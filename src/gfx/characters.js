// Public character API: builds cel-shaded skinned figurines from cast looks and drives their
// procedural animation (loops, one-shots with impact callbacks, blinking, secondary motion).
import * as THREE from 'three';
import { toonMaterial, toonGlobals, setDissolve as toonSetDissolve } from './toon.js';
import { makeBones, boneInverses, compileClip, evalClip, mixPose, applyPose, SpringChain, clamp, makeRng, hashStr } from './char-anim.js';
import { faceDecalGeometry, faceTexture, warmFace, EXPRESSIONS } from './char-faces.js';
import { buildHumanoid } from './char-humanoid.js';
import { buildMonster, buildWyvern } from './char-monsters.js';

// ------------------------------------------------------------------ shared materials
const OUTLINE_COLOR = 0x1a1222;
let skinOutlineMat = null;

/** Screen-space hull for skinned meshes: uses skinned normals and a per-vertex width attribute. */
function makeHullMaterial({ color = OUTLINE_COLOR, width = 2.2, additive = false, opacity = 1, key = 'ewk-char-hull' } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.BackSide, transparent: additive || opacity < 1, opacity, depthWrite: !additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive, fog: true,
  });
  const uWidth = { value: width };
  mat.userData.outline = { uWidth };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = uWidth;
    shader.uniforms.uResolution = toonGlobals.resolution;
    shader.uniforms.uOutlineScale = toonGlobals.outlineScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;\nuniform vec2 uResolution;\nuniform float uOutlineScale;\nattribute float aOutline;')
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
      {
        #ifdef USE_SKINNING
          vec3 hullN = normalize(transformedNormal);
        #else
          vec3 hullN = normalize(normalMatrix * normal);
        #endif
        vec2 hullDir = (projectionMatrix * vec4(hullN, 0.0)).xy * uResolution;
        float hullLen = length(hullDir);
        if (hullLen > 1e-6) hullDir /= hullLen;
        gl_Position.xy += hullDir * uOutlineWidth * aOutline * uOutlineScale * 2.0 / uResolution * gl_Position.w;
      }`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

function outlineMat() {
  if (!skinOutlineMat) skinOutlineMat = makeHullMaterial({});
  return skinOutlineMat;
}

/** Unlit HDR material for glowing parts (vertex colours above 1.0 feed the bloom pass). */
function glowMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, depthWrite: true, fog: false });
}

let auraDiscTex = null;
function auraTexture() {
  if (auraDiscTex) return auraDiscTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 63);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  auraDiscTex = new THREE.CanvasTexture(c);
  auraDiscTex.colorSpace = THREE.SRGBColorSpace;
  return auraDiscTex;
}
const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

// ------------------------------------------------------------------ blueprints (cached per look)
const blueprintCache = new Map();

function blueprintFor(look, team, quality) {
  const key = `${team}|${quality}|${JSON.stringify(look)}`;
  let bp = blueprintCache.get(key);
  if (!bp) {
    const opts = { team, quality };
    bp = (!look.kind || look.kind === 'humanoid') ? buildHumanoid(look, opts) : buildMonster(look, opts);
    bp.inverses = boneInverses(bp.def);
    bp.compiled = {};
    for (const name in bp.clips) bp.compiled[name] = compileClip(bp.clips[name], bp.def, name);
    if (look.mount && look.mount.kind === 'wyvern') {
      const mb = buildWyvern(look.mount, opts);
      mb.inverses = boneInverses(mb.def);
      mb.compiled = {};
      for (const name in mb.clips) mb.compiled[name] = compileClip(mb.clips[name], mb.def, name);
      bp.mountBp = mb;
    }
    blueprintCache.set(key, bp);
  }
  return bp;
}

// ------------------------------------------------------------------ rig instance
const CHAIN_TUNING = {
  cape: { k: 55, d: 8.5 }, hair: { k: 150, d: 17 }, scarf: { k: 40, d: 6 }, tail: { k: 60, d: 8 }, hem: { k: 50, d: 7 },
};

/** One skinned figure (body, outline hull, glow and translucent layers, face decal, spring chains). */
class RigInstance {
  constructor(bp, look) {
    this.bp = bp;
    const { bones, root } = makeBones(bp.def);
    this.bones = bones;
    this.rest = bones.map((b) => b.position.clone());
    this.group = new THREE.Group();
    this.group.add(root);
    this.skeleton = new THREE.Skeleton(bones, bp.inverses.map((m) => m.clone()));
    this.toonMats = [];
    this.glowMats = [];
    this.meshes = [];
    const ident = new THREE.Matrix4();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, bp.height * 0.5, 0), bp.radius || bp.height * 1.1);
    const L = bp.layers;
    const addSkinned = (geo, mat, { shadow = false, outline = false, order = 0 } = {}) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.bind(this.skeleton, ident);
      m.boundingSphere = sphere;
      m.castShadow = shadow;
      m.receiveShadow = false;
      m.renderOrder = order;
      if (outline) { m.userData.isOutline = true; m.raycast = () => {}; }
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    if (L.body) {
      const mat = toonMaterial({ color: 0xffffff, vertexColors: true, name: 'charBody' });
      this.toonMats.push(mat);
      this.body = addSkinned(L.body.geometry, mat, { shadow: true });
      if (L.body.outline) this.hull = addSkinned(L.body.outline, outlineMat(), { outline: true });
    }
    if (L.trans) {
      const mat = toonMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, name: 'charTrans' });
      if (bp.transFlutter) addFlutter(mat, bp.transFlutter);
      this.toonMats.push(mat);
      this.trans = addSkinned(L.trans.geometry, mat, { order: 1 });
    }
    if (L.glow) {
      const mat = glowMaterial();
      this.glowMats.push(mat);
      this.glow = addSkinned(L.glow.geometry, mat, { order: 2 });
    }
    if (bp.face) {
      const exprMap = faceTexture(look, 'neutral');
      const mat = toonMaterial({ color: 0xe6e6e6, map: exprMap, transparent: true, depthWrite: false, emissive: 0x1e1e1e, emissiveMap: exprMap, name: 'charFace' });
      this.toonMats.push(mat);
      this.faceMat = mat;
      const f = bp.face;
      const decal = new THREE.Mesh(faceDecalGeometry(bp.quality), mat);
      decal.position.set(f.at[0], f.at[1], f.at[2]);
      decal.scale.set(f.scl[0], f.scl[1], f.scl[2]);
      decal.userData.noOutline = true;
      decal.renderOrder = 1;
      this.bone(f.bone).add(decal);
      this.face = decal;
    }
    const n6 = bones.length * 6;
    this.P = new Float32Array(n6); this.A = new Float32Array(n6); this.B = new Float32Array(n6);
    this.C = new Float32Array(n6); this.H = new Float32Array(n6);
    this.chains = (bp.chains || []).map((c) => {
      const ids = c.bones.map((n) => bp.def.idx(n)).filter((i) => i !== undefined);
      const sc = new SpringChain(ids, CHAIN_TUNING[c.kind] || CHAIN_TUNING.cape);
      sc.kind = c.kind; sc.amp = c.amp || 1; sc.phase = c.phase || 0; sc.base = c.base || 0; sc.side = c.side || 0;
      return sc;
    });
    const ids = (names) => names.map((n) => bp.def.idx(n)).filter((i) => i !== undefined);
    this.leanIds = ids(['base', 'hips', 'spine', 'chest', 'body']);
    this.headIds = ids(['head', 'neck']);
  }
  bone(name) { const i = this.bp.def.idx(name); return i === undefined ? null : this.bones[i]; }
  clip(name) {
    const c = this.bp.compiled;
    if (c[name]) return c[name];
    const a = this.bp.alias && this.bp.alias[name];
    return a && c[a] ? c[a] : null;
  }
  dispose() {
    for (const m of this.toonMats) m.dispose();
    for (const m of this.glowMats) m.dispose();
    this.skeleton.dispose();
  }
}

/** Adds a gentle vertex flutter (wraith hems) to a translucent toon material. */
function addFlutter(mat, { amp = 0.03, freq = 5, below = 0.5 }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uFlutterTime = toonGlobals.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlutterTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float fl = clamp((${below.toFixed(3)} - position.y) / ${below.toFixed(3)}, 0.0, 1.0);
        float ph = position.x * 23.0 + position.z * 17.0;
        transformed.x += sin(uFlutterTime * ${freq.toFixed(2)} + ph) * ${amp.toFixed(3)} * fl;
        transformed.z += cos(uFlutterTime * ${(freq * 0.8).toFixed(2)} + ph * 1.3) * ${amp.toFixed(3)} * fl;
        transformed.y += sin(uFlutterTime * ${(freq * 1.3).toFixed(2)} + ph * 0.7) * ${(amp * 0.5).toFixed(3)} * fl;
      }`);
  };
  mat.customProgramCacheKey = () => 'ewk-toon-flutter';
}

