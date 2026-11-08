import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { App } from './app/app';
import { setSoundEnabled } from './app/audio';
import { setKeepAwake } from './app/wake';
import { bumpAttempts, currentSetup, getBest, getBestSectors, getSettings, getTyre, saveSettings, setBest, updateBestSectors } from './app/store';
import { SegmentScreen, type SegmentTutorial } from './screens/segments';
import type { DrawMode } from './app/draw-mode';
import { brakeZones, courseFor, decodePicks, encodePicks, type Pick } from './app/segments';
import { coachFor, startCoach } from './app/coach-client';
import { HomeScreen } from './screens/home';
import { DrawScreen } from './screens/draw';
import { TUTORIAL_COPY } from './app/tutorial-copy';
import { RaceScreen, timeAtProgress, type CamSnapshot, type RaceCaption } from './screens/race';
import { ResultsScreen } from './screens/results';
import { openLeaderboard } from './screens/leaderboard';
import { openLinePicker, openTimes } from './screens/times';
import { flushUnsubmitted } from './app/sync';
import { fetchLap, type ReplayLap } from './app/api';
import { addLap, getLaps, whenText, type SavedLap } from './app/laps';
import { LOCAL_ONLY, REAL_CIRCUITS } from './app/edition';
import { initNative } from './app/native';
import { unpackLine } from './sim/pack';
import type { LapResult } from './sim/lapsim';
import { initPwa } from './app/pwa';
import { watchForUpdates } from './app/update';
import { UpdateBanner } from './screens/update-banner';
import { CATALOG } from './data/catalog';
import { TUTORIAL } from './data/tutorial';
import type { DrawTutorial } from './screens/draw';
import { simulateLap, simulatePlan } from './sim/lapsim';
import { decodePath, encodePath, validatePath } from './sim/path';
import type { Track } from './sim/track';
import type { Compound } from './sim/types';

const app = new App();
// The Toybox edition ships as an app store build: no newer deploy to spot.
const updates = LOCAL_ONLY ? null : new UpdateBanner(app, (s) => s instanceof HomeScreen || s instanceof ResultsScreen);
app.onShow = () => updates?.sync();
setSoundEnabled(getSettings().sound);
setKeepAwake(getSettings().keepAwake);
let currentSlug = getSettings().lastTrack;

function home(slug = currentSlug): void {
  currentSlug = slug;
  app.show(new HomeScreen(app, { draw: (s, c, walkthrough) => void draw(s, c, walkthrough), leaderboard: (s) => board(s), edit: (s) => pickLine(s) }, slug));
}

// Tutorial -----------------------------------------------------------------

/** Absolute decimetre points from delta code. */
function absolute(code: readonly number[]): number[] {
  const out: number[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < code.length; i += 2) {
    x += code[i];
    y += code[i + 1];
    out.push(x, y);
  }
  return out;
}

function tutorialFor(walkthrough: boolean): DrawTutorial {
  return {
    prefix: absolute(TUTORIAL.line).slice(0, TUTORIAL.prefixPoints * 2),
    handoff: TUTORIAL.handoff,
    cornerIn: TUTORIAL.cornerIn,
    apex: TUTORIAL.apex,
    cornerOut: TUTORIAL.cornerOut,
    walkthrough,
  };
}

/** The ideal way through the last corner, from the handover to the line (metres), as a dotted guide. */
function idealFinish(): Float64Array {
  return decodePath(TUTORIAL.line).slice((TUTORIAL.prefixPoints - 1) * 2);
}

function endTutorial(state: 'done' | 'skipped'): void {
  if (!getSettings().tutorial) saveSettings({ tutorial: state });
}

/** Where the championship picks up: the last real circuit played, else round 1. */
function championshipSlug(): string {
  const last = app.meta(getSettings().lastTrack);
  return last.tutorial ? CATALOG.find((m) => !m.tutorial)!.slug : last.slug;
}

/** A circuit's leaderboard (the web edition) or your own times (the Toybox edition), from wherever it is opened. */
function board(slug: string): void {
  // Copying a setup can change the tyre the home screen shows.
  const copied = () => {
    const cur = app.current;
    if (cur instanceof HomeScreen) cur.refresh();
  };
  if (LOCAL_ONLY) {
    openTimes(app, slug, { watch: (index) => watchOwn(slug, index), copied });
    return;
  }
  openLeaderboard(app, slug, { watch: (rank) => watch(slug, rank), copied });
}

