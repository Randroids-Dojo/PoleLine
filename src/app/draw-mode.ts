// How the racing line goes down, from easy to hard. Tap and bend (easy, the
// default) lays the line as a chain of curves (src/app/curve.ts). Tidy my
// strokes (medium) is freehand drawing that is corrected into a racing line
// each time the finger lifts (src/app/tidy.ts). Freehand (hard) puts the ink
// exactly where the finger is. Every mode produces an ordinary line that is
// validated and simulated the same way.

export type DrawMode = 'freehand' | 'smooth' | 'curves';

export type DrawLevel = 'easy' | 'medium' | 'hard';

export const DEFAULT_DRAW_MODE: DrawMode = 'curves';

export const DRAW_MODES: { id: DrawMode; level: DrawLevel; label: string; short: string; detail: string }[] = [
  { id: 'curves', level: 'easy', label: 'Tap and bend', short: 'Tap the track and bend the curves.', detail: 'Tap the track ahead to lay the line in smooth curves. Drag the dot in the middle of a curve to bend it.' },
  {
    id: 'smooth',
    level: 'medium',
    label: 'Tidy my strokes',
    short: 'Draw it, and each stroke is corrected.',
    detail: 'Draw freely. When you lift, your stroke is corrected into a clean racing line that uses the width of the track. It still ends where you lifted, and the white line never stops you.',
  },
  { id: 'freehand', level: 'hard', label: 'Freehand', short: 'Draw it exactly, with no help.', detail: 'Your line goes exactly where your finger goes. Touch the white line and the stroke stops there.' },
];

export const LEVEL_LABELS: Record<DrawLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export function isDrawMode(v: unknown): v is DrawMode {
  return v === 'freehand' || v === 'smooth' || v === 'curves';
}

/** The mode's name as setup text shows it: "Tap and bend (easy)". Laps from before the modes were freehand. */
export function drawModeText(mode: DrawMode | undefined): string {
  const m = DRAW_MODES.find((o) => o.id === (mode ?? 'freehand')) ?? DRAW_MODES[DRAW_MODES.length - 1];
  return `${m.label} (${m.level})`;
}
