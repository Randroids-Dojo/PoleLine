// The Toybox edition's made-up circuits: twenty rounds, each a plan of
// corners, each with a radius (see plan.ts), with its own locked conditions. Nothing
// here is a real place. Edit, then run `npm run toybox:tracks`.

import type { Corner } from './plan.js';

export interface Circuit {
  slug: string;
  name: string;
  short: string;
  /** Where in the toybox it sits (shown where the web edition shows a country). */
  region: string;
  /** A glyph for the region, where the web edition shows a flag. */
  glyph: string;
  /** One line of character for the circuit list. */
  character: string;
  /** Multiplies every coordinate and radius, to tune lap length with one number. */
  scale?: number;
  width: number;
  altitude: number;
  airTemp: number;
  trackTemp: number;
  windSpeed: number;
  windFrom: number;
  night: boolean;
  street: boolean;
  downforce: 1 | 2 | 3 | 4 | 5;
  /** Surface grip, the one calibration input for a made-up circuit (pole pace is derived from it). */
  grip: number;
  corners: Corner[];
}

const LANTERN = ['Lantern Coast', '🏮'] as const;
const DOWNS = ['The Downs', '🌾'] as const;
const FLATS = ['Tidal Flats', '🌊'] as const;
const REDSTONE = ['Red Stone', '🏜️'] as const;
const WOODS = ['North Woods', '🌲'] as const;
const LAKES = ['Lake Country', '🛶'] as const;
const FOUNDRY = ['The Foundry', '⚙️'] as const;
const NEON = ['Neon District', '🌃'] as const;
const PLATEAU = ['High Plateau', '🏔️'] as const;
const SUN = ['Sun Country', '☀️'] as const;
const GREEN = ['Green Country', '🍀'] as const;
const NORTH = ['Far North', '❄️'] as const;

const place = (r: readonly [string, string]) => ({ region: r[0], glyph: r[1] });

