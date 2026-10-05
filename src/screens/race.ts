// Real-time playback of the simulated lap. The car comes through the final
// corner on a flying lap, the clock starts at the line, sectors light up in
// timing colours and the personal-best ghost runs alongside. The same screen
// replays leaderboard laps, with the current P1 as the ghost.

import type { App, Screen } from '../app/app';
import { startEngine, stopEngine, sfx, updateEngine } from '../app/audio';
import { formatDelta, formatLap, formatSector, kmh } from '../app/format';
import { Camera, angleForHeading, lerpAngle } from '../render/camera';
import { GHOST_LIVERY, drawCar, makeCarSprite } from '../render/car-art';
import { liveryById } from '../render/liveries';
import { getSettings } from '../app/store';
import { polyPath, strokeInk } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { COMPOUND_SPECS, ERS } from '../sim/car';
import type { LapResult } from '../sim/lapsim';
import type { Track } from '../sim/track';
import { ICONS, h, setText, svg, tyreBadge } from '../ui/dom';

export type SectorColour = 'purple' | 'green' | 'yellow';

export interface CamSnapshot {
  cx: number;
  cy: number;
  zoom: number;
  angle: number;
  ay: number;
}

export interface RaceActions {
  finished(from: CamSnapshot): void;
  exit(): void;
}

/** Watching a leaderboard lap instead of running your own. */
export interface ReplayInfo {
  driver: string;
  rank: number;
  /** Who the ghost is, e.g. "Lando, P1" or "your best"; null without a ghost. */
  ghostName: string | null;
}

/** Active aero indicator, as on the 2026 broadcast: wing bars angled in corner mode, flat in straight mode. */
const AERO_GLYPH =
  '<svg class="aero-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g class="aero-corner"><path d="M6.5 19.5L11 4.5M13 19.5L17.5 4.5"/></g><g class="aero-straight"><path d="M4 9h16M4 15h16"/></g></svg>';

const RUN_UP = 2.6;
const RUN_OUT = 2.2;

interface Sample {
  x: number;
  y: number;
  hx: number;
  hy: number;
  v: number;
  s: number;
  i: number;
  f: number;
}

export function sampleAt(lap: LapResult, tIn: number): Sample {
  const T = lap.t[lap.n];
  let t = tIn % T;
  if (t < 0) t += T;
  let lo = 0, hi = lap.n;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lap.t[mid] <= t) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const j = i + 1 >= lap.n ? 0 : i + 1;
  const span = lap.t[i + 1] - lap.t[i];
  const f = span > 0 ? (t - lap.t[i]) / span : 0;
  const x = lap.x[i] + (lap.x[j] - lap.x[i]) * f;
  const y = lap.y[i] + (lap.y[j] - lap.y[i]) * f;
  const p = i === 0 ? lap.n - 1 : i - 1;
  const q = j + 1 >= lap.n ? 0 : j + 1;
  let hx = lap.x[q] - lap.x[p];
  let hy = lap.y[q] - lap.y[p];
  const hl = Math.hypot(hx, hy) || 1;
  hx /= hl;
  hy /= hl;
  const sNext = j === 0 ? lap.s[i] + (lap.s[i] - (lap.s[p] ?? lap.s[i])) : lap.s[j];
  return { x, y, hx, hy, v: lap.v[i] + (lap.v[j] - lap.v[i]) * f, s: lap.s[i] + (sNext - lap.s[i]) * f, i, f };
}

