// Overhead circuit artwork drawn straight from the centreline: striped grass
// or city blocks, run-off, white lines, red/white kerbs on every corner, the
// chequered start/finish and the grid boxes. Geometry is chunked into Path2D
// pieces with bounding boxes so only what is on screen gets stroked.

import type { Camera } from './camera';
import { frameAt, type Track } from '../sim/track';

export interface Palette {
  ground: string;
  groundAlt: string;
  wall: string;
  runoff: string;
  runoffWidth: number;
  wallWidth: number;
  asphalt: string;
  asphaltSpeck: string;
  line: string;
  kerbRed: string;
  kerbWhite: string;
  street: boolean;
  night: boolean;
}

export function paletteFor(track: Track): Palette {
  const { street, night } = track.meta;
  if (street) {
    return night
      ? { ground: '#202329', groundAlt: '#262a31', wall: '#8d949d', runoff: '#2f333a', runoffWidth: 1.4, wallWidth: 2.1, asphalt: '#2c2f35', asphaltSpeck: '#3b3f47', line: '#eef1f6', kerbRed: '#c8202a', kerbWhite: '#e9edf2', street, night }
      : { ground: '#8c9097', groundAlt: '#82868d', wall: '#e4e6e9', runoff: '#55595f', runoffWidth: 1.4, wallWidth: 2.1, asphalt: '#3d4046', asphaltSpeck: '#4b4f56', line: '#f7f7f4', kerbRed: '#d6262d', kerbWhite: '#f6f6f3', street, night };
  }
  return night
    ? { ground: '#1d3426', groundAlt: '#1a2f22', wall: '#14171b', runoff: '#3a3f46', runoffWidth: 10, wallWidth: 10.8, asphalt: '#2d3036', asphaltSpeck: '#3a3e45', line: '#eef1f6', kerbRed: '#c8202a', kerbWhite: '#e9edf2', street, night }
    : { ground: '#4d7a37', groundAlt: '#456f31', wall: '#24272b', runoff: '#80868d', runoffWidth: 10, wallWidth: 10.8, asphalt: '#43464c', asphaltSpeck: '#52565d', line: '#f7f7f4', kerbRed: '#d6262d', kerbWhite: '#f6f6f3', street, night };
}

interface Chunk {
  path: Path2D;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Kerb extends Chunk {}

const CHUNK = 40;

function noisePattern(ctx: CanvasRenderingContext2D, base: string, speck: string, size: number, metres: number, rot = 0): CanvasPattern | string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return base;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.fillStyle = speck;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size * 0.18; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.5;
    g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1);
  }
  const p = ctx.createPattern(c, 'repeat');
  if (!p) return base;
  const m = new DOMMatrix().rotateSelf((rot * 180) / Math.PI).scaleSelf(metres / size, metres / size);
  p.setTransform(m);
  return p;
}

function stripePattern(ctx: CanvasRenderingContext2D, a: string, b: string, metres: number, rot: number): CanvasPattern | string {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return a;
  g.fillStyle = a;
  g.fillRect(0, 0, size, size / 2);
  g.fillStyle = b;
  g.fillRect(0, size / 2, size, size / 2);
  let seed = 98765;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size * 0.12; i++) {
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1);
  }
  const p = ctx.createPattern(c, 'repeat');
  if (!p) return a;
  p.setTransform(new DOMMatrix().rotateSelf((rot * 180) / Math.PI).scaleSelf(metres / size, metres / size));
  return p;
}

function blockPattern(ctx: CanvasRenderingContext2D, a: string, b: string, metres: number): CanvasPattern | string {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return a;
  g.fillStyle = a;
  g.fillRect(0, 0, size, size);
  g.fillStyle = b;
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size);
    const w = 20 + Math.floor(rnd() * 60), h = 20 + Math.floor(rnd() * 60);
    g.fillRect(x, y, w, h);
    g.fillRect(x - size, y, w, h);
    g.fillRect(x, y - size, w, h);
  }
  const p = ctx.createPattern(c, 'repeat');
  if (!p) return a;
  p.setTransform(new DOMMatrix().rotateSelf(17).scaleSelf(metres / size, metres / size));
  return p;
}

