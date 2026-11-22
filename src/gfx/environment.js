// Sky dome, sun / moon, hemisphere light, fog, optional ambient particles and drifting cloud shadows.
//
//   const env = new Environment(scene, renderer, 'day', { bounds: world.bounds, quality: 'high' });
//   every frame: env.update(dt, elapsed, camera);
//   post stack reads env.preset: exposure, bloomStrength, bloomThreshold, saturation, contrast, vignette, tint…
//
// Angles: azimuth in degrees measured from +Z toward +X (0 = +Z, 90 = +X, 180 = -Z), elevation in degrees above
// the horizon. `sunAz/sunEl` aim the shadow-casting light; `bodyAz/bodyEl` place the visible sun / moon disc.
// They are decoupled on purpose: cutscenes look toward -Z, the title camera toward +Z, the tactics camera
// never sees the sky. All colours are sRGB hex.
import * as THREE from 'three';

const DEG = Math.PI / 180;

const DEFAULTS = {
  zenith: 0x2a6fe8, skyMid: 0x5c9cf0, horizon: 0xbfe2ff, skyGround: null, skyCurve: 0.6,
  hazeColor: 0xe6f5ff, haze: 0.35,
  bodyAz: 205, bodyEl: 40, bodySize: 0.045, bodyColor: 0xfffbea, bodyIntensity: 8, moon: 0, moonPhase: 0, rays: 0,
  glowColor: 0xfff2cc, glow: 0.4, glowPow: 5,
  hGlowColor: 0xffd9a0, hGlow: 0,
  cloudCover: 0.6, cloudSoft: 0.035, cloudScale: 0.65, cloudSpeed: 0.01, cloudWind: 75,
  cloudLit: 0xffffff, cloudShade: 0x9fb3dc, cloudUnder: 0xc3c6e8, cloudRim: 0xffffff, cloudOpacity: 1,
  cumulus: 1, cumulusHeight: 0.22, cirrus: 0,
  stars: 0, milkyWay: 0, aurora: 0, auroraColor: 0x3ff0c0, auroraColor2: 0xa060ff,
  ridgeColor: 0x8fb2e0, ridgeColor2: 0x6f9ac8, ridgeHeight: 0.045, ridgeHeight2: 0.028, ridgeHaze: 0.55, ridgeSharp: 0.6, snow: 0,
  cone: 0, coneAz: 196, coneGlow: 0xff6020,
  underGlowColor: 0xff5a1a, underGlow: 0,
  sunAz: -25, sunEl: 54, sunColor: 0xfff3e0, sunIntensity: 2.4, shadowIntensity: 0.9, shadowRadius: 1.5,
  hemiSky: 0xbfdcff, hemiGround: 0x8c7c5a, hemiIntensity: 1.4,
  fogColor: 0xc4e0f8, fogDensity: 0.009,
  exposure: 1, bloomStrength: 0.32, bloomThreshold: 0.88, bloomRadius: 0.4,
  saturation: 1.1, contrast: 1.05, vignette: 0.2, tint: [1, 1, 1],
  cloudShadow: 0.3,
  particleColor: 0xfff6c8, particles: 0.25, particleSize: 0.06, particleVel: [0.1, 0.03, 0.06],
  particleWobble: 0.3, particleTwinkle: 0.5, particleGlow: 1.2,
};

/**
 * Sky / lighting / post presets, each merged over the shared defaults when resolved (see Environment.preset).
 * Post keys: exposure (renderer.toneMappingExposure), bloomStrength, bloomThreshold, bloomRadius,
 * saturation, contrast, vignette, tint [r,g,b] multipliers; fog: fogColor (sRGB hex), fogDensity (FogExp2).
 * @type {Record<'dawn'|'day'|'sunset'|'night'|'desert'|'volcano'|'twilight'|'title', object>}
 */
