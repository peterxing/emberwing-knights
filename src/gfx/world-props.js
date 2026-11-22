// Procedural low-poly toon models for the world builder: a fast typed-array geometry merger (GeoBuilder),
// primitive templates, props, structures and the instanced vegetation kit.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Growable typed array. */
export class Grow {
  constructor(Type, n = 1024) { this.T = Type; this.a = new Type(n); this.n = 0; }
  need(k) {
    if (this.n + k <= this.a.length) return;
    let m = this.a.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new this.T(m);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  view() { return this.a.slice(0, this.n); }
}

// ------------------------------------------------------------------------------------------- templates
function weldNormals(pos, idx) {
  const n = pos.length / 3;
  const map = new Map();
  const id = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) { j = k++; map.set(key, j); }
    id[i] = j;
  }
  const acc = new Float32Array(k * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) {
      const o = id[v] * 3;
      acc[o] += nx; acc[o + 1] += ny; acc[o + 2] += nz;
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = id[i] * 3;
    const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1;
    out[i * 3] = acc[o] / l; out[i * 3 + 1] = acc[o + 1] / l; out[i * 3 + 2] = acc[o + 2] / l;
  }
  return out;
}

function toTemplate(geo, flat) {
  let g = geo;
  if (flat) {
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals();
  }
  const pos = g.attributes.position.array;
  const n = pos.length / 3;
  let idx;
  if (g.index) idx = Uint32Array.from(g.index.array);
  else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  return {
    pos: Float32Array.from(pos),
    nrm: Float32Array.from(g.attributes.normal.array),
    onrm: weldNormals(pos, idx),
    col: g.attributes.color ? Float32Array.from(g.attributes.color.array) : null,
    idx, n,
  };
}

function hash3(x, y, z, s = 0) {
  let h = Math.imul(Math.round(x * 1000) | 0, 374761393) ^ Math.imul(Math.round(y * 1000) | 0, 668265263) ^ Math.imul(Math.round(z * 1000) | 0, 1440662683) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function jitter(geo, amt, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash3(x, y, z, seed) - 0.5) * 2 * amt;
    p.setXYZ(i, x * k, y * k * (y < -0.3 ? 0.6 : 1), z * k);
  }
  return geo;
}

function prismGeo() {
  const g = new THREE.BufferGeometry();
  const A = [-0.5, 0], B = [0.5, 0], C = [0, 1];
  const v = [];
  const tri = (a, b, c) => v.push(...a, ...b, ...c);
  const f = 0.5, k = -0.5;
  tri([...A, f], [...B, f], [...C, f]);
  tri([...B, k], [...A, k], [...C, k]);
  tri([...A, k], [...A, f], [...C, f]); tri([...A, k], [...C, f], [...C, k]);
  tri([...B, f], [...B, k], [...C, k]); tri([...B, f], [...C, k], [...C, f]);
  tri([...A, k], [...B, k], [...B, f]); tri([...A, k], [...B, f], [...A, f]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

const TPL = new Map();
function tpl(key, make, flat = false) {
  let t = TPL.get(key);
  if (!t) { t = toTemplate(make(), flat); TPL.set(key, t); }
  return t;
}

/** Template library (unit sized; most are bottom-anchored at y = 0). */
export const T = {
  box: () => tpl('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  boxc: () => tpl('boxc', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (n = 8, r = 1) => tpl(`cyl${n}_${r}`, () => new THREE.CylinderGeometry(r, 1, 1, n).translate(0, 0.5, 0)),
  cylc: (n = 8) => tpl(`cylc${n}`, () => new THREE.CylinderGeometry(1, 1, 1, n)),
  cone: (n = 8) => tpl(`cone${n}`, () => new THREE.ConeGeometry(1, 1, n).translate(0, 0.5, 0)),
  sph: (d = 1) => tpl(`sph${d}`, () => new THREE.IcosahedronGeometry(1, d)),
  rock: (v = 0) => tpl(`rock${v}`, () => jitter(new THREE.IcosahedronGeometry(1, 0), 0.24, v + 1), true),
  prism: () => tpl('prism', prismGeo, true),
  halfcyl: () => tpl('halfcyl', () => new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)),
  cloth: () => tpl('cloth', () => new THREE.BoxGeometry(1, 1, 1, 6, 6, 1)),
  oct: () => tpl('oct', () => new THREE.OctahedronGeometry(1, 0), true),
  torus: () => tpl('torus', () => new THREE.TorusGeometry(1, 0.2, 5, 10, Math.PI)),
  barrel: () => tpl('barrel', () => new THREE.LatheGeometry(
    [[0.001, 0], [0.115, 0], [0.136, 0.06], [0.147, 0.17], [0.136, 0.28], [0.115, 0.34], [0.001, 0.34]].map(([x, y]) => new THREE.Vector2(x, y)), 10)),
  arch: (H, s, r, hw, d) => tpl(`arch${H.toFixed(2)}_${s}_${r}_${hw}_${d}`, () => {
    const sh = new THREE.Shape();
    sh.moveTo(-hw, 0); sh.lineTo(-r, 0); sh.lineTo(-r, s);
    sh.absarc(0, s, r, Math.PI, 0, true);
    sh.lineTo(r, 0); sh.lineTo(hw, 0); sh.lineTo(hw, H); sh.lineTo(-hw, H); sh.lineTo(-hw, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, curveSegments: 9 });
    g.deleteAttribute('uv');
    return g.translate(0, 0, -d / 2);
  }, true),
};

/** Builds a local transform matrix (position, euler rotation, scale). */
export function L(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  return _l.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ------------------------------------------------------------------------------------------- builder
/**
 * Merges transformed template copies into one indexed geometry with vertex colours, optional per-vertex
 * emission (aEmit) and sway data (aSway/aSwayDir), plus welded "outline" normals for inverted-hull outlines.
 */
export class GeoBuilder {
  constructor({ emit = false, sway = false, size = 1 << 15 } = {}) {
    this.P = new Grow(Float32Array, size); this.N = new Grow(Float32Array, size);
    this.C = new Grow(Float32Array, size); this.O = new Grow(Float32Array, size);
    this.I = new Grow(Uint32Array, Math.ceil(size * 1.5));
    this.E = emit ? new Grow(Float32Array, Math.ceil((size * 4) / 3)) : null;
    this.S = sway ? new Grow(Float32Array, Math.ceil((size * 4) / 3)) : null;
    this.D = sway ? new Grow(Float32Array, size) : null;
    this.nv = 0;
    this.stack = [new THREE.Matrix4()];
    this.emit = null;
    this.sway = null;
    this.desat = 0;
    this.dim = 1;
    this._sw = [0, 0, 0, 0];
    this._sd = [0, 0, 0];
  }
  get top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(new THREE.Matrix4().multiplyMatrices(this.top, m)); return this; }
  pushT(x, y, z, ry = 0, s = 1) { return this.push(L(x, y, z, s, s, s, 0, ry, 0)); }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }
  reset(m) { this.stack = [m ? m.clone() : new THREE.Matrix4()]; return this; }
  /** Local point -> builder space. */
  w(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.top); }
  /** Local direction -> builder space (normalised). */
  dir(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).transformDirection(this.top); }

  add(t, local, color) {
    const m = _m.multiplyMatrices(this.top, local);
    _nm.getNormalMatrix(m);
    const e = m.elements, q = _nm.elements;
    _c.set(color);
    let r = _c.r, g = _c.g, b = _c.b;
    if (this.desat > 0) { const lum = r * 0.3 + g * 0.59 + b * 0.11; r += (lum - r) * this.desat; g += (lum - g) * this.desat; b += (lum - b) * this.desat; }
    r *= this.dim; g *= this.dim; b *= this.dim;
    const n = t.n, base = this.nv;
    const P = this.P, N = this.N, Cc = this.C, O = this.O;
    P.need(n * 3); N.need(n * 3); Cc.need(n * 3); O.need(n * 3);
    const pa = P.a, na = N.a, ca = Cc.a, oa = O.a;
    let pi = P.n;
    const em = this.emit, E = this.E, sw = this.sway, S = this.S, D = this.D;
    if (E) E.need(n * 4);
    if (S) { S.need(n * 4); D.need(n * 3); }
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const x = t.pos[i3], y = t.pos[i3 + 1], z = t.pos[i3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      pa[pi] = wx; pa[pi + 1] = wy; pa[pi + 2] = wz;
      let nx = t.nrm[i3], ny = t.nrm[i3 + 1], nz = t.nrm[i3 + 2];
      let tx = q[0] * nx + q[3] * ny + q[6] * nz, ty = q[1] * nx + q[4] * ny + q[7] * nz, tz = q[2] * nx + q[5] * ny + q[8] * nz;
      let l = Math.hypot(tx, ty, tz) || 1;
      na[pi] = tx / l; na[pi + 1] = ty / l; na[pi + 2] = tz / l;
      nx = t.onrm[i3]; ny = t.onrm[i3 + 1]; nz = t.onrm[i3 + 2];
      tx = q[0] * nx + q[3] * ny + q[6] * nz; ty = q[1] * nx + q[4] * ny + q[7] * nz; tz = q[2] * nx + q[5] * ny + q[8] * nz;
      l = Math.hypot(tx, ty, tz) || 1;
      oa[pi] = tx / l; oa[pi + 1] = ty / l; oa[pi + 2] = tz / l;
      if (t.col) { ca[pi] = r * t.col[i3]; ca[pi + 1] = g * t.col[i3 + 1]; ca[pi + 2] = b * t.col[i3 + 2]; }
      else { ca[pi] = r; ca[pi + 1] = g; ca[pi + 2] = b; }
      if (E) {
        const o = E.n + i * 4;
        if (em) { E.a[o] = em[0]; E.a[o + 1] = em[1]; E.a[o + 2] = em[2]; E.a[o + 3] = em[3]; }
        else { E.a[o] = 0; E.a[o + 1] = 0; E.a[o + 2] = 0; E.a[o + 3] = 0; }
      }
      if (S) {
        const o = S.n + i * 4, o3 = D.n + i3;
        if (sw) {
          sw(wx, wy, wz, this._sw, this._sd);
          S.a[o] = this._sw[0]; S.a[o + 1] = this._sw[1]; S.a[o + 2] = this._sw[2]; S.a[o + 3] = this._sw[3];
          D.a[o3] = this._sd[0]; D.a[o3 + 1] = this._sd[1]; D.a[o3 + 2] = this._sd[2];
        } else {
          S.a[o] = 0; S.a[o + 1] = 0; S.a[o + 2] = 0; S.a[o + 3] = 0;
          D.a[o3] = 0; D.a[o3 + 1] = 0; D.a[o3 + 2] = 0;
        }
      }
      pi += 3;
    }
    P.n = pi; N.n = pi; Cc.n = pi; O.n = pi;
    if (E) E.n += n * 4;
    if (S) { S.n += n * 4; D.n += n * 3; }
    const I = this.I;
    I.need(t.idx.length);
    for (let i = 0; i < t.idx.length; i++) I.a[I.n + i] = t.idx[i] + base;
    I.n += t.idx.length;
    this.nv += n;
    return this;
  }

  box(x, y, z, w, h, d, col, rx = 0, ry = 0, rz = 0) { return this.add(T.box(), L(x, y, z, w, h, d, rx, ry, rz), col); }
  boxc(x, y, z, w, h, d, col, rx = 0, ry = 0, rz = 0) { return this.add(T.boxc(), L(x, y, z, w, h, d, rx, ry, rz), col); }
  cyl(x, y, z, r, h, col, n = 8, top = 1, rx = 0, ry = 0, rz = 0) { return this.add(T.cyl(n, top), L(x, y, z, r, h, r, rx, ry, rz), col); }
  sph(x, y, z, rx, ry, rz, col, d = 1) { return this.add(T.sph(d), L(x, y, z, rx, ry, rz), col); }
  /** Horizontal-or-tilted beam between two local points (centred cylinder/box). */
  beam(a, b, r, col, n = 6) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
    _l.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r, len, r));
    return this.add(n === 4 ? T.boxc() : T.cylc(n), _l, col);
  }

  get empty() { return this.nv === 0; }

  /** Returns { geometry, outline } — outline shares position/index but carries welded normals. */
  build() {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(this.P.view(), 3);
    g.setAttribute('position', pos);
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.view(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.view(), 3));
    let sway, dir;
    if (this.E) g.setAttribute('aEmit', new THREE.BufferAttribute(this.E.view(), 4));
    if (this.S) {
      sway = new THREE.BufferAttribute(this.S.view(), 4);
      dir = new THREE.BufferAttribute(this.D.view(), 3);
      g.setAttribute('aSway', sway); g.setAttribute('aSwayDir', dir);
    }
    const iv = this.I.view();
    const index = new THREE.BufferAttribute(this.nv > 65535 ? iv : Uint16Array.from(iv), 1);
    g.setIndex(index);
    g.computeBoundingSphere();
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', pos);
    og.setAttribute('normal', new THREE.BufferAttribute(this.O.view(), 3));
    if (sway) { og.setAttribute('aSway', sway); og.setAttribute('aSwayDir', dir); }
    og.setIndex(index);
    og.boundingSphere = g.boundingSphere;
    return { geometry: g, outline: og };
  }
}

