/**
 * Procedural sound effects. Each entry renders into any BaseAudioContext:
 * `play(ctx, out, time, pitch, rnd) -> duration in seconds`; `wet` is the reverb send amount.
 * `pitch` scales frequencies and playback rate; `rnd()` returns [0, 1) for small variations.
 * @module audio/sfx
 */
import { gain, filt, osc, noise, drive, vibrato, mtof, INSTRUMENTS } from './instruments.js';

const vary = (rnd, x, amt = 0.04) => x * (1 + (rnd() - 0.5) * 2 * amt);

function ramp(p, t, v0, v1, dur) {
  p.setValueAtTime(v0, t);
  p.exponentialRampToValueAtTime(Math.max(1e-4, v1), t + Math.max(0.005, dur));
}

/** Linear attack, optional hold, exponential tail with time constant `tau`; returns end time. */
function env(p, t, a, hold, tau, peak) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  if (hold > 0) p.setValueAtTime(peak, t + a + hold);
  p.setTargetAtTime(0, t + a + hold, tau);
  return t + a + hold + tau * 5;
}

function tone(ctx, out, t, { type = 'sine', f0, f1 = f0, glide, a = 0.004, hold = 0, tau = 0.05, peak = 0.3 }) {
  const g = gain(ctx, 0);
  const end = env(g.gain, t, a, hold, tau, peak);
  const o = osc(ctx, type, f0, t, end);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + (glide ?? end - t));
  o.connect(g).connect(out);
  return { o, g, end };
}

function hiss(ctx, out, t, { type = 'bandpass', f0, f1 = f0, sweep, q = 1, a = 0.004, hold = 0, tau = 0.05, peak = 0.3, rate = 1 }) {
  const g = gain(ctx, 0);
  const end = env(g.gain, t, a, hold, tau, peak);
  const f = filt(ctx, type, f0, q);
  if (f1 !== f0) ramp(f.frequency, t, f0, f1, sweep ?? end - t);
  noise(ctx, t, end, rate).connect(f).connect(g).connect(out);
  return { f, g, end };
}

/** Rise-then-fall band sweep, the basis of whooshes. */
function whoosh(ctx, out, t, d, lo, hi, end, q, peak) {
  const { f } = hiss(ctx, out, t, { f0: lo, q, a: d * 0.45, tau: d * 0.15, peak });
  f.frequency.setValueAtTime(lo, t);
  f.frequency.exponentialRampToValueAtTime(hi, t + d * 0.5);
  f.frequency.exponentialRampToValueAtTime(end, t + d);
  return t + d + 0.1;
}

function chime(ctx, out, t, f, peak = 0.2, dec = 0.5) {
  let end = t;
  for (const [ratio, amp, life] of [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.18, 0.3]]) {
    if (f * ratio > Math.min(15000, ctx.sampleRate * 0.45)) continue;
    end = Math.max(end, tone(ctx, out, t, { f0: f * ratio, a: 0.002, tau: dec * life, peak: peak * amp }).end);
  }
  return end;
}

function metal(ctx, out, t, base, ratios, peak, tau) {
  let end = t;
  ratios.forEach((ratio, i) => {
    end = Math.max(end, tone(ctx, out, t, { f0: base * ratio, a: 0.001, tau: tau / (1 + i * 0.35), peak: peak / (1 + i * 0.5) }).end);
  });
  return end;
}

/** Stick-slip creak: a slow sawtooth exciting a sweeping resonance. */
function creak(ctx, out, t, d, f0, f1, peak, rnd) {
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + d * 0.2);
  g.gain.setValueAtTime(peak, t + d * 0.8);
  g.gain.linearRampToValueAtTime(0, t + d);
  const bp = filt(ctx, 'bandpass', f0, 7);
  ramp(bp.frequency, t, f0, f1, d);
  const saw = osc(ctx, 'sawtooth', vary(rnd, 34, 0.15), t, t + d + 0.02);
  saw.frequency.linearRampToValueAtTime(vary(rnd, 55, 0.15), t + d);
  saw.connect(bp).connect(g).connect(out);
  return t + d;
}

