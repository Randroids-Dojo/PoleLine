// Compass rose for the draw screen. The card turns with the map so N always
// points at real north. Tap it to step the top of the screen through north,
// east, south and west; drag it round to rotate the map to any angle. The
// Auto pill shows (and toggles) whether the map follows the track on its own.

import { h } from './dom';

export interface CompassHandlers {
  tap(): void;
  dragStart(): void;
  drag(delta: number): void;
  toggleAuto(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LETTERS: [string, number, number][] = [
  ['N', 0, -31],
  ['E', 31, 0],
  ['S', 0, 31],
  ['W', -31, 0],
];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export class Compass {
  readonly el: HTMLElement;
  private card: SVGGElement;
  private letters: SVGTextElement[] = [];
  private autoBtn: HTMLButtonElement;
  private angle = NaN;
  private drag: { id: number; cx: number; cy: number; last: number; startX: number; startY: number; moving: boolean } | null = null;

  constructor(private handlers: CompassHandlers) {
    const svg = el('svg', { viewBox: '-50 -50 100 100', class: 'compass-rose', 'aria-hidden': 'true' });
    svg.append(el('circle', { r: 47, class: 'compass-face' }));
    this.card = el('g', {});
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const long = i % 4 === 0;
      const r0 = long ? 38 : 41;
      this.card.append(el('line', { x1: Math.sin(a) * r0, y1: -Math.cos(a) * r0, x2: Math.sin(a) * 45, y2: -Math.cos(a) * 45, class: long ? 'compass-tick is-major' : 'compass-tick' }));
    }
    this.card.append(el('path', { d: 'M0 -24 L7 0 L-7 0 Z', class: 'compass-north' }));
    this.card.append(el('path', { d: 'M0 24 L7 0 L-7 0 Z', class: 'compass-south' }));
    for (const [t, x, y] of LETTERS) {
      const text = el('text', { x, y: y + 5.5, class: t === 'N' ? 'compass-letter is-north' : 'compass-letter', 'text-anchor': 'middle' });
      text.textContent = t;
      this.letters.push(text);
      this.card.append(text);
    }
    svg.append(this.card, el('circle', { r: 4.5, class: 'compass-pin' }));

    const rose = h('button', { class: 'compass-btn', 'aria-label': 'Compass. Tap to turn north, east, south or west to the top. Drag to rotate the map.' });
    rose.append(svg);
    rose.addEventListener('pointerdown', (e) => this.down(e as PointerEvent, rose));
    rose.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
    rose.addEventListener('pointerup', (e) => this.up(e as PointerEvent));
    rose.addEventListener('pointercancel', (e) => this.up(e as PointerEvent));
    rose.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        this.handlers.tap();
      }
    });

    this.autoBtn = h('button', { class: 'compass-auto', 'aria-pressed': 'true', onclick: () => this.handlers.toggleAuto() }, h('i', { 'aria-hidden': 'true' }), 'Auto') as HTMLButtonElement;
    this.el = h('div', { class: 'compass' }, rose, this.autoBtn);
  }

  /** Map rotation in radians (the camera angle). */
  setAngle(a: number): void {
    if (Math.abs(a - this.angle) < 1e-4) return;
    this.angle = a;
    const deg = (a * 180) / Math.PI;
    this.card.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
    LETTERS.forEach(([, x, y], i) => this.letters[i].setAttribute('transform', `rotate(${(-deg).toFixed(2)} ${x} ${y})`));
  }

  setAuto(on: boolean): void {
    this.autoBtn.classList.toggle('is-on', on);
    this.autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.autoBtn.setAttribute('aria-label', on ? 'Auto-rotate is on. Tap to keep the map still.' : 'Auto-rotate is off. Tap to let the map follow the track.');
  }

  private down(e: PointerEvent, target: HTMLElement): void {
    if (this.drag) return;
    e.preventDefault();
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    target.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, cx, cy, last: Math.atan2(e.clientY - cy, e.clientX - cx), startX: e.clientX, startY: e.clientY, moving: false };
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moving && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    if (!d.moving) {
      d.moving = true;
      this.handlers.dragStart();
    }
    const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
    let delta = a - d.last;
    if (delta > Math.PI) delta -= Math.PI * 2;
    else if (delta < -Math.PI) delta += Math.PI * 2;
    d.last = a;
    if (delta) this.handlers.drag(delta);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moving && e.type === 'pointerup') this.handlers.tap();
  }
}

/** Bearing (degrees clockwise from north) that sits at the top of the screen for a camera angle. */
export function bearingAtTop(angle: number): number {
  const deg = (-angle * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** The next cardinal bearing clockwise from the current one. */
export function nextCardinal(bearing: number): number {
  for (const c of [90, 180, 270, 360]) if (c > bearing + 1) return c % 360;
  return 90;
}

/** Camera angle that puts a bearing at the top of the screen. */
export function angleForBearing(bearing: number): number {
  return (-bearing * Math.PI) / 180;
}
