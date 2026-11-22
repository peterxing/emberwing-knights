// GLSL + material factories for the VFX module.
// Most effect materials use premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA): the fragment writes
// (glow * coverage, darkening) so a single material can be purely additive (alpha 0) or darken
// the background (dark flames, portals) without switching blend modes.
import * as THREE from 'three';

const NOISE = /* glsl */ `
float vfxHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vfxNoiseP(vec2 p, float P) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, P); float x1 = mod(i.x + 1.0, P);
  float a = vfxHash(vec2(x0, i.y)); float b = vfxHash(vec2(x1, i.y));
  float c = vfxHash(vec2(x0, i.y + 1.0)); float d = vfxHash(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float vfxFbmP(vec2 p, float P) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vfxNoiseP(p, P); p *= 2.0; P *= 2.0; a *= 0.5; }
  return s / 0.9375;
}
`;

const OUTPUT = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

/** Applies premultiplied-alpha blending (additive when the shader writes alpha 0). */
export function premultiplied(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

// ------------------------------------------------------------------ particles
const PARTICLE_VERT = /* glsl */ `
attribute vec4 iPos;   // xyz, rotation
attribute vec4 iVel;   // xyz effective velocity, w = stretch seconds
attribute vec4 iColor; // linear rgb (HDR), alpha
attribute vec2 iData;  // size, cell + blend * 0.5
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vBlend;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos.xyz, 1.0);
  float size = iData.x;
  vec2 c = position.xy;
  if (iVel.w > 0.0) {
    vec3 vv = mat3(modelViewMatrix) * iVel.xyz;
    float len = length(vv.xy);
    if (len > 1e-4) {
      vec2 d = vv.xy / len;
      vec2 n = vec2(d.y, -d.x);
      mv.xy += d * (c.y * (size + len * iVel.w)) + n * (c.x * size);
    } else {
      mv.xy += c * size;
    }
  } else {
    float cs = cos(iPos.w); float sn = sin(iPos.w);
    mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  }
  gl_Position = projectionMatrix * mv;
  float cell = floor(iData.y + 1e-3);
  vBlend = clamp((iData.y - cell) * 2.0, 0.0, 1.0);
  vec2 cxy = vec2(mod(cell, uAtlas.x), floor(cell / uAtlas.x));
  vUv = vec2((cxy.x + uv.x) / uAtlas.x, 1.0 - (cxy.y + 1.0 - uv.y) / uAtlas.y);
  vColor = iColor;
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vBlend;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(t.rgb * vColor.rgb * a, a * (1.0 - vBlend));
  ${OUTPUT}
}
`;

/** Camera-facing (optionally velocity-stretched) instanced particle material sampling the atlas. */
export function particleMaterial(atlas, cols, rows) {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-particles',
    uniforms: { uMap: { value: atlas }, uAtlas: { value: new THREE.Vector2(cols, rows) } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    depthTest: true,
    fog: false,
  }));
}

// ------------------------------------------------------------------ shared world-space vertex shader
const WORLD_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vUv = uv;
  vP = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// ------------------------------------------------------------------ light / fire pillars and cones
const PILLAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
uniform float uAlpha;
uniform float uTime;
uniform float uMode;
uniform float uSpeed;
uniform float uBot;
uniform float uTop;
uniform vec2 uReveal;
uniform float uDark;
uniform float uEdge;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${NOISE}
void main() {
  float v = vUv.y;
  if (v < uReveal.x || v > uReveal.y) discard;
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float vert = smoothstep(0.0, uBot, v) * (1.0 - smoothstep(1.0 - uTop, 1.0, v));
  vert *= smoothstep(uReveal.x, uReveal.x + 0.08, v) * (1.0 - smoothstep(uReveal.y - 0.08, uReveal.y, v));
  vec3 col;
  float a;
  if (uMode < 0.5) {
    float body = pow(facing, uEdge);
    float core = pow(facing, 9.0);
    float n1 = vfxNoiseP(vec2(vUv.x * 12.0, v * 2.5 - uTime * uSpeed), 12.0);
    float n2 = vfxNoiseP(vec2(vUv.x * 28.0, v * 6.0 - uTime * uSpeed * 1.7), 28.0);
    float streak = smoothstep(0.2, 0.9, n1 * 0.55 + n2 * 0.45);
    col = uColor * (0.45 + 0.9 * streak) * 0.75 + uCore * core * (0.7 + 0.6 * streak);
    a = body * vert;
  } else {
    float soft = pow(facing, uEdge);
    float f = vfxFbmP(vec2(vUv.x * 7.0, v * 2.6 - uTime * uSpeed), 7.0);
    float shape = f * 1.2 + (1.0 - v) * 0.35 - 0.38 + soft * 0.25;
    float body = smoothstep(0.15, 0.55, shape);
    float heat = clamp((shape - 0.25) * 1.5, 0.0, 1.0);
    col = mix(uColor * 0.7, uCore, heat * heat) * (0.35 + 0.75 * heat);
    a = body * soft * vert;
  }
  a *= uAlpha;
  gl_FragColor = vec4(col * uIntensity * a, a * uDark);
  ${OUTPUT}
}
`;

/** Scrolling-noise light/fire column for open cylinders and cones (uMode 0 = light, 1 = fire). */
export function pillarMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-pillar',
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.8, 0.3) }, uCore: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 2 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uMode: { value: 0 },
      uSpeed: { value: 1 }, uBot: { value: 0.05 }, uTop: { value: 0.5 }, uReveal: { value: new THREE.Vector2(0, 1) },
      uDark: { value: 0 }, uEdge: { value: 1.6 },
    },
    vertexShader: WORLD_VERT,
    fragmentShader: PILLAR_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ flat rings / ground glows (XZ plane, radius 1)
const FLAT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
uniform float uAlpha;
uniform float uWidth;
uniform float uTime;
uniform float uNoise;
uniform float uFill;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float outer = 1.0 - smoothstep(0.92, 1.0, r);
  float inner = smoothstep(1.0 - uWidth, 0.96, r);
  float band = outer * inner * inner * step(0.001, uWidth);
  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
  float n = vfxNoiseP(vec2(ang * 28.0, r * 3.0 - uTime * 2.0), 28.0);
  band *= mix(1.0, 0.35 + 1.0 * n, uNoise);
  float fill = uFill * pow(1.0 - r, 1.6);
  vec3 col = mix(uColor, uCore, smoothstep(0.55, 1.0, band)) * (band + fill);
  gl_FragColor = vec4(col * uIntensity * uAlpha, 0.0);
  ${OUTPUT}
}
`;

/** Flat expanding shockwave ring / soft ground glow on a 2x2 XZ plane. */
export function ringMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-ring',
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.6, 0.2) }, uCore: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 2 }, uAlpha: { value: 1 }, uWidth: { value: 0.3 }, uTime: { value: 0 },
      uNoise: { value: 0.5 }, uFill: { value: 0 },
    },
    vertexShader: FLAT_VERT,
    fragmentShader: RING_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ domes / orbs
