/**
 * Emberwing Knights — battle & map visual effects.
 *
 * - Pooled, CPU-simulated GPU particles: two InstancedBufferGeometry draw calls (blended + additive),
 *   camera-facing quads with optional velocity stretch, one procedural texture atlas.
 * - Shader meshes for light/fire pillars, shockwave rings, domes, slash crescents, rune circles,
 *   portals and wings of light; ribbon lightning/tendrils; instanced cel-shaded ice crystals;
 *   canvas damage numbers.
 * - Everything runs on an internal clock advanced by update(dt), so a given seed + dt sequence
 *   always produces the same frame.
 */
import * as THREE from 'three';
import { addOutline, toonMaterial } from './toon.js';
import {
  CELLS, ATLAS_COLS, ATLAS_ROWS, mulberry32,
  createParticleAtlas, createRuneCircleTexture, createWingTexture,
} from './vfx-textures.js';
import {
  particleMaterial, pillarMaterial, ringMaterial, domeMaterial, slashMaterial, slashGeometry,
  circleMaterial, portalMaterial, ribbonMaterial, crystalMaterial, crystalGeometry, billboardMaterial,
} from './vfx-shaders.js';

// ------------------------------------------------------------------ particle record layout
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, S0 = 8, S1 = 9;
const R0 = 10, G0 = 11, B0 = 12, R1 = 13, G1 = 14, B1 = 15, ALPHA = 16, RAMP = 17, GRAV = 18, DRAG = 19;
const ROT = 20, SPIN = 21, STRETCH = 22, CELL = 23, FIN = 24, FOUT = 25, TWINK = 26, PHASE = 27;
const SWIRL = 28, CX = 29, CZ = 30, ATTR = 31, AX = 32, AY = 33, AZ = 34, KILL = 35, FOLLOW = 36;
const WOB = 37, WOBF = 38, FLOOR = 39, BOUNCE = 40, RADV = 41, SMODE = 42, LOCK = 43;
const STRIDE = 44;

const MAX_SLOTS = 64;
const MAX_SEG = 2400;
const TEXT_W = 512, TEXT_H = 160;
const FLASH_K = 0.15; // global scale for the impact PointLight (candela, physically based lighting)

const C = CELLS;

/** Effect palette (sRGB hex). */
export const VFX_COLORS = Object.freeze({
  fire: 0xff7426, fireHot: 0xffd27a, smoke: 0x2b2421,
  ice: 0x7fd8ff, iceDeep: 0x2f86e8, iceCore: 0xe8fbff,
  holy: 0xffcf62, holyCore: 0xfff6dc,
  elec: 0x7fb0ff, elecCore: 0xe6f3ff,
  dark: 0xa64dff, darkDeep: 0x4b0f8f, darkCore: 0xf0c8ff, black: 0x0a0010,
  heal: 0x6fef8f, healGold: 0xffe48a, healCore: 0xf2ffe6,
  blood: 0xff2f62, bloodDeep: 0x8a0a35,
});
const COL = VFX_COLORS;

// colour-over-life ramps: [t, sRGB hex, HDR intensity]
const RAMP_DEFS = {
  fire: [[0, 0xfff4d6, 2.7], [0.1, 0xffd36b, 2.3], [0.26, 0xff9a3a, 1.5], [0.42, 0xc8683c, 0.75], [0.58, 0x5a4a42, 0.3], [1, 0x2a2624, 0.1]],
  dfire: [[0, 0xf6e6ff, 3.0], [0.18, 0xd08cff, 2.4], [0.42, 0x9a3cf0, 1.7], [0.7, 0x4a0e9a, 0.8], [1, 0x12001e, 0]],
  holy: [[0, 0xffffff, 3.2], [0.25, 0xfff2bf, 2.4], [0.6, 0xffcf5a, 1.4], [1, 0x8a5a1a, 0]],
  ice: [[0, 0xffffff, 2.8], [0.25, 0xd2f6ff, 2.0], [0.6, 0x74c8ff, 1.2], [1, 0x1f56b0, 0]],
  elec: [[0, 0xffffff, 3.6], [0.2, 0xcfe9ff, 2.7], [0.55, 0x77a5ff, 1.6], [1, 0x2a35b0, 0]],
  heal: [[0, 0xffffff, 2.8], [0.25, 0xeaffc0, 2.1], [0.6, 0x84f59a, 1.3], [1, 0x1d8f5a, 0]],
  blood: [[0, 0xffe0ea, 2.8], [0.3, 0xff5c8a, 2.0], [0.7, 0xb0124a, 0.9], [1, 0x30000e, 0]],
};
const LUT_N = 64;
const RAMP_ID = {};
const RAMP_LUT = new Float32Array(Object.keys(RAMP_DEFS).length * LUT_N * 3);
{
  const c = new THREE.Color();
  let id = 0;
  for (const [name, stops] of Object.entries(RAMP_DEFS)) {
    RAMP_ID[name] = id;
    const cols = stops.map(([t, hex, k]) => { c.set(hex); return [t, c.r * k, c.g * k, c.b * k]; });
    for (let i = 0; i < LUT_N; i++) {
      const t = i / (LUT_N - 1);
      let j = 0;
      while (j < cols.length - 2 && t > cols[j + 1][0]) j++;
      const a = cols[j], b = cols[j + 1];
      const f = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0] || 1)));
      const o = (id * LUT_N + i) * 3;
      RAMP_LUT[o] = a[1] + (b[1] - a[1]) * f;
      RAMP_LUT[o + 1] = a[2] + (b[2] - a[2]) * f;
      RAMP_LUT[o + 2] = a[3] + (b[3] - a[3]) * f;
    }
    id++;
  }
}

const KIND = {
  fire: { color: COL.fire, core: COL.fireHot, ramp: 'fire' },
  ice: { color: COL.ice, core: COL.iceCore, ramp: 'ice' },
  holy: { color: COL.holy, core: COL.holyCore, ramp: 'holy' },
  elec: { color: COL.elec, core: COL.elecCore, ramp: 'elec' },
  dark: { color: COL.dark, core: COL.darkCore, ramp: 'dfire' },
  heal: { color: COL.heal, core: COL.healCore, ramp: 'heal' },
  blood: { color: COL.blood, core: 0xffd6e0, ramp: 'blood' },
};

const PROJ = {
  arrow: { speed: 16, arc: 0.1 },
  fireball: { speed: 7.5, arc: 0.12 },
  iceShard: { speed: 11, arc: 0.04 },
  darkOrb: { speed: 6.5, arc: 0.07 },
  holyOrb: { speed: 7, arc: 0.08 },
  boltOrb: { speed: 13, arc: 0.02 },
};

const TDEF = Object.freeze({
  cell: 0, life: 0.6, lifeVar: 0.25, size: 0.15, sizeEnd: null, sizeVar: 0.25,
  color: 0xffffff, color2: null, intensity: 1, alpha: 1, ramp: null,
  gravity: 0, drag: 0, rot: 0, rotVar: Math.PI, spin: 0, spinVar: 0, stretch: 0, blend: 1,
  fadeIn: 0.08, fadeOut: 0.5, twinkle: 0, swirl: 0, swirlVar: 0, cx: 0, cz: 0, radialVel: 0,
  attract: 0, target: null, killDist: 0.06, follow: -1, wobble: 0, wobbleFreq: 3,
  floorY: -1e9, bounce: 0.3, sizeMode: 0, lock: 0, delay: 0, delayVar: 0, over: false,
});

// ------------------------------------------------------------------ small math helpers
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
const easeInQuad = (t) => t * t;
const easeOutBack = (t, k = 1.70158) => 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
const fadeEnv = (t, life, fi, fo) => (t < fi ? t / fi : 1) * (t > life - fo ? Math.max(0, (life - t) / fo) : 1);

const _UP = new THREE.Vector3(0, 1, 0);
const _X = new THREE.Vector3(1, 0, 0);
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3(), _e1 = new THREE.Vector3();
const _j1 = new THREE.Vector3(), _j2 = new THREE.Vector3(), _j3 = new THREE.Vector3();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _col = new THREE.Color();

/** Copies {x,y,z} / [x,y,z] / Vector3 into a new (or given) Vector3. */
function v3(p, out = new THREE.Vector3()) {
  if (!p) return out.set(0, 0, 0);
  if (Array.isArray(p)) return out.fromArray(p);
  return out.set(p.x || 0, p.y || 0, p.z || 0);
}

// ------------------------------------------------------------------ particle pool
class ParticlePool {
  constructor(capacity, material, renderOrder) {
    this.cap = capacity;
    this.n = 0;
    this.d = new Float32Array(capacity * STRIDE);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (size) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(4); this.aVel = mk(4); this.aCol = mk(4); this.aDat = mk(2);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iData', this.aDat);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.name = 'vfx-particles';
    this.mesh.raycast = () => {};
  }

  upload() {
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    for (const a of [this.aPos, this.aVel, this.aCol, this.aDat]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ VFX
/**
 * Visual effects manager. Create one per scene and call update(dt, camera) every frame.
 * Positions: "chest" points for combat effects (hitSpark, slash, floatText, projectiles, spell from/to);
 * ground (feet) points for unit/area effects (levelUp, promotion, buff, aura, magicCircle, dust,
 * splash, chestOpen, deathBurst, spell `ground`).
 */
export class VFX {
  /**
   * @param {THREE.Scene|THREE.Object3D} scene
   * @param {{maxParticles?: number, seed?: number, flashLight?: boolean, textLayer?: number}} [opts]
   *   flashLight: keep one PointLight (intensity 0 when idle) for impact flashes (default true).
   *   textLayer: put damage numbers on this camera layer only, so the game can draw them in an
   *   overlay pass after bloom (default: layer 0, i.e. drawn with the scene).
   */
  constructor(scene, opts = {}) {
    const { maxParticles = 6000, seed, flashLight = true } = opts;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'vfx';
    scene.add(this.root);
    this.rand = mulberry32(seed ?? ((Math.random() * 2147483647) | 0));
    this.time = 0;

    this._camPos = new THREE.Vector3(0, 3, 8);
    this._camRight = new THREE.Vector3(1, 0, 0);
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._camera = null;

    this.atlas = createParticleAtlas();
    this.runeTex = createRuneCircleTexture();
    this.wingTex = createWingTexture();
    this._pmat = particleMaterial(this.atlas, ATLAS_COLS, ATLAS_ROWS);
    const normCap = Math.max(256, Math.floor(maxParticles * 0.25));
    const overCap = Math.max(128, Math.floor(maxParticles * 0.08));
    this._norm = new ParticlePool(normCap, this._pmat, 20);
    this._add = new ParticlePool(Math.max(512, maxParticles - normCap - overCap), this._pmat, 40);
    this._over = new ParticlePool(overCap, this._pmat, 44);
    this.root.add(this._norm.mesh, this._add.mesh, this._over.mesh);
    this._textLayer = opts.textLayer ?? null;

    this._tpl = { ...TDEF };
    this._timers = [];
    this._tasks = [];
    this._fx = [];
    this._pending = new Set();
    this._slots = new Float32Array(MAX_SLOTS * 4);
    this._slotFree = [];
    this._resetSlots();

    this._geo = {
      pillar: new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0),
      cone: new THREE.CylinderGeometry(1, 0.05, 1, 40, 1, true).translate(0, 0.5, 0),
      flat: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      hemi: new THREE.SphereGeometry(1, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      sphere: new THREE.SphereGeometry(1, 40, 24),
      slash: slashGeometry(),
      quad: new THREE.PlaneGeometry(1, 1),
    };
    this._freeMesh = {};

    // instanced ice crystals (+ outline hull sharing the instance matrices)
    this._crystals = [];
    this._cMax = 96;
    const cg = crystalGeometry(mulberry32(99));
    this._cFlash = new THREE.InstancedBufferAttribute(new Float32Array(this._cMax), 1).setUsage(THREE.DynamicDrawUsage);
    cg.setAttribute('iFlash', this._cFlash);
    this._cMesh = new THREE.InstancedMesh(cg, crystalMaterial(), this._cMax);
    this._cMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._cMesh.frustumCulled = false;
    this._cMesh.name = 'vfx-crystals';
    this._cMesh.raycast = () => {};
    this._cMesh.userData.noOutline = true;
    this._cOutline = addOutline(this._cMesh, { color: 0x0f2c55, width: 1.6, smoothNormals: true });
    this._cMesh.count = 0;
    this._cOutline.count = 0;
    this._cMesh.visible = false;
    this.root.add(this._cMesh);

    this._bolts = [];
    this._initRibbons();

    this._texts = [];
    this._textFree = [];

    this._arrowFree = [];
    this._arrowsActive = new Set();
    this._arrowParts = null;

    this.light = null;
    if (flashLight) {
      this.light = new THREE.PointLight(0xffffff, 0, 7, 2);
      this.light.castShadow = false;
      this.light.name = 'vfx-flash';
      this.root.add(this.light);
    }
    this._lightT = 0;
    this._lightDur = 0;
    this._lightPeak = 0;
  }

  // ================================================================= frame update
  /**
   * Advance all effects. Billboards always face the rendering camera; `camera` is also used for
   * slash orientation and damage-number minimum screen size.
   * @param {number} dt seconds (clamped to 0.1)
   * @param {THREE.Camera} [camera]
   */
  update(dt, camera) {
    dt = Math.min(Math.max(+dt || 0, 0), 0.1);
    if (camera) {
      this._camera = camera;
      camera.updateMatrixWorld();
      camera.getWorldPosition(this._camPos);
      this._camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      this._camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    }
    this.time += dt;

    const tm = this._timers;
    while (tm.length && tm[0].t <= this.time + 1e-9) {
      const fn = tm.shift().fn;
      try { fn(); } catch (e) { console.error('[vfx] timer failed', e); }
    }

    const tasks = this._tasks;
    for (let i = 0; i < tasks.length; i++) {
      let keep = false;
      try { keep = tasks[i](dt) !== false; } catch (e) { console.error('[vfx] task failed', e); }
      if (!keep) { tasks.splice(i, 1); i--; }
    }

    const fx = this._fx;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      f.t += dt;
      if (f.tick(f, f.t, dt) === false || f.t >= f.dur) { this._release(f); fx.splice(i, 1); i--; }
    }

    this._updateCrystals();
    this._simulate(this._norm, dt);
    this._simulate(this._add, dt);
    this._simulate(this._over, dt);
    this._updateBolts(dt);
    this._updateTexts(dt);
    this._updateLight(dt);
  }

  /** Live particle / object counts (debug). */
  stats() {
    return {
      particles: this._norm.n + this._add.n + this._over.n, blended: this._norm.n, additive: this._add.n, over: this._over.n,
      meshes: this._fx.length, bolts: this._bolts.length, crystals: this._crystals.length,
      texts: this._texts.length, tasks: this._tasks.length, timers: this._timers.length,
    };
  }

  /**
   * Optional: compiles every VFX shader up front so the first spell doesn't hitch.
   * Call once after the scene's lights are set up.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   */
  precompile(renderer, camera) {
    const types = ['pillar', 'cone', 'ring', 'dome', 'sphere', 'slash', 'circle', 'portal', 'wing'];
    const meshes = types.map((t) => [t, this._acquire(t)]);
    const always = [this._norm.mesh, this._add.mesh, this._over.mesh, this._cMesh, this._rMesh].map((m) => [m, m.visible]);
    for (const [m] of always) m.visible = true;
    const text = this._textAcquire();
    text.sprite.visible = true;
    const arrow = this._arrowAcquire();
    try {
      renderer.compile(this.root, camera, this.scene);
    } catch (err) {
      console.warn('[vfx] precompile failed', err);
    }
    for (const [t, m] of meshes) { m.visible = false; this._freeMesh[t].push(m); }
    for (const [m, v] of always) m.visible = v;
    text.sprite.visible = false;
    this._textFree.push(text);
    this._arrowRelease(arrow);
  }

  /** Stops everything immediately. Pending promises resolve and pending onImpact callbacks fire once. */
  clear() {
    this._timers.length = 0;
    this._tasks.length = 0;
    for (const f of this._fx) this._release(f);
    this._fx.length = 0;
    this._norm.n = 0; this._norm.upload();
    this._add.n = 0; this._add.upload();
    this._over.n = 0; this._over.upload();
    this._crystals.length = 0;
    this._updateCrystals();
    this._bolts.length = 0;
    this._updateBolts(0);
    for (const e of this._texts) { e.sprite.visible = false; this._textFree.push(e); }
    this._texts.length = 0;
    for (const a of [...this._arrowsActive]) this._arrowRelease(a);
    this._resetSlots();
    if (this.light) this.light.intensity = 0;
    this._lightDur = 0;
    const pend = [...this._pending];
    this._pending.clear();
    for (const c of pend) c.finish();
  }

  /** Removes everything from the scene and frees GPU resources. */
  dispose() {
    this.clear();
    this.root.removeFromParent();
    const mats = new Set(), geos = new Set();
    this.root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    });
    for (const g of Object.values(this._geo)) geos.add(g);
    for (const e of this._textFree) e.tex.dispose();
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
    this.atlas.dispose(); this.runeTex.dispose(); this.wingTex.dispose();
    this._freeMesh = {};
    this._textFree.length = 0;
  }

