/**
 * Synth voices, drums, building blocks and the shared mixing graph.
 * Every function takes a BaseAudioContext plus a destination node, so the exact same code
 * drives the live AudioContext and OfflineAudioContext renders (see dev/audio.html).
 * @module audio/instruments
 */

/** MIDI note number -> frequency in Hz. */
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const jitter = (amt) => (Math.random() - 0.5) * 2 * amt;

const perCtx = new WeakMap();
function bag(ctx) {
  let b = perCtx.get(ctx);
  if (!b) { b = { waves: {} }; perCtx.set(ctx, b); }
  return b;
}

/** Deterministic xorshift32 generator so generated buffers are identical every run. */
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Building blocks (also used by sfx.js)

/** @returns {GainNode} */
export function gain(ctx, v = 1) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** @returns {BiquadFilterNode} */
export function filt(ctx, type, freq, q = 0.707, db = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.max(10, Math.min(20000, freq || 1000));
  f.Q.value = q;
  if (db) f.gain.value = db;
  return f;
}

const WAVE_SPECS = {
  warm: [48, (k) => Math.exp(-k / 18) / k],
  reed: [16, (k) => [0, 0.5, 0.9, 1, 0.82, 0.6, 0.4, 0.27, 0.18, 0.12, 0.08, 0.055, 0.04, 0.03, 0.02, 0.015, 0.01][k] || 0],
  flute: [6, (k) => [0, 1, 0.24, 0.09, 0.04, 0.02, 0.01][k] || 0],
  pluck: [24, (k) => Math.pow(k, -1.45) * (k % 2 ? 1 : 0.65)],
  hollow: [21, (k) => (k % 2 ? 1 / k : 0.1 / k)],
  organ: [8, (k) => [0, 1, 0.5, 0.2, 0.25, 0.08, 0.1, 0, 0.06][k] || 0],
};

function periodic(ctx, name) {
  const b = bag(ctx);
  if (!b.waves[name]) {
    const [n, amp] = WAVE_SPECS[name];
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = amp(k);
    b.waves[name] = ctx.createPeriodicWave(real, imag);
  }
  return b.waves[name];
}

/**
 * Oscillator started at `t` and stopped at `end`. `type` is a native type or one of the
 * custom tables: warm, reed, flute, pluck, hollow, organ.
 * @returns {OscillatorNode}
 */
export function osc(ctx, type, freq, t, end) {
  const o = ctx.createOscillator();
  if (WAVE_SPECS[type]) o.setPeriodicWave(periodic(ctx, type));
  else o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(end);
  return o;
}

const noiseData = new Map();
function noiseBuffer(ctx) {
  const b = bag(ctx);
  if (!b.noise) {
    const sr = ctx.sampleRate;
    let data = noiseData.get(sr);
    if (!data) {
      const rnd = prng(0x5eed);
      data = new Float32Array(sr * 2);
      for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
      noiseData.set(sr, data);
    }
    b.noise = ctx.createBuffer(1, data.length, sr);
    b.noise.copyToChannel(data, 0);
  }
  return b.noise;
}

/**
 * Looping white-noise source between `t` and `end` (random read offset so hits differ).
 * @returns {AudioBufferSourceNode}
 */
export function noise(ctx, t, end, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, Math.random() * 1.5);
  s.stop(end);
  return s;
}

/** Attack/decay/sustain/release on an AudioParam; returns the time the release has died away. */
export function adsr(p, t, dur, a, d, s, r, peak) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (s < 1) p.setTargetAtTime(peak * s, t + a, d / 3);
  const off = t + Math.max(dur, a);
  p.setTargetAtTime(0, off, r / 5);
  return off + r;
}

/** Fast attack then exponential decay with time constant `tau`; returns an end time. */
export function perc(p, t, a, tau, peak) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, tau);
  return t + a + tau * 5;
}

/** Delayed vibrato in cents applied to the detune of each oscillator. */
export function vibrato(ctx, oscs, t, end, rate, cents, delay = 0.25) {
  if (!cents) return;
  const lfo = osc(ctx, 'sine', rate, t, end);
  const depth = gain(ctx, 0);
  depth.gain.setValueAtTime(0, t + delay);
  depth.gain.linearRampToValueAtTime(cents, t + delay + 0.45);
  lfo.connect(depth);
  for (const o of oscs) depth.connect(o.detune);
}

