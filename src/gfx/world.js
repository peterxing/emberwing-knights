// World builder: turns a mapDef into a cel-shaded "HD-2D diorama" — merged terrain columns with procedural
// surfaces, stylised water, instanced swaying vegetation, structures, props, flames and a fog-faded surrounding
// landscape. One World per battle map; add `world.group` to the scene and call `update()` every frame.
import * as THREE from 'three';
import { TERRAIN, H_UNIT, WATER_Y, LAVA_Y, resolveHeights, surfaceY, terrainChar } from '../game/data/terrain.js';
import { toonMaterial, outlineMaterial } from './toon.js';
import {
  TT, PAL_SLOTS, createWorldUniforms, terrainMaterial, waterMaterial, propMaterial, clothMaterial, clothDepthMaterial,
  vegMaterial, vegDepthMaterial, animatedOutlineMaterial, fxMaterial,
} from './world-shaders.js';
import {
  GeoBuilder, Grow, L, PROPS, tint, wallTop, gate, house, doorstep, fort, throne, pillar, altarDeco, ruins, bridge,
  tower, palm, deadTree, chestLidGeometry, doorGeometry, vegetationKit, hangBanner,
} from './world-props.js';

const MARGIN = 12;
const BED_Y = WATER_Y - 0.36;
const VOID_Y = -3.2;
const LIP = 0.03;
const LIP_H = 0.09;
const CANOPY_H = 1.0;
const LID_OPEN = -1.95;
const DOOR_OPEN = -1.25;
const OUTLINE = 0x231a1e;

const BASE_PAL = {
  grassDark: 0x4a8a3a, grassMid: 0x67a845, grassLight: 0x8cc456, soilA: 0x7a5434, soilB: 0x936a42,
  rockA: 0x7b7975, rockB: 0x96918a, rockC: 0xb3ada2, sandA: 0xdcc48c, sandB: 0xc9ab72,
  stoneA: 0xa29d92, stoneB: 0x8a857b, mortar: 0x5a554e, carpetA: 0xa82430, carpetB: 0x7a1820,
  goldA: 0xb98a2a, goldB: 0xe6bb52, ashA: 0x4b4543, ashB: 0x625853, snow: 0xd6dfe9,
  bedA: 0x8c7c58, bedB: 0x5f6a52, forest: 0x3d6b2c, roadA: 0xa8845a, roadB: 0x8f6c48,
  gap: 0x6a8a44, rune: 0x6fe6ff, voidGlow: 0x8a4dff, canopyA: 0x2c6232, canopyB: 0x4a8a3a,
  flowerA: 0xf07aa8, flowerB: 0xe8c440, flowerC: 0xd6d0c4, flowerD: 0x93aef0,
  leaves: [0x3f8f3a, 0x55a43f, 0x6db84a, 0x4c9a45], pine: [0x2e6b48, 0x3a7d52, 0x2a5f40],
  bush: [0x4a9440, 0x5aa547, 0x3f8a3c], trunk: 0x6b4a2f, tuft: [0x5d9f3e, 0x77b84b, 0x8cc456],
  rock: [0x8a8680, 0x9a958d, 0x7b7872], flowers: [0xf07aa8, 0xe8c440, 0xd6d0c4, 0x93aef0, 0xe0503a],
  wall: 0x9a958b, banner: [0xa3222c, 0x2c4c9e], flag: 0x2c4c9e,
  water: { shallow: 0x3aa9b4, deep: 0x1b5890, foam: 0xdceff2, high: 0xb4e8f2 },
  roofs: [0xc0553a, 0x4f6d9a, 0x5f8a4a, 0xc9a25a, 0x8a4a6a], plasters: [0xe6dcc4, 0xdccba6, 0xe9e4d8, 0xd2bd98],
};

const PALETTES = {
  temperate: {},
  autumn: {
    grassDark: 0x7f7d36, grassMid: 0x9c9842, grassLight: 0xbdb456, forest: 0x75542a, gap: 0x8f8a44,
    canopyA: 0x8a4a22, canopyB: 0xc77a2e, leaves: [0xd9772a, 0xe8a23a, 0xc4462b, 0xb5a23c], bush: [0xb5672b, 0x9a8a3a, 0xc98a34],
    tuft: [0xa9a046, 0xc2b25a, 0x8f8a3a], flowerA: 0xe8783a, flowerD: 0xd9b04a,
  },
  desert: {
    grassDark: 0x8f8a44, grassMid: 0xa69a52, grassLight: 0xbcad66, sandA: 0xd9b675, sandB: 0xc49a5c,
    stoneA: 0xc6a97e, stoneB: 0xae8f66, mortar: 0x7c6448, rockA: 0xa8805a, rockB: 0xb88f66, rockC: 0xcca97e,
    soilA: 0x9c6e42, soilB: 0xae7f50, bedA: 0xc2a275, bedB: 0x8c8a5e, roadA: 0xb89462, roadB: 0x9f7c50,
    gap: 0xcfae78, forest: 0x9a8a4a, canopyA: 0x5f7e36, canopyB: 0x7a9244, leaves: [0x5f9a3e, 0x7cae48, 0x4f8a38],
    tuft: [0xaa9c54, 0xbcaa62, 0x958f48], rock: [0xa8845e, 0xb8946a, 0x987654], bush: [0x7a8a3a, 0x8f9a48],
    water: { shallow: 0x46b8ac, deep: 0x1c7090, foam: 0xe2f4f4, high: 0xbff0f4 }, wall: 0xc2a67e,
  },
  ashen: {
    grassDark: 0x55503f, grassMid: 0x67604b, grassLight: 0x7a725a, soilA: 0x4a3a30, soilB: 0x5a463a,
    rockA: 0x4a4240, rockB: 0x5c5350, rockC: 0x786d66, sandA: 0x6e655c, sandB: 0x5e564f,
    stoneA: 0x7a716a, stoneB: 0x625a54, mortar: 0x2e2a28, ashA: 0x3a3433, ashB: 0x4c4442,
    bedA: 0x4a4038, bedB: 0x3a3a34, forest: 0x4a4436, roadA: 0x6a5a4a, roadB: 0x5a4c40, gap: 0x4c4442,
    canopyA: 0x3a3a2c, canopyB: 0x4a4a36, leaves: [0x6a6a3a, 0x5a5a32], pine: [0x2e3a30, 0x3a4436],
    bush: [0x5a5a38, 0x4a4a30], tuft: [0x6a6350, 0x7a725a], rock: [0x5a524e, 0x6a605a, 0x4a4442],
    water: { shallow: 0x4f7e76, deep: 0x22404e, foam: 0xc8d6d2, high: 0x9cc4bc }, rune: 0xff8a4a, wall: 0x6e6660,
  },
  golden: {
    grassDark: 0x6a9a40, grassMid: 0x84a84a, grassLight: 0xa2bc5a, stoneA: 0xcfc6b2, stoneB: 0xb5aa94, mortar: 0x8a7c62,
    goldA: 0xa87420, goldB: 0xdcae48, sandA: 0xd8b97e, sandB: 0xc4a066, rockA: 0xa8865e, rockB: 0xb9966c, rockC: 0xcfb088,
    soilA: 0xa47a50, soilB: 0xb68c5e, gap: 0xcdb07a, bedA: 0xc8ad80, bedB: 0x93977a, rune: 0xffd77a,
    carpetA: 0x2d4f9e, carpetB: 0x1e3a7a, roadA: 0xbf9a68, roadB: 0xa8865a, leaves: [0x5f9a3e, 0x7cae48],
    rock: [0xb4926a, 0xc4a27a, 0xa4845e], water: { shallow: 0x44b8b4, deep: 0x1c6aa0, foam: 0xe4f6f6, high: 0xc4f4f6 },
    banner: [0x2d4f9e, 0xd29a32], wall: 0xc4b89e, flag: 0xd29a32,
  },
};

const ENV = {
  dawn: { night: 0.4, sky: 0xffc9a8, light: 0.75 },
  day: { night: 0, sky: 0xbfe2ff, light: 0.5 },
  sunset: { night: 0.65, sky: 0xffb07a, light: 0.9 },
  night: { night: 1, sky: 0x3a4f8a, light: 1.3 },
  desert: { night: 0, sky: 0xd8f0ff, light: 0.5 },
  volcano: { night: 0.55, sky: 0xff8a5a, light: 1.0 },
  twilight: { night: 0.85, sky: 0x8a7ad0, light: 1.15 },
};

const QUALITY = {
  high: { tuft: 5, flower: 1, outTuft: 0.45, vegOutline: true, lights: 4, canopy: 6, vegShadow: true },
  medium: { tuft: 3, flower: 0.6, outTuft: 0.2, vegOutline: true, lights: 2, canopy: 5, vegShadow: true },
  low: { tuft: 0, flower: 0.3, outTuft: 0, vegOutline: false, lights: 0, canopy: 3, vegShadow: false },
};

const ROADISH = new Set([',', '=', 'V', 'B', 'G', 'W']);
const CARPETISH = new Set(['c', 'T']);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR_KEYS = ['E', 'W', 'S', 'N'];
// rotation about Y that turns local +z toward each direction
const FACE_RY = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];

const GROUND_OF = { h: '.', V: ',', '=': ',', G: ',', W: '.', T: 'C', O: 'C', A: 'C', c: 'C' };

