// Small shared utilities: easing, tweens, timing, seeded RNG, events.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/** Frame-driven tween manager (advanced by the engine loop, respects a global time scale). */
class Tweens {
  constructor() { this.list = []; this.timeScale = 1; }
  /** Animate from 0..1 over `dur` seconds calling fn(easedT). Resolves on completion. */
  run(dur, fn, easing = ease.inOutQuad) {
    return new Promise((resolve) => {
      if (dur <= 0) { fn(1); resolve(); return; }
      this.list.push({ t: 0, dur, fn, easing, resolve });
    });
  }
  /** Wait `sec` seconds of (scaled) game time. */
  wait(sec) { return this.run(sec, () => {}, ease.linear); }
  update(dt) {
    const d = dt * this.timeScale;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += d;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(tw.easing(k));
      if (k >= 1) { this.list.splice(i, 1); tw.resolve(); }
    }
  }
  clear() { for (const tw of this.list) tw.resolve(); this.list.length = 0; }
}
export const tweens = new Tweens();
export const wait = (sec) => tweens.wait(sec);

/** Real-time sleep (ms), independent of the game loop. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mulberry32 seeded RNG with helpers. */
export class RNG {
  constructor(seed = Date.now() >>> 0) { this.s = seed >>> 0; }
  next() {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pct(p) { return this.next() * 100 < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
}

/** Minimal event emitter. */
export class Emitter {
  constructor() { this.h = new Map(); }
  on(ev, fn) { if (!this.h.has(ev)) this.h.set(ev, new Set()); this.h.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.h.get(ev)?.delete(fn); }
  emit(ev, ...a) { for (const fn of [...(this.h.get(ev) || [])]) fn(...a); }
}

export const key = (x, y) => `${x},${y}`;
export const manhattan = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);