/** Symmetric saturation curve for grit on impacts (amount ~1..20). */
export function drive(ctx, amount) {
  const n = 1024;
  const c = new Float32Array(n);
  const k = Math.max(0.001, amount);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  const w = ctx.createWaveShaper();
  w.curve = c;
  w.oversample = '2x';
  return w;
}

// ---------------------------------------------------------------------------------------------
// Shared reverb and master chain

const irData = new Map();
function buildImpulse(sr, seconds, rt60) {
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.014);
  const fadeN = Math.floor(sr * 0.006);
  return [0, 1].map((c) => {
    const ch = new Float32Array(len);
    const rnd = prng(9173 + c * 7919);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr;
      const fc = 900 + 7200 * Math.exp(-tt * 1.7);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (rnd() * 2 - 1 - lp);
      const onset = i - pre < fadeN ? (i - pre) / fadeN : 1;
      ch[i] = (onset * lp * Math.exp((-6.9 * tt) / rt60)) / Math.sqrt(a / (2 - a));
    }
    for (let k = 0; k < 10; k++) {
      const at = pre + Math.floor(sr * (0.003 + rnd() * 0.07));
      ch[at] += (rnd() < 0.5 ? -1 : 1) * (0.8 - k * 0.05);
    }
    return ch;
  });
}

function impulse(ctx) {
  const sr = ctx.sampleRate;
  let chans = irData.get(sr);
  if (!chans) { chans = buildImpulse(sr, 2.8, 2.3); irData.set(sr, chans); }
  const buf = ctx.createBuffer(2, chans[0].length, sr);
  buf.copyToChannel(chans[0], 0);
  buf.copyToChannel(chans[1], 1);
  return buf;
}

function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    c[i] = Math.sign(x) * (ax < 0.8 ? ax : 0.8 + 0.18 * Math.tanh((ax - 0.8) / 0.18));
  }
  return c;
}

function setParams(node, values) {
  for (const k in values) node[k].value = values[k];
}

/** Headroom for the orchestra so full-volume music rarely reaches the limiter. */
const MUSIC_TRIM = 0.8;

/**
 * @typedef {object} Mixer
 * @property {BaseAudioContext} ctx
 * @property {GainNode} master    mute stage, feeds compressor -> limiter -> safety clipper
 * @property {GainNode} musicDry  music volume (dry path)
 * @property {GainNode} musicWet  music volume (reverb send path)
 * @property {GainNode} sfxDry    sfx volume (dry path)
 * @property {GainNode} sfxWet    sfx volume (reverb send path)
 * @property {AudioParam[]} duck  music ducking gains (dry + wet)
 */

/**
 * Build the shared graph: music/sfx buses, one procedural convolution reverb, gentle
 * compressor, limiter and a soft clipper that keeps the output below full scale.
 * @param {BaseAudioContext} ctx
 * @param {{raw?: boolean}} [opts] raw: skip the master dynamics (level calibration only)
 * @returns {Mixer}
 */
export function createMixer(ctx, opts = {}) {
  const master = gain(ctx, 1);
  if (opts.raw) master.connect(ctx.destination);
  else {
    const lowCut = filt(ctx, 'highpass', 30, 0.6);
    const shelf = filt(ctx, 'highshelf', 6500, 0.707, -3);
    const comp = ctx.createDynamicsCompressor();
    setParams(comp, { threshold: -14, knee: 12, ratio: 2.2, attack: 0.015, release: 0.3 });
    const lim = ctx.createDynamicsCompressor();
    setParams(lim, { threshold: -3, knee: 0, ratio: 20, attack: 0.0015, release: 0.12 });
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    master.connect(lowCut).connect(shelf).connect(comp).connect(lim).connect(clip).connect(ctx.destination);
  }

  const verbIn = gain(ctx, 1);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx);
  verbIn.connect(filt(ctx, 'highpass', 170, 0.6)).connect(filt(ctx, 'lowpass', 6000, 0.6))
    .connect(conv).connect(gain(ctx, 0.85)).connect(master);

  const musicDry = gain(ctx), musicWet = gain(ctx);
  const duckDry = gain(ctx), duckWet = gain(ctx);
  musicDry.connect(duckDry).connect(gain(ctx, MUSIC_TRIM)).connect(master);
  musicWet.connect(duckWet).connect(gain(ctx, MUSIC_TRIM)).connect(verbIn);
  const sfxDry = gain(ctx), sfxWet = gain(ctx);
  sfxDry.connect(master);
  sfxWet.connect(verbIn);
  return { ctx, master, musicDry, musicWet, sfxDry, sfxWet, duck: [duckDry.gain, duckWet.gain] };
}

