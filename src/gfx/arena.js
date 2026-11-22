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
  field: { ridgeHeight: 0.028, ridgeHeight2: 0.018, ridgeSharp: 0.15, fogScale: 0.5 },
  forest: { ridgeHeight: 0.035, ridgeSharp: 0.3, fogScale: 0.6 },
  rocky: { ridgeHeight: 0.075, ridgeHeight2: 0.035, ridgeSharp: 0.9, snow: 1, ridgeHaze: 0.45, fogScale: 0.3 },
  castle: { fogScale: 0.4 },
  desert: { ridgeHeight: 0.03, ridgeHeight2: 0.02, ridgeSharp: 0.05, fogScale: 0.5 },
  bridge: { ridgeHeight: 0.045, ridgeSharp: 0.45, fogScale: 0.5 },
  temple: { fogScale: 0.6 },
  volcano: { ridgeSharp: 0.9, fogScale: 0.6 },
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
    sand: [0xeac488, 0xd8a866], hill: [0xd8b880, 0xe4c690], farHill: 0xe2c89a, stone: [0xd2b68a, 0xbfa076, 0xe0c69c],
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

function broadTree(b, x, z, s, pal, r, y = 0, fine = true) {
  const th = 1.25 * s;
  b.add(G.trunk, M(x, y + th / 2, z, 0.17 * s, th, 0.17 * s, 0, r() * 6, (r() - 0.5) * 0.12), pal.trunk, true);
  const n = 5 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const rr = i === 0 ? 0 : (0.42 + r() * 0.3) * s;
    const bs = (i === 0 ? 0.88 : 0.5 + r() * 0.24) * s;
    const by = y + th + (i === 0 ? 0.5 : 0.15 + r() * 0.55) * s;
    b.add(fine ? G.ico2 : G.ico1, M(x + Math.cos(a) * rr, by, z + Math.sin(a) * rr * 0.85, bs, bs * 0.86, bs), pick(pal.leaves, r));
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
    g.fillStyle = gold ? '#c9a45a' : '#a39e96'; g.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let y = 0; y < n; y++) {
      const shift = !gold && y % 2 ? s / 2 : 0;
      for (let x = -1; x < n; x++) {
        const x0 = x * s + shift, y0 = y * s;
        const v = 226 + Math.floor(r() * 29);
        g.fillStyle = gold ? ((x + y) % 2 ? '#fff1cf' : '#fbf7ee') : `rgb(${v},${v - 2},${v - 6})`;
        g.fillRect(x0 + 2, y0 + 2, s - 4, s - 4);
        if (gold) {
          g.strokeStyle = '#e0b552'; g.lineWidth = 3; g.strokeRect(x0 + 12, y0 + 12, s - 24, s - 24);
          g.fillStyle = '#e8bf52';
          g.beginPath(); g.moveTo(x0 + s / 2, y0 + s / 2 - 11); g.lineTo(x0 + s / 2 + 11, y0 + s / 2); g.lineTo(x0 + s / 2, y0 + s / 2 + 11); g.lineTo(x0 + s / 2 - 11, y0 + s / 2); g.fill();
        } else {
          for (let k = 0; k < 5; k++) {
            const v2 = 200 + Math.floor(r() * 35);
            g.strokeStyle = `rgba(${v2},${v2},${v2},0.5)`; g.lineWidth = 1;
            g.beginPath(); g.moveTo(x0 + r() * s, y0 + r() * s); g.lineTo(x0 + r() * s, y0 + r() * s); g.stroke();
          }
        }
      }
    }
  }, { repeat: true }));
}

function crestTex(bgHex) {
  return texOnce('crest' + bgHex, () => canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#' + new THREE.Color(bgHex).getHexString(); g.fillRect(0, 0, w, h);
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
  col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9, 0.935, g) * uGlint * 1.5 * (0.5 + 0.5 * sin(uTime * 3.0 + p.x * 4.0));
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
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: /* glsl */ `
uniform float uTime;
varying float vH;
varying float vFlick;
void main() {
  vec3 p = position;
  vH = color.g;
  float ph = color.r * 6.2831;
  float k = vH * vH * color.b;
  p.x += sin(uTime * 9.0 + ph) * 0.1 * k;
  p.z += cos(uTime * 7.0 + ph * 1.3) * 0.07 * k;
  p.y += sin(uTime * 11.0 + ph * 2.0) * 0.05 * k;
  vFlick = 0.85 + 0.15 * sin(uTime * 17.0 + ph * 3.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: /* glsl */ `
varying float vH;
varying float vFlick;
void main() {
  vec3 c = mix(vec3(4.0, 2.7, 1.3), vec3(2.4, 0.6, 0.14), smoothstep(0.05, 0.85, vH));
  gl_FragColor = vec4(c * vFlick * (1.0 - smoothstep(0.5, 1.0, vH) * 0.75), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
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
    const g = new THREE.PlaneGeometry(0.055, 0.2, 1, 2).translate(0, 0.1, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setX(k, p.getX(k) * (1 - y / 0.24)); p.setZ(k, y * y * 1.4); }
    g.rotateY(a).translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    blades.push(g);
  }
  const geo = mergeGeometries(blades.map((g) => g.toNonIndexed()));
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) { const t = 0.55 + 0.45 * Math.min(1, p.getY(k) / 0.2); col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = t; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let k = 0; k < n.count; k++) n.setXYZ(k, n.getX(k) * 0.3, 1, n.getZ(k) * 0.3);
  geo.attributes.normal.needsUpdate = true;
  return geo;
}
function flowerGeometry() {
  const parts = [new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3).translate(0, 0.075, 0).toNonIndexed()];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(new THREE.CircleGeometry(0.034, 5).rotateX(-Math.PI / 2 + 0.25).translate(Math.cos(a) * 0.034, 0.155, Math.sin(a) * 0.034).toNonIndexed());
  }
  parts.push(new THREE.CircleGeometry(0.02, 6).rotateX(-Math.PI / 2).translate(0, 0.16, 0).toNonIndexed());
  const geo = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g; }));
  const col = new Float32Array(geo.attributes.position.count * 3);
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const stem = p.getY(k) < 0.145, centre = Math.hypot(p.getX(k), p.getZ(k)) < 0.021 && p.getY(k) > 0.157;
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
    mesh.setMatrixAt(n, M(x, heightFn(x, z) - 0.02, z, s, s * (0.85 + r() * 0.35), s, (r() - 0.5) * 0.2, r() * 6.28, (r() - 0.5) * 0.2));
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
// ------------------------------------------------------------------------------------ stage assembly
function stageKit() {
  return { near: new Batch(), mid: new Batch(), far: new Batch(), glow: new Batch(), flame: new Batch(), extra: [], lights: [], shafts: null };
}

/** Flames: cone tongues whose colour attribute carries (phase, height fraction, size) for the shader. */
function flame(kit, x, y, z, s, r) {
  const ph = r();
  for (const [ox, oz, k] of [[0, 0, 1], [0.08, 0.05, 0.7], [-0.07, -0.04, 0.65]]) {
    const h = 0.55 * s * k, b0 = y;
    kit.flame.add(G.cone7, M(x + ox * s, y + h / 2, z + oz * s, 0.16 * s * k, h, 0.16 * s * k), (vx, vy, vz, out) => out.setRGB(ph + ox, Math.min(1, Math.max(0, (vy - b0) / h)), s));
  }
}

function lightShafts(kit, ctx, shafts, color, intensity) {
  const geos = shafts.map(([x0, y0, z0, x1, y1, z1, w]) => {
    const g = new THREE.PlaneGeometry(1, 1);
    const p = g.attributes.position;
    const top = new THREE.Vector3(x0, y0, z0), bot = new THREE.Vector3(x1, y1, z1);
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      const at = bot.clone().lerp(top, v);
      p.setXYZ(i, at.x + (u - 0.5) * w * (0.75 + v * 0.5), at.y, at.z);
    }
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), shaftMaterial(ctx.time, color, intensity));
  mesh.name = 'ArenaShafts';
  mesh.renderOrder = 5;
  kit.extra.push(mesh);
}