/**
 * Watch one of your own saved laps in real time, against your quickest lap
 * (or the next quickest, when watching the quickest).
 */
async function watchOwn(slug: string, index: number): Promise<void> {
  const track = await app.track(slug);
  const laps = getLaps(slug);
  const lap = laps[index];
  if (!lap) throw new Error('no such lap');
  const run = (l: SavedLap) => lapOf(track, decodePath(l.code), l.compound, l.brakes);
  const result = run(lap);
  const other = index === 0 ? laps[1] : laps[0];
  const ghost = other ? run(other) : null;
  const ghostName = other ? (index === 0 ? 'your second best' : 'your best') : null;
  currentSlug = slug;
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  const back = () => {
    home(slug);
    board(slug);
  };
  app.show(new RaceScreen(app, track, app.art(track), result, ghost, ghost ? ghost.sectorsMs : null, { finished: back, exit: back }, { driver: whenText(lap.date), rank: index + 1, ghostName }));
}

/**
 * Watch a leaderboard lap in real time. It re-simulates from the stored line,
 * so it is the exact lap on the board. The ghost is the current P1, or your
 * own best when watching P1.
 */
async function watch(slug: string, rank: number): Promise<void> {
  const track = await app.track(slug);
  const [lap, p1] = await Promise.all([fetchLap(slug, rank), rank === 1 ? Promise.resolve(null) : fetchLap(slug, 1).catch(() => null)]);
  const run = (r: ReplayLap) => lapOf(track, decodePath(unpackLine(r.line)), r.compound, r.brakes);
  const result = run(lap);
  if (result.timeMs !== lap.timeMs) console.warn('replay time differs', result.timeMs, lap.timeMs);
  let ghost: LapResult | null = null;
  let ghostName: string | null = null;
  if (p1) {
    ghost = run(p1);
    ghostName = `${p1.name}, P1`;
  } else if (rank === 1) {
    const pb = getBest(slug);
    if (pb && pb.timeMs !== lap.timeMs) {
      ghost = lapOf(track, decodePath(pb.code), pb.compound, pb.brakes);
      ghostName = 'your best';
    }
  }
  currentSlug = slug;
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  const back = () => {
    home(slug);
    board(slug);
  };
  // Sector colours compare against the ghost: green where this lap was quicker.
  app.show(new RaceScreen(app, track, app.art(track), result, ghost, ghost ? ghost.sectorsMs : null, { finished: back, exit: back }, { driver: lap.name, rank, ghostName }));
}

/** A saved line to edit: its points (delta code), the tyre it ran on and its time. */
interface EditSource {
  code: number[];
  compound: Compound;
  timeMs: number;
}

/** Choose one of your saved lines on a circuit to edit. */
function pickLine(slug: string): void {
  openLinePicker(app, slug, {
    edit: async (index) => {
      const lap = getLaps(slug)[index];
      if (!lap) throw new Error('no such lap');
      // A lap laid segment by segment opens as its segments, while the circuit is still cut the same way.
      const picks = lap.picks ? decodePicks(lap.picks) : null;
      if (picks && picks.length === courseFor(await app.track(slug)).segments.length) return editSegments(slug, picks, lap.compound);
      return editLine(slug, lap);
    },
  });
}

/**
 * Open a saved line whole in the draw screen, ready to redraw any part of it.
 * Rejects when the line no longer passes the circuit's checks.
 */
async function editLine(slug: string, from: EditSource): Promise<void> {
  const track = await app.track(slug);
  if (!validatePath(track, decodePath(from.code)).ok) throw new Error('saved line is not a legal lap');
  currentSlug = slug;
  if (!track.meta.tutorial) saveSettings({ lastTrack: slug });
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  app.show(
    new DrawScreen(app, track, app.art(track), from.compound, { complete: (pts, tyre) => race(track, tyre, pts, false, from), exit: () => home(slug) }, null, null, absolute(from.code)),
  );
}

