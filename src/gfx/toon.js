// Shared anime-style (cel) shading toolkit used by every visual module.
// - toonMaterial(): MeshToonMaterial + rim light, tint/flash and dissolve support
// - addOutline()/outlineAll(): screen-space-width inverted-hull outlines
// - setTint()/setDissolve(): per-object effects for hit flashes, "acted" greying and death dissolves
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const toonGlobals = {
  resolution: { value: new THREE.Vector2(1920, 1080) }, // drawing-buffer pixels
  outlineScale: { value: 1 }, // = devicePixelRatio, so outline widths are given in CSS px
  rimColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
  rimStrength: { value: 0.38 },
  time: { value: 0 },
};

/** Call on resize (engine does this). */
export function setToonResolution(cssWidth, cssHeight, pixelRatio = 1) {
  toonGlobals.resolution.value.set(Math.max(1, cssWidth * pixelRatio), Math.max(1, cssHeight * pixelRatio));
  toonGlobals.outlineScale.value = pixelRatio;
}

// ---------------------------------------------------------------- gradient maps
const gradientCache = new Map();
const GRADIENT_STYLES = {
  // [dotNL threshold, tone] pairs, evaluated in order; last tone used above final threshold
  anime2: [[0.05, 0.42], [2, 1.0]],
  anime3: [[-0.25, 0.36], [0.22, 0.7], [2, 1.0]],
  soft4: [[-0.4, 0.3], [-0.05, 0.52], [0.35, 0.78], [2, 1.0]],
  flat: [[2, 1.0]],
};

/** Returns a NearestFilter gradient texture for MeshToonMaterial. */
export function gradientMap(style = 'anime3') {
  if (gradientCache.has(style)) return gradientCache.get(style);
  const bands = GRADIENT_STYLES[style] || GRADIENT_STYLES.anime3;
  const N = 64;
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const dot = (i / (N - 1)) * 2 - 1;
    let tone = 1;
    for (const [th, t] of bands) { if (dot < th) { tone = t; break; } }
    const v = Math.round(tone * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientCache.set(style, tex);
  return tex;
}

// ---------------------------------------------------------------- toon material
const TOON_FRAG_PARS = /* glsl */ `
varying vec3 vToonObjPos;
uniform vec4 uTint;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uRimMul;
uniform vec3 uRimColor;
uniform float uRimStrength;
float ewkHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ewkNoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ewkHash(i), ewkHash(i + vec3(1,0,0)), f.x), mix(ewkHash(i + vec3(0,1,0)), ewkHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ewkHash(i + vec3(0,0,1)), ewkHash(i + vec3(1,0,1)), f.x), mix(ewkHash(i + vec3(0,1,1)), ewkHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

const TOON_FRAG_MAIN = /* glsl */ `
{
  vec3 ewkView = normalize(vViewPosition);
  float ewkRim = 1.0 - clamp(dot(normalize(normal), ewkView), 0.0, 1.0);
  ewkRim = smoothstep(0.6, 0.92, ewkRim);
  outgoingLight += uRimColor * ewkRim * uRimStrength * uRimMul;
  outgoingLight = mix(outgoingLight, uTint.rgb, uTint.a);
  if (uDissolve > 0.0) {
    float n = ewkNoise(vToonObjPos * 7.0) * 0.65 + ewkNoise(vToonObjPos * 19.0) * 0.35;
    if (n < uDissolve) discard;
    float edge = 1.0 - smoothstep(0.0, 0.07, n - uDissolve);
    outgoingLight += uDissolveColor * edge * 4.0;
  }
}
#include <opaque_fragment>
`;

/**
 * Anime cel-shaded material.
 * opts: color, map, emissive, emissiveIntensity, gradient ('anime2'|'anime3'|'soft4'|'flat'),
 *       rim (multiplier, default 1), transparent, opacity, side, vertexColors, alphaTest, depthWrite, fog
 * material.userData.toon holds per-material uniforms { uTint, uDissolve, uDissolveColor, uRimMul }.
 */
export function toonMaterial(opts = {}) {
  const {
    color = 0xffffff, map = null, emissive = 0x000000, emissiveIntensity = 1, emissiveMap = null,
    gradient = 'anime3', rim = 1.0, transparent = false, opacity = 1, side = THREE.FrontSide,
    vertexColors = false, alphaTest = 0, depthWrite = true, fog = true, name = '',
  } = opts;
  const mat = new THREE.MeshToonMaterial({
    color, map, emissive, emissiveIntensity, emissiveMap, gradientMap: gradientMap(gradient),
    transparent, opacity, side, vertexColors, alphaTest, depthWrite, fog,
  });
  mat.name = name;
  const u = {
    uTint: { value: new THREE.Vector4(1, 1, 1, 0) },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(1.0, 0.55, 0.18) },
    uRimMul: { value: rim },
  };
  mat.userData.toon = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uRimColor: toonGlobals.rimColor, uRimStrength: toonGlobals.rimStrength });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vToonObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvToonObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TOON_FRAG_PARS)
      .replace('#include <opaque_fragment>', TOON_FRAG_MAIN);
  };
  mat.customProgramCacheKey = () => 'ewk-toon-v1';
  return mat;
}

// ---------------------------------------------------------------- outlines
const outlineCache = new Map();

/** Back-face hull material whose width is constant in screen pixels. */
export function outlineMaterial({ color = 0x1a1222, width = 2.0, opacity = 1 } = {}) {
  const key = `${color}|${width}|${opacity}`;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const mat = new THREE.MeshBasicMaterial({
    color, side: THREE.BackSide, transparent: opacity < 1, opacity, fog: true,
  });
  const uWidth = { value: width };
  mat.userData.outline = { uWidth };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = uWidth;
    shader.uniforms.uResolution = toonGlobals.resolution;
    shader.uniforms.uOutlineScale = toonGlobals.outlineScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutlineWidth;\nuniform vec2 uResolution;\nuniform float uOutlineScale;')
      .replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
      {
        vec3 ewkN = normal;
        #ifdef USE_INSTANCING
          ewkN = mat3(instanceMatrix) * ewkN;
        #endif
        vec3 ewkVN = normalize(normalMatrix * ewkN);
        vec2 ewkDir = (projectionMatrix * vec4(ewkVN, 0.0)).xy * uResolution;
        float ewkLen = length(ewkDir);
        if (ewkLen > 1e-6) ewkDir /= ewkLen;
        gl_Position.xy += ewkDir * uOutlineWidth * uOutlineScale * 2.0 / uResolution * gl_Position.w;
      }`);
  };
  mat.customProgramCacheKey = () => 'ewk-outline-v1';
  outlineCache.set(key, mat);
  return mat;
}

