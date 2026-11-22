/**
 * Building blocks for the cel-shaded anime portraits rendered by portraits.js:
 * colour maths, spline/ribbon geometry, an SVG defs collector and the part generators
 * (face, eyes, mouth, hair, outfits, headgear, creatures). Coordinates live in a 512×512
 * frame; the character faces slightly towards the viewer's right and the key light comes
 * from the upper left.
 */

// ------------------------------------------------------------------ colour
const c8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const pack = (r, g, b) => (c8(r) << 16) | (c8(g) << 8) | c8(b);

export const hex = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
export const mix = (a, b, t) => {
  const A = rgb(a), B = rgb(b);
  return pack(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
};
export const mul = (a, b) => {
  const A = rgb(a), B = rgb(b);
  return pack((A[0] * B[0]) / 255, (A[1] * B[1]) / 255, (A[2] * B[2]) / 255);
};
export const lum = (n) => {
  const [r, g, b] = rgb(n);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
export const INK = 0x2a1a1f;
export const inkOf = (c) => mix(mul(c, 0x5a3a48), INK, 0.6);
export const shadeOf = (c) => mix(c, mul(c, 0xa090c8), lum(c) > 0.75 ? 0.5 : 0.82);
export const lightOf = (c, k = 0.42) => mix(c, 0xffffff, k);

/** Cel tones for one material (hex strings plus the raw numbers). */
export function tone(c) {
  const s = shadeOf(c);
  const d = mix(s, mul(s, 0x6a5a90), 0.55);
  return { n: c, sn: s, c: hex(c), s: hex(s), d: hex(d), l: hex(lightOf(c)), k: hex(inkOf(c)) };
}

// ------------------------------------------------------------------ geometry
export const f1 = (v) => Math.round(v * 10) / 10;
export const fmt = (p) => `${f1(p[0])} ${f1(p[1])}`;
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function segs(pts, closed, ten) {
  const n = pts.length, out = [];
  const at = (i) => (closed ? pts[((i % n) + n) % n] : pts[i < 0 ? 0 : i >= n ? n - 1 : i]);
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const k1 = ((p1[2] ?? 1) * ten) / 6, k2 = ((p2[2] ?? 1) * ten) / 6;
    out.push([
      p1,
      [p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1],
      [p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2],
      p2,
    ]);
  }
  return out;
}

/** Smooth Catmull-Rom path through points; an optional third coordinate scales the tangent (0 = corner). */
export function spline(pts, closed = false, ten = 1) {
  if (pts.length < 2) return '';
  let d = 'M' + fmt(pts[0]);
  for (const s of segs(pts, closed, ten)) d += `C${fmt(s[1])} ${fmt(s[2])} ${fmt(s[3])}`;
  return closed ? d + 'Z' : d;
}

export const poly = (pts, closed = true) => 'M' + pts.map(fmt).join('L') + (closed ? 'Z' : '');

/** Point on a cubic Bézier given as [p0, c1, c2, p1]. */
export function bz(s, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
}
export const bzPts = (s, n = 20, t0 = 0, t1 = 1) => Array.from({ length: n + 1 }, (_, i) => bz(s, t0 + ((t1 - t0) * i) / n));

/** Sample a Catmull-Rom spline into roughly n points. */
export function sample(pts, n = 32, closed = false, ten = 1) {
  const ss = segs(pts, closed, ten);
  const lens = ss.map((s) => Math.hypot(s[3][0] - s[0][0], s[3][1] - s[0][1]) + 0.01);
  const tot = lens.reduce((a, b) => a + b, 0);
  const out = [];
  ss.forEach((s, i) => {
    const m = Math.max(2, Math.round((n * lens[i]) / tot));
    for (let j = 0; j < m; j++) out.push(bz(s, j / m));
  });
  if (!closed) { const e = ss[ss.length - 1][3]; out.push([e[0], e[1]]); }
  return out;
}

/** Variable-width outline around an already sampled centre line; wf(t) returns the full width. */
export function ribbonOf(c, wf) {
  const N = c.length, L = [], R = [];
  for (let i = 0; i < N; i++) {
    const a = c[i > 0 ? i - 1 : 0], b = c[i < N - 1 ? i + 1 : N - 1];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const h = Math.max(0, wf(N > 1 ? i / (N - 1) : 0)) / 2;
    L.push([c[i][0] - ty * h, c[i][1] + tx * h]);
    R.push([c[i][0] + ty * h, c[i][1] - tx * h]);
  }
  return { L, R, c, d: poly(L.concat(R.slice().reverse())) };
}

/** Width profiles for ribbons, t in 0..1 along the stroke. */
export const PROF = {
  both: (t) => Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.6),
  soft: (t) => Math.pow(Math.max(0, Math.sin(Math.PI * (0.06 + 0.88 * t))), 0.45),
  tail: (t) => Math.pow(1 - t, 0.8),
  head: (t) => Math.pow(t, 0.8),
  flat: () => 1,
  lock: (t) => Math.pow(1 - t, 0.85) * (1 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1))),
  blunt: (t) => (t < 0.8 ? 1 + 0.15 * Math.sin((Math.PI * t) / 0.8) : Math.pow((1 - t) / 0.2, 0.6)),
};

/** Tapered stroke along a spline through pts. */
export const ribbon = (pts, w, prof = PROF.both, n = 28) => ribbonOf(sample(pts, n), (t) => w * prof(t)).d;

/** Closed ellipse path (rotation in degrees). */
export function ell(cx, cy, rx, ry, rot = 0) {
  const a = (rot * Math.PI) / 180, dx = rx * Math.cos(a), dy = rx * Math.sin(a);
  const r = `${f1(rx)} ${f1(ry)} ${f1(rot)} 1 0`;
  return `M${f1(cx - dx)} ${f1(cy - dy)}A${r} ${f1(cx + dx)} ${f1(cy + dy)}A${r} ${f1(cx - dx)} ${f1(cy - dy)}Z`;
}

/** Centre line of a hair lock from root to tip with a bend (px, + bows left of travel) and an S-curl. */
export function lockLine(root, tip, bend = 0, curl = 0) {
  const dx = tip[0] - root[0], dy = tip[1] - root[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  const at = (t, o) => [root[0] + dx * t + nx * o, root[1] + dy * t + ny * o];
  return [root, at(0.33, bend * 0.85 + curl), at(0.67, bend * 0.85 - curl), tip];
}

/** A pointed hair lock: ribbon that is widest near the root and sharp at the tip. */
export function lock(root, tip, w, bend = 0, curl = 0, prof = PROF.lock) {
  return ribbonOf(sample(lockLine(root, tip, bend, curl), 22), (t) => w * prof(t));
}

/** Translate every point of a list. */
export const shift = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy, ...p.slice(2)]);

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function rngFor(str) {
  let s = 2166136261;
  for (let i = 0; i < str.length; i++) { s ^= str.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ svg
const col = (c) => (typeof c === 'number' ? hex(c) : c);
const stopsOf = (stops) => stops
  .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${col(c)}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`)
  .join('');

/** Collects <defs> for one SVG and hands out ids under a unique prefix. */
export class Doc {
  constructor(uid) { this.uid = uid; this.defs = []; this.n = 0; }
  id(p) { return `${this.uid}-${p}${(this.n++).toString(36)}`; }
  clip(ds) {
    const id = this.id('c');
    this.defs.push(`<clipPath id="${id}">${[].concat(ds).filter(Boolean).map((d) => `<path d="${d}"/>`).join('')}</clipPath>`);
    return id;
  }
  lin(stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1, user = false) {
    const id = this.id('l');
    this.defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stopsOf(stops)}</linearGradient>`);
    return `url(#${id})`;
  }
  rad(stops, cx = 0.5, cy = 0.5, r = 0.5, user = false) {
    const id = this.id('r');
    this.defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${user ? ' gradientUnits="userSpaceOnUse"' : ''}>${stopsOf(stops)}</radialGradient>`);
    return `url(#${id})`;
  }
  blur(sd) {
    const id = this.id('b');
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`);
    return `url(#${id})`;
  }
}

export const fill = (d, c, a = '') => (d ? `<path d="${d}" fill="${col(c)}"${a}/>` : '');
export const line = (d, c, w, a = '') => (d ? `<path d="${d}" fill="none" stroke="${col(c)}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${a}/>` : '');
export const g = (s, a = '') => (s ? `<g${a}>${s}</g>` : '');
export const op = (o) => ` opacity="${o}"`;
export const clipTo = (doc, ds, s) => (s ? `<g clip-path="url(#${doc.clip(ds)})">${s}</g>` : '');
export const moved = (s, dx, dy) => (s ? `<g transform="translate(${f1(dx)} ${f1(dy)})">${s}</g>` : '');

/**
 * Draw shapes with one shared outer contour: every shape is first stroked at twice the line width
 * in the ink colour, then all fills go on top so only the outside half of the contour survives.
 * Each shape may carry an `after` string drawn right after its own fill (shading, inner lines).
 */
export function inked(shapes, ink, lw = 4) {
  const list = shapes.filter((s) => s && (s.d || s.raw));
  if (!list.length) return '';
  const ds = list.filter((x) => x.d).map((x) => x.d).join('');
  let s = ds ? `<path d="${ds}" fill="none" stroke="${col(ink)}" stroke-width="${lw * 2}" stroke-linejoin="round"/>` : '';
  for (const x of list) s += x.d ? fill(x.d, x.fill, x.a || '') + (x.after || '') : x.raw;
  return s;
}
// ------------------------------------------------------------------ frame & palette
/** Head and body geometry for a humanoid look. */
export function frameOf(look) {
  const male = look.gender === 'm', elder = look.age === 'elder', adult = look.age === 'adult';
  const heavy = look.body === 'heavy', slim = look.body === 'slim', petite = look.body === 'petite';
  const k = heavy ? 1.1 : slim ? 0.95 : petite ? 0.9 : 1;
  const shN = (male ? 196 : 166) * k;
  return {
    male, elder, adult, heavy, slim, petite,
    cx: 256, mx: 267, eyeY: 240, chinY: male ? 337 : 341,
    neckX: 257, neckW: male ? (heavy ? 84 : elder ? 58 : 66) : 52,
    bx: 266, shN, shF: shN * 0.86, shY: male ? 424 : 434, collarY: 390, gaze: 3,
  };
}

/** Skin, hair and eye tones for a humanoid look. */
export function paletteOf(look) {
  const skin = look.skin ?? 0xf3d2bd;
  const hair = look.hair?.color ?? 0x5a4030;
  const hs = look.hair?.shade ?? shadeOf(hair);
  const eye = look.eyes?.color ?? 0x6b4a2a;
  const skinS = mix(skin, mul(skin, 0xe2a09a), 0.62);
  const dark = lum(hair) < 0.16;
  const pale = lum(hair) > 0.6;
  return {
    skinN: skin, skin: hex(skin), skinS: hex(skinS), skinSN: skinS,
    skinD: hex(mix(skinS, mul(skinS, 0xb87070), 0.45)),
    skinL: hex(mix(skin, 0xffffff, 0.45)),
    skinLine: hex(mix(mul(skin, 0x8a4440), INK, 0.3)),
    skinInk: hex(mix(mul(skin, 0x4a2428), INK, 0.55)),
    blush: hex(mix(skin, 0xff5f6f, 0.6)),
    mouth: hex(mix(mul(skin, 0x5a2228), INK, 0.4)),
    mouthIn: hex(0x6e1f2a), tongue: hex(0xe36f78),
    hairN: hair, hairSN: hs, hair: hex(hair), hairS: hex(pale ? mix(hair, hs, 0.8) : hs), hairD: hex(mix(hs, INK, 0.3)), sheenOp: pale ? 0.6 : 0.85,
    hairL: hex(dark ? mix(hair, 0x9aa8dc, 0.45) : mix(hair, 0xfff2dc, pale ? 0.75 : 0.42)),
    hairInk: hex(dark ? mix(hs, 0x000000, 0.55) : mix(mul(hs, 0x5a3a4a), INK, 0.45)),
    hairLine: hex(dark ? mix(hair, 0x8a94c0, 0.32) : mix(hs, INK, pale ? 0.12 : 0.3)),
    brow: hex(pale ? mix(hs, INK, 0.38) : mix(hs, INK, 0.3)),
    lash: hex(mix(INK, mul(hs, 0x5a3040), 0.2)),
    lashLow: hex(mix(mix(INK, mul(hs, 0x5a3040), 0.2), skinS, 0.3)),
    white: '#fdfcff', whiteS: hex(mix(0xdcdff0, skinS, 0.25)),
    iris: hex(eye), irisD: hex(mix(eye, 0x1a0c18, 0.55)), irisL: hex(mix(eye, 0xffffff, 0.5)),
    irisRing: hex(mix(eye, 0x1a0c18, 0.7)), pupil: hex(mix(eye, 0x12060e, 0.78)), eyeN: eye,
  };
}

// ------------------------------------------------------------------ face
/** Face contour (cheeks, jaw, chin and the skull dome) as spline points. */
export function facePts(G) {
  const { mx } = G;
  const w = G.heavy ? 6 : 0;
  const top = [[352, 160], [332, 114], [284, 94], [230, 95], [186, 116], [162, 158]];
  let side;
  if (G.elder) {
    side = [[157, 206], [158, 246], [166, 280], [186, 312], [228, 337], [mx - 9, 347, 0.5], [mx + 9, 346, 0.5],
      [306, 333], [329, 305], [343, 273], [350, 247], [355, 214]];
  } else if (G.male) {
    side = [[156 - w, 206], [158 - w, 250], [167 - w, 284], [190 - w, 313], [229 - w * 0.5, 334], [mx - 10, G.chinY, 0.5],
      [mx + 9, G.chinY - 1, 0.5], [304 + w * 0.5, 326], [328 + w, 300], [343 + w, 272], [350 + w, 248], [355 + w, 214]];
  } else {
    side = [[158, 206], [161, 250], [171, 282], [194, 310], [232, 333], [mx - 1, G.chinY, 0.3],
      [302, 330], [326, 304], [341, 276], [348, 250], [354, 218]];
  }
  return [...side, ...top];
}

/** Ears; the near ear (viewer's left) is fully drawn, the far one only peeks out. */
export function earsSVG(G, pal, opts = {}) {
  const near = spline([[180, 236], [160, 224], [145, 230], [141, 250], [147, 272], [160, 288], [176, 292], [184, 262]], true);
  const nearIn = ribbon([[156, 238], [150, 254], [155, 272], [167, 282]], 2, PROF.both, 16);
  const far = spline([[338, 236], [356, 228], [366, 238], [364, 262], [355, 282], [340, 288], [334, 262]], true);
  let s = inked([
    { d: near, fill: pal.skin, after: fill(spline([[158, 238], [151, 254], [156, 272], [170, 282], [168, 256]], true), pal.skinS) + fill(nearIn, pal.skinLine) },
    { d: far, fill: pal.skin, after: fill(spline([[354, 238], [360, 252], [356, 270], [348, 276], [350, 252]], true), pal.skinS) },
  ], pal.skinInk, 3.4);
  if (opts.earring) {
    s += line('M162 290q-3 9 2 15', opts.earring.k, 2);
    s += inked([{ d: ell(165, 312, 5, 6), fill: opts.earring.c }], opts.earring.k, 1.6) + fill(ell(163.5, 310, 1.6, 2), '#fff', op(0.8));
  }
  return s;
}

/** Neck column with the jaw's cast shadow. */
export function neckSVG(doc, G, pal, faceD) {
  const l = G.neckX - G.neckW / 2, r = G.neckX + G.neckW / 2;
  const d = spline([[l + 3, 250, 0], [l + 1, 320], [l - 5, 372], [l - 22, 414, 0], [r + 22, 414, 0], [r + 5, 372], [r - 1, 320], [r - 3, 250, 0]], true);
  let sh = moved(fill(faceD, pal.skinS), 3, 20);
  sh += fill(poly([[r - 15, 250], [r + 6, 250], [r + 12, 420], [r - 6, 420]]), pal.skinS);
  return { d, svg: inked([{ d, fill: pal.skin, after: clipTo(doc, d, sh) }], pal.skinInk, 3.6) };
}

// ------------------------------------------------------------------ eyes
const EYES = {
  bright: { iv: 0.1, ov: -0.02, a: [0.12, -0.62], b: [0.6, -0.72], lo: 0.52, ir: [0.3, 0.56], lw: 1, wing: [0.15, 0.05], hl: 3 },
  gentle: { iv: 0.04, ov: 0.12, a: [0.18, -0.6], b: [0.64, -0.56], lo: 0.5, ir: [0.3, 0.54], lw: 0.95, wing: [0.1, 0.12], hl: 2 },
  sharp: { iv: 0.14, ov: -0.16, a: [0.22, -0.46], b: [0.6, -0.66], lo: 0.38, ir: [0.25, 0.5], lw: 1, wing: [0.17, -0.05], hl: 2 },
  sleepy: { iv: 0.08, ov: 0.08, a: [0.2, -0.32], b: [0.62, -0.36], lo: 0.48, ir: [0.29, 0.56], lw: 1.05, wing: [0.1, 0.07], hl: 2, lid: 1 },
  fierce: { iv: 0.22, ov: -0.2, a: [0.26, -0.38], b: [0.62, -0.64], lo: 0.36, ir: [0.24, 0.48], lw: 1.15, wing: [0.18, -0.08], hl: 2 },
  cold: { iv: 0.12, ov: -0.14, a: [0.26, -0.3], b: [0.62, -0.48], lo: 0.32, ir: [0.22, 0.46], lw: 1, wing: [0.19, -0.06], hl: 1 },
};

/** Placement of one eye: inner corner, direction towards the outer corner and size. */
export function eyeBox(G, side) {
  const far = side === 'far';
  const W0 = G.elder ? 46 : G.male ? 54 : 58;
  const H = G.elder ? 32 : G.male ? 42 : 50;
  return { far, W0, W: far ? W0 * 0.88 : W0, H, dir: far ? 1 : -1, xi: far ? G.mx + 20 : G.mx - 24, yi: G.eyeY };
}

function closedEye(E, pal, lw, kind) {
  if (kind === 'squeeze') {
    const v = E(0.12, 0.06), a = E(0.98, -0.44), b = E(0.98, 0.42);
    return fill(ribbon([a, E(0.56, -0.24), v], lw * 0.95, PROF.soft), pal.lash)
      + fill(ribbon([v, E(0.56, 0.26), b], lw * 0.8, PROF.soft), pal.lash)
      + fill(ribbon([E(0.34, -0.56), E(0.7, -0.68), E(1.04, -0.62)], 1.7, PROF.both), pal.skinLine, op(0.7));
  }
  return fill(ribbon([E(0, 0.14), E(0.5, -0.3), E(1.06, 0.1)], lw, PROF.soft), pal.lash);
}

/** One anime eye. ex: { open, tilt, droop, lower, iris, closed } */
export function eyeSVG(doc, G, pal, side, shape, ex = {}) {
  const S = EYES[shape] || EYES.bright;
  const B = eyeBox(G, side);
  const { W, H, dir, xi, yi } = B;
  const E = (u, v) => [xi + dir * u * W, yi + v * H];
  const lashW = (G.male ? 4.4 : 5.6) * S.lw;
  if (ex.closed) return closedEye(E, pal, lashW, ex.closed);
  const open = ex.open ?? 1, tilt = ex.tilt ?? 0, droop = ex.droop ?? 0;
  const lo = S.lo * (1 - (ex.lower ?? 0)) * (open > 1 ? 1 + (open - 1) * 0.6 : 1);
  const ov = S.ov + droop * 0.5;
  const I = E(0, S.iv), O = E(1, ov);
  const A = E(S.a[0], S.a[1] * open + tilt), Bc = E(S.b[0], S.b[1] * open + tilt * 0.3 + droop);
  const C = E(0.86, lo), D = E(0.26, lo * 0.98);
  const up = bzPts([I, A, Bc, O], 24), dn = bzPts([O, C, D, I], 24);
  const white = `M${fmt(I)}C${fmt(A)} ${fmt(Bc)} ${fmt(O)}C${fmt(C)} ${fmt(D)} ${fmt(I)}Z`;
  const topY = Math.min(...up.map((p) => p[1])), botY = Math.max(...dn.map((p) => p[1]));
  const k = ex.iris ?? 1;
  const irx = S.ir[0] * B.W0 * (B.far ? 0.9 : 1) * k, iry = S.ir[1] * H * k;
  const icx = E(0.5, 0)[0] + G.gaze, icy = (topY + botY) / 2 + H * 0.03;
  const irisD = ell(icx, icy, irx, iry);
  const band = (dy) => poly([...up, ...up.slice().reverse().map((p) => [p[0], p[1] + dy])]);
  let inner = fill(white, pal.white) + fill(band(H * 0.24), pal.whiteS);
  inner += fill(irisD, doc.lin([[0, pal.irisD], [0.55, pal.iris], [1, pal.irisL]]));
  inner += clipTo(doc, irisD, fill(ell(icx, icy + iry * 0.66, irx * 0.84, iry * 0.44), pal.irisL, op(0.7)));
  inner += fill(ell(icx, icy - iry * 0.04, irx * 0.46, iry * 0.52), pal.pupil);
  inner += line(irisD, pal.irisRing, 1.6);
  inner += fill(band(H * 0.34), pal.irisD, op(0.32));
  inner += fill(ell(icx - irx * 0.34, icy - iry * 0.34, irx * 0.36, iry * 0.26, -24), '#fff');
  if (S.hl > 1) inner += fill(ell(icx + irx * 0.42, icy + iry * 0.46, irx * 0.17, irx * 0.17), '#fff', op(0.92));
  if (S.hl > 2) inner += fill(ell(icx + irx * 0.08, icy - iry * 0.62, irx * 0.1, irx * 0.1), '#fff', op(0.85));
  let s = clipTo(doc, white, inner);
  const wingEnd = E(1 + S.wing[0], ov + S.wing[1]);
  const lc0 = [...up.slice(1), lerp2(O, wingEnd, 0.5), wingEnd];
  const nU = up.length - 2, N = lc0.length;
  const wf = (t) => {
    const i = t * (N - 1);
    if (i <= nU) return lashW * (0.26 + 0.74 * Math.pow(Math.min(1, i / nU / 0.55), 0.8));
    return lashW * Math.pow(Math.max(0, 1 - (i - nU) / (N - 1 - nU)), 0.85);
  };
  const lc = lc0.map((p, i) => [p[0], p[1] - wf(i / (N - 1)) * 0.28]);
  s += fill(ribbonOf(lc, wf).d, pal.lash);
  if (!G.male) {
    for (const [u, len, ang] of [[0.8, 7, 0.95], [0.95, 9, 0.55]]) {
      const p = bz([I, A, Bc, O], u);
      p[1] -= lashW * 0.35;
      const q = [p[0] + dir * len * Math.cos(ang), p[1] - len * Math.sin(ang)];
      s += fill(ribbon([p, lerp2(p, q, 0.5).map((v, j) => v + (j ? 1 : 0)), q], 2.8, PROF.tail, 10), pal.lash);
    }
  }
  s += fill(ribbonOf(dn.slice(1, 15), (t) => 2.3 * Math.pow(1 - t, 0.7) * Math.min(1, 0.4 + t * 6)).d, pal.lashLow);
  const cr = up.slice(5, 22).map((p) => [p[0] + dir * 1.5, p[1] - H * (S.lid ? 0.15 : 0.2) * (open > 1 ? 1.15 : 1)]);
  s += fill(ribbonOf(cr, (t) => 1.8 * PROF.both(t)).d, pal.skinLine, op(S.lid ? 0.9 : 0.72));
  return s;
}

/** Eyebrow; bp = [innerDy, outerDy, arch, pullTowardsNose] in px. Drawn over the fringe with a thin skin halo. */
export function browSVG(G, pal, side, bp) {
  const B = eyeBox(G, side);
  const { W, H, dir, xi, yi } = B;
  const X = (u) => xi + dir * u * W;
  const base = yi - H * 0.64 - (G.male ? 12 : 15);
  const [inner, outer, arch, pull] = bp;
  const p0 = [X(-0.06) - dir * pull, base + 5 + inner];
  const p2 = [X(1.08), base + 6 + outer];
  const p1 = [X(0.45), base - 3 - arch + (inner + outer) * 0.4];
  const w = G.male ? (G.heavy || G.adult ? 7.6 : 6.6) : G.elder ? 6 : 4.6;
  const prof = G.male ? (t) => Math.pow(1 - t, 0.5) * Math.min(1, 0.6 + t * 4) : (t) => PROF.soft(t) * (1 - 0.3 * t);
  const d = ribbonOf(sample([p0, p1, p2], 24), (t) => w * prof(t)).d;
  return line(d, pal.skin, 2.6, op(0.9)) + fill(d, pal.brow);
}

/** Small anime nose: cel wedge on the far side, tip line and a highlight. */
export function noseSVG(G, pal) {
  const x = G.mx + 6, y = G.eyeY + (G.male ? 45 : 41);
  let s = fill(spline([[x - 1, y - 24, 0], [x + 7, y - 9], [x + 7, y + 1], [x, y + 3.5, 0], [x + 1, y - 9]], true), pal.skinS);
  s += fill(ribbon([[x + 1, y - 13], [x + 6.5, y - 3], [x + 1, y + 2.5]], G.male ? 2.5 : 2.1, PROF.soft, 16), pal.skinLine);
  if (G.male) s += fill(ribbon([[x - 8, y + 2.5], [x - 3, y + 3.8]], 1.8, PROF.both, 8), pal.skinLine, op(0.65));
  if (G.elder) {
    s += fill(ribbon([[x - 22, y + 2], [x - 26, y + 14], [x - 24, y + 24]], 1.6, PROF.both), pal.skinLine, op(0.5));
    s += fill(ribbon([[x + 18, y + 2], [x + 22, y + 13], [x + 21, y + 22]], 1.4, PROF.both), pal.skinLine, op(0.45));
  }
  s += fill(ell(x - 3, y - 4, 2.2, 1.5), '#fff', op(0.5));
  return s;
}

/** Mouth shapes for every expression. */
export function mouthSVG(doc, G, pal, kind) {
  const cx = G.mx + 3, cy = G.chinY - (G.male ? 31 : 33);
  const mw = G.male ? 1.15 : 1;
  const M = ([x, y, k]) => (k === undefined ? [cx + (x > 0 ? x * 0.88 : x) * mw, cy + y] : [cx + (x > 0 ? x * 0.88 : x) * mw, cy + y, k]);
  const lip = (pts, w = 2.6) => fill(ribbon(pts.map(M), w, PROF.soft), pal.mouth);
  const lower = (y = 8, w = 6) => fill(ribbon([M([-w, y]), M([0, y + 1]), M([w, y])], 1.6, PROF.both, 10), pal.skinLine, op(0.4));
  const open = (pts, o = {}) => {
    const d = spline(pts.map(M), true);
    let inner = fill(d, pal.mouthIn);
    const ys = pts.map((p) => p[1]), top = Math.min(...ys), bot = Math.max(...ys);
    if (o.tongue) inner += fill(ell(cx + (o.tx ?? 0), cy + bot - o.tongue[1] * 0.4, o.tongue[0], o.tongue[1]), pal.tongue);
    if (o.teeth) inner += fill(poly([[cx - 40, cy + top - 4], [cx + 40, cy + top - 4], [cx + 40, cy + top + o.teeth], [cx - 40, cy + top + o.teeth]]), '#fffaf6');
    if (o.lowTeeth) inner += fill(poly([[cx - 40, cy + bot + 4], [cx + 40, cy + bot + 4], [cx + 40, cy + bot - o.lowTeeth], [cx - 40, cy + bot - o.lowTeeth]]), '#f4ecea');
    return clipTo(doc, d, inner) + line(d, pal.mouth, 2.2);
  };
  switch (kind) {
    case 'smile':
      return lip([[-15, -4], [-7, 1.5], [1, 3], [9, 1.5], [14, -3.5]], 2.8) + lower(9, 6);
    case 'grin':
      return open([[-20, -3, 0.2], [-8, -1], [8, -1], [19, -4, 0.2], [12, 9], [0, 14], [-12, 9]], { teeth: 5, tongue: [8, 4.5] })
        + lip([[-21, -3.5], [-8, -1.5], [8, -1.5], [20, -4.5]], 2.4);
    case 'clench': {
      const pts = [[-17, 3, 0.15], [-7, -2], [7, -2], [16, 3, 0.15], [13, 8], [0, 9], [-14, 8]];
      const d = spline(pts.map(M), true);
      let t = fill(d, '#fffaf6') + fill(ribbon([M([-15, 3.5]), M([0, 3]), M([14, 3.5])], 1.4, PROF.flat), pal.skinLine, op(0.75));
      for (const x of [-9, -2, 5, 11]) t += line(`M${fmt(M([x, -1]))}L${fmt(M([x, 8]))}`, '#c9bfc4', 1);
      return clipTo(doc, d, t) + line(d, pal.mouth, 2.2);
    }
    case 'frown':
      return lip([[-11, 4.5], [-4, 0.5], [4, 0], [11, 4]], 2.6) + lower(9, 4);
    case 'o':
      return open([[0, -5], [7, 2], [5, 10], [0, 12], [-6, 10], [-8, 2]], { tongue: [5, 3] });
    case 'firm':
      return lip([[-14, 1.5], [-6, 0], [6, 0], [13, 1.8]], 3.1) + lower(8, 6);
    case 'grit': {
      const pts = [[-16, 1, 0.15], [-6, -3], [6, -2], [15, 3, 0.15], [12, 7], [0, 9], [-14, 9]];
      const d = spline(pts.map(M), true);
      let t = fill(d, '#fffaf6') + fill(ribbon([M([-14, 3.5]), M([0, 3.5]), M([13, 5])], 1.4, PROF.flat), pal.skinLine, op(0.75));
      for (const x of [-8, -1, 6]) t += line(`M${fmt(M([x, -2]))}L${fmt(M([x, 9]))}`, '#c9bfc4', 1);
      return clipTo(doc, d, t) + line(d, pal.mouth, 2.2);
    }
    case 'smirk':
      return lip([[-15, -5], [-8, 0], [0, 1.6], [7, 1.2], [12, -0.2]], 2.8)
        + fill(ribbon([M([-15, -8]), M([-17, -5]), M([-16, -2])], 1.6, PROF.both, 8), pal.mouth, op(0.8)) + lower(8, 5);
    case 'wobble':
      return open([[-9, 3, 0.3], [-4, 0], [1, 1], [6, -0.5], [10, 2.5, 0.3], [5, 5], [-4, 5.5]], {})
        + lip([[-10, 3], [-4, -0.5], [1, 0.8], [6, -1], [11, 2.5]], 2);
    case 'shout':
      return open([[-21, -5, 0.3], [-8, -9], [8, -9], [19, -5, 0.3], [15, 13], [0, 23], [-16, 13]], { teeth: 5, tongue: [11, 6] })
        + lip([[-22, -5.5], [-8, -9.5], [8, -9.5], [20, -5.5]], 2.4);
    default:
      return lip([[-11, 0], [-3, 1.2], [5, 1], [11, -0.5]], 2.6) + lower(8, 5);
  }
}

// ------------------------------------------------------------------ expression overlays
export function angerMark(x, y, r = 17) {
  let s = '';
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const pts = [[x + a * 3.5, y + b * r], [x + a * r * 0.42, y + b * r * 0.42], [x + a * r, y + b * 3.5]];
    s += fill(ribbon(pts, 9, PROF.soft, 14), '#7a0c18') + fill(ribbon(pts, 5.4, PROF.soft, 14), '#ff3b4a');
  }
  return s;
}

