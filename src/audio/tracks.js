/**
 * The soundtrack of Emberwing Knights as data, plus the small notation compiler that turns it
 * into timed note events for the sequencer in audio.js.
 *
 * Notation
 *  - Melodic line: space separated tokens `PITCH[DUR][.][MOD]`; `|` marks a bar line (checked).
 *      PITCH  C4, F#3, Bb5; stacked notes joined with `+` (C4+E4+G4); `r` rest (`rq` or `r q`); `~` tie.
 *      DUR    w=4 h=2 q=1 e=1/2 s=1/4 t=1/3 T=2/3 beats, `.` dots it; omitted = previous.
 *      MOD    `!` accent, `?` soft, `'` staccato.
 *  - Drum line: one char per step: x hit, X accent, o ghost, f flam, `.`/`-` rest. Optional step
 *    prefix `8:` `12:` (8th triplets) `16:` (default) `4:` `32:`. Short lines repeat to fill.
 *  - Chords: `"Dm:2 G7:2 C"` -> symbol[:beats], default one bar; slash bass allowed (D/F#).
 *  - Generators follow their section's chords: pad(), arp(), bass(), stab(). Chord-tone tokens:
 *    1 3 5 7 8 10 12 14 15 17, 0 (fifth below), 2 4 6 9 11 13, b2 b3 b5 b6 b7, `.` rest, `-` hold.
 * @module audio/tracks
 */

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, T: 2 / 3 };
const PITCH_RE = /^([A-G])([#b]?)(-?\d)$/;
const TOKEN_RE = /^(r|~|[A-G][#b]?-?\d(?:\+[A-G][#b]?-?\d)*)([whqestT]\.?)?([!?']*)$/;
const CHORD_RE = /^([A-G][#b]?)(maj7|m7b5|madd9|add9|7sus4|sus4|sus2|dim7|dim|aug|m9|m7|m6|m|9|7|6|5)?(?:\/([A-G][#b]?))?$/;
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14], sus4: [0, 5, 7], sus2: [0, 2, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6],
  dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], 5: [0, 7],
};
const STEPS = { 4: 1, 8: 0.5, 12: 1 / 3, 16: 0.25, 24: 1 / 6, 32: 0.125 };
const HITS = { x: 0.8, X: 1, o: 0.45, f: 0.85 };
const DRUM_INSTS = new Set(['kick', 'snare', 'hat', 'shaker', 'crash']);
const EPS = 1e-6;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Note name ("C#4") -> MIDI number. */
export function midi(name) {
  const m = PITCH_RE.exec(name);
  if (!m) throw new Error(`bad pitch "${name}"`);
  return 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const noteName = (m) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const pitchClass = (s) => (SEMI[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12;
const place = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12);

function parseLine(src, meter, warn) {
  const events = [];
  let t = 0, dur = 1, barStart = 0, bar = 1, last = null, sawBar = false;
  const checkBar = () => {
    if (Math.abs(t - barStart - meter) > EPS) warn(`bar ${bar} has ${+(t - barStart).toFixed(3)} beats`);
  };
  const text = src.replace(/(^|\s)r\s+([whqestT]\.?)(?=\s|$)/g, '$1r$2');
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok === '|') { checkBar(); barStart = t; bar++; sawBar = true; continue; }
    const m = TOKEN_RE.exec(tok);
    if (!m) { warn(`bad token "${tok}"`); continue; }
    if (m[2]) dur = DUR[m[2][0]] * (m[2].length > 1 ? 1.5 : 1);
    if (m[1] === 'r') { t += dur; last = null; continue; }
    if (m[1] === '~') { if (last) for (const e of last) e.d += dur; t += dur; continue; }
    const mods = m[3];
    const v = mods.includes('!') ? 1.25 : mods.includes('?') ? 0.6 : 1;
    const d = mods.includes("'") ? dur * 0.45 : dur;
    last = m[1].split('+').map((p) => {
      const e = { t, d, m: midi(p), v };
      events.push(e);
      return e;
    });
    t += dur;
  }
  if (sawBar && t - barStart > EPS) checkBar();
  return { events, beats: t };
}

function parseDrums(src) {
  let body = src.trim(), step = 0.25;
  const pre = /^(\d+):/.exec(body);
  if (pre) { step = STEPS[pre[1]] ?? 0.25; body = body.slice(pre[0].length); }
  const events = [];
  let t = 0;
  for (const ch of body) {
    if (ch === ' ' || ch === '|' || ch === '\n' || ch === '\t') continue;
    const v = HITS[ch];
    if (ch === 'f') events.push({ t: t - 0.06, d: step, m: null, v: 0.4 });
    if (v) events.push({ t, d: step, m: null, v });
    t += step;
  }
  return { events, beats: t };
}

function parseChords(src, meter, warn) {
  const chords = [];
  let t = 0;
  for (const tok of src.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [sym, len] = tok.split(':');
    const m = CHORD_RE.exec(sym);
    if (!m) { warn(`bad chord "${tok}"`); continue; }
    const iv = QUALITY[m[2] ?? ''];
    const has = (x) => iv.includes(x);
    const third = has(3) ? 3 : has(4) ? 4 : has(5) ? 5 : has(2) ? 2 : 7;
    const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7;
    const seventh = has(10) ? 10 : has(11) ? 11 : has(9) ? 9 : 12;
    const root = pitchClass(m[1]);
    const d = len ? Number(len) : meter;
    chords.push({ t, d, name: sym, root, bass: m[3] ? pitchClass(m[3]) : root, iv, third, fifth, seventh });
    t += d;
  }
  return { chords, beats: t };
}

const chordAt = (chords, t) => chords.find((c) => t >= c.t - EPS && t < c.t + c.d - EPS) ?? chords[chords.length - 1];

function degree(c, tok) {
  switch (tok) {
    case '1': return 0; case '8': return 12; case '15': return 24;
    case '3': return c.third; case '10': return c.third + 12; case '17': return c.third + 24;
    case '5': return c.fifth; case '12': return c.fifth + 12; case '0': return c.fifth - 12;
    case '7': return c.seventh; case '14': return c.seventh + 12;
    case '2': return 2; case '9': return 14; case '4': return 5; case '11': return 17;
    case '6': return 9; case '13': return 21;
    case 'b2': return 1; case 'b3': return 3; case 'b5': return 6; case 'b6': return 8; case 'b7': return 10;
    default: return null;
  }
}

function voiceLead(c, lo, n, prev) {
  const pcs = [...new Set(c.iv.map((x) => (c.root + x) % 12))];
  const cands = pcs.map((_, inv) => {
    const v = [];
    let cur = lo - 1;
    for (let i = 0; i < n; i++) {
      cur = place(pcs[(inv + i) % pcs.length], cur + 1);
      v.push(cur);
    }
    return v;
  });
  if (!prev) return cands[0];
  const cost = (v) => v.reduce((s, m, i) => s + Math.abs(m - (prev[i] ?? prev[prev.length - 1])), 0);
  return cands.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

/** Sustained voice-led chords; common tones are held across chord changes. */
export const pad = (o = {}) => ({ gen: 'pad', ...o });
/** Chord-tone arpeggio restarting at each chord change. */
export const arp = (pattern, o = {}) => ({ gen: 'arp', pattern, ...o });
/** Chord-tone bass line; 1/8/15 follow the slash bass. */
export const bass = (pattern, o = {}) => ({ gen: 'arp', slash: true, pattern, ...o });
/** Rhythmic chord hits from a drum-style pattern. */
export const stab = (pattern, o = {}) => ({ gen: 'stab', pattern, ...o });

function genPad(chords, o) {
  const lo = midi(o.lo ?? 'C4'), n = o.n ?? 4, events = [];
  let prev = null, held = new Map();
  for (const c of chords) {
    const voicing = voiceLead(c, lo, n, prev);
    const next = new Map();
    for (const m of voicing) {
      let e = o.tie === false ? null : held.get(m);
      if (e) e.d += c.d;
      else { e = { t: c.t, d: c.d, m, v: 1 }; events.push(e); }
      next.set(m, e);
    }
    held = next;
    prev = voicing;
  }
  return events;
}

function genArp(chords, o) {
  const toks = o.pattern.trim().split(/\s+/);
  const step = o.step ?? 0.5, lo = midi(o.lo ?? 'C4'), events = [];
  for (const c of chords) {
    const root = place(c.root, lo), low = place(o.slash ? c.bass : c.root, lo);
    let last = null, i = 0;
    for (let t = c.t; t < c.t + c.d - EPS; t += step, i++) {
      const tok = toks[i % toks.length];
      const d = Math.min(step, c.t + c.d - t);
      if (tok === '.') { last = null; continue; }
      if (tok === '-') { if (last) last.d += d; continue; }
      const core = tok.replace(/[!?]$/, '');
      const iv = degree(c, core);
      if (iv == null) continue;
      const base = o.slash && (core === '1' || core === '8' || core === '15') ? low : root;
      const v = tok.endsWith('!') ? 1.2 : tok.endsWith('?') ? 0.6 : 1;
      last = { t, d, m: base + iv, v };
      events.push(last);
    }
  }
  return events;
}

function genStab(chords, beats, o) {
  const { events: hits, beats: len } = parseDrums(o.pattern);
  const lo = midi(o.lo ?? 'C4'), n = o.n ?? 3, events = [];
  const voicings = new Map();
  let prev = null;
  for (const c of chords) { prev = voiceLead(c, lo, n, prev); voicings.set(c, prev); }
  for (let off = 0; off < beats - EPS; off += len) {
    for (const h of hits) {
      const t = off + h.t;
      if (t < 0 || t >= beats - EPS) continue;
      for (const m of voicings.get(chordAt(chords, t))) events.push({ t, d: o.len ?? 0.4, m, v: h.v });
    }
  }
  return events;
}

function repeatTo(events, len, beats) {
  if (len <= EPS || len >= beats - EPS) return events;
  const out = [];
  for (let off = 0; off < beats - EPS; off += len) for (const e of events) out.push({ ...e, t: e.t + off });
  return out;
}

/** Flags sustained melody notes a semitone above a chord tone (b9 / "avoid" notes). */
function lint(events, chords, warn, label) {
  for (const e of events) {
    if (e.d < 0.74 && (Math.abs(e.t - Math.round(e.t)) > EPS || e.d < 0.5)) continue;
    const c = chordAt(chords, e.t);
    const pcs = c.iv.map((x) => (c.root + x) % 12);
    const n = ((e.m % 12) + 12) % 12;
    if (pcs.includes(n)) continue;
    if (pcs.some((q) => (n - q + 12) % 12 === 1)) warn(`${label} beat ${+e.t.toFixed(2)}: ${noteName(e.m)} clashes with ${c.name}`);
  }
}

function compile(name, def) {
  const warnings = [];
  const meter = def.meter ?? 4;
  const build = (sections, tag) => {
    const events = [];
    let offset = 0;
    sections.forEach((sec, si) => {
      const warn = (msg) => warnings.push(`${name} ${tag}[${si}] ${msg}`);
      const tr = sec.tr ?? 0;
      const { chords, beats } = parseChords(sec.chords, meter, warn);
      for (const [part, content] of Object.entries(sec.parts ?? {})) {
        const pdef = def.parts[part];
        if (!pdef) { warn(`unknown part ${part}`); continue; }
        for (const line of [].concat(content)) {
          let evs;
          if (typeof line === 'string') {
            const drum = pdef.drum || DRUM_INSTS.has(pdef.inst);
            const r = drum ? parseDrums(line) : parseLine(line, meter, (m) => warn(`${part}: ${m}`));
            if (r.beats > beats + EPS) warn(`${part} runs ${+r.beats.toFixed(3)} beats in a ${beats}-beat section`);
            else if (r.beats > EPS && Math.abs(beats / r.beats - Math.round(beats / r.beats)) > 1e-4) {
              warn(`${part} (${+r.beats.toFixed(3)} beats) does not tile ${beats} beats`);
            }
            evs = repeatTo(r.events, r.beats, beats);
            if (drum && pdef.note) for (const e of evs) e.m = midi(pdef.note);
            if (pdef.lead) lint(evs, chords, warn, part);
          } else if (line.gen === 'pad') evs = genPad(chords, line);
          else if (line.gen === 'arp') evs = genArp(chords, line);
          else if (line.gen === 'stab') evs = genStab(chords, beats, line);
          else { warn(`bad content for ${part}`); continue; }
          const vel = (line.vel ?? 1) * (pdef.vel ?? 0.8);
          const shift = tr + (pdef.oct ?? 0) * 12;
          for (const e of evs) {
            if (e.t >= beats - EPS) continue;
            events.push({ t: offset + e.t, d: e.d, m: e.m == null ? null : e.m + shift, v: Math.min(1, e.v * vel), p: part });
          }
        }
      }
      offset += beats;
    });
    events.sort((a, b) => a.t - b.t);
    return { events, beats: offset };
  };
  return {
    name, key: def.key, bpm: def.bpm, meter, spb: 60 / def.bpm, parts: def.parts, once: !!def.once, gain: def.gain ?? 1,
    maxFadeIn: def.maxFadeIn ?? Infinity, intro: build(def.intro ?? [], 'intro'), body: build(def.loop, 'loop'), warnings,
  };
}

// ---------------------------------------------------------------------------------------------
// Shared material. The Emberwing motif (title theme) returns in the final battle and the ending.

const THEME_CHORDS = 'D G Em A7 D G D/A:2 A7sus4:1 A7:1 D';
const THEME = `D5h. A4e D5e | F#5h E5q D5q | E5h. B4e E5e | G5h F#5q E5q |
  F#5q. D5e A5q F#5q | B5h A5q G5q | F#5q E5q D5q E5q | D5w`;
const crashAt = (bars, ...at) => `4:${Array.from({ length: bars * 4 }, (_, i) => (at.includes(i / 4) ? 'X' : '.')).join('')}`;

// ---------------------------------------------------------------------------------------------
// title: heroic overture (D major, 92 bpm). Intro swell, horn theme, string answer, tutti, bridge.

const title = {
  key: 'D major', bpm: 92,
  parts: {
    horn: { inst: 'horn', vol: 0.9, wet: 0.35, pan: -0.15, lead: true, vel: 0.85, oct: -1 },
    brass: { inst: 'brass', vol: 0.5, wet: 0.3, pan: 0.15, lead: true, vel: 0.8 },
    vln: { inst: 'strlead', vol: 0.7, wet: 0.4, pan: 0.1, lead: true, vel: 0.8 },
    str: { inst: 'strings', vol: 0.65, wet: 0.45, prio: 0, vel: 0.7 },
    swell: { inst: 'strings', vol: 0.7, wet: 0.5, prio: 0, vel: 0.75, opts: { attack: 2.2, release: 1.2 } },
    ost: { inst: 'lowstr', vol: 0.45, wet: 0.25, prio: 0, vel: 0.65 },
    harp: { inst: 'harp', vol: 0.55, wet: 0.5, pan: 0.35, prio: 0, vel: 0.7 },
    bass: { inst: 'bass', vol: 0.75, wet: 0.15, vel: 0.75 },
    timp: { inst: 'timpani', vol: 0.9, wet: 0.3, vel: 0.85 },
    roll: { inst: 'timproll', vol: 0.8, wet: 0.3, vel: 0.8 },
    cym: { inst: 'crash', vol: 0.45, wet: 0.4, vel: 0.8 },
    sus: { inst: 'suscym', vol: 0.5, wet: 0.4, vel: 0.8 },
    snare: { inst: 'snare', vol: 0.4, wet: 0.25, vel: 0.7 },
  },
  intro: [{
    chords: 'D D A7sus4 A7',
    parts: {
      swell: pad({ lo: 'A3' }),
      bass: 'D2w | ~w | A1w | ~w',
      roll: 'D2w | r w | r w | A2w',
      timp: 'r w | D2q! r h. | A2q r h. | r w',
      harp: 'r w | D4s F#4 A4 D5 F#5 A5 D6 A5 F#5 D5 A4 F#4 D4 F#4 A4 D5 | r w | r w',
      horn: 'r w | r w | D5h. A4e D5e | E5w',
      sus: 'r w | r w | r w | C4w',
    },
  }],
  loop: [
    {
      chords: THEME_CHORDS,
      parts: {
        horn: THEME,
        str: pad({ lo: 'D3' }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'D3' }),
        bass: bass('1 - - - 5 - - -', { lo: 'D2' }),
        timp: 'D2q! r h. | r w | r w | r h. A2q | D2q r h. | r w | r h D2q A2q | D2q r h.',
        cym: crashAt(8, 0),
      },
    },
    {
      chords: 'Bm G Em A Bm G Bb:2 C:2 D',
      parts: {
        vln: 'F#5h B5q. A5e | G5h D5h | E5q. F#5e G5q B5q | A5h. r q | F#5h B5q. C#6e | D6h B5q G5q | D6h E6h | F#6w',
        horn: 'D5w | D5h B4h | B4w | A4q. C#5e E5q A5q | F#5w | G5h B5h | Bb5h C6h | A5w',
        str: pad({ lo: 'D3' }),
        harp: arp('1 5 8 5 10 5 8 5', { lo: 'B2' }),
        bass: bass('1 - - - - - 5 -', { lo: 'D2' }),
        timp: 'B2q r h. | r w | r w | r w | B2q r h. | r w | Bb2q r q C3q r q | D3q! r h.',
        cym: crashAt(8, 0, 7),
      },
    },
    {
      chords: THEME_CHORDS,
      parts: {
        horn: THEME,
        brass: THEME,
        ost: arp('1 5 8 5', { lo: 'D3' }),
        str: pad({ lo: 'A3' }),
        harp: arp('1 5 8 10', { lo: 'D4', step: 0.25 }),
        bass: bass('1 - 1 - 5 - 1 -', { lo: 'D2' }),
        snare: '16:X...x...x...x.xx',
        timp: 'D2q! r q D2q r q | G2q r h. | E2q r h. | A2q r q A2e A2e A2q | D2q! r q D2q r q | G2q r h. | A2q r q A2q A2q | D2q! r h.',
        cym: crashAt(8, 0, 4),
      },
    },
    {
      chords: 'G Em7 A7sus4 A7',
      parts: {
        horn: 'D5h. A4e D5e | E5h. B4e E5e | D5w | C#5h. r q',
        str: pad({ lo: 'B3', vel: 0.85 }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'G3', vel: 0.8 }),
        bass: bass('1 - - - - - - -', { lo: 'D2' }),
        roll: 'r w | r w | r w | A2w',
        sus: 'r w | r w | r w | C4w',
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// story: wistful dialogue theme (A minor, 3/4, 80 bpm). Flute, oboe answer, strings, harp.

const STORY_CHORDS = 'Am F G C F Dm E7 Am';
const STORY_MEL = 'A4h B4q | C5h A4q | B4q. C5e D5q | E5h. | F5h E5q | D5q. C5e B4q | B4q. A4e G#4q | A4h.';
const storyBed = (lo) => ({
  str: pad({ lo: 'E3' }),
  harp: arp('1 5 8 10 8 5', { lo }),
  bass: bass('1 - -', { lo: 'E2', step: 1 }),
});

const story = {
  key: 'A minor', bpm: 80, meter: 3,
  parts: {
    flute: { inst: 'flute', vol: 0.8, wet: 0.45, pan: -0.1, lead: true, vel: 0.75 },
    oboe: { inst: 'oboe', vol: 0.75, wet: 0.45, pan: 0.15, lead: true, vel: 0.75 },
    vln: { inst: 'strlead', vol: 0.6, wet: 0.5, pan: 0.05, lead: true, vel: 0.7 },
    str: { inst: 'strings', vol: 0.55, wet: 0.5, prio: 0, vel: 0.6, opts: { attack: 0.7, release: 1.2 } },
    harp: { inst: 'harp', vol: 0.5, wet: 0.5, pan: 0.3, prio: 0, vel: 0.6 },
    bass: { inst: 'bass', vol: 0.55, wet: 0.2, vel: 0.6, opts: { attack: 0.08 } },
  },
  loop: [
    { chords: STORY_CHORDS, parts: { flute: STORY_MEL, ...storyBed('A2') } },
    {
      chords: STORY_CHORDS,
      parts: {
        oboe: 'E5h D5q | C5h A4q | B4q. C5e D5q | G5h. | A5h G5q | F5q. E5e D5q | E5q D5q B4q | A4h.',
        flute: 'C6h. | A5h. | B5h. | C6h. | A5h. | A5h. | B5h. | E5h.',
        ...storyBed('A2'),
      },
    },
    {
      chords: 'F G Em Am Dm G C E7',
      parts: {
        vln: 'C5q F5q A5q | G5h. | B4q E5q G5q | E5h. | A4q D5q F5q | E5h D5q | C5h. | B4h.',
        flute: 'A5h. | B5h. | G5h. | A5h. | F5h. | G5h F5q | E5h. | G#5h.',
        ...storyBed('F2'),
      },
    },
    {
      chords: STORY_CHORDS,
      parts: { flute: STORY_MEL, oboe: 'C5h. | A4h. | B4h. | C5h. | A4h. | A4h. | B4h. | E4h.', ...storyBed('A2') },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// camp: warm town/shop theme (F major, 116 bpm). Lute and pizzicato, flute tune, light percussion.

const CAMP_CHORDS = 'F C Dm C Bb F Gm7:2 C7:2 F';
const CAMP_MEL = `C5q F5e G5e A5q F5q | G5q. F5e E5q C5q | D5q F5e G5e A5q D6q | C6q. Bb5e A5q G5q |
  F5q D5e F5e Bb5q F5q | A5q. G5e F5q C5q | D5q. E5e G5q E5q | F5h. r q`;
const campBed = {
  lute: arp('1 5 8 10 12 10 8 5', { lo: 'F3' }),
  pizz: bass('1 . 5 . 8 . 5 .', { lo: 'F2' }),
  str: pad({ lo: 'A3', n: 3 }),
  shaker: '8:oxoxoxox',
  kick: '4:x.x.',
  tamb: '4:.x.x',
};

const camp = {
  key: 'F major', bpm: 116,
  parts: {
    flute: { inst: 'flute', vol: 0.75, wet: 0.3, pan: -0.15, lead: true, vel: 0.8, opts: { vib: 9 } },
    oboe: { inst: 'oboe', vol: 0.7, wet: 0.3, pan: 0.2, lead: true, vel: 0.75 },
    bell: { inst: 'bell', vol: 0.4, wet: 0.35, pan: 0.25, vel: 0.65 },
    lute: { inst: 'lute', vol: 0.45, wet: 0.25, pan: 0.25, prio: 0, vel: 0.75 },
    pizz: { inst: 'pizz', vol: 0.6, wet: 0.2, pan: -0.1, vel: 0.8 },
    str: { inst: 'strings', vol: 0.35, wet: 0.35, prio: 0, vel: 0.55 },
    shaker: { inst: 'shaker', vol: 0.6, wet: 0.1, pan: 0.3, vel: 0.7 },
    kick: { inst: 'kick', vol: 0.3, wet: 0.05, vel: 0.7 },
    tamb: { inst: 'hat', vol: 0.45, wet: 0.15, pan: -0.3, vel: 0.7, opts: { open: true } },
  },
  loop: [
    { chords: CAMP_CHORDS, parts: { flute: CAMP_MEL, ...campBed } },
    {
      chords: 'Bb C Am Dm Gm7 C F/A:2 Bb:2 C7',
      parts: {
        oboe: 'D5h F5q D5q | E5h G5q E5q | C5q. B4e A4q C5q | D5h. r q | Bb4h D5q F5q | E5h. C5q | F5h D5h | E5q G5q C6q Bb5q',
        flute: 'r w | r w | r w | r h. A5e Bb5e | D6h. r q | C6h. r q | A5h F5h | G5w',
        ...campBed,
      },
    },
    {
      chords: CAMP_CHORDS,
      parts: {
        flute: CAMP_MEL,
        bell: CAMP_MEL,
        oboe: 'A4w | G4w | F4w | E4w | D4w | C4w | Bb4h G4h | A4h. r q',
        ...campBed,
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// player: heroic march for the player phase (Bb major, 118 bpm). Snare march, brass, strings.

const MARCH_CHORDS = 'Bb F7/A Bb Eb:2 F:2 Gm Eb Cm7:2 F7:2 Bb';
const MARCH = `Bb4q. F4e Bb4q D5q | C5q. F4e C5q Eb5q | D5q. C5e Bb4q F5q | G5h F5h |
  D5q. Bb4e G4q D5q | Eb5q. D5e C5q Bb4q | C5q. D5e Eb5q C5q | Bb4h. r q`;
const MARCH_TIMP = 'Bb2q! r h. | F2q r h. | Bb2q r h. | Eb2q r F2q r | G2q r h. | Eb2q r h. | C3q r F2q F2q | Bb2q! r h.';
const marchBed = {
  str: pad({ lo: 'F3' }),
  bass: bass('1 - . . 5 - . .', { lo: 'Bb1' }),
  horn: stab('8:..x...x.', { lo: 'D4', n: 3, len: 0.3 }),
  snare: '16:X..oX.o.X..oX.o.X..oX.o.X.x.xxxx',
  kick: '4:x.x.',
};

const player = {
  key: 'Bb major', bpm: 118,
  parts: {
    brass: { inst: 'brass', vol: 0.85, wet: 0.3, pan: 0.1, lead: true, vel: 0.85 },
    hornmel: { inst: 'horn', vol: 0.7, wet: 0.3, pan: -0.15, lead: true, vel: 0.75, oct: -1 },
    horn: { inst: 'horn', vol: 0.45, wet: 0.3, pan: -0.25, vel: 0.7 },
    vln: { inst: 'strlead', vol: 0.6, wet: 0.35, pan: 0.15, lead: true, vel: 0.8 },
    str: { inst: 'strings', vol: 0.45, wet: 0.35, prio: 0, vel: 0.6 },
    bass: { inst: 'bass', vol: 0.75, wet: 0.1, vel: 0.8 },
    snare: { inst: 'snare', vol: 0.55, wet: 0.2, pan: 0.1, vel: 0.8 },
    kick: { inst: 'kick', vol: 0.5, wet: 0.05, vel: 0.8 },
    cym: { inst: 'crash', vol: 0.45, wet: 0.35, vel: 0.8 },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.25, vel: 0.8 },
  },
  loop: [
    { chords: MARCH_CHORDS, parts: { brass: MARCH, ...marchBed, cym: crashAt(8, 0), timp: MARCH_TIMP } },
    {
      chords: 'Eb Bb/D Cm Gm Ab Eb/G F F7',
      parts: {
        vln: 'G5h Bb5h | F5h D5h | Eb5q. D5e C5q G5q | D5w | C6h Ab5h | Bb5h G5h | A5q. G5e F5q C5q | Eb5h. r q',
        hornmel: 'G5h Bb5h | F5h D5h | Eb5q. D5e C5q G5q | D5w | C6h Ab5h | Bb5h G5h | A5q. G5e F5q C5q | Eb5h. r q',
        brass: 'r w | r w | r w | r w | r w | r w | r w | r h F4e F4e F4q!',
        ...marchBed,
        cym: crashAt(8, 0, 4),
        timp: 'Eb2q r h. | D2q r h. | C3q r h. | G2q r h. | Ab2q r h. | G2q r h. | F2q r h. | F2q r q F2e F2e F2q',
      },
    },
    {
      chords: MARCH_CHORDS,
      parts: {
        brass: MARCH,
        hornmel: MARCH,
        vln: 'D6w | Eb6w | F6w | Eb6h C6h | Bb5w | G5w | G5h A5h | Bb5h. r q',
        ...marchBed,
        cym: crashAt(8, 0, 4),
        timp: MARCH_TIMP,
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// enemy: tense enemy-phase theme (D minor, 100 bpm). Low string ostinato, timpani, brass stabs.

const ENEMY_CHORDS = 'Dm Dm Bb A Dm Dm Gm A7';
const ENEMY_MEL = 'D5h. E5q | F5h E5q D5q | D5q. C5e Bb4h | A4w | D5h. E5q | F5h G5q A5q | Bb5h. A5e G5e | A5w';
const ENEMY_TIMP = 'D2q! r q D2e D2e D2q | r w | Bb2q r h. | A2q r q A2e A2e A2q | D2q! r q D2e D2e D2q | r w | G2q r h. | A2q r q A2q A2q';
const enemyBed = {
  ost: bass('1 1 8 1 b2 1 5 1', { lo: 'D3', step: 0.25 }),
  bass: bass('1 - - - - - - -', { lo: 'D2' }),
  str: pad({ lo: 'A3', n: 3, vel: 0.8 }),
};

const enemy = {
  key: 'D minor', bpm: 100, gain: 0.9,
  parts: {
    horn: { inst: 'horn', vol: 0.85, wet: 0.35, pan: -0.1, lead: true, vel: 0.8, oct: -1 },
    oboe: { inst: 'oboe', vol: 0.65, wet: 0.4, pan: 0.2, lead: true, vel: 0.7 },
    brass: { inst: 'brass', vol: 0.45, wet: 0.3, pan: -0.15, vel: 0.85, opts: { bright: 0.8 } },
    ost: { inst: 'lowstr', vol: 0.75, wet: 0.2, vel: 0.7 },
    bass: { inst: 'bass', vol: 0.6, wet: 0.1, vel: 0.75 },
    str: { inst: 'strings', vol: 0.55, wet: 0.4, prio: 0, vel: 0.55 },
    timp: { inst: 'timpani', vol: 0.75, wet: 0.3, vel: 0.85 },
    snare: { inst: 'snare', vol: 0.3, wet: 0.25, vel: 0.7, opts: { snappy: 0.05 } },
    sus: { inst: 'suscym', vol: 0.4, wet: 0.4, vel: 0.8 },
  },
  loop: [
    { chords: ENEMY_CHORDS, parts: { horn: ENEMY_MEL, ...enemyBed, timp: ENEMY_TIMP } },
    {
      chords: 'Bb C Dm Dm Bb C A A7',
      parts: {
        oboe: 'F5q. G5e A5h | G5q. A5e Bb5h | A5q. G5e F5q E5q | D5h. r q | F5q. G5e A5q D6q | C6h. Bb5q | A5q. Bb5e A5q G5q | A5w',
        brass: stab('8:X..X..X.', { lo: 'D4', n: 3, len: 0.3 }),
        ...enemyBed,
        snare: '16:o.o.x.o.o.o.x.oo',
        timp: 'Bb2q r h. | C3q r h. | D3q r h. | D3q r q D3q D3q | Bb2q r h. | C3q r h. | A2q r h. | A2q A2q A2q A2q',
        sus: 'r w | r w | r w | r w | r w | r w | r w | C4w',
      },
    },
    {
      chords: ENEMY_CHORDS,
      parts: {
        horn: ENEMY_MEL,
        oboe: 'A5w | A5h G5h | F5w | E5w | A5w | A5h C6h | D6w | C#6w',
        brass: stab('8:X..X..X.', { lo: 'D4', n: 3, len: 0.3 }),
        ...enemyBed,
        snare: '16:o.o.x.o.o.o.x.oo',
        timp: ENEMY_TIMP,
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// battle: fast fight theme (E minor, 150 bpm). One-bar orchestral hit + tom fill, then driving 16ths.

const BATTLE_CHORDS = 'Em C D Em Am C D B7';
const BATTLE_MEL = 'E5q B4e E5e G5q. F#5e | E5h G5q C6q | B5q. A5e F#5q D5q | E5h. r q | A5q E5e A5e C6q. B5e | G5h E5q G5q | F#5q. G5e A5q F#5q | D#5h. F#5q';
const battleBed = {
  ost: bass('1 1 8 1 1 1 8 1 1 1 8 1 5 1 8 1', { lo: 'E3', step: 0.25 }),
  bass: bass('1 - - 1 - - 1 -', { lo: 'E2' }),
  str: pad({ lo: 'G3' }),
  kick: '16:X.....x.X.....x.',
  snare: '16:....X..o....X.oo',
  hat: '16:x.x.x.x.x.x.x.x.',
};
const BATTLE_TIMP = 'E2q! r q E2q r q | C3q r h. | D3q r h. | E2q! r e E2e E2q E2q | A2q r h. | C3q r h. | D3q r h. | B2q B2q B2q B2q';

const battle = {
  key: 'E minor', bpm: 150, maxFadeIn: 0.08, gain: 0.75,
  parts: {
    brass: { inst: 'brass', vol: 0.8, wet: 0.25, pan: -0.05, lead: true, vel: 0.9 },
    vln: { inst: 'strlead', vol: 0.65, wet: 0.3, pan: 0.15, lead: true, vel: 0.85 },
    horn: { inst: 'horn', vol: 0.65, wet: 0.3, pan: -0.2, lead: true, vel: 0.85 },
    hit: { inst: 'brass', vol: 0.5, wet: 0.3, vel: 1 },
    stabs: { inst: 'brass', vol: 0.4, wet: 0.25, pan: 0.2, vel: 0.85 },
    ost: { inst: 'lowstr', vol: 0.65, wet: 0.15, vel: 0.8 },
    bass: { inst: 'bass', vol: 0.7, wet: 0.08, vel: 0.85 },
    str: { inst: 'strings', vol: 0.4, wet: 0.3, prio: 0, vel: 0.6, opts: { attack: 0.15 } },
    kick: { inst: 'kick', vol: 0.45, wet: 0.05, vel: 0.9 },
    snare: { inst: 'snare', vol: 0.6, wet: 0.2, vel: 0.85 },
    hat: { inst: 'hat', vol: 0.6, wet: 0.1, pan: 0.25, vel: 0.8 },
    cym: { inst: 'crash', vol: 0.5, wet: 0.3, vel: 0.9 },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.25, vel: 0.9 },
    tom: { inst: 'tom', vol: 0.35, wet: 0.2, vel: 0.9 },
  },
  intro: [{
    chords: 'Em',
    parts: {
      hit: 'E3+B3+E4+G4q! r e E3+B3+E4+G4e! r h',
      str: 'E3+B3+E4+G4q r e E3+B3+E4+G4e r h',
      timp: 'E2q! r e E2e! r h',
      cym: '4:X...',
      kick: '16:X.....X.........',
      tom: 'r h E3s! D3 C3 B2 A2 G2 E2 E2!',
      snare: '16:........ooooxxxX',
    },
  }],
  loop: [
    { chords: BATTLE_CHORDS, parts: { brass: BATTLE_MEL, ...battleBed, cym: crashAt(8, 0), timp: BATTLE_TIMP } },
    {
      chords: 'C D Bm Em C D B7 B7',
      parts: {
        vln: 'G5q. A5e B5q C6q | D6h. A5q | B5q. A5e F#5q D5q | E5w | G5q. A5e B5q C6q | D6q. E6e F#6q A6q | F#6h D#6h | B5h. r q',
        stabs: stab('8:X..X..X.', { lo: 'E4', n: 3, len: 0.25 }),
        ...battleBed,
        cym: crashAt(8, 0, 4),
        timp: 'C3q r h. | D3q r h. | B2q r h. | E2q r q E2q E2q | C3q r h. | D3q r h. | B2q r h. | B2q B2q B2e B2e B2q',
      },
    },
    {
      chords: 'Am Am Em Em C C B B7',
      parts: {
        horn: 'A4h. C5q | E5w | B4h. G4q | E4w | C5h. E5q | G5w | F#5h. D#5q | B4w',
        ost: bass('1 . 1 . 1 . 1 . 1 . 1 . 5 . 8 .', { lo: 'E3', step: 0.25, vel: 0.8 }),
        bass: bass('1 - - - - - - -', { lo: 'E2' }),
        str: pad({ lo: 'A3' }),
        kick: '16:X.......X.......',
        snare: `16:${'........X.......'.repeat(6)}x.x.x.x.xxxxxxxxXXXXXXXXXXXXXXXX`,
        hat: '16:....x.......x...',
        timp: 'A2q r h. | r w | E2q r h. | r w | C3q r h. | r w | B2q r h. | B2q B2q B2q B2q',
        cym: crashAt(8, 0),
      },
    },
    {
      chords: BATTLE_CHORDS,
      parts: {
        brass: BATTLE_MEL,
        vln: BATTLE_MEL,
        ...battleBed,
        hat: '16:xoxoxoxoxoxoxoxo',
        cym: crashAt(8, 0, 4),
        timp: BATTLE_TIMP,
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// boss: intense boss theme (C minor, 132 bpm). Choir pads, taiko toms, low brass, Neapolitan turns.

const BOSS_CHORDS = 'Cm Ab Fm G Cm Ab Db G7';
const BOSS_MEL = 'C5q. D5e Eb5q G5q | Ab5h. G5q | F5q. G5e Ab5q C6q | B5h. r q | C6q. Bb5e G5q Eb5q | F5q. Eb5e C5q Ab4q | Db5h F5h | D5h B4h';
const BOSS_TIMP = 'C3q! r h. | Ab2q r h. | F2q r h. | G2q r G2e G2e G2q | C3q! r h. | Ab2q r h. | Db3q r h. | G2q G2q G2q G2q';
const bossBed = {
  choir: pad({ lo: 'G3' }),
  ost: bass('1 1 8 1 1 1 5 b7', { lo: 'C3' }),
  bass: bass('1 - - - 1 - - -', { lo: 'C2' }),
  tom: '8:X..xX.x.',
  tomhi: '8:..x...xx',
  kick: '4:x.x.',
  snare: '4:.x.x',
};

const boss = {
  key: 'C minor', bpm: 132, gain: 0.72,
  parts: {
    choir: { inst: 'choir', vol: 0.8, wet: 0.5, prio: 1, vel: 0.75 },
    brass: { inst: 'brass', vol: 0.75, wet: 0.3, lead: true, vel: 0.9, oct: -1, opts: { bright: 0.85 } },
    horn: { inst: 'horn', vol: 0.7, wet: 0.35, pan: -0.2, lead: true, vel: 0.85 },
    vln: { inst: 'strlead', vol: 0.6, wet: 0.35, pan: 0.15, lead: true, vel: 0.85 },
    stabs: { inst: 'brass', vol: 0.45, wet: 0.3, pan: 0.1, vel: 0.9 },
    ost: { inst: 'lowstr', vol: 0.7, wet: 0.15, vel: 0.85 },
    bass: { inst: 'bass', vol: 0.6, wet: 0.08, vel: 0.9 },
    tom: { inst: 'tom', vol: 0.45, wet: 0.25, drum: true, note: 'G1', vel: 0.95 },
    tomhi: { inst: 'tom', vol: 0.35, wet: 0.25, drum: true, note: 'D2', pan: 0.25, vel: 0.85 },
    kick: { inst: 'kick', vol: 0.45, wet: 0.05, vel: 0.9 },
    snare: { inst: 'snare', vol: 0.6, wet: 0.25, vel: 0.85 },
    cym: { inst: 'crash', vol: 0.5, wet: 0.35, vel: 0.9 },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.3, vel: 0.9 },
  },
  intro: [{
    chords: 'Cm Cm',
    parts: {
      choir: pad({ lo: 'G3' }),
      ost: bass('1 1 8 1 1 1 5 b7', { lo: 'C3' }),
      tom: '8:X..xX.x.X..xX.xx',
      timp: 'C3q! r h. | C3e C3e C3e C3e G2q G2q',
      cym: '4:X.......',
    },
  }],
  loop: [
    { chords: BOSS_CHORDS, parts: { brass: BOSS_MEL, ...bossBed, cym: crashAt(8, 0, 4), timp: BOSS_TIMP } },
    {
      chords: 'Fm Cm Ab Eb Fm Cm Db G',
      parts: {
        vln: 'Ab5q G5q F5q C6q | Eb6h. D6q | C6q Bb5q Ab5q Eb5q | G5w | Ab5q G5q F5q C6q | Eb6q. F6e G6q Eb6q | F6h. Db6q | D6h B5h',
        stabs: stab('8:X.....x.', { lo: 'C4', n: 3, len: 0.4 }),
        ...bossBed,
        choir: pad({ lo: 'G3', vel: 0.9 }),
        cym: crashAt(8, 0, 4),
        timp: 'F2q r h. | C3q r h. | Ab2q r h. | Eb2q r h. | F2q r h. | C3q r h. | Db3q r h. | G2q G2q G2q G2q',
      },
    },
    {
      chords: 'Ab Bb Cm Cm Ab Bb G G7',
      parts: {
        horn: 'Eb4h C4h | D4h F4h | G4w | G4h. F4e Eb4e | Eb4h C5h | D5h F5h | D5w | B4h G4h',
        ...bossBed,
        choir: pad({ lo: 'C4' }),
        ost: bass('1 . 1 . 1 . 1 .', { lo: 'C3' }),
        bass: bass('1 - - - - - - -', { lo: 'C2' }),
        tom: '8:X.X.X.X.',
        tomhi: '8:.x.x.x.x',
        timp: 'Ab2q r h. | Bb2q r h. | C3q r h. | C3q C3q C3q C3q | Ab2q r h. | Bb2q r h. | G2q r h. | G2e G2e G2e G2e G2q! r q',
        cym: crashAt(8, 0),
      },
    },
    { chords: BOSS_CHORDS, parts: { brass: BOSS_MEL, vln: BOSS_MEL, ...bossBed, cym: crashAt(8, 0, 4), timp: BOSS_TIMP } },
  ],
};

// ---------------------------------------------------------------------------------------------
// final: epic battle against the dragon (D minor -> D major, 144 bpm). The Emberwing motif returns.

const FINAL_CHORDS = 'Dm Bb Gm A Dm F/C Eb A7';
const FINAL_MEL = 'D5q. A4e D5q F5q | F5h. D5q | G5q. A5e Bb5q D6q | C#6h. r q | D6q. C6e A5q F5q | G5q. F5e E5q C5q | Bb4q. Eb5e G5q Bb5q | A5h. E5e C#5e';
const FINAL_TIMP = 'D2q! r q D2q r q | Bb2q r h. | G2q r h. | A2q r q A2e A2e A2q | D2q! r q D2q r q | C3q r h. | Eb2q r h. | A2q A2q A2q A2q';
const finalBed = {
  ost: bass('1 1 8 1 1 1 8 1 b2 1 8 1 5 1 8 1', { lo: 'D3', step: 0.25 }),
  bass: bass('1 - - 1 - - 1 -', { lo: 'D2' }),
  str: pad({ lo: 'A3' }),
  choir: pad({ lo: 'D4', n: 3, vel: 0.8 }),
  kick: '16:X.....x.X.....x.',
  snare: '16:....X..o....X.oo',
  hat: '16:x.x.x.x.x.x.x.x.',
};

const finale = {
  key: 'D minor / D major', bpm: 144, gain: 0.72,
  parts: {
    brass: { inst: 'brass', vol: 0.75, wet: 0.3, lead: true, vel: 0.9 },
    horn: { inst: 'horn', vol: 0.7, wet: 0.3, pan: -0.2, lead: true, vel: 0.85, oct: -1 },
    vln: { inst: 'strlead', vol: 0.6, wet: 0.35, pan: 0.15, lead: true, vel: 0.85 },
    choir: { inst: 'choir', vol: 0.75, wet: 0.5, prio: 1, vel: 0.75 },
    str: { inst: 'strings', vol: 0.4, wet: 0.35, prio: 0, vel: 0.6, opts: { attack: 0.2 } },
    ost: { inst: 'lowstr', vol: 0.7, wet: 0.15, vel: 0.85 },
    bass: { inst: 'bass', vol: 0.6, wet: 0.08, vel: 0.9 },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.3, vel: 0.9 },
    tom: { inst: 'tom', vol: 0.4, wet: 0.25, drum: true, note: 'A1', vel: 0.95 },
    kick: { inst: 'kick', vol: 0.45, wet: 0.05, vel: 0.9 },
    snare: { inst: 'snare', vol: 0.6, wet: 0.2, vel: 0.85 },
    hat: { inst: 'hat', vol: 0.4, wet: 0.1, pan: 0.2, vel: 0.8 },
    cym: { inst: 'crash', vol: 0.5, wet: 0.35, vel: 0.9 },
    sus: { inst: 'suscym', vol: 0.45, wet: 0.4, vel: 0.85 },
  },
  intro: [{
    chords: 'Dm Dm',
    parts: {
      choir: pad({ lo: 'A3' }),
      brass: 'D4+A4w! | ~h. r q',
      timp: 'D2q! r h. | D2s D2 D2 D2 A2 A2 A2 A2 D2q! r q',
      tom: '16:................X.x.X.x.XxXxXXXX',
      sus: 'r w | C4w',
      cym: '4:X.......',
    },
  }],
  loop: [
    { chords: FINAL_CHORDS, parts: { brass: FINAL_MEL, ...finalBed, cym: crashAt(8, 0, 4), timp: FINAL_TIMP } },
    {
      chords: 'Gm Bb Dm C Gm Bb A A7',
      parts: {
        vln: 'Bb5h. A5e G5e | F5h D6h | C6q. Bb5e A5q F5q | G5w | Bb5h. C6e D6e | F6h. D6q | E6q. D6e C#6q A5q | E6h. r q',
        horn: 'D5w | D5w | F5w | E5w | D5w | D5w | C#5w | C#5w',
        ...finalBed,
        choir: pad({ lo: 'G3' }),
        kick: '4:x.x.',
        snare: '4:.x.x',
        tom: '8:X..xX.x.',
        cym: crashAt(8, 0),
        timp: 'G2q r h. | Bb2q r h. | D2q r h. | C3q r h. | G2q r h. | Bb2q r h. | A2q r h. | A2e A2e A2e A2e A2q! r q',
      },
    },
    { chords: FINAL_CHORDS, parts: { brass: FINAL_MEL, horn: FINAL_MEL, vln: FINAL_MEL, ...finalBed, cym: crashAt(8, 0, 4), timp: FINAL_TIMP } },
    {
      chords: THEME_CHORDS,
      parts: {
        brass: THEME,
        horn: THEME,
        ...finalBed,
        ost: bass('1 1 8 1 1 1 8 1 1 1 8 1 5 1 8 1', { lo: 'D3', step: 0.25 }),
        choir: pad({ lo: 'A3' }),
        hat: '16:xoxoxoxoxoxoxoxo',
        cym: crashAt(8, 0, 4),
        timp: 'D2q! r q D2q r q | G2q r h. | E2q r h. | A2q r q A2e A2e A2q | D2q! r q D2q r q | G2q r h. | A2q r q A2q A2q | D2q! r h.',
        sus: 'r w | r w | r w | r w | r w | r w | r w | C4w',
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// One-shots: victory fanfare (~6 s), defeat phrase (~6 s), level-up jingle (~2 s).

const victory = {
  key: 'C major', bpm: 120, once: true, maxFadeIn: 0.05, gain: 0.85,
  parts: {
    brass: { inst: 'brass', vol: 0.75, wet: 0.35, lead: true, vel: 0.9 },
    horn: { inst: 'horn', vol: 0.65, wet: 0.35, pan: -0.2, lead: true, vel: 0.85 },
    str: { inst: 'strings', vol: 0.5, wet: 0.45, prio: 0, vel: 0.7, opts: { attack: 0.08, release: 1.4 } },
    harp: { inst: 'harp', vol: 0.5, wet: 0.5, pan: 0.3, vel: 0.75 },
    bass: { inst: 'bass', vol: 0.7, wet: 0.15, vel: 0.8, opts: { release: 0.8 } },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.3, vel: 0.9 },
    snare: { inst: 'snare', vol: 0.4, wet: 0.25, vel: 0.8 },
    cym: { inst: 'crash', vol: 0.5, wet: 0.4, vel: 0.9 },
  },
  loop: [{
    chords: 'C Ab:2 Bb:2 C',
    parts: {
      brass: 'G4e. G4s G4e. G4s C5q E5q | Eb5q. C5e F5q D5q | E5w',
      horn: 'E4e. E4s E4e. E4s G4q G4q | C5q. Ab4e Bb4q Bb4q | G4w',
      str: pad({ lo: 'G3' }),
      harp: 'r w | r w | C4s E4 G4 C5 E5 G5 C6 E6 G6h',
      bass: 'C2h. G1q | Ab1h Bb1h | C2w',
      timp: 'C3q! r h G2e G2e | Ab2q r q Bb2q Bb2q | C3q! r h.',
      snare: `16:${'.'.repeat(16)}oooooooxxxxxxxxXX${'.'.repeat(15)}`,
      cym: '4:X.......X...',
    },
  }],
};

const defeat = {
  key: 'A minor', bpm: 60, meter: 3, once: true,
  parts: {
    oboe: { inst: 'oboe', vol: 0.8, wet: 0.5, lead: true, vel: 0.7 },
    str: { inst: 'strings', vol: 0.6, wet: 0.5, prio: 0, vel: 0.6, opts: { attack: 0.5, release: 1.8 } },
    bass: { inst: 'bass', vol: 0.6, wet: 0.2, vel: 0.6, opts: { attack: 0.1, release: 1.2 } },
    harp: { inst: 'harp', vol: 0.5, wet: 0.5, pan: 0.3, vel: 0.55 },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.35, vel: 0.5 },
  },
  loop: [{
    chords: 'Dm E7:1.5 Am:1.5',
    parts: {
      oboe: 'A5q. G5e F5q | E5h.',
      str: pad({ lo: 'D3' }),
      bass: 'D2h. | E2q. A1q.',
      harp: 'r h. | r q. A2e E3e A3e',
      timp: 'r h. | r q. A2q.',
    },
  }],
};

const levelup = {
  key: 'C major', bpm: 140, once: true, maxFadeIn: 0.02,
  parts: {
    bell: { inst: 'bell', vol: 0.45, wet: 0.4, pan: 0.15, lead: true, vel: 0.85 },
    brass: { inst: 'brass', vol: 0.5, wet: 0.3, lead: true, vel: 0.85 },
    timp: { inst: 'timpani', vol: 0.7, wet: 0.3, vel: 0.85 },
    cym: { inst: 'crash', vol: 0.4, wet: 0.4, vel: 0.8 },
  },
  loop: [{
    chords: 'C:1 F:1 G:1 C:1',
    parts: {
      bell: 'C6s E6 G6 C6 F6 A6 C7 F6 G6 B6 D7 G6 C7q',
      brass: 'C5+E5+G5e! r e A4+C5+F5e! r e B4+D5+G5e! r e C5+E5+G5+C6q!',
      timp: 'C3q! r q G2q C3q!',
      cym: '4:...X',
    },
  }],
};

// ---------------------------------------------------------------------------------------------
// ending: emotional credits theme (G major, 80 bpm). The main theme slowed and re-voiced.

const ending = {
  key: 'G major', bpm: 80,
  parts: {
    vln: { inst: 'strlead', vol: 0.7, wet: 0.5, pan: 0.1, lead: true, vel: 0.75, opts: { attack: 0.12, vib: 10 } },
    flute: { inst: 'flute', vol: 0.75, wet: 0.5, pan: -0.15, lead: true, vel: 0.7 },
    horn: { inst: 'horn', vol: 0.65, wet: 0.45, pan: -0.25, lead: true, vel: 0.7, oct: -1 },
    str: { inst: 'strings', vol: 0.55, wet: 0.5, prio: 0, vel: 0.6, opts: { attack: 0.6, release: 1.4 } },
    harp: { inst: 'harp', vol: 0.5, wet: 0.5, pan: 0.3, prio: 0, vel: 0.6 },
    bass: { inst: 'bass', vol: 0.6, wet: 0.2, vel: 0.65, opts: { attack: 0.06 } },
    timp: { inst: 'timpani', vol: 0.6, wet: 0.35, vel: 0.6 },
    cym: { inst: 'crash', vol: 0.35, wet: 0.5, vel: 0.6 },
    sus: { inst: 'suscym', vol: 0.35, wet: 0.5, vel: 0.7 },
  },
  loop: [
    {
      chords: THEME_CHORDS, tr: -7,
      parts: {
        vln: THEME,
        str: pad({ lo: 'A3' }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'D4' }),
        bass: bass('1 - - - 5 - - -', { lo: 'D3' }),
      },
    },
    {
      chords: 'Em C G D/F# Em C Am7:2 D:2 D',
      parts: {
        flute: 'B5h. A5e G5e | G5h E5h | D5q. E5e G5q B5q | A5w | B5h. D6e B5e | A5h G5h | E5q. G5e F#5q A5q | D5w',
        horn: 'G5w | G5w | G5w | F#5w | G5w | E5w | E5h F#5h | F#5w',
        str: pad({ lo: 'E3' }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'E3' }),
        bass: bass('1 - - - 5 - - -', { lo: 'E2' }),
      },
    },
    {
      chords: THEME_CHORDS, tr: -7,
      parts: {
        vln: THEME,
        horn: THEME,
        flute: 'F#6w | D6w | E6w | E6w | F#6w | D6w | D6h E6h | D6w',
        str: pad({ lo: 'A3' }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'D4' }),
        bass: bass('1 - - - 5 - - -', { lo: 'D3' }),
        timp: 'D3q! r h. | r w | r w | r h. A2q | D3q r h. | r w | r w | D3q r h.',
        cym: crashAt(8, 0),
      },
    },
    {
      chords: 'Cmaj7 Bm7 Am7 D7sus4:2 D:2',
      parts: {
        flute: 'E6h. D6q | D6h. B5q | C6h. A5q | A5h F#5h',
        str: pad({ lo: 'E3' }),
        harp: arp('1 5 8 10 12 10 8 5', { lo: 'E3' }),
        bass: bass('1 - - - - - - -', { lo: 'E2' }),
        sus: 'r w | r w | r w | C4w',
      },
    },
  ],
};

const TRACK_DEFS = {
  title, story, camp, player, enemy, battle, boss, final: finale, victory, defeat, levelup, ending,
};

/** All track names. */
export const TRACK_NAMES = Object.keys(TRACK_DEFS);

const compiled = new Map();

/**
 * Compiled track (events in beats, tempo, parts, intro/loop segments, lint warnings), cached.
 * @param {string} name
 * @returns {object|null}
 */
export function getTrack(name) {
  if (!Object.prototype.hasOwnProperty.call(TRACK_DEFS, name)) return null;
  if (!compiled.has(name)) compiled.set(name, compile(name, TRACK_DEFS[name]));
  return compiled.get(name);
}
