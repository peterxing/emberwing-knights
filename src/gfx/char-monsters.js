// Monsters (wolf, skeleton, wraith, golem, wyrm) and the wyvern mount: rigs, skinned parts and clips.
import * as THREE from 'three';
import { shade } from './toon.js';
import { RigDef, Assembler, prim, sweepGeo, stripGeo, chainWeightsAxis, partMatrix, D2R, clamp } from './char-anim.js';
import { HumanoidBuild, humanoidRig, humanoidClips, humanoidPost, addWeapon, metal, gradY } from './char-humanoid.js';

const C = (hex) => new THREE.Color(hex);
const K = (t, e, p = {}, o = {}) => ({ t, e, p, o });

/** Colour fn: top colour with a lighter underside (bellies) and a darker back ridge. */
function bellyFn(top, belly, split = -0.25) {
  const a = C(top), b = C(belly), dk = C(shade(top, -0.25));
  return (p, n, out) => {
    out.copy(a);
    if (n.y < split) out.lerp(b, clamp((split - n.y) / 0.4, 0, 1));
    else if (n.y > 0.75) out.lerp(dk, (n.y - 0.75) * 2);
  };
}

/** Tapered tube through bone positions (necks, tails), weighted along the chain. */
function chainTube(A, key, names, radius, color, { extraStart = null, extraEnd = null, radial = 10, seg = 12, ol = 1, layer = 'body' } = {}) {
  const def = A.def;
  const pts = names.map((n) => def.pos[def.idx(n)].toArray());
  if (extraStart) pts.unshift(extraStart);
  if (extraEnd) pts.push(extraEnd);
  const first = def.pos[def.idx(names[0])], last = def.pos[def.idx(names[names.length - 1])];
  const axis = [last.x - first.x, last.y - first.y, last.z - first.z];
  A.add(sweepGeo(key, pts, radius, { seg, radial, side: [1, 0, 0] }), { bone: names[0], color, w: chainWeightsAxis(def, names, axis), ol, layer });
}

/** Limb segment between two bone rest positions (cached per shape). */
function limb(A, key, bone, a, b, r0, r1, color, radial = 8, ol = 1) {
  A.add(sweepGeo(key, [[0, 0, 0], [(b[0] - a[0]) * 0.5, (b[1] - a[1]) * 0.5, (b[2] - a[2]) * 0.5], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]], (u) => r0 + (r1 - r0) * u, { seg: 3, radial }),
    { bone, at: a, color, ol });
}

// ------------------------------------------------------------------ wolf
function buildWolf(look, q) {
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('body', 'base', 0, 0.36, 0);
  R.bone('chest', 'body', 0, 0.37, 0.1);
  R.bone('rump', 'body', 0, 0.36, -0.13);
  R.bone('neck', 'chest', 0, 0.43, 0.18);
  R.bone('head', 'neck', 0, 0.5, 0.25);
  R.bone('jaw', 'head', 0, 0.465, 0.31);
  ['tail0', 'tail1', 'tail2'].forEach((n, i) => R.bone(n, i ? `tail${i - 1}` : 'rump', 0, 0.41 - i * 0.03, -0.22 - i * 0.09));
  for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
    R.bone('fu' + side, 'chest', s * 0.065, 0.31, 0.13);
    R.bone('fl' + side, 'fu' + side, s * 0.065, 0.17, 0.15);
    R.bone('fp' + side, 'fl' + side, s * 0.065, 0.03, 0.16);
    R.bone('bu' + side, 'rump', s * 0.065, 0.31, -0.15);
    R.bone('bl' + side, 'bu' + side, s * 0.065, 0.17, -0.2);
    R.bone('bp' + side, 'bl' + side, s * 0.065, 0.03, -0.17);
  }
  const A = new Assembler(R);
  const s = (n) => Math.max(5, Math.round(n * q));
  const col = look.color ?? 0x6b6f7a, belly = look.belly ?? 0xbfc3cc;
  const fur = bellyFn(col, belly);
  A.add(prim.sphere(s(18), s(12)), { bone: 'chest', at: [0, 0.375, 0.07], scl: [0.122, 0.13, 0.16], color: fur });
  A.add(prim.sphere(s(16), s(12)), { bone: 'rump', at: [0, 0.36, -0.12], scl: [0.1, 0.1, 0.13], color: fur });
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 2.6;
    const pts = [[Math.sin(a) * 0.09, 0.42 + Math.cos(a) * 0.05, 0.16], [Math.sin(a) * 0.12, 0.42 + Math.cos(a) * 0.07, 0.08], [Math.sin(a) * 0.12, 0.4 + Math.cos(a) * 0.06, -0.0]];
    A.add(sweepGeo(`ruff${i}`, pts, (u) => [0.045 * (1 - u), 0.02 * (1 - u)], { seg: 5, radial: 5, side: [Math.cos(a), -Math.sin(a), 0] }), { bone: 'chest', color: shade(col, 0.08), ol: 0.8 });
  }
  A.add(sweepGeo('wolfNeck', [[0, 0.4, 0.12], [0, 0.45, 0.2], [0, 0.49, 0.25]], (u) => [0.075 - u * 0.015, 0.08 - u * 0.02], { seg: 6, radial: 10 }), { bone: 'neck', color: fur, ol: 0.6 });
  A.add(prim.sphere(s(16), s(12)), { bone: 'head', at: [0, 0.515, 0.26], scl: [0.098, 0.09, 0.105], color: fur });
  A.add(sweepGeo('snout', [[0, 0.495, 0.31], [0, 0.487, 0.37], [0, 0.477, 0.425]], (u) => [0.054 - u * 0.018, 0.04 - u * 0.012], { seg: 5, radial: 10 }), { bone: 'head', color: fur });
  A.add(prim.sphere(8, 6), { bone: 'head', at: [0, 0.49, 0.428], scl: [0.02, 0.016, 0.014], color: 0x1a1418, ol: 0.5 });
  for (const sx of [-1, 1]) {
    A.add(prim.cone(s(6)), { bone: 'head', at: [sx * 0.058, 0.6, 0.235], rot: [-0.35, 0, -sx * 0.32], scl: [0.04, 0.1, 0.022], color: (p, n, o) => o.set(n.z > 0.3 ? shade(belly, -0.2) : col), ol: 0.8 });
    A.add(prim.sphere(8, 6), { bone: 'head', layer: 'glow', at: [sx * 0.048, 0.522, 0.345], rot: [0, sx * 0.4, sx * 0.35], scl: [0.022, 0.011, 0.007], color: look.eyes ?? 0xffd04a, glow: 2.6 });
    A.add(prim.box(), { bone: 'head', at: [sx * 0.046, 0.541, 0.34], rot: [0, 0, sx * 0.4], scl: [0.05, 0.01, 0.016], color: shade(col, -0.45), ol: 0, hard: true });
    for (let k = 0; k < 2; k++) A.add(prim.cone(4), { bone: 'head', at: [sx * (0.02 + k * 0.012), 0.462, 0.395 - k * 0.03], rot: [Math.PI, 0, 0], scl: [0.006, 0.02, 0.006], color: 0xf4f1e8, ol: 0.3 });
  }
  A.add(sweepGeo('wolfJaw', [[0, 0.455, 0.3], [0, 0.45, 0.35], [0, 0.452, 0.4]], (u) => [0.034 - u * 0.012, 0.016], { seg: 5, radial: 8 }), { bone: 'jaw', color: shade(belly, -0.1) });
  for (const sx of [-1, 1]) A.add(prim.cone(4), { bone: 'jaw', at: [sx * 0.02, 0.47, 0.385], scl: [0.006, 0.018, 0.006], color: 0xf4f1e8, ol: 0.3 });
  const tailPts = ['tail0', 'tail1', 'tail2'].map((n) => R.pos[R.idx(n)].toArray()).concat([[0, 0.3, -0.48]]);
  A.add(sweepGeo('wolfTail', tailPts, (u) => 0.055 * Math.sin(Math.PI * Math.min(1, 0.25 + u * 0.8)) + 0.008, { seg: s(10), radial: s(8) }),
    { bone: 'tail0', w: chainWeightsAxis(R, ['tail0', 'tail1', 'tail2'], [0, -0.3, -1]), color: (p, n, o, mp) => o.copy(C(col)).lerp(C(belly), clamp((-0.4 - mp.z) / 0.08, 0, 1)) });
  for (const side of ['L', 'R']) {
    for (const f of ['f', 'b']) {
      const u = R.pos[R.idx(f + 'u' + side)].toArray(), l = R.pos[R.idx(f + 'l' + side)].toArray(), p = R.pos[R.idx(f + 'p' + side)].toArray();
      limb(A, `wl${f}u`, f + 'u' + side, [u[0], u[1] + 0.03, u[2]], l, f === 'b' ? 0.054 : 0.044, 0.03, fur);
      limb(A, `wl${f}l`, f + 'l' + side, l, p, 0.029, 0.023, fur);
      A.add(prim.sphere(s(10), s(6)), { bone: f + 'p' + side, at: [p[0], p[1] - 0.004, p[2] + 0.016], scl: [0.036, 0.026, 0.05], color: shade(col, -0.15) });
    }
  }
  return {
    kind: 'wolf', def: R, layers: A.build(), height: 0.62, radius: 0.9, face: null,
    anchors: { head: { bone: 'head', at: [0, 0.51, 0.27] }, chest: { bone: 'chest', at: [0, 0.38, 0.08] }, mouth: { bone: 'jaw', at: [0, 0.465, 0.42] },
      weapon: { bone: 'jaw', at: [0, 0.47, 0.43] }, hand: { bone: 'fpR', at: [-0.065, 0.03, 0.17] } },
    chains: [{ kind: 'tail', bones: ['tail0', 'tail1', 'tail2'] }], clips: wolfClips(), alias: { shoot: 'attack', cast: 'victory' }, loopAlias: { fly: 'idle' }, defaultLoop: 'idle', hover: 0,
  };
}

function quadGait(names, { dur, amp, lift, phases, bob, pitch = 0, flex = 0, head = 0 }) {
  const legs = names.legs;
  return (P, t) => {
    const ph = (t / dur) * Math.PI * 2;
    for (let i = 0; i < legs.length; i++) {
      const u = legs[i][0], l = legs[i][1], p = legs[i][2];
      const f = ph + phases[i] * Math.PI * 2;
      const c = Math.cos(f), s = Math.sin(f);
      P[u * 6] += amp * c * D2R;
      P[l * 6] += lift * Math.max(0, s) * D2R * (i < 2 ? 1 : -0.6);
      P[p * 6] += -lift * 0.6 * Math.max(0, s) * D2R;
    }
    P[names.base * 6 + 4] += bob * (0.5 + 0.5 * Math.cos(2 * ph));
    if (pitch) P[names.base * 6] += pitch * Math.sin(ph) * D2R;
    if (flex) { P[names.front * 6] += flex * Math.sin(ph) * D2R; P[names.back * 6] -= flex * Math.sin(ph) * D2R; }
    if (head) P[names.head * 6] += head * Math.sin(2 * ph) * D2R;
  };
}