export const ENV_PRESETS = {
  dawn: {
    label: 'Dawn',
    zenith: 0x4a62c0, skyMid: 0x9a8ad0, horizon: 0xffc890, skyCurve: 0.42,
    hazeColor: 0xffd8c0, haze: 0.35,
    bodyAz: 160, bodyEl: 5, bodySize: 0.05, bodyColor: 0xfff0d0, bodyIntensity: 6, rays: 0.25,
    glowColor: 0xffc890, glow: 0.45, glowPow: 6, hGlowColor: 0xff9a6a, hGlow: 0.55,
    cloudCover: 0.58, cloudSoft: 0.07, cloudScale: 0.6, cloudSpeed: 0.006,
    cloudLit: 0xffd2c0, cloudShade: 0x8c7fb8, cloudUnder: 0xff9f8a, cloudRim: 0xfff0e0, cumulus: 0.6, cumulusHeight: 0.16,
    stars: 0.15,
    ridgeColor: 0xb89ab8, ridgeColor2: 0x8a76a8, ridgeHaze: 0.6,
    sunAz: 60, sunEl: 26, sunColor: 0xffe0c4, sunIntensity: 2.25, shadowIntensity: 0.75, shadowRadius: 2,
    hemiSky: 0xa898e0, hemiGround: 0x9a7a6a, hemiIntensity: 1.45,
    fogColor: 0xf0c0b8, fogDensity: 0.014,
    exposure: 1.02, bloomStrength: 0.45, bloomThreshold: 0.84, saturation: 1.08, contrast: 1.02, vignette: 0.25, tint: [1.02, 0.99, 1.0],
    cloudShadow: 0.15,
    particleColor: 0xffd8b0, particles: 0.3,
  },
  day: {
    label: 'Day',
  },
  sunset: {
    label: 'Sunset',
    zenith: 0x2a2f7a, skyMid: 0xb04a7a, horizon: 0xffa040, skyCurve: 0.38,
    hazeColor: 0xffc070, haze: 0.45,
    bodyAz: 200, bodyEl: 5, bodySize: 0.06, bodyColor: 0xffe0a0, bodyIntensity: 7, rays: 0.2,
    glowColor: 0xffa050, glow: 0.8, glowPow: 3, hGlowColor: 0xff7a30, hGlow: 0.8,
    cloudCover: 0.55, cloudLit: 0xffc070, cloudShade: 0x4a2c6a, cloudUnder: 0xff8a50, cloudRim: 0xffe8b0, cumulus: 0.8, cumulusHeight: 0.2,
    stars: 0.05,
    ridgeColor: 0x8a4a6a, ridgeColor2: 0x5a3050, ridgeHaze: 0.5,
    sunAz: -60, sunEl: 21, sunColor: 0xffc088, sunIntensity: 2.4, shadowIntensity: 0.85,
    hemiSky: 0x7a6ac0, hemiGround: 0x7a5a4a, hemiIntensity: 1.35,
    fogColor: 0xf0a070, fogDensity: 0.012,
    exposure: 1, bloomStrength: 0.55, bloomThreshold: 0.82, saturation: 1.08, contrast: 1.08, vignette: 0.3, tint: [1.03, 0.99, 0.95],
    cloudShadow: 0.2,
    particleColor: 0xffc070, particles: 0.35,
  },
  night: {
    label: 'Night',
    zenith: 0x050b24, skyMid: 0x0f2350, horizon: 0x24426e, skyCurve: 0.6,
    hazeColor: 0x2c4a78, haze: 0.4,
    bodyAz: 200, bodyEl: 11, bodySize: 0.055, bodyColor: 0xe8f0ff, bodyIntensity: 3, moon: 1,
    glowColor: 0x8fb0ff, glow: 0.35, glowPow: 12,
    cloudCover: 0.6, cloudLit: 0x8c9cc8, cloudShade: 0x121c3e, cloudUnder: 0x1a2448, cloudRim: 0xc8d8ff, cloudOpacity: 0.9,
    cumulus: 0.5, cumulusHeight: 0.15,
    stars: 1, milkyWay: 0.6,
    ridgeColor: 0x14244a, ridgeColor2: 0x0c1834, ridgeHaze: 0.4,
    sunAz: -35, sunEl: 42, sunColor: 0xb0c4f4, sunIntensity: 2.0, shadowIntensity: 0.75,
    hemiSky: 0x5670ac, hemiGround: 0x2a2a40, hemiIntensity: 1.3,
    fogColor: 0x1a2c50, fogDensity: 0.012,
    exposure: 1.1, bloomStrength: 0.6, bloomThreshold: 0.78, saturation: 1, contrast: 1.06, vignette: 0.32, tint: [0.94, 0.98, 1.08],
    cloudShadow: 0,
    particleColor: 0xc8ff7a, particles: 0.45, particleSize: 0.07, particleVel: [0.02, 0.02, 0.02], particleWobble: 0.6, particleTwinkle: 1.5, particleGlow: 3,
  },
  desert: {
    label: 'Desert',
    zenith: 0x3f8fd8, skyMid: 0x7ab8e8, horizon: 0xf0dcb4, skyCurve: 0.55,
    hazeColor: 0xfff0d4, haze: 0.45,
    bodyAz: 165, bodyEl: 55, bodySize: 0.045, bodyColor: 0xffffff, bodyIntensity: 9,
    glowColor: 0xfff4d8, glow: 0.6, glowPow: 3,
    cloudCover: 0.52, cirrus: 0.8, cloudLit: 0xffffff, cloudShade: 0xc8d0e0, cumulus: 0.2, cumulusHeight: 0.12,
    ridgeColor: 0xd8b890, ridgeColor2: 0xc49a70, ridgeHeight: 0.04, ridgeHeight2: 0.025, ridgeHaze: 0.6, ridgeSharp: 0.2,
    sunAz: -15, sunEl: 62, sunColor: 0xfff0d0, sunIntensity: 2.7, shadowIntensity: 0.95,
    hemiSky: 0xd0e4ff, hemiGround: 0xc8a070, hemiIntensity: 1.35,
    fogColor: 0xf0dcb8, fogDensity: 0.01,
    exposure: 1, bloomStrength: 0.35, bloomThreshold: 0.86, saturation: 1.05, contrast: 1.05, vignette: 0.2, tint: [1.04, 1.0, 0.94],
    cloudShadow: 0.12,
    particleColor: 0xffe8c0, particles: 0.35, particleVel: [0.6, 0.02, 0.15], particleWobble: 0.2, particleGlow: 0.8,
  },
  volcano: {
    label: 'Volcano',
    zenith: 0x140a0e, skyMid: 0x3a1216, horizon: 0xc8401a, skyCurve: 0.45,
    hazeColor: 0xff6a2a, haze: 0.4,
    bodyAz: 190, bodyEl: 12, bodySize: 0.05, bodyColor: 0xff6040, bodyIntensity: 1.5,
    glowColor: 0xff5020, glow: 0.3,
    cloudCover: 0.45, cloudLit: 0x5a4048, cloudShade: 0x24161c, cloudUnder: 0xb84a26, cloudRim: 0xff9a5a, cumulus: 0.9, cumulusHeight: 0.25,
    underGlowColor: 0xff4a10, underGlow: 0.8,
    ridgeColor: 0x2a1418, ridgeColor2: 0x1a0c10, ridgeHaze: 0.3, ridgeSharp: 0.85, cone: 0.09, coneGlow: 0xff6020,
    sunAz: -30, sunEl: 50, sunColor: 0xffc8a8, sunIntensity: 2.2, shadowIntensity: 0.8,
    hemiSky: 0x8a6a7a, hemiGround: 0xa8482a, hemiIntensity: 1.0,
    fogColor: 0x4a1a16, fogDensity: 0.013,
    exposure: 0.9, bloomStrength: 0.55, bloomThreshold: 0.85, saturation: 0.98, contrast: 1.08, vignette: 0.38, tint: [1.0, 0.95, 0.95],
    cloudShadow: 0.25,
    particleColor: 0xff8030, particles: 0.6, particleVel: [0.15, 0.6, 0.1], particleTwinkle: 2, particleGlow: 4,
  },
  twilight: {
    label: 'Twilight',
    zenith: 0x150c40, skyMid: 0x5a2a8a, horizon: 0x2fc4bc, skyCurve: 0.5,
    hazeColor: 0x5ad0c8, haze: 0.4,
    bodyAz: 165, bodyEl: 14, bodySize: 0.045, bodyColor: 0xf0e8ff, bodyIntensity: 3, moon: 1, moonPhase: 0.55,
    glowColor: 0xb08aff, glow: 0.3, glowPow: 14, hGlowColor: 0xff8ac8, hGlow: 0.22,
    cloudCover: 0.6, cloudLit: 0xd8a0e0, cloudShade: 0x3a2a6a, cloudUnder: 0x48d0c8, cloudRim: 0xffd0f0, cumulus: 0.5, cumulusHeight: 0.16,
    stars: 0.7, milkyWay: 0.3, aurora: 0.8,
    ridgeColor: 0x2a2050, ridgeColor2: 0x1a1438, ridgeHaze: 0.4,
    sunAz: -40, sunEl: 32, sunColor: 0xc8b0ff, sunIntensity: 2.1, shadowIntensity: 0.8,
    hemiSky: 0x7a6ad0, hemiGround: 0x2a5a6a, hemiIntensity: 1.35,
    fogColor: 0x2e6a80, fogDensity: 0.012,
    exposure: 1.08, bloomStrength: 0.65, bloomThreshold: 0.78, saturation: 1.12, contrast: 1.06, vignette: 0.3, tint: [1.0, 0.97, 1.06],
    cloudShadow: 0.05,
    particleColor: 0x9afff0, particles: 0.5, particleVel: [0.03, 0.18, 0.03], particleTwinkle: 2, particleGlow: 3,
  },
  title: {
    label: 'Title',
    zenith: 0x22357a, skyMid: 0xd8785a, horizon: 0xffb84a, skyCurve: 0.42,
    hazeColor: 0xffd080, haze: 0.38,
    bodyAz: -15, bodyEl: 3.5, bodySize: 0.065, bodyColor: 0xfff0c0, bodyIntensity: 10, rays: 0.6,
    glowColor: 0xffb050, glow: 0.7, glowPow: 4, hGlowColor: 0xff8a30, hGlow: 0.8,
    cloudCover: 0.5, cloudLit: 0xffd890, cloudShade: 0x5a4a90, cloudUnder: 0xff8a50, cloudRim: 0xfff0c0, cumulus: 1.0, cumulusHeight: 0.24,
    ridgeColor: 0x7a4a6a, ridgeColor2: 0x4a2a4a,
    sunAz: 150, sunEl: 22, sunColor: 0xffcf98, sunIntensity: 2.6,
    hemiSky: 0x8a7ad0, hemiGround: 0x9a6a3a, hemiIntensity: 1.3,
    fogColor: 0xf0a868, fogDensity: 0.01,
    exposure: 1.05, bloomStrength: 0.75, bloomThreshold: 0.8, saturation: 1.1, contrast: 1.1, vignette: 0.35, tint: [1.03, 1.0, 0.95],
    particleColor: 0xffd080, particles: 0.45,
  },
};