// ---------------------------------------------------------------------------------------------
// Melodic voices. Signature: (ctx, out, t, midi, durSeconds, velocity 0..1, partOptions) -> endTime

function strings(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m);
  const a = o.attack ?? 0.32, r = o.release ?? 0.9;
  const end = t + Math.max(dur, a) + r;
  const cut = Math.min(7000, (700 + 2600 * v) * (o.bright ?? 1) + f * 1.2);
  const lp = filt(ctx, 'lowpass', cut, 0.5);
  lp.frequency.setValueAtTime(cut * 0.45, t);
  lp.frequency.linearRampToValueAtTime(cut, t + a * 1.2);
  const n = o.voices ?? 3, spread = o.spread ?? 10;
  const oscs = [];
  for (let i = 0; i < n; i++) {
    const s = osc(ctx, 'warm', f, t, end);
    s.detune.setValueAtTime((n > 1 ? -spread + (2 * spread * i) / (n - 1) : 0) + jitter(2), t);
    s.connect(lp);
    oscs.push(s);
  }
  vibrato(ctx, oscs, t, end, 5 + Math.random() * 0.8, o.vib ?? 6, Math.min(0.5, dur * 0.4));
  const g = gain(ctx, 0);
  lp.connect(g).connect(out);
  adsr(g.gain, t, dur, a, 0.4, 0.85, r, ((o.level ?? 0.12) * v) / Math.sqrt(n));
  return end;
}

function strlead(ctx, out, t, m, dur, v, o = {}) {
  return strings(ctx, out, t, m, dur, v, { attack: 0.07, release: 0.4, vib: 12, voices: 2, spread: 6, bright: 1.2, level: 0.2, ...o });
}

function lowstr(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), r = o.release ?? 0.12;
  const end = t + dur + r;
  const lp = filt(ctx, 'lowpass', 1000, 1.1);
  lp.frequency.setValueAtTime(Math.min(4200, f * (6 + 6 * v)), t);
  lp.frequency.setTargetAtTime(f * 2.5 + 220, t + 0.012, 0.09);
  for (const d of [-7, 6]) {
    const s = osc(ctx, 'warm', f, t, end);
    s.detune.setValueAtTime(d, t);
    s.connect(lp);
  }
  const g = gain(ctx, 0);
  lp.connect(g).connect(out);
  adsr(g.gain, t, dur, 0.008, 0.14, 0.6, r, 0.17 * v);
  return end;
}

function bass(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), a = o.attack ?? 0.02, r = o.release ?? 0.22;
  const end = t + Math.max(dur, a) + r;
  const g = gain(ctx, 0);
  const sub = osc(ctx, 'sine', f, t, end);
  const subG = gain(ctx, 0.55);
  sub.connect(subG).connect(g);
  const body = osc(ctx, 'warm', f, t, end);
  const lp = filt(ctx, 'lowpass', f * 3 + 160, 0.9);
  body.connect(lp).connect(g);
  g.connect(out);
  adsr(g.gain, t, dur, a, 0.35, 0.8, r, 0.14 * v);
  return end;
}

function brass(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), a = o.attack ?? 0.035, r = o.release ?? 0.18;
  const end = t + Math.max(dur, a) + r;
  const br = o.bright ?? 1;
  const lp = filt(ctx, 'lowpass', f, 1.3);
  lp.frequency.setValueAtTime(f * 1.1, t);
  lp.frequency.linearRampToValueAtTime(Math.min(5200, f * (2.2 + 5 * v) * br), t + a + 0.03);
  lp.frequency.setTargetAtTime(Math.min(3800, f * (1.6 + 2.6 * v) * br), t + a + 0.03, 0.2);
  const oscs = [-6, 5].map((d) => {
    const s = osc(ctx, o.wave ?? 'sawtooth', f, t, end);
    s.detune.setValueAtTime(d - 28, t);
    s.detune.linearRampToValueAtTime(d, t + 0.05);
    s.connect(lp);
    return s;
  });
  vibrato(ctx, oscs, t, end, 5.1, o.vib ?? 4, 0.35);
  const g = gain(ctx, 0);
  lp.connect(g).connect(out);
  adsr(g.gain, t, dur, a, 0.25, 0.78, r, (o.level ?? 0.2) * v);
  return end;
}