// ------------------------------------------------------------------------------------------- colours
/** Shared prop colours (sRGB hex). */
export const KC = {
  wood: 0x8a5a2e, woodD: 0x5c3b22, woodL: 0xb58350, iron: 0x3a3a44, gold: 0xe6b445, goldD: 0xa8771f,
  stone: 0xa7a296, stoneD: 0x7c776d, stoneL: 0xbcb6a9, marble: 0xd6cebe, bone: 0xdcd4bf, rope: 0xc9b07a,
  red: 0xb3262f, blue: 0x2c4c9e, cream: 0xefe4c8, hay: 0xdcb44e, dark: 0x2a2228, plaster: 0xf0e6cf,
};
const FLAME = 0xff5a0a;
const GLOW = 0xff9a3a;
const lin = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };

/** Brightness tweak on a hex colour (f > 0 lighter, f < 0 darker). */
export function tint(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f); else c.multiplyScalar(1 + f);
  return c.getHex();
}

// ------------------------------------------------------------------------------------------- cloth helpers
/** Banner hanging from a horizontal rod at local (x, yTop, z), facing local +z. */
export function hangBanner(ctx, x, yTop, z, w, len, col, trim, amp = 0.05) {
  const { b, cloth: cl } = ctx;
  cl.reset(b.top);
  const top = cl.w(x, yTop, z).y;
  const d = cl.dir(0, 0, 1);
  const ph = ctx.rng() * TAU;
  cl.sway = (px, py, pz, sw, sd) => {
    sw[0] = ph; sw[1] = amp; sw[2] = Math.min(1, Math.max(0, (top - py) / len)); sw[3] = 1;
    sd[0] = d.x; sd[1] = d.y; sd[2] = d.z;
  };
  cl.add(T.cloth(), L(x, yTop - len / 2, z, w, len, 0.014), col);
  cl.add(T.box(), L(x, yTop - len, z, w + 0.012, 0.045, 0.02), trim);
  cl.add(T.boxc(), L(x, yTop - len * 0.42, z + 0.011, 0.1, 0.1, 0.01, 0, 0, Math.PI / 4), trim);
  cl.add(T.boxc(), L(x, yTop - len * 0.42, z + 0.016, 0.05, 0.05, 0.01, 0, 0, Math.PI / 4), col);
  cl.sway = null;
  b.add(T.cylc(6), L(x, yTop + 0.012, z, 0.014, w + 0.08, 0.014, 0, 0, Math.PI / 2), KC.woodD);
  for (const s of [-1, 1]) b.sph(x + s * (w / 2 + 0.045), yTop + 0.012, z, 0.022, 0.022, 0.022, KC.gold, 0);
}

