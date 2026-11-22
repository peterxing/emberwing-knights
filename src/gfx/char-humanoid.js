// Super-deformed humanoid figurines: rig layout, body, outfits, hair, headgear, facial details,
// weapons, shields, capes and scarves, all baked into one skinned vertex-coloured mesh.
import * as THREE from 'three';
import { shade } from './toon.js';
import { editFaceNormals } from './char-faces.js';
import {
  RigDef, Assembler, prim, cachedGeo, sweepGeo, stripGeo, chainWeightsAxis, makeRng, hashStr, D2R, clamp, lerp, ik2,
} from './char-anim.js';

const TEAM_ACCENT = { player: 0x3d8bff, enemy: 0xff4a3d, ally: 0x4ee08a, neutral: 0xe8d36a };

/** Body measurements (model units, before look.scale) derived from build / gender / age. */
export function humanoidDims(look) {
  const heavy = look.body === 'heavy', slim = look.body === 'slim';
  const fem = look.gender === 'f';
  const d = { heavy, slim, fem, elder: look.age === 'elder' };
  d.hipY = heavy ? 0.288 : 0.296;
  d.legX = heavy ? 0.06 : slim ? 0.047 : 0.053;
  d.thigh = 0.126; d.shin = 0.126;
  d.ankleY = d.hipY - 0.01 - d.thigh - d.shin;
  d.waistY = d.hipY + 0.045;
  d.chestY = d.waistY + 0.095;
  d.neckY = d.chestY + 0.122;
  d.tw = (heavy ? 1.3 : slim ? 0.9 : 1.0) * (fem ? 0.93 : 1);
  d.td = heavy ? 1.2 : slim ? 0.93 : 1.0;
  d.shX = 0.098 * d.tw + (heavy ? 0.018 : 0.012);
  d.shY = d.neckY - 0.036;
  d.upper = 0.1; d.fore = 0.094;
  d.lr = heavy ? 1.32 : slim ? 0.86 : 1.0;
  d.headR = 0.19;
  d.headY = d.neckY + 0.168;
  d.headS = [1.0, 0.95, 0.97];
  d.capeTop = d.shY + 0.012;
  return d;
}

/** Bone layout for humanoids (also used by the skeleton monster). */
export function humanoidRig(look, d, extra = {}) {
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('hips', 'base', 0, d.hipY, 0);
  R.bone('spine', 'hips', 0, d.waistY, 0);
  R.bone('chest', 'spine', 0, d.chestY, 0);
  R.bone('head', 'chest', 0, d.neckY, 0);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const x = s * d.shX;
    R.bone('arm' + side, 'chest', x, d.shY, 0);
    R.bone('fore' + side, 'arm' + side, x, d.shY - d.upper, 0);
    R.bone('hand' + side, 'fore' + side, x, d.shY - d.upper - d.fore, 0);
  }
  const hy = d.shY - d.upper - d.fore;
  R.bone('wpn', 'handR', -d.shX, hy - 0.012, 0);
  R.bone('off', 'handL', d.shX, hy - 0.012, 0);
  R.bone('nock', 'off', d.shX, hy - 0.012 + 0.07, 0);
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    const x = s * d.legX;
    R.bone('thigh' + side, 'hips', x, d.hipY - 0.01, 0);
    R.bone('shin' + side, 'thigh' + side, x, d.hipY - 0.01 - d.thigh, 0);
    R.bone('foot' + side, 'shin' + side, x, d.ankleY, 0);
  }
  // cape chain hangs from the upper back
  const cz = -0.085 * d.td;
  let prev = 'chest';
  for (let i = 0; i < 4; i++) {
    const n = 'cape' + i;
    R.bone(n, prev, 0, d.capeTop - i * 0.105, cz - i * 0.012);
    prev = n;
  }
  // scarf tail chain at the back of the neck
  prev = 'chest';
  for (let i = 0; i < 3; i++) {
    const n = 'scarf' + i;
    R.bone(n, prev, -0.04, d.neckY - 0.005 - i * 0.07, -0.1 - i * 0.03);
    prev = n;
  }
  // hair chains: positions supplied per hairstyle (default: back of the head)
  const hairA = extra.hairA || [[0, d.headY - 0.02, -0.17], [0, d.headY - 0.16, -0.2], [0, d.headY - 0.3, -0.21]];
  const hairB = extra.hairB || null;
  prev = 'head';
  hairA.forEach((p, i) => { R.bone('hairA' + i, prev, p[0], p[1], p[2]); prev = 'hairA' + i; });
  if (hairB) {
    prev = 'head';
    hairB.forEach((p, i) => { R.bone('hairB' + i, prev, p[0], p[1], p[2]); prev = 'hairB' + i; });
  }
  return R;
}

// ------------------------------------------------------------------ colour helpers
const C = (hex) => new THREE.Color(hex);
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
/** Vertical gradient colour fn between two hex colours over local Y range [y0, y1]. */
export function gradY(hexBottom, hexTop, y0 = -1, y1 = 1) {
  const a = C(hexBottom), b = C(hexTop);
  return (p, n, out) => out.copy(a).lerp(b, clamp((p.y - y0) / (y1 - y0), 0, 1));
}
/** "Painted" metal: lighter on upward/forward faces with a bright band, darker underneath. */
export function metal(hex, gloss = 1) {
  const base = C(hex), hi = C(shade(hex, 0.55)), lo = C(shade(hex, -0.35));
  return (p, n, out) => {
    const up = n.y * 0.65 + n.z * 0.35;
    out.copy(base);
    if (up < 0) out.lerp(lo, Math.min(1, -up * 0.9));
    else out.lerp(hi, Math.min(1, Math.pow(up, 3) * 0.75 * gloss));
  };
}
/** Hair: base colour with darker underside/tips and a light sheen band near the crown. */
export function hairFn(look, tipFrom = null) {
  const h = look.hair || { color: 0x553322, shade: 0x2a1a10 };
  const base = C(h.color), dark = C(h.shade !== undefined ? h.shade : shade(h.color, -0.4)), hi = C(shade(h.color, 0.32));
  return (p, n, out, mp) => {
    out.copy(base);
    if (n.y < 0.05) out.lerp(dark, Math.min(1, (0.05 - n.y) * 0.9));
    if (tipFrom !== null && mp && mp.y < tipFrom) out.lerp(dark, Math.min(0.7, (tipFrom - mp.y) * 2.5));
    if (n.y > 0.45 && n.y < 0.8) out.lerp(hi, 0.45);
  };
}

/** Per-look state shared by the build steps. */
export class HumanoidBuild {
  constructor(look, opts) {
    this.look = look;
    this.q = opts.quality === 'low' ? 0.6 : 0.85;
    this.team = opts.team || 'player';
    this.teamColor = TEAM_ACCENT[this.team] || TEAM_ACCENT.player;
    this.d = humanoidDims(look);
    this.o = look.outfit || {};
    this.rng = makeRng(hashStr(JSON.stringify(look)));
    this.glowParts = [];
    this.anchors = {};
    this.flags = {};
  }
  seg(n) { return Math.max(4, Math.round(n * this.q)); }
}

// ------------------------------------------------------------------ body
function skirtWeights(R, d, len, follow = 0.75) {
  const hips = R.idx('hips'), tl = R.idx('thighL'), tr = R.idx('thighR');
  const top = d.waistY - 0.02;
  return (p) => {
    let t = clamp((top - p.y) / len, 0, 1);
    t = Math.pow(t, 1.4) * follow;
    const wl = clamp((p.x + 0.035) / 0.07, 0, 1);
    return [[hips, 1 - t], [tl, t * wl], [tr, t * (1 - wl)]];
  };
}

/** Skin, head, limbs. Colours come from the dress spec so sleeves/boots match outfits. */
export function addBody(B, A, sp) {
  const d = B.d, look = B.look, skin = look.skin || 0xf2cfb6, s = (n) => B.seg(n);
  A.add(cachedGeo(`head${s(22)}`, () => editFaceNormals(new THREE.SphereGeometry(1, s(22), s(16)))), { bone: 'head', at: [0, d.headY, 0], scl: [d.headR * d.headS[0], d.headR * d.headS[1], d.headR * d.headS[2]], color: skin });
  for (const sx of [-1, 1]) {
    A.add(prim.sphere(s(8), s(6)), { bone: 'head', at: [sx * d.headR * 0.97, d.headY - 0.012, -0.004], scl: [0.022, 0.038, 0.03], color: shade(skin, -0.06), ol: 0.6 });
  }
  A.add(prim.cyl(1, 1, s(10), true), { bone: 'head', at: [0, d.neckY + 0.02, 0], scl: [0.034, 0.07, 0.032], color: shade(skin, -0.12), ol: 0 });
  // torso (chest + waist) and pelvis
  const cy = d.chestY, wy = d.waistY, hy = d.hipY;
  const chestProf = [[0, cy - 0.05], [0.074, cy - 0.046], [0.089, cy - 0.01], [0.097, cy + 0.03], [0.098, cy + 0.068], [0.09, cy + 0.094], [0.068, cy + 0.111], [0.036, cy + 0.121], [0, cy + 0.125]];
  const tz = d.td * 0.8;
  A.add(prim.lathe(chestProf, s(16)), { bone: 'chest', scl: [d.tw, 1, tz], color: sp.shirt });
  A.add(prim.lathe([[0, wy - 0.03], [0.07, wy - 0.028], [0.075, wy + 0.02], [0.08, wy + 0.06], [0, wy + 0.07]], s(16)), { bone: 'spine', scl: [d.tw, 1, tz], color: sp.waist || sp.shirt, ol: 0.7 });
  A.add(prim.lathe([[0, hy - 0.052], [0.05, hy - 0.049], [0.073, hy - 0.026], [0.08, hy + 0.01], [0.077, hy + 0.04], [0, hy + 0.05]], s(16)),
    { bone: 'hips', scl: [d.tw * (d.fem ? 1.05 : 1), 1, tz], color: sp.pelvis || sp.thigh });
  // arms
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const x = sx * d.shX;
    const ur = 0.031 * d.lr, fr = 0.028 * d.lr;
    A.add(prim.capsule(ur, Math.max(0.01, d.upper - ur), s(4), s(10)), { bone: 'arm' + side, at: [x, d.shY - d.upper * 0.5, 0], color: sp.upper });
    A.add(prim.capsule(fr, Math.max(0.01, d.fore - fr * 1.4), s(4), s(10)), { bone: 'fore' + side, at: [x, d.shY - d.upper - d.fore * 0.46, 0], color: sp.fore });
    A.add(prim.sphere(s(12), s(9)), { bone: 'hand' + side, at: [x, d.shY - d.upper - d.fore - 0.008, 0.004], scl: [0.034 * d.lr, 0.036 * d.lr, 0.031 * d.lr], color: sp.hand });
  }
  // legs + boots
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const x = sx * d.legX;
    const tr = (d.slim ? 0.037 : 0.041) * d.lr, shr = (d.slim ? 0.032 : 0.035) * d.lr;
    if (!sp.hideThighs) A.add(prim.capsule(tr, Math.max(0.01, d.thigh - tr), s(4), s(10)), { bone: 'thigh' + side, at: [x, d.hipY - 0.01 - d.thigh * 0.5, 0], color: sp.thigh });
    A.add(prim.capsule(shr, Math.max(0.01, d.shin - shr * 1.5), s(4), s(10)), { bone: 'shin' + side, at: [x, d.ankleY + d.shin * 0.5, 0], color: sp.shin || sp.boots });
    const bootTop = sp.bootTall ? d.ankleY + d.shin * 0.95 : d.ankleY + 0.075;
    A.add(prim.cyl(0.92, 1, s(12), false), { bone: 'shin' + side, at: [x, (0.03 + bootTop) / 2, 0], scl: [shr * 1.18, bootTop - 0.03, shr * 1.18], color: sp.boots });
    A.add(prim.torus(0.35, s(6), s(14)), { bone: 'shin' + side, at: [x, bootTop, 0], rot: [Math.PI / 2, 0, 0], scl: [shr * 1.12, shr * 1.12, shr * 1.1], color: shade(sp.boots, 0.18), ol: 0.6 });
    A.add(prim.sphere(s(12), s(8)), { bone: 'foot' + side, at: [x, 0.036, 0.022], scl: [0.044 * d.lr, 0.038, 0.072], color: sp.boots });
    A.add(prim.cyl(1, 1, s(12)), { bone: 'foot' + side, at: [x, 0.008, 0.022], scl: [0.045 * d.lr, 0.016, 0.07], color: shade(sp.boots, -0.45), ol: 0.6 });
    if (sp.greave) {
      A.add(prim.sphere(s(10), s(8)), { bone: 'shin' + side, at: [x, d.ankleY + d.shin * 0.55, 0.018], scl: [shr * 1.25, d.shin * 0.42, shr * 1.05], color: metal(sp.greave) });
      A.add(prim.sphere(s(8), s(6)), { bone: 'shin' + side, at: [x, d.ankleY + d.shin * 0.98, 0.026], scl: [shr * 1.1, 0.028, 0.03], color: metal(sp.greave) });
    }
  }
}

// ------------------------------------------------------------------ outfits
/** Turn look.outfit into a list of colours and garment pieces. */
export function dressSpec(B) {
  const look = B.look, o = B.o, skin = look.skin || 0xf2cfb6;
  const P = o.primary ?? 0x6a7a8a, S = o.secondary ?? 0x3a3a4a, T = o.trim ?? 0xc9a24a;
  const boots = o.boots ?? 0x3a2a1a, belt = o.belt ?? 0x4a3020;
  const sp = {
    shirt: P, upper: P, fore: P, hand: skin, thigh: shade(P, -0.5), boots, belt, buckle: T, trim: T,
    pauldron: o.pauldrons ? 'round' : null, pauldronCol: S,
  };
  const fem = look.gender === 'f';
  switch (o.top) {
    case 'lightArmor':
      Object.assign(sp, { plate: S, plateKind: 'light', fore: S, foreMetal: true, hand: shade(belt, 0.1), thigh: shade(P, -0.55),
        skirt: { col: P, len: fem ? 0.12 : 0.085, flare: fem ? 1.5 : 1.3, trim: T, pleats: fem }, bootTall: fem, pauldronCol: S });
      break;
    case 'heavyArmor':
      Object.assign(sp, { shirt: P, plate: P, plateKind: 'heavy', upper: shade(P, -0.25), fore: P, foreMetal: true, gauntlet: true, hand: shade(P, -0.15),
        thigh: shade(S, -0.45), greave: P, tabard: { col: S, trim: T, len: 0.2 }, skirt: { col: P, len: 0.07, flare: 1.35, trim: T, metal: true },
        pauldron: o.pauldrons ? 'heavy' : null, pauldronCol: P, collar: { col: P, h: 0.035, flare: 1.1, metal: true } });
      break;
    case 'darkArmor':
      Object.assign(sp, { shirt: shade(P, -0.2), plate: P, plateKind: 'dark', upper: shade(S, -0.35), fore: P, foreMetal: true, gauntlet: true, hand: shade(P, -0.1),
        thigh: shade(P, -0.35), greave: P, tabard: { col: S, trim: T, len: 0.21, split: true }, skirt: { col: shade(P, 0.05), len: 0.065, flare: 1.4, trim: T, metal: true },
        pauldron: o.pauldrons ? 'spike' : null, pauldronCol: P, collar: { col: P, h: 0.05, flare: 1.25, metal: true } });
      break;
    case 'robe':
      Object.assign(sp, { shirt: P, waist: P, upper: P, fore: P, bell: P, robe: { col: P, flare: 1.55, trim: T, front: null }, hideThighs: true,
        collar: { col: S, h: 0.02, flare: 1.05 }, rope: true });
      break;
    case 'priestRobe':
      Object.assign(sp, { shirt: P, waist: P, upper: P, fore: P, bell: P, bellTrim: T, robe: { col: P, flare: 1.55, trim: T, front: S }, hideThighs: true,
        collar: { col: S, h: 0.026, flare: 1.15 }, mantle: { col: P, trim: T, len: 0.07 }, sash: S });
      break;
    case 'mageRobe':
      Object.assign(sp, { shirt: P, waist: shade(S, 0.1), upper: P, fore: P, bell: P, bellTrim: T, thigh: S,
        skirt: { col: P, len: 0.17, flare: 1.75, trim: T, under: S, split: true }, mantle: { col: P, trim: T, len: 0.065, points: 6 },
        collar: { col: S, h: 0.04, flare: 1.3 } });
      break;
    case 'cultistRobe':
      Object.assign(sp, { shirt: P, waist: P, upper: P, fore: P, bell: P, bellTrim: T, robe: { col: P, flare: 1.7, trim: T, front: S, jag: true }, hideThighs: true,
        mantle: { col: S, trim: T, len: 0.085, points: 7 }, sash: T });
      break;
    case 'regalRobe':
      Object.assign(sp, { shirt: P, waist: P, upper: P, fore: P, bell: P, bellTrim: T, robe: { col: P, flare: 1.85, trim: T, front: S, train: true }, hideThighs: true,
        collar: { col: S, h: 0.085, flare: 1.9, trim: T, open: true }, pauldron: 'regal', pauldronCol: T, sash: null });
      break;
    case 'leather':
      Object.assign(sp, { shirt: S, upper: S, fore: P, bracer: true, hand: shade(belt, 0.1), thigh: shade(P, -0.42), vest: { col: P, trim: T },
        skirt: { col: P, len: 0.075, flare: 1.3, trim: T, split: true }, strap: belt, bootTall: fem });
      break;
    case 'rogueGarb':
      Object.assign(sp, { shirt: P, upper: S, fore: S, wrap: T, hand: S, thigh: S, pelvis: P,
        skirt: { col: P, len: 0.06, flare: 1.35, trim: T, split: true }, strap: T, sash: S, bootTall: true });
      break;
    case 'furVest':
      Object.assign(sp, { shirt: shade(S, -0.15), upper: skin, fore: skin, bracer: true, bracerCol: belt, hand: skin, thigh: shade(S, -0.1),
        vest: { col: P, trim: T, open: true }, fur: shade(P, 0.42), skirt: { col: P, len: 0.07, flare: 1.35, trim: shade(P, 0.35), split: true },
        pauldron: o.pauldrons ? 'fur' : null, pauldronCol: shade(P, 0.42) });
      break;
    case 'tunic':
    default:
      Object.assign(sp, { thigh: S, skirt: { col: P, len: 0.08, flare: 1.3, trim: T } });
  }
  if (o.top === 'regalRobe' || o.top === 'priestRobe') sp.hand = skin;
  return sp;
}