function wolfClips() {
  const idx = (n) => WOLF_NAMES.indexOf(n);
  const names = { base: idx('base'), front: idx('chest'), back: idx('rump'), head: idx('head'), legs: [['fuL', 'flL', 'fpL'], ['fuR', 'flR', 'fpR'], ['buL', 'blL', 'bpL'], ['buR', 'blR', 'bpR']].map((a) => a.map(idx)) };
  const stand = { head: [-6, 0, 0], neck: [-4, 0, 0], tail0: [-20, 0, 0], tail1: [10, 0, 0] };
  const crouch = { body: [6, 0, 0], chest: [6, 0, 0], neck: [10, 0, 0], head: [6, 0, 0], jaw: [12, 0, 0], fuL: [-14, 0, 0], fuR: [-14, 0, 0], flL: [26, 0, 0], flR: [26, 0, 0], fpL: [-10, 0, 0], fpR: [-10, 0, 0], buL: [-26, 0, 0], buR: [-26, 0, 0], blL: [40, 0, 0], blR: [40, 0, 0], tail0: [-6, 0, 0] };
  const DEAD = { base: [0, 0, 84], body: [0, 0, 0], neck: [-14, 0, 6], head: [-10, 0, 12], jaw: [12, 0, 0], fuL: [-24, 0, 0], flL: [20, 0, 0], fuR: [-34, 0, -8], flR: [10, 0, 0], buL: [16, 0, 0], blL: [-12, 0, 0], buR: [24, 0, -6], tail0: [20, 0, 0] };
  const DEADO = { base: [0.06, 0.03, 0] };
  return {
    idle: { dur: 2.2, loop: true, keys: [K(0, 'io', stand), K(1.1, 'io', { ...stand, neck: [-6, 0, 0], head: [-8, 0, 2] }, { body: [0, 0.006, 0] })],
      fn: (P, t) => { P[idx('tail1') * 6 + 1] += Math.sin(t * 2.4) * 0.25; P[idx('tail2') * 6 + 1] += Math.sin(t * 2.4 - 0.8) * 0.3; P[idx('head') * 6 + 1] += Math.sin(t * 0.5) * 0.2; } },
    walk: { dur: 0.8, loop: true, keys: [K(0, 'io', stand)], fn: quadGait(names, { dur: 0.8, amp: 22, lift: 32, phases: [0, 0.5, 0.6, 0.1], bob: 0.008, head: 2 }) },
    run: { dur: 0.42, loop: true, keys: [K(0, 'io', { ...stand, neck: [8, 0, 0], tail0: [-50, 0, 0] })], fn: quadGait(names, { dur: 0.42, amp: 38, lift: 55, phases: [0, 0.08, 0.5, 0.58], bob: 0.03, pitch: 6, flex: 10 }) },
    ready: { dur: 1.0, loop: true, keys: [K(0, 'io', crouch, { body: [0, -0.04, 0] }), K(0.5, 'io', { ...crouch, jaw: [18, 0, 0] }, { body: [0, -0.046, 0] })] },
    hurt: { dur: 1.4, loop: true, keys: [K(0, 'io', { neck: [16, 0, 0], head: [10, 0, 8], fuL: [-40, 0, 0], flL: [70, 0, 0], tail0: [30, 0, 0], body: [4, 0, -4] }, { body: [0, -0.02, 0] }), K(0.7, 'io', { neck: [18, 0, 0], head: [12, 0, 6], fuL: [-36, 0, 0], flL: [66, 0, 0], tail0: [32, 0, 0], body: [5, 0, -4] }, { body: [0, -0.026, 0] })] },
    dead: { dur: 3, loop: true, keys: [K(0, 'io', DEAD, DEADO)] },
    attack: { dur: 0.75, impact: 0.38, flutter: 1, all: true, keys: [
      K(0, 'io', stand),
      K(0.2, 'o', crouch, { base: [0, 0, -0.06], body: [0, -0.05, 0] }),
      K(0.32, 'i', { body: [-10, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0], jaw: [40, 0, 0], fuL: [-60, 0, 0], fuR: [-55, 0, 0], buL: [40, 0, 0], buR: [36, 0, 0], tail0: [-40, 0, 0] }, { base: [0, 0.07, 0.26] }),
      K(0.38, 'i3', { body: [6, 0, 0], neck: [10, 0, 0], head: [14, 0, 0], jaw: [0, 0, 0], fuL: [-30, 0, 0], fuR: [-26, 0, 0], buL: [20, 0, 0], buR: [20, 0, 0], tail0: [-30, 0, 0] }, { base: [0, 0.02, 0.32] }),
      K(0.55, 'o', { ...stand, neck: [6, 0, 0], head: [10, 20, 0] }, { base: [0, 0, 0.3] }),
      K(0.75, 'io', stand, { base: [0, 0, 0] }),
    ] },
    attack2: { dur: 1.0, impact: 0.55, flutter: 1.2, all: true, keys: [
      K(0, 'io', stand),
      K(0.25, 'o', crouch, { base: [0, 0, -0.08], body: [0, -0.07, 0] }),
      K(0.45, 'i', { body: [-24, 0, 0], neck: [-10, 0, 0], jaw: [46, 0, 0], fuL: [-80, 0, 0], fuR: [-76, 0, 0], flL: [20, 0, 0], flR: [20, 0, 0], buL: [50, 0, 0], buR: [46, 0, 0], tail0: [-50, 0, 0] }, { base: [0, 0.22, 0.32] }),
      K(0.55, 'i3', { body: [14, 0, 0], neck: [16, 0, 0], head: [18, 0, 0], jaw: [0, 0, 0], fuL: [-40, 0, 0], fuR: [-36, 0, 0], buL: [10, 0, 0], buR: [10, 0, 0] }, { base: [0, 0.04, 0.5] }),
      K(0.72, 'o', { ...crouch, head: [14, -24, 0], neck: [8, -10, 0] }, { base: [0, 0, 0.5], body: [0, -0.03, 0] }),
      K(1.0, 'io', stand, { base: [0, 0, 0] }),
    ] },
    hit: { dur: 0.4, impact: 0.03, blendIn: 0.02, all: true, keys: [
      K(0, 'io', stand), K(0.06, 'o3', { body: [-10, 0, 6], neck: [-24, 0, 0], head: [-18, 16, 0], jaw: [30, 0, 0], tail0: [30, 0, 0] }, { base: [0, 0.02, -0.08] }),
      K(0.2, 'io', { body: [-4, 0, 2], neck: [-8, 0, 0], head: [-6, 6, 0], jaw: [10, 0, 0] }, { base: [0, 0, -0.09] }), K(0.4, 'io', stand, { base: [0, 0, 0] }),
    ] },
    dodge: { dur: 0.45, impact: 0.18, all: true, keys: [
      K(0, 'io', stand), K(0.1, 'o', crouch, { body: [0, -0.04, 0] }),
      K(0.22, 'o', { body: [-14, 0, 0], fuL: [-40, 0, 0], fuR: [-40, 0, 0], buL: [30, 0, 0], buR: [30, 0, 0] }, { base: [0, 0.08, -0.24] }),
      K(0.32, 'i', crouch, { base: [0, 0, -0.27], body: [0, -0.03, 0] }), K(0.45, 'io', stand, { base: [0, 0, 0] }),
    ] },
    death: { dur: 1.0, impact: 0.7, all: true, keys: [
      K(0, 'io', { ...stand, neck: [-20, 0, 0], jaw: [30, 0, 0] }),
      K(0.3, 'o', { ...crouch, neck: [20, 0, 0], head: [10, 0, 0], jaw: [10, 0, 0], fuL: [-30, 0, 0], fuR: [-30, 0, 0], flL: [60, 0, 0], flR: [60, 0, 0] }, { body: [0, -0.1, 0] }),
      K(0.7, 'i', { ...DEAD, base: [0, 0, 94] }, { base: [0.06, 0.02, 0] }),
      K(0.84, 'o', { ...DEAD, base: [0, 0, 80] }, { base: [0.06, 0.04, 0] }),
      K(1.0, 'io', DEAD, DEADO),
    ] },
    victory: { dur: 1.2, impact: 0.5, all: true, keys: [
      K(0, 'io', stand),
      K(0.35, 'o', { body: [-24, 0, 0], rump: [16, 0, 0], neck: [-40, 0, 0], head: [-30, 0, 0], jaw: [36, 0, 0], buL: [-40, 0, 0], buR: [-40, 0, 0], blL: [60, 0, 0], blR: [60, 0, 0], fuL: [14, 0, 0], fuR: [14, 0, 0], tail0: [20, 0, 0] }, { body: [0, -0.02, -0.02] }),
      K(1.0, 'io', { body: [-26, 0, 0], rump: [18, 0, 0], neck: [-44, 0, 0], head: [-34, 0, 0], jaw: [40, 0, 0], buL: [-42, 0, 0], buR: [-42, 0, 0], blL: [62, 0, 0], blR: [62, 0, 0], fuL: [16, 0, 0], fuR: [16, 0, 0], tail0: [20, 0, 0] }, { body: [0, -0.025, -0.02] }),
      K(1.2, 'io', stand),
    ], fn: (P, t) => { if (t > 0.35 && t < 1.0) P[WOLF_NAMES.indexOf('head') * 6 + 2] += Math.sin(t * 30) * 0.03; } },
    jump: { dur: 0.5, impact: 0.4, all: true, keys: [K(0, 'io', stand), K(0.1, 'o', crouch, { body: [0, -0.04, 0] }), K(0.25, 'o', { body: [-10, 0, 0], fuL: [-40, 0, 0], fuR: [-40, 0, 0], buL: [30, 0, 0], buR: [30, 0, 0] }, { base: [0, 0.14, 0] }), K(0.4, 'i', crouch, { body: [0, -0.03, 0] }), K(0.5, 'io', stand)] },
    talk: { dur: 0.8, impact: 0.3, keys: [K(0, 'io', { head: [-6, 0, 0], jaw: [0, 0, 0] }), K(0.2, 'io', { head: [-12, 0, 14], jaw: [22, 0, 0] }), K(0.4, 'io', { head: [-4, 0, -6], jaw: [0, 0, 0] }), K(0.6, 'io', { head: [-10, 0, 10], jaw: [18, 0, 0] }), K(0.8, 'io', { head: [-6, 0, 0], jaw: [0, 0, 0] })] },
  };
}
const WOLF_NAMES = ['base', 'body', 'chest', 'rump', 'neck', 'head', 'jaw', 'tail0', 'tail1', 'tail2',
  'fuL', 'flL', 'fpL', 'buL', 'blL', 'bpL', 'fuR', 'flR', 'fpR', 'buR', 'blR', 'bpR'];

// ------------------------------------------------------------------ skeleton (humanoid rig, bony parts)
function buildSkeleton(look, opts) {
  const col = look.color ?? 0xe9e2cf, dark = shade(col, -0.62), joint = shade(col, -0.12);
  const hl = {
    kind: 'skeleton', gender: 'm', age: 'adult', body: 'slim', skin: col, eyes: { color: look.eyes ?? 0x6ff0ff, shape: 'cold' },
    outfit: { primary: 0x5a4a3a, trim: 0x7a6a4a, belt: 0x3a2e24 }, weapon: look.weapon || 'sword', blade: 0xa39888, accent: 0x6a5a4a, shield: look.shield || null,
  };
  const B = new HumanoidBuild(hl, opts);
  const d = B.d, q = B.q, s = (n) => Math.max(5, Math.round(n * q));
  const R = humanoidRig(hl, d);
  R.bone('jaw', 'head', 0, d.headY - 0.075, 0.03);
  const A = new Assembler(R);
  const hy = d.headY;
  A.add(prim.sphere(s(20), s(14)), { bone: 'head', at: [0, hy + 0.012, -0.012], scl: [0.158, 0.15, 0.165], color: col });
  A.add(prim.sphere(s(14), s(8)), { bone: 'head', at: [0, hy - 0.045, 0.05], scl: [0.115, 0.07, 0.1], color: col });
  for (const sx of [-1, 1]) {
    A.add(prim.sphere(s(10), s(8)), { bone: 'head', at: [sx * 0.06, hy - 0.008, 0.134], scl: [0.048, 0.044, 0.024], color: dark, ol: 0 });
    A.add(prim.sphere(8, 6), { bone: 'head', layer: 'glow', at: [sx * 0.058, hy - 0.006, 0.158], scl: [0.017, 0.02, 0.006], color: hl.eyes.color, glow: 3.0 });
  }
  A.add(prim.cone(3), { bone: 'head', at: [0, hy - 0.05, 0.15], rot: [Math.PI, 0, 0], scl: [0.016, 0.026, 0.008], color: dark, ol: 0 });
  for (let i = -3; i <= 3; i++) A.add(prim.box(), { bone: 'head', at: [i * 0.012, hy - 0.083, 0.128 - Math.abs(i) * 0.006], scl: [0.009, 0.016, 0.008], color: 0xf7f3e6, ol: 0.3, hard: true });
  A.add(prim.sphereCut(s(14), s(6), Math.PI / 2 - 1.2, 2.4, 1.6, 0.9), { bone: 'jaw', at: [0, hy - 0.07, 0.025], scl: [0.105, 0.09, 0.105], color: col, ol: 0.8 });
  for (let i = -2; i <= 2; i++) A.add(prim.box(), { bone: 'jaw', at: [i * 0.013, hy - 0.098, 0.118 - Math.abs(i) * 0.006], scl: [0.009, 0.014, 0.008], color: 0xf7f3e6, ol: 0.3, hard: true });
  // spine, ribs, pelvis
  for (let i = 0; i < 5; i++) A.add(prim.cyl(1, 1, 8), { bone: i < 2 ? 'spine' : 'chest', at: [0, d.waistY - 0.02 + i * 0.045, -0.035], scl: [0.017, 0.03, 0.017], color: joint, ol: 0.7 });
  A.add(prim.cyl(1, 1, 8), { bone: 'head', at: [0, d.neckY + 0.02, -0.01], scl: [0.02, 0.06, 0.02], color: joint, ol: 0.6 });
  for (let i = 0; i < 4; i++) {
    const y = d.chestY + 0.075 - i * 0.034, r = 0.085 - Math.abs(i - 1) * 0.008;
    A.add(prim.torus(0.13, 6, s(18)), { bone: 'chest', at: [0, y, 0.0], rot: [-Math.PI / 2 + 0.25, 0, 0], scl: [r, r * 0.8, 0.09], color: col, ol: 0.6 });
  }
  A.add(prim.rbox(0.3, 1), { bone: 'chest', at: [0, d.chestY + 0.03, 0.068], scl: [0.022, 0.12, 0.012], color: col, ol: 0.5 });
  A.add(prim.cyl(1, 1, 8), { bone: 'chest', at: [0, d.shY + 0.004, 0.0], rot: [0, 0, Math.PI / 2], scl: [0.012, d.shX * 2, 0.012], color: col, ol: 0.6 });
  A.add(prim.torus(0.28, 6, s(14)), { bone: 'hips', at: [0, d.hipY + 0.01, 0], rot: [-Math.PI / 2 + 0.3, 0, 0], scl: [0.07, 0.05, 0.4], color: col });
  const cloth = [];
  for (let i = 0; i <= 4; i++) { const v = i / 4, y = d.hipY + 0.02 - v * 0.12; cloth.push([[-0.05 + v * 0.01, y, 0.06 + v * 0.02], [0, y - (i === 4 ? 0.02 : 0), 0.066 + v * 0.02], [0.05 - v * 0.012, y + (i === 4 ? 0.01 : 0), 0.06 + v * 0.02]]); }
  A.add(stripGeo('skelCloth', cloth, 0.008, [0, 0, 1]), { bone: 'hips', color: 0x4a3a2c, ol: 0.6 });
  // limbs: thin bones with knobbly joints
  const bonePart = (bone, a, b, r) => A.add(prim.cyl(1, 1, 8), { bone, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], scl: [r, Math.abs(a[1] - b[1]), r], color: col, ol: 0.8 });
  const knob = (bone, p, r) => A.add(prim.sphere(s(8), s(6)), { bone, at: p, scl: r, color: joint, ol: 0.7 });
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    const x = sx * d.shX, ey = d.shY - d.upper, hyy = ey - d.fore;
    knob('arm' + side, [x, d.shY, 0], 0.026);
    bonePart('arm' + side, [x, d.shY, 0], [x, ey, 0], 0.014);
    knob('fore' + side, [x, ey, 0], 0.02);
    for (const dz of [-0.008, 0.008]) bonePart('fore' + side, [x, ey, dz], [x, hyy + 0.01, dz], 0.009);
    A.add(prim.sphere(8, 6), { bone: 'hand' + side, at: [x, hyy - 0.006, 0], scl: [0.024, 0.026, 0.02], color: col, ol: 0.7 });
    const lx = sx * d.legX, ky = d.hipY - 0.01 - d.thigh;
    knob('thigh' + side, [lx, d.hipY - 0.005, 0], 0.024);
    bonePart('thigh' + side, [lx, d.hipY - 0.01, 0], [lx, ky, 0], 0.016);
    knob('shin' + side, [lx, ky, 0.004], 0.024);
    bonePart('shin' + side, [lx, ky, 0], [lx, d.ankleY + 0.01, 0], 0.013);
    A.add(prim.rbox(0.4, 1), { bone: 'foot' + side, at: [lx, 0.018, 0.022], scl: [0.045, 0.026, 0.085], color: col, ol: 0.8 });
  }
  const wpn = addWeapon(B, A);
  const clips = humanoidClips(B, wpn, R);
  const baseIdle = clips.idle.fn;
  const ij = R.idx('jaw'), ih = R.idx('head'), ic = R.idx('chest');
  clips.idle = { ...clips.idle, fn: (P, t, ctx) => {
    baseIdle(P, t, ctx);
    const step = Math.floor(t * 2.2), frac = t * 2.2 - step;
    const r1 = Math.sin(step * 12.9898) * 43758.5453 % 1;
    P[ih * 6 + 2] += (r1 > 0.5 ? 1 : -1) * 0.12 * Math.max(0, 1 - frac * 3);
    P[ic * 6 + 1] += (r1 - 0.5) * 0.08;
    P[ij * 6] += Math.max(0, Math.sin(t * 17)) * 0.2 * (r1 > 0.2 ? 1 : 0);
  } };
  for (const k of ['attack', 'attack2', 'victory']) {
    const c = clips[k];
    const f = c.fn;
    clips[k] = { ...c, ctl: [...(c.ctl || []), 'jaw'], fn: (P, t, ctx) => { if (f) f(P, t, ctx); P[ij * 6] += Math.max(0, Math.sin(t * 22)) * 0.35; } };
  }
  return {
    kind: 'skeleton', def: R, layers: A.build(), dims: d, height: hy + 0.17, radius: 1.0, face: null,
    anchors: { head: { bone: 'head', at: [0, hy, 0] }, chest: { bone: 'chest', at: [0, d.chestY + 0.03, 0.02] }, hand: { bone: 'handR', at: [-d.shX, d.shY - d.upper - d.fore, 0] },
      mouth: { bone: 'jaw', at: [0, hy - 0.09, 0.12] }, weapon: wpn.tip },
    chains: [], clips, post: humanoidPost(R, d), alias: wpn.alias || {}, loopAlias: { fly: 'idle' }, defaultLoop: 'idle', hover: 0,
  };
}