function horn(ctx, out, t, m, dur, v, o = {}) {
  return brass(ctx, out, t, m, dur, v, { wave: 'warm', bright: 0.6, attack: 0.06, release: 0.3, vib: 3, level: 0.15, ...o });
}

function flute(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), a = o.attack ?? 0.05, r = o.release ?? 0.16;
  const end = t + Math.max(dur, a) + r;
  const g = gain(ctx, 0);
  const tone = osc(ctx, 'flute', f, t, end);
  tone.connect(g);
  const breathG = gain(ctx, 0);
  noise(ctx, t, end).connect(filt(ctx, 'bandpass', Math.min(9000, f * 2), 1.3)).connect(breathG).connect(g);
  breathG.gain.setValueAtTime(0.4, t);
  breathG.gain.setTargetAtTime(0.08, t + 0.03, 0.06);
  vibrato(ctx, [tone], t, end, 5.3, o.vib ?? 13, Math.min(0.35, dur * 0.5));
  g.connect(out);
  adsr(g.gain, t, dur, a, 0.2, 0.9, r, 0.18 * v);
  return end;
}

function oboe(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), a = o.attack ?? 0.035, r = o.release ?? 0.12;
  const end = t + Math.max(dur, a) + r;
  const tone = osc(ctx, 'reed', f, t, end);
  vibrato(ctx, [tone], t, end, 5.7, o.vib ?? 10, Math.min(0.3, dur * 0.5));
  const g = gain(ctx, 0);
  tone.connect(filt(ctx, 'peaking', 1450, 1.2, 4)).connect(filt(ctx, 'lowpass', 4800, 0.7)).connect(g).connect(out);
  adsr(g.gain, t, dur, a, 0.2, 0.88, r, 0.25 * v);
  return end;
}

function pluck(ctx, out, t, m, v, o) {
  const f = mtof(m);
  const tau = o.decay;
  const end = t + tau * 4.6 + 0.02;
  const top = Math.min(9000, f * o.bright), low = Math.min(top, f * o.dark + 80);
  const lp = filt(ctx, 'lowpass', top, o.q ?? 0.8);
  lp.frequency.setValueAtTime(top, t);
  lp.frequency.setTargetAtTime(low, t + 0.004, o.tone ?? 0.12);
  const detunes = o.course ? [-4, 4] : [0];
  for (const d of detunes) {
    const s = osc(ctx, o.wave ?? 'pluck', f, t, end);
    s.detune.setValueAtTime(d + (o.twang ?? 0), t);
    if (o.twang) s.detune.setTargetAtTime(d, t + 0.005, 0.02);
    s.connect(lp);
  }
  const g = gain(ctx, 0);
  let tail = lp.connect(g);
  if (o.body) tail = tail.connect(filt(ctx, 'peaking', o.body, 1.4, 5));
  tail.connect(out);
  perc(g.gain, t, 0.003, tau, ((o.level ?? 0.3) * v) / Math.sqrt(detunes.length));
  return end;
}

function harp(ctx, out, t, m, dur, v, o = {}) {
  return pluck(ctx, out, t, m, v, { decay: 0.22 + 0.45 * clamp01((86 - m) / 50), bright: 9, dark: 2.4, tone: 0.18, wave: 'pluck', level: 0.26, ...o });
}

function pizz(ctx, out, t, m, dur, v, o = {}) {
  return pluck(ctx, out, t, m, v, { decay: 0.09 + 0.08 * clamp01((80 - m) / 40), bright: 6, dark: 1.6, tone: 0.05, wave: 'warm', level: 0.46, ...o });
}

function lute(ctx, out, t, m, dur, v, o = {}) {
  return pluck(ctx, out, t, m, v, { decay: 0.2 + 0.2 * clamp01((80 - m) / 40), bright: 7, dark: 2.2, tone: 0.1, course: true, twang: 14, body: 1100, level: 0.26, ...o });
}