  // ================================================================= scheduling
  _after(delay, fn) {
    const t = this.time + Math.max(0, delay || 0);
    const tm = this._timers;
    let lo = 0, hi = tm.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tm[mid].t <= t) lo = mid + 1; else hi = mid; }
    tm.splice(lo, 0, { t, fn });
  }

  _task(fn) { this._tasks.push(fn); }

  /** Emitter task running `fn(t, dt)` every frame for `dur` seconds (starting after `delay`). */
  _emitFor(delay, dur, fn) {
    this._after(delay, () => {
      let t = 0;
      this._task((dt) => {
        t += dt;
        fn(Math.min(t, dur), dt);
        return t < dur;
      });
    });
  }

  _ctx(onImpact) {
    let resolveFn;
    const promise = new Promise((r) => { resolveFn = r; });
    const ctx = {
      promise, impacted: false, done: false,
      impact: () => {
        if (ctx.impacted) return;
        ctx.impacted = true;
        if (typeof onImpact === 'function') {
          try { onImpact(); } catch (e) { console.error('[vfx] onImpact failed', e); }
        }
      },
      finish: () => {
        if (ctx.done) return;
        ctx.done = true;
        ctx.impact();
        this._pending.delete(ctx);
        resolveFn();
      },
    };
    this._pending.add(ctx);
    return ctx;
  }

  _resetSlots() {
    this._slots.fill(0);
    this._slotFree.length = 0;
    for (let i = MAX_SLOTS - 1; i >= 0; i--) this._slotFree.push(i);
  }

  _slotAlloc(p) {
    const i = this._slotFree.pop();
    if (i === undefined) return -1;
    this._slotSet(i, p);
    this._slots[i * 4 + 3] = 1;
    return i;
  }

  _slotSet(i, p) {
    if (i < 0) return;
    const s = this._slots;
    s[i * 4] = p.x; s[i * 4 + 1] = p.y; s[i * 4 + 2] = p.z;
  }

  _slotRelease(i) {
    if (i < 0) return;
    this._slots[i * 4 + 3] = 0;
    this._after(0.05, () => this._slotFree.push(i));
  }

  // ================================================================= particles
  /** Resets the shared spawn template to defaults + overrides and precomputes colours. */
  _T(o) {
    const T = this._tpl;
    Object.assign(T, TDEF, o);
    const k = T.intensity;
    _col.set(T.color);
    T.r0 = _col.r * k; T.g0 = _col.g * k; T.b0 = _col.b * k;
    if (T.color2 !== null && T.color2 !== undefined) _col.set(T.color2);
    T.r1 = _col.r * k; T.g1 = _col.g * k; T.b1 = _col.b * k;
    T.rampId = T.ramp ? (RAMP_ID[T.ramp] ?? -1) : -1;
    T.s0 = T.size;
    T.s1 = T.sizeEnd === null || T.sizeEnd === undefined ? T.size : T.sizeEnd;
    if (T.target) { T.ax = T.target.x; T.ay = T.target.y; T.az = T.target.z; } else { T.ax = T.ay = T.az = 0; }
    return T;
  }

  _emit(T, x, y, z, vx = 0, vy = 0, vz = 0) {
    const pool = T.over ? this._over : T.blend >= 1 ? this._add : this._norm;
    if (pool.n >= pool.cap) return;
    const R = this.rand, d = pool.d, o = pool.n * STRIDE;
    pool.n++;
    const sj = 1 + (R() * 2 - 1) * T.sizeVar;
    d[o + PX] = x; d[o + PY] = y; d[o + PZ] = z;
    d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + AGE] = -(T.delay + R() * T.delayVar);
    d[o + LIFE] = Math.max(0.02, T.life * (1 + (R() * 2 - 1) * T.lifeVar));
    d[o + S0] = T.s0 * sj; d[o + S1] = T.s1 * sj;
    d[o + R0] = T.r0; d[o + G0] = T.g0; d[o + B0] = T.b0;
    d[o + R1] = T.r1; d[o + G1] = T.g1; d[o + B1] = T.b1;
    d[o + ALPHA] = T.alpha; d[o + RAMP] = T.rampId;
    d[o + GRAV] = -T.gravity; d[o + DRAG] = T.drag;
    d[o + ROT] = T.rot + (R() * 2 - 1) * T.rotVar;
    d[o + SPIN] = (T.spin + (R() * 2 - 1) * T.spinVar) * (R() < 0.5 ? -1 : 1);
    d[o + STRETCH] = T.stretch;
    d[o + CELL] = T.cell + Math.min(Math.max(T.blend, 0), 0.999) * 0.5;
    d[o + FIN] = T.fadeIn; d[o + FOUT] = T.fadeOut;
    d[o + TWINK] = T.twinkle; d[o + PHASE] = R() * 6.2831853;
    d[o + SWIRL] = T.swirl * (1 + (R() * 2 - 1) * T.swirlVar);
    d[o + CX] = T.cx; d[o + CZ] = T.cz; d[o + RADV] = T.radialVel;
    d[o + ATTR] = T.attract; d[o + AX] = T.ax; d[o + AY] = T.ay; d[o + AZ] = T.az; d[o + KILL] = T.killDist;
    d[o + FOLLOW] = T.follow;
    d[o + WOB] = T.wobble; d[o + WOBF] = T.wobbleFreq * (0.7 + 0.6 * R());
    d[o + FLOOR] = T.floorY; d[o + BOUNCE] = T.bounce;
    d[o + SMODE] = T.sizeMode; d[o + LOCK] = T.lock;
  }

  _simulate(pool, dt) {
    const d = pool.d, slots = this._slots, lut = RAMP_LUT;
    const P = pool.aPos.array, V = pool.aVel.array, Cc = pool.aCol.array, D = pool.aDat.array;
    const inv = dt > 0 ? 1 / dt : 0;
    let n = pool.n, i = 0;
    while (i < n) {
      const o = i * STRIDE;
      const age = d[o + AGE] + dt;
      const life = d[o + LIFE];
      const fol = d[o + FOLLOW];
      let dead = age >= life || (fol >= 0 && slots[fol * 4 + 3] === 0);
      let px = d[o + PX], py = d[o + PY], pz = d[o + PZ];
      let ex = 0, ey = 0, ez = 0;
      const locked = d[o + LOCK] !== 0;
      if (!dead && age >= 0 && !locked) {
        let vx = d[o + VX], vy = d[o + VY], vz = d[o + VZ];
        const ox = px, oy = py, oz = pz;
        vy += d[o + GRAV] * dt;
        const drag = d[o + DRAG];
        if (drag > 0) { const k = Math.exp(-drag * dt); vx *= k; vy *= k; vz *= k; }
        const att = d[o + ATTR];
        if (att !== 0) {
          const dx = d[o + AX] - px, dy = d[o + AY] - py, dz = d[o + AZ] - pz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < d[o + KILL]) dead = true;
          else { const k = (att * dt) / dist; vx += dx * k; vy += dy * k; vz += dz * k; }
        }
        px += vx * dt; py += vy * dt; pz += vz * dt;
        const wob = d[o + WOB];
        if (wob !== 0) {
          const ph = age * d[o + WOBF] + d[o + PHASE];
          px += Math.cos(ph) * wob * dt;
          pz += Math.sin(ph * 0.83) * wob * dt;
        }
        const sw = d[o + SWIRL];
        if (sw !== 0) {
          const cx = d[o + CX], cz = d[o + CZ];
          const rx = px - cx, rz = pz - cz;
          const a = sw * dt, ca = Math.cos(a), sa = Math.sin(a);
          let nx = rx * ca - rz * sa, nz = rx * sa + rz * ca;
          const rv = d[o + RADV];
          if (rv !== 0) {
            const r = Math.sqrt(nx * nx + nz * nz) + 1e-6;
            const k = Math.max(0, r + rv * dt) / r;
            nx *= k; nz *= k;
          }
          px = cx + nx; pz = cz + nz;
        }
        if (py < d[o + FLOOR]) {
          py = d[o + FLOOR];
          vy = -vy * d[o + BOUNCE];
          vx *= 0.55; vz *= 0.55;
          d[o + SPIN] *= 0.6;
        }
        d[o + PX] = px; d[o + PY] = py; d[o + PZ] = pz;
        d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
        ex = (px - ox) * inv; ey = (py - oy) * inv; ez = (pz - oz) * inv;
      } else if (locked) {
        ex = d[o + VX]; ey = d[o + VY]; ez = d[o + VZ];
      }
      if (dead) {
        n--;
        if (i !== n) d.copyWithin(o, n * STRIDE, n * STRIDE + STRIDE);
        continue;
      }
      d[o + AGE] = age;
      if (fol >= 0) { px += slots[fol * 4]; py += slots[fol * 4 + 1]; pz += slots[fol * 4 + 2]; }
      const w = i * 4, w2 = i * 2;
      if (age < 0) {
        P[w] = px; P[w + 1] = py; P[w + 2] = pz; P[w + 3] = 0;
        V[w + 3] = 0; Cc[w + 3] = 0; D[w2] = 0; D[w2 + 1] = d[o + CELL];
        i++;
        continue;
      }
      const t = age / life;
      const rot = d[o + ROT] + d[o + SPIN] * dt;
      d[o + ROT] = rot;
      const s0 = d[o + S0], s1 = d[o + S1], sm = d[o + SMODE];
      let size;
      if (sm === 0) size = s0 + (s1 - s0) * (1 - (1 - t) * (1 - t));
      else if (sm === 1) size = s0 + (s1 - s0) * t;
      else if (sm === 2) size = s0 + (s1 - s0) * (1 - (1 - t) ** 4);
      else size = s0 + (s1 - s0) * Math.sin(Math.PI * Math.min(1, t * 1.15));
      let a = d[o + ALPHA];
      const fi = d[o + FIN];
      if (fi > 0 && t < fi) a *= t / fi;
      const fo = d[o + FOUT];
      if (fo > 0 && t > 1 - fo) a *= (1 - t) / fo;
      const tw = d[o + TWINK];
      if (tw > 0) a *= 0.55 + 0.45 * Math.sin(age * tw + d[o + PHASE]);
      let r, g, b;
      const ramp = d[o + RAMP];
      if (ramp >= 0) {
        const li = (ramp * LUT_N + Math.min(LUT_N - 1, (t * (LUT_N - 1) + 0.5) | 0)) * 3;
        r = lut[li] * d[o + R0]; g = lut[li + 1] * d[o + G0]; b = lut[li + 2] * d[o + B0];
      } else {
        r = d[o + R0] + (d[o + R1] - d[o + R0]) * t;
        g = d[o + G0] + (d[o + G1] - d[o + G0]) * t;
        b = d[o + B0] + (d[o + B1] - d[o + B0]) * t;
      }
      P[w] = px; P[w + 1] = py; P[w + 2] = pz; P[w + 3] = rot;
      V[w] = ex; V[w + 1] = ey; V[w + 2] = ez; V[w + 3] = d[o + STRETCH];
      Cc[w] = r; Cc[w + 1] = g; Cc[w + 2] = b; Cc[w + 3] = a;
      D[w2] = size; D[w2 + 1] = d[o + CELL];
      i++;
    }
    pool.n = n;
    pool.upload();
  }

  /** Random unit vector within `spread` (0..1 → 0..180° half-angle) of unit `dir`. */
  _cone(out, dir, spread) {
    const R = this.rand;
    const cosMax = Math.cos(clamp01(spread) * Math.PI);
    const cz = 1 - R() * (1 - cosMax);
    const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
    const ph = R() * Math.PI * 2;
    _b1.crossVectors(dir, Math.abs(dir.y) < 0.9 ? _UP : _X).normalize();
    _b2.crossVectors(dir, _b1);
    return out.copy(dir).multiplyScalar(cz).addScaledVector(_b1, Math.cos(ph) * sz).addScaledVector(_b2, Math.sin(ph) * sz);
  }

  /** Emits `n` particles from p with speeds in [sp0, sp1] inside a cone. */
  _spray(T, p, n, dir, spread, sp0, sp1, jitter = 0) {
    const R = this.rand;
    for (let i = 0; i < n; i++) {
      this._cone(_e1, dir, spread);
      const sp = sp0 + (sp1 - sp0) * R();
      this._emit(T,
        p.x + (R() * 2 - 1) * jitter, p.y + (R() * 2 - 1) * jitter, p.z + (R() * 2 - 1) * jitter,
        _e1.x * sp, _e1.y * sp, _e1.z * sp);
    }
  }

  /** Single soft glow that grows fast and fades linearly. */
  _glow(p, color, size0, size1, life, intensity = 2, extra) {
    const T = this._T({ cell: C.glow, blend: 0.75, life, lifeVar: 0, size: size0, sizeEnd: size1, sizeVar: 0, color, intensity, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 });
    if (extra) Object.assign(T, extra);
    this._emit(T, p.x, p.y, p.z);
  }

  _rr(a, b) { return a + (b - a) * this.rand(); }

  /** Moves `p` (in place) toward the camera by `d` so impact effects sit in front of the body they hit. */
  _towardCam(p, d) {
    _s1.subVectors(this._camPos, p);
    const L = _s1.length();
    if (L > 1e-4) p.addScaledVector(_s1, Math.min(d, L * 0.5) / L);
    return p;
  }

  // ================================================================= mesh effects
  _acquire(type) {
    const list = this._freeMesh[type] || (this._freeMesh[type] = []);
    let m = list.pop();
    if (!m) { m = this._makeMesh(type); m.userData.renderOrder = m.renderOrder; this.root.add(m); }
    m.visible = true;
    m.renderOrder = m.userData.renderOrder;
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
    return m;
  }

  _makeMesh(type) {
    const G = this._geo;
    let m;
    switch (type) {
      case 'pillar': m = new THREE.Mesh(G.pillar, pillarMaterial()); m.renderOrder = 30; break;
      case 'cone': m = new THREE.Mesh(G.cone, pillarMaterial()); m.renderOrder = 30; break;
      case 'ring': m = new THREE.Mesh(G.flat, ringMaterial()); m.renderOrder = 12; break;
      case 'dome': m = new THREE.Mesh(G.hemi, domeMaterial()); m.renderOrder = 31; break;
      case 'sphere': m = new THREE.Mesh(G.sphere, domeMaterial()); m.renderOrder = 31; break;
      case 'slash': m = new THREE.Mesh(G.slash, slashMaterial()); m.renderOrder = 42; break;
      case 'circle': m = new THREE.Mesh(G.flat, circleMaterial(this.runeTex)); m.renderOrder = 8; break;
      case 'portal': m = new THREE.Mesh(G.flat, portalMaterial()); m.renderOrder = 9; break;
      case 'wing': m = new THREE.Mesh(G.quad, billboardMaterial(this.wingTex)); m.renderOrder = 36; m.frustumCulled = false; break;
      default: throw new Error(`[vfx] unknown mesh type ${type}`);
    }
    m.name = `vfx-${type}`;
    m.raycast = () => {};
    return m;
  }

  _meshFx(type, dur, tick) {
    const mesh = this._acquire(type);
    const f = { type, mesh, u: mesh.material.uniforms, t: 0, dur, tick, seed: this.rand() * 10 };
    this._fx.push(f);
    return f;
  }

  _release(f) {
    f.mesh.visible = false;
    (this._freeMesh[f.type] || (this._freeMesh[f.type] = [])).push(f.mesh);
  }

  /** Light / fire pillar (or cone when o.cone, oriented along o.dir) standing on `pos`. */
  _pillar(pos, o = {}) {
    const life = o.life ?? 1;
    const fi = o.fadeIn ?? 0.08, fo = o.fadeOut ?? 0.3, rt = o.revealTime ?? 0.12;
    const f = this._meshFx(o.cone ? 'cone' : 'pillar', life, (f, t) => {
      const u = f.u;
      u.uTime.value = t + f.seed;
      u.uAlpha.value = fadeEnv(t, life, fi, fo) * (o.alpha ?? 1);
      const e = easeOutCubic(Math.min(1, t / rt));
      if (o.reveal === 'down') u.uReveal.value.set(1 - e, 1);
      else if (o.reveal === 'none') u.uReveal.value.set(0, 1);
      else u.uReveal.value.set(0, e);
      const r = (o.radius ?? 0.5) * (o.radiusFn ? o.radiusFn(t / life) : 1);
      f.mesh.scale.set(r, o.height ?? 3, r);
    });
    const u = f.u;
    u.uColor.value.set(o.color ?? COL.holy);
    u.uCore.value.set(o.core ?? 0xffffff);
    u.uIntensity.value = o.intensity ?? 2;
    u.uMode.value = o.mode === 'fire' ? 1 : 0;
    u.uSpeed.value = o.speed ?? 1.2;
    u.uBot.value = o.bot ?? 0.06;
    u.uTop.value = o.top ?? 0.5;
    u.uDark.value = o.dark ?? 0.4;
    u.uEdge.value = o.edge ?? 1.6;
    f.mesh.position.copy(pos);
    if (o.dir) f.mesh.quaternion.setFromUnitVectors(_UP, o.dir);
    f.tick(f, 0, 0);
    return f;
  }

  /** Flat ring/glow on the ground (or facing o.normal) expanding r0 → r1. */
  _ring(pos, o = {}) {
    const life = o.life ?? 0.5;
    const r0 = o.r0 ?? 0.2, r1 = o.r1 ?? 1.5;
    const baseY = pos.y + (o.lift ?? 0.03);
    const f = this._meshFx('ring', life, (f, t) => {
      const k = Math.min(1, t / life);
      const e = o.ease === 'linear' ? k : easeOutCubic(k);
      const r = Math.max(0.001, r0 + (r1 - r0) * e);
      f.mesh.scale.set(r, r, r);
      if (o.rise) f.mesh.position.y = baseY + o.rise * (o.riseEase === 'linear' ? k : easeOutQuad(k));
      f.u.uAlpha.value = o.alphaFn ? o.alphaFn(k) : Math.min(1, k / 0.06) * (1 - k) ** (o.fadePow ?? 1.4);
      f.u.uTime.value = t + f.seed;
    });
    const u = f.u;
    u.uColor.value.set(o.color ?? COL.fire);
    u.uCore.value.set(o.core ?? 0xffffff);
    u.uIntensity.value = o.intensity ?? 2;
    u.uWidth.value = o.width ?? 0.3;
    u.uNoise.value = o.noise ?? 0.5;
    u.uFill.value = o.fill ?? 0;
    f.mesh.position.set(pos.x, baseY, pos.z);
    if (o.normal) f.mesh.quaternion.setFromUnitVectors(_UP, o.normal);
    f.tick(f, 0, 0);
    return f;
  }

  /** Hemisphere dome on the ground, or a full sphere (o.sphere) — fresnel glow, optional darkening. */
  _dome(pos, o = {}) {
    const life = o.life ?? 1;
    const r0 = o.r0 ?? 0.2, r1 = o.r1 ?? 2;
    const f = this._meshFx(o.sphere ? 'sphere' : 'dome', life, (f, t) => {
      const k = Math.min(1, t / life);
      const r = o.radiusFn ? o.radiusFn(k) : r0 + (r1 - r0) * easeOutCubic(k);
      f.mesh.scale.setScalar(Math.max(0.001, r));
      f.u.uAlpha.value = o.alphaFn ? o.alphaFn(k) : Math.min(1, k / 0.08) * (1 - smoothstep(0.4, 1, k));
      f.u.uTime.value = t + f.seed;
    });
    const u = f.u;
    u.uColor.value.set(o.color ?? COL.holy);
    u.uCore.value.set(o.core ?? 0xffffff);
    u.uIntensity.value = o.intensity ?? 1.6;
    u.uRimPow.value = o.rimPow ?? 2.5;
    u.uFill.value = o.fill ?? 0.08;
    u.uDark.value = o.dark ?? 0;
    u.uLines.value = o.lines ?? 0;
    f.mesh.position.copy(pos);
    f.tick(f, 0, 0);
    return f;
  }

  _defaultSlashDir(center, out) {
    out.subVectors(center, this._camPos).normalize();
    _s4.crossVectors(out, _UP);
    if (_s4.lengthSq() < 1e-6) _s4.copy(_X);
    _s4.normalize();
    return out.copy(_s4).addScaledVector(_UP, -0.6).normalize();
  }

  /**
   * Basis for a crescent: local +X = swing direction at mid-arc, +Y = bulge (outward), +Z = plane normal
   * (as close to the camera direction as possible, then tilted by `tilt` around X).
   * With `bulge`, +Y is forced to that direction instead (sword waves).
   */
  _crescentBasis(center, dir, tilt, bulge, outX, outY, outZ) {
    _s2.subVectors(this._camPos, center).normalize();
    if (bulge) {
      outY.copy(bulge).normalize();
      outZ.copy(_s2).addScaledVector(outY, -_s2.dot(outY));
      if (outZ.lengthSq() < 1e-6) outZ.crossVectors(outY, _UP);
      outZ.normalize();
      if (tilt) outZ.applyAxisAngle(outY, tilt);
      outX.crossVectors(outY, outZ).normalize();
      return;
    }
    outX.copy(dir).normalize();
    outZ.copy(_s2).addScaledVector(outX, -_s2.dot(outX));
    if (outZ.lengthSq() < 1e-6) outZ.crossVectors(_UP, outX);
    outZ.normalize();
    if (tilt) outZ.applyAxisAngle(outX, tilt);
    outY.crossVectors(outZ, outX).normalize();
  }

  /**
   * Anime crescent slash. o: radius, dir | bulge, tilt, color, core, span, width, dur, intensity,
   * full (whole arc visible, no sweep), travel (Vector3 velocity), noise, sparks, s, grow.
   */
  _crescent(center, o) {
    const R = o.radius;
    const dur = o.dur ?? 0.27;
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    this._crescentBasis(center, o.dir || _X, o.tilt || 0, o.bulge, X, Y, Z);
    const q = new THREE.Quaternion().setFromRotationMatrix(_m4.makeBasis(X, Y, Z));
    const mid = center.clone();
    const span = o.span ?? 3.3;
    const s = o.s ?? 1;
    const sparkT = { cell: C.spark, life: 0.22, lifeVar: 0.4, size: 0.035 * s, sizeVar: 0.4, color: 0xffffff, color2: o.color ?? 0x9fdcff, intensity: 2.2, drag: 3, gravity: 3, stretch: 0.03, fadeIn: 0, fadeOut: 0.6, rotVar: 0 };
    let lastHead = 0;
    const f = this._meshFx('slash', dur, (f, t, dt) => {
      const u = f.u;
      const k = t / dur;
      let head = 1, tail = 0;
      if (!o.full) {
        const ht = o.headTime ?? dur * 0.34;
        head = easeOutCubic(Math.min(1, t / ht));
        const td = o.tailDelay ?? dur * 0.2;
        tail = easeInQuad(clamp01((t - td) / (dur - td)));
      }
      u.uHead.value = head;
      u.uTail.value = Math.min(tail, head - 0.002);
      u.uAlpha.value = (o.full ? Math.min(1, t / 0.05) : 1) * (1 - smoothstep(o.full ? 0.75 : 0.6, 1, k));
      u.uTime.value = t + f.seed;
      if (o.travel && dt > 0) mid.addScaledVector(o.travel, dt);
      const sc = R * (o.scaleFn ? o.scaleFn(k) : 1 + (o.grow ?? 0.14) * k);
      f.mesh.scale.setScalar(sc);
      f.mesh.position.copy(mid).addScaledVector(Y, -sc);
      if (o.sparks && dt > 0 && head < 0.995 && head > 0.05) {
        const T = this._T(sparkT);
        const steps = 2;
        for (let i = 0; i < steps; i++) {
          const hh = lastHead + (head - lastHead) * ((i + 1) / steps);
          const th = (hh - 0.5) * span;
          const sn = Math.sin(th), cs = Math.cos(th);
          _t1.copy(X).multiplyScalar(sn * sc).addScaledVector(Y, cs * sc).add(f.mesh.position);
          _t2.copy(X).multiplyScalar(cs).addScaledVector(Y, -sn);
          const sp = this._rr(2.5, 5) * s;
          this._emit(T, _t1.x, _t1.y, _t1.z,
            _t2.x * sp + (this.rand() - 0.5) * s, _t2.y * sp + (this.rand() - 0.5) * s, _t2.z * sp + (this.rand() - 0.5) * s);
        }
      }
      lastHead = head;
    });
    const u = f.u;
    u.uColor.value.set(o.color ?? 0x9fdcff);
    u.uCore.value.set(o.core ?? 0xffffff);
    u.uSpan.value = span;
    u.uWidth.value = o.width ?? 0.34;
    u.uIntensity.value = o.intensity ?? 1;
    u.uNoise.value = o.noise ?? 0;
    u.uSym.value = o.full ? 1 : 0;
    f.mesh.quaternion.copy(q);
    f.mid = mid; f.X = X; f.Y = Y;
    f.tick(f, 0, 0);
    return f;
  }

  // ================================================================= ice crystals
  _crystalNew() {
    if (this._crystals.length >= this._cMax) return null;
    const c = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(1e-4, 1e-4, 1e-4), flash: 0, alive: true };
    this._crystals.push(c);
    return c;
  }

  _updateCrystals() {
    const list = this._crystals, mesh = this._cMesh, fl = this._cFlash.array;
    let k = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.alive) continue;
      list[k] = c;
      _m4.compose(c.pos, c.quat, c.scale);
      mesh.setMatrixAt(k, _m4);
      fl[k] = c.flash;
      k++;
    }
    list.length = k;
    mesh.count = k;
    this._cOutline.count = k;
    mesh.visible = k > 0;
    if (k) { mesh.instanceMatrix.needsUpdate = true; this._cFlash.needsUpdate = true; }
  }

  // ================================================================= ribbons (lightning / tendrils)
  _initRibbons() {
    const nv = MAX_SEG * 4;
    const g = new THREE.BufferGeometry();
    this._rA = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this._rB = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this._rInfo = new THREE.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._rCol = new THREE.BufferAttribute(new Float32Array(nv * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('aA', this._rA);
    g.setAttribute('aB', this._rB);
    g.setAttribute('aInfo', this._rInfo);
    g.setAttribute('aColor', this._rCol);
    const idx = new Uint32Array(MAX_SEG * 6);
    for (let k = 0; k < MAX_SEG; k++) {
      const b = k * 4, o = k * 6;
      idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1;
      idx[o + 3] = b + 1; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this._rGeo = g;
    this._rMesh = new THREE.Mesh(g, ribbonMaterial());
    this._rMesh.frustumCulled = false;
    this._rMesh.renderOrder = 45;
    this._rMesh.visible = false;
    this._rMesh.name = 'vfx-ribbons';
    this._rMesh.raycast = () => {};
    this.root.add(this._rMesh);
  }

  /** Jagged polyline A→B by midpoint displacement (2^levels segments). */
  _jag(A, B, levels, disp) {
    const R = this.rand;
    let pts = [A.x, A.y, A.z, B.x, B.y, B.z];
    _j1.subVectors(B, A);
    const len = _j1.length() || 1;
    _j1.divideScalar(len);
    _j2.crossVectors(_j1, Math.abs(_j1.y) < 0.9 ? _UP : _X).normalize();
    _j3.crossVectors(_j1, _j2);
    let d = disp * len;
    for (let l = 0; l < levels; l++) {
      const next = [];
      for (let i = 0; i + 5 < pts.length; i += 3) {
        const x0 = pts[i], y0 = pts[i + 1], z0 = pts[i + 2], x1 = pts[i + 3], y1 = pts[i + 4], z1 = pts[i + 5];
        const a = (R() * 2 - 1) * d, b = (R() * 2 - 1) * d;
        next.push(x0, y0, z0,
          (x0 + x1) * 0.5 + _j2.x * a + _j3.x * b,
          (y0 + y1) * 0.5 + _j2.y * a + _j3.y * b,
          (z0 + z1) * 0.5 + _j2.z * a + _j3.z * b);
      }
      next.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
      pts = next;
      d *= 0.5;
    }
    return Float32Array.from(pts);
  }

  /**
   * Lightning bolt A→B with branches. o: width, color, core, levels, disp, branches, life,
   * regen (times to re-randomise), env ('strike'|'arc'|'leader'|'steady'), update(b, t, dt).
   */
  _bolt(A, B, o = {}) {
    const b = {
      A: A.clone(), B: B.clone(), o, t: 0, life: o.life ?? 0.4, lines: [],
      color: new THREE.Color(o.color ?? COL.elec), core: o.core ?? 1,
      regenAt: (o.regen || []).slice(), env: o.env || 'strike', update: o.update || null,
    };
    if (!b.update) this._genBolt(b);
    this._bolts.push(b);
    return b;
  }

  _genBolt(b) {
    const o = b.o, R = this.rand;
    const w = o.width ?? 0.12;
    b.lines.length = 0;
    const main = this._jag(b.A, b.B, o.levels ?? 5, o.disp ?? 0.12);
    b.lines.push({ pts: main, n: main.length / 3, w0: w * (o.taper ?? 0.55), w1: w, a: 1 });
    const nb = o.branches ?? 4;
    const n = main.length / 3;
    const dir = _t1.subVectors(b.B, b.A);
    const len = dir.length();
    dir.normalize();
    for (let i = 0; i < nb; i++) {
      const idx = Math.floor((0.12 + R() * 0.72) * (n - 1));
      const P = new THREE.Vector3(main[idx * 3], main[idx * 3 + 1], main[idx * 3 + 2]);
      this._cone(_t2, dir, 0.32);
      const L = len * (0.06 + R() * 0.12);
      const E = P.clone().addScaledVector(_t2, L);
      const pts = this._jag(P, E, 3, 0.22);
      b.lines.push({ pts, n: pts.length / 3, w0: w * 0.5, w1: w * 0.06, a: 0.8 });
      if (R() < 0.45) {
        const j = Math.floor((0.3 + R() * 0.5) * (pts.length / 3 - 1));
        const P2 = new THREE.Vector3(pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
        this._cone(_t2, dir, 0.4);
        const E2 = P2.clone().addScaledVector(_t2, L * 0.5);
        const p2 = this._jag(P2, E2, 2, 0.25);
        b.lines.push({ pts: p2, n: p2.length / 3, w0: w * 0.3, w1: w * 0.04, a: 0.6 });
      }
    }
  }

  _boltAlpha(b) {
    const t = b.t, R = this.rand;
    switch (b.env) {
      case 'strike':
        if (t < 0.04) return 1;
        if (t < 0.07) return 0.3;
        if (t < 0.12) return 1;
        return Math.exp(-(t - 0.12) * 11) * (0.65 + 0.35 * R());
      case 'arc': return (R() < 0.75 ? 1 : 0.35) * (1 - t / b.life);
      case 'leader': return 0.4 * (R() < 0.6 ? 1 : 0.15) * (1 - t / b.life);
      default: return fadeEnv(t, b.life, 0.08, 0.25);
    }
  }

  _updateBolts(dt) {
    const bolts = this._bolts;
    const A = this._rA.array, B = this._rB.array, I = this._rInfo.array, Cc = this._rCol.array;
    let seg = 0;
    for (let i = 0; i < bolts.length; i++) {
      const b = bolts[i];
      b.t += dt;
      if (b.t >= b.life) { bolts.splice(i, 1); i--; continue; }
      while (b.regenAt.length && b.t >= b.regenAt[0]) { b.regenAt.shift(); this._genBolt(b); }
      if (b.update) b.update(b, b.t, dt);
      const alpha = this._boltAlpha(b);
      if (alpha <= 0.002) continue;
      const cr = b.color.r, cg = b.color.g, cb = b.color.b, core = b.core;
      for (const L of b.lines) {
        const pts = L.pts, n = L.n;
        const la = alpha * L.a;
        for (let k = 0; k < n - 1 && seg < MAX_SEG; k++) {
          const f0 = k / (n - 1), f1 = (k + 1) / (n - 1);
          const w0 = L.w0 + (L.w1 - L.w0) * f0, w1 = L.w0 + (L.w1 - L.w0) * f1;
          for (let v = 0; v < 4; v++) {
            const vi = seg * 4 + v;
            const end = v >> 1;
            A[vi * 3] = pts[k * 3]; A[vi * 3 + 1] = pts[k * 3 + 1]; A[vi * 3 + 2] = pts[k * 3 + 2];
            B[vi * 3] = pts[k * 3 + 3]; B[vi * 3 + 1] = pts[k * 3 + 4]; B[vi * 3 + 2] = pts[k * 3 + 5];
            I[vi * 4] = v & 1 ? 1 : -1; I[vi * 4 + 1] = end; I[vi * 4 + 2] = end ? w1 : w0; I[vi * 4 + 3] = la;
            Cc[vi * 4] = cr; Cc[vi * 4 + 1] = cg; Cc[vi * 4 + 2] = cb; Cc[vi * 4 + 3] = core;
          }
          seg++;
        }
      }
    }
    this._rGeo.setDrawRange(0, seg * 6);
    this._rMesh.visible = seg > 0;
    if (seg) {
      for (const a of [this._rA, this._rB, this._rInfo, this._rCol]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, seg * 4 * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  /** Short crackling arcs around `center` for `dur` seconds. */
  _crackle(center, radius, dur, o = {}) {
    let acc = 0;
    const c = center.clone();
    this._emitFor(o.delay ?? 0, dur, (t, dt) => {
      acc += dt * (o.rate ?? 30);
      while (acc >= 1) {
        acc -= 1;
        this._cone(_t1, _UP, o.spread ?? 1);
        const A = c.clone().addScaledVector(_t1, radius * this._rr(0.1, 0.5));
        this._cone(_t2, _t1, 0.5);
        const B = A.clone().addScaledVector(_t2, radius * this._rr(0.5, 1.0));
        if (o.floorY !== undefined) { A.y = Math.max(A.y, o.floorY + 0.02); B.y = Math.max(B.y, o.floorY + 0.02); }
        this._bolt(A, B, { width: o.width ?? 0.03, color: o.color ?? COL.elec, levels: 3, disp: 0.3, branches: this.rand() < 0.3 ? 1 : 0, life: this._rr(0.05, 0.11), env: 'arc', core: o.core ?? 0.8 });
      }
    });
  }

  // ================================================================= damage numbers
  _textAcquire() {
    let e = this._textFree.pop();
    if (!e) {
      const canvas = document.createElement('canvas');
      canvas.width = TEXT_W; canvas.height = TEXT_H;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, fog: false });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 1000;
      sprite.frustumCulled = false;
      sprite.raycast = () => {};
      sprite.name = 'vfx-text';
      if (this._textLayer !== null) sprite.layers.set(this._textLayer);
      this.root.add(sprite);
      e = { sprite, canvas, ctx, tex, anchor: new THREE.Vector3(), t: 0, life: 1, h: 0.4, aspect: 1, pop: 1.3, crit: false, lift: 0 };
    }
    return e;
  }

  _textStyle(str, color, crit, heal) {
    if (color !== null && color !== undefined) {
      const c = new THREE.Color(color);
      const lite = c.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
      const dark = c.clone().multiplyScalar(0.22);
      return { top: '#ffffff', mid: `#${lite.getHexString()}`, bot: `#${c.getHexString()}`, out: `#${dark.getHexString()}` };
    }
    if (heal) return { top: '#f6fff2', mid: '#a8ff9c', bot: '#27c763', out: '#06301a' };
    if (crit) return { top: '#fff7b8', mid: '#ffb21f', bot: '#ff3a1c', out: '#3a0505' };
    if (/^miss/i.test(str)) return { top: '#ffffff', mid: '#d8e6ff', bot: '#86a2d8', out: '#141b2e' };
    return { top: '#ffffff', mid: '#fff1c4', bot: '#ffae38', out: '#2a1206' };
  }

  _drawText(e, str, st, crit) {
    const ctx = e.ctx;
    ctx.clearRect(0, 0, TEXT_W, TEXT_H);
    let fs = crit ? 112 : 100;
    const family = '"Segoe UI Black", "Arial Black", "Helvetica Neue", Arial, sans-serif';
    const font = () => `${crit ? 'italic ' : ''}900 ${fs}px ${family}`;
    ctx.font = font();
    let w = ctx.measureText(str).width;
    const maxW = TEXT_W - fs * 0.3 - 16;
    if (w > maxW) { fs = Math.floor(fs * (maxW / w)); ctx.font = font(); w = ctx.measureText(str).width; }
    const cx = TEXT_W / 2, cy = TEXT_H / 2 + fs * 0.05;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = fs * 0.22;
    ctx.lineWidth = fs * 0.24;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(str, cx + fs * 0.03, cy + fs * 0.06);
    ctx.restore();
    ctx.lineWidth = fs * 0.18;
    ctx.strokeStyle = st.out;
    ctx.strokeText(str, cx, cy);
    const g = ctx.createLinearGradient(0, cy - fs * 0.42, 0, cy + fs * 0.4);
    g.addColorStop(0, st.top);
    g.addColorStop(0.5, st.mid);
    g.addColorStop(1, st.bot);
    ctx.fillStyle = g;
    ctx.fillText(str, cx, cy);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, cy - fs * 0.5, TEXT_W, fs * 0.2);
    ctx.globalCompositeOperation = 'source-over';
    e.tex.needsUpdate = true;
    return Math.min(TEXT_W, w + fs * 0.3 + 12);
  }

  _updateTexts(dt) {
    const list = this._texts;
    const cam = this._camera;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      e.t += dt;
      const t = e.t;
      if (t >= e.life) { e.sprite.visible = false; this._textFree.push(e); list.splice(i, 1); i--; continue; }
      let s;
      if (t < 0.08) s = 0.3 + (e.pop - 0.3) * easeOutQuad(t / 0.08);
      else if (t < 0.18) s = e.pop + (0.93 - e.pop) * smoothstep(0, 1, (t - 0.08) / 0.1);
      else if (t < 0.27) s = 0.93 + 0.07 * easeOutQuad((t - 0.18) / 0.09);
      else s = 1;
      let hop;
      if (t < 0.2) hop = easeOutQuad(t / 0.2);
      else if (t < 0.34) hop = 1 - 0.28 * easeInQuad((t - 0.2) / 0.14);
      else if (t < 0.46) hop = 0.72 + 0.1 * Math.sin(((t - 0.34) / 0.12) * Math.PI);
      else hop = 0.72 + (t - 0.46) * 0.35;
      let h = e.h;
      if (cam) {
        const dist = Math.max(0.01, this._camPos.distanceTo(e.anchor));
        const minFrac = 0.06;
        const minH = cam.isPerspectiveCamera
          ? dist * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * minFrac / (cam.zoom || 1)
          : ((cam.top - cam.bottom) / (cam.zoom || 1)) * minFrac;
        h = Math.max(h, minH * (e.h / 0.42));
      }
      const hs = h * s;
      e.sprite.scale.set(hs * e.aspect, hs, 1);
      e.sprite.position.copy(e.anchor).addScaledVector(_UP, h * (0.35 + hop * 0.55) + e.lift * (h / e.h));
      if (e.crit && t < 0.3) {
        const k = 1 - t / 0.3;
        e.sprite.position.addScaledVector(this._camRight, Math.sin(t * 80) * 0.04 * h * 2.4 * k);
      }
      const a = t > e.life - 0.3 ? (e.life - t) / 0.3 : 1;
      e.sprite.material.opacity = a;
      e.sprite.material.color.setScalar(0.8);
    }
  }

  // ================================================================= flash light
  _flash(p, color, intensity, dur) {
    if (!this.light) return;
    intensity *= FLASH_K;
    if (this._lightDur > 0 && this.light.intensity > intensity) return;
    this.light.position.copy(p);
    this.light.color.set(color);
    this._lightPeak = intensity;
    this._lightT = 0;
    this._lightDur = dur;
    this.light.intensity = intensity;
  }

  _updateLight(dt) {
    if (!this.light || this._lightDur <= 0) return;
    this._lightT += dt;
    const k = this._lightT / this._lightDur;
    if (k >= 1) { this.light.intensity = 0; this._lightDur = 0; return; }
    this.light.intensity = this._lightPeak * (1 - k) * (1 - k);
  }

  // ================================================================= arrows
  _arrowAcquire() {
    let g = this._arrowFree.pop();
    if (!g) {
      if (!this._arrowParts) {
        this._arrowParts = {
          shaft: new THREE.CylinderGeometry(0.014, 0.014, 0.58, 6).translate(0, -0.03, 0),
          head: new THREE.ConeGeometry(0.042, 0.13, 6).translate(0, 0.32, 0),
          fletch: new THREE.PlaneGeometry(0.075, 0.15).translate(0, -0.27, 0),
          mShaft: toonMaterial({ color: 0x8a5a2b }),
          mHead: toonMaterial({ color: 0xd8dde6, emissive: 0x222831 }),
          mFletch: toonMaterial({ color: 0xf4efe6, side: THREE.DoubleSide }),
        };
      }
      const P = this._arrowParts;
      g = new THREE.Group();
      g.add(new THREE.Mesh(P.shaft, P.mShaft), new THREE.Mesh(P.head, P.mHead));
      const f1 = new THREE.Mesh(P.fletch, P.mFletch);
      const f2 = f1.clone(); f2.rotation.y = Math.PI / 2;
      g.add(f1, f2);
      g.traverse((o) => { o.raycast = () => {}; });
      g.name = 'vfx-arrow';
      this.root.add(g);
    }
    g.visible = true;
    this._arrowsActive.add(g);
    return g;
  }

  _arrowRelease(g) {
    g.visible = false;
    this._arrowsActive.delete(g);
    this._arrowFree.push(g);
  }

  _acc() {
    let a = 0;
    return (rate, dt) => { a += rate * dt; const n = Math.floor(a); a -= n; return n; };
  }

  // ================================================================= public: generic
  /**
   * Generic particle burst.
   * @param {THREE.Vector3} pos
   * @param {object} [opts] count, color, color2, speed, life, size, sizeEnd, gravity (downward accel.), drag,
   *   texture ('glow'|'spark'|'star'|'smoke'|'ring'|'shard'|'leaf'|'flake'|'ember'|'feather'|'fire'|'rune'|'drop'|'dot'|'plus'|'wisp'),
   *   spread (0..1 cone half-angle fraction, 1 = sphere), dir, additive (default true), stretch (s of motion blur),
   *   intensity, spin, alpha, scale
   */
  burst(pos, opts = {}) {
    const {
      count = 20, color = 0xffffff, color2 = null, speed = 2, life = 0.6, size = 0.15, sizeEnd = null,
      gravity = 0, drag = 0, texture = 'glow', spread = 1, dir = null, additive = true, stretch = 0,
      intensity = additive ? 1.8 : 1, spin = 0, scale = 1, alpha = 1,
    } = opts;
    const p = v3(pos);
    const d = dir ? v3(dir).normalize() : _UP.clone();
    const T = this._T({
      cell: C[texture] ?? C.glow, life, size: size * scale, sizeEnd: (sizeEnd ?? size * 0.35) * scale, color, color2,
      intensity, gravity, drag, stretch, blend: additive ? 1 : 0, spinVar: spin, alpha, fadeIn: 0.04, fadeOut: 0.6,
      rotVar: stretch > 0 ? 0 : Math.PI,
    });
    this._spray(T, p, Math.max(0, Math.floor(count)), d, spread, speed * scale * 0.45, speed * scale);
  }

  /**
   * Weapon impact: white core flash, star flare, shock ring, sparks (biased along `dir`). ~0.35 s.
   * @param {THREE.Vector3} pos
   * @param {{color?: number, crit?: boolean, dir?: THREE.Vector3, scale?: number}} [opts]
   */
  hitSpark(pos, opts = {}) {
    const { color = 0xffc46b, crit = false, scale = 1 } = opts;
    const s = scale * (crit ? 1.3 : 1);
    const p = this._towardCam(v3(pos), 0.3 * scale);
    const dir = opts.dir ? v3(opts.dir).normalize() : null;
    this._glow(p, 0xffffff, 0.18 * s, 0.6 * s, 0.11, 1.5);
    this._glow(p, color, 0.3 * s, 0.9 * s, 0.22, 0.7);
    this._emit(this._T({ cell: C.star, life: 0.16, lifeVar: 0, size: 0.95 * s, sizeEnd: 0.2 * s, sizeVar: 0.1, color: 0xffffff, color2: color, intensity: 1.6, rotVar: 0.5, fadeIn: 0, fadeOut: 0.7 }), p.x, p.y, p.z);
    this._emit(this._T({ cell: C.ring, life: 0.18, lifeVar: 0, size: 0.15 * s, sizeEnd: 0.85 * s, sizeVar: 0, color, intensity: 0.9, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
    const sparks = this._T({ cell: C.spark, life: 0.26, lifeVar: 0.45, size: 0.05 * s, sizeVar: 0.4, color: 0xffffff, color2: color, intensity: 2.0, drag: 4.5, gravity: 5, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
    this._spray(sparks, p, crit ? 28 : 15, dir || _UP, dir ? 0.42 : 1, 3.5 * s, 8.5 * s);
    const bits = this._T({ cell: C.dot, life: 0.35, lifeVar: 0.3, size: 0.045 * s, sizeEnd: 0.015 * s, color, intensity: 1.5, drag: 3, gravity: 7, fadeIn: 0, fadeOut: 0.4 });
    this._spray(bits, p, crit ? 10 : 5, dir || _UP, dir ? 0.5 : 1, 2 * s, 4.5 * s);
    if (crit) {
      this._emit(this._T({ cell: C.star, life: 0.26, lifeVar: 0, size: 1.5 * s, sizeEnd: 0.3 * s, sizeVar: 0, color: 0xffffff, color2: color, intensity: 1.4, rot: Math.PI / 4, rotVar: 0.15, fadeIn: 0, fadeOut: 0.7 }), p.x, p.y, p.z);
      this._emit(this._T({ cell: C.ring, life: 0.24, lifeVar: 0, size: 0.25 * s, sizeEnd: 1.3 * s, sizeVar: 0, color: 0xffffff, color2: color, intensity: 0.35, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
      const lines = this._T({ cell: C.spark, life: 0.2, lifeVar: 0.3, size: 0.045 * s, sizeVar: 0.3, color: 0xffffff, color2: color, intensity: 1.3, drag: 8, stretch: 0.055, fadeIn: 0, fadeOut: 0.6, rotVar: 0 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + this.rand() * 0.4;
        _t1.copy(this._camRight).multiplyScalar(Math.cos(a)).addScaledVector(this._camUp, Math.sin(a));
        const sp = this._rr(9, 14) * s;
        this._emit(lines, p.x + _t1.x * 0.15 * s, p.y + _t1.y * 0.15 * s, p.z + _t1.z * 0.15 * s, _t1.x * sp, _t1.y * sp, _t1.z * sp);
      }
      this._flash(p, color, 5, 0.25);
    }
  }

  /**
   * Anime crescent slash (or a thrust streak) through `center`. ~0.27 s (crit adds a crossing arc, ~0.4 s).
   * @param {THREE.Vector3} center
   * @param {{color?: number, radius?: number, dir?: THREE.Vector3, crit?: boolean, thrust?: boolean, scale?: number}} [opts]
   *   dir = swing travel direction at the moment the blade passes `center`.
   */
  slash(center, opts = {}) {
    const { color = 0x9fdcff, radius = 0.9, crit = false, thrust = false, scale = 1 } = opts;
    const c = this._towardCam(v3(center), 0.25 * scale);
    let dir = opts.dir ? v3(opts.dir) : null;
    if (!dir || dir.lengthSq() < 1e-8) dir = this._defaultSlashDir(c, new THREE.Vector3());
    dir.normalize();
    if (thrust) { this._thrust(c, dir, color, scale, crit); return; }
    const R = radius * scale * (crit ? 1.15 : 1);
    const tilt = (this.rand() * 2 - 1) * 0.5;
    this._crescent(c, { radius: R, dir, color, tilt, span: 3.2, width: 0.5, dur: 0.27, sparks: true, s: scale });
    this._after(0.05, () => this._glow(c, color, 0.2 * scale, 0.7 * scale, 0.14, 1.0));
    if (crit) {
      const fwd = new THREE.Vector3().subVectors(c, this._camPos).normalize();
      const d2 = dir.clone().applyAxisAngle(fwd, (this.rand() < 0.5 ? 1 : -1) * 1.75);
      this._after(0.08, () => {
        this._crescent(c, { radius: R * 1.08, dir: d2, color, tilt: -tilt * 0.5, span: 3.2, width: 0.52, dur: 0.3, sparks: true, s: scale, intensity: 1.1 });
        this.hitSpark(c, { color, crit: true, dir, scale });
      });
    }
  }

  _thrust(c, dir, color, s, crit) {
    const k = crit ? 1.3 : 1;
    const L = 1.6 * s * k;
    const mid = c.clone().addScaledVector(dir, -0.25 * s);
    this._emit(this._T({ cell: C.spark, lock: 1, stretch: 1, life: 0.2, lifeVar: 0, size: 0.3 * s * k, sizeVar: 0, color, intensity: 1.4, fadeIn: 0.05, fadeOut: 0.8, rotVar: 0 }),
      mid.x, mid.y, mid.z, dir.x * L, dir.y * L, dir.z * L);
    this._emit(this._T({ cell: C.spark, lock: 1, stretch: 1, life: 0.15, lifeVar: 0, size: 0.09 * s * k, sizeVar: 0, color: 0xffffff, intensity: 2.6, fadeIn: 0.05, fadeOut: 0.8, rotVar: 0 }),
      mid.x, mid.y, mid.z, dir.x * L * 0.92, dir.y * L * 0.92, dir.z * L * 0.92);
    const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? _UP : _X).normalize();
    const w = new THREE.Vector3().crossVectors(dir, u);
    const lines = this._T({ cell: C.spark, life: 0.16, lifeVar: 0.3, size: 0.03 * s, sizeVar: 0.3, color: 0xffffff, color2: color, intensity: 1.5, drag: 3, stretch: 0.05, fadeIn: 0, fadeOut: 0.7, rotVar: 0 });
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2, r = this._rr(0.08, 0.38) * s;
      const ox = (u.x * Math.cos(a) + w.x * Math.sin(a)) * r, oy = (u.y * Math.cos(a) + w.y * Math.sin(a)) * r, oz = (u.z * Math.cos(a) + w.z * Math.sin(a)) * r;
      const sp = this._rr(10, 16) * s;
      this._emit(lines, c.x - dir.x * 0.9 * s + ox, c.y - dir.y * 0.9 * s + oy, c.z - dir.z * 0.9 * s + oz, dir.x * sp, dir.y * sp, dir.z * sp);
    }
    const tip = c.clone().addScaledVector(dir, 0.3 * s);
    this._glow(tip, 0xffffff, 0.15 * s, 0.6 * s, 0.12, 1.6);
    this._emit(this._T({ cell: C.ring, life: 0.18, lifeVar: 0, size: 0.15 * s, sizeEnd: 0.85 * s, sizeVar: 0, color, intensity: 1.3, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), tip.x, tip.y, tip.z);
    const sp = this._T({ cell: C.spark, life: 0.22, lifeVar: 0.4, size: 0.05 * s, sizeVar: 0.4, color: 0xffffff, color2: color, intensity: 1.8, drag: 4, gravity: 4, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
    this._spray(sp, tip, crit ? 22 : 12, dir, 0.3, 4 * s, 9 * s);
    if (crit) this._after(0.05, () => this.hitSpark(tip, { color, crit: true, dir, scale: s }));
  }

  /**
   * Popping damage number / 'MISS' / 'CRITICAL!' (~1.1 s, crit ~1.3 s). Drawn on top of everything and kept
   * at least ~6% of the screen height tall so it stays readable from the tactical camera.
   * @param {THREE.Vector3} pos anchor (e.g. above the unit's head)
   * @param {string|number} text
   * @param {{color?: number|string, size?: number, crit?: boolean, heal?: boolean}} [opts]
   */
  floatText(pos, text, opts = {}) {
    const { color = null, size = 1, crit = false, heal = false } = opts;
    const str = String(text ?? '');
    if (!str) return;
    const e = this._textAcquire();
    const w = this._drawText(e, str, this._textStyle(str, color, crit, heal), crit);
    e.tex.repeat.set(w / TEXT_W, 1);
    e.tex.offset.set((1 - w / TEXT_W) / 2, 0);
    e.aspect = w / TEXT_H;
    v3(pos, e.anchor);
    e.t = 0;
    e.crit = crit;
    e.life = crit ? 1.3 : 1.1;
    e.h = 0.42 * size * (crit ? 1.3 : 1);
    e.pop = crit ? 1.65 : 1.32;
    let lift = 0;
    for (const o of this._texts) if (o.t < 0.35 && o.anchor.distanceToSquared(e.anchor) < 0.2) lift = Math.max(lift, o.lift + o.h * 0.78);
    e.lift = lift;
    e.sprite.scale.set(1e-4, 1e-4, 1);
    e.sprite.material.opacity = 0;
    e.sprite.visible = true;
    this._texts.push(e);
  }

  // ================================================================= projectiles
  /**
   * Fires a projectile; resolves ~0.45 s after impact.
   * @param {'arrow'|'fireball'|'iceShard'|'darkOrb'|'holyOrb'|'boltOrb'} kind
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{onImpact?: Function, speed?: number, arc?: number, scale?: number}} [opts]
   *   speed in units/s (defaults per kind), arc = apex height as a fraction of the distance.
   * @returns {Promise<void>}
   */
  projectile(kind, from, to, opts = {}) {
    const k = PROJ[kind] ? kind : 'fireball';
    if (!PROJ[kind]) console.warn(`[vfx] unknown projectile "${kind}"`);
    const A = v3(from), B = v3(to);
    const s = opts.scale ?? 1;
    const ctx = this._ctx(opts.onImpact);
    const travel = this._fly(k, A, B, {
      s, speed: opts.speed, arc: opts.arc,
      onArrive: (p, dir) => { this._projImpact(k, p, dir, s); ctx.impact(); },
    });
    this._after(travel + 0.45, ctx.finish);
    return ctx.promise;
  }

  _fly(kind, from, to, o = {}) {
    const s = o.s ?? 1;
    const A = from.clone(), B = to.clone();
    const dist = A.distanceTo(B);
    const travel = o.travel ?? Math.max(0.08, dist / Math.max(0.1, o.speed ?? PROJ[kind].speed));
    const arcH = (o.arc ?? PROJ[kind].arc) * dist;
    const st = {
      kind, A, B, s, travel, arcH, pos: A.clone(), dir: new THREE.Vector3().subVectors(B, A).normalize(),
      slot: this._slotAlloc(A), t: 0, acc: {}, data: {},
    };
    this._projStart(st);
    this._task((dt) => {
      st.t += dt;
      const k = Math.min(1, st.t / travel);
      st.pos.lerpVectors(A, B, k);
      st.pos.y += arcH * 4 * k * (1 - k);
      st.dir.subVectors(B, A).divideScalar(travel);
      st.dir.y += (arcH * 4 * (1 - 2 * k)) / travel;
      st.dir.normalize();
      this._slotSet(st.slot, st.pos);
      if (k >= 1) {
        this._projEnd(st);
        this._slotRelease(st.slot);
        if (o.onArrive) o.onArrive(st.pos.clone(), st.dir.clone());
        return false;
      }
      this._projTick(st, dt);
      return true;
    });
    return travel;
  }

  _rate(st, key, rate, dt) {
    const a = (st.acc[key] || 0) + rate * dt;
    const n = Math.floor(a);
    st.acc[key] = a - n;
    return n;
  }

  _projStart(st) {
    const s = st.s, f = st.slot;
    const fol = (o) => {
      if (f < 0) return;
      this._emit(this._T({ life: 1e5, lifeVar: 0, sizeVar: 0, fadeIn: 0, fadeOut: 0, follow: f, rotVar: 0, ...o }), 0, 0, 0);
    };
    switch (st.kind) {
      case 'arrow': {
        const m = this._arrowAcquire();
        m.scale.setScalar(s);
        m.position.copy(st.A);
        m.quaternion.setFromUnitVectors(_UP, st.dir);
        st.data.mesh = m;
        st.data.prevTail = st.A.clone();
        break;
      }
      case 'fireball':
        fol({ cell: C.glow, size: 0.75 * s, color: COL.fire, intensity: 0.9, twinkle: 22 });
        fol({ cell: C.glow, size: 0.34 * s, color: 0xfff0c8, intensity: 2.0, twinkle: 31 });
        break;
      case 'iceShard': {
        const c = this._crystalNew();
        if (c) { c.flash = 0.2; c.scale.set(0.075 * s, 0.44 * s, 0.075 * s); c.pos.copy(st.A); c.quat.setFromUnitVectors(_UP, st.dir); }
        st.data.crystal = c;
        st.data.spin = this.rand() * 6;
        fol({ cell: C.glow, size: 0.5 * s, color: COL.ice, intensity: 0.55, twinkle: 18 });
        break;
      }
      case 'darkOrb': {
        fol({ cell: C.glow, size: 1.0 * s, color: COL.dark, intensity: 0.5, twinkle: 9 });
        fol({ cell: C.ring, size: 0.52 * s, color: 0xd59bff, intensity: 1.4, spin: 4, twinkle: 14 });
        const core = this._dome(st.A, { sphere: true, life: 1e5, radiusFn: () => 0.15 * s, color: 0xc070ff, core: 0xf0d0ff, intensity: 1.1, rimPow: 1.6, fill: 0, dark: 0.95, alphaFn: () => 1 });
        core.mesh.renderOrder = 41;
        st.data.core = core;
        if (f >= 0) {
          const T = this._T({ cell: C.dot, life: 1e5, lifeVar: 0, size: 0.06 * s, sizeVar: 0.2, color: 0xe0b0ff, intensity: 1.8, fadeIn: 0, fadeOut: 0, follow: f, swirl: 7, swirlVar: 0.3, twinkle: 10 });
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            this._emit(T, Math.cos(a) * 0.3 * s, (this.rand() - 0.5) * 0.16 * s, Math.sin(a) * 0.3 * s);
          }
        }
        break;
      }
      case 'holyOrb':
        fol({ cell: C.glow, size: 0.8 * s, color: COL.holy, intensity: 0.8, twinkle: 12 });
        fol({ cell: C.glow, size: 0.3 * s, color: 0xffffff, intensity: 2.1 });
        fol({ cell: C.star, size: 0.9 * s, color: COL.holyCore, intensity: 1.4, spin: 2.5 });
        break;
      case 'boltOrb':
        fol({ cell: C.glow, size: 0.7 * s, color: COL.elec, intensity: 1.0, twinkle: 40 });
        fol({ cell: C.glow, size: 0.26 * s, color: 0xffffff, intensity: 2.4 });
        break;
      default: break;
    }
  }

  _projTick(st, dt) {
    const s = st.s, p = st.pos, d = st.dir, R = this.rand;
    let n;
    switch (st.kind) {
      case 'arrow': {
        const m = st.data.mesh;
        m.position.copy(p);
        m.quaternion.setFromUnitVectors(_UP, d);
        const tail = _t1.copy(p).addScaledVector(d, -0.3 * s);
        const prev = st.data.prevTail;
        _t2.subVectors(tail, prev);
        if (_t2.lengthSq() > 1e-8) {
          const T = this._T({ cell: C.spark, lock: 1, stretch: 1, life: 0.14, lifeVar: 0, size: 0.035 * s, sizeVar: 0, color: 0xffffff, intensity: 0.8, fadeIn: 0, fadeOut: 1, rotVar: 0 });
          this._emit(T, (tail.x + prev.x) / 2, (tail.y + prev.y) / 2, (tail.z + prev.z) / 2, _t2.x, _t2.y, _t2.z);
        }
        prev.copy(tail);
        break;
      }
      case 'fireball':
        n = this._rate(st, 'f', 85, dt);
        if (n) {
          const T = this._T({ cell: C.fire, ramp: 'fire', life: 0.34, lifeVar: 0.3, size: 0.26 * s, sizeEnd: 0.5 * s, sizeVar: 0.3, intensity: 0.75, gravity: -1.5, drag: 2, spinVar: 3, fadeIn: 0.05, fadeOut: 0.6 });
          for (; n > 0; n--) {
            this._emit(T, p.x + (R() - 0.5) * 0.08 * s, p.y + (R() - 0.5) * 0.08 * s, p.z + (R() - 0.5) * 0.08 * s,
              (-d.x * 0.6 + (R() - 0.5) * 0.6) * s, (-d.y * 0.6 + (R() - 0.5) * 0.6 + 0.3) * s, (-d.z * 0.6 + (R() - 0.5) * 0.6) * s);
          }
        }
        n = this._rate(st, 's', 28, dt);
        if (n) {
          const T = this._T({ cell: C.spark, ramp: 'fire', life: 0.4, lifeVar: 0.4, size: 0.035 * s, sizeVar: 0.4, intensity: 0.9, gravity: 2.5, drag: 1.5, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
          for (; n > 0; n--) { this._cone(_e1, d, 0.85); this._emit(T, p.x, p.y, p.z, -_e1.x * 1.6 * s, (-_e1.y * 1.6 + 0.5) * s, -_e1.z * 1.6 * s); }
        }
        n = this._rate(st, 'k', 16, dt);
        if (n) {
          const T = this._T({ cell: C.smoke, blend: 0, color: COL.smoke, alpha: 0.4, life: 0.65, lifeVar: 0.3, size: 0.2 * s, sizeEnd: 0.55 * s, gravity: -0.8, drag: 1.5, spinVar: 1.2, fadeIn: 0.15, fadeOut: 0.6, delay: 0.06 });
          for (; n > 0; n--) this._emit(T, p.x, p.y, p.z, (R() - 0.5) * 0.3 * s, 0.25 * s, (R() - 0.5) * 0.3 * s);
        }
        break;
      case 'iceShard': {
        const c = st.data.crystal;
        if (c) {
          st.data.spin += dt * 16;
          _q1.setFromUnitVectors(_UP, d);
          _q2.setFromAxisAngle(_UP, st.data.spin);
          c.quat.copy(_q1).multiply(_q2);
          c.pos.copy(p).addScaledVector(d, -0.2 * s);
        }
        n = this._rate(st, 'g', 60, dt);
        if (n) {
          const T = this._T({ cell: C.glow, ramp: 'ice', life: 0.28, lifeVar: 0.3, size: 0.2 * s, sizeEnd: 0.05 * s, intensity: 0.6, fadeIn: 0, fadeOut: 0.8 });
          for (; n > 0; n--) this._emit(T, p.x + (R() - 0.5) * 0.06 * s, p.y + (R() - 0.5) * 0.06 * s, p.z + (R() - 0.5) * 0.06 * s, (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.4 * s);
        }
        n = this._rate(st, 'f', 26, dt);
        if (n) {
          const T = this._T({ cell: C.flake, blend: 0.6, color: 0xeaf9ff, intensity: 1.0, life: 0.55, lifeVar: 0.3, size: 0.07 * s, sizeEnd: 0.03 * s, gravity: 1.2, drag: 1.5, spinVar: 4, fadeIn: 0.05, fadeOut: 0.5 });
          for (; n > 0; n--) this._emit(T, p.x, p.y, p.z, ((R() - 0.5) * 0.8 - d.x * 0.5) * s, (R() - 0.5) * 0.8 * s, ((R() - 0.5) * 0.8 - d.z * 0.5) * s);
        }
        break;
      }
      case 'darkOrb':
        if (st.data.core) st.data.core.mesh.position.copy(p);
        n = this._rate(st, 'w', 38, dt);
        if (n) {
          const T = this._T({ cell: C.wisp, blend: 0.05, over: true, color: 0x1c0634, alpha: 0.55, life: 0.5, lifeVar: 0.3, size: 0.22 * s, sizeEnd: 0.5 * s, drag: 2, spinVar: 2, fadeIn: 0.1, fadeOut: 0.6 });
          for (; n > 0; n--) this._emit(T, p.x + (R() - 0.5) * 0.12 * s, p.y + (R() - 0.5) * 0.12 * s, p.z + (R() - 0.5) * 0.12 * s, (R() - 0.5) * 0.4 * s, (R() - 0.2) * 0.4 * s, (R() - 0.5) * 0.4 * s);
        }
        n = this._rate(st, 'g', 34, dt);
        if (n) {
          const T = this._T({ cell: C.glow, ramp: 'dfire', life: 0.3, lifeVar: 0.3, size: 0.28 * s, sizeEnd: 0.08 * s, intensity: 0.6, fadeIn: 0, fadeOut: 0.8 });
          for (; n > 0; n--) this._emit(T, p.x, p.y, p.z, (R() - 0.5) * 0.5 * s, (R() - 0.5) * 0.5 * s, (R() - 0.5) * 0.5 * s);
        }
        n = this._rate(st, 's', 20, dt);
        if (n) {
          const T = this._T({ cell: C.spark, ramp: 'dfire', life: 0.35, lifeVar: 0.3, size: 0.035 * s, intensity: 0.9, drag: 2, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
          for (; n > 0; n--) { this._cone(_e1, d, 0.9); this._emit(T, p.x, p.y, p.z, -_e1.x * 1.5 * s, -_e1.y * 1.5 * s, -_e1.z * 1.5 * s); }
        }
        break;
      case 'holyOrb':
        n = this._rate(st, 'g', 40, dt);
        if (n) {
          const T = this._T({ cell: C.glow, ramp: 'holy', life: 0.3, lifeVar: 0.3, size: 0.26 * s, sizeEnd: 0.06 * s, intensity: 0.55, fadeIn: 0, fadeOut: 0.8 });
          for (; n > 0; n--) this._emit(T, p.x, p.y, p.z, (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.4 * s);
        }
        n = this._rate(st, 's', 30, dt);
        if (n) {
          const T = this._T({ cell: C.star, color: 0xfff3c8, intensity: 1.4, life: 0.45, lifeVar: 0.4, size: 0.14 * s, sizeEnd: 0.02 * s, drag: 2, twinkle: 30, fadeIn: 0, fadeOut: 0.6, spinVar: 3 });
          for (; n > 0; n--) {
            this._emit(T, p.x + (R() - 0.5) * 0.15 * s, p.y + (R() - 0.5) * 0.15 * s, p.z + (R() - 0.5) * 0.15 * s,
              ((R() - 0.5) * 0.7 - d.x * 0.4) * s, (R() - 0.5) * 0.7 * s, ((R() - 0.5) * 0.7 - d.z * 0.4) * s);
          }
        }
        break;
      case 'boltOrb':
        n = this._rate(st, 's', 55, dt);
        if (n) {
          const T = this._T({ cell: C.spark, ramp: 'elec', life: 0.16, lifeVar: 0.4, size: 0.035 * s, intensity: 1.0, drag: 3, stretch: 0.03, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
          for (; n > 0; n--) { this._cone(_e1, _UP, 1); const sp = this._rr(2, 4.5) * s; this._emit(T, p.x, p.y, p.z, _e1.x * sp, _e1.y * sp, _e1.z * sp); }
        }
        if (this._rate(st, 'a', 24, dt)) {
          this._cone(_t1, _UP, 1);
          const A = p.clone().addScaledVector(_t1, 0.05 * s);
          this._cone(_t2, _t1, 0.45);
          const B = A.clone().addScaledVector(_t2, this._rr(0.25, 0.42) * s);
          this._bolt(A, B, { width: 0.03 * s, color: COL.elec, levels: 3, disp: 0.3, branches: 0, life: 0.07, env: 'arc' });
        }
        n = this._rate(st, 'g', 30, dt);
        if (n) {
          const T = this._T({ cell: C.glow, ramp: 'elec', life: 0.2, lifeVar: 0.3, size: 0.22 * s, sizeEnd: 0.05 * s, intensity: 0.5, fadeIn: 0, fadeOut: 0.8 });
          for (; n > 0; n--) this._emit(T, p.x, p.y, p.z);
        }
        break;
      default: break;
    }
  }

  _projEnd(st) {
    if (st.data.mesh) this._arrowRelease(st.data.mesh);
    if (st.data.crystal) st.data.crystal.alive = false;
    if (st.data.core) st.data.core.dur = 0;
  }

  _projImpact(kind, p, dir, s) {
    switch (kind) {
      case 'arrow': this.hitSpark(p, { color: 0xffe6b0, dir, scale: 0.7 * s }); break;
      case 'fireball': this._explosion(p, s * 0.8); break;
      case 'iceShard': this._iceBurst(p, s * 0.8, dir); break;
      case 'darkOrb': this._darkBurst(p, s * 0.8); break;
      case 'holyOrb': this._holyBurst(p, s * 0.8); break;
      case 'boltOrb': this._elecBurst(p, s * 0.8); break;
      default: break;
    }
  }

  // ================================================================= reusable bursts
  _castFlare(p, K, s) {
    this._glow(p, K.color, 0.2 * s, 0.75 * s, 0.32, 1.1);
    this._glow(p, 0xffffff, 0.1 * s, 0.35 * s, 0.18, 1.4);
    this._emit(this._T({ cell: C.star, life: 0.25, lifeVar: 0, size: 0.7 * s, sizeEnd: 0.1 * s, sizeVar: 0, color: K.core, intensity: 1.4, rotVar: 0.3, spin: 3, fadeIn: 0, fadeOut: 0.6 }), p.x, p.y, p.z);
    const sp = this._T({ cell: C.spark, ramp: K.ramp, life: 0.3, lifeVar: 0.4, size: 0.035 * s, intensity: 0.9, drag: 4, stretch: 0.03, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
    this._spray(sp, p, 10, _UP, 1, 1.5 * s, 3.5 * s);
  }

  /** Motes converging on `p` (charge-up). */
  _gather(p, K, s, n, radius, life, delayVar = 0.2) {
    const T = this._T({ cell: C.glow, ramp: K.ramp, life, lifeVar: 0.2, size: 0.1 * s, sizeEnd: 0.04 * s, intensity: 0.8, attract: 14 * s, target: p, killDist: 0.07 * s, drag: 2.5, stretch: 0.02, fadeIn: 0.25, fadeOut: 0.2, rotVar: 0, delayVar });
    for (let i = 0; i < n; i++) {
      this._cone(_e1, _UP, 1);
      const r = radius * this._rr(0.6, 1) * s;
      this._emit(T, p.x + _e1.x * r, p.y + _e1.y * r, p.z + _e1.z * r, -_e1.z * 0.8 * s, 0, _e1.x * 0.8 * s);
    }
  }

  _feathers(p, s, n, color = 0xfff6e0) {
    const T = this._T({ cell: C.feather, blend: 0.5, color, intensity: 1.3, life: 1.4, lifeVar: 0.3, size: 0.2 * s, sizeVar: 0.3, gravity: 0.6, drag: 3.5, wobble: 1.0, wobbleFreq: 4, spinVar: 2.5, fadeIn: 0.05, fadeOut: 0.4 });
    this._spray(T, p, n, _UP, 0.8, 1.5 * s, 3.5 * s, 0.1 * s);
  }

  _explosion(pos, s, groundY) {
    const gy = groundY ?? pos.y - 0.55;
    const p = this._towardCam(v3(pos), 0.18 * s);
    this._glow(p, 0xfff4dc, 0.45 * s, 1.3 * s, 0.15, 1.4);
    this._glow(p, COL.fire, 0.7 * s, 1.7 * s, 0.34, 0.55);
    this._flash(p, 0xffa040, 7, 0.4);
    const puffs = this._T({ cell: C.fire, ramp: 'fire', blend: 0.5, life: 0.65, lifeVar: 0.3, size: 0.36 * s, sizeEnd: 0.85 * s, sizeVar: 0.3, intensity: 0.6, drag: 4.5, gravity: -1.6, spinVar: 2.5, fadeIn: 0.04, fadeOut: 0.6 });
    this._spray(puffs, p, 28, _UP, 1, 1.6 * s, 4.2 * s, 0.16 * s);
    const core = this._T({ cell: C.glow, ramp: 'fire', life: 0.3, lifeVar: 0.25, size: 0.45 * s, sizeEnd: 0.8 * s, intensity: 0.45, drag: 5, fadeIn: 0, fadeOut: 0.7 });
    this._spray(core, p, 5, _UP, 1, 0.5 * s, 1.5 * s);
    const embers = this._T({ cell: C.spark, ramp: 'fire', life: 0.75, lifeVar: 0.4, size: 0.045 * s, sizeVar: 0.4, intensity: 1.0, gravity: 5.5, drag: 1.6, stretch: 0.035, fadeIn: 0, fadeOut: 0.4, rotVar: 0, floorY: gy + 0.02, bounce: 0.25 });
    this._spray(embers, p, 26, _UP, 0.75, 3 * s, 7.5 * s);
    const smoke = this._T({ cell: C.smoke, blend: 0, color: 0x3a2d28, color2: 0x1c1614, alpha: 0.5, life: 1.25, lifeVar: 0.3, size: 0.45 * s, sizeEnd: 1.25 * s, sizeVar: 0.3, gravity: -0.9, drag: 2, spinVar: 0.8, fadeIn: 0.2, fadeOut: 0.6, delay: 0.1, delayVar: 0.15 });
    this._spray(smoke, p, 10, _UP, 0.7, 0.4 * s, 1.4 * s, 0.15 * s);
    this._ring({ x: p.x, y: gy, z: p.z }, { r0: 0.3 * s, r1: 2.0 * s, life: 0.45, color: COL.fire, core: COL.fireHot, intensity: 1.8, width: 0.35, noise: 0.7 });
    this._emit(this._T({ cell: C.ring, life: 0.2, lifeVar: 0, size: 0.3 * s, sizeEnd: 1.8 * s, sizeVar: 0, color: COL.fireHot, intensity: 0.55, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
  }

  _iceBurst(pos, s, dir) {
    const p = this._towardCam(v3(pos), 0.15 * s);
    this._glow(p, 0xffffff, 0.3 * s, 1.1 * s, 0.13, 1.7);
    this._glow(p, COL.ice, 0.6 * s, 1.6 * s, 0.3, 0.9);
    this._flash(p, 0x9fdcff, 4, 0.3);
    const shards = this._T({ cell: C.shard, blend: 0.45, color: 0xdff6ff, intensity: 1.2, life: 0.6, lifeVar: 0.3, size: 0.12 * s, sizeEnd: 0.07 * s, sizeVar: 0.4, gravity: 7, drag: 1.5, spinVar: 10, fadeIn: 0, fadeOut: 0.35 });
    this._spray(shards, p, 18, dir || _UP, dir ? 0.55 : 1, 2 * s, 5 * s);
    const mist = this._T({ cell: C.glow, ramp: 'ice', life: 0.45, lifeVar: 0.3, size: 0.25 * s, sizeEnd: 0.6 * s, intensity: 0.45, drag: 4, fadeIn: 0, fadeOut: 0.8 });
    this._spray(mist, p, 10, _UP, 1, 0.5 * s, 1.5 * s);
    const flakes = this._T({ cell: C.flake, blend: 0.6, color: 0xf2fbff, intensity: 1.1, life: 0.9, lifeVar: 0.3, size: 0.08 * s, sizeEnd: 0.03 * s, gravity: 1.2, drag: 2.5, spinVar: 3, wobble: 0.5, fadeIn: 0, fadeOut: 0.5 });
    this._spray(flakes, p, 14, _UP, 1, 1 * s, 3 * s);
    this._emit(this._T({ cell: C.ring, life: 0.25, lifeVar: 0, size: 0.3 * s, sizeEnd: 1.6 * s, sizeVar: 0, color: COL.ice, intensity: 1.2, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
  }

  _darkBurst(pos, s) {
    const p = this._towardCam(v3(pos), 0.15 * s);
    this._glow(p, 0xf0d0ff, 0.3 * s, 1.0 * s, 0.14, 1.4);
    this._glow(p, COL.dark, 0.7 * s, 1.9 * s, 0.38, 0.85);
    this._flash(p, 0xa050ff, 4, 0.35);
    const wisps = this._T({ cell: C.wisp, blend: 0.05, over: true, color: 0x1a0530, alpha: 0.6, life: 0.8, lifeVar: 0.3, size: 0.35 * s, sizeEnd: 0.9 * s, drag: 3.5, gravity: -0.5, spinVar: 2, fadeIn: 0.05, fadeOut: 0.6 });
    this._spray(wisps, p, 12, _UP, 1, 1.5 * s, 3 * s);
    const flame = this._T({ cell: C.fire, ramp: 'dfire', life: 0.45, lifeVar: 0.3, size: 0.3 * s, sizeEnd: 0.7 * s, intensity: 0.7, drag: 4, gravity: -1, spinVar: 2, fadeIn: 0.04, fadeOut: 0.6 });
    this._spray(flame, p, 16, _UP, 1, 1.2 * s, 3 * s);
    const sparks = this._T({ cell: C.spark, ramp: 'dfire', life: 0.5, lifeVar: 0.4, size: 0.04 * s, intensity: 1.0, drag: 2, gravity: 2, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
    this._spray(sparks, p, 20, _UP, 1, 3 * s, 6.5 * s);
    this._emit(this._T({ cell: C.ring, life: 0.3, lifeVar: 0, size: 0.3 * s, sizeEnd: 2.0 * s, sizeVar: 0, color: 0xc070ff, intensity: 1.2, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
  }

  _holyBurst(pos, s) {
    const p = this._towardCam(v3(pos), 0.15 * s);
    this._glow(p, 0xffffff, 0.35 * s, 1.1 * s, 0.15, 1.4);
    this._glow(p, COL.holy, 0.6 * s, 1.5 * s, 0.32, 0.6);
    this._emit(this._T({ cell: C.star, life: 0.35, lifeVar: 0, size: 1.6 * s, sizeEnd: 0.4 * s, sizeVar: 0, color: 0xffffff, color2: COL.holy, intensity: 1.2, rotVar: 0.2, spin: 1.5, fadeIn: 0, fadeOut: 0.7 }), p.x, p.y, p.z);
    this._flash(p, 0xffe2a0, 5, 0.35);
    const sp = this._T({ cell: C.star, color: 0xfff3c8, intensity: 1.5, life: 0.7, lifeVar: 0.4, size: 0.16 * s, sizeEnd: 0.03 * s, drag: 3, gravity: 0.6, twinkle: 25, spinVar: 4, fadeIn: 0, fadeOut: 0.5 });
    this._spray(sp, p, 22, _UP, 1, 1.5 * s, 4 * s);
    this._emit(this._T({ cell: C.ring, life: 0.3, lifeVar: 0, size: 0.35 * s, sizeEnd: 1.8 * s, sizeVar: 0, color: COL.holy, intensity: 0.7, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
  }

  _elecBurst(pos, s) {
    const p = this._towardCam(v3(pos), 0.15 * s);
    this._glow(p, 0xffffff, 0.35 * s, 1.2 * s, 0.12, 2.0);
    this._glow(p, COL.elec, 0.7 * s, 1.8 * s, 0.3, 0.9);
    this._flash(p, 0xb8d4ff, 5, 0.3);
    const sp = this._T({ cell: C.spark, ramp: 'elec', life: 0.35, lifeVar: 0.4, size: 0.045 * s, intensity: 1.1, drag: 3, gravity: 4, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
    this._spray(sp, p, 26, _UP, 1, 3 * s, 8 * s);
    for (let i = 0; i < 5; i++) {
      this._cone(_t1, _UP, 1);
      const B = p.clone().addScaledVector(_t1, this._rr(0.5, 0.9) * s);
      this._bolt(p, B, { width: 0.045 * s, color: COL.elec, levels: 4, disp: 0.22, branches: 1, life: this._rr(0.12, 0.2), env: 'arc' });
    }
    this._crackle(p, 0.6 * s, 0.35, { rate: 20, width: 0.03 * s });
    this._emit(this._T({ cell: C.ring, life: 0.22, lifeVar: 0, size: 0.3 * s, sizeEnd: 1.8 * s, sizeVar: 0, color: COL.elec, intensity: 1.3, fadeIn: 0, fadeOut: 1, sizeMode: 2, rotVar: 0 }), p.x, p.y, p.z);
  }

  // ================================================================= spells
  /**
   * Casts a spell effect. Resolves when it has fully played; `onImpact` fires exactly once at the
   * moment damage/healing should be shown.
   * @param {'flame'|'inferno'|'frost'|'blizzard'|'bolt'|'tempest'|'holy'|'nova'|'heal'|'healAll'|'dark'|'drain'|'dragonFang'|'breath'|'summon'} name
   * @param {{from?: THREE.Vector3, to?: THREE.Vector3, ground?: THREE.Vector3, onImpact?: Function, scale?: number}} [opts]
   *   from = caster chest, to = target chest, ground = target feet (default to.y - 0.55),
   *   scale = size multiplier (≈1.5 on the tactical map).
   * @returns {Promise<void>}
   */
  spell(name, opts = {}) {
    const m = SPELLS[name];
    const ctx = this._ctx(opts.onImpact);
    if (!m) {
      console.warn(`[vfx] unknown spell "${name}"`);
      ctx.finish();
      return ctx.promise;
    }
    const s = opts.scale ?? 1;
    let from = opts.from ? v3(opts.from) : null;
    let to = opts.to ? v3(opts.to) : null;
    if (!from && !to) { from = new THREE.Vector3(-1.6, 0.55, 0); to = new THREE.Vector3(1.6, 0.55, 0); }
    else if (!from) from = to.clone().add(new THREE.Vector3(-3.2, 0, 0));
    else if (!to) to = from.clone().add(new THREE.Vector3(3.2, 0, 0));
    const ground = opts.ground ? v3(opts.ground) : new THREE.Vector3(to.x, to.y - 0.55, to.z);
    this[m]({ from, to, ground, s, ctx, opts });
    return ctx.promise;
  }

  _spFlame({ from, to, ground, s, ctx }) {
    this._castFlare(from, KIND.fire, s);
    const travel = THREE.MathUtils.clamp(from.distanceTo(to) / 7.5, 0.32, 0.62);
    this._after(0.08, () => this._fly('fireball', from, to, {
      s, travel, arc: 0.12,
      onArrive: (p) => { this._explosion(p, s, ground.y); ctx.impact(); },
    }));
    this._after(0.08 + travel + 1.1, ctx.finish);
  }

  _spInferno({ from, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.fire, s);
    this.magicCircle(g, { color: 0xff7a2a, radius: 1.25 * s, duration: 1.25, intensity: 1.4 });
    const rim = this._acc(), emb = this._acc();
    const rimT = { cell: C.fire, ramp: 'fire', life: 0.45, lifeVar: 0.3, size: 0.18 * s, sizeEnd: 0.35 * s, intensity: 0.7, gravity: -3, drag: 1.5, rotVar: 0.4, fadeIn: 0.1, fadeOut: 0.6 };
    const embT = { cell: C.spark, ramp: 'fire', life: 0.9, lifeVar: 0.4, size: 0.035 * s, intensity: 0.9, gravity: -1.5, drag: 0.8, stretch: 0.03, wobble: 0.6, fadeIn: 0.1, fadeOut: 0.5, rotVar: 0 };
    this._emitFor(0.1, 0.5, (t, dt) => {
      let n = rim(40 + t * 90, dt);
      if (n) {
        const T = this._T(rimT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = 1.1 * s * this._rr(0.9, 1.0); this._emit(T, g.x + Math.cos(a) * r, g.y + 0.05, g.z + Math.sin(a) * r, 0, this._rr(0.5, 1.2) * s, 0); }
      }
      n = emb(30, dt);
      if (n) {
        const T = this._T(embT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = 1.1 * s * Math.sqrt(this.rand()); this._emit(T, g.x + Math.cos(a) * r, g.y + 0.05, g.z + Math.sin(a) * r, 0, this._rr(1, 2.5) * s, 0); }
      }
    });
    const tE = 0.58;
    this._after(tE, () => {
      this._pillar(g, { mode: 'fire', radius: 0.62 * s, height: 4.2 * s, color: 0xff4a10, core: 0xffd890, intensity: 0.6, speed: 2.4, life: 0.8, fadeIn: 0.05, fadeOut: 0.45, revealTime: 0.14, edge: 1.1, top: 0.45, bot: 0.04, radiusFn: (k) => 0.75 + 0.35 * easeOutCubic(Math.min(1, k * 4)) });
      this._pillar(g, { radius: 0.3 * s, height: 3.6 * s, color: 0xffb040, core: 0xfff4d0, intensity: 0.5, speed: 3, life: 0.5, fadeIn: 0.04, fadeOut: 0.3, revealTime: 0.1 });
      this._flash(new THREE.Vector3(g.x, g.y + 1, g.z), 0xff8a30, 10, 0.6);
      this._glow({ x: g.x, y: g.y + 0.6 * s, z: g.z }, 0xfff0c0, 0.6 * s, 1.8 * s, 0.22, 0.9);
      this._ring(g, { r0: 0.4 * s, r1: 2.4 * s, life: 0.5, color: COL.fire, core: COL.fireHot, intensity: 1.3, width: 0.35, noise: 0.8 });
      this._ring(g, { r0: 0.2 * s, r1: 1.5 * s, life: 0.8, color: 0xff3a10, core: 0xffc060, intensity: 0.45, width: 0, fill: 1.0, noise: 0.3 });
      const wave = this._T({ cell: C.fire, ramp: 'fire', life: 0.55, lifeVar: 0.3, size: 0.35 * s, sizeEnd: 0.7 * s, intensity: 0.7, drag: 2.8, gravity: -1.2, rotVar: 0.5, fadeIn: 0.05, fadeOut: 0.6 });
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * 6.283 + this.rand() * 0.2, sp = this._rr(3.5, 5) * s;
        this._emit(wave, g.x + Math.cos(a) * 0.4 * s, g.y + 0.12 * s, g.z + Math.sin(a) * 0.4 * s, Math.cos(a) * sp, 0.4 * s, Math.sin(a) * sp);
      }
      const embers = this._T({ cell: C.spark, ramp: 'fire', life: 0.9, lifeVar: 0.4, size: 0.045 * s, intensity: 1.0, gravity: 4, drag: 1.2, stretch: 0.035, fadeIn: 0, fadeOut: 0.4, rotVar: 0, floorY: g.y + 0.02, bounce: 0.3 });
      this._spray(embers, { x: g.x, y: g.y + 0.3 * s, z: g.z }, 30, _UP, 0.45, 4 * s, 9 * s);
      ctx.impact();
    });
    const col = this._acc();
    const colT = { cell: C.fire, ramp: 'fire', blend: 0.55, life: 0.55, lifeVar: 0.3, size: 0.4 * s, sizeEnd: 0.9 * s, sizeVar: 0.3, intensity: 0.42, drag: 0.6, gravity: -2, rotVar: 0.5, spinVar: 1, fadeIn: 0.05, fadeOut: 0.55 };
    this._emitFor(tE, 0.7, (t, dt) => {
      let n = col(t < 0.45 ? 75 : 35, dt);
      if (!n) return;
      const T = this._T(colT);
      for (; n > 0; n--) {
        const a = this.rand() * 6.283, r = 0.45 * s * Math.sqrt(this.rand());
        this._emit(T, g.x + Math.cos(a) * r, g.y + 0.1, g.z + Math.sin(a) * r, Math.cos(a) * 0.3 * s, this._rr(4, 7.5) * s, Math.sin(a) * 0.3 * s);
      }
    });
    this._after(tE + 0.45, () => {
      const T = this._T({ cell: C.smoke, blend: 0, color: 0x3a2d28, color2: 0x1a1412, alpha: 0.45, life: 1.2, lifeVar: 0.3, size: 0.5 * s, sizeEnd: 1.4 * s, gravity: -1.2, drag: 1.2, spinVar: 0.8, fadeIn: 0.25, fadeOut: 0.6, delayVar: 0.3 });
      for (let i = 0; i < 14; i++) {
        const a = this.rand() * 6.283, r = 0.6 * s * this.rand();
        this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.3, 1.8) * s, g.z + Math.sin(a) * r, Math.cos(a) * 0.3, this._rr(0.6, 1.4) * s, Math.sin(a) * 0.3);
      }
    });
    this._after(1.95, ctx.finish);
  }

  /** Ice spike erupting at `base`, shattering after `hold` seconds. */
  _spike(base, o) {
    const s = o.s ?? 1;
    const H = o.height, r = o.radius;
    const delay = o.delay ?? 0, erupt = o.erupt ?? 0.09, hold = o.hold ?? 0.6;
    const quat = new THREE.Quaternion().setFromAxisAngle(_UP, this.rand() * 6.283);
    if (o.tilt && o.tiltDir) {
      const ax = new THREE.Vector3().crossVectors(_UP, o.tiltDir).normalize();
      quat.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, o.tilt));
    }
    let c = null, t = 0;
    this._task((dt) => {
      t += dt;
      const te = t - delay;
      if (te < 0) return true;
      if (!c) {
        c = this._crystalNew();
        if (!c) return false;
        c.pos.copy(base);
        c.quat.copy(quat);
        this._spikeDust(base, s, r);
      }
      if (!c.alive) return false;
      const k = Math.min(1, te / erupt);
      const h = te < erupt ? easeOutBack(k, 2.4) : 1;
      const wr = r * (0.5 + 0.5 * Math.min(1, k * 1.6));
      c.scale.set(wr, Math.max(1e-4, H * h), wr);
      c.flash = te < erupt ? 0.4 : Math.max(0, 0.4 - (te - erupt) / 0.1) + 0.04 * Math.sin(te * 9) ** 2;
      if (te >= hold) { c.alive = false; this._shatter(base, quat, H, r, s); return false; }
      return true;
    });
  }

  _spikeDust(base, s, r) {
    const k = r / (0.13 * s);
    this._glow({ x: base.x, y: base.y + 0.08 * s, z: base.z }, 0xe8fbff, 0.12 * s * k, 0.5 * s * k, 0.2, 0.45);
    const T = this._T({ cell: C.glow, ramp: 'ice', life: 0.35, lifeVar: 0.3, size: 0.12 * s, sizeEnd: 0.03 * s, intensity: 0.7, drag: 4, gravity: 3, fadeIn: 0, fadeOut: 0.6 });
    this._spray(T, base, 5, _UP, 0.45, 1 * s, 2.5 * s);
    const sm = this._T({ cell: C.smoke, blend: 0.4, color: 0xdff4ff, alpha: 0.35, life: 0.6, lifeVar: 0.3, size: 0.15 * s * k, sizeEnd: 0.45 * s * k, drag: 3, fadeIn: 0.1, fadeOut: 0.6 });
    this._spray(sm, base, 3, _UP, 0.5, 0.4 * s, 1 * s);
  }

  _shatter(base, quat, H, r, s) {
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const k = r / (0.13 * s);
    const n = Math.round(5 + (H / s) * 7);
    const T = this._T({ cell: C.shard, blend: 0.4, color: 0xd9f4ff, intensity: 1.15, life: 0.9, lifeVar: 0.3, size: 0.13 * s * k, sizeEnd: 0.07 * s * k, sizeVar: 0.45, gravity: 8, drag: 0.8, spinVar: 9, floorY: base.y + 0.03, bounce: 0.28, fadeIn: 0, fadeOut: 0.3 });
    for (let i = 0; i < n; i++) {
      const h = this.rand() * H;
      this._cone(_e1, _UP, 0.55);
      const sp = this._rr(1.2, 3.2) * s;
      this._emit(T, base.x + axis.x * h, base.y + axis.y * h, base.z + axis.z * h, _e1.x * sp, _e1.y * sp * 0.8 + 1.2 * s, _e1.z * sp);
    }
    const G = this._T({ cell: C.plus, color: 0xffffff, intensity: 1.6, life: 0.4, lifeVar: 0.3, size: 0.22 * s, sizeEnd: 0.02 * s, drag: 3, fadeIn: 0, fadeOut: 0.6, rotVar: 0.3 });
    for (let i = 0; i < 3; i++) { const h = this.rand() * H; this._emit(G, base.x + axis.x * h, base.y + axis.y * h, base.z + axis.z * h); }
    const M = this._T({ cell: C.smoke, blend: 0.35, color: 0xe6f7ff, alpha: 0.3, life: 0.8, lifeVar: 0.3, size: 0.2 * s * k, sizeEnd: 0.6 * s * k, drag: 2.5, gravity: -0.2, fadeIn: 0.05, fadeOut: 0.6 });
    for (let i = 0; i < 2; i++) { const h = this.rand() * H * 0.8; this._emit(M, base.x + axis.x * h, base.y + axis.y * h, base.z + axis.z * h, (this.rand() - 0.5) * 0.5, 0.2, (this.rand() - 0.5) * 0.5); }
  }

  _iceImpact(chest, g, s) {
    this._glow(chest, 0xffffff, 0.25 * s, 0.9 * s, 0.13, 1.1);
    this._glow({ x: g.x, y: g.y + 0.3 * s, z: g.z }, COL.ice, 0.6 * s, 1.5 * s, 0.35, 0.45);
    this._flash(new THREE.Vector3(g.x, g.y + 1, g.z), 0x9fdcff, 6, 0.45);
    this._ring(g, { r0: 0.3 * s, r1: 1.9 * s, life: 0.45, color: COL.ice, core: 0xffffff, intensity: 1.6, width: 0.3, noise: 0.6 });
    const mist = this._T({ cell: C.smoke, blend: 0.3, color: 0xcfefff, alpha: 0.2, life: 0.9, lifeVar: 0.3, size: 0.3 * s, sizeEnd: 0.9 * s, drag: 3, gravity: -0.3, spinVar: 1, fadeIn: 0.15, fadeOut: 0.6 });
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * 6.283, sp = this._rr(1, 2.2) * s;
      this._emit(mist, g.x, g.y + 0.1 * s, g.z, Math.cos(a) * sp, 0.3 * s, Math.sin(a) * sp);
    }
    const flakes = this._T({ cell: C.flake, blend: 0.6, color: 0xf2fbff, intensity: 1.1, life: 1.0, lifeVar: 0.3, size: 0.08 * s, sizeEnd: 0.03 * s, gravity: 0.8, drag: 2, spinVar: 3, wobble: 0.6, fadeIn: 0, fadeOut: 0.5 });
    this._spray(flakes, { x: g.x, y: g.y + 0.4 * s, z: g.z }, 20, _UP, 0.6, 1.5 * s, 3.5 * s);
  }

  _spikeRing(g, s, n, r0, r1, h0, h1, rad0, rad1, tilt0, tilt1, delay, jitter, shatterAt) {
    const ph = this.rand() * 6.283;
    for (let i = 0; i < n; i++) {
      const a = ph + (i / n) * 6.283 + (this.rand() - 0.5) * 0.45;
      const r = this._rr(r0, r1) * s;
      const d = delay + this.rand() * jitter;
      this._spike(new THREE.Vector3(g.x + Math.cos(a) * r, g.y - 0.02, g.z + Math.sin(a) * r), {
        s, height: this._rr(h0, h1) * s, radius: this._rr(rad0, rad1) * s,
        tiltDir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), tilt: this._rr(tilt0, tilt1),
        delay: d, hold: shatterAt - d,
      });
    }
  }

  _spFrost({ from, to, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.ice, s);
    this._ring(g, { r0: 1.2 * s, r1: 0.7 * s, life: 0.55, color: COL.ice, core: 0xffffff, intensity: 1.0, width: 0.6, noise: 0.8, fill: 0.5, alphaFn: (k) => Math.min(1, k / 0.3) * (1 - k * 0.5) });
    const motes = this._T({ cell: C.flake, blend: 0.7, color: 0xeaf9ff, intensity: 1.1, life: 0.5, lifeVar: 0.2, size: 0.07 * s, sizeEnd: 0.04 * s, attract: 10 * s, target: g, killDist: 0.15 * s, drag: 2, spinVar: 4, fadeIn: 0.3, fadeOut: 0.2 });
    for (let i = 0; i < 26; i++) {
      const a = this.rand() * 6.283, r = this._rr(0.8, 1.4) * s;
      this._emit(motes, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.6) * s, g.z + Math.sin(a) * r, -Math.sin(a) * 1.2 * s, 0, Math.cos(a) * 1.2 * s);
    }
    const tE = 0.42;
    this._spikeRing(g, s, 7, 0.26, 0.5, 0.75, 1.25, 0.11, 0.16, 0.15, 0.45, tE, 0.07, tE + 0.62);
    this._spikeRing(g, s, 6, 0.65, 0.9, 0.3, 0.55, 0.07, 0.1, 0.4, 0.75, tE + 0.05, 0.06, tE + 0.6);
    this._after(tE + 0.06, () => { this._iceImpact(to, g, s); ctx.impact(); });
    this._after(tE + 1.35, ctx.finish);
  }

  _spBlizzard({ from, to, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.ice, s);
    this.magicCircle(g, { color: 0x8fdcff, radius: 1.5 * s, duration: 1.4, intensity: 1.1 });
    const snow = this._acc(), wind = this._acc(), mist = this._acc();
    const snowT = { cell: C.flake, blend: 0.65, color: 0xf2fbff, intensity: 1.05, life: 1.0, lifeVar: 0.3, size: 0.075 * s, sizeEnd: 0.05 * s, sizeVar: 0.4, swirl: 4.5, swirlVar: 0.35, cx: g.x, cz: g.z, radialVel: -0.15 * s, spinVar: 5, fadeIn: 0.15, fadeOut: 0.35 };
    const windT = { cell: C.spark, color: 0xeaf8ff, intensity: 0.9, life: 0.45, lifeVar: 0.3, size: 0.035 * s, sizeVar: 0.3, swirl: 7.5, swirlVar: 0.25, cx: g.x, cz: g.z, stretch: 0.05, fadeIn: 0.2, fadeOut: 0.5, rotVar: 0 };
    const mistT = { cell: C.smoke, blend: 0.3, color: 0xcdeeff, alpha: 0.22, life: 1.2, lifeVar: 0.3, size: 0.6 * s, sizeEnd: 1.1 * s, swirl: 2.2, swirlVar: 0.3, cx: g.x, cz: g.z, spinVar: 0.6, fadeIn: 0.3, fadeOut: 0.5 };
    this._emitFor(0, 1.35, (t, dt) => {
      let n = snow(150, dt);
      if (n) {
        const T = this._T(snowT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.4, 1.6) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 1.9) * s, g.z + Math.sin(a) * r, 0, this._rr(-0.6, 0.6) * s, 0); }
      }
      n = wind(90, dt);
      if (n) {
        const T = this._T(windT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.5, 1.5) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.1, 1.6) * s, g.z + Math.sin(a) * r, 0, this._rr(0.2, 1.0) * s, 0); }
      }
      n = mist(14, dt);
      if (n) {
        const T = this._T(mistT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.3, 1.2) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.1, 0.9) * s, g.z + Math.sin(a) * r, 0, 0.1 * s, 0); }
      }
    });
    this._spikeRing(g, s, 7, 0.75, 1.25, 0.5, 0.85, 0.1, 0.15, 0.1, 0.5, 0.72, 0.06, 1.34);
    this._spikeRing(g, s, 7, 0.25, 0.6, 0.8, 1.3, 0.11, 0.16, 0.1, 0.45, 0.85, 0.06, 1.36);
    this._after(0.9, () => { this._iceImpact(to, g, s * 1.15); ctx.impact(); });
    this._after(1.98, ctx.finish);
  }

  _strike(g, s, o = {}) {
    const k = o.big ? 1.2 : o.small ? 0.75 : 1;
    const top = new THREE.Vector3(g.x + (this.rand() - 0.5) * 1.4 * s, g.y + 9 * s, g.z + (this.rand() - 0.5) * 0.8 * s);
    this._bolt(top, new THREE.Vector3(g.x, g.y, g.z), { width: 0.13 * s * k, color: o.color ?? COL.elec, levels: 6, disp: 0.09, branches: 6, life: 0.38, regen: [0.07, 0.15], env: 'strike', taper: 0.5 });
    const hit = { x: g.x, y: g.y + 0.15 * s, z: g.z };
    this._glow(hit, 0xffffff, 0.4 * s * k, 1.4 * s * k, 0.18, 1.3);
    this._glow({ x: g.x, y: g.y + 0.6 * s, z: g.z }, COL.elec, 0.8 * s * k, 2.0 * s * k, 0.35, 0.45);
    this._flash(new THREE.Vector3(g.x, g.y + 1.2, g.z), 0xcfe0ff, 12 * k, 0.4);
    this._ring(g, { r0: 0.2 * s, r1: 2.0 * s * k, life: 0.42, color: COL.elec, core: 0xffffff, intensity: 2.0, width: 0.25, noise: 0.8 });
    this._ring(g, { r0: 0.3 * s, r1: 0.9 * s * k, life: 0.45, color: 0x5a78ff, core: 0xd8e8ff, intensity: 0.4, width: 0, fill: 1.2, noise: 0.4 });
    const sp = this._T({ cell: C.spark, ramp: 'elec', life: 0.5, lifeVar: 0.4, size: 0.05 * s, sizeVar: 0.4, intensity: 1.1, gravity: 9, drag: 1.2, stretch: 0.035, fadeIn: 0, fadeOut: 0.4, rotVar: 0, floorY: g.y + 0.02, bounce: 0.35 });
    this._spray(sp, hit, Math.round(34 * k), _UP, 0.5, 3 * s, 8 * s);
    const sm = this._T({ cell: C.smoke, blend: 0, color: 0x3a3c48, alpha: 0.4, life: 1.0, lifeVar: 0.3, size: 0.3 * s, sizeEnd: 0.9 * s, gravity: -0.8, drag: 2, spinVar: 1, fadeIn: 0.2, fadeOut: 0.6, delay: 0.08 });
    this._spray(sm, hit, 6, _UP, 0.6, 0.4 * s, 1.2 * s, 0.1 * s);
    this._crackle(new THREE.Vector3(g.x, g.y + 0.35 * s, g.z), 0.7 * s, 0.5, { rate: 28, width: 0.03 * s, delay: 0.05, floorY: g.y });
  }

  _spBolt({ from, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.elec, s);
    this._crackle(from, 0.35 * s, 0.35, { rate: 26, width: 0.025 * s });
    const chargeT = { cell: C.spark, ramp: 'elec', life: 0.3, lifeVar: 0.3, size: 0.03 * s, intensity: 0.8, stretch: 0.03, drag: 1, fadeIn: 0.2, fadeOut: 0.5, rotVar: 0 };
    const ch = this._acc();
    this._emitFor(0.05, 0.35, (t, dt) => {
      let n = ch(45, dt);
      if (!n) return;
      const T = this._T(chargeT);
      for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.2, 0.7) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + 0.05, g.z + Math.sin(a) * r, 0, this._rr(2, 4) * s, 0); }
    });
    this._ring(g, { r0: 0.9 * s, r1: 0.5 * s, life: 0.45, color: COL.elec, core: 0xffffff, intensity: 0.9, width: 0.5, noise: 0.9, fill: 0.4, alphaFn: (k) => Math.min(1, k / 0.3) });
    this._after(0.28, () => this._bolt(
      new THREE.Vector3(g.x + (this.rand() - 0.5) * s, g.y + 8 * s, g.z),
      new THREE.Vector3(g.x, g.y + this._rr(1.0, 2.0) * s, g.z),
      { width: 0.05 * s, color: COL.elec, levels: 5, disp: 0.12, branches: 2, life: 0.12, env: 'leader' }));
    this._after(0.42, () => { this._strike(g, s, { big: true }); ctx.impact(); });
    this._after(1.25, ctx.finish);
  }

  _spTempest({ from, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.elec, s);
    this._ring(g, { r0: 1.6 * s, r1: 1.2 * s, life: 1.5, color: 0x9fd0ff, core: 0xffffff, intensity: 0.8, width: 0.35, noise: 0.9, alphaFn: (k) => Math.min(1, k / 0.15) * (1 - smoothstep(0.7, 1, k)) });
    const wind = this._acc(), leaf = this._acc(), dust = this._acc();
    const windT = { cell: C.spark, color: 0xe2f4ff, intensity: 0.9, life: 0.55, lifeVar: 0.3, size: 0.035 * s, sizeVar: 0.3, swirl: 7, swirlVar: 0.3, cx: g.x, cz: g.z, radialVel: 0.25 * s, stretch: 0.055, fadeIn: 0.2, fadeOut: 0.5, rotVar: 0 };
    const leafT = { cell: C.leaf, blend: 0, color: 0x7bc24f, color2: 0x4e9a3a, life: 1.1, lifeVar: 0.3, size: 0.11 * s, sizeVar: 0.3, swirl: 4.5, swirlVar: 0.3, cx: g.x, cz: g.z, radialVel: 0.35 * s, spinVar: 7, fadeIn: 0.1, fadeOut: 0.3 };
    const dustT = { cell: C.smoke, blend: 0, color: 0x8d8170, alpha: 0.25, life: 1.0, lifeVar: 0.3, size: 0.4 * s, sizeEnd: 1.0 * s, swirl: 3, cx: g.x, cz: g.z, radialVel: 0.4 * s, spinVar: 0.8, fadeIn: 0.2, fadeOut: 0.6 };
    this._emitFor(0, 1.45, (t, dt) => {
      let n = wind(110, dt);
      if (n) {
        const T = this._T(windT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.5, 1.7) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0, 1.4) * s, g.z + Math.sin(a) * r, 0, this._rr(0.6, 1.8) * s, 0); }
      }
      n = leaf(16, dt);
      if (n) {
        const T = this._T(leafT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.4, 1.2) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + 0.1 * s, g.z + Math.sin(a) * r, 0, this._rr(1, 2.2) * s, 0); }
      }
      n = dust(10, dt);
      if (n) {
        const T = this._T(dustT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.3, 1.0) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + 0.1 * s, g.z + Math.sin(a) * r, 0, 0.3 * s, 0); }
      }
    });
    for (const [tS, off] of [[0.55, 1.1], [0.7, 0.9], [0.8, 0], [0.98, 1.0], [1.15, 1.3]]) {
      this._after(tS, () => {
        const a = this.rand() * 6.283;
        this._strike(new THREE.Vector3(g.x + Math.cos(a) * off * s, g.y, g.z + Math.sin(a) * off * s * 0.6), s, { big: off === 0, small: off !== 0 });
        if (off === 0) ctx.impact();
      });
    }
    this._after(1.9, ctx.finish);
  }

  _spHoly({ from, to, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.holy, s);
    this.magicCircle(g, { color: 0xffd36e, radius: 1.05 * s, duration: 1.25, intensity: 1.4 });
    const motes = this._T({ cell: C.star, color: 0xfff1c0, intensity: 1.3, life: 0.8, lifeVar: 0.3, size: 0.12 * s, sizeEnd: 0.04 * s, twinkle: 22, spinVar: 2, fadeIn: 0.3, fadeOut: 0.4, delayVar: 0.4 });
    for (let i = 0; i < 24; i++) {
      const a = this.rand() * 6.283, r = this._rr(0.1, 0.8) * s;
      this._emit(motes, g.x + Math.cos(a) * r, g.y + this._rr(1.6, 3.0) * s, g.z + Math.sin(a) * r, 0, -this._rr(1.5, 2.8) * s, 0);
    }
    const tP = 0.55, tI = tP + 0.13;
    this._after(tP, () => {
      this._pillar(g, { radius: 0.5 * s, height: 7 * s, color: 0xffcf62, core: 0xffffff, intensity: 0.35, speed: -1.6, life: 0.95, reveal: 'down', revealTime: 0.13, fadeIn: 0.03, fadeOut: 0.4, top: 0.35, bot: 0.03, edge: 1.4, radiusFn: (k) => 1 + 0.12 * Math.sin(k * 20) * (1 - k) });
      this._pillar(g, { radius: 0.2 * s, height: 7 * s, color: 0xfff2c8, core: 0xffffff, intensity: 0.45, speed: -2.5, life: 0.75, reveal: 'down', revealTime: 0.11, fadeIn: 0.03, fadeOut: 0.35, top: 0.35, bot: 0.03, edge: 1.2 });
    });
    this._after(tI, () => {
      this._holyBurst(to, s);
      this._glow({ x: g.x, y: g.y + 0.1, z: g.z }, COL.holy, 0.5 * s, 1.6 * s, 0.45, 0.55);
      this._ring(g, { r0: 0.3 * s, r1: 2.2 * s, life: 0.55, color: COL.holy, core: 0xffffff, intensity: 1.8, width: 0.3, noise: 0.5 });
      this._feathers(to, s, 14);
      ctx.impact();
    });
    for (let i = 0; i < 3; i++) {
      this._after(tI + i * 0.12, () => this._ring(g, { r0: 0.72 * s, r1: 0.5 * s, life: 0.7, color: COL.holy, core: 0xffffff, intensity: 1.6, width: 0.14, noise: 0.2, rise: 2.0 * s, alphaFn: (k) => Math.min(1, k / 0.1) * (1 - k) }));
    }
    this._after(1.75, ctx.finish);
  }

  _spNova({ from, to, ground, s, ctx }) {
    const g = ground.clone();
    this._castFlare(from, KIND.holy, s);
    this.magicCircle(g, { color: 0xffe08a, radius: 2.0 * s, duration: 1.2, intensity: 1.2 });
    const motes = this._T({ cell: C.glow, ramp: 'holy', life: 0.6, lifeVar: 0.2, size: 0.12 * s, sizeEnd: 0.05 * s, intensity: 0.7, attract: 16 * s, target: to, killDist: 0.12 * s, drag: 2.2, stretch: 0.025, fadeIn: 0.3, fadeOut: 0.15, rotVar: 0, delayVar: 0.25 });
    for (let i = 0; i < 50; i++) {
      this._cone(_e1, _UP, 0.7);
      const r = this._rr(1.4, 2.2) * s;
      this._emit(motes, to.x + _e1.x * r, Math.max(g.y + 0.05, to.y + _e1.y * r), to.z + _e1.z * r, -_e1.z * 1.2 * s, 0, _e1.x * 1.2 * s);
    }
    const tN = 0.68;
    this._glow(to, COL.holy, 0.2 * s, 0.9 * s, tN, 0.9, { sizeMode: 1, fadeIn: 0.5, fadeOut: 0.1 });
    this._after(tN, () => {
      this._dome(g, { r0: 0.3 * s, r1: 2.4 * s, life: 0.75, color: 0xffd36e, core: 0xffffff, intensity: 0.85, rimPow: 2.2, fill: 0.07, lines: 0.7, alphaFn: (k) => Math.min(1, k / 0.06) * (1 - smoothstep(0.35, 1, k)) });
      this._glow(to, 0xffffff, 0.5 * s, 1.8 * s, 0.2, 1.3);
      this._glow({ x: g.x, y: g.y + 0.5, z: g.z }, COL.holy, 1.0 * s, 2.6 * s, 0.45, 0.45);
      this._flash(new THREE.Vector3(g.x, g.y + 1.2, g.z), 0xffe6b0, 10, 0.5);
      this._ring(g, { r0: 0.4 * s, r1: 3.0 * s, life: 0.6, color: COL.holy, core: 0xffffff, intensity: 1.8, width: 0.25, noise: 0.5 });
      const stars = this._T({ cell: C.star, color: 0xfff3c8, intensity: 1.5, life: 0.8, lifeVar: 0.3, size: 0.2 * s, sizeEnd: 0.04 * s, drag: 2.5, twinkle: 20, spinVar: 3, fadeIn: 0, fadeOut: 0.5 });
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * 6.283, sp = this._rr(3, 5) * s;
        this._emit(stars, to.x, to.y, to.z, Math.cos(a) * sp, this._rr(0.2, 2) * s, Math.sin(a) * sp);
      }
      this._feathers(to, s, 8);
      ctx.impact();
    });
    this._after(1.7, ctx.finish);
  }

  _spHeal({ from, to, ground, s, ctx }, big = false) {
    const g = ground.clone();
    const k = big ? 2.1 : 1;
    const tI = big ? 0.75 : 0.55;
    const total = big ? 1.85 : 1.45;
    this._castFlare(from, KIND.heal, s);
    this.magicCircle(g, { color: 0x7dffa0, radius: 0.8 * s * k, duration: total - 0.45, intensity: 1.1 });
    this._pillar(g, { radius: 0.45 * s * k, height: 1.8 * s * (big ? 1.3 : 1), color: 0x6ff08f, core: 0xf4ffd8, intensity: 0.5, speed: 1.2, life: total - 0.3, fadeIn: 0.25, fadeOut: 0.45, revealTime: 0.4, top: 0.7, bot: 0.04, edge: 1.3 });
    const leaves = this._acc(), sparks = this._acc();
    const leafT = { cell: C.leaf, blend: 0.25, color: 0x9af58a, color2: 0x4fcf6a, intensity: 1.1, life: 1.1, lifeVar: 0.25, size: 0.11 * s, sizeVar: 0.3, swirl: 3.4, swirlVar: 0.25, cx: g.x, cz: g.z, spinVar: 4, fadeIn: 0.15, fadeOut: 0.35 };
    const sparkT = { cell: C.star, color: 0xf0ffc8, color2: 0x8cff9a, intensity: 1.4, life: 0.9, lifeVar: 0.35, size: 0.11 * s, sizeEnd: 0.03 * s, twinkle: 24, spinVar: 2, fadeIn: 0.1, fadeOut: 0.5 };
    this._emitFor(0, total - 0.55, (t, dt) => {
      let n = leaves(big ? 22 : 11, dt);
      if (n) {
        const T = this._T(leafT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.45, 0.75) * s * k; this._emit(T, g.x + Math.cos(a) * r, g.y + 0.1 * s, g.z + Math.sin(a) * r, 0, this._rr(0.5, 0.95) * s, 0); }
      }
      n = sparks(big ? 70 : 34, dt);
      if (n) {
        const T = this._T(sparkT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = Math.sqrt(this.rand()) * 0.6 * s * k; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.02, 0.4) * s, g.z + Math.sin(a) * r, 0, this._rr(0.6, 1.4) * s, 0); }
      }
    });
    if (big) this._dome(g, { r0: 1.7 * s, r1: 1.9 * s, life: 1.3, color: 0x7dffa0, core: 0xeaffd0, intensity: 0.8, rimPow: 3, fill: 0.05, alphaFn: (q) => Math.min(1, q / 0.3) * (1 - smoothstep(0.6, 1, q)) * 0.4 });
    this._after(tI, () => {
      const c = big ? { x: g.x, y: g.y + 0.6 * s, z: g.z } : to;
      this._glow(c, 0xeaffd8, 0.3 * s * k, 1.0 * s * k, 0.4, 0.8);
      this._glow(c, COL.heal, 0.5 * s * k, 1.4 * s * k, 0.55, 0.4);
      const burst = this._T({ cell: C.star, color: 0xf6ffd8, color2: 0x9dff9a, intensity: 1.5, life: 0.8, lifeVar: 0.3, size: 0.14 * s, sizeEnd: 0.03 * s, drag: 2.5, gravity: -0.6, twinkle: 20, spinVar: 3, fadeIn: 0, fadeOut: 0.5 });
      this._spray(burst, c, big ? 40 : 20, _UP, 0.65, 1.2 * s, 2.8 * s, 0.1 * s * k);
      this._ring(g, { r0: 0.6 * s * k, r1: 0.45 * s * k, life: 0.75, color: 0x8cff9a, core: 0xffffff, intensity: 1.4, width: 0.16, noise: 0.3, rise: 1.4 * s, alphaFn: (q) => Math.min(1, q / 0.1) * (1 - q) });
      this._ring(g, { r0: 0.3 * s * k, r1: 1.2 * s * k, life: 0.5, color: COL.heal, core: 0xf2ffe6, intensity: 1.3, width: 0.3, noise: 0.4 });
      ctx.impact();
    });
    this._after(total, ctx.finish);
  }

  _spHealAll(c) { this._spHeal(c, true); }

  _spDark({ from, to, ground, s, ctx }) {
    this._gather(from, KIND.dark, s, 22, 0.8, 0.3, 0.1);
    this._glow(from, COL.dark, 0.2 * s, 0.8 * s, 0.35, 0.8, { sizeMode: 1, fadeIn: 0.3, fadeOut: 0.3 });
    const travel = THREE.MathUtils.clamp(from.distanceTo(to) / 6.5, 0.35, 0.6);
    const tL = 0.18;
    this._after(tL, () => this._fly('darkOrb', from, to, {
      s, travel, arc: 0.06,
      onArrive: (p) => { ctx.impact(); this._implode(p, s, ground.y); },
    }));
    this._after(tL + travel + 1.0, ctx.finish);
  }

  _implode(p, s, gy) {
    const sphere = this._dome(p, {
      sphere: true, life: 0.32, color: 0xb050ff, core: 0xf0c8ff, intensity: 1.3, rimPow: 1.8, fill: 0, dark: 0.85,
      radiusFn: (k) => 0.95 * s * (1 - easeInQuad(k)) + 0.05 * s, alphaFn: (k) => Math.min(1, k / 0.15),
    });
    sphere.mesh.renderOrder = 41;
    const T = this._T({ cell: C.spark, ramp: 'dfire', life: 0.32, lifeVar: 0.15, size: 0.05 * s, intensity: 0.9, attract: 60 * s, target: p, killDist: 0.1 * s, drag: 1, stretch: 0.04, fadeIn: 0.2, fadeOut: 0.1, rotVar: 0 });
    for (let i = 0; i < 40; i++) { this._cone(_e1, _UP, 1); const r = this._rr(1.0, 1.6) * s; this._emit(T, p.x + _e1.x * r, p.y + _e1.y * r, p.z + _e1.z * r); }
    const W = this._T({ cell: C.wisp, blend: 0.05, color: 0x1a0530, alpha: 0.55, life: 0.35, lifeVar: 0.2, size: 0.4 * s, sizeEnd: 0.15 * s, attract: 30 * s, target: p, killDist: 0.12 * s, drag: 2, spinVar: 3, fadeIn: 0.3, fadeOut: 0.3 });
    for (let i = 0; i < 12; i++) { this._cone(_e1, _UP, 1); const r = this._rr(0.9, 1.3) * s; this._emit(W, p.x + _e1.x * r, p.y + _e1.y * r, p.z + _e1.z * r); }
    this._after(0.32, () => {
      this._darkBurst(p, s * 1.1);
      this._ring({ x: p.x, y: gy, z: p.z }, { r0: 0.3 * s, r1: 2.0 * s, life: 0.5, color: COL.dark, core: 0xf0c8ff, intensity: 1.5, width: 0.3, noise: 0.7 });
    });
  }

  _tendril(A, B, s, idx) {
    const N = 28;
    const pts = new Float32Array(N * 3);
    const dir = new THREE.Vector3().subVectors(B, A);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, _UP);
    if (side.lengthSq() < 1e-6) side.copy(_X);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const ph = this.rand() * 6.283;
    const wispT = { cell: C.wisp, blend: 0.05, over: true, color: 0x1a0420, alpha: 0.45, life: 0.45, lifeVar: 0.3, size: 0.16 * s, sizeEnd: 0.32 * s, drag: 2, spinVar: 2, fadeIn: 0.2, fadeOut: 0.5 };
    const amp = this._rr(0.15, 0.35) * s * (idx % 2 ? 1 : -1);
    const ampU = this._rr(0.1, 0.4) * s;
    this._bolt(A, B, {
      width: 0.055 * s, color: idx % 2 ? 0xff3a7a : 0xb040ff, core: 0.12, life: 1.15 - idx * 0.04, env: 'steady',
      update: (b, t, dt) => {
        const reach = easeOutCubic(clamp01(t / 0.32));
        for (let i = 0; i < N; i++) {
          const u = (i / (N - 1)) * reach;
          const bow = Math.sin(Math.PI * u);
          const wave = Math.sin(u * Math.PI * 3 - t * 10 + ph) * 0.12 * s * bow;
          const so = amp * bow + wave, uo = ampU * bow + wave * 0.5;
          pts[i * 3] = A.x + dir.x * len * u + side.x * so + up.x * uo;
          pts[i * 3 + 1] = A.y + dir.y * len * u + side.y * so + up.y * uo;
          pts[i * 3 + 2] = A.z + dir.z * len * u + side.z * so + up.z * uo;
        }
        if (!b.lines.length) b.lines.push({ pts, n: N, w0: 0.08 * s, w1: 0.03 * s, a: 0.85 });
        if (dt > 0 && this.rand() < dt * 22 && t < 0.95) {
          const j = Math.floor(this.rand() * N * reach) * 3;
          this._emit(this._T(wispT), pts[j], pts[j + 1], pts[j + 2], (this.rand() - 0.5) * 0.3 * s, 0.25 * s, (this.rand() - 0.5) * 0.3 * s);
        }
      },
    });
  }

  _spDrain({ from, to, ground, s, ctx }) {
    const g = ground.clone();
    this.magicCircle(g, { color: 0xd0306a, radius: 0.85 * s, duration: 1.3, intensity: 1.1 });
    this._glow(from, COL.blood, 0.2 * s, 0.7 * s, 0.4, 0.7);
    for (let i = 0; i < 4; i++) this._after(0.12 + i * 0.04, () => this._tendril(to, from, s, i));
    this._after(0.45, () => {
      this._glow(to, 0xffd0dc, 0.3 * s, 1.0 * s, 0.18, 1.2);
      this._glow(to, COL.blood, 0.5 * s, 1.5 * s, 0.4, 0.7);
      const sp = this._T({ cell: C.spark, ramp: 'blood', life: 0.4, lifeVar: 0.3, size: 0.04 * s, intensity: 0.9, drag: 3, gravity: 3, stretch: 0.035, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
      this._spray(sp, to, 18, _UP, 1, 2 * s, 5 * s);
      this._flash(to, 0xff3060, 4, 0.3);
      ctx.impact();
    });
    const orbs = this._acc();
    const orbT = { cell: C.glow, ramp: 'blood', life: 1.2, lifeVar: 0.2, size: 0.15 * s, sizeEnd: 0.08 * s, intensity: 0.75, attract: 22 * s, target: from, killDist: 0.18 * s, drag: 1.4, stretch: 0.03, fadeIn: 0.1, fadeOut: 0.15, rotVar: 0 };
    const dotT = { ...orbT, cell: C.dot, ramp: null, color: 0xffd6e4, intensity: 1.6, size: 0.05 * s, sizeEnd: 0.03 * s };
    this._emitFor(0.45, 0.75, (t, dt) => {
      let n = orbs(70, dt);
      for (; n > 0; n--) {
        const T = this._T(n % 3 === 0 ? dotT : orbT);
        this._cone(_e1, _UP, 1);
        const r = this._rr(0.05, 0.3) * s;
        this._emit(T, to.x + _e1.x * r, to.y + _e1.y * r, to.z + _e1.z * r, _e1.x * 2 * s, (_e1.y * 2 + 1) * s, _e1.z * 2 * s);
      }
    });
    this._after(1.2, () => {
      this._glow(from, 0xffd0dc, 0.3 * s, 1.1 * s, 0.35, 0.9);
      this._ring({ x: from.x, y: from.y - 0.55, z: from.z }, { r0: 0.2 * s, r1: 1.0 * s, life: 0.5, color: COL.blood, core: 0xffd0dc, intensity: 1.2, width: 0.3 });
    });
    this._after(1.7, ctx.finish);
  }

  _spDragonFang({ from, to, ground, s, ctx }) {
    this._castFlare(from, KIND.fire, s);
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    const travel = THREE.MathUtils.clamp(dist / 6.5, 0.32, 0.55);
    const t0 = 0.06;
    this._after(t0, () => {
      const start = from.clone().addScaledVector(dir, 0.3 * s).add(new THREE.Vector3(0, 0.1 * s, 0));
      const vel = dir.clone().multiplyScalar(Math.max(0, dist - 0.3 * s - 0.15) / travel);
      const f = this._crescent(start, {
        radius: 0.62 * s, bulge: dir, color: 0xff6a1a, core: 0xffc870, span: 2.5, width: 0.5, dur: travel + 0.12,
        full: true, travel: vel, noise: 1, intensity: 0.95, s, scaleFn: (k) => 0.65 + 0.35 * easeOutCubic(Math.min(1, k * 3)),
      });
      const fl = this._acc();
      const flT = { cell: C.fire, ramp: 'fire', life: 0.28, lifeVar: 0.3, size: 0.16 * s, sizeEnd: 0.32 * s, intensity: 0.4, drag: 2, gravity: -1.5, rotVar: 0.5, fadeIn: 0.05, fadeOut: 0.7 };
      const stT = { cell: C.spark, ramp: 'fire', life: 0.22, lifeVar: 0.3, size: 0.07 * s, sizeVar: 0.4, intensity: 0.8, drag: 3, stretch: 0.09, fadeIn: 0, fadeOut: 0.6, rotVar: 0 };
      const follow = vel.length() * 0.45;
      this._emitFor(0, travel, (t, dt) => {
        let n = fl(150, dt);
        const sc = f.mesh.scale.x;
        for (; n > 0; n--) {
          const streak = n % 3 !== 0;
          const T = this._T(streak ? stT : flT);
          const th = (this.rand() - 0.5) * 2.25;
          const rr = sc * this._rr(0.75, 1.0);
          _t1.copy(f.X).multiplyScalar(Math.sin(th) * rr).addScaledVector(f.Y, Math.cos(th) * rr).add(f.mesh.position);
          const k = streak ? follow : -1.5 * s;
          this._emit(T, _t1.x, _t1.y, _t1.z, dir.x * k + (this.rand() - 0.5) * 0.5 * s, dir.y * k + 0.3 * s, dir.z * k + (this.rand() - 0.5) * 0.5 * s);
        }
      });
    });
    this._after(t0 + travel, () => {
      this._explosion(to, s * 0.7, ground.y);
      this._crescent(this._towardCam(to.clone(), 0.25 * s), { radius: 0.75 * s, dir: new THREE.Vector3(dir.x, -0.9, dir.z).normalize(), color: 0xff7a2a, core: 0xffd890, span: 3.2, width: 0.45, dur: 0.25, intensity: 0.85, s });
      this.hitSpark(to, { color: 0xffa040, dir, scale: s });
      ctx.impact();
    });
    this._after(t0 + travel + 1.0, ctx.finish);
  }

  _spBreath({ from, to, s, ctx }) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    this._gather(from, KIND.dark, s, 26, 0.9, 0.3, 0.12);
    this._glow(from, COL.dark, 0.2 * s, 0.9 * s, 0.35, 0.8, { sizeMode: 1, fadeIn: 0.4, fadeOut: 0.2 });
    const tS = 0.3, dur = 0.95;
    const speed = Math.max(5, dist / 0.42);
    const reach = dist / speed;
    const len = dist + 0.4 * s;
    const R = this.rand;
    const flame = this._acc(), dark = this._acc(), spark = this._acc();
    const fT = { cell: C.fire, ramp: 'dfire', life: (len / speed) * 1.15, lifeVar: 0.2, size: 0.12 * s, sizeEnd: 0.7 * s, sizeVar: 0.3, intensity: 0.6, drag: 0.4, stretch: 0.035, fadeIn: 0.05, fadeOut: 0.45, rotVar: 0 };
    const dT = { cell: C.wisp, blend: 0.08, over: true, color: 0x1a0630, color2: 0x07000c, alpha: 0.5, life: (len / speed) * 1.2, lifeVar: 0.2, size: 0.15 * s, sizeEnd: 0.8 * s, drag: 0.5, spinVar: 2.5, fadeIn: 0.1, fadeOut: 0.5 };
    const sT = { cell: C.spark, ramp: 'dfire', life: 0.4, lifeVar: 0.3, size: 0.04 * s, intensity: 0.9, drag: 0.6, stretch: 0.035, fadeIn: 0, fadeOut: 0.5, rotVar: 0 };
    const shoot = (T, n, spread, k0, k1) => {
      for (; n > 0; n--) {
        this._cone(_e1, dir, spread);
        const sp = speed * this._rr(k0, k1);
        this._emit(T, from.x + (R() - 0.5) * 0.05 * s, from.y + (R() - 0.5) * 0.05 * s, from.z + (R() - 0.5) * 0.05 * s, _e1.x * sp, _e1.y * sp, _e1.z * sp);
      }
    };
    this._emitFor(tS, dur, (t, dt) => {
      const env = Math.min(1, t / 0.1) * (t > dur - 0.2 ? Math.max(0, (dur - t) / 0.2) : 1);
      let n = flame(220 * env, dt);
      if (n) shoot(this._T(fT), n, 0.055, 0.85, 1.1);
      n = dark(70 * env, dt);
      if (n) shoot(this._T(dT), n, 0.06, 0.8, 1.0);
      n = spark(40 * env, dt);
      if (n) shoot(this._T(sT), n, 0.08, 0.9, 1.2);
    });
    this._after(tS, () => this._pillar(from, {
      cone: true, dir, mode: 'fire', radius: 0.55 * s, height: len, color: 0x7a1ad0, core: 0xf2d8ff, intensity: 1.1,
      speed: 3.5, life: dur + 0.15, fadeIn: 0.06, fadeOut: 0.3, revealTime: reach, edge: 1.0, top: 0.25, bot: 0.02, dark: 0.35,
    }));
    this._after(tS + reach, () => {
      this._glow(to, 0xf0d0ff, 0.4 * s, 1.4 * s, 0.25, 1.2);
      this._flash(to, 0xa050ff, 6, 0.6);
      ctx.impact();
    });
    const sp = this._acc();
    const spT = { cell: C.fire, ramp: 'dfire', life: 0.45, lifeVar: 0.3, size: 0.25 * s, sizeEnd: 0.6 * s, intensity: 0.55, drag: 3, gravity: -2, spinVar: 2, fadeIn: 0.05, fadeOut: 0.6 };
    this._emitFor(tS + reach, dur - reach + 0.1, (t, dt) => {
      let n = sp(70, dt);
      if (!n) return;
      const T = this._T(spT);
      for (; n > 0; n--) {
        const a = this.rand() * 6.283, v = this._rr(1.5, 3) * s;
        this._emit(T, to.x, to.y + (R() - 0.5) * 0.4 * s, to.z, Math.cos(a) * v * 0.6 + dir.x * v * 0.4, this._rr(0.5, 2) * s, Math.sin(a) * v * 0.6 + dir.z * v * 0.4);
      }
    });
    this._after(tS + dur + 0.05, () => {
      const W = this._T({ cell: C.wisp, blend: 0.05, color: 0x1a0626, alpha: 0.5, life: 0.9, lifeVar: 0.3, size: 0.3 * s, sizeEnd: 0.9 * s, drag: 2, gravity: -1, spinVar: 1.5, fadeIn: 0.1, fadeOut: 0.6 });
      this._spray(W, to, 8, _UP, 0.6, 0.4 * s, 1.2 * s, 0.2 * s);
    });
    this._after(tS + dur + 0.6, ctx.finish);
  }

  _spSummon({ ground, s, ctx }) {
    const g = ground.clone();
    this.magicCircle(g, { color: 0xc8306a, radius: 1.05 * s, duration: 1.4, intensity: 1.2, spin: -1 });
    const tO = 0.22, tI = 0.88, tC = 1.25;
    const portal = this._meshFx('portal', 1.85, (f, t) => {
      const u = f.u;
      u.uTime.value = t + f.seed;
      u.uOpen.value = t < tO ? 0 : t < tC ? easeOutBack(Math.min(1, (t - tO) / 0.35), 1.6) : Math.max(0, 1 - easeInQuad((t - tC) / 0.45));
      u.uAlpha.value = Math.min(1, t / 0.2);
      return t <= tC + 0.45;
    });
    portal.mesh.position.set(g.x, g.y + 0.035, g.z);
    portal.mesh.scale.setScalar(0.85 * s);
    portal.u.uColor.value.set(0x8a2ad8);
    portal.u.uRim.value.set(0xff4ab0);
    portal.u.uIntensity.value = 1;
    portal.tick(portal, 0, 0);
    const sm = this._acc(), mo = this._acc();
    const smT = { cell: C.wisp, blend: 0.05, color: 0x1a0626, alpha: 0.5, life: 0.9, lifeVar: 0.3, size: 0.3 * s, sizeEnd: 0.8 * s, gravity: -1.2, drag: 1.5, swirl: 2.5, cx: g.x, cz: g.z, spinVar: 1.5, fadeIn: 0.2, fadeOut: 0.6 };
    const moT = { cell: C.spark, ramp: 'dfire', life: 0.6, lifeVar: 0.3, size: 0.04 * s, intensity: 0.9, swirl: 6, swirlVar: 0.3, cx: g.x, cz: g.z, radialVel: -1.3 * s, stretch: 0.04, fadeIn: 0.2, fadeOut: 0.3, rotVar: 0 };
    this._emitFor(tO, tC - tO + 0.2, (t, dt) => {
      let n = sm(22, dt);
      if (n) {
        const T = this._T(smT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = Math.sqrt(this.rand()) * 0.7 * s; this._emit(T, g.x + Math.cos(a) * r, g.y + 0.05, g.z + Math.sin(a) * r, 0, this._rr(0.5, 1) * s, 0); }
      }
      n = mo(60, dt);
      if (n) {
        const T = this._T(moT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.9, 1.2) * s; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.4) * s, g.z + Math.sin(a) * r, 0, this._rr(-0.2, 0.3) * s, 0); }
      }
    });
    this._crackle(new THREE.Vector3(g.x, g.y + 0.1, g.z), 0.9 * s, 0.6, { delay: tO + 0.2, rate: 18, width: 0.03 * s, color: 0xd060ff, floorY: g.y });
    this._after(tI, () => {
      this._pillar(g, { radius: 0.55 * s, height: 3.4 * s, color: 0xa040ff, core: 0xffd0ff, intensity: 0.65, speed: 2.2, life: 0.6, fadeIn: 0.03, fadeOut: 0.35, revealTime: 0.12, dark: 0.3, edge: 1.3, top: 0.5 });
      this._glow({ x: g.x, y: g.y + 0.5 * s, z: g.z }, 0xf0d0ff, 0.4 * s, 1.5 * s, 0.22, 0.8);
      this._flash(new THREE.Vector3(g.x, g.y + 1, g.z), 0xb050ff, 8, 0.5);
      this._ring(g, { r0: 0.3 * s, r1: 2.2 * s, life: 0.5, color: 0xc050ff, core: 0xffd0ff, intensity: 1.6, width: 0.3, noise: 0.6 });
      const W = this._T({ cell: C.wisp, blend: 0.05, color: 0x1a0626, alpha: 0.65, life: 1.0, lifeVar: 0.3, size: 0.35 * s, sizeEnd: 1.0 * s, drag: 2.5, gravity: -0.8, spinVar: 1.5, fadeIn: 0.05, fadeOut: 0.6 });
      for (let i = 0; i < 16; i++) {
        const a = this.rand() * 6.283, sp = this._rr(1.2, 2.6) * s;
        this._emit(W, g.x, g.y + 0.2 * s, g.z, Math.cos(a) * sp, this._rr(0.3, 1.2) * s, Math.sin(a) * sp);
      }
      const S = this._T({ cell: C.spark, ramp: 'dfire', life: 0.6, lifeVar: 0.3, size: 0.045 * s, intensity: 1.0, drag: 1.5, gravity: 2, stretch: 0.04, fadeIn: 0, fadeOut: 0.5, rotVar: 0 });
      this._spray(S, { x: g.x, y: g.y + 0.2 * s, z: g.z }, 24, _UP, 0.4, 3 * s, 7 * s);
      ctx.impact();
    });
    this._after(1.85, ctx.finish);
  }

  // ================================================================= unit / area effects
  /**
   * Glowing rotating rune circle on the ground (draws itself in, fades in/out).
   * @param {THREE.Vector3} pos ground point
   * @param {{color?: number, radius?: number, duration?: number, intensity?: number, spin?: number}} [opts]
   *   duration: auto-stop after this many seconds (default: until stop()).
   * @returns {{stop: () => void}}
   */
  magicCircle(pos, opts = {}) {
    const { color = COL.holy, radius = 1, duration = Infinity, intensity = 1.4, spin = 1 } = opts;
    const p = v3(pos);
    let stopping = false, stopT = 0;
    const f = this._meshFx('circle', Infinity, (f, t) => {
      if (!stopping && t >= duration) { stopping = true; stopT = t; }
      let k = Math.min(1, t / 0.25);
      if (stopping) { k *= 1 - (t - stopT) / 0.35; if (k <= 0) return false; }
      const u = f.u;
      u.uAlpha.value = k;
      u.uReveal.value = Math.min(1, t / 0.4);
      u.uRotA.value = f.seed + t * 0.55 * spin;
      u.uRotB.value = f.seed - t * 0.85 * spin;
      u.uPulse.value = 0.15 * Math.sin(t * 7);
      f.mesh.scale.setScalar(radius * (0.82 + 0.18 * easeOutBack(Math.min(1, t / 0.3))));
      return true;
    });
    f.u.uColor.value.set(color);
    f.u.uIntensity.value = intensity;
    f.mesh.position.set(p.x, p.y + 0.025, p.z);
    f.tick(f, 0, 0);
    return { stop: () => { if (!stopping) { stopping = true; stopT = f.t; } } };
  }

  /**
   * Looping soft glow ring + rising motes (boss aura / selected unit).
   * @param {THREE.Vector3} pos ground point
   * @param {{color?: number, radius?: number, intensity?: number}} [opts]
   * @returns {{stop: () => void, setPosition: (v: THREE.Vector3) => void}}
   */
  aura(pos, opts = {}) {
    const { color = COL.holy, radius = 0.6, intensity = 1.1 } = opts;
    const p = v3(pos);
    let stopping = false, stopT = 0, alive = true;
    const f = this._meshFx('ring', Infinity, (f, t) => {
      let k = Math.min(1, t / 0.3);
      if (stopping) { k *= 1 - (t - stopT) / 0.35; if (k <= 0) { alive = false; return false; } }
      f.u.uAlpha.value = k * (0.8 + 0.2 * Math.sin(t * 3.2));
      f.u.uTime.value = t;
      const r = radius * (1 + 0.05 * Math.sin(t * 2.1));
      f.mesh.scale.set(r, r, r);
      f.mesh.position.set(p.x, p.y + 0.03, p.z);
      return true;
    });
    const u = f.u;
    u.uColor.value.set(color);
    u.uCore.value.set(color).lerp(new THREE.Color(1, 1, 1), 0.6);
    u.uIntensity.value = intensity;
    u.uWidth.value = 0.4;
    u.uNoise.value = 0.6;
    u.uFill.value = 0.18;
    f.tick(f, 0, 0);
    const k = radius / 0.6;
    const acc = this._acc();
    const moteT = { cell: C.glow, color, intensity: 1.6, life: 1.3, lifeVar: 0.3, size: 0.13 * k, sizeEnd: 0.04 * k, twinkle: 9, wobble: 0.15, fadeIn: 0.2, fadeOut: 0.5 };
    const dotT = { ...moteT, cell: C.dot, size: 0.035 * k, sizeEnd: 0.02 * k, intensity: 1.8 };
    this._task((dt) => {
      if (stopping || !alive) return false;
      let n = acc(radius * 28, dt);
      for (; n > 0; n--) {
        const T = this._T(n % 2 ? moteT : dotT);
        const a = this.rand() * 6.283, r = radius * this._rr(0.55, 1.0);
        this._emit(T, p.x + Math.cos(a) * r, p.y + 0.05, p.z + Math.sin(a) * r, 0, this._rr(0.35, 0.8) * k, 0);
      }
      return true;
    });
    return {
      stop: () => { if (!stopping) { stopping = true; stopT = f.t; } },
      setPosition: (v) => { v3(v, p); },
    };
  }

  /**
   * Golden light pillar + rising rings + sparkles (~1.6 s).
   * @param {THREE.Vector3} pos unit feet
   * @returns {Promise<void>}
   */
  levelUp(pos) {
    const g = v3(pos);
    const ctx = this._ctx(null);
    const chest = new THREE.Vector3(g.x, g.y + 0.55, g.z);
    this._pillar(g, { radius: 0.42, height: 3.4, color: 0xffc24a, core: 0xfff8e0, intensity: 0.42, speed: 1.6, life: 1.35, fadeIn: 0.05, fadeOut: 0.5, revealTime: 0.28, top: 0.55, edge: 1.5 });
    this._pillar(g, { radius: 0.15, height: 3.0, color: 0xfff0c0, core: 0xffffff, intensity: 0.55, speed: 2.2, life: 1.0, fadeIn: 0.05, fadeOut: 0.45, revealTime: 0.22, top: 0.5, edge: 1.2 });
    this._ring(g, { r0: 0.2, r1: 1.4, life: 0.5, color: 0xffc24a, core: 0xffffff, intensity: 1.6, width: 0.3, noise: 0.4 });
    this._ring(g, { r0: 0.8, r1: 0.9, life: 1.3, color: 0xffc24a, core: 0xfff0c0, intensity: 0.35, width: 0, fill: 0.8, noise: 0.3, alphaFn: (q) => Math.min(1, q / 0.1) * (1 - smoothstep(0.5, 1, q)) });
    for (let i = 0; i < 4; i++) {
      this._after(0.05 + i * 0.2, () => this._ring(g, { r0: 0.65, r1: 0.45, life: 0.7, color: 0xffcf5a, core: 0xffffff, intensity: 2.0, width: 0.2, noise: 0.15, rise: 1.7, alphaFn: (q) => Math.min(1, q / 0.12) * (1 - q) }));
    }
    this._glow(chest, 0xfff2c8, 0.3, 1.2, 0.3, 1.1);
    const sp = this._acc();
    const spT = { cell: C.star, color: 0xfff1b0, color2: 0xffc24a, intensity: 1.4, life: 0.9, lifeVar: 0.3, size: 0.13, sizeEnd: 0.03, swirl: 4, swirlVar: 0.3, cx: g.x, cz: g.z, twinkle: 22, spinVar: 2, fadeIn: 0.1, fadeOut: 0.5 };
    this._emitFor(0, 0.9, (t, dt) => {
      let n = sp(50, dt);
      if (!n) return;
      const T = this._T(spT);
      for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.3, 0.6); this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.5), g.z + Math.sin(a) * r, 0, this._rr(1.2, 2.4), 0); }
    });
    this._after(1.6, ctx.finish);
    return ctx.promise;
  }

  /**
   * Class promotion: rune circle, converging light, pillar burst, wings of light, feathers, shockwave (~2.5 s).
   * @param {THREE.Vector3} pos unit feet
   * @returns {Promise<void>}
   */
  promotion(pos) {
    const g = v3(pos);
    const ctx = this._ctx(null);
    const chest = new THREE.Vector3(g.x, g.y + 0.6, g.z);
    this.magicCircle(g, { color: 0xffe08a, radius: 1.5, duration: 1.9, intensity: 1.2 });
    this._gather(chest, KIND.holy, 1, 50, 1.6, 0.5, 0.35);
    this._glow(chest, COL.holy, 0.2, 1.0, 0.5, 0.8, { sizeMode: 1, fadeIn: 0.6, fadeOut: 0.1 });
    const tB = 0.5;
    this._after(tB, () => {
      this._pillar(g, { radius: 0.65, height: 6, color: 0xffcf62, core: 0xffffff, intensity: 0.34, speed: 1.4, life: 1.5, revealTime: 0.2, fadeIn: 0.04, fadeOut: 0.6, top: 0.45, edge: 1.5, radiusFn: (k) => 0.7 + 0.3 * easeOutCubic(Math.min(1, k * 5)) });
      this._pillar(g, { radius: 0.22, height: 5, color: 0xfff2c8, core: 0xffffff, intensity: 0.45, speed: 2.2, life: 1.1, revealTime: 0.15, fadeIn: 0.04, fadeOut: 0.5, top: 0.45, edge: 1.2 });
      this._glow(chest, 0xffffff, 0.4, 1.8, 0.28, 1.0);
      this._flash(new THREE.Vector3(g.x, g.y + 1.2, g.z), 0xffe6b0, 10, 0.7);
      this._ring(g, { r0: 0.3, r1: 3.2, life: 0.7, color: 0xffcf62, core: 0xffffff, intensity: 1.8, width: 0.25, noise: 0.5 });
      this._wings(chest, 1.75);
      this._feathers(chest, 1, 20);
      for (let i = 0; i < 4; i++) {
        this._after(0.1 + i * 0.22, () => this._ring(g, { r0: 0.8, r1: 0.55, life: 0.8, color: 0xffcf5a, core: 0xffffff, intensity: 1.5, width: 0.12, noise: 0.2, rise: 2.4, alphaFn: (q) => Math.min(1, q / 0.12) * (1 - q) }));
      }
    });
    const sp = this._acc();
    const spT = { cell: C.star, color: 0xfff1b0, color2: 0xffc24a, intensity: 1.4, life: 1.0, lifeVar: 0.3, size: 0.15, sizeEnd: 0.03, swirl: 3.5, swirlVar: 0.3, cx: g.x, cz: g.z, twinkle: 20, spinVar: 2, fadeIn: 0.1, fadeOut: 0.5 };
    this._emitFor(tB, 1.4, (t, dt) => {
      let n = sp(60, dt);
      if (!n) return;
      const T = this._T(spT);
      for (; n > 0; n--) { const a = this.rand() * 6.283, r = this._rr(0.4, 0.9); this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.6), g.z + Math.sin(a) * r, 0, this._rr(1.2, 2.6), 0); }
    });
    this._after(2.5, ctx.finish);
    return ctx.promise;
  }

  _wings(chest, dur) {
    for (const flip of [1, -1]) {
      const f = this._meshFx('wing', dur, (f, t) => {
        const u = f.u;
        const k = t / dur;
        const open = easeOutBack(Math.min(1, t / 0.45), 1.3);
        u.uRot.value = (1 - open) * 0.9 - 0.12;
        u.uReveal.value = Math.min(1.2, (t / 0.4) * 1.2);
        u.uAlpha.value = Math.min(1, t / 0.15) * (1 - smoothstep(0.65, 1, k)) * (0.9 + 0.1 * Math.sin(t * 9));
        const sz = 1.55 * (0.85 + 0.15 * open);
        u.uSize.value.set(sz, sz);
      });
      f.u.uFlip.value = flip;
      f.u.uOffset.value.set(0.12, 0.05);
      f.u.uDepth.value = 0.35;
      f.u.uColor.value.set(0xfff0c8);
      f.u.uIntensity.value = 1.2;
      f.mesh.position.copy(chest);
      f.tick(f, 0, 0);
    }
  }

  /**
   * Embers + ash rising off a dissolving unit (~1.6 s).
   * @param {THREE.Vector3} pos unit feet
   * @param {number} [color] ember colour (match the dissolve edge colour)
   */
  deathBurst(pos, color = 0xff8a3a) {
    const g = v3(pos);
    const emb = this._acc(), ash = this._acc();
    const embT = { cell: C.ember, color, intensity: 2.0, life: 1.1, lifeVar: 0.4, size: 0.085, sizeEnd: 0.025, sizeVar: 0.4, gravity: -0.8, drag: 0.6, wobble: 1.0, wobbleFreq: 5, twinkle: 14, fadeIn: 0.05, fadeOut: 0.5 };
    const ashT = { cell: C.shard, blend: 0, color: 0x2a2522, alpha: 0.85, life: 1.3, lifeVar: 0.3, size: 0.05, sizeEnd: 0.03, sizeVar: 0.5, gravity: -0.5, drag: 0.8, wobble: 1.2, wobbleFreq: 4, spinVar: 4, fadeIn: 0.05, fadeOut: 0.5 };
    this._emitFor(0, 0.9, (t, dt) => {
      let n = emb(130, dt);
      if (n) {
        const T = this._T(embT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = Math.sqrt(this.rand()) * 0.25; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.95), g.z + Math.sin(a) * r, Math.cos(a) * 0.3, this._rr(0.3, 1.0), Math.sin(a) * 0.3); }
      }
      n = ash(40, dt);
      if (n) {
        const T = this._T(ashT);
        for (; n > 0; n--) { const a = this.rand() * 6.283, r = Math.sqrt(this.rand()) * 0.25; this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0.05, 0.95), g.z + Math.sin(a) * r, Math.cos(a) * 0.4, this._rr(0.2, 0.7), Math.sin(a) * 0.4); }
      }
    });
    this._glow({ x: g.x, y: g.y + 0.5, z: g.z }, color, 0.4, 1.2, 0.7, 0.6, { fadeIn: 0.2 });
  }

  /**
   * Footstep / landing dust puff (~0.7 s).
   * @param {THREE.Vector3} pos ground point
   * @param {{color?: number, scale?: number, count?: number}} [opts]
   */
  dust(pos, opts = {}) {
    const { color = 0xcbb89a, scale = 1, count = 9 } = opts;
    const g = v3(pos), s = scale;
    const T = this._T({ cell: C.smoke, blend: 0, color, alpha: 0.55, life: 0.65, lifeVar: 0.3, size: 0.14 * s, sizeEnd: 0.45 * s, sizeVar: 0.3, drag: 4, gravity: -0.3, spinVar: 1.5, fadeIn: 0.05, fadeOut: 0.6 });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 6.283 + this.rand() * 0.6, sp = this._rr(0.8, 1.6) * s;
      this._emit(T, g.x + Math.cos(a) * 0.08 * s, g.y + 0.06 * s, g.z + Math.sin(a) * 0.08 * s, Math.cos(a) * sp, this._rr(0.2, 0.6) * s, Math.sin(a) * sp);
    }
  }

  /** Water splash: droplets, mist and ripples (~0.8 s). @param {THREE.Vector3} pos water surface point */
  splash(pos, opts = {}) {
    const g = v3(pos), s = opts.scale ?? 1;
    const drops = this._T({ cell: C.drop, blend: 0.35, color: 0xdff3ff, intensity: 1.15, alpha: 0.9, life: 0.65, lifeVar: 0.3, size: 0.08 * s, sizeEnd: 0.05 * s, gravity: 9, drag: 0.5, stretch: 0.03, fadeIn: 0, fadeOut: 0.3, rotVar: 0 });
    this._spray(drops, { x: g.x, y: g.y + 0.05, z: g.z }, 34, _UP, 0.3, 2.5 * s, 4.8 * s, 0.1 * s);
    const mist = this._T({ cell: C.smoke, blend: 0.3, color: 0xe8f6ff, alpha: 0.35, life: 0.7, lifeVar: 0.3, size: 0.2 * s, sizeEnd: 0.55 * s, drag: 3, gravity: -0.2, spinVar: 1, fadeIn: 0.05, fadeOut: 0.6 });
    this._spray(mist, g, 6, _UP, 0.5, 0.5 * s, 1.2 * s);
    this._ring(g, { r0: 0.15 * s, r1: 1.0 * s, life: 0.7, color: 0x9fd8ff, core: 0xffffff, intensity: 1.0, width: 0.2, noise: 0.3, lift: 0.02 });
    this._after(0.15, () => this._ring(g, { r0: 0.1 * s, r1: 0.6 * s, life: 0.6, color: 0x9fd8ff, core: 0xffffff, intensity: 0.6, width: 0.2, noise: 0.3, lift: 0.02 }));
  }

  /** Treasure glint: a twinkling star pop (~0.6 s). @param {THREE.Vector3} pos */
  sparkle(pos, opts = {}) {
    const p = v3(pos), s = opts.scale ?? 1;
    this._emit(this._T({ cell: C.star, color: 0xffffff, color2: 0xffe08a, intensity: 1.6, life: 0.55, lifeVar: 0, size: 0, sizeEnd: 0.5 * s, sizeVar: 0.1, sizeMode: 3, spin: 2.5, rotVar: 0.4, fadeIn: 0, fadeOut: 0.3 }), p.x, p.y, p.z);
    const T = this._T({ cell: C.plus, color: 0xfff6d0, intensity: 1.4, life: 0.4, lifeVar: 0.2, size: 0, sizeEnd: 0.2 * s, sizeMode: 3, rotVar: 0.3, fadeIn: 0, fadeOut: 0.3, delayVar: 0.2 });
    for (let i = 0; i < 3; i++) { this._cone(_e1, _UP, 1); this._emit(T, p.x + _e1.x * 0.18 * s, p.y + _e1.y * 0.18 * s, p.z + _e1.z * 0.18 * s); }
    this._glow(p, 0xffe9b0, 0.1 * s, 0.35 * s, 0.4, 0.5);
  }

  /** Treasure chest opening: light rays, small pillar, golden sparkle fountain (~1.4 s). @param {THREE.Vector3} pos chest base */
  chestOpen(pos, opts = {}) {
    const g = v3(pos), s = opts.scale ?? 1;
    const top = new THREE.Vector3(g.x, g.y + 0.35 * s, g.z);
    this._glow(top, 0xfff2c8, 0.3 * s, 1.4 * s, 0.5, 1.0);
    this._flash(top, 0xffd890, 4, 0.6);
    const rays = this._T({ cell: C.spark, lock: 1, stretch: 1, color: 0xffe6a0, intensity: 1.0, life: 1.0, lifeVar: 0.25, size: 0.12 * s, sizeVar: 0.3, fadeIn: 0.25, fadeOut: 0.5, rotVar: 0 });
    for (let i = 0; i < 9; i++) {
      this._cone(_e1, _UP, 0.2);
      const L = this._rr(0.8, 1.6) * s;
      this._emit(rays, top.x + _e1.x * L * 0.5, top.y + _e1.y * L * 0.5, top.z + _e1.z * L * 0.5, _e1.x * L, _e1.y * L, _e1.z * L);
    }
    this._pillar(g, { radius: 0.32 * s, height: 1.6 * s, color: 0xffcf62, core: 0xfff6e0, intensity: 0.55, speed: 1.5, life: 1.2, fadeIn: 0.1, fadeOut: 0.5, revealTime: 0.3, top: 0.7, edge: 1.4 });
    const coins = this._T({ cell: C.star, color: 0xffe9a0, color2: 0xffb830, intensity: 1.5, life: 1.1, lifeVar: 0.3, size: 0.12 * s, sizeEnd: 0.05 * s, gravity: 5, drag: 0.6, twinkle: 25, spinVar: 4, fadeIn: 0, fadeOut: 0.4, floorY: g.y + 0.03, bounce: 0.35 });
    this._spray(coins, top, 26, _UP, 0.22, 2.4 * s, 3.8 * s, 0.05 * s);
    const motes = this._T({ cell: C.glow, ramp: 'holy', life: 1.0, lifeVar: 0.3, size: 0.1 * s, sizeEnd: 0.03 * s, intensity: 0.6, gravity: -0.8, drag: 1.5, wobble: 0.5, fadeIn: 0.1, fadeOut: 0.5 });
    this._spray(motes, top, 16, _UP, 0.35, 0.5 * s, 1.5 * s, 0.15 * s);
    this._ring(g, { r0: 0.2 * s, r1: 1.0 * s, life: 0.5, color: 0xffcf62, core: 0xffffff, intensity: 1.2, width: 0.3, noise: 0.4 });
  }

  /** Stat buff: rising rings, upward streaks and sparkles (~1.0 s). @param {THREE.Vector3} pos unit feet */
  buff(pos, color = 0x7fd8ff) {
    const g = v3(pos);
    for (let i = 0; i < 2; i++) {
      this._after(i * 0.18, () => this._ring(g, { r0: 0.55, r1: 0.4, life: 0.7, color, core: 0xffffff, intensity: 1.4, width: 0.16, noise: 0.3, rise: 1.15, alphaFn: (q) => Math.min(1, q / 0.12) * (1 - q) }));
    }
    this._ring(g, { r0: 0.2, r1: 0.9, life: 0.45, color, core: 0xffffff, intensity: 1.3, width: 0.3, noise: 0.4 });
    const T = this._T({ cell: C.spark, color: 0xffffff, color2: color, intensity: 1.3, life: 0.55, lifeVar: 0.3, size: 0.05, sizeVar: 0.3, drag: 0.5, stretch: 0.06, fadeIn: 0.1, fadeOut: 0.5, rotVar: 0, delayVar: 0.3 });
    for (let i = 0; i < 16; i++) { const a = this.rand() * 6.283, r = this._rr(0.25, 0.45); this._emit(T, g.x + Math.cos(a) * r, g.y + this._rr(0, 0.3), g.z + Math.sin(a) * r, 0, this._rr(1.8, 3), 0); }
    const P = this._T({ cell: C.plus, color, intensity: 1.5, life: 0.7, lifeVar: 0.3, size: 0.14, sizeEnd: 0.03, twinkle: 20, fadeIn: 0, fadeOut: 0.5, delayVar: 0.3 });
    for (let i = 0; i < 8; i++) { const a = this.rand() * 6.283, r = this._rr(0.15, 0.4); this._emit(P, g.x + Math.cos(a) * r, g.y + this._rr(0.2, 0.9), g.z + Math.sin(a) * r, 0, this._rr(0.5, 1.0), 0); }
    this._glow({ x: g.x, y: g.y + 0.55, z: g.z }, color, 0.3, 1.0, 0.4, 0.7);
  }

  /**
   * Looping atmosphere inside `bounds` (prewarmed, so it starts populated).
   * @param {'embers'|'fireflies'|'pollen'|'snow'|'ash'|'leaves'|'motes'|'sand'} kind
   * @param {THREE.Box3} bounds
   * @param {{density?: number}} [opts]
   * @returns {{stop: () => void}}
   */
  ambient(kind, bounds, opts = {}) {
    const density = Math.max(0, opts.density ?? 1);
    const min = v3(bounds.min), max = v3(bounds.max);
    const size = new THREE.Vector3().subVectors(max, min);
    const area = Math.max(1, size.x * size.z);
    const H = Math.max(0.5, size.y);
    const R = this.rand;
    const clamp = THREE.MathUtils.clamp;
    const rx = () => min.x + R() * size.x, rz = () => min.z + R() * size.z;
    const CONF = {
      snow: {
        per: 1.6, life: clamp(H / 0.7, 3, 12),
        t: { cell: C.flake, blend: 0.25, color: 0xffffff, intensity: 0.95, alpha: 0.95, lifeVar: 0.15, size: 0.09, sizeVar: 0.45, wobble: 0.4, wobbleFreq: 1.5, spinVar: 1.5, fadeIn: 0.05, fadeOut: 0.08 },
        spawn: (f, T) => this._emit(T, rx(), max.y - f * H, rz(), 0.12, -this._rr(0.55, 0.85), 0.05),
      },
      ash: {
        per: 1.1, life: clamp(H / 0.3, 4, 14),
        extra: { ratio: 0.12, t: { cell: C.ember, color: 0xff8a3a, color2: 0xff4a10, intensity: 1.6, lifeVar: 0.3, size: 0.06, sizeEnd: 0.03, wobble: 0.8, wobbleFreq: 2, twinkle: 7, fadeIn: 0.1, fadeOut: 0.3 } },
        t: { cell: C.shard, blend: 0, color: 0x9a938c, color2: 0x55504c, alpha: 0.85, lifeVar: 0.2, size: 0.06, sizeVar: 0.5, wobble: 0.7, wobbleFreq: 1.8, spinVar: 3, fadeIn: 0.05, fadeOut: 0.1 },
        spawn: (f, T) => this._emit(T, rx(), max.y - f * H, rz(), 0.1, -this._rr(0.2, 0.4), 0.04),
      },
      embers: {
        per: 0.8, life: clamp(H / 0.55, 2.5, 8),
        t: { cell: C.ember, color: 0xff8a3a, color2: 0xff4a10, intensity: 1.9, lifeVar: 0.3, size: 0.1, sizeEnd: 0.04, sizeVar: 0.4, wobble: 0.7, wobbleFreq: 2.5, twinkle: 6, fadeIn: 0.1, fadeOut: 0.3 },
        spawn: (f, T) => this._emit(T, rx(), min.y + f * H, rz(), 0, this._rr(0.3, 0.8), 0),
      },
      fireflies: {
        per: 0.22, life: 6,
        t: { cell: C.glow, color: 0xd8ff7a, intensity: 1.6, lifeVar: 0.3, size: 0.18, sizeVar: 0.3, wobble: 0.5, wobbleFreq: 1.2, twinkle: 2.5, fadeIn: 0.15, fadeOut: 0.2 },
        spawn: (f, T) => this._emit(T, rx(), min.y + this._rr(0.2, Math.min(2.5, H)), rz(), this._rr(-0.15, 0.15), this._rr(-0.05, 0.08), this._rr(-0.15, 0.15)),
      },
      pollen: {
        per: 0.9, life: 5,
        t: { cell: C.dot, color: 0xfff2b0, intensity: 1.0, lifeVar: 0.3, size: 0.05, sizeVar: 0.4, wobble: 0.3, wobbleFreq: 1.5, twinkle: 1.5, fadeIn: 0.2, fadeOut: 0.25 },
        spawn: (f, T) => this._emit(T, rx(), min.y + R() * Math.min(3, H), rz(), 0.18, this._rr(-0.03, 0.06), 0.08),
      },
      leaves: {
        per: 0.4, life: clamp(H / 0.55, 3, 12),
        colors: [0x7bc24f, 0x9ccf4a, 0xe0a83a, 0xd0602a].map((h) => new THREE.Color(h)),
        t: { cell: C.leaf, blend: 0, alpha: 1, lifeVar: 0.2, size: 0.15, sizeVar: 0.3, wobble: 1.2, wobbleFreq: 2, spinVar: 3, fadeIn: 0.05, fadeOut: 0.1 },
        spawn: (f, T) => this._emit(T, rx(), max.y - f * H, rz(), 0.35, -this._rr(0.4, 0.7), 0.1),
      },
      motes: {
        per: 0.45, life: 6,
        t: { cell: C.glow, color: 0xbfe4ff, intensity: 1.4, lifeVar: 0.3, size: 0.12, sizeVar: 0.4, wobble: 0.25, wobbleFreq: 1, twinkle: 3, fadeIn: 0.2, fadeOut: 0.3 },
        spawn: (f, T) => this._emit(T, rx(), min.y + R() * H * (f > 0 ? 1 : 0.3), rz(), 0, this._rr(0.12, 0.3), 0),
      },
      sand: {
        per: 1.8, life: clamp(size.x / 3.5, 1.5, 8),
        t: { cell: C.dot, blend: 0, color: 0xd8c090, alpha: 0.6, lifeVar: 0.2, size: 0.04, sizeVar: 0.4, stretch: 0.06, fadeIn: 0.05, fadeOut: 0.1, rotVar: 0 },
        spawn: (f, T) => this._emit(T, min.x + f * size.x, min.y + R() * Math.min(2, H), rz(), this._rr(2.5, 4.5), this._rr(-0.1, 0.1), this._rr(0.1, 0.4)),
      },
    };
    const conf = CONF[kind];
    if (!conf) { console.warn(`[vfx] unknown ambient "${kind}"`); return { stop() {} }; }
    const target = Math.min(1500, Math.round(area * conf.per * density));
    const rate = target / conf.life;
    const tpl = { ...conf.t, life: conf.life };
    const emitN = (n, pre) => {
      const T = this._T(tpl);
      for (let i = 0; i < n; i++) {
        const f = pre ? R() * 0.95 : 0;
        T.delay = -f * conf.life;
        if (conf.colors) {
          const c = conf.colors[(R() * conf.colors.length) | 0];
          T.r0 = T.r1 = c.r; T.g0 = T.g1 = c.g; T.b0 = T.b1 = c.b;
        }
        conf.spawn(f, T);
      }
      if (conf.extra) {
        const k = Math.floor(n * conf.extra.ratio + R());
        if (k > 0) {
          const T2 = this._T({ ...conf.extra.t, life: conf.life });
          for (let i = 0; i < k; i++) { const f = pre ? R() * 0.95 : 0; T2.delay = -f * conf.life; conf.spawn(f, T2); }
        }
      }
    };
    emitN(target, true);
    let stopped = false;
    const acc = this._acc();
    this._task((dt) => {
      if (stopped) return false;
      const n = acc(rate, dt);
      if (n) emitN(n, false);
      return true;
    });
    return { stop: () => { stopped = true; } };
  }
}

const SPELLS = {
  flame: '_spFlame', inferno: '_spInferno', frost: '_spFrost', blizzard: '_spBlizzard',
  bolt: '_spBolt', tempest: '_spTempest', holy: '_spHoly', nova: '_spNova',
  heal: '_spHeal', healAll: '_spHealAll', dark: '_spDark', drain: '_spDrain',
  dragonFang: '_spDragonFang', breath: '_spBreath', summon: '_spSummon',
};

/** Names accepted by VFX#spell. */
export const SPELL_NAMES = Object.freeze(Object.keys(SPELLS));