// ------------------------------------------------------------------ wraith
function buildWraith(look, q) {
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('body', 'base', 0, 0.5, 0);
  R.bone('chest', 'body', 0, 0.62, 0);
  R.bone('head', 'chest', 0, 0.74, 0.02);
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    R.bone('arm' + side, 'chest', sx * 0.13, 0.66, 0);
    R.bone('fore' + side, 'arm' + side, sx * 0.15, 0.54, 0);
    R.bone('hand' + side, 'fore' + side, sx * 0.16, 0.42, 0);
  }
  R.bone('hem0', 'body', 0, 0.42, 0);
  R.bone('hem1', 'hem0', 0, 0.3, 0);
  R.bone('hem2', 'hem1', 0, 0.16, 0);
  const A = new Assembler(R);
  const s = (n) => Math.max(5, Math.round(n * q));
  const col = look.color ?? 0x2a2440, glow = look.glow ?? 0x8affd8, eyes = look.eyes ?? glow;
  const cloth = bellyFn(col, shade(col, -0.3), -0.4);
  const hemW = chainWeightsAxis(R, ['hem0', 'hem1', 'hem2'], [0, -1, 0]);
  const open = 52 * D2R;
  const hood = prim.sphereCut(s(22), s(12), Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, 122 * D2R);
  A.add(hood, { bone: 'head', at: [0, 0.8, -0.01], rot: [0.15, 0, 0], scl: [0.175, 0.18, 0.19], color: cloth });
  A.add(hood, { bone: 'head', at: [0, 0.8, -0.01], rot: [0.15, 0, 0], scl: [0.168, 0.173, 0.183], color: 0x0b0912, invert: true, ol: 0 });
  A.add(prim.sphere(s(14), s(10)), { bone: 'head', at: [0, 0.79, -0.005], scl: [0.135, 0.14, 0.14], color: 0x06050a, ol: 0 });
  A.add(prim.cone(s(8)), { bone: 'head', at: [0, 0.93, -0.12], rot: [-1.1, 0, 0], scl: [0.07, 0.16, 0.05], color: cloth, ol: 0.9 });
  for (const sx of [-1, 1]) A.add(prim.sphere(8, 6), { bone: 'head', layer: 'glow', at: [sx * 0.048, 0.79, 0.128], rot: [0, 0, -sx * 0.35], scl: [0.026, 0.011, 0.006], color: eyes, glow: 2.8 });
  A.add(prim.lathe([[0.19, 0.58], [0.16, 0.62], [0.1, 0.7], [0.07, 0.74]], s(18)), { bone: 'chest', color: cloth });
  A.add(prim.lathe([[0.15, 0.4], [0.14, 0.5], [0.12, 0.6], [0.09, 0.68]], s(18)), { bone: 'chest', color: cloth, ol: 0.8 });
  A.add(prim.lathe([[0.2, 0.24], [0.18, 0.32], [0.155, 0.42], [0.14, 0.48]], s(20)), { bone: 'body', w: hemW, color: cloth, ol: 0.9 });
  const rag = (() => {
    const g = prim.lathe([[0.25, -0.02], [0.23, 0.08], [0.21, 0.18], [0.195, 0.28]], s(28)).clone();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0.0) { const a = Math.atan2(p.getX(i), p.getZ(i)); p.setY(i, y + 0.07 * (0.5 + 0.5 * Math.cos(a * 9)) + 0.03 * Math.cos(a * 23)); }
    }
    g.computeVertexNormals();
    return g;
  })();
  A.add(rag, { bone: 'body', layer: 'trans', w: hemW, color: shade(col, 0.15), alpha: (lp) => clamp((lp.y + 0.02) / 0.22, 0, 1) * 0.85 });
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    A.add(prim.cyl(0.8, 1.15, s(10), true), { bone: 'arm' + side, at: [sx * 0.14, 0.6, 0], scl: [0.04, 0.13, 0.04], color: cloth, ol: 0.8 });
    A.add(prim.cyl(0.85, 1.6, s(12), true), { bone: 'fore' + side, at: [sx * 0.155, 0.48, 0], scl: [0.042, 0.13, 0.042], color: cloth, ol: 0.8 });
    A.add(prim.sphere(8, 6), { bone: 'hand' + side, at: [sx * 0.16, 0.41, 0.01], scl: [0.026, 0.03, 0.022], color: 0x3a3650, ol: 0.7 });
    for (let i = 0; i < 3; i++) {
      const x = sx * 0.16 + (i - 1) * 0.013;
      const pts = [[0, 0, 0], [0, -0.05, 0.03], [0, -0.1, 0.03]];
      A.add(sweepGeo('wclaw', pts, (u) => [0.006 * (1 - u), 0.009 * (1 - u)], { seg: 5, radial: 4 }), { bone: 'hand' + side, layer: 'glow', at: [x, 0.4, 0.02], color: glow, glow: 2.2 });
    }
  }
  const DEAD = { base: [-84, 0, 0], head: [-10, 30, 0], armL: [-20, 0, 70], armR: [-20, 0, -70], foreL: [-10, 0, 0], foreR: [-10, 0, 0] };
  const idle = { body: [4, 0, 0], head: [6, 0, 0], armL: [-16, 0, 14], armR: [-16, 0, -14], foreL: [-30, 0, 0], foreR: [-30, 0, 0] };
  const ready = { body: [12, 0, 0], chest: [6, 0, 0], head: [-4, 0, 0], armL: [-60, 0, 36], armR: [-60, 0, -36], foreL: [-40, 0, 0], foreR: [-40, 0, 0], handL: [20, 0, 0], handR: [20, 0, 0] };
  const H0 = 0.16;
  const hover = (amp, rate) => (P, t) => { P[0 * 6 + 4] += Math.sin(t * rate) * amp; P[R.idx('body') * 6 + 2] += Math.sin(t * rate * 0.5) * 0.05; };
  const clips = {
    idle: { dur: 2.4, loop: true, keys: [K(0, 'io', idle, { base: [0, H0, 0] }), K(1.2, 'io', { ...idle, head: [8, 0, 4], armL: [-20, 0, 16] }, { base: [0, H0, 0] })], fn: hover(0.03, 2.6) },
    walk: { dur: 1.2, loop: true, keys: [K(0, 'io', { ...idle, body: [16, 0, 0], armL: [10, 0, 20], armR: [10, 0, -20] }, { base: [0, H0, 0] })], fn: hover(0.025, 5.2) },
    run: { dur: 1.0, loop: true, keys: [K(0, 'io', { ...idle, body: [28, 0, 0], head: [-14, 0, 0], armL: [30, 0, 24], armR: [30, 0, -24] }, { base: [0, H0 + 0.04, 0] })], fn: hover(0.03, 6.3) },
    ready: { dur: 1.4, loop: true, keys: [K(0, 'io', ready, { base: [0, H0 + 0.02, 0] }), K(0.7, 'io', { ...ready, armL: [-66, 0, 40], armR: [-66, 0, -40] }, { base: [0, H0 + 0.03, 0] })], fn: hover(0.02, 4.5) },
    hurt: { dur: 1.8, loop: true, keys: [K(0, 'io', { body: [20, 0, 8], head: [20, 0, 10], armL: [10, 0, 10], armR: [-40, 0, -20], foreR: [-80, 0, 0] }, { base: [0, 0.07, 0] })], fn: hover(0.015, 2) },
    dead: { dur: 3, loop: true, keys: [K(0, 'io', DEAD, { base: [0, 0.14, 0.32] })] },
    attack: { dur: 0.75, impact: 0.38, flutter: 1, all: true, keys: [
      K(0, 'io', ready, { base: [0, H0, 0] }),
      K(0.2, 'o', { ...ready, body: [-8, -20, 0], chest: [-6, -20, 0], armR: [-160, 0, -40], foreR: [-20, 0, 0], armL: [-40, 0, 40] }, { base: [0, H0 + 0.06, -0.05] }),
      K(0.38, 'i3', { ...ready, body: [24, 20, 0], chest: [10, 24, 0], head: [6, -20, 0], armR: [-60, 0, 30], foreR: [-10, 0, 0], armL: [10, 0, 50] }, { base: [0, H0 - 0.02, 0.28] }),
      K(0.55, 'o', { ...ready, body: [22, 26, 0], chest: [10, 30, 0], armR: [-30, 0, 40], foreR: [-10, 0, 0] }, { base: [0, H0, 0.3] }),
      K(0.75, 'io', ready, { base: [0, H0, 0] }),
    ] },
    attack2: { dur: 1.0, impact: 0.55, flutter: 1.4, all: true, keys: [
      K(0, 'io', ready, { base: [0, H0, 0] }),
      K(0.25, 'o', { ...ready, body: [-10, 0, 0], armL: [-150, 0, 40], armR: [-150, 0, -40], foreL: [-20, 0, 0], foreR: [-20, 0, 0] }, { base: [0, H0 + 0.14, -0.04] }),
      K(0.45, 'i', { base: [0, -300, 0], body: [10, 0, 0], armL: [-90, 0, 80], armR: [-90, 0, -80] }, { base: [0, H0 + 0.1, 0.2] }),
      K(0.55, 'o', { base: [0, -360, 0], ...ready, body: [26, 0, 0], armL: [-70, 0, -30], armR: [-70, 0, 30], foreL: [-10, 0, 0], foreR: [-10, 0, 0] }, { base: [0, H0 - 0.03, 0.34] }),
      K(0.8, 'o', { base: [0, -360, 0], ...ready, body: [22, 0, 0], armL: [-40, 0, -40], armR: [-40, 0, 40] }, { base: [0, H0, 0.34] }),
      K(0.99, 'io', { base: [0, -360, 0], ...ready }, { base: [0, H0, 0] }),
      K(1.0, 'h', ready, { base: [0, H0, 0] }),
    ] },
    cast: { dur: 1.1, impact: 0.75, flutter: 0.8, all: true, keys: [
      K(0, 'io', ready, { base: [0, H0, 0] }),
      K(0.3, 'o', { body: [-10, 0, 0], head: [-16, 0, 0], armL: [-150, 0, 30], armR: [-150, 0, -30], foreL: [-20, 0, 0], foreR: [-20, 0, 0] }, { base: [0, H0 + 0.1, 0] }),
      K(0.65, 'io', { body: [-12, 0, 0], head: [-18, 0, 0], armL: [-156, 0, 34], armR: [-156, 0, -34], foreL: [-20, 0, 0], foreR: [-20, 0, 0] }, { base: [0, H0 + 0.13, 0] }),
      K(0.75, 'i3', { body: [20, 0, 0], head: [4, 0, 0], armL: [-86, 0, 10], armR: [-86, 0, -10], foreL: [-4, 0, 0], foreR: [-4, 0, 0] }, { base: [0, H0, 0.08] }),
      K(1.1, 'io', ready, { base: [0, H0, 0] }),
    ], fn: (P, t, ctx) => { if (ctx && t > 0.2 && t < 0.95) ctx.glowBoost = Math.max(ctx.glowBoost, t < 0.75 ? (t - 0.2) * 2.5 : 1.4 * (1 - (t - 0.75) / 0.2)); } },
    hit: { dur: 0.4, impact: 0.03, blendIn: 0.02, all: true, keys: [K(0, 'io', idle, { base: [0, H0, 0] }), K(0.06, 'o3', { body: [-20, 0, 6], head: [-20, 10, 0], armL: [-30, 0, 50], armR: [-30, 0, -50] }, { base: [0, H0 + 0.02, -0.1] }), K(0.2, 'io', { ...idle, body: [-6, 0, 0] }, { base: [0, H0, -0.11] }), K(0.4, 'io', idle, { base: [0, H0, 0] })] },
    dodge: { dur: 0.45, impact: 0.18, all: true, keys: [K(0, 'io', idle, { base: [0, H0, 0] }), K(0.2, 'o', { ...idle, body: [-24, 0, 0], armL: [20, 0, 40], armR: [20, 0, -40] }, { base: [0, H0 + 0.06, -0.3] }), K(0.3, 'io', { ...idle, body: [-10, 0, 0] }, { base: [0, H0 + 0.03, -0.32] }), K(0.45, 'io', idle, { base: [0, H0, 0] })] },
    death: { dur: 1.0, impact: 0.7, all: true, keys: [
      K(0, 'io', { ...idle, body: [-14, 0, 0], head: [-20, 0, 0] }, { base: [0, H0, 0] }),
      K(0.4, 'o', { body: [-20, 0, 10], head: [-30, 0, 14], armL: [-140, 0, 40], armR: [-140, 0, -40] }, { base: [0, H0 + 0.22, 0] }),
      K(0.7, 'i', { ...DEAD, base: [-92, 0, 0] }, { base: [0, 0.12, 0.32] }), K(0.85, 'o', { ...DEAD, base: [-80, 0, 0] }, { base: [0, 0.16, 0.32] }),
      K(1.0, 'io', DEAD, { base: [0, 0.14, 0.32] }),
    ] },
    victory: { dur: 1.2, impact: 0.5, all: true, keys: [K(0, 'io', idle, { base: [0, H0, 0] }), K(0.45, 'o', { body: [-14, 0, 0], head: [-24, 0, 0], armL: [-120, 0, 70], armR: [-120, 0, -70], foreL: [-10, 0, 0], foreR: [-10, 0, 0] }, { base: [0, H0 + 0.24, 0] }), K(1.2, 'io', { body: [-12, 0, 0], head: [-20, 0, 0], armL: [-116, 0, 66], armR: [-116, 0, -66] }, { base: [0, H0 + 0.2, 0] })], fn: hover(0.02, 3) },
    jump: { dur: 0.5, impact: 0.4, all: true, keys: [K(0, 'io', idle, { base: [0, H0, 0] }), K(0.25, 'o', { ...idle, body: [-8, 0, 0] }, { base: [0, H0 + 0.2, 0] }), K(0.5, 'io', idle, { base: [0, H0, 0] })] },
    talk: { dur: 0.8, impact: 0.3, keys: [K(0, 'io', { head: [6, 0, 0], armL: [-16, 0, 14], foreL: [-30, 0, 0] }), K(0.3, 'io', { head: [0, 0, 12], armL: [-50, 0, 30], foreL: [-60, 0, 0] }), K(0.8, 'io', { head: [6, 0, 0], armL: [-16, 0, 14], foreL: [-30, 0, 0] })] },
  };
  clips.levelup = clips.victory;
  clips.fly = clips.idle;
  return {
    kind: 'wraith', def: R, layers: A.build(), height: 0.98, hover: 0, radius: 1.0, face: null,
    anchors: { head: { bone: 'head', at: [0, 0.79, 0.02] }, chest: { bone: 'chest', at: [0, 0.6, 0.06] }, mouth: { bone: 'head', at: [0, 0.75, 0.13] },
      hand: { bone: 'handR', at: [-0.16, 0.4, 0.03] }, weapon: { bone: 'handR', at: [-0.16, 0.32, 0.05] } },
    chains: [{ kind: 'hem', bones: ['hem0', 'hem1', 'hem2'] }], clips, alias: { shoot: 'cast' }, loopAlias: { idle: 'fly' }, defaultLoop: 'fly',
    transFlutter: { amp: 0.022, freq: 5.5, below: 0.3 },
  };
}

