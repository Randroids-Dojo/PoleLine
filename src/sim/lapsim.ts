// Deterministic quasi-steady-state lap simulation.
//
// 1. The drawn line is resampled every ~1 m.
// 2. A real car cannot follow every wobble of a fingertip, so the line is
//    smoothed with a speed-dependent window: a few metres in a hairpin, ~14 m
//    on a 300 km/h straight. The smoothed path is what the car actually drives.
// 3. Corner speed limits come from tyre grip plus aerodynamic downforce (which
//    depends on airspeed, so the locked track wind matters), with tyre load
//    sensitivity. Forward/backward passes add power-, traction- and
//    brake-limited acceleration with a friction ellipse.
// 4. 2026 rules: on designated straights the wings flatten into straight mode
//    (less drag and downforce) and close into corner mode under braking. Drive
//    power is the engine plus the MGU-K, whose output tapers above 290 km/h and
//    is limited by a battery that starts the lap charged, drains on throttle and
//    recharges under braking. Like a real energy-management map, the car
//    deploys fully below a cut-off speed and clips above it; the cut-off is the
//    highest one the battery can sustain for the whole lap, found by bisection.
// 5. A tyre thermal model integrates sliding energy around the lap; the grip it
//    implies feeds back into the speed profile for a few fixed iterations.
//
// Only + - * / and Math.sqrt are used on the timing path, so every JS engine
// produces bit-identical lap times for the same quantised line.

import { AERO, CAR, COMPOUND_SPECS, ERS, G, THERMAL, deployLimit, gearFor, tyreGrip } from './car.js';
import { projectNear, type Projection, type Track } from './track.js';
import type { Compound } from './types.js';

const SAMPLE_SPACING = 1.0;
const SIGMA_INITIAL = 5;
const SIGMA_PER_SPEED = 0.2;
const SIGMA_MIN = 3;
const SIGMA_MAX = 16;
const BISECT_STEPS = 36;
const FEEDBACK_ITERATIONS = 3;
const DEPLOY_BISECT_STEPS = 12;
const WARM_WINDOW = 4;
const WARM_STEPS = 7;
/** Deployment fades in over this speed band (m/s) below the cut-off. */
const CLIP_BAND = 8;

export interface LapStats {
  topSpeed: number;
  minSpeed: number;
  avgSpeed: number;
  maxLatG: number;
  maxBrakeG: number;
  tyreMax: number;
  tyreMin: number;
  distance: number;
  /** Electrical energy deployed and recovered over the lap (joules). */
  energyUsed: number;
  energyRecovered: number;
  /** Lap progress (m) where the battery first ran down to its reserve, or -1. */
  flatAt: number;
  /** Battery charge left when crossing the line (joules). */
  energyLeft: number;
  /** Speed (m/s) above which the car stops deploying to save energy, or Infinity. */
  clipSpeed: number;
}

export interface LapResult {
  compound: Compound;
  timeMs: number;
  sectorsMs: [number, number, number];
  n: number;
  /** Driven (smoothed) path. */
  x: Float32Array;
  y: Float32Array;
  /** Speed m/s at each sample. */
  v: Float32Array;
  /** Cumulative time (s) at each sample; t[n] is the lap time. */
  t: Float64Array;
  /** Unwrapped progress along the track centreline at each sample. */
  s: Float32Array;
  latG: Float32Array;
  lonG: Float32Array;
  tyre: Float32Array;
  /** 1 while the wings are in straight mode. */
  straight: Uint8Array;
  /** Battery charge (joules), MGU-K deployment and regeneration (watts). */
  soc: Float32Array;
  deploy: Float32Array;
  regen: Float32Array;
  throttle: Float32Array;
  brake: Float32Array;
  gear: Uint8Array;
  rpm: Float32Array;
  stats: LapStats;
}

interface Geo {
  n: number;
  x: Float64Array;
  y: Float64Array;
  ds: Float64Array;
  k: Float64Array;
  hx: Float64Array;
  hy: Float64Array;
}