/** Lathe with optional radial ripple (pleats / scallops), jagged or trailing hems and a front opening. */
function latheFx(key, profile, seg, { ripple = 0, rippleN = 12, jag = 0, jagN = 9, trainZ = 0, open = 0 } = {}) {
  const k = `lfx${key}/${seg}/${ripple}/${rippleN}/${jag}/${jagN}/${trainZ}/${open}/${profile.map((p) => p.join(',')).join(';')}`;
  return cachedGeo(k, () => {
    const g = prim.lathe(profile, seg, open, Math.PI * 2 - open * 2).clone();
    const pos = g.attributes.position;
    const yTop = profile[profile.length - 1][1], yBot = profile[0][1];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-5) continue;
      const phi = Math.atan2(x, z);
      const down = clamp((yTop - y) / Math.max(1e-5, yTop - yBot), 0, 1);
      const kk = 1 + ripple * Math.sin(phi * rippleN) * down;
      let ny = y, nx = x * kk, nz = z * kk;
      if (jag && down > 0.9) ny += jag * (0.5 + 0.5 * Math.cos(phi * jagN)) * (yTop - yBot);
      if (trainZ && z < 0) { const b = (-z / r) * down * down; nz -= trainZ * b; ny -= trainZ * 0.2 * b; }
      pos.setXYZ(i, nx, ny, nz);
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    return g;
  });
}

function ringAt(A, bone, y, rx, rz, thick, col, ol = 0.7, seg = 18, tube = 0.2) {
  A.add(prim.torus(tube, 6, seg), { bone, at: [0, y, 0], rot: [-Math.PI / 2, 0, 0], scl: [rx, rz, thick / tube], color: col, ol });
}

/** Armour shells, skirts, robes, tabards, collars, mantles, belts and other garments. */
export function addDress(B, A, sp) {
  const d = B.d, R = A.def, s = (n) => B.seg(n), look = B.look, o = B.o;
  const cy = d.chestY, wy = d.waistY, tz = d.td * 0.8;
  const T = sp.trim;
  if (sp.plate) {
    const k = sp.plateKind === 'light' ? 1.09 : 1.15;
    const top = sp.plateKind === 'light' ? cy + 0.098 : cy + 0.105;
    const prof = [[0.083, cy - 0.04], [0.093, cy - 0.01], [0.1, cy + 0.03], [0.1, cy + 0.066], [0.09, cy + 0.09], [0.074, top]].map(([r, y]) => [r * k + 0.004, y]);
    A.add(prim.lathe(prof, s(18)), { bone: 'chest', scl: [d.tw, 1, tz * 1.04], color: metal(sp.plate) });
    ringAt(A, 'chest', cy - 0.04, (0.083 * k + 0.005) * d.tw, (0.083 * k + 0.005) * tz * 1.04, 0.011, T, 0.5);
    ringAt(A, 'chest', top, (0.074 * k + 0.004) * d.tw, (0.074 * k + 0.004) * tz * 1.04, 0.009, T, 0.5);
    if (sp.plateKind !== 'light') {
      for (let i = 0; i < 2; i++) {
        const y = wy + 0.045 - i * 0.03;
        A.add(prim.lathe([[0.083, y - 0.018], [0.089, y], [0.085, y + 0.016]], s(18)), { bone: 'spine', scl: [d.tw * 1.06, 1, tz * 1.1], color: metal(shade(sp.plate, -0.08)), ol: 0.6 });
      }
    }
    if (sp.plateKind === 'dark') {
      A.add(prim.rbox(0.3, 1), { bone: 'chest', at: [0, cy + 0.03, 0.099 * tz * k + 0.002], scl: [0.016, 0.11, 0.012], color: metal(shade(sp.plate, 0.15)), ol: 0.5 });
    }
  }
  if (sp.vest) {
    const open = sp.vest.open ? 0.5 : 0.18;
    const prof = [[0.086, wy + 0.0], [0.094, cy - 0.01], [0.103, cy + 0.03], [0.102, cy + 0.07], [0.09, cy + 0.095], [0.07, cy + 0.107]];
    A.add(latheFx(`vest${open}`, prof, s(18), { open }), { bone: 'chest', scl: [d.tw, 1, tz * 1.05], color: sp.vest.col });
  }
  if (sp.collar) {
    const c = sp.collar, ny = d.neckY;
    const prof = [[0.05, ny - 0.03], [0.055, ny - 0.006], [0.05 * c.flare + 0.008, ny + c.h]];
    const geo = c.open ? latheFx('collarOpen', prof, s(18), { open: 0.75 }) : prim.lathe(prof, s(18));
    A.add(geo, { bone: 'chest', scl: [d.tw * 1.05, 1, tz * 1.12], color: c.metal ? metal(c.col) : c.col, ol: 0.8 });
    if (c.trim) A.add(c.open ? latheFx('collarOpenT', [[0.05 * c.flare + 0.006, ny + c.h - 0.004], [0.05 * c.flare + 0.011, ny + c.h + 0.004]], s(18), { open: 0.75 })
      : prim.lathe([[0.05 * c.flare + 0.006, ny + c.h - 0.004], [0.05 * c.flare + 0.011, ny + c.h + 0.004]], s(18)), { bone: 'chest', scl: [d.tw * 1.05, 1, tz * 1.12], color: c.trim, ol: 0 });
  }
  if (sp.mantle) {
    const m = sp.mantle, ny = d.neckY;
    const bot = d.shY - m.len;
    const prof = [[0.13 * d.tw + 0.01, bot], [0.12 * d.tw + 0.008, bot + 0.02], [0.095 * d.tw, ny - 0.028], [0.058, ny - 0.006]];
    const geo = latheFx(`mantle${m.points || 0}`, prof, s(20), { jag: m.points ? 0.35 : 0, jagN: m.points || 9 });
    A.add(geo, { bone: 'chest', scl: [1, 1, tz * 1.2], color: m.col });
    if (!m.points) ringAt(A, 'chest', bot + 0.002, 0.13 * d.tw + 0.012, (0.13 * d.tw + 0.012) * tz * 1.06, 0.01, m.trim, 0.5);
  }
  if (sp.strap) {
    A.add(prim.torus(0.16, 6, s(20)), { bone: 'chest', at: [0, cy + 0.03, 0], rot: [-Math.PI / 2, 0.62, 0], scl: [0.104 * d.tw, 0.104 * tz * 1.02, 0.08], color: sp.strap, ol: 0.5 });
  }
  if (sp.fur) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.2;
      const r = 0.075 * d.tw;
      A.add(prim.sphere(s(9), s(7)), { bone: 'chest', at: [Math.sin(a) * r * 1.15, d.neckY - 0.03 + (i % 2) * 0.008, Math.cos(a) * r * 0.95 * tz / 0.8], scl: [0.05, 0.036, 0.046].map((v) => v * (0.9 + 0.25 * B.rng())), color: sp.fur, ol: 0.7 });
    }
  }
  const top = wy - 0.006;
  if (sp.skirt) {
    const k = sp.skirt, r0 = 0.083 * d.tw, r1 = r0 * k.flare, y1 = top - k.len;
    const sw = skirtWeights(R, d, k.len + 0.02);
    if (k.under) {
      const u = latheFx('under', [[r1 * 1.02, y1 - 0.03], [r0 * 0.98, top]], s(20), {});
      A.add(u, { bone: 'hips', w: sw, scl: [1, 1, tz / 0.8 * 0.92], color: k.under });
    }
    const prof = [[r1, y1], [r1 * 0.93, y1 + k.len * 0.35], [r0, top]];
    const geo = latheFx(`skirt${k.pleats ? 'p' : ''}`, prof, s(24), { ripple: k.pleats ? 0.05 : 0.0, rippleN: 14 });
    A.add(geo, { bone: 'hips', w: sw, scl: [1, 1, tz / 0.8 * 0.92], color: k.metal ? metal(k.col) : k.col });
    if (k.trim) A.add(latheFx('skirtTrim', [[r1 + 0.002, y1 - 0.002], [r1 * 0.985 + 0.002, y1 + 0.012]], s(24), {}), { bone: 'hips', w: sw, scl: [1, 1, tz / 0.8 * 0.92], color: k.trim, ol: 0 });
  }
  if (sp.robe) {
    const k = sp.robe, r0 = 0.084 * d.tw, hemY = 0.055, r1 = 0.095 * k.flare * (d.heavy ? 1.15 : 1);
    const len = top - hemY;
    const sw = skirtWeights(R, d, len, 0.55);
    const prof = [[r1, hemY], [r1 * 0.9, hemY + len * 0.3], [r0 * 1.08, hemY + len * 0.75], [r0, top]];
    const opts = { jag: k.jag ? 0.06 : 0, jagN: 11, trainZ: k.train ? 0.06 : 0, ripple: 0.012, rippleN: 9 };
    A.add(latheFx('robe', prof, s(26), opts), { bone: 'hips', w: sw, scl: [1, 1, tz / 0.8 * 0.9], color: k.col });
    A.add(latheFx('robeTrim', [[r1 + 0.003, hemY - 0.002], [r1 * 0.97 + 0.003, hemY + 0.016]], s(26), { jag: k.jag ? 0.6 : 0, jagN: 11, trainZ: k.train ? 0.06 : 0 }),
      { bone: 'hips', w: sw, scl: [1, 1, tz / 0.8 * 0.9], color: k.trim, ol: 0 });
    if (k.front) {
      const zf = (y) => { const t = clamp((top - y) / len, 0, 1); return (r0 + (r1 - r0) * Math.pow(t, 1.3)) * tz / 0.8 * 0.9 * 1.02 + 0.007; };
      const rows = [];
      for (let i = 0; i <= 6; i++) {
        const y = top + 0.01 - (len + 0.004) * (i / 6);
        const w = 0.026 + 0.022 * (i / 6);
        rows.push([[-w, y, zf(y) - 0.004], [0, y, zf(y) + 0.003], [w, y, zf(y) - 0.004]]);
      }
      A.add(stripGeo(`robeFront${d.tw}${r1}`, rows, 0.006, [0, 0, 1]), { bone: 'hips', w: sw, color: k.front, ol: 0.5 });
    }
  }
  if (sp.tabard) {
    const k = sp.tabard, sw = skirtWeights(R, d, k.len + 0.03, 0.5);
    for (const zs of [1, -1]) {
      const z0 = (0.083 * d.tw * tz / 0.8 * 0.95 + 0.012) * zs;
      const rows = [];
      for (let i = 0; i <= 4; i++) {
        const y = top + 0.012 - k.len * (i / 4), w = 0.05 * d.tw + 0.008 * (i / 4);
        const z = z0 + zs * (0.02 * (i / 4));
        rows.push([[-w, y, z], [0, y, z + zs * 0.004], [w, y, z]]);
      }
      A.add(stripGeo(`tabard${zs}${d.tw}${k.len}${tz}`, rows, 0.008, [0, 0, zs]), { bone: 'hips', w: sw, color: k.col, ol: 0.8 });
      const yb = top + 0.012 - k.len;
      A.add(prim.box(), { bone: 'hips', w: sw, at: [0, yb + 0.004, z0 + zs * 0.022], scl: [0.11 * d.tw, 0.012, 0.012], color: k.trim, ol: 0.4, hard: true });
    }
  }
  // belt or sash with buckle and a small team-colour gem
  const bz = 0.082 * tz / 0.8 * 0.95 * (sp.plate && sp.plateKind !== 'light' ? 1.12 : 1);
  ringAt(A, 'spine', top + 0.004, 0.083 * d.tw * (sp.plate && sp.plateKind !== 'light' ? 1.1 : 1.03), bz + 0.004, sp.sash ? 0.03 : 0.02, sp.sash || sp.belt, 0.7);
  if (!sp.sash && !sp.rope) {
    A.add(prim.rbox(0.25, 1), { bone: 'spine', at: [0, top + 0.004, bz + 0.012], scl: [0.034, 0.028, 0.012], color: metal(sp.buckle), ol: 0.6 });
  }
  A.add(prim.octa(), { bone: 'spine', at: [0, top + 0.004, bz + 0.02], scl: [0.008, 0.01, 0.006], color: B.teamColor, ol: 0 });
  if (sp.sash || sp.rope) {
    const col = sp.sash || sp.belt;
    for (const [dx, len] of [[0.025, 0.09], [0.045, 0.07]]) {
      const rows = [];
      for (let i = 0; i <= 4; i++) { const y = top - len * (i / 4); rows.push([[dx - 0.012, y, bz + 0.012], [dx + 0.012, y, bz + 0.012 + 0.006 * (i / 4)]]); }
      A.add(stripGeo(`sashEnd${dx}${len}${bz}`, rows, 0.007, [0, 0, 1]), { bone: 'hips', w: skirtWeights(R, d, 0.1, 0.4), color: shade(col, -0.05), ol: 0.5 });
    }
  }
  // sleeves and cuffs
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const x = sx * d.shX, fy = d.shY - d.upper, hy = fy - d.fore;
    if (sp.bell) {
      A.add(prim.cyl(1.0, 1.55, s(14), false), { bone: 'fore' + side, at: [x, fy - d.fore * 0.5, 0], scl: [0.031 * d.lr, d.fore * 0.95, 0.031 * d.lr], color: sp.bell });
      if (sp.bellTrim) A.add(prim.torus(0.2, 5, s(14)), { bone: 'fore' + side, at: [x, hy + d.fore * 0.03, 0], rot: [Math.PI / 2, 0, 0], scl: [0.047 * d.lr, 0.047 * d.lr, 0.04], color: sp.bellTrim, ol: 0.4 });
    } else if (sp.gauntlet) {
      A.add(prim.cyl(1.25, 0.95, s(12), false), { bone: 'fore' + side, at: [x, hy + 0.035, 0], scl: [0.033 * d.lr, 0.05, 0.033 * d.lr], color: metal(sp.fore), ol: 0.8 });
    } else if (sp.bracer) {
      A.add(prim.cyl(1.1, 1.0, s(12), false), { bone: 'fore' + side, at: [x, hy + 0.03, 0], scl: [0.031 * d.lr, 0.045, 0.031 * d.lr], color: sp.bracerCol || shade(sp.fore, -0.2), ol: 0.7 });
    } else if (sp.wrap) {
      for (let i = 0; i < 3; i++) ringAt(A, 'fore' + side, hy + 0.02 + i * 0.022, 0.03 * d.lr, 0.03 * d.lr, 0.008, sp.wrap, 0, 12, 0.25);
    }
    if (sp.foreMetal && !sp.gauntlet && !sp.bell) {
      A.add(prim.cyl(1.12, 0.98, s(12), false), { bone: 'fore' + side, at: [x, hy + 0.034, 0], scl: [0.031 * d.lr, 0.046, 0.031 * d.lr], color: metal(sp.fore), ol: 0.7 });
    }
  }
  addPauldrons(B, A, sp);
  if (o.crest) addCrest(B, A, sp, bz);
}

function addPauldrons(B, A, sp) {
  if (!sp.pauldron) return;
  const d = B.d, R = A.def, s = (n) => B.seg(n), kind = sp.pauldron, col = sp.pauldronCol, T = sp.trim;
  const ch = R.idx('chest');
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const arm = R.idx('arm' + side);
    const w = () => [[ch, 0.4], [arm, 0.6]];
    const x = sx * (d.shX + 0.004), y = d.shY + 0.012;
    const big = kind === 'heavy' || kind === 'spike' ? 1.3 : kind === 'regal' ? 1.25 : 1;
    const half = prim.sphereCut(s(14), s(8), 0, Math.PI * 2, 0, Math.PI * 0.55);
    if (kind === 'fur') {
      for (let i = 0; i < 3; i++) A.add(prim.sphere(s(9), s(7)), { bone: 'chest', w, at: [x + sx * 0.012 * i, y - 0.004 * i, (i - 1) * 0.03], scl: [0.04, 0.034, 0.04], color: col, ol: 0.7 });
      continue;
    }
    A.add(half, { bone: 'chest', w, at: [x, y - 0.012, 0], rot: [0, 0, -sx * 0.35], scl: [0.055 * big, 0.05 * big, 0.06 * big], color: metal(col) });
    A.add(prim.torus(0.12, 5, s(16)), { bone: 'chest', w, at: [x + sx * 0.008, y - 0.022 * big + 0.004, 0], rot: [-Math.PI / 2, 0, -sx * 0.35], scl: [0.055 * big, 0.06 * big, 0.07], color: T, ol: 0.4 });
    if (kind === 'heavy' || kind === 'spike') {
      A.add(half, { bone: 'chest', w, at: [x + sx * 0.022, y - 0.045, 0], rot: [0, 0, -sx * 0.6], scl: [0.05, 0.035, 0.062], color: metal(shade(col, -0.08)), ol: 0.8 });
    }
    if (kind === 'spike') {
      for (const dz of [-0.022, 0.018]) {
        A.add(prim.cone(s(8)), { bone: 'chest', w, at: [x + sx * 0.03, y + 0.045, dz], rot: [0, 0, -sx * 0.55], scl: [0.013, 0.06, 0.013], color: metal(shade(col, 0.1)), ol: 0.7 });
      }
    }
    if (kind === 'regal') {
      A.add(prim.cone(s(10)), { bone: 'chest', w, at: [x + sx * 0.035, y + 0.018, 0], rot: [0, 0, -sx * 1.25], scl: [0.04, 0.05, 0.05], color: metal(col), ol: 0.8 });
    }
  }
}