// ------------------------------------------------------------------ character
const ONE_SHOT_TIMES = {
  attack: [0.75, 0.38], attack2: [1.0, 0.55], shoot: [1.0, 0.6], cast: [1.1, 0.75], hit: [0.4, 0.04], dodge: [0.45, 0.18],
  death: [1.0, 0.7], victory: [1.2, 0.5], jump: [0.5, 0.4], talk: [0.8, 0.3], levelup: [1.3, 0.6],
};
const LOOP_NAMES = new Set(['idle', 'walk', 'run', 'ready', 'hurt', 'dead', 'fly']);
const GREY = new THREE.Color(0x77777f);
const _tmpV = new THREE.Vector3(), _tmpV2 = new THREE.Vector3(), _tmpC = new THREE.Color();
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

/** A posable, animated unit model. Create with createCharacter(). */
export class Character {
  constructor(look, opts = {}) {
    if (!look) throw new Error('createCharacter: look is required');
    const team = opts.team || 'player', quality = opts.quality || 'high';
    this.look = look; this.team = team; this.quality = quality;
    const bp = blueprintFor(look, team, quality);
    this.bp = bp;
    this.root = new THREE.Group();
    this.root.name = `character:${look.kind || 'humanoid'}`;
    this.root.userData.character = this;
    this._yaw = new THREE.Group();
    this._model = new THREE.Group();
    this.root.add(this._yaw);
    this._yaw.add(this._model);
    const scale = (look.scale || 1) * (bp.baseScale || 1);
    this._scale = scale;
    this._model.scale.setScalar(scale);
    this.main = new RigInstance(bp, look);
    this.rigs = [this.main];
    if (bp.mountBp) {
      this.mountRig = new RigInstance(bp.mountBp, look);
      this._model.add(this.mountRig.group);
      this.mountRig.bone('saddle').add(this.main.group);
      this.main.group.position.y = -bp.dims.hipY + 0.02;
      this.rigs.unshift(this.mountRig);
      this.height = (bp.mountBp.saddleY + bp.mountBp.hover + bp.height - bp.dims.hipY + 0.02) * scale;
    } else {
      this._model.add(this.main.group);
      this.height = (bp.height + (bp.hover || 0)) * scale;
    }
    this._anchors = {};
    for (const name in bp.anchors) {
      const a = bp.anchors[name];
      const rig = a.mount ? this.mountRig : this.main;
      if (!rig) continue;
      const bi = rig.bp.def.idx(a.bone);
      const o = new THREE.Object3D();
      o.position.set(a.at[0], a.at[1], a.at[2]).sub(rig.bp.def.pos[bi]);
      rig.bones[bi].add(o);
      this._anchors[name] = o;
    }
    if (bp.arrow) this._makeArrow(bp.arrow);
    if (look.aura) this._makeAura(look.aura, bp);
    this._time = 0;
    this._rng = makeRng(hashStr(JSON.stringify(look)) ^ 0x9e3779b9);
    this._facingTarget = 0; this._facingCur = 0; this._turnRate = 0;
    this._state = bp.defaultLoop || 'idle';
    this._loopT = this._rng() * 2;
    this._prevState = null; this._prevT = 0; this._fade = 1;
    this._one = null; this._out = null;
    this._expr = 'neutral'; this._shownExpr = 'neutral';
    this._blinkNext = 1.5 + this._rng() * 3; this._blinkUntil = -1;
    this._flash = null; this._greyed = false; this._dissolve = 0; this._tintDirty = true;
    this._lastRoot = new THREE.Vector3(NaN, 0, 0);
    this._vel = new THREE.Vector2(); this._baseLast = new THREE.Vector2();
    this._ctx = { ch: this, rig: null, time: 0, arrow: false, glowBoost: 0, flutter: 0 };
    if (bp.face) warmFace(look);
    this.update(0);
  }