export function sweatDrop(x, y, k = 1) {
  const d = spline([[x, y - 17 * k, 0], [x + 7 * k, y - 2 * k], [x + 7 * k, y + 7 * k], [x, y + 11 * k], [x - 7 * k, y + 7 * k], [x - 7 * k, y - 2 * k]], true);
  return inked([{ d, fill: '#c6ecff', after: fill(ell(x - 2.5 * k, y + 3 * k, 2.2 * k, 3.4 * k, 20), '#fff', op(0.9)) }], '#2f5f8e', 1.8);
}

export function tearDrop(G, pal) {
  const B = eyeBox(G, 'near');
  const x = B.xi - B.W * 0.86, y = B.yi + B.H * 0.5;
  const d = spline([[x, y, 0], [x + 4, y + 10], [x + 3, y + 17], [x - 2, y + 19], [x - 5, y + 15], [x - 4, y + 9]], true);
  return fill(ribbon([[x + 18, y - 1], [x + 8, y + 1], [x, y]], 2.6, PROF.both, 10), '#bfe8ff', op(0.85))
    + inked([{ d, fill: '#d8f3ff', after: fill(ell(x - 1.5, y + 13, 1.4, 2.6), '#fff') }], '#3f7fb4', 1.4);
}

export function scratchMarks(x, y) {
  let s = '';
  for (const [dx, dy, l] of [[0, 0, 22], [7, 5, 16]]) {
    s += fill(ribbon([[x + dx, y + dy], [x + dx + l * 0.55, y + dy - l * 0.32], [x + dx + l, y + dy - l * 0.5]], 2.6, PROF.both, 10), '#c93a43');
  }
  return s + fill(ribbon([[x + 4, y - 7], [x + 7, y + 9]], 1.4, PROF.both, 6), '#c93a43', op(0.7));
}
// ------------------------------------------------------------------ hair
const LIGHT = [-0.55, -0.83];
/** Hair lock entry: { r: ribbon, ...flags } */
export const L_ = (root, tip, w, bend = 0, curl = 0, o = {}) => ({ r: lock(root, tip, w, bend, curl, o.prof || PROF.lock), ...o });
/** Plain closed hair shape entry. */
export const S_ = (pts, o = {}) => ({ d: spline(pts, true), ...o });
const shapeD = (x) => (x.r ? x.r.d : x.d);

function lockAfter(r, pal, o) {
  const N = r.c.length, m = Math.floor(N / 3);
  const nl = [r.L[m][0] - r.c[m][0], r.L[m][1] - r.c[m][1]];
  const darkL = nl[0] * LIGHT[0] + nl[1] * LIGHT[1] < 0;
  const dark = darkL ? r.L : r.R, lit = darkL ? r.R : r.L;
  const out = [], inn = [];
  for (let i = Math.round((N - 1) * (o.shade0 ?? 0.08)); i < N; i++) {
    const t = i / (N - 1), f = (o.shadeK ?? 0.48) * Math.pow(1 - t, 0.3);
    out.push(dark[i]);
    inn.push(lerp2(dark[i], lit[i], f));
  }
  let s = fill(poly(out.concat(inn.reverse())), o.shade || pal.hairS);
  if (!o.noLine) {
    const j0 = Math.round((N - 1) * (o.line0 ?? 0.3));
    s += fill(ribbonOf(lit.slice(j0), (t) => 1.7 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)), 0.7)).d, o.lineC || pal.hairLine, op(0.9));
  }
  return s;
}

/** Zig-zag highlight band ("angel ring") along a centre line running left to right, broken into segments. */
export function sheenBand(pts, h = 7, teeth = 9, parts = [[0.03, 0.31], [0.36, 0.64], [0.69, 0.97]]) {
  const c = sample(pts, 60);
  const n = c.length, pattern = [1, 0.55, 1.25, 0.7, 1.05, 0.45, 0.9];
  let d = '';
  for (const [a, b] of parts) {
    const i0 = Math.round(a * (n - 1)), i1 = Math.round(b * (n - 1));
    const top = [], bot = [];
    for (let i = i0; i <= i1; i++) {
      const p = c[i], q0 = c[Math.max(0, i - 1)], q1 = c[Math.min(n - 1, i + 1)];
      let tx = q1[0] - q0[0], ty = q1[1] - q0[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const tp = Math.pow(Math.sin((Math.PI * (i - i0)) / Math.max(1, i1 - i0)), 0.5);
      const k = (i - i0) % 2;
      const u = (h * 0.45 + (k ? 1.8 : 0)) * tp, dn = (h * 0.55 + (k ? teeth * pattern[i % pattern.length] : 0.5)) * tp;
      top.push([p[0] + ty * u, p[1] - tx * u]);
      bot.push([p[0] - ty * dn, p[1] + tx * dn]);
    }
    d += poly(top.concat(bot.reverse()));
  }
  return d;
}

/** Strand line helper used by styles. */
export const strand = (pts, w = 1.7) => ribbon(pts, w, PROF.both, 18);

/**
 * Render a hair description { back, front, side, sheen, capLines, backLines, backShade, under, extraBack, extraFront }.
 * `mid` (e.g. a circlet) is slotted between the fringe and the side locks inside one inked group, so lock roots
 * stay hidden under the cap. Returns the layers plus the shapes that cast a shadow on the face.
 */
export function hairSVG(doc, G, pal, H, mid = '') {
  const prep = (list, after) => list.map((x) => ({
    d: shapeD(x), fill: x.fill || pal.hair,
    after: (after && x.r && !x.flat ? lockAfter(x.r, x.pal || pal, x) : '') + (x.after || ''),
  }));
  let back = '';
  if (H.back && H.back.length) {
    back = inked(prep(H.back, false), pal.hairInk, 4);
    back += clipTo(doc, H.back.map(shapeD), (H.backShade ?? fill(ell(G.neckX + 10, 336, 118, 132), pal.hairS)) + (H.backLines || ''));
  }
  const list = [...(H.front || []), ...(H.side || [])];
  let front = mid;
  if (list.length) {
    front = inked([...prep(H.front || [], true), { raw: mid }, ...prep(H.side || [], true)], pal.hairInk, 4);
    const sheen = H.sheen ? fill(sheenBand(H.sheen, H.sheenH ?? 7, H.sheenT ?? 7), pal.hairL, op(pal.sheenOp ?? 0.85)) : '';
    const extra = (H.capLines || '') + (H.sideLines || '') + sheen;
    if (extra) front += clipTo(doc, list.map(shapeD), extra);
  }
  const cast = list.filter((x) => !x.noCast).map(shapeD);
  return { back, front, cast, under: H.under || '', extraBack: H.extraBack || '', extraFront: H.extraFront || '' };
}

const capPts = (v = 0) => [[148 - v * 0.2, 240, 0.4], [134 - v, 186], [148 - v, 124], [198, 84 - v], [262, 74 - v],
  [324, 84 - v], [364 + v * 0.5, 122], [380 + v, 180], [372 + v * 0.4, 238, 0.4], [346, 198], [306, 160], [258, 150], [212, 158], [176, 194]];
const cap = (v = 0, o = {}) => S_(capPts(v), { cap: true, ...o });
const SHEEN = [[166, 168], [208, 126], [262, 112], [316, 120], [358, 158]];
const capStrands = (pal) => [
  [[232, 92], [214, 120], [204, 150]], [[262, 86], [258, 118], [252, 146]], [[296, 92], [306, 122], [312, 150]],
  [[196, 108], [176, 140], [166, 176]], [[330, 108], [348, 140], [356, 176]],
].map((p) => fill(strand(p, 1.6), pal.hairLine, op(0.8))).join('');

function braidSVG(pts, w, pal, tie) {
  const c = sample(pts, 60);
  const n = c.length;
  const len = c.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0), 0);
  const segs = Math.max(4, Math.round(len / (w * 0.62)));
  const lens = [];
  for (let k = 0; k < segs; k++) {
    const i = Math.min(n - 1, Math.round(((k + 0.5) / segs) * (n - 1)));
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    let ux = b[0] - a[0], uy = b[1] - a[1];
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const nx = -uy, ny = ux, side = k % 2 ? 1 : -1, ww = w * (1 - (0.3 * k) / segs), h = (len / segs) * 0.85;
    const A = [c[i][0] - ux * h * 0.6 + nx * side * ww * 0.42, c[i][1] - uy * h * 0.6 + ny * side * ww * 0.42];
    const B = [c[i][0] + ux * h * 0.65 - nx * side * ww * 0.12, c[i][1] + uy * h * 0.65 - ny * side * ww * 0.12];
    const M = [c[i][0] + nx * side * ww * 0.1, c[i][1] + ny * side * ww * 0.1];
    const r = ribbonOf(sample([A, M, B], 12), (t) => ww * 0.66 * PROF.soft(t));
    lens.push({ d: r.d, fill: pal.hair, after: fill(ribbonOf(r.c.slice(2, -3), (t) => ww * 0.2 * PROF.both(t)).d, pal.hairL, op(0.6)) + fill(ribbonOf((side > 0 ? r.R : r.L).slice(3), (t) => 2.4 * PROF.both(t)).d, pal.hairS) });
  }
  const end = c[n - 1], pre = c[n - 4];
  const ang = Math.atan2(end[1] - pre[1], end[0] - pre[0]);
  const tip = [end[0] + Math.cos(ang) * w * 1.4, end[1] + Math.sin(ang) * w * 1.4];
  const tuft = lock(end, tip, w * 0.8, 3, 0);
  let s = inked([...lens, { d: tuft.d, fill: pal.hair, after: fill(ribbonOf(tuft.c.slice(2, -2), (t) => 2 * PROF.both(t)).d, pal.hairS) }], pal.hairInk, 2.6);
  if (tie) s += inked([{ d: ell(end[0], end[1], w * 0.46, w * 0.3, (ang * 180) / Math.PI + 90), fill: hex(tie) }], INK, 1.6);
  return s;
}

