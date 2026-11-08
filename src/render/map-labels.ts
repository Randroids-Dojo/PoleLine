// Names on the map, drawn upright in screen space however the map is turned:
// turns as dark T badges on the outside of each bend, and the three timing
// sectors as blue S badges where each one starts. Brake boards (white, with
// metres) and segment numbers are drawn by the screens that use them.

import { TURNS } from '../data/turns';
import type { Camera } from './camera';
import { frameAt, type Track } from '../sim/track';

/** Where each official turn's apex is (metres along the lap), or none for a circuit without the data. */
export function turnsOf(track: Track): readonly number[] {
  return TURNS[track.meta.slug] ?? [];
}

/** The timing sector (1 to 3) lap distance s falls in: the lap in thirds, as the sim times them. */
export function sectorAt(track: Track, s: number): 1 | 2 | 3 {
  const f = (((s % track.length) + track.length) % track.length) / track.length;
  return f < 1 / 3 ? 1 : f < 2 / 3 ? 2 : 3;
}

/** Which way the road bends at s: 1 right, -1 left. */
function bendAt(track: Track, s: number): 1 | -1 {
  const a = frameAt(track, s - 12);
  const b = frameAt(track, s + 12);
  return a.tx * b.ty - a.ty * b.tx >= 0 ? 1 : -1;
}

/** A badge drawn on screen (px), so later labels can keep clear of it. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, size: number): Box {
  ctx.font = `800 ${size}px "Archivo Variable", sans-serif`;
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size + 7;
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y + 0.5);
  return { x: x - w / 2, y: y - h / 2, w, h };
}

function onScreen(cam: Camera, p: { x: number; y: number }, pad = 30): boolean {
  return p.x > -pad && p.y > -pad && p.x < cam.w + pad && p.y < cam.h + pad;
}

/**
 * T badges beside every turn: outside the bend, about a finger from the
 * edge. Call with the screen transform (identity times dpr) set.
 */
export function drawTurnLabels(ctx: CanvasRenderingContext2D, cam: Camera, track: Track, opts: { size?: number; alpha?: number } = {}): Box[] {
  const turns = turnsOf(track);
  const boxes: Box[] = [];
  if (!turns.length) return boxes;
  const size = opts.size ?? 12;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  turns.forEach((s, i) => {
    const f = frameAt(track, s);
    const out = -bendAt(track, s);
    const off = track.limit + (size + 8) / cam.zoom;
    const p = cam.toScreen(f.x + f.nx * out * off, f.y + f.ny * out * off);
    if (onScreen(cam, p)) boxes.push(badge(ctx, p.x, p.y, `T${i + 1}`, '#1d2026', '#ffffff', size));
  });
  ctx.restore();
  return boxes;
}

/**
 * Where each timing sector starts: a blue line across the road and an S
 * badge beside it. S1 starts at the start line.
 */
export function drawSectorMarks(ctx: CanvasRenderingContext2D, cam: Camera, track: Track, opts: { size?: number; line?: boolean } = {}): Box[] {
  const size = opts.size ?? 12;
  const boxes: Box[] = [];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 0; k < 3; k++) {
    const s = (track.length * k) / 3;
    const f = frameAt(track, s);
    const w = track.limit + 2;
    const a = cam.toScreen(f.x + f.nx * w, f.y + f.ny * w);
    const b = cam.toScreen(f.x - f.nx * w, f.y - f.ny * w);
    if (opts.line !== false) {
      ctx.strokeStyle = '#1f6fe0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // The badge sits off the right edge of the road.
    const off = track.limit + (size + 10) / cam.zoom;
    const p = cam.toScreen(f.x + f.nx * off, f.y + f.ny * off);
    if (onScreen(cam, p)) boxes.push(badge(ctx, p.x, p.y, `S${k + 1}`, '#1f6fe0', '#ffffff', size));
  }
  ctx.restore();
  return boxes;
}