  /** Current facing (radians about Y; 0 = +Z). Assigning turns immediately. */
  get facing() { return this._facingTarget; }
  set facing(v) { this.setFacing(v, true); }

  /** Turn to `rad` (smoothly over ~0.15 s unless `immediate`). */
  setFacing(rad, immediate = false) {
    if (!Number.isFinite(rad)) return;
    this._facingTarget = wrapAngle(rad);
    if (immediate) { this._facingCur = this._facingTarget; this._yaw.rotation.y = this._facingCur; }
  }

  /** Face a world-space point. */
  faceTowards(worldVec3, immediate = false) {
    this.root.updateWorldMatrix(true, false);
    _tmpV.setFromMatrixPosition(this.root.matrixWorld);
    const dx = worldVec3.x - _tmpV.x, dz = worldVec3.z - _tmpV.z;
    if (dx * dx + dz * dz < 1e-10) return;
    let parentYaw = 0;
    if (this.root.parent) { this.root.parent.getWorldQuaternion(_q0); _e0.setFromQuaternion(_q0, 'YXZ'); parentYaw = _e0.y; }
    this.setFacing(Math.atan2(dx, dz) - parentYaw - this.root.rotation.y, immediate);
  }

  /** Switch the looping state: idle | walk | run | ready | hurt | dead | fly. */
  setState(name) {
    if (!LOOP_NAMES.has(name)) name = 'idle';
    if (this.bp.loopAlias && this.bp.loopAlias[name]) name = this.bp.loopAlias[name];
    if (name === this._state) return;
    this._prevState = this._state; this._prevT = this._loopT;
    this._fade = 0;
    const keepPhase = (name === 'walk' || name === 'run') && (this._state === 'walk' || this._state === 'run');
    this._state = name;
    if (!keepPhase) this._loopT = 0;
  }
  get state() { return this._state; }