/** Flag attached to a vertical pole at local (x, y..y+h, z) extending toward local +x. */
export function poleFlag(ctx, x, y, z, w, h, col, amp = 0.045) {
  const cl = ctx.cloth;
  cl.reset(ctx.b.top);
  const base = cl.w(x, y, z);
  const d = cl.dir(0, 0, 1);
  const ph = ctx.rng() * TAU;
  cl.sway = (px, py, pz, sw, sd) => {
    sw[0] = ph; sw[1] = amp; sw[2] = Math.min(1, Math.hypot(px - base.x, pz - base.z) / w); sw[3] = 0;
    sd[0] = d.x; sd[1] = d.y; sd[2] = d.z;
  };
  cl.add(T.cloth(), L(x + w / 2, y + h / 2, z, w, h, 0.012), col);
  cl.add(T.boxc(), L(x + w * 0.55, y + h / 2, z, 0.06, 0.06, 0.016, 0, 0, Math.PI / 4), tint(col, 0.55));
  cl.sway = null;
}

// ------------------------------------------------------------------------------------------- props
function flameAt(ctx, x, y, z, size, glowSize, glowI, prio, col = GLOW) {
  ctx.fx(x, y, z, size, 0, FLAME, 1);
  ctx.fx(x, y + size * 0.35, z, glowSize, 1, col, glowI);
  if (prio > 0) ctx.light(x, y + size * 0.5, z, 0xff9a48, prio);
}

function chestBase(ctx) {
  const b = ctx.b;
  b.box(0, 0, 0, 0.44, 0.2, 0.3, KC.wood);
  b.box(0, 0, 0, 0.46, 0.03, 0.32, KC.goldD);
  b.box(0, 0.178, 0, 0.452, 0.024, 0.312, KC.goldD);
  for (const x of [-0.165, 0.165]) b.box(x, 0, 0, 0.045, 0.2, 0.316, KC.gold);
  b.box(0, 0.085, 0.152, 0.075, 0.09, 0.02, KC.gold);
  b.box(0, 0.11, 0.163, 0.022, 0.032, 0.006, KC.dark);
  b.emit = lin(KC.gold, 0.35).concat(0);
  b.box(0, 0.19, 0, 0.39, 0.025, 0.25, KC.gold);
  for (let i = 0; i < 5; i++) b.sph(-0.12 + i * 0.06, 0.215, (i % 2) * 0.05 - 0.02, 0.03, 0.012, 0.03, 0xffd76a, 0);
  b.emit = null;
  ctx.chests.push(b.top.clone());
}

/** Chest lid geometry: hinge line at the origin (back edge), lid extends toward +z. */
export function chestLidGeometry() {
  const b = new GeoBuilder({ size: 2048 });
  b.box(0, 0, 0.15, 0.44, 0.03, 0.3, KC.wood);
  b.add(T.halfcyl(), L(0, 0.03, 0.15, 0.44, 0.11, 0.15), KC.wood);
  for (const x of [-0.165, 0.165]) b.add(T.halfcyl(), L(x, 0.028, 0.15, 0.048, 0.118, 0.158), KC.gold);
  b.box(0, 0.0, 0.15, 0.46, 0.03, 0.318, KC.goldD);
  b.box(0, -0.055, 0.306, 0.07, 0.085, 0.018, KC.gold);
  return b.build();
}

/** Door geometry: hinge at the origin, panel extends toward +x, facing +z. */
export function doorGeometry() {
  const b = new GeoBuilder({ size: 2048 });
  b.box(0.1, 0, 0, 0.2, 0.34, 0.03, 0x7a4526);
  for (const y of [0.07, 0.25]) b.box(0.1, y, 0.012, 0.2, 0.025, 0.012, KC.iron);
  for (const x of [0.05, 0.1, 0.15]) b.box(x, 0.01, 0.016, 0.006, 0.32, 0.006, 0x5a3218);
  b.sph(0.165, 0.17, 0.025, 0.015, 0.015, 0.015, KC.gold, 0);
  return b.build();
}

function statue(ctx, gold, col) {
  const b = ctx.b;
  const st = gold ? 0xf0c050 : (col ?? 0xb9b3a7);
  b.box(0, 0, 0, 0.42, 0.14, 0.42, gold ? KC.marble : KC.stoneD);
  b.box(0, 0.14, 0, 0.36, 0.06, 0.36, gold ? KC.goldD : KC.stone);
  if (gold) b.emit = lin(0xffc860, 0.28).concat(2);
  const y0 = 0.2;
  b.cyl(0, y0, 0, 0.14, 0.34, st, 8, 0.55);
  b.box(0, y0 + 0.3, 0, 0.21, 0.15, 0.13, st);
  for (const s of [-1, 1]) {
    b.sph(s * 0.115, y0 + 0.43, 0, 0.06, 0.05, 0.06, st);
    b.beam([s * 0.12, y0 + 0.42, 0], [s * 0.04, y0 + 0.34, 0.1], 0.03, st);
  }
  b.sph(0, y0 + 0.54, 0, 0.078, 0.082, 0.078, st);
  b.add(T.cone(8), L(0, y0 + 0.57, 0, 0.085, 0.13, 0.085), st);
  b.box(0, y0 - 0.06, 0.1, 0.034, 0.34, 0.014, st);
  b.box(0, y0 + 0.27, 0.1, 0.13, 0.026, 0.03, st);
  b.box(0, y0 + 0.29, 0.1, 0.026, 0.06, 0.026, st);
  b.sph(0, y0 + 0.36, 0.1, 0.03, 0.03, 0.03, st, 0);
  b.emit = null;
  if (gold) {
    ctx.fx(0, 0.62, 0, 1.25, 1, 0xffd070, 0.35);
    ctx.fx(0.12, 0.75, 0.08, 0.16, 3, 0xfff0b0, 1.6);
    ctx.fx(-0.1, 0.5, 0.1, 0.12, 3, 0xfff0b0, 1.4);
  }
}

function rubble(ctx, n, r, col, s = 1) {
  for (let i = 0; i < n; i++) {
    const a = ctx.rng() * TAU, d = r * (0.4 + ctx.rng() * 0.6);
    const k = (0.04 + ctx.rng() * 0.05) * s;
    ctx.b.add(T.rock((i % 4)), L(Math.cos(a) * d, k * 0.3, Math.sin(a) * d, k * 1.2, k, k, 0, ctx.rng() * TAU, 0), tint(col, (ctx.rng() - 0.5) * 0.2));
  }
}

/** Swaying palm: segmented curved trunk (static) + drooping fronds (cloth builder). Local origin = base. */
function palm(ctx, s = 1) {
  const { b, cloth: cl, rng } = ctx;
  cl.reset(b.top);
  const lean = (rng() - 0.5) * 0.5, la = rng() * TAU;
  let x = 0, y = 0, z = 0;
  const segs = 6, segH = 0.2 * s;
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs;
    const nx = Math.cos(la) * lean * t * t * s, nz = Math.sin(la) * lean * t * t * s, ny = (i + 1) * segH;
    b.beam([x, y, z], [nx, ny, nz], (0.055 - i * 0.004) * s, i % 2 ? 0x8a6a48 : 0x9c7a52, 6);
    x = nx; y = ny; z = nz;
  }
  const top = cl.w(x, y, z);
  const ph = rng() * TAU;
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * TAU + rng() * 0.4;
    const droop = 0.35 + rng() * 0.35;
    const len = (0.5 + rng() * 0.12) * s;
    cl.sway = (px, py, pz, sw, sd) => {
      sw[0] = ph + i * 0.3; sw[1] = 0.05; sw[2] = Math.min(1, Math.hypot(px - top.x, py - top.y, pz - top.z) / len); sw[3] = 2;
      sd[0] = 0; sd[1] = 0; sd[2] = 0;
    };
    const hl = len * 0.5 * Math.cos(droop);
    cl.add(T.cloth(), L(x + Math.cos(a) * hl, y - Math.sin(droop) * len * 0.5, z + Math.sin(a) * hl, 0.13 * s, 0.012, len, droop, Math.PI / 2 - a, 0, 'YXZ'), i % 2 ? 0x4f9a3a : 0x67b046);
  }
  cl.sway = null;
  for (let i = 0; i < 3; i++) b.sph(x + Math.cos(i * 2.1) * 0.05, y - 0.05, z + Math.sin(i * 2.1) * 0.05, 0.04 * s, 0.045 * s, 0.04 * s, 0x6b4a24, 0);
}

