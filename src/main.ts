import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { App } from './app/app';
import { setSoundEnabled } from './app/audio';
import { setKeepAwake } from './app/wake';
import { bumpAttempts, currentSetup, getBest, getBestSectors, getSettings, getTyre, saveSettings, setBest, updateBestSectors } from './app/store';
import { HomeScreen } from './screens/home';
import { DrawScreen } from './screens/draw';
import { RaceScreen, type CamSnapshot } from './screens/race';
import { ResultsScreen } from './screens/results';
import { openLeaderboard } from './screens/leaderboard';
import { flushUnsubmitted } from './app/sync';
import { fetchLap, type ReplayLap } from './app/api';
import { unpackLine } from './sim/pack';
import type { LapResult } from './sim/lapsim';
import { initPwa } from './app/pwa';
import { watchForUpdates } from './app/update';
import { UpdateBanner } from './screens/update-banner';
import { CATALOG } from './data/catalog';
import { simulateLap } from './sim/lapsim';
import { decodePath, encodePath, validatePath } from './sim/path';
import type { Track } from './sim/track';
import type { Compound } from './sim/types';

const app = new App();
const updates = new UpdateBanner(app, (s) => s instanceof HomeScreen || s instanceof ResultsScreen);
app.onShow = () => updates.sync();
setSoundEnabled(getSettings().sound);
setKeepAwake(getSettings().keepAwake);
let currentSlug = getSettings().lastTrack;

function home(slug = currentSlug): void {
  currentSlug = slug;
  app.show(new HomeScreen(app, { draw: (s, c) => void draw(s, c), leaderboard: (s) => board(s) }, slug));
}

/** A circuit's leaderboard, from wherever it is opened. */
function board(slug: string): void {
  openLeaderboard(app, slug, {
    watch: (rank) => watch(slug, rank),
    // Copying a setup can change the tyre the home screen shows.
    copied: () => {
      const cur = app.current;
      if (cur instanceof HomeScreen) cur.refresh();
    },
  });
}

/**
 * Watch a leaderboard lap in real time. It re-simulates from the stored line,
 * so it is the exact lap on the board. The ghost is the current P1, or your
 * own best when watching P1.
 */
async function watch(slug: string, rank: number): Promise<void> {
  const track = await app.track(slug);
  const [lap, p1] = await Promise.all([fetchLap(slug, rank), rank === 1 ? Promise.resolve(null) : fetchLap(slug, 1).catch(() => null)]);
  const run = (r: ReplayLap) => simulateLap(track, decodePath(unpackLine(r.line)), r.compound);
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
      ghost = simulateLap(track, decodePath(pb.code), pb.compound);
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

async function draw(slug: string, compound: Compound): Promise<void> {
  currentSlug = slug;
  saveSettings({ lastTrack: slug });
  if (history.state?.screen !== 'session') history.pushState({ screen: 'session' }, '');
  const track = await app.track(slug);
  const art = app.art(track);
  const best = getBest(slug);
  const guide = best ? decodePath(best.code) : null;
  app.show(new DrawScreen(app, track, art, compound, { complete: (pts) => race(track, compound, pts), exit: () => home(slug) }, guide));
}

function race(track: Track, compound: Compound, pts: number[]): void {
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
  const lap = simulateLap(track, points, compound);
  const previous = getBest(slug);
  const ghost = previous ? simulateLap(track, decodePath(previous.code), previous.compound) : null;
  const bestSectorsBefore = getBestSectors(slug);
  const attempt = bumpAttempts(slug);
  const isPb = !previous || lap.timeMs < previous.timeMs;
  const setup = currentSetup();
  if (isPb) {
    setBest(slug, { timeMs: lap.timeMs, compound, sectorsMs: lap.sectorsMs, code, date: new Date().toISOString(), submitted: false, setup });
  }
  updateBestSectors(slug, lap.sectorsMs);
  const showResults = (from: CamSnapshot) =>
    app.show(
      new ResultsScreen(app, track, art, { lap, points, code, previous, bestSectorsBefore, isPb, attempt, setup }, {
        // The tyre chosen for this circuit, which copying a setup from the leaderboard can change.
        again: () => void draw(slug, getTyre(slug)),
        leaderboard: () => board(slug),
        home: () => home(slug),
      }, from),
    );
  app.show(new RaceScreen(app, track, art, lap, ghost, bestSectorsBefore, { finished: showResults, exit: () => home(slug) }));
}

window.addEventListener('popstate', () => {
  // A stray back swipe must not throw away a half-drawn lap.
  const cur = app.current;
  if (cur instanceof DrawScreen && cur.status === 'drawing') {
    history.pushState({ screen: 'session' }, '');
    return;
  }
  home();
});

if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __pl: unknown }).__pl = { app, race };
}

/** Links from lap alerts: `?track=<slug>&board=1` opens that circuit's leaderboard. */
function openLink(search: string): boolean {
  const q = new URLSearchParams(search);
  const slug = q.get('track');
  if (!slug || !CATALOG.some((m) => m.slug === slug)) return false;
  // Never throw away a lap being drawn or raced.
  const cur = app.current;
  if ((cur instanceof DrawScreen && cur.status === 'drawing') || cur instanceof RaceScreen) return true;
  home(slug);
  if (q.has('board')) board(slug);
  return true;
}

if (openLink(location.search)) {
  const q = new URLSearchParams(location.search);
  q.delete('track');
  q.delete('board');
  history.replaceState(history.state, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
} else {
  home();
}
initPwa((search) => void openLink(search));
watchForUpdates(() => updates.available());
void flushUnsubmitted();
