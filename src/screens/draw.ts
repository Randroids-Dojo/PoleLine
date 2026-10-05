// Draw a lap. The map is zoomed so the track is a comfortable finger width and
// rotated so the road ahead points up the screen. Strokes draw exactly under
// the finger. When the tip runs out of room ahead the map has to move:
//   pause mode (default): the stroke ends, the camera glides on to frame the
//     next section, and the player lifts and carries on from the tip.
//   continuous mode: the map feeds forward under the finger while it moves,
//     at a player-chosen speed.
// Lifting the finger always glides the camera on. By default the map turns so
// the road ahead points up; with auto-rotate off it keeps whatever angle the
// player set with the compass (tap: N/E/S/W at the top, drag: any angle).
// Dragging on the grass pans the map at any time (with a little momentum); a
// button glides back to the tip when it is off screen. A stroke that crosses the
// white line stops at the edge; the player undoes that stroke (or carries on
// from the tip). Only a line that stays inside the limits can be raced.

import type { App, Screen } from '../app/app';
import { buzz, sfx, unlockAudio } from '../app/audio';
import { getSettings, saveSettings, setTyre, type ScrollMode, type Settings } from '../app/store';
import { tyreHint } from '../app/describe';
import { COMPOUND_SPECS } from '../sim/car';
import { openSettings } from './settings';
import { Camera, angleForHeading, easeInOutCubic, lerpAngle } from '../render/camera';
import { INK, polyPath, strokeInk } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { LineBuilder, START_TOUCH_RANGE } from '../sim/builder';
import { UNITS_PER_METRE } from '../sim/path';
import { frameAt, projectGlobal, projectNear, type Track } from '../sim/track';
import { COMPOUNDS, type Compound } from '../sim/types';
import { ICONS, h, setText, tyreBadge } from '../ui/dom';
import { Compass, angleForBearing, bearingAtTop, nextCardinal } from '../ui/compass';
import { CornerDamper, type CornerDamping } from '../app/damping';

export interface DrawActions {
  complete(points: number[], compound: Compound): void;
  exit(): void;
}

interface CamState {
  cx: number;
  cy: number;
  zoom: number;
  angle: number;
  ax: number;
  ay: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TIP_GRAB_RADIUS = 58;
/** A touch this far outside the white line (metres) counts as grass and pans the map. */
const GRASS_MARGIN = 0.6;
/** Help tips stay up this long (plus a little per character), then fade. */
const HINT_BASE_MS = 1800;
const HINT_PER_CHAR_MS = 35;
const HINT_MAX_MS = 4800;
/** In pause mode, end the stroke when the tip gets this close (px) to the edge of the drawing area ahead. */
const ADVANCE_ROOM = 64;
/** A stroke always gets at least this many metres before the map may move on. */
const MIN_STROKE = 8;
const PICKUP_EASE = 70;
/** Start warning when the line is this close (metres) to the edge of the track. */
const EDGE_WARN = 1.2;
const HINTS = {
  start: 'Put your finger on the chequered line and drag along the track.',
  drawing: 'Stay inside the white lines.',
  lifted: 'Lift whenever you like. Carry on from the purple tip.',
  advance: 'The map moved on. Lift your finger, then carry on from the purple tip.',
  resume: 'Carry on from the purple tip.',
  limits: 'Undo the stroke, or carry on from the wall.',
  panTap: 'Drag on the grass to move the map.',
  autoOff: 'Auto-rotate is off, so the map stays at your angle. Tap Auto to bring it back.',
  width: 'Use the whole width: wide on entry, clip the apex, wide on exit.',
  closing: 'Cross the line where you started for a clean flying lap.',
  backward: 'The line only flows forward.',
  grab: 'Carry on from the end of your line.',
};

export class DrawScreen implements Screen {
  private builder: LineBuilder;
  private cam = new Camera();
  private glide: { from: CamState; to: CamState; t0: number; dur: number } | null = null;
  private ink = new Path2D();
  private inkFrom = 0;
  private pointerId: number | null = null;
  private drawing = false;
  private zoom: number;
  private el: HTMLElement;
  private hint: HTMLElement;
  private bar: HTMLElement;
  private pct: HTMLElement;
  private undoBtn: HTMLButtonElement;
  /** Before the first stroke the bottom bar picks the tyre; it only matters once the lap is raced. */
  private tyreStrip!: HTMLElement;
  private tyreMark!: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniOutline: Path2D;
  private miniScale = 1;
  private miniOff = { x: 0, y: 0 };
  private flashUntil = 0;
  private limitsCard: HTMLElement | null = null;
  private stamp: HTMLElement | null = null;
  private tipPulse = 0;
  private strokes = 0;
  private finishedAt = 0;
  private backwardRun = 0;
  private shiftX = 0;
  private shiftY = 0;
  private pickup: { ox: number; oy: number; sx: number; sy: number } | null = null;
  private guidePath: Path2D | null = null;
  private warned = false;
  private listeners: [string, EventListener][] = [];
  private mode: ScrollMode;
  private scrollSpeed: number;
  /** The stroke was ended by the map moving on; waiting for the finger to lift. */
  private awaitLift = false;
  /** Lap progress when the current stroke began. */
  private strokeFrom = 0;
  private topStrip!: HTMLElement;
  private bottomStrip!: HTMLElement;
  private safe = { top: 96, bottom: 700, left: 14, right: 376 };
  /** HUD widgets floating over the map that the tip should not hide under. */
  private avoid: Rect[] = [];
  private autoRotate: boolean;
  private damping: CornerDamping;
  private damper: CornerDamper | null = null;
  private subtitle!: HTMLElement;
  private scrollShown = -1;
  private compass: Compass;
  private spin: { from: number; to: number; t0: number; dur: number; pivot: { x: number; y: number }; world: { x: number; y: number } } | null = null;
  private dragPivot: { pivot: { x: number; y: number }; world: { x: number; y: number } } | null = null;
  private coach: HTMLElement | null = null;
  private coachTimer: ReturnType<typeof setTimeout> | null = null;
  private panStart = { x: 0, y: 0, t: 0 };
  private panDistance = 0;
  private panning = false;
  private panLast = { x: 0, y: 0, t: 0 };
  private panVel = { x: 0, y: 0 };
  private momentum: { x: number; y: number } | null = null;
  private recenterBtn!: HTMLButtonElement;
  private recenterLabel!: HTMLElement;
  private recenterShown = false;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private compound: Compound,
    private actions: DrawActions,
    guide: Float64Array | null = null,
  ) {
    this.builder = new LineBuilder(track);
    if (guide) this.guidePath = polyPath(guide);
    const settings = getSettings();
    this.mode = settings.scrollMode;
    this.scrollSpeed = settings.scrollSpeed;
    this.autoRotate = settings.autoRotate;
    this.damping = settings.cornerDamping;
    this.compass = new Compass({
      tap: () => this.compassTap(),
      dragStart: () => this.compassDragStart(),
      drag: (d) => this.compassDrag(d),
      toggleAuto: () => this.setAutoRotate(!this.autoRotate, true),
    });
    this.compass.setAuto(this.autoRotate);
    app.setCanvasVisible(true);
    this.zoom = this.drawZoom();

    this.hint = h('p', { class: 'draw-hint', role: 'status' }, HINTS.start);
    this.bar = h('i');
    this.pct = h('span', { class: 'draw-pct' }, '0%');
    this.undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo last stroke', html: ICONS.undo, onclick: () => this.undo() }) as HTMLButtonElement;
    this.mini = h('canvas', { class: 'minimap', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniOutline = this.buildMiniOutline();

    this.topStrip = h(
      'div',
      { class: 'strip strip-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to circuits', html: ICONS.close, onclick: () => this.actions.exit() }),
      h('div', { class: 'draw-title' }, h('strong', null, track.meta.short), (this.subtitle = h('span', null, 'Draw your lap'))),
      h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings(this.app, (s) => this.applySettings(s)) }),
      (this.tyreMark = h('span', { class: 'draw-tyre', title: COMPOUND_SPECS[compound].label, html: tyreBadge(compound, 26) })),
    );
    this.tyreStrip = h('div', { class: 'strip strip-bottom draw-tyres', role: 'radiogroup', 'aria-label': 'Tyre for this lap' });
    for (const c of COMPOUNDS) {
      const b = h('button', {
        class: 'draw-tyre-pick',
        role: 'radio',
        'data-c': c,
        html: `${tyreBadge(c, 24)}<span>${COMPOUND_SPECS[c].label}</span>`,
        onclick: () => this.pickTyre(c),
      });
      this.tyreStrip.append(b);
    }
    this.bottomStrip = h(
      'div',
      { class: 'strip strip-bottom' },
      this.undoBtn,
      this.pct,
      h('button', { class: 'icon-btn', 'aria-label': 'Start the lap again', html: ICONS.restart, onclick: () => this.restart() }),
    );
    this.recenterLabel = h('span', null, 'Back to the start');
    this.recenterBtn = h('button', { class: 'recenter is-hidden', onclick: () => this.recenter() }, h('span', { class: 'recenter-dot', 'aria-hidden': 'true' }), this.recenterLabel) as HTMLButtonElement;
    this.el = h(
      'div',
      { class: 'draw-hud' },
      this.topStrip,
      this.compass.el,
      this.recenterBtn,
      h('div', { class: 'draw-progress', role: 'progressbar', 'aria-label': 'Lap drawn' }, this.bar),
      this.mini,
      this.hint,
      this.bottomStrip,
      this.tyreStrip,
    );
    app.root.append(this.el);
    this.resize();
    this.showHint(HINTS.start);
    this.updateSubtitle(this.cornerFactor());
    this.setCam(this.startFrame());
    this.syncTyres();
    this.updateHud();