/** Leafless tree with forked branches. Local origin = base. */
function deadTree(ctx, s = 1, col = 0x6b5d52) {
  const { b, rng } = ctx;
  const h = (0.85 + rng() * 0.3) * s;
  b.cyl(0, 0, 0, 0.075 * s, h, col, 6, 0.45);
  const n = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, y = h * (0.45 + i * 0.15);
    const len = (0.28 + rng() * 0.18) * s;
    const ex = Math.cos(a) * len, ez = Math.sin(a) * len, ey = y + len * (0.5 + rng() * 0.4);
    b.beam([0, y, 0], [ex, ey, ez], 0.026 * s, col, 5);
    b.beam([ex, ey, ez], [ex * 1.3 + (rng() - 0.5) * 0.1, ey + 0.12 * s, ez * 1.3], 0.014 * s, col, 4);
  }
  b.add(T.cone(6), L(0, -0.02, 0, 0.13 * s, 0.12 * s, 0.13 * s), col);
}

function windmill(ctx, o) {
  const b = ctx.b;
  b.cyl(0, 0, 0, 0.36, 0.12, KC.stoneD, 8);
  b.cyl(0, 0.12, 0, 0.32, 1.05, 0xece3cf, 8, 0.7);
  b.box(0, 0.12, 0.27, 0.15, 0.26, 0.08, 0x5a3a22);
  b.emit = lin(0xffc070, 1.6).concat(1);
  b.box(0, 0.62, 0.235, 0.09, 0.11, 0.05, 0x40506a);
  b.box(0.12, 0.42, 0.21, 0.07, 0.09, 0.05, 0x40506a, 0, 0.5, 0);
  b.emit = null;
  b.add(T.cone(8), L(0, 1.17, 0, 0.3, 0.36, 0.3), o.color ?? 0xa8452e);
  const s = new GeoBuilder({ size: 2048 });
  s.cyl(0, 0, 0, 0.06, 0.08, KC.woodD, 8, 1, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    s.push(L(0, 0, 0.05, 1, 1, 1, 0, 0, i * Math.PI / 2));
    s.box(0, 0, 0, 0.035, 0.72, 0.03, KC.woodD);
    s.box(0.07, 0.16, 0.0, 0.11, 0.54, 0.012, 0xf2ead6);
    for (const y of [0.3, 0.48]) s.box(0.07, y, 0.008, 0.12, 0.012, 0.01, KC.woodD);
    s.pop();
  }
  ctx.sails.push({ m: b.top.clone().multiply(L(0, 1.02, 0.33)), build: s.build() });
}

