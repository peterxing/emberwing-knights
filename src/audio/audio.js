/**
 * Emberwing Knights audio engine: a lookahead music sequencer and procedural sound effects on the
 * Web Audio API. Music is composed as data in tracks.js, voices live in instruments.js and effects
 * in sfx.js; nothing is loaded from disk.
 * @module audio/audio
 */
import { createMixer, INSTRUMENTS } from './instruments.js';
import { getTrack, TRACK_NAMES } from './tracks.js';
import { SFX_DEFS, SFX_NAMES } from './sfx.js';

/** Names accepted by `audio.playMusic()`. */
export const TRACKS = [...TRACK_NAMES];
/** Names accepted by `audio.sfx()`. */
export const SFX = [...SFX_NAMES];

const LOOKAHEAD = 0.2;
const LOOKAHEAD_HIDDEN = 1.5;
const TICK_MS = 25;
const MUSIC_VOICES = 46;
const SFX_VOICES = 14;
const TAIL = 3.5;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

/** Counts sounding voices; lower-priority notes are refused first when the pool is crowded. */
class VoicePool {
  constructor(max) { this.max = max; this.ends = []; }
  admit(at, prio) {
    this.ends = this.ends.filter((e) => e > at);
    return this.ends.length < this.max - (2 - prio) * 6;
  }
  add(end) { this.ends.push(end); }
}

function rampParam(p, now, target, dur) {
  const v = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(v, now);
  if (dur > 0.005) p.linearRampToValueAtTime(target, now + dur);
  else p.setValueAtTime(target, now);
}

/** Plays one compiled track: per-part channel strips, intro once, then the body looped. */
class TrackPlayer {
  constructor(mix, track, start, voices, rnd = Math.random) {
    const ctx = mix.ctx;
    Object.assign(this, { ctx, track, voices, rnd, segStart: start, ptr: 0, finished: false, endTime: Infinity });
    this.fadingOut = false;
    this.stopAt = Infinity;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry.connect(mix.musicDry);
    this.wet.connect(mix.musicWet);
    this.parts = {};
    for (const [key, def] of Object.entries(track.parts)) {
      const input = ctx.createGain();
      input.gain.value = (def.vol ?? 0.7) * track.gain;
      let node = input;
      if (def.pan) {
        node = ctx.createStereoPanner();
        node.pan.value = def.pan;
        input.connect(node);
      }
      node.connect(this.dry);
      if (def.wet) {
        const send = ctx.createGain();
        send.gain.value = def.wet;
        node.connect(send).connect(this.wet);
      }
      this.parts[key] = { input, fn: INSTRUMENTS[def.inst], opts: def.opts ?? {}, prio: def.prio ?? (def.lead ? 2 : 1) };
    }
    this.inIntro = track.intro.beats > 0;
    this.seg = this.inIntro ? track.intro : track.body;
  }

  /** Create nodes for every note that starts before `until` (audio-clock seconds). */
  schedule(until, now) {
    const { spb, body, once } = this.track;
    while (!this.finished) {
      const evs = this.seg.events;
      while (this.ptr < evs.length) {
        const ev = evs[this.ptr];
        const at = this.segStart + ev.t * spb;
        if (at >= until) return;
        this.ptr++;
        if (at >= now - 0.02) this.play(ev, at);
      }
      let next = this.segStart + this.seg.beats * spb;
      if (!this.inIntro && once) { this.finished = true; this.endTime = next; return; }
      const loopLen = body.beats * spb;
      if (!this.inIntro && next + loopLen < now) next += Math.floor((now - next) / loopLen) * loopLen;
      this.inIntro = false;
      this.seg = body;
      this.segStart = next;
      this.ptr = 0;
      if (next >= until) return;
    }
  }

  play(ev, at) {
    const part = this.parts[ev.p];
    if (!part || !part.fn) return;
    if (!this.voices.admit(at, this.fadingOut ? 0 : part.prio)) return;
    const t = Math.max(this.ctx.currentTime, at + (this.rnd() - 0.5) * 0.008);
    const vel = clamp(ev.v * (0.94 + this.rnd() * 0.12), 0.05, 1);
    const end = part.fn(this.ctx, part.input, t, ev.m, ev.d * this.track.spb, vel, part.opts);
    this.voices.add(end);
  }

  fadeIn(now, start, dur) {
    for (const g of [this.dry.gain, this.wet.gain]) {
      g.setValueAtTime(0, now);
      g.setValueAtTime(0, start);
      if (dur > 0.005) g.linearRampToValueAtTime(1, start + dur);
      else g.setValueAtTime(1, start);
    }
  }