const DOME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uIntensity;
uniform float uAlpha;
uniform float uTime;
uniform float uRimPow;
uniform float uFill;
uniform float uDark;
uniform float uLines;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${NOISE}
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, uRimPow);
  float ang = atan(vP.z, vP.x) / 6.2831853 + 0.5;
  float n = vfxNoiseP(vec2(ang * 18.0, vP.y * 4.0 - uTime * 1.6), 18.0);
  float lines = smoothstep(0.9, 1.0, sin(vP.y * 26.0 - uTime * 9.0) * 0.5 + 0.5) * uLines;
  float hexa = smoothstep(0.78, 0.95, n) * uLines;
  float glow = rim * (0.75 + 0.5 * n) + uFill * (0.3 + 0.7 * n) + (lines + hexa) * 0.6;
  vec3 col = mix(uColor, uCore, clamp(rim * rim + lines, 0.0, 1.0));
  float a = uAlpha;
  gl_FragColor = vec4(col * glow * uIntensity * a, uDark * a * (1.0 - 0.6 * rim));
  ${OUTPUT}
}
`;

/** Fresnel energy dome / orb with optional scan lines and background darkening (uDark). */
export function domeMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-dome',
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.85, 0.4) }, uCore: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 2 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uRimPow: { value: 2.5 },
      uFill: { value: 0.1 }, uDark: { value: 0 }, uLines: { value: 0 },
    },
    vertexShader: WORLD_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.FrontSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ slash crescents
const SLASH_VERT = /* glsl */ `
attribute vec2 aArc;
uniform float uSpan;
uniform float uWidth;
varying vec2 vArc;
void main() {
  float u = aArc.x; float v = aArc.y;
  float th = (u - 0.5) * uSpan;
  float taper = pow(sin(3.14159265 * u), 0.6);
  float r = 1.0 - uWidth * taper * (1.0 - v);
  vArc = aArc;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(th) * r, cos(th) * r, 0.0, 1.0);
}
`;

const SLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uHead;
uniform float uTail;
uniform float uAlpha;
uniform float uIntensity;
uniform float uTime;
uniform float uNoise;
uniform float uSym;
varying vec2 vArc;
${NOISE}
void main() {
  float u = vArc.x; float v = vArc.y;
  float k = (u - uTail) / max(uHead - uTail, 1e-3);
  if (k < 0.0 || k > 1.0) discard;
  float along = mix(smoothstep(0.0, 0.6, k) * (1.0 - smoothstep(0.96, 1.0, k)), pow(sin(3.14159265 * u), 0.6), uSym);
  float aa = 1.0 - smoothstep(0.955, 1.0, v);
  float lines = 0.78 + 0.22 * sin(v * 48.0 + u * 7.0);
  float n = vfxNoiseP(vec2(u * 26.0 - uTime * 14.0, v * 3.0), 26.0);
  lines *= mix(1.0, 0.45 + 1.0 * n, uNoise);
  float head = smoothstep(0.75, 1.0, k) * (1.0 - uSym);
  float body = smoothstep(0.0, 0.9, v);
  float edgeLine = smoothstep(0.84, 0.95, v);
  vec3 col = uColor * 1.35 * body * lines + uCore * 1.9 * edgeLine + uCore * head * edgeLine * 1.1;
  float a = along * aa * uAlpha;
  gl_FragColor = vec4(col * uIntensity * a, 0.0);
  ${OUTPUT}
}
`;

/** Anime crescent: sweeping head/tail reveal, white edge line over a coloured body with speed lines. */
export function slashMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-slash',
    uniforms: {
      uColor: { value: new THREE.Color(0.5, 0.8, 1) }, uCore: { value: new THREE.Color(1, 1, 1) },
      uHead: { value: 0 }, uTail: { value: 0 }, uAlpha: { value: 1 }, uIntensity: { value: 1 },
      uSpan: { value: 3.3 }, uWidth: { value: 0.3 }, uTime: { value: 0 }, uNoise: { value: 0 }, uSym: { value: 0 },
    },
    vertexShader: SLASH_VERT,
    fragmentShader: SLASH_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

/** Crescent strip: aArc = (u along arc, v across: 0 inner .. 1 outer). */
export function slashGeometry(segments = 64, rows = 4) {
  const g = new THREE.BufferGeometry();
  const arc = new Float32Array((segments + 1) * (rows + 1) * 2);
  const pos = new Float32Array((segments + 1) * (rows + 1) * 3);
  let k = 0;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j <= rows; j++) { arc[k * 2] = i / segments; arc[k * 2 + 1] = j / rows; k++; }
  }
  const idx = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aArc', new THREE.BufferAttribute(arc, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.5);
  return g;
}