function bowSVG(x, y, s, c, k, flipX = 1) {
  const P = (dx, dy, k) => (k === undefined ? [x + dx * s * flipX, y + dy * s] : [x + dx * s * flipX, y + dy * s, k]);
  const loopA = spline([P(0, 0, 0), P(-10, -16), P(-26, -14), P(-24, 2), P(-12, 4)], true);
  const loopB = spline([P(0, 0, 0), P(10, -14), P(24, -10), P(22, 4), P(10, 4)], true);
  const tailA = spline([P(-2, 2), P(-10, 18), P(-16, 32, 0), P(-6, 26), P(2, 30, 0), P(2, 12)], true);
  const tailB = spline([P(2, 2), P(10, 16), P(16, 28, 0), P(6, 24), P(-1, 26, 0), P(0, 10)], true);
  const sh = shadeOf(c);
  return inked([
    { d: tailA, fill: hex(c), after: fill(ribbon([P(-4, 6), P(-8, 18), P(-10, 26)], 2, PROF.both, 10), hex(sh)) },
    { d: tailB, fill: hex(sh) },
    { d: loopA, fill: hex(c), after: fill(ribbon([P(-4, -2), P(-14, -10), P(-20, -6)], 2.4, PROF.both, 10), hex(sh)) },
    { d: loopB, fill: hex(c), after: fill(ribbon([P(4, -2), P(14, -8), P(18, -2)], 2.4, PROF.both, 10), hex(sh)) },
    { d: ell(x, y, 6.5 * s, 7.5 * s), fill: hex(c), after: fill(ell(x - 2 * s * flipX, y - 2.5 * s, 2.4 * s, 2 * s), '#fff', op(0.7)) },
  ], k, 2.2);
}

/** Hair style generators: (G, pal, tw) → hair description for hairSVG. */
export const HAIR = {
  spiky(G, pal, tw) {
    return {
      back: [
        S_([[150, 252], [126, 190], [144, 118], [204, 76], [272, 70], [336, 88], [374, 140], [388, 200], [374, 262], [340, 300], [300, 312], [230, 312], [178, 300]]),
        L_([200, 230], [100, 206], 66, 16), L_([208, 262], [116, 292], 58, 10), L_([228, 282], [160, 340], 50, 4),
        L_([318, 268], [372, 316], 44, -6), L_([296, 282], [326, 342], 40, -4),
      ],
      front: [
        cap(4),
        L_([224, 150], [108, 96], 76, 18, 0, { top: 1 }), L_([238, 132], [150, 38], 72, 14, 0, { top: 1 }),
        L_([262, 124], [232, 20], 66, 6, 0, { top: 1 }), L_([286, 126], [318, 30], 62, -8, 0, { top: 1 }),
        L_([306, 142], [378, 74], 58, -10, 0, { top: 1 }), L_([326, 172], [400, 142], 52, -8, 0, { top: 1 }),
        L_([196, 176], [98, 152], 62, 12, 0, { top: 1 }),
        L_([264, 102], [302, 22], 20, -12, 12, { top: 1, shadeK: 0.4 }),
        L_([212, 150], [166, 204], 44, 10), L_([232, 128], [192, 216], 50, 10),
        L_([284, 132], [298, 218], 46, -6), L_([310, 146], [346, 206], 40, -8),
        L_([258, 128], [242, 226], 50, 4),
      ],
      side: [L_([190, 168], [182, 326], 34, 12), L_([340, 168], [342, 308], 30, -10)],
      sheen: SHEEN, capLines: capStrands(pal),
    };
  },

  long(G, pal, tw) {
    const swept = tw.sweptBack;
    const back = [S_([[256, 80], [330, 92], [378, 140], [394, 230], [400, 330], [412, 430], [426, 540, 0], [86, 540, 0], [100, 430], [110, 330], [116, 230], [132, 140], [182, 92]])];
    const backLines = [[[140, 200], [124, 330], [118, 470]], [[168, 280], [156, 400], [150, 520]], [[370, 200], [386, 330], [394, 470]], [[350, 290], [360, 400], [368, 520]]]
      .map((p) => fill(strand(p, 2), pal.hairS)).join('');
    const H = { back, backLines, sheen: SHEEN, capLines: capStrands(pal) };
    if (swept) {
      H.front = [S_([[148, 240, 0.4], [134, 186], [148, 124], [198, 84], [262, 74], [324, 84], [364, 122], [380, 180], [372, 238, 0.4],
        [358, 200], [334, 162], [300, 146], [G.mx + 2, 158, 0.2], [236, 148], [198, 160], [166, 198]])];
      H.capLines = [[[G.mx - 4, 152], [244, 112], [212, 92]], [[300, 150], [282, 106], [252, 86]], [[220, 152], [196, 120], [178, 112]],
        [[330, 164], [324, 120], [300, 94]], [[350, 190], [356, 150], [344, 116]]].map((p) => fill(strand(p, 1.8), pal.hairLine, op(0.85))).join('');
      H.side = [L_([170, 226], [138, 470], 44, 12), L_([346, 226], [376, 452], 40, -12)];
      H.sheen = [[170, 150], [214, 112], [262, 98], [314, 106], [356, 140]];
      return H;
    }
    const sk = { shadeK: 0.34, shade0: 0.3, line0: 0.5 };
    H.front = [cap(2),
      L_([192, 142], [178, 206], 40, 4, 0, sk), L_([332, 148], [348, 202], 34, -4, 0, sk), L_([214, 134], [206, 210], 42, 2, 0, sk),
      L_([310, 138], [320, 208], 38, -3, 0, sk), L_([238, 130], [234, 214], 42, 1, 0, sk), L_([286, 132], [292, 214], 40, -2, 0, sk), L_([262, 128], [263, 217], 42, 0, 0, sk)];
    H.side = [L_([172, 176], [146, 476], 46, 16), L_([186, 196], [178, 436], 32, 6), L_([344, 180], [374, 452], 40, -12), L_([334, 198], [342, 420], 28, -4)];
    return H;
  },

  bob(G, pal, tw) {
    const H = {
      back: [S_([[256, 80], [328, 90], [374, 132], [392, 200], [394, 268], [386, 318, 0.2], [364, 300], [346, 330, 0.2], [326, 302], [300, 312], [212, 312],
        [178, 334, 0.2], [158, 306], [126, 336, 0.2], [114, 272], [118, 198], [142, 126], [194, 88]])],
      front: [cap(4),
        L_([270, 126], [172, 192], 46, -16), L_([300, 126], [196, 216], 52, -14), L_([292, 128], [236, 230], 48, -10),
        L_([306, 132], [278, 226], 44, -6), L_([318, 142], [326, 216], 38, 0), L_([334, 152], [358, 206], 32, -4)],
      side: [L_([168, 176], [124, 326], 52, 18, -8), L_([184, 198], [166, 318], 36, 8), L_([346, 180], [370, 316], 42, -14, 4)],
      sheen: SHEEN, capLines: capStrands(pal),
    };
    if (tw.sideBraid) H.extraFront = braidSVG([[184, 244], [180, 300], [170, 352], [160, 396]], 15, pal, tw.braidTie);
    return H;
  },

  twintails(G, pal, tw) {
    const tails = [
      S_([[174, 194], [146, 194], [116, 220], [92, 276], [76, 350], [66, 430], [50, 524, 0], [84, 482], [100, 512, 0], [108, 430], [120, 350], [140, 270], [164, 226]]),
      S_([[342, 194], [370, 194], [400, 220], [424, 276], [440, 350], [452, 430], [470, 524, 0], [436, 484], [420, 514, 0], [410, 432], [398, 350], [378, 270], [352, 226]]),
    ];
    const lines = [[[132, 220], [104, 300], [92, 400], [80, 480]], [[150, 230], [126, 320], [112, 420]], [[384, 220], [412, 300], [426, 400], [440, 480]], [[366, 230], [392, 320], [404, 420]]]
      .map((p) => fill(strand(p, 2), pal.hairS)).join('');
    const H = {
      back: [S_([[256, 84], [326, 94], [368, 136], [380, 200], [374, 262], [350, 300], [300, 310], [214, 310], [164, 296], [140, 252], [134, 196], [148, 132], [196, 94]]), ...tails],
      backShade: fill(ell(G.neckX + 10, 330, 96, 120), pal.hairS) + fill(spline([[156, 230], [132, 330], [110, 450], [100, 520], [130, 520], [130, 400], [150, 300], [166, 240]], true), pal.hairS)
        + fill(spline([[360, 230], [384, 330], [404, 450], [420, 520], [400, 520], [396, 400], [376, 300], [352, 240]], true), pal.hairS),
      backLines: lines,
      front: [cap(2),
        L_([196, 136], [182, 206], 44, 4, 0, { prof: PROF.blunt }), L_([222, 130], [214, 210], 44, 2, 0, { prof: PROF.blunt }),
        L_([326, 140], [340, 204], 36, -3, 0, { prof: PROF.blunt }), L_([300, 132], [308, 210], 40, -2, 0, { prof: PROF.blunt }),
        L_([248, 128], [246, 212], 44, 0, 0, { prof: PROF.blunt }), L_([274, 128], [278, 212], 42, -1, 0, { prof: PROF.blunt }),
        L_([344, 156], [358, 202], 28, -4)],
      side: [L_([172, 182], [166, 302], 36, 8), L_([346, 186], [350, 294], 30, -6)],
      sheen: SHEEN, capLines: capStrands(pal),
    };
    if (tw.ribbons) H.extraFront = bowSVG(150, 194, 1, tw.ribbons, INK, -1) + bowSVG(364, 194, 0.9, tw.ribbons, INK, 1);
    return H;
  },
  ponytail(G, pal, tw) {
    const low = tw.lowTail, capped = tw.headgear === 'cap';
    const tail = low ? L_([300, 286], [388, 470], 50, -12, 6) : capped ? L_([176, 214], [100, 430], 56, 26, -8) : L_([166, 150], [86, 376], 62, 30, -10);
    const root = low ? [300, 288] : capped ? [176, 214] : [166, 152];
    const back = [S_([[256, 84], [326, 92], [366, 132], [378, 196], [370, 254], [344, 288], [300, 298], [214, 298], [168, 282], [142, 236], [140, 168], [160, 118], [204, 90]]), tail];
    if (low) back.push(L_([306, 296], [366, 420], 22, -6), L_([296, 292], [342, 436], 18, 8));
    const side = [L_([174, 192], [172, 276], 26, 6), L_([342, 194], [348, 266], 22, -4)];
    return {
      back, side,
      front: [cap(0), L_([294, 138], [312, 204], 26, -6), L_([250, 132], [226, 210], 32, 6), L_([272, 134], [276, 198], 24, -2)],
      capLines: [[[300, 156], [272, 112], [224, 90]], [[330, 170], [312, 120], [270, 92]], [[226, 156], [204, 124], [184, 112]], [[354, 196], [350, 150], [320, 108]], [[266, 150], [240, 110], [204, 98]]]
        .map((p) => fill(strand(p, 1.7), pal.hairLine, op(0.85))).join(''),
      sheen: SHEEN, sheenH: 6,
      extraBack: inked([{ d: ell(root[0], root[1], 10, 13, low ? 30 : -30), fill: hex(tw.tie ?? 0x3a2a22) }], INK, 2),
    };
  },

  short(G, pal, tw) {
    const H = {
      back: [S_([[256, 86], [326, 96], [364, 136], [374, 196], [366, 250], [344, 280], [300, 290], [212, 290], [166, 272], [142, 224], [144, 152], [190, 100]])],
      front: [
        S_([[150, 236, 0.4], [138, 186], [150, 128], [198, 90], [262, 80], [324, 90], [362, 126], [376, 182], [368, 234, 0.4], [352, 200], [326, 166],
          [292, 150], [262, 152], [228, 150], [196, 164], [170, 196]], { cap: true }),
        L_([210, 124], [190, 172], 34, 8), L_([234, 116], [226, 180], 34, 4), L_([312, 132], [334, 170], 26, -5),
        L_([288, 120], [304, 172], 30, -4), L_([262, 116], [266, 178], 32, -2),
      ],
      side: [L_([162, 198], [168, 268], 22, 4), L_([350, 202], [352, 258], 18, -3)],
      sheen: [[170, 152], [214, 116], [262, 104], [314, 112], [354, 148]], sheenH: 6, sheenT: 6,
      capLines: [[[230, 96], [216, 120], [206, 146]], [[296, 96], [306, 124], [310, 148]], [[196, 112], [178, 140], [170, 170]]]
        .map((p) => fill(strand(p, 1.5), pal.hairLine, op(0.8))).join(''),
    };
    if (tw.greyTemples) {
      const grey = hex(mix(pal.hairN, 0xc8c8c8, 0.55));
      H.side.forEach((x) => { x.fill = grey; x.pal = { ...pal, hairS: hex(mix(pal.hairSN, 0x9a9a9a, 0.5)) }; });
      H.capLines += [[[152, 198], [148, 226]], [[162, 186], [157, 214]], [[172, 178], [166, 200]], [[362, 196], [364, 222]], [[354, 188], [356, 212]]].map((p) => fill(strand(p, 2.6), grey)).join('');
    }
    if (tw.undercut) {
      H.under = fill(spline([[150, 240], [138, 190], [150, 130], [196, 96], [190, 150], [176, 210]], true), pal.hair, op(0.32));
      H.front = [
        S_([[176, 206, 0.4], [166, 150], [196, 96], [262, 78], [324, 88], [362, 124], [376, 182], [368, 234, 0.4], [352, 200], [326, 166], [292, 150], [240, 150], [200, 166]], { cap: true }),
        L_([300, 110], [176, 156], 52, -14), L_([310, 124], [196, 184], 44, -10), L_([318, 140], [244, 196], 34, -8),
      ];
      H.side = [L_([350, 202], [352, 256], 18, -3)];
    }
    return H;
  },

  messy(G, pal, tw) {
    const H = {
      back: [S_([[256, 78], [330, 86], [376, 128], [400, 160, 0.2], [386, 200], [406, 246, 0.2], [380, 262], [382, 306, 0.2], [352, 292], [332, 320, 0.2],
        [302, 302], [214, 302], [180, 324, 0.2], [164, 292], [128, 306, 0.2], [134, 262], [104, 236, 0.2], [126, 204], [110, 164, 0.2], [140, 138], [150, 102, 0.2], [190, 92]])],
      front: [cap(6),
        L_([214, 132], [122, 108], 58, 14, 0, { top: 1 }), L_([244, 116], [188, 44], 56, 10, 0, { top: 1 }),
        L_([282, 116], [304, 40], 52, -10, 0, { top: 1 }), L_([312, 132], [376, 88], 50, -8, 0, { top: 1 }),
        L_([196, 170], [112, 172], 52, 8), L_([332, 170], [402, 200], 46, -8),
        L_([220, 136], [174, 212], 46, 12), L_([246, 132], [220, 224], 46, 6), L_([270, 130], [270, 216], 40, 0),
        L_([294, 130], [342, 262], 44, -16, 4)],
      side: [L_([172, 182], [154, 304], 42, 14, -4), L_([188, 200], [196, 292], 26, 4), L_([344, 184], [366, 292], 36, -10, 3)],
      sheen: SHEEN, capLines: capStrands(pal),
    };
    if (tw.leaves) {
      const leaf = (x, y, s, a) => {
        const r = (dx, dy) => [x + (dx * Math.cos(a) - dy * Math.sin(a)) * s, y + (dx * Math.sin(a) + dy * Math.cos(a)) * s];
        const d = spline([r(-12, 0, 0), r(-4, -6), r(6, -5), r(13, 0, 0), r(6, 5), r(-4, 6)].map((p, i) => (i === 0 || i === 3 ? [...p, 0] : p)), true);
        return inked([{ d, fill: '#a8d65a', after: fill(ribbon([r(-11, 0), r(0, 0.6), r(11, 0)], 1.4, PROF.both, 10), '#5e8f2a') + fill(spline([r(-4, -6), r(6, -5), r(13, 0), r(4, -1)], true), '#86b844') }], '#2c3f16', 2)
          + line(`M${fmt(r(-12, 0))}L${fmt(r(-17, 2))}`, '#2c3f16', 2);
      };
      H.extraFront = leaf(212, 80, 1, -0.5) + leaf(372, 150, 0.85, 0.8) + leaf(150, 192, 0.8, 2.6);
    }
    return H;
  },

  slick(G, pal, tw) {
    return {
      back: [S_([[256, 82], [330, 90], [370, 130], [384, 194], [378, 256], [356, 302, 0.2], [334, 282], [306, 300, 0.2], [210, 292], [176, 306, 0.2], [150, 270], [134, 200], [150, 130], [196, 92]])],
      front: [S_([[148, 240, 0.4], [134, 186], [148, 124], [198, 84], [262, 74], [324, 84], [364, 122], [380, 180], [372, 238, 0.4], [358, 200], [338, 166], [304, 150],
        [G.mx, 158, 0.3], [232, 148], [196, 160], [166, 198]], { cap: true })],
      side: [L_([290, 150], [314, 230], 14, -8, 6), L_([278, 152], [262, 214], 11, 8, -4), L_([170, 200], [168, 262], 20, 4), L_([350, 204], [352, 256], 16, -3)],
      capLines: [[[G.mx - 4, 152], [246, 110], [206, 90]], [[300, 150], [276, 106], [240, 84]], [[224, 150], [196, 120], [172, 116]], [[330, 162], [318, 118], [286, 90]],
        [[352, 190], [354, 148], [334, 112]], [[196, 162], [168, 150], [148, 160]]].map((p) => fill(strand(p, 1.8), pal.hairLine, op(0.85))).join(''),
      sheen: [[168, 150], [212, 112], [262, 100], [316, 108], [358, 142]],
    };
  },

  mohawk(G, pal, tw) {
    const roots = [[280, 150], [268, 120], [248, 102], [220, 96], [192, 106], [170, 126], [156, 156], [150, 188]];
    const tips = [[270, 82], [244, 40], [206, 24], [158, 38], [112, 70], [80, 116], [72, 170], [84, 226]];
    const spikes = roots.map((r, i) => L_(r, tips[i], 46 - i * 1.6, i < 2 ? 4 : 10, 0, { top: 1 }));
    const base = ribbon([[292, 168], [272, 118], [232, 96], [188, 104], [160, 140], [150, 196]], 30, PROF.flat, 30);
    return {
      back: [L_([170, 196], [108, 256], 40, 10), L_([178, 220], [128, 296], 34, 8)],
      under: fill(spline([[150, 240], [138, 186], [152, 126], [200, 90], [262, 80], [324, 90], [362, 126], [376, 182], [368, 238], [340, 194], [306, 168], [292, 176], [226, 170], [176, 198]], true), pal.hair, op(0.22)),
      front: [{ d: base }, ...spikes.reverse()],
      side: [],
      sheen: [[110, 150], [140, 100], [190, 72], [244, 66], [290, 84]], sheenH: 6, sheenT: 7,
    };
  },

  bald(G, pal, tw) {
    return {
      back: [S_([[164, 196], [140, 236], [146, 292], [178, 308], [216, 300], [300, 300], [340, 306], [368, 288], [374, 236], [354, 196], [330, 252], [192, 252]])],
      front: [],
      side: [
        S_([[176, 196], [156, 200], [142, 224], [134, 250, 0.2], [148, 246], [140, 272, 0.2], [156, 266], [158, 294, 0.2], [174, 276], [180, 238]]),
        S_([[340, 200], [360, 206], [372, 230], [380, 256, 0.2], [368, 252], [372, 278, 0.2], [358, 270], [350, 292, 0.2], [340, 270], [336, 236]]),
      ],
      sideLines: [[[150, 222], [148, 248]], [[160, 250], [158, 274]], [[364, 226], [366, 250]], [[352, 254], [354, 276]]].map((p) => fill(strand(p, 1.5), pal.hairLine, op(0.8))).join(''),
    };
  },

  braid(G, pal, tw) {
    return {
      back: [S_([[256, 84], [326, 92], [366, 132], [378, 196], [370, 254], [344, 288], [300, 298], [214, 298], [168, 282], [142, 236], [140, 168], [160, 118], [204, 90]])],
      front: [cap(0), L_([264, 128], [196, 200], 48, -14), L_([270, 130], [336, 196], 42, 14)],
      side: [L_([172, 184], [172, 272], 28, 6), L_([344, 186], [348, 264], 24, -4)],
      sheen: SHEEN, capLines: capStrands(pal),
      extraFront: braidSVG([[180, 262], [174, 330], [162, 400], [152, 470]], 22, pal, tw.braidTie),
    };
  },

  sidecut(G, pal, tw) {
    const st = tw.streak;
    const streak = st ? { fill: hex(st), pal: { ...pal, hairS: hex(shadeOf(st)), hairLine: hex(mix(st, 0xffffff, 0.35)) } } : {};
    return {
      back: [S_([[256, 84], [326, 94], [364, 134], [376, 196], [368, 252], [344, 284], [300, 292], [212, 292], [170, 276], [150, 236], [150, 160], [192, 100]])],
      under: fill(spline([[150, 240], [138, 190], [148, 136], [184, 106], [196, 150], [180, 210]], true), pal.hair, op(0.55))
        + [[[156, 150], [150, 170]], [[164, 176], [158, 196]], [[150, 200], [148, 220]], [[170, 130], [162, 146]]].map((p) => fill(strand(p, 1.2), pal.hairLine, op(0.5))).join(''),
      front: [
        S_([[178, 206, 0.4], [166, 150], [196, 98], [262, 76], [324, 86], [364, 122], [380, 180], [372, 238, 0.4], [346, 198], [306, 160], [258, 150], [214, 160]], { cap: true }),
        L_([262, 124], [360, 236], 38, -16), L_([222, 120], [268, 214], 40, -10),
        L_([236, 118], [322, 256], 54, -24, 4), L_([248, 120], [346, 290], 46, -30, 6, streak),
      ],
      side: [L_([350, 190], [358, 262], 26, -4)],
      sheen: [[178, 140], [220, 110], [272, 98], [324, 110], [362, 146]],
    };
  },

  wild(G, pal, tw) {
    return {
      back: [S_([[256, 70], [334, 76], [390, 118], [422, 170, 0.2], [400, 204], [426, 252, 0.2], [394, 266], [404, 318, 0.2], [362, 300], [340, 338, 0.2],
        [300, 306], [212, 306], [176, 340, 0.2], [154, 300], [112, 320, 0.2], [120, 268], [86, 246, 0.2], [114, 206], [88, 162, 0.2], [130, 132], [136, 92, 0.2], [190, 82]])],
      front: [cap(10),
        L_([206, 140], [100, 92], 70, 16, 0, { top: 1 }), L_([236, 120], [168, 26], 66, 10, 0, { top: 1 }), L_([276, 116], [290, 18], 62, -8, 0, { top: 1 }),
        L_([308, 130], [392, 66], 58, -10, 0, { top: 1 }), L_([330, 170], [418, 150], 52, -8, 0, { top: 1 }), L_([192, 180], [86, 176], 60, 10, 0, { top: 1 }),
        L_([222, 136], [176, 216], 48, 12), L_([250, 130], [236, 228], 48, 4), L_([282, 134], [300, 222], 44, -6), L_([312, 148], [350, 210], 38, -8)],
      side: [L_([174, 178], [146, 330], 44, 16), L_([344, 180], [372, 320], 40, -14)],
      sheen: SHEEN, capLines: capStrands(pal),
    };
  },
/*@@HAIR*/
};
// ------------------------------------------------------------------ outfits
/** Outfit tones from look.outfit. */
export function outfitPal(look) {
  const o = look.outfit || {};
  return {
    primary: tone(o.primary ?? 0x6a5a4a), secondary: tone(o.secondary ?? 0x3a3a44), trim: tone(o.trim ?? 0xc9a24a),
    cape: o.cape != null ? tone(o.cape) : null, scarf: o.scarf != null ? tone(o.scarf) : null, belt: tone(o.belt ?? 0x4a3322),
  };
}