const COLOR_KEYS = new Set(['zenith', 'skyMid', 'horizon', 'skyGround', 'hazeColor', 'bodyColor', 'glowColor', 'hGlowColor',
  'cloudLit', 'cloudShade', 'cloudUnder', 'cloudRim', 'auroraColor', 'auroraColor2', 'ridgeColor', 'ridgeColor2', 'coneGlow',
  'underGlowColor', 'sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'particleColor']);
const ANGLE_KEYS = new Set(['bodyAz', 'sunAz', 'coneAz', 'cloudWind']);

function resolvePreset(name, overrides) {
  const key = ENV_PRESETS[name] ? name : 'day';
  const o = overrides || {};
  const p = { ...DEFAULTS, ...ENV_PRESETS[key] };
  for (const k of Object.keys(o)) if (k !== 'fogScale' && o[k] !== undefined) p[k] = o[k];
  if (o.fogScale) p.fogDensity *= o.fogScale;
  if (p.skyGround == null) p.skyGround = p.fogColor;
  p.name = key;
  p.tint = [...p.tint];
  p.particleVel = [...p.particleVel];
  return p;
}

const _ca = new THREE.Color();
const _cb = new THREE.Color();
function lerpPreset(a, b, t) {
  const out = { ...b, tint: [...b.tint], particleVel: [...b.particleVel] };
  for (const k of Object.keys(b)) {
    const va = a[k];
    const vb = b[k];
    if (va === undefined || va === null) continue;
    if (Array.isArray(vb)) out[k] = vb.map((v, i) => va[i] + (v - va[i]) * t);
    else if (COLOR_KEYS.has(k)) out[k] = _ca.setHex(va).lerp(_cb.setHex(vb), t).getHex();
    else if (ANGLE_KEYS.has(k)) out[k] = va + ((((vb - va) % 360) + 540) % 360 - 180) * t;
    else if (typeof vb === 'number') out[k] = va + (vb - va) * t;
  }
  return out;
}

function dirFromAngles(az, el, target = new THREE.Vector3()) {
  const ce = Math.cos(el * DEG);
  return target.set(Math.sin(az * DEG) * ce, Math.sin(el * DEG), Math.cos(az * DEG) * ce).normalize();
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------- cloud shadows
function makeCloudShadowTexture(size = 256) {
  const rnd = mulberry32(7331);
  const octaves = [[4, 0.5], [8, 0.27], [16, 0.13], [32, 0.07], [64, 0.035]];
  const lattices = octaves.map(([p]) => Float32Array.from({ length: p * p }, rnd));
  const sm = (t) => t * t * (3 - 2 * t);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      let norm = 0;
      for (let k = 0; k < octaves.length; k++) {
        const [p, amp] = octaves[k];
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = sm(fx - ix);
        const ty = sm(fy - iy);
        const L = lattices[k];
        const x0 = ix % p, x1 = (ix + 1) % p, y0 = iy % p, y1 = (iy + 1) % p;
        const a = L[y0 * p + x0] + (L[y0 * p + x1] - L[y0 * p + x0]) * tx;
        const b = L[y1 * p + x0] + (L[y1 * p + x1] - L[y1 * p + x0]) * tx;
        n += amp * (a + (b - a) * ty);
        norm += amp;
      }
      const t = Math.min(1, Math.max(0, (n / norm - 0.5) / 0.12));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(sm(t) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const CLOUD_PARS = /* glsl */ `
uniform sampler2D uCloudTex;
uniform vec2 uCloudOffset;
uniform float uCloudScale;
uniform float uCloudStrength;
varying vec3 vEwkCloudWP;
float ewkCloudShade(vec3 wp) {
  return 1.0 - texture2D(uCloudTex, wp.xz * uCloudScale + uCloudOffset).r * uCloudStrength;
}
`;

/**
 * Shared drifting cloud-shadow uniforms, animated by every Environment created with `cloudShadows: true`
 * (the default) and faded per preset (`cloudShadow` key; 0 at night).
 *
 * - Built-in lit materials (toonMaterial, MeshStandard/Lambert/Phong…): `cloudShadow.apply(material)` patches
 *   the material so only directional (sun) light is dimmed under clouds. Chains any existing onBeforeCompile
 *   (call it after toonMaterial()), extends customProgramCacheKey, supports instancing/batching.
 * - Custom ShaderMaterials: `Object.assign(uniforms, cloudShadow.uniforms)`, prepend `cloudShadow.glsl` to the
 *   fragment shader (declares the uniforms, `varying vec3 vEwkCloudWP` and `float ewkCloudShade(vec3 worldPos)`
 *   returning 1 in sunlight → 1-strength under a cloud), write the world position to vEwkCloudWP in the vertex
 *   shader and multiply your sun term by `ewkCloudShade(vEwkCloudWP)`.
 *   Raw: shadow = texture2D(uCloudTex, worldPos.xz * uCloudScale + uCloudOffset).r * uCloudStrength.
 */
export const cloudShadow = {
  uniforms: {
    uCloudTex: { value: makeCloudShadowTexture() },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudScale: { value: 1 / 34 },
    uCloudStrength: { value: 0 },
  },
  glsl: CLOUD_PARS,
  /** Patch a lit material in place so it receives cloud shadows; returns the material. */
  apply(material) {
    if (!material || material.userData.ewkCloud) return material;
    material.userData.ewkCloud = true;
    const prev = material.onBeforeCompile;
    const hasPrev = prev && prev !== THREE.Material.prototype.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = function (shader, renderer) {
      if (hasPrev) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, cloudShadow.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEwkCloudWP;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 ewkW = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  ewkW = batchingMatrix * ewkW;
#endif
#ifdef USE_INSTANCING
  ewkW = instanceMatrix * ewkW;
#endif
  vEwkCloudWP = (modelMatrix * ewkW).xyz;
}`);
      const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= ewkCloudSun;',
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + CLOUD_PARS)
        .replace('#include <lights_fragment_begin>', 'float ewkCloudSun = ewkCloudShade(vEwkCloudWP);\n' + lights);
    };
    material.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) : '') + '|ewk-cloud-v1';
    };
    material.needsUpdate = true;
    return material;
  },
  _stamp: -1,
};

// ------------------------------------------------------------------------------------------- sky dome
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith, uMid, uHorizon, uGround, uHaze, uFogColor;
uniform float uSkyCurve, uHazeAmt;
uniform vec3 uSunDir, uBodyColor, uGlowColor, uHGlowColor;
uniform float uBodySize, uBodyIntensity, uMoon, uPhase, uRays, uGlow, uGlowPow, uHGlow;
uniform vec3 uCloudLit, uCloudShade, uCloudUnder, uCloudRim;
uniform float uCloudCover, uCloudSoft, uCloudScale, uCloudOpacity, uCumulus, uCumulusH, uCirrus, uWindAng;
uniform vec2 uCloudOffset;
uniform float uStars, uMilky, uAurora;
uniform vec3 uAurora1, uAurora2;
uniform vec3 uRidge1, uRidge2, uConeGlow, uUnderGlowColor;
uniform float uRidgeH1, uRidgeH2, uRidgeHaze, uRidgeSharp, uCone, uConeAz, uSnow, uUnderGlow;
uniform float uTime;
varying vec3 vDir;

#define TAU 6.28318530718

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pnoise(vec2 p, float P) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P); float x1 = mod(i.x + 1.0, P);
  return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), u.x), mix(hash12(vec2(x0, i.y + 1.0)), hash12(vec2(x1, i.y + 1.0)), u.x), u.y);
}
float vnoise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float cloudFbm(vec2 p) {
  vec2 w = vec2(vnoise(p * 0.45 + 3.1), vnoise(p * 0.45 + 17.7)) - 0.5;
  p += w * 0.9;
  float s = 0.0; float a = 0.55;
  for (int i = 0; i < CLOUD_OCTAVES; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.47; }
  return s;
}
float ridgeFbm(float x, float P, float seed, float sharp) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) {
    float n = pnoise(vec2(x, seed + float(i) * 7.31), P);
    n = mix(n, 1.0 - abs(n * 2.0 - 1.0), sharp);
    s += a * n; x *= 2.0; P *= 2.0; a *= 0.5;
  }
  return s;
}

vec3 starField(vec3 d) {
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float scale = k == 0 ? 150.0 : 70.0;
    float dens = k == 0 ? 0.035 : 0.006;
    vec3 p = d * scale;
    vec3 i = floor(p); vec3 f = fract(p) - 0.5;
    float h = hash13(i + float(k) * 91.0);
    if (h < dens) {
      vec3 q = f - (hash33(i) - 0.5) * 0.6;
      float r = length(q);
      float tw = 0.6 + 0.4 * sin(uTime * (1.3 + 3.0 * fract(h * 97.0)) + h * 517.0);
      float s = smoothstep(k == 0 ? 0.08 + 0.06 * fract(h * 53.0) : 0.12, 0.0, r);
      if (k == 1) {
        vec3 a1 = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + 1e-4);
        vec3 a2 = cross(d, a1);
        float sx = abs(dot(q, a1)); float sy = abs(dot(q, a2));
        s += (smoothstep(0.035, 0.0, sy) * smoothstep(0.45, 0.0, sx) + smoothstep(0.035, 0.0, sx) * smoothstep(0.45, 0.0, sy)) * 0.8;
      }
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(h * 13.0));
      col += tint * s * tw * (k == 0 ? 1.6 : 3.0);
    }
  }
  return col;
}

vec3 milkyWay(vec3 d) {
  vec3 n = normalize(vec3(0.35, 0.55, -0.75));
  float b = dot(d, n);
  float band = exp(-b * b / 0.035);
  float cl = vnoise3(d * 6.0) * 0.6 + vnoise3(d * 15.0) * 0.4;
  float dust = smoothstep(0.45, 0.75, vnoise3(d * 9.0 + 4.0));
  return mix(vec3(0.35, 0.4, 0.85), vec3(0.9, 0.7, 0.95), cl) * band * cl * (1.0 - dust * 0.7) * 0.22;
}

vec3 auroraCol(vec3 d) {
  if (d.y < 0.02) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 p = d.xz / (d.y + 0.25) * (1.0 + fi * 0.09) * 1.3;
    float wave = sin(p.x * 0.9 + uTime * 0.05 + vnoise(vec2(p.x * 0.6, fi * 0.3 + uTime * 0.04)) * 3.0) * 0.55;
    float y = p.y + 2.8 + wave;
    float band = exp(-y * y * 3.5);
    float rays = 0.55 + 0.45 * vnoise(vec2(p.x * 9.0 + uTime * 0.2, fi));
    acc += mix(uAurora1, uAurora2, fi / 8.0) * band * rays * (1.0 - fi / 10.0);
  }
  return acc * 0.16 * smoothstep(0.02, 0.2, d.y);
}

vec4 planarClouds(vec3 d) {
  if (d.y <= 0.0) return vec4(0.0);
  float ca = cos(uWindAng); float sa = sin(uWindAng);
  mat2 rot = mat2(ca, -sa, sa, ca);
  float stretch = 1.0 + uCirrus * 3.0;
  vec2 p = rot * (d.xz / (d.y + 0.14) * uCloudScale);
  p.x /= stretch;
  p += uCloudOffset;
  float n = cloudFbm(p);
  float cov = uCloudCover + uCirrus * 0.05;
  float a = smoothstep(cov, cov + uCloudSoft + uCirrus * 0.2, n);
  if (a <= 0.001) return vec4(0.0);
  vec2 ls = rot * (uSunDir.xz + vec2(1e-4));
  ls.x /= stretch;
  float n2 = cloudFbm(p + normalize(ls) * 0.16);
  float lit = smoothstep(-0.004, 0.012, n - n2);
  float core = smoothstep(cov + 0.05, cov + 0.07, n) * 0.6 + smoothstep(cov + 0.12, cov + 0.3, n) * 0.4;
  vec3 col = mix(uCloudShade, uCloudLit, lit * (1.0 - core * 0.35));
  col = mix(col, uCloudUnder, core * 0.55 * (1.0 - lit * 0.6));
  float edge = 1.0 - smoothstep(cov, cov + uCloudSoft * 2.5, n);
  float sunFace = pow(max(dot(d, uSunDir), 0.0), 6.0);
  col += uCloudRim * edge * (0.12 + 1.2 * sunFace) * lit;
  a *= smoothstep(0.0, 0.1, d.y) * uCloudOpacity;
  return vec4(col, a);
}

// Horizon cumulus: per azimuth cell a cluster of sphere "puffs" (union, nearest surface wins), cel-lit in the
// local frame (right, up, toward viewer) so lit tops, shaded bellies and silver linings follow the real sun.
vec4 cumulusBand(vec3 d, float az01) {
  if (uCumulus <= 0.0) return vec4(0.0);
  float e = asin(clamp(d.y, -1.0, 1.0));
  float Hmax = uCumulusH * uCumulus;
  if (e > Hmax * 1.05 + 0.03 || e < -0.01) return vec4(0.0);
  const float N = 16.0;
  float cw = TAU / N;
  float pa = az01 * TAU + uCloudOffset.x * 0.015;
  vec2 wob = vec2(vnoise(vec2(pa * 38.0, e * 38.0)), vnoise(vec2(pa * 38.0 + 7.3, e * 38.0 + 2.1))) - 0.5;
  vec2 pp = vec2(pa, e) + wob * 0.006;
  float ci = floor(pp.x / cw);
  float bestZ = -1e9; float secondZ = -1e9; vec3 nrm = vec3(0.0, 0.0, 1.0); float sdf = 1e9; float hgt = 0.0; float clusterH = 0.1;
  for (int c = -1; c <= 1; c++) {
    float cell = ci + float(c);
    float hc = mod(cell, N);
    if (hash12(vec2(hc, 5.3)) > 0.2 + 0.55 * clamp(uCumulus, 0.0, 1.2)) continue;
    float H = Hmax * (0.35 + 0.65 * hash12(vec2(hc, 1.3)));
    float cx = (cell + 0.5 + (hash12(vec2(hc, 7.7)) - 0.5) * 0.5) * cw;
    float hw = cw * (0.42 + 0.3 * hash12(vec2(hc, 9.2)));
    for (int k = 0; k < 10; k++) {
      vec3 r3 = hash33(vec3(hc * 1.37, float(k) * 2.11, 4.0));
      float fy = pow(r3.y, 1.25);
      float py = fy * H * 0.78;
      float px = cx + (r3.x - 0.5) * 2.0 * hw * (1.0 - fy * 0.62);
      float pr = H * (0.2 + 0.16 * r3.z) * (1.0 - fy * 0.35) + 0.012;
      vec2 dv = pp - vec2(px, py);
      float d2 = dot(dv, dv);
      sdf = min(sdf, sqrt(d2) - pr);
      if (d2 < pr * pr) {
        float zs = (r3.z - 0.5) * pr * 0.8 + sqrt(pr * pr - d2);
        if (zs > bestZ) {
          secondZ = bestZ; bestZ = zs;
          nrm = vec3(dv / pr, sqrt(max(0.0, 1.0 - d2 / (pr * pr)))); hgt = py / H; clusterH = H;
        } else secondZ = max(secondZ, zs);
      }
    }
  }
  float a = smoothstep(0.0015, -0.0015, sdf);
  if (a <= 0.001) return vec4(0.0);
  vec3 R = normalize(cross(d, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 U = cross(R, d);
  vec3 L = normalize(vec3(dot(uSunDir, R), dot(uSunDir, U) + 0.2, dot(uSunDir, -d)));
  float dif = dot(nrm, L) * 0.8 + nrm.y * 0.3 - (1.0 - hgt) * 0.32;
  float lit = smoothstep(0.08, 0.11, dif);
  float mid = smoothstep(-0.26, -0.23, dif);
  float base = smoothstep(0.0, 0.4, hgt + e / max(clusterH, 0.02) * 0.4);
  vec3 shade = mix(uCloudUnder, uCloudShade, base);
  vec3 col = mix(shade, mix(shade, uCloudLit, 0.42), mid);
  col = mix(col, uCloudLit, lit);
  col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.006, bestZ - secondZ)) * step(-1e8, secondZ);
  float back = smoothstep(0.0, 0.8, -L.z);
  float facing = smoothstep(0.0, 0.6, dot(normalize(nrm.xy + 1e-4), normalize(L.xy + 1e-4)));
  float rim = smoothstep(-0.0045, -0.0012, sdf) * facing;
  col = mix(col, uCloudRim * (1.0 + back * 0.5), rim * (0.25 + 0.45 * back));
  a *= uCloudOpacity * smoothstep(-0.01, 0.006, e);
  return vec4(col, a);
}

float ridgeH(float az01, float P, float seed, float amp, float sharp) {
  return amp * pow(ridgeFbm(az01 * P, P, seed, sharp), 1.6) * 1.9;
}
float ridge1(float az01, float coneD) {
  float cone = uCone * pow(max(0.0, 1.0 - abs(coneD) * 24.0), 1.35);
  cone = min(cone, uCone * 0.84);
  return max(ridgeH(az01, 7.0, 3.0, uRidgeH1, uRidgeSharp), cone);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  float az01 = atan(d.x, -d.z) / TAU + 0.5;

  float t = pow(hp, uSkyCurve);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.5, t));
  col = mix(col, uZenith, smoothstep(0.35, 1.0, t));

  vec2 dxz = normalize(d.xz + vec2(1e-5));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
  float azs = clamp(dot(dxz, sxz) * 0.5 + 0.5, 0.0, 1.0);
  col = mix(col, uHGlowColor, clamp(pow(azs, 3.0) * exp(-hp * 4.5) * uHGlow, 0.0, 1.0));
  col += uUnderGlowColor * uUnderGlow * exp(-hp * 5.0) * 0.5;

  if (uStars > 0.0) {
    float vis = uStars * smoothstep(-0.02, 0.2, h);
    col += starField(d) * vis;
    if (uMilky > 0.0) col += milkyWay(d) * uMilky * vis;
  }
  if (uAurora > 0.0) col += auroraCol(d) * uAurora;

  float sd = dot(d, uSunDir);
  vec3 toB = d - uSunDir;
  float dist = length(toB);
  float disc = 1.0 - smoothstep(uBodySize * 0.93, uBodySize, dist);
  vec3 a1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 a2 = cross(a1, uSunDir);
  vec3 body = uBodyColor * uBodyIntensity;
  if (uMoon > 0.0) {
    vec2 mp = vec2(dot(toB, a1), dot(toB, a2)) / uBodySize;
    float mare = smoothstep(0.45, 0.75, vnoise(mp * 2.3 + 4.0) * 0.6 + vnoise(mp * 5.0) * 0.4);
    float lunar = 1.0 - smoothstep(0.9, 1.0, length(mp - vec2(-0.55, 0.32) * uPhase * 1.6)) * step(0.001, uPhase);
    body = mix(body, uBodyColor * uBodyIntensity * (1.0 - 0.25 * dot(mp, mp)) * (1.0 - mare * 0.28), uMoon);
    disc *= mix(1.0, lunar, uMoon);
  }
  col = mix(col, body, disc);
  if (uRays > 0.0) {
    float ang = atan(dot(toB, a2), dot(toB, a1) + 1e-7);
    float r = vnoise(vec2(ang * 7.0, uTime * 0.15)) * 0.6 + vnoise(vec2(ang * 19.0, uTime * 0.1 + 3.0)) * 0.4;
    col += uGlowColor * smoothstep(0.45, 0.85, r) * exp(-dist * 5.0) * smoothstep(uBodySize, uBodySize * 1.6, dist) * uRays * 1.4;
  }

  vec4 cb = cumulusBand(d, az01);
  vec4 cp = planarClouds(d);
  cp.a *= 1.0 - cb.a;
  col = mix(col, cp.rgb, cp.a);
  col = mix(col, cb.rgb, cb.a);
  float cloudA = max(cp.a, cb.a);

  float g = max(sd, 0.0);
  float glow = pow(g, uGlowPow) * uGlow + pow(g, 90.0) * uGlow * 1.6 + pow(g, 900.0) * uGlow * 3.0;
  col += uGlowColor * glow * (1.0 - cloudA * 0.55);

  col = mix(col, uHaze, clamp(exp(-hp * 9.0) * uHazeAmt, 0.0, 1.0));

  float coneD = az01 - uConeAz; coneD -= floor(coneD + 0.5);
  float coneTop = uCone * 0.84;
  if (uCone > 0.0 && h > coneTop && h < coneTop + 0.3) {
    float ph = h - coneTop;
    float cx = ph * 0.06 + sin(ph * 14.0 - uTime * 0.2) * 0.003;
    float w = 0.004 + ph * 0.1;
    float n = vnoise(vec2(coneD * 150.0, ph * 28.0 - uTime * 0.5)) * 0.65 + vnoise(vec2(coneD * 400.0, ph * 70.0 - uTime)) * 0.35;
    float plume = smoothstep(w, w * 0.5, abs(coneD - cx) + (n - 0.5) * w * 0.9) * smoothstep(0.3, 0.1, ph);
    vec3 ash = mix(uCloudShade, uCloudUnder * 1.4, exp(-ph * 30.0));
    col = mix(col, ash, plume * 0.95);
  }

  if (uRidgeH1 > 0.0 && h < 0.35) {
    float r1 = ridge1(az01, coneD);
    float r2 = ridgeH(az01 + 0.137, 11.0, 11.0, uRidgeH2, uRidgeSharp * 0.5);
    float sAz = atan(uSunDir.x, -uSunDir.z) / TAU + 0.5;
    float side = sAz - az01; side -= floor(side + 0.5);
    if (h < r1) {
      float eps = 0.0015;
      float slope = (ridge1(az01 + eps, coneD + eps) - ridge1(az01 - eps, coneD - eps)) / eps;
      float lit = smoothstep(-0.2, 0.4, -slope * sign(side) * 0.08);
      vec3 rc = mix(uRidge1, mix(uRidge1, uHGlowColor + uGlowColor * 0.3, 0.25), lit);
      float snow = uSnow * smoothstep(0.55, 0.8, r1 / max(uRidgeH1 * 1.3, 1e-3)) * smoothstep(r1 * 0.72, r1 * 0.8, h);
      rc = mix(rc, vec3(0.92, 0.95, 1.0) * mix(0.72, 1.05, lit), snow);
      rc = mix(rc, uFogColor, uRidgeHaze * (0.55 + 0.45 * smoothstep(r1, 0.0, h)));
      if (uCone > 0.0 && abs(coneD) < 0.045) {
        float rel = clamp(h / coneTop, 0.0, 1.0);
        float crater = smoothstep(0.86, 0.99, rel) * smoothstep(0.012, 0.004, abs(coneD));
        float fan = coneD / max(1.08 - rel, 0.05);
        float lines = smoothstep(0.08, 0.0, abs(fract(fan * 30.0 + vnoise(vec2(h * 90.0, 3.0)) * 0.6) - 0.5)) * step(abs(fan), 0.05);
        float flow = 0.65 + 0.35 * sin(uTime * 1.3 - rel * 18.0 + floor(fan * 30.0) * 2.0);
        rc += uConeGlow * (crater * 2.5 + lines * smoothstep(0.25, 0.85, rel) * flow * 1.4);
      }
      col = rc;
    }
    if (h < r2) col = mix(uRidge2, uFogColor, uRidgeHaze * 0.55 * smoothstep(r2, -0.01, h));
  }

  if (h < 0.0) col = mix(uFogColor, uGround, smoothstep(0.1, 0.6, -h));
  col = mix(col, uFogColor, exp(-abs(h) * 70.0) * 0.8);

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------------------------- particles
const PARTICLE_VERT = /* glsl */ `
uniform float uTime, uSize, uAmount, uWobble, uTwinkle, uViewH;
uniform vec3 uBoxMin, uBoxSize, uVel;
attribute vec4 aSeed;
varying float vA;
void main() {
  float sp = 0.6 + 0.8 * fract(aSeed.w * 13.7);
  float ph = aSeed.w * 43.98;
  vec3 p = aSeed.xyz * uBoxSize + uVel * uTime * sp;
  p += vec3(sin(uTime * 0.9 * sp + ph), sin(uTime * 0.7 + ph * 1.3) * 0.6, cos(uTime * 0.8 * sp + ph * 0.7)) * uWobble;
  p = mod(p, uBoxSize);
  vec3 f = p / uBoxSize;
  float edge = smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.8, f.y)
    * smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.05, f.z) * smoothstep(1.0, 0.95, f.z);
  vec4 mv = modelViewMatrix * vec4(uBoxMin + p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * uTwinkle * sp * 2.0 + ph * 3.0);
  float on = step(aSeed.w, uAmount);
  vA = on * edge * mix(1.0, tw * tw, clamp(uTwinkle * 0.5, 0.0, 1.0));
  gl_PointSize = on * uSize * (0.6 + 0.8 * aSeed.y) * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1);
}
`;
const PARTICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  a = a * a * (0.35 + 0.65 * smoothstep(0.5, 0.0, r));
  gl_FragColor = vec4(uColor * uGlow * a * vA, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SHADOW_SIZES = { low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector2();
const _center = new THREE.Vector3();
const _corner = new THREE.Vector3();

/**
 * Sky dome, sun/moon DirectionalLight (shadow-fitted), HemisphereLight, FogExp2 and optional ambient particles.
 * Extra members: `name` (preset key), `sky` (dome mesh), `skyUniforms`, `particles` (THREE.Points | null),
 * `group`, `setOverrides(obj)`.
 */
export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {string} presetName ENV_PRESETS key
   * @param {object} [opts]
   * @param {THREE.Box3|null} [opts.bounds] playable area for the shadow fit (and particle volume)
   * @param {'low'|'medium'|'high'|'ultra'} [opts.quality='high'] shadow-map size and sky noise octaves
   * @param {boolean} [opts.particles=false] floating motes / fireflies / embers / sparkles per preset
   * @param {boolean} [opts.cloudShadows=true] animate the shared `cloudShadow` uniforms
   * @param {object} [opts.overrides] preset keys forced for every preset (see setOverrides)
   */
  constructor(scene, renderer, presetName = 'day', opts = {}) {
    const { bounds = null, quality = 'high', particles = false, cloudShadows = true, overrides = null } = opts || {};
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.drivesCloudShadows = cloudShadows;
    this._overrides = overrides ? { ...overrides } : {};
    this.group = new THREE.Group();
    this.group.name = 'Environment';
    scene.add(this.group);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.name = 'EnvSun';
    this.sun.castShadow = true;
    const ms = SHADOW_SIZES[quality] || 2048;
    this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.group.add(this.hemi, this.sun, this.sun.target);

    const col = () => ({ value: new THREE.Color() });
    const num = (v) => ({ value: v });
    this.skyUniforms = {
      uZenith: col(), uMid: col(), uHorizon: col(), uGround: col(), uHaze: col(), uFogColor: col(),
      uSkyCurve: num(0.6), uHazeAmt: num(0.3),
      uSunDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() }, uBodyColor: col(), uGlowColor: col(), uHGlowColor: col(),
      uBodySize: num(0.05), uBodyIntensity: num(5), uMoon: num(0), uPhase: num(0), uRays: num(0), uGlow: num(0.4), uGlowPow: num(5), uHGlow: num(0),
      uCloudLit: col(), uCloudShade: col(), uCloudUnder: col(), uCloudRim: col(),
      uCloudCover: num(0.5), uCloudSoft: num(0.06), uCloudScale: num(0.6), uCloudOpacity: num(1),
      uCumulus: num(1), uCumulusH: num(0.3), uCirrus: num(0), uWindAng: num(0), uCloudOffset: { value: new THREE.Vector2() },
      uStars: num(0), uMilky: num(0), uAurora: num(0), uAurora1: col(), uAurora2: col(),
      uRidge1: col(), uRidge2: col(), uConeGlow: col(), uUnderGlowColor: col(),
      uRidgeH1: num(0.04), uRidgeH2: num(0.03), uRidgeHaze: num(0.5), uRidgeSharp: num(0.6), uCone: num(0), uConeAz: num(0.5),
      uSnow: num(0), uUnderGlow: num(0), uTime: num(0),
    };
    const skyMat = new THREE.ShaderMaterial({
      name: 'EnvSky', uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      defines: { CLOUD_OCTAVES: quality === 'low' ? 3 : quality === 'medium' ? 4 : 5 },
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat);
    this.sky.name = 'EnvSkyDome';
    this.sky.renderOrder = -1e6;
    this.sky.frustumCulled = false;
    this.sky.scale.setScalar(300);
    this.sky.raycast = () => {};
    this.group.add(this.sky);

    this._prevFog = scene.fog;
    this.fog = new THREE.FogExp2(0xffffff, 0.01);
    scene.fog = this.fog;

    this.particles = particles ? this._makeParticles() : null;
    if (this.particles) this.group.add(this.particles);

    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._bodyDir = new THREE.Vector3(0, 0.3, -1);
    this._cloudOffset = new THREE.Vector2();
    this._trans = null;
    this._fitted = false;
    this.bounds = new THREE.Box3(new THREE.Vector3(-12, -1, -10), new THREE.Vector3(12, 4, 10));
    if (bounds && !bounds.isEmpty()) this.bounds.copy(bounds);

    this.preset = resolvePreset(presetName, this._overrides);
    this.name = this.preset.name;
    this._apply(this.preset);
    this.setBounds(this.bounds);
  }

  /** Fit the sun's shadow camera tightly (+ margin) around `box3` (the playable area). */
  setBounds(box3) {
    if (box3 && !box3.isEmpty()) this.bounds.copy(box3);
    this._fitShadow();
    if (this.particles) {
      const u = this.particles.material.uniforms;
      const b = this.bounds;
      u.uBoxMin.value.set(b.min.x - 1, b.min.y, b.min.z - 1);
      u.uBoxSize.value.set(b.max.x - b.min.x + 2, Math.max(3, b.max.y - b.min.y + 1.5), b.max.z - b.min.z + 2);
    }
  }

  /**
   * Switch preset. `seconds > 0` cross-fades sky, lights, fog and the post values in `preset`
   * (re-read them each frame during a fade if your post stack caches them).
   */
  setPreset(name, seconds = 0) {
    const target = resolvePreset(name, this._overrides);
    this.name = target.name;
    if (!(seconds > 0)) {
      this._trans = null;
      this.preset = target;
      this._apply(target);
      return;
    }
    this._trans = { from: this.preset, to: target, t: 0, dur: seconds };
  }

  /** Force preset keys for every preset, e.g. { ridgeHeight: 0.08, snow: 1, cumulus: 0.4, fogScale: 1.4 }. */
  setOverrides(overrides = {}) {
    this._overrides = { ...overrides };
    this.setPreset(this.name, 0);
  }

  /**
   * @param {number} dt seconds since the last frame
   * @param {number} elapsed running time in seconds
   * @param {THREE.Camera} [camera] the dome is recentred on it and scaled inside its far plane
   */
  update(dt, elapsed, camera) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    if (this._trans) {
      const tr = this._trans;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const k = tr.t * tr.t * (3 - 2 * tr.t);
      this.preset = tr.t >= 1 ? tr.to : lerpPreset(tr.from, tr.to, k);
      this._apply(this.preset);
      if (tr.t >= 1) this._trans = null;
    }
    const p = this.preset;
    const u = this.skyUniforms;
    u.uTime.value = elapsed;
    const wa = p.cloudWind * DEG;
    this._cloudOffset.x += Math.cos(wa) * p.cloudSpeed * dt * 6;
    this._cloudOffset.y += Math.sin(wa) * p.cloudSpeed * dt * 6;
    u.uCloudOffset.value.copy(this._cloudOffset);

    if (this.drivesCloudShadows) {
      const cs = cloudShadow.uniforms;
      if (cloudShadow._stamp !== elapsed) {
        cloudShadow._stamp = elapsed;
        cs.uCloudOffset.value.x += Math.sin(wa) * p.cloudSpeed * dt * 2.2;
        cs.uCloudOffset.value.y += Math.cos(wa) * p.cloudSpeed * dt * 2.2;
      }
      cs.uCloudStrength.value = p.cloudShadow;
    }

    if (camera) {
      this.sky.position.copy(camera.position);
      this.sky.scale.setScalar((camera.far || 1000) * 0.9);
    }
    if (this.particles) {
      const pu = this.particles.material.uniforms;
      pu.uTime.value = elapsed;
      if (this.renderer) pu.uViewH.value = this.renderer.getDrawingBufferSize(_v2).y;
    }
  }

  /** Remove everything this environment added (restores the previous scene.fog) and free GPU resources. */
  dispose() {
    this.scene.remove(this.group);
    if (this.scene.fog === this.fog) this.scene.fog = this._prevFog || null;
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    if (this.particles) {
      this.particles.geometry.dispose();
      this.particles.material.dispose();
    }
    this.sun.dispose();
    this.hemi.dispose();
  }

  _makeParticles(count = 640) {
    const rnd = mulberry32(99);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      name: 'EnvParticles',
      uniforms: {
        uTime: { value: 0 }, uSize: { value: 0.06 }, uAmount: { value: 0.3 }, uWobble: { value: 0.3 }, uTwinkle: { value: 0.5 },
        uViewH: { value: 720 }, uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
        uVel: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uGlow: { value: 1 },
      },
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.name = 'EnvParticles';
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    pts.raycast = () => {};
    return pts;
  }

  _apply(p) {
    const u = this.skyUniforms;
    u.uZenith.value.setHex(p.zenith);
    u.uMid.value.setHex(p.skyMid);
    u.uHorizon.value.setHex(p.horizon);
    u.uGround.value.setHex(p.skyGround);
    u.uHaze.value.setHex(p.hazeColor);
    u.uFogColor.value.setHex(p.fogColor);
    u.uSkyCurve.value = p.skyCurve;
    u.uHazeAmt.value = p.haze;
    dirFromAngles(p.bodyAz, p.bodyEl, this._bodyDir);
    u.uSunDir.value.copy(this._bodyDir);
    u.uBodyColor.value.setHex(p.bodyColor);
    u.uGlowColor.value.setHex(p.glowColor);
    u.uHGlowColor.value.setHex(p.hGlowColor);
    u.uBodySize.value = p.bodySize;
    u.uBodyIntensity.value = p.bodyIntensity;
    u.uMoon.value = p.moon;
    u.uPhase.value = p.moonPhase;
    u.uRays.value = p.rays;
    u.uGlow.value = p.glow;
    u.uGlowPow.value = p.glowPow;
    u.uHGlow.value = p.hGlow;
    u.uCloudLit.value.setHex(p.cloudLit);
    u.uCloudShade.value.setHex(p.cloudShade);
    u.uCloudUnder.value.setHex(p.cloudUnder);
    u.uCloudRim.value.setHex(p.cloudRim);
    u.uCloudCover.value = p.cloudCover;
    u.uCloudSoft.value = p.cloudSoft;
    u.uCloudScale.value = p.cloudScale;
    u.uCloudOpacity.value = p.cloudOpacity;
    u.uCumulus.value = p.cumulus;
    u.uCumulusH.value = p.cumulusHeight;
    u.uCirrus.value = p.cirrus;
    u.uWindAng.value = p.cloudWind * DEG;
    u.uStars.value = p.stars;
    u.uMilky.value = p.milkyWay;
    u.uAurora.value = p.aurora;
    u.uAurora1.value.setHex(p.auroraColor);
    u.uAurora2.value.setHex(p.auroraColor2);
    u.uRidge1.value.setHex(p.ridgeColor);
    u.uRidge2.value.setHex(p.ridgeColor2);
    u.uRidgeH1.value = p.ridgeHeight;
    u.uRidgeH2.value = p.ridgeHeight2;
    u.uRidgeHaze.value = p.ridgeHaze;
    u.uRidgeSharp.value = p.ridgeSharp;
    u.uSnow.value = p.snow;
    u.uCone.value = p.cone;
    const coneDir = dirFromAngles(p.coneAz, 0, _v);
    u.uConeAz.value = Math.atan2(coneDir.x, -coneDir.z) / (Math.PI * 2) + 0.5;
    u.uConeGlow.value.setHex(p.coneGlow);
    u.uUnderGlowColor.value.setHex(p.underGlowColor);
    u.uUnderGlow.value = p.underGlow;

    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.shadow.intensity = p.shadowIntensity;
    this.sun.shadow.radius = p.shadowRadius;
    const prevDir = _v.copy(this._sunDir);
    dirFromAngles(p.sunAz, p.sunEl, this._sunDir);
    if (!this._fitted || prevDir.distanceToSquared(this._sunDir) > 1e-10) this._fitShadow();

    this.fog.color.setHex(p.fogColor);
    this.fog.density = p.fogDensity;

    if (this.particles) {
      const pu = this.particles.material.uniforms;
      pu.uColor.value.setHex(p.particleColor);
      pu.uAmount.value = p.particles;
      pu.uSize.value = p.particleSize;
      pu.uVel.value.fromArray(p.particleVel);
      pu.uWobble.value = p.particleWobble;
      pu.uTwinkle.value = p.particleTwinkle;
      pu.uGlow.value = p.particleGlow;
    }
  }

  _fitShadow() {
    if (!this.bounds || !this.preset) return;
    this._fitted = true;
    const b = this.bounds;
    const center = b.getCenter(_center);
    const radius = b.getSize(_v).length() * 0.5;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this._sunDir, radius + 20);
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    const inv = cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = _corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(inv);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
    }
    const m = 1.5;
    cam.left = minX - m; cam.right = maxX + m; cam.bottom = minY - m; cam.top = maxY + m;
    cam.near = Math.max(0.1, -maxZ - 8);
    cam.far = -minZ + 8;
    cam.updateProjectionMatrix();
    const texel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / this.sun.shadow.mapSize.x;
    const grazing = 1 / Math.max(0.25, Math.sin(Math.max(5, this.preset.sunEl) * DEG));
    this.sun.shadow.normalBias = texel * (0.9 + 0.5 * grazing);
    this.sun.shadow.bias = -0.0002 * grazing * (40 / Math.max(10, cam.far - cam.near));
    this.sun.shadow.needsUpdate = true;
  }
}
