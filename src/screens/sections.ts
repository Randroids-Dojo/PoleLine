// Section by section: the lap is laid one section at a time. Each section
// runs to a brake board, a turn-in, an apex, an exit or on down a straight
// (src/app/sections.ts). For each one the player taps Left or Right to pick
// the third of the road (a gate) the line passes at its end, then Gas or
// Brake, which sets it and moves on. The line takes the smoothest way through
// the gates; the pedals become the brake zones the lap sim drives to. Once
// the lap is laid the whole circuit shows with the brake zones in red, any
// section can be tapped and changed, and Race runs it.

import type { App, Screen } from '../app/app';
import { buzz, sfx, unlockAudio } from '../app/audio';
import { getSettings, saveSettings, setTyre } from '../app/store';
import {
  courseFor,
  encodePicks,
  gate,
  laneOptions,
  laneSide,
  planPoints,
  sectionText,
  settleLanes,
  solveOffsets,
  startLane,
  type Course,
  type Lane,
  type Pedal,
  type Pick,
} from '../app/sections';
import { Camera, angleForHeading, easeInOutCubic, lerpAngle } from '../render/camera';
import { INK, strokeInk } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { LineBuilder } from '../sim/builder';
import { COMPOUND_SPECS } from '../sim/car';
import { projectGlobal, type Track } from '../sim/track';
import { COMPOUNDS, type Compound } from '../sim/types';
import { ICONS, h, setText, tyreBadge } from '../ui/dom';
import { openSettings } from './settings';
import type { Coach } from '../app/coach-client';
import { bestTips, tipAction, tipSeconds, type CoachReport, type Tip } from '../app/coach';

export interface SectionActions {
  /** Race the lap: its line (decimetres, flat [x, y, ...]), the tyre and the picks. */
  complete(points: number[], compound: Compound, picks: Pick[]): void;
  exit(): void;
}

interface CamState {
  cx: number;
  cy: number;
  zoom: number;
  angle: number;
}

/** Lessons, one at a time, each shown until the player has done it. */
const LESSONS = {
  gas: 'Tap Gas to drive this section.',
  brake: 'Tap Brake where you want to slow down.',
  lane: 'Left and Right pick your gate.',
  review: 'Tap any section to change it.',
} as const;
type Lesson = keyof typeof LESSONS;

const HINT_MS = 4200;
/** The whole lap labels the time to find in this many sections. */
const TIP_LABELS = 3;
/** Gain labels keep at least this far apart (px), more than a tap's slop around each. */
const LABEL_GAP = 14;
/** A tap that moves less than this (px) picks a section on the map. */
const TAP_SLOP = 10;
const BRAKE_RED = 'rgba(225, 6, 0, 0.62)';
/** The camera frames at most this much (metres) of a section, ending at its gate. */
const MAX_FRAME = 170;

const ARROW = {
  up: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5l7 9H5z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 19l7-9H5z" fill="currentColor"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12l9-7v14z" fill="currentColor"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19 12l-9-7v14z" fill="currentColor"/></svg>',
};