/** @type {Record<string, {wet: number, gain?: number, play: Function}>} */
export const SFX_DEFS = {
  cursor: { wet: 0.04, gain: 0.9, play(ctx, out, t, k, rnd) {
    const f = vary(rnd, 1450, 0.02) * k;
    tone(ctx, out, t, { type: 'triangle', f0: f, f1: f * 1.08, a: 0.002, tau: 0.012, peak: 0.16 });
    return tone(ctx, out, t, { f0: f * 2, a: 0.002, tau: 0.008, peak: 0.05 }).end - t;
  } },
  select: { wet: 0.08, gain: 1.6, play(ctx, out, t, k, rnd) {
    const f = vary(rnd, 880, 0.02) * k;
    tone(ctx, out, t, { type: 'triangle', f0: f, a: 0.002, tau: 0.02, peak: 0.18 });
    return tone(ctx, out, t + 0.055 / k, { type: 'triangle', f0: f * 1.5, a: 0.002, tau: 0.03, peak: 0.18 }).end - t;
  } },
  confirm: { wet: 0.2, play(ctx, out, t, k) {
    const f = mtof(84) * k;
    chime(ctx, out, t, f, 0.16, 0.18);
    tone(ctx, out, t, { type: 'triangle', f0: f / 2, a: 0.003, tau: 0.04, peak: 0.08 });
    return chime(ctx, out, t + 0.07 / k, f * 1.5, 0.18, 0.3) - t;
  } },
  cancel: { wet: 0.08, gain: 2, play(ctx, out, t, k, rnd) {
    const lp = filt(ctx, 'lowpass', 2200, 0.7);
    lp.connect(out);
    const f = vary(rnd, 660, 0.02) * k;
    tone(ctx, lp, t, { type: 'square', f0: f, a: 0.003, tau: 0.02, peak: 0.1 });
    return tone(ctx, lp, t + 0.06 / k, { type: 'square', f0: f * 0.667, f1: f * 0.6, a: 0.003, tau: 0.035, peak: 0.1 }).end - t;
  } },
  menu: { wet: 0.1, gain: 1.3, play(ctx, out, t, k) {
    hiss(ctx, out, t, { f0: 700 * k, f1: 2600 * k, sweep: 0.1 / k, q: 1.2, a: 0.03 / k, tau: 0.03 / k, peak: 0.25 });
    return tone(ctx, out, t + 0.02 / k, { f0: 520 * k, f1: 780 * k, glide: 0.06 / k, tau: 0.03 / k, peak: 0.14 }).end - t;
  } },
  error: { wet: 0.05, gain: 1.4, play(ctx, out, t, k) {
    const lp = filt(ctx, 'lowpass', 1100, 0.9);
    lp.connect(out);
    let end = t;
    for (let i = 0; i < 2; i++) {
      const at = t + (i * 0.13) / k;
      tone(ctx, lp, at, { type: 'square', f0: 185 * k, a: 0.004, hold: 0.06 / k, tau: 0.015, peak: 0.13 });
      end = tone(ctx, lp, at, { type: 'sawtooth', f0: 191 * k, a: 0.004, hold: 0.06 / k, tau: 0.015, peak: 0.08 }).end;
    }
    return end - t;
  } },
  step: { wet: 0.06, gain: 0.7, play(ctx, out, t, k, rnd) {
    hiss(ctx, out, t, { type: 'lowpass', f0: vary(rnd, 700, 0.25) * k, q: 0.8, a: 0.003, tau: 0.03, peak: 0.4 });
    return tone(ctx, out, t, { f0: vary(rnd, 120, 0.1) * k, f1: 60 * k, glide: 0.06, a: 0.003, tau: 0.03, peak: 0.3 }).end - t;
  } },
  swing: { wet: 0.12, gain: 1.4, play(ctx, out, t, k, rnd) {
    return whoosh(ctx, out, t, vary(rnd, 0.24, 0.1) / k, 500 * k, 2800 * k, 900 * k, 1.6, 0.5) - t;
  } },
  hit: { wet: 0.12, play(ctx, out, t, k, rnd) {
    const sat = drive(ctx, 2.5);
    sat.connect(out);
    hiss(ctx, sat, t, { f0: vary(rnd, 1800, 0.15) * k, q: 0.7, a: 0.002, tau: 0.035, peak: 0.5 });
    tone(ctx, sat, t, { f0: 170 * k, f1: 55 * k, glide: 0.1, a: 0.002, tau: 0.06, peak: 0.55 });
    hiss(ctx, out, t, { type: 'highpass', f0: 3000 * k, a: 0.001, tau: 0.012, peak: 0.2 });
    return 0.35;
  } },
  heavyHit: { wet: 0.18, gain: 1.25, play(ctx, out, t, k) {
    const sat = drive(ctx, 4);
    sat.connect(gain(ctx, 0.8)).connect(out);
    tone(ctx, sat, t, { f0: 130 * k, f1: 38 * k, glide: 0.25, a: 0.002, tau: 0.12, peak: 0.7 });
    hiss(ctx, sat, t, { type: 'lowpass', f0: 3500 * k, f1: 300 * k, sweep: 0.2, q: 0.8, a: 0.002, tau: 0.08, peak: 0.6 });
    hiss(ctx, out, t, { f0: 2500 * k, q: 1, a: 0.001, tau: 0.02, peak: 0.25 });
    return 0.7;
  } },
  crit: { wet: 0.25, play(ctx, out, t, k, rnd) {
    whoosh(ctx, out, t, 0.14 / k, 900 * k, 4000 * k, 2000 * k, 1.4, 0.35);
    const t1 = t + 0.09 / k;
    SFX_DEFS.heavyHit.play(ctx, out, t1, k, rnd);
    metal(ctx, out, t1, 1250 * k, [1, 1.69, 2.43, 3.11], 0.12, 0.35);
    hiss(ctx, out, t1, { type: 'highpass', f0: 5000, a: 0.002, tau: 0.12, peak: 0.15 });
    return 1.1;
  } },
  miss: { wet: 0.15, gain: 1.5, play(ctx, out, t, k) {
    const d = 0.3 / k;
    const { f } = hiss(ctx, out, t, { f0: 900 * k, q: 2.2, a: d * 0.5, tau: d * 0.15, peak: 0.3 });
    ramp(f.frequency, t, 900 * k, 3800 * k, d);
    tone(ctx, out, t + d * 0.6, { type: 'triangle', f0: 1200 * k, f1: 700 * k, glide: 0.12, a: 0.01, tau: 0.04, peak: 0.06 });
    return d + 0.2;
  } },
  block: { wet: 0.2, play(ctx, out, t, k, rnd) {
    metal(ctx, out, t, vary(rnd, 620, 0.05) * k, [1, 2.16, 3.56, 5.1], 0.22, 0.12);
    hiss(ctx, out, t, { type: 'highpass', f0: 2500 * k, a: 0.001, tau: 0.015, peak: 0.35 });
    tone(ctx, out, t, { f0: 200 * k, f1: 120 * k, glide: 0.05, a: 0.002, tau: 0.03, peak: 0.3 });
    return 0.6;
  } },
  bowDraw: { wet: 0.1, gain: 2, play(ctx, out, t, k, rnd) {
    const d = 0.5 / k;
    creak(ctx, out, t, d, 320 * k, 760 * k, 0.5, rnd);
    tone(ctx, out, t, { type: 'triangle', f0: 140 * k, f1: 195 * k, glide: d, a: d * 0.8, tau: 0.03, peak: 0.05 });
    return d + 0.2;
  } },
  arrow: { wet: 0.12, gain: 1.4, play(ctx, out, t, k) {
    tone(ctx, out, t, { type: 'triangle', f0: 210 * k, f1: 190 * k, glide: 0.1, a: 0.002, tau: 0.05, peak: 0.3 });
    const d = 0.32 / k;
    const { f } = hiss(ctx, out, t + 0.02, { f0: 3200 * k, q: 3, a: 0.03, tau: d / 4, peak: 0.35 });
    ramp(f.frequency, t + 0.02, 3200 * k, 1300 * k, d);
    return d + 0.1;
  } },
  arrowHit: { wet: 0.1, play(ctx, out, t, k, rnd) {
    hiss(ctx, out, t, { type: 'lowpass', f0: vary(rnd, 1000, 0.15) * k, a: 0.001, tau: 0.02, peak: 0.45 });
    tone(ctx, out, t, { type: 'triangle', f0: 260 * k, f1: 160 * k, glide: 0.05, a: 0.001, tau: 0.03, peak: 0.35 });
    tone(ctx, out, t + 0.012, { f0: 520 * k, a: 0.001, tau: 0.05, peak: 0.08 });
    return 0.28;
  } },
  fire: { wet: 0.25, play(ctx, out, t, k, rnd) {
    const d = 1.1 / k;
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.12 / k);
    g.gain.setValueAtTime(0.5, t + d * 0.4);
    g.gain.setTargetAtTime(0, t + d * 0.4, d * 0.15);
    const f = filt(ctx, 'lowpass', 400 * k, 1.2);
    f.frequency.setValueAtTime(400 * k, t);
    f.frequency.exponentialRampToValueAtTime(2600 * k, t + 0.15 / k);
    f.frequency.exponentialRampToValueAtTime(700 * k, t + d);
    const flicker = gain(ctx, 0.75);
    osc(ctx, 'sine', 9 + rnd() * 4, t, t + d + 0.1).connect(gain(ctx, 0.25)).connect(flicker.gain);
    noise(ctx, t, t + d + 0.1, 0.8).connect(f).connect(flicker).connect(g).connect(out);
    for (let i = 0; i < 14; i++) {
      hiss(ctx, out, t + rnd() * d * 0.8, { type: 'highpass', f0: 2500 + rnd() * 3000, a: 0.001, tau: 0.004 + rnd() * 0.006, peak: 0.15 + rnd() * 0.2 });
    }
    return d + 0.15;
  } },
  explosion: { wet: 0.3, play(ctx, out, t, k, rnd) {
    const sat = drive(ctx, 3);
    sat.connect(out);
    tone(ctx, sat, t, { f0: 95 * k, f1: 28 * k, glide: 0.7, a: 0.004, tau: 0.3, peak: 0.75 });
    hiss(ctx, sat, t, { type: 'lowpass', f0: 3200 * k, f1: 160 * k, sweep: 1.0, q: 0.9, a: 0.004, tau: 0.32, peak: 0.8 });
    for (let i = 0; i < 8; i++) {
      hiss(ctx, out, t + 0.1 + rnd() * 0.7, { f0: 900 + rnd() * 2500, q: 2, a: 0.002, tau: 0.02 + rnd() * 0.03, peak: 0.08 + rnd() * 0.1 });
    }
    return 1.7;
  } },
  ice: { wet: 0.35, gain: 1.6, play(ctx, out, t, k, rnd) {
    tone(ctx, out, t, { type: 'triangle', f0: 2600 * k, f1: 1300 * k, glide: 0.5, a: 0.01, tau: 0.12, peak: 0.1 });
    for (let i = 0; i < 7; i++) chime(ctx, out, t + (i * 0.06 + rnd() * 0.04) / k, (1800 + rnd() * 2600) * k, 0.07, 0.25);
    hiss(ctx, out, t, { type: 'highpass', f0: 6000, a: 0.15, tau: 0.15, peak: 0.08 });
    return 1.0;
  } },
  shatter: { wet: 0.25, gain: 1.4, play(ctx, out, t, k, rnd) {
    hiss(ctx, out, t, { type: 'highpass', f0: 2500 * k, a: 0.001, tau: 0.03, peak: 0.4 });
    for (let i = 0; i < 16; i++) {
      hiss(ctx, out, t + (rnd() * 0.35) / k, { f0: (2500 + rnd() * 6000) * k, q: 6 + rnd() * 6, a: 0.001, tau: 0.01 + rnd() * 0.03, peak: 0.25 + rnd() * 0.3 });
    }
    for (let i = 0; i < 5; i++) chime(ctx, out, t + (0.05 + rnd() * 0.4) / k, (2500 + rnd() * 2500) * k, 0.05, 0.12);
    return 0.85;
  } },
  thunder: { wet: 0.4, play(ctx, out, t, k, rnd) {
    const d = 2.1 / k;
    hiss(ctx, out, t, { type: 'highpass', f0: 1200 * k, a: 0.001, tau: 0.05, peak: 0.55 });
    hiss(ctx, out, t + 0.06, { f0: 2200 * k, q: 0.8, a: 0.001, tau: 0.08, peak: 0.4 });
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.12);
    g.gain.setTargetAtTime(0, t + 0.3, d * 0.28);
    const am = gain(ctx, 0.6);
    for (let i = 0, at = t + 0.15; i < 6; i++, at += (0.15 + rnd() * 0.25) / k) am.gain.setTargetAtTime(0.35 + rnd() * 0.65, at, 0.06);
    noise(ctx, t, t + d + 0.3, 0.5).connect(filt(ctx, 'lowpass', 220 * k, 0.8)).connect(am).connect(g).connect(out);
    tone(ctx, out, t + 0.05, { f0: 48 * k, f1: 34 * k, glide: 1.2, a: 0.05, tau: 0.45, peak: 0.35 });
    return d + 0.3;
  } },
  holy: { wet: 0.5, gain: 1.5, play(ctx, out, t, k) {
    for (const m of [72, 76, 79, 84]) {
      for (const det of [-6, 6]) {
        const g = gain(ctx, 0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 0.35);
        g.gain.setValueAtTime(0.045, t + 0.7);
        g.gain.setTargetAtTime(0, t + 0.7, 0.22);
        const o = osc(ctx, 'triangle', mtof(m) * k, t, t + 1.9);
        o.detune.value = det;
        o.connect(g).connect(out);
      }
    }
    [0, 4, 7, 12, 16, 19].forEach((iv, i) => chime(ctx, out, t + 0.15 + i * 0.09, mtof(84 + iv) * k, 0.05, 0.3));
    return 1.8;
  } },
  heal: { wet: 0.45, play(ctx, out, t, k) {
    [79, 84, 88, 91, 96].forEach((m, i) => chime(ctx, out, t + (i * 0.08) / k, mtof(m) * k, 0.1, 0.35));
    for (const m of [72, 76, 79]) tone(ctx, out, t, { f0: mtof(m) * k, a: 0.25, hold: 0.25, tau: 0.18, peak: 0.06 });
    hiss(ctx, out, t + 0.1, { type: 'highpass', f0: 7000, a: 0.2, tau: 0.15, peak: 0.05 });
    return 1.3;
  } },
  dark: { wet: 0.4, gain: 0.7, play(ctx, out, t, k) {
    const d = 1.2 / k;
    const lp = filt(ctx, 'lowpass', 1400 * k, 2);
    ramp(lp.frequency, t, 1400 * k, 180 * k, d);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.2 / k);
    g.gain.setTargetAtTime(0, t + d * 0.6, d * 0.12);
    lp.connect(g).connect(out);
    for (const f of [55, 58.3, 82.4]) osc(ctx, 'sawtooth', f * k, t, t + d + 0.1).connect(lp);
    hiss(ctx, out, t, { type: 'lowpass', f0: 600 * k, a: d * 0.5, tau: 0.08, peak: 0.25 });
    return d + 0.15;
  } },
  magicCharge: { wet: 0.3, play(ctx, out, t, k) {
    const d = 1.0 / k;
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + d * 0.85);
    g.gain.setTargetAtTime(0, t + d * 0.9, 0.03);
    const trem = gain(ctx, 0.6);
    const lfo = osc(ctx, 'sine', 7, t, t + d + 0.2);
    lfo.frequency.exponentialRampToValueAtTime(26, t + d);
    lfo.connect(gain(ctx, 0.4)).connect(trem.gain);
    const lp = filt(ctx, 'lowpass', 3000, 1.5);
    for (const [type, mul] of [['sawtooth', 1], ['triangle', 1.5]]) {
      const o = osc(ctx, type, 180 * k * mul, t, t + d + 0.2);
      o.frequency.exponentialRampToValueAtTime(1500 * k * mul, t + d);
      o.connect(lp);
    }
    lp.connect(trem).connect(g).connect(out);
    hiss(ctx, out, t, { f0: 400 * k, f1: 5000 * k, sweep: d, q: 3, a: d * 0.9, tau: 0.04, peak: 0.25 });
    chime(ctx, out, t + d * 0.92, 2093 * k, 0.08, 0.2);
    return d + 0.3;
  } },
  levelUp: { wet: 0.35, gain: 1.2, play(ctx, out, t, k) {
    const lp = filt(ctx, 'lowpass', 3500, 0.7);
    lp.connect(out);
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => {
      const at = t + (i * 0.065) / k;
      chime(ctx, out, at, mtof(m) * k, 0.09, 0.3);
      tone(ctx, lp, at, { type: 'square', f0: mtof(m) * k, a: 0.003, tau: 0.04, peak: 0.035 });
    });
    hiss(ctx, out, t + 0.45 / k, { type: 'highpass', f0: 6500, a: 0.05, tau: 0.15, peak: 0.07 });
    for (const m of [84, 88, 91]) tone(ctx, out, t + 0.46 / k, { type: 'triangle', f0: mtof(m) * k, a: 0.01, hold: 0.25, tau: 0.12, peak: 0.07 });
    return 1.2;
  } },
  promote: { wet: 0.45, play(ctx, out, t, k) {
    const up = 12 * Math.log2(k);
    hiss(ctx, out, t, { f0: 300 * k, f1: 4000 * k, sweep: 0.8 / k, q: 2.5, a: 0.75 / k, tau: 0.05, peak: 0.2 });
    const t1 = t + 0.6 / k;
    for (const m of [60, 67, 72, 76, 79]) INSTRUMENTS.choir(ctx, out, t1, m + up, 1.0 / k, 0.8, { attack: 0.3, release: 0.7, level: 0.09 });
    [72, 76, 79, 84, 88, 91].forEach((m, i) => chime(ctx, out, t1 + (i * 0.07) / k, mtof(m) * k, 0.08, 0.4));
    hiss(ctx, out, t1, { type: 'highpass', f0: 7000, a: 0.3, hold: 0.3, tau: 0.25, peak: 0.06 });
    return 0.6 / k + 1.0 / k + 0.75;
  } },
  death: { wet: 0.3, play(ctx, out, t, k) {
    const d = 1.1 / k;
    const lp = filt(ctx, 'lowpass', 1800 * k, 1);
    ramp(lp.frequency, t, 1800 * k, 250 * k, d);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.05, d * 0.3);
    const o = osc(ctx, 'sawtooth', 440 * k, t, t + d + 0.3);
    o.frequency.exponentialRampToValueAtTime(70 * k, t + d);
    vibrato(ctx, [o], t, t + d + 0.3, 6, 30, 0.05);
    o.connect(lp).connect(g).connect(out);
    hiss(ctx, out, t, { type: 'lowpass', f0: 1200 * k, f1: 200 * k, sweep: d, a: 0.05, tau: d * 0.25, peak: 0.12 });
    return d + 0.3;
  } },
  chest: { wet: 0.3, play(ctx, out, t, k, rnd) {
    creak(ctx, out, t, 0.3 / k, 500 * k, 820 * k, 0.45, rnd);
    const t1 = t + 0.3 / k;
    tone(ctx, out, t1, { f0: 110 * k, f1: 70 * k, glide: 0.08, a: 0.002, tau: 0.05, peak: 0.4 });
    hiss(ctx, out, t1, { type: 'lowpass', f0: 800 * k, a: 0.002, tau: 0.03, peak: 0.35 });
    let end = t1;
    [91, 95, 98, 103].forEach((m, i) => { end = chime(ctx, out, t1 + (0.08 + i * 0.07) / k, mtof(m) * k, 0.08, 0.35); });
    return end - t;
  } },
  gold: { wet: 0.2, gain: 1.6, play(ctx, out, t, k, rnd) {
    let end = t;
    for (let i = 0; i < 6; i++) {
      const at = t + (i * 0.045 + rnd() * 0.03) / k;
      const f = (2900 + rnd() * 2200) * k;
      tone(ctx, out, at, { f0: f, a: 0.001, tau: 0.035, peak: 0.12 });
      end = tone(ctx, out, at, { f0: f * 2.4, a: 0.001, tau: 0.02, peak: 0.05 }).end;
    }
    return Math.max(0.5, end - t + 0.1);
  } },
  item: { wet: 0.3, gain: 1.2, play(ctx, out, t, k) {
    chime(ctx, out, t, mtof(79) * k, 0.13, 0.3);
    tone(ctx, out, t + 0.1 / k, { type: 'triangle', f0: mtof(96) * k, a: 0.005, tau: 0.08, peak: 0.04 });
    return chime(ctx, out, t + 0.1 / k, mtof(84) * k, 0.15, 0.45) - t;
  } },
  turn: { wet: 0.35, play(ctx, out, t, k) {
    const d = 0.6 / k;
    whoosh(ctx, out, t, d, 300 * k, 3200 * k, 600 * k, 1.4, 0.4);
    const g0 = t + d * 0.45;
    let end = g0;
    for (const [ratio, amp, tau] of [[1, 0.22, 0.32], [1.47, 0.12, 0.26], [2.09, 0.08, 0.2], [2.83, 0.05, 0.15], [3.6, 0.035, 0.1]]) {
      end = Math.max(end, tone(ctx, out, g0, { f0: 98 * k * ratio * 1.01, f1: 98 * k * ratio, glide: 0.3, a: 0.015, tau, peak: amp }).end);
    }
    return end - t;
  } },
  roar: { wet: 0.35, gain: 0.7, play(ctx, out, t, k) {
    const d = 1.5 / k;
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.18 / k);
    g.gain.setValueAtTime(0.55, t + d * 0.6);
    g.gain.setTargetAtTime(0, t + d * 0.6, d * 0.12);
    const sat = drive(ctx, 3);
    sat.connect(filt(ctx, 'peaking', 520 * k, 3, 10)).connect(filt(ctx, 'peaking', 1150 * k, 4, 8))
      .connect(filt(ctx, 'lowpass', 2600 * k, 0.7)).connect(g).connect(out);
    const growlDepth = gain(ctx, 26 * k);
    osc(ctx, 'sine', 31, t, t + d + 0.2).connect(growlDepth);
    for (const det of [0, 70]) {
      const o = osc(ctx, 'sawtooth', 70 * k, t, t + d + 0.2);
      o.frequency.linearRampToValueAtTime(118 * k, t + d * 0.3);
      o.frequency.linearRampToValueAtTime(62 * k, t + d);
      o.detune.value = det;
      growlDepth.connect(o.frequency);
      o.connect(sat);
    }
    hiss(ctx, out, t, { f0: 800 * k, q: 0.8, a: 0.2 / k, hold: d * 0.4, tau: d * 0.1, peak: 0.25 });
    return d + 0.3;
  } },
  howl: { wet: 0.4, play(ctx, out, t, k) {
    const d = 1.4 / k;
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.25 / k);
    g.gain.setValueAtTime(0.28, t + d * 0.7);
    g.gain.setTargetAtTime(0, t + d * 0.7, d * 0.08);
    const o = osc(ctx, 'triangle', 380 * k, t, t + d + 0.2);
    o.frequency.exponentialRampToValueAtTime(720 * k, t + d * 0.3);
    o.frequency.setValueAtTime(720 * k, t + d * 0.6);
    o.frequency.exponentialRampToValueAtTime(430 * k, t + d);
    vibrato(ctx, [o], t, t + d + 0.2, 5.5, 25, d * 0.3);
    o.connect(filt(ctx, 'peaking', 900 * k, 2, 6)).connect(filt(ctx, 'lowpass', 2500 * k, 0.7)).connect(g).connect(out);
    hiss(ctx, out, t, { f0: 1200 * k, q: 3, a: 0.2, hold: d * 0.5, tau: 0.1, peak: 0.05 });
    return d + 0.2;
  } },
  wing: { wet: 0.2, gain: 1.4, play(ctx, out, t, k) {
    for (let i = 0; i < 2; i++) {
      const at = t + (i * 0.22) / k;
      const { f } = hiss(ctx, out, at, { type: 'lowpass', f0: 500 * k, q: 1.2, a: 0.04 / k, tau: 0.05 / k, peak: 0.6 });
      ramp(f.frequency, at, 500 * k, 1400 * k, 0.08 / k);
    }
    return 0.25 / k + 0.3;
  } },
  text: { wet: 0, gain: 0.8, play(ctx, out, t, k, rnd) {
    return tone(ctx, out, t, { f0: vary(rnd, 1500, 0.05) * k, a: 0.002, tau: 0.006, peak: 0.06 }).end - t;
  } },
  quake: { wet: 0.2, play(ctx, out, t, k, rnd) {
    const d = 1.6 / k;
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.15);
    g.gain.setValueAtTime(0.7, t + d * 0.55);
    g.gain.setTargetAtTime(0, t + d * 0.55, d * 0.12);
    const am = gain(ctx, 0.6);
    osc(ctx, 'sine', 6.5, t, t + d + 0.2).connect(gain(ctx, 0.35)).connect(am.gain);
    noise(ctx, t, t + d + 0.2, 0.4).connect(filt(ctx, 'lowpass', 140 * k, 0.9)).connect(am).connect(g).connect(out);
    tone(ctx, out, t, { f0: 40 * k, f1: 32 * k, glide: d, a: 0.1, hold: d * 0.4, tau: d * 0.12, peak: 0.35 });
    for (let i = 0; i < 6; i++) hiss(ctx, out, t + 0.1 + rnd() * d * 0.6, { type: 'lowpass', f0: 600 + rnd() * 600, a: 0.003, tau: 0.03, peak: 0.12 });
    return d + 0.2;
  } },
  door: { wet: 0.25, play(ctx, out, t, k, rnd) {
    const d = 0.55 / k;
    creak(ctx, out, t, d, 520 * k, 880 * k, 0.5, rnd);
    tone(ctx, out, t + d, { f0: 85 * k, f1: 55 * k, glide: 0.1, a: 0.003, tau: 0.06, peak: 0.5 });
    hiss(ctx, out, t + d, { type: 'lowpass', f0: 500 * k, a: 0.002, tau: 0.04, peak: 0.4 });
    return d + 0.4;
  } },
  summon: { wet: 0.45, play(ctx, out, t, k) {
    const d = 0.75 / k;
    hiss(ctx, out, t, { f0: 5000, q: 0.7, a: d, tau: 0.02, peak: 0.25 });
    tone(ctx, out, t, { type: 'triangle', f0: 260 * k, f1: 1040 * k, glide: d, a: d * 0.9, tau: 0.03, peak: 0.12 });
    const t1 = t + d;
    let end = t1;
    [69, 73, 76, 81, 85].forEach((m, i) => { end = Math.max(end, chime(ctx, out, t1 + i * 0.03, mtof(m) * k, 0.09, 0.5)); });
    tone(ctx, out, t1, { f0: 90 * k, f1: 45 * k, glide: 0.3, a: 0.004, tau: 0.15, peak: 0.45 });
    hiss(ctx, out, t1, { type: 'lowpass', f0: 1500, f1: 200, sweep: 0.5, a: 0.003, tau: 0.12, peak: 0.3 });
    return end - t;
  } },
};

/** All sound-effect names. */
export const SFX_NAMES = Object.keys(SFX_DEFS);
