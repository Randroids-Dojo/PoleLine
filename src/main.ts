import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { App } from './app/app';
import { setSoundEnabled } from './app/audio';
import { setKeepAwake } from './app/wake';
import { bumpAttempts, getBest, getBestSectors, getSettings, saveSettings, setBest, updateBestSectors } from './app/store';
import { HomeScreen } from './screens/home';
import { DrawScreen } from './screens/draw';
import { RaceScreen, type CamSnapshot } from './screens/race';
import { ResultsScreen } from './screens/results';
import { openLeaderboard } from './screens/leaderboard';
import { flushUnsubmitted } from './app/sync';
import { initPwa } from './app/pwa';
import { CATALOG } from './data/catalog';
import { simulateLap } from './sim/lapsim';
import { decodePath, encodePath, validatePath } from './sim/path';
import type { Track } from './sim/track';
import type { Compound } from './sim/types';

const app = new App();
setSoundEnabled(getSettings().sound);
setKeepAwake(getSettings().keepAwake);
let currentSlug = getSettings().lastTrack;

function home(slug = currentSlug): void {
  currentSlug = slug;
  app.show(new HomeScreen(app, { draw: (s, c) => void draw(s, c), leaderboard: (s) => openLeaderboard(app, s) }, slug));
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
  if (isPb) {
    setBest(slug, { timeMs: lap.timeMs, compound, sectorsMs: lap.sectorsMs, code, date: new Date().toISOString(), submitted: false });
  }
  updateBestSectors(slug, lap.sectorsMs);
  const showResults = (from: CamSnapshot) =>
    app.show(
      new ResultsScreen(app, track, art, { lap, points, code, previous, bestSectorsBefore, isPb, attempt }, {
        again: () => void draw(slug, compound),
        leaderboard: () => openLeaderboard(app, slug),
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
  if (q.has('board')) openLeaderboard(app, slug);
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
void flushUnsubmitted();