/** Metal tones: brighter highlight and stronger shadow than cloth. */
export function metalTone(c) {
  const t = tone(c);
  const s = mix(c, mul(c, 0x76749c), lum(c) > 0.6 ? 0.42 : 0.78);
  return { ...t, s: hex(s), sn: s, d: hex(mix(s, 0x000000, 0.22)), l: hex(mix(c, 0xffffff, 0.65)) };
}

export function torsoPts(G, dip = 10) {
  const { bx, shN, shF, shY, collarY } = G;
  const nl = G.neckX - G.neckW / 2 - 4, nr = G.neckX + G.neckW / 2 + 4;
  return [
    [bx - shN - 22, 540, 0], [bx - shN - 12, 486], [bx - shN - 2, shY + 24], [bx - shN + 30, shY - 2], [nl - 38, collarY + 16], [nl, collarY - 2, 0.5],
    [G.neckX + 3, collarY + dip],
    [nr, collarY - 2, 0.5], [nr + 36, collarY + 18], [bx + shF - 26, shY + 2], [bx + shF - 2, shY + 26], [bx + shF + 8, 486], [bx + shF + 16, 540, 0],
  ];
}

function torsoShade(G, T) {
  const { bx, shF, shN, shY } = G;
  return fill(spline([[bx + shF * 0.48, 392], [bx + shF * 0.6, 452], [bx + shF * 0.56, 540], [620, 540], [620, 380]], true), T.s)
    + fill(ribbon([[bx - shN + 58, shY + 16], [bx - shN + 46, 474], [bx - shN + 42, 530]], 16, PROF.head), T.s)
    + fill(ell(G.neckX + 8, G.collarY + 12, G.neckW * 0.8, 15), T.s);
}

/** Base torso filled with one tone, shaded. Returns { d, svg }. */
function torsoBase(doc, G, T, dip = 10) {
  const d = spline(torsoPts(G, dip), true);
  return { d, svg: inked([{ d, fill: T.c, after: clipTo(doc, d, torsoShade(G, T)) }], T.k, 4) };
}

/** Flat decorative band with an ink edge and a soft highlight. */
export function trimBand(pts, w, Tr, lw = 1.5) {
  const d = ribbon(pts, w, PROF.flat, 30);
  return inked([{ d, fill: Tr.c, after: fill(ribbon(pts, w * 0.32, PROF.both, 30), Tr.l, op(0.75)) }], Tr.k, lw);
}

export function capeSVG(doc, G, C) {
  const { bx, shN, shF } = G;
  const d = spline([[bx - shN - 52, 540, 0], [bx - shN - 34, 470], [bx - shN - 4, 418], [G.neckX - 70, 380], [G.neckX + 70, 380], [bx + shF + 6, 420],
    [bx + shF + 32, 470], [bx + shF + 46, 540, 0]], true);
  const sh = fill(spline([[bx - shN - 52, 540], [bx - shN - 30, 486], [bx - shN - 14, 470], [bx - shN, 540]], true), C.d)
    + fill(spline([[bx + shF + 46, 540], [bx + shF + 30, 480], [bx + shF + 14, 466], [bx + shF + 8, 540]], true), C.s)
    + fill(ribbon([[bx - shN - 26, 446], [bx - shN - 36, 500], [bx - shN - 40, 540]], 6, PROF.both), C.l, op(0.35));
  return inked([{ d, fill: C.c, after: clipTo(doc, d, sh) }], C.k, 4);
}

/** Layered shoulder plate. side: 'near' | 'far'. o: { scale, spikes, lames, feather } */
export function pauldronSVG(doc, G, side, M, Tr, o = {}) {
  const near = side === 'near', so = near ? -1 : 1;
  const k = (o.scale ?? 1) * (near ? 1 : 0.84);
  const ox = near ? G.bx - G.shN + 30 : G.bx + G.shF - 26, oy = G.shY + 4;
  const P = (u, v, c) => (c === undefined ? [ox + so * u * k, oy + v * k] : [ox + so * u * k, oy + v * k, c]);
  const angular = o.angular ? 0.3 : 1;
  let s = '';
  const lames = o.lames ?? 1;
  for (let i = lames; i >= 1; i--) {
    const dy = i * 15;
    const d = spline([P(-44, 10 + dy, angular), P(-6, -6 + dy), P(40, 2 + dy), P(70, 30 + dy, angular), P(62, 46 + dy), P(16, 40 + dy), P(-30, 30 + dy)], true);
    s += inked([{ d, fill: i % 2 ? M.s : M.c, after: fill(ribbon([P(-30, 26 + dy), P(16, 36 + dy), P(60, 40 + dy)], 4, PROF.both), M.d, op(0.6)) }], M.k, 3.2);
  }
  const dome = spline([P(-58, 16, angular), P(-40, -26), P(4, -44), P(50, -26), P(76, 18, angular), P(64, 42), P(14, 36), P(-34, 32)], true);
  const sh = fill(spline([P(76, 18), P(64, 42), P(14, 36), P(-34, 32), P(-30, 16), P(20, 18), P(54, 4)], true), M.s)
    + fill(ribbon([P(-30, -12), P(0, -30), P(36, -24)], 9, PROF.both), M.l, op(0.75));
  s += inked([{ d: dome, fill: M.c, after: clipTo(doc, dome, sh) }], M.k, 3.6);
  s += trimBand([P(-52, 22), P(-20, 32), P(16, 34), P(60, 38), P(72, 22)], 6, Tr, 1.4);
  if (o.spikes) {
    for (const [u, v, l, a] of [[-14, -38, 34, -1.9], [24, -34, 38, -1.45], [56, -10, 32, -0.9]]) {
      const b = P(u, v), tip = [b[0] + so * Math.cos(a) * l * k * -1, b[1] + Math.sin(a) * l * k];
      const base1 = P(u - 8, v + 4), base2 = P(u + 8, v + 4);
      s += inked([{ d: poly([base1, tip, base2]), fill: M.s, after: fill(poly([base1, tip, b]), M.c) }], M.k, 2.4);
    }
  }
  if (o.feather) {
    for (let i = 0; i < 4; i++) {
      const b = P(-40 + i * 30, 34 + (i === 3 ? -4 : 0));
      s += inked([{ d: spline([[b[0] - 6, b[1] - 2], [b[0], b[1] + 14, 0], [b[0] + 6, b[1] - 2]], true), fill: Tr.c }], Tr.k, 1.4);
    }
  }
  return s;
}

/** Gold ember-dragon emblem. */
export function dragonCrest(x, y, s, Tr, gem = '#ff6a3a') {
  const P = (dx, dy, c) => (c === undefined ? [x + dx * s, y + dy * s] : [x + dx * s, y + dy * s, c]);
  const wing = (m) => spline([P(m * 3, -2), P(m * 13, -12), P(m * 27, -17, 0), P(m * 20, -8), P(m * 27, -3, 0), P(m * 17, 1), P(m * 22, 8, 0), P(m * 8, 6)], true);
  const body = spline([P(0, -19, 0), P(6, -12), P(7, -2), P(3, 12), P(0, 20, 0), P(-3, 12), P(-7, -2), P(-6, -12)], true);
  const horns = poly([P(-5, -14), P(-9, -24), P(-1, -17)]) + poly([P(5, -14), P(9, -24), P(1, -17)]);
  return inked([{ d: wing(-1), fill: Tr.c }, { d: wing(1), fill: Tr.s }, { d: horns, fill: Tr.c }, { d: body, fill: Tr.c,
    after: fill(ell(x, y - 2 * s, 3.4 * s, 5 * s), gem) + fill(ell(x - 1 * s, y - 4 * s, 1.2 * s, 1.8 * s), '#fff', op(0.8)) }], Tr.k, 1.6);
}

/** Small gold flame emblem. */
export function emberCrest(x, y, s, Tr, gem = '#ff5a2a') {
  const P = (dx, dy, c) => (c === undefined ? [x + dx * s, y + dy * s] : [x + dx * s, y + dy * s, c]);
  const outer = spline([P(0, -20, 0), P(6, -8), P(11, -12, 0), P(11, 2), P(6, 12), P(0, 15), P(-6, 12), P(-11, 2), P(-10, -10, 0), P(-5, -6)], true);
  const inner = spline([P(0, -8, 0), P(4, 1), P(3, 8), P(0, 10), P(-3, 8), P(-4, 1)], true);
  return inked([{ d: outer, fill: Tr.c, after: fill(inner, gem) + fill(ell(x - 1.2 * s, y + 3 * s, 1, 2), '#fff', op(0.8)) }], Tr.k, 1.6);
}

/** Scarf around the neck: 'wrap' = roll with a knot, hanging tail and a flying end; 'cowl' = bunched under the chin. Returns { back, front }. */
export function scarfSVG(doc, G, C, style = 'wrap') {
  const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2, cx = G.neckX + 2;
  const fold = (p, w = 5) => fill(ribbon(p, w, PROF.both), C.s);
  if (style === 'cowl') {
    const d = spline([[nl - 24, 414], [nl - 24, 366], [nl - 8, 342], [cx, 350], [nr + 8, 340], [nr + 24, 358], [nr + 30, 406], [nr + 16, 428], [cx + 2, 434], [nl - 12, 430]], true);
    const sh = fold([[nl - 18, 368], [cx, 380], [nr + 22, 364]], 5) + fold([[nl - 20, 392], [cx + 2, 404], [nr + 26, 388]], 5) + fold([[nl - 16, 414], [cx + 2, 424], [nr + 22, 412]], 4)
      + fold([[nl - 4, 350], [cx, 356], [nr + 6, 346]], 3) + fill(ell(nr + 24, 400, 16, 40), C.s) + fill(ribbon([[nl - 16, 360], [nl - 2, 348], [cx - 8, 352]], 4, PROF.both), C.l, op(0.45));
    return { back: '', front: inked([{ d, fill: C.c, after: clipTo(doc, d, sh) }], C.k, 3.6) };
  }
  const fly = spline([[nl + 4, 362], [nl - 50, 340], [nl - 108, 344], [nl - 160, 322, 0], [nl - 142, 356], [nl - 178, 372, 0], [nl - 116, 378], [nl - 56, 388], [nl + 4, 392]], true);
  const roll = spline([[nl - 36, 404], [nl - 30, 364], [nl - 4, 350], [cx, 358], [nr + 8, 348], [nr + 32, 358], [nr + 42, 392], [nr + 26, 418], [cx + 4, 426], [nl - 20, 424]], true);
  const tail = spline([[nl - 30, 414], [nl - 50, 452], [nl - 58, 498], [nl - 54, 540, 0], [nl - 14, 540, 0], [nl - 18, 496], [nl - 6, 452], [nl + 4, 424]], true);
  const knot = spline([[nl - 40, 404], [nl - 30, 388], [nl - 8, 392], [nl + 4, 410], [nl - 6, 428], [nl - 30, 428]], true);
  const back = inked([{ d: fly, fill: C.c, after: clipTo(doc, fly, fold([[nl - 20, 368], [nl - 90, 362], [nl - 150, 344]], 6) + fill(ribbon([[nl - 30, 384], [nl - 100, 380], [nl - 160, 370]], 6, PROF.both), C.d)) }], C.k, 3.6);
  const front = inked([
    { d: tail, fill: C.c, after: clipTo(doc, tail, fill(spline([[nl - 26, 430], [nl - 36, 480], [nl - 30, 540], [nl - 14, 540], [nl - 20, 480]], true), C.s) + fold([[nl - 40, 450], [nl - 48, 500], [nl - 46, 536]], 4)) },
    { d: roll, fill: C.c, after: clipTo(doc, roll, fold([[nl - 26, 376], [cx, 388], [nr + 30, 374]], 6) + fold([[nl - 30, 398], [cx + 2, 412], [nr + 34, 398]], 6)
      + fill(ell(nr + 34, 396, 22, 34), C.s) + fill(ribbon([[nl - 18, 366], [nl, 356], [cx - 10, 360]], 4, PROF.both), C.l, op(0.5))) },
    { d: knot, fill: C.c, after: clipTo(doc, knot, fill(ell(nl - 14, 420, 16, 9), C.s) + fill(ribbon([[nl - 32, 398], [nl - 16, 392], [nl - 4, 398]], 3, PROF.both), C.l, op(0.5))) },
  ], C.k, 3.6);
  return { back, front };
}

function collarBand(doc, G, T, Tr, h = 34) {
  const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
  const d = spline([[nl - 8, 404, 0], [nl - 6, 400 - h, 0.4], [G.neckX + 2, 406 - h], [nr + 6, 398 - h, 0.4], [nr + 10, 402, 0], [G.neckX + 4, 414]], true);
  return inked([{ d, fill: T.c, after: clipTo(doc, d, fill(ell(nr + 6, 400, 18, 40), T.s)) + (Tr ? fill(ribbon([[nl - 7, 404 - h + 6], [G.neckX + 2, 410 - h], [nr + 8, 402 - h + 6]], 3, PROF.flat), Tr.c) : '') }], T.k, 3);
}

function breastplate(doc, G, M, Tr, o = {}) {
  const { bx } = G;
  const w = G.male ? 1 : 0.86, X = (dx) => bx + dx * w;
  const top = o.top ?? 0;
  const d = spline([[X(-124), 540, 0], [X(-128), 478], [X(-112), 438 + top], [X(-66), 418 + top], [X(-2), 434 + top, 0.6], [X(58), 416 + top], [X(100), 434 + top], [X(110), 478], [X(106), 540, 0]], true);
  const sh = fill(poly([[X(-2), 430 + top], [X(4), 540], [X(140), 540], [X(140), 400]]), M.s)
    + fill(ribbon([[X(-58), 440 + top], [X(-72), 486], [X(-80), 536]], 12, PROF.both), M.l, op(0.7))
    + fill(ribbon([[X(-38), 446 + top], [X(-48), 490], [X(-52), 530]], 4, PROF.both), M.l, op(0.6))
    + fill(ribbon([[X(30), 444 + top], [X(42), 500]], 5, PROF.both), M.c, op(0.5))
    + fill(ribbon([[X(-1), 436 + top], [X(2), 488], [X(4), 540]], 2.2, PROF.both), M.k, op(0.45));
  let s = inked([{ d, fill: M.c, after: clipTo(doc, d, sh) }], M.k, 4);
  s += trimBand([[X(-114), 444 + top], [X(-66), 422 + top], [X(-2), 438 + top], [X(58), 420 + top], [X(102), 440 + top]], 7, Tr);
  return s;
}