interface Env {
  rho: number;
  /** Engine power at the wheels after the altitude correction. */
  ice: number;
  mu: number;
  /** Aero on throttle (straight mode where active) and under braking (always corner mode). */
  claFwd: Float64Array;
  cdaFwd: Float64Array;
  claBrk: Float64Array;
  cdaBrk: Float64Array;
  windPar: Float64Array;
  /** Energy management: full deployment below this speed, none above (m/s). */
  vCut: number;
}

const NO_CLIP = 1000;

/** Share of full deployment at speed v under the current cut-off (1 below it, 0 above). */
function deployShare(env: Env, v: number): number {
  if (env.vCut >= NO_CLIP) return 1;
  const f = (env.vCut + CLIP_BAND * 0.5 - v) / CLIP_BAND;
  return f > 1 ? 1 : f < 0 ? 0 : f;
}

/** MGU-K power used at speed v under the current energy-management cut-off. */
function electric(env: Env, v: number): number {
  return deployLimit(v) * deployShare(env, v);
}

/** Engine power diverted into the battery above the cut-off (super clipping). */
function superClip(env: Env, v: number): number {
  return env.vCut >= NO_CLIP ? 0 : ERS.superClip * (1 - deployShare(env, v));
}

function resample(pts: Float64Array): { x: Float64Array; y: Float64Array; n: number } {
  const m = pts.length / 2;
  // Closed polyline: the lap closes from the last point back to the first
  // along the start/finish line.
  let total = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === m ? 0 : i + 1;
    const dx = pts[j * 2] - pts[i * 2];
    const dy = pts[j * 2 + 1] - pts[i * 2 + 1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  const n = Math.max(64, Math.round(total / SAMPLE_SPACING));
  const h = total / n;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let seg = 0;
  let segStart = 0;
  let ax = pts[0], ay = pts[1];
  let bx = pts[2], by = pts[3];
  let segLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  for (let i = 0; i < n; i++) {
    const target = i * h;
    while (target > segStart + segLen && seg < m - 1) {
      segStart += segLen;
      seg++;
      const j = seg + 1 === m ? 0 : seg + 1;
      ax = pts[seg * 2];
      ay = pts[seg * 2 + 1];
      bx = pts[j * 2];
      by = pts[j * 2 + 1];
      segLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    }
    const u = segLen > 0 ? (target - segStart) / segLen : 0;
    x[i] = ax + (bx - ax) * u;
    y[i] = ay + (by - ay) * u;
  }
  return { x, y, n };
}

/** Quartic-kernel circular smoothing with a per-sample window (in samples). */
function smooth(x: Float64Array, y: Float64Array, sigma: Float64Array, spacing: number): { x: Float64Array; y: Float64Array } {
  const n = x.length;
  const ox = new Float64Array(n);
  const oy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hs = (2.5 * sigma[i]) / spacing;
    const K = Math.floor(hs);
    let sw = 0, sx = 0, sy = 0;
    for (let k = -K; k <= K; k++) {
      const r = k / hs;
      const w0 = 1 - r * r;
      const w = w0 * w0;
      let j = i + k;
      if (j < 0) j += n;
      else if (j >= n) j -= n;
      sw += w;
      sx += x[j] * w;
      sy += y[j] * w;
    }
    ox[i] = sx / sw;
    oy[i] = sy / sw;
  }
  return { x: ox, y: oy };
}

