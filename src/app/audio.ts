// Synthesised sound: a V6-turbo style engine note driven by rpm and throttle,
// plus short UI cues. Created lazily on the first user gesture.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio(): void {
  ac();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (master && ctx) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.02);
  if (!on) stopEngine();
}

function blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
  const a = ac();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  tap: () => blip(880, 0.05, 'triangle', 0.06),
  penDown: () => blip(520, 0.07, 'sine', 0.08, 780),
  lift: () => blip(700, 0.05, 'sine', 0.04, 500),
  fail: () => {
    blip(150, 0.32, 'square', 0.12, 70);
    blip(156, 0.32, 'sawtooth', 0.06, 72);
  },
  lapDrawn: () => {
    blip(660, 0.1, 'triangle', 0.09);
    blip(990, 0.16, 'triangle', 0.09, undefined, 0.09);
  },
  sector: (kind: 'purple' | 'green' | 'yellow') => {
    const f = kind === 'purple' ? 1320 : kind === 'green' ? 1100 : 880;
    blip(f, 0.09, 'sine', 0.07);
  },
  finish: (great: boolean) => {
    const notes = great ? [784, 988, 1175, 1568] : [660, 830, 990];
    notes.forEach((n, i) => blip(n, 0.22, 'triangle', 0.09, undefined, i * 0.09));
  },
  lights: (i: number) => blip(i >= 0 ? 600 : 1200, 0.12, 'square', 0.05),
};

// Engine voice.
let eng: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; whine: OscillatorNode; whineGain: GainNode } | null = null;

function shaper(a: AudioContext): WaveShaperNode {
  const ws = a.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.4 * x);
  }
  ws.curve = curve;
  return ws;
}

export function startEngine(): void {
  const a = ac();
  if (!a || !master || eng) return;
  const o1 = a.createOscillator();
  const o2 = a.createOscillator();
  const o3 = a.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'square';
  o3.type = 'sawtooth';
  const mix = a.createGain();
  mix.gain.value = 0.3;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.Q.value = 3;
  const gain = a.createGain();
  gain.gain.value = 0;
  const ws = shaper(a);
  o1.connect(mix);
  o2.connect(mix);
  o3.connect(mix);
  mix.connect(ws).connect(filter).connect(gain).connect(master);
  const whine = a.createOscillator();
  whine.type = 'sine';
  const whineGain = a.createGain();
  whineGain.gain.value = 0;
  whine.connect(whineGain).connect(master);
  o1.start();
  o2.start();
  o3.start();
  whine.start();
  eng = { o1, o2, o3, filter, gain, whine, whineGain };
}

export function updateEngine(rpm: number, throttle: number, speed: number): void {
  const a = ctx;
  if (!a || !eng) return;
  const t = a.currentTime;
  const f = (rpm / 60) * 3; // six cylinders, four-stroke
  eng.o1.frequency.setTargetAtTime(f, t, 0.012);
  eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.012);
  eng.o3.frequency.setTargetAtTime(f * 1.007, t, 0.012);
  eng.filter.frequency.setTargetAtTime(900 + throttle * 2600 + rpm * 0.08, t, 0.03);
  eng.gain.gain.setTargetAtTime(0.05 + throttle * 0.11, t, 0.04);
  eng.whine.frequency.setTargetAtTime(2400 + speed * 18, t, 0.05);
  eng.whineGain.gain.setTargetAtTime(throttle > 0.5 ? 0.006 : 0.012, t, 0.08);
}

export function stopEngine(): void {
  if (!eng || !ctx) return;
  const e = eng;
  eng = null;
  const t = ctx.currentTime;
  e.gain.gain.setTargetAtTime(0, t, 0.08);
  e.whineGain.gain.setTargetAtTime(0, t, 0.08);
  setTimeout(() => {
    for (const o of [e.o1, e.o2, e.o3, e.whine]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
  }, 400);
}

export function buzz(ms: number | number[]): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* unsupported */
  }
}