function finishStage(ctx, kit, group) {
  const outdoor = ctx.outdoor;
  const toonV = (rim = 1) => {
    const m = toonMaterial({ color: 0xffffff, vertexColors: true, rim });
    return outdoor ? cloudShadow.apply(m) : m;
  };
  if (!kit.near.empty) {
    const m = kit.near.build(toonV(), 'ArenaNear');
    m.castShadow = m.receiveShadow = true;
    addOutline(m, { width: 1.7, color: OUTLINE, smoothNormals: true });
    group.add(m);
  }
  if (!kit.mid.empty) {
    const m = kit.mid.build(toonV(0.6), 'ArenaMid');
    m.castShadow = m.receiveShadow = true;
    if (ctx.quality !== 'low') addOutline(m, { width: 1.15, color: OUTLINE, smoothNormals: true });
    group.add(m);
  }
  if (!kit.far.empty) group.add(kit.far.build(toonMaterial({ color: 0xffffff, vertexColors: true, rim: 0.25, gradient: 'soft4' }), 'ArenaFar'));
  if (!kit.glow.empty) group.add(kit.glow.build(glowMaterial(), 'ArenaGlow'));
  if (!kit.flame.empty) {
    const f = kit.flame.build(flameMaterial(ctx.time), 'ArenaFlames');
    f.renderOrder = 6;
    group.add(f);
  }
  for (const e of kit.extra) group.add(e);
}

function groundMaterial(ctx, map, gradient = 'anime3') {
  const m = toonMaterial({ color: 0xffffff, vertexColors: true, map, gradient, rim: 0 });
  return ctx.outdoor ? cloudShadow.apply(m) : m;
}

/** Shared rolling-terrain height: flat under the fighters, gentle swells, rising distant hills. */
function rollingHeight(seed, amp = 1, farAmp = 1) {
  return (x, z) => {
    const core = smooth(5, 15, Math.hypot(x * 0.55, (z + 1) * 1.05));
    let y = (fbm(x * 0.045 + seed, z * 0.045 - seed, 3) - 0.42) * 3.2 * amp * core;
    y += smooth(-22, -95, z) * 11 * farAmp * (fbm(x * 0.012 + seed * 2, z * 0.012, 3) + 0.25);
    return y;
  };
}

function tuftsAndFlowers(ctx, kit, height, { tufts = 260, flowers = 90, flowerColors, tuftColors, xr = 15, z0 = -9, z1 = 5.5 } = {}) {
  const q = ctx.quality === 'low' ? 0.4 : ctx.quality === 'medium' ? 0.7 : 1;
  const place = (rr) => {
    const x = (rr() * 2 - 1) * xr, z = z0 + rr() * (z1 - z0);
    if (clearZone(x, z, -0.3) && rr() < 0.85) return null;
    return [x, z, 0.75 + rr() * 0.45];
  };
  if (tufts > 0) kit.extra.push(scatter('tuft', Math.round(tufts * q), place, height, tuftColors || ctx.pal.tuft, ctx.time, ctx.r, 0.08));
  if (flowers > 0) kit.extra.push(scatter('flower', Math.round(flowers * q), place, height, flowerColors || ctx.pal.flowers, ctx.time, ctx.r, 0.05));
}

// ------------------------------------------------------------------------------------------ themes
function buildField(ctx, kit, group) {
  const { pal, r, variant } = ctx;
  const height = rollingHeight(3.1, variant === 'meadow' ? 0.4 : 0.6, 0.9);
  const grass = patchColor(pal.grass, 0.16, 2);
  const far = new THREE.Color(pal.farHill);
  const dirt = new THREE.Color(pal.dirt[1]), dirtDark = new THREE.Color(pal.dirt[0]), stone = new THREE.Color(pal.stone[0]);
  const road = variant === 'road' || variant === 'village' || variant === 'paved';
  const color = (x, z, y, out) => {
    grass(x, z, out);
    out.lerp(far, smooth(-30, -120, z) * 0.6);
    if (road) {
      const w = 1.25 + (vnoise(x * 0.4, 7) - 0.5) * 0.5;
      const t = 1 - smooth(w - 0.25, w + 0.12, Math.abs(z + Math.sin(x * 0.08) * 0.4));
      if (t > 0) out.lerp(variant === 'paved' ? stone : _c2.copy(dirtDark).lerp(dirt, vnoise(x * 1.3, z * 1.3)), t * smooth(30, 18, Math.abs(x)));
    }
    return out;
  };
  group.add(groundMesh(height, color, groundMaterial(ctx, grassTex())));

  if (variant === 'paved') {
    for (let i = 0; i < 260; i++) {
      const x = (r() * 2 - 1) * 16, z = (r() * 2 - 1) * 1.15;
      kit.near.add(G.box, M(x, 0.01, z, 0.32 + r() * 0.2, 0.05, 0.26 + r() * 0.16, 0, r() * 0.6, 0), pick(pal.stone, r), true);
    }
  }
  for (const [x, z, s] of [[-7.5, -2.6, 0.75], [8.2, -1.8, 0.55], [-10.5, 1.5, 0.6], [6.4, 3.2, 0.35], [-5.2, 3.6, 0.3], [11, -4, 0.9]]) rock(kit.near, x, z, s, pick(pal.rock, r), r, height(x, z));
  const bushes = variant === 'thicket' ? 16 : 6;
  for (let i = 0; i < bushes; i++) {
    const side = i % 2 ? 1 : -1, x = side * (4.6 + r() * 8), z = -4.5 + r() * (variant === 'thicket' ? 8 : 4);
    if (clearZone(x, z, 0.8)) continue;
    bush(kit.near, x, z, 0.8 + r() * 0.6, pal, r, height(x, z));
  }
  if (variant === 'village') {
    const night = ctx.night;
    for (const [x, z, ry, s] of [[-6.8, -7.6, 0.25, 1.15], [-1.6, -9.6, -0.08, 1.0], [3.9, -8.2, -0.2, 1.2], [9.4, -6.2, -0.45, 1.05], [-12.5, -5.4, 0.6, 1.1]]) cottage(kit.mid, kit.glow, x, z, ry, s, pal, r, night);
    fence(kit.near, -11, -4.6, -4.2, pal.wood, r);
    fence(kit.near, 5.2, 11.5, -3.8, pal.wood, r);
    kit.mid.add(G.cyl16, M(6.8, 0.35, -4.9, 0.55, 0.7, 0.55), pal.stone[1]);
    kit.mid.add(G.cone7, M(6.8, 1.45, -4.9, 0.85, 0.5, 0.85), pal.roofs[0], true);
    for (const sx of [-0.45, 0.45]) kit.mid.add(G.box, M(6.8 + sx, 0.85, -4.9, 0.08, 0.9, 0.08), pal.wood, true);
  } else if (variant === 'fort') {
    for (let i = 0; i < 34; i++) {
      const x = -13 + i * 0.78, z = -7.2 + Math.sin(i * 0.37) * 0.3, h = 2.3 + r() * 0.35;
      kit.mid.add(G.cyl8, M(x, h / 2, z, 0.36, h, 0.36), pal.wood);
      kit.mid.add(G.cone7, M(x, h + 0.22, z, 0.36, 0.44, 0.36), pal.wood, true);
    }
    for (const x of [-5.4, 5.4]) {
      for (const [lx, lz] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.7], [0.8, 0.7]]) kit.mid.add(G.cyl8, M(x + lx, 2.1, -6.2 + lz, 0.12, 4.2, 0.12), pal.trunk);
      kit.mid.add(G.box, M(x, 4.25, -6.2, 2.1, 0.18, 2.1), pal.wood, true);
      kit.mid.add(G.box, M(x, 4.75, -6.2 + 1.0, 2.1, 0.8, 0.12), pal.wood, true);
      kit.mid.add(G.cone7, M(x, 5.6, -6.2, 1.7, 1.2, 1.7, 0, Math.PI / 7, 0), pal.roofs[0], true);
      flame(kit, x + 1.1, 4.4, -5.0, 0.55, r);
    }
    kit.lights.push({ pos: [-5.4, 4.9, -4.6], color: 0xffa040, intensity: 6, distance: 9 });
    kit.lights.push({ pos: [5.4, 4.9, -4.6], color: 0xffa040, intensity: 6, distance: 9 });
  } else {
    fence(kit.near, -12.5, -6.2, -5.6, pal.wood, r, height(-9, -5.6));
  }
  const treeSpots = [];
  for (let i = 0; i < 24; i++) {
    const x = (r() * 2 - 1) * 42, z = -16 - r() * 30;
    if (variant === 'village' && Math.abs(x) < 12 && z > -20) continue;
    treeSpots.push([x, z]);
  }
  treeSpots.push([-11.5, -6.5], [13.5, -8], [-16, -3.5], [17, -2.5]);
  for (const [x, z] of treeSpots) {
    const s = 0.95 + r() * 0.65;
    if (r() < 0.12) pineTree(kit.mid, x, z, s, pal, r, height(x, z));
    else broadTree(kit.mid, x, z, s, pal, r, height(x, z), Math.abs(z) < 20);
  }
  for (let i = 0; i < 70; i++) {
    const x = (r() * 2 - 1) * 110, z = -40 - r() * 110;
    const s = 2.2 + r() * 2.5;
    kit.far.add(G.ico1, M(x, height(x, z) + s * 0.5, z, s, s * 0.8, s), pick(pal.leaves, r));
  }
  tuftsAndFlowers(ctx, kit, height, { flowers: variant === 'meadow' ? 520 : 170, tufts: variant === 'meadow' ? 600 : 480 });
  return height;
}