function geometry(x: Float64Array, y: Float64Array): Geo {
  const n = x.length;
  const ds = new Float64Array(n);
  const k = new Float64Array(n);
  const hx = new Float64Array(n);
  const hy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const dx = x[j] - x[i];
    const dy = y[j] - y[i];
    ds[i] = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  }
  for (let i = 0; i < n; i++) {
    let a = i - 2;
    if (a < 0) a += n;
    let c = i + 2;
    if (c >= n) c -= n;
    const abx = x[i] - x[a], aby = y[i] - y[a];
    const bcx = x[c] - x[i], bcy = y[c] - y[i];
    const cax = x[a] - x[c], cay = y[a] - y[c];
    const ab = Math.sqrt(abx * abx + aby * aby);
    const bc = Math.sqrt(bcx * bcx + bcy * bcy);
    const ca = Math.sqrt(cax * cax + cay * cay);
    const cross = abx * bcy - aby * bcx;
    const den = ab * bc * ca;
    k[i] = den > 1e-9 ? (2 * cross) / den : 0;
    let p = i - 1;
    if (p < 0) p += n;
    const q = i + 1 === n ? 0 : i + 1;
    const tx = x[q] - x[p];
    const ty = y[q] - y[p];
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    hx[i] = tx / tl;
    hy[i] = ty / tl;
  }
  return { n, x, y, ds, k, hx, hy };
}

function airspeed(v: number, windPar: number): number {
  const va = v - windPar;
  return va > 0 ? va : 0;
}

/** Lateral acceleration capacity (m/s^2) at sample i and speed v. */
function lateralCapacity(env: Env, grip: number, i: number, v: number): number {
  const va = airspeed(v, env.windPar[i]);
  const n = 1 + (0.5 * env.rho * env.claBrk[i] * va * va) / (CAR.mass * G);
  const mu = env.mu * grip * (1 - CAR.loadSensitivity * (n - 1));
  return mu * G * n;
}