// ------------------------------------------------------------------ magic circles
const CIRCLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uAlpha;
uniform float uRotA;
uniform float uRotB;
uniform float uReveal;
uniform float uPulse;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float rot = r > 0.745 ? uRotA : uRotB;
  float c = cos(rot); float s = sin(rot);
  mat2 R = mat2(c, s, -s, c);
  vec2 q = R * p;
  vec2 dx = R * dFdx(p) * 0.5; vec2 dy = R * dFdy(p) * 0.5;
  vec4 t = textureGrad(uMap, q * 0.5 + 0.5, dx, dy);
  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
  float rev = uReveal >= 1.0 ? 1.0 : 1.0 - smoothstep(uReveal - 0.04, uReveal, ang);
  float glow = exp(-r * r * 2.5) * 0.16 + exp(-pow((r - 0.95) * 9.0, 2.0)) * 0.12;
  vec3 col = uColor * (t.a * rev * (1.0 + uPulse) + glow * min(uReveal * 1.5, 1.0));
  gl_FragColor = vec4(col * uIntensity * uAlpha, 0.0);
  ${OUTPUT}
}
`;

/** Rune circle with counter-rotating outer/inner layers and a draw-in sweep. */
export function circleMaterial(runeTex) {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-circle',
    uniforms: {
      uMap: { value: runeTex }, uColor: { value: new THREE.Color(1, 0.7, 0.3) }, uIntensity: { value: 1.6 },
      uAlpha: { value: 0 }, uRotA: { value: 0 }, uRotB: { value: 0 }, uReveal: { value: 0 }, uPulse: { value: 0 },
    },
    vertexShader: FLAT_VERT,
    fragmentShader: CIRCLE_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ summon portal
const PORTAL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uTime;
uniform float uAlpha;
uniform float uOpen;
uniform float uIntensity;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p) / max(uOpen, 1e-3);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
  float sw = ang * 5.0 + r * 2.2 - uTime * 0.9;
  float n = vfxFbmP(vec2(sw * 6.0, r * 3.0 - uTime * 1.2), 30.0);
  float arms = smoothstep(0.45, 0.8, n) * smoothstep(0.1, 0.8, r);
  float rim = smoothstep(0.7, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float dark = 1.0 - smoothstep(0.82, 1.0, r);
  vec3 glow = uRim * rim * 2.2 + uColor * arms * 1.4 + uRim * exp(-r * r * 30.0) * 0.6;
  gl_FragColor = vec4(glow * uIntensity * uAlpha, dark * 0.9 * uAlpha);
  ${OUTPUT}
}
`;

/** Swirling dark portal disc: darkens the ground and adds a glowing rim and spiral arms. */
export function portalMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-portal',
    uniforms: {
      uColor: { value: new THREE.Color(0.55, 0.1, 0.9) }, uRim: { value: new THREE.Color(1, 0.3, 0.9) },
      uTime: { value: 0 }, uAlpha: { value: 1 }, uOpen: { value: 0 }, uIntensity: { value: 1 },
    },
    vertexShader: FLAT_VERT,
    fragmentShader: PORTAL_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ ribbons (lightning, tendrils)
const RIBBON_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aInfo;  // side (-1/1), end (0 = A, 1 = B), half width, alpha
attribute vec4 aColor; // rgb, core strength
varying float vSide;
varying float vAlpha;
varying vec4 vColor;
void main() {
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  vec2 d = b.xy - a.xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0, 1.0);
  vec2 n = vec2(-d.y, d.x);
  vec4 p = mix(a, b, aInfo.y);
  p.xy += d * (aInfo.y * 2.0 - 1.0) * aInfo.z * 0.22;
  p.xy += n * aInfo.x * aInfo.z;
  gl_Position = projectionMatrix * p;
  vSide = aInfo.x;
  vAlpha = aInfo.w;
  vColor = aColor;
}
`;

const RIBBON_FRAG = /* glsl */ `
varying float vSide;
varying float vAlpha;
varying vec4 vColor;
void main() {
  float x = abs(vSide);
  float core = 1.0 - smoothstep(0.08, 0.26, x);
  float glow = pow(1.0 - x, 2.2);
  vec3 col = vColor.rgb * glow * 1.0 + vec3(1.0) * core * 2.4 * vColor.a;
  gl_FragColor = vec4(col * vAlpha, 0.0);
  ${OUTPUT}
}
`;

/** Camera-facing ribbon segments (lightning, tendrils) with a white core and coloured glow. */
export function ribbonMaterial() {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-ribbon',
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}

// ------------------------------------------------------------------ ice crystals (instanced, cel shaded)
const CRYSTAL_VERT = /* glsl */ `
attribute float aH;
attribute float iFlash;
varying vec3 vWPos;
varying vec3 vWN;
varying float vH;
varying float vFlash;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * p;
  vWPos = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * n);
  vH = aH;
  vFlash = iFlash;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CRYSTAL_FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uRim;
