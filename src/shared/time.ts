// Lap formatting shared by the browser and API. No browser or build globals.

export function formatLap(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-:--.---';
  const neg = ms < 0;
  const a = Math.abs(Math.round(ms));
  const m = Math.floor(a / 60000);
  const s = Math.floor((a % 60000) / 1000);
  const r = a % 1000;
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