  /**
   * Play a one-shot clip; resolves when it ends (the figure then blends back to the current loop).
   * opts.onImpact fires exactly once per call (at the strike / release moment, or on interruption).
   */
  play(name, opts = {}) {
    if (this._one) this._finishOne(true);
    const speed = opts.speed > 0 ? opts.speed : 1;
    const clip = this.main.clip(name) || (this.mountRig && this.mountRig.clip(name));
    const tbl = ONE_SHOT_TIMES[name] || [0.6, 0.3];
    const dur = clip ? clip.dur : tbl[0], impact = clip ? Math.min(clip.impact, clip.dur) : tbl[1];
    return new Promise((resolve) => {
      this._one = { name, t: 0, dur, impact, speed, fired: false, onImpact: opts.onImpact, resolve, blendIn: clip && clip.blendIn !== undefined ? clip.blendIn : 0.07 };
      this._out = null;
    });
  }

  /** Base facial expression: neutral | angry | hurt | happy | closed. */
  setExpression(name) { this._expr = EXPRESSIONS.includes(name) ? name : 'neutral'; }

  /** Brief colour flash (hit feedback). */
  flash(color = 0xffffff, duration = 0.12) {
    this._flash = { color: new THREE.Color(color), dur: Math.max(0.01, duration), t: 0 };
    this._tintDirty = true;
  }

  /** Grey "already acted" look. */
  setGreyed(on) { this._greyed = !!on; this._tintDirty = true; }