// ------------------------------------------------------------------ golem
function buildGolem(look, q) {
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('hips', 'base', 0, 0.42, 0);
  R.bone('spine', 'hips', 0, 0.55, 0);
  R.bone('chest', 'spine', 0, 0.76, 0);
  R.bone('head', 'chest', 0, 1.06, 0.06);
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    R.bone('arm' + side, 'chest', sx * 0.34, 0.98, 0);
    R.bone('fore' + side, 'arm' + side, sx * 0.38, 0.74, 0.02);
    R.bone('hand' + side, 'fore' + side, sx * 0.4, 0.46, 0.04);
    R.bone('thigh' + side, 'hips', sx * 0.15, 0.4, 0);
    R.bone('shin' + side, 'thigh' + side, sx * 0.16, 0.22, 0.0);
    R.bone('foot' + side, 'shin' + side, sx * 0.16, 0.07, 0.0);
  }
  const A = new Assembler(R);
  const col = look.color ?? 0xc9a66b, rune = look.rune ?? 0x5ff0ff, eyes = look.eyes ?? rune;
  let seed = 7;
  const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.16; };
  const stone = (k = 0) => { const base = C(shade(col, k + jitter())), dk = C(shade(col, k - 0.28)); return (p, n, out) => out.copy(base).lerp(dk, n.y < -0.3 ? 0.7 : n.y < 0.3 ? 0.15 : 0); };
  const blk = (bone, at, scl, k = 0, rot) => A.add(prim.rbox(0.12, 2), { bone, at, scl, rot, color: stone(k), hard: true });
  const runeBar = (bone, at, scl, rot) => A.add(prim.box(), { bone, layer: 'glow', at, scl, rot, color: rune, glow: 2.3 });
  blk('hips', [0, 0.42, 0], [0.38, 0.16, 0.26], -0.05);
  blk('spine', [0, 0.57, 0], [0.44, 0.18, 0.3], 0.02);
  blk('chest', [0, 0.86, 0], [0.66, 0.42, 0.38], 0.04);
  blk('chest', [0, 1.02, -0.06], [0.5, 0.14, 0.3], -0.02);
  blk('head', [0, 1.14, 0.08], [0.22, 0.18, 0.22], 0.06);
  A.add(prim.box(), { bone: 'head', at: [0, 1.15, 0.195], scl: [0.17, 0.035, 0.02], color: 0x15110d, ol: 0, hard: true });
  for (const sx of [-1, 1]) A.add(prim.box(), { bone: 'head', layer: 'glow', at: [sx * 0.045, 1.15, 0.205], scl: [0.04, 0.018, 0.008], color: eyes, glow: 2.8 });
  A.add(prim.octa(), { bone: 'chest', at: [0, 0.86, 0.19], scl: [0.075, 0.095, 0.03], color: shade(col, -0.35), ol: 0.8 });
  A.add(prim.octa(), { bone: 'chest', layer: 'glow', at: [0, 0.86, 0.205], scl: [0.05, 0.068, 0.02], color: rune, glow: 2.8 });
  runeBar('chest', [0, 0.99, 0.193], [0.012, 0.07, 0.006]);
  runeBar('chest', [0, 0.72, 0.193], [0.012, 0.08, 0.006]);
  for (const sx of [-1, 1]) {
    runeBar('chest', [sx * 0.15, 0.9, 0.193], [0.13, 0.012, 0.006], [0, 0, sx * 0.5]);
    runeBar('chest', [sx * 0.22, 0.76, 0.193], [0.012, 0.12, 0.006]);
  }
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    blk('arm' + side, [sx * 0.37, 1.0, 0], [0.26, 0.22, 0.28], 0.06);
    blk('arm' + side, [sx * 0.37, 0.86, 0.01], [0.15, 0.22, 0.15], -0.04);
    blk('fore' + side, [sx * 0.39, 0.62, 0.02], [0.21, 0.28, 0.22], 0.02);
    blk('hand' + side, [sx * 0.4, 0.42, 0.05], [0.21, 0.19, 0.22], -0.02);
    runeBar('arm' + side, [sx * 0.505, 1.0, 0], [0.006, 0.12, 0.012]);
    runeBar('fore' + side, [sx * 0.39, 0.62, 0.133], [0.012, 0.18, 0.006]);
    blk('thigh' + side, [sx * 0.16, 0.32, 0], [0.17, 0.18, 0.18], -0.06);
    blk('shin' + side, [sx * 0.16, 0.17, 0.0], [0.19, 0.16, 0.21], 0.0);
    blk('foot' + side, [sx * 0.16, 0.045, 0.03], [0.21, 0.09, 0.29], -0.08);
  }
  const ib = 0;
  const idle = { chest: [3, 0, 0], head: [4, 0, 0], armL: [0, 0, 6], armR: [0, 0, -6], foreL: [-12, 0, 0], foreR: [-12, 0, 0] };
  const ready = { hips: [0, -10, 0], spine: [8, 0, 0], chest: [8, -6, 0], head: [-6, 10, 0], armL: [-40, 0, 20], armR: [-40, 0, -20], foreL: [-50, 0, 0], foreR: [-50, 0, 0], thighL: [-16, 0, 4], thighR: [-8, 0, -4], shinL: [24, 0, 0], shinR: [14, 0, 0], footL: [-8, 0, 0], footR: [-6, 0, 0] };
  const overhead = { spine: [-10, 0, 0], chest: [-14, 0, 0], head: [-6, 0, 0], armL: [-175, 0, -6], armR: [-175, 0, 6], foreL: [-30, 0, 0], foreR: [-30, 0, 0] };
  const slam = { spine: [26, 0, 0], chest: [20, 0, 0], head: [-10, 0, 0], armL: [-50, 0, -14], armR: [-50, 0, 14], foreL: [-6, 0, 0], foreR: [-6, 0, 0], thighL: [-40, 0, 6], thighR: [-30, 0, -6], shinL: [60, 0, 0], shinR: [50, 0, 0], footL: [-20, 0, 0], footR: [-20, 0, 0] };
  const DEAD = { base: [86, 0, 0], head: [10, 24, 0], armL: [-150, 0, 20], armR: [-160, 0, -20], foreL: [-20, 0, 0], foreR: [-10, 0, 0], thighL: [10, 0, 4], thighR: [6, 0, -4] };
  const gaitFn = (dur, amp, bob) => (P, t) => {
    const ph = (t / dur) * Math.PI * 2, c = Math.cos(ph), sn = Math.sin(ph);
    const L = R.idx('thighL'), Rr = R.idx('thighR'), sL = R.idx('shinL'), sR = R.idx('shinR');
    P[L * 6] += amp * c * D2R; P[Rr * 6] -= amp * c * D2R;
    P[sL * 6] += Math.max(0, sn) * amp * 1.4 * D2R; P[sR * 6] += Math.max(0, -sn) * amp * 1.4 * D2R;
    P[ib * 6 + 4] += -bob * Math.abs(Math.cos(ph));
    P[R.idx('chest') * 6 + 2] += 0.06 * c; P[R.idx('hips') * 6 + 1] += 0.08 * c;
    P[R.idx('armL') * 6] -= amp * 0.6 * c * D2R; P[R.idx('armR') * 6] += amp * 0.6 * c * D2R;
  };
  const clips = {
    idle: { dur: 3, loop: true, keys: [K(0, 'io', idle), K(1.5, 'io', { ...idle, chest: [5, 0, 0], armL: [0, 0, 8], armR: [0, 0, -8] }, { chest: [0, 0.008, 0] })] },
    walk: { dur: 1.1, loop: true, keys: [K(0, 'io', { ...idle, spine: [4, 0, 0] })], fn: gaitFn(1.1, 18, 0.025) },
    run: { dur: 0.8, loop: true, keys: [K(0, 'io', { ...idle, spine: [12, 0, 0], foreL: [-50, 0, 0], foreR: [-50, 0, 0] })], fn: gaitFn(0.8, 26, 0.04) },
    ready: { dur: 1.6, loop: true, keys: [K(0, 'io', ready, { hips: [0, -0.03, 0] }), K(0.8, 'io', { ...ready, chest: [10, -6, 0] }, { hips: [0, -0.036, 0] })] },
    hurt: { dur: 2, loop: true, keys: [K(0, 'io', { spine: [18, 0, 6], chest: [12, 0, 0], head: [14, 0, 8], armL: [10, 0, 10], foreL: [-10, 0, 0], armR: [-30, 0, -10], foreR: [-70, 0, 0], thighL: [-20, 0, 0], shinL: [30, 0, 0], footL: [-10, 0, 0] }, { hips: [0, -0.04, 0] })] },
    dead: { dur: 3, loop: true, keys: [K(0, 'io', DEAD, { base: [0, 0.15, -0.45] })] },
    attack: { dur: 0.75, impact: 0.38, all: true, flutter: 0.5, keys: [
      K(0, 'io', ready, { hips: [0, -0.03, 0] }),
      K(0.24, 'o', { ...ready, ...overhead }, { hips: [0, -0.01, 0], base: [0, 0, -0.04] }),
      K(0.38, 'i3', slam, { hips: [0, -0.12, 0], base: [0, 0, 0.12] }),
      K(0.56, 'o', { ...slam, chest: [24, 0, 0] }, { hips: [0, -0.13, 0], base: [0, 0, 0.12] }),
      K(0.75, 'io', ready, { hips: [0, -0.03, 0] }),
    ] },
    attack2: { dur: 1.0, impact: 0.55, all: true, keys: [
      K(0, 'io', ready, { hips: [0, -0.03, 0] }),
      K(0.2, 'o', { ...ready, spine: [20, 0, 0], thighL: [-40, 0, 6], thighR: [-40, 0, -6], shinL: [70, 0, 0], shinR: [70, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] }, { hips: [0, -0.12, 0] }),
      K(0.42, 'o', { ...overhead, thighL: [-20, 0, 0], thighR: [-10, 0, 0], shinL: [30, 0, 0] }, { base: [0, 0.28, 0.18] }),
      K(0.55, 'i3', slam, { hips: [0, -0.14, 0], base: [0, 0, 0.3] }),
      K(0.8, 'o', { ...slam, chest: [24, 0, 0] }, { hips: [0, -0.14, 0], base: [0, 0, 0.3] }),
      K(1.0, 'io', ready, { hips: [0, -0.03, 0] }),
    ] },
    cast: { dur: 1.1, impact: 0.75, all: true, keys: [
      K(0, 'io', ready, { hips: [0, -0.03, 0] }),
      K(0.3, 'o', { ...ready, chest: [-14, 0, 0], head: [-14, 0, 0], armL: [-40, 0, 70], armR: [-40, 0, -70], foreL: [-30, 0, 0], foreR: [-30, 0, 0] }, { hips: [0, -0.02, 0] }),
      K(0.65, 'io', { ...ready, chest: [-16, 0, 0], head: [-16, 0, 0], armL: [-44, 0, 80], armR: [-44, 0, -80], foreL: [-30, 0, 0], foreR: [-30, 0, 0] }, { hips: [0, -0.02, 0] }),
      K(0.75, 'i3', { ...ready, chest: [16, 0, 0], armL: [-90, 0, 10], armR: [-90, 0, -10], foreL: [0, 0, 0], foreR: [0, 0, 0] }, { hips: [0, -0.05, 0], base: [0, 0, 0.06] }),
      K(1.1, 'io', ready, { hips: [0, -0.03, 0] }),
    ], fn: (P, t, ctx) => { if (ctx && t > 0.2 && t < 0.95) ctx.glowBoost = Math.max(ctx.glowBoost, t < 0.75 ? (t - 0.2) * 3 : 1.6 * (1 - (t - 0.75) / 0.2)); } },
    hit: { dur: 0.4, impact: 0.03, blendIn: 0.02, all: true, keys: [K(0, 'io', idle), K(0.07, 'o3', { ...idle, spine: [-10, 0, 4], chest: [-8, 6, 0], head: [-12, 0, 0] }, { base: [0, 0, -0.06] }), K(0.4, 'io', idle)] },
    dodge: { dur: 0.45, impact: 0.18, all: true, keys: [K(0, 'io', idle), K(0.18, 'o', { ...idle, spine: [-8, 0, 0], thighL: [-20, 0, 0], shinL: [30, 0, 0] }, { base: [0, 0.02, -0.18] }), K(0.3, 'io', idle, { base: [0, 0, -0.2] }), K(0.45, 'io', idle)] },
    death: { dur: 1.0, impact: 0.7, all: true, keys: [
      K(0, 'io', { ...idle, chest: [-10, 0, 0], head: [-16, 0, 0] }),
      K(0.35, 'o', { spine: [20, 0, 6], chest: [14, 0, 0], head: [10, 0, 6], armL: [0, 0, 20], armR: [0, 0, -20], thighL: [-90, 0, 4], thighR: [-80, 0, -4], shinL: [100, 0, 0], shinR: [100, 0, 0] }, { hips: [0, -0.2, 0] }),
      K(0.7, 'i', { ...DEAD, base: [92, 0, 0] }, { base: [0, 0.13, -0.45] }), K(0.85, 'o', { ...DEAD, base: [82, 0, 0] }, { base: [0, 0.17, -0.45] }),
      K(1.0, 'io', DEAD, { base: [0, 0.15, -0.45] }),
    ] },
    victory: { dur: 1.2, impact: 0.5, all: true, keys: [K(0, 'io', idle), K(0.4, 'o', { chest: [-14, 0, 0], head: [-20, 0, 0], armL: [-150, 0, 30], armR: [-150, 0, -30], foreL: [-30, 0, 0], foreR: [-30, 0, 0] }, { hips: [0, 0.01, 0] }), K(0.7, 'io', { chest: [-10, 0, 0], head: [-14, 0, 0], armL: [-40, 0, 40], armR: [-40, 0, -40], foreL: [-110, 0, 0], foreR: [-110, 0, 0] }), K(1.2, 'io', { chest: [-12, 0, 0], head: [-14, 0, 0], armL: [-150, 0, 30], armR: [-150, 0, -30], foreL: [-30, 0, 0], foreR: [-30, 0, 0] })] },
    jump: { dur: 0.5, impact: 0.4, all: true, keys: [K(0, 'io', idle), K(0.12, 'o', { ...idle, spine: [14, 0, 0], thighL: [-30, 0, 0], thighR: [-30, 0, 0], shinL: [50, 0, 0], shinR: [50, 0, 0] }, { hips: [0, -0.08, 0] }), K(0.26, 'o', idle, { base: [0, 0.12, 0] }), K(0.4, 'i', { ...idle, spine: [10, 0, 0] }, { hips: [0, -0.05, 0] }), K(0.5, 'io', idle)] },
    talk: { dur: 0.8, impact: 0.3, keys: [K(0, 'io', { head: [4, 0, 0] }), K(0.3, 'io', { head: [12, 0, 6] }), K(0.8, 'io', { head: [4, 0, 0] })] },
  };
  clips.levelup = clips.victory;
  return {
    kind: 'golem', def: R, layers: A.build(), height: 1.25, radius: 1.4, face: null,
    anchors: { head: { bone: 'head', at: [0, 1.14, 0.1] }, chest: { bone: 'chest', at: [0, 0.86, 0.2] }, mouth: { bone: 'head', at: [0, 1.12, 0.2] },
      hand: { bone: 'handR', at: [-0.4, 0.4, 0.06] }, weapon: { bone: 'handR', at: [-0.4, 0.34, 0.08] } },
    chains: [], clips, alias: { shoot: 'cast' }, loopAlias: { fly: 'idle' }, defaultLoop: 'idle', hover: 0, auraRadius: 0.8,
  };
}