/** Outfit generators: (doc, G, P, look, tw) → { back, body, front }. */
export const OUTFIT = {
  lightArmor(doc, G, P, look, tw) {
    const T = P.primary, M = metalTone(P.secondary.n), Tr = P.trim;
    let body = torsoBase(doc, G, T, 6).svg + collarBand(doc, G, T, Tr);
    body += breastplate(doc, G, M, Tr);
    const crestX = G.bx - 6, crestY = 476;
    if (look.outfit?.crest === 'dragon') body += dragonCrest(crestX, crestY, 1.15, Tr);
    else if (tw.emberCrest) body += emberCrest(crestX, crestY, 1, Tr);
    if (look.outfit?.pauldrons) body += pauldronSVG(doc, G, 'near', M, Tr, { lames: 1, feather: tw.feathered }) + pauldronSVG(doc, G, 'far', M, Tr, { lames: 1, feather: tw.feathered });
    else body += pauldronSVG(doc, G, 'near', M, Tr, { scale: 0.7, lames: 0 }) + pauldronSVG(doc, G, 'far', M, Tr, { scale: 0.7, lames: 0 });
    return { body };
  },

  heavyArmor(doc, G, P, look, tw) {
    const M = metalTone(P.primary.n), S = P.secondary, Tr = P.trim, { bx } = G;
    let body = torsoBase(doc, G, M, 4).svg;
    const tab = spline([[bx - 52, 540, 0], [bx - 44, 430, 0.5], [bx + 38, 426, 0.5], [bx + 46, 540, 0]], true);
    body += inked([{ d: tab, fill: S.c, after: clipTo(doc, tab, fill(poly([[bx + 6, 420], [bx + 60, 420], [bx + 60, 540], [bx + 12, 540]]), S.s)) }], S.k, 3);
    body += trimBand([[bx - 44, 432], [bx - 48, 490], [bx - 51, 540]], 6, Tr) + trimBand([[bx + 38, 428], [bx + 42, 490], [bx + 45, 540]], 6, Tr);
    if (look.outfit?.crest === 'dragon') body += dragonCrest(bx - 3, 482, 1.05, Tr);
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    for (const [i, h] of [[1, 0], [0, 22]]) {
      const d = spline([[nl - 40 + i * 6, 428 - h * 0.2, 0.3], [nl - 22, 372 + h], [G.neckX, 384 + h], [nr + 22, 368 + h], [nr + 44 - i * 6, 424 - h * 0.2, 0.3], [G.neckX + 4, 440 - h * 0.6]], true);
      body += inked([{ d, fill: M.c, after: clipTo(doc, d, fill(ell(nr + 30, 420, 30, 60), M.s) + fill(ribbon([[nl - 20, 384 + h], [nl, 392 + h], [G.neckX - 6, 396 + h]], 5, PROF.both), M.l, op(0.7))) }], M.k, 3.4);
    }
    body += pauldronSVG(doc, G, 'near', M, Tr, { scale: 1.3, lames: 2 }) + pauldronSVG(doc, G, 'far', M, Tr, { scale: 1.3, lames: 2 });
    return { body };
  },

  darkArmor(doc, G, P, look, tw) {
    const M = metalTone(P.primary.n), S = P.secondary, Tr = P.trim, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, M, 4).svg;
    const plate = poly([[bx - 116, 540], [bx - 120, 458], [bx - 76, 424], [bx - 2, 448], [bx + 62, 422], [bx + 104, 452], [bx + 98, 540]]);
    body += inked([{ d: plate, fill: M.c, after: clipTo(doc, plate, fill(poly([[bx - 2, 446], [bx + 2, 540], [bx + 130, 540], [bx + 130, 420]]), M.s)
      + fill(poly([[bx - 70, 446], [bx - 2, 474], [bx - 2, 486], [bx - 74, 456]]), S.c) + fill(poly([[bx + 56, 444], [bx + 2, 474], [bx + 2, 486], [bx + 60, 454]]), S.s)
      + fill(ribbon([[bx - 90, 470], [bx - 96, 520]], 8, PROF.both), M.l, op(0.5))) }], M.k, 4);
    body += trimBand([[bx - 114, 460], [bx - 76, 428], [bx - 2, 452], [bx + 62, 426], [bx + 100, 454]], 5, Tr);
    if (look.outfit?.crest === 'obsidian') body += inked([{ d: poly([[bx - 2, 486], [bx + 12, 504], [bx - 2, 528], [bx - 16, 504]]), fill: S.c, after: fill(poly([[bx - 2, 492], [bx + 6, 504], [bx - 2, 520]]), S.l, op(0.6)) }], Tr.k, 2);
    const collar = (m) => {
      const x0 = m < 0 ? nl : nr;
      return poly([[x0 + m * 40, 432], [x0 + m * 40, 360], [x0 + m * 22, 300], [x0 + m * 2, 352], [x0 - m * 4, 414]]);
    };
    for (const m of [-1, 1]) {
      const d = collar(m), x0 = m < 0 ? nl : nr;
      body += inked([{ d, fill: m < 0 ? M.c : M.s, after: fill(poly([[x0 + m * 30, 420], [x0 + m * 30, 362], [x0 + m * 20, 324], [x0 + m * 8, 360], [x0 + m * 6, 416]]), S.s) }], M.k, 3.4);
    }
    const sp = !!tw.spikes;
    body += pauldronSVG(doc, G, 'near', M, Tr, { scale: 1.2, lames: 2, angular: true, spikes: sp }) + pauldronSVG(doc, G, 'far', M, Tr, { scale: 1.2, lames: 2, angular: true, spikes: sp });
    return { body };
  },
  tunic(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx } = G;
    let body = torsoBase(doc, G, T, 16).svg;
    const yoke = spline([[bx - G.shN + 26, G.shY + 4], [G.neckX - 60, 404], [G.neckX + 4, 418], [G.neckX + 64, 402], [bx + G.shF - 22, G.shY + 6], [bx + G.shF - 30, G.shY + 24], [G.neckX + 4, 440], [bx - G.shN + 34, G.shY + 24]], true);
    body += inked([{ d: yoke, fill: S.c, after: clipTo(doc, yoke, fill(poly([[bx + 30, 380], [bx + 200, 380], [bx + 200, 460], [bx + 30, 460]]), S.s)) }], S.k, 3);
    body += trimBand([[G.neckX - 34, 398], [G.neckX + 4, 414], [G.neckX + 38, 396]], 5, Tr);
    body += line(`M${G.neckX + 4} 414L${G.neckX + 6} 460`, T.k, 2) + line(`M${G.neckX - 4} 424l20 6M${G.neckX - 4} 440l20 6`, P.belt.c, 2.2);
    return { body };
  },

  robe(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, T, 6).svg;
    const inner = poly([[nl - 4, 396], [G.neckX + 6, 404], [nr + 4, 394], [bx + 4, 500]]);
    body += inked([{ d: inner, fill: S.c, after: clipTo(doc, inner, fill(poly([[G.neckX + 6, 390], [nr + 20, 390], [bx + 10, 520]]), S.s)) }], S.k, 2.4);
    const lapN = poly([[nl - 12, 390], [nl + 2, 388], [bx + 8, 510], [bx - 18, 540], [bx - 34, 540]]);
    const lapF = poly([[nr + 12, 388], [nr - 2, 388], [bx + 6, 482], [bx + 22, 470]]);
    body += inked([{ d: lapF, fill: T.s }, { d: lapN, fill: T.c }], T.k, 3);
    body += trimBand([[nl - 4, 392], [G.neckX + 30, 450], [bx + 4, 508]], 5, Tr) + trimBand([[nr + 4, 390], [bx + 12, 476]], 4, Tr);
    return { body };
  },

  priestRobe(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx, shN, shF, shY } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, T, 6).svg;
    for (const m of [-1, 1]) {
      const x0 = m < 0 ? nl - 4 : nr + 4, x1 = m < 0 ? bx - 60 : bx + 50;
      const d = spline([[x0, 400, 0], [x0 + m * 6, 450], [x1, 540, 0], [x1 + m * 30, 540, 0], [x0 + m * 34, 446], [x0 + m * 26, 398, 0]], true);
      body += inked([{ d, fill: m < 0 ? S.c : S.s }], S.k, 3);
    }
    const cape = spline([[bx - shN - 8, 490, 0.5], [bx - shN + 4, shY + 4], [bx - shN + 44, shY - 18], [nl - 26, 398], [G.neckX + 4, 410], [nr + 26, 396], [bx + shF - 30, shY - 14],
      [bx + shF + 2, shY + 8], [bx + shF + 8, 486, 0.5], [bx + shF - 50, 478], [nr + 22, 440], [G.neckX + 4, 446], [nl - 24, 442], [bx - shN + 60, 484]], true);
    const capeSh = fill(spline([[nr + 20, 400], [bx + shF + 10, 420], [bx + shF + 10, 490], [nr + 30, 446]], true), T.s)
      + fill(ribbon([[nl - 40, 420], [bx - shN + 50, 450], [bx - shN + 30, 476]], 6, PROF.both), T.s, op(0.8));
    body += inked([{ d: cape, fill: T.c, after: clipTo(doc, cape, capeSh) }], T.k, 3.6);
    body += trimBand([[bx - shN - 2, 486], [bx - shN + 60, 480], [nl - 24, 440], [G.neckX + 4, 444], [nr + 22, 438], [bx + shF - 50, 474], [bx + shF + 4, 484]], 7, Tr);
    for (const m of [-1, 1]) {
      const x0 = m < 0 ? nl - 2 : nr + 2;
      const d = spline([[x0 - m * 4, 404, 0], [x0 + m * 2, 446], [x0 + m * 10, 540, 0], [x0 + m * 40, 540, 0], [x0 + m * 30, 444], [x0 + m * 22, 400, 0]], true);
      body += inked([{ d, fill: m < 0 ? S.c : S.s, after: fill(ribbon([[x0 + m * 2, 410], [x0 + m * 8, 470], [x0 + m * 14, 540]], 4, PROF.flat), Tr.c, op(0.9)) }], S.k, 3);
      const cx = x0 + m * 22, cy = 494;
      body += inked([{ d: poly([[cx, cy - 10], [cx + 3, cy - 3], [cx + 10, cy], [cx + 3, cy + 3], [cx, cy + 10], [cx - 3, cy + 3], [cx - 10, cy], [cx - 3, cy - 3]]), fill: Tr.c }], Tr.k, 1.2);
    }
    body += collarBand(doc, G, T, Tr, 36);
    const gem = hex(look.accent ?? 0x7fd8ff);
    body += inked([{ d: ell(G.neckX + 4, 410, 9, 10), fill: Tr.c }], Tr.k, 1.6) + fill(ell(G.neckX + 4, 410, 5.5, 6.5), gem) + fill(ell(G.neckX + 2.5, 407.5, 1.8, 2.2), '#fff', op(0.9));
    return { body };
  },

  mageRobe(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    const star = (x, y, r) => fill(poly([[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28], [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]]), Tr.c);
    const collarBack = spline([[nl - 44, 420, 0.3], [nl - 66, 352], [nl - 58, 300, 0.2], [nl - 20, 318], [G.neckX, 322], [nr + 22, 314], [nr + 60, 294, 0.2], [nr + 68, 350], [nr + 46, 420, 0.3]], true);
    const back = inked([{ d: collarBack, fill: S.c, after: clipTo(doc, collarBack, fill(ell(G.neckX, 300, 70, 40), S.d) + star(nl - 46, 346, 6) + star(nr + 44, 340, 5) + star(nl - 30, 384, 4)) }], T.k, 3.6)
      + trimBand([[nl - 46, 418], [nl - 64, 352], [nl - 57, 302]], 5, Tr) + trimBand([[nr + 46, 418], [nr + 66, 350], [nr + 59, 296]], 5, Tr);
    let body = torsoBase(doc, G, T, 8).svg;
    body += clipTo(doc, spline(torsoPts(G, 8), true), star(bx - 104, 470, 7) + star(bx + 74, 496, 6) + star(bx - 50, 512, 5) + star(bx + 120, 452, 5) + star(bx - 140, 500, 5));
    const v = poly([[nl - 8, 400], [nr + 8, 398], [bx + 2, 470]]);
    body += inked([{ d: v, fill: S.c }], S.k, 2.4);
    for (const m of [-1, 1]) {
      const x0 = m < 0 ? nl : nr;
      const d = spline([[x0 + m * 46, 420, 0.3], [x0 + m * 30, 440], [bx + m * 4, 482, 0], [x0 - m * 2, 404], [x0 + m * 4, 390, 0.4]], true);
      body += inked([{ d, fill: m < 0 ? T.c : T.s }], T.k, 3);
      body += trimBand([[x0 - m * 1, 400], [bx + m * 2, 476]], 5, Tr);
    }
    const gem = hex(look.accent ?? 0xff7a3d);
    body += inked([{ d: ell(bx + 1, 470, 9, 11), fill: Tr.c }], Tr.k, 1.6) + fill(ell(bx + 1, 470, 5.5, 7), gem) + fill(ell(bx - 0.5, 467, 1.8, 2.4), '#fff', op(0.9));
    return { back, body };
  },

  leather(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, B = P.belt, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, S, 18).svg;
    const tp = torsoPts(G, 18);
    const near = spline([...tp.slice(0, 6), [nl + 4, 394], [bx - 10, 540, 0]], true);
    const far = spline([[nr - 4, 394], ...tp.slice(7), [bx + 12, 540, 0]], true);
    body += inked([{ d: near, fill: T.c, after: clipTo(doc, near, torsoShade(G, T)) }, { d: far, fill: T.c, after: clipTo(doc, far, torsoShade(G, T)) }], T.k, 3.6);
    body += line(`M${nl + 10} 404L${bx - 6} 532`, Tr.c, 1.6, ' stroke-dasharray="4 4"') + line(`M${nr - 10} 404L${bx + 8} 532`, Tr.c, 1.6, ' stroke-dasharray="4 4"');
    for (let i = 0; i < 4; i++) {
      const y = 420 + i * 24, a = lerp(nl + 6, bx - 8, (y - 394) / 146), b = lerp(nr - 6, bx + 10, (y - 394) / 146);
      body += line(`M${f1(a)} ${y}L${f1(b)} ${y + 12}M${f1(a)} ${y + 12}L${f1(b)} ${y}`, B.c, 2);
    }
    const strap = ribbon([[bx - G.shN + 70, G.shY - 6], [bx - 20, 480], [bx + 70, 540]], 18, PROF.flat, 24);
    body += inked([{ d: strap, fill: B.c, after: fill(ribbon([[bx - G.shN + 72, G.shY - 4], [bx - 18, 478], [bx + 70, 538]], 4, PROF.flat, 24), B.s) }], B.k, 3);
    body += inked([{ d: poly([[bx - 48, 450], [bx - 26, 462], [bx - 36, 482], [bx - 58, 470]]), fill: Tr.c, after: fill(poly([[bx - 46, 458], [bx - 32, 466], [bx - 38, 476], [bx - 52, 468]]), B.c) }], Tr.k, 1.6);
    body += pauldronSVG(doc, G, 'near', tone(mix(T.n, 0x000000, 0.1)), Tr, { scale: 0.72, lames: 1 });
    return { body };
  },

  rogueGarb(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, B = P.belt, { bx, shN, shY } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, S, 6).svg;
    const tp = torsoPts(G, 6);
    const near = spline([...tp.slice(0, 6), [nl + 8, 398], [bx - 14, 470], [bx - 26, 540, 0]], true);
    const far = spline([[nr - 8, 398], ...tp.slice(7), [bx + 28, 540, 0], [bx + 14, 470]], true);
    body += inked([{ d: near, fill: T.c, after: clipTo(doc, near, torsoShade(G, T)) }, { d: far, fill: T.c, after: clipTo(doc, far, torsoShade(G, T)) }], T.k, 3.6);
    body += line(spline([[nl + 10, 404], [bx - 12, 470], [bx - 22, 540]]), Tr.c, 2.4) + line(spline([[nr - 10, 404], [bx + 12, 470], [bx + 24, 540]]), Tr.c, 2.4)
      + line(spline([[bx - shN + 44, shY + 8], [bx - shN + 66, shY + 50], [bx - shN + 70, 540]]), Tr.c, 2, op(0.8));
    const strap = ribbon([[bx - shN + 50, shY + 30], [bx - 30, 484], [bx + 90, 500]], 12, PROF.flat, 24);
    body += inked([{ d: strap, fill: B.c, after: fill(ribbon([[bx - shN + 52, shY + 33], [bx - 28, 487], [bx + 90, 503]], 3, PROF.flat, 24), B.s) }], B.k, 2.4);
    body += inked([{ d: poly([[bx - 44, 474], [bx - 26, 480], [bx - 32, 498], [bx - 50, 492]]), fill: Tr.c, after: fill(poly([[bx - 41, 480], [bx - 31, 484], [bx - 35, 494], [bx - 45, 490]]), B.c) }], Tr.k, 1.4);
    body += pauldronSVG(doc, G, 'near', tone(mix(S.n, T.n, 0.5)), Tr, { scale: 0.66, lames: 1 });
    if (P.scarf) body += scarfSVG(doc, G, P.scarf, 'cowl').front;
    return { body };
  },

  furVest(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, B = P.belt, { bx, shN, shF, shY } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, S, 20).svg;
    const tp = torsoPts(G, 20);
    const near = spline([...tp.slice(0, 6), [nl + 10, 400], [bx - 24, 540, 0]], true);
    const far = spline([[nr - 10, 400], ...tp.slice(7), [bx + 26, 540, 0]], true);
    body += inked([{ d: near, fill: T.c, after: clipTo(doc, near, torsoShade(G, T)) }, { d: far, fill: T.c, after: clipTo(doc, far, torsoShade(G, T)) }], T.k, 3.6);
    body += inked([{ d: ribbon([[bx - 70, 450], [bx, 500], [bx + 70, 452]], 12, PROF.flat, 20), fill: B.c }], B.k, 2.4);
    const fur = hex(mix(Tr.n, T.n, 0.25)), furS = hex(shadeOf(mix(Tr.n, T.n, 0.25)));
    const pts = [];
    const L = bx - shN - 16, R = bx + shF + 14;
    pts.push([L, 470, 0.3]);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, x = lerp(L, R, t), y = 470 - Math.sin(Math.PI * t) * 50 + (i % 2 ? 16 : 0);
      pts.push([x, y, i % 2 ? 0.2 : 1]);
    }
    pts.push([R, 470, 0.3], [bx + shF - 10, shY - 24], [nr + 28, 368, 0.6], [G.neckX, 360], [nl - 28, 368, 0.6], [bx - shN + 14, shY - 26]);
    const mantle = spline(pts, true);
    body += inked([{ d: mantle, fill: fur, after: clipTo(doc, mantle, fill(spline([[nr + 10, 360], [R + 20, 400], [R + 20, 480], [bx + 60, 470]], true), furS)
      + [[bx - shN + 30, 440], [bx - 100, 430], [bx - 40, 420], [bx + 40, 418], [bx + 100, 432]].map(([x, y]) => fill(strand([[x, y - 10], [x + 4, y + 4], [x + 2, y + 14]], 2), furS)).join('')) }], hex(inkOf(mix(Tr.n, T.n, 0.25))), 3.6);
    if (look.outfit?.pauldrons) body += pauldronSVG(doc, G, 'near', metalTone(0x8a8f98), tone(0x6a5a40), { scale: 0.95, lames: 1 });
    return { body };
  },

  cultistRobe(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    let body = torsoBase(doc, G, T, 6).svg;
    const v = poly([[nl - 4, 396], [nr + 4, 394], [bx + 2, 456]]);
    body += inked([{ d: v, fill: S.c }], S.k, 2.4) + trimBand([[nl - 8, 396], [bx + 2, 460], [nr + 8, 394]], 5, Tr);
    const x = bx - 2, y = 494;
    let sig = line(ell(x, y, 22, 22), Tr.c, 3) + line(ell(x, y, 15, 15), Tr.c, 1.6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      sig += line(`M${f1(x + Math.cos(a) * 24)} ${f1(y + Math.sin(a) * 24)}L${f1(x + Math.cos(a) * 32)} ${f1(y + Math.sin(a) * 32)}`, Tr.c, 2.4);
    }
    sig += fill(spline([[x - 11, y, 0], [x, y - 6], [x + 11, y, 0], [x, y + 6]], true), Tr.c) + fill(ell(x, y, 3, 3), S.c);
    body += sig;
    return { body };
  },

  regalRobe(doc, G, P, look, tw) {
    const T = P.primary, S = P.secondary, Tr = P.trim, { bx } = G;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    const fil = (pts) => fill(ribbon(pts, 2, PROF.both, 20), Tr.c);
    const collarBack = spline([[nl - 48, 430, 0.3], [nl - 92, 340], [nl - 108, 232, 0], [nl - 58, 260], [G.neckX, 286], [nr + 58, 254], [nr + 106, 222, 0], [nr + 92, 336], [nr + 50, 430, 0.3]], true);
    const back = inked([{ d: collarBack, fill: S.c, after: clipTo(doc, collarBack, fill(ell(G.neckX, 300, 92, 64), S.d)
      + fil([[nl - 80, 330], [nl - 70, 300], [nl - 82, 280], [nl - 92, 296]]) + fil([[nr + 80, 324], [nr + 70, 294], [nr + 82, 272], [nr + 92, 290]])) }], T.k, 3.6)
      + trimBand([[nl - 50, 428], [nl - 92, 340], [nl - 106, 236]], 7, Tr) + trimBand([[nr + 52, 428], [nr + 92, 336], [nr + 104, 226]], 7, Tr);
    let body = torsoBase(doc, G, T, 6).svg;
    const v = poly([[nl - 10, 398], [nr + 10, 396], [bx + 2, 488]]);
    body += inked([{ d: v, fill: S.c, after: fill(poly([[G.neckX + 4, 398], [nr + 10, 396], [bx + 2, 488]]), S.s) }], S.k, 2.4);
    body += trimBand([[nl - 12, 398], [bx + 1, 486]], 8, Tr) + trimBand([[nr + 12, 396], [bx + 3, 486]], 8, Tr);
    body += fil([[bx - 120, 470], [bx - 96, 452], [bx - 80, 470], [bx - 94, 482]]) + fil([[bx + 110, 466], [bx + 88, 450], [bx + 72, 468], [bx + 86, 480]]);
    const gem = hex(look.accent ?? 0xffc23d);
    body += inked([{ d: spline([[bx + 2, 470, 0], [bx + 14, 488], [bx + 2, 508, 0], [bx - 10, 488]], true), fill: Tr.c }], Tr.k, 1.8)
      + fill(spline([[bx + 2, 478, 0], [bx + 8, 488], [bx + 2, 500, 0], [bx - 4, 488]], true), gem) + fill(ell(bx, 484, 1.4, 2.6), '#fff', op(0.85));
    return { back, body };
  },
/*@@OUTFIT*/
};
// ------------------------------------------------------------------ headgear
const gemSVG = (x, y, rx, ry, c, Tr) => inked([{ d: spline([[x, y - ry - 4, 0], [x + rx + 4, y], [x, y + ry + 4, 0], [x - rx - 4, y]], true), fill: Tr.c }], Tr.k, 1.6)
  + fill(spline([[x, y - ry, 0], [x + rx, y], [x, y + ry, 0], [x - rx, y]], true), c)
  + fill(spline([[x, y - ry, 0], [x + rx, y], [x, y + ry * 0.1]], true), '#fff', op(0.25))
  + fill(ell(x - rx * 0.3, y - ry * 0.35, rx * 0.25, ry * 0.3), '#fff', op(0.9));

function starPin(x, y, r, Tr, gem) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  return inked([{ d: poly(pts), fill: Tr.c, after: fill(poly([pts[0], pts[1], [x, y], pts[9]]), Tr.l, op(0.7)) + fill(ell(x, y, r * 0.22, r * 0.22), gem) }], Tr.k, 1.6);
}