export class TrackArt {
  readonly track: Track;
  readonly palette: Palette;
  private chunks: Chunk[] = [];
  private kerbs: Kerb[] = [];
  private sfWhite = new Path2D();
  private sfBlack = new Path2D();
  private grid = new Path2D();
  private groundFill: CanvasPattern | string;
  private asphaltFill: CanvasPattern | string;
  readonly outline: Path2D;

  constructor(track: Track, ctx: CanvasRenderingContext2D) {
    this.track = track;
    this.palette = paletteFor(track);
    const p = this.palette;
    this.groundFill = p.street ? blockPattern(ctx, p.ground, p.groundAlt, 160) : stripePattern(ctx, p.ground, p.groundAlt, 36, 0.35);
    this.asphaltFill = noisePattern(ctx, p.asphalt, p.asphaltSpeck, 96, 9);
    this.buildChunks();
    this.buildKerbs();
    this.buildStart();
    const o = new Path2D();
    for (let i = 0; i < track.n; i++) {
      if (i === 0) o.moveTo(track.x[i], track.y[i]);
      else o.lineTo(track.x[i], track.y[i]);
    }
    o.closePath();
    this.outline = o;
  }

  private buildChunks(): void {
    const t = this.track;
    for (let start = 0; start < t.n; start += CHUNK) {
      const path = new Path2D();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let k = 0; k <= CHUNK; k++) {
        const raw = start + k;
        const i = raw % t.n;
        const x = t.x[i], y = t.y[i];
        if (k === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (raw >= t.n) break;
      }
      this.chunks.push({ path, minX, minY, maxX, maxY });
    }
  }

