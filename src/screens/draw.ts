// Draw a lap. The map is zoomed so the track is a comfortable finger width and
// rotated so the road ahead points up the screen. Strokes draw exactly under
// the finger; when the tip runs out of room ahead, the map gently feeds forward
// (only while the finger moves, so it can never run away). Lifting the finger
// glides the camera on to frame the next section. Leaving the track deletes
// the lap.

import type { App, Screen } from '../app/app';
import { buzz, sfx, unlockAudio } from '../app/audio';
import { getSettings, saveSettings } from '../app/store';
import { Camera, angleForHeading, easeInOutCubic, lerpAngle } from '../render/camera';
import { INK, polyPath, strokeInk } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { LineBuilder, START_TOUCH_RANGE } from '../sim/builder';
import { UNITS_PER_METRE } from '../sim/path';
import { frameAt, projectNear, type Track } from '../sim/track';
import type { Compound } from '../sim/types';
import { ICONS, h, setText, tyreBadge } from '../ui/dom';

export interface DrawActions {
  complete(points: number[]): void;
  exit(): void;
}

interface CamState {
  cx: number;
  cy: number;
  zoom: number;
  angle: number;
  ay: number;
}

const TIP_GRAB_RADIUS = 58;
const PICKUP_EASE = 70;
/** Start warning when the line is this close (metres) to the edge of the track. */
const EDGE_WARN = 1.2;
const HINTS = {
  start: 'Put your finger on the chequered line and drag along the track.',
  drawing: 'Stay inside the white lines.',
  lifted: 'Lift whenever you like. Carry on from the purple tip.',
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
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniOutline: Path2D;
  private miniScale = 1;
  private miniOff = { x: 0, y: 0 };
  private flashUntil = 0;
  private failCard: HTMLElement | null = null;
  private stamp: HTMLElement | null = null;
  private tipPulse = 0;
  private strokes = 0;
  private finishedAt = 0;
  private backwardRun = 0;
  private pickup: { ox: number; oy: number; sx: number; sy: number } | null = null;
  private guidePath: Path2D | null = null;
  private warned = false;
  private listeners: [string, EventListener][] = [];

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    compound: Compound,
    private actions: DrawActions,
    guide: Float64Array | null = null,
  ) {
    this.builder = new LineBuilder(track);
    if (guide) this.guidePath = polyPath(guide);
    app.setCanvasVisible(true);
    this.zoom = this.drawZoom();

    this.hint = h('p', { class: 'draw-hint', role: 'status' }, HINTS.start);
    this.bar = h('i');
    this.pct = h('span', { class: 'draw-pct' }, '0%');
    this.undoBtn = h('button', { class: 'icon-btn', 'aria-label': 'Undo last stroke', html: ICONS.undo, onclick: () => this.undo() }) as HTMLButtonElement;
    this.mini = h('canvas', { class: 'minimap', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniOutline = this.buildMiniOutline();

    this.el = h(
      'div',
      { class: 'draw-hud' },
      h(
        'div',
        { class: 'strip strip-top' },
        h('button', { class: 'icon-btn', 'aria-label': 'Back to circuits', html: ICONS.close, onclick: () => this.actions.exit() }),
        h('div', { class: 'draw-title' }, h('strong', null, track.meta.short), h('span', null, 'Draw your lap')),
        h('span', { class: 'draw-tyre', html: tyreBadge(compound, 26) }),
      ),
      h('div', { class: 'draw-progress', role: 'progressbar', 'aria-label': 'Lap drawn' }, this.bar),
      this.mini,
      this.hint,
      h(
        'div',
        { class: 'strip strip-bottom' },
        this.undoBtn,
        this.pct,
        h('button', { class: 'icon-btn', 'aria-label': 'Start the lap again', html: ICONS.restart, onclick: () => this.restart() }),
      ),
    );
    app.root.append(this.el);
    this.resize();
    this.setCam(this.frameFor(0, this.startPoint()));
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
      angle: angleForHeading(hx, hy),
      ay: 0.55,
    };
  }

  private setCam(s: CamState): void {
    this.cam.cx = s.cx;
    this.cam.cy = s.cy;
    this.cam.zoom = s.zoom;
    this.cam.angle = s.angle;
    this.cam.ay = s.ay;
    this.cam.ax = 0.5;
  }

  private camState(): CamState {
    return { cx: this.cam.cx, cy: this.cam.cy, zoom: this.cam.zoom, angle: this.cam.angle, ay: this.cam.ay };
  }

  private glideTo(to: CamState, dur = 460): void {
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
    if (this.pointerId !== null || this.failCard || this.builder.status === 'done') return;
    unlockAudio();
    const p = this.local(e);
    this.glide = null;
    const w = this.cam.toWorld(p.x, p.y);
    if (this.builder.status === 'idle') {
      if (!this.builder.start(w.x, w.y)) {
        this.flashHint(HINTS.start);
        return;
      }
      sfx.penDown();
      buzz(8);
      this.pointerId = e.pointerId;
      this.drawing = true;
      this.strokes = 1;
      this.rebuildInk();
      this.app.canvas.setPointerCapture(e.pointerId);
      setText(this.hint, HINTS.drawing);
      return;
    }
    if (this.builder.status !== 'drawing') return;
    const tip = this.builder.lastPoint!;
    const ts = this.cam.toScreen(tip.x, tip.y);
    if (Math.hypot(ts.x - p.x, ts.y - p.y) > TIP_GRAB_RADIUS) {
      this.tipPulse = performance.now();
      this.flashHint(HINTS.grab);
      buzz([10, 40, 10]);
      return;
    }
    this.builder.beginStroke();
    this.strokes++;
    this.pointerId = e.pointerId;
    this.drawing = true;
    this.app.canvas.setPointerCapture(e.pointerId);
    sfx.penDown();
    // Magnetic pickup: the line carries on from the tip and eases onto the
    // finger over the first few dozen pixels instead of jumping to it.
    this.pickup = { ox: w.x - tip.x, oy: w.y - tip.y, sx: p.x, sy: p.y };
  }

  private onMove(e: PointerEvent): void {
    if (!this.drawing || e.pointerId !== this.pointerId) return;
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
    if (!this.drawing) return;
    this.drawing = false;
    if (this.builder.status === 'drawing') {
      sfx.lift();
      this.glideToTip();
      if (this.strokes === 1 && !getSettings().tutorialDone) setText(this.hint, HINTS.lifted);
      else if (this.builder.progress > this.track.length * 0.82) setText(this.hint, HINTS.closing);
      else setText(this.hint, this.strokes % 3 === 2 ? HINTS.width : HINTS.lifted);
    }
  }

  private feed(x: number, y: number): void {
    const before = this.builder.progress;
    const r = this.builder.extend(x, y);
    if (r !== 'backward' && r !== 'skip') this.backwardRun = 0;
    if (r === 'ok' || r === 'finish') {
      this.appendInk();
      const ds = this.builder.progress - before;
      if (r === 'ok' && ds > 0) this.conveyor(ds);
      if (r === 'finish') this.finish();
      this.updateHud();
    } else if (r === 'offtrack') {
      this.fail();
    } else if (r === 'backward') {
      this.backwardRun++;
      if (this.backwardRun > 8 && performance.now() - this.flashUntil > 1500) this.flashHint(HINTS.backward);
    }
  }

  /** Feed the map forward when the tip is running out of room ahead. */
  private conveyor(ds: number): void {
    const tip = this.builder.lastPoint!;
    const ts = this.cam.toScreen(tip.x, tip.y);
    const f = frameAt(this.track, this.builder.progress);
    const d = this.cam.dirToScreen(f.tx, f.ty);
    const top = 96, bottom = this.app.h - 110, left = 14, right = this.app.w - 14;
    let room = Infinity;
    if (d.x > 1e-3) room = Math.min(room, (right - ts.x) / d.x);
    if (d.x < -1e-3) room = Math.min(room, (left - ts.x) / d.x);
    if (d.y > 1e-3) room = Math.min(room, (bottom - ts.y) / d.y);
    if (d.y < -1e-3) room = Math.min(room, (top - ts.y) / d.y);
    const r0 = Math.min(this.app.w, this.app.h) * 0.42;
    if (room >= r0) return;
    const gain = 1.6 * (1 - Math.max(0, room) / r0);
    this.cam.cx += f.tx * ds * gain;
    this.cam.cy += f.ty * ds * gain;
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
    if (!this.builder.canUndo || this.drawing) return;
    sfx.tap();
    if (this.builder.undoStroke()) {
      this.rebuildInk();
      this.glideToTip();
      this.updateHud();
    }
  }

  private restart(): void {
    if (this.drawing) return;
    sfx.tap();
    this.failCard?.remove();
    this.failCard = null;
    this.builder.reset();
    this.ink = new Path2D();
    this.inkFrom = 0;
    this.strokes = 0;
    this.glideTo(this.frameFor(0, this.startPoint()), 600);
    setText(this.hint, HINTS.start);
    this.updateHud();
  }

  private fail(): void {
    this.drawing = false;
    this.pointerId = null;
    sfx.fail();
    buzz([30, 60, 90]);
    this.el.classList.add('is-failed');
    setTimeout(() => this.el.classList.remove('is-failed'), 500);
    const retry = h('button', { class: 'btn-primary', onclick: () => this.restart() }, 'Draw again');
    this.failCard = h(
      'div',
      { class: 'sheet fail-card', role: 'alertdialog', 'aria-labelledby': 'fail-title' },
      h('h2', { id: 'fail-title' }, 'Track limits'),
      h('p', null, 'Your line left the track, so the lap is deleted. Every lap has to stay inside the white lines.'),
      retry,
      h('button', { class: 'btn-quiet', onclick: () => this.actions.exit() }, 'Back to circuits'),
    );
    this.el.append(this.failCard);
    retry.focus();
    this.updateHud();
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
    setTimeout(() => this.actions.complete(pts), 750);
  }

  private flashHint(text: string): void {
    this.flashUntil = performance.now();
    setText(this.hint, text);
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
    g.strokeStyle = this.builder.status === 'failed' ? '#e10600' : INK;
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
    const z = this.drawZoom();
    if (Math.abs(z - this.zoom) > 1e-6) {
      this.zoom = z;
      this.cam.zoom = z;
    }
  }

  frame(now: number): void {
    if (this.glide) {
      const g = this.glide;
      const t = Math.min(1, (now - g.t0) / g.dur);
      const e = easeInOutCubic(t);
      this.cam.cx = g.from.cx + (g.to.cx - g.from.cx) * e;
      this.cam.cy = g.from.cy + (g.to.cy - g.from.cy) * e;
      this.cam.zoom = g.from.zoom + (g.to.zoom - g.from.zoom) * e;
      this.cam.angle = lerpAngle(g.from.angle, g.to.angle, e);
      this.cam.ay = g.from.ay + (g.to.ay - g.from.ay) * e;
      if (t >= 1) this.glide = null;
    }
    const { ctx } = this.app;
    const dpr = this.app.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cam.apply(ctx, dpr);
    this.art.draw(ctx, this.cam);

    const status = this.builder.status;
    if (this.guidePath && status !== 'failed') {
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
      strokeInk(ctx, this.ink, this.cam.zoom, status === 'failed' ? '#e10600' : INK);
    }
    if (status === 'drawing' && this.builder.progress > this.track.length * 0.7) this.drawStartMarker(ctx, now);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (status === 'drawing') this.drawTip(ctx, now);
    if (status === 'failed' && this.builder.failPoint) this.drawFail(ctx, now);
    if (status === 'done') this.drawDone(ctx, now);
    this.drawMini();
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

  private drawFail(ctx: CanvasRenderingContext2D, now: number): void {
    const f = this.builder.failPoint!;
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
    for (const [type, fn] of this.listeners) this.app.canvas.removeEventListener(type, fn);
    this.el.remove();
  }
}
