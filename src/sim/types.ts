// Shared types for the deterministic lap simulation. Everything under src/sim
// runs identically in the browser and in the Vercel leaderboard function, so it
// must stay free of DOM APIs and of transcendental Math functions whose last
// bits can differ between JS engines (only + - * / and Math.sqrt are used).

export type Compound = 'soft' | 'medium' | 'hard';
export const COMPOUNDS: Compound[] = ['soft', 'medium', 'hard'];

export interface TrackMeta {
  slug: string;
  name: string;
  short: string;
  country: string;
  flag: string;
  street: boolean;
  night: boolean;
  width: number;
  turns: number;
  length: number;
  officialLength: number;
  altitude: number;
  poleRef: number;
  airTemp: number;
  trackTemp: number;
  windSpeed: number;
  windFrom: number;
  /** Wind velocity (the direction it blows towards), metres per second, +x east, +y south. */
  wind: [number, number];
  rho: number;
  downforce: 1 | 2 | 3 | 4 | 5;
  /** Surface grip multiplier, calibrated so an ideal line lands near real pole pace. */
  grip: number;
  /** Share of the lap spent in each sector on the ideal line (for purple sectors). */
  poleSectors: [number, number, number];
  /** DRS activation zones as [startS, endS] along the centreline (metres). */
  drs: [number, number][];
  size: [number, number];
  /** Thumbnail outline, flat [x, y, ...] in a 0..1000 box. */
  outline: number[];
}

export interface Vec {
  x: number;
  y: number;
}