function addCrest(B, A, sp, bz) {
  const d = B.d, o = B.o, cy = d.chestY, z = (sp.plate ? 0.1 * 1.1 + 0.006 : 0.098) * d.td * 0.8 * 1.02 + 0.006;
  if (o.crest === 'dragon') {
    const pts = [[0, 0.03], [0.012, 0.012], [0.032, 0.022], [0.022, 0.0], [0.03, -0.014], [0.01, -0.01], [0, -0.032], [-0.01, -0.01], [-0.03, -0.014], [-0.022, 0.0], [-0.032, 0.022], [-0.012, 0.012]];
    A.add(prim.slab('crestDragon', pts, 0.008, 0.002), { bone: 'chest', at: [0, cy + 0.045, z], scl: [1.05, 1.05, 1], color: metal(shade(sp.trim, 0.1)), ol: 0.5 });
    A.add(prim.sphere(8, 6), { bone: 'chest', layer: 'glow', at: [0, cy + 0.044, z + 0.006], scl: [0.009, 0.011, 0.006], color: 0xff7a2a, glow: 2.6 });
  } else if (o.crest === 'obsidian') {
    const pts = [[0, 0.034], [0.024, 0.006], [0.012, -0.03], [0, -0.02], [-0.012, -0.03], [-0.024, 0.006]];
    A.add(prim.slab('crestObs', pts, 0.008, 0.002), { bone: 'chest', at: [0, cy + 0.045, z], color: 0x1a1420, ol: 0.5 });
    A.add(prim.octa(), { bone: 'chest', layer: 'glow', at: [0, cy + 0.048, z + 0.006], scl: [0.008, 0.012, 0.005], color: 0xff2a3a, glow: 2.2 });
  }
}

// ------------------------------------------------------------------ hair
const _hn = new THREE.Vector3(), _hd = new THREE.Vector3(), _hs = new THREE.Vector3(), _hx = new THREE.Vector3();
const _hy = new THREE.Vector3(), _hz = new THREE.Vector3();

/** Tapered, flattened hair lock extending along local -Y; bend > 0 curls the tip outward (+Z). */
function lockGeo(len, w, t, bend = 0, curl = 0, q = 1) {
  const L = Math.round(len * 200) / 200, W = Math.round(w * 400) / 400, Tt = Math.round(t * 400) / 400;
  const Bd = Math.round(bend * 20) / 20, Cu = Math.round(curl * 20) / 20;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    pts.push([0, -L * u, Bd * L * u * u + Cu * L * Math.pow(u, 4)]);
  }
  return sweepGeo(`lock${L}/${W}/${Tt}/${Bd}/${Cu}`, pts, (u) => {
    const taper = u < 0.12 ? 0.75 + 0.25 * (u / 0.12) : Math.pow(1 - (u - 0.12) / 0.88, 0.85);
    return [W * taper, Tt * taper];
  }, { seg: Math.max(4, Math.round(7 * q)), radial: Math.max(4, Math.round(5 * q)), side: [1, 0, 0] });
}

/**
 * Matrix placing a lock root on the scalp at azimuth `az` (0 = front, +90 = character's left) and
 * polar angle `el` (0 = crown), flowing down the surface, swept sideways by `sweep` and lifted
 * away from the head by `lift` (degrees).
 */
function lockMatrix(d, az, el, { sweep = 0, lift = 0, k = 1.03, twist = 0, dy = 0, dir = null } = {}) {
  const a = az * D2R, e = el * D2R;
  _hn.set(Math.sin(e) * Math.sin(a), Math.cos(e), Math.sin(e) * Math.cos(a));
  const pos = new THREE.Vector3(_hn.x * d.headR * d.headS[0] * k, d.headY + dy + _hn.y * d.headR * d.headS[1] * k, _hn.z * d.headR * d.headS[2] * k);
  _hd.set(Math.cos(e) * Math.sin(a), -Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
  _hs.crossVectors(_hn, _hd).normalize();
  const sw = sweep * D2R, lf = lift * D2R;
  let flow;
  if (dir) {
    flow = _hn.clone().multiplyScalar(dir[0]).add(new THREE.Vector3(0, dir[1], -dir[2])).normalize();
  } else {
    flow = _hd.clone().multiplyScalar(Math.cos(sw)).addScaledVector(_hs, Math.sin(sw)).normalize();
    flow.multiplyScalar(Math.cos(lf)).addScaledVector(_hn, Math.sin(lf)).normalize();
  }
  _hy.copy(flow).negate();
  _hz.copy(_hn).addScaledVector(flow, -_hn.dot(flow));
  if (_hz.lengthSq() < 1e-6) _hz.set(0, 0, 1).addScaledVector(flow, -flow.z);
  _hz.normalize();
  _hx.crossVectors(_hy, _hz).normalize();
  const m = new THREE.Matrix4().makeBasis(_hx, _hy, _hz);
  if (twist) m.multiply(new THREE.Matrix4().makeRotationY(twist * D2R));
  m.setPosition(pos);
  return m;
}

/** Hair chain bone positions for styles that sway. */
export function hairChains(look, d) {
  const st = look.hair ? look.hair.style : 'short';
  const hy = d.headY;
  if (st === 'long' || st === 'wild') return { hairA: [[0, hy - 0.08, -0.19], [0, hy - 0.24, -0.21], [0, hy - 0.38, -0.21]] };
  if (st === 'braid') return { hairA: [[0, hy - 0.08, -0.18], [0, hy - 0.2, -0.2], [0, hy - 0.32, -0.19]] };
  if (st === 'ponytail') {
    const y0 = ponyY(look, d);
    return { hairA: [[0, y0, -0.2], [0, y0 - 0.12, -0.28], [0, y0 - 0.26, -0.27]] };
  }
  if (st === 'twintails') {
    return {
      hairA: [[0.2, hy + 0.08, -0.07], [0.31, hy - 0.06, -0.09], [0.31, hy - 0.26, -0.08]],
      hairB: [[-0.2, hy + 0.08, -0.07], [-0.31, hy - 0.06, -0.09], [-0.31, hy - 0.26, -0.08]],
    };
  }
  return {};
}
const ponyY = (look, d) => (look.gender === 'f' ? d.headY + 0.07 : d.headY - 0.05);

const lockTaper = (w, t, tipStart = 0.78, bulge = 0) => (u) => {
  const root = u < 0.1 ? 0.8 + 2 * u : 1;
  const tip = u > tipStart ? Math.max(0, 1 - (u - tipStart) / (1 - tipStart)) : 1;
  const b = 1 + bulge * Math.sin(Math.min(1, u / 0.8) * Math.PI);
  const k = root * Math.pow(tip, 0.8) * b;
  return [w * k, t * k];
};

/** Lock following the scalp from polar angle el0 to elEnd, then falling under gravity. */
function hangLockGeo(d, az, el0, len, w, t, { elEnd = 100, flare = 0.05, back = 0, q = 1, k = 1.045 } = {}) {
  const a = az * D2R, sa = Math.sin(a), ca = Math.cos(a);
  const rx = d.headR * d.headS[0] * k, ry = d.headR * d.headS[1] * k, rz = d.headR * d.headS[2] * k;
  const pts = [];
  const e1 = Math.max(el0 + 8, elEnd);
  for (let i = 0; i <= 3; i++) {
    const e = (el0 + (e1 - el0) * (i / 3)) * D2R;
    pts.push([sa * Math.sin(e) * rx, d.headY + Math.cos(e) * ry, ca * Math.sin(e) * rz]);
  }
  const arc = d.headR * k * (e1 - el0) * D2R;
  const rest = Math.max(0.03, len - arc);
  const last = pts[3];
  for (let i = 1; i <= 3; i++) {
    const u = i / 3;
    pts.push([last[0] + sa * flare * u, last[1] - rest * u, last[2] + ca * flare * u - back * u]);
  }
  const key = `hang${az}/${el0}/${e1}/${len}/${w}/${t}/${flare}/${back}/${k}/${d.headY.toFixed(3)}`;
  return sweepGeo(key, pts, lockTaper(w, t, 0.8), { seg: Math.max(6, Math.round(11 * q)), radial: Math.max(4, Math.round(5 * q)), side: [ca, 0, -sa] });
}

/** Free-form lock through model-space points (twin-tails, ponytails). */
function pathLockGeo(key, pts, w, t, { side = [0, 0, 1], bulge = 0.35, tipStart = 0.7, q = 1 } = {}) {
  return sweepGeo(`path${key}`, pts, lockTaper(w, t, tipStart, bulge), { seg: Math.max(6, Math.round(12 * q)), radial: Math.max(5, Math.round(7 * q)), side });
}

function headgearFlags(look) {
  const hg = look.headgear;
  const f = { hideTop: false, hideCap: false, hideBack: false, hideBangs: false, hideTails: false, hideSide: false };
  if (hg === 'hood') Object.assign(f, { hideTop: true, hideCap: true, hideBack: true, hideTails: true });
  else if (hg === 'helmOpen' || hg === 'plumedHelm') Object.assign(f, { hideTop: true, hideCap: true, hideSide: true });
  else if (hg === 'helmClosed') Object.assign(f, { hideTop: true, hideCap: true, hideBack: true, hideBangs: true, hideSide: true });
  else if (hg === 'witchHat' || hg === 'cap') f.hideTop = true;
  return f;
}

/** Builds the hairstyle from a scalp cap plus many tapered locks / spikes. */
export function addHair(B, A) {
  const look = B.look, d = B.d, h = look.hair || { style: 'short', color: 0x553322 }, st = h.style;
  const f = headgearFlags(look);
  const R = A.def, s = (n) => B.seg(n), rnd = B.rng;
  const col = hairFn(look);
  const tipCol = hairFn(look, d.headY - 0.12);
  const lock = (az, el, len, w, t, o = {}) => {
    const m = lockMatrix(d, az, el, o);
    A.add(lockGeo(len, w, t, o.bend ?? -0.3, o.curl ?? 0, B.q), { bone: 'head', m, color: o.color || col, w: o.w, ol: o.ol ?? 0.85 });
  };
  const bangs = (n, spread, len, o = {}) => {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      const az = (o.az0 ?? 0) - spread + 2 * spread * u;
      const edge = Math.abs(u - 0.5) * 2;
      const L = len * (o.blunt ? 1 : (0.84 + 0.28 * edge) * (0.92 + 0.16 * rnd()));
      lock(az, o.el ?? 30, L, o.w ?? 0.078, o.t ?? 0.03, { sweep: (o.sweep ?? 0) + (u - 0.5) * (o.fan ?? 26), lift: o.lift ?? 3, bend: o.bend ?? -0.45, k: 1.04, color: o.color });
    }
  };
  const ring = (az0, az1, n, el, len, o = {}) => {
    for (let i = 0; i < n; i++) {
      const az = az0 + (az1 - az0) * (n === 1 ? 0.5 : i / (n - 1));
      lock(az, el, len * (0.9 + 0.2 * rnd()), o.w ?? 0.09, o.t ?? 0.03, { sweep: (o.sweep ?? 0) + (rnd() - 0.5) * (o.jitter ?? 10), lift: o.lift ?? 4, bend: o.bend ?? -0.25, curl: o.curl ?? 0, k: o.k ?? 1.035, w: o.w2, color: o.color });
    }
  };
  if (st !== 'bald' && st !== 'mohawk' && !f.hideCap) {
    const cut = prim.sphereCut(s(22), s(12), 0, Math.PI * 2, 0, (st === 'slick' ? 92 : 96) * D2R);
    A.add(cut, { bone: 'head', at: [0, d.headY + 0.004, -0.008], rot: [-(st === 'slick' ? 30 : 25) * D2R, 0, 0], scl: [d.headR * 1.05, d.headR * d.headS[1] * 1.05, d.headR * d.headS[2] * 1.05], color: col, ol: 0.9 });
  }
  const chainW = (names) => chainWeightsAxis(R, names, [0, -1, 0]);
  const headI = R.idx('head');
  const scalpBlend = (names, band = 0.09) => {
    const base = chainW(names);
    const y0 = R.pos[R.idx(names[0])].y;
    return (p) => {
      if (p.y >= y0 + band * 0.3) return [[headI, 1]];
      const w = base(p);
      if (p.y > y0 - band) {
        const k = clamp((y0 + band * 0.3 - p.y) / (band * 1.3), 0, 1);
        return [[headI, 1 - k], ...w.map(([b, ww]) => [b, ww * k])];
      }
      return w;
    };
  };
  const longW = R.has('hairA0') ? scalpBlend(['hairA0', 'hairA1', 'hairA2']) : undefined;
  switch (st) {
    case 'spiky': {
      if (!f.hideBangs) bangs(5, 40, 0.16, { lift: 8, bend: -0.3, fan: 34 });
      if (!f.hideSide) for (const sx of [-1, 1]) lock(sx * 60, 42, 0.24, 0.07, 0.028, { sweep: -sx * 8, lift: 6, bend: -0.25 });
      if (!f.hideTop) {
        const spikes = [
          [180, 16, 0.25, 0.1, 0.25, 0.8, 0.7], [145, 28, 0.23, 0.095, 0.5, 0.6, 0.7], [215, 28, 0.23, 0.095, 0.5, 0.6, 0.7],
          [180, 44, 0.23, 0.1, 0.5, 0.35, 0.9], [118, 50, 0.19, 0.085, 0.85, 0.3, 0.55], [242, 50, 0.19, 0.085, 0.85, 0.3, 0.55],
          [152, 66, 0.19, 0.09, 0.6, 0.05, 0.9], [208, 66, 0.19, 0.09, 0.6, 0.05, 0.9], [180, 82, 0.17, 0.085, 0.5, -0.25, 0.9],
          [72, 30, 0.17, 0.08, 0.7, 0.55, 0.45], [288, 30, 0.17, 0.08, 0.7, 0.55, 0.45], [28, 12, 0.16, 0.085, 0.3, 0.9, 0.5], [332, 12, 0.16, 0.085, 0.3, 0.9, 0.5],
        ];
        for (const [az, el, len, wd, o, u, b] of spikes) lock(az, el, len, wd, 0.045, { dir: [o, u, b], bend: 0.28, k: 0.99, color: tipCol });
        lock(0, 4, 0.14, 0.032, 0.016, { dir: [0, 1, -0.15], bend: 1.1, curl: 0.5, k: 1.02 });
      } else if (!f.hideBack) ring(120, 240, 5, 70, 0.13);
      break;
    }
    case 'long': {
      const swept = look.age === 'elder';
      const hang = (az, el0, len, w, t, o = {}) => A.add(hangLockGeo(d, az, el0, len, w, t, { q: B.q, ...o }), { bone: 'head', color: o.color || tipCol, w: o.w, ol: 0.85 });
      if (!f.hideBangs && !swept) bangs(6, 44, 0.165, { blunt: look.gender === 'f', fan: 14, lift: 2 });
      if (swept && !f.hideTop) ring(-60, 60, 5, 14, 0.2, { sweep: 0, lift: 6, bend: -0.6, w: 0.09 });
      if (!f.hideSide) for (const sx of [-1, 1]) {
        hang(sx * 62, 40, f.hideTop ? 0.34 : 0.4, 0.06, 0.026, { elEnd: 96, flare: 0.03 });
        hang(sx * 80, 46, f.hideTop ? 0.36 : 0.44, 0.07, 0.028, { elEnd: 98, flare: 0.05 });
      }
      if (!f.hideBack) {
        ring(100, 260, 7, 50, 0.15, { bend: -0.3 });
        for (let i = 0; i < 7; i++) {
          const az = 116 + i * 21.3;
          hang(az, 52, 0.56 + 0.03 * Math.sin(i * 2.1), 0.085, 0.032, { elEnd: 104, flare: 0.04, back: 0.03, w: longW });
        }
      }
      break;
    }
    case 'bob': {
      if (!f.hideBangs) bangs(6, 46, 0.165, { sweep: -14, fan: 30, lift: 4 });
      if (!f.hideBack) {
        ring(62, 298, 10, 48, 0.2, { bend: -0.18, curl: -0.25, w: 0.095, lift: 6, jitter: 16, sweep: 0 });
        lock(-70, 56, 0.2, 0.06, 0.03, { bend: -0.15, sweep: -10, lift: 12 });
      }
      if (!f.hideSide) {
        for (let i = 0; i < 6; i++) {
          A.add(prim.sphere(s(8), s(6)), { bone: 'head', at: [-d.headR * 0.98, d.headY - 0.03 - i * 0.03, 0.05 - i * 0.004], scl: [0.016, 0.02, 0.016], color: i % 2 ? shade(h.color, -0.12) : h.color, ol: 0.5 });
        }
      }
      break;
    }
    case 'ponytail': {
      if (!f.hideBangs) bangs(5, 40, 0.15, { fan: 24 });
      if (!f.hideSide) for (const sx of [-1, 1]) lock(sx * 72, 48, 0.2, 0.07, 0.026, { bend: -0.2 });
      if (!f.hideBack) ring(110, 250, 5, 52, 0.13, { bend: -0.35 });
      const y0 = ponyY(look, d);
      A.add(prim.torus(0.35, 6, s(12)), { bone: 'head', at: [0, y0, -0.19], rot: [0.5, 0, 0], scl: [0.03, 0.03, 0.026], color: look.outfit?.trim ?? 0x8a3a2a, ol: 0.6 });
      const wts = chainW(['hairA0', 'hairA1', 'hairA2']);
      for (const [dx, wid] of [[0, 0.055], [0.022, 0.04], [-0.022, 0.04]]) {
        const pts = [[dx * 0.5, y0 + 0.01, -0.19], [dx, y0 - 0.01, -0.25], [dx * 1.2, y0 - 0.12, -0.29], [dx, y0 - 0.25, -0.28], [dx * 0.6, y0 - 0.36, -0.25]];
        A.add(pathLockGeo(`pony${dx}/${y0.toFixed(3)}/${wid}`, pts, wid, wid * 0.8, { q: B.q, side: [1, 0, 0] }), { bone: 'head', color: tipCol, w: wts, ol: 0.85 });
      }
      break;
    }
    case 'twintails': {
      if (!f.hideBangs) bangs(7, 46, 0.15, { blunt: true, fan: 10, lift: 2 });
      if (!f.hideSide) for (const sx of [-1, 1]) lock(sx * 74, 50, 0.19, 0.065, 0.026, { bend: -0.15 });
      if (!f.hideBack) ring(110, 250, 5, 55, 0.15, { bend: -0.32 });
      const hy = d.headY;
      for (const [sx, ch] of [[1, 'A'], [-1, 'B']]) {
        const wts = chainW([`hair${ch}0`, `hair${ch}1`, `hair${ch}2`]);
        for (const [dz, dx, wid, drop] of [[0, 0, 0.068, 0], [0.03, -0.012, 0.045, 0.04], [-0.03, 0.01, 0.048, 0.02]]) {
          const pts = [[sx * 0.15, hy + 0.09, -0.06 + dz * 0.5], [sx * (0.24 + dx), hy + 0.08, -0.08 + dz], [sx * (0.31 + dx), hy - 0.04, -0.09 + dz],
            [sx * (0.32 + dx), hy - 0.2 - drop * 0.5, -0.08 + dz], [sx * (0.29 + dx), hy - 0.36 - drop, -0.06 + dz * 0.6], [sx * (0.26 + dx), hy - 0.46 - drop, -0.05]];
          A.add(pathLockGeo(`twin${sx}/${dz}/${hy.toFixed(3)}`, pts, wid, wid * 0.85, { q: B.q, side: [0, 0, 1], bulge: 0.45 }), { bone: 'head', color: tipCol, w: wts, ol: 0.85 });
        }
        const rib = look.outfit?.trim ?? 0xf2c14e;
        const rx = sx * 0.17, ry = hy + 0.1, rz = -0.06;
        for (const sz of [-1, 1]) {
          A.add(prim.sphere(s(10), s(7)), { bone: 'head', at: [rx + sx * 0.012, ry + 0.025, rz + sz * 0.045], rot: [sz * 0.6, 0, sx * 0.35], scl: [0.022, 0.036, 0.05], color: rib, ol: 0.7 });
        }
        A.add(prim.sphere(s(8), s(6)), { bone: 'head', at: [rx + sx * 0.016, ry + 0.012, rz], scl: [0.024, 0.024, 0.024], color: shade(rib, -0.15), ol: 0.6 });
      }
      break;
    }
    case 'messy': case 'wild': {
      const wild = st === 'wild';
      if (!f.hideBangs) {
        bangs(6, 46, 0.17, { fan: 40, lift: 10, bend: -0.3 });
        if (look.hair.hint && /over one eye|fringe/.test(look.hair.hint)) lock(-22, 34, 0.24, 0.085, 0.03, { sweep: 16, lift: 6, bend: -0.5 });
      }
      if (!f.hideTop) {
        for (let i = 0; i < (wild ? 14 : 10); i++) {
          const az = rnd() * 360, el = 18 + rnd() * 70;
          if (Math.cos(az * D2R) > 0.55 && el > 40) continue;
          lock(az, el, (wild ? 0.2 : 0.14) * (0.8 + rnd() * 0.5), 0.08, 0.035, { lift: 20 + rnd() * 30, bend: 0.2, sweep: (rnd() - 0.5) * 50, k: 1.0 });
        }
      }
      if (!f.hideBack) ring(80, 280, 8, 62, wild ? 0.2 : 0.15, { bend: -0.15, lift: 12, jitter: 40 });
      if (look.hair.hint && /lea(f|ves)/.test(look.hair.hint) && !f.hideTop) {
        for (const [az, el] of [[40, 30], [-120, 40]]) {
          const m = lockMatrix(d, az, el, { lift: 50, k: 1.06 });
          A.add(prim.sphere(s(6), s(4)), { bone: 'head', m, scl: [0.026, 0.008, 0.016], color: 0x6fb83a, ol: 0.5 });
        }
      }
      break;
    }
    case 'slick': {
      if (!f.hideTop) {
        for (let i = 0; i < 7; i++) {
          const az = -54 + i * 18;
          lock(az, 14, 0.3, 0.085, 0.03, { sweep: 0, lift: 6, bend: -0.62, k: 1.03 });
        }
        lock(14, 32, 0.15, 0.03, 0.016, { lift: 10, bend: -0.6, sweep: 18, color: tipCol });
        lock(-6, 34, 0.13, 0.026, 0.014, { lift: 12, bend: -0.5, sweep: -10, color: tipCol });
      }
      if (!f.hideBack) ring(100, 260, 6, 66, 0.12, { bend: -0.2, lift: 6 });
      break;
    }
    case 'mohawk': {
      if (!f.hideTop) {
        for (let i = 0; i < 8; i++) {
          const el = -6 + i * 14;
          const az = el < 0 ? 0 : 180;
          const ell = Math.abs(el);
          lock(az, ell, 0.16 + 0.05 * Math.sin((i / 7) * Math.PI), 0.07, 0.05, { lift: 62, bend: 0.3, k: 0.98, sweep: 0, color: tipCol });
        }
        A.add(prim.sphereCut(s(18), s(10), 0, Math.PI * 2, 0, 1.75), { bone: 'head', at: [0, d.headY, -0.004], rot: [-0.3, 0, 0], scl: [d.headR * 1.012, d.headR * d.headS[1] * 1.012, d.headR * d.headS[2] * 1.012], color: shade(look.skin, -0.12), ol: 0 });
      }
      break;
    }
    case 'bald': {
      if (!f.hideBack) {
        for (let i = 0; i < 11; i++) {
          A.add(hangLockGeo(d, 75 + i * 21, 74, 0.14, 0.085, 0.03, { elEnd: 114, flare: 0.0, q: B.q }), { bone: 'head', color: tipCol, ol: 0.8 });
        }
      }
      break;
    }
    case 'braid': {
      if (!f.hideBangs) bangs(5, 40, 0.15, { fan: 24 });
      if (!f.hideSide) for (const sx of [-1, 1]) lock(sx * 72, 50, 0.24, 0.066, 0.026, { bend: -0.18, color: tipCol });
      if (!f.hideBack) ring(110, 250, 5, 56, 0.14, { bend: -0.3 });
      const wts = scalpBlend(['hairA0', 'hairA1', 'hairA2'], 0.05);
      const p0 = R.pos[R.idx('hairA0')];
      for (let i = 0; i < 8; i++) {
        const y = p0.y - i * 0.042, z = p0.z - 0.035 - Math.min(i, 3) * 0.008;
        A.add(prim.sphere(s(9), s(7)), { bone: 'head', w: wts, at: [(i % 2 ? 0.008 : -0.008), y, z], rot: [0, 0, i % 2 ? 0.5 : -0.5], scl: [0.03 - i * 0.0015, 0.03, 0.026], color: i % 2 ? h.color : shade(h.color, -0.1), ol: 0.6 });
      }
      break;
    }
    case 'sidecut': {
      if (!f.hideTop) {
        ring(150, 330, 6, 30, 0.12, { bend: -0.3, lift: 8, w: 0.08 });
        A.add(prim.sphereCut(s(16), s(10), Math.PI * 0.5, Math.PI, 0.4, 1.4), { bone: 'head', at: [0, d.headY, 0], scl: [d.headR * 1.01, d.headR * d.headS[1] * 1.01, d.headR * d.headS[2] * 1.01], color: shade(h.color, 0.1), ol: 0 });
      }
      if (!f.hideBangs) {
        const streak = look.eyes?.color ?? 0xa86bff;
        lock(-20, 18, 0.3, 0.1, 0.034, { sweep: 26, lift: 8, bend: -0.55, k: 1.05 });
        lock(-44, 26, 0.3, 0.08, 0.03, { sweep: 18, lift: 6, bend: -0.45, k: 1.05, color: hairFn({ hair: { color: shade(streak, -0.15), shade: shade(streak, -0.5) } }) });
        lock(10, 22, 0.16, 0.07, 0.026, { sweep: -20, lift: 8, bend: -0.5 });
      }
      if (!f.hideBack) ring(120, 240, 4, 64, 0.12, { bend: -0.25 });
      break;
    }
    case 'short': default: {
      const undercut = look.gender === 'f' && st === 'short';
      if (!f.hideBangs) bangs(5, 40, undercut ? 0.15 : 0.12, { fan: 30, lift: 12, bend: -0.25, sweep: undercut ? -18 : 0 });
      if (!f.hideSide) for (const sx of [-1, 1]) lock(sx * 74, 52, 0.11, 0.06, 0.024, { bend: -0.25 });
      if (!f.hideBack) ring(110, 250, 6, 60, 0.11, { bend: -0.3, lift: 8 });
      if (!f.hideTop) for (let i = 0; i < 5; i++) lock(120 + i * 30, 26, 0.12, 0.08, 0.035, { lift: 24, bend: 0.1, k: 1.0 });
      break;
    }
  }
}