// ------------------------------------------------------------------ dragons (shared wing helper)
/**
 * Bat-like wing: struts along the arm bones (shoulder, elbow, wrist) plus fingers, and a membrane
 * strip spanning leading edge -> trailing points, skinned across the three wing bones.
 */
function dragonWing(A, names, trail, { mem, bone, r = 0.02, key, q = 1 }) {
  const def = A.def;
  const ids = names.map((n) => def.idx(n));
  const P = ids.map((i) => def.pos[i]);
  const sx = Math.sign(P[1].x - P[0].x) || 1;
  const tip = P[2].clone().add(new THREE.Vector3(sx * Math.abs(P[2].x - P[1].x) * 0.8, (P[2].y - P[1].y) * 0.6, (P[2].z - P[1].z) * 0.9 - 0.04));
  const lead = [P[0], P[1], P[2], tip];
  const x0 = P[0].x, x1 = P[1].x, x2 = P[2].x;
  const wfn = (mp) => {
    const t = (mp.x - x0) / (x1 - x0);
    if (t <= 1) { const k = clamp(t, 0, 1); return [[ids[0], 1 - k], [ids[1], k]]; }
    const k = clamp((mp.x - x1) / (x2 - x1), 0, 1); return [[ids[1], 1 - k], [ids[2], k]];
  };
  const rows = [];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const leadA = lead.map((p) => [p.x, p.y, p.z]);
  const L7 = [], T7 = [];
  for (let j = 0; j <= 6; j++) {
    const i0 = Math.floor(j / 2), half = j % 2 === 1;
    if (!half) { L7.push(leadA[i0]); T7.push(trail[i0]); continue; }
    L7.push(lerp3(leadA[i0], leadA[i0 + 1], 0.5));
    const mid = lerp3(trail[i0], trail[i0 + 1], 0.5);
    T7.push(lerp3(mid, L7[L7.length - 1], 0.28));
  }
  for (let i = 0; i < 6; i++) {
    const v = i / 5;
    rows.push(L7.map((a, j) => {
      const b = T7[j];
      const sag = Math.sin(v * Math.PI) * 0.05 * Math.abs(x2 - x0) * (j === 0 || j === 6 ? 0.3 : 1);
      return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v - sag, a[2] + (b[2] - a[2]) * v];
    }));
  }
  A.add(stripGeo(key, rows, 0.012, [0, 1, 0]), { bone: names[0], w: wfn, color: mem });
  const strut = (a, b, r0, r1, k) => A.add(sweepGeo(`${key}${k}`, [a.toArray ? a.toArray() : a, b.toArray ? b.toArray() : b], (u) => r0 + (r1 - r0) * u, { seg: 3, radial: Math.max(5, Math.round(7 * q)) }), { bone: names[0], w: wfn, color: bone, ol: 0.8 });
  strut(P[0], P[1], r * 1.3, r, 'a');
  strut(P[1], P[2], r, r * 0.8, 'b');
  strut(P[2], tip, r * 0.8, r * 0.15, 'c');
  strut(P[2], trail[2], r * 0.6, r * 0.12, 'd');
  strut(P[2], trail[1], r * 0.6, r * 0.12, 'e');
  A.add(prim.cone(5), { bone: names[2], at: [P[2].x + sx * r, P[2].y + r * 2.5, P[2].z], rot: [0, 0, -sx * 0.4], scl: [r * 0.7, r * 3, r * 0.7], color: bone, ol: 0.6 });
  return tip;
}