function buildForest(ctx, kit, group) {
  const { pal, r } = ctx;
  const pines = ctx.variant === 'pines';
  const height = rollingHeight(7.7, 0.8, 0.6);
  const leafLitter = new THREE.Color(pal.dirt[0]).lerp(new THREE.Color(pal.trunk), 0.3);
  const grass = patchColor([pal.grass[0], pal.grass[1], pal.grass[0]], 0.2, 5);
  const color = (x, z, y, out) => {
    grass(x, z, out);
    out.multiplyScalar(0.9);
    const lit = fbm(x * 0.25 + 9, z * 0.25, 3);
    out.lerp(leafLitter, smooth(0.5, 0.75, lit) * 0.55 * smooth(3, 8, Math.hypot(x * 0.6, z)));
    out.lerp(new THREE.Color(pal.pine[0]), smooth(-14, -40, z) * 0.6);
    return out;
  };
  group.add(groundMesh(height, color, groundMaterial(ctx, grassTex())));
  const tree = (b, x, z, s) => (pines || r() < 0.15 ? pineTree(b, x, z, s * 1.25, pal, r, height(x, z)) : broadTree(b, x, z, s, pal, r, height(x, z), b === kit.near || z > -9));
  for (const [x, z, s] of [[-6.4, -2.2, 1.7], [7.1, -2.9, 1.9], [-9.5, 1.2, 1.6], [10.2, 0.5, 1.5], [-12.5, -4.5, 1.8], [13.5, -5, 1.7]]) tree(kit.near, x, z, s);
  for (let i = 0; i < 46; i++) {
    const x = (r() * 2 - 1) * 26, z = -6 - r() * 13;
    tree(kit.mid, x, z, 1.1 + r() * 0.8);
  }
  for (let i = 0; i < 90; i++) {
    const x = (r() * 2 - 1) * 120, z = -22 - r() * 100, s = 2.4 + r() * 3;
    if (pines) kit.far.add(G.cone7, M(x, height(x, z) + s, z, s * 0.6, s * 2.4, s * 0.6), pick(pal.pine, r), true);
    else kit.far.add(G.ico1, M(x, height(x, z) + s * 0.8, z, s, s, s), _c2.set(pick(pal.leaves, r)).multiplyScalar(0.75).getHex());
  }
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1, x = side * (3.8 + r() * 8), z = -4 + r() * 8;
    if (clearZone(x, z, 0.8)) continue;
    bush(kit.near, x, z, 0.55 + r() * 0.5, pal, r, height(x, z));
  }
  kit.near.add(G.cyl8, M(-4.8, 0.22, -3.4, 0.22, 2.6, 0.22, 0, 0.3, Math.PI / 2), pal.trunk);
  kit.near.add(G.cyl8, M(5.6, 0.2, 2.6, 0.2, 2.0, 0.2, 0, -0.5, Math.PI / 2), pal.trunk);
  for (let i = 0; i < 9; i++) {
    const x = (r() < 0.5 ? -1 : 1) * (3.8 + r() * 4), z = -3 + r() * 6.5;
    if (clearZone(x, z, 0.5)) continue;
    const s = 0.18 + r() * 0.14, y = height(x, z);
    kit.near.add(G.cyl6, M(x, y + s * 0.6, z, s * 0.25, s * 1.2, s * 0.25), 0xf2e8d4, true);
    kit.near.add(G.dome, M(x, y + s * 1.1, z, s * 0.75, s * 0.55, s * 0.75), r() < 0.6 ? 0xd8452f : 0xe8c06a);
  }
  rock(kit.near, -7.6, 2.8, 0.55, pick(pal.rock, r), r, 0);
  rock(kit.near, 8.6, -1.2, 0.7, pick(pal.rock, r), r, 0);
  const warm = ctx.night ? 0x9ab8ff : 0xfff0c8;
  lightShafts(kit, ctx, [[-4, 9, -10, -1.8, 0, -1.5, 1.6], [1.5, 9.5, -11, 2.4, 0, -2.2, 1.2], [6, 9, -9, 4.6, 0, -0.5, 1.9], [-9, 9, -8, -6.5, 0, 0.5, 1.1]], warm, ctx.night ? 0.12 : 0.22);
  tuftsAndFlowers(ctx, kit, height, { tufts: 220, flowers: 45, flowerColors: [0xf6f3ea, 0xf8d64a, 0xb9a6ff] });
  return height;
}

function buildRocky(ctx, kit, group) {
  const { pal, r } = ctx;
  const peaks = ctx.variant === 'peaks';
  const edge = (x) => -5.6 + Math.sin(x * 0.35) * 0.8 + (vnoise(x * 0.5, 3) - 0.5) * 0.8;
  const height = (x, z) => {
    const e = edge(x);
    const top = (fbm(x * 0.08, z * 0.08, 3) - 0.45) * 1.2 * smooth(4, 10, Math.hypot(x * 0.6, z + 1));
    if (z > e) return top + smooth(10, 26, Math.abs(x)) * 6 * fbm(x * 0.05, z * 0.05);
    const drop = smooth(e, e - 3.5, z);
    return top * (1 - drop) - drop * (28 + fbm(x * 0.03, z * 0.03) * 10) + smooth(-60, -140, z) * 18 * fbm(x * 0.02, z * 0.02 + 5);
  };
  const grass = patchColor(pal.grass, 0.22, 11);
  const rockC = new THREE.Color(pal.rock[0]), rockL = new THREE.Color(pal.rock[2]), valley = new THREE.Color(pal.farHill);
  const color = (x, z, y, out) => {
    grass(x, z, out);
    const stony = smooth(0.52, 0.62, fbm(x * 0.3 + 4, z * 0.3, 3));
    out.lerp(_c2.copy(rockC).lerp(rockL, vnoise(x * 2, z * 2)), Math.max(stony * 0.85, smooth(edge(x) + 0.4, edge(x) - 0.6, z)));
    if (y < -12) out.copy(valley).lerp(rockC, 0.25);
    return out;
  };
  group.add(groundMesh(height, color, groundMaterial(ctx, grassTex())));
  for (const [x, z, s] of [[-6.2, -3.2, 1.4], [-8.8, -1.5, 1.0], [7.4, -3.6, 1.7], [9.6, -0.8, 0.9], [-11, 2.2, 1.2], [12, 1.5, 1.3], [5.2, 3.4, 0.4], [-4.8, 3.2, 0.35]]) rock(kit.near, x, z, s, pick(pal.rock, r), r, height(x, z) - 0.15, s > 1.2);
  for (let i = 0; i < 18; i++) {
    const x = (r() * 2 - 1) * 14, z = -4.8 + r() * 9;
    if (clearZone(x, z, 0.6)) continue;
    rock(kit.near, x, z, 0.15 + r() * 0.25, pick(pal.rock, r), r, height(x, z));
  }
  for (const [x, z] of [[-8, -4.2], [10.5, -4.6], [-13, -3]]) pineTree(kit.near, x, z, 1.3 + r() * 0.4, pal, r, height(x, z));
  if (peaks) {
    const capSnow = pal.name === 'temperate' || pal.name === 'autumn' ? 0xeef4fb : null;
    for (const [x, z, w, h] of [[-12, -7, 1.6, 5.5], [13.5, -8, 2, 7], [-16, -2, 1.8, 6.5]]) peak(kit.mid, x, z, w, h, _c2.set(pal.rock[0]).multiplyScalar(0.78).getHex(), capSnow, r, height(x, z) - 0.5);
  }
  const snow = ctx.pal.name === 'desert' || ctx.pal.name === 'golden' || ctx.pal.name === 'ashen' ? null : 0xeef4fb;
  for (let i = 0; i < 18; i++) {
    const x = (r() * 2 - 1) * 140, z = -62 - r() * 100, w = 12 + r() * 18, h = 20 + r() * 22;
    peak(kit.far, x, z, w, h, _c2.set(pal.rock[0]).lerp(new THREE.Color(pal.farHill), 0.15).multiplyScalar(0.85).getHex(), snow, r, -28);
  }
  for (const [x, z, w, h] of [[-10.5, -7.5, 1.6, 4.2], [11.5, -8.2, 2.0, 5.2]]) peak(kit.mid, x, z, w, h, pal.rock[1], null, r, height(x, -5) - 1.2);
  for (let i = 0; i < 26; i++) {
    const x = (r() * 2 - 1) * 70, z = -18 - r() * 40, s = 2 + r() * 3;
    kit.far.add(G.cone7, M(x, height(x, z) + s, z, s * 0.55, s * 2.2, s * 0.55), pick(pal.pine, r), true);
  }
  tuftsAndFlowers(ctx, kit, height, { tufts: 200, flowers: 40, z0: -5, flowerColors: [0xf6f3ea, 0xb9a6ff, 0xf8d64a] });
  return height;
}
function archShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h);
  s.absarc(0, h, w / 2, 0, Math.PI, false);
  s.lineTo(-w / 2, 0);
  return s;
}