// ------------------------------------------------------------------ headgear
/** Circlets, hats, hoods and helmets (placed over the hair volume). */
export function addHeadgear(B, A, sp) {
  const look = B.look, d = B.d, o = B.o, hg = look.headgear, s = (n) => B.seg(n);
  if (!hg) { B.hatTop = 0.035; return; }
  const hy = d.headY, R = d.headR;
  const gem = look.accent ?? 0x7fd8ff, trim = o.trim ?? 0xd9ab47;
  const head = { bone: 'head' };
  const band = (y, rx, rz, thick, col, tilt = 0.12) => A.add(prim.torus(0.06, 6, s(28)), { ...head, at: [0, y, -0.008], rot: [-Math.PI / 2 + tilt, 0, 0], scl: [rx, rz, thick / 0.06], color: col, ol: 0.6 });
  switch (hg) {
    case 'circlet': case 'hornedCirclet': {
      const col = hg === 'hornedCirclet' ? 0xc8c6d8 : trim;
      band(hy + 0.09, R * 1.12, R * 1.13, 0.012, metal(col));
      A.add(prim.octa(), { ...head, at: [0, hy + 0.07, R * 1.1 + 0.012], scl: [0.018, 0.026, 0.012], color: gem, ol: 0.5 });
      A.add(prim.octa(), { ...head, layer: 'glow', at: [0, hy + 0.07, R * 1.1 + 0.021], scl: [0.008, 0.012, 0.004], color: gem, glow: 1.6 });
      B.hatTop = 0.035;
      if (hg === 'hornedCirclet') {
        for (const sx of [-1, 1]) {
          const pts = [[sx * 0.15, hy + 0.1, 0.06], [sx * 0.2, hy + 0.19, 0.01], [sx * 0.21, hy + 0.27, -0.07], [sx * 0.17, hy + 0.32, -0.15]];
          A.add(sweepGeo(`horn${sx}/${hy.toFixed(3)}`, pts, (u) => 0.026 * (1 - u * 0.92), { seg: s(10), radial: s(8), side: [0, 0, 1] }), { ...head, color: gradY(0x2a2433, 0xd8c8ff, hy + 0.08, hy + 0.32) });
        }
        B.hatTop = 0.12;
      }
      break;
    }
    case 'crown': {
      const y0 = hy + 0.1;
      A.add(prim.cyl(1.0, 0.94, s(18), true), { ...head, at: [0, y0 + 0.025, -0.012], rot: [-0.12, 0, 0], scl: [R * 1.05, 0.055, R * 1.05], color: metal(trim) });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        A.add(prim.cone(s(6)), { ...head, at: [Math.sin(a) * R * 1.02, y0 + 0.075 - Math.cos(a) * 0.006, Math.cos(a) * R * 1.02 - 0.012], scl: [0.018, i === 0 ? 0.07 : 0.05, 0.018], color: metal(trim), ol: 0.6 });
      }
      A.add(prim.octa(), { ...head, at: [0, y0 + 0.028, R * 1.06], scl: [0.016, 0.022, 0.01], color: gem, ol: 0.5 });
      A.add(prim.octa(), { ...head, layer: 'glow', at: [0, y0 + 0.028, R * 1.06 + 0.007], scl: [0.008, 0.012, 0.004], color: gem, glow: 1.8 });
      B.hatTop = 0.1;
      break;
    }
    case 'witchHat': {
      const col = o.primary ?? 0x5b2a86;
      const by = hy + 0.11;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-0.18, 0, 0.1)).setPosition(0, by, -0.01);
      A.add(prim.cyl(1, 1, s(28)), { ...head, m: m.clone().multiply(new THREE.Matrix4().makeScale(0.3, 0.014, 0.3)), color: col });
      A.add(prim.torus(0.06, 6, s(28)), { ...head, m: m.clone().multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(0.3, 0.3, 0.2)), color: shade(col, -0.1), ol: 0.8 });
      const cone = sweepGeo('witchCone', [[0, 0, 0], [0, 0.13, -0.01], [0, 0.25, -0.05], [0.0, 0.33, -0.12], [0, 0.35, -0.2]],
        (u) => 0.135 * Math.pow(1 - u, 0.95) + 0.004, { seg: s(14), radial: s(16), side: [1, 0, 0], capStart: true });
      A.add(cone, { ...head, m, color: gradY(shade(col, -0.2), shade(col, 0.15), 0, 0.3) });
      const bandM = m.clone().multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.028)).multiply(new THREE.Matrix4().makeScale(0.13, 0.13, 0.11));
      A.add(prim.torus(0.22, 6, s(24)), { ...head, m: bandM, color: trim, ol: 0.5 });
      const star = [];
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.014 : 0.034; star.push([Math.sin(a) * r, Math.cos(a) * r]); }
      const starM = m.clone().multiply(new THREE.Matrix4().makeTranslation(0.05, 0.05, 0.12)).multiply(new THREE.Matrix4().makeRotationY(0.4));
      A.add(prim.slab('star', star, 0.012, 0.002), { ...head, m: starM, color: metal(trim), ol: 0.5 });
      B.hatTop = 0.42;
      break;
    }
    case 'hood': {
      const col = o.cape ?? o.primary ?? 0x4a3a2a;
      const open = 58 * D2R;
      const shell = prim.sphereCut(s(24), s(14), Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, 118 * D2R);
      const sc = [R * 1.2, R * d.headS[1] * 1.2, R * d.headS[2] * 1.22];
      A.add(shell, { ...head, at: [0, hy + 0.01, -0.012], rot: [0.12, 0, 0], scl: sc, color: col });
      A.add(shell, { ...head, at: [0, hy + 0.01, -0.012], rot: [0.12, 0, 0], scl: sc.map((v) => v * 0.97), color: shade(col, -0.55), invert: true, ol: 0 });
      A.add(prim.cone(s(8)), { ...head, at: [0, hy + 0.13, -0.17], rot: [-1.0, 0, 0], scl: [0.06, 0.12, 0.05], color: col, ol: 0.8 });
      const cw = d.tw;
      A.add(prim.lathe([[0.17 * cw + 0.02, d.shY - 0.02], [0.13 * cw + 0.02, d.neckY - 0.005], [0.12, d.neckY + 0.05]], s(20)), { bone: 'chest', scl: [1, 1, 0.95], color: col });
      B.hatTop = 0.06;
      break;
    }
    case 'helmOpen': case 'plumedHelm': case 'helmClosed': {
      const col = sp.plate || o.primary || 0x8a929e;
      const closed = hg === 'helmClosed';
      const dome = prim.sphereCut(s(24), s(12), 0, Math.PI * 2, 0, (closed ? 98 : 84) * D2R);
      const sc = [R * 1.13, R * d.headS[1] * 1.13, R * d.headS[2] * 1.15];
      A.add(dome, { ...head, at: [0, hy + 0.012, -0.004], rot: [-0.12, 0, 0], scl: sc, color: metal(col) });
      A.add(dome, { ...head, at: [0, hy + 0.012, -0.004], rot: [-0.12, 0, 0], scl: sc.map((v) => v * 0.97), color: shade(col, -0.6), invert: true, ol: 0 });
      band(hy + (closed ? -0.012 : 0.04), R * 1.15, R * 1.17, 0.018, metal(trim), -0.12);
      A.add(prim.rbox(0.4, 1), { ...head, at: [0, hy + 0.17, -0.01], rot: [-0.25, 0, 0], scl: [0.022, 0.05, 0.2], color: metal(shade(col, 0.1)), ol: 0.6 });
      if (closed) {
        const plate = prim.sphereCut(s(18), s(10), Math.PI / 2 - 1.15, 2.3, 72 * D2R, 76 * D2R);
        A.add(plate, { ...head, at: [0, hy - 0.005, 0.004], scl: [R * 1.16, R * 1.12, R * 1.19], color: metal(col) });
        A.add(prim.box(), { ...head, at: [0, hy + 0.012, R * 1.15], scl: [0.2, 0.022, 0.03], color: 0x0c0a10, ol: 0, hard: true });
        for (const sx of [-1, 1]) A.add(prim.sphere(8, 6), { ...head, layer: 'glow', at: [sx * 0.045, hy + 0.012, R * 1.17], scl: [0.022, 0.009, 0.006], color: look.eyes?.color ?? 0xff4a3a, glow: 2.4 });
        B.flags.noFace = true;
      } else {
        for (const sx of [-1, 1]) {
          A.add(prim.rbox(0.35, 1), { ...head, at: [sx * R * 1.02, hy - 0.06, 0.02], rot: [0.15, 0, sx * 0.1], scl: [0.03, 0.1, 0.11], color: metal(col), ol: 0.8 });
        }
      }
      if (hg === 'plumedHelm') {
        const plume = o.cape ?? o.secondary ?? 0xc0262f;
        const pts = [[0, hy + 0.2, 0.06], [0, hy + 0.27, -0.03], [0, hy + 0.27, -0.15], [0, hy + 0.2, -0.26], [0, hy + 0.08, -0.32]];
        A.add(sweepGeo(`plume${hy.toFixed(3)}`, pts, (u) => [0.022 * (1 - u * 0.5), 0.05 * Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1))], { seg: s(12), radial: s(8), side: [1, 0, 0] }), { ...head, color: plume });
        B.hatTop = 0.12;
      } else B.hatTop = 0.05;
      break;
    }
    case 'bandana': {
      const col = look.accent ?? o.secondary ?? 0x9a3a2a;
      band(hy + 0.07, R * 1.12, R * 1.12, 0.03, col, 0.14);
      A.add(prim.sphere(s(8), s(6)), { ...head, at: [0, hy + 0.1, -R * 1.12], scl: [0.03, 0.026, 0.022], color: col, ol: 0.6 });
      for (const sx of [-1, 1]) {
        const pts = [[sx * 0.01, hy + 0.09, -R * 1.12], [sx * 0.04, hy + 0.03, -R * 1.18], [sx * 0.06, hy - 0.05, -R * 1.2]];
        A.add(sweepGeo(`bandTail${sx}/${hy.toFixed(3)}`, pts, (u) => [0.022 * (1 - u * 0.6), 0.006], { seg: 6, radial: 6, side: [1, 0, 0] }), { ...head, color: shade(col, -0.1), ol: 0.6 });
      }
      B.hatTop = 0.035;
      break;
    }
    case 'cap': {
      const col = o.cape ?? o.secondary ?? 0x4a5a3a;
      const crown = prim.sphereCut(s(22), s(10), 0, Math.PI * 2, 0, 62 * D2R);
      A.add(crown, { ...head, at: [0, hy + 0.03, -0.01], rot: [-0.15, 0, 0.08], scl: [R * 1.14, R * 1.12, R * 1.16], color: col });
      A.add(prim.cyl(1, 1, s(16), false), { ...head, at: [0, hy + 0.105, R * 0.95], rot: [0.32, 0, 0], scl: [0.11, 0.012, 0.07], color: shade(col, -0.2), ol: 0.6 });
      const pts = [[0.09, hy + 0.15, -0.04], [0.13, hy + 0.24, -0.1], [0.14, hy + 0.3, -0.2]];
      A.add(sweepGeo(`feather${hy.toFixed(3)}`, pts, (u) => [0.004, 0.03 * Math.sin(Math.PI * Math.min(1, u + 0.05))], { seg: 8, radial: 6, side: [0, 0, 1] }), { ...head, color: look.accent ?? 0xc8b07a, ol: 0.6 });
      B.hatTop = 0.08;
      break;
    }
    default: B.hatTop = 0.035;
  }
}