  fadeOut(now, dur) {
    this.fadingOut = true;
    this.stopAt = now + dur;
    for (const g of [this.dry.gain, this.wet.gain]) rampParam(g, now, 0, dur);
  }

  dispose() {
    this.dry.disconnect();
    this.wet.disconnect();
  }
}

/** Fire one effect into a mixer (shared by the live engine and offline renders); returns its end time. */
function fireSfx(mix, def, t, opts, rnd) {
  const ctx = mix.ctx;
  const out = ctx.createGain();
  out.gain.value = clamp(num(opts.volume, 1), 0, 4) * (def.gain ?? 1);
  const pan = ctx.createStereoPanner();
  pan.pan.value = clamp(num(opts.pan, 0), -1, 1);
  out.connect(pan).connect(mix.sfxDry);
  if (def.wet > 0) {
    const send = ctx.createGain();
    send.gain.value = def.wet;
    pan.connect(send).connect(mix.sfxWet);
  }
  const pitch = clamp(num(opts.pitch, 1), 0.25, 4) * (1 + (rnd() - 0.5) * 0.03);
  return t + def.play(ctx, out, t, pitch, rnd);
}

const S = {
  ctx: null,
  mix: null,
  ready: false,
  music: 0.7,
  sfx: 0.8,
  muted: false,
  player: null,
  fading: [],
  current: null,
  pending: null,
  timer: 0,
  musicVoices: new VoicePool(MUSIC_VOICES),
  sfxVoices: new VoicePool(SFX_VOICES),
  recent: new Map(),
};

function applyVolumes(immediate = false) {
  const m = S.mix;
  if (!m) return;
  const now = S.ctx.currentTime;
  const set = (p, v) => {
    if (immediate) { p.value = v; return; }
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, 0.03);
  };
  const mv = S.music * S.music, sv = S.sfx * S.sfx;
  set(m.musicDry.gain, mv);
  set(m.musicWet.gain, mv);
  set(m.sfxDry.gain, sv);
  set(m.sfxWet.gain, sv);
  set(m.master.gain, S.muted ? 0 : 1);
}

function retire(now, fade) {
  const p = S.player;
  if (!p) return;
  S.player = null;
  p.fadeOut(now, fade);
  S.fading.push(p);
}

function startTrack(name, opts) {
  const track = getTrack(name);
  const now = S.ctx.currentTime;
  const fade = Math.max(0, num(opts.fade, 1.2));
  retire(now, fade);
  const start = now + 0.05;
  const p = new TrackPlayer(S.mix, track, start, S.musicVoices);
  p.fadeIn(now, start, Math.min(fade, track.maxFadeIn));
  S.player = p;
  p.schedule(now + LOOKAHEAD, now);
}

function onReady() {
  if (S.ready) return;
  S.ready = true;
  if (S.pending) {
    const { name, opts } = S.pending;
    S.pending = null;
    startTrack(name, opts);
  }
}

