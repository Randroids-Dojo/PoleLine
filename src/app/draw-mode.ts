// How the racing line goes down, from easy to expert. Segment by segment
// (easy, the default) lays the lap a segment at a time: Gas or Brake and a
// gate for each (src/screens/segments.ts). Tap and bend (medium) lays the
// line as a chain of curves (src/app/curve.ts). Tidy my strokes (hard) is
// freehand drawing that is corrected into a racing line each time the finger
// lifts (src/app/tidy.ts). Freehand (expert) puts the ink exactly where the
// finger is. Every mode produces an ordinary line that is validated and
// simulated the same way; a lap laid segment by segment also carries the
// brake zones its pedals set.

export type DrawMode = 'segments' | 'curves' | 'smooth' | 'freehand';

/** The modes drawn with a finger on the draw screen (segment by segment has its own screen). */
export type DrawnMode = Exclude<DrawMode, 'segments'>;

export type DrawLevel = 'easy' | 'medium' | 'hard' | 'expert';

export const DEFAULT_DRAW_MODE: DrawMode = 'segments';

export const DRAW_MODES: { id: DrawMode; level: DrawLevel; label: string; short: string; detail: string }[] = [
  {
    id: 'segments',
    level: 'easy',
    label: 'Segment by segment',
    short: 'Gas or Brake, and a gate, for each segment.',
    detail: 'The lap comes a segment at a time. Tap Left or Right to pick which third of the road the line passes, then Gas or Brake. The line takes the smoothest way through your gates.',
  },
  { id: 'curves', level: 'medium', label: 'Tap and bend', short: 'Tap the track and bend the curves.', detail: 'Tap the track ahead to lay the line in smooth curves. Drag the dot in the middle of a curve to bend it.' },
  {
    id: 'smooth',
    level: 'hard',
    label: 'Tidy my strokes',
    short: 'Draw it, and each stroke is corrected.',
    detail: 'Draw freely. When you lift, your stroke is corrected into a clean racing line that uses the width of the track. It still ends where you lifted, and the white line never stops you.',
  },
  { id: 'freehand', level: 'expert', label: 'Freehand', short: 'Draw it exactly, with no help.', detail: 'Your line goes exactly where your finger goes. Touch the white line and the stroke stops there.' },
];

export const LEVEL_LABELS: Record<DrawLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export function isDrawMode(v: unknown): v is DrawMode {
  return v === 'segments' || v === 'freehand' || v === 'smooth' || v === 'curves';
}

/** The drawing mode the draw screen uses when the setting is segment by segment (editing a drawn line, say). */
export function drawnMode(m: DrawMode): DrawnMode {
  return m === 'segments' ? 'curves' : m;
}

/** The mode's name as setup text shows it: "Tap and bend (medium)". Laps from before the modes were freehand. */
export function drawModeText(mode: DrawMode | undefined): string {
  const m = DRAW_MODES.find((o) => o.id === (mode ?? 'freehand')) ?? DRAW_MODES[DRAW_MODES.length - 1];
  return `${m.label} (${m.level})`;
}