// ------------------------------------------------------------------ wyvern mount
/** Blueprint for the wyvern mount (rider attaches to the 'saddle' bone). */
export function buildWyvern(mount, opts = {}) {
  const q = opts.quality === 'low' ? 0.6 : 1;
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('body', 'base', 0, 0.52, 0);
  R.bone('saddle', 'body', 0, 0.62, -0.03);
  R.bone('neck0', 'body', 0, 0.58, 0.16);
  R.bone('neck1', 'neck0', 0, 0.68, 0.27);
  R.bone('head', 'neck1', 0, 0.8, 0.36);
  R.bone('jaw', 'head', 0, 0.775, 0.41);
  ['tail0', 'tail1', 'tail2', 'tail3'].forEach((n, i) => R.bone(n, i ? `tail${i - 1}` : 'body', 0, 0.5 - i * 0.045, -0.2 - i * 0.17));
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    R.bone('thigh' + side, 'body', sx * 0.08, 0.47, -0.05);
    R.bone('shin' + side, 'thigh' + side, sx * 0.1, 0.35, 0.0);
    R.bone('foot' + side, 'shin' + side, sx * 0.1, 0.24, -0.04);
    R.bone('wing' + side + '0', 'body', sx * 0.09, 0.6, 0.08);
    R.bone('wing' + side + '1', 'wing' + side + '0', sx * 0.38, 0.72, 0.02);
    R.bone('wing' + side + '2', 'wing' + side + '1', sx * 0.68, 0.68, -0.1);
  }
  const A = new Assembler(R);
  const s = (n) => Math.max(5, Math.round(n * q));
  const col = mount.color ?? 0xc8432b, belly = mount.belly ?? 0xf1c27d, wingC = mount.wing ?? shade(col, -0.35), armor = mount.armor;
  const skin = bellyFn(col, belly, -0.2);
  A.add(prim.sphere(s(18), s(14)), { bone: 'body', at: [0, 0.52, -0.02], scl: [0.12, 0.112, 0.22], color: skin });
  A.add(prim.sphere(s(14), s(10)), { bone: 'body', at: [0, 0.535, 0.1], scl: [0.1, 0.1, 0.11], color: skin });
  chainTube(A, 'wyvNeck', ['neck0', 'neck1', 'head'], (u) => 0.07 - u * 0.025, skin, { extraStart: [0, 0.54, 0.06], seg: s(10) });
  A.add(prim.sphere(s(14), s(10)), { bone: 'head', at: [0, 0.81, 0.38], scl: [0.068, 0.062, 0.085], color: skin });
  A.add(sweepGeo('wyvSnout', [[0, 0.8, 0.42], [0, 0.79, 0.48], [0, 0.775, 0.535]], (u) => [0.05 - u * 0.02, 0.034 - u * 0.012], { seg: 4, radial: 10 }), { bone: 'head', color: skin });
  A.add(sweepGeo('wyvJaw', [[0, 0.77, 0.4], [0, 0.762, 0.47], [0, 0.762, 0.52]], (u) => [0.038 - u * 0.016, 0.014], { seg: 4, radial: 8 }), { bone: 'jaw', color: belly });
  for (const sx of [-1, 1]) {
    A.add(sweepGeo(`wyvHorn${sx}`, [[sx * 0.035, 0.85, 0.37], [sx * 0.06, 0.885, 0.3], [sx * 0.075, 0.9, 0.23]], (u) => 0.016 * (1 - u * 0.9), { seg: 5, radial: 6 }), { bone: 'head', color: shade(belly, 0.15) });
    A.add(prim.sphere(8, 6), { bone: 'head', layer: 'glow', at: [sx * 0.042, 0.822, 0.44], rot: [0, sx * 0.5, 0], scl: [0.012, 0.009, 0.006], color: 0xffc23a, glow: 2.2 });
    for (let k = 0; k < 2; k++) A.add(prim.cone(4), { bone: 'head', at: [sx * 0.022, 0.768, 0.5 - k * 0.03], rot: [Math.PI, 0, 0], scl: [0.005, 0.016, 0.005], color: 0xf6f2e6, ol: 0.3 });
  }
  chainTube(A, 'wyvTail', ['tail0', 'tail1', 'tail2', 'tail3'], (u) => 0.065 * (1 - u) + 0.008, skin, { extraEnd: [0, 0.31, -0.84], seg: s(14) });
  A.add(prim.slab('wyvFin', [[0, 0.05], [0.05, -0.01], [0, -0.07], [-0.05, -0.01]], 0.012, 0.003), { bone: 'tail3', at: [0, 0.31, -0.86], rot: [-Math.PI / 2, 0, 0], color: wingC, ol: 0.7 });
  const spinePts = [[0, 0.64, 0.1], [0, 0.645, -0.02], [0, 0.63, -0.14], [0, 0.56, -0.3], [0, 0.5, -0.47], [0, 0.44, -0.62]];
  const spineBones = ['body', 'body', 'body', 'tail0', 'tail1', 'tail2'];
  spinePts.forEach((p, i) => { if (i < 1 || i > 2) A.add(prim.cone(5), { bone: spineBones[i], at: p, rot: [-0.5, 0, 0], scl: [0.018, 0.05 - i * 0.004, 0.012], color: shade(belly, -0.1), ol: 0.6 }); });
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const th = R.pos[R.idx('thigh' + side)].toArray(), sh = R.pos[R.idx('shin' + side)].toArray(), ft = R.pos[R.idx('foot' + side)].toArray();
    A.add(prim.sphere(s(10), s(8)), { bone: 'thigh' + side, at: [th[0], th[1] - 0.04, th[2] + 0.01], scl: [0.05, 0.075, 0.065], color: skin });
    limb(A, 'wyvShin', 'shin' + side, sh, ft, 0.03, 0.022, skin);
    for (let k = -1; k <= 1; k++) A.add(prim.cone(4), { bone: 'foot' + side, at: [ft[0] + k * 0.018, ft[1] - 0.025, ft[2] + 0.03], rot: [1.6, 0, 0], scl: [0.008, 0.04, 0.008], color: shade(belly, -0.3), ol: 0.5 });
    const w0 = R.pos[R.idx(`wing${side}0`)];
    const trail = [[sx * 0.06, 0.55, -0.2], [sx * 0.3, 0.6, -0.32], [sx * 0.62, 0.6, -0.36], null];
    trail[3] = [w0.x + sx * 0.86, 0.66, -0.2];
    dragonWing(A, [`wing${side}0`, `wing${side}1`, `wing${side}2`], trail, { mem: gradY(shade(wingC, 0.18), shade(wingC, -0.05), 0.5, 0.75), bone: skin, r: 0.02, key: `wyvWing${side}`, q });
  }
  A.add(prim.sphereCut(s(16), s(8), 0, Math.PI * 2, 0, 1.4), { bone: 'saddle', at: [0, 0.6, -0.03], scl: [0.09, 0.045, 0.12], color: 0x6b4426 });
  A.add(prim.torus(0.18, 6, s(18)), { bone: 'body', at: [0, 0.53, -0.04], rot: [0, 0, 0], scl: [0.125, 0.118, 0.12], color: 0x4a2e1a, ol: 0.5 });
  A.add(prim.cyl(1, 1, 8), { bone: 'saddle', at: [0, 0.66, 0.06], rot: [0.3, 0, 0], scl: [0.016, 0.05, 0.016], color: 0x8a5a32, ol: 0.6 });
  if (armor) {
    A.add(prim.sphereCut(s(14), s(8), Math.PI / 2 - 1.1, 2.2, 0.2, 1.2), { bone: 'head', at: [0, 0.815, 0.385], scl: [0.075, 0.068, 0.095], color: metal(armor) });
    A.add(prim.sphereCut(s(14), s(8), Math.PI / 2 - 1.0, 2.0, 0.8, 1.4), { bone: 'body', at: [0, 0.535, 0.1], scl: [0.108, 0.108, 0.12], color: metal(armor) });
    for (const sx of [-1, 1]) A.add(prim.sphereCut(s(10), s(6), 0, Math.PI * 2, 0, 1.3), { bone: `wing${sx > 0 ? 'L' : 'R'}0`, at: [sx * 0.1, 0.62, 0.08], scl: [0.05, 0.035, 0.06], color: metal(armor), ol: 0.8 });
  }
  return {
    kind: 'wyvern', def: R, layers: A.build(), height: 0.95, saddleY: 0.62, hover: 0.03, radius: 1.3, face: null,
    anchors: {}, chains: [{ kind: 'tail', bones: ['tail0', 'tail1', 'tail2', 'tail3'] }], clips: wyvernClips(R), alias: { levelup: 'victory', cast: 'victory', shoot: 'attack' }, defaultLoop: 'fly',
  };
}

function wyvernClips(R) {
  const I = (n) => R.idx(n);
  const W = [['L', 1], ['R', -1]].map(([side, sx]) => ({ sx, w0: I(`wing${side}0`), w1: I(`wing${side}1`), w2: I(`wing${side}2`) }));
  const iBody = I('body'), iNeck0 = I('neck0'), iTail1 = I('tail1'), iTail2 = I('tail2');
  const flapFn = (dur, amp, bob, base = 0.03) => (P, t) => {
    const ph = (t / dur) * Math.PI * 2;
    const c = Math.cos(ph), c1 = Math.cos(ph - 0.7), c2 = Math.cos(ph - 1.3);
    for (let k = 0; k < 2; k++) {
      const w = W[k], sx = w.sx;
      P[w.w0 * 6 + 2] += sx * (amp * c + 8) * D2R;
      P[w.w1 * 6 + 2] += sx * (amp * 0.55 * c1 - 4) * D2R;
      P[w.w2 * 6 + 2] += sx * (amp * 0.4 * c2) * D2R;
      P[w.w0 * 6 + 1] += sx * 10 * Math.sin(ph) * D2R;
    }
    P[4] += base + bob * Math.sin(ph + Math.PI * 0.5 + 0.6);
    P[iBody * 6] += 3 * Math.sin(ph) * D2R;
    P[iNeck0 * 6] -= 4 * Math.sin(ph) * D2R;
    P[iTail1 * 6 + 1] += 8 * Math.sin(ph * 0.5) * D2R;
    P[iTail2 * 6 + 1] += 10 * Math.sin(ph * 0.5 - 0.6) * D2R;
  };
  const legs = { thighL: [30, 0, 6], thighR: [30, 0, -6], shinL: [20, 0, 0], shinR: [20, 0, 0], footL: [40, 0, 0], footR: [40, 0, 0], neck0: [-6, 0, 0], head: [6, 0, 0] };
  const DEAD = { base: [0, 0, 12], body: [6, 0, 0], neck0: [30, 20, 0], neck1: [20, 10, 0], head: [10, 10, 0], jaw: [16, 0, 0], wingL0: [0, 0, -14], wingL1: [0, 0, -6], wingR0: [0, 0, 24], wingR1: [0, 0, 10], thighL: [-50, 0, 30], thighR: [-50, 0, -30], tail1: [6, 20, 0], tail2: [4, 20, 0] };
  const DEADO = { base: [0, -0.4, 0.05] };
  const wingsUp = { wingL0: [0, 0, 50], wingR0: [0, 0, -50], wingL1: [0, 0, 20], wingR1: [0, 0, -20] };
  return {
    fly: { dur: 0.9, loop: true, keys: [K(0, 'io', legs)], fn: flapFn(0.9, 42, 0.035) },
    hurt: { dur: 1.3, loop: true, keys: [K(0, 'io', { ...legs, neck0: [16, 0, 0], head: [14, 0, 8], body: [6, 0, 6] })], fn: flapFn(1.3, 30, 0.025, -0.02) },
    dead: { dur: 3, loop: true, keys: [K(0, 'io', DEAD, DEADO)] },
    attack: { dur: 0.75, impact: 0.38, all: true, keys: [
      K(0, 'io', legs, { base: [0, 0.03, 0] }),
      K(0.2, 'o', { ...legs, ...wingsUp, body: [-18, 0, 0], neck0: [-24, 0, 0], neck1: [-10, 0, 0], head: [-4, 0, 0], jaw: [10, 0, 0] }, { base: [0, 0.08, -0.06] }),
      K(0.32, 'i', { ...legs, body: [14, 0, 0], neck0: [26, 0, 0], neck1: [10, 0, 0], head: [6, 0, 0], jaw: [40, 0, 0], wingL0: [0, 0, -30], wingR0: [0, 0, 30] }, { base: [0, 0.0, 0.26] }),
      K(0.38, 'i3', { ...legs, body: [16, 0, 0], neck0: [30, 0, 0], neck1: [12, 0, 0], head: [8, 0, 0], jaw: [0, 0, 0], wingL0: [0, 0, -36], wingR0: [0, 0, 36] }, { base: [0, -0.01, 0.32] }),
      K(0.55, 'o', { ...legs, body: [8, 0, 0], neck0: [14, 0, 0], wingL0: [0, 0, 10], wingR0: [0, 0, -10] }, { base: [0, 0.02, 0.3] }),
      K(0.75, 'io', legs, { base: [0, 0.03, 0] }),
    ] },
    attack2: { dur: 1.0, impact: 0.55, all: true, keys: [
      K(0, 'io', legs, { base: [0, 0.03, 0] }),
      K(0.3, 'o', { ...legs, ...wingsUp, body: [-26, 0, 0], neck0: [-20, 0, 0], head: [-10, 0, 0] }, { base: [0, 0.26, -0.08] }),
      K(0.55, 'i3', { ...legs, body: [26, 0, 0], neck0: [30, 0, 0], head: [10, 0, 0], jaw: [30, 0, 0], wingL0: [0, 0, 20], wingR0: [0, 0, -20], wingL1: [0, 40, 0], wingR1: [0, -40, 0] }, { base: [0, -0.02, 0.45] }),
      K(0.8, 'o', { ...legs, body: [6, 0, 0], neck0: [10, 0, 0], ...wingsUp }, { base: [0, 0.06, 0.4] }),
      K(1.0, 'io', legs, { base: [0, 0.03, 0] }),
    ] },
    hit: { dur: 0.4, impact: 0.03, blendIn: 0.02, all: true, keys: [K(0, 'io', legs, { base: [0, 0.03, 0] }), K(0.07, 'o3', { ...legs, body: [-16, 0, 8], neck0: [-24, 0, 0], head: [-16, 12, 0], jaw: [26, 0, 0], ...wingsUp }, { base: [0, 0.05, -0.1] }), K(0.4, 'io', legs, { base: [0, 0.03, 0] })] },
    dodge: { dur: 0.45, impact: 0.18, all: true, keys: [K(0, 'io', legs, { base: [0, 0.03, 0] }), K(0.2, 'o', { ...legs, base: [0, 0, 26], body: [-10, 0, 0], ...wingsUp }, { base: [0.12, 0.08, -0.26] }), K(0.45, 'io', legs, { base: [0, 0.03, 0] })] },
    death: { dur: 1.0, impact: 0.7, all: true, keys: [
      K(0, 'io', { ...legs, neck0: [-30, 0, 0], head: [-20, 0, 0], jaw: [36, 0, 0], ...wingsUp }, { base: [0, 0.06, 0] }),
      K(0.4, 'o', { ...legs, body: [10, 0, 10], neck0: [10, 0, 0], wingL0: [0, 0, 60], wingR0: [0, 0, -20] }, { base: [0, 0.0, 0] }),
      K(0.7, 'i', { ...DEAD, base: [0, 0, 20] }, { base: [0, -0.42, 0.05] }), K(0.85, 'o', { ...DEAD, base: [0, 0, 8] }, { base: [0, -0.37, 0.05] }),
      K(1.0, 'io', DEAD, DEADO),
    ] },
    victory: { dur: 1.2, impact: 0.5, all: true, keys: [K(0, 'io', legs, { base: [0, 0.03, 0] }), K(0.4, 'o', { ...legs, ...wingsUp, wingL0: [0, 0, 64], wingR0: [0, 0, -64], body: [-20, 0, 0], neck0: [-30, 0, 0], neck1: [-10, 0, 0], head: [-16, 0, 0], jaw: [40, 0, 0] }, { base: [0, 0.14, 0] }), K(1.2, 'io', { ...legs, ...wingsUp, body: [-16, 0, 0], neck0: [-26, 0, 0], head: [-12, 0, 0], jaw: [30, 0, 0] }, { base: [0, 0.1, 0] })] },
    jump: { dur: 0.5, impact: 0.4, all: true, keys: [K(0, 'io', legs, { base: [0, 0.03, 0] }), K(0.2, 'o', { ...legs, ...wingsUp }, { base: [0, 0.2, 0] }), K(0.5, 'io', legs, { base: [0, 0.03, 0] })] },
    talk: { dur: 0.8, impact: 0.3, keys: [K(0, 'io', { head: [6, 0, 0], jaw: [0, 0, 0] }), K(0.25, 'io', { head: [-4, 0, 10], jaw: [24, 0, 0] }), K(0.8, 'io', { head: [6, 0, 0], jaw: [0, 0, 0] })] },
  };
}

