// 2D camera with rotation. `anchor` is where the camera centre sits on screen
// (fractions of the viewport), so a car can sit low in the frame with track
// visible ahead of it.

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 3;
  angle = 0;
  ax = 0.5;
  ay = 0.5;
  w = 1;
  h = 1;

  apply(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.w * this.ax, this.h * this.ay);
    ctx.rotate(this.angle);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cx, -this.cy);
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return {
      x: (dx * c - dy * s) * this.zoom + this.w * this.ax,
      y: (dx * s + dy * c) * this.zoom + this.h * this.ay,
    };
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    const vx = (sx - this.w * this.ax) / this.zoom;
    const vy = (sy - this.h * this.ay) / this.zoom;
    const c = Math.cos(-this.angle);
    const s = Math.sin(-this.angle);
    return { x: vx * c - vy * s + this.cx, y: vx * s + vy * c + this.cy };
  }

  /** Rotate a world direction into screen space. */
  dirToScreen(dx: number, dy: number): { x: number; y: number } {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  /** World-space axis-aligned bounds of the viewport, padded by `pad` metres. */
  bounds(pad = 0): { minX: number; minY: number; maxX: number; maxY: number } {
    const pts = [this.toWorld(0, 0), this.toWorld(this.w, 0), this.toWorld(0, this.h), this.toWorld(this.w, this.h)];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  copyFrom(o: Camera): void {
    this.cx = o.cx;
    this.cy = o.cy;
    this.zoom = o.zoom;
    this.angle = o.angle;
    this.ax = o.ax;
    this.ay = o.ay;
  }
}

/** Heading (radians, screen space) that should point up: camera angle. */
export function angleForHeading(hx: number, hy: number): number {
  return -Math.PI / 2 - Math.atan2(hy, hx);
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