  /** Dissolve the whole figure (0 = solid, 1 = gone). */
  setDissolve(t) {
    t = clamp(t, 0, 1);
    this._dissolve = t;
    toonSetDissolve(this.root, t);
    for (const rig of this.rigs) for (const m of rig.glowMats) m.opacity = 1 - t;
    if (this._aura) this._aura.visible = t < 0.98;
    if (this._arrow) this._arrow.visible = this._arrow.visible && t < 0.02;
  }

  /** Advance animation by dt seconds (call every frame). */
  update(dt) {
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    this._time += dt;
    const ctx = this._ctx;
    ctx.time = this._time; ctx.arrow = false; ctx.glowBoost = 0; ctx.flutter = 0;
    // facing
    const prevF = this._facingCur;
    const diff = wrapAngle(this._facingTarget - this._facingCur);
    this._facingCur = Math.abs(diff) < 1e-4 ? this._facingTarget : wrapAngle(this._facingCur + diff * (1 - Math.exp(-dt * 21)));
    this._yaw.rotation.y = this._facingCur;
    const turn = dt > 0 ? wrapAngle(this._facingCur - prevF) / dt : 0;
    this._turnRate += (turn - this._turnRate) * Math.min(1, dt * 10);
    // one-shot timeline (impact fires exactly once, even when a large dt jumps past it)
    const o = this._one;
    if (o) {
      o.t += dt * o.speed;
      if (!o.fired && o.t >= o.impact) {
        o.fired = true;
        if (o.onImpact) { try { o.onImpact(); } catch (e) { console.error(e); } }
      }
      if (this._one === o && o.t >= o.dur) this._finishOne(false);
    }
    if (this._out) { this._out.t += dt; if (this._out.t >= this._out.dur) this._out = null; }
    this._loopT += dt;
    this._prevT += dt;
    if (this._fade < 1) this._fade = Math.min(1, this._fade + dt / 0.22);
    // body velocity in the facing frame (drives capes / hair)
    const rp = this.root.position;
    let vx = 0, vz = 0;
    if (dt > 0 && Number.isFinite(this._lastRoot.x)) {
      vx = (rp.x - this._lastRoot.x) / dt; vz = (rp.z - this._lastRoot.z) / dt;
      if (Math.abs(rp.x - this._lastRoot.x) + Math.abs(rp.z - this._lastRoot.z) > 0.75) { vx = 0; vz = 0; }
    }
    this._lastRoot.copy(rp);
    const sf = Math.sin(this._facingCur), cf = Math.cos(this._facingCur);
    let vF = vx * sf + vz * cf, vL = vx * cf - vz * sf;
    for (let i = 0; i < this.rigs.length; i++) this._evalRig(this.rigs[i], dt);
    const BP = this.rigs[0].P;
    const bx = BP[3], bz = BP[5];
    if (dt > 0) { vF += (bz - this._baseLast.y) / dt; vL += (bx - this._baseLast.x) / dt; }
    this._baseLast.set(bx, bz);
    const k = Math.min(1, dt * 8);
    this._vel.x += (clamp(vF, -6, 6) - this._vel.x) * k;
    this._vel.y += (clamp(vL, -6, 6) - this._vel.y) * k;
    if (this._arrow) this._arrow.visible = ctx.arrow && this._dissolve < 0.02;
    this._updateFace();
    this._updateTint(dt);
    this._updateGlow(dt);
  }

  _finishOne(interrupted) {
    const o = this._one;
    if (!o) return;
    this._one = null;
    if (!o.fired) {
      o.fired = true;
      if (o.onImpact) { try { o.onImpact(); } catch (e) { console.error(e); } }
    }
    for (const rig of this.rigs) {
      const c = rig.clip(o.name);
      rig.outClip = c;
      if (c) evalClip(c, interrupted ? o.t : c.dur, rig.H, this._ctx);
    }
    if (o.name === 'death') {
      this._state = 'dead'; this._prevState = null; this._fade = 1; this._loopT = 0;
      this._out = { t: 0, dur: 0.25 };
    } else {
      this._out = { t: 0, dur: interrupted ? 0.1 : 0.2 };
    }
    o.resolve();
  }