/** Prop builders keyed by mapDef prop type. Local space: tile centre at the tile top, front = +z. */
export const PROPS = {
  chest: (ctx) => chestBase(ctx),
  barrel(ctx) {
    const b = ctx.b;
    b.add(T.barrel(), L(0, 0, 0), KC.wood);
    for (const y of [0.055, 0.265]) b.cyl(0, y, 0, 0.142, 0.026, KC.iron, 12);
    b.cyl(0, 0.335, 0, 0.11, 0.012, KC.woodD, 12);
  },
  crate(ctx) {
    const b = ctx.b, w = 0.32, h = 0.3, t = 0.034, o = w / 2 - t / 2 + 0.004;
    b.box(0, 0, 0, w, h, w, KC.woodL);
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x * o, 0, z * o, t, h + 0.004, t, KC.woodD);
    for (const y of [0, h - t]) {
      b.box(0, y, o, w, t, t, KC.woodD); b.box(0, y, -o, w, t, t, KC.woodD);
      b.box(o, y, 0, t, t, w, KC.woodD); b.box(-o, y, 0, t, t, w, KC.woodD);
    }
    for (const s of [-1, 1]) b.boxc(0, h / 2, s * (o + 0.004), Math.hypot(w, h) * 0.86, t * 0.9, t * 0.6, KC.woodD, 0, 0, Math.atan2(h, w) * s);
  },
  torch(ctx) {
    const b = ctx.b;
    b.cyl(0, 0, 0, 0.035, 0.6, KC.woodD, 6, 0.7);
    b.cyl(0, 0.46, 0, 0.04, 0.03, KC.iron, 8);
    b.cyl(0, 0.57, 0, 0.042, 0.07, KC.iron, 8, 1.7);
    b.emit = lin(0xff6a1a, 1.2).concat(0);
    b.cyl(0, 0.635, 0, 0.062, 0.014, 0x401808, 8);
    b.emit = null;
    flameAt(ctx, 0, 0.64, 0, 0.3, 0.95, 0.75, 1);
  },
  brazier(ctx) {
    const b = ctx.b;
    b.cyl(0, 0, 0, 0.16, 0.05, KC.stoneD, 8);
    b.cyl(0, 0.05, 0, 0.085, 0.3, KC.iron, 8, 0.55);
    b.cyl(0, 0.34, 0, 0.12, 0.13, KC.iron, 10, 1.5);
    b.cyl(0, 0.45, 0, 0.19, 0.03, 0x2e2e36, 10);
    b.emit = lin(0xff5a10, 1.5).concat(0);
    b.cyl(0, 0.47, 0, 0.16, 0.02, 0x501a08, 10);
    b.emit = null;
    flameAt(ctx, 0, 0.48, 0, 0.46, 1.4, 0.85, 3);
  },
  campfire(ctx) {
    const b = ctx.b;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      b.add(T.rock(i % 4), L(Math.cos(a) * 0.19, 0.02, Math.sin(a) * 0.19, 0.06, 0.045, 0.055, 0, a, 0), i % 2 ? KC.stone : KC.stoneD);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI + 0.3;
      b.beam([Math.cos(a) * 0.16, 0.02, Math.sin(a) * 0.16], [-Math.cos(a) * 0.05, 0.1, -Math.sin(a) * 0.05], 0.028, i % 2 ? KC.woodD : 0x6b4428, 6);
    }
    b.emit = lin(0xff5a10, 1.3).concat(0);
    b.cyl(0, 0, 0, 0.13, 0.025, 0x3a1206, 10);
    b.emit = null;
    flameAt(ctx, 0, 0.04, 0, 0.42, 1.3, 0.8, 2);
  },
  tent(ctx, o) {
    const b = ctx.b, col = o.color ?? 0xd8c8a0;
    b.add(T.prism(), L(0, 0, 0, 0.82, 0.58, 0.84), col);
    b.add(T.prism(), L(0, 0.46, 0, 0.2, 0.13, 0.86), tint(col, -0.3));
    b.add(T.prism(), L(0, 0, 0.42, 0.34, 0.36, 0.02), KC.dark);
    for (const z of [-0.44, 0.44]) b.cyl(0, 0, z, 0.016, 0.68, KC.woodD, 6);
    for (const s of [-1, 1]) {
      b.beam([0, 0.6, 0.44], [s * 0.32, 0, 0.62], 0.005, KC.rope, 4);
      b.beam([0, 0.6, -0.44], [s * 0.32, 0, -0.62], 0.005, KC.rope, 4);
    }
  },
  campTent(ctx, o) { PROPS.tent(ctx, o); },
  statue: (ctx, o) => statue(ctx, false, o.color),
  goldenStatue: (ctx) => statue(ctx, true),
  well(ctx) {
    const b = ctx.b;
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU;
      b.box(Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21, 0.08, 0.24, 0.125, i % 2 ? KC.stone : KC.stoneD, 0, -a, 0);
    }
    b.cyl(0, 0, 0, 0.19, 0.17, 0x23405a, 12);
    for (const s of [-1, 1]) b.box(s * 0.26, 0, 0, 0.05, 0.64, 0.05, KC.woodD);
    b.add(T.cylc(6), L(0, 0.5, 0, 0.022, 0.56, 0.022, 0, 0, Math.PI / 2), KC.wood);
    b.add(T.prism(), L(0, 0.6, 0, 0.42, 0.2, 0.66, 0, Math.PI / 2, 0), 0xa8553a);
    b.box(0.06, 0.32, 0, 0.004, 0.18, 0.004, KC.rope);
    b.cyl(0.06, 0.26, 0, 0.045, 0.065, KC.wood, 8, 1.15);
  },
  cart(ctx) {
    const b = ctx.b;
    b.box(0, 0.15, 0, 0.56, 0.05, 0.34, KC.wood);
    for (const s of [-1, 1]) { b.box(0, 0.2, s * 0.16, 0.56, 0.1, 0.025, KC.woodL); b.box(s * 0.27, 0.2, 0, 0.025, 0.1, 0.34, KC.woodL); }
    for (const s of [-1, 1]) {
      b.add(T.cylc(12), L(-0.05, 0.13, s * 0.2, 0.13, 0.04, 0.13, Math.PI / 2, 0, 0), KC.woodD);
      b.add(T.cylc(8), L(-0.05, 0.13, s * 0.225, 0.035, 0.02, 0.035, Math.PI / 2, 0, 0), KC.iron);
      b.beam([0.27, 0.18, s * 0.1], [0.58, 0.03, s * 0.1], 0.018, KC.woodD, 5);
    }
    b.add(T.cylc(6), L(-0.05, 0.13, 0, 0.02, 0.42, 0.02, Math.PI / 2, 0, 0), KC.iron);
    b.sph(-0.06, 0.27, 0, 0.21, 0.12, 0.13, KC.hay);
    b.sph(0.12, 0.27, 0.03, 0.08, 0.09, 0.08, 0xcdb48a);
  },
  crateStack(ctx) { PROPS.crate(ctx); },
  fence(ctx) {
    const b = ctx.b;
    for (const x of [-0.45, 0, 0.45]) {
      b.box(x, 0, -0.42, 0.055, 0.3, 0.055, KC.woodD);
      b.add(T.cone(4), L(x, 0.3, -0.42, 0.04, 0.06, 0.04, 0, Math.PI / 4, 0), KC.woodD);
    }
    for (const y of [0.1, 0.22]) b.box(0, y, -0.42, 0.98, 0.04, 0.028, KC.wood);
  },
  signpost(ctx) {
    const b = ctx.b;
    b.box(0, 0, 0, 0.045, 0.62, 0.045, KC.woodD);
    b.box(0.09, 0.47, 0.03, 0.3, 0.08, 0.022, KC.woodL, 0, 0, 0.04);
    b.add(T.prism(), L(0.24, 0.51, 0.03, 0.08, 0.06, 0.022, 0, 0, -Math.PI / 2), KC.woodL);
    b.box(-0.07, 0.34, -0.02, 0.24, 0.07, 0.022, KC.wood, 0, 0.5, -0.03);
  },
  lamppost(ctx) {
    const b = ctx.b;
    b.box(0, 0, 0, 0.1, 0.05, 0.1, KC.iron);
    b.cyl(0, 0.05, 0, 0.022, 0.8, KC.iron, 6);
    b.box(0, 0.84, 0, 0.11, 0.02, 0.11, KC.iron);
    b.emit = lin(0xffc36a, 2.4).concat(1);
    b.box(0, 0.86, 0, 0.075, 0.1, 0.075, 0xffe6b0);
    b.emit = null;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x * 0.042, 0.86, z * 0.042, 0.012, 0.1, 0.012, KC.iron);
    b.add(T.cone(4), L(0, 0.96, 0, 0.08, 0.09, 0.08, 0, Math.PI / 4, 0), KC.iron);
    if (ctx.night > 0.25) {
      ctx.fx(0, 0.91, 0, 0.9, 1, 0xffc070, 0.55 * ctx.night);
      ctx.light(0, 0.95, 0, 0xffc070, 1.2);
    }
  },
  obelisk(ctx) {
    const b = ctx.b, stone = ctx.golden ? 0xcfc6b2 : 0xb0a58f, rune = ctx.runeColor;
    b.box(0, 0, 0, 0.46, 0.08, 0.46, KC.stoneD);
    b.box(0, 0.08, 0, 0.36, 0.08, 0.36, KC.stone);
    b.add(T.cyl(4, 0.62), L(0, 0.16, 0, 0.17, 1.2, 0.17, 0, Math.PI / 4, 0), stone);
    b.add(T.cone(4), L(0, 1.36, 0, 0.106, 0.2, 0.106, 0, Math.PI / 4, 0), ctx.golden ? KC.gold : stone);
    b.emit = lin(rune, 1.4).concat(2);
    for (let k = 0; k < 5; k++) {
      const y = 0.3 + k * 0.18;
      const hw = 0.12 * (1 - 0.38 * (y - 0.16) / 1.2);
      b.box(0, y, hw + 0.002, 0.05, 0.09, 0.008, rune);
    }
    b.emit = null;
    ctx.fx(0, 0.7, 0.15, 0.8, 1, rune, 0.3);
  },
  brokenPillar(ctx) {
    const b = ctx.b, c = ctx.golden ? KC.marble : KC.stoneL;
    b.box(0, 0, 0, 0.42, 0.1, 0.42, KC.stoneD);
    b.cyl(0, 0.1, 0, 0.15, 0.46, c, 12);
    b.add(T.rock(1), L(0.04, 0.55, 0, 0.13, 0.09, 0.12, 0, 0.5, 0.3), c);
    b.add(T.rock(2), L(-0.06, 0.55, 0.03, 0.09, 0.07, 0.09), c);
    b.add(T.cylc(12), L(0.04, 0.13, 0.3, 0.13, 0.3, 0.13, 0, 0.4, Math.PI / 2), c);
    rubble(ctx, 4, 0.35, c);
  },
  bones(ctx) {
    const b = ctx.b;
    b.sph(0.12, 0.055, 0.06, 0.075, 0.065, 0.085, KC.bone);
    for (const s of [-1, 1]) b.sph(0.12 + s * 0.03, 0.065, 0.13, 0.02, 0.02, 0.012, KC.dark, 0);
    b.box(0.12, 0, 0.11, 0.07, 0.03, 0.05, KC.bone);
    for (let i = 0; i < 4; i++) b.add(T.torus(), L(-0.12 + i * 0.05, 0.0, -0.05, 0.085 - i * 0.008, 0.085 - i * 0.008, 0.085, 0, Math.PI / 2, 0), KC.bone);
    b.add(T.cylc(6), L(-0.05, 0.012, -0.05, 0.012, 0.24, 0.012, 0, 0, Math.PI / 2), KC.bone);
    b.add(T.cylc(6), L(-0.02, 0.02, 0.2, 0.016, 0.26, 0.016, 0, 0.7, Math.PI / 2), KC.bone);
    for (const s of [-1, 1]) b.sph(-0.02 + s * 0.1, 0.02, 0.2 - s * 0.085, 0.03, 0.025, 0.03, KC.bone, 0);
  },
  crystal(ctx, o) {
    const b = ctx.b, col = o.color ?? 0x7fe0ff;
    b.add(T.rock(3), L(0, 0, 0, 0.22, 0.1, 0.2), KC.stoneD);
    b.emit = lin(col, 0.9).concat(2);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, d = i === 0 ? 0 : 0.09, s = i === 0 ? 1.15 : 0.6 + ctx.rng() * 0.3;
      b.add(T.oct(), L(Math.cos(a) * d, 0.08 + 0.17 * s, Math.sin(a) * d, 0.06 * s, 0.24 * s, 0.06 * s, Math.sin(a) * 0.35 * (d > 0), a, Math.cos(a) * 0.35 * (d > 0)), col);
    }
    b.emit = null;
    ctx.fx(0, 0.3, 0, 0.8, 1, col, 0.45);
    ctx.fx(0.05, 0.45, 0.05, 0.14, 3, 0xffffff, 1.5);
    ctx.light(0, 0.45, 0, col, 0.6);
  },
  haystack(ctx) {
    const b = ctx.b;
    b.sph(0, 0.1, 0, 0.32, 0.26, 0.32, KC.hay);
    b.sph(0.02, 0.3, 0, 0.21, 0.17, 0.2, tint(KC.hay, 0.12));
    b.sph(-0.05, 0.43, 0.02, 0.09, 0.07, 0.09, tint(KC.hay, 0.2));
    b.beam([0.15, 0.0, 0.25], [0.05, 0.55, 0.1], 0.012, KC.woodD, 4);
  },
  windmill: (ctx, o) => windmill(ctx, o),
  banner(ctx, o) {
    const b = ctx.b, col = o.color ?? KC.red;
    b.cyl(0, 0, 0, 0.026, 1.28, KC.woodD, 6);
    b.box(0, 0, 0, 0.1, 0.05, 0.1, KC.iron);
    b.sph(0, 1.3, 0, 0.035, 0.05, 0.035, KC.gold, 0);
    hangBanner(ctx, 0, 1.16, 0.035, 0.34, 0.62, col, KC.gold, 0.05);
  },
  tree: (ctx) => ctx.vegTree('broad', 0, 0, 1.05),
  pine: (ctx) => ctx.vegTree('pine', 0, 0, 1.05),
  deadTree: (ctx) => deadTree(ctx, 1, ctx.ashen ? 0x3e3532 : 0x6b5d52),
  palm: (ctx) => palm(ctx, 1),
  rock: (ctx) => ctx.vegRock(0, 0, 0.16, ctx.rng() * TAU),
  boulder: (ctx) => ctx.vegRock(0, 0, 0.36, ctx.rng() * TAU),
  tower: (ctx, o) => tower(ctx, o.height ?? 2.6, o.color ?? 0x4f6d9a, o.flag ?? KC.red),
};
export { palm, deadTree };

