// Character rig toolkit: bone layouts, a skinned "part assembler" that bakes many small
// primitives into one vertex-coloured SkinnedMesh per material layer, procedural geometry
// helpers, a keyframe pose/clip evaluator and spring chains for capes, hair and scarves.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { smoothNormalGeometry } from './toon.js';

/** Degrees to radians. */
export const D2R = Math.PI / 180;
/** Clamp v into [a, b]. */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;
/** Hermite smoothstep of x between edges a and b. */
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Deterministic hash RNG (mulberry-style) so builds and idle twitches are reproducible. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string. */
export function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

// ------------------------------------------------------------------ rig layout
/**
 * Bone layout with identity rest rotations; every bone stores its model-space rest position,
 * so parts can be authored directly in model coordinates (feet at origin, +Z forward, +X = left).
 */
export class RigDef {
  constructor() { this.names = []; this.parent = []; this.pos = []; this.index = Object.create(null); }
  bone(name, parentName, x, y, z) {
    const i = this.names.length;
    this.names.push(name);
    this.parent.push(parentName == null ? -1 : this.index[parentName]);
    this.pos.push(new THREE.Vector3(x, y, z));
    this.index[name] = i;
    return i;
  }
  get count() { return this.names.length; }
  has(name) { return this.index[name] !== undefined; }
  idx(name) { return typeof name === 'number' ? name : this.index[name]; }
  /** Rest position relative to the parent bone. */
  local(i, target = new THREE.Vector3()) {
    const p = this.parent[i];
    target.copy(this.pos[i]);
    if (p >= 0) target.sub(this.pos[p]);
    return target;
  }
}

/** Instantiate THREE.Bone objects for a RigDef; returns { bones, root } (root = first bone). */
export function makeBones(def) {
  const bones = [];
  for (let i = 0; i < def.count; i++) {
    const b = new THREE.Bone();
    b.name = def.names[i];
    def.local(i, b.position);
    bones.push(b);
    const p = def.parent[i];
    if (p >= 0) bones[p].add(b);
  }
  return { bones, root: bones[0] };
}

