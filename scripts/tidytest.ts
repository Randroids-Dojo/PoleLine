// Tidy strokes check, headless: draws hand-like laps stroke by stroke through
// a LineBuilder, once as drawn (freehand, the hard mode) and once with every
// stroke corrected on lift (tidy strokes, the medium mode), and compares them.
// A corrected lap should stay legal, lose its kinks and wobble, and run much
// closer to the ideal line's time.
//
//   npx tsx scripts/tidytest.ts [slug,slug,...] [stroke metres]

import { CATALOG } from '../src/data/catalog.js';
import { TIDY_DEFAULTS, blend, tidyStroke, type TidyTuning } from '../src/app/tidy.js';
import { LineBuilder } from '../src/sim/builder.js';
import { simulateLap } from '../src/sim/lapsim.js';
import { UNITS_PER_METRE, validatePath } from '../src/sim/path.js';
import { buildTrack, frameAt, projectNear, type Track } from '../src/sim/track.js';
import { minCurvatureOffsets, offsetsToLine, wobble } from './optimal.js';

const slugs = (process.argv[2] ?? 'spielberg,monaco,suzuka,silverstone,hungaroring,zandvoort').split(',');
const STROKE = Number(process.argv[3] ?? 140);
// TUNE='keepWave=60,ahead=120' tries a variation of the fit.
const tuning: TidyTuning = { ...TIDY_DEFAULTS };
for (const kv of (process.env.TUNE ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (tuning as unknown as Record<string, number>)[k] = Number(v);
}

/** Deterministic noise. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A hand-drawn lap as finger samples per stroke: the wobbled ideal line, a
 * little fingertip jitter, and at each new stroke a sideways slip between
 * where the line ended and where the finger lands, eased in over a few metres
 * like the draw screen's pickup.
 */
function handStrokes(track: Track, seed: number, amp: number, slip: number): { x: number; y: number }[][] {
  const ideal = minCurvatureOffsets(track);
  const alpha = wobble(track, ideal, seed, amp, 50, 0.04);
  const rnd = rng(seed * 7 + 1);
  const strokes: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  // Each stroke's finger runs `now` off the wobbled line; the line eases onto
  // it from where the last stroke left off (`was`) over the first 6 m.
  let was = 0;
  let now = 0;
  let strokeStart = 0;
  const step = 0.8;
  for (let s = step; s <= track.length + 3; s += step) {
    if (s - strokeStart >= STROKE) {
      strokes.push(cur);
      cur = [];
      strokeStart = s;
      was = now;
      now = (rnd() * 2 - 1) * slip;
    }
    const f = frameAt(track, s);
    const i = f.seg;
    const j = (i + 1) % track.n;
    const u = ((s % track.length) - track.s[i]) / track.segLen[i];
    const a = alpha[i] + (alpha[j] - alpha[i]) * u;
    const e = Math.min(1, (s - strokeStart) / 6);
    // A careful player keeps the finger inside the white lines.
    const lim = track.limit - 0.25;
    const lat = Math.max(-lim, Math.min(lim, a + was + (now - was) * e + (rnd() * 2 - 1) * 0.12));
    cur.push({ x: f.x + f.nx * lat, y: f.y + f.ny * lat });
  }
  strokes.push(cur);
  return strokes;
}

/** Keep a finger sample inside the white lines, as tidy strokes does while drawing. */
function clampInside(track: Track, b: LineBuilder, p: { x: number; y: number }): { x: number; y: number } {
  const q = projectNear(track, p.x, p.y, b.hint, 12);
  const lim = track.limit - 0.3;
  if (q.dist <= lim) return p;
  const f = frameAt(track, q.s);
  const side = q.d >= 0 ? lim : -lim;
  return { x: f.x + f.nx * side, y: f.y + f.ny * side };
}

function metres(b: LineBuilder): Float64Array {
  return Float64Array.from(b.points, (v) => v / UNITS_PER_METRE);
}

/** 3 m steps of a line (long enough that decimetre rounding does not read as a kink). */
function steps(line: Float64Array): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: line[0], y: line[1] }];
  for (let i = 2; i < line.length; i += 2) {
    const l = pts[pts.length - 1];
    if (Math.hypot(line[i] - l.x, line[i + 1] - l.y) >= 3) pts.push({ x: line[i], y: line[i + 1] });
  }
  return pts;
}

/** Turning angle (degrees) at each step. */
function turns(pts: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y;
    const bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
    out.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * (180 / Math.PI));
  }
  return out;
}

/**
 * Sharpest kink (degrees): how far one step's turn sticks out from the turns
 * either side of it. A steady corner scores zero however tight it is.
 */
function worstKink(line: Float64Array): number {
  const t = turns(steps(line));
  let worst = 0;
  for (let i = 1; i < t.length - 1; i++) worst = Math.max(worst, Math.abs(t[i] - (t[i - 1] + t[i + 1]) / 2));
  return worst;
}