export const CIRCUITS: Circuit[] = [
  {
    slug: 'harbour-loop', name: 'Harbour Loop', short: 'Harbour Loop', ...place(LANTERN),
    character: 'Tight streets round the old harbour, under the lanterns',
    width: 10, altitude: 4, airTemp: 24, trackTemp: 30, windSpeed: 2.5, windFrom: 170, night: true, street: true, downforce: 5, grip: 0.95,
    scale: 1,
    corners: [[0,0,25],[520,0,22],[520,-160,20],[700,-160,22],[700,-520,24],[380,-520,30],[380,-380,22],[200,-380,26],[200,-620,24],[-120,-620,28],[-120,-300,40],[-40,-200,40],[-120,-100,30]],
  },
  {
    slug: 'kestrel-park', name: 'Kestrel Park Circuit', short: 'Kestrel Park', ...place(DOWNS),
    character: 'Fast, open and flowing across the chalk downs',
    width: 14, altitude: 190, airTemp: 19, trackTemp: 31, windSpeed: 6, windFrom: 230, night: false, street: false, downforce: 3, grip: 1.1,
    scale: 1.4,
    corners: [[0,0,120],[900,60,110],[1250,420,40],[1150,760,140],[720,920,40],[600,640,30],[420,820,110],[-150,560,38],[-250,300,90],[-50,150,55]],
  },
  {
    slug: 'saltmarsh', name: 'Saltmarsh Raceway', short: 'Saltmarsh', ...place(FLATS),
    character: 'Flat, windy and all about the long straights and hairpins',
    width: 13, altitude: 2, airTemp: 16, trackTemp: 26, windSpeed: 8, windFrom: 270, night: false, street: false, downforce: 2, grip: 1.05,
    scale: 1,
    corners: [[0,0,50],[1200,0,28],[1200,70,28],[800,70,60],[700,300,60],[1100,420,45],[1150,700,45],[600,700,90],[300,560,70],[-100,700,45],[-200,420,55],[100,300,50],[-50,100,45]],
  },
  {
    slug: 'ember-gorge', name: 'Ember Gorge', short: 'Ember Gorge', ...place(REDSTONE),
    character: 'Hot asphalt winding through the red canyon',
    width: 12, altitude: 640, airTemp: 33, trackTemp: 52, windSpeed: 3, windFrom: 60, night: false, street: false, downforce: 4, grip: 1.0,
    scale: 1.15,
    corners: [[0,0,60],[600,0,45],[760,220,50],[560,420,40],[700,640,55],[400,760,45],[150,600,60],[-100,760,40],[-300,560,50],[-200,300,70],[-350,120,45],[-150,-60,60]],
  },
  {
    slug: 'pinewood-club', name: 'Pinewood Club Circuit', short: 'Pinewood', ...place(WOODS),
    character: 'A short club circuit between the pines',
    width: 11, altitude: 220, airTemp: 15, trackTemp: 24, windSpeed: 3.5, windFrom: 300, night: false, street: false, downforce: 3, grip: 1.08,
    scale: 1.12,
    corners: [[0,0,50],[500,0,40],[620,200,45],[450,380,35],[600,560,40],[300,620,55],[80,450,40],[-150,560,45],[-250,300,60],[-80,120,45]],
  },
  {
    slug: 'glasswater', name: 'Glasswater Circuit', short: 'Glasswater', ...place(LAKES),
    character: 'Cool air and long esses along the lake shore',
    width: 13, altitude: 310, airTemp: 14, trackTemp: 21, windSpeed: 4, windFrom: 20, night: false, street: false, downforce: 4, grip: 1.12,
    scale: 1,
    corners: [[0,0,90],[800,0,110],[1050,250,80],[900,500,100],[1050,750,100],[900,1000,80],[600,1050,70],[450,850,60],[200,900,60],[0,700,90],[150,450,90],[-50,250,70],[-250,400,50],[-350,150,60]],
  },
  {
    slug: 'old-quarry', name: 'Old Quarry Circuit', short: 'Old Quarry', ...place(FOUNDRY),
    character: 'Stop and go: heavy braking into the quarry floor',
    width: 12.5, altitude: 95, airTemp: 21, trackTemp: 36, windSpeed: 3, windFrom: 120, night: false, street: false, downforce: 3, grip: 1.03,
    scale: 0.88,
    corners: [[0,0,40],[700,0,30],[700,180,35],[420,180,35],[420,420,40],[900,420,45],[900,760,38],[400,760,30],[400,620,30],[100,620,45],[100,900,40],[-250,900,50],[-250,500,60],[-80,300,45],[-250,120,40]],
  },
  {
    slug: 'lantern-quay', name: 'Lantern Quay Street Circuit', short: 'Lantern Quay', ...place(LANTERN),
    character: 'A long waterfront blast, then the walls close in',
    width: 11.5, altitude: 3, airTemp: 27, trackTemp: 31, windSpeed: 2, windFrom: 150, night: true, street: true, downforce: 4, grip: 0.97,
    scale: 1,
    corners: [[0,0,45],[1000,0,26],[1000,120,26],[760,120,30],[760,300,35],[1100,300,40],[1100,620,35],[650,620,50],[520,480,50],[300,620,40],[300,820,35],[-150,820,40],[-150,560,45],[50,420,45],[-150,240,40]],
  },
  {
    slug: 'thornfield', name: 'Thornfield', short: 'Thornfield', ...place(DOWNS),
    character: 'Three fast sweeps and a hedge-lined hairpin',
    width: 13.5, altitude: 140, airTemp: 20, trackTemp: 32, windSpeed: 5, windFrom: 210, night: false, street: false, downforce: 2, grip: 1.09,
    scale: 1,
    corners: [[0,0,70],[900,-100,150],[1500,300,140],[1500,700,30],[1420,700,30],[1420,350,60],[1000,600,120],[400,900,90],[-200,700,110],[-350,300,80],[-100,100,90]],
  },
  {
    slug: 'midnight-strip', name: 'Midnight Strip Circuit', short: 'Midnight Strip', ...place(NEON),
    character: 'Neon boulevards: very long straights joined by 90 degree corners',
    width: 13, altitude: 610, airTemp: 12, trackTemp: 15, windSpeed: 3, windFrom: 200, night: true, street: true, downforce: 1, grip: 0.93,
    scale: 0.85,
    corners: [[0,0,35],[1500,0,32],[1500,320,30],[1200,320,30],[1200,620,35],[1700,620,40],[1700,1100,32],[600,1100,32],[600,850,30],[200,850,32],[200,1200,32],[-300,1200,40],[-300,400,32],[-100,400,32],[-100,150,32]],
  },
  {
    slug: 'ridgeback', name: 'Ridgeback Circuit', short: 'Ridgeback', ...place(PLATEAU),
    character: 'Thin air on the plateau: less drag, less grip',
    width: 13, altitude: 2150, airTemp: 20, trackTemp: 41, windSpeed: 2.5, windFrom: 80, night: false, street: false, downforce: 5, grip: 0.98,
    scale: 1.15,
    corners: [[0,0,50],[800,0,45],[900,220,50],[700,360,55],[850,560,40],[600,720,45],[350,600,60],[200,780,40],[-50,700,50],[-300,500,40],[-200,250,70],[-320,60,40]],
  },
  {
    slug: 'cinder-ring', name: 'Cinder Ring', short: 'Cinder Ring', ...place(FOUNDRY),
    character: 'Two banked bowls and a twisty infield',
    width: 14, altitude: 60, airTemp: 23, trackTemp: 39, windSpeed: 2, windFrom: 0, night: false, street: false, downforce: 2, grip: 1.06,
    scale: 1.2,
    corners: [[0,0,90],[800,0,140],[1000,200,140],[800,400,140],[300,400,38],[230,230,26],[80,330,26],[-250,150,50],[-150,-50,80]],
  },
  {
    slug: 'saffron-dunes', name: 'Saffron Dunes International', short: 'Saffron Dunes', ...place(SUN),
    character: 'Long, hot, high-energy corners in the dunes',
    width: 14, altitude: 20, airTemp: 34, trackTemp: 50, windSpeed: 5, windFrom: 330, night: false, street: false, downforce: 3, grip: 1.02,
    scale: 1.1,
    corners: [[0,0,100],[700,-50,130],[1200,200,120],[1250,600,110],[900,800,70],[750,600,60],[450,650,100],[300,950,90],[-150,900,100],[-350,600,120],[-200,250,100],[-400,50,70]],
  },
  {
    slug: 'bluebell-hollow', name: 'Bluebell Hollow', short: 'Bluebell', ...place(GREEN),
    character: 'Narrow, twisty and green: maximum downforce country',
    width: 11, altitude: 260, airTemp: 22, trackTemp: 37, windSpeed: 2, windFrom: 250, night: false, street: false, downforce: 5, grip: 1.1,
    scale: 1.15,
    corners: [[0,0,45],[450,0,40],[560,180,35],[380,300,40],[520,480,35],[300,560,40],[360,760,35],[100,820,45],[-80,640,40],[-300,760,35],[-420,520,50],[-200,380,45],[-350,180,40],[-150,60,40]],
  },
  {
    slug: 'copperhead', name: 'Copperhead Circuit', short: 'Copperhead', ...place(REDSTONE),
    character: 'A snake of esses carved into the copper hills',
    width: 12.5, altitude: 720, airTemp: 29, trackTemp: 45, windSpeed: 4, windFrom: 110, night: false, street: false, downforce: 4, grip: 1.04,
    scale: 1.05,
    corners: [[0,0,70],[900,0,60],[1050,200,60],[900,380,60],[1050,560,60],[900,740,60],[1050,920,55],[800,1050,60],[500,900,90],[200,1050,60],[-100,900,70],[-100,500,70],[150,400,60],[-100,250,55],[-250,60,50]],
  },
  {
    slug: 'tidewater-bay', name: 'Tidewater Bay', short: 'Tidewater', ...place(FLATS),
    character: 'Mixed corners on a windy spit of land',
    width: 13, altitude: 5, airTemp: 18, trackTemp: 28, windSpeed: 7, windFrom: 240, night: false, street: false, downforce: 3, grip: 1.07,
    scale: 1,
    corners: [[0,0,60],[750,0,80],[1000,250,60],[850,450,45],[1050,600,50],[900,850,70],[500,800,90],[300,1000,60],[0,850,50],[-100,1050,45],[-350,900,60],[-250,600,90],[-400,350,60],[-200,150,60]],
  },
  {
    slug: 'fox-hollow', name: 'Fox Hollow Circuit', short: 'Fox Hollow', ...place(WOODS),
    character: 'Blind crests and one brutal hairpin in the woods',
    width: 12, altitude: 340, airTemp: 17, trackTemp: 27, windSpeed: 3, windFrom: 320, night: false, street: false, downforce: 4, grip: 1.1,
    scale: 1,
    corners: [[0,0,60],[650,0,50],[820,220,45],[650,450,60],[950,750,26],[880,800,26],[560,520,70],[250,700,60],[-100,600,55],[-250,800,45],[-450,600,60],[-300,350,80],[-400,100,50]],
  },
  {
    slug: 'granite-pass', name: 'Granite Pass', short: 'Granite Pass', ...place(PLATEAU),
    character: 'The long one: big straights and brave sweepers over the pass',
    width: 13.5, altitude: 1450, airTemp: 16, trackTemp: 26, windSpeed: 5, windFrom: 290, night: false, street: false, downforce: 2, grip: 1.08,
    scale: 1,
    corners: [[0,0,90],[1200,0,160],[1700,400,120],[1600,800,60],[1300,900,80],[1100,700,70],[700,800,110],[300,1100,100],[-200,1000,120],[-500,700,90],[-350,400,100],[-600,150,70],[-300,-50,80]],
  },
  {
    slug: 'starlight-pier', name: 'Starlight Pier', short: 'Starlight Pier', ...place(LANTERN),
    character: 'Bright corners along a dark pier at night',
    width: 12, altitude: 2, airTemp: 25, trackTemp: 29, windSpeed: 3, windFrom: 190, night: true, street: true, downforce: 4, grip: 0.96,
    scale: 1.18,
    corners: [[0,0,40],[550,0,30],[550,200,32],[800,200,35],[800,500,40],[500,620,55],[300,520,40],[300,760,36],[-100,760,40],[-100,500,35],[100,500,35],[100,300,40],[-250,300,40],[-250,100,40]],
  },
  {
    slug: 'aurora-point', name: 'Aurora Point', short: 'Aurora Point', ...place(NORTH),
    character: 'Cold, fast and long under the northern lights',
    width: 14, altitude: 80, airTemp: 6, trackTemp: 11, windSpeed: 6, windFrom: 10, night: true, street: false, downforce: 3, grip: 1.12,
    scale: 1,
    corners: [[0,0,110],[1300,0,150],[1800,450,130],[1850,1000,30],[1500,850,60],[1000,800,45],[700,950,90],[400,1250,110],[-100,1200,90],[-300,900,40],[-100,600,120],[-400,350,100],[-500,50,90]],
  },
];