async function draw(slug: string, compound: Compound, walkthrough = false, skipIntro = false): Promise<void> {
  currentSlug = slug;
  const meta = app.meta(slug);
  if (!meta.tutorial) saveSettings({ lastTrack: slug });
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  const track = await app.track(slug);
  const art = app.art(track);
  const best = getBest(slug);
  // On the tutorial circuit the guide is always the suggested way through the last corner, which
  // crosses the finish where the drawn lap began; elsewhere your best lap is the guide.
  const bestLine = best ? decodePath(best.code) : null;
  const guide = meta.tutorial ? idealFinish() : bestLine;
  const leave = () => {
    if (walkthrough) endTutorial('skipped');
    home(walkthrough ? championshipSlug() : slug);
  };
  // The tutorial switches between laying and drawing when the player changes
  // difficulty on its welcome card or pause menu, carrying on at their turn.
  const switchMode = (m: DrawMode) => {
    // The pause menu the switch came from closes with the screen it belonged to.
    app.root.querySelectorAll('.overlay').forEach((o) => o.remove());
    saveSettings({ drawMode: m });
    void draw(slug, getTyre(slug), walkthrough, true);
  };
  // Segment by segment lays the lap a segment at a time (on the tutorial
  // circuit, the last corner of the lap laid for the player).
  if (getSettings().drawMode === 'segments') {
    const tutorial: SegmentTutorial | null = meta.tutorial
      ? { prefix: tutorialFor(walkthrough).prefix, ideal: decodePath(TUTORIAL.line), guide: idealFinish(), walkthrough, skipIntro }
      : null;
    app.show(new SegmentScreen(app, track, art, compound, { complete: (pts, tyre, picks) => race(track, tyre, pts, walkthrough, null, picks), exit: leave, skip: leave, switchMode }, null, null, tutorial));
    return;
  }
  app.show(
    new DrawScreen(
      app,
      track,
      art,
      compound,
      { complete: (pts, tyre) => race(track, tyre, pts, walkthrough), exit: leave, skip: leave, switchMode },
      guide,
      meta.tutorial ? { ...tutorialFor(walkthrough), skipIntro } : null,
    ),
  );
}

/** A lap as it is scored: a drawn line on its own, or a plan laid segment by segment with its brake zones. */
function lapOf(track: Track, points: Float64Array, compound: Compound, brakes?: readonly number[]): LapResult {
  return brakes ? simulatePlan(track, points, compound, brakes) : simulateLap(track, points, compound);
}

/**
 * Race a lap. `edited` is the saved line it was edited from, if it was;
 * `picks` the segments it was laid with, if it was laid segment by segment
 * (its brake zones then go with it everywhere: the board, bests, saved laps).
 */
function race(track: Track, compound: Compound, pts: number[], walkthrough = false, edited: EditSource | null = null, picks: Pick[] | null = null): void {
  const slug = track.meta.slug;
  const art = app.art(track);
  const code = encodePath(pts);
  const points = decodePath(code);
  const valid = validatePath(track, points);
  if (!valid.ok) {
    console.error('drawn line failed validation', valid);
    void draw(slug, compound);
    return;
  }
  const course = picks ? courseFor(track) : null;
  const brakes = picks && course ? brakeZones(course, picks) : undefined;
  const plan = picks && brakes ? { brakes, picks: encodePicks(picks) } : {};
  const lap = lapOf(track, points, compound, brakes);
  // Where a lap laid segment by segment lost time is worked out in a worker while the race plays.
  // (Not on the tutorial, whose lap is mostly laid for the player.)
  const coach = picks && course && !track.meta.tutorial ? startCoach(track, course, picks, compound) : null;
  const previous = getBest(slug);
  const ghost = previous ? lapOf(track, decodePath(previous.code), previous.compound, previous.brakes) : null;
  const bestSectorsBefore = getBestSectors(slug);
  const attempt = bumpAttempts(slug);
  const isPb = !previous || lap.timeMs < previous.timeMs;
  const setup = currentSetup();
  const date = new Date().toISOString();
  // Your quickest laps stay on the device with their lines, to edit later. The
  // Toybox edition shows them where the web edition shows the leaderboard.
  // Recorded before a new best replaces the old one, so a best kept from
  // before laps were (the web edition) joins the list instead of being lost.
  const added = addLap(slug, { timeMs: lap.timeMs, compound, sectorsMs: lap.sectorsMs, code, date, setup, ...plan });
  const kept = LOCAL_ONLY ? added : null;
  if (isPb) {
    setBest(slug, { timeMs: lap.timeMs, compound, sectorsMs: lap.sectorsMs, code, date, submitted: false, setup, ...plan });
  }
  updateBestSectors(slug, lap.sectorsMs);
  const showResults = (from: CamSnapshot) => {
    // Finishing the walkthrough lap completes the tutorial.
    if (walkthrough) endTutorial('done');
    app.show(
      new ResultsScreen(app, track, art, { lap, points, code, brakes, previous, bestSectorsBefore, isPb, attempt, setup, walkthrough, kept, editedFrom: edited?.timeMs ?? null, segments: !!picks, coach }, {
        // The tyre chosen for this circuit, which copying a setup from the leaderboard can change.
        again: () => void draw(slug, getTyre(slug)),
        // The lap just raced, opened whole to change another part (as its segments, if it was laid that way).
        // Not on the tutorial, whose lap is mostly laid for you.
        edit: track.meta.tutorial ? undefined : picks ? () => void editSegments(slug, picks, compound) : () => void editLine(slug, { code, compound, timeMs: lap.timeMs }),
        leaderboard: () => board(slug),
        home: () => home(slug),
        // The tutorial circuit always leads on to the championship.
        continueGame: track.meta.tutorial ? () => home(championshipSlug()) : undefined,
      }, from),
    );
  };
  // The walkthrough narrates the first lap it shows.
  const yours = walkthrough ? timeAtProgress(lap, TUTORIAL.handoff) : 0;
  const captions: RaceCaption[] = walkthrough
    ? [
        { at: -2.4, dur: 3.2, text: picks ? 'Here it comes on a flying lap, on your gas and brakes.' : 'Here it comes on a flying lap, driving the line exactly.' },
        { at: 2.5, dur: 4.5, text: 'Speed, gear, battery and tyres live in the bar below.' },
        { at: 9, dur: 4.5, text: REAL_CIRCUITS ? 'Sectors turn purple when they beat real pole pace.' : 'Sectors turn purple when they beat pole pace.' },
        { at: yours - 0.8, dur: 4.5, text: TUTORIAL_COPY[setup.drawMode ?? 'freehand'].yourCorner },
      ]
    : [];
  app.show(new RaceScreen(app, track, art, lap, ghost, bestSectorsBefore, { finished: showResults, exit: () => home(slug) }, null, captions));
}