// ------------------------------------------------------------------------------------------- structures
/** Round castle tower used by castle surroundings. */
export function tower(ctx, h, roof, flagCol) {
  const b = ctx.b;
  b.cyl(0, 0, 0, 0.46, h, 0x9e988c, 12);
  b.cyl(0, h * 0.35, 0, 0.47, 0.05, 0x87817a, 12);
  b.cyl(0, h - 0.06, 0, 0.52, 0.12, 0x8a847a, 12);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    b.box(Math.cos(a) * 0.45, h + 0.06, Math.sin(a) * 0.45, 0.13, 0.16, 0.12, 0x9e988c, 0, -a, 0);
  }
  b.add(T.cone(12), L(0, h + 0.12, 0, 0.42, 0.75, 0.42), roof);
  b.cyl(0, h + 0.85, 0, 0.012, 0.35, KC.woodD, 4);
  poleFlag(ctx, 0.012, h + 0.98, 0, 0.26, 0.16, flagCol);
  b.emit = lin(0xffb860, 1.6).concat(1);
  for (let i = 0; i < 3; i++) {
    const a = 0.4 + i * 2.1;
    b.box(Math.cos(a) * 0.45, h * 0.55, Math.sin(a) * 0.45, 0.04, 0.12, 0.07, 0x30364a, 0, -a, 0);
  }
  b.emit = null;
}

/**
 * Crenellations on a wall tile. Local origin = tile centre on the wall top.
 * exposed: { E, W, S, N } booleans for edges facing open ground.
 */
export function wallTop(ctx, exposed, col = 0x9a958b) {
  const b = ctx.b;
  const dirs = [['E', 0], ['S', -Math.PI / 2], ['W', Math.PI], ['N', Math.PI / 2]];
  for (const [k, ry] of dirs) {
    if (!exposed[k]) continue;
    b.pushT(0, 0, 0, ry);
    for (const z of [-0.25, 0.25]) b.box(0.43, 0, z, 0.14, 0.22, 0.24, col);
    b.box(0.5, -0.13, 0, 0.06, 0.05, 1.0, tint(col, -0.12));
    b.pop();
  }
}

/** Gatehouse arch: local passage along z, opening spans x. relH = height above the tile top. */
export function gate(ctx, relH, bannerCol) {
  const b = ctx.b;
  const H = relH + 0.32, s = 0.78, r = 0.27;
  for (const sx of [-1, 1]) {
    b.box(sx * 0.415, 0, 0, 0.17, H, 1.0, 0x958f84);
    b.box(sx * 0.415, H - 0.02, 0, 0.19, 0.05, 1.02, 0x80796f);
  }
  b.add(T.arch(H, s, r, 0.335, 0.56), L(0, 0, 0), 0xa29c90);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    b.boxc(Math.cos(a) * (r + 0.03), s + Math.sin(a) * (r + 0.03), 0, 0.07, 0.05, 0.6, i % 2 ? 0xb8b2a4 : 0xc8c2b4, 0, 0, a + Math.PI / 2);
  }
  for (const z of [-0.47, 0.47]) for (let i = 0; i < 4; i++) b.box(-0.375 + i * 0.25, H + 0.03, z, 0.15, 0.2, 0.1, 0x958f84);
  for (let i = 0; i < 6; i++) {
    const x = -0.2 + i * 0.08;
    const top = s + Math.sqrt(Math.max(0, r * r - x * x)) - 0.01;
    b.box(x, s - 0.06, 0, 0.018, top - s + 0.06, 0.02, KC.iron);
    b.add(T.cone(4), L(x, s - 0.06, 0, 0.012, 0.045, 0.012, Math.PI, 0, 0), KC.iron);
  }
  for (const y of [s + 0.02, s + 0.13]) b.box(0, y, 0, 0.5, 0.018, 0.022, KC.iron);
  for (const z of [-1, 1]) {
    b.pushT(0, 0, z * 0.5, z > 0 ? 0 : Math.PI);
    ctx.cloth.reset(b.top);
    hangBanner(ctx, 0, H - 0.07, -0.2, 0.24, 0.3, bannerCol, KC.gold, 0.035);
    for (const sx of [-1, 1]) {
      b.box(sx * 0.42, s - 0.05, 0.02, 0.04, 0.12, 0.05, KC.iron);
      b.cyl(sx * 0.42, s + 0.07, 0.05, 0.035, 0.05, KC.iron, 8, 1.6);
      flameAt(ctx, sx * 0.42, s + 0.12, 0.05, 0.2, 0.7, 0.6, z > 0 ? 1.5 : 0);
    }
    b.pop();
  }
  ctx.cloth.reset(b.top);
}

/** Timber-framed cottage (door facing local +z). Returns door hinge matrix (local). */
export function house(ctx, v, hasVillage) {
  const b = ctx.b;
  const { plaster, roof, timber, shutter } = v;
  b.box(0, 0, 0, 0.86, 0.09, 0.78, KC.stoneD);
  b.box(0, 0.09, 0, 0.78, 0.5, 0.7, plaster);
  const yT = 0.59;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(x * 0.385, 0.09, z * 0.345, 0.05, 0.51, 0.05, timber);
  for (const z of [-0.355, 0.355]) { b.box(0, yT - 0.04, z, 0.8, 0.05, 0.03, timber); b.box(0, 0.32, z, 0.8, 0.035, 0.025, timber); }
  for (const x of [-0.395, 0.395]) {
    b.box(x, yT - 0.04, 0, 0.025, 0.05, 0.72, timber);
    for (const s of [-1, 1]) b.boxc(x, 0.34, s * 0.17, 0.022, 0.42, 0.035, timber, s * 0.75, 0, 0);
  }
  const rise = 0.36, half = 0.35 + 0.09, ang = Math.atan2(rise, half), slen = Math.hypot(half, rise) + 0.04;
  b.add(T.prism(), L(0, yT, 0, 0.7, rise, 0.78, 0, Math.PI / 2, 0), plaster);
  const ga = Math.atan2(0.35, rise), gl = Math.hypot(0.35, rise) * 1.02;
  for (const x of [-0.392, 0.392]) {
    b.box(x, yT, 0, 0.026, 0.035, 0.72, timber);
    b.boxc(x, yT + rise * 0.5, -0.175, 0.026, gl, 0.03, timber, ga, 0, 0);
    b.boxc(x, yT + rise * 0.5, 0.175, 0.026, gl, 0.03, timber, -ga, 0, 0);
    b.boxc(x, yT + rise * 0.36, 0, 0.026, rise * 0.7, 0.03, timber);
  }
  for (const s of [-1, 1]) {
    b.boxc(0, yT + rise / 2 + 0.03, s * half / 2, 0.96, 0.055, slen, roof, s * ang, 0, 0);
    b.boxc(0, yT + rise / 2 + 0.045, s * half / 2, 0.97, 0.012, slen * 0.94, tint(roof, 0.12), s * ang, 0, 0);
  }
  b.box(0, yT + rise + 0.005, 0, 0.98, 0.05, 0.07, tint(roof, -0.25));
  b.box(0.24, yT + 0.1, -0.13, 0.12, 0.42, 0.12, KC.stone);
  b.box(0.24, yT + 0.5, -0.13, 0.15, 0.04, 0.15, KC.stoneD);
  const dx = -0.14;
  b.box(dx, 0.09, 0.352, 0.26, 0.37, 0.03, timber);
  b.emit = hasVillage ? lin(0xffa040, 0.9).concat(1) : null;
  b.box(dx, 0.1, 0.36, 0.2, 0.34, 0.012, 0x2a1a12);
  b.emit = null;
  b.box(dx, 0.07, 0.4, 0.3, 0.025, 0.1, KC.stone);
  const win = (x, y, z, ry) => {
    b.pushT(x, y, z, ry);
    b.box(0, 0, 0, 0.16, 0.15, 0.03, timber);
    b.emit = lin(0xffb44a, 2.2).concat(1);
    b.box(0, 0.012, 0.008, 0.125, 0.125, 0.025, 0x3a4664);
    b.emit = null;
    b.box(0, 0.012, 0.02, 0.012, 0.125, 0.01, timber);
    b.box(0, 0.068, 0.02, 0.125, 0.012, 0.01, timber);
    for (const s of [-1, 1]) b.box(s * 0.11, 0.0, 0.0, 0.05, 0.15, 0.02, shutter, 0, s * 0.25, 0);
    b.pop();
  };
  win(0.17, 0.3, 0.352, 0);
  b.box(0.17, 0.27, 0.38, 0.2, 0.04, 0.06, KC.woodD);
  for (let i = 0; i < 4; i++) b.sph(0.1 + i * 0.045, 0.32, 0.385, 0.028, 0.025, 0.028, [0xf07aa8, 0xe8c440, 0xd6d0c4, 0xe0503a][(i + v.seed) % 4], 0);
  win(0.395, 0.3, 0.05, Math.PI / 2);
  win(-0.395, 0.3, -0.05, -Math.PI / 2);
  win(-0.12, 0.3, -0.352, Math.PI);
  return L(dx - 0.1, 0.1, 0.375).clone();
}