function helmDome(doc, G, M, Tr, o = {}) {
  const dome = spline([[142, 238, 0.4], [134, 170], [158, 104], [214, 70], [270, 66], [330, 80], [372, 124], [386, 188], [378, 242, 0.4], [360, 204], [330, 182], [266, 174], [204, 180], [166, 206]], true);
  const sh = fill(spline([[300, 60], [392, 120], [400, 250], [350, 240], [340, 150]], true), M.s)
    + fill(ribbon([[178, 160], [196, 110], [236, 84]], 12, PROF.both), M.l, op(0.75)) + fill(ribbon([[206, 166], [220, 126], [250, 104]], 4, PROF.both), M.l, op(0.6))
    + fill(ribbon([[268, 176], [266, 120], [262, 70]], 8, PROF.flat), M.c) + line(spline([[272, 176], [270, 120], [266, 68]]), M.k, 1.6, op(0.6));
  let s = inked([{ d: dome, fill: M.c, after: clipTo(doc, dome, sh) }], M.k, 4);
  const guard = (m) => (m < 0
    ? spline([[148, 208, 0.4], [180, 196], [184, 262], [176, 300], [160, 318, 0.3], [144, 280]], true)
    : spline([[376, 212, 0.4], [348, 198], [346, 260], [352, 292], [366, 306, 0.3], [380, 270]], true));
  for (const m of [-1, 1]) s += inked([{ d: guard(m), fill: m < 0 ? M.c : M.s, after: line(spline(m < 0 ? [[164, 230], [168, 270]] : [[362, 232], [362, 266]]), M.k, 1.4, op(0.5)) }], M.k, 3.4);
  s += trimBand([[146, 222], [204, 186], [266, 178], [330, 186], [378, 216]], o.brim ?? 12, Tr, 1.8);
  for (const [x, y] of [[176, 206], [222, 186], [312, 186], [356, 202]]) s += fill(ell(x, y, 2.4, 2.4), Tr.k) + fill(ell(x - 0.6, y - 0.6, 1, 1), '#fff', op(0.7));
  return s;
}

/** Headgear generators: (doc, G, P, look, tw, ex) → { back, mid, top, cast, hide }. */
export const HEADGEAR = {
  circlet(doc, G, P, look, tw) {
    const Tr = P.trim;
    const gem = hex(tw.gem ?? look.accent ?? 0x4aa3e8);
    return { mid: trimBand([[170, 206], [212, 184], [G.mx, 174], [320, 180], [352, 198]], 6, Tr) + gemSVG(G.mx, 175, 6, 8, gem, Tr) };
  },

  hornedCirclet(doc, G, P, look, tw) {
    const Tr = tone(tw.metal ?? 0xc8c4d8);
    const gem = hex(look.accent ?? 0x9b3dff);
    const horn = (pts, w) => {
      const r = ribbonOf(sample(pts, 26), (t) => w * Math.pow(1 - t, 0.9));
      const ridges = [0.2, 0.4, 0.6].map((t) => { const i = Math.round(t * (r.c.length - 1)); return line(`M${fmt(r.L[i])}L${fmt(r.R[i])}`, Tr.s, 1.6); }).join('');
      return inked([{ d: r.d, fill: Tr.c, after: ridges + fill(ribbonOf(r.L.slice(2, -4), (t) => 3 * PROF.both(t)).d, '#fff', op(0.7)) }], Tr.k, 2.6);
    };
    return {
      top: horn([[192, 172], [168, 120], [150, 80], [118, 44]], 18) + horn([[330, 168], [350, 118], [362, 82], [390, 44]], 15),
      mid: trimBand([[170, 204], [212, 182], [G.mx, 172], [320, 178], [352, 196]], 6, Tr) + gemSVG(G.mx, 173, 6, 9, gem, Tr),
    };
  },

  crown(doc, G, P, look, tw) {
    const Tr = P.trim, gem = hex(look.accent ?? 0xff3a3a);
    const band = spline([[180, 156, 0.3], [222, 140], [G.mx, 136], [316, 140], [348, 152, 0.3], [348, 174, 0.3], [316, 164], [G.mx, 160], [222, 164], [180, 180, 0.3]], true);
    const spikes = [[188, 158, 168, 104], [224, 146, 220, 92], [G.mx, 142, G.mx, 72], [312, 146, 318, 94], [344, 156, 360, 110]];
    let s = '';
    for (const [x, y, tx, ty] of spikes) s += inked([{ d: poly([[x - 13, y + 4], [tx, ty], [x + 13, y + 4]]), fill: Tr.c, after: fill(poly([[x - 4, y + 2], [tx, ty], [x + 13, y + 4]]), Tr.s) }], Tr.k, 2.2)
      + fill(ell(tx, ty + 2, 4, 4), gem) + inked([{ d: ell(tx, ty, 4.5, 4.5), fill: Tr.c }], Tr.k, 1.4);
    s += inked([{ d: band, fill: Tr.c, after: clipTo(doc, band, fill(poly([[300, 120], [360, 120], [360, 190], [300, 190]]), Tr.s) + fill(ribbon([[190, 152], [G.mx, 140], [330, 146]], 3, PROF.both), Tr.l, op(0.8))) }], Tr.k, 2.6);
    s += gemSVG(G.mx, 150, 6, 7, gem, Tr) + gemSVG(212, 154, 4, 5, gem, Tr) + gemSVG(320, 154, 4, 5, gem, Tr);
    return { top: s };
  },

  witchHat(doc, G, P, look, tw) {
    const T = P.primary, Tr = P.trim;
    const cone = spline([[176, 150, 0.4], [196, 104], [210, 66], [200, 46], [170, 32], [124, 30, 0], [176, 6], [216, 8], [248, 28], [276, 62], [304, 102], [332, 150, 0.4]], true);
    const brim = ell(254, 146, 182, 36, -5);
    const brimUnder = spline([[74, 162], [160, 172], [254, 176], [350, 160], [434, 130], [430, 150], [350, 186], [254, 198], [150, 190], [80, 172]], true);
    let s = inked([{ d: cone, fill: T.c, after: clipTo(doc, cone, fill(spline([[262, 0], [340, 150], [300, 160], [240, 40]], true), T.s) + fill(ribbon([[196, 132], [212, 80], [210, 50]], 8, PROF.both), T.l, op(0.35))) }], T.k, 4);
    s += inked([{ d: brim, fill: T.c, after: clipTo(doc, brim, fill(brimUnder, T.s) + fill(ribbon([[110, 140], [200, 124], [300, 120]], 4, PROF.both), T.l, op(0.35))) }], T.k, 4);
    s += trimBand([[186, 128], [222, 120], [256, 118], [292, 120], [326, 128]], 15, Tr);
    s += starPin(218, 122, 14, Tr, hex(look.accent ?? 0xff7a3d));
    return { top: s, cast: [brim], hide: { top: true } };
  },

  hood(doc, G, P, look, tw) {
    const C = P.cape || P.primary;
    const back = spline([[104, 440], [104, 320], [118, 204], [158, 108], [220, 62], [292, 60], [352, 92], [394, 170], [408, 290], [412, 440]], true);
    const outer = [[136, 446], [130, 330], [136, 224], [164, 130], [220, 84], [290, 82], [348, 112], [384, 186], [392, 300], [386, 446]];
    const hole = [[176, 330], [164, 252], [170, 176], [204, 136], [262, 124], [320, 136], [352, 176], [358, 250], [346, 330], [306, 396], [226, 396]];
    const rim = spline(outer, true) + spline(hole.slice().reverse(), true);
    const shadow = clipTo(doc, spline(hole, true), fill(spline(hole, true), doc.lin([[0, INK, 0.62], [1, INK, 0]], 0, 124, 0, 232, true)));
    const folds = [[[150, 250], [160, 330], [168, 420]], [[372, 250], [366, 330], [362, 420]], [[196, 108], [236, 96], [276, 98]]].map((p) => fill(ribbon(p, 5, PROF.both), C.s)).join('');
    return {
      back: inked([{ d: back, fill: C.d }], C.k, 4),
      over: shadow + inked([{ d: rim, fill: C.c, a: ' fill-rule="evenodd"', after: clipTo(doc, rim, folds + fill(spline([[340, 90], [420, 200], [420, 446], [370, 446], [372, 220]], true), C.s)) }], C.k, 4),
      hide: { back: true },
    };
  },

  hoodDown(doc, G, P, look, tw) {
    const C = P.cape || P.primary;
    const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
    const cowl = spline([[nl - 96, 440], [nl - 80, 374], [nl - 36, 334], [G.neckX, 322], [nr + 40, 330], [nr + 84, 370], [nr + 98, 440]], true);
    const roll = spline([[nl - 50, 418], [nl - 34, 384], [G.neckX, 396], [nr + 34, 380], [nr + 52, 414], [nr + 26, 436], [G.neckX + 4, 440], [nl - 26, 438]], true);
    return {
      outfitBack: inked([{ d: cowl, fill: C.c, after: clipTo(doc, cowl, fill(ell(G.neckX, 350, 64, 30), C.d) + fill(ribbon([[nl - 70, 400], [nl - 40, 360], [nl - 4, 346]], 6, PROF.both), C.l, op(0.4))) }], C.k, 4),
      outfitFront: inked([{ d: roll, fill: C.c, after: clipTo(doc, roll, fill(ribbon([[nl - 40, 410], [G.neckX, 420], [nr + 40, 404]], 6, PROF.both), C.s) + fill(ell(nr + 30, 420, 26, 26), C.s)) }], C.k, 3.6),
    };
  },

  helmOpen(doc, G, P, look, tw) {
    return { top: helmDome(doc, G, metalTone(P.primary.n), P.trim), hide: { front: true, side: true } };
  },

  plumedHelm(doc, G, P, look, tw) {
    const M = metalTone(P.primary.n), Tr = P.trim, Pl = P.secondary;
    const plume = [L_([262, 76], [96, 128], 46, 34), L_([254, 74], [112, 172], 40, 20), L_([270, 74], [132, 76], 40, 30), L_([266, 72], [150, 210], 30, 6)];
    const pal = { hairS: Pl.s, hairLine: Pl.l };
    const s = inked(plume.map((x) => ({ d: x.r.d, fill: Pl.c, after: lockAfter(x.r, pal, {}) })), Pl.k, 3.4)
      + inked([{ d: spline([[244, 84], [254, 58], [282, 56], [290, 80]], true), fill: Tr.c }], Tr.k, 2);
    return { top: s + helmDome(doc, G, M, Tr), hide: { front: true, side: true } };
  },

  helmClosed(doc, G, P, look, tw, ex) {
    const M = metalTone(P.primary.n), Tr = P.trim, eye = look.eyes?.color ?? 0xff4a3a;
    const d = spline([[150, 352, 0.4], [136, 260], [138, 170], [168, 102], [224, 66], [290, 64], [348, 94], [384, 160], [388, 250], [378, 340, 0.4], [330, 372], [268, 380], [200, 374]], true);
    const sh = fill(spline([[300, 50], [400, 140], [400, 380], [310, 380], [330, 240]], true), M.s)
      + fill(ribbon([[172, 170], [188, 120], [230, 86]], 12, PROF.both), M.l, op(0.75))
      + fill(ribbon([[268, 72], [272, 160], [272, 376]], 10, PROF.flat), M.c) + line(spline([[276, 70], [278, 160], [278, 378]]), M.k, 1.8, op(0.6));
    const slit = spline([[176, 232], [230, 226], [272, 236], [316, 226], [362, 232], [358, 250], [316, 246], [272, 254], [230, 246], [178, 250]], true);
    const slant = ex.brow ? ex.brow[0] * 0.25 : 0;
    const glow = doc.rad([[0, '#fff'], [0.35, hex(lightOf(eye, 0.3))], [1, hex(eye), 0]]);
    let inner = fill(slit, '#0d0a10');
    for (const [x, m] of [[228, -1], [316, 1]]) inner += fill(ell(x, 240 + slant * 0.4, 20, 9, m * slant * 2), glow) + fill(ell(x, 240, 9, 3.4, m * slant * 2), '#fff');
    let s = inked([{ d, fill: M.c, after: clipTo(doc, d, sh) }], M.k, 4);
    s += inked([{ d: slit, fill: '#0d0a10', after: inner }], M.k, 2.4);
    for (let i = 0; i < 4; i++) s += fill(ell(306 + i * 12, 300, 2.6, 6), '#0d0a10');
    s += trimBand([[142, 200], [200, 176], [270, 170], [336, 176], [384, 196]], 8, Tr, 1.6) + trimBand([[152, 330], [210, 360], [270, 366], [330, 356], [378, 326]], 8, Tr, 1.6);
    return { top: s, hide: { front: true, side: true, face: true } };
  },

  bandana(doc, G, P, look, tw) {
    const C = P.secondary;
    const d = spline([[146, 222, 0.4], [136, 168], [158, 108], [214, 78], [272, 74], [332, 88], [368, 128], [380, 186], [372, 218, 0.4], [342, 184], [300, 168], [258, 164], [214, 170], [176, 192]], true);
    const tails = spline([[150, 190], [124, 212], [108, 262], [116, 300, 0], [130, 262], [142, 230], [150, 270, 0], [158, 224], [160, 196]], true);
    const knot = ell(152, 196, 14, 12);
    const dots = [[200, 110], [250, 96], [300, 104], [340, 140], [180, 150], [230, 136], [286, 134], [326, 166], [214, 172]].map(([x, y]) => fill(ell(x, y, 3.2, 3.2), C.l, op(0.85))).join('');
    return {
      top: inked([{ d: tails, fill: C.s }, { d, fill: C.c, after: clipTo(doc, d, fill(spline([[300, 70], [390, 150], [380, 230], [330, 180]], true), C.s) + dots + fill(ribbon([[176, 186], [258, 160], [342, 180]], 6, PROF.both), C.s)) }, { d: knot, fill: C.c, after: fill(ell(156, 200, 7, 6), C.s) }], C.k, 3.6),
      hide: { top: true },
    };
  },

  cap(doc, G, P, look, tw) {
    const C = P.cape || P.primary, fc = tone(tw.featherC ?? P.trim.n);
    const crown = spline([[152, 210, 0.4], [142, 172], [108, 136, 0], [158, 118], [212, 88], [276, 76], [332, 88], [366, 124], [378, 178], [374, 206, 0.4], [330, 192], [262, 184], [196, 192]], true);
    const brim = spline([[146, 214, 0.3], [140, 186], [198, 166], [262, 160], [330, 158], [396, 128, 0], [380, 172], [376, 206, 0.3], [330, 194], [262, 186], [196, 194]], true);
    const vane = ribbonOf(sample([[184, 176], [140, 150], [100, 136], [58, 140]], 26), (t) => 24 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)), 0.6) * (1 - 0.25 * t));
    let barbs = '';
    for (const t of [0.35, 0.55, 0.75]) { const i = Math.round(t * (vane.c.length - 1)); barbs += line(`M${fmt(vane.c[i])}L${fmt(vane.L[i])}`, fc.s, 1.6) + line(`M${fmt(vane.c[i])}L${fmt(vane.R[i])}`, fc.s, 1.6); }
    const s = inked([{ d: vane.d, fill: fc.c, after: fill(poly([...vane.c.slice(2), ...vane.R.slice(2).reverse()]), fc.s, op(0.7)) + barbs + fill(ribbonOf(vane.c, (t) => 2.2 * (1 - t)).d, fc.k) },
      { d: crown, fill: C.c, after: clipTo(doc, crown, fill(spline([[300, 60], [392, 130], [384, 210], [330, 190]], true), C.s) + fill(ribbon([[150, 150], [200, 108], [262, 88]], 8, PROF.both), C.l, op(0.35))) },
      { d: brim, fill: C.c, after: clipTo(doc, brim, fill(poly([[300, 150], [400, 120], [400, 220], [300, 220]]), C.s) + fill(ribbon([[150, 192], [262, 170], [380, 150]], 3, PROF.both), C.l, op(0.4))) }], C.k, 3.6);
    return { top: s, cast: [brim], hide: { top: true } };
  },
};
// ------------------------------------------------------------------ facial features
/** Beard, mustache, stubble, scar, eyepatch, mask, freckles and war paint. Returns { under, beard, over, top, hideMouth, hideNose, hideEye }. */
export function facialSVG(doc, G, pal, look, tw, faceD) {
  const fx = new Set(look.facial || []);
  const out = { under: '', beard: '', over: '', top: '', hideMouth: false, hideNose: false, hideEye: null };
  const hair = pal.hair, hairS = pal.hairS;
  if (fx.has('freckles')) {
    const c = hex(mix(pal.skinSN, 0x9a4a2a, 0.45));
    for (const [x, y, r] of [[196, 270, 1.8], [206, 276, 1.5], [214, 268, 1.6], [190, 280, 1.4], [222, 278, 1.3], [204, 286, 1.2], [316, 268, 1.5], [326, 274, 1.3], [308, 278, 1.2], [322, 284, 1.1], [258, 262, 1.2], [282, 260, 1.2]]) out.under += fill(ell(x, y, r, r), c, op(0.85));
  }
  if (fx.has('warpaint')) {
    const c = hex(tw.paint ?? 0x22304a);
    for (const [x, y] of [[196, 262], [210, 266], [224, 270]]) out.under += fill(ribbon([[x, y], [x - 6, y + 16], [x - 10, y + 32]], 6, PROF.tail), c, op(0.9));
    for (const [x, y] of [[312, 262], [324, 260]]) out.under += fill(ribbon([[x, y], [x + 4, y + 14], [x + 6, y + 28]], 5, PROF.tail), c, op(0.9));
    out.under += fill(ribbon([[G.mx - 2, 150], [G.mx - 1, 170], [G.mx, 192]], 7, PROF.tail), c, op(0.9));
  }
  if (fx.has('stubble')) {
    const reg = spline([[162, 256], [170, 296], [200, 322], [240, 338], [272, 340], [306, 328], [334, 300], [350, 262], [338, 272], [318, 296], [292, 300], [270, 294], [246, 300], [214, 296], [184, 270]], true);
    let dots = '';
    const rnd = rngFor('stubble');
    for (let i = 0; i < 70; i++) {
      const x = 170 + rnd() * 176, y = 262 + rnd() * 78;
      dots += fill(ell(x, y, 0.9, 0.9), hairS, op(0.6));
    }
    out.under += clipTo(doc, [faceD], clipTo(doc, reg, fill(reg, hair, op(0.16)) + dots));
  }
  if (fx.has('scar')) {
    const pts = tw.scar === 'cheek' ? [[190, 258], [206, 276], [228, 298]] : [[304, 176], [312, 194], [320, 218]];
    out.over += fill(ribbon(pts, 6, PROF.both), pal.skinLine, op(0.55)) + fill(ribbon(pts, 3.4, PROF.both), hex(mix(pal.skinN, 0xffd0d0, 0.5)));
    for (const t of [0.3, 0.6]) {
      const p = lerp2(pts[0], pts[2], t);
      out.over += line(`M${f1(p[0] - 5)} ${f1(p[1] + 3)}L${f1(p[0] + 5)} ${f1(p[1] - 3)}`, pal.skinLine, 1.3, op(0.6));
    }
  }
  const beard = fx.has('beard') ? (tw.beard || (G.elder ? 'long' : 'short')) : null;
  if (beard) {
    const w = G.heavy ? 7 : 0;
    let d, lines = [];
    if (beard === 'long') {
      d = spline([[158, 244], [160, 292], [176, 342], [204, 402], [234, 452], [262, 486, 0], [292, 450], [320, 398], [342, 338], [354, 290], [354, 248],
        [344, 258], [332, 292], [306, 316], [286, 326], [266, 328], [242, 324], [214, 312], [190, 290], [174, 256]], true);
      lines = [[[206, 330], [214, 380], [234, 430]], [[240, 336], [246, 400], [256, 456]], [[284, 336], [286, 396], [276, 450]], [[318, 324], [314, 370], [300, 410]]];
    } else {
      const b = beard === 'braided' ? 26 : 0;
      d = spline([[157 - w, 246], [159 - w, 284], [174 - w, 316], [204 - w * 0.5, 340 + b * 0.5], [232, 354 + b, 0.3], [248, 350 + b], [262, 362 + b, 0.3], [278, 352 + b], [294, 360 + b, 0.3],
        [318 + w * 0.5, 336 + b * 0.5], [337 + w, 308], [350 + w, 276], [354 + w, 248],
        [344 + w * 0.5, 256], [332, 282], [312, 302], [292, 318], [270, 321], [248, 318], [228, 310], [204, 296], [184, 276], [171 - w * 0.5, 252]], true);
      lines = [[[184, 290], [200, 314], [222, 332]], [[246, 332], [250, 348 + b]], [[276, 334], [276, 350 + b]], [[326, 304], [316, 324], [302, 338]], [[168, 262], [172, 290]]];
    }
    const sh = fill(spline([[300, 300], [362, 240], [362, 420], [300, 490], [284, 420]], true), hairS) + lines.map((p) => fill(strand(p, 1.8), pal.hairLine, op(0.85))).join('');
    out.beard += inked([{ d, fill: hair, after: clipTo(doc, d, sh) }], pal.hairInk, 3.4);
    if (beard === 'braided') {
      for (const x of [252, 284]) out.beard += braidSVG([[x, 362], [x - 2, 400], [x - 6, 446]], 16, pal, tw.braidTie ?? 0xb08a50);
    }
  }
  if (fx.has('mustache') || beard === 'long' || beard === 'braided') {
    const m = (s) => spline([[G.mx + 2, 293], [G.mx + 2 + s * 14, 290], [G.mx + 2 + s * 28, 300], [G.mx + 2 + s * 36, 322, 0], [G.mx + 2 + s * 24, 308], [G.mx + 2 + s * 8, 304]], true);
    out.over += inked([{ d: m(-1), fill: hair, after: fill(ribbon([[G.mx - 6, 298], [G.mx - 20, 300], [G.mx - 30, 310]], 2, PROF.both), hairS) }, { d: m(0.88), fill: hair, after: fill(ribbon([[G.mx + 10, 298], [G.mx + 22, 300], [G.mx + 28, 310]], 2, PROF.both), hairS) }], pal.hairInk, 2.6);
  } else if (beard === 'short') {
    out.over += inked([{ d: spline([[G.mx - 24, 312, 0.2], [G.mx - 18, 298], [G.mx - 6, 292], [G.mx + 3, 294], [G.mx + 12, 291], [G.mx + 22, 297], [G.mx + 26, 310, 0.2], [G.mx + 16, 302], [G.mx + 3, 300], [G.mx - 12, 302]], true),
      fill: hair, after: fill(ribbon([[G.mx + 4, 296], [G.mx + 14, 296], [G.mx + 22, 302]], 2, PROF.both), hairS) }], pal.hairInk, 2.2);
  }
  if (fx.has('eyepatch')) {
    out.hideEye = 'far';
    const pc = '#2b2126';
    const patch = spline([[288, 224], [312, 214], [338, 222], [342, 246], [326, 262], [300, 260], [286, 246]], true);
    out.top += fill(ribbon([[290, 226], [236, 180], [176, 140], [140, 128]], 6, PROF.flat), '#1e171b') + fill(ribbon([[338, 228], [362, 222], [384, 216]], 6, PROF.flat), '#1e171b');
    out.top += inked([{ d: patch, fill: pc, after: fill(ribbon([[296, 226], [314, 220], [332, 226]], 3, PROF.both), '#5a4a52', op(0.8)) + line(spline([[292, 230], [312, 220], [334, 228], [336, 246], [322, 256], [300, 254], [292, 244]], true), '#6a5a60', 1, ' stroke-dasharray="3 3"') }], INK, 2.6);
  }
  if (fx.has('mask')) {
    out.hideMouth = true;
    out.hideNose = true;
    const c = tone(tw.maskColor ?? look.outfit?.secondary ?? 0x3a3030);
    const d = spline([[154, 252, 0.4], [204, 262], [G.mx, 264], [326, 256], [356, 246, 0.4], [352, 284], [334, 316], [308, 346], [306, 420, 0], [212, 420, 0], [206, 352], [176, 320], [160, 284]], true);
    const folds = [[[196, 290], [244, 300], [300, 292]], [[210, 326], [252, 338], [302, 326]], [[218, 360], [256, 372], [298, 362]]].map((p) => fill(ribbon(p, 4, PROF.both), c.s)).join('');
    out.over += inked([{ d, fill: c.c, after: clipTo(doc, d, folds + fill(spline([[300, 250], [370, 240], [360, 420], [300, 420], [312, 330]], true), c.s) + fill(ribbon([[180, 262], [G.mx, 270], [340, 258]], 5, PROF.both), c.s)) }], c.k, 3.4);
  }
  return out;
}
// ------------------------------------------------------------------ creatures
const CREATURE_POSE = {
  neutral: [0, 0, 0], smile: [0.1, 0, 0], grin: [0.45, 0.4, 0], angry: [0.55, 1, 0], sad: [0, -0.4, 1], surprised: [0.35, -0.6, 0],
  determined: [0.05, 0.6, 0], hurt: [0.35, 0.7, 1], smirk: [0.15, 0.3, 0], worried: [0.05, -0.4, 1], shout: [1, 1, 0],
};
/** [mouthOpen 0..1, glare -1..1, earsDown 0..1] for creature expressions. */
export const poseOf = (expr) => CREATURE_POSE[expr] || CREATURE_POSE.neutral;