function brazier(kit, x, z, r, metal = 0x4a4038) {
  kit.near.add(G.cyl8, M(x, 0.45, z, 0.07, 0.9, 0.07), metal, true);
  kit.near.add(G.cyl8, M(x, 0.04, z, 0.3, 0.08, 0.3), metal, true);
  kit.near.add(G.dome, M(x, 1.0, z, 0.34, -0.22, 0.34), metal);
  kit.glow.add(G.cyl16, M(x, 0.99, z, 0.28, 0.02, 0.28), 0xffa040);
  flame(kit, x, 1.0, z, 1.0, r);
  kit.lights.push({ pos: [x, 1.6, z + 0.2], color: 0xff9a40, intensity: 16, distance: 11 });
}

function buildCastle(ctx, kit, group) {
  const { pal, r, variant, night } = ctx;
  const ashen = pal.name === 'ashen';
  const stoneHex = ashen ? 0x8a8078 : 0xc4b8a4, wallHex = ashen ? 0x7c736a : 0xb0a694, trimHex = ashen ? 0x5f5850 : 0x8e8674;
  const height = () => 0;
  const tint = patchColor([stoneHex, _c2.set(stoneHex).multiplyScalar(0.9).getHex(), stoneHex], 0.3, 4);
  group.add(groundMesh(height, (x, z, y, out) => tint(x, z, out), groundMaterial(ctx, tileTex('stone')), { repeat: 4 }));
  const BZ = -8.5, WH = 11;
  kit.near.add(G.box, M(0, WH / 2, BZ - 0.5, 30, WH, 1), wallHex, true);
  kit.near.add(G.box, M(0, 0.35, BZ + 0.05, 30, 0.7, 0.3), trimHex, true);
  kit.near.add(G.box, M(0, WH - 0.4, BZ + 0.05, 30, 0.5, 0.4), trimHex, true);
  for (const sx of [-1, 1]) {
    kit.near.add(G.box, M(sx * 13.5, WH / 2, -0.3, 1, WH, 17), wallHex, true);
    kit.near.add(G.box, M(sx * 13.2, 0.35, -0.3, 0.4, 0.7, 17), trimHex, true);
  }
  const winW = 2.2, winH = 2.3, winY = 1.5;
  const xs = variant === 'gate' ? [-6.6, 6.6] : [-6.6, 0, 6.6];
  const glassLo = new THREE.Color(night ? 0x2a4a8a : 0xd8ecff), glassHi = new THREE.Color(night ? 0x5a78c0 : 0xffffff);
  for (const x of xs) {
    const glass = new THREE.ShapeGeometry(archShape(winW, winH), 12);
    const frame = new THREE.ExtrudeGeometry(archShape(winW + 0.5, winH), { depth: 0.25, bevelEnabled: false, curveSegments: 12 });
    frame.translate(0, 0, -0.3);
    kit.near.add(frame, M(x, winY - 0.12, BZ + 0.08, 1, 1.02, 1), trimHex, true);
    kit.glow.add(glass, M(x, winY, BZ + 0.21, 1, 1, 1), (vx, vy, vz, out) => out.copy(glassLo).lerp(glassHi, smooth(winY, winY + winH + 1, vy)).multiplyScalar(night ? 0.45 : 0.42));
    kit.near.add(G.box, M(x, winY + winH * 0.62, BZ + 0.28, 0.1, winH * 1.24 + winW * 0.5, 0.08), trimHex, true);
    for (const yy of [0.35, 0.7]) kit.near.add(G.box, M(x, winY + winH * yy, BZ + 0.28, winW, 0.08, 0.08), trimHex, true);
    kit.near.add(G.box, M(x, winY - 0.25, BZ + 0.3, winW + 0.8, 0.22, 0.5), trimHex, true);
  }
  if (variant === 'gate') {
    const gw = 4.6, gh = 4.2;
    kit.glow.add(new THREE.ShapeGeometry(archShape(gw, gh), 16), M(0, 0, BZ + 0.02), (vx, vy, vz, out) => out.set(night ? 0x34508a : 0xfff4dc).multiplyScalar(night ? 0.5 : 0.85));
    kit.near.add(new THREE.ExtrudeGeometry(archShape(gw + 0.9, gh), { depth: 0.4, bevelEnabled: false, curveSegments: 16 }).translate(0, 0, -0.45), M(0, -0.1, BZ + 0.15), trimHex, true);
    for (let i = 0; i < 7; i++) kit.near.add(G.box, M(-gw / 2 + 0.3 + i * ((gw - 0.6) / 6), gh * 0.55 + 1.6, BZ + 0.35, 0.1, gh * 0.9, 0.1), 0x3a3434, true);
    for (let j = 0; j < 4; j++) kit.near.add(G.box, M(0, 3.0 + j * 0.9, BZ + 0.36, gw, 0.1, 0.1), 0x3a3434, true);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) kit.near.add(G.box, M(sx * 1.3, 0.12, BZ + 1.2 + i * 1.1, 1.3, 0.24, 1.0), trimHex, true);
  }
  for (const x of [-9.4, -4.3, 4.3, 9.4]) {
    for (const z of [-6.4, -2.9]) pillar(kit.near, x, z, 9.2, 0.42, stoneHex, trimHex);
  }
  kit.near.add(G.box, M(0, 9.6, -6.4, 22, 0.6, 1.0), trimHex, true);
  kit.near.add(G.box, M(0, 9.6, -2.9, 22, 0.6, 1.0), trimHex, true);
  const bannerHex = pal.name === 'golden' ? 0x2d4f9e : ashen ? 0x5a1a20 : 0xa3222c;
  const bannerGeo = [];
  for (const x of [-9.4, -4.3, 4.3, 9.4]) {
    const g = new THREE.PlaneGeometry(1.0, 2.5, 4, 10).translate(x, 2.85, -2.9 + 0.5);
    bannerGeo.push(g);
    kit.near.add(G.cyl6, M(x, 4.12, -2.9 + 0.5, 0.045, 1.25, 0.045, 0, 0, Math.PI / 2), 0xd9ab47, true);
  }
  const banner = new THREE.Mesh(mergeGeometries(bannerGeo), addSway(toonMaterial({ color: 0xffffff, map: crestTex(bannerHex), alphaTest: 0.5, side: THREE.DoubleSide }), ctx.time, 0.05, true));
  banner.castShadow = true;
  banner.name = 'ArenaBanners';
  kit.extra.push(banner);
  if (variant === 'carpet' || variant === 'throne') {
    kit.near.add(G.box, M(0, 0.012, 0.5, 2.3, 0.024, 18), ashen ? 0x5a1a20 : 0xa8242c, true);
    for (const sx of [-1, 1]) kit.near.add(G.box, M(sx * 1.08, 0.02, 0.5, 0.12, 0.03, 18), 0xd9ab47, true);
  }
  if (variant === 'throne') {
    kit.near.add(G.box, M(0, 0.15, -6.4, 6, 0.3, 3.4), trimHex, true);
    kit.near.add(G.box, M(0, 0.42, -6.8, 4.4, 0.25, 2.4), stoneHex, true);
    kit.near.add(G.box, M(0, 1.0, -6.9, 1.4, 0.9, 1.1), 0x8a1c26, true);
    kit.near.add(G.box, M(0, 2.2, -7.4, 1.5, 2.7, 0.3), 0xd9ab47, true);
    kit.near.add(G.box, M(0, 2.3, -7.25, 1.1, 2.1, 0.08), 0x8a1c26, true);
    kit.near.add(G.cone7, M(0, 3.85, -7.4, 0.45, 0.6, 0.2), 0xd9ab47, true);
    for (const sx of [-1, 1]) kit.near.add(G.box, M(sx * 0.78, 1.35, -6.9, 0.2, 0.5, 1.1), 0xd9ab47, true);
  }
  for (const [x, z] of [[-11.6, -7.2], [-10.8, -7.6], [11.4, -7.3]]) {
    kit.near.add(G.cyl8, M(x, 0.5, z, 0.42, 1.0, 0.42), 0x7a5434);
    for (const yy of [0.2, 0.8]) kit.near.add(G.cyl8, M(x, yy, z, 0.44, 0.06, 0.44), 0x4a4038);
  }
  kit.near.add(G.box, M(10.6, 0.4, -7.5, 0.9, 0.8, 0.8), 0x8a6a44, true);
  kit.near.add(G.box, M(10.7, 1.05, -7.6, 0.6, 0.5, 0.6, 0, 0.4, 0), 0x9a7a50, true);
  brazier(kit, -5.3, -3.7, r);
  brazier(kit, 5.3, -3.7, r);
  for (const x of [-11.9, 11.9]) {
    kit.near.add(G.box, M(x, 3.4, -5, 0.15, 0.5, 0.15), 0x4a4038, true);
    flame(kit, x, 3.72, -5, 0.6, r);
  }
  const shaftCol = night ? 0x8fb0ff : 0xfff2d0;
  lightShafts(kit, ctx, xs.map((x) => [x, winY + winH + 0.6, BZ + 0.3, x + 1.4, 0, -1.4, winW * 0.95]), shaftCol, night ? 0.16 : 0.26);
  return height;
}