    const c = app.canvas;
    this.listen(c, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(c, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(c, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(c, 'pointercancel', (e) => this.onUp(e as PointerEvent));
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([type, fn]);
  }

  private applySettings(s: Settings): void {
    const was = this.mode;
    this.mode = s.scrollMode;
    this.scrollSpeed = s.scrollSpeed;
    this.damping = s.cornerDamping;
    this.updateSubtitle(this.cornerFactor());
    if (s.autoRotate !== this.autoRotate) this.setAutoRotate(s.autoRotate, false);
    else if (was !== this.mode && !this.drawing) this.glideToTip();
  }

  /** Turn auto-rotation on or off. Turning it on re-frames with the road ahead pointing up. */
  private setAutoRotate(on: boolean, save: boolean): void {
    this.autoRotate = on;
    this.compass.setAuto(on);
    if (save) {
      saveSettings({ autoRotate: on });
      sfx.tap();
    }
    if (on && !this.drawing) {
      this.spin = null;
      this.glideToTip();
    }
  }

  // Compass -----------------------------------------------------------------

  /** Rotation pivot: the tip (or start line) when it is in view, otherwise the middle of the map. */
  private pivot(): { x: number; y: number } {
    const a = this.builder.lastPoint ?? this.startPoint();
    const p = this.cam.toScreen(a.x, a.y);
    const { top, bottom, left, right } = this.safe;
    if (p.x > left && p.x < right && p.y > top && p.y < bottom) return p;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  /** Set the camera angle while keeping `world` under the screen point `pivot`. */
  private rotateAbout(angle: number, pivot: { x: number; y: number }, world: { x: number; y: number }): void {
    const c = this.cam;
    c.angle = angle;
    const vx = (pivot.x - c.w * c.ax) / c.zoom;
    const vy = (pivot.y - c.h * c.ay) / c.zoom;
    const co = Math.cos(-angle);
    const si = Math.sin(-angle);
    c.cx = world.x - (vx * co - vy * si);
    c.cy = world.y - (vx * si + vy * co);
  }

  /** Using the compass means the player wants to choose the angle: auto-rotate goes off. */
  private takeManualControl(): void {
    if (!this.autoRotate) return;
    this.setAutoRotate(false, true);
    this.showHint(HINTS.autoOff);
  }

  private compassTap(): void {
    if (this.drawing) return;
    this.takeManualControl();
    this.glide = null;
    this.momentum = null;
    const target = angleForBearing(nextCardinal(bearingAtTop(this.cam.angle)));
    const pivot = this.pivot();
    this.spin = { from: this.cam.angle, to: target, t0: performance.now(), dur: 380, pivot, world: this.cam.toWorld(pivot.x, pivot.y) };
    sfx.tap();
  }

  private compassDragStart(): void {
    if (this.drawing) return;
    this.takeManualControl();
    this.glide = null;
    this.spin = null;
    this.momentum = null;
    const pivot = this.pivot();
    this.dragPivot = { pivot, world: this.cam.toWorld(pivot.x, pivot.y) };
  }

  private compassDrag(delta: number): void {
    if (this.drawing || !this.dragPivot) return;
    this.rotateAbout(this.cam.angle + delta, this.dragPivot.pivot, this.dragPivot.world);
  }

  /** The part of the screen not covered by HUD, where the tip can live. */
  private measureSafe(): void {
    const top = this.topStrip.getBoundingClientRect();
    const bottom = this.bottomStrip.getBoundingClientRect();
    this.safe = {
      top: (top.bottom || 70) + 22,
      bottom: (bottom.top || this.app.h - 80) - 62,
      left: 14,
      right: this.app.w - 14,
    };
    this.avoid = [this.mini, this.compass.el].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left - 14, y: r.top - 14, w: r.width + 28, h: r.height + 28 };
    });
  }