  _evalRig(rig, dt) {
    const ctx = this._ctx;
    ctx.rig = rig;
    const lc = rig.clip(this._state) || rig.clip('idle');
    if (lc) evalClip(lc, this._loopT, rig.A, ctx); else rig.A.fill(0);
    if (this._fade < 1 && this._prevState) {
      const pc = rig.clip(this._prevState);
      if (pc) { evalClip(pc, this._prevT, rig.B, ctx); mixPose(rig.A, rig.B, rig.A, smooth01(this._fade)); }
    }
    const P = rig.P;
    const o = this._one;
    let oneClip = null;
    if (o) {
      oneClip = rig.clip(o.name);
      if (oneClip) {
        evalClip(oneClip, o.t, rig.C, ctx);
        const bi = oneClip.blendIn !== undefined ? oneClip.blendIn : o.blendIn;
        mixPose(P, rig.A, rig.C, bi > 0 ? smooth01(o.t / bi) : 1, oneClip.mask);
        ctx.flutter = Math.max(ctx.flutter, oneClip.flutter || 0);
      } else P.set(rig.A);
    } else if (this._out && rig.outClip) {
      mixPose(P, rig.A, rig.H, 1 - smooth01(this._out.t / this._out.dur), rig.outClip.mask);
    } else {
      P.set(rig.A);
    }
    if (rig.bp.post) rig.bp.post(P, ctx);
    this._driveChains(rig, dt);
    applyPose(rig.bones, rig.rest, P);
  }