/** Doorstep decorations for a village tile. Local -z faces the house. */
export function doorstep(ctx, seed) {
  const b = ctx.b;
  b.box(0.38, 0, -0.38, 0.08, 0.04, 0.08, KC.stoneD);
  b.cyl(0.38, 0.04, -0.38, 0.02, 0.62, KC.iron, 6);
  b.box(0.38, 0.64, -0.38, 0.02, 0.02, 0.13, KC.iron);
  b.emit = lin(0xffc36a, 2.4).concat(1);
  b.box(0.38, 0.52, -0.31, 0.07, 0.09, 0.07, 0xffe6b0);
  b.emit = null;
  b.add(T.cone(4), L(0.38, 0.61, -0.31, 0.06, 0.06, 0.06, 0, Math.PI / 4, 0), KC.iron);
  if (ctx.night > 0.25) { ctx.fx(0.38, 0.56, -0.31, 0.75, 1, 0xffc070, 0.5 * ctx.night); ctx.light(0.38, 0.6, -0.31, 0xffc070, 0.9); }
  const pot = (x, z, c) => {
    b.cyl(x, 0, z, 0.06, 0.09, 0xb0603a, 8, 1.25);
    b.sph(x, 0.13, z, 0.07, 0.06, 0.07, 0x4f9a3c);
    for (let i = 0; i < 3; i++) b.sph(x + Math.cos(i * 2.1) * 0.04, 0.17, z + Math.sin(i * 2.1) * 0.04, 0.022, 0.02, 0.022, c, 0);
  };
  pot(-0.39, -0.4, [0xf07aa8, 0xe8c440, 0xe0503a][seed % 3]);
  pot(-0.25, -0.43, [0xd6d0c4, 0x93aef0, 0xf07aa8][seed % 3]);
  b.box(-0.4, 0, 0.36, 0.035, 0.32, 0.035, KC.woodD);
  b.box(-0.4, 0.2, 0.36, 0.2, 0.12, 0.02, KC.woodL);
  b.box(-0.4, 0.245, 0.372, 0.1, 0.02, 0.008, 0x7a4a26);
}

/** Small walkable fort: low stone ring with gaps toward open neighbours, towers and a flag. */
export function fort(ctx, open, flagCol) {
  const b = ctx.b, st = 0x9d978a;
  const dirs = [['E', 0], ['S', -Math.PI / 2], ['W', Math.PI], ['N', Math.PI / 2]];
  for (const [k, ry] of dirs) {
    b.pushT(0, 0, 0, ry);
    if (open[k]) {
      for (const s of [-1, 1]) {
        b.box(0.44, 0, s * 0.3, 0.1, 0.2, 0.22, st);
        b.box(0.44, 0.2, s * 0.33, 0.1, 0.06, 0.08, st);
      }
    } else {
      b.box(0.44, 0, 0, 0.1, 0.2, 0.82, st);
      for (const z of [-0.27, 0, 0.27]) b.box(0.44, 0.2, z, 0.1, 0.06, 0.08, st);
    }
    b.pop();
  }
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.cyl(x * 0.42, 0, z * 0.42, 0.09, 0.34, tint(st, -0.08), 8);
    b.add(T.cone(8), L(x * 0.42, 0.34, z * 0.42, 0.11, 0.16, 0.11), 0x8a4a32);
  }
  b.cyl(-0.42, 0.45, -0.42, 0.013, 0.5, KC.woodD, 4);
  poleFlag(ctx, -0.42 + 0.013, 0.72, -0.42, 0.28, 0.18, flagCol);
}

/** Throne at the back (local -z) of the tile with two banners. */
export function throne(ctx, golden, bannerCol) {
  const b = ctx.b;
  const gold = golden ? 0xf2c24e : KC.gold, velvet = 0xa3222c;
  b.box(0, 0, -0.22, 0.84, 0.05, 0.52, KC.goldD);
  b.box(0, 0.05, -0.24, 0.72, 0.05, 0.44, velvet);
  b.box(0, 0.1, -0.27, 0.38, 0.16, 0.3, gold);
  b.box(0, 0.26, -0.26, 0.34, 0.04, 0.28, velvet);
  b.box(0, 0.1, -0.43, 0.42, 0.72, 0.09, gold);
  b.box(0, 0.3, -0.385, 0.28, 0.48, 0.02, velvet);
  b.add(T.prism(), L(0, 0.82, -0.43, 0.42, 0.16, 0.09), gold);
  for (const s of [-1, 1]) {
    b.box(s * 0.205, 0.26, -0.26, 0.06, 0.12, 0.3, gold);
    b.sph(s * 0.205, 0.39, -0.12, 0.035, 0.035, 0.035, gold, 0);
    b.add(T.cone(6), L(s * 0.2, 0.82, -0.43, 0.04, 0.14, 0.04), gold);
  }
  b.emit = lin(0xff3040, 0.9).concat(2);
  b.sph(0, 0.88, -0.38, 0.04, 0.04, 0.025, 0xff3a4a, 0);
  b.emit = null;
  for (const s of [-1, 1]) {
    b.cyl(s * 0.42, 0, -0.44, 0.022, 1.36, KC.woodD, 6);
    b.sph(s * 0.42, 1.38, -0.44, 0.032, 0.045, 0.032, gold, 0);
    hangBanner(ctx, s * 0.42, 1.25, -0.41, 0.2, 0.62, bannerCol, gold, 0.04);
  }
}

/** Tall stone column on a non-walkable pillar tile. */
export function pillar(ctx, golden, h = 2.2) {
  const b = ctx.b;
  const st = golden ? 0xd3c8b2 : 0xb2ab9d, trim = golden ? 0xd9a840 : 0x9a9488;
  b.box(0, 0, 0, 0.52, 0.12, 0.52, golden ? 0xc4b9a2 : 0x8f897d);
  b.box(0, 0.12, 0, 0.44, 0.07, 0.44, trim);
  b.cyl(0, 0.19, 0, 0.2, 0.06, trim, 14);
  b.cyl(0, 0.25, 0, 0.165, h - 0.45, st, 14);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    b.box(Math.cos(a) * 0.161, 0.27, Math.sin(a) * 0.161, 0.014, h - 0.5, 0.016, tint(st, -0.12), 0, -a, 0);
  }
  b.cyl(0, h - 0.2, 0, 0.19, 0.08, trim, 14, 1.25);
  b.box(0, h - 0.12, 0, 0.5, 0.1, 0.5, trim);
  b.box(0, h - 0.02, 0, 0.44, 0.05, 0.44, st);
  if (golden) {
    b.emit = lin(0xffc04a, 0.3).concat(2);
    b.cyl(0, h - 0.3, 0, 0.172, 0.06, 0xf6c850, 14);
    b.emit = null;
  }
}