function cornerSpeed(env: Env, grip: number, i: number, kAbs: number): number {
  if (kAbs < 1e-7) return CAR.vMax;
  if (lateralCapacity(env, grip, i, CAR.vMax) >= CAR.vMax * CAR.vMax * kAbs) return CAR.vMax;
  let lo = 0, hi = CAR.vMax;
  for (let it = 0; it < BISECT_STEPS; it++) {
    const mid = (lo + hi) * 0.5;
    if (lateralCapacity(env, grip, i, mid) >= mid * mid * kAbs) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Grip-limited speed at every sample (independent of power, so it is computed once per grip state). */
function cornerLimits(geo: Geo, env: Env, grip: Float64Array): Float64Array {
  const n = geo.n;
  const vLat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const kAbs = geo.k[i] < 0 ? -geo.k[i] : geo.k[i];
    vLat[i] = cornerSpeed(env, grip[i], i, kAbs);
  }
  return vLat;
}

function speedProfile(geo: Geo, env: Env, grip: Float64Array, vLat: Float64Array): Float64Array {
  const n = geo.n;
  let i0 = 0;
  for (let i = 1; i < n; i++) if (vLat[i] < vLat[i0]) i0 = i;
  const m = CAR.mass;
  const vf = new Float64Array(n);
  vf[i0] = vLat[i0];
  for (let s = 0; s < n - 1; s++) {
    let i = i0 + s;
    if (i >= n) i -= n;
    const j = i + 1 === n ? 0 : i + 1;
    const v = vf[i];
    const va = airspeed(v, env.windPar[i]);
    const fz = m * G + 0.5 * env.rho * env.claFwd[i] * va * va;
    const nl = fz / (m * G);
    const mu = env.mu * grip[i] * (1 - CAR.loadSensitivity * (nl - 1));
    const cap = mu * G * nl;
    const kAbs = geo.k[i] < 0 ? -geo.k[i] : geo.k[i];
    let u = (v * v * kAbs) / cap;
    if (u > 1) u = 1;
    const avail = Math.sqrt(1 - u * u);
    const fTrac = mu * CAR.tractionShare * fz * avail;
    const fPow = (env.ice + electric(env, v) - superClip(env, v)) / (v > 10 ? v : 10);
    const fDrive = fTrac < fPow ? fTrac : fPow;
    const fDrag = 0.5 * env.rho * env.cdaFwd[i] * va * va;
    const fRoll = CAR.crr * fz;
    const a = (fDrive - fDrag - fRoll) / m;
    const v2 = v * v + 2 * a * geo.ds[i];
    const vn = v2 > 1 ? Math.sqrt(v2) : 1;
    vf[j] = vn < vLat[j] ? vn : vLat[j];
  }
  const vb = new Float64Array(n);
  vb[i0] = vLat[i0];
  for (let s = 0; s < n - 1; s++) {
    let j = i0 - s;
    if (j < 0) j += n;
    const i = j === 0 ? n - 1 : j - 1;
    const v = vb[j];
    const va = airspeed(v, env.windPar[j]);
    const fz = m * G + 0.5 * env.rho * env.claBrk[j] * va * va;
    const nl = fz / (m * G);
    const mu = env.mu * grip[j] * (1 - CAR.loadSensitivity * (nl - 1));
    const cap = mu * G * nl;
    const kAbs = geo.k[j] < 0 ? -geo.k[j] : geo.k[j];
    let u = (v * v * kAbs) / cap;
    if (u > 1) u = 1;
    const avail = Math.sqrt(1 - u * u);
    const fBrake = mu * CAR.brakeShare * fz * avail;
    const fDrag = 0.5 * env.rho * env.cdaBrk[j] * va * va;
    const fRoll = CAR.crr * fz;
    const a = (fBrake + fDrag + fRoll) / m;
    const v2 = v * v + 2 * a * geo.ds[i];
    const vn = Math.sqrt(v2);
    vb[i] = vn < vLat[i] ? vn : vLat[i];
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = vf[i] < vb[i] ? vf[i] : vb[i];
  return out;
}

interface Thermal {
  temp: Float64Array;
  grip: Float64Array;
}

function thermal(geo: Geo, env: Env, v: Float64Array, prevGrip: Float64Array, compound: Compound, track: Track, surface: number): Thermal {
  const spec = COMPOUND_SPECS[compound];
  const meta = track.meta;
  const n = geo.n;
  const temp = new Float64Array(n);
  const grip = new Float64Array(n);
  const rest = (meta.airTemp + meta.trackTemp) * 0.5 + THERMAL.restOffset;
  let T = meta.trackTemp + spec.warm;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    temp[i] = T;
    grip[i] = surface * spec.grip * tyreGrip(spec, T);
    const vi = v[i];
    const vj = v[j];
    const dt = (2 * geo.ds[i]) / (vi + vj);
    const aLat = vi * vi * geo.k[i];
    const aLon = (vj * vj - vi * vi) / (2 * geo.ds[i]);
    const aTot = Math.sqrt(aLat * aLat + aLon * aLon);
    const cap = lateralCapacity(env, prevGrip[i], i, vi);
    let u = aTot / cap;
    if (u > 1.2) u = 1.2;
    const q = (u * aTot * vi) / 1000;
    const cool = THERMAL.coolBase + THERMAL.coolSpeed * vi;
    T += dt * (THERMAL.gain * spec.heat * q - cool * (T - rest));
  }
  return { temp, grip };
}

interface Energy {
  soc: Float64Array;
  deploy: Float64Array;
  regen: Float64Array;
  used: number;
  recovered: number;
  flatAt: number;
  left: number;
  /** Lowest charge reached over the lap (negative means the plan is not sustainable). */
  min: number;
}

/**
 * Battery state around the lap for a speed profile. Deployment shares the load
 * with the engine in proportion to their limits; braking beyond what drag and
 * rolling resistance provide is recovered up to the MGU-K limit and the per-lap
 * cap. Charge is allowed to go negative here so the caller can tell whether a
 * deployment plan is sustainable.
 */
function energy(geo: Geo, env: Env, v: Float64Array, prog: Float64Array): Energy {
  const n = geo.n;
  const m = CAR.mass;
  const soc = new Float64Array(n);
  const deploy = new Float64Array(n);
  const regen = new Float64Array(n);
  let q = ERS.startCharge;
  let recovered = 0;
  let used = 0;
  let flatAt = -1;
  let min = q;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    soc[i] = q;
    const vi = v[i];
    const vj = v[j];
    const dt = (2 * geo.ds[i]) / (vi + vj);
    const aLon = (vj * vj - vi * vi) / (2 * geo.ds[i]);
    const va = airspeed(vi, env.windPar[i]);
    const fz = m * G + 0.5 * env.rho * env.claFwd[i] * va * va;
    const fDrag = 0.5 * env.rho * env.cdaFwd[i] * va * va;
    const fRoll = CAR.crr * fz;
    const need = (m * aLon + fDrag + fRoll) * vi;
    if (need > 0) {
      const kCap = electric(env, vi);
      let e = (need * kCap) / (env.ice + kCap || 1);
      if (e > kCap) e = kCap;
      if (e < 0) e = 0;
      deploy[i] = e;
      q -= e * dt;
      used += e * dt;
      // Super clipping recharges at full throttle above the cut-off.
      let r = superClip(env, vi) * ERS.harvestEfficiency;
      if (r > 0) {
        let room = ERS.capacity - q;
        const lapRoom = ERS.harvestPerLap - recovered;
        if (lapRoom < room) room = lapRoom;
        if (r * dt > room) r = room > 0 ? room / dt : 0;
        regen[i] = r;
        q += r * dt;
        recovered += r * dt;
      }
    } else {
      const vaB = airspeed(vi, env.windPar[i]);
      const fzB = m * G + 0.5 * env.rho * env.claBrk[i] * vaB * vaB;
      const fBrake = -m * aLon - 0.5 * env.rho * env.cdaBrk[i] * vaB * vaB - CAR.crr * fzB;
      if (fBrake > 0) {
        let r = fBrake * vi;
        if (r > ERS.harvest) r = ERS.harvest;
        r *= ERS.harvestEfficiency;
        let room = ERS.capacity - q;
        const lapRoom = ERS.harvestPerLap - recovered;
        if (lapRoom < room) room = lapRoom;
        if (r * dt > room) r = room > 0 ? room / dt : 0;
        regen[i] = r;
        q += r * dt;
        recovered += r * dt;
      }
    }
    if (q < min) min = q;
    if (flatAt < 0 && q < ERS.reserve * 0.3) flatAt = prog[i];
  }
  return { soc, deploy, regen, used, recovered, flatAt, left: q, min };
}

