// Battle-cutscene stages for FD2-style side-view fights. Self-contained (does not use the map World builder):
// each terrain theme is a hand-shaped diorama — continuous ground strip, framing props, parallax mid/back
// layers and its own Environment sky — built from a few merged, vertex-coloured toon batches so a whole stage
// stays around 15 draw calls. Built stages are cached per theme + variant + preset + palette.
//
// Camera contract: perspective FOV 30-40 on the +Z side looking toward -Z at the combatants (distance 4-9,
// small arcs). leftSpot / rightSpot sit at x = -/+1.7, z = 0 on flat ground (y = 0).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial, addOutline, canvasTexture } from './toon.js';
import { Environment, cloudShadow } from './environment.js';

const OUTLINE = 0x1f1724;
const STAGE_BOUNDS = new THREE.Box3(new THREE.Vector3(-10, -0.6, -5.5), new THREE.Vector3(10, 4.5, 4.5));
const CACHE_LIMIT = 6;

const THEME_OF = {
  '.': 'field', '"': 'field', ',': 'field', B: 'field', Y: 'field', W: 'field', V: 'field', h: 'field',
  F: 'forest', P: 'forest', H: 'rocky', M: 'rocky', K: 'rocky',
  C: 'castle', c: 'castle', T: 'castle', G: 'castle', O: 'castle', '#': 'castle',
  S: 'desert', D: 'desert', R: 'desert', '=': 'bridge', '~': 'bridge',
  g: 'temple', A: 'temple', L: 'volcano', X: 'volcano',
};
const VARIANT_OF = {
  '"': 'meadow', ',': 'road', B: 'paved', Y: 'thicket', W: 'fort', V: 'village', h: 'village',
  P: 'pines', M: 'peaks', K: 'peaks', c: 'carpet', T: 'throne', G: 'gate',
  D: 'dunes', R: 'ruins', '~': 'water', A: 'altar', X: 'chasm',
};
const THEME_PALETTE = { desert: 'desert', temple: 'golden', volcano: 'golden' };

// Sky tweaks per theme (Environment overrides): silhouettes that suit the backdrop.
const SKY_OVERRIDES = {
  field: { ridgeHeight: 0.028, ridgeHeight2: 0.018, ridgeSharp: 0.15 },
  forest: { ridgeHeight: 0.035, ridgeSharp: 0.3 },
  rocky: { ridgeHeight: 0.075, ridgeHeight2: 0.035, ridgeSharp: 0.9, snow: 1, ridgeHaze: 0.45 },
  castle: { fogScale: 0.6 },
  desert: { ridgeHeight: 0.03, ridgeHeight2: 0.02, ridgeSharp: 0.05 },
  bridge: { ridgeHeight: 0.045, ridgeSharp: 0.45 },
  temple: { fogScale: 0.8 },
  volcano: { ridgeSharp: 0.9 },
};