  _driveChains(rig, dt) {
    if (!rig.chains.length) return;
    const P = rig.P, t = this._time;
    const lying = this._state === 'dead' && !this._one;
    const speed = Math.hypot(this._vel.x, this._vel.y);
    const flutter = this._ctx.flutter;
    let lean = 0;
    for (let i = 0; i < rig.leanIds.length; i++) lean += P[rig.leanIds[i] * 6];
    let headLean = lean;
    for (let i = 0; i < rig.headIds.length; i++) headLean += P[rig.headIds[i] * 6];
    for (let ci = 0; ci < rig.chains.length; ci++) {
      const ch = rig.chains[ci];
      const n = ch.ids.length;
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0;
        let tx = 0, tz = 0;
        if (ch.kind === 'cape' || ch.kind === 'scarf') {
          const amp = (ch.kind === 'scarf' ? 0.12 : 0.05) + speed * 0.16 + flutter * 0.35;
          tx = (ch.base || 0.08) / n + clamp(this._vel.x * 0.5, -0.2, 1.1) * (0.45 + 0.55 * u) / n * 1.6
            + Math.sin(t * (ch.kind === 'scarf' ? 9 : 6.5) - i * 0.9 + ch.phase) * amp * (0.3 + u);
          tz = clamp(-this._vel.y * 0.45, -0.6, 0.6) / n + this._turnRate * 0.06 * u
            + Math.sin(t * 4.3 - i * 1.1 + ch.phase) * amp * 0.5 * u;
          if (i === 0) tx -= lean;
        } else if (ch.kind === 'hair') {
          const amp = 0.025 + speed * 0.05 + flutter * 0.12;
          tx = clamp(this._vel.x * 0.25, -0.15, 0.5) / n + Math.sin(t * 3.1 - i * 0.8 + ch.phase) * amp;
          tz = clamp(-this._vel.y * 0.3, -0.4, 0.4) / n + this._turnRate * 0.04 + Math.sin(t * 2.3 - i + ch.phase) * amp * 0.6;
          if (i === 0) tx -= headLean * 0.7;
          tx = clamp(tx, -0.7, 0.7);
        } else if (ch.kind === 'tail') {
          tz = this._turnRate * 0.08 + clamp(-this._vel.y * 0.2, -0.3, 0.3) / n;
          tx = clamp(this._vel.x * 0.12, -0.2, 0.3) / n;
        } else if (ch.kind === 'hem') {
          tx = Math.sin(t * 2.6 - i * 0.9 + ch.phase) * 0.06 + clamp(this._vel.x * 0.25, -0.2, 0.6) / n;
          tz = Math.sin(t * 2.1 - i * 1.3 + ch.phase) * 0.05;
        }
        if (lying) { tx = 0; tz = 0; }
        ch.tx[i] = tx * ch.amp; ch.tz[i] = tz * ch.amp;
      }
      ch.step(dt);
      ch.write(P);
    }
  }

  _updateFace() {
    const face = this.main.faceMat;
    if (!face) return;
    let expr = this._expr;
    const oc = this._one ? this.main.clip(this._one.name) : null;
    if (oc && oc.expr) expr = oc.expr;
    else if (expr === 'neutral') {
      if (this._state === 'dead') expr = 'closed';
      else if (this._state === 'hurt') expr = 'hurt';
    }
    if (this._time >= this._blinkNext) {
      this._blinkUntil = this._time + 0.11;
      this._blinkNext = this._time + (this._rng() < 0.18 ? 0.25 : 3 + this._rng() * 2);
    }
    if ((expr === 'neutral' || expr === 'angry') && this._time < this._blinkUntil) expr = 'closed';
    if (expr !== this._shownExpr) {
      const tex = faceTexture(this.look, expr);
      face.map = tex; face.emissiveMap = tex;
      this._shownExpr = expr;
    }
  }

  _updateTint(dt) {
    const f = this._flash;
    if (f) { f.t += dt; if (f.t >= f.dur) this._flash = null; this._tintDirty = true; }
    if (!this._tintDirty) return;
    this._tintDirty = false;
    let amount = this._greyed ? 0.45 : 0;
    _tmpC.copy(GREY);
    if (this._flash) {
      const k = 1 - smooth01(this._flash.t / this._flash.dur);
      if (this._greyed) { _tmpC.lerp(this._flash.color, k); amount = Math.max(amount, 0.85 * k); }
      else { _tmpC.copy(this._flash.color); amount = 0.85 * k; }
    }
    for (let r = 0; r < this.rigs.length; r++) {
      const rig = this.rigs[r];
      for (let i = 0; i < rig.toonMats.length; i++) rig.toonMats[i].userData.toon.uTint.value.set(_tmpC.r, _tmpC.g, _tmpC.b, amount);
    }
  }

  _updateGlow() {
    const t = this._time;
    const k = (this._greyed ? 0.4 : 1) * (0.92 + 0.08 * Math.sin(t * 7.3) + this._ctx.glowBoost);
    for (let r = 0; r < this.rigs.length; r++) {
      const mats = this.rigs[r].glowMats;
      for (let i = 0; i < mats.length; i++) mats[i].color.setScalar(k);
    }
    if (this._aura) {
      const a = this._aura;
      const p = 0.5 + 0.5 * Math.sin(t * 2.2);
      const fade = 1 - this._dissolve;
      if (a.disc) { a.disc.material.opacity = (0.32 + 0.22 * p) * a.strength * fade; a.disc.scale.setScalar(a.radius * (0.94 + 0.08 * p)); }
      if (a.shell) a.shell.material.opacity = (0.22 + 0.2 * p) * a.strength * fade;
    }
  }

  _makeAura(color, bp) {
    const boss = (this.look.scale || 1) > 1.04 || this.look.kind === 'wyrm';
    const strength = boss ? 1 : 0.6;
    const group = new THREE.Group();
    const discMat = new THREE.MeshBasicMaterial({ map: auraTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.4 });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.y = 0.015;
    disc.renderOrder = -1;
    disc.userData.noOutline = true;
    group.add(disc);
    let shell = null;
    if (this.main.hull) {
      const c = new THREE.Color(color).multiplyScalar(boss ? 1.0 : 0.8);
      const mat = makeHullMaterial({ color: c, width: boss ? 5 : 3.5, additive: true, opacity: 0.4, key: 'ewk-char-aura' });
      shell = new THREE.SkinnedMesh(this.main.hull.geometry, mat);
      shell.bind(this.main.skeleton, new THREE.Matrix4());
      shell.boundingSphere = this.main.body.boundingSphere;
      shell.renderOrder = -1;
      shell.userData.isOutline = true;
      shell.raycast = () => {};
      this.main.group.add(shell);
    }
    const radius = (bp.auraRadius || 0.55) * (this.look.scale || 1);
    this.root.add(group);
    this._aura = { group, disc, shell, radius, strength, get visible() { return group.visible; }, set visible(v) { group.visible = v; if (shell) shell.visible = v; } };
  }

  _makeArrow(spec) {
    const geo = spec.geometry;
    const m = new THREE.Mesh(geo, this.main.body.material);
    m.visible = false;
    const nb = this.main.bone(spec.bone);
    m.position.set(spec.at[0], spec.at[1], spec.at[2]);
    if (spec.rot) m.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
    nb.add(m);
    addHullFor(m);
    this._arrow = m;
  }

  /**
   * World position of an anchor: weapon (tip) | hand | head | chest | feet | mouth | overhead.
   */
  getAnchor(name, target = new THREE.Vector3()) {
    if (name === 'feet') {
      const rig = this.rigs[0];
      rig.bones[0].updateWorldMatrix(true, false);
      target.setFromMatrixPosition(rig.bones[0].matrixWorld);
      this.root.updateWorldMatrix(true, false);
      target.y = _tmpV2.setFromMatrixPosition(this.root.matrixWorld).y;
      return target;
    }
    if (name === 'overhead') {
      this.getAnchor('head', target);
      this.root.updateWorldMatrix(true, false);
      target.y = _tmpV2.setFromMatrixPosition(this.root.matrixWorld).y + this.height + 0.18 * this._scale;
      return target;
    }
    const a = this._anchors[name] || this._anchors.head || this._anchors.chest;
    if (!a) return target.setFromMatrixPosition(this.root.matrixWorld);
    a.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(a.matrixWorld);
  }

  /** Release GPU resources owned by this character (shared geometry stays cached). */
  dispose() {
    if (this._one) this._finishOne(true);
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const rig of this.rigs) rig.dispose();
    if (this._aura) {
      this._aura.disc.material.dispose();
      if (this._aura.shell) this._aura.shell.material.dispose();
    }
    this.rigs = [];
  }
}

