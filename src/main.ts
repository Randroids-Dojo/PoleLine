import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import { App } from './app/app';
import { setSoundEnabled } from './app/audio';
import { bumpAttempts, getBest, getBestSectors, getSettings, saveSettings, setBest, updateBestSectors } from './app/store';
import { HomeScreen } from './screens/home';
import { DrawScreen } from './screens/draw';
import { RaceScreen } from './screens/race';
import { ResultsScreen } from './screens/results';
import { openLeaderboard } from './screens/leaderboard';
import { simulateLap } from './sim/lapsim';
import { decodePath, encodePath, validatePath } from './sim/path';
import type { Track } from './sim/track';
import type { Compound } from './sim/types';

const app = new App();
setSoundEnabled(getSettings().sound);
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
  app.show(new DrawScreen(app, track, art, compound, { complete: (pts) => race(track, compound, pts), exit: () => home(slug) }));
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
  const showResults = () =>
    app.show(
      new ResultsScreen(app, track, art, { lap, points, code, previous, bestSectorsBefore, isPb, attempt }, {
        again: () => void draw(slug, compound),
        leaderboard: () => openLeaderboard(app, slug),
        home: () => home(slug),
      }),
    );
  app.show(new RaceScreen(app, track, art, lap, ghost, bestSectorsBefore, { finished: showResults, exit: () => home(slug) }));
}

window.addEventListener('popstate', () => home());

if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __pl: unknown }).__pl = { app };
}

home();