const smoothCache = new WeakMap();
/** Geometry copy with welded vertices + averaged normals (prevents cracked outlines on hard edges). */
export function smoothNormalGeometry(geo) {
  if (smoothCache.has(geo)) return smoothCache.get(geo);
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  smoothCache.set(geo, merged);
  return merged;
}

/**
 * Adds an outline hull as a child of `mesh`. Works for Mesh and InstancedMesh.
 * opts: color, width (CSS px), smoothNormals (use for boxes / hard-edged geometry)
 */
export function addOutline(mesh, opts = {}) {
  const { color = 0x1a1222, width = 2.0, smoothNormals = false, opacity = 1 } = opts;
  const geo = smoothNormals ? smoothNormalGeometry(mesh.geometry) : mesh.geometry;
  const mat = outlineMaterial({ color, width, opacity });
  let om;
  if (mesh.isInstancedMesh) {
    om = new THREE.InstancedMesh(geo, mat, mesh.count);
    om.instanceMatrix = mesh.instanceMatrix;
    om.frustumCulled = false;
  } else {
    om = new THREE.Mesh(geo, mat);
  }
  om.castShadow = false;
  om.receiveShadow = false;
  om.userData.isOutline = true;
  om.raycast = () => {};
  om.renderOrder = mesh.renderOrder;
  mesh.add(om);
  return om;
}

/** Adds outlines to every mesh under `root` (skips userData.noOutline and existing outlines). */
export function outlineAll(root, opts = {}) {
  const targets = [];
  root.traverse((o) => {
    if ((o.isMesh || o.isInstancedMesh) && !o.userData.isOutline && !o.userData.noOutline && !o.isSprite) targets.push(o);
  });
  for (const m of targets) addOutline(m, { ...opts, smoothNormals: opts.smoothNormals ?? !!m.userData.hardEdges });
  return root;
}

// ---------------------------------------------------------------- per-object effects
/** Mix every toon material under root toward `color` by `amount` (0..1). Used for hit flash / greyed-out. */
export function setTint(root, color = 0xffffff, amount = 0) {
  const c = color instanceof THREE.Color ? color : new THREE.Color(color);
  root.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      const t = m.userData && m.userData.toon;
      if (t) t.uTint.value.set(c.r, c.g, c.b, amount);
    }
  });
}

/** Dissolve every toon material under root (0 = solid, 1 = gone). Outlines fade out with it. */
export function setDissolve(root, t = 0, edgeColor) {
  root.traverse((o) => {
    if (o.userData.isOutline) { o.visible = t <= 0.02; return; }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      const u = m.userData && m.userData.toon;
      if (u) {
        u.uDissolve.value = t;
        if (edgeColor !== undefined) u.uDissolveColor.value.set(edgeColor);
      }
    }
  });
}

/** Clone a toon material keeping toon behaviour (materials are per-character so tints don't leak). */
export function cloneToon(mat) {
  const t = mat.userData.toon;
  return toonMaterial({
    color: mat.color.getHex(), map: mat.map, emissive: mat.emissive.getHex(), emissiveIntensity: mat.emissiveIntensity,
    rim: t ? t.uRimMul.value : 1, transparent: mat.transparent, opacity: mat.opacity, side: mat.side,
    vertexColors: mat.vertexColors, alphaTest: mat.alphaTest, depthWrite: mat.depthWrite, fog: mat.fog,
  });
}

// ---------------------------------------------------------------- misc helpers
/** Canvas-backed sRGB texture. draw(ctx, w, h) */
export function canvasTexture(w, h, draw, { repeat = false, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; }
  tex.anisotropy = 4;
  return tex;
}

/** Hex color helpers */
export function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f); else c.multiplyScalar(1 + f);
  return c.getHex();
}