function mesa(b, x, z, w, h, y0, hexA, hexB, r) {
  const g = new THREE.CylinderGeometry(0.74, 1, 1, 11, 5);
  const p = g.attributes.position;
  const seed = Math.floor(r() * 997);
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    if (Math.hypot(px, pz) < 0.05) continue;
    const k = 0.86 + 0.28 * hash2(Math.round(Math.atan2(pz, px) * 9) + seed, Math.round(py * 10));
    p.setXYZ(i, px * k, py, pz * k);
  }
  const a = new THREE.Color(hexA), bb = new THREE.Color(hexB);
  b.add(g, M(x, y0 + h / 2, z, w, h, w * (0.6 + r() * 0.4), 0, r() * 6, 0), (vx, vy, vz, out) => {
    const band = Math.floor(((vy - y0) / h) * 6 + hash2(Math.round(vx), 1) * 0.6);
    return out.copy(band % 2 ? a : bb).multiplyScalar(0.86 + 0.14 * ((vy - y0) / h));
  }, true);
}

function buildDesert(ctx, kit, group) {
  const { pal, r, variant } = ctx;
  const dunes = variant === 'dunes';
  const height = (x, z) => {
    const core = smooth(4.5, 13, Math.hypot(x * 0.55, (z + 1) * 1.1));
    const s = x * 0.06 + z * 0.032 + fbm(x * 0.02, z * 0.02, 3) * 2.4;
    const t = s - Math.floor(s);
    const prof = t < 0.7 ? Math.pow(t / 0.7, 1.4) : Math.pow((1 - t) / 0.3, 1.7);
    let y = (prof * (dunes ? 4.4 : 3.1) + (fbm(x * 0.06, z * 0.06, 3) - 0.4) * 1.0) * core;
    y += smooth(-20, -80, z) * 9 * (fbm(x * 0.015 + 2, z * 0.015, 3) + 0.2);
    return y;
  };
  const sand = patchColor(pal.sand, 0.12, 6);
  const dark = new THREE.Color(pal.sand[1]).multiplyScalar(0.82);
  const color = (x, z, y, out) => { sand(x, z, out); out.lerp(dark, smooth(0.62, 0.8, fbm(x * 0.2 + 1, z * 0.2, 3)) * 0.35); return out; };
  group.add(groundMesh(height, color, groundMaterial(ctx, sandTex()), { repeat: 4 }));
  const stone = pal.stone;
  const column = (b, x, z, h, rad = 0.38, tilt = 0) => {
    const y0 = height(x, z) - 0.25;
    const segs = Math.max(1, Math.round(h / 0.9));
    for (let i = 0; i < segs; i++) {
      const sh = h / segs;
      b.add(G.cyl8, M(x + tilt * i * 0.3, y0 + sh * (i + 0.5), z, rad * (1 - i * 0.03), sh * 0.96, rad * (1 - i * 0.03), 0, r() * 2, tilt * 0.3), pick(stone, r), true);
    }
    b.add(G.box, M(x, y0 + 0.1, z, rad * 2.6, 0.3, rad * 2.6, 0, r(), 0), stone[1], true);
  };
  const ruins = variant === 'ruins';
  column(kit.near, -6.2, -4.2, 2.6);
  column(kit.near, 7.6, -5.1, 1.6, 0.42, 0.4);
  column(kit.near, -10.2, -1.2, 3.4);
  if (ruins) {
    column(kit.near, 5.1, -2.6, 1.1);
    column(kit.near, -4.9, 2.6, 0.7, 0.4);
    kit.near.add(G.cyl8, M(4.4, 0.25, 3.0, 0.36, 2.6, 0.36, 0, 0.6, Math.PI / 2), stone[0], true);
  }
  for (const [x, ry] of [[3.2, 0.1]]) {
    const z = -9.5, y0 = height(x, z) - 0.5;
    for (const sx of [-1.4, 1.4]) column(kit.mid, x + sx, z, 4.2, 0.45);
    kit.mid.add(G.box, M(x, y0 + 4.5, z, 4.2, 0.7, 1.1, 0, ry, 0), stone[2], true);
  }
  kit.mid.add(G.cyl8, M(-3.5, height(-3.5, -7.2) + 0.25, -7.2, 0.42, 3.2, 0.42, 0, 1.1, Math.PI / 2), stone[0], true);
  for (const [x, z, s] of [[-2.2, -6.2, 0.7], [9.4, -2.6, 0.55], [-8.5, 2.8, 0.5], [12.5, -6, 1.1]]) {
    kit.near.add(G.box, M(x, height(x, z) + s * 0.25, z, s * 1.3, s * 0.9, s, r() * 0.3, r() * 3, r() * 0.2), pick(stone, r), true);
  }
  for (const [x, z, s] of [[-8.6, -6.4, 1.25], [-10.1, -4.6, 1.0], [10.6, -8.8, 1.35]]) palm(kit.mid, x, z, s, pal, r);
  bush(kit.near, -9.2, -4.0, 0.8, pal, r, height(-9.2, -4.0));
  for (let i = 0; i < 7; i++) {
    const x = (r() < 0.5 ? -1 : 1) * (4 + r() * 9), z = -3 + r() * 7;
    if (clearZone(x, z, 0.6)) continue;
    bush(kit.near, x, z, 0.32 + r() * 0.2, { ...pal, bush: [0x9a8a52, 0x8a7a48, 0xa89a5e] }, r, height(x, z) - 0.05);
  }
  for (let i = 0; i < 12; i++) {
    const x = (r() * 2 - 1) * 140, z = -45 - r() * 110, w = 8 + r() * 14, h = 7 + r() * 10;
    mesa(kit.far, x, z, w, h, height(x, z) - 1.5, pal.rock[2], _c2.set(pal.rock[1]).multiplyScalar(0.92).getHex(), r);
  }
  tuftsAndFlowers(ctx, kit, height, { tufts: 70, flowers: 0, tuftColors: [0xb8aa62, 0xa89a52, 0xc8b870] });
  return height;
}