const PALETTES = {
  temperate: {
    grass: [0x4f8f3c, 0x67a845, 0x86c052], dirt: [0x8a6040, 0xa47a52], rock: [0x85817b, 0x9a958d, 0xb3ada2],
    leaves: [0x3f8f3a, 0x55a43f, 0x6db84a, 0x4c9a45], pine: [0x2e6b48, 0x3a7d52, 0x2a5f40], trunk: 0x6b4a2f,
    bush: [0x4a9440, 0x5aa547, 0x3f8a3c], tuft: [0x5d9f3e, 0x77b84b, 0x8cc456],
    flowers: [0xf47fae, 0xf8d64a, 0xf6f3ea, 0x9cb8ff, 0xe8503a], hill: [0x5f9e48, 0x78b257], farHill: 0x86b874,
    sand: [0xdcc48c, 0xc9ab72], stone: [0xa29d92, 0x8a857b, 0xb8b2a6], wood: 0x8a5e3a,
    roofs: [0xc0553a, 0x4f6d9a, 0xc9a25a, 0x8a4a6a], plaster: [0xece2ca, 0xe2d2ae, 0xefeae0],
  },
  autumn: {
    grass: [0x8a8a3a, 0x9c9842, 0xbdb456], leaves: [0xd9772a, 0xe8a23a, 0xc4462b, 0xb5a23c], bush: [0xb5672b, 0x9a8a3a, 0xc98a34],
    tuft: [0xa9a046, 0xc2b25a, 0x8f8a3a], hill: [0xa49a4a, 0xbcae5a], farHill: 0xb8aa72,
  },
  ashen: {
    grass: [0x55503f, 0x67604b, 0x7a725a], dirt: [0x4a3a30, 0x5a463a], rock: [0x5a524e, 0x6a605a, 0x7a706a],
    leaves: [0x6a6a3a, 0x5a5a32, 0x76704a], pine: [0x2e3a30, 0x3a4436, 0x34402f], trunk: 0x4a3a2e, bush: [0x5a5a38, 0x4a4a30],
    tuft: [0x6a6350, 0x7a725a, 0x5a5444], flowers: [0x9a8a7a, 0xb06a4a, 0x8a7a6a], hill: [0x5f5a48, 0x6e6852], farHill: 0x6a6658,
    stone: [0x7a716a, 0x625a54, 0x8a8078],
  },
  desert: {
    grass: [0xa8a058, 0xb8aa62, 0xc6b872], dirt: [0xb08458, 0xc29468], rock: [0xa8845e, 0xb8946a, 0xcca97e],
    leaves: [0x5f9a3e, 0x7cae48, 0x4f8a38], bush: [0x8a8a42, 0x9a9a4e], tuft: [0xaa9c54, 0xbcaa62, 0x958f48],
    sand: [0xe4c98e, 0xd2b077], hill: [0xd8b880, 0xe4c690], farHill: 0xe2c89a, stone: [0xd2b68a, 0xbfa076, 0xe0c69c],
  },
  golden: {
    grass: [0x7a9a40, 0x8cac4a, 0xa6bc5a], rock: [0x4a3c3a, 0x5a4a44, 0x6a5650], stone: [0xd8cdb4, 0xc4b79a, 0xe6dcc6],
    gold: [0xc9962e, 0xe8bf52, 0xa87420], sand: [0xd8b97e, 0xc4a066], hill: [0x8a6a50, 0x9a7a5a], farHill: 0x8a6a5a,
  },
};
function paletteFor(name, theme) {
  const key = PALETTES[name] ? name : THEME_PALETTE[theme] || 'temperate';
  return { name: key, ...PALETTES.temperate, ...PALETTES[key] };
}

// ----------------------------------------------------------------------------------------- helpers
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += a; f *= 2.03; a *= 0.5; }
  return s / n;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _pv = new THREE.Vector3();
const _sv = new THREE.Vector3();
/** Matrix from position, scale and Euler rotation. */
function M(x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(_pv.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _sv.set(sx, sy, sz));
}

