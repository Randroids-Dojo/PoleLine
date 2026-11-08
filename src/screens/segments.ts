// Segment by segment: the lap is laid one segment at a time. Each segment
// runs to a brake board, a turn-in, an apex, an exit or on down a straight
// (src/app/segments.ts). For each one the player taps Left or Right to pick
// the third of the road (a gate) the line passes at its end, then Gas or
// Brake, which sets it and moves on. The line takes the smoothest way through
// the gates; the pedals become the brake zones the lap sim drives to. Once
// the lap is laid the whole circuit shows with the brake zones in red, any
// segment can be tapped and changed, and Race runs it.

import type { App, Screen } from '../app/app';
import { buzz, sfx, unlockAudio } from '../app/audio';
import { getSettings, saveSettings, setTyre } from '../app/store';
import {
  courseFor,
  decodePicks,
  laneOffset,
  encodePicks,
  gate,
  laneOptions,
  laneSide,
  planPoints,
  segmentText,
  settleLanes,
  turnOfSegment,
  solveOffsets,
  startLane,
  type Course,
  type Lane,
  type Pedal,
  type Pick,
} from '../app/segments';
import { Camera, angleForHeading, easeInOutCubic, lerpAngle } from '../render/camera';
import { INK, strokeInk } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { LineBuilder } from '../sim/builder';
import { COMPOUND_SPECS } from '../sim/car';
import { frameAt, projectGlobal, type Track } from '../sim/track';
import { COMPOUNDS, type Compound } from '../sim/types';
import { ICONS, h, setText, tyreBadge } from '../ui/dom';
import { openSettings } from './settings';
import { difficultyPicker, openPauseMenu } from './pause';
import { REAL_CIRCUITS } from '../app/edition';
import { TUTORIAL_COPY } from '../app/tutorial-copy';
import type { DrawMode } from '../app/draw-mode';
import { simulateLap } from '../sim/lapsim';
import { UNITS_PER_METRE } from '../sim/path';
import { polyPath } from '../render/line-art';
import { drawSectorMarks, drawTurnLabels, turnsOf, type Box } from '../render/map-labels';
import { placeLabels } from '../render/label-place';
import { analysed, startCoach, type Coach } from '../app/coach-client';
import { bestTips, tipAction, tipSeconds, type CoachReport, type Tip } from '../app/coach';

export interface SegmentActions {
  /** Race the lap: its line (decimetres, flat [x, y, ...]), the tyre and the picks. */
  complete(points: number[], compound: Compound, picks: Pick[]): void;
  exit(): void;
  /** The player left the tutorial walkthrough. */
  skip?(): void;
  /** The tutorial: carry on in a drawing mode instead (picked on the welcome card or the pause menu). */
  switchMode?(mode: DrawMode): void;
}

/**
 * The tutorial circuit: the lap is laid for the player as far as the last
 * corner (the same line the drawn tutorial gives, so a lap starts with it as
 * the leaderboard requires), and they lay the last corner's segments.
 */
export interface SegmentTutorial {
  /** The line laid for the player, absolute decimetre points [x, y, ...]. */
  prefix: number[];
  /** One fast way round the whole lap (metres, flat), whose pedals the laid segments take. */
  ideal: Float64Array;
  /** A dotted guide through the last corner (metres, flat). */
  guide: Float64Array | null;
  /** First run: welcome, a flight along the laid line, then the player's turn, with coaching. */
  walkthrough: boolean;
  /** Carry on straight to the player's turn (they switched here from a drawing mode). */
  skipIntro?: boolean;
}

interface CamState {
  cx: number;
  cy: number;
  zoom: number;
  angle: number;
}

/** Lessons, one at a time, each shown until the player has done it. */
const LESSONS = {
  gas: 'Tap Gas to drive this segment.',
  brake: 'Tap Brake where you want to slow down.',
  lane: 'Left and Right pick your gate.',
  review: 'Tap any segment to change it.',
} as const;
type Lesson = keyof typeof LESSONS;

const HINT_MS = 4200;
/** The tutorial: a segment ending this close (metres) past where the laid line stops is laid too. */
const GIVEN_SLACK = 8;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The whole lap labels the time to find in this many segments. */
const TIP_LABELS = 3;
/** The All gas, no brakes offer comes after this many Gas picks in a row. */
const ALL_GAS_AFTER = 5;
const FLAME = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2.5c.6 3-1.7 4.6-3 6.4-1.6 2.1-2.4 3.6-2.4 5.6A5.4 5.4 0 0012 20a5.4 5.4 0 005.4-5.5c0-2.2-1-3.9-2.2-5.2.1 1.5-.4 2.6-1.3 3.2.3-3.6-.6-7.4-1.9-10z" fill="#ff8a00"/><path d="M12 11.5c.3 1.6-.9 2.4-1.5 3.3-.6.8-.9 1.5-.9 2.3A2.4 2.4 0 0012 19.5a2.4 2.4 0 002.4-2.4c0-1.3-.8-2.4-1.5-3.1.1.6-.1 1.1-.5 1.4 0-1.5-.1-2.7-.4-3.9z" fill="#ffc163"/></svg>';
/** After a change to an analysed lap, analyse it again once the player has paused this long (ms). */
const RECOACH_MS = 900;
/** A tip as shown: stale while the plan as it stands now is still being analysed. */
type ShownTip = Tip & { stale: boolean };
/** The whole track numbers the first segment and every this many after it. */
const SEGMENT_NUMBER_EVERY = 5;
/** A tap that moves less than this (px) picks a segment on the map. */
const TAP_SLOP = 10;
const BRAKE_RED = 'rgba(225, 6, 0, 0.62)';
/** The camera frames at most this much (metres) of a segment, ending at its gate. */
const MAX_FRAME = 170;

/** One chevron, turned four ways, for the four arms of the pad. */
const chevron = (turn: number) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="transform:rotate(${turn}deg)"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW = { up: chevron(0), right: chevron(90), down: chevron(180), left: chevron(270) };

/** Where each gate sits across the miniature road in the pad (viewBox units). */
const ROAD_LANE_X: Record<Lane, number> = { [-1]: 31, 0: 60, 1: 89 } as Record<Lane, number>;
const ROAD_SVG = `<svg class="sec-road-art" viewBox="0 0 120 88" aria-hidden="true">
  <defs><pattern id="sec-kerb" width="8" height="12" patternUnits="userSpaceOnUse"><rect width="8" height="6" fill="#e10600"/><rect y="6" width="8" height="6" fill="#ffffff"/></pattern></defs>
  <rect width="120" height="88" fill="#2f343b"/>
  <rect x="0" width="8" height="88" fill="url(#sec-kerb)"/><rect x="112" width="8" height="88" fill="url(#sec-kerb)"/>
  <rect x="10" width="1.6" height="88" fill="#ffffff" opacity="0.85"/><rect x="108.4" width="1.6" height="88" fill="#ffffff" opacity="0.85"/>
  <rect class="sec-gate" data-lane="-1" x="18" y="10" width="26" height="8" rx="4"/>
  <rect class="sec-gate" data-lane="0" x="47" y="10" width="26" height="8" rx="4"/>
  <rect class="sec-gate" data-lane="1" x="76" y="10" width="26" height="8" rx="4"/>
  <path class="sec-route-glow" d="M60 70 C60 48 60 40 60 22"/>
  <path class="sec-route" d="M60 70 C60 48 60 40 60 22"/>
  <circle class="sec-from" cx="60" cy="72" r="6"/>
</svg>`;