// ------------------------------------------------------------------------------------------- utilities
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOutBack = (q, c1 = 1.9) => 1 + (c1 + 1) * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2);
const smooth = (q) => q * q * (3 - 2 * q);

function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = q - v[k]; d[q] = r * r + f[v[k]]; }
}
/** In-place squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt2d(g, w, h) {
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
}

const _desat = new THREE.Color();
function desat(hex, out, ks = 0.42, kd = 0.2) {
  const c = _desat.set(hex);
  const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  c.r += (l - c.r) * out * ks; c.g += (l - c.g) * out * ks; c.b += (l - c.b) * out * ks;
  return c.multiplyScalar(1 - out * kd);
}

const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _v3 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _col = new THREE.Color();
const _Y = new THREE.Vector3(0, 1, 0);

/**
 * Renderable battle map.
 * @example
 *   const world = new World(mapDef, { quality: 'high' });
 *   scene.add(world.group);
 *   // per frame: world.update(dt, elapsed, camera)
 */
export class World {
  /**
   * @param {object} mapDef map definition ({ id, width, height, tiles, heights?, props?, environment, border, palette? })
   * @param {{quality?: 'high'|'medium'|'low'}} [opts]
   */
  constructor(mapDef, opts = { quality: 'high' }) {
    const t0 = performance.now();
    this.mapDef = mapDef;
    this.quality = QUALITY[opts && opts.quality] ? opts.quality : 'high';
    this.Q = QUALITY[this.quality];
    /** @type {number} */ this.width = mapDef.width;
    /** @type {number} */ this.height = mapDef.height;
    /** @type {number[][]} */ this.heights = resolveHeights(mapDef);
    /** @type {THREE.Group} */ this.group = new THREE.Group();
    this.group.name = `World:${mapDef.id ?? ''}`;
    this.envName = ENV[mapDef.environment] ? mapDef.environment : 'day';
    this.env = ENV[this.envName];
    this.paletteName = PALETTES[mapDef.palette] ? mapDef.palette
      : this.envName === 'desert' ? 'desert' : this.envName === 'volcano' ? 'ashen' : 'temperate';
    this.pal = { ...BASE_PAL, ...PALETTES[this.paletteName] };
    this.border = mapDef.border || 'forest';
    this.U = createWorldUniforms();
    this.U.uNight.value = this.env.night;
    const snowless = ['desert', 'ashen', 'golden'].includes(this.paletteName) || this.envName === 'desert' || this.envName === 'volcano';
    this.U.uSnowY.value = snowless ? 999 : 4 * H_UNIT - 0.05;
    this._seed = hashStr(String(mapDef.id ?? 'map'));
    this._dispose = [];
    this._chests = new Map();
    this._doors = new Map();
    this._anims = [];
    this._lights = [];
    this._sails = [];
    this._fadeTarget = 0;
    this._pickTop = new Float32Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this._pickTop[y * this.width + x] = this.tileTop(x, y);

    const phases = {};
    let tp = performance.now();
    const mark = (k) => { const n = performance.now(); phases[k] = +(n - tp).toFixed(1); tp = n; };
    this._buildGrid(); mark('grid');
    this._decorate(); mark('decorate');
    this._buildShore(); mark('shore');
    this._buildTerrain(); mark('terrain');
    this._buildWater(); mark('water');
    this._buildStatic(); mark('static');
    this._buildInstances(); mark('instances');
    this._buildFx();
    this._buildLights(); mark('fxLights');

    let lo = Infinity, hi = -Infinity;
    for (const v of this._pickTop) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    /** Playable area: x∈[0,width], z∈[0,height], y from the lowest walkable surface to the highest tile top + 1.6. @type {THREE.Box3} */
    this.bounds = new THREE.Box3(new THREE.Vector3(0, lo, 0), new THREE.Vector3(this.width, hi + 1.6, this.height));
    this.group.traverse((o) => { o.frustumCulled = false; });
    /** Build diagnostics: { buildMs, phases, meshes, triangles, lights } */
    this.stats = { buildMs: performance.now() - t0, phases, ...this._countStats() };
  }

  // ----------------------------------------------------------------------------------------- grid
  _idx(x, y) {
    const i = x + MARGIN, j = y + MARGIN;
    return i < 0 || j < 0 || i >= this._EW || j >= this._EH ? -1 : j * this._EW + i;
  }
  _chAt(x, y) { const k = this._idx(x, y); return k < 0 ? null : this._ch[k]; }
  _isWater(k) { const c = this._ch[k]; return c === '~' || (c === '=' && !this._lavaBridge[k]); }
  _isLava(k) { const c = this._ch[k]; return c === 'L' || (c === '=' && this._lavaBridge[k] === 1); }
  _topAt(x, y) { const k = this._idx(x, y); return k < 0 ? this._skirtY : this._top[k]; }