export class SectionScreen implements Screen {
  private course: Course;
  private cam = new Camera();
  private glide: { from: CamState; to: CamState; t0: number; dur: number } | null = null;
  private picks: Pick[] = [];
  /** The section being picked: picks.length while laying the lap, any section when changing one. */
  private cursor = 0;
  /** The lane the line will be in at the end of the cursor's section. */
  private armed: Lane = 0;
  /** The lap is laid and the whole circuit shows. */
  private review = false;
  private history: { picks: Pick[]; cursor: number; review: boolean }[] = [];
  private offsets: Float64Array = new Float64Array(1);
  /** The line so far (metres, one point per centreline vertex). */
  private points: { x: number; y: number }[] = [];
  private ink = new Path2D();
  private brakeInk = new Path2D();
  /** The cursor's section as the armed gate would lay it. */
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
  private laneBars: HTMLElement[] = [];
  private count: HTMLElement;
  private undoBtns: HTMLButtonElement[] = [];
  private doneBtn: HTMLButtonElement;
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
  private unwatch: (() => void) | null = null;
  /** Where the gain labels were drawn (px), so a tap on one opens its section. */
  private gainLabels: { x: number; y: number; w: number; h: number; section: number }[] = [];

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private compound: Compound,
    private actions: SectionActions,
    /** A plan to start from (changing the one just raced). */
    from: Pick[] | null = null,
    /** Where that plan lost time, being worked out (src/app/coach.ts). */
    coach: Coach | null = null,
  ) {
    this.course = courseFor(track);
    this.learnt = getSettings().sectionLessons;
    app.setCanvasVisible(true);
    for (let i = 0; i <= track.n; i++) {
      const k = i % track.n;
      if (i === 0) this.outline.moveTo(track.x[k], track.y[k]);
      else this.outline.lineTo(track.x[k], track.y[k]);
    }

    const key = (k: 'gas' | 'brake' | 'left' | 'right', icon: string, word: string, extra: HTMLElement | null = null) =>
      h('button', { class: `sec-key sec-${k}`, 'aria-label': word, onclick: () => this.press(k) }, h('span', { class: 'sec-arrow', html: icon }), h('b', null, word), extra) as HTMLButtonElement;
    this.leftSide = h('small', null, '');
    this.rightSide = h('small', null, '');
    this.keys = {
      gas: key('gas', ARROW.up, 'Gas'),
      brake: key('brake', ARROW.down, 'Brake'),
      left: key('left', ARROW.left, 'Left', this.leftSide),
      right: key('right', ARROW.right, 'Right', this.rightSide),
    };
    const lanes = h('div', { class: 'sec-lanes', 'aria-hidden': 'true' });
    for (let i = 0; i < 3; i++) {
      const b = h('i');
      this.laneBars.push(b);
      lanes.append(b);
    }
    const undo = () => h('button', { class: 'icon-btn sec-undo', 'aria-label': 'Undo', html: ICONS.undo, onclick: () => this.undo() }) as HTMLButtonElement;
    const restart = () => h('button', { class: 'icon-btn sec-restart', 'aria-label': 'Start the lap again', html: ICONS.restart, onclick: () => this.restart() }) as HTMLButtonElement;
    this.count = h('span', { class: 'sec-count' }, '');
    this.doneBtn = h('button', { class: 'sec-done', hidden: true, onclick: () => this.showReview() }, 'Whole lap') as HTMLButtonElement;
    const padUndo = undo();
    this.undoBtns.push(padUndo);
    this.pad = h(
      'div',
      { class: 'sec-pad', role: 'group', 'aria-label': 'Pick this section' },
      this.count,
      this.keys.gas,
      this.doneBtn,
      this.keys.left,
      lanes,
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
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings(this.app, () => {}) }),
      ),
      h('div', { class: 'draw-progress', role: 'progressbar', 'aria-label': 'Lap laid' }, this.bar),
      this.hint,
      this.pad,
      this.reviewBar,
    );
    app.root.append(this.el);
    this.cam.w = app.w;
    this.cam.h = app.h;

    if (from && from.length === this.course.sections.length) {
      this.picks = from.map((p) => ({ ...p }));
      this.cursor = this.picks.length;
      this.review = true;
    }
    this.solve(null);
    this.syncArmed();
    this.syncTyres();
    this.sync();
    this.setCam(this.review ? this.overviewFrame() : this.sectionFrame(this.cursor));
    this.teach();
    if (coach) {
      this.unwatch = coach.watch((r) => {
        this.report = r;
        this.sync();
      });
    }

    const c = app.canvas;
    this.listen(c, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(c, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(c, 'pointercancel', () => (this.down = null));
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent));
  }

  private listen(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  /** A lap is underway, so a stray back gesture should not throw it away. */
  get holdsWork(): boolean {
    return this.picks.length > 0 && !this.leaving;
  }

  /**
   * Tips from the analysis, while the plan and tyre are still the lap that was
   * raced: each gain is exact for that lap only (battery and tyres tie the
   * whole lap together), so any change hides them until the next race.
   */
  private tips(): Tip[] {
    const r = this.report;
    if (!r?.done || !this.asRaced()) return [];
    return bestTips(r);
  }

  /** The plan and tyre are the ones the analysis ran on. */
  private asRaced(): boolean {
    const r = this.report;
    return !!r && r.compound === this.compound && encodePicks(this.picks) === r.picks;
  }

  private tipFor(k: number): Tip | null {
    return this.tips().find((t) => t.section === k) ?? null;
  }

  /** Test hook: where things stand. */
  get state(): { cursor: number; total: number; picks: string; review: boolean; armed: Lane; startLane: Lane; coached: boolean; tips: (Tip & { action: string })[] } {
    return {
      coached: !!this.report?.done,
      tips: this.tips().map((t) => ({ ...t, action: tipAction(t) })),
      cursor: this.cursor,
      total: this.course.sections.length,
      picks: this.picks.map((p) => (p.pedal === 'gas' ? 'g' : 'b') + (p.lane < 0 ? 'l' : p.lane > 0 ? 'r' : 'm')).join(''),
      review: this.review,
      armed: this.armed,
      startLane: startLane(this.course, this.picks, this.cursor),
    };
  }

  // Picking ----------------------------------------------------------------

  private press(k: 'gas' | 'brake' | 'left' | 'right'): void {
    unlockAudio();
    if (this.review || this.leaving) return;
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
    return laneOptions(this.course, this.picks, this.cursor);
  }

  private commit(pedal: Pedal): void {
    const k = this.cursor;
    if (k >= this.course.sections.length) return;
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
    const whole = this.picks.length === this.course.sections.length;
    this.solve(appending && !whole ? prev : null);
    if (whole && appending && k === this.course.sections.length - 1) {
      this.lapLaid();
      return;
    }
    // Changing a laid lap walks on through the sections after the one changed.
    this.cursor = whole && k + 1 >= this.course.sections.length ? 0 : k + 1;
    if (whole && k + 1 >= this.course.sections.length) {
      this.showReview();
      return;
    }
    this.syncArmed();
    this.sync();
    this.glideTo(this.sectionFrame(this.cursor));
    this.teach();
  }

  private lapLaid(): void {
    sfx.lapDrawn();
    buzz(20);
    this.stamp?.remove();
    this.stamp = h('div', { class: 'stamp' }, 'Lap laid');
    this.el.append(this.stamp);
    const stamp = this.stamp;
    setTimeout(() => {
      stamp.remove();
      if (this.stamp === stamp) this.stamp = null;
    }, 1100);
    this.showReview();
  }

  private showReview(): void {
    if (this.picks.length !== this.course.sections.length) return;
    this.review = true;
    this.cursor = this.picks.length;
    this.preview = null;
    this.sync();
    this.glideTo(this.overviewFrame(), 700);
    this.teach();
  }

  /** Open a section of a laid lap (or any laid section) to change it. */
  private openSection(k: number): void {
    if (k < 0 || k > this.picks.length || k >= this.course.sections.length) return;
    if (k === this.cursor && !this.review) return;
    this.review = false;
    this.cursor = k;
    this.syncArmed();
    this.sync();
    this.glideTo(this.sectionFrame(k));
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
    // The section the undo reopens comes back with the gate it was set with.
    const undone = this.picks[last.cursor];
    this.picks = last.picks;
    this.cursor = last.cursor;
    this.review = last.review;
    this.solve(null);
    this.syncArmed(undone?.lane);
    this.sync();
    this.glideTo(this.review ? this.overviewFrame() : this.sectionFrame(this.cursor));
  }

  private restart(): void {
    if (!this.picks.length) return;
    this.remember();
    this.picks = [];
    this.cursor = 0;
    this.review = false;
    this.solve(null);
    this.syncArmed();
    this.sync();
    this.glideTo(this.sectionFrame(0), 600);
    this.say('Back to the start line. Undo brings your lap back.');
  }

  private pickTyre(c: Compound): void {
    this.compound = c;
    setTyre(this.track.meta.slug, c);
    sfx.tap();
    this.syncTyres();
    this.sync();
  }

  private syncTyres(): void {
    for (const b of this.tyreBtns) {
      const on = b.dataset.c === this.compound;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }

  private race(): void {
    if (this.leaving || this.picks.length !== this.course.sections.length) return;
    const b = new LineBuilder(this.track);
    const pts = this.points;
    let ok = b.start(pts[0].x, pts[0].y);
    for (let i = 1; ok && i < pts.length && b.status !== 'done'; i++) {
      const r = b.extend(pts[i].x, pts[i].y);
      if (r === 'offtrack' || r === 'backward') ok = false;
    }
    if (!ok || b.status !== 'done') {
      console.error('planned line is not a legal lap');
      this.say('That line does not make a lap. Change a section, or undo.');
      sfx.fail();
      return;
    }
    this.leaving = true;
    saveSettings({ tutorialDone: true });
    this.actions.complete(b.points.slice(), this.compound, this.picks.map((p) => ({ ...p })));
  }

  // The line ------------------------------------------------------------------

  /** Solve the line for the picks so far (re-solving only the end when `prev` is the line before one more section). */
  private solve(prev: Float64Array | null): void {
    this.offsets = solveOffsets(this.track, this.course, this.picks, prev);
    this.points = this.picks.length ? planPoints(this.track, this.course, this.picks, this.offsets) : [];
    this.ink = new Path2D();
    this.brakeInk = new Path2D();
    const pts = this.points;
    pts.forEach((p, i) => (i ? this.ink.lineTo(p.x, p.y) : this.ink.moveTo(p.x, p.y)));
    let from = 0;
    this.course.sections.forEach((sec, k) => {
      if (k < this.picks.length && this.picks[k].pedal === 'brake') {
        for (let q = from; q <= sec.v && q < pts.length; q++) {
          if (q === from) this.brakeInk.moveTo(pts[q].x, pts[q].y);
          else this.brakeInk.lineTo(pts[q].x, pts[q].y);
        }
      }
      from = sec.v;
    });
  }

  /** The cursor's section as the armed gate would lay it, dashed until it is set. */
  private updatePreview(): void {
    this.preview = null;
    if (this.review) return;
    const k = this.cursor;
    const sec = this.course.sections[k];
    if (!sec) return;
    const trial = this.picks.map((p) => ({ ...p }));
    const pedal = trial[k]?.pedal ?? 'gas';
    if (k === trial.length) trial.push({ pedal, lane: this.armed });
    else {
      trial[k] = { pedal, lane: this.armed };
      settleLanes(this.course, trial, k);
    }
    const whole = trial.length === this.course.sections.length;
    const off = solveOffsets(this.track, this.course, trial, k === this.picks.length && !whole ? this.offsets : null);
    const t = this.track;
    const a = k === 0 ? 0 : this.course.sections[k - 1].v;
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
    const total = this.course.sections.length;
    const sec = this.course.sections[this.cursor];
    const laid = this.picks.length;
    this.bar.style.transform = `scaleX(${laid / total})`;
    const coaching = this.report && !this.report.done && this.asRaced();
    const tipped = this.tips().length > 0;
    const changed = this.report && !this.asRaced();
    setText(
      this.subtitle,
      this.review
        ? coaching
          ? 'Lap laid. Finding where it lost time'
          : tipped
            ? 'Tap an orange section to find time'
            : changed
              ? 'Race it to find where it loses time'
              : 'Lap laid. Tap a section to change it'
        : sec
          ? `${this.cursor + 1} of ${total}. ${sectionText(sec)}`
          : '',
    );
    setText(this.count, sec ? `${this.cursor + 1}/${total}` : '');
    this.pad.hidden = this.review;
    this.reviewBar.hidden = !this.review;
    this.el.classList.toggle('is-review', this.review);
    this.doneBtn.hidden = this.review || laid !== total;
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
    // Inside or outside of the corner this section belongs to.
    const side = (lane: Lane) => {
      const s = laneSide(this.course, sec, lane);
      return s > 0 ? 'inside' : s < 0 ? 'outside' : '';
    };
    setText(this.leftSide, side(-1));
    setText(this.rightSide, side(1));
    const from = startLane(this.course, this.picks, this.cursor);
    this.laneBars.forEach((b, j) => {
      const lane = (j - 1) as Lane;
      b.className = lane === this.armed ? 'is-armed' : options.includes(lane) ? 'is-open' : '';
      b.classList.toggle('is-from', lane === from);
    });
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
    saveSettings({ sectionLessons: this.learnt });
  }

  /** The next lesson, when the moment for it comes: gas first, brake at the first board, gates at the first corner. */
  private teach(): void {
    const sec = this.course.sections[this.cursor];
    if (this.review) {
      if (!this.learned('review')) this.say(LESSONS.review, 6000);
      return;
    }
    if (!sec) return;
    if (!this.learned('gas')) return this.say(LESSONS.gas, 8000);
    if (!this.learned('brake') && sec.end === 'board') return this.say(LESSONS.brake, 8000);
    if (!this.learned('lane') && this.learned('brake') && (sec.end === 'turn' || sec.end === 'in' || sec.end === 'apex' || sec.end === 'out' || sec.end === 'exit')) return this.say(LESSONS.lane, 8000);
    // A section the last lap lost time in says what would win it back.
    const tip = this.tipFor(this.cursor);
    if (tip) return this.say(`${tipAction(tip)} here: ${tipSeconds(tip)} s quicker.`, 6000);
    // Nothing to teach here: a lesson still showing from the last section has had its moment.
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
    // A gain label opens its section.
    const inside = (b: { x: number; y: number; w: number; h: number }, pad: number) => sx >= b.x - pad && sx <= b.x + b.w + pad && sy >= b.y - pad && sy <= b.y + b.h + pad;
    const label = this.review ? (this.gainLabels.find((b) => inside(b, 0)) ?? this.gainLabels.find((b) => inside(b, 6))) : undefined;
    if (label) {
      this.openSection(label.section);
      return;
    }
    const w = this.cam.toWorld(sx, sy);
    const p = projectGlobal(this.track, w.x, w.y);
    // A finger's width off the road still counts, however far out the map is.
    if (p.dist > this.track.limit + 22 / this.cam.zoom) return;
    const k = this.course.sections.findIndex((s) => p.s >= s.from && p.s < s.to);
    if (k < 0) return;
    // Laid sections and the next one can be opened.
    if (k <= this.picks.length) this.openSection(k);
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
   * Frame a section with the road just past it (enough to see the corner it
   * leads to), turned so the road runs up the screen.
   */
  private sectionFrame(k: number): CamState {
    const t = this.track;
    const sec = this.course.sections[Math.min(k, this.course.sections.length - 1)];
    // A long section shows its last stretch: the gate and the brake boards are what matter.
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

  private overviewFrame(): CamState {
    const t = this.track;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < t.n; i++) {
      minX = Math.min(minX, t.x[i]);
      maxX = Math.max(maxX, t.x[i]);
      minY = Math.min(minY, t.y[i]);
      maxY = Math.max(maxY, t.y[i]);
    }
    const { top, bottom } = this.safeArea();
    const zoom = Math.min((this.app.w - 36) / (maxX - minX + 40), (bottom - top) / (maxY - minY + 40));
    const shift = ((top + bottom) / 2 - this.app.h / 2) / zoom;
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 - shift, zoom, angle: 0 };
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
    this.setCam(this.review ? this.overviewFrame() : this.sectionFrame(this.cursor));
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
    const sec = this.course.sections[this.cursor];
    if (sec && !this.review) this.drawSectionBand(ctx, sec.from, sec.to);
    const tips = this.review ? this.tips() : [];
    if (tips.length) this.drawLosses(ctx, tips);
    if (this.review) this.drawBoundaries(ctx);
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
    if (sec && !this.review) this.drawTip(ctx, now);
    if (tips.length) this.drawGains(ctx, tips.slice(0, TIP_LABELS));
    else this.gainLabels = [];
  }

  /**
   * On the whole lap, the sections that lost time: a wide orange band under
   * the line, stronger the more there is to find, wide enough to see with the
   * whole circuit on screen.
   */
  private drawLosses(ctx: CanvasRenderingContext2D, tips: Tip[]): void {
    const t = this.track;
    const z = this.cam.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(t.limit * 2.2, 26 / z);
    for (const tip of tips) {
      const sec = this.course.sections[tip.section];
      const from = tip.section === 0 ? 0 : this.course.sections[tip.section - 1].v;
      ctx.beginPath();
      for (let q = from; q <= sec.v; q++) {
        const v = q % t.n;
        if (q === from) ctx.moveTo(t.x[v], t.y[v]);
        else ctx.lineTo(t.x[v], t.y[v]);
      }
      ctx.strokeStyle = `rgba(255, 138, 0, ${(0.45 + 0.5 * Math.min(1, tip.gain / 300)).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** On the whole lap, the time to find in the sections with the most, as labels that open them. */
  private drawGains(ctx: CanvasRenderingContext2D, tips: Tip[]): void {
    const t = this.track;
    this.gainLabels = [];
    ctx.save();
    ctx.font = '800 12px "Archivo Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tip of tips) {
      const sec = this.course.sections[tip.section];
      const from = tip.section === 0 ? 0 : this.course.sections[tip.section - 1].v;
      const mid = Math.round((from + sec.v) / 2) % t.n;
      const p = this.cam.toScreen(t.x[mid], t.y[mid]);
      const text = `-${tipSeconds(tip)} s`;
      const w = ctx.measureText(text).width + 16;
      const h2 = 24;
      // Above the section, or clear of a label already there.
      let box = { x: p.x - w / 2, y: p.y - h2 - 10, w, h: h2, section: tip.section };
      for (const dy of [0, h2 + 26, -(h2 + LABEL_GAP), 2 * h2 + 40, -(2 * h2 + 2 * LABEL_GAP)]) {
        const trial = { ...box, y: p.y - h2 - 10 + dy };
        if (!this.gainLabels.some((o) => trial.x < o.x + o.w + LABEL_GAP && o.x < trial.x + trial.w + LABEL_GAP && trial.y < o.y + o.h + LABEL_GAP && o.y < trial.y + trial.h + LABEL_GAP)) {
          box = trial;
          break;
        }
      }
      this.gainLabels.push(box);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ff8a00';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000000';
      ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 0.5);
    }
    ctx.restore();
  }

  /** The section being picked, shaded on the asphalt. */
  private drawSectionBand(ctx: CanvasRenderingContext2D, from: number, to: number, fill = 'rgba(155, 48, 255, 0.16)'): void {
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

  /** In the whole-lap view, a tick across the road at every section boundary. */
  private drawBoundaries(ctx: CanvasRenderingContext2D): void {
    const t = this.track;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = Math.max(0.6, 1.4 / this.cam.zoom);
    ctx.beginPath();
    for (const s of this.course.sections) {
      const v = s.v % t.n;
      ctx.moveTo(t.x[v] + t.nx[v] * t.limit, t.y[v] + t.ny[v] * t.limit);
      ctx.lineTo(t.x[v] - t.nx[v] * t.limit, t.y[v] - t.ny[v] * t.limit);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** The three gates across the road where the section ends: the armed one purple, the ones it can reach white. */
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
    this.course.sections.forEach((sec, k) => {
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

  /** Where the line stands now: the start of the section being picked. */
  private drawTip(ctx: CanvasRenderingContext2D, now: number): void {
    const t = this.track;
    const k = this.cursor;
    const v = k === 0 ? 0 : this.course.sections[k - 1].v % t.n;
    const a = k === 0 ? (this.picks.length ? this.offsets[0] : 0) : this.offsets[this.course.sections[k - 1].v] ?? 0;
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
    this.unwatch?.();
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.el.remove();
  }
}