const _c = new THREE.Color();
const _c2 = new THREE.Color();
/** Collects transformed, vertex-coloured geometry and merges it into one mesh. */
class Batch {
  constructor() { this.geos = []; }
  /** color: hex | THREE.Color | (x, y, z, outColor) => void evaluated per vertex in stage space. */
  add(geo, matrix, color, flat = false, keepUv = false) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUv && k === 'uv')) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    if (flat || !g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const ca = new Float32Array(p.count * 3);
    if (typeof color === 'function') {
      for (let i = 0; i < p.count; i++) { color(p.getX(i), p.getY(i), p.getZ(i), _c); ca[i * 3] = _c.r; ca[i * 3 + 1] = _c.g; ca[i * 3 + 2] = _c.b; }
    } else {
      _c.set(color);
      for (let i = 0; i < p.count; i++) { ca[i * 3] = _c.r; ca[i * 3 + 1] = _c.g; ca[i * 3 + 2] = _c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    this.geos.push(g);
    return this;
  }
  get empty() { return this.geos.length === 0; }
  build(material, name) {
    const geo = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    return mesh;
  }
}

/** Vertical colour ramp helper: darker at the base, lighter at the top. */
function ramp(hexA, hexB, y0, y1) {
  const a = new THREE.Color(hexA), b = new THREE.Color(hexB);
  return (x, y, z, out) => out.copy(a).lerp(b, smooth(y0, y1, y));
}

// ------------------------------------------------------------------------------------ geometry kits
const G = {
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  ico2: new THREE.IcosahedronGeometry(1, 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  trunk: new THREE.CylinderGeometry(0.7, 1, 1, 7),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone7: new THREE.ConeGeometry(1, 1, 7),
  cone9: new THREE.ConeGeometry(1, 1, 9, 3),
  dome: new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  sphere: new THREE.SphereGeometry(1, 18, 12),
  roof: (() => {
    const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
  })(),
};

/** Lumpy low-poly rock (deterministic per seed); flat-shaded when added with flat = true. */
function rockGeo(seed, detail = 0, squash = 0.75) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.72 + 0.56 * hash2(Math.round(x * 97) + seed * 31, Math.round(y * 89) * 7 + Math.round(z * 83) * 13);
    p.setXYZ(i, x * k, Math.max(y * k * squash, -0.35), z * k);
  }
  return g;
}
const ROCKS = [0, 1, 2, 3, 4, 5].map((s) => rockGeo(s + 1));
const ROCKS_FINE = [0, 1, 2].map((s) => rockGeo(s + 11, 1, 0.85));

function broadTree(b, x, z, s, pal, r, y = 0) {
  const th = 1.25 * s;
  b.add(G.trunk, M(x, y + th / 2, z, 0.17 * s, th, 0.17 * s, 0, r() * 6, (r() - 0.5) * 0.12), pal.trunk, true);
  const n = 5 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = i === 0 ? 0 : (0.42 + r() * 0.3) * s;
    const bs = (i === 0 ? 0.88 : 0.5 + r() * 0.24) * s;
    const by = y + th + (i === 0 ? 0.5 : 0.15 + r() * 0.55) * s;
    b.add(G.ico2, M(x + Math.cos(a) * rr, by, z + Math.sin(a) * rr * 0.85, bs, bs * 0.86, bs), pick(pal.leaves, r));
  }
}

function pineTree(b, x, z, s, pal, r, y = 0) {
  b.add(G.trunk, M(x, y + 0.35 * s, z, 0.13 * s, 0.7 * s, 0.13 * s), pal.trunk, true);
  const c = pick(pal.pine, r);
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    const rad = (0.95 - t * 0.5) * s, h = (1.15 - t * 0.25) * s;
    b.add(G.cone7, M(x, y + (0.55 + i * 0.62) * s + h / 2, z, rad, h, rad, 0, r() * 6, 0), _c2.set(c).multiplyScalar(0.92 + t * 0.16).getHex(), true);
  }
}

function bush(b, x, z, s, pal, r, y = 0) {
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, rr = i === 0 ? 0 : 0.35 * s;
    const bs = (i === 0 ? 0.5 : 0.32 + r() * 0.12) * s;
    b.add(G.ico1, M(x + Math.cos(a) * rr, y + bs * 0.55, z + Math.sin(a) * rr, bs, bs * 0.8, bs), pick(pal.bush, r));
  }
}

function rock(b, x, z, s, color, r, y = 0, fine = false) {
  const g = fine ? pick(ROCKS_FINE, r) : pick(ROCKS, r);
  b.add(g, M(x, y + s * 0.3, z, s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5), (r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3), color, true);
}