/**
 * Energy management: pick the highest deployment cut-off speed the battery can
 * sustain for the whole lap (never dipping below empty), by bisection.
 */
function solveDeployment(geo: Geo, env: Env, grip: Float64Array, vLat: Float64Array, prog: Float64Array, hint = NO_CLIP): { v: Float64Array; en: Energy } {
  const feasible = (cut: number): { v: Float64Array; en: Energy; ok: boolean } => {
    env.vCut = cut;
    const pv = speedProfile(geo, env, grip, vLat);
    const pe = energy(geo, env, pv, prog);
    return { v: pv, en: pe, ok: pe.min >= 0 };
  };
  const free = feasible(NO_CLIP);
  if (free.ok) return free;
  let lo = 0;
  let hi = CAR.vMax;
  let steps = DEPLOY_BISECT_STEPS;
  // The cut-off barely moves between grip iterations: search near the last one.
  if (hint < NO_CLIP) {
    const a = hint - WARM_WINDOW;
    const b = hint + WARM_WINDOW;
    if (a > 0 && b < CAR.vMax && feasible(a).ok && !feasible(b).ok) {
      lo = a;
      hi = b;
      steps = WARM_STEPS;
    }
  }
  let v = free.v;
  let en = free.en;
  for (let it = 0; it < steps; it++) {
    env.vCut = (lo + hi) * 0.5;
    v = speedProfile(geo, env, grip, vLat);
    en = energy(geo, env, v, prog);
    if (en.min >= 0) lo = env.vCut;
    else hi = env.vCut;
  }
  env.vCut = lo;
  v = speedProfile(geo, env, grip, vLat);
  en = energy(geo, env, v, prog);
  return { v, en };
}

export interface SimOptions {
  /** Override the calibrated surface grip (used by the calibration script). */
  surfaceGrip?: number;
}