// ------------------------------------------------------------------ facial geometry
/** Beards, moustaches, masks and eyepatch straps (painted marks live on the face texture). */
export function addFacial(B, A) {
  const look = B.look, d = B.d, fac = look.facial || [], s = (n) => B.seg(n);
  const hy = d.headY, R = d.headR;
  const hairCol = look.hair ? look.hair.color : 0x5a4030;
  const beardCol = hairFn({ hair: { color: hairCol, shade: look.hair?.shade ?? shade(hairCol, -0.35) } });
  if (fac.includes('beard')) {
    const long = look.age === 'elder';
    const jaw = prim.sphereCut(s(20), s(10), Math.PI / 2 - 1.3, 2.6, 129 * D2R, 46 * D2R);
    A.add(jaw, { bone: 'head', at: [0, hy - 0.004, 0.004], scl: [R * 1.03, R * d.headS[1] * 1.04, R * d.headS[2] * 1.05], color: beardCol, ol: 0.8 });
    if (long) {
      const pts = [[0, hy - 0.12, 0.13], [0, hy - 0.2, 0.15], [0, hy - 0.3, 0.13], [0, hy - 0.38, 0.1]];
      A.add(sweepGeo(`beardLong${hy.toFixed(3)}`, pts, (u) => [0.09 * (1 - u * 0.75), 0.04 * (1 - u * 0.6)], { seg: s(10), radial: s(10), side: [1, 0, 0] }), { bone: 'head', color: beardCol });
    } else if (d.heavy && look.body === 'heavy' && look.hair?.style === 'mohawk') {
      const pts = [[0, hy - 0.15, 0.13], [0, hy - 0.22, 0.15], [0, hy - 0.3, 0.13]];
      A.add(sweepGeo(`beardBraid${hy.toFixed(3)}`, pts, (u) => 0.032 * (1 - u * 0.5), { seg: 8, radial: 8 }), { bone: 'head', color: beardCol });
      A.add(prim.torus(0.3, 6, 10), { bone: 'head', at: [0, hy - 0.27, 0.142], rot: [Math.PI / 2 - 0.3, 0, 0], scl: [0.022, 0.022, 0.02], color: look.outfit?.trim ?? 0xb08a50, ol: 0.5 });
    } else {
      A.add(prim.sphere(s(10), s(8)), { bone: 'head', at: [0, hy - 0.155, 0.105], scl: [0.055, 0.04, 0.04], color: beardCol, ol: 0.8 });
    }
  }
  if (fac.includes('mustache') || (fac.includes('beard') && look.age === 'elder')) {
    for (const sx of [-1, 1]) {
      const pts = [[sx * 0.004, hy - 0.072, R * 0.99], [sx * 0.04, hy - 0.085, R * 0.95], [sx * 0.07, hy - 0.11, R * 0.86]];
      A.add(sweepGeo(`mus${sx}/${hy.toFixed(3)}`, pts, (u) => [0.016 * (1 - u * 0.7), 0.012 * (1 - u * 0.7)], { seg: 6, radial: 6, side: [0, 1, 0] }), { bone: 'head', color: beardCol, ol: 0.6 });
    }
  }
  if (fac.includes('mask')) {
    const col = look.outfit?.top === 'cultistRobe' ? 0x1a1214 : (look.outfit?.secondary ?? 0x3a2a2a);
    const mask = prim.sphereCut(s(18), s(8), Math.PI / 2 - 1.2, 2.4, 106 * D2R, 52 * D2R);
    A.add(mask, { bone: 'head', at: [0, hy, 0.004], scl: [R * 1.04, R * d.headS[1] * 1.05, R * d.headS[2] * 1.07], color: col, ol: 0.8 });
    if (look.outfit?.top === 'cultistRobe') A.add(prim.torus(0.12, 5, s(20), Math.PI), { bone: 'head', at: [0, hy - 0.035, 0.01], rot: [-0.1, 0, Math.PI], scl: [R * 1.0, R * 0.9, R * 0.5], color: look.outfit.trim, ol: 0 });
  }
  if (fac.includes('eyepatch')) {
    A.add(prim.torus(0.06, 5, s(28)), { bone: 'head', at: [0, hy + 0.035, -0.005], rot: [-Math.PI / 2 + 0.35, 0, 0.42], scl: [R * 1.06, R * 1.06, 0.16], color: 0x1e1a1c, ol: 0.4 });
  }
}

// ------------------------------------------------------------------ cape + scarf
/** Two-tone cape skinned to the cape chain, and a scarf with fluttering tails on the scarf chain. */
export function addCapeScarf(B, A, sp) {
  const d = B.d, o = B.o, R = A.def;
  if (o.cape) {
    B.flags.cape = true;
    const col = C(o.cape), lining = C(shade(o.cape, -0.42)), trimC = C(o.trim ?? shade(o.cape, 0.3));
    const top = d.capeTop + 0.012, len = d.capeTop - (sp.robe ? 0.1 : 0.15);
    const cz = R.pos[R.idx('cape0')].z;
    const nr = 8, nc = 7, rows = [];
    for (let i = 0; i < nr; i++) {
      const v = i / (nr - 1);
      const y = top - v * (len - 0.01);
      const hw = lerp(0.1 * d.tw + 0.035, 0.17 * d.tw + 0.05, Math.pow(v, 0.8));
      const th = lerp(1.25, 0.95, v);
      const row = [];
      for (let j = 0; j < nc; j++) {
        const a = -th + 2 * th * (j / (nc - 1));
        const x = hw * Math.sin(a) / Math.sin(th);
        const z = cz + 0.012 - (Math.cos(a) - Math.cos(th)) * lerp(0.07, 0.05, v) - v * 0.045;
        row.push([x, y, z]);
      }
      rows.push(row);
    }
    const bottom = top - len + 0.01;
    A.add(stripGeo(`cape${d.tw}/${d.td}/${len.toFixed(3)}/${top.toFixed(3)}`, rows, 0.012, [0, 0, -1]), {
      bone: 'chest', w: chainWeightsAxis(R, ['cape0', 'cape1', 'cape2', 'cape3'], [0, -1, 0]),
      color: (p, n, out, mp) => { out.copy(n.z < 0.15 ? col : lining); if (mp.y < bottom + 0.018) out.copy(trimC); },
    });
    for (const sx of [-1, 1]) {
      A.add(prim.sphere(8, 6), { bone: 'chest', at: [sx * (0.075 * d.tw + 0.02), top - 0.005, cz + 0.04], scl: [0.018, 0.018, 0.012], color: metal(o.trim ?? 0xc9a24a), ol: 0.5 });
    }
  }
  if (o.scarf) {
    B.flags.scarf = true;
    const col = o.scarf, ny = d.neckY - 0.008;
    A.add(prim.torus(0.42, B.seg(8), B.seg(18)), { bone: 'chest', at: [0, ny, 0.005], rot: [-Math.PI / 2 + 0.12, 0, 0], scl: [0.075 * d.tw + 0.012, 0.07 * d.td + 0.01, 0.07], color: col });
    A.add(prim.sphere(8, 6), { bone: 'chest', at: [-0.05, ny - 0.012, 0.07], scl: [0.03, 0.028, 0.022], color: shade(col, -0.08), ol: 0.7 });
    const p0 = R.pos[R.idx('scarf0')], p2 = R.pos[R.idx('scarf2')];
    const ax = [p2.x - p0.x, p2.y - p0.y, p2.z - p0.z];
    const al = Math.hypot(ax[0], ax[1], ax[2]);
    const L = al + 0.07;
    const nrm = ax.map((v) => v / al);
    for (const [dx, wid, lenK] of [[0.0, 0.05, 1], [0.035, 0.042, 0.82]]) {
      const rows = [];
      for (let i = 0; i <= 6; i++) {
        const u = i / 6, l = u * L * lenK;
        const cx = p0.x + dx + nrm[0] * l, cy = p0.y + 0.01 + nrm[1] * l, cz = p0.z + 0.02 + nrm[2] * l;
        const w = wid * (1 - u * 0.25);
        rows.push([[cx - w * 0.5, cy, cz], [cx + w * 0.5, cy + 0.004, cz - 0.004]]);
      }
      A.add(stripGeo(`scarfTail${dx}/${p0.y.toFixed(3)}/${lenK}`, rows, 0.01, [0, 0, -1]), { bone: 'chest', w: chainWeightsAxis(R, ['scarf0', 'scarf1', 'scarf2'], nrm), color: shade(col, dx ? -0.06 : 0) });
    }
  }
}
// ------------------------------------------------------------------ weapons
const WEAPON_STYLE = {
  sword: 'sword', flameSword: 'sword', dagger: 'sword', greatsword: 'great', lance: 'lance', axe: 'axe', bow: 'bow', longbow: 'bow',
  staff: 'staff', holyStaff: 'staff', rod: 'rod', twinDaggers: 'twin', claws: 'claws', scythe: 'scythe', none: 'unarmed',
};

function bladeGeo(key, len, width, thick, tipFrac = 0.16) {
  return sweepGeo(`blade${key}`, [[0, 0, 0], [0, len * 0.5, 0], [0, len, 0]],
    (u) => { const k = u > 1 - tipFrac ? Math.max(0.0, (1 - u) / tipFrac) : 1 - u * 0.12; return [width * k, thick * Math.max(0.35, k)]; },
    { seg: 8, radial: 4, side: [0, 0, 1], capStart: true });
}

/** Weapon (right hand), off-hand items, shield and quiver. Returns style info + tip anchor. */
export function addWeapon(B, A) {
  const look = B.look, d = B.d, R = A.def, s = (n) => B.seg(n);
  const type = look.weapon || 'none';
  const style = WEAPON_STYLE[type] || 'unarmed';
  const wp = R.pos[R.idx('wpn')], op = R.pos[R.idx('off')];
  const at = (p, x, y, z) => [p.x + x, p.y + y, p.z + z];
  const blade = look.blade ?? 0xd6dde6, acc = look.accent ?? 0xc9a24a;
  const trim = B.o.trim ?? 0xc9a24a, grip = shade(B.o.belt ?? 0x4a3020, -0.1);
  const out = { style, type, reach: 0.5, alias: {} };
  const W = { bone: 'wpn' };
  const swordAt = (bone, p, len, width, dir = 1, gripLen = 0.075, guardW = 0.12) => {
    const b = { bone };
    A.add(prim.cyl(1, 1, s(8)), { ...b, at: at(p, 0, dir * 0.0, 0), scl: [0.017, gripLen, 0.017], color: grip, ol: 0.7 });
    A.add(prim.sphere(8, 6), { ...b, at: at(p, 0, -dir * (gripLen * 0.5 + 0.012), 0), scl: 0.018, color: metal(trim), ol: 0.6 });
    A.add(prim.rbox(0.3, 1), { ...b, at: at(p, 0, dir * (gripLen * 0.5 + 0.008), 0), scl: [0.034, 0.026, guardW * 1.25], color: metal(trim), ol: 0.7 });
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y + dir * (gripLen * 0.5 + 0.016), p.z);
    if (dir < 0) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
    A.add(bladeGeo(`${len}/${width}`, len, width, 0.016), { ...b, m, color: metal(blade, 1.3) });
    return gripLen * 0.5 + 0.016 + len;
  };
  switch (type) {
    case 'sword': case 'flameSword': case 'dagger': {
      const len = type === 'dagger' ? 0.2 : 0.42, width = type === 'dagger' ? 0.036 : 0.05;
      const reach = swordAt('wpn', wp, len, width, 1, type === 'dagger' ? 0.06 : 0.08, type === 'dagger' ? 0.08 : 0.13);
      if (type === 'flameSword') {
        const base = wp.y + 0.058;
        const flame = sweepGeo('flame', [[0, 0, 0], [0, len * 0.5, 0], [0, len + 0.04, 0]],
          (u) => [0.07 * (1 - u * 0.7) * (1 + 0.25 * Math.sin(u * 19)), 0.028 * (1 - u * 0.6)], { seg: 16, radial: 6, side: [0, 0, 1] });
        A.add(flame, { ...W, layer: 'glow', at: [wp.x, base, wp.z], color: (p, n, o) => o.setRGB(1.0, 0.55 + 0.35 * (1 - p.y / len), 0.12 + 0.2 * (1 - p.y / len)), glow: 2.4 });
        B.flags.flame = true;
      }
      out.reach = reach; out.tip = { bone: 'wpn', at: at(wp, 0, reach, 0) };
      break;
    }
    case 'greatsword': {
      const reach = swordAt('wpn', wp, 0.62, 0.075, 1, 0.13, 0.2);
      A.add(prim.rbox(0.3, 1), { ...W, at: at(wp, 0, 0.13, 0), scl: [0.03, 0.05, 0.075], color: metal(B.look.accent ?? 0xa8242c), ol: 0.6 });
      out.reach = reach; out.tip = { bone: 'wpn', at: at(wp, 0, reach, 0) };
      break;
    }
    case 'lance': {
      A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, 0.14, 0), scl: [0.022, 0.98, 0.022], color: metal(shade(blade, -0.35)) });
      for (const y of [-0.05, 0.06]) A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, y, 0), scl: [0.02, 0.035, 0.02], color: acc, ol: 0.5 });
      A.add(prim.cyl(0.25, 1, s(12)), { ...W, at: at(wp, 0, 0.13, 0), scl: [0.05, 0.08, 0.05], color: metal(trim), ol: 0.8 });
      A.add(sweepGeo('lanceHead', [[0, 0, 0], [0, 0.06, 0], [0, 0.19, 0]], (u) => [0.05 * (u < 0.3 ? 0.6 + u * 1.3 : (1 - u) / 0.7), 0.018 * (1 - u * 0.7)], { seg: 8, radial: 4, side: [0, 0, 1] }),
        { ...W, at: at(wp, 0, 0.62, 0), color: metal(blade, 1.3) });
      const rows = [];
      for (let i = 0; i <= 4; i++) { const u = i / 4; rows.push([[0, 0.6 - u * 0.0, 0.004 + u * 0.13], [0, 0.6 - 0.07 + u * 0.05, 0.004 + u * 0.13]]); }
      A.add(stripGeo('pennant', rows, 0.006, [1, 0, 0]), { ...W, at: at(wp, 0, 0, 0), color: acc, ol: 0.5 });
      out.reach = 0.81; out.tip = { bone: 'wpn', at: at(wp, 0, 0.81, 0) };
      break;
    }
    case 'axe': {
      A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, 0.15, 0), scl: [0.022, 0.56, 0.022], color: 0x6b4a2e });
      const head = [[0, -0.07], [0.05, -0.1], [0.12, -0.12], [0.15, -0.04], [0.15, 0.06], [0.12, 0.13], [0.05, 0.1], [0, 0.07]];
      A.add(prim.slab('axeHead', head, 0.026, 0.005), { ...W, at: at(wp, 0, 0.36, 0.01), rot: [0, -Math.PI / 2, 0], scl: [1.25, 1.25, 1], color: metal(blade, 1.2) });
      A.add(prim.cone(s(6)), { ...W, at: at(wp, 0, 0.36, -0.045), rot: [-Math.PI / 2, 0, 0], scl: [0.022, 0.07, 0.014], color: metal(blade), ol: 0.7 });
      A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, 0.36, 0), scl: [0.024, 0.09, 0.024], color: metal(shade(blade, -0.3)), ol: 0.6 });
      A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, 0.0, 0), scl: [0.02, 0.07, 0.02], color: acc, ol: 0.5 });
      out.reach = 0.46; out.tip = { bone: 'wpn', at: at(wp, 0, 0.4, 0.12) };
      break;
    }
    case 'bow': case 'longbow': {
      const half = type === 'longbow' ? 0.4 : 0.31, brace = 0.07;
      const O = { bone: 'off' };
      const limb = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8 * 2 - 1;
        const z = u * half, y = brace * 0.15 + Math.pow(Math.abs(u), 1.8) * (brace + 0.01) - (type === 'longbow' && Math.abs(u) > 0.85 ? (Math.abs(u) - 0.85) * 0.25 : 0);
        limb.push([0, y - brace * 0.15, z]);
      }
      A.add(sweepGeo(`bow${half}`, limb, (u) => { const c = Math.abs(u - 0.5) * 2; return [0.016 * (1 - c * 0.5), 0.022 * (1 - c * 0.5)]; }, { seg: 16, radial: 6, side: [1, 0, 0] }),
        { ...O, at: at(op, 0, 0, 0), color: (p, n, o2) => o2.set(Math.abs(p.z) < 0.035 ? acc : blade) });
      const tipY = Math.pow(1, 1.8) * (brace + 0.01) - (type === 'longbow' ? 0.15 * 0.25 : 0);
      for (const sz of [-1, 1]) {
        const tip = [0, tipY, sz * half], nock = [0, brace, 0];
        const pts = [tip, [0, (tip[1] + nock[1]) / 2, tip[2] / 2], nock];
        A.add(sweepGeo(`string${half}${sz}`, pts, () => 0.0028, { seg: 4, radial: 4, side: [1, 0, 0] }), {
          bone: 'off', at: at(op, 0, 0, 0), color: 0xf0ead8, ol: 0.35,
          w: (mp) => { const t = clamp(1 - Math.abs(mp.z - op.z) / half, 0, 1); return [[R.idx('off'), 1 - t], [R.idx('nock'), t]]; },
        });
      }
      // quiver on the back
      A.add(prim.cyl(1.0, 0.85, s(10)), { bone: 'chest', at: [0.06, d.chestY + 0.02, -0.105 * d.td], rot: [0.25, 0, -0.55], scl: [0.04, 0.2, 0.04], color: shade(B.o.belt ?? 0x5a3a22, 0.1) });
      for (let i = 0; i < 4; i++) {
        A.add(prim.cone(5), { bone: 'chest', at: [0.1 + i * 0.012 - 0.02, d.chestY + 0.13 + (i % 2) * 0.012, -0.13 * d.td + i * 0.008], rot: [0.25, 0, -0.55], scl: [0.016, 0.05, 0.006], color: i % 2 ? acc : 0xf2efe6, ol: 0.5 });
      }
      // nocked arrow (separate mesh shown while drawing)
      const AA = new Assembler(R);
      AA.add(prim.cyl(1, 1, 6), { at: [0, -0.21, 0], scl: [0.005, 0.42, 0.005], color: 0x8a6a42, ol: 0.6 });
      AA.add(prim.cone(6), { at: [0, -0.44, 0], rot: [Math.PI, 0, 0], scl: [0.013, 0.045, 0.006], color: metal(0xd8dde4), ol: 0.6 });
      for (const r of [0, Math.PI / 2]) AA.add(prim.box(), { at: [0, -0.03, 0], rot: [0, r, 0], scl: [0.03, 0.05, 0.002], color: acc, ol: 0.4, hard: true });
      out.arrow = { geometry: AA.build().body.geometry, bone: 'nock', at: [0, 0, 0], rot: [0, 0, 0] };
      out.reach = 0.3; out.tip = { bone: 'off', at: at(op, 0, -0.02, 0) };
      out.alias = { attack: 'shoot' };
      break;
    }
    case 'staff': case 'holyStaff': {
      const holy = type === 'holyStaff';
      A.add(prim.cyl(1, 0.85, s(8)), { ...W, at: at(wp, 0, 0.1, 0), scl: [0.02, 0.84, 0.02], color: (p, n, o2) => o2.set(blade).lerp(C(shade(blade, -0.3)), clamp(-p.y, 0, 1)) });
      for (const y of [-0.31, 0.0, 0.47]) A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, y, 0), scl: [0.02, 0.03, 0.02], color: metal(trim), ol: 0.5 });
      A.add(prim.torus(0.16, 6, s(16)), { ...W, at: at(wp, 0, 0.56, 0), rot: [0, Math.PI / 2, 0], scl: [0.05, 0.065, 0.05], color: metal(trim), ol: 0.6 });
      A.add(prim.octa(), { ...W, at: at(wp, 0, 0.57, 0), scl: [0.042, 0.075, 0.042], color: shade(acc, 0.25), ol: 0.6 });
      A.add(prim.octa(), { ...W, layer: 'glow', at: at(wp, 0, 0.56, 0), scl: [0.018, 0.034, 0.018], color: acc, glow: 1.8 });
      if (holy) {
        const wing = [[0, 0], [0.05, 0.02], [0.11, 0.07], [0.13, 0.12], [0.09, 0.1], [0.08, 0.06], [0.05, 0.05], [0.02, 0.02]];
        for (const sz of [-1, 1]) {
          A.add(prim.slab('holyWing', wing, 0.012, 0.003), { ...W, at: at(wp, 0, 0.5, sz * 0.03), rot: [0, sz > 0 ? -Math.PI / 2 : Math.PI / 2, 0], color: (p, n, o2) => o2.set(0xfbf6ea).lerp(C(trim), p.y > 0.09 ? 0.6 : 0), ol: 0.6 });
        }
        A.add(prim.torus(0.07, 6, s(24)), { ...W, layer: 'glow', at: at(wp, 0, 0.64, 0), rot: [0, Math.PI / 2, 0], scl: [0.075, 0.075, 0.075], color: shade(acc, 0.1), glow: 1.7 });
      }
      out.reach = 0.6; out.tip = { bone: 'wpn', at: at(wp, 0, 0.58, 0) };
      break;
    }
    case 'rod': {
      A.add(prim.cyl(1, 0.8, s(8)), { ...W, at: at(wp, 0, 0.07, 0), scl: [0.018, 0.36, 0.018], color: metal(blade) });
      A.add(prim.cyl(1.2, 0.6, s(10)), { ...W, at: at(wp, 0, 0.27, 0), scl: [0.028, 0.05, 0.028], color: metal(trim), ol: 0.6 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const pts = [[Math.sin(a) * 0.022, 0.0, Math.cos(a) * 0.022], [Math.sin(a) * 0.05, 0.05, Math.cos(a) * 0.05], [Math.sin(a) * 0.02, 0.1, Math.cos(a) * 0.02]];
        A.add(sweepGeo(`rodClaw${i}`, pts, (u) => 0.008 * (1 - u * 0.6), { seg: 6, radial: 5 }), { ...W, at: at(wp, 0, 0.28, 0), color: metal(trim), ol: 0.6 });
      }
      A.add(prim.sphere(s(14), s(10)), { ...W, layer: 'glow', at: at(wp, 0, 0.35, 0), scl: 0.055, color: acc, glow: 2.2 });
      A.add(prim.sphere(s(10), s(8)), { ...W, layer: 'glow', at: at(wp, 0, 0.34, 0), scl: 0.022, color: 0xffffff, glow: 2.6 });
      out.reach = 0.38; out.tip = { bone: 'wpn', at: at(wp, 0, 0.34, 0) };
      break;
    }
    case 'twinDaggers': {
      const reach = swordAt('wpn', wp, 0.17, 0.026, 1, 0.06, 0.08);
      swordAt('off', op, 0.17, 0.026, -1, 0.06, 0.08);
      out.reach = reach; out.tip = { bone: 'wpn', at: at(wp, 0, reach, 0) };
      break;
    }
    case 'claws': {
      for (const [bone, p] of [['wpn', wp], ['off', op]]) {
        for (let i = 0; i < 3; i++) {
          const x = (i - 1) * 0.016;
          const pts = [[x, 0, 0.02], [x, -0.06, 0.05], [x, -0.12, 0.04]];
          A.add(sweepGeo(`claw${i}`, pts, (u) => [0.006 * (1 - u), 0.01 * (1 - u)], { seg: 6, radial: 4, side: [1, 0, 0] }), { bone, at: at(p, 0, 0, 0), color: metal(blade), ol: 0.6 });
        }
      }
      out.reach = 0.14; out.tip = { bone: 'wpn', at: at(wp, 0, -0.1, 0.05) };
      break;
    }
    case 'scythe': {
      A.add(prim.cyl(1, 1, s(8)), { ...W, at: at(wp, 0, 0.13, 0), scl: [0.02, 0.98, 0.02], color: shade(B.o.secondary ?? 0x222222, 0.1) });
      const pts = [[0, 0.6, 0.0], [-0.12, 0.67, 0.0], [-0.27, 0.61, 0.02], [-0.37, 0.48, 0.04]];
      A.add(sweepGeo('scytheBlade2', pts, (u) => [0.065 * (1 - u * 0.85), 0.012], { seg: 12, radial: 4, side: [0, 1, 0] }), { ...W, at: at(wp, 0, 0, 0), color: metal(blade, 1.3) });
      A.add(sweepGeo('scytheEdge2', pts.map((p) => [p[0], p[1] + 0.04, p[2]]), (u) => [0.012 * (1 - u * 0.8), 0.006], { seg: 12, radial: 4, side: [0, 1, 0] }), { ...W, layer: 'glow', at: at(wp, 0, -0.045, 0), color: acc, glow: 2.2 });
      A.add(prim.sphere(8, 6), { ...W, at: at(wp, 0, 0.62, 0), scl: 0.03, color: metal(trim), ol: 0.6 });
      out.reach = 0.7; out.tip = { bone: 'wpn', at: at(wp, -0.36, 0.5, 0.04) };
      break;
    }
    default: out.tip = { bone: 'handR', at: at(wp, 0, 0, 0) };
  }
  if (look.shield) addShield(B, A);
  return out;
}