function buildBridge(ctx, kit, group) {
  const { pal, r } = ctx;
  const cx = (z) => Math.sin(z * 0.045) * 7 * smooth(-8, -60, z);
  const bw = (z) => 9 - 2.5 * smooth(-10, -70, z);
  const height = (x, z) => {
    const d = Math.abs(x - cx(z)) - bw(z);
    const bank = smooth(-1.6, 1.2, d);
    const land = (fbm(x * 0.05, z * 0.05, 3) - 0.4) * 2 * smooth(2, 10, d) + smooth(-25, -100, z) * 9 * fbm(x * 0.015, z * 0.015 + 3);
    return -2.8 + bank * 2.8 + land * bank;
  };
  const grass = patchColor(pal.grass, 0.18, 3);
  const mud = new THREE.Color(pal.dirt[0]), bed = new THREE.Color(0x5f6a52), far = new THREE.Color(pal.farHill);
  const color = (x, z, y, out) => {
    grass(x, z, out);
    out.lerp(mud, smooth(-0.3, -1.1, y) * 0.8);
    if (y < -1.4) out.copy(bed);
    out.lerp(far, smooth(-30, -120, z) * 0.5);
    return out;
  };
  group.add(groundMesh(height, color, groundMaterial(ctx, grassTex())));
  const wc = {
    ashen: { shallow: 0x4f7e76, deep: 0x22404e, foam: 0xc8d6d2 }, desert: { shallow: 0x46b8ac, deep: 0x1c7090, foam: 0xe2f4f4 },
    golden: { shallow: 0x44b8b4, deep: 0x1c6aa0, foam: 0xe4f6f6 },
  }[pal.name] || { shallow: 0x3aa9b4, deep: 0x1b5890, foam: 0xdceff2 };
  const wk = ctx.night ? 0.42 : 1;
  const wmat = waterMaterial(ctx.time, { shallow: _c2.set(wc.shallow).multiplyScalar(wk).getHex(), deep: _c2.set(wc.deep).multiplyScalar(wk).getHex(), foam: _c2.set(wc.foam).multiplyScalar(ctx.night ? 0.55 : 1).getHex(), sky: ctx.skyColor, bank: 9, glint: ctx.night ? 0.35 : 1 });
  wmat.fragmentShader = wmat.fragmentShader.replace('float bank = smoothstep(uBank - 5.0, uBank, abs(p.x));',
    'float cxz = sin(p.y * 0.045) * 7.0 * smoothstep(-8.0, -60.0, p.y); float bwz = uBank - 2.5 * smoothstep(-10.0, -70.0, p.y);\n  p.x -= cxz;\n  float bank = smoothstep(bwz - 5.0, bwz, abs(p.x));')
    .replace('float foam = smoothstep(uBank - 0.9, uBank - 0.15,', 'float foam = smoothstep(bwz - 0.9, bwz - 0.15,');
  const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 300).rotateX(-Math.PI / 2).translate(0, -1.35, -90), wmat);
  water.name = 'ArenaWater';
  kit.extra.push(water);
  const wood = pal.wood;
  for (let x = -10.6, i = 0; x <= 10.6; x += 0.37, i++) {
    kit.near.add(G.box, M(x, -0.065 + (r() - 0.5) * 0.02, 0, 0.34, 0.13, 3.1 + (r() - 0.5) * 0.15, 0, (r() - 0.5) * 0.03, 0), _c2.set(wood).multiplyScalar(0.82 + r() * 0.3).getHex(), true);
  }
  for (const z of [-1.3, 1.3]) kit.near.add(G.box, M(0, -0.3, z, 21.6, 0.26, 0.26), _c2.set(wood).multiplyScalar(0.7).getHex(), true);
  for (const x of [-6.5, -2.2, 2.2, 6.5]) for (const z of [-1.35, 1.35]) kit.near.add(G.cyl8, M(x, -1.6, z, 0.17, 2.9, 0.17), _c2.set(pal.trunk).multiplyScalar(0.85).getHex());
  for (let x = -10.5; x <= 10.6; x += 2.1) {
    kit.near.add(G.box, M(x, 0.4, -1.5, 0.14, 0.8, 0.14), wood, true);
    kit.near.add(G.box, M(x, 0.18, 1.5, 0.13, 0.36, 0.13), wood, true);
  }
  kit.near.add(G.box, M(0, 0.74, -1.5, 21.2, 0.1, 0.12), wood, true);
  kit.near.add(G.box, M(0, 0.4, -1.5, 21.2, 0.07, 0.08), wood, true);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) rock(kit.near, sx * (9 + r() * 2), -3 + r() * 6, 0.4 + r() * 0.5, pick(pal.rock, r), r, height(sx * 9.5, 0) - 0.3);
    bush(kit.near, sx * 12, -2.4, 1.0, pal, r, height(sx * 12, -2.4));
    broadTree(kit.near, sx * 14.5, -1, 1.6, pal, r, height(sx * 14.5, -1));
  }
  for (let i = 0; i < 40; i++) {
    const z = -8 - r() * 40, side = r() < 0.5 ? -1 : 1, x = cx(z) + side * (bw(z) + 2 + r() * 10);
    if (r() < 0.25) pineTree(kit.mid, x, z, 1.3 + r() * 0.5, pal, r, height(x, z));
    else broadTree(kit.mid, x, z, 1.0 + r() * 0.7, pal, r, height(x, z), z > -16);
  }
  for (let i = 0; i < 60; i++) {
    const z = -45 - r() * 120, side = r() < 0.5 ? -1 : 1, x = cx(z) + side * (8 + r() * 60), s = 2.2 + r() * 2.5;
    kit.far.add(G.ico1, M(x, height(x, z) + s * 0.6, z, s, s * 0.85, s), pick(pal.leaves, r));
  }
  const reeds = (rr) => {
    const z = -12 + rr() * 17, side = rr() < 0.5 ? -1 : 1, x = cx(z) + side * (bw(z) - 0.3 + rr() * 1.2);
    return Math.abs(z) < 2.2 ? null : [x, z, 1.4 + rr() * 0.8];
  };
  const hb = (x, z) => Math.max(height(x, z), -1.35);
  kit.extra.push(scatter('tuft', ctx.quality === 'low' ? 60 : 160, reeds, hb, [0x6a9a3e, 0x7aa848, 0x5a8a36], ctx.time, r, 0.1));
  const bankTufts = (rr) => {
    const z = -10 + rr() * 15, side = rr() < 0.5 ? -1 : 1, x = side * (10.2 + rr() * 7);
    return [x, z, 0.9 + rr() * 0.6];
  };
  kit.extra.push(scatter('tuft', ctx.quality === 'low' ? 60 : 140, bankTufts, height, pal.tuft, ctx.time, r, 0.08));
  kit.extra.push(scatter('flower', ctx.quality === 'low' ? 20 : 50, bankTufts, height, pal.flowers, ctx.time, r, 0.05));
  return height;
}
function buildTemple(ctx, kit, group) {
  const { pal, r, variant } = ctx;
  const gold = pal.gold || [0xc9962e, 0xe8bf52, 0xa87420];
  const ivory = 0xf0e6cc, ivoryDark = 0xd6c8a6;
  const height = (x, z) => {
    const ax = Math.abs(x);
    if (z < -9.3) return -1.3 + smooth(-40, -120, z) * 14 * fbm(x * 0.02, z * 0.02);
    if (ax < 8.2) return 0;
    if (ax < 10.8) return -1.3;
    return 0.35 + smooth(16, 40, ax) * 6 * fbm(x * 0.03, z * 0.03);
  };
  const floor = patchColor([0xfff4dc, 0xf2e2b8, 0xfff4dc], 0.25, 8);
  const basalt = new THREE.Color(pal.rock[0]);
  group.add(groundMesh(height, (x, z, y, out) => (y > -0.1 && Math.abs(x) < 8.2 ? floor(x, z, out) : out.copy(basalt).multiplyScalar(0.85 + vnoise(x, z) * 0.3)),
    groundMaterial(ctx, tileTex('gold')), { repeat: 3 }));
  for (const sx of [-1, 1]) {
    kit.near.add(G.box, M(sx * 8.35, -0.6, -0.5, 0.3, 1.4, 17.6), gold[2], true);
    kit.near.add(G.box, M(sx * 10.65, -0.45, -0.5, 0.3, 1.7, 17.6), pal.rock[1], true);
  }
  kit.near.add(G.box, M(0, -0.6, -9.45, 16.6, 1.4, 0.3), gold[2], true);
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(260, 220).rotateX(-Math.PI / 2).translate(0, -0.75, -100), lavaMaterial(ctx.time, { scale: 0.5 }));
  lava.name = 'ArenaLava';
  kit.extra.push(lava);
  const gPillar = (b, x, z, h) => {
    b.add(G.cyl16, M(x, h / 2, z, 0.44, h, 0.44), gold[1]);
    for (const yy of [0.9, h * 0.5, h - 0.9]) b.add(G.cyl16, M(x, yy, z, 0.5, 0.12, 0.5), gold[2]);
    b.add(G.box, M(x, 0.18, z, 1.15, 0.36, 1.15), ivory, true);
    b.add(G.box, M(x, h - 0.18, z, 1.2, 0.36, 1.2), ivory, true);
    b.add(G.cyl16, M(x, h - 0.45, z, 0.56, 0.18, 0.56), ivoryDark);
  };
  for (const x of [-6.6, 6.6]) for (const z of [-1.8, -5.6]) gPillar(kit.near, x, z, 7.2);
  for (const x of [-7.5, -4.6, -2.5, 2.5, 4.6, 7.5]) gPillar(kit.mid, x, -8.6, 7.6);
  kit.mid.add(G.box, M(0, 7.85, -8.6, 17.5, 0.5, 1.3), ivory, true);
  kit.mid.add(G.box, M(0, 8.25, -8.6, 17.8, 0.3, 1.45), gold[1], true);
  const em = new THREE.Vector3(0, 4.3, -12.5);
  kit.glow.add(new THREE.TorusGeometry(1.05, 0.12, 8, 40), M(em.x, em.y, em.z), 0xb88a36);
  kit.glow.add(new THREE.CircleGeometry(0.8, 32), M(em.x, em.y, em.z - 0.05), 0x9a6a26);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, len = i % 2 ? 0.5 : 0.95;
    kit.glow.add(G.cone7, M(em.x + Math.cos(a) * (1.25 + len / 2), em.y + Math.sin(a) * (1.25 + len / 2), em.z, 0.12, len, 0.04, 0, 0, a - Math.PI / 2), 0xa8782e, true);
  }
  for (const sx of [-1, 1]) {
    const x = sx * 12.2;
    kit.mid.add(G.box, M(x, 1.6, -3.5, 1.2, 2.6, 1.2), ivory, true);
    kit.mid.add(G.cone7, M(x, 5.2, -3.5, 0.75, 4.6, 0.75, 0, Math.PI / 7, 0), gold[1], true);
  }
  if (variant === 'altar') {
    kit.near.add(G.box, M(0, 0.15, -6.2, 4.4, 0.3, 3.0), ivory, true);
    kit.near.add(G.box, M(0, 0.45, -6.4, 3.4, 0.3, 2.2), ivoryDark, true);
    kit.near.add(G.box, M(0, 1.05, -6.5, 1.8, 0.9, 1.1), gold[1], true);
    kit.glow.add(G.ico0, M(0, 2.35, -6.5, 0.38, 0.62, 0.38), 0x9af4ff);
    kit.lights.push({ pos: [0, 2.4, -6.0], color: 0x9af4ff, intensity: 9, distance: 10 });
  }
  brazier(kit, -3.6, -3.8, r, gold[2]);
  brazier(kit, 3.6, -3.8, r, gold[2]);
  for (let i = 0; i < 10; i++) {
    const x = (r() * 2 - 1) * 70, z = -25 - r() * 70;
    peak(kit.far, x, z, 7 + r() * 10, 12 + r() * 22, pal.rock[0], null, r, -1.5);
  }
  const shaftCol = 0xffe2a0;
  lightShafts(kit, ctx, [[-3, 12, -12, -1.2, 0, -2.5, 2.0], [3, 12, -12, 1.8, 0, -3.5, 1.6]], shaftCol, ctx.night ? 0.06 : 0.12);
  return height;
}