/** Snow-capped (optional) jagged peak. */
function peak(b, x, z, w, h, rockHex, snowHex, r, y = 0) {
  const g = new THREE.ConeGeometry(1, 1, 9, 4);
  const p = g.attributes.position;
  const seed = Math.floor(r() * 1000);
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    if (py > 0.49) continue;
    const k = 0.8 + 0.4 * hash2(Math.round(px * 50) + seed, Math.round(py * 50) + Math.round(pz * 50) * 3);
    p.setXYZ(i, px * k, py + (k - 1) * 0.15, pz * k);
  }
  const rk = new THREE.Color(rockHex), sn = snowHex == null ? null : new THREE.Color(snowHex);
  const top = y + h, line = y + h * (0.62 + r() * 0.1);
  b.add(g, M(x, y + h / 2, z, w, h, w * (0.7 + r() * 0.4), 0, r() * 6, 0), (vx, vy, vz, out) => {
    out.copy(rk).multiplyScalar(0.85 + 0.25 * (vy - y) / h);
    if (sn && vy > line + (hash2(Math.round(vx * 3), Math.round(vz * 3)) - 0.5) * h * 0.08) out.copy(sn);
    return out;
  }, true);
  return top;
}

function cottage(b, glow, x, z, ry, s, pal, r, night) {
  const base = M(x, 0, z, s, s, s, 0, ry, 0);
  const add = (batch, geo, lm, color, flat = true) => batch.add(geo, base.clone().multiply(lm), color, flat);
  const wallC = pick(pal.plaster, r), roofC = pick(pal.roofs, r), beam = 0x5e3f28;
  add(b, G.box, M(0, 0.62, 0, 1.7, 1.24, 1.25), wallC);
  add(b, G.roof, M(0, 1.22, 0, 1.95, 0.8, 1.55), roofC);
  add(b, G.box, M(0.5, 1.65, -0.28, 0.24, 0.7, 0.24), 0x8c7c6c);
  add(b, G.box, M(-0.38, 0.45, 0.635, 0.34, 0.9, 0.04), 0x5a3a24);
  for (const [bx, by, bw, bh] of [[0, 1.2, 1.74, 0.08], [-0.84, 0.62, 0.08, 1.24], [0.84, 0.62, 0.08, 1.24], [0, 0.04, 1.74, 0.08]]) add(b, G.box, M(bx, by, 0.64, bw, bh, 0.05), beam);
  const win = night ? 0xffb04a : 0x34466a;
  add(night ? glow : b, G.box, M(0.38, 0.74, 0.635, 0.36, 0.3, 0.04), win);
  add(night ? glow : b, G.box, M(0.86, 0.72, 0.1, 0.04, 0.28, 0.32), win);
}

function fence(b, x0, x1, z, color, r, y = 0) {
  const n = Math.max(2, Math.round((x1 - x0) / 1.1));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    b.add(G.box, M(x, y + 0.36, z, 0.1, 0.72, 0.1, 0, 0, (r() - 0.5) * 0.1), color, true);
  }
  for (const h of [0.3, 0.58]) b.add(G.box, M((x0 + x1) / 2, y + h, z, x1 - x0, 0.06, 0.05), color, true);
}

function pillar(b, x, z, h, rad, color, trim, y = 0) {
  b.add(G.cyl16, M(x, y + h / 2, z, rad, h, rad), color);
  b.add(G.box, M(x, y + 0.14, z, rad * 2.5, 0.28, rad * 2.5), trim, true);
  b.add(G.box, M(x, y + h - 0.14, z, rad * 2.5, 0.28, rad * 2.5), trim, true);
  b.add(G.cyl16, M(x, y + h - 0.36, z, rad * 1.12, 0.12, rad * 1.12), trim);
}

function palm(b, x, z, s, pal, r) {
  let px = x, py = 0;
  const lean = (r() - 0.5) * 0.5;
  for (let i = 0; i < 6; i++) {
    const h = 0.42 * s;
    b.add(G.trunk, M(px, py + h / 2, z, 0.11 * s * (1 - i * 0.06), h, 0.11 * s * (1 - i * 0.06), 0, 0, -lean * 0.4), i % 2 ? 0x8a6a44 : 0x7a5a38, true);
    px += lean * h * 0.4; py += h * 0.97;
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.4;
    b.add(G.sphere, M(px + Math.cos(a) * 0.55 * s, py - 0.1 * s, z + Math.sin(a) * 0.55 * s, 0.62 * s, 0.07 * s, 0.2 * s, 0, -a, -0.35), pick(pal.leaves, r));
  }
}
// ----------------------------------------------------------------------------------------- textures
const TEX = {};
const texOnce = (name, fn) => TEX[name] || (TEX[name] = fn());
function wrapDraw(g, w, h, fn) { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } }

function grassTex() {
  return texOnce('grass', () => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    const r = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 40, v = r() < 0.5 ? 222 : 255;
      wrapDraw(g, w, h, () => {
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${v},${v},${v},0.45)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 700; i++) {
      const x = r() * w, y = r() * h, l = 4 + r() * 8, a = -Math.PI / 2 + (r() - 0.5) * 0.8, v = 200 + Math.floor(r() * 55);
      g.strokeStyle = `rgba(${v},${v},${v},0.7)`; g.lineWidth = 1 + r() * 1.4;
      wrapDraw(g, w, h, () => { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); });
    }
  }, { repeat: true }));
}

function sandTex() {
  return texOnce('sand', () => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
    const r = mulberry32(9);
    for (let i = 0; i < 18; i++) {
      const y0 = (i / 18) * h + r() * 6;
      for (const [off, v, a] of [[0, 255, 0.9], [3, 214, 0.55]]) {
        g.strokeStyle = `rgba(${v},${v},${v},${a})`; g.lineWidth = 2;
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + off + Math.sin((x / w) * Math.PI * 4 + i) * 4);
        g.stroke();
      }
    }
    for (let i = 0; i < 500; i++) { const v = 205 + Math.floor(r() * 50); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  }, { repeat: true }));
}

function tileTex(kind) {
  return texOnce('tile-' + kind, () => canvasTexture(512, 512, (g, w, h) => {
    const gold = kind === 'gold';
    const r = mulberry32(gold ? 21 : 13);
    g.fillStyle = gold ? '#6c5530' : '#8c8c8c'; g.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = gold ? 0 : 214 + Math.floor(r() * 40);
      g.fillStyle = gold ? ((x + y) % 2 ? '#ffe6a6' : '#f4f0e6') : `rgb(${v},${v},${v})`;
      g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      if (gold) {
        g.strokeStyle = '#d9a640'; g.lineWidth = 5; g.strokeRect(x * s + 14, y * s + 14, s - 28, s - 28);
        g.fillStyle = '#4a7ad0'; g.beginPath(); g.arc(x * s + s / 2, y * s + s / 2, 9, 0, Math.PI * 2); g.fill();
      } else {
        for (let k = 0; k < 6; k++) {
          const v2 = 190 + Math.floor(r() * 40);
          g.strokeStyle = `rgba(${v2},${v2},${v2},0.6)`; g.lineWidth = 1;
          g.beginPath(); g.moveTo(x * s + r() * s, y * s + r() * s); g.lineTo(x * s + r() * s, y * s + r() * s); g.stroke();
        }
      }
    }
  }, { repeat: true }));
}

function crestTex() {
  return texOnce('crest', () => canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8bf52';
    g.fillRect(0, 0, w, 10); g.fillRect(0, h - 40, w, 6);
    g.save(); g.translate(w / 2, h * 0.42);
    g.beginPath();
    for (const sx of [-1, 1]) {
      g.moveTo(0, -6);
      g.bezierCurveTo(sx * 18, -40, sx * 52, -46, sx * 58, -10);
      g.bezierCurveTo(sx * 40, -18, sx * 30, -8, sx * 22, 6);
      g.bezierCurveTo(sx * 34, 2, sx * 44, 10, sx * 46, 22);
      g.bezierCurveTo(sx * 28, 14, sx * 16, 18, 0, 30);
    }
    g.fill();
    g.beginPath(); g.moveTo(0, -38); g.bezierCurveTo(14, -18, 12, 4, 0, 14); g.bezierCurveTo(-12, 4, -14, -18, 0, -38); g.fill();
    g.restore();
    g.beginPath(); g.moveTo(0, h - 30); g.lineTo(w / 2, h - 2); g.lineTo(w, h - 30); g.lineTo(w, h); g.lineTo(0, h); g.closePath();
    g.globalCompositeOperation = 'destination-out'; g.fill();
  }));
}