function addShield(B, A) {
  const look = B.look, d = B.d, R = A.def, sh = look.shield;
  const fp = R.pos[R.idx('foreL')];
  const kind = look.kind === 'skeleton' ? 'round' : (B.o.top === 'heavyArmor' ? 'kite' : 'heater');
  let pts;
  if (kind === 'kite') pts = [[0, 0.16], [0.1, 0.13], [0.11, 0.02], [0.06, -0.1], [0, -0.18], [-0.06, -0.1], [-0.11, 0.02], [-0.1, 0.13]];
  else if (kind === 'heater') pts = [[0, 0.12], [0.095, 0.11], [0.1, 0.0], [0.06, -0.09], [0, -0.13], [-0.06, -0.09], [-0.1, 0.0], [-0.095, 0.11]];
  else { pts = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push([Math.sin(a) * 0.12, Math.cos(a) * 0.12]); } }
  const inner = pts.map(([x, y]) => [x * 0.84, y * 0.86]);
  const x = fp.x + 0.045, y = fp.y - d.fore * 0.45;
  const rot = [0, Math.PI / 2, 0];
  A.add(prim.slab(`shield${kind}`, pts, 0.018, 0.004), { bone: 'foreL', at: [x, y, 0.0], rot, color: metal(sh.trim ?? 0xc9a24a) });
  A.add(prim.slab(`shieldIn${kind}`, inner, 0.01, 0.003), { bone: 'foreL', at: [x + 0.011, y + 0.004, 0.0], rot, color: kind === 'round' ? gradY(shade(sh.color, -0.2), sh.color, -0.12, 0.12) : sh.color, ol: 0.4 });
  A.add(prim.sphere(10, 8), { bone: 'foreL', at: [x + 0.019, y + 0.01, 0], scl: [0.012, 0.03, 0.03], color: metal(sh.trim ?? 0xc9a24a), ol: 0.5 });
  if (kind !== 'round') {
    A.add(prim.box(), { bone: 'foreL', at: [x + 0.017, y + 0.004, 0], scl: [0.004, 0.2, 0.018], color: sh.trim ?? 0xc9a24a, ol: 0, hard: true });
    A.add(prim.box(), { bone: 'foreL', at: [x + 0.017, y + 0.05, 0], scl: [0.004, 0.018, 0.14], color: sh.trim ?? 0xc9a24a, ol: 0, hard: true });
  }
}

// ------------------------------------------------------------------ animation
// Leg IK: clips store foot targets in footL/footR position channels and an IK weight (degrees ->
// read back as 1.0) in the foot Y-rotation channel; this post-process converts them into leg angles.
const _ik = [0, 0];
/** Post-process for blended humanoid poses: head stabilisation and foot-planting leg IK. */
export function humanoidPost(def, d) {
  const ih = def.idx('hips'), isp = def.idx('spine'), ich = def.idx('chest'), ihd = def.idx('head');
  const legs = [['thighL', 'shinL', 'footL'], ['thighR', 'shinR', 'footR']].map((n) => n.map((x) => def.idx(x)));
  return (P) => {
    // keep the (big) head looking ahead when the torso pitches, so faces stay readable
    const torso = P[ih * 6] + P[isp * 6] + P[ich * 6];
    P[ihd * 6] -= 0.55 * clamp(torso, -0.6, 0.8);
    const hdy = P[ih * 6 + 4], hdz = P[ih * 6 + 5], hpitch = P[ih * 6];
    for (let li = 0; li < 2; li++) {
      const it = legs[li][0], is = legs[li][1], iff = legs[li][2];
      const fo = iff * 6;
      const w = clamp(P[fo + 1] / D2R, 0, 1);
      if (w > 0.001) {
        const fx = P[fo + 3], fy = P[fo + 4], fz = P[fo + 5];
        const hipY = d.hipY - 0.01 + hdy, footY = d.ankleY + fy;
        ik2(footY - hipY, fz - hdz, d.thigh, d.shin, _ik);
        P[it * 6] = lerp(P[it * 6], _ik[0] - hpitch, w);
        P[is * 6] = lerp(P[is * 6], _ik[1], w);
        P[it * 6 + 2] = lerp(P[it * 6 + 2], Math.atan2(fx, Math.max(0.05, hipY - footY)), w);
        P[fo] = lerp(P[fo], P[fo] - (_ik[0] - hpitch) - _ik[1] - hpitch, w);
      }
      P[fo + 1] = 0; P[fo + 3] = 0; P[fo + 4] = 0; P[fo + 5] = 0;
    }
  };
}

/** Feet planted (IK on) with optional per-foot offsets [x, y, z] and toe pitch (degrees). */
const plant = (fl = [0, 0, 0], fr = [0, 0, 0], pl = 0, pr = 0) => ({ p: { footL: [pl, 1, 0], footR: [pr, 1, 0] }, o: { footL: fl, footR: fr } });
/** Merge pose fragments ({p, o} objects) into a key. */
function K(t, e, ...parts) {
  const k = { t, e, p: {}, o: {} };
  for (const part of parts) {
    if (!part) continue;
    if (part.p) Object.assign(k.p, part.p);
    if (part.o) Object.assign(k.o, part.o);
  }
  return k;
}
const P_ = (p, o) => ({ p, o });

/** Weapon-hold poses (arms + weapon/off-hand bones) per style. */
function holds(style, hasShield) {
  const L0 = { armL: [6, 0, 9], foreL: [-14, 0, 0] };
  const LS = { armL: [-12, 0, 16], foreL: [-62, 0, 0] };
  const H = {
    sword: {
      idle: { armR: [-14, 0, -11], foreR: [-28, 0, 0], wpn: [150, 0, 0], ...(hasShield ? LS : L0) },
      ready: { armR: [-45, 0, -18], foreR: [-42, 0, 0], wpn: [100, 0, 0], armL: hasShield ? [-38, 0, 18] : [-25, 0, 22], foreL: hasShield ? [-70, 0, 0] : [-55, 0, 0] },
    },
    great: {
      idle: { armR: [-30, 0, -6], foreR: [-40, 0, 0], wpn: [180, 0, 14], armL: [-34, 0, -16], foreL: [-40, 0, 0] },
      ready: { armR: [-42, 0, -6], foreR: [-46, 0, 0], wpn: [128, 0, 0], armL: [-48, 0, -14], foreL: [-44, 0, 0] },
    },
    axe: {
      idle: { armR: [-10, 0, -12], foreR: [-22, 0, 0], wpn: [158, 0, 0], ...(hasShield ? LS : L0) },
      ready: { armR: [-52, 0, -24], foreR: [-58, 0, 0], wpn: [72, 0, 0], armL: [-28, 0, 24], foreL: [-62, 0, 0] },
    },
    lance: {
      idle: { armR: [-4, 0, -24], foreR: [-50, 0, 0], wpn: [58, 0, 34], ...(hasShield ? LS : L0) },
      ready: { armR: [-22, 0, -18], foreR: [-66, 0, 0], wpn: [172, 0, 0], armL: hasShield ? [-40, 0, 14] : [-42, 0, -16], foreL: hasShield ? [-72, 0, 0] : [-58, 0, 0] },
    },
    staff: {
      idle: { armR: [-8, 0, -18], foreR: [-54, 0, 0], wpn: [62, 0, 26], ...L0 },
      ready: { armR: [-34, 0, -14], foreR: [-50, 0, 0], wpn: [70, 0, 18], armL: [-34, 0, 4], foreL: [-62, 0, 0] },
    },
    rod: {
      idle: { armR: [-18, 0, -10], foreR: [-62, 0, 0], wpn: [55, 0, 0], ...L0 },
      ready: { armR: [-48, 0, -16], foreR: [-48, 0, 0], wpn: [70, 0, 0], armL: [-30, 0, 24], foreL: [-50, 0, 0] },
    },
    bow: {
      idle: { armR: [4, 0, -10], foreR: [-16, 0, 0], wpn: [0, 0, 0], armL: [-6, 0, 10], foreL: [-30, 0, 0], off: [-90, 0, 0] },
      ready: { armR: [-30, 0, -20], foreR: [-80, 0, 0], armL: [-62, -10, 26], foreL: [-22, 0, 0], off: [-25, 0, 0] },
    },
    twin: {
      idle: { armR: [-12, 0, -12], foreR: [-34, 0, 0], wpn: [120, 0, 0], armL: [-6, 0, 12], foreL: [-30, 0, 0], off: [0, 0, 0] },
      ready: { armR: [-40, 0, -24], foreR: [-62, 0, 0], wpn: [96, 0, 0], armL: [-36, 0, 26], foreL: [-66, 0, 0], off: [10, 0, 0] },
    },
    scythe: {
      idle: { armR: [-8, 0, -18], foreR: [-56, 0, 0], wpn: [62, 0, 26], ...L0 },
      ready: { armR: [-30, 0, -10], foreR: [-48, 0, 0], wpn: [60, -30, 30], armL: [-40, 0, -6], foreL: [-60, 0, 0] },
    },
    claws: {
      idle: { armR: [-6, 0, -12], foreR: [-30, 0, 0], armL: [-6, 0, 12], foreL: [-30, 0, 0] },
      ready: { armR: [-40, 0, -24], foreR: [-80, 0, 0], armL: [-40, 0, 24], foreL: [-80, 0, 0] },
    },
    unarmed: {
      idle: { armR: [4, 0, -10], foreR: [-16, 0, 0], ...L0 },
      ready: { armR: [-40, 0, -20], foreR: [-90, 0, 0], armL: [-40, 0, 20], foreL: [-90, 0, 0] },
    },
  };
  return H[style] || H.unarmed;
}