function bell(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), dec = o.decay ?? 0.7;
  const parts = [[1, 1, 1], [2.76, 0.32, 0.45], [5.4, 0.14, 0.25], [8.93, 0.05, 0.15]];
  let end = t;
  for (const [ratio, amp, life] of parts) {
    if (f * ratio > Math.min(16000, ctx.sampleRate * 0.45)) continue;
    const g = gain(ctx, 0);
    const e = perc(g.gain, t, 0.002, dec * life, (o.level ?? 0.2) * v * amp);
    osc(ctx, 'sine', f * ratio, t, e).connect(g).connect(out);
    end = Math.max(end, e);
  }
  return end;
}

const VOWELS = { ah: [760, 1180, 2600], oh: [520, 880, 2450], oo: [360, 760, 2300], eh: [560, 1650, 2500] };

function choir(ctx, out, t, m, dur, v, o = {}) {
  const f = mtof(m), a = o.attack ?? 0.45, r = o.release ?? 1.0;
  const end = t + Math.max(dur, a) + r;
  const [f1, f2, f3] = VOWELS[o.vowel ?? 'ah'];
  const src = gain(ctx, 1);
  const oscs = [-9, 0, 8].map((d) => {
    const s = osc(ctx, 'sawtooth', f, t, end);
    s.detune.setValueAtTime(d + jitter(3), t);
    s.connect(src);
    return s;
  });
  vibrato(ctx, oscs, t, end, 4.6 + Math.random() * 0.8, o.vib ?? 9, 0.3);
  const g = gain(ctx, 0);
  src.connect(filt(ctx, 'peaking', f1, 3.5, 12)).connect(filt(ctx, 'peaking', f2, 5, 10))
    .connect(filt(ctx, 'peaking', f3, 6, 6)).connect(filt(ctx, 'lowpass', 2900, 0.6)).connect(g).connect(out);
  adsr(g.gain, t, dur, a, 0.5, 0.9, r, (o.level ?? 0.045) * v);
  return end;
}

// ---------------------------------------------------------------------------------------------
// Percussion (midi is used for pitched drums, ignored otherwise)

function kick(ctx, out, t, m, dur, v) {
  const g = gain(ctx, 0);
  const end = perc(g.gain, t, 0.002, 0.12, 0.85 * v);
  const s = osc(ctx, 'sine', 150, t, end);
  s.frequency.exponentialRampToValueAtTime(46, t + 0.12);
  s.connect(g).connect(out);
  const cg = gain(ctx, 0);
  noise(ctx, t, t + 0.04).connect(filt(ctx, 'highpass', 1600)).connect(cg).connect(out);
  perc(cg.gain, t, 0.001, 0.006, 0.2 * v);
  return end;
}

function snare(ctx, out, t, m, dur, v, o = {}) {
  const tg = gain(ctx, 0);
  const toneEnd = perc(tg.gain, t, 0.002, 0.045, 0.42 * v);
  const s = osc(ctx, 'triangle', 205, t, toneEnd);
  s.frequency.exponentialRampToValueAtTime(165, t + 0.06);
  s.connect(tg).connect(out);
  const ng = gain(ctx, 0);
  const end = perc(ng.gain, t, 0.002, o.snappy ?? 0.07, 0.5 * v);
  noise(ctx, t, end).connect(filt(ctx, 'highpass', 1400, 0.7)).connect(filt(ctx, 'lowpass', 7800, 0.7))
    .connect(ng).connect(out);
  return Math.max(end, toneEnd);
}

function hat(ctx, out, t, m, dur, v, o = {}) {
  const g = gain(ctx, 0);
  const end = perc(g.gain, t, 0.001, o.open ? 0.11 : 0.028, 0.9 * v);
  noise(ctx, t, end).connect(filt(ctx, 'bandpass', 8200, 0.9)).connect(filt(ctx, 'highpass', 5500))
    .connect(g).connect(out);
  return end;
}

function shaker(ctx, out, t, m, dur, v) {
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.75 * v, t + 0.014);
  g.gain.setTargetAtTime(0, t + 0.014, 0.035);
  const end = t + 0.2;
  noise(ctx, t, end).connect(filt(ctx, 'bandpass', 6200, 1.1)).connect(filt(ctx, 'highpass', 3600))
    .connect(g).connect(out);
  return end;
}