function buildVolcano(ctx, kit, group) {
  const { pal, r, variant } = ctx;
  const chasm = variant === 'chasm';
  const R = 0.5, SP = R * Math.sqrt(3);
  const topY = (x, z) => {
    const d = Math.hypot(x / 8.2, z / 4.8);
    if (d > 1) return null;
    const calm = smooth(0.35, 0.7, d);
    return -0.015 - hash2(Math.round(x * 10), Math.round(z * 10)) * 0.05 * (1 - calm) - calm * (hash2(Math.round(x * 7) + 3, Math.round(z * 7)) * 0.35 - (d > 0.9 ? 0.25 : 0));
  };
  const height = (x, z) => topY(x, z) ?? -0.1;
  const basalt = new THREE.Color(0x3a3436), basaltTop = new THREE.Color(0x5a5254);
  for (let j = -8; j <= 8; j++) {
    for (let i = -11; i <= 11; i++) {
      const x = i * SP + (j & 1 ? SP / 2 : 0), z = j * 1.5 * R * 0.97;
      const y = topY(x, z);
      if (y == null) continue;
      const h = 6;
      kit.near.add(G.cyl6, M(x, y - h / 2, z, R * 0.97, h, R * 0.97, 0, Math.PI / 6, 0), (vx, vy, vz, out) => out.copy(basalt).lerp(basaltTop, smooth(y - 0.4, y, vy)).multiplyScalar(0.9 + hash2(i, j) * 0.25), true);
      if (r() < 0.55) {
        for (let e = 0; e < 6; e++) {
          if (r() < 0.45) continue;
          const a0 = (e / 6) * Math.PI * 2 + Math.PI / 6, a1 = a0 + Math.PI / 3;
          const ex = x + Math.cos((a0 + a1) / 2) * R * 0.84, ez = z + Math.sin((a0 + a1) / 2) * R * 0.84;
          kit.glow.add(G.box, M(ex, y + 0.004, ez, R * 0.95, 0.01, 0.045, 0, -(a0 + a1) / 2 + Math.PI / 2, 0), _c2.set(0xff7a24).multiplyScalar(0.5 + r() * 0.8).getHex());
        }
      }
    }
  }
  if (chasm) {
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x120a1c, fog: true });
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(400, 300).rotateX(-Math.PI / 2).translate(0, -14, -100), voidMat);
    abyss.name = 'ArenaAbyss';
    kit.extra.push(abyss);
    for (let i = 0; i < 14; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (6 + r() * 24), z = -6 - r() * 26, s = 0.6 + r() * 1.6, y = -1.5 + r() * 6;
      const g = pick(ROCKS_FINE, r);
      kit.mid.add(g, M(x, y, z, s * 1.3, s * 0.45, s * 1.1, 0, r() * 6, 0), basaltTop.getHex(), true);
      kit.mid.add(G.cone9, M(x, y - s * 0.95, z, s * 1.05, s * 1.7, s * 0.9, Math.PI, r() * 6, (r() - 0.5) * 0.3), _c2.set(pick(pal.rock, r)).multiplyScalar(0.8).getHex(), true);
      kit.glow.add(G.ico0, M(x, y - s * 1.75, z, s * 0.12, s * 0.2, s * 0.12), 0x9a6aff);
    }
  } else {
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(400, 300).rotateX(-Math.PI / 2).translate(0, -1.5, -100), lavaMaterial(ctx.time, { scale: 0.32 }));
    lava.name = 'ArenaLava';
    kit.extra.push(lava);
    kit.lights.push({ pos: [-4, -0.6, 3.5], color: 0xff6a20, intensity: 10, distance: 10 });
    kit.lights.push({ pos: [5, -0.6, -4.5], color: 0xff6a20, intensity: 10, distance: 10 });
  }
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1, x = side * (10 + r() * 18), z = -9 - r() * 20, h = 2.2 + r() * 4.5;
    peak(kit.mid, x, z, 1.1 + r() * 1.4, h, pal.rock[1], null, r, chasm ? -6 : -1.6);
  }
  for (let i = 0; i < 12; i++) {
    const x = (r() * 2 - 1) * 120, z = -45 - r() * 110, w = 12 + r() * 18, h = 18 + r() * 30;
    const top = peak(kit.far, x, z, w, h, 0x2a2224, null, r, chasm ? -14 : -1.5);
    if (r() < 0.5) kit.glow.add(G.cone7, M(x, top - h * 0.12, z, w * 0.12, h * 0.25, w * 0.12), 0xff5a1a, true);
  }
  for (const [x, z, s] of [[-6.8, -2.6, 0.9], [7.3, -2.2, 1.1], [-8.6, 1.5, 0.7]]) rock(kit.near, x, z, s, pick(pal.rock, r), r, height(x, z) - 0.2, true);
  return height;
}

