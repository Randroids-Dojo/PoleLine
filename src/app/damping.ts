// Corner damping for continuous scrolling: how much to slow the map's forward
// feed near corners. Everything is precomputed per circuit from centreline
// curvature, then looked up by the tip's lap progress. Display only; it never
// touches the simulation.

import type { Track } from '../sim/track';

export type CornerDamping = 'off' | 'gentle' | 'early' | 'hold' | 'pace';

export const CORNER_DAMPING_OPTIONS: { id: CornerDamping; label: string; detail: string }[] = [
  { id: 'off', label: 'Off', detail: 'Same scroll speed everywhere.' },
  { id: 'gentle', label: 'Gentle', detail: 'Eases off a little in proportion to how tight the corner under your tip is.' },
  { id: 'early', label: 'Brake early', detail: 'Looks 70 m ahead and slows before corners, like a braking zone, then picks up on the exit.' },
  { id: 'hold', label: 'Corner hold', detail: 'Almost stops through corners so you can place the apex. Full speed on the straights.' },
  { id: 'pace', label: 'Racing pace', detail: 'Follows how fast a car would take each part of the track.' },
];

const LOOK_AHEAD = 70;
const SMOOTH = 5;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class CornerDamper {
  private n: number;
  private step: number;
  /** Corner intensity 0 (straight) .. 1 (hairpin) per centreline vertex. */
  private corner: Float64Array;
  /** Reference car speed as a fraction of top speed per vertex. */
  private pace: Float64Array;

  constructor(private track: Track) {
    const n = track.n;
    this.n = n;
    this.step = track.length / n;
    const k = new Float64Array(n);
    const span = 5;
    for (let i = 0; i < n; i++) {
      const a = (i - span + n) % n, c = (i + span) % n;
      const abx = track.x[i] - track.x[a], aby = track.y[i] - track.y[a];
      const bcx = track.x[c] - track.x[i], bcy = track.y[c] - track.y[i];
      const cax = track.x[a] - track.x[c], cay = track.y[a] - track.y[c];
      const den = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cax, cay);
      k[i] = den > 0 ? Math.abs((2 * (abx * bcy - aby * bcx)) / den) : 0;
    }
    const ks = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -SMOOTH; d <= SMOOTH; d++) sum += k[(i + d + n) % n];
      ks[i] = sum / (SMOOTH * 2 + 1);
    }
    // Intensity: ignore gentle bends, saturate around a 20 m radius.
    this.corner = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = ks[i] / (ks[i] + 1 / 90);
      this.corner[i] = Math.max(0, Math.min(1, (c - 0.15) / 0.7));
    }
    // Reference speed: lateral grip limit, then braking and acceleration passes.
    const vTop = 90;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(vTop, Math.sqrt(30 / Math.max(ks[i], 1e-6)));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * 11 * this.step));
      }
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * 40 * this.step));
      }
    }
    this.pace = new Float64Array(n);
    for (let i = 0; i < n; i++) this.pace[i] = v[i] / vTop;
  }

  private index(s: number): number {
    const L = this.track.length;
    let w = s % L;
    if (w < 0) w += L;
    return Math.min(this.n - 1, Math.floor(w / this.step));
  }

  private intensity(s: number): number {
    return this.corner[this.index(s)];
  }

  /** Scroll speed multiplier at lap progress s for a damping mode (1 means no change). */
  factor(mode: CornerDamping, s: number): number {
    switch (mode) {
      case 'gentle':
        return 1 - 0.5 * this.intensity(s);
      case 'early': {
        let worst = 0;
        for (let d = 0; d <= LOOK_AHEAD; d += this.step * 2) {
          worst = Math.max(worst, this.intensity(s + d) * (1 - (0.45 * d) / LOOK_AHEAD));
        }
        return Math.max(0.2, 1 - 0.78 * worst);
      }
      case 'hold': {
        let worst = 0;
        for (let d = -6; d <= 14; d += this.step) worst = Math.max(worst, this.intensity(s + d));
        return Math.max(0.1, 1 - 0.9 * smoothstep(0.25, 0.55, worst));
      }
      case 'pace':
        return Math.max(0.15, this.pace[this.index(s)]);
      default:
        return 1;
    }
  }
}
