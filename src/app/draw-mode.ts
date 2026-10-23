// How the racing line goes down. Freehand is the hard mode: the ink is exactly
// where the finger is. The easy modes help the line come out smooth: tidy
// strokes refits each freehand stroke when the finger lifts (src/app/tidy.ts),
// tap and bend lays the line as a chain of curves (src/app/curve.ts). Every
// mode produces an ordinary line that is validated and simulated the same way.

export type DrawMode = 'freehand' | 'smooth' | 'curves';

export const DRAW_MODES: { id: DrawMode; easy: boolean; label: string; detail: string }[] = [
  { id: 'freehand', easy: false, label: 'Freehand', detail: 'Your line goes exactly where your finger goes. Touch the white line and the stroke stops there.' },
  {
    id: 'smooth',
    easy: true,
    label: 'Tidy my strokes',
    detail: 'Draw freely. When you lift, wobbles straighten out and corners round off. The line slides along the white line instead of stopping.',
  },
  { id: 'curves', easy: true, label: 'Tap and bend', detail: 'Tap the track ahead to lay the line in smooth curves. Drag the dot in the middle of a curve to bend it.' },
];

export function isDrawMode(v: unknown): v is DrawMode {
  return v === 'freehand' || v === 'smooth' || v === 'curves';
}

/** The mode's name as setup text shows it: "Tap and bend (easy)". */
export function drawModeText(mode: DrawMode | undefined): string {
  const m = DRAW_MODES.find((o) => o.id === (mode ?? 'freehand')) ?? DRAW_MODES[0];
  return m.easy ? `${m.label} (easy)` : m.label;
}