/** Reopen a plan to change some of its segments. */
async function editSegments(slug: string, picks: Pick[], compound: Compound): Promise<void> {
  const track = await app.track(slug);
  currentSlug = slug;
  if (!track.meta.tutorial) saveSettings({ lastTrack: slug });
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  // The analysis of the lap just raced marks where this plan lost time.
  const coach = coachFor(slug, encodePicks(picks));
  app.show(new SegmentScreen(app, track, app.art(track), compound, { complete: (pts, tyre, p) => race(track, tyre, pts, false, null, p), exit: () => home(slug) }, picks, coach));
}

window.addEventListener('popstate', () => {
  // A stray back swipe must not throw away a half-drawn lap or an edited one.
  const cur = app.current;
  if ((cur instanceof DrawScreen || cur instanceof SegmentScreen) && cur.holdsWork) {
    history.pushState({ screen: 'session' }, '');
    return;
  }
  home();
});

if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __pl: unknown }).__pl = { app, race, draw, editLine, editSegments, coachFor };
}

/** Links from lap alerts: `?track=<slug>&board=1` opens that circuit's leaderboard. */
function openLink(search: string): boolean {
  const q = new URLSearchParams(search);
  const slug = q.get('track');
  if (!slug || !CATALOG.some((m) => m.slug === slug)) return false;
  // Never throw away a lap being drawn or raced.
  const cur = app.current;
  if (((cur instanceof DrawScreen || cur instanceof SegmentScreen) && cur.holdsWork) || cur instanceof RaceScreen) return true;
  home(slug);
  if (q.has('board')) board(slug);
  return true;
}

if (openLink(location.search)) {
  const q = new URLSearchParams(location.search);
  q.delete('track');
  q.delete('board');
  history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
} else if (!getSettings().tutorial) {
  // First launch: the walkthrough on the tutorial circuit, until it is finished or skipped.
  void draw(TUTORIAL.slug, getTyre(TUTORIAL.slug), true);
} else {
  home();
}
if (!LOCAL_ONLY) {
  initPwa((search) => void openLink(search));
  watchForUpdates(() => updates?.available());
  void flushUnsubmitted();
} else if ('serviceWorker' in navigator) {
  // Nothing is fetched, so nothing is cached: drop any worker left by an earlier build in this WebView.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {});
}
// The native shell: splash screen, haptics, keeping the screen awake and the Android back button.
void initNative({
  back: () => {
    const overlay = app.root.querySelector<HTMLElement>('.overlay');
    if (overlay) {
      overlay.remove();
      return true;
    }
    // On the circuits screen there is nothing to go back to: leave the app.
    if (app.current instanceof HomeScreen) return false;
    if (history.state?.screen === 'session') {
      history.back();
      return true;
    }
    return false;
  },
});