function crash(ctx, out, t, m, dur, v) {
  const g = gain(ctx, 0);
  const end = perc(g.gain, t, 0.003, 0.6, 0.4 * v);
  noise(ctx, t, end).connect(filt(ctx, 'highpass', 2600, 0.6)).connect(filt(ctx, 'lowpass', 8800, 0.6))
    .connect(g).connect(out);
  const sg = gain(ctx, 0);
  const ringEnd = perc(sg.gain, t, 0.01, 0.9, 0.12 * v);
  noise(ctx, t, ringEnd).connect(filt(ctx, 'bandpass', 5200, 3)).connect(sg).connect(out);
  return Math.max(end, ringEnd);
}

function suscym(ctx, out, t, m, dur, v) {
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0.0005, t);
  g.gain.exponentialRampToValueAtTime(0.6 * v, t + Math.max(0.1, dur));
  g.gain.setTargetAtTime(0, t + Math.max(0.1, dur), 0.1);
  const end = t + dur + 0.6;
  noise(ctx, t, end).connect(filt(ctx, 'bandpass', 5200, 0.55)).connect(filt(ctx, 'highpass', 1800))
    .connect(g).connect(out);
  return end;
}

function tom(ctx, out, t, m, dur, v) {
  const f = m ? mtof(m) : 82;
  const g = gain(ctx, 0);
  const end = perc(g.gain, t, 0.003, 0.2, 0.75 * v);
  const s = osc(ctx, 'sine', f * 1.7, t, end);
  s.frequency.exponentialRampToValueAtTime(f, t + 0.1);
  s.connect(g).connect(out);
  const ng = gain(ctx, 0);
  noise(ctx, t, t + 0.15).connect(filt(ctx, 'lowpass', 1100)).connect(ng).connect(out);
  perc(ng.gain, t, 0.002, 0.03, 0.45 * v);
  return end;
}

const TIMP_MODES = [[1, 1, 0.55], [1.5, 0.4, 0.3], [1.98, 0.22, 0.2], [2.44, 0.1, 0.14]];

function timpani(ctx, out, t, m, dur, v) {
  const f = mtof(m);
  let end = t;
  for (const [ratio, amp, tau] of TIMP_MODES) {
    const g = gain(ctx, 0);
    const e = perc(g.gain, t, 0.004, tau * (0.7 + 0.6 * v), 0.3 * v * amp);
    const s = osc(ctx, 'sine', f * ratio * 1.035, t, e);
    s.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.09);
    s.connect(g).connect(out);
    end = Math.max(end, e);
  }
  const ng = gain(ctx, 0);
  noise(ctx, t, t + 0.12).connect(filt(ctx, 'bandpass', f * 4, 0.8)).connect(ng).connect(out);
  perc(ng.gain, t, 0.002, 0.025, 0.25 * v);
  return end;
}

/** A whole timpani roll in one voice: drum tone + stick noise with tremolo, swelling over the note. */
function timproll(ctx, out, t, m, dur, v) {
  const f = mtof(m), end = t + dur + 1.6;
  const g = gain(ctx, 0);
  osc(ctx, 'sine', f, t, end).connect(g);
  osc(ctx, 'sine', f * 1.5, t, end).connect(gain(ctx, 0.3)).connect(g);
  noise(ctx, t, end).connect(filt(ctx, 'bandpass', f * 4, 0.9)).connect(gain(ctx, 0.6)).connect(g);
  const trem = gain(ctx, 0.65);
  osc(ctx, 'sine', 12 + Math.random() * 3, t, end).connect(gain(ctx, 0.35)).connect(trem.gain);
  g.connect(trem).connect(out);
  g.gain.setValueAtTime(0.04 * v, t);
  g.gain.linearRampToValueAtTime(0.32 * v, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.3);
  return end;
}

/**
 * Instrument table used by the sequencer. Each entry is
 * `(ctx, destination, time, midi, durationSeconds, velocity0to1, partOptions) => endTime`.
 */
export const INSTRUMENTS = {
  strings, strlead, lowstr, bass, brass, horn, flute, oboe, harp, pizz, lute, bell, choir,
  kick, snare, hat, shaker, crash, suscym, tom, timpani, timproll,
};