export function simulateLap(track: Track, pts: Float64Array, compound: Compound, opts: SimOptions = {}): LapResult {
  const meta = track.meta;
  const surface = opts.surfaceGrip ?? meta.grip;
  const spec = COMPOUND_SPECS[compound];
  const raw = resample(pts);
  const n = raw.n;
  const spacing = (() => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const dx = raw.x[j] - raw.x[i];
      const dy = raw.y[j] - raw.y[i];
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total / n;
  })();

  // Progress along the centreline for sectors, DRS and live deltas.
  const prog = new Float64Array(n);
  {
    const proj: Projection = { seg: 0, s: 0, d: 0, dist: 0 };
    projectNear(track, raw.x[0], raw.y[0], 0, 12, proj);
    let sUn = proj.s > track.length / 2 ? proj.s - track.length : proj.s;
    let sRaw = proj.s;
    let hint = proj.seg;
    prog[0] = sUn;
    for (let i = 1; i < n; i++) {
      projectNear(track, raw.x[i], raw.y[i], hint, 12, proj);
      let d = proj.s - sRaw;
      if (d < -track.length / 2) d += track.length;
      else if (d > track.length / 2) d -= track.length;
      sUn += d;
      sRaw = proj.s;
      hint = proj.seg;
      prog[i] = sUn;
    }
  }

  const aero = AERO[meta.downforce];
  const powerScale = 1 - CAR.altitudePowerLoss * (1 - meta.rho / CAR.rhoRef);
  const env: Env = {
    rho: meta.rho,
    ice: CAR.icePower * (powerScale < 1 ? powerScale : 1),
    mu: CAR.mu,
    claFwd: new Float64Array(n),
    cdaFwd: new Float64Array(n),
    claBrk: new Float64Array(n),
    cdaBrk: new Float64Array(n),
    windPar: new Float64Array(n),
    vCut: NO_CLIP,
  };

  // Pass 1: uniform smoothing to estimate speeds.
  const sigma = new Float64Array(n);
  sigma.fill(SIGMA_INITIAL);
  let path = smooth(raw.x, raw.y, sigma, spacing);
  let geo = geometry(path.x, path.y);
  const zone = new Uint8Array(n);
  const setAero = () => {
    for (let i = 0; i < n; i++) {
      env.windPar[i] = meta.wind[0] * geo.hx[i] + meta.wind[1] * geo.hy[i];
      const kAbs = geo.k[i] < 0 ? -geo.k[i] : geo.k[i];
      let on = 0;
      if (kAbs < 1 / 700) {
        let s = prog[i] % track.length;
        if (s < 0) s += track.length;
        for (const z of meta.straights) {
          if (z[0] <= z[1] ? s >= z[0] && s <= z[1] : s >= z[0] || s <= z[1]) on = 1;
        }
      }
      zone[i] = on;
      env.claBrk[i] = aero.cla;
      env.cdaBrk[i] = aero.cda;
      env.claFwd[i] = on ? aero.cla * CAR.straightDownforce : aero.cla;
      env.cdaFwd[i] = on ? aero.cda * CAR.straightDrag : aero.cda;
    }
  };
  setAero();
  let grip: Float64Array = new Float64Array(n);
  grip.fill(surface * spec.grip);
  let v = speedProfile(geo, env, grip, cornerLimits(geo, env, grip));

  // Pass 2: speed-dependent smoothing, then tyre and battery feedback.
  for (let i = 0; i < n; i++) {
    const sg = SIGMA_PER_SPEED * v[i];
    sigma[i] = sg < SIGMA_MIN ? SIGMA_MIN : sg > SIGMA_MAX ? SIGMA_MAX : sg;
  }
  path = smooth(raw.x, raw.y, sigma, spacing);
  geo = geometry(path.x, path.y);
  setAero();
  let th: Thermal = { temp: new Float64Array(n), grip };
  let solved = solveDeployment(geo, env, grip, cornerLimits(geo, env, grip), prog);
  for (let it = 0; it < FEEDBACK_ITERATIONS; it++) {
    th = thermal(geo, env, solved.v, grip, compound, track, surface);
    grip = th.grip;
    solved = solveDeployment(geo, env, grip, cornerLimits(geo, env, grip), prog, env.vCut);
  }
  v = solved.v;
  const en = solved.en;

  // Time integration.
  const t = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    t[i + 1] = t[i] + (2 * geo.ds[i]) / (v[i] + v[j]);
  }
  const lap = t[n];
  const timeAt = (target: number): number => {
    for (let i = 1; i < n; i++) {
      if (prog[i] >= target) {
        const span = prog[i] - prog[i - 1];
        const f = span > 0 ? (target - prog[i - 1]) / span : 0;
        return t[i - 1] + (t[i] - t[i - 1]) * f;
      }
    }
    return lap;
  };
  const t1 = Math.round(timeAt(track.length / 3) * 1000);
  const t2 = Math.round(timeAt((track.length * 2) / 3) * 1000);
  const timeMs = Math.round(lap * 1000);

  // Telemetry (display only).
  const out: LapResult = {
    compound,
    timeMs,
    sectorsMs: [t1, t2 - t1, timeMs - t2],
    n,
    x: new Float32Array(path.x),
    y: new Float32Array(path.y),
    v: new Float32Array(v),
    t,
    s: new Float32Array(prog),
    latG: new Float32Array(n),
    lonG: new Float32Array(n),
    tyre: new Float32Array(th.temp),
    straight: new Uint8Array(n),
    soc: new Float32Array(en.soc),
    deploy: new Float32Array(en.deploy),
    regen: new Float32Array(en.regen),
    throttle: new Float32Array(n),
    brake: new Float32Array(n),
    gear: new Uint8Array(n),
    rpm: new Float32Array(n),
    stats: {
      topSpeed: 0,
      minSpeed: Infinity,
      avgSpeed: 0,
      maxLatG: 0,
      maxBrakeG: 0,
      tyreMax: -Infinity,
      tyreMin: Infinity,
      distance: 0,
      energyUsed: en.used,
      energyRecovered: en.recovered,
      flatAt: en.flatAt,
      energyLeft: en.left,
      clipSpeed: env.vCut >= NO_CLIP ? Infinity : env.vCut,
    },
  };
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const vi = v[i];
    const aLat = vi * vi * geo.k[i];
    const aLon = (v[j] * v[j] - vi * vi) / (2 * geo.ds[i]);
    out.latG[i] = aLat / G;
    out.lonG[i] = aLon / G;
    const va = airspeed(vi, env.windPar[i]);
    const drag = (0.5 * env.rho * env.cdaFwd[i] * va * va) / CAR.mass;
    if (aLon > 0.3) out.throttle[i] = 1;
    else if (aLon > -drag - 1.5) out.throttle[i] = aLon > -1 ? 0.55 : 0.1;
    else out.brake[i] = Math.min(1, (-aLon - drag) / 35);
    // The wings are flat only while the car is not braking.
    out.straight[i] = zone[i] && out.brake[i] === 0 ? 1 : 0;
    const gr = gearFor(vi);
    out.gear[i] = gr.gear;
    out.rpm[i] = gr.rpm;
    dist += geo.ds[i];
    const st = out.stats;
    if (vi > st.topSpeed) st.topSpeed = vi;
    if (vi < st.minSpeed) st.minSpeed = vi;
    const lat = aLat < 0 ? -aLat / G : aLat / G;
    if (lat > st.maxLatG) st.maxLatG = lat;
    if (-aLon / G > st.maxBrakeG) st.maxBrakeG = -aLon / G;
    if (th.temp[i] > st.tyreMax) st.tyreMax = th.temp[i];
    if (th.temp[i] < st.tyreMin) st.tyreMin = th.temp[i];
  }
  out.stats.distance = dist;
  out.stats.avgSpeed = dist / lap;
  return out;
}