varying vec3 vWPos;
varying vec3 vWN;
varying float vH;
varying float vFlash;
void main() {
  vec3 n = normalize(vWN);
  vec3 v = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : normalize(cameraPosition - vWPos);
  if (dot(n, v) < 0.0) n = -n;
  vec3 L = normalize(vec3(0.35, 0.9, 0.45));
  float d = dot(n, L);
  float cel = d > 0.3 ? 1.0 : (d > -0.25 ? 0.74 : 0.55);
  vec3 base = mix(uDeep, uLight, clamp(vH * 0.75 + 0.25, 0.0, 1.0)) * cel;
  float fres = pow(1.0 - abs(dot(n, v)), 2.2);
  float spec = step(0.94, dot(n, normalize(L + v)));
  vec3 col = base + uRim * fres * 0.9 + vec3(1.0) * spec * 0.7 + vec3(0.55, 0.85, 1.0) * vH * vH * 0.3;
  col = mix(col, vec3(1.15, 1.45, 1.7), vFlash);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT}
}
`;

/** Cel-shaded faceted ice for the instanced crystal mesh (per-instance iFlash). */
export function crystalMaterial() {
  return new THREE.ShaderMaterial({
    name: 'vfx-crystal',
    uniforms: {
      uDeep: { value: new THREE.Color(0x2a6fc4) },
      uLight: { value: new THREE.Color(0xc9f3ff) },
      uRim: { value: new THREE.Color(0x9fe8ff) },
    },
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    fog: false,
  });
}

/** Faceted ice spike: pointed base below y=0, hex prism body, tip at y=1 (flat normals + aH). */
export function crystalGeometry(rand) {
  const N = 6;
  const base = [], shoulder = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const rb = 1 * (0.85 + rand() * 0.3);
    const rs = 0.78 * (0.85 + rand() * 0.3);
    base.push([Math.cos(a) * rb, 0, Math.sin(a) * rb]);
    shoulder.push([Math.cos(a) * rs, 0.66 + rand() * 0.08, Math.sin(a) * rs]);
  }
  const tip = [0.06, 1, -0.04];
  const bottom = [0, -0.25, 0];
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(base[i], shoulder[i], base[j]);
    tri(base[j], shoulder[i], shoulder[j]);
    tri(shoulder[i], tip, shoulder[j]);
    tri(base[j], bottom, base[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const h = new Float32Array(pos.length / 3);
  for (let i = 0; i < h.length; i++) h[i] = Math.max(0, pos[i * 3 + 1]);
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ textured billboards (wings of light)
const BILLBOARD_VERT = /* glsl */ `
uniform vec2 uSize;
uniform vec2 uAnchor;
uniform float uRot;
uniform float uFlip;
uniform vec2 uOffset;
uniform float uDepth;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.z -= uDepth;
  vec2 c = (uv - uAnchor) * uSize;
  c.x *= uFlip;
  float r = uRot * uFlip;
  float cs = cos(r); float sn = sin(r);
  c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  mv.xy += c + vec2(uOffset.x * uFlip, uOffset.y);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
}
`;

const BILLBOARD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uIntensity;
uniform float uReveal;
uniform vec2 uAnchor;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float d = length(vUv - uAnchor) / 1.1;
  float rev = 1.0 - smoothstep(uReveal - 0.15, uReveal, d);
  float a = t.a * uAlpha * rev;
  gl_FragColor = vec4(uColor * t.rgb * uIntensity * a, 0.0);
  ${OUTPUT}
}
`;

/** Screen-aligned textured quad anchored at a pivot (wings of light), with radial reveal. */
export function billboardMaterial(tex) {
  return premultiplied(new THREE.ShaderMaterial({
    name: 'vfx-billboard',
    uniforms: {
      uMap: { value: tex }, uColor: { value: new THREE.Color(1, 0.9, 0.6) }, uAlpha: { value: 1 },
      uIntensity: { value: 2 }, uReveal: { value: 1 }, uSize: { value: new THREE.Vector2(1, 1) },
      uAnchor: { value: new THREE.Vector2(0.06, 0.38) }, uRot: { value: 0 }, uFlip: { value: 1 },
      uOffset: { value: new THREE.Vector2(0, 0) }, uDepth: { value: 0 },
    },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: BILLBOARD_FRAG,
    side: THREE.DoubleSide,
    fog: false,
  }));
}