/** Glowing eye: radial halo, bright core and an optional slit pupil. */
export function glowEye(doc, x, y, rx, ry, c, o = {}) {
  const halo = doc.rad([[0, hex(lightOf(c, 0.5)), 0.85], [0.4, hex(c), 0.45], [1, hex(c), 0]]);
  let s = fill(ell(x, y, rx * 3, ry * 3.2, o.rot || 0), halo);
  s += fill(o.d || ell(x, y, rx, ry, o.rot || 0), hex(c)) + fill(o.core || ell(x, y, rx * 0.55, ry * 0.5, o.rot || 0), hex(lightOf(c, 0.75)));
  if (o.slit) s += fill(ell(x + rx * 0.1, y, rx * 0.16, ry * 0.85, o.rot || 0), '#140a18');
  return s;
}

function furTufts(pts, w, c, n = 0) {
  return pts.map((p) => fill(ribbon(p, w, PROF.both, 12), c, n ? op(n) : '')).join('');
}

function wolfSVG(doc, look, expr) {
  const C = tone(look.color ?? 0x6b6f7a), B = tone(look.belly ?? 0xbfc3cc), eye = look.eyes ?? 0xffd04a;
  const [open, glare, down] = poseOf(expr);
  const ink = C.k;
  const body = spline([[24, 540, 0], [40, 456], [80, 398, 0.3], [70, 368], [110, 350, 0.3], [108, 318], [150, 298], [210, 318], [300, 318], [356, 300], [396, 314, 0.3],
    [392, 346], [432, 360, 0.3], [424, 394], [464, 420, 0.3], [458, 454], [494, 540, 0]], true);
  const ruff = spline([[156, 540, 0], [168, 452], [136, 418, 0.2], [178, 414], [166, 376, 0.2], [210, 384], [220, 342, 0.2], [252, 368], [276, 330, 0.2], [298, 364],
    [332, 336, 0.2], [338, 378], [374, 368, 0.2], [358, 420], [390, 444, 0.2], [364, 462], [376, 540, 0]], true);
  let s = inked([{ d: body, fill: C.c, after: clipTo(doc, body, fill(spline([[380, 300], [520, 360], [520, 540], [400, 540], [420, 420]], true), C.s) + fill(ell(260, 330, 130, 40), C.s)
    + furTufts([[[90, 420], [100, 470]], [[120, 380], [136, 430]], [[430, 420], [436, 470]], [[60, 470], [66, 520]]], 3, C.d, 0.7)) },
  { d: ruff, fill: B.c, after: clipTo(doc, ruff, fill(spline([[300, 330], [400, 360], [380, 540], [300, 540], [320, 420]], true), B.s)
    + furTufts([[[200, 410], [206, 450]], [[250, 400], [254, 444]], [[300, 400], [296, 446]], [[226, 460], [230, 500]], [[280, 470], [278, 510]], [[330, 440], [326, 486]]], 2.6, B.s)) }], ink, 4);
  const ear = (base1, tip, base2, inner) => inked([{ d: spline([base1, lerp2(base1, tip, 0.55).map((v, i) => v + (i ? 0 : -6)), [...tip, 0], lerp2(base2, tip, 0.5), base2], true), fill: C.c,
    after: fill(spline(inner, true), hex(mix(C.n, 0xd08890, 0.45))) }], ink, 3.6);
  const tipN = down ? [104, 112] : [140, 52], tipF = down ? [338, 72] : [298, 36];
  s += ear([166, 186], tipN, [226, 140], [[176, 170], lerp2([176, 170], tipN, 0.7), [200, 146]]);
  s += ear([248, 136], tipF, [312, 156], [[262, 134], lerp2([270, 134], tipF, 0.72), [300, 148]]);
  const head = spline([[164, 304, 0.3], [124, 290], [142, 272, 0.2], [112, 246], [136, 232, 0.2], [124, 204], [146, 190, 0.3], [150, 160], [184, 130], [234, 116], [282, 122],
    [314, 146], [334, 176], [364, 194], [394, 212], [414, 236, 0.5], [412, 258, 0.5], [396, 274], [358, 286], [326, 302], [290, 318], [244, 326], [200, 318]], true);
  const muzzle = spline([[286, 232], [320, 212], [362, 214], [394, 232], [404, 256], [388, 276], [354, 286], [322, 302], [286, 314], [250, 320], [226, 300], [250, 270]], true);
  const jawDrop = open * 34;
  let hs = fill(muzzle, B.c) + fill(spline([[330, 150], [380, 190], [420, 230], [420, 300], [330, 300], [340, 240]], true), C.s, op(0.55));
  hs += fill(spline([[150, 270], [196, 300], [250, 320], [210, 330], [150, 320]], true), C.s);
  hs += furTufts([[[208, 132], [214, 158]], [[236, 126], [238, 150]], [[262, 130], [258, 152]], [[172, 222], [186, 244]], [[160, 250], [178, 268]]], 2.4, C.d, 0.8);
  hs += fill(spline([[210, 184], [246, 172], [282, 180], [300, 176], [326, 170], [336, 182], [304, 192], [276, 200], [244, 196], [216, 200]], true), C.d, op(0.55));
  s += inked([{ d: head, fill: C.c, after: clipTo(doc, head, hs) }], ink, 4);
  if (jawDrop > 1) {
    const mouth = spline([[392, 268], [360, 280], [326, 294], [300, 300], [318, 306 + jawDrop * 0.6], [352, 296 + jawDrop], [384, 284 + jawDrop * 0.9], [398, 276 + jawDrop * 0.6]], true);
    const jaw = spline([[300, 302], [326, 312 + jawDrop * 0.7], [358, 304 + jawDrop], [390, 290 + jawDrop * 0.9], [396, 302 + jawDrop * 0.9], [360, 322 + jawDrop], [312, 328 + jawDrop * 0.5], [286, 318]], true);
    let m = fill(mouth, '#4a1420') + fill(ell(350, 300 + jawDrop * 0.8, 26, 8), '#c0505a');
    for (const x of [380, 352]) m += fill(poly([[x - 5, 276 - (x - 380) * 0.3], [x + 5, 274 - (x - 380) * 0.3], [x, 292 - (x - 380) * 0.25]]), '#fffaf0');
    for (const x of [372, 340]) m += fill(poly([[x - 5, 300 + jawDrop * 0.9], [x + 5, 300 + jawDrop * 0.9], [x, 284 + jawDrop * 0.9]]), '#fffaf0');
    s += inked([{ d: jaw, fill: B.c, after: clipTo(doc, jaw, fill(ell(330, 330 + jawDrop, 60, 16), B.s)) }], ink, 3.4) + inked([{ d: mouth, fill: '#4a1420', after: clipTo(doc, mouth, m) }], ink, 2.4);
    s += furTufts([[[330, 220], [340, 234]], [[346, 218], [354, 232]], [[362, 222], [368, 236]]], 2.2, B.k, 0.6);
  } else {
    s += fill(ribbon([[394, 266], [372, 276], [342, 286], [312, 292]], 2.8, PROF.soft), ink);
  }
  s += inked([{ d: ell(402, 246, 13, 10, 12), fill: '#1c1a22', after: fill(ell(398, 241, 4, 2.6, 12), '#fff', op(0.6)) + fill(ell(408, 250, 2.4, 1.8), '#000') }], ink, 2);
  const g = glare * 4;
  s += glowEye(doc, 248, 196, 15, 7.5, eye, { d: spline([[226, 196 - g * 0.3], [246, 186 + g], [270, 188 + g * 0.4], [276, 196], [254, 205]], true), core: ell(250, 196, 7, 4), slit: true });
  s += glowEye(doc, 314, 185, 11, 6, eye, { d: spline([[298, 186 + g * 0.4], [314, 177 + g * 0.8], [330, 180], [334, 186], [316, 193]], true), core: ell(316, 185, 5, 3), slit: true });
  s += fill(ribbon([[220, 186 + g * 0.6], [246, 176 + g * 1.4], [276, 184 + g * 0.4]], 5, PROF.soft), ink) + fill(ribbon([[298, 174 + g], [316, 167 + g], [336, 174]], 4, PROF.soft), ink);
  return s;
}

function skeletonSVG(doc, look, expr) {
  const Bn = tone(look.color ?? 0xe9e2cf), eye = look.eyes ?? 0x6ff0ff;
  const [open, glare] = poseOf(expr);
  const ink = hex(mix(INK, 0x3a3428, 0.3));
  const hole = '#17141c';
  let s = look.aura ? fill(ell(256, 260, 250, 250), doc.rad([[0, hex(look.aura), 0.32], [1, hex(look.aura), 0]])) : '';
  const cloak = spline([[40, 540, 0], [60, 450], [92, 410], [150, 396], [262, 392], [370, 396], [430, 412], [460, 460], [474, 540, 0], [430, 520, 0.2], [400, 540, 0], [130, 540, 0], [90, 516, 0.2]], true);
  s += inked([{ d: cloak, fill: '#3a3230', after: fill(ell(262, 420, 140, 30), '#2a2424') }], INK, 4);
  for (let i = 3; i >= 0; i--) {
    const y = 336 + i * 24;
    s += inked([{ d: spline([[244, y], [262, y - 6], [282, y], [280, y + 14], [262, y + 18], [246, y + 14]], true), fill: Bn.c, after: fill(ell(270, y + 8, 10, 6), Bn.s) }], ink, 3);
  }
  const ribs = [[[262, 448], [212, 452], [168, 474], [148, 520]], [[262, 470], [216, 476], [180, 500], [168, 540]], [[262, 448], [306, 452], [344, 472], [360, 516]], [[262, 470], [302, 476], [334, 498], [344, 540]]];
  s += inked(ribs.map((p) => ({ d: ribbon(p, 11, PROF.soft, 24), fill: Bn.c, after: fill(ribbon(p.map(([x, y]) => [x, y + 3]), 4, PROF.soft, 24), Bn.s) })), ink, 3);
  s += inked([{ d: spline([[252, 428, 0.5], [272, 428, 0.5], [270, 540, 0], [254, 540, 0]], true), fill: Bn.c, after: fill(poly([[264, 428], [272, 428], [270, 540], [264, 540]]), Bn.s) }], ink, 3);
  for (const m of [-1, 1]) {
    const end = m < 0 ? [112, 410] : [410, 414];
    const cb = ribbon([[262, 426], [m < 0 ? 200 : 324, 414], end], 14, PROF.flat, 20);
    s += inked([{ d: cb, fill: Bn.c, after: fill(ribbon([[262, 430], [m < 0 ? 200 : 324, 419], end], 4, PROF.both, 20), Bn.s) }, { d: ell(end[0], end[1], 22, 20), fill: Bn.c, after: fill(ell(end[0] + 6, end[1] + 6, 14, 11), Bn.s) }], ink, 3.4);
  }
  const rust = metalTone(0x6e5e52);
  s += pauldronSVG(doc, { bx: 262, shN: 150, shF: 148, shY: 412 }, 'near', rust, tone(0x5a4a3a), { scale: 1.05, lames: 2, angular: true });
  const jaw = open * 24;
  const mand = spline([[196, 262], [200, 298], [218, 326], [246, 340], [282, 340], [306, 326], [320, 298], [322, 266], [312, 270], [304, 298], [284, 310], [242, 310], [218, 298], [208, 266]].map(([x, y]) => [x, y > 280 ? y + jaw : y + jaw * 0.4]), true);
  let mt = '';
  for (let i = 0; i < 7; i++) mt += fill(spline([[226 + i * 11, 314 + jaw], [232 + i * 11, 304 + jaw], [236 + i * 11, 314 + jaw]], true), Bn.c);
  s += inked([{ d: mand, fill: Bn.c, after: clipTo(doc, mand, fill(spline([[290, 300], [340, 260], [340, 360], [270, 360]], true), Bn.s)) }], ink, 3.6);
  if (jaw > 2) s += inked([{ d: spline([[224, 306], [300, 304], [298, 306 + jaw], [226, 308 + jaw]], true), fill: hole }], ink, 1.6) + inked([{ d: poly([[222, 316 + jaw], [302, 316 + jaw], [300, 308 + jaw], [224, 308 + jaw]]), fill: Bn.c, after: mt }], ink, 1.6);
  const skull = spline([[170, 236], [158, 182], [172, 130], [214, 98], [262, 92], [312, 104], [346, 138], [356, 186], [350, 232], [338, 262], [322, 286], [300, 298], [236, 302], [204, 292], [184, 268]], true);
  let sk = fill(spline([[320, 110], [380, 180], [360, 300], [320, 290], [338, 200]], true), Bn.s) + fill(spline([[164, 196], [190, 214], [196, 256], [176, 262], [160, 236]], true), Bn.s);
  sk += fill(ribbon([[196, 130], [230, 108], [270, 102]], 10, PROF.both), Bn.l, op(0.8));
  sk += line(spline([[300, 108], [292, 132], [304, 150], [296, 170]]), ink, 2) + line(spline([[204, 270], [226, 262], [252, 268]]), Bn.k, 1.6, op(0.5));
  s += inked([{ d: skull, fill: Bn.c, after: clipTo(doc, skull, sk) }], ink, 4);
  let teeth = '';
  for (let i = 0; i < 7; i++) teeth += inked([{ d: spline([[228 + i * 11, 286], [238 + i * 11, 286], [238 + i * 11, 300], [233 + i * 11, 304], [228 + i * 11, 300]], true), fill: Bn.c }], ink, 1.3);
  s += teeth;
  const sockN = spline([[198, 216 + glare * 4], [214, 200 + glare * 6], [240, 204 + glare * 4], [252, 222], [244, 246], [222, 252], [202, 242]], true);
  const sockF = spline([[282, 214], [298, 202 + glare * 5], [322, 206 + glare * 3], [328, 226], [318, 244], [296, 248], [282, 234]], true);
  s += fill(sockN, hole) + fill(sockF, hole) + line(sockN, ink, 2.2) + line(sockF, ink, 2.2);
  s += inked([{ d: spline([[268, 252, 0], [278, 268], [272, 278], [266, 272], [260, 278], [256, 268]], true), fill: hole }], ink, 1.4);
  s += glowEye(doc, 226, 226, 7, 7, eye) + glowEye(doc, 304, 225, 6, 6, eye);
  return s;
}
function wraithSVG(doc, look, expr) {
  const C = tone(look.color ?? 0x2a2440), glow = look.glow ?? 0x8affd8, eye = look.eyes ?? glow;
  const [open, glare] = poseOf(expr);
  const mid = doc.id('m');
  doc.defs.push(`<linearGradient id="${mid}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.62" stop-color="#fff"/><stop offset="0.98" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="url(#${mid}g)"/></mask>`);
  let s = fill(ell(256, 250, 240, 250), doc.rad([[0, hex(glow), 0.28], [0.6, hex(glow), 0.08], [1, hex(glow), 0]]));
  const cloak = spline([[84, 540, 0], [96, 430], [120, 330], [140, 230], [176, 140], [226, 92], [278, 86], [330, 108], [370, 170], [392, 260], [408, 360], [426, 450], [440, 540, 0]], true);
  const hood = spline([[150, 330], [148, 240], [170, 160], [214, 112], [270, 102], [322, 124], [356, 180], [368, 260], [362, 340], [318, 380], [262, 392], [196, 378]], true);
  const face = spline([[190, 330], [184, 260], [198, 196], [236, 160], [282, 156], [318, 180], [334, 236], [330, 300], [304, 344], [258, 356], [216, 348]], true);
  const tat = [[[110, 420], [96, 500], [84, 540]], [[150, 440], [146, 500], [150, 540]], [[400, 420], [414, 490], [430, 540]], [[360, 450], [366, 500], [362, 540]]].map((p) => fill(ribbon(p, 10, PROF.both), C.d)).join('');
  let body = inked([{ d: cloak, fill: C.c, after: clipTo(doc, cloak, fill(spline([[330, 110], [440, 300], [440, 540], [350, 540], [370, 300]], true), C.s) + tat) },
    { d: hood, fill: C.c, after: clipTo(doc, hood, fill(spline([[300, 104], [380, 200], [370, 360], [330, 380], [350, 240]], true), C.s) + fill(ribbon([[176, 190], [210, 132], [262, 112]], 10, PROF.both), C.l, op(0.35))) }], C.k, 4);
  body += fill(face, '#08060c') + clipTo(doc, face, fill(ell(260, 270, 70, 90), doc.rad([[0, hex(glow), 0.3], [1, hex(glow), 0]])));
  const g = glare * 5;
  body += glowEye(doc, 232, 246, 16, 6, eye, { rot: -8 + g }) + glowEye(doc, 296, 244, 13, 5, eye, { rot: 8 - g });
  if (open > 0.2) body += fill(ell(262, 312, 16 + open * 6, 6 + open * 16), doc.rad([[0, hex(lightOf(glow, 0.4)), 0.8], [1, hex(glow), 0]]));
  for (const [p, w] of [[[[150, 250], [110, 214], [96, 170], [118, 130]], 7], [[[364, 250], [408, 216], [420, 170], [398, 134]], 6], [[[214, 112], [196, 80], [214, 50]], 5], [[[304, 110], [322, 78], [306, 48]], 5]]) {
    body += fill(ribbon(p, w, PROF.both), hex(glow), op(0.16));
  }
  const claw = (x, y, m) => {
    const fingers = [[-30, -76], [-10, -98], [12, -96], [32, -70]].map(([dx, dy]) => ribbon([[x + dx * 0.35 * m, y], [x + dx * 0.75 * m, y + dy * 0.55], [x + dx * m * 1.05, y + dy]], 13, PROF.tail));
    const palm = spline([[x - 34 * m, y + 8], [x - 24 * m, y - 20], [x + 26 * m, y - 20], [x + 38 * m, y + 8], [x + 24 * m, y + 70], [x - 26 * m, y + 70]], true);
    return inked([...fingers.map((d) => ({ d, fill: C.l })), { d: palm, fill: C.c, after: fill(ell(x + 10 * m, y + 30, 20, 30), C.s) }], C.k, 3) + fingers.map((d) => fill(d, hex(glow), op(0.18))).join('');
  };
  body += claw(132, 410, 1) + claw(388, 416, -1);
  return s + `<g mask="url(#${mid})">${body}</g>`;
}