/** Inverse bind matrices for identity-rotation rest poses (pure translations). */
export function boneInverses(def) {
  return def.pos.map((p) => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}

// ------------------------------------------------------------------ geometry cache + primitives
const geoCache = new Map();
/** Memoise a geometry under `key`. */
export function cachedGeo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

const flatCache = new WeakMap();
function flatVersion(geo) {
  let g = flatCache.get(geo);
  if (!g) {
    g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('normal');
    g.computeVertexNormals();
    flatCache.set(geo, g);
  }
  return g;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Shared primitive generators (unit sized where sensible; place them with part matrices). */
export const prim = {
  sphere: (w = 16, h = 12) => cachedGeo(`sph${w}/${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** Partial sphere; angles in radians (three's phi/theta convention). */
  sphereCut: (w, h, phiStart, phiLen, thetaStart, thetaLen) => cachedGeo(
    `sphc${w}/${h}/${r3(phiStart)}/${r3(phiLen)}/${r3(thetaStart)}/${r3(thetaLen)}`,
    () => new THREE.SphereGeometry(1, w, h, phiStart, phiLen, thetaStart, thetaLen)),
  box: () => cachedGeo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  rbox: (radius = 0.2, seg = 2) => cachedGeo(`rbox${r3(radius)}/${seg}`, () => new RoundedBoxGeometry(1, 1, 1, seg, radius)),
  /** Unit-height cylinder centred at the origin. */
  cyl: (rTop = 1, rBot = 1, seg = 12, open = false, hSeg = 1) => cachedGeo(
    `cyl${r3(rTop)}/${r3(rBot)}/${seg}/${open}/${hSeg}`, () => new THREE.CylinderGeometry(rTop, rBot, 1, seg, hSeg, open)),
  cone: (seg = 10) => cachedGeo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg, 1)),
  torus: (tube = 0.2, rs = 8, ts = 20, arc = Math.PI * 2) => cachedGeo(
    `tor${r3(tube)}/${rs}/${ts}/${r3(arc)}`, () => new THREE.TorusGeometry(1, tube, rs, ts, arc)),
  capsule: (r = 0.5, len = 1, cap = 4, rad = 10) => cachedGeo(
    `cap${r3(r)}/${r3(len)}/${cap}/${rad}`, () => new THREE.CapsuleGeometry(r, len, cap, rad)),
  octa: () => cachedGeo('octa', () => flatVersion(new THREE.OctahedronGeometry(1, 0))),
  ico: (detail = 0) => cachedGeo(`ico${detail}`, () => flatVersion(new THREE.IcosahedronGeometry(1, detail))),
  /** Lathe from [[r, y], ...] profile (bottom to top). */
  lathe: (profile, seg = 16, phiStart = 0, phiLen = Math.PI * 2) => cachedGeo(
    `lat${seg}/${r3(phiStart)}/${r3(phiLen)}/${profile.map((p) => `${r3(p[0])},${r3(p[1])}`).join(';')}`,
    () => new THREE.LatheGeometry(profile.map((p) => new THREE.Vector2(p[0], p[1])), seg, phiStart, phiLen)),
  /** Flat polygon (XY plane) extruded along Z and centred on Z. */
  slab: (key, pts, depth = 0.1, bevel = 0) => cachedGeo(`slab${key}/${r3(depth)}/${r3(bevel)}`, () => {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, steps: 1, curveSegments: 6,
    });
    g.translate(0, 0, -depth / 2);
    g.deleteAttribute('uv');
    return g;
  }),
  flat: flatVersion,
};

const _sv = new THREE.Vector3(), _st = new THREE.Vector3(), _sb = new THREE.Vector3(), _sn = new THREE.Vector3(), _side = new THREE.Vector3();

/**
 * Tube swept through Catmull-Rom control points with an elliptical, tapering cross-section.
 * radius(u) returns a number or [rSide, rNormal]; `side` fixes the cross-section orientation,
 * which keeps flattened hair locks, blades and tails lying the right way.
 */
export function sweepGeo(key, pts, radius, { seg = 10, radial = 8, side = [1, 0, 0], capStart = true, capEnd = true } = {}) {
  return cachedGeo(`swp${key}/${seg}/${radial}`, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const pos = [], idx = [];
    _side.set(side[0], side[1], side[2]).normalize();
    const rings = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      curve.getPoint(u, _sv);
      curve.getTangent(u, _st).normalize();
      _sb.copy(_side).addScaledVector(_st, -_side.dot(_st));
      if (_sb.lengthSq() < 1e-8) _sb.set(0, 0, 1).addScaledVector(_st, -_st.z);
      _sb.normalize();
      _sn.crossVectors(_st, _sb);
      const r = radius(u);
      const rx = Array.isArray(r) ? r[0] : r, rz = Array.isArray(r) ? r[1] : r;
      const start = pos.length / 3;
      rings.push({ start, c: _sv.clone(), rx });
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        pos.push(_sv.x + _sb.x * rx * ca + _sn.x * rz * sa, _sv.y + _sb.y * rx * ca + _sn.y * rz * sa, _sv.z + _sb.z * rx * ca + _sn.z * rz * sa);
      }
    }
    for (let i = 0; i < seg; i++) {
      const r0 = rings[i].start, r1 = rings[i + 1].start;
      for (let j = 0; j < radial; j++) {
        const j1 = (j + 1) % radial;
        const a = r0 + j, b = r1 + j, c = r0 + j1, d = r1 + j1;
        idx.push(a, c, b, b, c, d);
      }
    }
    if (capStart && rings[0].rx > 1e-5) {
      const c = pos.length / 3; const p = rings[0].c; pos.push(p.x, p.y, p.z);
      for (let j = 0; j < radial; j++) idx.push(c, rings[0].start + ((j + 1) % radial), rings[0].start + j);
    }
    const last = rings[seg];
    if (capEnd && last.rx > 1e-5) {
      const c = pos.length / 3; const p = last.c; pos.push(p.x, p.y, p.z);
      for (let j = 0; j < radial; j++) idx.push(c, last.start + j, last.start + ((j + 1) % radial));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Thin closed slab through a grid of points rows[i][j] = [x,y,z] (rows run down the strip).
 * Both faces render with a front-side material, so capes, scarf tails and wing membranes
 * need no DoubleSide and keep a proper outline hull. `hint` = rough direction of the outer face.
 */
export function stripGeo(key, rows, thickness = 0.012, hint = [0, 0, -1]) {
  return cachedGeo(`strip${key}/${r3(thickness)}`, () => {
    const nr = rows.length, nc = rows[0].length;
    const H = new THREE.Vector3(...hint).normalize();
    const du = new THREE.Vector3(), dv = new THREE.Vector3(), nrm = new THREE.Vector3();
    const pos = [], idx = [], want = [];
    const at = (i, j) => rows[clamp(i, 0, nr - 1)][clamp(j, 0, nc - 1)];
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 0.5 : -0.5;
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nc; j++) {
          const a = at(i, j + 1), b = at(i, j - 1), c = at(i + 1, j), d = at(i - 1, j);
          du.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          dv.set(c[0] - d[0], c[1] - d[1], c[2] - d[2]);
          nrm.crossVectors(du, dv).normalize();
          if (nrm.dot(H) < 0) nrm.negate();
          const p = rows[i][j];
          pos.push(p[0] + nrm.x * thickness * sgn, p[1] + nrm.y * thickness * sgn, p[2] + nrm.z * thickness * sgn);
          want.push(nrm.x * sgn * 2, nrm.y * sgn * 2, nrm.z * sgn * 2);
        }
      }
    }
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), w = new THREE.Vector3();
    const tri = (a, b, c, wx, wy, wz) => {
      pa.fromArray(pos, a * 3); pb.fromArray(pos, b * 3); pc.fromArray(pos, c * 3);
      pb.sub(pa); pc.sub(pa); pb.cross(pc);
      w.set(wx, wy, wz);
      if (pb.dot(w) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
    };
    const off = nr * nc;
    for (let s = 0; s < 2; s++) {
      const o = s * off;
      for (let i = 0; i < nr - 1; i++) {
        for (let j = 0; j < nc - 1; j++) {
          const a = o + i * nc + j, b = a + 1, c = a + nc, d = c + 1;
          const wx = want[a * 3], wy = want[a * 3 + 1], wz = want[a * 3 + 2];
          tri(a, b, c, wx, wy, wz); tri(b, d, c, wx, wy, wz);
        }
      }
    }
    const edge = (a, b, ox, oy, oz) => { tri(a, b, off + a, ox, oy, oz); tri(b, off + b, off + a, ox, oy, oz); };
    for (let i = 0; i < nr - 1; i++) {
      const l = i * nc, r = i * nc + nc - 1;
      const lo = rows[i][0], li = rows[i][1], ro = rows[i][nc - 1], ri = rows[i][nc - 2];
      edge(l, l + nc, lo[0] - li[0], lo[1] - li[1], lo[2] - li[2]);
      edge(r, r + nc, ro[0] - ri[0], ro[1] - ri[1], ro[2] - ri[2]);
    }
    for (let j = 0; j < nc - 1; j++) {
      const t = j, b = (nr - 1) * nc + j;
      const to = rows[0][j], ti = rows[1][j], bo = rows[nr - 1][j], bi = rows[nr - 2][j];
      edge(t, t + 1, to[0] - ti[0], to[1] - ti[1], to[2] - ti[2]);
      edge(b, b + 1, bo[0] - bi[0], bo[1] - bi[1], bo[2] - bi[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------------ skinned part assembler
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _lv = new THREE.Vector3(), _ln = new THREE.Vector3();
const _col = new THREE.Color(), _M = new THREE.Matrix4(), _NM = new THREE.Matrix3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s3 = new THREE.Vector3(), _t3 = new THREE.Vector3();

/** Build a part matrix from { at:[x,y,z], rot:[rx,ry,rz] (radians), scl: n | [sx,sy,sz] } or { m }. */
export function partMatrix(o, target = _M) {
  if (o.m) return target.copy(o.m);
  const r = o.rot, s = o.scl, t = o.at;
  _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, o.order || 'XYZ');
  _q.setFromEuler(_e);
  if (s === undefined) _s3.set(1, 1, 1); else if (typeof s === 'number') _s3.set(s, s, s); else _s3.set(s[0], s[1], s[2]);
  _t3.set(t ? t[0] : 0, t ? t[1] : 0, t ? t[2] : 0);
  return target.compose(_t3, _q, _s3);
}

class LayerData {
  constructor(alpha) {
    this.alpha = alpha;
    this.p = []; this.n = []; this.c = []; this.si = []; this.sw = []; this.ix = [];
    this.op = []; this.on = []; this.osi = []; this.osw = []; this.ow = []; this.oix = [];
  }
}

const _wbuf = [[0, 1], [0, 0], [0, 0], [0, 0]];

/**
 * Soft-knee on very bright paint (linear luminance above ~0.55) so white cloth and pale skin stay
 * under the bloom threshold in full sun while keeping their hue.
 */
export function compressAlbedo(c) {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  if (l > 0.6) { const k = (0.6 + (l - 0.6) * 0.55) / l; c.r *= k; c.g *= k; c.b *= k; }
  return c;
}

/**
 * Collects primitives authored in model space, attaches each to a bone (rigid) or to several
 * bones (weights callback), bakes vertex colours, and emits merged skinned geometries per layer:
 * body (toon + outline hull), glow (unlit HDR colours) and trans (vertex-alpha toon).
 */
export class Assembler {
  constructor(def) {
    this.def = def;
    this.layers = new Map();
  }
  layer(name) {
    let L = this.layers.get(name);
    if (!L) { L = new LayerData(name === 'trans'); L.compress = name !== 'glow'; this.layers.set(name, L); }
    return L;
  }
  /**
   * opts: bone, at/rot/scl or m, color (hex | Color | fn(localPos, localNormal, outColor)),
   *       layer ('body'|'glow'|'trans'), ol (outline width multiplier, 0 = none), hard (smooth outline normals),
   *       w (fn(modelPos) -> [[boneIndex, weight], ...]), alpha (number | fn(localPos)), glow (HDR multiplier), flat
   * Colour callbacks receive (localPos, modelNormal, outColor, modelPos).
   */
  add(geo, opts = {}) {
    if (opts.flat) geo = prim.flat(geo);
    const L = this.layer(opts.layer || 'body');
    const M = partMatrix(opts, new THREE.Matrix4());
    const bone = opts.bone === undefined ? 0 : this.def.idx(opts.bone);
    if (bone === undefined) throw new Error(`unknown bone ${opts.bone}`);
    this._emit(L, geo, M, opts, bone, false);
    const ol = opts.ol === undefined ? (opts.layer && opts.layer !== 'body' ? 0 : 1) : opts.ol;
    if (ol > 0) this._emit(L, opts.hard ? smoothNormalGeometry(geo) : geo, M, opts, bone, true, ol);
    return this;
  }
  _emit(L, geo, M, opts, bone, outline, olw = 1) {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const P = outline ? L.op : L.p, N = outline ? L.on : L.n, SI = outline ? L.osi : L.si, SW = outline ? L.osw : L.sw;
    const IX = outline ? L.oix : L.ix;
    const base = P.length / 3;
    _NM.getNormalMatrix(M);
    const flip = (M.determinant() < 0) !== !!opts.invert;
    const nsign = opts.invert ? -1 : 1;
    const color = opts.color === undefined ? 0xffffff : opts.color;
    const fnCol = typeof color === 'function' ? color : null;
    if (!fnCol && !outline) _col.set(color);
    const glow = opts.glow || 1;
    const fnA = typeof opts.alpha === 'function' ? opts.alpha : null;
    const alpha = opts.alpha === undefined ? 1 : opts.alpha;
    for (let i = 0; i < pos.count; i++) {
      _lv.fromBufferAttribute(pos, i);
      _ln.fromBufferAttribute(nor, i);
      _v.copy(_lv).applyMatrix4(M);
      _n.copy(_ln).applyMatrix3(_NM).normalize().multiplyScalar(nsign);
      P.push(_v.x, _v.y, _v.z);
      N.push(_n.x, _n.y, _n.z);
      if (!outline) {
        if (fnCol) fnCol(_lv, _n, _col, _v);
        if (L.compress) compressAlbedo(_col);
        L.c.push(_col.r * glow, _col.g * glow, _col.b * glow);
        if (L.alpha) L.c.push(fnA ? fnA(_lv, _v) : alpha);
      } else {
        L.ow.push(olw);
      }
      if (opts.w) {
        const ws = opts.w(_v);
        let tot = 0;
        for (let k = 0; k < 4; k++) {
          const e = ws[k];
          _wbuf[k][0] = e ? e[0] : 0; _wbuf[k][1] = e ? e[1] : 0; tot += _wbuf[k][1];
        }
        tot = tot > 0 ? 1 / tot : 0;
        for (let k = 0; k < 4; k++) { SI.push(_wbuf[k][0]); SW.push(_wbuf[k][1] * tot); }
      } else {
        SI.push(bone, 0, 0, 0); SW.push(1, 0, 0, 0);
      }
    }
    if (geo.index) {
      const ix = geo.index.array;
      for (let k = 0; k < ix.length; k += 3) {
        if (flip) IX.push(base + ix[k], base + ix[k + 2], base + ix[k + 1]);
        else IX.push(base + ix[k], base + ix[k + 1], base + ix[k + 2]);
      }
    } else {
      for (let k = 0; k < pos.count; k += 3) {
        if (flip) IX.push(base + k, base + k + 2, base + k + 1);
        else IX.push(base + k, base + k + 1, base + k + 2);
      }
    }
  }
  /** Returns { [layer]: { geometry, outline|null } } with shared, cache-friendly BufferGeometries. */
  build() {
    const out = {};
    for (const [name, L] of this.layers) {
      if (!L.p.length) continue;
      let bad = 0;
      for (const arr of [L.p, L.n, L.sw, L.op, L.on, L.osw]) {
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { bad++; arr[i] = 0; }
      }
      if (bad) console.warn(`[char] ${bad} non-finite vertex values in layer ${name}`);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(L.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(L.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(L.c, L.alpha ? 4 : 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(L.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(L.sw, 4));
      g.setIndex(L.ix);
      let o = null;
      if (L.op.length) {
        o = new THREE.BufferGeometry();
        o.setAttribute('position', new THREE.Float32BufferAttribute(L.op, 3));
        o.setAttribute('normal', new THREE.Float32BufferAttribute(L.on, 3));
        o.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(L.osi, 4));
        o.setAttribute('skinWeight', new THREE.Float32BufferAttribute(L.osw, 4));
        o.setAttribute('aOutline', new THREE.Float32BufferAttribute(L.ow, 1));
        o.setIndex(L.oix);
      }
      out[name] = { geometry: g, outline: o };
    }
    return out;
  }
}

/** Weight helper: blend linearly along a bone chain by model-space Y (top bone first). */
export function chainWeightsY(def, boneNames) {
  const ids = boneNames.map((n) => def.idx(n));
  const ys = ids.map((i) => def.pos[i].y);
  return (p) => {
    if (p.y >= ys[0]) return [[ids[0], 1]];
    for (let k = 0; k < ids.length - 1; k++) {
      if (p.y >= ys[k + 1]) {
        const t = (ys[k] - p.y) / Math.max(1e-5, ys[k] - ys[k + 1]);
        return [[ids[k], 1 - t], [ids[k + 1], t]];
      }
    }
    return [[ids[ids.length - 1], 1]];
  };
}

/** Weight helper: blend along a chain by distance from the first bone along an axis direction. */
export function chainWeightsAxis(def, boneNames, axis) {
  const ids = boneNames.map((n) => def.idx(n));
  const ax = new THREE.Vector3(...axis).normalize();
  const o = def.pos[ids[0]];
  const ds = ids.map((i) => def.pos[i].clone().sub(o).dot(ax));
  const tmp = new THREE.Vector3();
  return (p) => {
    const d = tmp.copy(p).sub(o).dot(ax);
    if (d <= ds[0]) return [[ids[0], 1]];
    for (let k = 0; k < ids.length - 1; k++) {
      if (d <= ds[k + 1]) {
        const t = (d - ds[k]) / Math.max(1e-5, ds[k + 1] - ds[k]);
        return [[ids[k], 1 - t], [ids[k + 1], t]];
      }
    }
    return [[ids[ids.length - 1], 1]];
  };
}

// ------------------------------------------------------------------ poses & clips
// A pose is a Float32Array of 6 floats per bone: Euler XYZ rotation (radians) + position offset.
/** Easing curves usable as key  values: l, io, i, o, i3, o3, ob (overshoot), h (hold). */
export const EASE = {
  l: (u) => u,
  io: (u) => u * u * (3 - 2 * u),
  i: (u) => u * u,
  o: (u) => 1 - (1 - u) * (1 - u),
  i3: (u) => u * u * u,
  o3: (u) => 1 - (1 - u) * (1 - u) * (1 - u),
  ob: (u) => { const c = 1.6; const x = u - 1; return 1 + (c + 1) * x * x * x + c * x * x; },
  h: () => 0,
};

/**
 * Compile a clip definition against a rig.
 * def: { dur, loop, keys: [{ t, e, p: { bone: [degX, degY, degZ] }, o: { bone: [x, y, z] } }], fn(P, t, ctx), ctl: [bone names] }
 * Bones named in any key (or in ctl) are "controlled"; one-shots only override controlled channels.
 */
export function compileClip(def, rig, name = '') {
  const nb = rig.count, n6 = nb * 6;
  const keys = def.keys && def.keys.length ? def.keys : [{ t: 0 }];
  const nk = keys.length;
  const vals = new Float32Array(nk * n6);
  const mask = new Uint8Array(n6);
  const times = new Float32Array(nk);
  const eases = [];
  keys.forEach((k, ki) => {
    times[ki] = k.t || 0;
    eases.push(EASE[k.e || 'io'] || EASE.io);
    if (k.p) for (const bn in k.p) {
      const bi = rig.index[bn]; if (bi === undefined) continue;
      const r = k.p[bn];
      for (let a = 0; a < 3; a++) { vals[ki * n6 + bi * 6 + a] = (r[a] || 0) * D2R; mask[bi * 6 + a] = 1; }
    }
    if (k.o) for (const bn in k.o) {
      const bi = rig.index[bn]; if (bi === undefined) continue;
      const o = k.o[bn];
      for (let a = 0; a < 3; a++) { vals[ki * n6 + bi * 6 + 3 + a] = o[a] || 0; mask[bi * 6 + 3 + a] = 1; }
    }
  });
  for (const bn of def.ctl || []) {
    const bi = rig.index[bn]; if (bi === undefined) continue;
    for (let a = 0; a < 6; a++) mask[bi * 6 + a] = 1;
  }
  if (def.loop || def.all) mask.fill(1);
  return {
    name, dur: def.dur || 1, loop: !!def.loop, impact: def.impact === undefined ? (def.dur || 1) * 0.5 : def.impact,
    nk, n6, times, eases, vals, mask, fn: def.fn || null, expr: def.expr || null, flutter: def.flutter || 0,
    blendIn: def.blendIn,
  };
}

/** Evaluate a compiled clip at time t into `out` (all channels written). */
export function evalClip(c, t, out, ctx) {
  const { nk, n6, times, vals, eases, dur } = c;
  if (c.loop) t = ((t % dur) + dur) % dur; else t = clamp(t, 0, dur);
  if (nk === 1) {
    for (let i = 0; i < n6; i++) out[i] = vals[i];
  } else {
    let k1 = 0;
    while (k1 < nk && times[k1] <= t) k1++;
    let ka, kb, u, ease;
    if (k1 === 0 || k1 === nk) {
      if (!c.loop) {
        const k = k1 === 0 ? 0 : nk - 1;
        const o = k * n6;
        for (let i = 0; i < n6; i++) out[i] = vals[o + i];
        if (c.fn) c.fn(out, t, ctx);
        return out;
      }
      ka = nk - 1; kb = 0;
      const span = dur - times[ka] + times[0];
      const into = k1 === 0 ? t + dur - times[ka] : t - times[ka];
      u = span > 0 ? into / span : 0;
      ease = eases[0];
    } else {
      ka = k1 - 1; kb = k1;
      u = (t - times[ka]) / Math.max(1e-6, times[kb] - times[ka]);
      ease = eases[kb];
    }
    const w = ease(clamp(u, 0, 1));
    const oa = ka * n6, ob = kb * n6;
    for (let i = 0; i < n6; i++) out[i] = vals[oa + i] + (vals[ob + i] - vals[oa + i]) * w;
  }
  if (c.fn) c.fn(out, t, ctx);
  return out;
}

/** out = a + (b - a) * w on masked channels (mask null = all); unmasked channels copy a. */
export function mixPose(out, a, b, w, mask = null) {
  const n = out.length;
  if (mask) { for (let i = 0; i < n; i++) out[i] = mask[i] ? a[i] + (b[i] - a[i]) * w : a[i]; }
  else { for (let i = 0; i < n; i++) out[i] = a[i] + (b[i] - a[i]) * w; }
  return out;
}

/** Write a pose into bones (rest positions + offsets, absolute Euler rotations). */
export function applyPose(bones, restPos, P) {
  for (let i = 0, o = 0; i < bones.length; i++, o += 6) {
    const b = bones[i], r = restPos[i];
    b.rotation.set(P[o], P[o + 1], P[o + 2]);
    b.position.set(r.x + P[o + 3], r.y + P[o + 4], r.z + P[o + 5]);
  }
}

/** Add degrees to a bone's rotation channels inside a pose (handy inside clip fn callbacks). */
export function addRot(P, bi, dx, dy, dz) {
  if (bi === undefined || bi < 0) return;
  const o = bi * 6;
  P[o] += dx * D2R; P[o + 1] += dy * D2R; P[o + 2] += dz * D2R;
}
/** Add a position offset to a bone inside a pose. */
export function addPos(P, bi, x, y, z) {
  if (bi === undefined || bi < 0) return;
  const o = bi * 6 + 3;
  P[o] += x; P[o + 1] += y; P[o + 2] += z;
}

/**
 * Planar two-bone solve for a limb hanging along -Y: reach a target offset (dy, dz) from the root
 * joint (dz forward). Writes [rootRotX, midRotX] (radians) into out; the mid joint bends backward
 * (knees) unless `bendForward` (elbows).
 */
export function ik2(dy, dz, a, b, out, bendForward = false) {
  const d = clamp(Math.hypot(dy, dz), 1e-4, a + b - 1e-4);
  const phi = Math.atan2(dz, -dy);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const cosK = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  const alpha = Math.acos(cosA);
  const bend = Math.PI - Math.acos(cosK);
  if (!bendForward) { out[0] = -(phi + alpha); out[1] = bend; }
  else { out[0] = -(phi - alpha); out[1] = -bend; }
  return out;
}

// ------------------------------------------------------------------ spring chains
/**
 * Damped angular springs for a bone chain (rotation X = swing back, Z = swing sideways).
 * Each link chases a target angle; results are added onto the pose before it is applied.
 */
export class SpringChain {
  constructor(boneIds, { k = 70, d = 10, gain = 1 } = {}) {
    this.ids = boneIds;
    const n = boneIds.length;
    this.x = new Float32Array(n); this.vx = new Float32Array(n);
    this.z = new Float32Array(n); this.vz = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.k = k; this.d = d; this.gain = gain;
  }
  reset() { this.x.fill(0); this.vx.fill(0); this.z.fill(0); this.vz.fill(0); }
  step(dt) {
    const { k, d } = this;
    const steps = dt > 1 / 50 ? Math.ceil(dt * 60) : 1;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.ids.length; i++) {
        this.vx[i] += (k * (this.tx[i] - this.x[i]) - d * this.vx[i]) * h;
        this.vz[i] += (k * (this.tz[i] - this.z[i]) - d * this.vz[i]) * h;
        this.x[i] += this.vx[i] * h;
        this.z[i] += this.vz[i] * h;
      }
    }
  }
  /** Add the chain's angles onto pose P. */
  write(P) {
    for (let i = 0; i < this.ids.length; i++) {
      const o = this.ids[i] * 6;
      P[o] += this.x[i] * this.gain;
      P[o + 2] += this.z[i] * this.gain;
    }
  }
}