// ------------------------------------------------------------------ wyrm (final boss)
const WYRM_LEGS = [['fuL', 'flL', 'fpL'], ['fuR', 'flR', 'fpR'], ['buL', 'blL', 'bpL'], ['buR', 'blR', 'bpR']];
function buildWyrm(look, q) {
  const R = new RigDef();
  R.bone('base', null, 0, 0, 0);
  R.bone('body', 'base', 0, 0.95, 0);
  R.bone('chest', 'body', 0, 1.0, 0.38);
  R.bone('hips', 'body', 0, 0.92, -0.42);
  R.bone('neck0', 'chest', 0, 1.2, 0.62);
  R.bone('neck1', 'neck0', 0, 1.48, 0.8);
  R.bone('neck2', 'neck1', 0, 1.74, 0.92);
  R.bone('head', 'neck2', 0, 1.95, 1.0);
  R.bone('jaw', 'head', 0, 1.859, 1.104);
  ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'].forEach((n, i) => R.bone(n, i ? `tail${i - 1}` : 'hips', 0, 0.9 - i * 0.14, -0.75 - i * 0.28));
  for (const [sx, side] of [[1, 'L'], [-1, 'R']]) {
    R.bone('fu' + side, 'chest', sx * 0.34, 0.84, 0.42);
    R.bone('fl' + side, 'fu' + side, sx * 0.4, 0.42, 0.34);
    R.bone('fp' + side, 'fl' + side, sx * 0.4, 0.1, 0.5);
    R.bone('bu' + side, 'hips', sx * 0.32, 0.84, -0.46);
    R.bone('bl' + side, 'bu' + side, sx * 0.4, 0.44, -0.66);
    R.bone('bp' + side, 'bl' + side, sx * 0.4, 0.1, -0.5);
    R.bone('w' + side + '0', 'chest', sx * 0.24, 1.32, 0.28);
    R.bone('w' + side + '1', 'w' + side + '0', sx * 0.8, 1.84, 0.0);
    R.bone('w' + side + '2', 'w' + side + '1', sx * 1.4, 2.04, -0.32);
  }
  const A = new Assembler(R);
  const s = (n) => Math.max(6, Math.round(n * q));
  const col = look.color ?? 0x1d1a2b, belly = look.belly ?? 0x3b2f4f, glow = look.glow ?? 0xb04dff, horn = look.horn ?? 0xe8dcc0;
  const bodyC = C(shade(col, 0.1)), bellyC = C(shade(belly, 0.12)), ridge = C(shade(col, -0.2));
  const scales = (p, n, out, mp) => {
    out.copy(bodyC);
    if (n.y < -0.3) { out.lerp(bellyC, clamp((-0.3 - n.y) / 0.35, 0, 1)); if (mp && Math.sin(mp.z * 38) > 0.6) out.multiplyScalar(0.82); }
    else if (n.y > 0.8) out.lerp(ridge, (n.y - 0.8) * 3);
  };
  const hornC = gradY(shade(horn, -0.35), shade(horn, 0.1), -1, 1);
  const HP = R.pos[R.idx('head')], HK = 1.3;
  const headM = new THREE.Matrix4().makeTranslation(HP.x, HP.y, HP.z).multiply(new THREE.Matrix4().makeScale(HK, HK, HK)).multiply(new THREE.Matrix4().makeTranslation(-HP.x, -HP.y, -HP.z));
  const addH = (geo, o) => A.add(geo, { ...o, m: headM.clone().multiply(partMatrix(o, new THREE.Matrix4())) });
  A.add(prim.sphere(s(22), s(16)), { bone: 'body', at: [0, 0.98, -0.02], scl: [0.44, 0.4, 0.7], color: scales, w: chainWeightsAxis(R, ['hips', 'body', 'chest'], [0, 0, 1]) });
  A.add(prim.sphere(s(18), s(14)), { bone: 'chest', at: [0, 1.06, 0.36], scl: [0.42, 0.45, 0.42], color: scales });
  A.add(prim.sphere(s(16), s(12)), { bone: 'hips', at: [0, 0.98, -0.44], scl: [0.38, 0.37, 0.36], color: scales });
  chainTube(A, 'wyrmNeck', ['neck0', 'neck1', 'neck2', 'head'], (u) => 0.29 - u * 0.12, scales, { extraStart: [0, 1.06, 0.44], seg: s(14), radial: s(14) });
  addH(prim.sphere(s(18), s(14)), { bone: 'head', at: [0, 1.99, 1.02], scl: [0.2, 0.17, 0.25], color: scales });
  addH(sweepGeo('wyrmSnout', [[0, 1.97, 1.1], [0, 1.94, 1.27], [0, 1.9, 1.42]], (u) => [0.15 - u * 0.05, 0.095 - u * 0.025], { seg: 5, radial: 12 }), { bone: 'head', color: scales });
  addH(sweepGeo('wyrmJaw', [[0, 1.87, 1.06], [0, 1.85, 1.25], [0, 1.85, 1.4]], (u) => [0.12 - u * 0.045, 0.04], { seg: 5, radial: 10 }), { bone: 'jaw', color: belly });
  for (const sx of [-1, 1]) {
    addH(sweepGeo(`wyrmHornA${sx}`, [[sx * 0.11, 2.07, 0.98], [sx * 0.22, 2.2, 0.84], [sx * 0.27, 2.27, 0.64], [sx * 0.23, 2.22, 0.46]], (u) => 0.055 * (1 - u * 0.92), { seg: s(10), radial: 8 }), { bone: 'head', color: hornC });
    addH(sweepGeo(`wyrmHornB${sx}`, [[sx * 0.16, 1.97, 0.94], [sx * 0.27, 1.99, 0.84], [sx * 0.34, 1.96, 0.72]], (u) => 0.035 * (1 - u * 0.9), { seg: 6, radial: 7 }), { bone: 'head', color: hornC });
    addH(prim.rbox(0.3, 1), { bone: 'head', at: [sx * 0.09, 2.07, 1.13], rot: [0.2, sx * 0.3, sx * 0.35], scl: [0.13, 0.035, 0.07], color: shade(col, -0.25), ol: 0.6 });
    addH(prim.sphere(8, 6), { bone: 'head', layer: 'glow', at: [sx * 0.105, 2.02, 1.16], rot: [0, sx * 0.5, sx * 0.4], scl: [0.048, 0.02, 0.012], color: glow, glow: 3.2 });
    for (let k = 0; k < 3; k++) {
      addH(prim.cone(4), { bone: 'head', at: [sx * (0.07 + k * 0.014), 1.88, 1.36 - k * 0.08], rot: [Math.PI, 0, 0], scl: [0.016, 0.06, 0.016], color: 0xf0eadc, ol: 0.3 });
      addH(prim.cone(4), { bone: 'jaw', at: [sx * (0.065 + k * 0.014), 1.9, 1.33 - k * 0.08], scl: [0.014, 0.05, 0.014], color: 0xf0eadc, ol: 0.3 });
    }
  }
  chainTube(A, 'wyrmTail', ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'], (u) => 0.24 * (1 - u) + 0.02, scales, { extraStart: [0, 0.95, -0.55], extraEnd: [0, 0.22, -2.08], seg: s(18), radial: s(12) });
  const spines = [['neck1', [0, 1.62, 0.8]], ['neck0', [0, 1.36, 0.66]], ['chest', [0, 1.36, 0.42]], ['body', [0, 1.37, 0.06]], ['hips', [0, 1.3, -0.32]], ['tail0', [0, 1.04, -0.78]], ['tail1', [0, 0.92, -1.06]], ['tail2', [0, 0.75, -1.34]], ['tail3', [0, 0.57, -1.6]]];
  spines.forEach(([b, p], i) => A.add(prim.cone(5), { bone: b, at: p, rot: [-0.55, 0, 0], scl: [0.05 - i * 0.003, 0.15 - i * 0.008, 0.03], color: hornC, ol: 0.7 }));
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    for (const f of ['f', 'b']) {
      const u = R.pos[R.idx(f + 'u' + side)].toArray(), l = R.pos[R.idx(f + 'l' + side)].toArray(), p = R.pos[R.idx(f + 'p' + side)].toArray();
      const back = f === 'b';
      const top = [u[0] * 0.8, u[1] + (back ? 0.12 : 0.1), u[2]];
      A.add(sweepGeo(`wyu${f}`, [[top[0] - u[0], top[1] - u[1], top[2] - u[2]], [0, 0, 0], [l[0] - u[0], l[1] - u[1], l[2] - u[2]]], (t) => (back ? 0.24 : 0.2) * (1 - t * 0.4), { seg: 6, radial: s(12) }),
        { bone: f + 'u' + side, at: u, color: scales });
      limb(A, `wyl${f}`, f + 'l' + side, l, p, back ? 0.15 : 0.13, 0.11, scales, s(12));
      A.add(prim.sphere(s(12), s(10)), { bone: f + 'l' + side, at: l, scl: back ? 0.15 : 0.135, color: scales, ol: 0.6 });
      A.add(prim.sphere(s(10), s(8)), { bone: f + 'p' + side, at: [p[0], p[1] - 0.035, p[2] + 0.06], scl: [0.13, 0.075, 0.17], color: scales });
      for (let k = -1; k <= 1; k++) A.add(prim.cone(5), { bone: f + 'p' + side, at: [p[0] + k * 0.065, p[1] - 0.06, p[2] + 0.21], rot: [1.45, 0, 0], scl: [0.025, 0.09, 0.022], color: hornC, ol: 0.6 });
    }
    const trail = [[sx * 0.2, 1.12, -0.28], [sx * 0.62, 1.2, -0.62], [sx * 1.25, 1.42, -0.8], [sx * 1.95, 1.9, -0.55]];
    dragonWing(A, [`w${side}0`, `w${side}1`, `w${side}2`], trail, { mem: (pp, n, o) => o.set(shade(col, 0.02)).lerp(C(glow), 0.12), bone: scales, r: 0.06, key: `wyrmWing${side}`, q });
  }
  const crack = (bone, at, len, rot) => A.add(prim.box(), { bone, layer: 'glow', at, rot, scl: [0.022, len, 0.022], color: glow, glow: 2.6 });
  for (const sx of [-1, 1]) {
    crack('body', [sx * 0.42, 1.0, 0.05], 0.26, [0.3, 0, sx * 0.2]);
    crack('body', [sx * 0.4, 1.08, -0.2], 0.2, [-0.6, 0, sx * 0.3]);
    crack('hips', [sx * 0.36, 0.98, -0.47], 0.2, [0.8, 0, sx * 0.2]);
    crack('chest', [sx * 0.36, 1.12, 0.48], 0.16, [-0.3, 0, sx * 0.5]);
    crack('neck0', [sx * 0.2, 1.26, 0.66], 0.14, [0.4, 0, sx * 0.2]);
  }
  A.add(prim.sphere(s(14), s(10)), { bone: 'chest', layer: 'glow', at: [0, 1.02, 0.77], rot: [0.25, 0, 0], scl: [0.05, 0.2, 0.02], color: glow, glow: 2.2 });
  A.add(prim.sphere(s(10), s(8)), { bone: 'neck0', layer: 'glow', at: [0, 1.24, 0.83], rot: [0.6, 0, 0], scl: [0.035, 0.12, 0.016], color: glow, glow: 1.8 });
  return {
    kind: 'wyrm', def: R, layers: A.build(), height: 2.3, radius: 3.2, face: null,
    anchors: { head: { bone: 'head', at: [0, 1.99, 1.07] }, chest: { bone: 'chest', at: [0, 1.05, 0.6] }, mouth: { bone: 'jaw', at: [0, 1.885, 1.47] },
      weapon: { bone: 'jaw', at: [0, 1.885, 1.5] }, hand: { bone: 'fpR', at: [-0.36, 0.08, 0.7] } },
    chains: [{ kind: 'tail', bones: ['tail0', 'tail1', 'tail2', 'tail3', 'tail4'] }], clips: wyrmClips(R), alias: { shoot: 'cast', levelup: 'victory' },
    loopAlias: { fly: 'idle' }, defaultLoop: 'idle', hover: 0, auraRadius: 1.6,
  };
}

