// Plain-language descriptions of a circuit's locked conditions.

import type { TrackMeta } from '../sim/types';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function windText(m: TrackMeta): string {
  return `${Math.round(m.windSpeed * 3.6)} km/h from ${compass(m.windFrom)}`;
}

export function downforceLabel(m: TrackMeta): string {
  return ['Very low', 'Low', 'Medium', 'High', 'Maximum'][m.downforce - 1];
}

export function gripLabel(m: TrackMeta): string {
  if (m.grip < 0.9) return 'Low';
  if (m.grip < 0.99) return 'Medium';
  if (m.grip < 1.08) return 'High';
  return 'Very high';
}

export function tyreHint(m: TrackMeta): string {
  if (m.trackTemp >= 45) return 'Hot track. Softs can overheat over a lap, mediums stay calmer.';
  if (m.trackTemp <= 20) return 'Cold track. Harder compounds struggle to switch on.';
  if (m.downforce <= 2) return 'Low drag trim. Corner exits onto the long straights matter most.';
  if (m.downforce >= 5) return 'Maximum downforce. Slow corners decide the lap.';
  return 'Softs are the quickest choice if you keep the line smooth.';
}

/** SVG path for the thumbnail outline (0..1000 box). */
export function outlinePath(m: TrackMeta): string {
  const o = m.outline;
  let d = '';
  for (let i = 0; i < o.length; i += 2) d += `${i ? 'L' : 'M'}${o[i]} ${o[i + 1]}`;
  return d + 'Z';
}

export function outlineViewBox(m: TrackMeta, pad = 60): string {
  const [w, h] = m.size;
  const s = 1000 / Math.max(w, h);
  return `${-pad} ${-pad} ${Math.round(w * s) + pad * 2} ${Math.round(h * s) + pad * 2}`;
}