// ----------------------------------------------------------------------------------------- materials
const NOISE_GLSL = /* glsl */ `
float ahash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float anoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ahash(i), ahash(i + vec2(1.0, 0.0)), u.x), mix(ahash(i + vec2(0.0, 1.0)), ahash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
const WORLD_VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWP;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OUT_FRAG = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
`;

function fogShader(uniforms, fragmentShader, extra = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
    vertexShader: WORLD_VERT, fragmentShader, fog: true, ...extra,
  });
  return mat;
}

function waterMaterial(time, o) {
  return fogShader({
    uTime: time, uDeep: { value: new THREE.Color(o.deep) }, uShallow: { value: new THREE.Color(o.shallow) },
    uFoam: { value: new THREE.Color(o.foam) }, uSky: { value: new THREE.Color(o.sky) }, uBank: { value: o.bank }, uGlint: { value: o.glint },
  }, /* glsl */ `
uniform float uTime, uBank, uGlint;
uniform vec3 uDeep, uShallow, uFoam, uSky;
varying vec3 vWP;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  vec2 p = vWP.xz;
  float n = anoise(p * vec2(0.8, 0.32) + vec2(0.0, -uTime * 0.35)) * 0.6 + anoise(p * vec2(1.9, 0.7) + vec2(3.7, -uTime * 0.6)) * 0.4;
  float bank = smoothstep(uBank - 5.0, uBank, abs(p.x));
  vec3 col = mix(uDeep, uShallow, clamp(bank * 0.75 + (n - 0.5) * 0.5 + 0.15, 0.0, 1.0));
  float band = smoothstep(0.6, 0.62, n) * (1.0 - smoothstep(0.67, 0.69, n));
  col = mix(col, uFoam, band * 0.5);
  vec3 V = normalize(cameraPosition - vWP);
  col = mix(col, uSky, pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0) * 0.6);
  float g = anoise(p * vec2(5.0, 2.4) + vec2(0.0, -uTime * 0.9));
  col += vec3(1.0, 0.97, 0.9) * smoothstep(0.83, 0.88, g) * uGlint * 1.8 * (0.5 + 0.5 * sin(uTime * 3.0 + p.x * 4.0));
  float foam = smoothstep(uBank - 0.9, uBank - 0.15, abs(p.x) + (n - 0.5) * 0.7);
  col = mix(col, uFoam, foam * 0.9);
  gl_FragColor = vec4(col, 1.0);
${OUT_FRAG}
}`);
}

function lavaMaterial(time, o = {}) {
  return fogShader({
    uTime: time, uHot: { value: new THREE.Color(o.hot || 0xffa030) }, uCrust: { value: new THREE.Color(o.crust || 0x2a0c08) },
    uWarm: { value: new THREE.Color(o.warm || 0xb02a0a) }, uScale: { value: o.scale || 0.45 },
  }, /* glsl */ `
uniform float uTime, uScale;
uniform vec3 uHot, uCrust, uWarm;
varying vec3 vWP;
#include <fog_pars_fragment>
${NOISE_GLSL}
vec2 h22(vec2 p) { return vec2(ahash(p), ahash(p + 19.19)); }
float cellEdge(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = 0.5 + 0.38 * sin(uTime * 0.35 + 6.2831 * h22(i + g));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
void main() {
  vec2 p = vWP.xz * uScale + vec2(uTime * 0.025, uTime * 0.018);
  float n = anoise(vWP.xz * 0.6 + uTime * 0.08);
  float e = cellEdge(p);
  float crack = 1.0 - smoothstep(0.03, 0.12 + n * 0.14, e);
  float pulse = 0.8 + 0.2 * sin(uTime * 1.7 + vWP.x * 0.6 + vWP.z * 0.4);
  vec3 col = mix(uCrust + uWarm * n * 0.35, uHot * (2.2 + n) * pulse, crack);
  gl_FragColor = vec4(col, 1.0);
${OUT_FRAG}
}`);
}