  private buildKerbs(): void {
    const t = this.track;
    const n = t.n;
    const k = new Float64Array(n);
    const span = 4;
    for (let i = 0; i < n; i++) {
      const a = (i - span + n) % n, c = (i + span) % n;
      const abx = t.x[i] - t.x[a], aby = t.y[i] - t.y[a];
      const bcx = t.x[c] - t.x[i], bcy = t.y[c] - t.y[i];
      const cax = t.x[a] - t.x[c], cay = t.y[a] - t.y[c];
      const den = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cax, cay);
      k[i] = den > 0 ? (2 * (abx * bcy - aby * bcx)) / den : 0;
    }
    const threshold = 1 / 160;
    const zones: { a: number; b: number; sign: number }[] = [];
    let i = 0;
    // Start scanning from a straight bit so zones never straddle the wrap.
    let origin = 0;
    for (let j = 0; j < n; j++) if (Math.abs(k[j]) < threshold / 2) { origin = j; break; }
    while (i < n) {
      const idx = (origin + i) % n;
      if (Math.abs(k[idx]) >= threshold) {
        const sign = Math.sign(k[idx]);
        let j = i;
        while (j < n && Math.abs(k[(origin + j) % n]) >= threshold * 0.7 && Math.sign(k[(origin + j) % n]) === sign) j++;
        zones.push({ a: origin + i, b: origin + j, sign });
        i = j + 1;
      } else i++;
    }
    const inset = this.track.half - 0.6;
    const add = (a: number, b: number, side: number) => {
      const path = new Path2D();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let s = a; s <= b; s++) {
        const q = ((s % n) + n) % n;
        const x = t.x[q] + t.nx[q] * side * inset;
        const y = t.y[q] + t.ny[q] * side * inset;
        if (s === a) path.moveTo(x, y);
        else path.lineTo(x, y);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      this.kerbs.push({ path, minX, minY, maxX, maxY });
    };
    for (const z of zones) {
      if (z.b - z.a < 3) continue;
      add(z.a - 6, z.b + 4, z.sign);
      const mid = Math.floor((z.a + z.b) / 2);
      add(mid, z.b + 14, -z.sign);
    }
  }

  private buildStart(): void {
    const t = this.track;
    const f = frameAt(t, 0);
    const half = t.half;
    const quad = (path: Path2D, s0: number, s1: number, d0: number, d1: number) => {
      const p = (s: number, d: number) => [f.x + f.tx * s + f.nx * d, f.y + f.ty * s + f.ny * d];
      const a = p(s0, d0), b = p(s1, d0), c = p(s1, d1), e = p(s0, d1);
      path.moveTo(a[0], a[1]);
      path.lineTo(b[0], b[1]);
      path.lineTo(c[0], c[1]);
      path.lineTo(e[0], e[1]);
      path.closePath();
    };
    quad(this.sfWhite, -1, 1, -half, half);
    const cell = 1;
    let row = 0;
    for (let s = -1; s < 1; s += cell, row++) {
      let col = 0;
      for (let d = -half; d < half - 1e-6; d += cell, col++) {
        if ((row + col) % 2 === 0) quad(this.sfBlack, s, s + cell, d, Math.min(half, d + cell));
      }
    }
    // Staggered grid boxes behind the line.
    for (let k = 0; k < 20; k++) {
      const s = -10 - k * 8;
      const fr = frameAt(t, s);
      const side = k % 2 === 0 ? -1 : 1;
      const dc = side * half * 0.45;
      const w = Math.min(2.4, half * 0.7);
      const pt = (ds: number, dd: number) => [fr.x + fr.tx * ds + fr.nx * (dc + dd), fr.y + fr.ty * ds + fr.ny * (dc + dd)];
      const a = pt(-1.2, -w / 2), b = pt(0, -w / 2), c = pt(0, w / 2), e = pt(-1.2, w / 2);
      this.grid.moveTo(a[0], a[1]);
      this.grid.lineTo(b[0], b[1]);
      this.grid.lineTo(c[0], c[1]);
      this.grid.lineTo(e[0], e[1]);
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const t = this.track;
    const p = this.palette;
    const b = cam.bounds(4);
    ctx.save();
    ctx.fillStyle = this.groundFill;
    ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pad = t.half + p.wallWidth + 2;
    const vis = this.chunks.filter((c) => c.maxX + pad >= b.minX && c.minX - pad <= b.maxX && c.maxY + pad >= b.minY && c.minY - pad <= b.maxY);
    const stroke = (style: string | CanvasPattern, width: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (const c of vis) ctx.stroke(c.path);
    };
    stroke(p.wall, t.meta.width + p.wallWidth * 2);
    stroke(p.runoff, t.meta.width + p.runoffWidth * 2);
    if (!p.street) stroke(p.night ? '#2a6b4a' : '#3c8a5c', t.meta.width + 3.2);
    stroke(p.line, t.meta.width + 0.7);
    stroke(this.asphaltFill, t.meta.width);

    const kpad = 2;
    ctx.lineCap = 'butt';
    for (const k of this.kerbs) {
      if (k.maxX + kpad < b.minX || k.minX - kpad > b.maxX || k.maxY + kpad < b.minY || k.minY - kpad > b.maxY) continue;
      ctx.setLineDash([]);
      ctx.strokeStyle = p.kerbWhite;
      ctx.lineWidth = 1.15;
      ctx.stroke(k.path);
      ctx.setLineDash([1.6, 1.6]);
      ctx.strokeStyle = p.kerbRed;
      ctx.stroke(k.path);
    }
    ctx.setLineDash([]);

    ctx.fillStyle = '#f6f6f3';
    ctx.fill(this.sfWhite);
    ctx.fillStyle = '#16181b';
    ctx.fill(this.sfBlack);
    ctx.strokeStyle = 'rgba(246,246,243,0.85)';
    ctx.lineWidth = 0.22;
    ctx.stroke(this.grid);
    ctx.restore();
  }
}
