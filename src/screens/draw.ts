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
//
// That is freehand, the hard mode. The other two modes help the line come out
// right (src/app/draw-mode.ts):
//   tap and bend (easy, the default): a touch on the track ahead lays a curve
//     from the tip to the finger (src/app/curve.ts). It stays pending, with a
//     handle at its end to move and one at its middle to bend it, until the
//     player sets it (the button, or a touch further on, which starts the next
//     curve).
//   tidy strokes (medium): drawing is freehand, but the line slides along the
//     white line instead of stopping at it, and each stroke is corrected into
//     a racing line when the finger lifts (src/app/tidy.ts).

import type { App, Screen } from '../app/app';
import { REAL_CIRCUITS } from '../app/edition';
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
import type { DrawMode } from '../app/draw-mode';
import { TUTORIAL_COPY } from '../app/tutorial-copy';
import { difficultyPicker, openPauseMenu } from './pause';
import { blend, tidyStroke, type Tidied } from '../app/tidy';
import { endDir, headingAtEnd, midpoint, sampleCurve, startBend, type Curve, type Vec } from '../app/curve';

export interface DrawActions {
  complete(points: number[], compound: Compound): void;
  exit(): void;
  /** The player skipped the tutorial walkthrough. */
  skip?(): void;
}

/** The tutorial circuit: most of the lap is drawn for the player. */
export interface DrawTutorial {
  /** The line drawn for the player, absolute decimetre points [x, y, ...]. */
  prefix: number[];
  handoff: number;
  cornerIn: number;
  apex: number;
  cornerOut: number;
  /** First run: a guided walkthrough with coaching. */
  walkthrough: boolean;
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

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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
/** Tap and bend and tidy strokes keep the finger's point (and a curve's handles) this far inside the limit (metres). */
const CLAMP_MARGIN = 0.3;
/** Tidy strokes: how long a stroke takes to ease into its tidied shape. */
const MORPH_MS = 260;
/** Tap and bend: touch radius of a curve's handles (px), and the shortest curve (metres). */
const KNOB_GRAB = 34;
const MIN_CURVE = 3;
/** Tap and bend: when less road than this share of the screen shows past a curve's end, the map moves on. */
const CURVE_ROOM = 0.36;
const HINTS = {
  start: 'Put your finger on the chequered line and drag along the track.',
  drawing: 'Stay inside the white lines.',
  lifted: 'Lift whenever you like. Carry on from the purple tip.',
  corrected: 'Your stroke was corrected into a racing line. Carry on from the purple tip.',
  advance: 'The map moved on. Lift your finger, then carry on from the purple tip.',
  resume: 'Carry on from the purple tip.',
  limits: 'Undo the stroke, or carry on from the wall.',
  panTap: 'Drag on the grass to move the map.',
  autoOff: 'Auto-rotate is off, so the map stays at your angle. Tap Auto to bring it back.',
  width: 'Use the whole width: wide on entry, clip the apex, wide on exit.',
  closing: 'Cross the line where you started for a clean flying lap.',
  backward: 'The line only flows forward.',
  grab: 'Carry on from the end of your line.',
  curvesStart: 'Touch the chequered line, then tap the track ahead to lay your line.',
  curveFirst: 'Tap the track ahead of the purple tip to lay a curve.',
  curveBend: 'Drag the middle dot to bend it. Tap further on to carry on.',
  curveOff: 'That curve leaves the track. Drag the middle dot to bring it inside.',
  curveBack: 'Tap further along the track, ahead of the purple tip.',
  curveFinish: 'Tap Finish lap, or bend the last curve first.',
  curveInside: 'Back inside. Tap further on, or Set curve.',
  curveFixed: 'Bent to stay on the track. Drag the middle dot to change it.',
};

/** Coaching while the walkthrough player draws the final corner, in the words of their mode: [lap metres, tip]. */
function cornerTips(t: DrawTutorial, mode: DrawMode): [number, string][] {
  const tips = TUTORIAL_COPY[mode].tips;
  return [
    [t.handoff + 4, tips[0]],
    [t.cornerIn - 14, tips[1]],
    [t.apex - 12, tips[2]],
    [t.cornerOut - 24, tips[3]],
  ];
}

export class DrawScreen implements Screen {
  private builder: LineBuilder;
  private cam = new Camera();
  private glide: { from: CamState; to: CamState; t0: number; dur: number } | null = null;
  private ink = new Path2D();
  private inkFrom = 0;
  private inkStart = 0;
  /** Tutorial: the part of the lap drawn for the player, and lap progress where theirs begins. */
  private givenInk: Path2D | null = null;
  private given = 0;
  private tipsShown = 0;
  /** Walkthrough: drawing waits until the coach hands over. */
  private locked = false;
  private coachCard: HTMLElement | null = null;
  private coachSpot: HTMLElement | null = null;
  private waitTyre: (() => void) | null = null;
  private waitDraw: (() => void) | null = null;
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
  private drawMode: DrawMode;
  /** Tidy strokes: the stroke easing from as drawn to tidied, after a lift. */
  private morph: { tidied: Tidied; to: Vec[]; anchor: Vec; t0: number } | null = null;
  /** Tap and bend: the curve laid but not set yet, its points, and how far they get. */
  private pending: Curve | null = null;
  private pendingPts: Vec[] = [];
  private pendingPath: Path2D | null = null;
  private pendingProbe: ReturnType<LineBuilder['probe']> | null = null;
  /** Which of the pending curve's handles the finger is moving. */
  private knob: 'end' | 'bend' | null = null;
  /** Where the last set curve left off, so the next one starts exactly along it. */
  private curveExit: { count: number; dir: Vec } | null = null;
  private curvesLaid = 0;
  /** The tutorial's pause menu is open; the walkthrough waits on this before its next move. */
  private paused: Promise<void> | null = null;
  /** The open coach card's text, rewritten if the player changes mode while it shows. */
  private coachText: { el: HTMLElement; text: () => string } | null = null;
  /** Tidy strokes: how many times the correction has been pointed out. */
  private corrections = 0;
  private setBtn!: HTMLButtonElement;

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private compound: Compound,
    private actions: DrawActions,
    guide: Float64Array | null = null,
    private tutorial: DrawTutorial | null = null,
  ) {
    this.builder = new LineBuilder(track);
    if (guide) this.guidePath = polyPath(guide);
    if (tutorial) {
      if (!this.builder.preload(tutorial.prefix)) throw new Error('tutorial line is not a legal opening');
      this.given = this.builder.progress;
      this.givenInk = polyPath(Array.from(tutorial.prefix, (v) => v / UNITS_PER_METRE));
      this.rebuildInk();
    }
    const settings = getSettings();
    this.mode = settings.scrollMode;
    this.scrollSpeed = settings.scrollSpeed;
    this.autoRotate = settings.autoRotate;
    this.damping = settings.cornerDamping;
    this.drawMode = settings.drawMode;
    this.compass = new Compass({
      tap: () => this.compassTap(),
      dragStart: () => this.compassDragStart(),
      drag: (d) => this.compassDrag(d),
      toggleAuto: () => this.setAutoRotate(!this.autoRotate, true),
    });
    this.compass.setAuto(this.autoRotate);
    app.setCanvasVisible(true);
    this.zoom = this.drawZoom();

    // The walkthrough introduces itself; no start hint underneath it.
    this.hint = h('p', { class: `draw-hint${tutorial?.walkthrough ? ' is-hidden' : ''}`, role: 'status' }, tutorial ? '' : this.startHint);
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
      h('div', { class: 'draw-title' }, h('strong', null, track.meta.short), (this.subtitle = h('span', null, tutorial ? 'Draw the last corner' : 'Draw your lap'))),
      tutorial
        ? h('button', { class: 'icon-btn', 'aria-label': 'Pause', html: ICONS.pause, onclick: () => this.openPause() })
        : h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings(this.app, (s) => this.applySettings(s)) }),
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
    this.setBtn = h('button', { class: 'btn-ink draw-set', hidden: true, onclick: () => this.setFromButton() }, 'Set curve') as HTMLButtonElement;
    this.bottomStrip = h(
      'div',
      { class: 'strip strip-bottom' },
      this.undoBtn,
      this.pct,
      this.setBtn,
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
    this.updateSubtitle(this.cornerFactor());
    this.syncTyres();
    this.updateHud();
    if (tutorial?.walkthrough) {
      this.setCam(this.startFrame());
      void this.walkthrough();
    } else if (tutorial) {
      this.setCam(this.frameFor(this.builder.progress, this.builder.lastPoint!));
      this.showHint(this.tutorialHint);
    } else {
      this.setCam(this.startFrame());
      this.showHint(this.startHint);
    }

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
    if (s.drawMode !== this.drawMode) {
      this.drawMode = s.drawMode;
      this.dropPending();
      this.endMorph();
      // The card spoke about a freehand stroke; in another mode the player carries on from the tip.
      this.closeLimits();
      this.updateHud();
      if (this.coachText) this.coachText.el.textContent = this.coachText.text();
      // A coach card on screen already says what to do next.
      if (!this.coachCard) {
        if (this.builder.status === 'idle') this.showHint(this.startHint);
        else if (this.tutorial && this.fresh) this.showHint(this.tutorialHint);
        else if (s.drawMode === 'curves') this.showHint(HINTS.curveFirst);
      }
    }
    this.mode = s.scrollMode;
    this.scrollSpeed = s.scrollSpeed;
    this.damping = s.cornerDamping;
    this.updateSubtitle(this.cornerFactor());
    if (s.autoRotate !== this.autoRotate) this.setAutoRotate(s.autoRotate, false);
    else if (was !== this.mode && !this.drawing) this.glideToTip();
  }

  private get startHint(): string {
    return this.drawMode === 'curves' ? HINTS.curvesStart : HINTS.start;
  }

  private get tutorialHint(): string {
    return TUTORIAL_COPY[this.drawMode].start;
  }

  /** Switch how the line goes down (the tutorial's welcome card and pause menu). */
  private setDrawMode(mode: DrawMode): void {
    this.applySettings(saveSettings({ drawMode: mode }));
  }

  /** The tutorial's pause menu: difficulty, resume, every setting, or skip the walkthrough. */
  private openPause(): void {
    if (this.drawing || this.knob) return;
    let release: () => void = () => {};
    this.paused = new Promise<void>((r) => (release = r));
    openPauseMenu(this.app, {
      mode: this.drawMode,
      pick: (m) => this.setDrawMode(m),
      settings: () => openSettings(this.app, (st) => this.applySettings(st)),
      skip: this.tutorial?.walkthrough ? () => this.skipWalkthrough() : undefined,
      closed: () => {
        this.paused = null;
        release();
      },
    });
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

  /** Pixels between the tip (or another point at lap progress s) and the edge of the drawing area, along the direction of travel. */
  private roomAhead(at: Vec | null = this.builder.lastPoint, s = this.builder.progress): number {
    const tip = at;
    if (!tip) return Infinity;
    const ts = this.cam.toScreen(tip.x, tip.y);
    const f = frameAt(this.track, s);
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
    // Tap and bend never scrolls under the finger: it frames like pause mode.
    if (this.mode === 'pause' || this.drawMode === 'curves') return this.frameLow(s, tip);
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
  private frameLow(s: number, tip: { x: number; y: number }, low = 0.8): CamState {
    const tipY = Math.max(this.safe.top + 160, Math.min(this.safe.bottom - 28, this.app.h * low));
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

  /** Tap and bend: the waiting curve's handles on screen and how far it gets (test hook). */
  get curveState(): { end: Vec; bend: Vec; kind: string } | null {
    const c = this.pending;
    if (!c) return null;
    const m = midpoint(c);
    return { end: this.cam.toScreen(c.to.x, c.to.y), bend: this.cam.toScreen(m.x, m.y), kind: this.pendingProbe?.kind ?? 'skip' };
  }

  /** Tidy strokes: a stroke is still easing into its tidied shape (test hook). */
  get isTidying(): boolean {
    return this.morph !== null;
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
    if (this.locked) return;
    if (this.builder.status === 'idle') {
      if (this.builder.canStartAt(w.x, w.y)) {
        this.glide = null;
        this.builder.start(w.x, w.y);
        this.updateHud();
        sfx.penDown();
        buzz(8);
        this.pointerId = e.pointerId;
        this.strokes = 1;
        this.strokeFrom = 0;
        this.rebuildInk();
        this.app.canvas.setPointerCapture(e.pointerId);
        if (this.drawMode === 'curves') {
          // Drag on from the line to lay the first curve, or lift and tap ahead.
          this.knob = 'end';
          this.showHint(HINTS.curveFirst);
          return;
        }
        this.drawing = true;
        this.showHint(HINTS.drawing);
        return;
      }
      if (this.isGrass(w.x, w.y)) this.beginPan(e, p);
      else this.flashHint(this.startHint);
      return;
    }
    if (this.builder.status !== 'drawing') return;
    this.endMorph();
    if (this.drawMode === 'curves') {
      // A track-limits card left from a freehand stroke goes once the player carries on with curves.
      this.closeLimits();
      this.curveDown(e, p, w);
      return;
    }
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
    this.waitDraw?.();
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
    if (this.knob) {
      const p = this.local(e);
      this.moveKnob(this.cam.toWorld(p.x, p.y));
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
    if (this.knob) {
      this.knobUp();
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
      const told = this.tidy();
      sfx.lift();
      this.glideToTip();
      // A correction that was just pointed out keeps the hint line to itself.
      if (!told) {
        if (this.strokes === 1 && !getSettings().tutorialDone) this.showHint(HINTS.lifted);
        else if (this.builder.progress > this.track.length * 0.82) this.showHint(HINTS.closing);
        else if (this.strokes % 4 === 3) this.showHint(HINTS.width);
      }
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
    // Tap and bend: while a curve waits, its end is where the player works, and the map moves past the tip on purpose.
    const anchor = this.pending?.to ?? this.builder.lastPoint ?? this.startPoint();
    const s = this.cam.toScreen(anchor.x, anchor.y);
    const { top, bottom, left, right } = this.safe;
    const off = s.x < left || s.x > right || s.y < top - 20 || s.y > bottom + 40;
    const show = off && !this.glide && !this.locked;
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
    // Tidy strokes: past the white line the line runs along it instead of stopping.
    if (this.drawMode === 'smooth') ({ x, y } = this.clampInside(x, y));
    const before = this.builder.progress;
    const r = this.builder.extend(x, y);
    if (r !== 'backward' && r !== 'skip') this.backwardRun = 0;
    if (r === 'ok' || r === 'finish') {
      this.appendInk();
      this.cornerCoaching();
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
    this.tidy();
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
    // Tap and bend never scrolls under the finger, so it has no scroll rate to show.
    const live = this.mode === 'continuous' && this.damping !== 'off' && this.drawMode !== 'curves';
    const rate = live ? Math.round(this.scrollSpeed * factor * 100) / 100 : -1;
    if (rate === this.scrollShown) return;
    this.scrollShown = rate;
    setText(this.subtitle, live ? `Scroll ${rate.toFixed(2)}× near here` : this.tutorial ? 'Draw the last corner' : 'Draw your lap');
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

  // Tidy strokes and tap and bend ------------------------------------------

  /** A point on the asphalt: past the white line it comes back just inside. */
  private clampInside(x: number, y: number, hint = this.builder.hint, window = 12): Vec {
    const p = projectNear(this.track, x, y, hint, window);
    const lim = this.track.limit - CLAMP_MARGIN;
    if (p.dist <= lim) return { x, y };
    const f = frameAt(this.track, p.s);
    const side = p.d >= 0 ? lim : -lim;
    return { x: f.x + f.nx * side, y: f.y + f.ny * side };
  }

  /**
   * Tidy strokes: correct the stroke just drawn, and let the ink ease into its
   * new shape. True when it pointed the correction out with a hint.
   */
  private tidy(): boolean {
    if (this.drawMode !== 'smooth') return false;
    const b = this.builder;
    const anchor = b.strokeAnchor;
    if (b.count - anchor < 4) return false;
    const line = Float64Array.from(b.points, (v) => v / UNITS_PER_METRE);
    const start = frameAt(this.track, 0);
    // The stroke that finishes the lap ends where the lap began, so the loop closes without a jog.
    const close = b.status === 'done' ? this.closingPoint() : null;
    const t = tidyStroke(this.track, line, anchor, { x: start.tx, y: start.ty }, b.strokeHint, undefined, close?.to);
    if (!t) return false;
    // A fit the walk refuses (rare: it would run backwards) eases back towards the stroke as drawn.
    for (const k of [1, 0.6, 0.3]) {
      const pts = k === 1 ? t.tidy : blend(t, k);
      if (!b.replaceStroke(pts)) continue;
      this.morph = { tidied: t, to: pts, anchor: { x: line[anchor * 2], y: line[anchor * 2 + 1] }, t0: performance.now() };
      this.rebuildInk(anchor + 1);
      // Say what happened the first few times the correction visibly moves the line.
      let moved = 0;
      pts.forEach((p, i) => (moved = Math.max(moved, Math.hypot(p.x - t.raw[i].x, p.y - t.raw[i].y))));
      if (moved < 0.8 || this.corrections >= 2) return false;
      this.corrections++;
      this.showHint(HINTS.corrected);
      return true;
    }
    return false;
  }

  private endMorph(): void {
    if (!this.morph) return;
    this.morph = null;
    this.rebuildInk();
  }

  /** Tap and bend: where a touch lands, in lap metres ahead of the tip (negative behind), and the circuit's direction there. */
  private ahead(w: Vec): { by: number; dir: Vec } {
    const b = this.builder;
    const t = this.track;
    // From a little behind the tip to well past anything on screen.
    const p = projectNear(t, w.x, w.y, (b.hint + 60) % t.n, 90);
    let by = p.s - (b.progress % t.length);
    if (by < -t.length / 2) by += t.length;
    else if (by > t.length / 2) by -= t.length;
    const f = frameAt(t, p.s);
    return { by, dir: { x: f.tx, y: f.ty } };
  }

  /** A curve's handle kept on the asphalt, however far ahead of the tip it is. */
  private clampFar(w: Vec): Vec {
    return this.clampInside(w.x, w.y, (this.builder.hint + 60) % this.track.n, 90);
  }

  /** The way the next curve leaves the tip: along the last curve, or along whatever line is there. */
  private exitDir(): Vec {
    const b = this.builder;
    if (this.curveExit && this.curveExit.count === b.count) return this.curveExit.dir;
    const pts = b.points;
    const tail: number[] = [];
    for (let i = Math.max(0, pts.length - 80); i < pts.length; i++) tail.push(pts[i] / UNITS_PER_METRE);
    const d = tail.length >= 4 ? headingAtEnd(tail) : null;
    if (d) return d;
    const f = frameAt(this.track, b.progress);
    return { x: f.tx, y: f.ty };
  }

  private newCurve(w: Vec): Curve {
    const from = this.builder.lastPoint!;
    return { from, dir: this.inward(from, this.exitDir()), ...this.endFor(w), bend: null };
  }

  /**
   * Where a curve ends for a finger at `w`: on the asphalt under it, arriving
   * along the track. Past the finish it closes the loop instead: it ends just
   * beyond where the lap began, heading the way the lap set off, so the line
   * crosses the finish exactly where it started.
   */
  private endFor(w: Vec): { to: Vec; toDir: Vec } {
    const to = this.clampFar(w);
    if (this.builder.progress + this.ahead(to).by >= this.track.length - 0.5) {
      const close = this.closingPoint();
      if (close) return { to: close.to, toDir: close.dir };
    }
    return { to, toDir: this.ahead(to).dir };
  }

  /** A point just past where the lap began, and the direction the lap set off in. */
  private closingPoint(): { to: Vec; dir: Vec } | null {
    const pts = this.builder.points;
    if (pts.length < 4) return null;
    const x0 = pts[0] / UNITS_PER_METRE;
    const y0 = pts[1] / UNITS_PER_METRE;
    let dx = 0;
    let dy = 0;
    for (let i = 2; i < pts.length; i += 2) {
      dx = pts[i] / UNITS_PER_METRE - x0;
      dy = pts[i + 1] / UNITS_PER_METRE - y0;
      if (dx * dx + dy * dy >= 36) break;
    }
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return null;
    const dir = { x: dx / l, y: dy / l };
    return { to: { x: x0 + dir.x * 1.5, y: y0 + dir.y * 1.5 }, dir };
  }

  /** Would a curve leaving `from` along `dir` still be on the asphalt a few metres on? */
  private headsInside(from: Vec, dir: Vec): boolean {
    const t = this.track;
    const p = projectNear(t, from.x + dir.x * 3, from.y + dir.y * 3, (this.builder.hint + 60) % t.n, 90);
    return p.dist <= t.limit - 0.1;
  }

  /**
   * A tip right on the white line and pointing over it would send every curve
   * off the track at once, however it is bent. Turn such a heading in along
   * the edge: a slight kink beats a line that cannot go on.
   */
  private inward(from: Vec, dir: Vec): Vec {
    if (this.headsInside(from, dir)) return dir;
    const t = this.track;
    const p = projectNear(t, from.x, from.y, (this.builder.hint + 60) % t.n, 90);
    const f = frameAt(t, p.s);
    const ox = p.d >= 0 ? f.nx : -f.nx;
    const oy = p.d >= 0 ? f.ny : -f.ny;
    const out = dir.x * ox + dir.y * oy;
    // Already heading in: the edge itself bends away, and a curve can be bent to follow it.
    if (out <= 0) return dir;
    for (const k of [0.4, 0.8, 1.2, 1.6]) {
      const x = dir.x - ox * out * k;
      const y = dir.y - oy * out * k;
      const l = Math.hypot(x, y) || 1;
      const d = { x: x / l, y: y / l };
      if (this.headsInside(from, d)) return d;
    }
    return { x: f.tx, y: f.ty };
  }

  private curveDown(e: PointerEvent, p: Vec, w: Vec): void {
    const c = this.pending;
    if (c) {
      const m = midpoint(c);
      const ms = this.cam.toScreen(m.x, m.y);
      const es = this.cam.toScreen(c.to.x, c.to.y);
      const dm = Math.hypot(ms.x - p.x, ms.y - p.y);
      const de = Math.hypot(es.x - p.x, es.y - p.y);
      if (Math.min(dm, de) <= KNOB_GRAB) {
        this.grabKnob(e, dm < de ? 'bend' : 'end');
        return;
      }
    }
    if (this.isGrass(w.x, w.y)) {
      this.beginPan(e, p);
      return;
    }
    const a = this.ahead(w);
    if (a.by < MIN_CURVE) {
      this.tipPulse = performance.now();
      this.flashHint(HINTS.curveBack);
      buzz([10, 40, 10]);
      return;
    }
    if (c) {
      // Between the tip and the waiting curve's end: that end comes here.
      if (a.by <= this.ahead(c.to).by) {
        this.grabKnob(e, 'end');
        this.moveKnob(w);
        return;
      }
      // Further on: the waiting curve now knows where the line goes next, so
      // it settles into it, is set, and the next one starts from its end.
      this.settle(this.clampFar(w));
      if (!this.setCurve() || this.builder.status !== 'drawing') return;
    }
    this.waitDraw?.();
    this.pending = this.newCurve(w);
    this.updatePending();
    this.grabKnob(e, 'end');
    sfx.penDown();
  }

  private grabKnob(e: PointerEvent, knob: 'end' | 'bend'): void {
    this.knob = knob;
    this.pointerId = e.pointerId;
    this.glide = null;
    this.momentum = null;
    this.app.canvas.setPointerCapture(e.pointerId);
    if (knob === 'bend' && this.pending) this.pending = startBend(this.pending);
  }

  /** The end follows the finger along the track; the middle bends the curve through the finger. */
  private moveKnob(w: Vec): void {
    const c = this.pending;
    if (!c) {
      // Still on the start line: the first curve begins once the finger moves on.
      if (this.knob !== 'end' || this.builder.status !== 'drawing' || this.ahead(w).by < MIN_CURVE) return;
      this.waitDraw?.();
      this.pending = this.newCurve(w);
    } else if (this.knob === 'end') {
      if (this.ahead(w).by < MIN_CURVE) return;
      this.pending = { ...c, ...this.endFor(w) };
    } else if (c.bend) {
      this.pending = { ...c, bend: { ...c.bend, ...this.bendTowards(c, this.clampFar(w)) } };
    }
    this.updatePending();
  }

  /**
   * A curve just laid that would leave the track: bend it by the least that
   * keeps it on, moving its middle towards the centre of the track first.
   */
  private autoBend(): boolean {
    const c = this.pending;
    if (!c) return false;
    const base = startBend(c);
    const m = { x: base.bend!.x, y: base.bend!.y };
    const t = this.track;
    const p = projectNear(t, m.x, m.y, (this.builder.hint + 60) % t.n, 90);
    const f = frameAt(t, p.s);
    const ix = p.d >= 0 ? -f.nx : f.nx;
    const iy = p.d >= 0 ? -f.ny : f.ny;
    for (let shift = 0.5; shift <= t.limit * 2.5; shift += 0.5) {
      for (const side of [1, -1]) {
        const q = { x: m.x + ix * shift * side, y: m.y + iy * shift * side };
        const bent: Curve = { ...base, bend: { ...base.bend!, x: q.x, y: q.y } };
        const pts = sampleCurve(bent, 1);
        const pr = this.builder.probe(pts);
        if (pr.kind !== 'ok' && pr.kind !== 'finish') continue;
        this.pending = bent;
        this.updatePending();
        return true;
      }
    }
    return false;
  }

  /**
   * Where the bend handle goes when the finger moves it to `m`. A legal curve
   * stays legal: past the point where it would leave the track the handle
   * stops, so bending can push a curve right up to the white line but not over.
   */
  private bendTowards(c: Curve, m: Vec): Vec {
    const legal = (k: string) => k === 'ok' || k === 'finish';
    const at = (q: Vec) => this.builder.probe(sampleCurve({ ...c, bend: { ...c.bend!, x: q.x, y: q.y } }, 1)).kind;
    if (!c.bend || !legal(this.pendingProbe?.kind ?? 'skip') || legal(at(m))) return m;
    const from = { x: c.bend.x, y: c.bend.y };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (legal(at({ x: from.x + (m.x - from.x) * mid, y: from.y + (m.y - from.y) * mid }))) lo = mid;
      else hi = mid;
    }
    return { x: from.x + (m.x - from.x) * lo, y: from.y + (m.y - from.y) * lo };
  }

  private knobUp(): void {
    this.knob = null;
    const c = this.pending;
    if (!c) return;
    if (Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y) < MIN_CURVE) {
      this.dropPending();
      return;
    }
    this.curvesLaid++;
    const was = this.pendingProbe?.kind;
    const fixed = (was === 'offtrack' || was === 'backward') && !c.bend && this.autoBend();
    const kind = this.pendingProbe?.kind;
    if (fixed) this.showHint(HINTS.curveFixed);
    else if (kind === 'offtrack' || kind === 'backward') this.showHint(HINTS.curveOff);
    else if (kind === 'finish') this.showHint(HINTS.curveFinish);
    else if (this.curvesLaid <= 2) this.showHint(HINTS.curveBend);
    else if (this.hint.textContent === HINTS.curveOff) this.showHint(HINTS.curveInside);
    // Little road showing past the curve's end: move the map on so the next tap has somewhere to land.
    const endS = this.builder.progress + this.ahead(c.to).by;
    if (kind !== 'finish' && this.roomAhead(c.to, endS) < this.app.h * CURVE_ROOM) this.glideTo(this.frameLow(endS, c.to, 0.56));
  }

  /**
   * Point the waiting curve's end between where it came from and where the
   * line goes next (the chord bisector, as a Catmull-Rom spline would), unless
   * the player has bent it. Kept only if the settled curve stays legal.
   */
  private settle(next: Vec): void {
    const c = this.pending;
    // A bent curve keeps its shape; one that closes the loop already arrives the way the lap set off.
    if (!c || c.bend || this.pendingProbe?.kind === 'finish') return;
    const ax = c.to.x - c.from.x;
    const ay = c.to.y - c.from.y;
    const bx = next.x - c.to.x;
    const by = next.y - c.to.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) return;
    const dx = ax / la + bx / lb;
    const dy = ay / la + by / lb;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const settled: Curve = { ...c, toDir: { x: dx / l, y: dy / l } };
    // An end on the white line that would point the next curve over it stays as it was.
    if (!this.headsInside(c.to, settled.toDir)) return;
    const pts = sampleCurve(settled, 1);
    const pr = this.builder.probe(pts);
    if (pr.kind !== 'ok' && pr.kind !== 'finish') return;
    this.pending = settled;
    this.pendingPts = pts;
    this.pendingProbe = pr;
  }

  private updatePending(): void {
    const c = this.pending!;
    this.pendingPts = sampleCurve(c, 1);
    this.pendingProbe = this.builder.probe(this.pendingPts);
    const path = new Path2D();
    path.moveTo(c.from.x, c.from.y);
    for (const q of this.pendingPts) path.lineTo(q.x, q.y);
    this.pendingPath = path;
    this.updateHud();
  }

  private dropPending(): void {
    if (!this.pending) return;
    this.pending = null;
    this.pendingPts = [];
    this.pendingPath = null;
    this.pendingProbe = null;
    this.knob = null;
    this.updateHud();
  }

  /** Lay the waiting curve into the line for good. False, with the reason shown, when it cannot go. */
  private setCurve(): boolean {
    const c = this.pending;
    const pr = this.pendingProbe;
    if (!c || !pr) return false;
    if (pr.kind === 'offtrack' || pr.kind === 'backward' || pr.kind === 'skip') {
      this.flashHint(pr.kind === 'offtrack' ? HINTS.curveOff : HINTS.curveBack);
      buzz([30, 60, 90]);
      return false;
    }
    const r = this.builder.addStroke(this.pendingPts);
    if (r === 'offtrack' || r === 'backward') {
      this.flashHint(HINTS.curveOff);
      return false;
    }
    this.curveExit = { count: this.builder.count, dir: endDir(c) };
    this.dropPending();
    this.strokes++;
    this.appendInk();
    this.cornerCoaching();
    sfx.lift();
    buzz(8);
    this.updateHud();
    if (r === 'finish') this.finish();
    return true;
  }

  private setFromButton(): void {
    if (!this.setCurve() || this.builder.status !== 'drawing') return;
    this.glideToTip();
    if (this.builder.progress > this.track.length * 0.82) this.showHint(HINTS.closing);
  }

  // Line state -------------------------------------------------------------

  /** Ink for the line, up to point `until` (all of it by default). */
  private rebuildInk(until?: number): void {
    this.ink = new Path2D();
    // The player's ink starts where the line drawn for them ends.
    this.inkFrom = this.inkStart = Math.max(0, this.builder.preloaded - 1);
    this.appendInk(until);
  }

  private appendInk(until = Infinity): void {
    const pts = this.builder.points;
    const n = Math.min(pts.length / 2, until);
    for (let i = this.inkFrom; i < n; i++) {
      const x = pts[i * 2] / UNITS_PER_METRE;
      const y = pts[i * 2 + 1] / UNITS_PER_METRE;
      if (i === this.inkStart) this.ink.moveTo(x, y);
      else this.ink.lineTo(x, y);
    }
    this.inkFrom = n;
  }

  private undo(): void {
    if (this.drawing || this.knob) return;
    if (this.pending) {
      // Tap and bend: the curve not set yet goes first, and the map comes back to the tip.
      sfx.tap();
      this.dropPending();
      this.glideToTip();
      this.showHint(HINTS.curveFirst);
      return;
    }
    this.endMorph();
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
      this.showHint(this.drawMode === 'curves' ? HINTS.curveFirst : HINTS.resume);
    }
  }

  private pickTyre(c: Compound): void {
    this.waitTyre?.();
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
    if (this.drawing || this.knob) return;
    sfx.tap();
    this.dropPending();
    this.endMorph();
    this.closeLimits();
    this.awaitLift = false;
    this.strokes = 0;
    if (this.tutorial) {
      // Back to the end of the line drawn for the player.
      this.builder.preload(this.tutorial.prefix);
      this.rebuildInk();
      this.tipsShown = 0;
      this.glideToTip();
      this.showHint(this.tutorialHint);
      this.updateHud();
      return;
    }
    this.builder.reset();
    this.ink = new Path2D();
    this.inkFrom = 0;
    this.glideTo(this.startFrame(), 600);
    this.showHint(this.startHint);
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
        h('div', { class: 'limits-text' }, h('strong', null, 'Track limits'), h('span', null, 'Your line ran into the white line. An easy way to draw in Settings keeps it inside, and scroll or rotation settings can help too.')),
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
    this.tidy();
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

  // Walkthrough --------------------------------------------------------------

  /**
   * The guided first run on the tutorial circuit: welcome, a flight along the
   * line drawn for the player, the tyre choice, then their turn at the tip.
   */
  private async walkthrough(): Promise<void> {
    this.locked = true;
    const welcome = await this.coachStep({
      title: 'Welcome to PoleLine',
      body: `You draw the racing line, and a ${REAL_CIRCUITS ? '2026 F1 car' : 'modern single-seater'} drives it flat out. We have drawn this lap for you as far as the last corner. You finish it.`,
      primary: 'Show me',
      // Easy to start with; the player can make it harder here, or later from the pause button.
      extra: h(
        'div',
        { class: 'coach-diff' },
        h('span', { class: 'coach-diff-head' }, 'How do you want to draw?'),
        difficultyPicker(this.drawMode, (m) => this.setDrawMode(m)),
        h('small', null, 'Change it any time from the pause button.'),
      ),
    });
    if (welcome === 'skip') return this.skipWalkthrough();
    await this.tour();
    if (this.closed) return;
    await this.paused;
    const tyres = this.coachStep({
      step: 'Step 1 of 2',
      title: 'Pick your tyres',
      body: `It is ${this.track.meta.trackTemp}°C on track. Softs grip most but overheat, hards never get warm. Mediums are made for days like this.`,
      target: () => this.tyreStrip.getBoundingClientRect(),
    });
    const picked = new Promise<'next'>((r) => (this.waitTyre = () => {
      this.waitTyre = null;
      r('next');
    }));
    if ((await Promise.race([tyres, picked])) === 'skip') return this.skipWalkthrough();
    this.closeCoach();
    await this.paused;
    this.locked = false;
    this.glideToTip();
    await wait(520);
    if (this.closed) return;
    const turn = this.coachStep({
      step: 'Step 2 of 2',
      title: 'Your turn',
      body: () => TUTORIAL_COPY[this.drawMode].turn,
      target: () => {
        const tip = this.builder.lastPoint;
        if (!tip) return null;
        const t = this.cam.toScreen(tip.x, tip.y);
        return new DOMRect(t.x - 30, t.y - 30, 60, 60);
      },
      round: true,
    });
    const started = new Promise<'next'>((r) => (this.waitDraw = () => {
      this.waitDraw = null;
      r('next');
    }));
    if ((await Promise.race([turn, started])) === 'skip') return this.skipWalkthrough();
    this.closeCoach();
    this.showHint(TUTORIAL_COPY[this.drawMode].going);
  }

  private closed = false;

  private skipWalkthrough(): void {
    this.closeCoach();
    this.actions.skip?.();
  }

  /** Fly the camera along the line drawn for the player, start line to handover. */
  private async tour(): Promise<void> {
    this.showHint('The purple line is drawn for you, from the start to the last corner.');
    const z = this.zoom * 0.5;
    for (const f of [0.18, 0.4, 0.62, 0.82, 1]) {
      await this.paused;
      if (this.closed) return;
      const s = this.given * f;
      const a = frameAt(this.track, s);
      const b = frameAt(this.track, s + 80);
      this.glideTo({ cx: a.x, cy: a.y, zoom: z, angle: angleForHeading(b.x - a.x, b.y - a.y), ax: 0.5, ay: 0.58 }, 820);
      await wait(820);
    }
  }

  private coachStep(o: { step?: string; title: string; body: string | (() => string); extra?: HTMLElement; primary?: string; target?: () => DOMRect | null; round?: boolean }): Promise<'next' | 'skip'> {
    this.closeCoach();
    return new Promise((resolve) => {
      const done = (r: 'next' | 'skip') => {
        this.closeCoach();
        resolve(r);
      };
      const text = typeof o.body === 'function' ? o.body : () => o.body as string;
      const body = h('p', null, text());
      this.coachText = { el: body, text };
      const card = h(
        'div',
        { class: 'coach', role: 'dialog', 'aria-label': o.title },
        o.step ? h('span', { class: 'coach-step' }, o.step) : null,
        h('strong', null, o.title),
        body,
        o.extra ?? null,
        h(
          'div',
          { class: 'coach-actions' },
          o.primary ? h('button', { class: 'btn-ink', onclick: () => done('next') }, o.primary) : null,
          h('button', { class: 'coach-skip', onclick: () => done('skip') }, 'Skip tutorial'),
        ),
      );
      const r = o.target?.() ?? null;
      if (r) {
        // A ring around the thing to touch; everything else dims, and touches still pass through.
        const pad = o.round ? 0 : 6;
        this.coachSpot = h('div', {
          class: `coach-spot${o.round ? ' is-round' : ''}`,
          style: `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`,
        });
        this.el.append(this.coachSpot);
        const below = r.top < this.app.h / 2;
        card.classList.add(below ? 'is-below' : 'is-above');
        card.style.setProperty(below ? 'top' : 'bottom', `${below ? r.bottom + 18 : this.app.h - r.top + 18}px`);
      } else {
        card.classList.add('is-center');
        this.coachSpot = h('div', { class: 'coach-dim' });
        this.el.append(this.coachSpot);
      }
      this.coachCard = card;
      this.el.append(card);
    });
  }

  private closeCoach(): void {
    this.coachCard?.remove();
    this.coachSpot?.remove();
    this.coachCard = this.coachSpot = null;
    this.coachText = null;
  }

  /** Walkthrough: one tip per stage of the final corner, as the line gets there. */
  private cornerCoaching(): void {
    if (!this.tutorial?.walkthrough) return;
    const tips = cornerTips(this.tutorial, this.drawMode);
    const s = this.builder.progress;
    while (this.tipsShown < tips.length && s >= tips[this.tipsShown][0]) {
      if (this.tipsShown === tips.length - 1 || s < tips[this.tipsShown + 1][0]) this.showHint(tips[this.tipsShown][1]);
      this.tipsShown++;
    }
  }

  /** Before the first stroke (or, on the tutorial, before the player adds to the drawn line). */
  private get fresh(): boolean {
    if (this.pending) return false;
    return this.builder.status === 'idle' || (this.builder.preloaded > 0 && this.builder.status === 'drawing' && this.builder.count === this.builder.preloaded);
  }

  private updateHud(): void {
    // The tutorial counts only the player's part of the lap.
    const span = this.track.length - this.given;
    const f = Math.min(1, Math.max(0, (this.builder.progress - this.given) / span));
    const pc = this.builder.status === 'done' ? 100 : Math.floor(f * 100);
    this.bar.style.transform = `scaleX(${f})`;
    setText(this.pct, `${pc}%`);
    this.undoBtn.disabled = !this.builder.canUndo && !this.pending;
    // Tap and bend: while a curve waits, its set button stands in for the percentage.
    const kind = this.pendingProbe?.kind;
    this.setBtn.hidden = !this.pending;
    this.pct.hidden = !!this.pending;
    setText(this.setBtn, kind === 'finish' ? 'Finish lap' : 'Set curve');
    this.setBtn.disabled = kind === 'offtrack' || kind === 'backward';
    // The tyre choice belongs to the start; once ink is down the bar is for drawing.
    const idle = this.fresh;
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
    if (status === 'drawing' && this.drawMode !== 'curves') this.drawEdgeWarning(ctx);
    if (this.givenInk) strokeInk(ctx, this.givenInk, this.cam.zoom, INK, 0.45);
    if (status !== 'idle') {
      strokeInk(ctx, this.ink, this.cam.zoom, INK);
    }
    if (this.morph) this.drawMorph(ctx, now);
    if (this.pendingPath) this.drawPending(ctx);
    if (status === 'drawing' && this.builder.progress > this.track.length * 0.7) this.drawStartMarker(ctx, now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (status === 'drawing') this.drawTip(ctx, now);
    if (status === 'drawing' && this.builder.offTrack) this.drawOffTrack(ctx, now, this.builder.offTrack);
    if (this.pending) this.drawKnobs(ctx, now);
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
    const strong = now - this.tipPulse < 700;
    // Tap and bend never draws from the tip, so it only pulses when it has something to say.
    if (!this.drawing && (this.drawMode !== 'curves' || strong)) {
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

  private drawOffTrack(ctx: CanvasRenderingContext2D, now: number, f: Vec): void {
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

  /** Tidy strokes: the stroke part way from as drawn to tidied. */
  private drawMorph(ctx: CanvasRenderingContext2D, now: number): void {
    const m = this.morph!;
    const t = Math.min(1, (now - m.t0) / MORPH_MS);
    const e = 1 - (1 - t) * (1 - t) * (1 - t);
    const path = new Path2D();
    path.moveTo(m.anchor.x, m.anchor.y);
    const raw = m.tidied.raw;
    for (let i = 0; i < raw.length; i++) path.lineTo(raw[i].x + (m.to[i].x - raw[i].x) * e, raw[i].y + (m.to[i].y - raw[i].y) * e);
    strokeInk(ctx, path, this.cam.zoom, INK);
    if (t >= 1) this.endMorph();
  }

  /** Tap and bend: the waiting curve, in ink with a dashed core until it is set (red while it cannot be). */
  private drawPending(ctx: CanvasRenderingContext2D): void {
    const k = this.pendingProbe?.kind;
    const color = k === 'offtrack' || k === 'backward' ? '#e10600' : INK;
    const z = this.cam.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(2.4, 11 / z);
    ctx.stroke(this.pendingPath!);
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(0.9, 4.2 / z);
    ctx.stroke(this.pendingPath!);
    ctx.globalAlpha = 1;
    ctx.setLineDash([6 / z, 5 / z]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(0.4, 1.8 / z);
    ctx.stroke(this.pendingPath!);
    ctx.restore();
  }

  /** Tap and bend: the waiting curve's handles. The end is a solid dot, the middle a ring to drag. */
  private drawKnobs(ctx: CanvasRenderingContext2D, now: number): void {
    const c = this.pending!;
    const k = this.pendingProbe?.kind;
    const bad = k === 'offtrack' || k === 'backward';
    const color = bad ? '#e10600' : INK;
    if (bad && k === 'offtrack' && this.pendingProbe?.x !== undefined) this.drawOffTrack(ctx, now, { x: this.pendingProbe.x, y: this.pendingProbe.y! });
    const m = midpoint(c);
    const ms = this.cam.toScreen(m.x, m.y);
    // Until a few curves have been laid, the middle handle pulses to show it can be moved.
    if (!this.knob && this.curvesLaid < 3 && !c.bend) {
      const ph = (now % 1300) / 1300;
      ctx.beginPath();
      ctx.arc(ms.x, ms.y, 12 + ph * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(155,48,255,${(1 - ph) * 0.6})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(ms.x, ms.y, this.knob === 'bend' ? 13 : 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ms.x, ms.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const es = this.cam.toScreen(c.to.x, c.to.y);
    ctx.beginPath();
    ctx.arc(es.x, es.y, this.knob === 'end' ? 12 : 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  private drawDone(ctx: CanvasRenderingContext2D, now: number): void {
    const t = Math.min(1, (now - this.finishedAt) / 600);
    ctx.fillStyle = `rgba(155,48,255,${0.18 * (1 - t)})`;
    ctx.fillRect(0, 0, this.app.w, this.app.h);
  }

  destroy(): void {
    this.closed = true;
    this.closeCoach();
    if (this.hintTimer) clearTimeout(this.hintTimer);
    if (this.coachTimer) clearTimeout(this.coachTimer);
    for (const [type, fn] of this.listeners) this.app.canvas.removeEventListener(type, fn);
    this.el.remove();
  }
}