  /** Pixels between the tip and the edge of the drawing area, along the direction of travel. */
  private roomAhead(): number {
    const tip = this.builder.lastPoint;
    if (!tip) return Infinity;
    const ts = this.cam.toScreen(tip.x, tip.y);
    const f = frameAt(this.track, this.builder.progress);
    const d = this.cam.dirToScreen(f.tx, f.ty);
    const { top, bottom, left, right } = this.safe;
    let room = Infinity;
    if (d.x > 1e-3) room = Math.min(room, (right - ts.x) / d.x);
    if (d.x < -1e-3) room = Math.min(room, (left - ts.x) / d.x);
    if (d.y > 1e-3) room = Math.min(room, (bottom - ts.y) / d.y);
    if (d.y < -1e-3) room = Math.min(room, (top - ts.y) / d.y);
    for (const m of this.avoid) if (ts.x > m.x && ts.x < m.x + m.w && ts.y > m.y && ts.y < m.y + m.h) room = 0;
    return room;
  }

  private drawZoom(): number {
    // Aim for a legal track width of ~52 CSS px on a phone, a little less on big screens.
    const target = Math.min(this.app.w, this.app.h) > 700 ? 46 : 52;
    const z = target / (this.track.meta.width + 0.7);
    return Math.max(2.2, Math.min(5.6, z));
  }

  private startPoint(): { x: number; y: number } {
    return { x: this.track.x[0], y: this.track.y[0] };
  }

  /** Camera that frames the next section of track ahead of progress s. */
  private frameFor(s: number, tip: { x: number; y: number }): CamState {
    if (this.mode === 'pause') return this.frameLow(s, tip);
    const look = Math.min(220, (this.app.h * 0.6) / this.zoom);
    const a = frameAt(this.track, s + 4);
    const b = frameAt(this.track, s + look * 0.55);
    let hx = b.x - a.x;
    let hy = b.y - a.y;
    const len = Math.hypot(hx, hy);
    if (len < 1) {
      hx = a.tx;
      hy = a.ty;
    } else {
      hx = (hx / len) * 0.75 + a.tx * 0.25;
      hy = (hy / len) * 0.75 + a.ty * 0.25;
    }
    const mid = frameAt(this.track, s + look * 0.3);
    return {
      cx: tip.x * 0.55 + mid.x * 0.45,
      cy: tip.y * 0.55 + mid.y * 0.45,
      zoom: this.zoom,
      angle: this.autoRotate ? angleForHeading(hx, hy) : this.cam.angle,
      ax: 0.5,
      ay: 0.55,
    };
  }

  /**
   * Every lap opens the same way, whatever the rotation setting: the start
   * straight runs from the bottom of the screen to the top, with the line low
   * enough to show plenty of road ahead. With auto-rotate off this angle then
   * stays until the player turns the map with the compass.
   */
  private startFrame(): CamState {
    const a = frameAt(this.track, 0);
    const b = frameAt(this.track, 40);
    let hx = b.x - a.x;
    let hy = b.y - a.y;
    const len = Math.hypot(hx, hy);
    if (len < 1) {
      hx = a.tx;
      hy = a.ty;
    }
    const tipY = Math.max(this.safe.top + 160, Math.min(this.safe.bottom - 40, this.app.h * 0.74));
    return { cx: a.x, cy: a.y, zoom: this.zoom, angle: angleForHeading(hx, hy), ax: 0.5, ay: tipY / this.app.h };
  }

  /**
   * Pause mode framing: the tip sits low on the screen and the next stretch of
   * track points up, so each stroke gets as much road as the screen can show.
   */
  private frameLow(s: number, tip: { x: number; y: number }): CamState {
    const tipY = Math.max(this.safe.top + 160, Math.min(this.safe.bottom - 28, this.app.h * 0.8));
    const ay = tipY / this.app.h;
    const look = (tipY - this.safe.top) / this.zoom;
    const a = frameAt(this.track, s + 3);
    const b = frameAt(this.track, s + look * 0.75);
    let cx = b.x - tip.x;
    let cy = b.y - tip.y;
    const len = Math.hypot(cx, cy);
    if (len < 1) {
      cx = a.tx;
      cy = a.ty;
    } else {
      cx /= len;
      cy /= len;
    }
    // Aim at the chord to the next stretch, but never so far that the road
    // right at the tip heads sideways or back towards the bottom edge.
    let hx = cx * 0.8 + a.tx * 0.2;
    let hy = cy * 0.8 + a.ty * 0.2;
    for (const k of [0.5, 1, 2, 4, 1000]) {
      const l = Math.hypot(hx, hy) || 1;
      if ((hx / l) * a.tx + (hy / l) * a.ty >= 0.55) break;
      hx = cx + a.tx * k;
      hy = cy + a.ty * k;
    }
    if (this.autoRotate) return { cx: tip.x, cy: tip.y, zoom: this.zoom, angle: angleForHeading(hx, hy), ax: 0.5, ay };
    // Fixed angle: keep the player's rotation and place the tip on the side of
    // the screen opposite to where the road is heading.
    const angle = this.cam.angle;
    const hl = Math.hypot(hx, hy) || 1;
    const co = Math.cos(angle);
    const si = Math.sin(angle);
    const dx = ((hx / hl) * co - (hy / hl) * si);
    const dy = ((hx / hl) * si + (hy / hl) * co);
    const { top, bottom, left, right } = this.safe;
    const mx = (left + right) / 2;
    const my = (top + bottom) / 2;
    const halfW = (right - left) / 2 - 46;
    const halfH = (bottom - top) / 2 - 46;
    let t = Math.min(Math.abs(dx) > 1e-3 ? halfW / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-3 ? halfH / Math.abs(dy) : Infinity) * 0.92;
    // Slide the tip towards the middle until it clears the compass and minimap.
    const hit = (x: number, y: number) => this.avoid.some((m) => x > m.x - 24 && x < m.x + m.w + 24 && y > m.y - 24 && y < m.y + m.h + 24);
    for (let i = 0; i < 10 && hit(mx - dx * t, my - dy * t); i++) t *= 0.88;
    return { cx: tip.x, cy: tip.y, zoom: this.zoom, angle, ax: (mx - dx * t) / this.app.w, ay: (my - dy * t) / this.app.h };
  }