function wyrmClips(R) {
  const I = (n) => R.idx(n);
  const names = { base: 0, front: I('chest'), back: I('hips'), head: I('head'), legs: WYRM_LEGS.map((a) => a.map(I)) };
  const fold = { wL0: [0, 10, 14], wR0: [0, -10, -14], wL1: [0, 0, -10], wR1: [0, 0, 10] };
  const half = { wL0: [0, 0, 34], wR0: [0, 0, -34], wL1: [0, 0, 10], wR1: [0, 0, -10] };
  const spread = { wL0: [0, -10, 56], wR0: [0, 10, -56], wL1: [0, 0, 20], wR1: [0, 0, -20], wL2: [0, 0, 10], wR2: [0, 0, -10] };
  const idle = { ...fold, neck0: [-16, 0, 0], neck1: [16, 0, 0], neck2: [14, 0, 0], head: [10, 0, 0], tail0: [-6, 0, 0], tail1: [6, 0, 0] };
  const ready = { ...half, chest: [8, 0, 0], neck0: [14, 0, 0], neck1: [10, 0, 0], neck2: [6, 0, 0], head: [-14, 0, 0], jaw: [10, 0, 0], fuL: [-10, 0, 0], fuR: [-10, 0, 0], flL: [16, 0, 0], flR: [16, 0, 0] };
  const rear = { ...spread, body: [-22, 0, 0], chest: [-10, 0, 0], neck0: [-34, 0, 0], neck1: [-18, 0, 0], neck2: [-10, 0, 0], head: [-26, 0, 0], jaw: [44, 0, 0], buL: [24, 0, 0], buR: [24, 0, 0], blL: [-20, 0, 0], blR: [-20, 0, 0], fuL: [-40, 0, 0], fuR: [-40, 0, 0], flL: [50, 0, 0], flR: [50, 0, 0] };
  const DEAD = { ...spread, wL0: [0, 0, -6], wR0: [0, 0, 6], wL1: [0, 0, -8], wR1: [0, 0, 8], neck0: [30, 24, 0], neck1: [24, 14, 0], neck2: [10, 10, 0], head: [8, 12, 10], jaw: [18, 0, 0],
    fuL: [-60, 0, 30], fuR: [-60, 0, -30], flL: [70, 0, 0], flR: [70, 0, 0], buL: [40, 0, 20], buR: [40, 0, -20], blL: [-30, 0, 0], blR: [-30, 0, 0], tail0: [10, 0, 0], tail1: [8, 16, 0], tail2: [6, 16, 0] };
  const DEADO = { base: [0, -0.5, 0] };
  const breath = (P, t) => {
    const b = Math.sin(t * Math.PI * 2 / 3);
    P[I('chest') * 6] += b * 0.04; P[I('body') * 6 + 4] += b * 0.012;
    P[I('neck1') * 6 + 1] += Math.sin(t * 0.7) * 0.08; P[I('head') * 6 + 1] += Math.sin(t * 0.7 - 0.6) * 0.1;
    P[I('wL0') * 6 + 2] += b * 0.03; P[I('wR0') * 6 + 2] -= b * 0.03;
    P[I('tail2') * 6 + 1] += Math.sin(t * 1.3) * 0.12; P[I('tail3') * 6 + 1] += Math.sin(t * 1.3 - 0.7) * 0.15;
  };
  return {
    idle: { dur: 3, loop: true, keys: [K(0, 'io', idle)], fn: breath },
    walk: { dur: 1.4, loop: true, keys: [K(0, 'io', idle)], fn: quadGait(names, { dur: 1.4, amp: 16, lift: 30, phases: [0, 0.5, 0.6, 0.1], bob: 0.03, head: 3 }) },
    run: { dur: 0.9, loop: true, keys: [K(0, 'io', { ...idle, ...half })], fn: quadGait(names, { dur: 0.9, amp: 24, lift: 40, phases: [0, 0.1, 0.5, 0.6], bob: 0.05, pitch: 4, flex: 6 }) },
    ready: { dur: 1.6, loop: true, keys: [K(0, 'io', ready), K(0.8, 'io', { ...ready, jaw: [18, 0, 0], head: [-16, 0, 0] })], fn: (P, t) => { breath(P, t); P[I('head') * 6 + 2] += Math.sin(t * 40) * 0.01; } },
    hurt: { dur: 2, loop: true, keys: [K(0, 'io', { ...fold, wL0: [0, 0, -10], wR0: [0, 0, 10], neck0: [24, 0, 0], neck1: [16, 0, 0], head: [10, 0, 10], jaw: [14, 0, 0] }, { body: [0, -0.06, 0] })], fn: breath },
    dead: { dur: 3, loop: true, keys: [K(0, 'io', DEAD, DEADO)] },
    attack: { dur: 0.75, impact: 0.38, all: true, keys: [
      K(0, 'io', ready),
      K(0.2, 'o', { ...ready, chest: [-8, 0, 0], neck0: [-30, 0, 0], neck1: [-12, 0, 0], neck2: [-6, 0, 0], head: [-12, 0, 0], jaw: [24, 0, 0] }, { base: [0, 0, -0.05] }),
      K(0.32, 'i', { ...ready, chest: [10, 0, 0], neck0: [34, 0, 0], neck1: [22, 0, 0], neck2: [8, 0, 0], head: [10, 0, 0], jaw: [46, 0, 0] }, { base: [0, -0.02, 0.24] }),
      K(0.38, 'i3', { ...ready, chest: [12, 0, 0], neck0: [38, 0, 0], neck1: [24, 0, 0], neck2: [10, 0, 0], head: [14, 0, 0], jaw: [0, 0, 0] }, { base: [0, -0.03, 0.3] }),
      K(0.55, 'o', { ...ready, neck0: [24, 0, 0], neck1: [14, 0, 0], head: [6, 20, 0], jaw: [10, 0, 0] }, { base: [0, -0.02, 0.28] }),
      K(0.75, 'io', ready),
    ] },
    attack2: { dur: 1.0, impact: 0.55, all: true, keys: [
      K(0, 'io', ready),
      K(0.3, 'o', { ...rear, jaw: [30, 0, 0], fuR: [-130, 0, -20], flR: [-30, 0, 0] }, { base: [0, 0.18, -0.1] }),
      K(0.55, 'i3', { ...ready, body: [12, 0, 0], neck0: [30, 0, 0], neck1: [16, 0, 0], head: [10, 0, 0], jaw: [40, 0, 0], fuR: [-40, 0, 20], flR: [30, 0, 0] }, { base: [0, -0.04, 0.34] }),
      K(0.8, 'o', { ...ready, neck0: [20, 0, 0], head: [4, -16, 0], jaw: [16, 0, 0] }, { base: [0, -0.02, 0.32] }),
      K(1.0, 'io', ready),
    ] },
    cast: { dur: 1.1, impact: 0.75, all: true, keys: [
      K(0, 'io', ready),
      K(0.35, 'o', rear, { base: [0, 0.16, -0.12] }),
      K(0.65, 'io', { ...rear, neck0: [-40, 0, 0], head: [-32, 0, 0], jaw: [50, 0, 0] }, { base: [0, 0.2, -0.14] }),
      K(0.75, 'i3', { ...ready, ...spread, body: [10, 0, 0], neck0: [30, 0, 0], neck1: [16, 0, 0], neck2: [6, 0, 0], head: [6, 0, 0], jaw: [62, 0, 0] }, { base: [0, 0, 0.12] }),
      K(0.92, 'o', { ...ready, ...spread, body: [10, 0, 0], neck0: [28, 0, 0], neck1: [16, 0, 0], head: [6, 0, 0], jaw: [58, 0, 0] }, { base: [0, 0, 0.12] }),
      K(1.1, 'io', ready),
    ], fn: (P, t, ctx) => { if (ctx && t > 0.2 && t < 1.0) ctx.glowBoost = Math.max(ctx.glowBoost, t < 0.75 ? (t - 0.2) * 3.5 : 2 * (1 - (t - 0.75) / 0.25)); if (t > 0.35 && t < 0.72) P[I('head') * 6 + 2] += Math.sin(t * 60) * 0.02; } },
    hit: { dur: 0.4, impact: 0.03, blendIn: 0.02, all: true, keys: [K(0, 'io', ready), K(0.07, 'o3', { ...ready, ...half, body: [-8, 0, 4], neck0: [-24, 10, 0], neck1: [-10, 0, 0], head: [-20, 16, 0], jaw: [36, 0, 0] }, { base: [0, 0.02, -0.12] }), K(0.4, 'io', ready)] },
    dodge: { dur: 0.45, impact: 0.18, all: true, keys: [K(0, 'io', ready), K(0.2, 'o', { ...ready, ...spread, body: [-10, 0, 0] }, { base: [0, 0.1, -0.3] }), K(0.45, 'io', ready)] },
    death: { dur: 1.0, impact: 0.7, all: true, keys: [
      K(0, 'io', { ...rear, jaw: [56, 0, 0] }, { base: [0, 0.14, 0] }),
      K(0.35, 'o', { ...rear, neck0: [-46, 0, 0], head: [-36, 0, 0], jaw: [60, 0, 0] }, { base: [0, 0.2, 0] }),
      K(0.7, 'i', { ...DEAD, body: [6, 0, 0] }, { base: [0, -0.53, 0] }), K(0.84, 'o', DEAD, { base: [0, -0.47, 0] }), K(1.0, 'io', DEAD, DEADO),
    ] },
    victory: { dur: 1.2, impact: 0.5, all: true, keys: [K(0, 'io', ready), K(0.45, 'o', { ...rear, jaw: [54, 0, 0] }, { base: [0, 0.16, 0] }), K(1.2, 'io', { ...rear, jaw: [44, 0, 0] }, { base: [0, 0.14, 0] })], fn: (P, t) => { if (t > 0.4) P[I('head') * 6 + 2] += Math.sin(t * 45) * 0.02; } },
    jump: { dur: 0.5, impact: 0.4, all: true, keys: [K(0, 'io', idle), K(0.22, 'o', { ...idle, ...spread }, { base: [0, 0.16, 0] }), K(0.5, 'io', idle)] },
    talk: { dur: 0.8, impact: 0.3, keys: [K(0, 'io', { head: [6, 0, 0], jaw: [0, 0, 0] }), K(0.3, 'io', { head: [-8, 0, 10], jaw: [30, 0, 0] }), K(0.8, 'io', { head: [6, 0, 0], jaw: [0, 0, 0] })] },
  };
}

// ------------------------------------------------------------------ dispatcher
/** Blueprint for a non-humanoid look (wolf, skeleton, wraith, golem, wyrm). */
export function buildMonster(look, opts = {}) {
  const q = opts.quality === 'low' ? 0.6 : 1;
  let bp;
  switch (look.kind) {
    case 'wolf': bp = buildWolf(look, q); break;
    case 'skeleton': bp = buildSkeleton(look, opts); break;
    case 'wraith': bp = buildWraith(look, q); break;
    case 'golem': bp = buildGolem(look, q); bp.baseScale = 1.08; break;
    case 'wyrm': bp = buildWyrm(look, q); break;
    default: throw new Error(`createCharacter: unknown look kind '${look.kind}'`);
  }
  bp.quality = opts.quality || 'high';
  return bp;
}