function tick() {
  const ctx = S.ctx;
  if (!ctx || !S.ready || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const hidden = typeof document !== 'undefined' && document.hidden;
  const until = now + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
  try {
    const p = S.player;
    if (p) {
      p.schedule(until, now);
      if (p.finished && now >= p.endTime) {
        S.player = null;
        if (S.current === p.track.name) S.current = null;
        p.stopAt = now;
        S.fading.push(p);
      }
    }
    for (let i = S.fading.length - 1; i >= 0; i--) {
      const f = S.fading[i];
      if (now < f.stopAt) f.schedule(Math.min(until, f.stopAt), now);
      else if (now > f.stopAt + TAIL) { f.dispose(); S.fading.splice(i, 1); }
    }
  } catch (err) {
    console.error('[audio] scheduler error', err);
  }
}

/**
 * Public audio API.
 * Volumes are 0..1 (applied with a squared taper); everything is a silent no-op where Web Audio
 * is unavailable.
 */
export const audio = {
  /**
   * Create or resume the AudioContext. Safe to call repeatedly; call it from a user gesture.
   * @returns {Promise<void>}
   */
  init() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return Promise.resolve();
    if (!S.ctx) {
      try {
        S.ctx = new AC({ latencyHint: 'interactive' });
      } catch (err) {
        console.warn('[audio] AudioContext unavailable', err);
        return Promise.resolve();
      }
      S.mix = createMixer(S.ctx);
      applyVolumes(true);
      S.timer = setInterval(tick, TICK_MS);
    }
    if (S.ctx.state === 'running') { onReady(); return Promise.resolve(); }
    return S.ctx.resume().then(onReady, (err) => console.warn('[audio] resume failed', err));
  },

  /**
   * Crossfade to a track. Requests made before init() resolves are remembered and started then.
   * The same track already playing is a no-op unless `restart` is set.
   * @param {string} name one of TRACKS
   * @param {{fade?: number, restart?: boolean}} [opts] fade in seconds (default 1.2)
   */
  playMusic(name, opts = {}) {
    if (!getTrack(name)) { console.warn(`[audio] unknown track "${name}"`); return; }
    if (S.current === name && !opts.restart) return;
    S.current = name;
    if (!S.ready) { S.pending = { name, opts }; return; }
    startTrack(name, opts);
  },

  /**
   * Fade out the current track.
   * @param {{fade?: number}} [opts] fade in seconds (default 1.0)
   */
  stopMusic(opts = {}) {
    S.pending = null;
    S.current = null;
    if (S.ctx && S.player) retire(S.ctx.currentTime, Math.max(0, num(opts.fade, 1.0)));
  },

  /**
   * Play a sound effect; ignored before init() or for unknown names.
   * @param {string} name one of SFX
   * @param {{volume?: number, pitch?: number, pan?: number}} [opts]
   */
  sfx(name, opts = {}) {
    if (!S.ready || !Object.prototype.hasOwnProperty.call(SFX_DEFS, name)) return;
    const now = S.ctx.currentTime;
    if (!S.sfxVoices.admit(now, 2)) return;
    const last = S.recent.get(name);
    if (last && now - last.t < 0.03) {
      if (last.n >= 2) return;
      last.n++;
    } else S.recent.set(name, { t: now, n: 1 });
    try {
      S.sfxVoices.add(fireSfx(S.mix, SFX_DEFS[name], now + 0.005, opts || {}, Math.random));
    } catch (err) {
      console.warn(`[audio] sfx "${name}" failed`, err);
    }
  },

  /** @param {number} v 0..1 */
  setMusicVolume(v) { S.music = clamp(num(v, S.music), 0, 1); applyVolumes(); },
  /** @param {number} v 0..1 */
  setSfxVolume(v) { S.sfx = clamp(num(v, S.sfx), 0, 1); applyVolumes(); },
  /** @param {boolean} m */
  setMuted(m) { S.muted = !!m; applyVolumes(); },

  /** @returns {number} */
  get musicVolume() { return S.music; },
  /** @returns {number} */
  get sfxVolume() { return S.sfx; },
  /** @returns {boolean} */
  get muted() { return S.muted; },
  /** @returns {string|null} name of the playing (or requested) track */
  get currentTrack() { return S.current; },

  /**
   * Briefly lower the music (big hits, level-ups).
   * @param {number} [amount=0.4] fraction of the music level removed (0..1)
   * @param {number} [seconds=0.6] how long to hold before recovering
   */
  duck(amount = 0.4, seconds = 0.6) {
    if (!S.ready) return;
    const now = S.ctx.currentTime;
    const level = clamp(1 - num(amount, 0.4), 0, 1);
    const hold = Math.max(0, num(seconds, 0.6));
    for (const p of S.mix.duck) {
      const v = p.value;
      const low = Math.min(v, level);
      p.cancelScheduledValues(now);
      p.setValueAtTime(v, now);
      p.linearRampToValueAtTime(low, now + 0.04);
      p.setValueAtTime(low, now + 0.04 + hold);
      p.setTargetAtTime(1, now + 0.04 + hold, 0.18);
    }
  },
};

/**
 * Dev/test helper: render a track's opening or one effect through an OfflineAudioContext using the
 * same mixer, sequencer and instruments as the live engine.
 * @param {'music'|'sfx'} kind
 * @param {string} name
 * @param {{seconds?: number, sampleRate?: number, raw?: boolean}} [opts] raw: bypass master dynamics
 * @returns {Promise<{buffer: AudioBuffer, from: number, to: number}>} the window (seconds) holding the sound
 */
export async function renderOffline(kind, name, { seconds = 6, sampleRate = 44100, raw = false } = {}) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const isMusic = kind === 'music';
  const track = isMusic ? getTrack(name) : null;
  const def = isMusic ? null : SFX_DEFS[name];
  if (!track && !def) throw new Error(`unknown ${kind} "${name}"`);
  // Chrome's compressor starts fully attenuated and releases over ~0.3 s, so let it settle first.
  const from = 0.4;
  const length = from + (isMusic ? seconds : 3.5);
  const ctx = new OAC(2, Math.ceil(length * sampleRate), sampleRate);
  const mix = createMixer(ctx, { raw });
  let to = length;
  if (isMusic) {
    const p = new TrackPlayer(mix, track, from, new VoicePool(MUSIC_VOICES));
    p.schedule(length, 0);
  } else {
    to = Math.min(length, fireSfx(mix, def, from, {}, Math.random) + 0.05);
  }
  return { buffer: await ctx.startRendering(), from, to };
}