export class SegmentScreen implements Screen {
  private course: Course;
  private cam = new Camera();
  private glide: { from: CamState; to: CamState; t0: number; dur: number } | null = null;
  private picks: Pick[] = [];
  /** The segment being picked: picks.length while laying the lap, any segment when changing one. */
  private cursor = 0;
  /** The lane the line will be in at the end of the cursor's segment. */
  private armed: Lane = 0;
  /** The lap is laid and the whole circuit shows. */
  private review = false;
  private history: { picks: Pick[]; cursor: number; review: boolean }[] = [];
  private offsets: Float64Array = new Float64Array(1);
  /** The line so far (metres, one point per centreline vertex). */
  private points: { x: number; y: number }[] = [];
  private ink = new Path2D();
  private brakeInk = new Path2D();
  /** The cursor's segment as the armed gate would lay it. */
  private preview: Path2D | null = null;
  private outline = new Path2D();
  private el: HTMLElement;
  private hint: HTMLElement;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private subtitle: HTMLElement;
  private bar: HTMLElement;
  private pad: HTMLElement;
  private reviewBar: HTMLElement;
  private keys: Record<'gas' | 'brake' | 'left' | 'right', HTMLButtonElement>;
  private leftSide: HTMLElement;
  private rightSide: HTMLElement;
  /** The pad's miniature road: its three gates, the line to the armed one, and where it starts. */
  private roadGates: SVGRectElement[] = [];
  private roadRoute: SVGPathElement[] = [];
  private roadFrom!: SVGCircleElement;
  private undoBtns: HTMLButtonElement[] = [];
  private doneBtn: HTMLButtonElement;
  private allGasBtn: HTMLButtonElement;
  private raceBtn: HTMLButtonElement;
  private tyreBtns: HTMLButtonElement[] = [];
  private listeners: [EventTarget, string, EventListener][] = [];
  private down: { x: number; y: number; id: number } | null = null;
  private pulse = 0;
  private stamp: HTMLElement | null = null;
  private leaving = false;
  /** Lessons done (bits, in LESSONS order), kept in the settings. */
  private learnt: number;
  /** Where the plan opened from the results lost time, and that plan. */
  private report: CoachReport | null = null;
  /** The latest finished analysis of any plan: its tips that still apply show while a changed plan is analysed. */
  private lastDone: CoachReport | null = null;
  private coach: Coach | null = null;
  private recoachTimer: ReturnType<typeof setTimeout> | null = null;
  private unwatch: (() => void) | null = null;
  /** The tutorial: segments laid for the player, the vertex the laid line runs to, its offsets, and how it looks. */
  private given = 0;
  private givenPicks: Pick[] = [];
  private givenV = 0;
  private fixed: Float64Array | null = null;
  private givenInk: Path2D | null = null;
  private guidePath: Path2D | null = null;
  /** The tutorial lap finishes in the gate it starts in. */
  private startGate: Lane = 0;
  /** Walkthrough: the pad waits while a coach card is up, and the first pick ends the "Your turn" card. */
  private locked = false;
  private waitPick: (() => void) | null = null;
  private coachCard: HTMLElement | null = null;
  private coachSpot: HTMLElement | null = null;
  private closed = false;
  /** Where the gain labels were drawn (px), so a tap on one opens its segment. */
  private gainLabels: { x: number; y: number; w: number; h: number; segment: number }[] = [];

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private compound: Compound,
    private actions: SegmentActions,
    /** A plan to start from (changing the one just raced). */
    from: Pick[] | null = null,
    /** Where that plan lost time, being worked out (src/app/coach.ts). */
    coach: Coach | null = null,
    private tutorial: SegmentTutorial | null = null,
  ) {
    this.course = courseFor(track);
    if (tutorial) this.layGiven(tutorial);
    this.learnt = getSettings().segmentLessons;
    app.setCanvasVisible(true);
    for (let i = 0; i <= track.n; i++) {
      const k = i % track.n;
      if (i === 0) this.outline.moveTo(track.x[k], track.y[k]);
      else this.outline.lineTo(track.x[k], track.y[k]);
    }

    const key = (k: 'gas' | 'brake' | 'left' | 'right', icon: string, word: string, extra: HTMLElement | null = null) =>
      h('button', { class: `sec-key sec-${k}`, 'aria-label': word, onclick: () => this.press(k) }, h('span', { class: 'sec-arrow', html: icon }), h('span', { class: 'sec-word' }, h('b', null, word), extra)) as HTMLButtonElement;
    this.leftSide = h('small', null, '');
    this.rightSide = h('small', null, '');
    this.keys = {
      gas: key('gas', ARROW.up, 'Gas'),
      brake: key('brake', ARROW.down, 'Brake'),
      left: key('left', ARROW.left, 'Left', this.leftSide),
      right: key('right', ARROW.right, 'Right', this.rightSide),
    };
    const road = h('div', { class: 'sec-road', html: ROAD_SVG });
    this.roadGates = Array.from(road.querySelectorAll<SVGRectElement>('.sec-gate'));
    this.roadRoute = Array.from(road.querySelectorAll<SVGPathElement>('.sec-route, .sec-route-glow'));
    this.roadFrom = road.querySelector<SVGCircleElement>('.sec-from')!;
    const undo = () => h('button', { class: 'sec-corner sec-undo', 'aria-label': 'Undo', html: ICONS.undo, onclick: () => this.undo() }) as HTMLButtonElement;
    const restart = () => h('button', { class: 'sec-corner sec-restart', 'aria-label': 'Start the lap again', html: ICONS.restart, onclick: () => this.restart() }) as HTMLButtonElement;
    this.doneBtn = h('button', { class: 'sec-done', hidden: true, onclick: () => this.showReview() }, 'Whole lap') as HTMLButtonElement;
    // Offered after a run of Gas: gas the rest of the lap in one tap.
    this.allGasBtn = h(
      'button',
      { class: 'sec-allgas', hidden: true, 'aria-label': 'All gas, no brakes', onclick: () => this.allGas() },
      h('span', { class: 'sec-allgas-icon', html: FLAME }),
      h('span', { class: 'sec-allgas-text' }, h('b', null, 'All gas,'), h('b', null, 'no brakes')),
    ) as HTMLButtonElement;
    const padUndo = undo();
    this.undoBtns.push(padUndo);
    this.pad = h(
      'div',
      { class: 'sec-pad', role: 'group', 'aria-label': 'Pick this segment' },
      this.allGasBtn,
      this.keys.gas,
      this.doneBtn,
      this.keys.left,
      road,
      this.keys.right,
      padUndo,
      this.keys.brake,
      restart(),
    );
    const reviewUndo = undo();
    this.undoBtns.push(reviewUndo);
    const tyres = h('div', { class: 'sec-tyres', role: 'radiogroup', 'aria-label': 'Tyre for this lap' });
    for (const c of COMPOUNDS) {
      const b = h('button', { class: 'draw-edit-tyre', role: 'radio', 'data-c': c, 'aria-label': COMPOUND_SPECS[c].label, html: tyreBadge(c, 28), onclick: () => this.pickTyre(c) }) as HTMLButtonElement;
      this.tyreBtns.push(b);
      tyres.append(b);
    }
    this.raceBtn = h('button', { class: 'btn-ink sec-race', onclick: () => this.race() }, 'Race') as HTMLButtonElement;
    this.reviewBar = h('div', { class: 'strip strip-bottom sec-review', hidden: true }, reviewUndo, restart(), tyres, this.raceBtn);

    this.hint = h('p', { class: 'draw-hint is-hidden', role: 'status' }, '');
    this.subtitle = h('span', null, '');
    this.bar = h('i');
    this.el = h(
      'div',
      { class: 'draw-hud sec-hud' },
      h(
        'div',
        { class: 'strip strip-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'Back to circuits', html: ICONS.close, onclick: () => this.actions.exit() }),
        h('div', { class: 'draw-title' }, h('strong', null, track.meta.short), this.subtitle),
        tutorial
          ? h('button', { class: 'icon-btn', 'aria-label': 'Pause', html: ICONS.pause, onclick: () => this.openPause() })
          : h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings(this.app, () => {}) }),
      ),
      h('div', { class: 'draw-progress', role: 'progressbar', 'aria-label': 'Lap laid' }, this.bar),
      this.hint,
      this.pad,
      this.reviewBar,
    );
    app.root.append(this.el);
    this.cam.w = app.w;
    this.cam.h = app.h;

    if (from && from.length === this.course.segments.length) {
      this.picks = from.map((p) => ({ ...p }));
      this.cursor = this.picks.length;
      this.review = true;
    }
    this.solve(null);
    this.syncArmed();
    this.syncTyres();
    this.sync();
    this.setCam(this.review ? this.overviewFrame() : this.segmentFrame(this.cursor));
    this.teach();
    // A plan opened from its result is analysed (or already was), so the
    // whole lap shows where it lost time.
    if (from && this.picks.length === this.course.segments.length) this.watchCoach(coach ?? startCoach(track, this.course, this.picks, this.compound));
    if (tutorial?.walkthrough) void this.walkthrough(!!tutorial.skipIntro);

    const c = app.canvas;
    this.listen(c, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(c, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(c, 'pointercancel', () => (this.down = null));
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
  }

  /**
   * The tutorial: the segments up to where the laid line ends are laid for
   * the player. The line there is the laid line itself (its offsets pinned in
   * the solve); their pedals are where one fast lap brakes; the player's
   * segments start after it.
   */
  private layGiven(tu: SegmentTutorial): void {
    const t = this.track;
    const pre = Array.from(tu.prefix, (v) => v / UNITS_PER_METRE);
    const m = pre.length / 2;
    const end = projectGlobal(t, pre[(m - 1) * 2], pre[(m - 1) * 2 + 1]);
    const segs = this.course.segments;
    // Laid for the player: every segment the laid line reaches the end of (or
    // all but a few metres of), so theirs start where it stops.
    this.given = Math.max(1, segs.findIndex((g) => g.to > end.s + GIVEN_SLACK));
    this.givenV = segs[this.given - 1].v;
    // The laid line's offset at each vertex: where it crosses the vertex's normal.
    const fixed = new Float64Array(this.givenV + 1);
    let j = 0;
    for (let q = 0; q <= this.givenV; q++) {
      const v = q % t.n;
      const cx = t.x[v], cy = t.y[v], nx = t.nx[v], ny = t.ny[v];
      // Along the track (its own direction there): the laid points either side of this vertex.
      const along = (k: number) => (pre[k * 2] - cx) * t.tx[v] + (pre[k * 2 + 1] - cy) * t.ty[v];
      while (j < m - 2 && along(j + 1) < 0) j++;
      const a = along(j);
      const b = along(j + 1);
      const u = b !== a ? Math.min(1, Math.max(0, -a / (b - a))) : 0;
      const px = pre[j * 2] + (pre[j * 2 + 2] - pre[j * 2]) * u;
      const py = pre[j * 2 + 1] + (pre[j * 2 + 3] - pre[j * 2 + 1]) * u;
      const lim = laneOffset(t);
      fixed[q] = Math.max(-lim, Math.min(lim, (px - cx) * nx + (py - cy) * ny));
    }
    this.fixed = fixed;
    const w = laneOffset(t);
    const laneOf = (a: number): Lane => (a < -w / 3 ? -1 : a > w / 3 ? 1 : 0);
    this.startGate = laneOf(fixed[0]);
    // Pedals: brake where the fast lap spends most of a segment braking.
    const lap = simulateLap(t, tu.ideal, 'medium');
    this.givenPicks = segs.slice(0, this.given).map((g) => {
      let n = 0, braking = 0;
      for (let i = 0; i < lap.n; i++) {
        if (lap.s[i] >= g.from && lap.s[i] < g.to) {
          n++;
          if (lap.brake[i] > 0.05) braking++;
        }
      }
      return { pedal: n && braking / n > 0.35 ? 'brake' : 'gas', lane: laneOf(fixed[Math.min(g.v, this.givenV)]) } as Pick;
    });
    this.picks = this.givenPicks.map((p) => ({ ...p }));
    this.cursor = this.given;
    this.givenInk = polyPath(pre);
    this.guidePath = tu.guide ? polyPath(tu.guide) : null;
  }

  /**
   * The guided first run on the tutorial circuit, in segment by segment's
   * words: welcome (with the difficulty), a flight along the laid line, the
   * player's turn at the last corner, then the tyre for the race.
   */
  private async walkthrough(skipIntro: boolean): Promise<void> {
    this.locked = true;
    if (!skipIntro) {
      const welcome = await this.coachStep({
        title: 'Welcome to PoleLine',
        body: `You lay the racing line, and a ${REAL_CIRCUITS ? '2026 F1 car' : 'modern single-seater'} drives it flat out. We have laid this lap for you as far as the last corner. You finish it.`,
        primary: 'Show me',
        extra: h(
          'div',
          { class: 'coach-diff' },
          h('span', { class: 'coach-diff-head' }, 'How do you want to lay it?'),
          difficultyPicker('segments', (m) => this.switchMode(m)),
          h('small', null, 'Change it any time from the pause button.'),
        ),
      });
      if (this.closed) return;
      if (welcome === 'skip') return this.skipWalkthrough();
      await this.tour();
      if (this.closed) return;
    }
    this.locked = false;
    this.glideTo(this.segmentFrame(this.cursor));
    await wait(450);
    if (this.closed) return;
    const turn = this.coachStep({
      step: 'Step 1 of 2',
      title: 'Your turn',
      body: TUTORIAL_COPY.segments.turn,
      target: () => this.pad.getBoundingClientRect(),
    });
    const started = new Promise<'next'>((r) => (this.waitPick = () => {
      this.waitPick = null;
      r('next');
    }));
    if ((await Promise.race([turn, started])) === 'skip') return this.skipWalkthrough();
    this.closeCoach();
    this.teach();
    // The tyre comes with the race, once the corner is laid.
    await new Promise<void>((r) => {
      const check = () => (this.closed || this.review ? r() : setTimeout(check, 200));
      check();
    });
    if (this.closed) return;
    await wait(900);
    if (this.closed || !this.review) return;
    const tyres = await this.coachStep({
      step: 'Step 2 of 2',
      title: 'Pick your tyres, then Race',
      body: `It is ${this.track.meta.trackTemp}°C on track. Softs grip most but overheat, hards never get warm. Mediums are made for days like this.`,
      target: () => this.reviewBar.getBoundingClientRect(),
    });
    if (tyres === 'skip') this.skipWalkthrough();
  }

  /** Fly the camera along the line laid for the player, start line to the last corner. */
  private async tour(): Promise<void> {
    this.say('The purple line is laid for you, from the start to the last corner.', 5000);
    const t = this.track;
    const end = this.course.segments[this.given - 1].to;
    for (const f of [0.18, 0.4, 0.62, 0.82, 1]) {
      if (this.closed) return;
      const s = end * f;
      const a = frameAt(t, s);
      const b = frameAt(t, s + 80);
      this.glideTo({ cx: a.x, cy: a.y, zoom: 1.6, angle: angleForHeading(b.x - a.x, b.y - a.y) }, 820);
      await wait(820);
    }
  }

  private skipWalkthrough(): void {
    this.closeCoach();
    this.actions.skip?.();
  }

  private switchMode(m: DrawMode): void {
    if (m === 'segments') return;
    this.closeCoach();
    this.leaving = true;
    this.actions.switchMode?.(m);
  }

  /** The tutorial's pause menu: difficulty, resume, every setting, or skip the walkthrough. */
  private openPause(): void {
    openPauseMenu(this.app, {
      mode: 'segments',
      pick: (m) => this.switchMode(m),
      settings: () => openSettings(this.app, () => {}),
      skip: this.tutorial?.walkthrough ? () => this.skipWalkthrough() : undefined,
    });
  }

  /** A coach card, centred or beside the thing to touch (ringed, everything else dimmed). */
  private coachStep(o: { step?: string; title: string; body: string; extra?: HTMLElement; primary?: string; target?: () => DOMRect | null }): Promise<'next' | 'skip'> {
    this.closeCoach();
    return new Promise((resolve) => {
      const done = (r: 'next' | 'skip') => {
        this.closeCoach();
        resolve(r);
      };
      const card = h(
        'div',
        { class: 'coach', role: 'dialog', 'aria-label': o.title },
        o.step ? h('span', { class: 'coach-step' }, o.step) : null,
        h('strong', null, o.title),
        h('p', null, o.body),
        o.extra ?? null,
        h(
          'div',
          { class: 'coach-actions' },
          o.primary ? h('button', { class: 'btn-ink', onclick: () => done('next') }, o.primary) : null,
          h('button', { class: 'coach-skip', onclick: () => done('skip') }, 'Skip tutorial'),
        ),
      );
      const r = o.target?.() ?? null;
      if (r && r.height) {
        const pad = 6;
        this.coachSpot = h('div', { class: 'coach-spot', style: `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px` });
        this.el.append(this.coachSpot);
        card.classList.add('is-above');
        card.style.setProperty('bottom', `${this.app.h - r.top + 18}px`);
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
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  /** A lap is underway, so a stray back gesture should not throw it away. */
  get holdsWork(): boolean {
    return this.picks.length > this.given && !this.leaving;
  }

  private watchCoach(coach: Coach): void {
    this.unwatch?.();
    this.coach = coach;
    this.unwatch = coach.watch((r) => {
      this.report = r;
      if (r.done) this.lastDone = r;
      this.sync();
    });
  }

  /**
   * After a change to a laid lap that has been analysed (or a change of tyre),
   * analyse it again once the player pauses, so the whole lap keeps showing
   * where it loses time.
   */
  private recoachSoon(): void {
    if (!this.coach) return;
    if (this.recoachTimer) clearTimeout(this.recoachTimer);
    // A plan seen before (an undo, the tyre it was raced on) answers at once.
    if (this.picks.length === this.course.segments.length && analysed(this.track.meta.slug, this.picks, this.compound)) {
      this.watchCoach(startCoach(this.track, this.course, this.picks, this.compound));
      return;
    }
    this.recoachTimer = setTimeout(() => {
      this.recoachTimer = null;
      if (this.leaving || this.picks.length !== this.course.segments.length || this.matches(this.report)) return;
      this.watchCoach(startCoach(this.track, this.course, this.picks, this.compound));
    }, RECOACH_MS);
  }

  /** A report on the plan and tyre as they stand now. */
  private matches(r: CoachReport | null): boolean {
    return !!r && r.compound === this.compound && r.picks === encodePicks(this.picks);
  }

  /**
   * The tips to show, biggest first. Each gain is exact for the plan and tyre
   * it was worked out on (battery and tyres tie the whole lap together). While
   * a changed plan is being analysed, the segments already checked show their
   * new tips and the rest show the last analysis's tips that still apply (the
   * segment's pick is unchanged and the gate is still reachable), marked stale.
   */
  private tips(): ShownTip[] {
    const cur = this.matches(this.report) ? this.report : null;
    if (cur?.done) return bestTips(cur).map((t) => ({ ...t, stale: false }));
    const fresh: ShownTip[] = cur ? bestTips(cur).map((t) => ({ ...t, stale: false })) : [];
    const old = this.lastDone;
    const stale: ShownTip[] = [];
    if (old && old !== cur) {
      const was = decodePicks(old.picks);
      for (const t of bestTips(old)) {
        if (cur && t.segment < cur.checked) continue;
        const p = this.picks[t.segment];
        if (!was || !p || p.pedal !== was[t.segment].pedal || p.lane !== was[t.segment].lane) continue;
        if (t.lane !== undefined && !laneOptions(this.course, this.picks, t.segment).includes(t.lane)) continue;
        stale.push({ ...t, stale: true });
      }
    }
    return [...fresh, ...stale].sort((x, y) => y.gain - x.gain);
  }

  private tipFor(k: number): ShownTip | null {
    return this.tips().find((t) => t.segment === k) ?? null;
  }

  /** Test hook: where things stand. */
  get state(): { cursor: number; total: number; picks: string; review: boolean; armed: Lane; startLane: Lane; coached: boolean; tips: (ShownTip & { action: string })[] } {
    return {
      coached: !!this.report?.done && this.matches(this.report),
      tips: this.tips().map((t) => ({ ...t, action: tipAction(t) })),
      cursor: this.cursor,
      total: this.course.segments.length,
      picks: this.picks.map((p) => (p.pedal === 'gas' ? 'g' : 'b') + (p.lane < 0 ? 'l' : p.lane > 0 ? 'r' : 'm')).join(''),
      review: this.review,
      armed: this.armed,
      startLane: startLane(this.course, this.picks, this.cursor),
    };
  }

  // Picking ----------------------------------------------------------------

  private press(k: 'gas' | 'brake' | 'left' | 'right'): void {
    unlockAudio();
    if (this.review || this.leaving || this.locked) return;
    this.waitPick?.();
    if (k === 'left' || k === 'right') {
      const options = this.options();
      const i = options.indexOf(this.armed);
      const next = options[i + (k === 'left' ? -1 : 1)];
      if (next === undefined) {
        buzz(30);
        this.flash(k);
        return;
      }
      this.armed = next;
      sfx.tap();
      buzz(8);
      this.done('lane');
      this.updatePreview();
      this.sync();
      return;
    }
    this.commit(k);
  }

  private options(): Lane[] {
    return this.optionsFor(this.cursor);
  }

  private optionsFor(k: number): Lane[] {
    // The tutorial lap finishes in the gate it starts in.
    if (this.tutorial && k === this.course.segments.length - 1) return [this.startGate];
    return laneOptions(this.course, this.picks, k);
  }

  private commit(pedal: Pedal): void {
    const k = this.cursor;
    if (k >= this.course.segments.length) return;
    this.remember();
    const pick: Pick = { pedal, lane: this.armed };
    const prev = this.offsets;
    const appending = k === this.picks.length;
    if (appending) this.picks.push(pick);
    else {
      this.picks[k] = pick;
      settleLanes(this.course, this.picks, k);
    }
    this.done(pedal);
    sfx.penDown();
    buzz(pedal === 'brake' ? [14, 40, 14] : 12);
    this.pulse = performance.now();
    const whole = this.picks.length === this.course.segments.length;
    this.solve(appending && !whole ? prev : null);
    if (whole) this.recoachSoon();
    if (whole && appending && k === this.course.segments.length - 1) {
      this.lapLaid();
      return;
    }
    // Changing a laid lap walks on through the segments after the one changed.
    this.cursor = whole && k + 1 >= this.course.segments.length ? 0 : k + 1;
    if (whole && k + 1 >= this.course.segments.length) {
      this.showReview();
      return;
    }
    this.syncArmed();
    this.sync();
    this.glideTo(this.segmentFrame(this.cursor));
    this.teach();
  }

  private lapLaid(text = 'Lap laid'): void {
    sfx.lapDrawn();
    buzz(20);
    this.stamp?.remove();
    this.stamp = h('div', { class: 'stamp' }, text);
    this.el.append(this.stamp);
    const stamp = this.stamp;
    setTimeout(() => {
      stamp.remove();
      if (this.stamp === stamp) this.stamp = null;
    }, 1100);
    this.showReview();
  }

  /** Gas picks in a row at the end of the lap laid so far. */
  private gasRun(): number {
    let n = 0;
    for (let k = this.picks.length - 1; k >= 0 && this.picks[k].pedal === 'gas'; k--) n++;
    return n;
  }

  /** The offer shows while laying a lap (not changing one) after a run of Gas, with some of the lap still to lay. */
  private offerAllGas(): boolean {
    return !this.tutorial && !this.review && !this.leaving && this.cursor === this.picks.length && this.course.segments.length - this.picks.length >= 2 && this.gasRun() >= ALL_GAS_AFTER;
  }

  /**
   * All gas, no brakes: every segment left goes on the gas, each staying in
   * the lane it starts in (the gate armed now for this one), and the lap is
   * laid. One undo takes it all back.
   */
  private allGas(): void {
    if (!this.offerAllGas()) return;
    this.remember();
    const total = this.course.segments.length;
    while (this.picks.length < total) {
      const k = this.picks.length;
      const options = this.optionsFor(k);
      const stay = k === this.cursor ? this.armed : startLane(this.course, this.picks, k);
      const lane = options.includes(stay) ? stay : options.reduce((a, b) => (Math.abs(b - stay) < Math.abs(a - stay) ? b : a), options[0]);
      this.picks.push({ pedal: 'gas', lane });
    }
    this.done('gas');
    this.solve(null);
    buzz([20, 30, 20, 30, 40]);
    this.lapLaid('No brakes!');
  }

  private showReview(): void {
    if (this.picks.length !== this.course.segments.length) return;
    this.review = true;
    this.cursor = this.picks.length;
    this.preview = null;
    this.sync();
    this.glideTo(this.overviewFrame(), 700);
    this.teach();
  }

  /** Open a segment of a laid lap (or any laid segment) to change it. */
  private openSegment(k: number): void {
    if (k < this.given || k > this.picks.length || k >= this.course.segments.length) return;
    if (k === this.cursor && !this.review) return;
    this.review = false;
    this.cursor = k;
    this.syncArmed();
    this.sync();
    this.glideTo(this.segmentFrame(k));
    sfx.tap();
    this.done('review');
    this.teach();
  }

  private syncArmed(prefer?: Lane): void {
    const options = this.options();
    const current = prefer ?? this.picks[this.cursor]?.lane ?? startLane(this.course, this.picks, this.cursor);
    this.armed = options.includes(current) ? current : options.reduce((a, b) => (Math.abs(b - current) < Math.abs(a - current) ? b : a), options[0] ?? 0);
    this.updatePreview();
  }

  private remember(): void {
    this.history.push({ picks: this.picks.map((p) => ({ ...p })), cursor: this.cursor, review: this.review });
    if (this.history.length > 200) this.history.shift();
  }

  private undo(): void {
    const last = this.history.pop();
    if (!last) return;
    sfx.lift();
    // The segment the undo reopens comes back with the gate it was set with.
    const undone = this.picks[last.cursor];
    this.picks = last.picks;
    this.cursor = last.cursor;
    this.review = last.review;
    this.solve(null);
    this.syncArmed(undone?.lane);
    this.recoachSoon();
    this.sync();
    this.glideTo(this.review ? this.overviewFrame() : this.segmentFrame(this.cursor));
  }

  private restart(): void {
    if (this.picks.length <= this.given) return;
    this.remember();
    this.picks = this.givenPicks.map((p) => ({ ...p }));
    this.cursor = this.given;
    this.review = false;
    this.solve(null);
    this.syncArmed();
    this.sync();
    this.glideTo(this.segmentFrame(this.cursor), 600);
    this.say(this.tutorial ? 'Back to the last corner. Undo brings your lap back.' : 'Back to the start line. Undo brings your lap back.');
  }

  private pickTyre(c: Compound): void {
    this.compound = c;
    setTyre(this.track.meta.slug, c);
    sfx.tap();
    this.syncTyres();
    this.sync();
    this.recoachSoon();
  }

  private syncTyres(): void {
    for (const b of this.tyreBtns) {
      const on = b.dataset.c === this.compound;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  private race(): void {
    if (this.leaving || this.picks.length !== this.course.segments.length) return;
    const b = new LineBuilder(this.track);
    const pts = this.points;
    // The tutorial lap starts with the line laid for the player, point for point.
    let ok = this.tutorial ? b.preload(this.tutorial.prefix) : b.start(pts[0].x, pts[0].y);
    let why = ok ? 'never reached the line' : 'bad start';
    for (let i = this.tutorial ? this.givenV + 1 : 1; ok && i < pts.length && b.status !== 'done'; i++) {
      const r = b.extend(pts[i].x, pts[i].y);
      if (r === 'offtrack' || r === 'backward') {
        ok = false;
        why = `${r} at vertex ${i}`;
      }
    }
    if (!ok || b.status !== 'done') {
      console.error('planned line is not a legal lap:', why);
      this.say('That line does not make a lap. Change a segment, or undo.');
      sfx.fail();
      return;
    }
    this.leaving = true;
    saveSettings({ tutorialDone: true });
    this.actions.complete(b.points.slice(), this.compound, this.picks.map((p) => ({ ...p })));
  }

  // The line ------------------------------------------------------------------

  /** Solve the line for the picks so far (re-solving only the end when `prev` is the line before one more segment). */
  private solve(prev: Float64Array | null): void {
    this.offsets = solveOffsets(this.track, this.course, this.picks, prev, this.fixed);
    this.points = this.picks.length ? planPoints(this.track, this.course, this.picks, this.offsets) : [];
    this.ink = new Path2D();
    this.brakeInk = new Path2D();
    const pts = this.points;
    // On the tutorial the laid-for-you line is drawn faint on its own; the ink is the player's part.
    const first = this.tutorial ? this.givenV : 0;
    for (let i = first; i < pts.length; i++) (i === first ? this.ink.moveTo(pts[i].x, pts[i].y) : this.ink.lineTo(pts[i].x, pts[i].y));
    let from = 0;
    this.course.segments.forEach((sec, k) => {
      if (k < this.picks.length && this.picks[k].pedal === 'brake') {
        for (let q = from; q <= sec.v && q < pts.length; q++) {
          if (q === from) this.brakeInk.moveTo(pts[q].x, pts[q].y);
          else this.brakeInk.lineTo(pts[q].x, pts[q].y);
        }
      }
      from = sec.v;
    });
  }

  /** The cursor's segment as the armed gate would lay it, dashed until it is set. */
  private updatePreview(): void {
    this.preview = null;
    if (this.review) return;
    const k = this.cursor;
    const sec = this.course.segments[k];
    if (!sec) return;
    const trial = this.picks.map((p) => ({ ...p }));
    const pedal = trial[k]?.pedal ?? 'gas';
    if (k === trial.length) trial.push({ pedal, lane: this.armed });
    else {
      trial[k] = { pedal, lane: this.armed };
      settleLanes(this.course, trial, k);
    }
    const whole = trial.length === this.course.segments.length;
    const off = solveOffsets(this.track, this.course, trial, k === this.picks.length && !whole ? this.offsets : null, this.fixed);
    const t = this.track;
    const a = k === 0 ? 0 : this.course.segments[k - 1].v;
    const p = new Path2D();
    for (let q = a; q <= sec.v && q < off.length; q++) {
      const v = q % t.n;
      const x = t.x[v] + t.nx[v] * off[q];
      const y = t.y[v] + t.ny[v] * off[q];
      if (q === a) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
    this.preview = p;
  }

  // HUD ------------------------------------------------------------------------

  private sync(): void {
    const total = this.course.segments.length;
    const sec = this.course.segments[this.cursor];
    const laid = this.picks.length;
    this.bar.style.transform = `scaleX(${laid / total})`;
    const shown = this.tips();
    const settled = this.matches(this.report) && !!this.report?.done;
    setText(
      this.subtitle,
      this.review
        ? !this.coach
          ? 'Lap laid. Tap a segment to change it'
          : !settled
            ? shown.length
              ? 'Updating where it loses time'
              : 'Finding where it loses time'
            : shown.length
              ? 'Tap an orange segment to find time'
              : 'No single change makes it quicker'
        : sec
          ? `Segment ${this.cursor + 1} of ${total}: ${segmentText(sec, turnOfSegment(this.course, this.cursor, turnsOf(this.track)))}`
          : '',
    );
    this.pad.hidden = this.review;
    this.reviewBar.hidden = !this.review;
    this.el.classList.toggle('is-review', this.review);
    this.doneBtn.hidden = this.review || laid !== total;
    const offer = this.offerAllGas();
    if (offer && this.allGasBtn.hidden) {
      // Pops in once when the run reaches it.
      this.allGasBtn.classList.remove('is-new');
      void this.allGasBtn.offsetWidth;
      this.allGasBtn.classList.add('is-new');
    }
    this.allGasBtn.hidden = !offer;
    const canUndo = this.history.length > 0;
    for (const b of this.undoBtns) b.disabled = !canUndo;
    if (!sec || this.review) return;
    const options = this.options();
    const i = options.indexOf(this.armed);
    this.keys.left.classList.toggle('is-off', i <= 0);
    this.keys.right.classList.toggle('is-off', i < 0 || i >= options.length - 1);
    const pedal = this.picks[this.cursor]?.pedal;
    this.keys.gas.classList.toggle('is-picked', pedal === 'gas');
    this.keys.brake.classList.toggle('is-picked', pedal === 'brake');
    // Inside or outside of the corner this segment belongs to.
    const side = (lane: Lane) => {
      const s = laneSide(this.course, sec, lane);
      return s > 0 ? 'inside' : s < 0 ? 'outside' : '';
    };
    setText(this.leftSide, side(-1));
    setText(this.rightSide, side(1));
    // The miniature road: the gates this segment can reach, and the line from
    // where it starts to the armed one.
    const from = startLane(this.course, this.picks, this.cursor);
    for (const g of this.roadGates) {
      const lane = Number(g.dataset.lane) as Lane;
      g.setAttribute('class', `sec-gate${lane === this.armed ? ' is-armed' : options.includes(lane) ? ' is-open' : ''}`);
    }
    const fx = ROAD_LANE_X[from];
    const ax = ROAD_LANE_X[this.armed];
    const d = `M${fx} 70 C${fx} 50 ${ax} 42 ${ax} 22`;
    for (const r of this.roadRoute) r.style.setProperty('d', `path("${d}")`);
    this.roadFrom.style.setProperty('cx', `${fx}px`);
  }

  private flash(k: 'left' | 'right'): void {
    const b = this.keys[k];
    b.classList.remove('is-shake');
    void b.offsetWidth;
    b.classList.add('is-shake');
  }

  private say(text: string, ms = HINT_MS): void {
    setText(this.hint, text);
    this.hint.classList.remove('is-hidden');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.classList.add('is-hidden'), ms);
  }

  private learned(l: Lesson): boolean {
    return (this.learnt & (1 << Object.keys(LESSONS).indexOf(l))) !== 0;
  }

  private done(l: Lesson): void {
    // Done: its line has served its purpose.
    if (this.hint.textContent === LESSONS[l]) this.hint.classList.add('is-hidden');
    if (this.learned(l)) return;
    this.learnt |= 1 << Object.keys(LESSONS).indexOf(l);
    saveSettings({ segmentLessons: this.learnt });
  }

  /** The next lesson, when the moment for it comes: gas first, brake at the first board, gates at the first corner. */
  private teach(): void {
    const sec = this.course.segments[this.cursor];
    if (this.review) {
      // A segment's "here" line means nothing on the whole lap.
      if (this.hint.textContent?.endsWith('s quicker.')) this.hint.classList.add('is-hidden');
      if (!this.learned('review')) this.say(LESSONS.review, 6000);
      return;
    }
    if (!sec) return;
    if (!this.learned('gas')) return this.say(LESSONS.gas, 8000);
    // Brake: at a brake board, or on the way to the turn-in, of a corner the car slows for.
    const slows = sec.corner !== null && this.course.corners[sec.corner].brakes;
    if (!this.learned('brake') && (sec.end === 'board' || (sec.end === 'turn' && slows))) return this.say(LESSONS.brake, 8000);
    if (!this.learned('lane') && this.learned('brake') && (sec.end === 'turn' || sec.end === 'in' || sec.end === 'apex' || sec.end === 'out' || sec.end === 'exit')) return this.say(LESSONS.lane, 8000);
    // A segment the last lap lost time in says what would win it back.
    const tip = this.tipFor(this.cursor);
    if (tip) return this.say(`${tipAction(tip)} here: ${tip.stale ? 'about ' : ''}${tipSeconds(tip)} s quicker.`, 6000);
    // Nothing to teach here: a lesson still showing from the last segment has had its moment.
    if (Object.values(LESSONS).includes(this.hint.textContent as (typeof LESSONS)[Lesson]) || this.hint.textContent?.endsWith('s quicker.')) this.hint.classList.add('is-hidden');
  }

  // Input ------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.app.root.querySelector('.overlay') || e.metaKey || e.ctrlKey || e.altKey) return;
    const map: Record<string, 'gas' | 'brake' | 'left' | 'right' | 'undo' | 'race'> = {
      ArrowUp: 'gas',
      w: 'gas',
      ArrowDown: 'brake',
      s: 'brake',
      ArrowLeft: 'left',
      a: 'left',
      ArrowRight: 'right',
      d: 'right',
      Backspace: 'undo',
      z: 'undo',
      Enter: 'race',
    };
    const act = map[e.key];
    if (!act) return;
    // Enter and Backspace belong to a focused button or field.
    const target = e.target as HTMLElement | null;
    if ((act === 'race' || act === 'undo') && target?.closest('button, input, select, textarea, a, [contenteditable]')) return;
    e.preventDefault();
    if (act === 'undo') this.undo();
    else if (act === 'race') {
      if (this.review) this.race();
    } else this.press(act);
  }

  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
    const r = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    // A gain label opens its segment.
    const inside = (b: { x: number; y: number; w: number; h: number }, pad: number) => sx >= b.x - pad && sx <= b.x + b.w + pad && sy >= b.y - pad && sy <= b.y + b.h + pad;
    const label = this.review ? (this.gainLabels.find((b) => inside(b, 0)) ?? this.gainLabels.find((b) => inside(b, 6))) : undefined;
    if (label) {
      this.openSegment(label.segment);
      return;
    }
    const w = this.cam.toWorld(sx, sy);
    const p = projectGlobal(this.track, w.x, w.y);
    // A finger's width off the road still counts, however far out the map is.
    if (p.dist > this.track.limit + 22 / this.cam.zoom) return;
    const k = this.course.segments.findIndex((s) => p.s >= s.from && p.s < s.to);
    if (k < 0) return;
    // Laid segments and the next one can be opened.
    if (k <= this.picks.length) this.openSegment(k);
  }

  // Camera ---------------------------------------------------------------------

  /** The free space between the top bar and the pad (or the review bar). */
  private safeArea(): { top: number; bottom: number } {
    const top = 96;
    const panel = (this.review ? this.reviewBar : this.pad).getBoundingClientRect();
    const bottom = panel.height ? panel.top - 64 : this.app.h - 260;
    return { top, bottom: Math.max(top + 120, bottom) };
  }

  /**
   * Frame a segment with the road just past it (enough to see the corner it
   * leads to), turned so the road runs up the screen.
   */
  private segmentFrame(k: number): CamState {
    const t = this.track;
    const sec = this.course.segments[Math.min(k, this.course.segments.length - 1)];
    // A long segment shows its last stretch: the gate and the brake boards are what matter.
    const s0 = Math.max(sec.from, sec.to - MAX_FRAME) - 12;
    const ahead = Math.max(70, Math.min(140, (sec.to - sec.from) * 0.6));
    const s1 = Math.max(sec.to + ahead, s0 + 150);
    const at = (s: number) => {
      let u = s % t.length;
      if (u < 0) u += t.length;
      let lo = 0, hi = t.n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (t.s[mid] <= u) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const pts: { x: number; y: number }[] = [];
    for (let s = s0; s <= s1; s += 4) {
      const i = at(s);
      pts.push({ x: t.x[i], y: t.y[i] });
    }
    const a = pts[0];
    const end = at(sec.to);
    let hx = t.x[end] - a.x;
    let hy = t.y[end] - a.y;
    const len = Math.hypot(hx, hy);
    const i0 = at(sec.from);
    if (len < 20) {
      hx = t.tx[i0];
      hy = t.ty[i0];
    }
    const angle = angleForHeading(hx, hy);
    // Fit the stretch (plus the road's width) in the free space.
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      const x = p.x * c - p.y * sn;
      const y = p.x * sn + p.y * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const pad = t.limit + 10;
    const { top, bottom } = this.safeArea();
    const zoom = Math.max(1, Math.min(5.2, Math.min((this.app.w - 28) / (maxX - minX + pad * 2), (bottom - top) / (maxY - minY + pad * 2))));
    // Centre of the fitted box, back in world space.
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    const cx = mx * c + my * sn;
    const cy = -mx * sn + my * c;
    // The camera sits at the middle of the screen: move it so the box centres
    // in the free space instead (screen down is world (sin a, cos a)).
    const shift = ((top + bottom) / 2 - this.app.h / 2) / zoom;
    return { cx: cx - Math.sin(angle) * shift, cy: cy - Math.cos(angle) * shift, zoom, angle };
  }

  /**
   * The whole circuit, as big as the free space allows: north up, or a quarter
   * turn when that makes it at least 15% bigger (a wide circuit on a tall
   * phone). Room is left around it for the turn badges and gain labels.
   */
  private overviewFrame(): CamState {
    const t = this.track;
    const { top, bottom } = this.safeArea();
    let best: CamState | null = null;
    for (const angle of [0, -Math.PI / 2]) {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < t.n; i++) {
        const x = t.x[i] * c - t.y[i] * sn;
        const y = t.x[i] * sn + t.y[i] * c;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const zoom = Math.min((this.app.w - 110) / (maxX - minX + 40), (bottom - top - 50) / (maxY - minY + 40));
      if (best && zoom < best.zoom * 1.15) continue;
      const mx = (minX + maxX) / 2;
      const my = (minY + maxY) / 2;
      const shift = ((top + bottom) / 2 - this.app.h / 2) / zoom;
      best = { cx: mx * c + my * sn - Math.sin(angle) * shift, cy: -mx * sn + my * c - Math.cos(angle) * shift, zoom, angle };
    }
    return best!;
  }

  private setCam(s: CamState): void {
    this.cam.cx = s.cx;
    this.cam.cy = s.cy;
    this.cam.zoom = s.zoom;
    this.cam.angle = s.angle;
    this.cam.ax = 0.5;
    this.cam.ay = 0.5;
  }

  private glideTo(to: CamState, dur = 420): void {
    this.glide = { from: { cx: this.cam.cx, cy: this.cam.cy, zoom: this.cam.zoom, angle: this.cam.angle }, to, t0: performance.now(), dur };
  }

  resize(): void {
    this.cam.w = this.app.w;
    this.cam.h = this.app.h;
    this.glide = null;
    this.setCam(this.review ? this.overviewFrame() : this.segmentFrame(this.cursor));
  }

  // Drawing ----------------------------------------------------------------

  frame(now: number): void {
    if (this.glide) {
      const g = this.glide;
      const u = Math.min(1, (now - g.t0) / g.dur);
      const e = easeInOutCubic(u);
      this.cam.cx = g.from.cx + (g.to.cx - g.from.cx) * e;
      this.cam.cy = g.from.cy + (g.to.cy - g.from.cy) * e;
      this.cam.zoom = Math.exp(Math.log(g.from.zoom) + (Math.log(g.to.zoom) - Math.log(g.from.zoom)) * e);
      this.cam.angle = lerpAngle(g.from.angle, g.to.angle, e);
      if (u >= 1) this.glide = null;
    }
    const { ctx } = this.app;
    const dpr = this.app.dpr;
    this.cam.apply(ctx, dpr);
    this.art.draw(ctx, this.cam);
    const z = this.cam.zoom;
    const sec = this.course.segments[this.cursor];
    if (sec && !this.review) this.drawSegmentBand(ctx, sec.from, sec.to);
    const tips = this.review ? this.tips() : [];
    if (tips.length) this.drawLosses(ctx, tips);
    if (this.review) this.drawBoundaries(ctx);
    if (this.guidePath) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([7 / z, 6 / z]);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 4.5 / z;
      ctx.stroke(this.guidePath);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2.2 / z;
      ctx.stroke(this.guidePath);
      ctx.restore();
    }
    if (this.givenInk) strokeInk(ctx, this.givenInk, z, INK, 0.45);
    // Brake zones glow red under the line.
    if (this.picks.length) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = BRAKE_RED;
      ctx.lineWidth = Math.max(4, 15 / z);
      ctx.stroke(this.brakeInk);
      ctx.restore();
      strokeInk(ctx, this.ink, z, INK);
    }
    if (this.preview && sec) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 3.4 / z);
      ctx.stroke(this.preview);
      ctx.restore();
    }
    if (sec && !this.review) this.drawGates(ctx, sec.v);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBoards(ctx);
    // Where each timing sector starts shows everywhere. Turn numbers and
    // segment numbers only on the whole track: close up, the brake boards and
    // the gate are all a segment needs.
    const badges = drawSectorMarks(ctx, this.cam, this.track, { size: this.review ? 11 : 12 });
    if (this.review) {
      badges.push(...drawTurnLabels(ctx, this.cam, this.track, { size: 10 }));
      badges.push(...this.drawSegmentNumbers(ctx, badges));
    }
    if (sec && !this.review) this.drawTip(ctx, now);
    if (tips.length) this.drawGains(ctx, tips.slice(0, TIP_LABELS), badges);
    else this.gainLabels = [];
  }

  /**
   * On the whole lap, the segments that lost time: a wide orange band under
   * the line, stronger the more there is to find, wide enough to see with the
   * whole circuit on screen.
   */
  private drawLosses(ctx: CanvasRenderingContext2D, tips: ShownTip[]): void {
    const t = this.track;
    const z = this.cam.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(t.limit * 2.2, 26 / z);
    for (const tip of tips) {
      const sec = this.course.segments[tip.segment];
      const from = tip.segment === 0 ? 0 : this.course.segments[tip.segment - 1].v;
      ctx.beginPath();
      for (let q = from; q <= sec.v; q++) {
        const v = q % t.n;
        if (q === from) ctx.moveTo(t.x[v], t.y[v]);
        else ctx.lineTo(t.x[v], t.y[v]);
      }
      // Stale (still being checked again): fainter.
      ctx.strokeStyle = `rgba(255, 138, 0, ${((0.45 + 0.5 * Math.min(1, tip.gain / 300)) * (tip.stale ? 0.5 : 1)).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * On the whole track, the number of the first segment and every fifth one,
   * in small tags on the left of the road at the middle of each, so a segment
   * a result names can be found. A tag that would cover a badge is left out.
   */
  private drawSegmentNumbers(ctx: CanvasRenderingContext2D, avoid: Box[]): Box[] {
    const t = this.track;
    const drawn: Box[] = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 10px "Archivo Variable", sans-serif';
    this.course.segments.forEach((seg, k) => {
      if (k !== 0 && (k + 1) % SEGMENT_NUMBER_EVERY !== 0) return;
      const from = k === 0 ? 0 : this.course.segments[k - 1].v;
      const mid = Math.round((from + seg.v) / 2) % t.n;
      const off = t.limit + 11 / this.cam.zoom;
      const p = this.cam.toScreen(t.x[mid] - t.nx[mid] * off, t.y[mid] - t.ny[mid] * off);
      const text = String(k + 1);
      const w = Math.max(18, ctx.measureText(text).width + 8);
      const box = { x: p.x - w / 2, y: p.y - 8, w, h: 16 };
      const hits = (o: Box) => box.x < o.x + o.w + 2 && o.x < box.x + box.w + 2 && box.y < o.y + o.h + 2 && o.y < box.y + box.h + 2;
      if (p.x < 0 || p.y < 0 || p.x > this.app.w || p.y > this.app.h || avoid.some(hits) || drawn.some(hits)) return;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#4b535d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000000';
      ctx.fillText(text, p.x, p.y + 0.5);
      drawn.push(box);
    });
    ctx.restore();
    return drawn;
  }

  /** On the whole lap, the time to find in the segments with the most, as labels that open them. */
  private drawGains(ctx: CanvasRenderingContext2D, tips: ShownTip[], badges: Box[] = []): void {
    const t = this.track;
    this.gainLabels = [];
    ctx.save();
    ctx.font = '800 12px "Archivo Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const h = 24;
    const items = tips.map((tip) => {
      const seg = this.course.segments[tip.segment];
      const from = tip.segment === 0 ? 0 : this.course.segments[tip.segment - 1].v;
      const mid = Math.round((from + seg.v) / 2) % t.n;
      const p = this.cam.toScreen(t.x[mid], t.y[mid]);
      const text = `Segment ${tip.segment + 1}: -${tipSeconds(tip)} s`;
      return { tip, text, x: p.x, y: p.y, w: ctx.measureText(text).width + 16, h };
    });
    // Never over one another; clear of the badges where there is room; on the
    // free part of the screen, between the top bar and the bottom bar.
    const bar = this.reviewBar.getBoundingClientRect();
    const bounds = { x: 8, y: 100, w: this.app.w - 16, h: (bar.height ? bar.top : this.app.h) - 8 - 100 };
    const spots = placeLabels(items, badges, bounds);
    items.forEach((it, i) => {
      const box = spots[i];
      if (!box) return;
      this.gainLabels.push({ ...box, segment: it.tip.segment });
      // A label pushed away from its segment points back at it.
      const cx = Math.max(box.x, Math.min(box.x + box.w, it.x));
      const cy = Math.max(box.y, Math.min(box.y + box.h, it.y));
      if (Math.hypot(cx - it.x, cy - it.y) > 14) {
        ctx.strokeStyle = '#ff8a00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(it.x, it.y);
        ctx.stroke();
        ctx.fillStyle = '#ff8a00';
        ctx.beginPath();
        ctx.arc(it.x, it.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (const g of this.gainLabels) {
      const it = items.find((x) => x.tip.segment === g.segment)!;
      // A stale tip (from before the latest change, still being checked) has a dashed edge.
      ctx.setLineDash(it.tip.stale ? [5, 4] : []);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ff8a00';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(g.x, g.y, g.w, g.h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = it.tip.stale ? '#4b535d' : '#000000';
      ctx.fillText(it.text, g.x + g.w / 2, g.y + g.h / 2 + 0.5);
    }
    ctx.restore();
  }

  /** The segment being picked, shaded on the asphalt. */
  private drawSegmentBand(ctx: CanvasRenderingContext2D, from: number, to: number, fill = 'rgba(155, 48, 255, 0.16)'): void {
    const t = this.track;
    const w = t.limit;
    ctx.beginPath();
    const left: { x: number; y: number }[] = [];
    let first = true;
    for (let i = 0; i < t.n; i++) {
      if (t.s[i] < from || t.s[i] > to) continue;
      const x = t.x[i] + t.nx[i] * w;
      const y = t.y[i] + t.ny[i] * w;
      if (first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      first = false;
      left.push({ x: t.x[i] - t.nx[i] * w, y: t.y[i] - t.ny[i] * w });
    }
    if (to >= t.length) left.push({ x: t.x[0] - t.nx[0] * w, y: t.y[0] - t.ny[0] * w });
    for (let i = left.length - 1; i >= 0; i--) ctx.lineTo(left[i].x, left[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** In the whole-lap view, a tick across the road at every segment boundary. */
  private drawBoundaries(ctx: CanvasRenderingContext2D): void {
    const t = this.track;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = Math.max(0.6, 1.4 / this.cam.zoom);
    ctx.beginPath();
    for (const s of this.course.segments) {
      const v = s.v % t.n;
      ctx.moveTo(t.x[v] + t.nx[v] * t.limit, t.y[v] + t.ny[v] * t.limit);
      ctx.lineTo(t.x[v] - t.nx[v] * t.limit, t.y[v] - t.ny[v] * t.limit);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** The three gates across the road where the segment ends: the armed one purple, the ones it can reach white. */
  private drawGates(ctx: CanvasRenderingContext2D, v: number): void {
    const t = this.track;
    const i = v % t.n;
    const z = this.cam.zoom;
    const options = this.options();
    // The end line across the road.
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([4 / z, 3 / z]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = Math.max(0.5, 1.6 / z);
    ctx.beginPath();
    ctx.moveTo(t.x[i] + t.nx[i] * t.limit, t.y[i] + t.ny[i] * t.limit);
    ctx.lineTo(t.x[i] - t.nx[i] * t.limit, t.y[i] - t.ny[i] * t.limit);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const lane of [-1, 0, 1] as Lane[]) {
      if (!options.includes(lane)) continue;
      const [g0, g1] = gate(t, lane);
      const gap = Math.min(0.5, (g1 - g0) * 0.12);
      const a = { x: t.x[i] + t.nx[i] * (g0 + gap), y: t.y[i] + t.ny[i] * (g0 + gap) };
      const b = { x: t.x[i] + t.nx[i] * (g1 - gap), y: t.y[i] + t.ny[i] * (g1 - gap) };
      const on = lane === this.armed;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.lineWidth = Math.max(3, (on ? 13 : 10) / z);
      ctx.stroke();
      ctx.strokeStyle = on ? INK : '#ffffff';
      ctx.lineWidth = Math.max(2, (on ? 9 : 6) / z);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Brake boards beside the track, upright on screen: 50 m steps before each turn-in that needs braking. */
  private drawBoards(ctx: CanvasRenderingContext2D): void {
    const t = this.track;
    const z = this.cam.zoom;
    if (z < 0.9) return;
    ctx.save();
    ctx.font = '800 11px "Archivo Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.course.segments.forEach((sec, k) => {
      if (sec.end !== 'board' || sec.corner === null) return;
      const c = this.course.corners[sec.corner];
      const i = sec.v % t.n;
      // On the outside of the corner it counts down to.
      const side = -c.dir;
      const off = t.limit + 2 + 16 / z;
      const p = this.cam.toScreen(t.x[i] + t.nx[i] * side * off, t.y[i] + t.ny[i] * side * off);
      if (p.x < -30 || p.y < -30 || p.x > this.app.w + 30 || p.y > this.app.h + 30) return;
      const near = !this.review && (k === this.cursor || k === this.cursor + 1 || k === this.cursor + 2);
      ctx.globalAlpha = this.review ? 0.75 : near ? 1 : 0.7;
      const w = 28;
      const h2 = 17;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(p.x - w / 2, p.y - h2 / 2, w, h2, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000000';
      ctx.fillText(String(sec.board), p.x, p.y + 0.5);
    });
    ctx.restore();
  }

  /** Where the line stands now: the start of the segment being picked. */
  private drawTip(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.track;
    const k = this.cursor;
    const v = k === 0 ? 0 : this.course.segments[k - 1].v % t.n;
    const a = k === 0 ? (this.picks.length ? this.offsets[0] : 0) : this.offsets[this.course.segments[k - 1].v] ?? 0;
    const p = this.cam.toScreen(t.x[v] + t.nx[v] * a, t.y[v] + t.ny[v] * a);
    const grow = Math.max(0, 1 - (now - this.pulse) / 500);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9 + grow * 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }

  destroy(): void {
    this.closed = true;
    this.closeCoach();
    this.unwatch?.();
    if (this.recoachTimer) clearTimeout(this.recoachTimer);
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.el.remove();
  }
}
