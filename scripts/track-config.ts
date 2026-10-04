// Hand-curated per-circuit configuration for the track build. Geometry comes
// from data-src/*.geojson (bacinger/f1-circuits, MIT). Everything here is the
// locked simulation context for a circuit: it never changes between attempts,
// so the same line on the same tyre always produces the same lap.
//
// poleRef: modern-era (2024/2025) dry qualifying pole pace in seconds.
// windFrom: meteorological direction the wind blows FROM (degrees, 0 = north).
// downforce: 1 (Monza trim) .. 5 (Monaco trim).
// Listed in 2025 calendar order; the index is the round number.

export interface TrackConfig {
  slug: string;
  source: string;
  name: string;
  short: string;
  country: string;
  flag: string;
  reverse?: boolean;
  startOffset?: number; // metres along the source loop where the S/F line sits
  width: number; // asphalt width in metres
  poleRef: number;
  turns: number;
  airTemp: number;
  trackTemp: number;
  windSpeed: number; // m/s
  windFrom: number;
  night: boolean;
  downforce: 1 | 2 | 3 | 4 | 5;
  street: boolean;
}

export const TRACKS: TrackConfig[] = [
  { slug: 'melbourne', source: 'au-1953', name: 'Albert Park Circuit', short: 'Melbourne', country: 'Australia', flag: '🇦🇺', width: 13, poleRef: 75.096, turns: 14, airTemp: 20, trackTemp: 31, windSpeed: 4, windFrom: 190, night: false, downforce: 3, street: true },
  { slug: 'shanghai', source: 'cn-2004', name: 'Shanghai International Circuit', short: 'Shanghai', country: 'China', flag: '🇨🇳', width: 15, poleRef: 90.641, turns: 16, airTemp: 17, trackTemp: 25, windSpeed: 3, windFrom: 90, night: false, downforce: 3, street: false },
  { slug: 'suzuka', source: 'jp-1962', name: 'Suzuka International Racing Course', short: 'Suzuka', country: 'Japan', flag: '🇯🇵', width: 11.5, poleRef: 86.983, turns: 18, airTemp: 18, trackTemp: 29, windSpeed: 3.5, windFrom: 260, night: false, downforce: 4, street: false },
  { slug: 'bahrain', source: 'bh-2002', name: 'Bahrain International Circuit', short: 'Sakhir', country: 'Bahrain', flag: '🇧🇭', width: 14, poleRef: 89.841, turns: 15, airTemp: 26, trackTemp: 31, windSpeed: 5.5, windFrom: 330, night: true, downforce: 3, street: false },
  { slug: 'jeddah', source: 'sa-2021', name: 'Jeddah Corniche Circuit', short: 'Jeddah', country: 'Saudi Arabia', flag: '🇸🇦', width: 12, poleRef: 87.294, turns: 27, airTemp: 28, trackTemp: 32, windSpeed: 4.5, windFrom: 315, night: true, downforce: 2, street: true },
  { slug: 'miami', source: 'us-2022', name: 'Miami International Autodrome', short: 'Miami', country: 'United States', flag: '🇺🇸', width: 13, poleRef: 86.204, turns: 19, airTemp: 30, trackTemp: 49, windSpeed: 4, windFrom: 130, night: false, downforce: 3, street: true },
  { slug: 'imola', source: 'it-1953', name: 'Autodromo Enzo e Dino Ferrari', short: 'Imola', country: 'Italy', flag: '🇮🇹', width: 11.5, poleRef: 74.67, turns: 19, airTemp: 22, trackTemp: 40, windSpeed: 2.5, windFrom: 60, night: false, downforce: 4, street: false },
  { slug: 'monaco', source: 'mc-1929', name: 'Circuit de Monaco', short: 'Monte Carlo', country: 'Monaco', flag: '🇲🇨', startOffset: 2490, width: 8.5, poleRef: 69.954, turns: 19, airTemp: 22, trackTemp: 41, windSpeed: 2, windFrom: 200, night: false, downforce: 5, street: true },
  { slug: 'barcelona', source: 'es-1991', name: 'Circuit de Barcelona-Catalunya', short: 'Barcelona', country: 'Spain', flag: '🇪🇸', width: 13, poleRef: 71.546, turns: 14, airTemp: 28, trackTemp: 46, windSpeed: 4, windFrom: 200, night: false, downforce: 4, street: false },
  { slug: 'montreal', source: 'ca-1978', name: 'Circuit Gilles Villeneuve', short: 'Montréal', country: 'Canada', flag: '🇨🇦', width: 11, poleRef: 70.899, turns: 14, airTemp: 22, trackTemp: 38, windSpeed: 3.5, windFrom: 250, night: false, downforce: 2, street: false },
  { slug: 'spielberg', source: 'at-1969', name: 'Red Bull Ring', short: 'Spielberg', country: 'Austria', flag: '🇦🇹', width: 13, poleRef: 63.971, turns: 10, airTemp: 24, trackTemp: 42, windSpeed: 3, windFrom: 300, night: false, downforce: 3, street: false },
  { slug: 'silverstone', source: 'gb-1948', name: 'Silverstone Circuit', short: 'Silverstone', country: 'Great Britain', flag: '🇬🇧', width: 15, poleRef: 84.892, turns: 18, airTemp: 20, trackTemp: 33, windSpeed: 6, windFrom: 225, night: false, downforce: 3, street: false },
  { slug: 'spa', source: 'be-1925', name: 'Circuit de Spa-Francorchamps', short: 'Spa', country: 'Belgium', flag: '🇧🇪', width: 13, poleRef: 100.562, turns: 19, airTemp: 17, trackTemp: 24, windSpeed: 4, windFrom: 230, night: false, downforce: 2, street: false },
  { slug: 'hungaroring', source: 'hu-1986', name: 'Hungaroring', short: 'Budapest', country: 'Hungary', flag: '🇭🇺', width: 12, poleRef: 75.372, turns: 14, airTemp: 30, trackTemp: 50, windSpeed: 2.5, windFrom: 310, night: false, downforce: 5, street: false },
  { slug: 'zandvoort', source: 'nl-1948', name: 'Circuit Zandvoort', short: 'Zandvoort', country: 'Netherlands', flag: '🇳🇱', width: 11.5, poleRef: 68.662, turns: 14, airTemp: 18, trackTemp: 29, windSpeed: 7, windFrom: 260, night: false, downforce: 5, street: false },
  { slug: 'monza', source: 'it-1922', name: 'Autodromo Nazionale Monza', short: 'Monza', country: 'Italy', flag: '🇮🇹', width: 13, poleRef: 78.792, turns: 11, airTemp: 26, trackTemp: 40, windSpeed: 2, windFrom: 0, night: false, downforce: 1, street: false },
  { slug: 'baku', source: 'az-2016', name: 'Baku City Circuit', short: 'Baku', country: 'Azerbaijan', flag: '🇦🇿', width: 10, poleRef: 101.117, turns: 20, airTemp: 24, trackTemp: 34, windSpeed: 8, windFrom: 350, night: false, downforce: 1, street: true },
  { slug: 'singapore', source: 'sg-2008', name: 'Marina Bay Street Circuit', short: 'Singapore', country: 'Singapore', flag: '🇸🇬', reverse: true, width: 11.5, poleRef: 89.158, turns: 19, airTemp: 30, trackTemp: 34, windSpeed: 1.5, windFrom: 170, night: true, downforce: 5, street: true },
  { slug: 'austin', source: 'us-2012', name: 'Circuit of the Americas', short: 'Austin', country: 'United States', flag: '🇺🇸', width: 15, poleRef: 92.51, turns: 20, airTemp: 27, trackTemp: 40, windSpeed: 4.5, windFrom: 180, night: false, downforce: 4, street: false },
  { slug: 'mexico-city', source: 'mx-1962', name: 'Autódromo Hermanos Rodríguez', short: 'Mexico City', country: 'Mexico', flag: '🇲🇽', width: 13, poleRef: 75.586, turns: 17, airTemp: 21, trackTemp: 43, windSpeed: 2.5, windFrom: 80, night: false, downforce: 5, street: false },
  { slug: 'interlagos', source: 'br-1940', name: 'Autódromo José Carlos Pace', short: 'Interlagos', country: 'Brazil', flag: '🇧🇷', width: 12.5, poleRef: 69.511, turns: 15, airTemp: 22, trackTemp: 40, windSpeed: 3, windFrom: 140, night: false, downforce: 3, street: false },
  { slug: 'las-vegas', source: 'us-2023', name: 'Las Vegas Strip Circuit', short: 'Las Vegas', country: 'United States', flag: '🇺🇸', width: 13, poleRef: 92.312, turns: 17, airTemp: 13, trackTemp: 15, windSpeed: 3, windFrom: 220, night: true, downforce: 1, street: true },
  { slug: 'lusail', source: 'qa-2004', name: 'Lusail International Circuit', short: 'Lusail', country: 'Qatar', flag: '🇶🇦', width: 13.5, poleRef: 79.387, turns: 16, airTemp: 26, trackTemp: 30, windSpeed: 5, windFrom: 340, night: true, downforce: 4, street: false },
  { slug: 'yas-marina', source: 'ae-2009', name: 'Yas Marina Circuit', short: 'Abu Dhabi', country: 'Abu Dhabi', flag: '🇦🇪', width: 14, poleRef: 82.207, turns: 16, airTemp: 27, trackTemp: 31, windSpeed: 3.5, windFrom: 300, night: true, downforce: 3, street: false },
];