/** Decorations for the raised runic altar (corner rune stones). */
export function altarDeco(ctx, rune) {
  const b = ctx.b;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    b.box(x * 0.4, 0, z * 0.4, 0.1, 0.05, 0.1, KC.stoneD);
    b.add(T.cyl(4, 0.6), L(x * 0.4, 0.05, z * 0.4, 0.05, 0.22, 0.05, 0, Math.PI / 4, 0), KC.stone);
    b.emit = lin(rune, 1.6).concat(2);
    b.add(T.oct(), L(x * 0.4, 0.33, z * 0.4, 0.035, 0.06, 0.035), rune);
    b.emit = null;
    ctx.fx(x * 0.4, 0.33, z * 0.4, 0.35, 1, rune, 0.45);
  }
}

/** Broken column chunks on a ruins tile (centre kept clear). */
export function ruins(ctx, golden) {
  const b = ctx.b, c = golden ? 0xd2c9b6 : 0xb4ad9f;
  const a = Math.floor(ctx.rng() * 4) * (Math.PI / 2) + Math.PI / 4;
  const cx = Math.cos(a) * 0.32, cz = Math.sin(a) * 0.32;
  b.box(cx, 0, cz, 0.3, 0.07, 0.3, tint(c, -0.2));
  b.cyl(cx, 0.07, cz, 0.12, 0.2 + ctx.rng() * 0.25, c, 10);
  b.add(T.rock(2), L(cx, 0.32, cz, 0.1, 0.08, 0.1, 0, a, 0.2), c);
  const a2 = a + Math.PI * (0.8 + ctx.rng() * 0.4);
  b.add(T.cylc(10), L(Math.cos(a2) * 0.3, 0.11, Math.sin(a2) * 0.3, 0.11, 0.26, 0.11, 0, a2, Math.PI / 2), c);
  b.boxc(Math.cos(a2 + 1.4) * 0.33, 0.03, Math.sin(a2 + 1.4) * 0.33, 0.22, 0.05, 0.16, tint(c, -0.1), 0.12, a2, 0.08);
  rubble(ctx, 3, 0.42, c, 0.9);
}

/** Plank bridge deck (top at local y = 0) running along local x, with rails and posts down to postDepth. */
export function bridge(ctx, railsZ, postDepth, endsX, postsX = [-0.42, 0.42]) {
  const b = ctx.b;
  const plank = [0x9c6b3e, 0x8f6036, 0xa8744a];
  for (let i = 0; i < 9; i++) {
    const x = -0.5 + 0.0555 + i * 0.111;
    b.box(x, -0.05, 0, 0.1, 0.05, 0.92, plank[(i * 7 + Math.floor(ctx.rng() * 3)) % 3], 0, (ctx.rng() - 0.5) * 0.03, 0);
  }
  for (const z of [-0.3, 0.3]) b.box(0, -0.13, z, 1.0, 0.08, 0.07, KC.woodD);
  for (const z of railsZ) {
    for (const x of postsX) {
      b.box(x, -postDepth, z, 0.07, postDepth + 0.36, 0.07, KC.woodD);
      b.add(T.cone(4), L(x, 0.36, z, 0.055, 0.05, 0.055, 0, Math.PI / 4, 0), KC.woodD);
    }
    b.box(0, 0.27, z, 1.0, 0.05, 0.045, KC.wood);
    b.box(0, 0.13, z, 1.0, 0.035, 0.035, KC.wood);
  }
  for (const x of endsX) b.box(x, -0.06, 0, 0.06, 0.07, 0.94, KC.woodD);
}

// ------------------------------------------------------------------------------------------- vegetation kit
function finishVeg(b, tintW) {
  const { geometry, outline } = b.build();
  const n = geometry.attributes.position.count;
  const tw = new Float32Array(n);
  if (tintW) tw.set(tintW); else tw.fill(1);
  geometry.setAttribute('aTintW', new THREE.BufferAttribute(tw, 1));
  return { geometry, outline };
}

/** Geometries for instanced vegetation. All carry vertex colours (multiplied by the instance colour). */
export function vegetationKit() {
  const kit = {};
  let b = new GeoBuilder({ size: 2048 });
  b.add(tpl('trunk', () => new THREE.CylinderGeometry(0.62, 1, 1, 6, 1, true).translate(0, 0.5, 0)), L(0, 0, 0), 0xffffff);
  b.add(tpl('flare', () => new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0)), L(0, -0.02, 0, 1.7, 0.14, 1.7), 0xffffff);
  kit.trunk = finishVeg(b);

  b = new GeoBuilder({ size: 2048 });
  {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (hash3(x, y, z, 7) - 0.5) * 0.24;
      p.setXYZ(i, x * k, y * k * (y < 0 ? 0.82 : 1), z * k);
    }
    const t = toTemplate(g, false);
    t.col = new Float32Array(t.n * 3);
    for (let i = 0; i < t.n; i++) {
      const x = t.pos[i * 3], y = t.pos[i * 3 + 1], z = t.pos[i * 3 + 2];
      const nx = x, ny = y * 1.1 + 0.18, nz = z;
      const l = Math.hypot(nx, ny, nz) || 1;
      t.nrm[i * 3] = nx / l; t.nrm[i * 3 + 1] = ny / l; t.nrm[i * 3 + 2] = nz / l;
      const k = 0.7 + 0.34 * Math.min(1, Math.max(0, (y + 1) / 2));
      t.col[i * 3] = k; t.col[i * 3 + 1] = k; t.col[i * 3 + 2] = k;
    }
    b.add(t, L(0, 0, 0), 0xffffff);
  }
  kit.blob = finishVeg(b);

  b = new GeoBuilder({ size: 2048 });
  const layers = [[1.0, 0.72, 0.0, 0.74], [0.8, 0.62, 0.34, 0.88], [0.56, 0.56, 0.66, 1.03]];
  for (const [r, h, y, k] of layers) b.add(T.cone(8), L(0, y, 0, r, h, r), new THREE.Color(k, k, k).getHex());
  kit.pine = finishVeg(b);

  b = new GeoBuilder({ size: 2048 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash3(i, 1, 2) * 0.6;
    const h = 0.11 + hash3(i, 3, 4) * 0.08;
    const lean = 0.25 + hash3(i, 5, 6) * 0.25;
    b.add(bladeTpl(), L(Math.cos(a) * 0.025, 0, Math.sin(a) * 0.025, 0.035, h, 0.035, 0, -a, -lean), 0xffffff);
  }
  kit.tuft = finishVeg(b);

  b = new GeoBuilder({ size: 2048 });
  b.add(bladeTpl(), L(0, 0, 0, 0.012, 0.13, 0.012), 0x3f7a2c);
  b.add(bladeTpl(), L(0, 0, 0, 0.03, 0.07, 0.03, 0, 1.2, 0.5), 0x4f8f36);
  const stemVerts = b.nv;
  b.add(T.cone(5), L(0, 0.118, 0, 0.042, 0.018, 0.042), 0xffffff);
  const petalVerts = b.nv;
  b.add(T.cone(3), L(0, 0.13, 0, 0.014, 0.014, 0.014), 0xffd84a);
  const tw = new Float32Array(b.nv);
  for (let i = stemVerts; i < petalVerts; i++) tw[i] = 1;
  kit.flower = finishVeg(b, tw);

  b = new GeoBuilder({ size: 2048 });
  b.add(T.rock(5), L(0, 0, 0), 0xffffff);
  kit.rock = finishVeg(b);
  return kit;
}

let _blade = null;
function bladeTpl() {
  if (_blade) return _blade;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.1, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([0.55, 0.62, 0.5, 0.55, 0.62, 0.5, 1.12, 1.15, 1.0], 3));
  _blade = toTemplate(g, false);
  return _blade;
}