  _buildGrid() {
    const W = this.width, H = this.height, M = MARGIN;
    const EW = W + 2 * M, EH = H + 2 * M, N = EW * EH;
    this._EW = EW; this._EH = EH;
    const ch = new Array(N), lv = new Float32Array(N), dd = new Uint8Array(N);
    for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) {
      const x = i - M, y = j - M, k = j * EW + i;
      if (x >= 0 && y >= 0 && x < W && y < H) { ch[k] = terrainChar(this.mapDef, x, y); lv[k] = this.heights[y][x]; continue; }
      const d = Math.max(Math.max(0, -x, x - (W - 1)), Math.max(0, -y, y - (H - 1)));
      dd[k] = d;
      const [c, l] = this._outsideCell(x, y, d);
      ch[k] = (c === 'F' || c === 'P') && d > this.Q.canopy ? 'n' : c; lv[k] = l;
    }
    this._ch = ch; this._lv = lv; this._dd = dd;
    const lb = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (ch[k] !== '=') continue;
      const i = k % EW, j = (k - i) / EW;
      let lava = false, water = false;
      for (const [dx, dy] of DIRS) {
        const ni = i + dx, nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= EW || nj >= EH) continue;
        const c = ch[nj * EW + ni];
        if (c === 'L') lava = true; else if (c === '~') water = true;
      }
      lb[k] = lava && !water ? 1 : 0;
    }
    this._lavaBridge = lb;

    const wd = new Int16Array(N).fill(-1);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let k = 0; k < N; k++) if (!this._isWater(k)) { wd[k] = 0; queue[qt++] = k; }
    while (qh < qt) {
      const k = queue[qh++], i = k % EW, j = (k - i) / EW;
      for (const [dx, dy] of DIRS) {
        const ni = i + dx, nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= EW || nj >= EH) continue;
        const nk = nj * EW + ni;
        if (wd[nk] < 0) { wd[nk] = wd[k] + 1; queue[qt++] = nk; }
      }
    }
    const top = new Float32Array(N), type = new Uint8Array(N), out = new Float32Array(N);
    const desertish = ['desert', 'ashen', 'golden'].includes(this.paletteName);
    for (let k = 0; k < N; k++) {
      const c = ch[k], d = dd[k];
      out[k] = d === 0 ? 0 : Math.min(1, 0.42 + d * 0.1);
      if (this._isWater(k)) top[k] = BED_Y - Math.min(Math.max(wd[k] - 1, 0), d > 0 ? 4 : 2) * 0.12;
      else if (this._isLava(k)) top[k] = LAVA_Y;
      else if (c === 'X') top[k] = VOID_Y;
      else if (c === 'n') top[k] = lv[k] * H_UNIT + CANOPY_H;
      else top[k] = lv[k] * H_UNIT;
      type[k] = lb[k] ? TT.LAVA : this._typeOf(c, k, desertish);
    }
    this._top = top; this._type = type; this._out = out; this._wd = wd;

    const ring = [];
    for (let i = 0; i < EW; i++) { ring.push(top[i], top[(EH - 1) * EW + i]); }
    for (let j = 1; j < EH - 1; j++) { ring.push(top[j * EW], top[j * EW + EW - 1]); }
    ring.sort((a, b) => a - b);
    this._skirtY = ring[Math.floor(ring.length / 2)];
    this._skirtType = { forest: TT.CANOPY, hills: TT.GRASS, mountains: TT.ROCK, desert: TT.SAND, water: TT.BED, castle: TT.FOREST, lava: TT.ASH }[this.border] ?? TT.GRASS;
    for (let k = 0; k < N; k++) {
      if (dd[k] < MARGIN - 1 || this._isWater(k)) continue;
      top[k] = this._skirtY;
      type[k] = this._skirtType;
    }
  }

  _typeOf(c, k, desertish) {
    switch (c) {
      case '.': return TT.GRASS;
      case '"': return TT.MEADOW;
      case ',': return TT.ROAD;
      case 'B': case 'G': case 'V': return TT.COBBLE;
      case 'Y': return this.paletteName === 'desert' ? TT.SAND : TT.GRASS;
      case 'F': case 'P': return this.paletteName === 'desert' ? TT.SAND : TT.FOREST;
      case 'H': return TT.HILL;
      case 'M': case 'K': return TT.ROCK;
      case '~': case '=': return TT.BED;
      case 'S': return TT.SAND;
      case 'D': return TT.DUNE;
      case '#': return TT.WALL;
      case 'C': return TT.FLOOR;
      case 'c': return TT.CARPET;
      case 'T': return TT.DAIS;
      case 'W': case 'h': return desertish || c === 'W' ? TT.DIRT : TT.GRASS;
      case 'R': return TT.RUINS;
      case 'L': return TT.LAVA;
      case 'g': return TT.GOLD;
      case 'A': return TT.ALTAR;
      case 'X': return TT.VOID;
      case 'n': return TT.CANOPY;
      case 'a': return TT.ASH;
      case 'O': {
        const i = k % this._EW, j = (k - i) / this._EW;
        for (const [dx, dy] of DIRS) {
          const nc = this._ch[(j + dy) * this._EW + i + dx];
          if (nc === 'g') return TT.GOLD;
          if (nc === 'S' || nc === 'D') return TT.SAND;
          if (nc === 'R') return TT.RUINS;
          if (nc === 'B') return TT.COBBLE;
        }
        return TT.FLOOR;
      }
      default: return TT.GRASS;
    }
  }

  _outsideCell(x, y, d) {
    const W = this.width, H = this.height, s = this._seed;
    const ex = clamp(x, 0, W - 1), ey = clamp(y, 0, H - 1);
    const e = terrainChar(this.mapDef, ex, ey) || '.';
    const el = this.heights[ey][ex];
    const front = x >= W || y >= H;
    const n1 = vnoise(x * 0.23, y * 0.23, s + 1), n2 = vnoise(x * 0.61, y * 0.61, s + 2), n3 = vnoise(x * 0.11, y * 0.11, s + 3);
    const r = hash2(x, y, s + 4);
    const border = this.border;
    if (e === '~') return ['~', 0];
    if (e === ',' || e === '=' || e === 'G' || e === 'V') {
      if (border === 'water' ? d <= 1 : border !== 'castle' || d <= 3) return [border === 'water' ? 'S' : ',', border === 'castle' ? el : Math.max(1, el)];
    }
    if (e === 'L' && d <= 3 + Math.floor(n2 * 3)) return ['L', 0];
    if (e === 'X') return d <= 2 + Math.floor(n2 * 2) ? ['X', -2] : ['K', 1];
    if (border === 'castle') {
      const ring = front ? 1 : 2;
      if (e === '#' && d <= ring) return ['#', el];
      if (e !== '#' && d <= 2) return [GROUND_OF[e] ?? e, el];
      if (d <= ring + 1) return ['K', 1];
      return [n2 > 0.55 ? (n1 > 0.5 ? 'F' : 'P') : n2 < 0.2 ? '"' : '.', -3];
    }
    if (e === '#' && d === 1 && r < 0.6) return ['#', Math.max(2, el - 2)];
    if (border !== 'water' && d <= 2 && r < (d === 1 ? 0.8 : 0.45)) {
      const g = GROUND_OF[e] ?? e;
      if (g !== '#') return [g, g === 'M' || g === 'K' ? el + d : el];
    }
    switch (border) {
      case 'hills': {
        const rise = Math.max(0, d - (front ? 3 : 1)) * 0.26 + n3 * 2.4 + n1 * 0.6 - 1.0;
        const lvl = 1 + clamp(Math.floor(rise), 0, 4);
        if (lvl >= 4) return ['M', lvl];
        if (lvl >= 2) return [n2 > 0.72 ? 'F' : 'H', lvl];
        return [n2 > 0.8 ? 'F' : n2 < 0.15 ? 'Y' : n2 > 0.55 && n2 < 0.63 ? '"' : '.', lvl];
      }
      case 'mountains': {
        const rise = Math.max(0, d - (front ? 3 : 1)) * 0.55 + n1 * 3.2 + n3 * 1.5 - 1.6;
        const lvl = 1 + clamp(Math.floor(rise), 0, 10);
        if (lvl >= 3) return ['M', lvl];
        if (lvl === 2) return [n2 > 0.68 ? 'P' : 'H', lvl];
        return [n2 > 0.72 ? 'P' : '.', lvl];
      }
      case 'desert': {
        if (d >= 6 && n3 > 0.6) return ['K', 3 + Math.floor((n3 - 0.6) * 12)];
        if (n2 > 0.9 && d > 1) return ['R', 1];
        return n1 > 0.56 ? ['D', 2] : ['S', 1];
      }
      case 'water': {
        const land = e !== '~' && e !== '=';
        if (land && d <= 1 + (n2 > 0.55 ? 1 : 0)) return ['S', 1];
        if (d >= 5 && n3 > 0.7) return n2 > 0.45 ? ['S', 1] : ['K', 2];
        return ['~', 0];
      }
      case 'lava': {
        if (Math.abs(n1 - 0.5) < 0.06 && d > 1) return ['L', 0];
        if (d >= 5 && n3 > 0.58) return ['K', 3 + Math.floor((n3 - 0.58) * 14)];
        return ['a', 1 + (n2 > 0.72 ? 1 : 0)];
      }
      default: {
        if (d >= this.Q.canopy + Math.floor(n2 * 2)) return ['n', 1 + (n3 > 0.55 ? 1 : 0)];
        if (n1 + d * 0.08 > 0.56) return [r < (this.paletteName === 'autumn' ? 0.25 : 0.4) ? 'P' : 'F', 1 + (d > 3 && n3 > 0.6 ? 1 : 0)];
        return [n2 > 0.72 ? 'Y' : n2 < 0.18 ? '"' : '.', 1];
      }
    }
  }

  // ----------------------------------------------------------------------------------------- decoration
  _decorate() {
    const W = this.width, H = this.height, M = MARGIN, EW = this._EW, EH = this._EH;
    const b = new GeoBuilder({ emit: true });
    const cloth = new GeoBuilder({ sway: true, size: 1 << 13 });
    const rng = mulberry32(this._seed + 77);
    const pal = this.pal;
    this._fx = [];
    this._lightCands = [];
    this._posts = [];
    this._veg = { trunk: [], blob: [], pine: [], tuft: [], flower: [], rock: [] };
    const ctx = {
      b, cloth, rng, pal, night: this.env.night, golden: this.paletteName === 'golden', ashen: this.paletteName === 'ashen',
      runeColor: pal.rune, chests: [], doors: [], sails: [], out: 0,
      fx: (x, y, z, size, kind, color, intensity) => {
        const p = b.w(x, y, z);
        const day = kind === 1 ? 0.25 + 0.75 * Math.max(this.env.night, 0.1) : kind === 0 ? 0.7 + 0.3 * this.env.night : 1;
        this._fx.push({ x: p.x, y: p.y, z: p.z, size, kind, color, intensity: intensity * day * (1 - ctx.out * 0.5) });
        return this._fx.length - 1;
      },
      light: (x, y, z, color, prio) => { if (ctx.out === 0) this._lightCands.push({ p: b.w(x, y, z), color, prio }); },
      vegTree: (kind, lx, lz, s) => { const p = b.w(lx, 0, lz); this._tree(kind, p.x, p.y, p.z, s, ctx.out, rng); },
      vegRock: (lx, lz, size, ry) => { const p = b.w(lx, 0, lz); this._rock(p.x, p.y - size * 0.25, p.z, size, size * 0.8, size, ry, ctx.out, rng); },
    };
    this._ctx = ctx;
    const begin = (x, y, ry = 0, yy = this._topAt(x, y), out = 0) => {
      const m = L(x + 0.5, yy, y + 0.5, 1, 1, 1, 0, ry, 0);
      b.reset(m); cloth.reset(m);
      ctx.out = out;
      b.desat = cloth.desat = out * this.U.uOutside.value.x;
      b.dim = cloth.dim = 1 - out * this.U.uOutside.value.y;
    };
    this._begin = begin;
    let bannerIdx = 0;

    for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) {
      const k = j * EW + i, c = this._ch[k], x = i - M, y = j - M;
      const out = this._out[k], d = this._dd[k], top = this._top[k];
      if (d >= M - 1) continue;
      const inside = d === 0;
      const nb = DIRS.map(([dx, dy]) => this._chAt(x + dx, y + dy));
      const r = rng();
      switch (c) {
        case '#': {
          const exposed = {};
          DIRS.forEach(([dx, dy], q) => { exposed[DIR_KEYS[q]] = nb[q] !== '#' && this._topAt(x + dx, y + dy) < top - 0.01; });
          begin(x, y, 0, top, out);
          wallTop(ctx, exposed, pal.wall);
          if (inside) {
            DIRS.forEach(([dx, dy], q) => {
              const n = nb[q];
              const ins = x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H;
              if (!exposed[DIR_KEYS[q]] || !ins || !n || '#hOX~L'.includes(n)) return;
              if ((x * 7 + y * 3 + q) % 4 !== 0) return;
              begin(x, y, FACE_RY[q], top, 0);
              hangBanner(ctx, 0, -0.2, 0.515, 0.34, 0.66, pal.banner[bannerIdx++ % pal.banner.length], 0xe6b445, 0.03);
            });
          }
          break;
        }
        case 'G': {
          const alongX = nb[0] === '#' || nb[1] === '#';
          const alongZ = nb[2] === '#' || nb[3] === '#';
          const ry = !alongX && alongZ ? Math.PI / 2 : 0;
          let wt = 0;
          DIRS.forEach(([dx, dy], q) => { if (nb[q] === '#') wt = Math.max(wt, this._topAt(x + dx, y + dy)); });
          if (!wt) wt = 4 * H_UNIT;
          begin(x, y, ry, top, out);
          gate(ctx, Math.max(0.9, wt - top), pal.banner[0]);
          break;
        }
        case 'h': {
          let q = nb.indexOf('V');
          if (q < 0) {
            const pref = [2, 0, 1, 3];
            q = pref.find((p) => nb[p] && TERRAIN[nb[p]] && Number.isFinite(TERRAIN[nb[p]].cost.foot) && nb[p] !== 'V') ?? 2;
          }
          begin(x, y, FACE_RY[q], top, out);
          const seed = Math.floor(hash2(x, y, this._seed) * 1000);
          const v = {
            plaster: pal.plasters[seed % pal.plasters.length], roof: pal.roofs[(seed >> 2) % pal.roofs.length],
            timber: 0x5a3a24, shutter: [0x3f6a8a, 0x6a8a3f, 0x8a3f3f, 0x4a5a7a][(seed >> 4) % 4], seed,
          };
          const hasV = nb[q] === 'V';
          const doorM = house(ctx, v, hasV);
          const vx = x + DIRS[q][0], vy = y + DIRS[q][1];
          const glow = hasV && ctx.night > 0.2 ? ctx.fx(-0.14, 0.25, 0.42, 0.6, 1, 0xffa860, 0.45 * ctx.night) : -1;
          ctx.doors.push({ m: b.top.clone().multiply(doorM), key: hasV ? `${vx},${vy}` : null, open: hasV, glow });
          break;
        }
        case 'V': {
          const q = nb.indexOf('h');
          begin(x, y, q >= 0 ? FACE_RY[q] + Math.PI : 0, top, out);
          if (q >= 0) doorstep(ctx, Math.floor(hash2(x, y, 9) * 100));
          else PROPS.signpost(ctx, {});
          break;
        }
        case 'W': {
          const open = {};
          DIRS.forEach((_, q) => { const n = nb[q]; open[DIR_KEYS[q]] = !!n && !!TERRAIN[n] && Number.isFinite(TERRAIN[n].cost.foot); });
          begin(x, y, 0, top, out);
          fort(ctx, open, pal.flag);
          break;
        }
        case 'T': {
          let q = [3, 1, 0, 2].find((p) => !nb[p] || nb[p] === '#' || !(x + DIRS[p][0] >= 0 && y + DIRS[p][1] >= 0 && x + DIRS[p][0] < W && y + DIRS[p][1] < H));
          if (q === undefined) q = 3;
          begin(x, y, FACE_RY[q] + Math.PI, top, out);
          throne(ctx, ctx.golden, pal.banner[0]);
          break;
        }
        case 'O': begin(x, y, 0, top, out); pillar(ctx, ctx.golden); break;
        case 'A': begin(x, y, 0, top, out); altarDeco(ctx, pal.rune); break;
        case 'R':
          begin(x, y, 0, top, out);
          ruins(ctx, ctx.golden);
          if (r < 0.5) this._tufts(x, y, top, 2, out, rng, true);
          break;
        case '=': {
          const deck = inside ? this.tileTop(x, y) : H_UNIT;
          const land = (n) => n && n !== '~';
          const alongX = land(nb[0]) || land(nb[1]) || !(land(nb[2]) || land(nb[3]));
          begin(x, y, alongX ? 0 : Math.PI / 2, deck, out);
          const ends = [];
          if (alongX ? land(nb[0]) && nb[0] !== '=' : land(nb[3]) && nb[3] !== '=') ends.push(0.5);
          if (alongX ? land(nb[1]) && nb[1] !== '=' : land(nb[2]) && nb[2] !== '=') ends.push(-0.5);
          const posts = (alongX ? nb[0] : nb[3]) === '=' ? [-0.42] : [-0.42, 0.42];
          bridge(ctx, [-0.45, 0.45], deck - top, ends, posts);
          for (const px of posts) for (const pz of [-0.45, 0.45]) { const p = b.w(px, 0, pz); this._posts.push([p.x, p.z]); }
          break;
        }
        case 'F': case 'P': this._forestCell(c, x, y, top, out, d, rng); break;
        case 'Y': {
          if (this.paletteName === 'desert') { this._desertCell(x, y, top, out, rng, 0.5); break; }
          const n = 2 + Math.floor(rng() * 2);
          for (let t = 0; t < n; t++) {
            const a = (t / n) * Math.PI * 2 + rng(), rr = 0.22 + rng() * 0.12;
            this._bush(x + 0.5 + Math.cos(a) * rr, top, y + 0.5 + Math.sin(a) * rr, 0.8 + rng() * 0.45, out, rng);
          }
          this._tufts(x, y, top, 3, out, rng);
          if (rng() < 0.6) this._flowers(x, y, top, 3, out, rng);
          break;
        }
        case '.': case '"': case 'H': {
          if (d > 4) break;
          const dens = d === 0 ? this.Q.tuft : this.Q.tuft * this.Q.outTuft;
          this._tufts(x, y, top, Math.round(dens * (c === 'H' ? 0.7 : 1)), out, rng);
          if (c === '"') this._flowers(x, y, top, Math.round(4 * this.Q.flower), out, rng);
          else if (r < 0.25 * this.Q.flower) this._flowers(x, y, top, 1 + Math.floor(rng() * 2), out, rng);
          if (c === 'H' && rng() < 0.45) this._rock(x + 0.2 + rng() * 0.6, top - 0.03, y + 0.2 + rng() * 0.6, 0.08 + rng() * 0.08, 0.06 + rng() * 0.06, 0.08 + rng() * 0.07, rng() * 6, out, rng);
          if (c === '.' && d > 1 && rng() < 0.05) this._tree('broad', x + 0.5, top, y + 0.5, 0.9 + rng() * 0.3, out, rng);
          break;
        }
        case 'M': case 'K': this._rockyCell(c, x, y, top, out, d, rng); break;
        case 'n': {
          if (d > 9 || !nb.some((n) => n && n !== 'n')) break;
          const cnt = 1 + (rng() < 0.5 ? 1 : 0);
          for (let t = 0; t < cnt; t++) {
            const s = 0.42 + rng() * 0.22;
            const col = desat(pal.leaves[Math.floor(rng() * pal.leaves.length)], out);
            this._inst(this._veg.blob, x + 0.2 + rng() * 0.6, top - 0.06, y + 0.2 + rng() * 0.6, s, s * 0.8, s, rng() * 6, col, rng() * 6, 0.02, top - 1.2, 0, out);
          }
          break;
        }
        case 'S': case 'D': this._desertCell(x, y, top, out, rng, d === 0 ? 1 : 0.6); break;
        case 'a':
          if (rng() < 0.1) this._rock(x + 0.2 + rng() * 0.6, top - 0.04, y + 0.2 + rng() * 0.6, 0.1 + rng() * 0.1, 0.08 + rng() * 0.08, 0.1 + rng() * 0.1, rng() * 6, out, rng);
          else if (rng() < 0.04 && d < 7) { begin(x, y, rng() * 6, top, out); deadTree(ctx, 0.9, 0x3e3532); }
          break;
        case 'L':
          if (this.env.night > 0.3 && d <= 4 && (x * 5 + y * 3) % 3 === 0) { begin(x, y, 0, top, out); ctx.fx(0, 0.2, 0, 1.3, 1, 0xff5a1a, 0.16); }
          break;
        case 'X':
          if (inside) { begin(x, y, 0, -1.6, 0); for (let t = 0; t < 2; t++) ctx.fx(rng() - 0.5, rng() * 0.6, rng() - 0.5, 0.09, 2, this.pal.voidGlow, 1.4); }
          break;
        default: break;
      }
    }

    if (this.border === 'castle') {
      const spots = [[-1, -1, 1.25], [W, -1, 0.95], [-1, H, 0.95]];
      for (let x = 6; x < W - 3; x += 7) spots.push([x, -1, 0.8]);
      for (let y = 6; y < H - 3; y += 7) spots.push([-1, y, 0.8]);
      for (const [tx, ty, h] of spots) {
        if (this._chAt(tx, ty) !== '#') continue;
        begin(tx, ty, 0, this._topAt(tx, ty), this._out[this._idx(tx, ty)]);
        tower(ctx, h, 0x4f5f8a, pal.banner[0]);
      }
    }

    for (const p of this.mapDef.props || []) {
      const fn = PROPS[p.type];
      if (!fn || p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
      begin(p.x, p.y, ((p.rot || 0) % 4) * (Math.PI / 2), this.tileTop(p.x, p.y), 0);
      const before = ctx.chests.length;
      fn(ctx, p);
      if (ctx.chests.length > before) {
        const glow = ctx.fx(0, 0.3, 0.04, 0.55, 1, 0xffcf5a, 0);
        this._chests.set(`${p.x},${p.y}`, { m: ctx.chests[ctx.chests.length - 1], angle: 0, open: false, glow, idx: ctx.chests.length - 1 });
      }
    }
    this._staticB = b;
    this._clothB = cloth;
  }

  _forestCell(c, x, y, top, out, d, rng) {
    const inside = d === 0;
    const n = inside ? 1 + Math.floor(rng() * 2.6) : 1 + Math.floor(rng() * 1.7);
    const a0 = rng() * Math.PI * 2;
    const desertP = this.paletteName === 'desert' || this.paletteName === 'golden';
    for (let t = 0; t < n; t++) {
      const a = a0 + (t / n) * Math.PI * 2 + (rng() - 0.5) * 0.6;
      const rr = n === 1 ? 0.12 + rng() * 0.16 : 0.26 + rng() * 0.08;
      const px = x + 0.5 + Math.cos(a) * rr, pz = y + 0.5 + Math.sin(a) * rr;
      const s = (inside ? 0.82 : 1.0) + rng() * 0.3;
      if (c === 'F' && desertP) { this._begin(x, y, 0, top, out); this._ctx.b.reset(L(px, top, pz)); palm(this._ctx, s * 0.95); }
      else if (c === 'F' && this.paletteName === 'ashen') { this._begin(x, y, 0, top, out); this._ctx.b.reset(L(px, top, pz, 1, 1, 1, 0, rng() * 6, 0)); deadTree(this._ctx, s, 0x3e3532); }
      else this._tree(c === 'P' ? 'pine' : 'broad', px, top, pz, s, out, rng);
    }
    if (inside || d < 3) this._tufts(x, y, top, 2, out, rng);
  }

  _rockyCell(c, x, y, top, out, d, rng) {
    const crag = c === 'K', inside = d === 0;
    const n = crag ? (inside ? 2 + Math.floor(rng() * 2) : rng() < 0.35 ? 1 : 0) : (inside ? 2 : 1) + Math.floor(rng() * 2);
    for (let t = 0; t < n; t++) {
      const a = rng() * Math.PI * 2;
      const rr = crag && inside ? 0.1 + rng() * 0.22 : 0.28 + rng() * 0.14;
      const px = x + 0.5 + Math.cos(a) * rr, pz = y + 0.5 + Math.sin(a) * rr;
      const w = crag && inside ? 0.3 + rng() * 0.22 : inside ? 0.16 + rng() * 0.12 : 0.18 + rng() * 0.2;
      const h = crag && inside ? 0.5 + rng() * 0.9 : inside ? 0.3 + rng() * 0.45 : 0.35 + rng() * 0.6;
      this._rock(px, top - h * 0.25, pz, w, h, w * (0.8 + rng() * 0.4), rng() * 6, out, rng);
    }
    if (!crag && inside && rng() < 0.6) this._tufts(x, y, top, 2, out, rng);
    if (!crag && d > 0 && d < 5 && rng() < 0.25 && top < 2.5 && this.paletteName !== 'ashen' && this.paletteName !== 'desert' && this.paletteName !== 'golden') {
      this._tree('pine', x + 0.3 + rng() * 0.4, top, y + 0.3 + rng() * 0.4, 0.8 + rng() * 0.3, out, rng);
    }
  }

  _desertCell(x, y, top, out, rng, k) {
    const r = rng();
    if (r < 0.12 * k) this._tufts(x, y, top, 2 + Math.floor(rng() * 3), out, rng, true);
    else if (r < 0.2 * k) this._rock(x + 0.2 + rng() * 0.6, top - 0.03, y + 0.2 + rng() * 0.6, 0.08 + rng() * 0.1, 0.06 + rng() * 0.08, 0.08 + rng() * 0.1, rng() * 6, out, rng);
    else if (r < 0.225 * k && out < 0.9) { this._begin(x, y, rng() * 6, top, out); PROPS.bones(this._ctx, {}); }
    else if (r < 0.24 * k) { this._begin(x, y, rng() * 6, top, out); deadTree(this._ctx, 0.8, 0x7a6a58); }
    const nearWater = DIRS.some(([dx, dy]) => this._chAt(x + dx, y + dy) === '~');
    if (nearWater && rng() < 0.3) { this._begin(x, y, 0, top, out); this._ctx.b.reset(L(x + 0.3 + rng() * 0.4, top, y + 0.3 + rng() * 0.4)); palm(this._ctx, 0.9 + rng() * 0.2); }
  }

  // ----------------------------------------------------------------------------------------- vegetation records
  _inst(list, x, y, z, sx, sy, sz, ry, color, phase, sway, ground, fade, out = 0) {
    list.push(x, y, z, sx, sy, sz, ry, color.r, color.g, color.b, phase, sway, ground, fade, out < 0.6 ? 1 : 0);
  }
  _tree(kind, x, y, z, s, out, rng) {
    const V = this._veg, pal = this.pal;
    const ph = rng() * Math.PI * 2;
    if (kind === 'pine') {
      this._inst(V.trunk, x, y, z, 0.06 * s, 0.42 * s, 0.06 * s, rng() * 6, desat(pal.trunk, out), ph, 0.004, y, 0, out);
      const pc = desat(pal.pine[Math.floor(rng() * pal.pine.length)], out);
      this._inst(V.pine, x, y + 0.26 * s, z, 0.42 * s, 1.12 * s, 0.42 * s, rng() * 6, pc, ph, 0.028, y, 1, out);
      return;
    }
    const th = 0.92 * s;
    this._inst(V.trunk, x, y, z, 0.065 * s, th, 0.065 * s, rng() * 6, desat(pal.trunk, out), ph, 0.006, y, 0, out);
    const base = pal.leaves[Math.floor(rng() * pal.leaves.length)];
    const main = 0.4 * s;
    this._inst(V.blob, x, y + th + 0.28 * s, z, main, main * 0.86, main, rng() * 6, desat(base, out), ph, 0.032, y, 1, out);
    const n = out > 0 ? 1 : 1 + Math.floor(rng() * 3);
    for (let t = 0; t < n; t++) {
      const a = rng() * Math.PI * 2, rr = (0.2 + rng() * 0.08) * s;
      const sz = (0.22 + rng() * 0.1) * s;
      const hy = th + (0.08 + rng() * 0.42) * s;
      _col.setHex(base).offsetHSL((rng() - 0.5) * 0.03, 0, hy > th + 0.3 * s ? 0.05 : -0.03);
      this._inst(V.blob, x + Math.cos(a) * rr, y + hy, z + Math.sin(a) * rr, sz, sz * 0.88, sz, rng() * 6, desat(_col.getHex(), out), ph, 0.032, y, 1, out);
    }
  }
  _bush(x, y, z, s, out, rng) {
    const base = this.pal.bush[Math.floor(rng() * this.pal.bush.length)];
    const ph = rng() * 6;
    const n = 2 + Math.floor(rng() * 2);
    for (let t = 0; t < n; t++) {
      const sz = (0.15 + rng() * 0.08) * s;
      const a = rng() * Math.PI * 2;
      this._inst(this._veg.blob, x + Math.cos(a) * 0.09 * s, y + sz * 0.6 + t * 0.03, z + Math.sin(a) * 0.09 * s, sz, sz * 0.82, sz, rng() * 6, desat(base, out), ph, 0.25, y, 0, out);
    }
  }
  _rock(x, y, z, sx, sy, sz, ry, out, rng) {
    const c = this.pal.rock[Math.floor(rng() * this.pal.rock.length)];
    this._inst(this._veg.rock, x, y, z, sx, sy, sz, ry, desat(c, out), 0, 0, y, 0, out);
  }
  _tufts(x, y, top, n, out, rng, dry = false) {
    const pal = this.pal;
    for (let t = 0; t < n; t++) {
      const c = dry ? tint(pal.tuft[Math.floor(rng() * pal.tuft.length)], -0.05) : pal.tuft[Math.floor(rng() * pal.tuft.length)];
      const cc = desat(c, out);
      if (dry) cc.lerp(_col.setHex(pal.sandB), 0.35);
      const s = 0.62 + rng() * 0.42;
      this._inst(this._veg.tuft, x + 0.06 + rng() * 0.88, top, y + 0.06 + rng() * 0.88, s, s * (0.7 + rng() * 0.4), s, rng() * 6, cc, rng() * 6, 3.2, top, 0);
    }
  }
  _flowers(x, y, top, n, out, rng) {
    const fl = this.pal.flowers;
    for (let t = 0; t < n; t++) {
      const s = 0.8 + rng() * 0.5;
      this._inst(this._veg.flower, x + 0.08 + rng() * 0.84, top, y + 0.08 + rng() * 0.84, s, s, s, rng() * 6, desat(fl[Math.floor(rng() * fl.length)], out), rng() * 6, 2.6, top, 0);
    }
  }

  // ----------------------------------------------------------------------------------------- shore field
  _buildShore() {
    const R = 8, EW = this._EW, EH = this._EH;
    let i0 = EW, i1 = -1, j0 = EH, j1 = -1;
    for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) {
      if (!this._isWater(j * EW + i)) continue;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    if (i1 < 0) {
      const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      this._shoreTex = tex;
      this._shoreXf = new THREE.Vector4(0, 0, 0, 0);
      this._dispose.push(tex);
      return;
    }
    const PAD = 6;
    i0 = Math.max(0, i0 - PAD); j0 = Math.max(0, j0 - PAD); i1 = Math.min(EW - 1, i1 + PAD); j1 = Math.min(EH - 1, j1 + PAD);
    const CW = i1 - i0 + 1, CH = j1 - j0 + 1, TW = CW * R, TH = CH * R;
    const g = new Float32Array(TW * TH);
    for (let ty = 0; ty < TH; ty++) {
      const row = (j0 + ((ty / R) | 0)) * EW + i0;
      for (let tx = 0; tx < TW; tx++) g[ty * TW + tx] = this._isWater(row + ((tx / R) | 0)) ? 1e20 : 0;
    }
    const ox = i0 - MARGIN, oz = j0 - MARGIN;
    const rad = 0.075 * R;
    for (const [px, pz] of this._posts) {
      const cx = (px - ox) * R, cz = (pz - oz) * R;
      for (let ty = Math.floor(cz - rad); ty <= Math.ceil(cz + rad); ty++) {
        for (let tx = Math.floor(cx - rad); tx <= Math.ceil(cx + rad); tx++) {
          if (tx < 0 || ty < 0 || tx >= TW || ty >= TH) continue;
          if ((tx + 0.5 - cx) ** 2 + (ty + 0.5 - cz) ** 2 <= rad * rad) g[ty * TW + tx] = 0;
        }
      }
    }
    edt2d(g, TW, TH);
    const data = new Uint8Array(TW * TH * 4);
    for (let i = 0; i < TW * TH; i++) {
      const dist = Math.max(0, Math.sqrt(g[i]) - 0.5) / R;
      data[i * 4] = Math.min(255, dist * 255);
      data[i * 4 + 1] = Math.min(255, (dist / 5) * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this._shoreTex = tex;
    this._shoreXf = new THREE.Vector4(ox, oz, 1 / CW, 1 / CH);
    this._dispose.push(tex);
  }

  // ----------------------------------------------------------------------------------------- terrain mesh
  _buildTerrain() {
    const EW = this._EW, EH = this._EH, M = MARGIN;
    let sand = 0, grass = 0;
    for (const row of this.mapDef.tiles) for (const ch of row) { if ('SDR'.includes(ch)) sand++; else if ('."HFPY'.includes(ch)) grass++; }
    this._roadSand = sand > grass;
    const GRASSY = new Set([TT.GRASS, TT.MEADOW, TT.FOREST, TT.HILL]);
    if (!this._roadSand) GRASSY.add(TT.ROAD);
    const P = new Grow(Float32Array, 1 << 16), Nn = new Grow(Float32Array, 1 << 16);
    const A = new Grow(Float32Array, 1 << 16), B = new Grow(Float32Array, 1 << 16), I = new Grow(Uint32Array, 1 << 16);
    const NORM = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    const ta = [0, 0, 0, 0], tb = [0, 0, 0, 0];
    let nv = 0;
    const quad = (v, n) => {
      const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2], wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
      const flip = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2] < 0;
      P.need(12); Nn.need(12); A.need(16); B.need(16); I.need(6);
      for (let c = 0; c < 4; c++) {
        P.a[P.n++] = v[c * 3]; P.a[P.n++] = v[c * 3 + 1]; P.a[P.n++] = v[c * 3 + 2];
        Nn.a[Nn.n++] = n[0]; Nn.a[Nn.n++] = n[1]; Nn.a[Nn.n++] = n[2];
        A.a[A.n++] = ta[0]; A.a[A.n++] = ta[1]; A.a[A.n++] = ta[2]; A.a[A.n++] = ta[3];
        B.a[B.n++] = tb[0]; B.a[B.n++] = tb[1]; B.a[B.n++] = tb[2]; B.a[B.n++] = tb[3];
      }
      const ia = I.a;
      if (flip) { ia[I.n++] = nv; ia[I.n++] = nv + 2; ia[I.n++] = nv + 1; ia[I.n++] = nv; ia[I.n++] = nv + 3; ia[I.n++] = nv + 2; }
      else { ia[I.n++] = nv; ia[I.n++] = nv + 1; ia[I.n++] = nv + 2; ia[I.n++] = nv; ia[I.n++] = nv + 2; ia[I.n++] = nv + 3; }
      nv += 4;
    };
    const topQ = (x0, x1, z0, z1, y) => quad([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], [0, 1, 0]);
    const vface = (d, c, a0, a1, y0, y1) => {
      if (y1 - y0 < 1e-4 || a1 - a0 < 1e-5) return;
      if (d < 2) quad([c, y0, a0, c, y0, a1, c, y1, a1, c, y1, a0], NORM[d]);
      else quad([a0, y0, c, a1, y0, c, a1, y1, c, a0, y1, c], NORM[d]);
    };
    const lipAt = (x2, y2, q, t) => {
      const k2 = this._idx(x2, y2);
      if (k2 < 0 || !GRASSY.has(this._type[k2]) || Math.abs(this._top[k2] - t) > 1e-3) return false;
      return t - this._topAt(x2 + DIRS[q][0], y2 + DIRS[q][1]) > LIP_H + 0.01;
    };
    const nt = [0, 0, 0, 0], nc = [null, null, null, null], nk = [0, 0, 0, 0], inGrid = [true, true, true, true];
    const skirtY = this._skirtY;
    for (let j = 0; j < EH; j++) for (let i = 0; i < EW; i++) {
      const k = j * EW + i, x = i - M, y = j - M;
      const t = this._top[k], type = this._type[k], out = this._out[k];
      let drop = 0, rise = 0, same = 0;
      for (let q = 0; q < 4; q++) {
        const kk = this._idx(x + DIRS[q][0], y + DIRS[q][1]);
        nk[q] = kk;
        inGrid[q] = kk >= 0;
        nt[q] = kk < 0 ? skirtY : this._top[kk];
        nc[q] = kk < 0 ? null : this._ch[kk];
        if (nt[q] < t - 1e-3) drop |= 1 << q;
        else if (nt[q] > t + 1e-3 || nc[q] === 'h' || nc[q] === 'O') rise |= 1 << q;
        if ((type === TT.ROAD && ROADISH.has(nc[q])) || (type === TT.CARPET && CARPETISH.has(nc[q]))) same |= 1 << q;
      }
      const grassy = GRASSY.has(type);
      const lips = [0, 1, 2, 3].map((q) => (grassy && (drop >> q & 1) && t - nt[q] > LIP_H + 0.01 ? LIP : 0));
      const [lE, lW, lS, lN] = lips;
      ta[0] = type; ta[1] = t; ta[2] = t; ta[3] = out;
      tb[0] = x; tb[1] = y; tb[2] = drop | (rise << 4) | (same << 8); tb[3] = 0;
      topQ(x - lW, x + 1 + lE, y - lN, y + 1 + lS, t);
      for (let q = 0; q < 4; q++) {
        const plane = q === 0 ? x + 1 : q === 1 ? x : q === 2 ? y + 1 : y;
        const sgn = q === 0 || q === 2 ? 1 : -1;
        const a0 = q < 2 ? y : x, a1 = a0 + 1;
        if (!inGrid[q] && nt[q] > t + 1e-3) {
          ta[0] = this._skirtType; ta[1] = nt[q]; ta[2] = t; ta[3] = 1; tb[2] = 0; tb[3] = 0;
          vface(q ^ 1, plane, a0, a1, t, nt[q]);
          continue;
        }
        if (!(drop >> q & 1)) continue;
        ta[0] = type; ta[1] = t; ta[2] = nt[q]; ta[3] = out;
        tb[2] = 0; tb[3] = nk[q] >= 0 && this._isLava(nk[q]) ? 1 : nc[q] === 'X' ? 2 : 0;
        const l = lips[q];
        if (l > 0) {
          const b0 = q < 2 ? y - lN : x - lW, b1 = q < 2 ? y + 1 + lS : x + 1 + lE;
          const op = plane + sgn * l;
          vface(q, op, b0, b1, t - LIP_H, t);
          vface(q, plane, a0, a1, nt[q], t - LIP_H);
          const [lowQ, highQ] = q < 2 ? [3, 2] : [1, 0];
          const lowLip = q < 2 ? lN : lW, highLip = q < 2 ? lS : lE;
          const s0 = Math.min(plane, op), s1 = Math.max(plane, op);
          ta[2] = t - LIP_H;
          if (!highLip && !lipAt(x + DIRS[highQ][0], y + DIRS[highQ][1], q, t)) vface(highQ, a1, s0, s1, t - LIP_H, t);
          if (!lowLip && !lipAt(x + DIRS[lowQ][0], y + DIRS[lowQ][1], q, t)) vface(lowQ, a0, s0, s1, t - LIP_H, t);
        } else {
          vface(q, plane, a0, a1, nt[q], t);
        }
      }
    }
    const X0 = -M, X1 = this.width + M, Z0 = -M, Z1 = this.height + M, E = 160;
    ta[0] = this._skirtType; ta[1] = skirtY; ta[2] = skirtY; ta[3] = 1;
    tb[0] = 0; tb[1] = 0; tb[2] = 0; tb[3] = 0;
    topQ(X0 - E, X1 + E, Z0 - E, Z0, skirtY);
    topQ(X0 - E, X1 + E, Z1, Z1 + E, skirtY);
    topQ(X0 - E, X0, Z0, Z1, skirtY);
    topQ(X1, X1 + E, Z0, Z1, skirtY);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Nn.view(), 3));
    g.setAttribute('aTA', new THREE.BufferAttribute(A.view(), 4));
    g.setAttribute('aTB', new THREE.BufferAttribute(B.view(), 4));
    const iv = I.view();
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? iv : Uint16Array.from(iv), 1));
    g.computeBoundingSphere();
    const mat = terrainMaterial(this.U, PAL_SLOTS.map((key) => new THREE.Color(this.pal[key])), this._shoreTex, this._shoreXf, { roadSand: this._roadSand });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'terrain';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.terrain = mesh;
    this._dispose.push(g, mat);
  }

  // ----------------------------------------------------------------------------------------- water
  _buildWater() {
    const EW = this._EW, EH = this._EH, M = MARGIN, y = WATER_Y;
    const P = [], I = [];
    const quad = (x0, x1, z0, z1) => {
      const n = P.length / 3;
      P.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      I.push(n, n + 2, n + 1, n, n + 3, n + 2);
    };
    for (let j = 0; j < EH; j++) {
      let run = -1;
      for (let i = 0; i <= EW; i++) {
        const w = i < EW && this._isWater(j * EW + i);
        if (w && run < 0) run = i;
        if (!w && run >= 0) { quad(run - M, i - M, j - M, j - M + 1); run = -1; }
      }
    }
    if (this.border === 'water') {
      const X0 = -M, X1 = this.width + M, Z0 = -M, Z1 = this.height + M, E = 160;
      quad(X0 - E, X1 + E, Z0 - E, Z0); quad(X0 - E, X1 + E, Z1, Z1 + E); quad(X0 - E, X0, Z0, Z1); quad(X1, X1 + E, Z0, Z1);
    }
    if (!P.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    const nrm = new Float32Array(P.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(I);
    const mat = waterMaterial(this.U, this._shoreTex, this._shoreXf, { ...this.pal.water, sky: this.env.sky });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'water';
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.water = mesh;
    this._dispose.push(g, mat);
  }

  // ----------------------------------------------------------------------------------------- merged props / cloth / animated parts
  _buildStatic() {
    const ctx = this._ctx;
    const outlineMat = outlineMaterial({ color: OUTLINE, width: 1.6 });
    if (!this._staticB.empty) {
      const { geometry, outline } = this._staticB.build();
      const mat = propMaterial(this.U);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = 'props';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const om = new THREE.Mesh(outline, outlineMat);
      om.userData.isOutline = true;
      om.raycast = () => {};
      mesh.add(om);
      this.group.add(mesh);
      this._dispose.push(geometry, outline, mat);
    }
    if (!this._clothB.empty) {
      const { geometry, outline } = this._clothB.build();
      const mat = clothMaterial(this.U);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = 'cloth';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = clothDepthMaterial(this.U);
      const om = new THREE.Mesh(outline, animatedOutlineMaterial(this.U, 'cloth', { color: OUTLINE, width: 1.3 }));
      om.userData.isOutline = true;
      om.raycast = () => {};
      mesh.add(om);
      this.group.add(mesh);
      this._dispose.push(geometry, outline, mat, mesh.customDepthMaterial, om.material);
    }
    if (ctx.chests.length) {
      const { geometry, outline } = chestLidGeometry();
      const mat = toonMaterial({ vertexColors: true, rim: 0.8, name: 'ew-lids' });
      const n = ctx.chests.length;
      const lids = new THREE.InstancedMesh(geometry, mat, n);
      lids.name = 'chestLids';
      lids.castShadow = true;
      lids.receiveShadow = true;
      const om = new THREE.InstancedMesh(outline, outlineMat, n);
      om.instanceMatrix = lids.instanceMatrix;
      om.userData.isOutline = true;
      om.raycast = () => {};
      lids.add(om);
      this.group.add(lids);
      this._lids = lids;
      ctx.chests.forEach((m, i) => {
        const rec = [...this._chests.values()].find((r) => r.idx === i);
        const base = m.clone().multiply(L(0, 0.2, -0.15));
        if (rec) rec.base = base;
        lids.setMatrixAt(i, base);
      });
      this._dispose.push(geometry, outline, mat);
    }
    if (ctx.doors.length) {
      const { geometry } = doorGeometry();
      const mat = toonMaterial({ vertexColors: true, rim: 0.6, name: 'ew-doors' });
      const doors = new THREE.InstancedMesh(geometry, mat, ctx.doors.length);
      doors.name = 'doors';
      doors.castShadow = true;
      doors.receiveShadow = true;
      this.group.add(doors);
      this._doorMesh = doors;
      ctx.doors.forEach((d, i) => {
        const rec = { base: d.m, angle: d.open ? DOOR_OPEN : 0, idx: i, glow: d.glow, visited: false };
        if (d.key) this._doors.set(d.key, rec);
        this._applyDoor(rec);
      });
      this._dispose.push(geometry, mat);
    }
    for (const s of ctx.sails) {
      const mat = toonMaterial({ vertexColors: true, rim: 0.6, name: 'ew-sails' });
      const mesh = new THREE.Mesh(s.build.geometry, mat);
      mesh.castShadow = true;
      const om = new THREE.Mesh(s.build.outline, outlineMat);
      om.userData.isOutline = true;
      om.raycast = () => {};
      mesh.add(om);
      const pivot = new THREE.Group();
      pivot.matrixAutoUpdate = false;
      pivot.matrix.copy(s.m);
      pivot.matrixWorldNeedsUpdate = true;
      pivot.add(mesh);
      this.group.add(pivot);
      this._sails.push(mesh);
      this._dispose.push(s.build.geometry, s.build.outline, mat);
    }
  }

  _applyLid(rec) {
    if (!this._lids || !rec.base) return;
    _m4.copy(rec.base).multiply(_m4b.makeRotationX(rec.angle));
    this._lids.setMatrixAt(rec.idx, _m4);
    this._lids.instanceMatrix.needsUpdate = true;
  }
  _applyDoor(rec) {
    _m4.copy(rec.base).multiply(_m4b.makeRotationY(rec.angle));
    this._doorMesh.setMatrixAt(rec.idx, _m4);
    this._doorMesh.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------------------------------------- instanced vegetation
  _buildInstances() {
    const kit = vegetationKit();
    this._kit = kit;
    const U = this.U, Q = this.Q;
    const shared = {
      blob: vegMaterial(U),
      trunk: vegMaterial(U, { rim: 0.4 }),
      pine: vegMaterial(U),
      grass: vegMaterial(U, { doubleSide: true, flatUp: true, rim: 0 }),
      rock: vegMaterial(U, { snow: true, rim: 0.5 }),
    };
    const depth = vegDepthMaterial(U);
    const vegOutline = animatedOutlineMaterial(U, 'veg', { color: OUTLINE, width: 1.5 });
    this._dispose.push(...Object.values(shared), depth, vegOutline);
    const spec = [
      ['trunk', kit.trunk, shared.trunk, true, true],
      ['blob', kit.blob, shared.blob, true, true],
      ['pine', kit.pine, shared.pine, true, true],
      ['rock', kit.rock, shared.rock, true, true],
      ['tuft', kit.tuft, shared.grass, false, false],
      ['flower', kit.flower, shared.grass, false, false],
    ];
    this._vegMeshes = {};
    const STRIDE = 15;
    for (const [name, part, mat, outline, shadow] of spec) {
      const list = this._veg[name];
      const n = list.length / STRIDE;
      this._dispose.push(part.geometry, part.outline);
      if (!n) continue;
      const geo = part.geometry;
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => list[b * STRIDE + 14] - list[a * STRIDE + 14]);
      let casters = 0;
      const mats = new Float32Array(n * 16), cols = new Float32Array(n * 3), veg = new Float32Array(n * 4);
      order.forEach((src, i) => {
        const o = src * STRIDE;
        if (list[o + 14] > 0) casters++;
        _v3.set(list[o], list[o + 1], list[o + 2]);
        _q4.setFromAxisAngle(_Y, list[o + 6]);
        _s3.set(list[o + 3], list[o + 4], list[o + 5]);
        _m4.compose(_v3, _q4, _s3).toArray(mats, i * 16);
        cols[i * 3] = list[o + 7]; cols[i * 3 + 1] = list[o + 8]; cols[i * 3 + 2] = list[o + 9];
        veg[i * 4] = list[o + 10]; veg[i * 4 + 1] = list[o + 11]; veg[i * 4 + 2] = list[o + 12]; veg[i * 4 + 3] = list[o + 13];
      });
      const vegAttr = new THREE.InstancedBufferAttribute(veg, 4);
      geo.setAttribute('aVeg', vegAttr);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = `veg:${name}`;
      mesh.instanceMatrix.array.set(mats);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      mesh.castShadow = shadow && Q.vegShadow && casters > 0;
      mesh.receiveShadow = true;
      if (mesh.castShadow) {
        mesh.customDepthMaterial = depth;
        mesh.userData.shadowCount = casters;
        mesh.onBeforeShadow = () => { mesh.count = casters; };
        mesh.onAfterShadow = () => { mesh.count = n; };
      }
      if (outline && Q.vegOutline) {
        part.outline.setAttribute('aVeg', vegAttr);
        part.outline.setAttribute('aTintW', geo.attributes.aTintW);
        const om = new THREE.InstancedMesh(part.outline, vegOutline, n);
        om.instanceMatrix = mesh.instanceMatrix;
        om.userData.isOutline = true;
        om.raycast = () => {};
        mesh.add(om);
      }
      this.group.add(mesh);
      this._vegMeshes[name] = mesh;
    }
  }

  // ----------------------------------------------------------------------------------------- flames, glows, motes
  _buildFx() {
    const list = this._fx;
    if (!list.length) return;
    const n = list.length;
    const pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), f = new Float32Array(n * 16), col = new Float32Array(n * 12);
    const idx = new Uint32Array(n * 6);
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < n; i++) {
      const s = list[i];
      _col.set(s.color);
      const ph = hash2(i, 7, this._seed);
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        pos[v * 3] = s.x; pos[v * 3 + 1] = s.y; pos[v * 3 + 2] = s.z;
        cor[v * 2] = C[c][0]; cor[v * 2 + 1] = C[c][1];
        f[v * 4] = s.size; f[v * 4 + 1] = ph; f[v * 4 + 2] = s.kind; f[v * 4 + 3] = s.intensity;
        col[v * 3] = _col.r; col[v * 3 + 1] = _col.g; col[v * 3 + 2] = _col.b;
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
    g.setAttribute('aF', new THREE.BufferAttribute(f, 4));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(n * 4 > 65535 ? idx : Uint16Array.from(idx), 1));
    const mat = fxMaterial(this.U);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'fx';
    mesh.renderOrder = 10;
    this.group.add(mesh);
    this._fxMesh = mesh;
    this._dispose.push(g, mat);
  }

  _setFx(i, intensity) {
    if (!this._fxMesh || i < 0) return;
    const a = this._fxMesh.geometry.attributes.aF;
    for (let c = 0; c < 4; c++) a.array[(i * 4 + c) * 4 + 3] = intensity;
    a.needsUpdate = true;
  }

  _buildLights() {
    const max = this.Q.lights;
    if (!max) return;
    const cands = this._lightCands.slice().sort((a, b) => b.prio - a.prio);
    const chosen = [];
    for (const c of cands) {
      if (chosen.length >= max) break;
      if (chosen.some((o) => o.p.distanceTo(c.p) < 3.5)) continue;
      chosen.push(c);
    }
    const lava = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (terrainChar(this.mapDef, x, y) === 'L') lava.push([x, y]);
    if (lava.length && chosen.length >= max) chosen.pop();
    if (lava.length && chosen.length < max) {
      let sx = 0, sy = 0;
      for (const [x, y] of lava) { sx += x; sy += y; }
      chosen.push({ p: new THREE.Vector3(sx / lava.length + 0.5, 0.9, sy / lava.length + 0.5), color: 0xff6a2a, prio: 2, lava: true });
    }
    const k = this.env.light;
    chosen.forEach((c, i) => {
      const base = (c.lava ? 4.5 : 2.6) * k;
      const l = new THREE.PointLight(c.color, base, c.lava ? 9 : 6, 1.6);
      l.position.copy(c.p);
      l.castShadow = false;
      l.userData.base = base;
      l.userData.ph = i * 1.7;
      this.group.add(l);
      this._lights.push(l);
    });
  }

  _countStats() {
    let draws = 0, tris = 0;
    this.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = o.geometry;
      const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      draws += 1;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    return { meshes: draws, triangles: Math.round(tris), lights: this._lights.length };
  }

  // ----------------------------------------------------------------------------------------- public API
  /** World Y of the walkable surface of tile (x, y) (bridges = deck top, water/lava = liquid surface). */
  tileTop(x, y) {
    const cx = clamp(Math.floor(x), 0, this.width - 1), cy = clamp(Math.floor(y), 0, this.height - 1);
    return surfaceY(this.mapDef, this.heights, cx, cy);
  }

  /** Centre of the tile's walkable surface. */
  tileCenter(x, y, target = new THREE.Vector3()) {
    return target.set(x + 0.5, this.tileTop(x, y), y + 0.5);
  }

  /** Tile hit by the ray (tops, sides, water and bridges; decorations ignored) or null. */
  pick(raycaster) {
    this.group.updateWorldMatrix(true, false);
    _inv.copy(this.group.matrixWorld).invert();
    const ray = _ray.copy(raycaster.ray).applyMatrix4(_inv);
    const o = ray.origin, d = ray.direction, W = this.width, H = this.height;
    let t0 = 0, t1 = Infinity;
    if (Math.abs(d.x) < 1e-12) { if (o.x < 0 || o.x > W) return null; } else {
      let a = -o.x / d.x, b = (W - o.x) / d.x;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (Math.abs(d.z) < 1e-12) { if (o.z < 0 || o.z > H) return null; } else {
      let a = -o.z / d.z, b = (H - o.z) / d.z;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t0 > t1) return null;
    let cx = clamp(Math.floor(o.x + d.x * (t0 + 1e-7)), 0, W - 1);
    let cz = clamp(Math.floor(o.z + d.z * (t0 + 1e-7)), 0, H - 1);
    const sx = Math.sign(d.x), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tmx = sx > 0 ? (cx + 1 - o.x) / d.x : sx < 0 ? (cx - o.x) / d.x : Infinity;
    let tmz = sz > 0 ? (cz + 1 - o.z) / d.z : sz < 0 ? (cz - o.z) / d.z : Infinity;
    let t = t0;
    for (let guard = 0; guard < W + H + 4; guard++) {
      const top = this._pickTop[cz * W + cx];
      const tExit = Math.min(tmx, tmz, t1);
      if (o.y + d.y * t <= top + 1e-6 || o.y + d.y * tExit <= top) return { x: cx, y: cz };
      if (tExit >= t1) break;
      if (tmx < tmz) { cx += sx; t = tmx; tmx += tdx; } else { cz += sz; t = tmz; tmz += tdz; }
      if (cx < 0 || cz < 0 || cx >= W || cz >= H) break;
    }
    return null;
  }

  /**
   * Animate water, wind, cloth, flames, lava, lights and pending chest/door animations.
   * @param {number} dt seconds since last frame
   * @param {number} elapsed seconds since start (drives all shader time)
   * @param {THREE.Camera} [camera] unused; accepted for API symmetry with other gfx modules
   */
  update(dt, elapsed, camera) {
    this.U.uTime.value = elapsed;
    const fade = this.U.uFade.value;
    fade.w += (this._fadeTarget - fade.w) * Math.min(1, dt * 7);
    if (fade.w < 0.002 && this._fadeTarget === 0) fade.w = 0;
    for (const l of this._lights) {
      const ph = l.userData.ph;
      l.intensity = l.userData.base * (0.86 + 0.1 * Math.sin(elapsed * 9.1 + ph) * Math.sin(elapsed * 5.3 + ph * 2.0) + 0.06 * Math.sin(elapsed * 17 + ph));
    }
    for (const s of this._sails) s.rotation.z = -elapsed * 0.7;
    if (this._anims.length) {
      this._anims = this._anims.filter((a) => {
        a.t += dt;
        const p = Math.min(1, a.t / a.dur);
        a.fn(p);
        if (p >= 1) { a.done && a.done(); return false; }
        return true;
      });
    }
  }

  /** True if a chest prop stands on the tile. */
  hasChest(x, y) { return this._chests.has(`${x},${y}`); }

  /** Opens a chest with a little jiggle and a springy lid; resolves when the lid settles. */
  openChest(x, y) {
    const rec = this._chests.get(`${x},${y}`);
    if (!rec) return Promise.resolve(false);
    if (rec.open) return Promise.resolve(true);
    rec.open = true;
    return new Promise((resolve) => {
      this._anims.push({
        t: 0, dur: 0.95,
        fn: (p) => {
          if (p < 0.2) {
            const q = p / 0.2;
            rec.angle = Math.sin(q * Math.PI * 4) * 0.07 * (1 - q) - 0.04 * Math.sin(q * Math.PI);
            this._setFx(rec.glow, 0);
          } else {
            const q = (p - 0.2) / 0.8;
            rec.angle = LID_OPEN * easeOutBack(q, 2.4);
            this._setFx(rec.glow, q < 0.25 ? (q / 0.25) * 1.3 : 1.3 - smooth((q - 0.25) / 0.75) * 1.0);
          }
          this._applyLid(rec);
        },
        done: () => resolve(true),
      });
    });
  }

  /** Immediately sets a chest lid open/closed (e.g. when restoring a save). */
  setChestOpen(x, y, open) {
    const rec = this._chests.get(`${x},${y}`);
    if (!rec) return;
    rec.open = !!open;
    rec.angle = open ? LID_OPEN : 0;
    this._setFx(rec.glow, open ? 0.3 : 0);
    this._applyLid(rec);
  }

  /** Marks a village as visited: its door swings shut and the doorway glow fades. */
  setVillageVisited(x, y) {
    const rec = this._doors.get(`${x},${y}`);
    if (!rec || rec.visited) return;
    rec.visited = true;
    const a0 = rec.angle;
    this._anims.push({
      t: 0, dur: 0.6,
      fn: (p) => {
        rec.angle = a0 * (1 - easeOutBack(p, 1.2));
        this._setFx(rec.glow, 0.45 * this.env.night * (1 - p));
        this._applyDoor(rec);
      },
    });
  }

  /** Fades/shrinks canopies within `radius` tiles of (x, y) so units stay visible. (-1, -1, 0) resets. */
  setFoliageFade(x, y, radius) {
    const f = this.U.uFade.value;
    if (radius > 0 && x >= 0 && y >= 0) {
      if (f.w < 0.01) f.set(x + 0.5, y + 0.5, radius, f.w);
      else { f.x = x + 0.5; f.y = y + 0.5; f.z = radius; }
      this._fadeTarget = 1;
    } else {
      this._fadeTarget = 0;
    }
  }

  /** Frees GPU resources and detaches the group. */
  dispose() {
    for (const d of this._dispose) d.dispose();
    this._dispose.length = 0;
    for (const l of this._lights) l.dispose();
    this._lights.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
