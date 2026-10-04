// Racing line strokes: the purple "ink" while drawing, and a speed-coloured
// trace for the results map.

export const INK = '#9b30ff';
export const INK_CORE = '#f3e8ff';

/** Stroke a polyline given as flat [x, y, ...] in metres. */
export function polyPath(pts: ArrayLike<number>, scale = 1, from = 0, to?: number): Path2D {
  const p = new Path2D();
  const n = pts.length / 2;
  const end = to === undefined ? n : Math.min(n, to);
  for (let i = from; i < end; i++) {
    const x = pts[i * 2] * scale;
    const y = pts[i * 2 + 1] * scale;
    if (i === from) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  return p;
}

export function strokeInk(ctx: CanvasRenderingContext2D, path: Path2D, zoom: number, color = INK, alpha = 1): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha * 0.28;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.4, 11 / zoom);
  ctx.stroke(path);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(0.9, 4.2 / zoom);
  ctx.stroke(path);
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = INK_CORE;
  ctx.lineWidth = Math.max(0.3, 1.4 / zoom);
  ctx.stroke(path);
  ctx.restore();
}

const SPEED_STOPS: [number, [number, number, number]][] = [
  [0, [255, 70, 40]],
  [0.35, [255, 196, 0]],
  [0.65, [40, 210, 120]],
  [1, [155, 48, 255]],
];

export function speedColor(f: number): string {
  const t = f < 0 ? 0 : f > 1 ? 1 : f;
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [b, cb] = SPEED_STOPS[i];
    const [a, ca] = SPEED_STOPS[i - 1];
    if (t <= b) {
      const u = (t - a) / (b - a);
      const c = ca.map((v, k) => Math.round(v + (cb[k] - v) * u));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(155,48,255)';
}

/** Bucket a lap's samples by speed so the heat trace takes a handful of strokes. */
export function speedPaths(x: Float32Array, y: Float32Array, v: Float32Array, buckets = 14): { color: string; path: Path2D }[] {
  const n = v.length;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  const out = Array.from({ length: buckets }, (_, b) => ({ color: speedColor(b / (buckets - 1)), path: new Path2D() }));
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = ((v[i] + v[j]) / 2 - lo) / span;
    const b = Math.min(buckets - 1, Math.max(0, Math.round(f * (buckets - 1))));
    out[b].path.moveTo(x[i], y[i]);
    out[b].path.lineTo(x[j], y[j]);
  }
  return out;
}