/** Time (s) at which a lap reached track progress s. */
export function timeAtProgress(lap: LapResult, s: number): number {
  let lo = 0, hi = lap.n - 1;
  if (s <= lap.s[0]) return 0;
  if (s >= lap.s[hi]) return lap.t[hi];
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (lap.s[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = lap.s[hi] - lap.s[lo];
  const f = span > 0 ? (s - lap.s[lo]) / span : 0;
  return lap.t[lo] + (lap.t[hi] - lap.t[lo]) * f;
}

export function sectorColour(ms: number, k: number, track: Track, bestSectors: [number, number, number] | null): SectorColour {
  const poleSector = track.meta.poleRef * 1000 * track.meta.poleSectors[k];
  if (ms <= poleSector) return 'purple';
  if (!bestSectors || ms <= bestSectors[k]) return 'green';
  return 'yellow';
}

export class RaceScreen implements Screen {
  private cam = new Camera();
  private sprite = makeCarSprite(liveryById(getSettings().livery));
  private ghostSprite = makeCarSprite(GHOST_LIVERY);
  private path: Path2D;
  private start = 0;
  private el: HTMLElement;
  private timer: HTMLElement;
  private delta: HTMLElement;
  private speed: HTMLElement;
  private gear: HTMLElement;
  private leds: HTMLElement[] = [];
  private aero: HTMLElement;
  private aeroOn = false;
  private ersFill: HTMLElement;
  private ersBox: HTMLElement;
  private tyreTemp: HTMLElement;
  private tyreChip: HTMLElement;
  private banner: HTMLElement;
  private sectors: HTMLElement[] = [];
  private sectorDone = [false, false, false];
  private finishedFlag = false;
  private done = false;
  private heading = 0;
  private trail: { x: number; y: number }[] = [];
  private zoomBase: number;

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private lap: LapResult,
    private ghost: LapResult | null,
    private bestSectors: [number, number, number] | null,
    private actions: RaceActions,
    private replay: ReplayInfo | null = null,
  ) {
    app.setCanvasVisible(true);
    this.path = polyPath(Array.from({ length: lap.n * 2 }, (_, k) => (k % 2 === 0 ? lap.x[k >> 1] : lap.y[k >> 1])));
    this.zoomBase = Math.min(app.w, app.h) > 700 ? 1.15 : 1;

    this.timer = h('div', { class: 'race-time' }, formatLap(0));
    this.delta = h('div', { class: 'race-delta', hidden: !ghost }, ghost ? (replay ? `vs ${replay.ghostName}` : 'vs best') : '');
    for (let k = 0; k < 3; k++) this.sectors.push(h('div', { class: 'sector' }, h('span', null, `S${k + 1}`), h('b', null, '')));
    this.speed = h('div', { class: 'speed' }, '0');
    this.gear = h('div', { class: 'gear' }, 'N');
    const ledBox = h('div', { class: 'leds', 'aria-hidden': 'true' });
    for (let k = 0; k < 15; k++) {
      const led = h('i', { class: k < 5 ? 'g' : k < 10 ? 'r' : 'p' });
      this.leds.push(led);
      ledBox.append(led);
    }
    this.aero = h(
      'div',
      { class: 'aero-chip', role: 'img', 'aria-label': 'Active aero: corner mode', title: 'Active aero: wings flat in straight mode on designated straights, angled in corner mode everywhere else' },
      h('span', { class: 'aero-label' }, 'Active aero'),
      svg(AERO_GLYPH),
    );
    this.ersFill = h('i');
    this.ersBox = h('div', { class: 'ers', title: 'Battery' }, h('span', null, 'ERS'), h('div', { class: 'ers-bar' }, this.ersFill));
    this.tyreTemp = h('span', null, '');
    this.tyreChip = h('div', { class: 'tyre-chip', html: tyreBadge(lap.compound, 24) }, this.tyreTemp);
    this.banner = h('div', { class: 'race-banner' }, replay ? `${replay.driver}, P${replay.rank}` : 'Flying lap');

    this.el = h(
      'div',
      { class: 'race-hud' },
      h(
        'div',
        { class: 'strip strip-top race-top' },
        h('div', { class: 'race-clock' }, this.timer, this.delta, replay ? h('div', { class: 'race-who' }, `Watching ${replay.driver}, P${replay.rank}`) : null),
        h('div', { class: 'sectors' }, ...this.sectors),
      ),
      this.banner,
      // Skip sits above the bottom strip, where a thumb already is, clear of the timing card.
      h(
        'div',
        { class: 'race-foot' },
        h('button', { class: 'skip', onclick: () => this.skip(), html: `<span>Skip</span>${ICONS.skip}` }),
        h('div', { class: 'strip race-bottom' }, h('div', { class: 'speedo' }, this.speed, h('small', null, 'km/h')), this.gear, h('div', { class: 'race-power' }, ledBox, this.ersBox), h('div', { class: 'race-chips' }, this.aero, this.tyreChip)),
      ),
    );
    app.root.append(this.el);
    this.resize();
    this.start = performance.now() + 250;
    const s0 = sampleAt(lap, -RUN_UP);
    this.heading = angleForHeading(s0.hx, s0.hy);
    this.cam.angle = this.heading;
    this.cam.cx = s0.x;
    this.cam.cy = s0.y;
    this.cam.zoom = this.targetZoom(s0.v);
    startEngine();
  }

  private targetZoom(v: number): number {
    const z = 9 - (v - 20) * 0.06;
    return Math.max(4.6, Math.min(9, z)) * this.zoomBase;
  }

  /** Jump to just before the line so the finish still lands; a second tap goes straight to results. */
  private skip(): void {
    if (this.done) return;
    const T = this.lap.t[this.lap.n];
    const elapsed = (performance.now() - this.start) / 1000 - RUN_UP;
    if (this.finishedFlag || elapsed > T - 1.6) {
      this.finishNow();
      return;
    }
    this.start = performance.now() - (T - 1.3 + RUN_UP) * 1000;
    // Fill in the sectors we jumped over without replaying their sounds.
    this.trail.length = 0;
  }

  private finishNow(): void {
    if (this.done) return;
    this.done = true;
    stopEngine();
    const c = this.cam;
    this.actions.finished({ cx: c.cx, cy: c.cy, zoom: c.zoom, angle: c.angle, ay: c.ay });
  }

  resize(): void {
    this.cam.w = this.app.w;
    this.cam.h = this.app.h;
    this.cam.ay = 0.62;
  }

  frame(now: number, dt: number): void {
    const T = this.lap.t[this.lap.n];
    const elapsed = (now - this.start) / 1000 - RUN_UP;
    const shown = Math.max(0, Math.min(elapsed, T));
    const smp = sampleAt(this.lap, elapsed < T ? elapsed : T + (elapsed - T));

    // Camera follows with a little lag.
    const target = angleForHeading(smp.hx, smp.hy);
    this.heading = lerpAngle(this.heading, target, 1 - Math.exp(-dt * 5));
    this.cam.angle = this.heading;
    this.cam.cx = smp.x;
    this.cam.cy = smp.y;
    this.cam.zoom += (this.targetZoom(smp.v) - this.cam.zoom) * (1 - Math.exp(-dt * 1.6));

    const { ctx } = this.app;
    const dpr = this.app.dpr;
    this.cam.apply(ctx, dpr);
    this.art.draw(ctx, this.cam);
    strokeInk(ctx, this.path, this.cam.zoom, undefined, 0.42);

    // Light trail behind the car.
    this.trail.push({ x: smp.x, y: smp.y });
    if (this.trail.length > 22) this.trail.shift();
    if (this.trail.length > 2) {
      ctx.lineCap = 'round';
      for (let k = 1; k < this.trail.length; k++) {
        const a = this.trail[k - 1], b = this.trail[k];
        ctx.strokeStyle = `rgba(155,48,255,${(k / this.trail.length) * 0.5})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    if (this.ghost) {
      const gT = this.ghost.t[this.ghost.n];
      const ge = elapsed < 0 ? gT + elapsed : elapsed;
      if (ge <= gT + RUN_OUT) {
        const g = sampleAt(this.ghost, ge);
        drawCar(ctx, this.ghostSprite, g.x, g.y, Math.atan2(g.hy, g.hx), 0.5);
      }
    }
    drawCar(ctx, this.sprite, smp.x, smp.y, Math.atan2(smp.hy, smp.hx));

    // HUD
    const i = smp.i;
    const lap = this.lap;
    setText(this.timer, formatLap(shown * 1000));
    setText(this.speed, String(kmh(smp.v)));
    setText(this.gear, String(lap.gear[i]));
    const rpm = lap.rpm[i];
    const lit = Math.round(Math.max(0, Math.min(1, (rpm - 10300) / 1800)) * 15);
    for (let k = 0; k < 15; k++) this.leds[k].classList.toggle('on', k < lit);
    const straight = lap.straight[i] === 1;
    if (straight !== this.aeroOn) {
      this.aeroOn = straight;
      this.aero.classList.toggle('on', straight);
      this.aero.setAttribute('aria-label', `Active aero: ${straight ? 'straight' : 'corner'} mode`);
    }
    const charge = Math.max(0, Math.min(1, lap.soc[i] / ERS.capacity));
    this.ersFill.style.transform = `scaleX(${charge.toFixed(3)})`;
    const clipping = lap.throttle[i] === 1 && lap.deploy[i] < 1000 && smp.v > lap.stats.clipSpeed - 2;
    const ersState = clipping ? 'clip' : lap.regen[i] > 1000 ? 'harvest' : lap.soc[i] < ERS.reserve * 0.3 ? 'flat' : lap.deploy[i] > 1000 ? 'deploy' : 'idle';
    if (this.ersBox.dataset.state !== ersState) this.ersBox.dataset.state = ersState;
    const spec = COMPOUND_SPECS[lap.compound];
    const temp = lap.tyre[i];
    setText(this.tyreTemp, `${Math.round(temp)}°`);
    const state = temp < spec.tOpt - spec.window ? 'cold' : temp > spec.tOpt + spec.window ? 'hot' : 'ok';
    if (this.tyreChip.dataset.state !== state) this.tyreChip.dataset.state = state;
    updateEngine(rpm, lap.throttle[i], smp.v);

    if (elapsed > 0.6 && !this.banner.classList.contains('is-gone')) this.banner.classList.add('is-gone');

    if (this.ghost && elapsed > 0.2 && elapsed < T && !this.finishedFlag) {
      const gt = timeAtProgress(this.ghost, smp.s);
      const d = (elapsed - gt) * 1000;
      setText(this.delta, formatDelta(d));
      this.delta.dataset.sign = d <= 0 ? 'up' : 'down';
    }

    // Sectors.
    let acc = 0;
    for (let k = 0; k < 3; k++) {
      acc += lap.sectorsMs[k];
      if (!this.sectorDone[k] && elapsed * 1000 >= acc) {
        this.sectorDone[k] = true;
        const ms = lap.sectorsMs[k];
        const colour = sectorColour(ms, k, this.track, this.bestSectors);
        const box = this.sectors[k];
        box.dataset.c = colour;
        setText(box.querySelector('b')!, formatSector(ms));
        sfx.sector(colour);
      }
    }

    if (!this.finishedFlag && elapsed >= T) {
      this.finishedFlag = true;
      setText(this.timer, formatLap(lap.timeMs));
      this.el.classList.add('is-finished');
      sfx.finish(false);
      const g = this.ghost;
      const d = g ? lap.timeMs - g.timeMs : 0;
      if (g) {
        setText(this.delta, formatDelta(d));
        this.delta.dataset.sign = d <= 0 ? 'up' : 'down';
      }
      const r = this.replay;
      const sub = r
        ? !g
          ? `P${r.rank} on the world board`
          : d < 0
            ? `${formatDelta(d)} faster than ${r.ghostName}`
            : d === 0
              ? `Level with ${r.ghostName}`
              : `${formatDelta(d)} to ${r.ghostName}`
        : !g
          ? 'First timed lap'
          : d < 0
            ? `Personal best ${formatDelta(d)}`
            : `${formatDelta(d)} to your best`;
      this.el.append(
        h('div', { class: `race-finish${!g || d < 0 ? ' is-pb' : ''}`, role: 'status' }, h('b', null, formatLap(lap.timeMs)), h('span', null, sub)),
      );
    }
    if (elapsed >= T + RUN_OUT) this.finishNow();
  }

  destroy(): void {
    stopEngine();
    this.el.remove();
  }
}