  private setCam(s: CamState): void {
    this.cam.cx = s.cx;
    this.cam.cy = s.cy;
    this.cam.zoom = s.zoom;
    this.cam.angle = s.angle;
    this.cam.ax = s.ax;
    this.cam.ay = s.ay;
  }

  private camState(): CamState {
    return { cx: this.cam.cx, cy: this.cam.cy, zoom: this.cam.zoom, angle: this.cam.angle, ax: this.cam.ax, ay: this.cam.ay };
  }

  private glideTo(to: CamState, dur = 460): void {
    this.shiftX = this.shiftY = 0;
    this.spin = null;
    this.glide = { from: this.camState(), to, t0: performance.now(), dur };
  }

  private glideToTip(): void {
    const tip = this.builder.lastPoint ?? this.startPoint();
    this.glideTo(this.frameFor(this.builder.progress, tip));
  }

  /** Debug and test hook: world metres to CSS pixels. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return this.cam.toScreen(x, y);
  }

  get status(): string {
    return this.builder.status;
  }

  /** Current corner damping multiplier at the tip (test hook). */
  get scrollFactor(): number {
    return this.cornerFactor();
  }

  /** Camera angle in radians (test hook). */
  get mapAngle(): number {
    return this.cam.angle;
  }

  /** True while the map is being dragged (test hook). */
  get isPanning(): boolean {
    return this.panning || this.momentum !== null;
  }

  /** True while a stroke is accepting finger movement. */
  get penDown(): boolean {
    return this.drawing;
  }

  /** Where the last refused segment left the track (test hook). */
  get offTrackAt(): { x: number; y: number } | null {
    return this.builder.offTrack;
  }

  get isGliding(): boolean {
    return this.glide !== null;
  }

  get tip(): { x: number; y: number } | null {
    return this.builder.lastPoint;
  }

