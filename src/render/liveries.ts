// Car colour schemes. In the web edition the eleven team liveries are loose
// colour impressions of the 2026 grid with no logos or sponsor marks; the
// Toybox edition races its own made-up teams. PoleLine's own purple car is the
// default in both.

import { REAL_CIRCUITS } from '../app/edition';

export interface Livery {
  id: string;
  name: string;
  /** Main bodywork. */
  body: string;
  /** Optional second body colour for the car's right half (a split livery). */
  split?: string;
  /** Engine cover spine stripe. */
  stripe: string;
  /** Sidepod flash. */
  accent: string;
  /** Nose tip. */
  nose: string;
  /** Wing main planes. */
  wing: string;
  /** Wing flaps and endplate trim. */
  wingTip: string;
  helmet: string;
}

export const POLELINE_LIVERY: Livery = {
  id: 'poleline',
  name: 'PoleLine',
  body: '#7a2cf0',
  stripe: '#f4f1ff',
  accent: '#c9a6ff',
  nose: '#f4f1ff',
  wing: '#141519',
  wingTip: '#ffffff',
  helmet: '#ffd400',
};

export const GHOST_LIVERY: Livery = {
  id: 'ghost',
  name: 'Ghost',
  body: '#e8ecf2',
  stripe: '#9aa3ad',
  accent: '#c3c9d1',
  nose: '#ffffff',
  wing: '#8d96a1',
  wingTip: '#ffffff',
  helmet: '#ffffff',
};

const SEASON: Livery[] = [
  { id: 'mclaren', name: 'McLaren', body: '#ff8000', stripe: '#1b1c1f', accent: '#1b1c1f', nose: '#ff8000', wing: '#1b1c1f', wingTip: '#ff8000', helmet: '#ffd400' },
  { id: 'ferrari', name: 'Ferrari', body: '#e3001b', stripe: '#ffffff', accent: '#1a1a1a', nose: '#e3001b', wing: '#1a1a1a', wingTip: '#e3001b', helmet: '#ffe600' },
  { id: 'red-bull', name: 'Red Bull', body: '#1e2a5c', stripe: '#e21b4d', accent: '#ffc906', nose: '#ffc906', wing: '#121a36', wingTip: '#e21b4d', helmet: '#ffc906' },
  { id: 'mercedes', name: 'Mercedes', body: '#16181b', stripe: '#c7cacd', accent: '#00d7b6', nose: '#c7cacd', wing: '#16181b', wingTip: '#00d7b6', helmet: '#c7cacd' },
  { id: 'aston-martin', name: 'Aston Martin', body: '#00665e', stripe: '#cedc00', accent: '#cedc00', nose: '#00665e', wing: '#0b2d2a', wingTip: '#cedc00', helmet: '#cedc00' },
  { id: 'alpine', name: 'Alpine', body: '#0b86d1', stripe: '#ff87bc', accent: '#ff87bc', nose: '#ff87bc', wing: '#0a1e3c', wingTip: '#ff87bc', helmet: '#ffffff' },
  { id: 'williams', name: 'Williams', body: '#1868db', stripe: '#00205b', accent: '#64c4ff', nose: '#1868db', wing: '#00205b', wingTip: '#64c4ff', helmet: '#ffffff' },
  { id: 'racing-bulls', name: 'Racing Bulls', body: '#f4f4f4', stripe: '#1634cb', accent: '#e21b4d', nose: '#1634cb', wing: '#1634cb', wingTip: '#f4f4f4', helmet: '#1634cb' },
  { id: 'audi', name: 'Audi', body: '#b9bcc0', stripe: '#1a1a1a', accent: '#f50537', nose: '#1a1a1a', wing: '#1a1a1a', wingTip: '#f50537', helmet: '#f50537' },
  { id: 'haas', name: 'Haas', body: '#f2f2f2', stripe: '#1a1a1a', accent: '#da291c', nose: '#1a1a1a', wing: '#1a1a1a', wingTip: '#da291c', helmet: '#da291c' },
  { id: 'cadillac', name: 'Cadillac', body: '#121212', split: '#f2f2f2', stripe: '#9a9a9a', accent: '#121212', nose: '#121212', wing: '#121212', wingTip: '#f2f2f2', helmet: '#f2f2f2' },
];

/** The toybox teams: nine made-up outfits with their own colours. */
const TOYBOX: Livery[] = [
  { id: 'kestrel', name: 'Kestrel Racing', body: '#0f7f7a', stripe: '#f2c14e', accent: '#f2c14e', nose: '#f2c14e', wing: '#0b3f3d', wingTip: '#f2c14e', helmet: '#f2c14e' },
  { id: 'nordlicht', name: 'Nordlicht', body: '#e9f3fb', stripe: '#3d9be9', accent: '#0d2a5c', nose: '#3d9be9', wing: '#0d2a5c', wingTip: '#e9f3fb', helmet: '#3d9be9' },
  { id: 'vulcan', name: 'Vulcan Motorsport', body: '#17181c', stripe: '#ff6a1f', accent: '#ff6a1f', nose: '#ff6a1f', wing: '#17181c', wingTip: '#ff6a1f', helmet: '#ff6a1f' },
  { id: 'meridian', name: 'Meridian', body: '#0d2a5c', stripe: '#ff6f61', accent: '#ff6f61', nose: '#ffffff', wing: '#081b3d', wingTip: '#ff6f61', helmet: '#ffffff' },
  { id: 'saffron', name: 'Saffron GP', body: '#f6c21b', stripe: '#1a1a1a', accent: '#1a1a1a', nose: '#1a1a1a', wing: '#1a1a1a', wingTip: '#f6c21b', helmet: '#1a1a1a' },
  { id: 'tidewater', name: 'Tidewater', body: '#0b5c3a', stripe: '#c9d1d9', accent: '#c9d1d9', nose: '#c9d1d9', wing: '#073d27', wingTip: '#c9d1d9', helmet: '#c9d1d9' },
  { id: 'carmine', name: 'Carmine Works', body: '#b3122e', stripe: '#ffffff', accent: '#1a1a1a', nose: '#b3122e', wing: '#1a1a1a', wingTip: '#ffffff', helmet: '#ffffff' },
  { id: 'phantom', name: 'Phantom', body: '#f4f4f4', split: '#161616', stripe: '#8a8a8a', accent: '#f4f4f4', nose: '#161616', wing: '#161616', wingTip: '#f4f4f4', helmet: '#f4f4f4' },
  { id: 'peppermint', name: 'Peppermint', body: '#4fd1a5', stripe: '#ffffff', accent: '#ef7aa6', nose: '#ef7aa6', wing: '#1f3d33', wingTip: '#ffffff', helmet: '#ef7aa6' },
];

export const LIVERIES: Livery[] = [POLELINE_LIVERY, ...(REAL_CIRCUITS ? SEASON : TOYBOX)];

export function liveryById(id: string | undefined): Livery {
  return LIVERIES.find((l) => l.id === id) ?? POLELINE_LIVERY;
}
