// Top-down 2026-regulation single-seater, drawn once per livery into an
// offscreen sprite (car points along +x) and blitted rotated each frame.
//
// Proportions follow the 2026 cars: a little shorter and narrower than the
// previous generation, a wide swept front wing on a long slim nose, exposed
// suspension arms, narrow front tyres, sidepods that flare just behind the
// cockpit and pinch into a tight coke-bottle rear, floor edges visible around
// the body and a narrower rear wing. A red rain light marks the back.

import { POLELINE_LIVERY, type Livery } from './liveries';

export type { Livery } from './liveries';
export { GHOST_LIVERY } from './liveries';
export const PLAYER_LIVERY = POLELINE_LIVERY;

const LEN = 5.4;
const WID = 1.9;
const PX = 32; // sprite pixels per metre

type Pt = [number, number];

/** One side of a symmetric outline (y <= 0), mirrored to make the closed shape. */
function mirrored(side: Pt[]): Pt[] {
  const back = side
    .slice()
    .reverse()
    .map(([x, y]) => [x, -y] as Pt);
  return side.concat(back);
}

export function makeCarSprite(l: Livery): HTMLCanvasElement {
  const pad = 12;
  const c = document.createElement('canvas');
  c.width = Math.ceil(LEN * PX) + pad * 2;
  c.height = Math.ceil(WID * PX) + pad * 2;
  const g = c.getContext('2d')!;
  g.translate(pad + LEN * PX * 0.5, pad + WID * PX * 0.5);
  g.scale(PX, PX);

  const poly = (pts: Pt[], fill: string) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0.05) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fillStyle = fill;
    g.fill();
  };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineWidth = w;
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.stroke();
  };

  // Soft shadow.
  g.save();
  g.globalAlpha = 0.16;
  rect(-2.55, -0.8, 5.2, 1.6, '#000', 0.6);
  g.restore();

  // Floor, with its edges showing past the sidepods.
  poly(
    mirrored([
      [1.05, -0.24],
      [0.72, -0.6],
      [0.42, -0.84],
      [-1.32, -0.84],
      [-1.5, -0.74],
      [-2.2, -0.56],
      [-2.34, -0.46],
    ]),
    '#1b1c20',
  );

  // Suspension arms.
  const arm = '#2c2e33';
  for (const s of [-1, 1]) {
    line(1.78, 0.1 * s, 1.6, 0.62 * s, 0.045, arm);
    line(1.4, 0.13 * s, 1.56, 0.62 * s, 0.045, arm);
    line(1.62, 0.14 * s, 1.42, 0.6 * s, 0.03, arm);
    line(-1.45, 0.42 * s, -1.78, 0.58 * s, 0.045, arm);
    line(-2.08, 0.26 * s, -1.84, 0.58 * s, 0.045, arm);
  }

  // Tyres: narrow fronts, wider rears, with a tread highlight.
  const tyre = '#101114';
  const tread = '#2a2c31';
  for (const s of [-1, 1]) {
    const fy = s < 0 ? -0.87 : 0.53;
    rect(1.22, fy, 0.72, 0.34, tyre, 0.1);
    rect(1.22, fy + 0.15, 0.72, 0.04, tread, 0.02);
    const ry = s < 0 ? -0.92 : 0.47;
    rect(-2.18, ry, 0.74, 0.45, tyre, 0.11);
    rect(-2.18, ry + 0.2, 0.74, 0.05, tread, 0.02);
  }

  // Bodywork: slim nose, chassis, sidepods flaring behind the cockpit,
  // coke-bottle taper to the gearbox.
  const bodySide: Pt[] = [
    [2.6, -0.05],
    [2.5, -0.09],
    [1.9, -0.11],
    [1.2, -0.15],
    [0.96, -0.2],
    [0.82, -0.36],
    [0.62, -0.64],
    [0.42, -0.75],
    [0.05, -0.78],
    [-0.45, -0.74],
    [-0.9, -0.6],
    [-1.25, -0.45],
    [-1.65, -0.3],
    [-2.0, -0.23],
    [-2.22, -0.19],
  ];
  const body = mirrored(bodySide);
  g.save();
  g.beginPath();
  body.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = l.body;
  g.fill();
  g.clip();
  // Split liveries paint the right half in the second colour.
  if (l.split) {
    g.fillStyle = l.split;
    g.fillRect(-3, 0, 6, 1);
  }
  // Sidepod flash: a swept band on each side.
  for (const s of [-1, 1]) {
    poly(
      [
        [0.35, 0.78 * s],
        [0.1, 0.78 * s],
        [-1.2, 0.36 * s],
        [-0.95, 0.36 * s],
      ],
      l.accent,
    );
  }
  // Engine cover stripe and nose tip.
  poly(
    [
      [0.15, -0.16],
      [-2.25, -0.08],
      [-2.25, 0.08],
      [0.15, 0.16],
    ],
    l.stripe,
  );
  poly(
    [
      [2.65, -0.12],
      [1.95, -0.13],
      [1.95, 0.13],
      [2.65, 0.12],
    ],
    l.nose,
  );
  g.restore();

  // Sidepod inlets and mirrors.
  for (const s of [-1, 1]) {
    const y = s < 0 ? -0.74 : 0.42;
    rect(0.5, y, 0.16, 0.32, '#0b0c0e', 0.05);
    line(0.86, 0.22 * s, 0.82, 0.5 * s, 0.04, '#2c2e33');
    g.beginPath();
    g.ellipse(0.8, 0.56 * s, 0.07, 0.12, 0, 0, Math.PI * 2);
    g.fillStyle = l.wing;
    g.fill();
  }

  // Cockpit, halo and helmet.
  rect(-0.3, -0.19, 0.82, 0.38, '#0a0b0d', 0.18);
  g.beginPath();
  g.arc(0.02, 0, 0.14, 0, Math.PI * 2);
  g.fillStyle = l.helmet;
  g.fill();
  rect(0.1, -0.07, 0.08, 0.14, '#111', 0.03);
  g.beginPath();
  g.moveTo(0.78, 0);
  g.lineTo(0.5, 0);
  g.moveTo(0.5, -0.19);
  g.quadraticCurveTo(-0.42, -0.3, -0.38, 0);
  g.quadraticCurveTo(-0.42, 0.3, 0.5, 0.19);
  g.lineWidth = 0.07;
  g.strokeStyle = '#3a3d43';
  g.stroke();

  // Airbox behind the driver's head.
  g.beginPath();
  g.ellipse(-0.52, 0, 0.17, 0.12, 0, 0, Math.PI * 2);
  g.fillStyle = '#0b0c0e';
  g.fill();

  // Front wing: swept main plane plus flap, endplates at the tips.
  poly(
    mirrored([
      [2.7, -0.08],
      [2.64, -0.5],
      [2.5, -0.86],
      [2.36, -0.86],
      [2.48, -0.5],
      [2.52, -0.08],
    ]),
    l.wing,
  );
  poly(
    mirrored([
      [2.5, -0.1],
      [2.46, -0.5],
      [2.34, -0.84],
      [2.24, -0.84],
      [2.36, -0.5],
      [2.38, -0.1],
    ]),
    l.wingTip,
  );
  for (const s of [-1, 1]) rect(2.2, s < 0 ? -0.93 : 0.86, 0.5, 0.07, '#0b0c0e', 0.02);
  // Nose tip sits over the wing centre.
  g.beginPath();
  g.ellipse(2.6, 0, 0.12, 0.08, 0, 0, Math.PI * 2);
  g.fillStyle = l.nose;
  g.fill();

  // Rear wing: narrower than the car, flap in the trim colour, dark endplates.
  rect(-2.62, -0.62, 0.48, 1.24, l.wing, 0.05);
  rect(-2.42, -0.62, 0.18, 1.24, l.wingTip, 0.04);
  for (const s of [-1, 1]) rect(-2.66, s < 0 ? -0.66 : 0.6, 0.56, 0.06, '#0b0c0e', 0.02);
  // Rain light.
  rect(-2.74, -0.07, 0.12, 0.14, '#ff2b2b', 0.03);
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

/** A preview image of a livery, pointing in the given direction ('up' or 'right'). */
export function liveryPreview(l: Livery, direction: 'up' | 'right' = 'right'): string {
  const sprite = makeCarSprite(l);
  if (direction === 'right') return sprite.toDataURL();
  const c = document.createElement('canvas');
  c.width = sprite.height;
  c.height = sprite.width;
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate(-Math.PI / 2);
  g.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  return c.toDataURL();
}