function golemSVG(doc, look, expr) {
  const gold = (look.color ?? 0) === 0xe0b44a || (look.scale ?? 1) > 1.05;
  const S = gold ? metalTone(look.color ?? 0xe0b44a) : tone(look.color ?? 0xc9a66b), rune = look.rune ?? 0x5ff0ff, eye = look.eyes ?? rune;
  const [open, glare] = poseOf(expr);
  const ink = S.k;
  const rnd = rngFor(gold ? 'goldGolem' : 'golem');
  const speckle = (n, x0, y0, w, h) => { let r = ''; for (let i = 0; i < n; i++) r += fill(ell(x0 + rnd() * w, y0 + rnd() * h, 1.6, 1.3), gold ? S.l : S.s, op(0.7)); return r; };
  const runeLine = (pts, w = 3) => fill(ribbon(pts, w * 2.6, PROF.flat, 10), hex(rune), op(0.25)) + fill(ribbon(pts, w, PROF.flat, 10), hex(lightOf(rune, 0.35)));
  let s = fill(ell(256, 300, 240, 220), doc.rad([[0, hex(rune), 0.18], [1, hex(rune), 0]]));
  const shN = spline([[24, 540, 0], [30, 430], [64, 372], [130, 350], [196, 368], [214, 440], [204, 540, 0]], true);
  const shF = spline([[312, 540, 0], [304, 440], [324, 376], [388, 352], [446, 376], [484, 440], [494, 540, 0]], true);
  const chest = poly([[176, 540], [182, 404], [256, 378], [338, 398], [344, 540]]);
  const sh = (d, dark) => clipTo(doc, d, fill(dark, S.s) + speckle(14, 40, 360, 440, 180));
  s += inked([{ d: chest, fill: S.c, after: sh(chest, poly([[260, 378], [344, 398], [350, 540], [262, 540]])) + runeLine([[220, 470], [256, 444], [296, 470], [256, 500], [220, 470]], 3) + fill(ell(258, 472, 10, 10), hex(lightOf(rune, 0.5))) },
    { d: shN, fill: S.c, after: sh(shN, spline([[150, 350], [214, 380], [214, 540], [140, 540], [170, 420]], true)) + line(spline([[60, 420], [100, 440], [120, 480]]), ink, 2) },
    { d: shF, fill: S.c, after: sh(shF, spline([[420, 360], [500, 430], [500, 540], [430, 540], [450, 440]], true)) + line(spline([[380, 400], [400, 430], [430, 440]]), ink, 2) }], ink, 4);
  if (gold) {
    s += trimBand([[40, 440], [90, 392], [150, 372], [204, 388]], 10, tone(0xb07a22)) + trimBand([[316, 392], [372, 372], [436, 384], [480, 430]], 10, tone(0xb07a22));
  }
  const head = spline([[176, 150, 0.3], [222, 120, 0.5], [292, 118, 0.5], [340, 142, 0.3], [358, 200], [352, 282, 0.4], [326, 330, 0.5], [262, 348, 0.5], [198, 332, 0.5], [168, 284, 0.4], [160, 200]], true);
  const hd = fill(spline([[300, 120], [370, 180], [360, 340], [300, 350], [330, 240]], true), S.s) + speckle(26, 170, 130, 180, 200)
    + fill(poly([[196, 318], [328, 314], [334, 340], [262, 356], [192, 338]]), S.s, op(0.8))
    + line(spline([[258, 120], [262, 150], [256, 178]]), ink, 2) + line(spline([[166, 268], [196, 262], [222, 268]]), ink, 2) + line(spline([[300, 264], [326, 258], [354, 266]]), ink, 2)
    + line(spline([[196, 316], [262, 312], [328, 314]]), ink, 2.2) + line(spline([[300, 128], [290, 146], [302, 160]]), ink, 1.8);
  s += inked([{ d: head, fill: S.c, after: clipTo(doc, head, hd) }], ink, 4);
  s += clipTo(doc, head, fill(spline([[160, 226], [256, 214 + glare * 8], [362, 220], [360, 252], [256, 248 + glare * 6], [160, 258]], true), '#1a1214', op(0.55)));
  const brow = spline([[166, 194, 0.2], [256, 178 + glare * 6], [352, 188, 0.2], [356, 214, 0.3], [304, 222 + glare * 4], [256, 218 + glare * 8], [206, 226 + glare * 4], [168, 230, 0.3]], true);
  s += inked([{ d: brow, fill: S.c, after: fill(ribbon([[176, 192], [256, 180 + glare * 6], [344, 190]], 6, PROF.both), gold ? S.l : hex(lightOf(S.n, 0.25)), op(0.8))
    + fill(poly([[166, 226], [256, 214 + glare * 8], [356, 210], [356, 216], [256, 222 + glare * 8], [168, 232]]), S.s) }], ink, 3.4);
  s += fill(ell(218, 240, 26, 8), '#120c10') + fill(ell(306, 236, 22, 7), '#120c10');
  s += glowEye(doc, 218, 240, 17, 4.5 - glare, eye, { rot: glare * 6 }) + glowEye(doc, 306, 236, 14, 4 - glare * 0.8, eye, { rot: -glare * 6 });
  const mouth = open > 0.15 ? spline([[218, 300], [262, 296], [306, 298], [300, 300 + open * 22], [262, 306 + open * 26], [222, 302 + open * 20]], true) : null;
  if (mouth) s += inked([{ d: mouth, fill: '#120c10', after: fill(ell(262, 304 + open * 10, 30, 6 + open * 8), doc.rad([[0, hex(lightOf(rune, 0.4)), 0.9], [1, hex(rune), 0]])) }], ink, 2.4);
  else s += fill(ribbon([[220, 298], [262, 296], [302, 293]], 3.6, PROF.soft), ink);
  s += runeLine([[248, 146], [258, 134], [268, 146], [258, 160], [248, 146]], 2.4) + runeLine([[258, 160], [258, 172]], 2.4);
  if (gold) {
    s += trimBand([[170, 178], [256, 160], [354, 174]], 8, tone(0xb07a22));
    s += inked([{ d: poly([[226, 128], [242, 92], [258, 120], [274, 88], [290, 126]]), fill: S.c, after: fill(poly([[258, 120], [274, 88], [290, 126]]), S.s) }], ink, 2.6);
  }
  return s;
}

function wyrmSVG(doc, look, expr) {
  const C = tone(look.color ?? 0x1d1a2b), Bl = tone(look.belly ?? 0x3b2f4f), glow = look.glow ?? 0xb04dff;
  const Hn = tone(look.horn ?? 0xe8dcc0), HnS = hex(mix(look.horn ?? 0xe8dcc0, 0xb07a30, 0.45));
  const [open, glare] = poseOf(expr);
  const ink = '#0b0910';
  const gl = hex(glow), gll = hex(lightOf(glow, 0.45));
  const crack = (pts, w = 3) => fill(ribbon(pts, w * 3, PROF.both, 16), gl, op(0.3)) + fill(ribbon(pts, w, PROF.both, 16), gll);
  let s = fill(ell(240, 250, 270, 270), doc.rad([[0, hex(look.aura ?? glow), 0.42], [0.6, hex(look.aura ?? glow), 0.14], [1, hex(look.aura ?? glow), 0]]));
  const horn = (pts, w) => {
    const r = ribbonOf(sample(pts, 30), (t) => w * Math.pow(1 - t, 0.85));
    const rings = [0.18, 0.34, 0.5, 0.64].map((t) => { const i = Math.round(t * (r.c.length - 1)); return line(`M${fmt(r.L[i])}L${fmt(r.R[i])}`, HnS, 2); }).join('');
    return inked([{ d: r.d, fill: Hn.c, after: fill(ribbonOf(r.R.slice(0, -3), (t) => (w * 0.35) * (1 - t)).d, HnS) + rings + fill(ribbonOf(r.L.slice(2, -6), (t) => 3 * PROF.both(t)).d, '#fff', op(0.6)) }], ink, 3.6);
  };
  s += horn([[200, 150], [150, 92], [90, 54], [24, 40]], 46) + horn([[244, 136], [222, 70], [196, 26], [164, -4]], 34);
  const neck = spline([[-10, 540, 0], [10, 430], [60, 344], [120, 290], [196, 286], [252, 330], [278, 420], [300, 540, 0]], true);
  const plates = [0, 1, 2, 3, 4].map((i) => { const y = 330 + i * 44; const x = 214 + i * 16; return spline([[x - 30, y], [x + 26, y - 6], [x + 34, y + 30], [x - 22, y + 38]], true); });
  const spines = [[[60, 344], [16, 300], [74, 318]], [[30, 400], [-14, 370], [40, 380]], [[96, 300], [64, 248], [116, 286]]].map((p) => poly(p));
  s += inked([...spines.map((d) => ({ d, fill: C.s })), { d: neck, fill: C.c, after: clipTo(doc, neck, plates.map((d) => fill(d, Bl.c) + line(d, ink, 2)).join('') + crack([[90, 420], [120, 380], [110, 340], [140, 310]], 2.6) + crack([[60, 500], [80, 470], [70, 440]], 2.2)) }], ink, 4);
  const jaw = open * 46;
  const lower = spline([[176, 300], [230, 312 + jaw * 0.5], [320, 304 + jaw * 0.9], [420, 284 + jaw], [446, 290 + jaw], [430, 310 + jaw], [330, 336 + jaw * 0.8], [240, 344 + jaw * 0.4], [180, 330]], true);
  const mouthIn = spline([[230, 292], [330, 284], [440, 262], [436, 286 + jaw], [330, 310 + jaw * 0.9], [240, 312 + jaw * 0.5]], true);
  let teeth = '';
  for (let i = 0; i < 6; i++) { const x = 290 + i * 26, y = 284 - i * 3.6; teeth += fill(poly([[x - 6, y - 2], [x + 6, y - 4], [x + 1, y + 16 + (i % 2) * 6]]), '#f4ecdc'); }
  for (let i = 0; i < 5; i++) { const x = 300 + i * 26, y = 304 + jaw * (0.6 + i * 0.08) - i * 4; teeth += fill(poly([[x - 6, y + 4], [x + 6, y + 2], [x, y - 14]]), '#e8dcc8'); }
  s += inked([{ d: lower, fill: C.c, after: clipTo(doc, lower, fill(poly([[180, 330], [446, 300], [446, 400], [180, 400]]), Bl.c)) }], ink, 3.6);
  s += inked([{ d: mouthIn, fill: '#2a0e34', after: clipTo(doc, mouthIn, fill(ell(330, 296 + jaw * 0.6, 90, 14 + jaw * 0.4), doc.rad([[0, gll, 0.9], [1, gl, 0]])) + teeth) }], ink, 2.4);
  const head = spline([[118, 250], [126, 196], [168, 150], [234, 128], [296, 140], [346, 166], [416, 186], [478, 208], [500, 232, 0.4], [492, 256, 0.4], [446, 266], [384, 274], [330, 286], [268, 298], [200, 304], [146, 290]], true);
  let hs = fill(spline([[330, 150], [510, 220], [500, 280], [330, 290], [380, 220]], true), C.s);
  hs += fill(ribbon([[180, 170], [240, 142], [300, 150]], 12, PROF.both), C.l, op(0.35)) + fill(ribbon([[340, 176], [410, 194], [470, 214]], 8, PROF.both), C.l, op(0.3));
  for (const [x, y] of [[200, 210], [226, 196], [180, 240], [214, 250], [248, 236], [380, 222], [420, 232], [350, 250]]) hs += fill(spline([[x - 8, y], [x, y - 7], [x + 8, y], [x, y + 4]], true), C.d, op(0.7));
  hs += crack([[150, 260], [180, 270], [196, 292]], 2.4) + crack([[330, 200], [360, 214], [356, 240], [380, 252]], 2.2) + crack([[230, 160], [250, 182], [242, 204]], 2);
  s += inked([{ d: head, fill: C.c, after: clipTo(doc, head, hs) }], ink, 4);
  const brow = spline([[232, 196 + glare * 6], [270, 168], [320, 166 + glare * 6], [356, 184 + glare * 6], [318, 186 + glare * 8], [276, 192], [250, 204]], true);
  s += inked([{ d: brow, fill: C.s }], ink, 3);
  for (const [b1, tip, b2] of [[[262, 172], [244, 120], [284, 166]], [[300, 166], [300, 116], [322, 168]], [[170, 290], [104, 316], [180, 304]], [[214, 302], [170, 344], [232, 306]]]) {
    s += inked([{ d: poly([b1, tip, b2]), fill: Hn.c, after: fill(poly([lerp2(b1, b2, 0.5), tip, b2]), HnS) }], ink, 2.4);
  }
  const ey = 206 + glare * 3;
  s += glowEye(doc, 296, ey, 20, 8 - glare * 2, glow, { d: spline([[270, ey + 2], [292, ey - 9 + glare * 3], [318, ey - 6 + glare * 2], [326, ey], [300, ey + 9]], true), core: ell(298, ey, 9, 4), slit: true });
  s += glowEye(doc, 378, ey - 12, 10, 4.5, glow, { d: spline([[364, ey - 11], [378, ey - 18], [392, ey - 14], [394, ey - 10], [378, ey - 6]], true), core: ell(380, ey - 12, 5, 2.4), slit: true });
  s += inked([{ d: ell(476, 226, 9, 5, 20), fill: '#050308' }], ink, 2);
  for (const [p, w] of [[[[486, 222], [504, 196], [496, 160]], 10], [[[480, 218], [470, 186], [486, 150]], 8]]) s += fill(ribbon(p, w, PROF.both), gl, op(0.25));
  return s;
}

function placeholder(doc) {
  const C = tone(0x3c4252), ink = '#1c1f28';
  const back = spline([[70, 540, 0], [86, 440], [130, 390], [170, 360], [160, 300], [156, 210], [184, 128], [246, 88], [310, 96], [356, 150], [372, 240], [366, 320], [350, 360], [392, 392], [430, 440], [446, 540, 0]], true);
  const hole = spline([[200, 300], [192, 230], [214, 168], [262, 142], [312, 160], [334, 220], [330, 296], [300, 338], [256, 350], [222, 336]], true);
  let s = fill(ell(256, 280, 230, 230), doc.rad([[0, '#8fa8d8', 0.2], [1, '#8fa8d8', 0]]));
  s += inked([{ d: back, fill: C.c, after: clipTo(doc, back, fill(spline([[310, 90], [400, 200], [450, 540], [340, 540], [360, 300]], true), C.s) + fill(ribbon([[196, 160], [230, 118], [280, 104]], 12, PROF.both), C.l, op(0.3))
    + fill(ribbon([[150, 420], [200, 400], [256, 396], [320, 404], [370, 424]], 8, PROF.both), C.s)) }], ink, 4);
  s += fill(hole, '#0c0d12') + clipTo(doc, hole, fill(ell(262, 300, 70, 60), doc.rad([[0, '#2a3040', 0.9], [1, '#2a3040', 0]])));
  return s + line(hole, ink, 3);
}

/** Wolf-pelt mantle over the shoulders with the wolf-head hood resting behind the near shoulder (Rask). Returns { back, front }. */
export function wolfPeltSVG(doc, G) {
  const F = tone(0x7c7f88), Bl = tone(0xb8bcc6), ink = F.k;
  const nl = G.neckX - G.neckW / 2, nr = G.neckX + G.neckW / 2;
  const pts = [[G.bx - G.shN - 14, 474, 0.3]];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = lerp(G.bx - G.shN - 14, G.bx + G.shF + 12, t);
    pts.push([x, 474 - Math.sin(Math.PI * t) * 46 + (i % 2 ? 18 : 0), i % 2 ? 0.2 : 1]);
  }
  pts.push([G.bx + G.shF + 12, 470, 0.3], [G.bx + G.shF - 6, G.shY - 22], [nr + 28, 370, 0.6], [G.neckX, 362], [nl - 28, 372, 0.6], [G.bx - G.shN + 18, G.shY - 22]);
  const mantle = spline(pts, true);
  const hx = nl - 74, hy = 352;
  const P = (dx, dy, c) => (c === undefined ? [hx + dx, hy + dy] : [hx + dx, hy + dy, c]);
  const ear = (b1, tip, b2) => ({ d: spline([P(...b1), P(...tip, 0), P(...b2)], true), fill: F.c, after: fill(spline([lerp2(P(...b1), P(...b2), 0.25), [...lerp2(lerp2(P(...b1), P(...b2), 0.5), P(...tip), 0.7), 0], lerp2(P(...b1), P(...b2), 0.75)], true), '#8a6268') });
  const head = spline([P(-62, 40), P(-70, 6), P(-48, -26), P(-6, -40), P(40, -30), P(62, 0), P(54, 44)], true);
  const snout = spline([P(-58, 4), P(-98, 26), P(-110, 50, 0.4), P(-88, 62), P(-50, 44)], true);
  const back = inked([ear([-44, -24], [-66, -90], [-12, -36]), ear([-2, -38], [8, -100], [34, -28]),
    { d: head, fill: F.c, after: clipTo(doc, head, fill(ell(hx + 30, hy + 20, 40, 40), F.s) + fill(ribbon([P(-50, -14), P(-24, -28), P(8, -30)], 6, PROF.both), F.d, op(0.6))) },
    { d: snout, fill: Bl.c, after: clipTo(doc, snout, fill(ell(hx - 70, hy + 54, 40, 12), Bl.s)) + fill(ell(hx - 104, hy + 48, 7, 6), '#1c1a22') }], ink, 3.6)
    + fill(spline([P(-46, -6), P(-30, -14), P(-20, -6), P(-34, 0)], true), '#1a1418') + fill(spline([P(-4, -12), P(10, -18), P(18, -10), P(6, -6)], true), '#1a1418');
  const front = inked([{ d: mantle, fill: F.c, after: clipTo(doc, mantle, fill(spline([[nr + 10, 360], [G.bx + G.shF + 30, 400], [G.bx + G.shF + 30, 490], [G.bx + 60, 470]], true), F.s)
    + [[G.bx - 150, 440], [G.bx - 100, 426], [G.bx - 40, 420], [G.bx + 40, 418], [G.bx + 100, 432]].map(([x, y]) => fill(strand([[x, y - 10], [x + 4, y + 4], [x + 2, y + 14]], 2), F.s)).join('')) }], ink, 3.6);
  return { back, front };
}
// ------------------------------------------------------------------ creatures (end)
/** Creature bust builders keyed by look.kind: (doc, look, expression) → svg. */
export const CREATURES = { wolf: wolfSVG, skeleton: skeletonSVG, wraith: wraithSVG, golem: golemSVG, wyrm: wyrmSVG };
/** Neutral hooded silhouette for unknown ids. */
export const placeholderSVG = (doc) => placeholder(doc);
/*@@*/