function flameMaterial(time) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
uniform float uTime;
varying float vH;
void main() {
  vec3 p = position;
  vH = clamp(p.y + 0.5, 0.0, 1.0);
  vec4 base = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float ph = base.x * 3.1 + base.z * 1.7 + color.r * 6.2831;
  p.x += sin(uTime * 9.0 + ph) * 0.12 * vH;
  p.z += cos(uTime * 7.0 + ph * 1.3) * 0.08 * vH;
  p *= 1.0 + 0.12 * sin(uTime * 13.0 + ph);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying float vH;
void main() {
  vec3 c = mix(vec3(4.0, 2.6, 1.2), vec3(2.2, 0.55, 0.12), smoothstep(0.1, 0.9, vH));
  gl_FragColor = vec4(c * (1.0 - smoothstep(0.55, 1.0, vH) * 0.7), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return mat;
}

function shaftMaterial(time, color, intensity) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
varying float vSeed;
void main() { vUv = uv; vSeed = position.x * 0.37 + position.z * 0.21; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uTime, uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying float vSeed;
${NOISE_GLSL}
void main() {
  float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
  float fall = smoothstep(0.0, 0.85, vUv.y);
  float streak = 0.6 + 0.4 * anoise(vec2(vUv.x * 7.0 + vSeed, uTime * 0.15 + vSeed));
  float a = edge * fall * streak * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function glowMaterial(boost = 2.2) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight *= ${boost.toFixed(2)};\n#include <opaque_fragment>`); };
  m.customProgramCacheKey = () => 'ewk-arena-glow' + boost;
  return m;
}

/** Chain a vertex sway (wind) onto a toon material; amount scales with local height (or 1 - uv.y for cloth). */
function addSway(mat, time, amp, cloth = false) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.uniforms.uSwayTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ewkIp = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#ifdef USE_INSTANCING
  ewkIp += instanceMatrix[3].xyz;
#endif
  ${cloth ? 'float ewkK = (1.0 - uv.y); ewkIp.x += position.x * 0.8;' : 'float ewkK = max(position.y, 0.0);'}
  transformed.x += sin(uSwayTime * 1.7 + ewkIp.x * 0.7 + ewkIp.z * 0.5) * ${amp.toFixed(3)} * ewkK;
  transformed.z += cos(uSwayTime * 1.3 + ewkIp.x * 0.4 + ewkIp.z * 0.9) * ${(amp * 0.6).toFixed(3)} * ewkK;
}`);
  };
  mat.customProgramCacheKey = () => `${prevKey}|sway${amp}${cloth ? 'c' : ''}`;
  return mat;
}

// ------------------------------------------------------------------------------------------ ground
function axisCoords(min, max, lo, hi, step) {
  const out = [];
  for (let v = lo; v <= hi + 1e-6; v += step) out.push(+v.toFixed(4));
  for (let s = step, v = hi; v < max;) { s *= 1.24; v = Math.min(max, v + s); out.push(v); }
  for (let s = step, v = lo; v > min;) { s *= 1.24; v = Math.max(min, v - s); out.unshift(v); }
  return out;
}

/** Big continuous ground (dense near the fighters, coarse toward the horizon) with height + colour fields. */
function groundMesh(heightFn, colorFn, mat, { xr = 230, zMin = -230, zMax = 60, repeat = 3 } = {}) {
  const xs = axisCoords(-xr, xr, -16, 16, 0.5);
  const zs = axisCoords(zMin, zMax, -12, 9, 0.5);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], y = heightFn(x, z), k = j * nx + i;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      colorFn(x, z, y, _c);
      col[k * 3] = _c.r; col[k * 3 + 1] = _c.g; col[k * 3 + 2] = _c.b;
      uv[k * 2] = x / repeat; uv[k * 2 + 1] = -z / repeat;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ArenaGround';
  mesh.receiveShadow = true;
  return mesh;
}

/** Colour field helper: blends palette shades with layered noise (painterly patches). */
function patchColor(hexes, scale = 0.18, seed = 0) {
  const cs = hexes.map((h) => new THREE.Color(h));
  return (x, z, out) => {
    const n = fbm(x * scale + seed, z * scale - seed, 3);
    const t = Math.min(0.999, Math.max(0, (n - 0.25) * 2)) * (cs.length - 1);
    const i = Math.floor(t);
    return out.copy(cs[i]).lerp(cs[Math.min(i + 1, cs.length - 1)], t - i);
  };
}

/** Keep-out test for the combatants' footprint and the camera foreground. */
const clearZone = (x, z, pad = 0) => Math.abs(x) < 3.4 + pad && z > -1.3 - pad && z < 1.3 + pad;

// ------------------------------------------------------------------------------- instanced scatter
function tuftGeometry() {
  const blades = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + i;
    const g = new THREE.PlaneGeometry(0.07, 0.34, 1, 2).translate(0, 0.17, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setX(k, p.getX(k) * (1 - y / 0.4)); p.setZ(k, y * y * 0.9); }
    g.rotateY(a).translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    blades.push(g);
  }
  const geo = mergeGeometries(blades.map((g) => g.toNonIndexed()));
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) { const t = 0.55 + 0.45 * Math.min(1, p.getY(k) / 0.34); col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = t; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let k = 0; k < n.count; k++) n.setXYZ(k, n.getX(k) * 0.3, 1, n.getZ(k) * 0.3);
  geo.attributes.normal.needsUpdate = true;
  return geo;
}
function flowerGeometry() {
  const parts = [new THREE.CylinderGeometry(0.012, 0.012, 0.22, 3).translate(0, 0.11, 0).toNonIndexed()];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(new THREE.CircleGeometry(0.05, 5).rotateX(-Math.PI / 2 + 0.25).translate(Math.cos(a) * 0.05, 0.23, Math.sin(a) * 0.05).toNonIndexed());
  }
  parts.push(new THREE.CircleGeometry(0.03, 6).rotateX(-Math.PI / 2).translate(0, 0.235, 0).toNonIndexed());
  const geo = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }));
  const col = new Float32Array(geo.attributes.position.count * 3);
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const stem = p.getY(k) < 0.215, centre = Math.hypot(p.getX(k), p.getZ(k)) < 0.03 && p.getY(k) > 0.23;
    const v = stem ? [0.22, 0.45, 0.15] : centre ? [1.0, 0.85, 0.3] : [1, 1, 1];
    col.set(v, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
const SCATTER_GEO = {};
const scatterGeo = (k) => SCATTER_GEO[k] || (SCATTER_GEO[k] = k === 'tuft' ? tuftGeometry() : flowerGeometry());

/**
 * Instanced vegetation. place(r) -> [x, z, scale] | null; heightFn gives the ground height.
 * Colours per instance from `colors`, wind sway shared via `time`.
 */
function scatter(kind, count, place, heightFn, colors, time, r, sway = 0.12) {
  const mat = addSway(toonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, gradient: 'anime2', rim: 0.4 }), time, sway);
  const mesh = new THREE.InstancedMesh(scatterGeo(kind), mat, count);
  const cs = colors.map((h) => new THREE.Color(h));
  let n = 0;
  for (let tries = 0; tries < count * 6 && n < count; tries++) {
    const pl = place(r);
    if (!pl) continue;
    const [x, z, s] = pl;
    mesh.setMatrixAt(n, M(x, heightFn(x, z) - 0.02, z, s, s * (0.8 + r() * 0.5), s, (r() - 0.5) * 0.2, r() * 6.28, (r() - 0.5) * 0.2));
    mesh.setColorAt(n, _c.copy(pick(cs, r)).multiplyScalar(0.9 + r() * 0.2));
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  mesh.name = 'Arena' + kind;
  return mesh;
}
// @@PART3@@