/** Clip table for a humanoid (loops + one-shots), specialised by weapon style and mount. */
export function humanoidClips(B, wpn, def) {
  const d = B.d, st = wpn.style, hasShield = !!B.look.shield;
  const H = holds(st, hasShield);
  const I = (n) => def.idx(n);
  const iBase = I('base'), iHips = I('hips'), iSpine = I('spine'), iChest = I('chest'), iHead = I('head');
  const iArmL = I('armL'), iArmR = I('armR'), iForeL = I('foreL'), iForeR = I('foreR'), iFootL = I('footL'), iFootR = I('footR');
  const stoop = d.elder ? 9 : 0;
  const STAND = plant([0.006, 0, 0.004], [-0.006, 0, -0.004]);
  const STANCE = plant([0.014, 0, 0.045], [-0.014, 0, -0.04]);
  const torsoIdle = P_({ spine: [2 + stoop, 0, 0], chest: [2 + stoop * 0.5, 0, 0], head: [-4 - stoop * 0.6, 0, 0] });
  const torsoReady = P_({ hips: [0, -14, 0], spine: [6, -4, 0], chest: [4, -6, 0], head: [-2, 22, 0] }, { hips: [0, -0.024, 0] });
  const clips = {};
  const breathe = (amp) => (P, t) => {
    const b = Math.sin(t * Math.PI * 2 / 2.6);
    P[iChest * 6] += b * 0.022 * amp; P[iHead * 6] -= b * 0.012 * amp;
    P[iArmL * 6 + 2] += b * 0.02 * amp; P[iArmR * 6 + 2] -= b * 0.02 * amp;
    P[iHips * 6 + 4] += (b - 1) * 0.0018 * amp;
    P[iHead * 6 + 1] += Math.sin(t * 0.63) * 0.05 * amp;
  };
  clips.idle = { dur: 2.6, loop: true, keys: [K(0, 'io', STAND, torsoIdle, P_(H.idle))], fn: breathe(1) };
  clips.ready = {
    dur: 1.2, loop: true, keys: [K(0, 'io', STANCE, torsoReady, P_(H.ready))],
    fn: (P, t) => { const b = Math.sin(t * Math.PI * 2 / 1.2); P[iHips * 6 + 4] += b * 0.004 - 0.002; P[iChest * 6] += b * 0.025; P[iArmR * 6] += b * 0.03; P[iArmL * 6] += b * 0.03; },
  };
  const gait = (dur, stride, lift, bob, lean, swing, foreBend) => ({
    dur, loop: true, keys: [K(0, 'io', STAND, P_({ spine: [lean + stoop, 0, 0], chest: [lean * 0.4, 0, 0], head: [-lean * 0.6, 0, 0] }), P_(H.idle))],
    fn: (P, t) => {
      const ph = (t / dur) * Math.PI * 2, c = Math.cos(ph), s = Math.sin(ph);
      P[iFootL * 6 + 5] += -stride * c; P[iFootL * 6 + 4] += lift * Math.max(0, s);
      P[iFootR * 6 + 5] += stride * c; P[iFootR * 6 + 4] += lift * Math.max(0, -s);
      P[iFootL * 6] -= Math.max(0, s) * 0.5 * (lift / 0.05); P[iFootR * 6] -= Math.max(0, -s) * 0.5 * (lift / 0.05);
      P[iHips * 6 + 4] += -bob - bob * Math.cos(2 * ph);
      P[iHips * 6 + 1] += 0.12 * c; P[iChest * 6 + 1] -= 0.16 * c; P[iHead * 6 + 1] += 0.05 * c;
      P[iHips * 6 + 3] += 0.006 * s;
      const sw = swing * c;
      P[iArmL * 6] -= sw; P[iArmR * 6] += sw * (st === 'unarmed' || st === 'claws' ? 1 : 0.45);
      P[iForeL * 6] += foreBend * (0.6 + 0.4 * Math.max(0, -c)); P[iForeR * 6] += foreBend * 0.5;
    },
  });
  clips.walk = gait(0.72, 0.05, 0.035, 0.005, 5, 0.35, -0.25);
  clips.run = gait(0.46, 0.078, 0.06, 0.011, 15, 0.7, -0.9);
  const HURT = [plant([0.01, 0, 0.03], [-0.012, 0, -0.03]), P_({ spine: [16, 0, 0], chest: [10, 6, -5], head: [10, -8, 8], armL: [-34, 0, 18], foreL: [-95, 0, 0] }, { hips: [0, -0.04, 0] })];
  const hurtArmR = { ...H.idle };
  clips.hurt = {
    dur: 1.6, loop: true, keys: [K(0, 'io', P_(hurtArmR), ...HURT)],
    fn: (P, t) => { const b = Math.sin(t * Math.PI * 2 / 0.8); P[iChest * 6] += b * 0.04; P[iHead * 6] += b * 0.03; P[iHips * 6 + 4] += b * 0.003; },
  };
  const DEAD = P_({ base: [-88, 14, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], head: [-6, 32, 0], armL: [-10, 0, 72], foreL: [-20, 0, 0], armR: [-10, 0, -70], foreR: [-30, 0, 0],
    thighL: [-6, 0, 10], thighR: [-12, 0, -8], shinL: [14, 0, 0], shinR: [22, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0], wpn: [10, 0, 0], off: [-90, 0, 0] },
  { base: [0, d.headR * 0.93, d.hipY + 0.04], hips: [0, 0, 0] });
  clips.dead = { dur: 3, loop: true, keys: [K(0, 'io', DEAD)] };
  // ---- reactions
  const READY = [STANCE, torsoReady, P_(H.ready)];
  clips.hit = {
    dur: 0.4, impact: 0.03, blendIn: 0.025, expr: 'hurt', flutter: 1,
    keys: [
      K(0, 'io', STAND, P_({}, { base: [0, 0, 0] })),
      K(0.06, 'o3', plant([0.006, 0, 0.03], [-0.006, 0, -0.01]), P_({ spine: [-14, 0, 4], chest: [-9, 6, 0], head: [-18, -6, 6], armL: [-26, 0, 34], armR: [-22, 0, -34], foreL: [-40, 0, 0], foreR: [-40, 0, 0] }, { base: [0, 0, -0.075], hips: [0, -0.012, 0] })),
      K(0.18, 'io', plant([0.006, 0, 0.02], [-0.006, 0, -0.01]), P_({ spine: [-6, 0, 2], chest: [-3, 3, 0], head: [-6, -3, 3], armL: [-10, 0, 20], armR: [-10, 0, -20], foreL: [-30, 0, 0], foreR: [-30, 0, 0] }, { base: [0, 0, -0.085], hips: [0, -0.016, 0] })),
      K(0.4, 'io', STAND, P_({ armL: [0, 0, 10], armR: [0, 0, -10], foreL: [-20, 0, 0], foreR: [-20, 0, 0] }, { base: [0, 0, 0] })),
    ],
    ctl: ['base', 'hips', 'spine', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR'],
  };
  clips.dodge = {
    dur: 0.45, impact: 0.18, blendIn: 0.04, flutter: 1,
    keys: [
      K(0, 'io', STAND, P_({}, { base: [0, 0, 0] })),
      K(0.08, 'o', plant([0.01, 0, 0.0], [-0.01, 0, -0.01]), P_({ spine: [8, 0, 0] }, { base: [0, 0, -0.02], hips: [0, -0.035, 0] })),
      K(0.2, 'o', plant([0.01, 0.045, 0.04], [-0.01, 0.03, -0.02]), P_({ spine: [-12, 0, 0], chest: [-6, 0, 0], head: [6, 0, 0], armL: [-30, 0, 40], armR: [-30, 0, -40], foreL: [-50, 0, 0], foreR: [-50, 0, 0] }, { base: [0, 0.06, -0.24], hips: [0, -0.01, 0] })),
      K(0.3, 'i', plant([0.012, 0, 0.03], [-0.012, 0, -0.03]), P_({ spine: [10, 0, 0], armL: [-20, 0, 30], armR: [-20, 0, -30], foreL: [-40, 0, 0], foreR: [-40, 0, 0] }, { base: [0, 0, -0.28], hips: [0, -0.04, 0] })),
      K(0.45, 'io', STAND, P_({}, { base: [0, 0, 0] })),
    ],
    ctl: ['base', 'hips', 'spine', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR'],
  };
  clips.death = {
    dur: 1.0, impact: 0.7, blendIn: 0.03, expr: 'hurt', flutter: 0.6, all: true,
    keys: [
      K(0, 'io', STAND, P_({ ...H.idle, spine: [-10, 0, 0], head: [-14, 0, 0] }, { base: [0, 0, -0.03] })),
      K(0.24, 'o', plant([0.012, 0, 0.03], [-0.012, 0, -0.01]), P_({ ...H.idle, spine: [24, 0, 4], chest: [12, 0, 0], head: [22, 0, 6], armL: [8, 0, 22], armR: [8, 0, -22], foreL: [-10, 0, 0], foreR: [-10, 0, 0] }, { base: [0, 0, -0.04], hips: [0, -0.1, 0] })),
      K(0.46, 'i', P_({ base: [-38, 6, 0], spine: [-4, 0, 0], chest: [-6, 0, 0], head: [-16, 12, 0], armL: [-40, 0, 50], armR: [-40, 0, -50], foreL: [-30, 0, 0], foreR: [-30, 0, 0],
        thighL: [-70, 0, 8], thighR: [-60, 0, -8], shinL: [100, 0, 0], shinR: [90, 0, 0], wpn: [120, 0, 30] }, { base: [0, 0.07, 0.04], hips: [0, -0.06, 0] })),
      K(0.7, 'i3', P_({ ...DEAD.p, base: [-91, 14, 0], head: [-14, 26, 0], armL: [-20, 0, 82], armR: [-20, 0, -80] }, { base: [0, d.headR * 0.93 + 0.012, d.hipY + 0.04] })),
      K(0.84, 'o', P_({ ...DEAD.p, base: [-84, 14, 0] }, { base: [0, d.headR * 0.93 + 0.025, d.hipY + 0.04] })),
      K(1.0, 'io', DEAD),
    ],
  };
  // ---- flourishes
  const up = st === 'bow' ? { armR: [-165, 0, -14], foreR: [-8, 0, 0] } : { armR: [-168, 0, -12], foreR: [-8, 0, 0], wpn: [180, 0, 0] };
  clips.victory = {
    dur: 1.2, impact: 0.5, expr: 'happy', flutter: 0.6,
    keys: [
      K(0, 'io', STAND, P_({ ...H.idle })),
      K(0.16, 'o', plant([0.006, 0, 0.01], [-0.006, 0, -0.01]), P_({ ...H.idle, spine: [12, 0, 0], head: [6, 0, 0] }, { hips: [0, -0.04, 0] })),
      K(0.4, 'o', plant([0.006, 0.03, 0], [-0.006, 0.03, 0]), P_({ ...H.idle, ...up, armL: [-40, 0, 30], foreL: [-90, 0, 0], chest: [-8, 0, 0], head: [-14, 0, 0] }, { base: [0, 0.09, 0] })),
      K(0.62, 'o', STAND, P_({ ...H.idle, ...up, armL: [12, 0, 32], foreL: [-110, 0, 20], chest: [-10, 8, 0], head: [-14, -6, 4] }, { hips: [0, -0.012, 0] })),
      K(1.2, 'io', STAND, P_({ ...H.idle, ...up, armL: [12, 0, 32], foreL: [-110, 0, 20], chest: [-8, 8, 0], head: [-10, -6, 2] })),
    ],
    ctl: ['base'],
  };
  clips.levelup = {
    dur: 1.3, impact: 0.6, expr: 'happy', flutter: 1,
    keys: [
      K(0, 'io', STAND, P_({ ...H.idle })),
      K(0.22, 'o', plant([0.006, 0, 0.01], [-0.006, 0, -0.01]), P_({ ...H.idle, spine: [16, 0, 0], head: [10, 0, 0], armL: [10, 0, 14], armR: [10, 0, -14] }, { hips: [0, -0.05, 0] })),
      K(0.5, 'o', plant([0.006, 0.05, 0.01], [-0.006, 0.05, -0.01]), P_({ ...H.idle, armL: [-160, 0, 28], armR: [-160, 0, -28], foreL: [-6, 0, 0], foreR: [-6, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0], wpn: [180, 0, 0] }, { base: [0, 0.13, 0] })),
      K(0.75, 'o', STAND, P_({ ...H.idle, armL: [-150, 0, 34], armR: [-150, 0, -34], foreL: [-10, 0, 0], foreR: [-10, 0, 0], chest: [-8, 0, 0], head: [-12, 0, 0], wpn: [180, 0, 0] }, { hips: [0, -0.02, 0] })),
      K(1.3, 'io', STAND, P_({ ...H.idle, armL: [-150, 0, 30], armR: [-150, 0, -30], foreL: [-12, 0, 0], foreR: [-12, 0, 0], chest: [-8, 0, 0], head: [-10, 0, 0], wpn: [180, 0, 0] })),
    ],
    fn: (P, t, ctx) => { if (ctx) ctx.glowBoost = Math.max(ctx.glowBoost, Math.exp(-Math.pow((t - 0.6) / 0.25, 2)) * 1.5); },
    ctl: ['base'],
  };
  clips.jump = {
    dur: 0.5, impact: 0.4, flutter: 0.8,
    keys: [
      K(0, 'io', STAND, P_({}, { base: [0, 0, 0] })),
      K(0.1, 'o', STAND, P_({ spine: [10, 0, 0], armL: [16, 0, 12], armR: [16, 0, -12] }, { hips: [0, -0.045, 0] })),
      K(0.25, 'o', plant([0.006, 0.05, 0.01], [-0.006, 0.04, -0.01]), P_({ spine: [-4, 0, 0], armL: [-30, 0, 30], armR: [-30, 0, -30] }, { base: [0, 0.14, 0] })),
      K(0.4, 'i', STAND, P_({ spine: [10, 0, 0], armL: [-10, 0, 20], armR: [-10, 0, -20] }, { hips: [0, -0.035, 0] })),
      K(0.5, 'io', STAND, P_({}, { base: [0, 0, 0] })),
    ],
    ctl: ['base', 'hips', 'spine', 'armL', 'armR'],
  };
  clips.talk = {
    dur: 0.8, impact: 0.3,
    keys: [
      K(0, 'io', P_({ head: [0, 0, 0], chest: [0, 0, 0], armL: [6, 0, 9], foreL: [-14, 0, 0] })),
      K(0.2, 'io', P_({ head: [9, 0, -3], chest: [3, 0, 0], armL: [-42, 0, 26], foreL: [-62, 0, 20] })),
      K(0.42, 'io', P_({ head: [-2, 0, 2], chest: [0, 4, 0], armL: [-48, 0, 30], foreL: [-58, 0, 26] })),
      K(0.6, 'io', P_({ head: [7, 0, 0], chest: [2, 0, 0], armL: [-30, 0, 22], foreL: [-50, 0, 10] })),
      K(0.8, 'io', P_({ head: [0, 0, 0], chest: [0, 0, 0], armL: [6, 0, 9], foreL: [-14, 0, 0] })),
    ],
  };
  // ---- attacks (per weapon style)
  const LUNGE = (z) => plant([0.016, 0, 0.1 + z * 0.2], [-0.013, 0, -0.06]);
  const base = (x, y, z) => P_({}, { base: [x, y, z] });
  const atk = (keys, extra = {}) => ({ dur: 0.75, impact: 0.38, blendIn: 0.06, expr: 'angry', flutter: 1, ctl: ['base', 'hips', 'spine', 'chest', 'head'], ...extra, keys });
  const atk2 = (keys, extra = {}) => atk(keys, { dur: 1.0, impact: 0.55, ...extra });
  const RDY = (...more) => [...READY, base(0, 0, 0), ...more];
  switch (st) {
    case 'sword': case 'axe': case 'great': case 'staff': case 'rod': case 'unarmed': case 'claws': {
      const heavy = st === 'axe' || st === 'great' || st === 'staff';
      const two = st === 'great';
      const raise = heavy
        ? { armR: [-172, 0, -14], foreR: [-40, 0, 0], wpn: [150, 0, 0], ...(two ? { armL: [-165, 0, 10], foreL: [-50, 0, 0] } : { armL: [-50, 0, 30], foreL: [-60, 0, 0] }) }
        : { armR: [-150, 0, -42], foreR: [-30, 0, 0], wpn: [120, 0, 0], armL: [-30, 0, 30], foreL: [-60, 0, 0] };
      const strike = heavy
        ? { armR: [-58, 0, -4], foreR: [-8, 0, 0], wpn: [188, 0, 0], ...(two ? { armL: [-58, 0, -8], foreL: [-10, 0, 0] } : { armL: [12, 0, 36], foreL: [-40, 0, 0] }) }
        : { armR: [-60, 0, 26], foreR: [-12, 0, 0], wpn: [178, 0, 34], armL: [12, 0, 40], foreL: [-40, 0, 0] };
      const follow = heavy
        ? { armR: [-30, 0, 2], foreR: [-6, 0, 0], wpn: [205, 0, 0], ...(two ? { armL: [-30, 0, -6], foreL: [-8, 0, 0] } : {}) }
        : { armR: [-34, 0, 36], foreR: [-10, 0, 0], wpn: [200, 0, 36] };
      clips.attack = atk([
        K(0, 'io', ...RDY()),
        K(0.2, 'o', STANCE, P_({ hips: [0, -20, 0], spine: [-4, -8, 0], chest: [-6, -26, 0], head: [-4, 30, 0], ...raise }, { hips: [0, -0.028, 0], base: [0, 0, -0.02] })),
        K(0.38, 'i3', LUNGE(0.1), P_({ hips: [0, 6, 0], spine: [12, 4, 0], chest: [14, 14, 0], head: [6, -14, 0], ...strike }, { hips: [0, -0.045, 0], base: [0, 0, 0.13] })),
        K(0.52, 'o', LUNGE(0.1), P_({ hips: [0, 8, 0], spine: [14, 6, 0], chest: [16, 20, 0], head: [8, -18, 0], ...strike, ...follow }, { hips: [0, -0.048, 0], base: [0, 0, 0.14] })),
        K(0.75, 'io', ...RDY()),
      ]);
      const spinArm = heavy ? { armR: [-95, 0, -70], foreR: [-10, 0, 0], wpn: [100, 0, 0], ...(two ? { armL: [-95, 0, -40], foreL: [-20, 0, 0] } : {}) }
        : { armR: [-95, 0, -75], foreR: [-8, 0, 0], wpn: [95, 0, 0], armL: [-40, 0, 60], foreL: [-30, 0, 0] };
      clips.attack2 = atk2([
        K(0, 'io', ...RDY()),
        K(0.22, 'o', plant([0.016, 0, 0.06], [-0.016, 0, -0.05]), P_({ hips: [0, -30, 0], spine: [14, -10, 0], chest: [8, -30, 0], head: [4, 40, 0], ...spinArm }, { hips: [0, -0.065, 0], base: [0, 0, -0.03] })),
        K(0.42, 'i', plant([0.008, 0.05, 0.02], [-0.008, 0.06, -0.03]), P_({ base: [0, -250, 0], spine: [-4, 0, 0], chest: [-4, -10, 0], head: [-6, 10, 0], ...spinArm }, { base: [0, 0.13, 0.2] })),
        K(0.55, 'o', plant([0.018, 0, 0.12], [-0.016, 0, -0.08]), P_({ base: [0, -360, 0], hips: [0, 16, 0], spine: [16, 10, 0], chest: [18, 30, 0], head: [8, -26, 0], ...strike }, { hips: [0, -0.06, 0], base: [0, 0, 0.26] })),
        K(0.78, 'o', plant([0.018, 0, 0.12], [-0.016, 0, -0.08]), P_({ base: [0, -360, 0], hips: [0, 18, 0], spine: [14, 10, 0], chest: [16, 34, 0], head: [6, -26, 0], ...strike, ...follow }, { hips: [0, -0.055, 0], base: [0, 0, 0.26] })),
        K(0.99, 'io', ...READY, P_({ base: [0, -360, 0] }, { base: [0, 0, 0] })),
        K(1.0, 'h', ...RDY()),
      ], { flutter: 1.4 });
      break;
    }
    case 'lance': case 'scythe': {
      const lance = st === 'lance';
      const pull = lance ? { armR: [2, 0, -22], foreR: [-82, 0, 0], wpn: [172, 0, 0] } : { armR: [-70, 0, -75], foreR: [-20, 0, 0], wpn: [100, -20, -30], armL: [-70, 0, -40], foreL: [-30, 0, 0] };
      const thrust = lance ? { armR: [-86, 0, -4], foreR: [-4, 0, 0], wpn: [160, 0, 0] } : { armR: [-75, 0, 35], foreR: [-10, 0, 0], wpn: [110, 30, 60], armL: [-60, 0, 30], foreL: [-30, 0, 0] };
      clips.attack = atk([
        K(0, 'io', ...RDY()),
        K(0.22, 'o', STANCE, P_({ hips: [0, -24, 0], spine: [2, -6, 0], chest: [-2, -22, 0], head: [-2, 36, 0], ...pull }, { hips: [0, -0.036, 0], base: [0, 0, -0.05] })),
        K(0.38, 'i3', LUNGE(0.2), P_({ hips: [0, 10, 0], spine: [12, 4, 0], chest: [10, 16, 0], head: [4, -16, 0], ...thrust }, { hips: [0, -0.05, 0], base: [0, 0, 0.2] })),
        K(0.52, 'o', LUNGE(0.2), P_({ hips: [0, 12, 0], spine: [12, 4, 0], chest: [10, 20, 0], head: [4, -18, 0], ...thrust }, { hips: [0, -0.05, 0], base: [0, 0, 0.21] })),
        K(0.75, 'io', ...RDY()),
      ]);
      clips.attack2 = atk2([
        K(0, 'io', ...RDY()),
        K(0.3, 'o', plant([0.016, 0, 0.05], [-0.016, 0, -0.07]), P_({ hips: [0, -34, 0], spine: [6, -10, 0], chest: [-4, -28, 0], head: [-4, 44, 0], ...pull }, { hips: [0, -0.07, 0], base: [0, 0, -0.1] })),
        K(0.42, 'io', plant([0.016, 0, 0.05], [-0.016, 0, -0.07]), P_({ hips: [0, -36, 0], spine: [8, -10, 0], chest: [-2, -30, 0], head: [-4, 44, 0], ...pull }, { hips: [0, -0.075, 0], base: [0, 0, -0.11] })),
        K(0.55, 'i3', plant([0.018, 0.02, 0.18], [-0.014, 0.03, -0.1]), P_({ hips: [0, 12, 0], spine: [16, 4, 0], chest: [12, 18, 0], head: [6, -18, 0], ...thrust }, { hips: [0, -0.04, 0], base: [0, 0.04, 0.4] })),
        K(0.78, 'o', plant([0.018, 0, 0.16], [-0.014, 0, -0.1]), P_({ hips: [0, 12, 0], spine: [14, 4, 0], chest: [10, 20, 0], head: [4, -18, 0], ...thrust }, { hips: [0, -0.055, 0], base: [0, 0, 0.42] })),
        K(1.0, 'io', ...RDY()),
      ], { fn: (P, t, ctx) => { if (ctx && t > 0.2 && t < 0.56) { ctx.glowBoost = Math.max(ctx.glowBoost, (t - 0.2) * 3); P[iChest * 6 + 1] += Math.sin(t * 90) * 0.02; } } });
      break;
    }
    case 'twin': {
      const back = { armR: [24, 0, -34], foreR: [-50, 0, 0], armL: [24, 0, 34], foreL: [-50, 0, 0], wpn: [110, 0, 0], off: [10, 0, 0] };
      const stabR = { armR: [-88, 0, -6], foreR: [-4, 0, 0], wpn: [182, 0, 0] };
      const stabL = { armL: [-88, 0, 6], foreL: [-4, 0, 0], off: [0, 0, 0] };
      clips.attack = atk([
        K(0, 'io', ...RDY()),
        K(0.16, 'o', STANCE, P_({ spine: [16, 0, 0], chest: [8, 0, 0], head: [-10, 0, 0], ...back }, { hips: [0, -0.05, 0], base: [0, 0, -0.02] })),
        K(0.29, 'i3', LUNGE(0.1), P_({ hips: [0, 14, 0], spine: [14, 6, 0], chest: [8, 16, 0], head: [-6, -14, 0], ...back, ...stabR }, { hips: [0, -0.05, 0], base: [0, 0, 0.14] })),
        K(0.38, 'i3', LUNGE(0.12), P_({ hips: [0, -10, 0], spine: [14, -6, 0], chest: [8, -18, 0], head: [-6, 16, 0], ...stabR, ...stabL, armR: [-20, 0, -30], foreR: [-60, 0, 0] }, { hips: [0, -0.05, 0], base: [0, 0, 0.17] })),
        K(0.52, 'o', LUNGE(0.12), P_({ hips: [0, -6, 0], spine: [12, -4, 0], chest: [8, -10, 0], head: [-4, 10, 0], ...stabL, ...stabR }, { hips: [0, -0.05, 0], base: [0, 0, 0.17] })),
        K(0.75, 'io', ...RDY()),
      ]);
      const cross = { armR: [-80, 0, 40], foreR: [-10, 0, 0], wpn: [180, 0, 40], armL: [-80, 0, -40], foreL: [-10, 0, 0], off: [0, 0, -40] };
      clips.attack2 = atk2([
        K(0, 'io', ...RDY()),
        K(0.2, 'o', plant([0.016, 0, 0.04], [-0.016, 0, -0.04]), P_({ spine: [18, 0, 0], head: [-12, 0, 0], ...back }, { hips: [0, -0.07, 0] })),
        K(0.42, 'i', plant([0.01, 0.06, 0.02], [-0.01, 0.05, -0.02]), P_({ base: [0, -300, 0], spine: [4, 0, 0], armR: [-90, 0, -80], armL: [-90, 0, 80], foreR: [0, 0, 0], foreL: [0, 0, 0], wpn: [90, 0, 0], off: [0, 0, 0] }, { base: [0, 0.14, 0.18] })),
        K(0.55, 'o', LUNGE(0.2), P_({ base: [0, -360, 0], spine: [16, 0, 0], chest: [10, 0, 0], head: [-8, 0, 0], ...cross }, { hips: [0, -0.06, 0], base: [0, 0, 0.26] })),
        K(0.78, 'o', LUNGE(0.2), P_({ base: [0, -360, 0], spine: [14, 0, 0], chest: [8, 0, 0], head: [-6, 0, 0], ...cross, armR: [-60, 0, 60], armL: [-60, 0, -60] }, { hips: [0, -0.055, 0], base: [0, 0, 0.26] })),
        K(0.99, 'io', ...READY, P_({ base: [0, -360, 0] }, { base: [0, 0, 0] })),
        K(1.0, 'h', ...RDY()),
      ], { flutter: 1.4 });
      break;
    }
    case 'bow': {
      const aim = { armL: [0, -34, 88], foreL: [0, 0, 0], off: [0, 90, 0] };
      const drawn = { armR: [-72, -30, -12], foreR: [-112, 0, 0] };
      const shootClip = (dur, rel, power) => ({
        dur, impact: rel, blendIn: 0.08, flutter: power ? 1.2 : 0.6, expr: power ? 'angry' : null,
        ctl: ['base', 'hips', 'spine', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'off', 'nock'],
        keys: [
          K(0, 'io', ...READY),
          K(rel * 0.28, 'o', STANCE, P_({ hips: [0, -22, 0], spine: [2, -8, 0], chest: [0, -24, 0], head: [-2, 50, 0], ...aim, armR: [-70, 0, -24], foreR: [-80, 0, 0] }, { hips: [0, -0.03, 0], nock: [0, 0.0, 0] })),
          K(rel * 0.8, 'io', STANCE, P_({ hips: [0, -22, 0], spine: [2, -8, 0], chest: [-4, -25, 0], head: [-2, 52, 0], ...aim, ...drawn }, { hips: [0, -0.035, 0], nock: [0, power ? 0.19 : 0.16, 0] })),
          K(rel - 0.001, 'l', STANCE, P_({ hips: [0, -22, 0], spine: [2, -8, 0], chest: [-4, -25, 0], head: [-2, 52, 0], ...aim, ...drawn }, { hips: [0, -0.035, 0], nock: [0, power ? 0.2 : 0.17, 0] })),
          K(rel + 0.06, 'o3', STANCE, P_({ hips: [0, -22, 0], spine: [-2, -8, 0], chest: [-8, -25, 0], head: [-4, 52, 0], ...aim, armR: [-60, 0, -70], foreR: [-40, 0, 0] }, { hips: [0, -0.035, 0], nock: [0, -0.012, 0], base: [0, 0, power ? -0.06 : -0.02] })),
          K(rel + 0.14, 'io', STANCE, P_({ hips: [0, -22, 0], spine: [0, -8, 0], chest: [-6, -24, 0], head: [-2, 50, 0], ...aim, armR: [-55, 0, -60], foreR: [-50, 0, 0] }, { hips: [0, -0.03, 0], nock: [0, 0.004, 0] })),
          K(dur, 'io', ...READY),
        ],
        fn: (P, t, ctx) => {
          if (ctx && t > rel * 0.2 && t < rel) ctx.arrow = true;
          if (t > rel * 0.8 && t < rel) P[iChest * 6 + 1] += Math.sin(t * 70) * 0.006;
          if (power && ctx && t > 0.3 && t < rel) ctx.glowBoost = Math.max(ctx.glowBoost, (t - 0.3) * 2);
        },
      });
      clips.shoot = shootClip(1.0, 0.6, false);
      clips.attack2 = shootClip(1.0, 0.55, true);
      break;
    }
  }
  // ---- casting (staff / rod raise, channel, release)
  const castUp = st === 'bow' ? { armR: [-150, 0, -24], foreR: [-20, 0, 0], armL: [-150, 0, 24], foreL: [-20, 0, 0], off: [-90, 0, 0] }
    : st === 'lance' || st === 'great' || st === 'axe' || st === 'sword' || st === 'twin' || st === 'scythe' || st === 'claws' || st === 'unarmed'
      ? { armR: [-30, 0, -16], foreR: [-50, 0, 0], armL: [-150, 0, 26], foreL: [-24, 0, 0] }
      : { armR: [-166, 0, -16], foreR: [-8, 0, 0], wpn: [178, 0, 0], armL: [-118, 0, 34], foreL: [-34, 0, 0] };
  const castOut = st === 'staff' || st === 'rod'
    ? { armR: [-86, 0, -8], foreR: [-6, 0, 0], wpn: [150, 0, 0], armL: [-84, 0, 18], foreL: [-12, 0, 0] }
    : { armR: [-30, 0, -16], foreR: [-50, 0, 0], armL: [-88, 0, 8], foreL: [-6, 0, 0] };
  clips.cast = {
    dur: 1.1, impact: 0.75, blendIn: 0.08, flutter: 0.8,
    ctl: ['base', 'hips', 'spine', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'wpn', 'off'],
    keys: [
      K(0, 'io', ...READY),
      K(0.26, 'o', STAND, P_({ spine: [-6, 0, 0], chest: [-8, 0, 0], head: [-14, 0, 0], ...castUp }, { hips: [0, -0.01, 0] })),
      K(0.62, 'io', STAND, P_({ spine: [-8, 0, 0], chest: [-10, 0, 0], head: [-16, 0, 0], ...castUp }, { hips: [0, -0.016, 0], base: [0, 0.01, 0] })),
      K(0.75, 'i3', LUNGE(-0.2), P_({ spine: [12, 0, 0], chest: [12, 0, 0], head: [2, 0, 0], ...castOut }, { hips: [0, -0.035, 0], base: [0, 0, 0.06] })),
      K(0.88, 'o', LUNGE(-0.2), P_({ spine: [14, 0, 0], chest: [12, 0, 0], head: [2, 0, 0], ...castOut }, { hips: [0, -0.04, 0], base: [0, 0, 0.065] })),
      K(1.1, 'io', ...READY),
    ],
    fn: (P, t, ctx) => {
      if (!ctx) return;
      if (t > 0.2 && t < 0.75) { const k = (t - 0.2) / 0.55; ctx.glowBoost = Math.max(ctx.glowBoost, k * 1.4); P[iChest * 6 + 1] += Math.sin(t * 48) * 0.012 * k; P[iHips * 6 + 4] += Math.sin(t * 9) * 0.004; }
      else if (t >= 0.75 && t < 0.95) ctx.glowBoost = Math.max(ctx.glowBoost, 1.8 * (1 - (t - 0.75) / 0.2));
    },
  };
  if (!clips.shoot) clips.shoot = st === 'staff' || st === 'rod' ? clips.cast : clips.attack;
  if (!clips.attack && clips.shoot) clips.attack = clips.shoot;
  if (B.look.mount) mountify(clips, H);
  return clips;
}

/** Seat a rider: keep upper-body animation, replace hips/legs with a straddling pose. */
function mountify(clips, H) {
  const SEAT = { hips: [-8, 0, 0], thighL: [-78, 0, 34], thighR: [-78, 0, -34], shinL: [84, 0, 0], shinR: [84, 0, 0], footL: [20, 0, 0], footR: [20, 0, 0] };
  const seatKey = (k) => {
    const p = { ...k.p, ...SEAT };
    if (p.base) p.base = [0, 0, 0];
    return { ...k, p, o: { nock: k.o.nock || [0, 0, 0] } };
  };
  for (const name of Object.keys(clips)) {
    const c = clips[name];
    clips[name] = { ...c, keys: c.keys.map(seatKey) };
  }
  const ride = { spine: [10, 0, 0], chest: [4, 0, 0], head: [-10, 0, 0], ...H.ready, ...SEAT };
  clips.fly = {
    dur: 0.9, loop: true, keys: [K(0, 'io', P_(ride)), K(0.45, 'io', P_({ ...ride, spine: [12, 0, 0], head: [-12, 0, 0] }))],
  };
  clips.idle = clips.fly; clips.ready = clips.fly; clips.walk = clips.fly; clips.run = clips.fly;
  clips.hurt = { dur: 1.4, loop: true, keys: [K(0, 'io', P_({ ...ride, spine: [24, 0, 4], chest: [10, 0, 0], head: [16, 0, 6], armL: [-30, 0, 18], foreL: [-90, 0, 0] }))] };
  const slump = { ...ride, spine: [52, 0, 8], chest: [20, 0, 0], head: [30, 20, 0], armL: [-40, 0, 30], armR: [-40, 0, -30], foreL: [-10, 0, 0], foreR: [-10, 0, 0] };
  clips.dead = { dur: 3, loop: true, keys: [K(0, 'io', P_(slump))] };
  clips.death = { dur: 1.0, impact: 0.7, expr: 'hurt', all: true, keys: [K(0, 'io', P_({ ...ride, spine: [-14, 0, 0], head: [-18, 0, 0] })), K(0.4, 'o', P_({ ...ride, spine: [30, 0, 4], head: [20, 0, 0] })), K(1.0, 'io', P_(slump))] };
}

// ------------------------------------------------------------------ assembly
/**
 * Build the (cacheable) blueprint for a humanoid look: rig, merged skinned layers, anchors,
 * spring chains and clip definitions.
 */
export function buildHumanoid(look, opts = {}) {
  const B = new HumanoidBuild(look, opts);
  const d = B.d;
  const def = humanoidRig(look, d, hairChains(look, d));
  const A = new Assembler(def);
  const sp = dressSpec(B);
  addBody(B, A, sp);
  addDress(B, A, sp);
  addHair(B, A);
  addHeadgear(B, A, sp);
  addFacial(B, A);
  addCapeScarf(B, A, sp);
  const wpn = addWeapon(B, A);
  const chains = [];
  if (B.flags.cape) chains.push({ kind: 'cape', bones: ['cape0', 'cape1', 'cape2', 'cape3'], base: 0.14 });
  if (B.flags.scarf) chains.push({ kind: 'scarf', bones: ['scarf0', 'scarf1', 'scarf2'], base: 0.5, phase: 1.3 });
  if (def.has('hairA0')) chains.push({ kind: 'hair', bones: ['hairA0', 'hairA1', 'hairA2'], amp: 1 });
  if (def.has('hairB0')) chains.push({ kind: 'hair', bones: ['hairB0', 'hairB1', 'hairB2'], amp: 1, phase: 1.7 });
  const top = d.headY + d.headR * d.headS[1] + (B.hatTop || 0.03);
  const hy = d.shY - d.upper - d.fore;
  const anchors = {
    head: { bone: 'head', at: [0, d.headY, 0] },
    chest: { bone: 'chest', at: [0, d.chestY + 0.03, 0.02] },
    hand: { bone: 'handR', at: [-d.shX, hy - 0.01, 0] },
    mouth: { bone: 'head', at: [0, d.headY - 0.1, d.headR * 0.95] },
    weapon: wpn.tip || { bone: 'handR', at: [-d.shX, hy - 0.01, 0] },
  };
  return {
    kind: 'humanoid', quality: opts.quality || 'high', def, layers: A.build(), dims: d,
    height: top, radius: Math.max(0.9, (wpn.reach || 0.5) + 0.5),
    face: B.flags.noFace ? null : { bone: 'head', at: [0, d.headY - d.neckY, 0], scl: [d.headR * d.headS[0], d.headR * d.headS[1], d.headR * d.headS[2]] },
    anchors, chains, clips: humanoidClips(B, wpn, def), post: humanoidPost(def, d), alias: wpn.alias || {}, loopAlias: look.mount ? { idle: 'fly', walk: 'fly', run: 'fly', ready: 'fly' } : { fly: 'idle' },
    defaultLoop: look.mount ? 'fly' : 'idle', hover: 0, arrow: wpn.arrow || null, auraRadius: 0.5,
  };
}