/** The five sharpest kinks: lap metres, degrees, metres from the nearest stroke start, margin to the limit. */
function reportKinks(track: Track, line: Float64Array, anchors: number[]): void {
  const pts = steps(line);
  const t = turns(pts);
  const ks: { s: number; deg: number; margin: number }[] = [];
  let hint = 0;
  for (let i = 1; i < t.length - 1; i++) {
    const p = projectNear(track, pts[i + 1].x, pts[i + 1].y, hint, 12);
    hint = p.seg;
    ks.push({ s: p.s, deg: Math.abs(t[i] - (t[i - 1] + t[i + 1]) / 2), margin: track.limit - p.dist });
  }
  ks.sort((a, b) => b.deg - a.deg);
  for (const k of ks.slice(0, 4)) {
    const near = Math.min(...anchors.map((a) => Math.abs(a - k.s)));
    console.log(`      kink ${k.deg.toFixed(1)}° at ${k.s.toFixed(0)}m, ${near.toFixed(1)}m from a stroke start, ${k.margin.toFixed(2)}m inside the limit`);
  }
}

function draw(track: Track, strokes: { x: number; y: number }[][], tidyOn: boolean) {
  const b = new LineBuilder(track);
  const first = strokes[0][0];
  const st = frameAt(track, 0);
  if (!b.start(first.x, first.y)) throw new Error('no start');
  let tidied = 0, failed = 0, devSum = 0, devN = 0, devMax = 0;
  const anchors: number[] = [];
  for (let k = 0; k < strokes.length && b.status !== 'done'; k++) {
    if (k > 0) b.beginStroke();
    anchors.push(b.progress);
    for (const p of strokes[k]) {
      const q = tidyOn ? clampInside(track, b, p) : p;
      const r = b.extend(q.x, q.y);
      if (r === 'finish') break;
      if (r === 'offtrack') {
        if (!tidyOn) return { b, tidied, failed, dev: 0, devMax: 0, offtrack: true, anchors };
      }
    }
    if (!tidyOn) continue;
    const t = tidyStroke(track, metres(b), b.strokeAnchor, { x: st.tx, y: st.ty }, b.strokeHint, tuning);
    if (!t) continue;
    let ok = false;
    for (const f of [1, 0.6, 0.3]) {
      if (b.replaceStroke(blend(t, f))) {
        ok = true;
        break;
      }
    }
    if (ok) {
      tidied++;
      for (let i = 0; i < t.raw.length; i++) {
        const d = Math.hypot(t.raw[i].x - t.tidy[i].x, t.raw[i].y - t.tidy[i].y);
        devSum += d;
        devN++;
        if (d > devMax) devMax = d;
      }
    } else failed++;
  }
  return { b, tidied, failed, dev: devN ? devSum / devN : 0, devMax, offtrack: false, anchors };
}

for (const slug of slugs) {
  const meta = CATALOG.find((m) => m.slug === slug)!;
  const track = buildTrack(meta, (await import(`../src/data/geometry/${slug}.ts`)).default as number[]);
  const ideal = simulateLap(track, Float64Array.from(offsetsToLine(track, minCurvatureOffsets(track)), (v) => v / UNITS_PER_METRE), 'soft').timeMs;
  console.log(`\n${slug}  ideal ${(ideal / 1000).toFixed(3)}s`);
  for (const [name, amp, slip] of [['steady', 0.35, 0.3], ['shaky', 0.8, 0.6], ['rough', 1.3, 1.0]] as const) {
    for (const seed of [1, 2]) {
      const strokes = handStrokes(track, seed, amp, slip);
      const row: string[] = [`  ${name.padEnd(6)} #${seed}`];
      for (const tidyOn of [false, true]) {
        const r = draw(track, strokes, tidyOn);
        const line = metres(r.b);
        const v = validatePath(track, line);
        if (!v.ok || r.offtrack) {
          row.push(`${tidyOn ? 'tidy' : 'hard'} ${r.offtrack ? 'offtrack' : v.error}`.padEnd(34));
          continue;
        }
        const lap = simulateLap(track, line, 'soft');
        if (process.env.KINKS && tidyOn) reportKinks(track, line, r.anchors);
        const extra = tidyOn ? ` dev ${r.dev.toFixed(2)}/${r.devMax.toFixed(2)}m tidied ${r.tidied} failed ${r.failed}` : '';
        row.push(`${tidyOn ? 'tidy' : 'hard'} ${(lap.timeMs / 1000).toFixed(3)}s kink ${worstKink(line).toFixed(1).padStart(4)}°${extra}`.padEnd(34));
      }
      console.log(row.join('  '));
    }
  }
}