const _q0 = new THREE.Quaternion(), _e0 = new THREE.Euler();

function addHullFor(mesh) {
  const geo = mesh.geometry;
  if (!geo.attributes.aOutline) {
    const n = geo.attributes.position.count;
    geo.setAttribute('aOutline', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.8), 1));
  }
  const hull = new THREE.Mesh(geo, outlineMat());
  hull.userData.isOutline = true;
  hull.raycast = () => {};
  mesh.add(hull);
}

/**
 * Create an animated character for a cast look (see game/data/cast.js lookFor()).
 * @param {object} look appearance spec
 * @param {{team?: 'player'|'enemy'|'ally', quality?: 'high'|'low'}} [opts]
 * @returns {Character}
 */
export function createCharacter(look, opts = { team: 'player', quality: 'high' }) {
  return new Character(look, opts || {});
}

let preloadPromise = null;
/**
 * Warm shared resources (outline material, aura texture, face decal geometry). Optionally pass
 * looks to pre-build their (cached) geometry and face textures in small slices so the first
 * createCharacter() for each is instant.
 * @param {object[]} [looks] looks from lookFor() to warm up
 * @param {{team?: string, quality?: string}} [opts]
 * @returns {Promise<void>}
 */
export function preloadCharacterAssets(looks = [], opts = {}) {
  if (!preloadPromise) {
    preloadPromise = Promise.resolve().then(() => {
      outlineMat();
      auraTexture();
      faceDecalGeometry('high');
      faceDecalGeometry('low');
    });
  }
  if (!looks || !looks.length) return preloadPromise;
  const team = opts.team || 'player', quality = opts.quality || 'high';
  return preloadPromise.then(async () => {
    for (const look of looks) {
      if (!look) continue;
      blueprintFor(look, team, quality);
      if (!look.kind || look.kind === 'humanoid') warmFace(look);
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}
