// Top-down modern single-seater, drawn once into an offscreen sprite (car
// points along +x) and blitted rotated each frame.

const LEN = 5.6;
const WID = 2.0;
const PX = 28; // sprite pixels per metre

export interface Livery {
  body: string;
  accent: string;
  wing: string;
  frontWing?: string;
  alpha?: number;
}

export const PLAYER_LIVERY: Livery = { body: '#7a2cf0', accent: '#f4f1ff', wing: '#141519', frontWing: '#ffffff' };
export const GHOST_LIVERY: Livery = { body: '#e8ecf2', accent: '#9aa3ad', wing: '#8d96a1', frontWing: '#ffffff' };

export function makeCarSprite(l: Livery): HTMLCanvasElement {
  const pad = 10;
  const c = document.createElement('canvas');
  c.width = Math.ceil(LEN * PX) + pad * 2;
  c.height = Math.ceil(WID * PX) + pad * 2;
  const g = c.getContext('2d')!;
  g.translate(pad + LEN * PX * 0.5, pad + WID * PX * 0.5);
  g.scale(PX, PX);
  // Coordinates in metres, origin at car centre, nose towards +x. Front axle
  // at x = 1.7, rear axle at x = -1.85, driver's helmet just behind centre.
  const rect = (x: number, y: number, w: number, h: number, r = 0.06) => {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  };
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  // Shadow
  g.fillStyle = 'rgba(0,0,0,0.18)';
  rect(-2.7, -0.86, 5.4, 1.86, 0.6);

  // Tyres: rears wider than fronts.
  g.fillStyle = '#111215';
  rect(1.33, -1.02, 0.74, 0.37, 0.09);
  rect(1.33, 0.65, 0.74, 0.37, 0.09);
  rect(-2.27, -1.04, 0.84, 0.46, 0.1);
  rect(-2.27, 0.58, 0.84, 0.46, 0.1);
  g.fillStyle = '#2a2c31';
  for (const [x, y, w] of [[1.33, -0.86, 0.74], [1.33, 0.81, 0.74], [-2.27, -0.83, 0.84], [-2.27, 0.79, 0.84]] as const) rect(x, y, w, 0.05, 0.02);

  // Floor
  g.fillStyle = '#1a1b1f';
  poly([[1.15, -0.34], [0.6, -0.9], [-1.5, -0.9], [-2.15, -0.52], [-2.15, 0.52], [-1.5, 0.9], [0.6, 0.9], [1.15, 0.34]]);

  // Body: slim nose, cockpit, sidepods flaring beside and behind the driver,
  // engine cover tapering to the gearbox.
  g.fillStyle = l.body;
  g.beginPath();
  g.moveTo(2.5, -0.13);
  g.quadraticCurveTo(2.62, 0, 2.5, 0.13);
  g.lineTo(1.1, 0.27);
  g.lineTo(0.6, 0.3);
  g.quadraticCurveTo(0.35, 0.8, -0.2, 0.8);
  g.quadraticCurveTo(-0.95, 0.78, -1.45, 0.42);
  g.lineTo(-2.2, 0.22);
  g.lineTo(-2.2, -0.22);
  g.lineTo(-1.45, -0.42);
  g.quadraticCurveTo(-0.95, -0.78, -0.2, -0.8);
  g.quadraticCurveTo(0.35, -0.8, 0.6, -0.3);
  g.lineTo(1.1, -0.27);
  g.closePath();
  g.fill();

  // Sidepod inlets (dark slots facing forward).
  g.fillStyle = '#0d0e10';
  rect(0.32, -0.74, 0.14, 0.34, 0.05);
  rect(0.32, 0.4, 0.14, 0.34, 0.05);

  // Accent stripe along the spine, from the nose tip back to the gearbox.
  g.fillStyle = l.accent;
  poly([[2.48, -0.045], [-2.12, -0.07], [-2.12, 0.07], [2.48, 0.045]]);

  // Cockpit, helmet and halo.
  g.fillStyle = '#0b0c0e';
  rect(-0.4, -0.22, 0.95, 0.44, 0.2);
  g.fillStyle = '#ffd400';
  g.beginPath();
  g.arc(-0.12, 0, 0.15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  rect(-0.02, -0.08, 0.1, 0.16, 0.03);
  g.strokeStyle = '#33363c';
  g.lineWidth = 0.08;
  g.beginPath();
  g.moveTo(0.62, 0);
  g.lineTo(0.42, 0);
  g.moveTo(0.42, -0.2);
  g.quadraticCurveTo(-0.45, -0.3, -0.42, 0);
  g.quadraticCurveTo(-0.45, 0.3, 0.42, 0.2);
  g.stroke();

  // Airbox behind the driver's head.
  g.fillStyle = '#0d0e10';
  g.beginPath();
  g.ellipse(-0.62, 0, 0.16, 0.13, 0, 0, Math.PI * 2);
  g.fill();

  // Front wing: the widest and brightest part of the car.
  g.fillStyle = l.frontWing ?? l.accent;
  rect(2.42, -1.0, 0.36, 2.0, 0.07);
  g.fillStyle = l.wing;
  rect(2.62, -1.0, 0.16, 2.0, 0.05);
  g.fillStyle = l.body;
  rect(2.4, -1.02, 0.42, 0.13, 0.03);
  rect(2.4, 0.89, 0.42, 0.13, 0.03);

  // Rear wing with a red rain light at the very back.
  g.fillStyle = l.wing;
  rect(-2.86, -0.5, 0.44, 1.0, 0.05);
  g.fillStyle = l.body;
  rect(-2.88, -0.54, 0.48, 0.1, 0.03);
  rect(-2.88, 0.44, 0.48, 0.1, 0.03);
  g.fillStyle = '#ff2b2b';
  rect(-3.02, -0.1, 0.16, 0.2, 0.04);
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
