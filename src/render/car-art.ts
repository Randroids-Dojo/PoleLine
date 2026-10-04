// Top-down modern single-seater, drawn once into an offscreen sprite (car
// points along +x) and blitted rotated each frame.

const LEN = 5.6;
const WID = 2.0;
const PX = 28; // sprite pixels per metre

export interface Livery {
  body: string;
  accent: string;
  wing: string;
  alpha?: number;
}

export const PLAYER_LIVERY: Livery = { body: '#7a2cf0', accent: '#f4f1ff', wing: '#141519' };
export const GHOST_LIVERY: Livery = { body: '#e8ecf2', accent: '#9aa3ad', wing: '#c3c9d1' };

export function makeCarSprite(l: Livery): HTMLCanvasElement {
  const pad = 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil(LEN * PX) + pad * 2;
  c.height = Math.ceil(WID * PX) + pad * 2;
  const g = c.getContext('2d')!;
  g.translate(pad + LEN * PX * 0.5, pad + WID * PX * 0.5);
  g.scale(PX, PX);
  // Coordinates in metres, origin at car centre, nose towards +x.
  const rect = (x: number, y: number, w: number, h: number, r = 0.06) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  // Shadow
  g.fillStyle = 'rgba(0,0,0,0.28)';
  rect(-2.75, -0.95, 5.55, 1.95, 0.4);
  // Wheels
  g.fillStyle = '#121316';
  rect(1.35, -1.0, 0.72, 0.36);
  rect(1.35, 0.64, 0.72, 0.36);
  rect(-2.15, -1.0, 0.8, 0.42);
  rect(-2.15, 0.58, 0.8, 0.42);
  // Floor
  g.fillStyle = '#1b1c20';
  g.beginPath();
  g.moveTo(1.2, -0.42);
  g.lineTo(0.6, -0.86);
  g.lineTo(-1.7, -0.86);
  g.lineTo(-2.05, -0.5);
  g.lineTo(-2.05, 0.5);
  g.lineTo(-1.7, 0.86);
  g.lineTo(0.6, 0.86);
  g.lineTo(1.2, 0.42);
  g.closePath();
  g.fill();
  // Body: sidepods and engine cover
  g.fillStyle = l.body;
  g.beginPath();
  g.moveTo(2.55, -0.08);
  g.lineTo(1.0, -0.24);
  g.quadraticCurveTo(0.55, -0.74, -0.25, -0.72);
  g.lineTo(-1.45, -0.42);
  g.lineTo(-2.15, -0.18);
  g.lineTo(-2.15, 0.18);
  g.lineTo(-1.45, 0.42);
  g.lineTo(-0.25, 0.72);
  g.quadraticCurveTo(0.55, 0.74, 1.0, 0.24);
  g.lineTo(2.55, 0.08);
  g.closePath();
  g.fill();
  // Accent stripe down the spine
  g.fillStyle = l.accent;
  g.beginPath();
  g.moveTo(2.5, -0.035);
  g.lineTo(-2.0, -0.07);
  g.lineTo(-2.0, 0.07);
  g.lineTo(2.5, 0.035);
  g.closePath();
  g.fill();
  // Cockpit and halo
  g.fillStyle = '#0d0e10';
  rect(0.05, -0.2, 0.7, 0.4, 0.18);
  g.strokeStyle = '#2a2c31';
  g.lineWidth = 0.07;
  g.beginPath();
  g.moveTo(0.82, 0);
  g.lineTo(0.62, 0);
  g.moveTo(0.62, -0.18);
  g.quadraticCurveTo(-0.1, -0.26, -0.05, 0);
  g.quadraticCurveTo(-0.1, 0.26, 0.62, 0.18);
  g.stroke();
  // Helmet
  g.fillStyle = '#ffd400';
  g.beginPath();
  g.arc(0.3, 0, 0.13, 0, Math.PI * 2);
  g.fill();
  // Front wing
  g.fillStyle = l.wing;
  rect(2.45, -0.95, 0.32, 1.9, 0.05);
  g.fillStyle = l.body;
  rect(2.45, -0.95, 0.12, 0.22, 0.02);
  rect(2.45, 0.73, 0.12, 0.22, 0.02);
  // Rear wing
  g.fillStyle = l.wing;
  rect(-2.75, -0.52, 0.42, 1.04, 0.05);
  g.fillStyle = l.accent;
  rect(-2.75, -0.52, 0.42, 0.08, 0.02);
  rect(-2.75, 0.44, 0.42, 0.08, 0.02);
  return c;
}

/** Cars are drawn a little larger than life so they read on a phone. */
const DISPLAY_SCALE = 1.3;

export function drawCar(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, heading: number, alpha = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(DISPLAY_SCALE, DISPLAY_SCALE);
  ctx.globalAlpha = alpha;
  const w = sprite.width / PX;
  const h = sprite.height / PX;
  ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
  ctx.restore();
}