const BUILDERS = { field: buildField, forest: buildForest, rocky: buildRocky, castle: buildCastle, desert: buildDesert, bridge: buildBridge, temple: buildTemple, volcano: buildVolcano };

const GROUND_TONE = {
  grass: 'grass', meadow: 'grass', bush: 'grass', forest: 'grass', pines: 'grass', hill: 'grass', fort: 'dirt', village: 'dirt',
  road: 'dirt', bridge: 'wood', sand: 'sand', dune: 'sand', ruins: 'sand', paved: 'stone', floor: 'stone', carpet: 'stone',
  throne: 'stone', gate: 'stone', gold: 'gold', altar: 'gold', mountain: 'rock',
};
const TERRAIN_ID = {
  '.': 'grass', '"': 'meadow', ',': 'road', B: 'paved', Y: 'bush', F: 'forest', P: 'pines', H: 'hill', M: 'mountain', '=': 'bridge',
  S: 'sand', D: 'dune', C: 'floor', c: 'carpet', T: 'throne', G: 'gate', W: 'fort', V: 'village', R: 'ruins', g: 'gold', A: 'altar',
};

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/**
 * Side-view battle stage. `scene` is self-contained (own Environment, ground, backdrop, props, 2 point lights).
 * Extra members: `env` (Environment), `grade` (= env.preset, for the post stack), `theme`, `variant`.
 */
export class Arena {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} [opts]
   * @param {string} [opts.terrain='.'] TERRAIN char of the defender's tile (selects theme + variant)
   * @param {string} [opts.preset='day'] ENV_PRESETS key
   * @param {string|null} [opts.attackerTerrain] attacker's TERRAIN char; a ground patch of its surface is painted under rightSpot
   * @param {string} [opts.palette] map palette ('temperate' | 'autumn' | 'ashen' | 'desert' | 'golden')
   * @param {'low'|'medium'|'high'} [opts.quality='high']
   */
  constructor(renderer, opts = {}) {
    const { terrain = '.', preset = 'day', attackerTerrain = null, palette, quality = 'high' } = opts || {};
    this.renderer = renderer;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.name = 'Arena';
    this.leftSpot = new THREE.Vector3(-1.7, 0, 0);
    this.rightSpot = new THREE.Vector3(1.7, 0, 0);
    this.focus = new THREE.Vector3(0, 0.6, 0);
    this.time = { value: 0 };
    this.env = new Environment(this.scene, renderer, preset, { bounds: STAGE_BOUNDS, quality, particles: quality !== 'low' });
    this.grade = this.env.preset;
    this.lights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xffa040, 0, 9, 2);
      this.scene.add(l);
      return l;
    });
    this._lightDefs = [];
    this._cache = new Map();
    this.stage = null;
    this._patch = null;
    this._palette = palette;
    this.setTerrain(terrain, preset, palette, attackerTerrain);
  }

  /** Resolved environment preset (exposure, bloom, grade…). */
  get preset() { return this.env.preset; }

  /**
   * Switch stage (cached per theme + variant + preset + palette) and sky preset.
   * @param {string} terrainChar defender's TERRAIN char
   * @param {string} [preset]
   * @param {string} [palette]
   * @param {string|null} [attackerTerrain]
   */
  setTerrain(terrainChar = '.', preset = this.env.name, palette = this._palette, attackerTerrain = null) {
    const ch = THEME_OF[terrainChar] ? terrainChar : '.';
    const theme = THEME_OF[ch], variant = VARIANT_OF[ch] || 'base';
    const pal = paletteFor(palette, theme);
    this._palette = palette;
    this.env.setOverrides(SKY_OVERRIDES[theme] || {});
    this.env.setPreset(preset);
    this.grade = this.env.preset;
    this.theme = theme;
    this.variant = variant;
    const key = `${theme}|${variant}|${this.env.name}|${pal.name}`;
    if (!this.stage || this.stage.key !== key) {
      if (this.stage) this.scene.remove(this.stage.group);
      let st = this._cache.get(key);
      if (!st) {
        st = this._build(key, theme, variant, pal);
        this._cache.set(key, st);
        this._evict(st);
      } else {
        this._cache.delete(key);
        this._cache.set(key, st);
      }
      this.stage = st;
      this.scene.add(st.group);
    }
    this._lightDefs = this.stage.lights.slice(0, 2);
    this.lights.forEach((l, i) => {
      const d = this._lightDefs[i];
      l.visible = true;
      l.intensity = d ? d.intensity : 0;
      if (d) { l.position.fromArray(d.pos); l.color.setHex(d.color); l.distance = d.distance; }
    });
    this._setPatch(attackerTerrain, terrainChar, pal);
  }

  /**
   * @param {number} dt
   * @param {number} elapsed
   * @param {THREE.Camera} camera
   */
  update(dt, elapsed, camera) {
    this.time.value = elapsed;
    this.env.update(dt, elapsed, camera);
    this.lights.forEach((l, i) => {
      const d = this._lightDefs[i];
      if (d) l.intensity = d.intensity * (0.86 + 0.1 * Math.sin(elapsed * 9.3 + i * 2) + 0.04 * Math.sin(elapsed * 23.1 + i));
    });
  }

  /** Free every cached stage, the Environment and the lights. */
  dispose() {
    for (const st of this._cache.values()) this._disposeStage(st);
    this._cache.clear();
    if (this._patch) { this._patch.geometry.dispose(); this._patch.material.alphaMap?.dispose(); this._patch.material.dispose(); }
    this.env.dispose();
    for (const l of this.lights) l.dispose();
    this.scene.clear();
  }

  _build(key, theme, variant, pal) {
    const ctx = {
      theme, variant, pal, preset: this.env.name, night: this.env.name === 'night' || this.env.name === 'twilight',
      r: mulberry32(strHash(theme + variant)), time: this.time, quality: this.quality, outdoor: theme !== 'castle',
      skyColor: new THREE.Color(this.env.preset.fogColor).lerp(new THREE.Color(this.env.preset.horizon), 0.5),
    };
    const kit = stageKit();
    const group = new THREE.Group();
    group.name = `ArenaStage:${key}`;
    const height = BUILDERS[theme](ctx, kit, group);
    finishStage(ctx, kit, group);
    return { key, group, lights: kit.lights, height };
  }

  _evict(keep) {
    while (this._cache.size > CACHE_LIMIT) {
      const [k, st] = this._cache.entries().next().value;
      if (st === keep || st === this.stage) { this._cache.delete(k); this._cache.set(k, st); continue; }
      this._cache.delete(k);
      this._disposeStage(st);
    }
  }

  _disposeStage(st) {
    st.group.traverse((o) => {
      if (o.geometry && !Object.values(G).includes(o.geometry) && !Object.values(SCATTER_GEO).includes(o.geometry)) o.geometry.dispose();
      if (o.material && !o.userData.isOutline) o.material.dispose();
    });
  }

  _setPatch(attacker, defender, pal) {
    if (this._patch) { this.scene.remove(this._patch); this._patch.geometry.dispose(); this._patch.material.alphaMap?.dispose(); this._patch.material.dispose(); this._patch = null; }
    const tone = attacker && GROUND_TONE[TERRAIN_ID[attacker]];
    if (!tone || tone === GROUND_TONE[TERRAIN_ID[defender]] || this.theme === 'bridge' || this.theme === 'volcano') return;
    const hex = { grass: pal.grass[1], dirt: pal.dirt[1], sand: pal.sand[0], stone: pal.stone[0], gold: 0xf2e2b8, rock: pal.rock[1], wood: pal.wood }[tone];
    const alpha = canvasTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#ddd'); gr.addColorStop(1, '#000');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const mat = toonMaterial({ color: hex, transparent: true, depthWrite: false, rim: 0 });
    mat.alphaMap = alpha;
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32).rotateX(-Math.PI / 2), mat);
    patch.position.set(this.rightSpot.x, (this.stage.height ? this.stage.height(this.rightSpot.x, 0) : 0) + 0.01, 0.1);
    patch.receiveShadow = true;
    patch.name = 'ArenaAttackerPatch';
    this._patch = patch;
    this.scene.add(patch);
  }
}