  // Input ------------------------------------------------------------------

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    if (this.pointerId !== null || this.builder.status === 'done') return;
    unlockAudio();
    this.momentum = null;
    this.spin = null;
    this.dismissCoach();
    const p = this.local(e);
    const w = this.cam.toWorld(p.x, p.y);
    if (this.builder.status === 'idle') {
      if (this.builder.canStartAt(w.x, w.y)) {
        this.glide = null;
        this.builder.start(w.x, w.y);
        this.updateHud();
        sfx.penDown();
        buzz(8);
        this.pointerId = e.pointerId;
        this.drawing = true;
        this.strokes = 1;
        this.strokeFrom = 0;
        this.rebuildInk();
        this.app.canvas.setPointerCapture(e.pointerId);
        this.showHint(HINTS.drawing);
        return;
      }
      if (this.isGrass(w.x, w.y)) this.beginPan(e, p);
      else this.flashHint(HINTS.start);
      return;
    }
    if (this.builder.status !== 'drawing') return;
    const tip = this.builder.lastPoint!;
    const ts = this.cam.toScreen(tip.x, tip.y);
    if (Math.hypot(ts.x - p.x, ts.y - p.y) > TIP_GRAB_RADIUS) {
      if (this.isGrass(w.x, w.y)) {
        this.beginPan(e, p);
        return;
      }
      this.tipPulse = performance.now();
      this.flashHint(HINTS.grab);
      buzz([10, 40, 10]);
      return;
    }
    this.glide = null;
    this.awaitLift = false;
    this.closeLimits();
    this.builder.beginStroke();
    this.strokes++;
    this.strokeFrom = this.builder.progress;
    this.pointerId = e.pointerId;
    this.drawing = true;
    this.app.canvas.setPointerCapture(e.pointerId);
    sfx.penDown();
    // Magnetic pickup: the line carries on from the tip and eases onto the
    // finger over the first few dozen pixels instead of jumping to it.
    this.pickup = { ox: w.x - tip.x, oy: w.y - tip.y, sx: p.x, sy: p.y };
  }

  /** Grass, run-off, walls: anywhere clearly outside the white lines. */
  private isGrass(x: number, y: number): boolean {
    return projectGlobal(this.track, x, y).dist > this.track.limit + GRASS_MARGIN;
  }

  private beginPan(e: PointerEvent, p: { x: number; y: number }): void {
    this.glide = null;
    this.shiftX = this.shiftY = 0;
    this.panning = true;
    this.pointerId = e.pointerId;
    this.panLast = { x: p.x, y: p.y, t: performance.now() };
    this.panStart = { ...this.panLast };
    this.panDistance = 0;
    this.panVel = { x: 0, y: 0 };
    this.app.canvas.setPointerCapture(e.pointerId);
  }

  /** Move the camera so the world point under the finger stays under it. */
  private panBy(fromX: number, fromY: number, toX: number, toY: number): void {
    const a = this.cam.toWorld(fromX, fromY);
    const b = this.cam.toWorld(toX, toY);
    this.cam.cx += a.x - b.x;
    this.cam.cy += a.y - b.y;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    if (this.panning) {
      const p = this.local(e);
      const now = performance.now();
      const dt = Math.max(1, now - this.panLast.t) / 1000;
      this.panBy(this.panLast.x, this.panLast.y, p.x, p.y);
      this.panDistance += Math.hypot(p.x - this.panLast.x, p.y - this.panLast.y);
      const vx = (p.x - this.panLast.x) / dt;
      const vy = (p.y - this.panLast.y) / dt;
      this.panVel = { x: this.panVel.x * 0.6 + vx * 0.4, y: this.panVel.y * 0.6 + vy * 0.4 };
      this.panLast = { x: p.x, y: p.y, t: now };
      return;
    }
    if (!this.drawing) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    for (const ev of list) {
      if (!this.drawing) break;
      const p = this.local(ev);
      const w = this.cam.toWorld(p.x, p.y);
      if (this.pickup) {
        const k = Math.max(0, 1 - Math.hypot(p.x - this.pickup.sx, p.y - this.pickup.sy) / PICKUP_EASE);
        w.x -= this.pickup.ox * k;
        w.y -= this.pickup.oy * k;
        if (k === 0) this.pickup = null;
      }
      this.feed(w.x, w.y);
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pickup = null;
    if (this.panning) {
      this.panning = false;
      if (this.panDistance < 8 && performance.now() - this.panStart.t < 400) {
        // A tap on the grass: remind them it drags.
        this.flashHint(HINTS.panTap);
        return;
      }
      if (!getSettings().panCoachSeen) saveSettings({ panCoachSeen: true });
      // A flick keeps the map gliding briefly; a slow drag stops where it is.
      const idle = performance.now() - this.panLast.t;
      const v = this.panVel;
      const speed = Math.hypot(v.x, v.y);
      const cap = speed > 1800 ? 1800 / speed : 1;
      if (idle < 80 && speed > 250) this.momentum = { x: v.x * cap, y: v.y * cap };
      return;
    }
    if (this.awaitLift) {
      this.awaitLift = false;
      if (this.builder.status === 'drawing' && !this.limitsCard) this.showHint(HINTS.resume);
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;
    if (this.builder.status === 'drawing') {
      sfx.lift();
      this.glideToTip();
      if (this.strokes === 1 && !getSettings().tutorialDone) this.showHint(HINTS.lifted);
      else if (this.builder.progress > this.track.length * 0.82) this.showHint(HINTS.closing);
      else if (this.strokes % 4 === 3) this.showHint(HINTS.width);
      if (this.strokes === 1 || this.strokes === 3) this.maybeCoach();
    }
  }

  // Grass-drag coach mark --------------------------------------------------

  /**
   * Once ever, at a natural pause after a stroke, show a hand dragging across
   * a patch of grass. Any touch dismisses it; a real pan means they know.
   */
  private maybeCoach(): void {
    if (this.coach || this.coachTimer || getSettings().panCoachSeen) return;
    this.coachTimer = setTimeout(() => {
      this.coachTimer = null;
      if (this.drawing || this.panning || this.builder.status !== 'drawing' || getSettings().panCoachSeen) return;
      const spot = this.grassSpot();
      if (!spot) return;
      saveSettings({ panCoachSeen: true });
      this.coach = h(
        'div',
        { class: 'pan-coach', style: `left:${spot.x}px;top:${spot.y}px`, 'aria-hidden': 'true' },
        h('span', { class: 'pan-coach-trail' }),
        h('span', { class: 'pan-coach-finger' }),
        h('span', { class: 'pan-coach-label' }, 'Drag the grass to look around'),
      );
      this.el.append(this.coach);
      // Keep the label on screen when the grass patch is near an edge.
      const label = this.coach.querySelector<HTMLElement>('.pan-coach-label');
      if (label) {
        const r = label.getBoundingClientRect();
        const shift = r.left < 10 ? 10 - r.left : r.right > this.app.w - 10 ? this.app.w - 10 - r.right : 0;
        if (shift) label.style.transform = `translateX(calc(-50% + ${shift}px))`;
      }
      this.coachTimer = setTimeout(() => this.dismissCoach(), 4200);
    }, 650);
  }

  private dismissCoach(): void {
    if (this.coachTimer) {
      clearTimeout(this.coachTimer);
      this.coachTimer = null;
    }
    if (!this.coach) return;
    const c = this.coach;
    this.coach = null;
    c.classList.add('is-leaving');
    setTimeout(() => c.remove(), 300);
  }

  /** A point on screen that is clearly grass, away from the track and the tip. */
  private grassSpot(): { x: number; y: number } | null {
    const { top, bottom, left, right } = this.safe;
    const tip = this.builder.lastPoint;
    const ts = tip ? this.cam.toScreen(tip.x, tip.y) : null;
    let best: { x: number; y: number; score: number } | null = null;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        const x = left + 70 + ((right - left - 140) * gx) / 3;
        const y = top + 40 + ((bottom - top - 80) * gy) / 6;
        if (this.avoid.some((m) => x > m.x - 60 && x < m.x + m.w + 60 && y > m.y - 30 && y < m.y + m.h + 30)) continue;
        const w = this.cam.toWorld(x, y);
        const d = projectGlobal(this.track, w.x, w.y).dist - this.track.limit;
        if (d * this.cam.zoom < 70) continue;
        const fromTip = ts ? Math.hypot(ts.x - x, ts.y - y) : 400;
        const score = Math.min(d * this.cam.zoom, 160) + Math.min(fromTip, 300) * 0.5 - Math.abs(y - (top + bottom) / 2) * 0.2;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** Glide back to the tip (or the start line before the lap begins). */
  private recenter(): void {
    sfx.tap();
    this.momentum = null;
    if (this.builder.status === 'idle') this.glideTo(this.startFrame());
    else this.glideToTip();
  }

  /** Show the recenter button whenever the tip has been panned out of view. */
  private updateRecenter(): void {
    if (this.builder.status === 'done') return;
    const anchor = this.builder.lastPoint ?? this.startPoint();
    const s = this.cam.toScreen(anchor.x, anchor.y);
    const { top, bottom, left, right } = this.safe;
    const off = s.x < left || s.x > right || s.y < top - 20 || s.y > bottom + 40;
    const show = off && !this.glide;
    if (show !== this.recenterShown) {
      this.recenterShown = show;
      this.recenterBtn.classList.toggle('is-hidden', !show);
      if (show) setText(this.recenterLabel, this.builder.status === 'idle' ? 'Back to the start' : 'Back to the tip');
    }
  }

  /** Show a help tip, then fade it out after a moment. */
  private showHint(text: string): void {
    setText(this.hint, text);
    this.hint.classList.remove('is-hidden');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    const ms = Math.min(HINT_MAX_MS, HINT_BASE_MS + text.length * HINT_PER_CHAR_MS);
    this.hintTimer = setTimeout(() => this.hint.classList.add('is-hidden'), ms);
  }

  private feed(x: number, y: number): void {
    const before = this.builder.progress;
    const r = this.builder.extend(x, y);
    if (r !== 'backward' && r !== 'skip') this.backwardRun = 0;
    if (r === 'ok' || r === 'finish') {
      this.appendInk();
      const ds = this.builder.progress - before;
      if (r === 'ok' && ds > 0) {
        if (this.mode === 'continuous') this.conveyor(ds);
        else if (this.builder.progress - this.strokeFrom > MIN_STROKE && this.roomAhead() < ADVANCE_ROOM) this.advance();
      }
      if (r === 'finish') this.finish();
      this.updateHud();
    } else if (r === 'offtrack') {
      // The line has run up to the white line: show that last stretch.
      this.appendInk();
      this.leftTrack();
    } else if (r === 'backward') {
      this.backwardRun++;
      if (this.backwardRun > 8 && performance.now() - this.flashUntil > 1500) this.flashHint(HINTS.backward);
    }
  }

  /**
   * Pause mode: the map needs to move, so this stroke is over. The camera
   * glides on and further finger movement is ignored until the finger lifts.
   */
  private advance(): void {
    this.drawing = false;
    this.pickup = null;
    this.awaitLift = true;
    sfx.lift();
    buzz(15);
    this.glideToTip();
    this.tipPulse = performance.now() + 380;
    this.flashHint(HINTS.advance);
    this.maybeCoach();
  }

  /** Continuous mode: scroll multiplier from corner damping at the tip. */
  private cornerFactor(): number {
    if (this.damping === 'off') return 1;
    if (!this.damper) this.damper = new CornerDamper(this.track);
    return this.damper.factor(this.damping, this.builder.progress);
  }

  /** While experimenting with damping, show the live scroll rate under the title. */
  private updateSubtitle(factor: number): void {
    const live = this.mode === 'continuous' && this.damping !== 'off';
    const rate = live ? Math.round(this.scrollSpeed * factor * 100) / 100 : -1;
    if (rate === this.scrollShown) return;
    this.scrollShown = rate;
    setText(this.subtitle, live ? `Scroll ${rate.toFixed(2)}× near here` : 'Draw your lap');
  }

  /** Continuous mode: feed the map forward while the tip is running out of room ahead. */
  private conveyor(ds: number): void {
    const room = this.roomAhead();
    const f = frameAt(this.track, this.builder.progress);
    const r0 = Math.min(this.app.w, this.app.h) * 0.42;
    const factor = this.cornerFactor();
    this.updateSubtitle(factor);
    if (room >= r0) return;
    const gain = 1.6 * this.scrollSpeed * factor * (1 - Math.max(0, room) / r0);
    // Applied at the next frame, never mid-batch: every finger sample in a
    // batch was taken against the frame the player was looking at.
    this.shiftX += f.tx * ds * gain;
    this.shiftY += f.ty * ds * gain;
  }

  // Line state -------------------------------------------------------------

  private rebuildInk(): void {
    this.ink = new Path2D();
    this.inkFrom = 0;
    this.appendInk();
  }

  private appendInk(): void {
    const pts = this.builder.points;
    const n = pts.length / 2;
    for (let i = this.inkFrom; i < n; i++) {
      const x = pts[i * 2] / UNITS_PER_METRE;
      const y = pts[i * 2 + 1] / UNITS_PER_METRE;
      if (i === 0) this.ink.moveTo(x, y);
      else this.ink.lineTo(x, y);
    }
    this.inkFrom = n;
  }

  private undo(): void {
    if (this.drawing) return;
    const hadCard = !!this.limitsCard;
    this.closeLimits();
    if (!this.builder.canUndo) {
      // Nothing drawn yet beyond the start: just clear the off-track marker.
      this.builder.offTrack = null;
      if (hadCard) this.showHint(HINTS.resume);
      return;
    }
    sfx.tap();
    if (this.builder.undoStroke()) {
      this.rebuildInk();
      this.glideToTip();
      this.updateHud();
      this.showHint(HINTS.resume);
    }
  }

  private pickTyre(c: Compound): void {
    sfx.tap();
    this.compound = c;
    setTyre(this.track.meta.slug, c);
    this.syncTyres();
    this.showHint(tyreHint(this.track.meta));
  }

  private syncTyres(): void {
    this.tyreStrip.querySelectorAll<HTMLElement>('.draw-tyre-pick').forEach((b) => {
      const on = b.dataset.c === this.compound;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    this.tyreMark.innerHTML = tyreBadge(this.compound, 26);
    this.tyreMark.title = COMPOUND_SPECS[this.compound].label;
  }

  private restart(): void {
    if (this.drawing) return;
    sfx.tap();
    this.closeLimits();
    this.builder.reset();
    this.awaitLift = false;
    this.ink = new Path2D();
    this.inkFrom = 0;
    this.strokes = 0;
    this.glideTo(this.startFrame(), 600);
    this.showHint(HINTS.start);
    this.updateHud();
  }

  /**
   * The finger crossed the white line. The line already stops at the last
   * legal point; end the stroke and offer to undo it.
   */
  private leftTrack(): void {
    this.drawing = false;
    this.pickup = null;
    this.awaitLift = true;
    sfx.fail();
    buzz([30, 60, 90]);
    this.el.classList.remove('is-offtrack');
    void this.el.offsetWidth;
    this.el.classList.add('is-offtrack');
    if (!this.limitsCard) {
      const undoBtn = h('button', { class: 'btn-limits', onclick: () => this.undo(), html: `${ICONS.undo}<span>Undo stroke</span>` });
      const settingsBtn = h('button', {
        class: 'btn-limits-alt',
        onclick: () => openSettings(this.app, (st) => this.applySettings(st)),
        html: `${ICONS.gear}<span>Settings</span>`,
      });
      this.limitsCard = h(
        'div',
        { class: 'limits-card', role: 'alert' },
        h('div', { class: 'limits-text' }, h('strong', null, 'Track limits'), h('span', null, 'Your line ran into the white line. Scroll or rotation settings can make tricky corners easier.')),
        h('div', { class: 'limits-actions' }, undoBtn, settingsBtn),
      );
      this.el.append(this.limitsCard);
      this.el.classList.add('has-limits');
    }
    // Make sure the spot where the line went wide is not hidden under the card.
    const off = this.builder.offTrack;
    if (off) {
      const cardTop = this.limitsCard.getBoundingClientRect().top;
      const sp = this.cam.toScreen(off.x, off.y);
      if (sp.y > cardTop - 50) {
        const dy = sp.y - (cardTop - 130);
        const c = this.cam.toWorld(this.cam.w * this.cam.ax, this.cam.h * this.cam.ay + dy);
        this.glideTo({ ...this.camState(), cx: c.x, cy: c.y }, 320);
      }
    }
    this.showHint(HINTS.limits);
    this.updateHud();
  }

  private closeLimits(): void {
    this.limitsCard?.remove();
    this.limitsCard = null;
    this.el.classList.remove('has-limits');
  }

  private finish(): void {
    this.drawing = false;
    this.pointerId = null;
    this.finishedAt = performance.now();
    sfx.lapDrawn();
    buzz(20);
    saveSettings({ tutorialDone: true });
    this.stamp = h('div', { class: 'stamp' }, 'Lap drawn');
    this.el.append(this.stamp);
    const pts = this.builder.points.slice();
    setTimeout(() => this.actions.complete(pts, this.compound), 750);
  }

  private flashHint(text: string): void {
    this.flashUntil = performance.now();
    this.showHint(text);
    this.hint.classList.remove('is-flash');
    void this.hint.offsetWidth;
    this.hint.classList.add('is-flash');
  }

  private updateHud(): void {
    const f = Math.min(1, this.builder.progress / this.track.length);
    const pc = this.builder.status === 'done' ? 100 : Math.floor(f * 100);
    this.bar.style.transform = `scaleX(${f})`;
    setText(this.pct, `${pc}%`);
    this.undoBtn.disabled = !this.builder.canUndo;
    // The tyre choice belongs to the start; once ink is down the bar is for drawing.
    const idle = this.builder.status === 'idle';
    this.tyreStrip.hidden = !idle;
    this.bottomStrip.hidden = idle;
    this.tyreMark.hidden = idle;
  }

  // Minimap ----------------------------------------------------------------

  private buildMiniOutline(): Path2D {
    const t = this.track;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.x[i]); maxX = Math.max(maxX, t.x[i]);
      minY = Math.min(minY, t.y[i]); maxY = Math.max(maxY, t.y[i]);
    }
    const size = 92;
    this.miniScale = size / Math.max(maxX - minX, maxY - minY);
    this.miniOff = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
    const p = new Path2D();
    for (let i = 0; i <= t.n; i++) {
      const k = i % t.n;
      const x = (t.x[k] + this.miniOff.x) * this.miniScale;
      const y = (t.y[k] + this.miniOff.y) * this.miniScale;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    return p;
  }

  private drawMini(): void {
    const c = this.mini;
    const g = this.miniCtx;
    const dpr = this.app.dpr;
    const size = 108;
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    g.translate(size / 2, size / 2);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 4;
    g.stroke(this.miniOutline);
    g.strokeStyle = '#c8ced6';
    g.lineWidth = 2;
    g.stroke(this.miniOutline);
    g.save();
    g.scale(this.miniScale, this.miniScale);
    g.translate(this.miniOff.x, this.miniOff.y);
    g.strokeStyle = INK;
    g.lineWidth = 2.6 / this.miniScale;
    g.stroke(this.ink);
    // Current view.
    const corners = [this.cam.toWorld(0, 0), this.cam.toWorld(this.app.w, 0), this.cam.toWorld(this.app.w, this.app.h), this.cam.toWorld(0, this.app.h)];
    g.beginPath();
    corners.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = 'rgba(155,48,255,0.16)';
    g.fill();
    g.strokeStyle = 'rgba(155,48,255,0.7)';
    g.lineWidth = 1 / this.miniScale;
    g.stroke();
    const tip = this.builder.lastPoint ?? this.startPoint();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(tip.x, tip.y, 3.4 / this.miniScale, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(tip.x, tip.y, 2.2 / this.miniScale, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Frame ------------------------------------------------------------------

  resize(): void {
    this.cam.w = this.app.w;
    this.cam.h = this.app.h;
    this.measureSafe();
    const z = this.drawZoom();
    if (Math.abs(z - this.zoom) > 1e-6) {
      this.zoom = z;
      this.cam.zoom = z;
    }
  }

  frame(now: number, dt = 0.016): void {
    if (this.momentum) {
      const m = this.momentum;
      const cx = this.app.w / 2, cy = this.app.h / 2;
      this.panBy(cx, cy, cx + m.x * dt, cy + m.y * dt);
      const k = Math.exp(-dt * 4.5);
      m.x *= k;
      m.y *= k;
      if (Math.hypot(m.x, m.y) < 25) this.momentum = null;
    }
    if (this.spin) {
      const sp = this.spin;
      const t = Math.min(1, (now - sp.t0) / sp.dur);
      this.rotateAbout(lerpAngle(sp.from, sp.to, easeInOutCubic(t)), sp.pivot, sp.world);
      if (t >= 1) this.spin = null;
    }
    if (this.shiftX || this.shiftY) {
      this.cam.cx += this.shiftX;
      this.cam.cy += this.shiftY;
      this.shiftX = this.shiftY = 0;
    }
    if (this.glide) {
      const g = this.glide;
      const t = Math.min(1, (now - g.t0) / g.dur);
      const e = easeInOutCubic(t);
      this.cam.cx = g.from.cx + (g.to.cx - g.from.cx) * e;
      this.cam.cy = g.from.cy + (g.to.cy - g.from.cy) * e;
      this.cam.zoom = g.from.zoom + (g.to.zoom - g.from.zoom) * e;
      this.cam.angle = lerpAngle(g.from.angle, g.to.angle, e);
      this.cam.ax = g.from.ax + (g.to.ax - g.from.ax) * e;
      this.cam.ay = g.from.ay + (g.to.ay - g.from.ay) * e;
      if (t >= 1) this.glide = null;
    }
    const { ctx } = this.app;
    const dpr = this.app.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.apply(ctx, dpr);
    this.art.draw(ctx, this.cam);

    const status = this.builder.status;
    if (this.guidePath) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const z = this.cam.zoom;
      ctx.setLineDash([7 / z, 6 / z]);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 4.5 / z;
      ctx.stroke(this.guidePath);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2.2 / z;
      ctx.stroke(this.guidePath);
      ctx.restore();
    }
    if (status === 'idle') this.drawStartCue(ctx, now);
    if (status === 'drawing') this.drawEdgeWarning(ctx);
    if (status !== 'idle') {
      strokeInk(ctx, this.ink, this.cam.zoom, INK);
    }
    if (status === 'drawing' && this.builder.progress > this.track.length * 0.7) this.drawStartMarker(ctx, now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (status === 'drawing') this.drawTip(ctx, now);
    if (status === 'drawing' && this.builder.offTrack) this.drawOffTrack(ctx, now);
    if (status === 'done') this.drawDone(ctx, now);
    this.drawMini();
    this.updateRecenter();
    this.compass.setAngle(this.cam.angle);
  }

  private drawStartCue(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.track;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const quad = (s0: number, s1: number) => {
      const a = frameAt(t, s0), b = frameAt(t, s1);
      const w = t.limit;
      ctx.beginPath();
      ctx.moveTo(a.x + a.nx * w, a.y + a.ny * w);
      ctx.lineTo(b.x + b.nx * w, b.y + b.ny * w);
      ctx.lineTo(b.x - b.nx * w, b.y - b.ny * w);
      ctx.lineTo(a.x - a.nx * w, a.y - a.ny * w);
      ctx.closePath();
    };
    quad(-START_TOUCH_RANGE * 0.5, START_TOUCH_RANGE * 0.4);
    ctx.fillStyle = `rgba(155,48,255,${0.18 + pulse * 0.2})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(155,48,255,${0.6 + pulse * 0.4})`;
    ctx.lineWidth = 2.5 / this.cam.zoom;
    ctx.stroke();
    // Chevrons showing the direction of travel.
    for (let k = 0; k < 4; k++) {
      const s = 14 + k * 9 + ((now / 40) % 9);
      const f = frameAt(t, s);
      const alpha = 0.85 - k * 0.18;
      const w = t.half * 0.55;
      ctx.beginPath();
      ctx.moveTo(f.x - f.tx * 3 + f.nx * w, f.y - f.ty * 3 + f.ny * w);
      ctx.lineTo(f.x + f.tx * 2, f.y + f.ty * 2);
      ctx.lineTo(f.x - f.tx * 3 - f.nx * w, f.y - f.ty * 3 - f.ny * w);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    // A demo fingertip sliding off the line.
    const cycle = (now % 2200) / 2200;
    const s = -4 + cycle * 44;
    const f = frameAt(t, s);
    ctx.globalAlpha = Math.sin(cycle * Math.PI);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 11 / this.cam.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3 / this.cam.zoom;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Glow the edge in red as the line gets close to leaving the track. */
  private drawEdgeWarning(ctx: CanvasRenderingContext2D): void {
    const tip = this.builder.lastPoint;
    if (!tip) return;
    const t = this.track;
    const p = projectNear(t, tip.x, tip.y, this.builder.hint, 4);
    const margin = t.limit - p.dist;
    if (margin >= EDGE_WARN) {
      this.warned = false;
      return;
    }
    const k = 1 - Math.max(0, margin) / EDGE_WARN;
    if (k > 0.5 && !this.warned) {
      this.warned = true;
      buzz(12);
    }
    const side = p.d >= 0 ? 1 : -1;
    ctx.save();
    ctx.beginPath();
    for (let ds = -14; ds <= 14; ds += 2) {
      const f = frameAt(t, p.s + ds);
      const x = f.x + f.nx * side * t.limit;
      const y = f.y + f.ny * side * t.limit;
      if (ds === -14) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(225,6,0,${0.25 + 0.6 * k})`;
    ctx.lineWidth = Math.max(0.8, 7 / this.cam.zoom);
    ctx.stroke();
    ctx.restore();
  }

  private drawStartMarker(ctx: CanvasRenderingContext2D, now: number): void {
    const p = this.builder.firstPoint;
    if (!p) return;
    const r = (7 + 2 * Math.sin(now / 200)) / this.cam.zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 / this.cam.zoom;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }

  private drawTip(ctx: CanvasRenderingContext2D, now: number): void {
    const tip = this.builder.lastPoint!;
    const s = this.cam.toScreen(tip.x, tip.y);
    if (!this.drawing) {
      const since = now - this.tipPulse;
      const strong = since < 700;
      const ph = (now % 1400) / 1400;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12 + ph * (strong ? 34 : 20), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(155,48,255,${(1 - ph) * (strong ? 0.9 : 0.55)})`;
      ctx.lineWidth = strong ? 4 : 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.drawing ? 7 : 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  private drawOffTrack(ctx: CanvasRenderingContext2D, now: number): void {
    const f = this.builder.offTrack!;
    const s = this.cam.toScreen(f.x, f.y);
    const ph = (now % 900) / 900;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14 + ph * 22, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(225,6,0,${1 - ph})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#e10600';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y - 8);
    ctx.lineTo(s.x + 8, s.y + 8);
    ctx.moveTo(s.x + 8, s.y - 8);
    ctx.lineTo(s.x - 8, s.y + 8);
    ctx.stroke();
  }

  private drawDone(ctx: CanvasRenderingContext2D, now: number): void {
    const t = Math.min(1, (now - this.finishedAt) / 600);
    ctx.fillStyle = `rgba(155,48,255,${0.18 * (1 - t)})`;
    ctx.fillRect(0, 0, this.app.w, this.app.h);
  }

  destroy(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (this.coachTimer) clearTimeout(this.coachTimer);
    for (const [type, fn] of this.listeners) this.app.canvas.removeEventListener(type, fn);
    this.el.remove();
  }
}
