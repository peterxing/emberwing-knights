// Shader injections and materials used by the world builder (gfx/world.js).
// Everything is layered on three's own materials via onBeforeCompile so lighting, shadows and fog keep working.
import * as THREE from 'three';
import { toonMaterial, gradientMap, toonGlobals } from './toon.js';

/** Terrain surface ids written into the terrain mesh `aTA.x` attribute. */
export const TT = {
  GRASS: 0, MEADOW: 1, ROAD: 2, COBBLE: 3, FLOOR: 4, CARPET: 5, SAND: 6, DUNE: 7, RUINS: 8, GOLD: 9,
  ALTAR: 10, LAVA: 11, VOID: 12, ROCK: 13, FOREST: 14, BED: 15, WALL: 16, SNOW: 17, DIRT: 18, ASH: 19,
  DAIS: 20, CANOPY: 21, HILL: 22,
};

/** Palette slots uploaded to the terrain shader (order matters: indices are hard-coded in GLSL). */
export const PAL_SLOTS = [
  'grassDark', 'grassMid', 'grassLight', 'soilA', 'soilB', 'rockA', 'rockB', 'rockC', 'sandA', 'sandB',
  'stoneA', 'stoneB', 'mortar', 'carpetA', 'carpetB', 'goldA', 'goldB', 'ashA', 'ashB', 'snow',
  'bedA', 'bedB', 'forest', 'roadA', 'roadB', 'gap', 'rune', 'voidGlow', 'canopyA', 'canopyB',
  'flowerA', 'flowerB', 'flowerC', 'flowerD',
];

/** Uniforms shared by every material of one World. */
export function createWorldUniforms() {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWind: { value: new THREE.Vector4(0.86, 0.5, 1, 1.5) }, // dirX, dirZ, strength, speed
    uFade: { value: new THREE.Vector4(0, 0, 0, 0) }, // centreX, centreZ, radius, amount
    uSnowY: { value: 1.55 },
    uOutside: { value: new THREE.Vector2(0.42, 0.2) }, // desaturation, darkening of the surroundings
  };
}

const NOISE_GLSL = /* glsl */ `
float ewH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 ewH22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float ewN2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(ewH21(i), ewH21(i + vec2(1.0, 0.0)), u.x), mix(ewH21(i + vec2(0.0, 1.0)), ewH21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ewFbm(vec2 p) { return ewN2(p) * 0.57 + ewN2(p * 2.03 + 17.3) * 0.29 + ewN2(p * 4.11 + 41.7) * 0.14; }
vec3 ewVor(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0; float d2 = 8.0; float id = 0.0;
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k - (k / 3) * 3 - 1), float(k / 3 - 1));
    vec2 o = ewH22(i + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    id = mix(id, fract(o.x * 3.71 + o.y * 1.37), step(d, d1));
    d2 = min(d2, max(d1, d));
    d1 = min(d1, d);
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

const BAYER_GLSL = /* glsl */ `
float ewB2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float ewBayer(vec2 fc) { return ewB2(0.5 * fc) * 0.25 + ewB2(fc) + 0.03125; }
`;

// ------------------------------------------------------------------------------------------- terrain
const TERRAIN_VERT_PARS = /* glsl */ `
attribute vec4 aTA;
attribute vec4 aTB;
flat varying vec4 vTA;
flat varying vec4 vTB;
varying vec3 vTP;
varying vec3 vTN;
varying vec3 vTW;
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uSnowY;
uniform float uSeam;
uniform float uLip;
uniform float uRoadSand;
uniform vec2 uOutside;
uniform vec3 uPal[34];
uniform sampler2D uShore;
uniform vec4 uShoreXf;
flat varying vec4 vTA;
flat varying vec4 vTB;
varying vec3 vTP;
varying vec3 vTN;
varying vec3 vTW;

vec3 ewFlower(float h) {
  h = fract(h * 17.31);
  return mix(mix(uPal[30], uPal[31], step(0.25, h)), mix(uPal[32], uPal[33], step(0.75, h)), step(0.5, h));
}
float ewSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a; vec2 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

vec3 ewFlag(vec2 p, float det, float sc) {
  vec2 q = p * sc; float row = floor(q.y); q.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(q); vec2 fq = fract(q);
  float e = min(min(fq.x, 1.0 - fq.x), min(fq.y, 1.0 - fq.y));
  float h = ewH21(id + 0.5);
  vec3 st = mix(uPal[10], uPal[11], h) * (0.91 + 0.12 * ewH21(id + 3.7));
  st *= 1.0 + 0.07 * (1.0 - smoothstep(0.03, 0.09, fq.y));
  float cl = abs((fq.x - 0.5) + (fq.y - 0.5) * (h * 2.4 - 1.2));
  st *= 1.0 - 0.22 * (1.0 - smoothstep(0.004, 0.012, cl)) * step(0.8, h) * det * step(0.12, fq.y) * step(fq.y, 0.88);
  return mix(uPal[12], st, smoothstep(0.012, 0.035, e));
}

vec3 ewSandC(vec2 p, float F, float det, float dune) {
  vec3 c = mix(uPal[8], uPal[9], smoothstep(0.3, 0.7, F));
  float rp = sin((p.x * 0.7 + p.y * 1.3 + F * 3.0) * (9.0 + dune * 3.0));
  float k = max(det, 0.3);
  c *= 1.0 - (0.07 + 0.05 * dune) * smoothstep(0.55, 0.9, rp) * k;
  c *= 1.0 + (0.04 + 0.05 * dune) * smoothstep(0.55, 0.9, -rp) * k;
  return c * (1.0 + (ewH21(floor(p * 48.0)) - 0.5) * 0.08 * det);
}

vec3 ewGrass(vec2 p, float F, float N, float det, float flowers) {
  float k = F + (N - 0.5) * 0.24;
  vec3 c = mix(mix(uPal[0], uPal[1], 0.3), uPal[1], smoothstep(0.40, 0.45, k));
  c = mix(c, uPal[2], smoothstep(0.62, 0.67, k));
  float s = ewN2(p * vec2(24.0, 9.0) + k * 5.0);
  c *= 1.0 + (s - 0.5) * 0.16 * det;
  vec2 g = p * 6.5; vec2 gi = floor(g);
  float h = ewH21(gi + 7.7);
  float r = length(fract(g) - (ewH22(gi) * 0.6 + 0.2));
  c = mix(c, uPal[2] * 1.12, step(0.87, h) * (1.0 - smoothstep(0.09, 0.14, r)) * det);
  return mix(c, ewFlower(h * 31.0), step(h, flowers) * (1.0 - smoothstep(0.05, 0.085, r)) * det);
}

float ewVScaleTop(int t) {
  return t == 2 ? 8.0 : t == 8 ? 2.4 : (t == 13 || t == 17) ? 2.6 : t == 15 ? 6.0 : t == 19 ? 1.7 : t == 21 ? 1.5 : t == 22 ? 4.0 : t == 11 ? 1.7 : 5.0;
}
vec2 ewSideVQ(int t, float u, float y) {
  if (t == 13 || t == 17 || t == 22) return vec2(u * 2.4, y * 0.8);
  if (t == 19 || t == 11 || t == 12) return vec2(u * 2.0, y * 1.2);
  if (t == 21) return vec2(u, y) * 2.5;
  return vec2(u, y) * 5.0;
}

vec3 ewTop(int t, vec2 p, vec2 f, int same, float topY, float det, vec3 V, float F, float N, inout vec3 emi) {
  vec3 G = ewGrass(p, F, N, det, t == 0 ? 0.012 : 0.0);
  vec3 FL = ewFlag(p, det, t == 16 ? 2.5 : 2.0);
  vec3 SA = ewSandC(p, F, det, t == 7 ? 1.0 : 0.0);
  vec3 c = G;
  if (t == 1) {
    c = G * vec3(1.03, 1.04, 0.95);
    vec2 g = p * 7.0; vec2 gi = floor(g);
    float h = ewH21(gi + 1.3);
    float r = length(fract(g) - (ewH22(gi + 2.0) * 0.5 + 0.25));
    float on = step(0.78, h);
    c = mix(c, ewFlower(h), on * (1.0 - smoothstep(0.1, 0.16, r)) * max(det, 0.35));
    c = mix(c, vec3(1.0, 0.82, 0.3), on * (1.0 - smoothstep(0.03, 0.06, r)) * det * 0.8);
  } else if (t == 2) {
    vec3 base = uRoadSand > 0.5 ? SA : G;
    vec2 q = f - 0.5;
    float d = length(q) + 0.05;
    if ((same & 1) != 0) d = min(d, ewSeg(q, vec2(0.0), vec2(0.8, 0.0)));
    if ((same & 2) != 0) d = min(d, ewSeg(q, vec2(0.0), vec2(-0.8, 0.0)));
    if ((same & 4) != 0) d = min(d, ewSeg(q, vec2(0.0), vec2(0.0, 0.8)));
    if ((same & 8) != 0) d = min(d, ewSeg(q, vec2(0.0), vec2(0.0, -0.8)));
    float wob = (N - 0.5) * 0.12;
    float m = 1.0 - smoothstep(0.338, 0.362, d + wob);
    vec3 dirt = mix(uPal[23], uPal[24], smoothstep(0.35, 0.65, F));
    dirt *= 1.0 - 0.13 * (1.0 - smoothstep(0.015, 0.04, abs(d - 0.15)));
    float peb = step(0.8, V.z) * (1.0 - smoothstep(0.16, 0.24, V.x));
    dirt = mix(dirt, uPal[11] * (0.85 + 0.3 * V.z), peb * det * 0.8);
    dirt *= 1.0 - 0.14 * smoothstep(0.28, 0.35, d + wob);
    c = mix(base, dirt, m);
  } else if (t == 3) {
    vec3 st = mix(uPal[10], uPal[11], V.z) * (0.86 + 0.24 * (1.0 - V.x));
    c = mix(uPal[12], st, smoothstep(0.03, 0.1, V.y - V.x));
  } else if (t == 4 || t == 16) {
    c = FL * (t == 4 ? 1.0 : 0.9) * (0.94 + 0.12 * F);
  } else if (t == 5 || t == 20) {
    int sm = t == 5 ? same : 0;
    float bE = (sm & 1) != 0 ? 9.0 : 1.0 - f.x;
    float bW = (sm & 2) != 0 ? 9.0 : f.x;
    float bS = (sm & 4) != 0 ? 9.0 : 1.0 - f.y;
    float bN = (sm & 8) != 0 ? 9.0 : f.y;
    float b = min(min(bE, bW), min(bS, bN));
    vec2 fq = abs(fract(p * 2.5) - 0.5);
    float dia = fq.x + fq.y;
    float motif = (1.0 - smoothstep(0.015, 0.035, abs(dia - 0.3))) + (1.0 - smoothstep(0.06, 0.09, dia));
    vec3 cc = mix(uPal[13], uPal[14], clamp(motif, 0.0, 1.0) * 0.75) * (0.95 + 0.08 * N);
    vec3 gold = mix(uPal[15], uPal[16], 0.6 + 0.4 * F);
    float line = 1.0 - smoothstep(0.004, 0.009, abs(b - 0.105));
    vec3 border = mix(gold, uPal[14] * 0.7, line) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.012, b - 0.06)));
    cc = mix(cc, border, step(b, 0.15));
    c = mix(FL, cc, step(0.06, b));
  } else if (t == 6 || t == 7) {
    c = SA * (t == 7 ? 1.04 : 1.0);
  } else if (t == 8) {
    vec3 slab = mix(uPal[10], uPal[11], V.z) * (0.86 + 0.18 * N);
    float cr = abs(fract(V.z * 13.0 + (p.x - p.y) * 1.7) - 0.5);
    slab *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.03, cr)) * det * step(0.55, V.z);
    slab = mix(slab, uPal[1] * 0.85, smoothstep(0.6, 0.7, F) * 0.55);
    c = mix(uPal[25] * (0.9 + 0.15 * N), slab, smoothstep(0.03, 0.08, V.y - V.x) * step(0.12, V.z));
  } else if (t == 9) {
    vec2 q = p * 2.0; vec2 id = floor(q); vec2 fq = fract(q) - 0.5;
    float e = max(abs(fq.x), abs(fq.y));
    vec3 g = mix(uPal[15], uPal[16], 0.45 + 0.35 * ewH21(id + 3.0));
    float inset = 1.0 - smoothstep(0.008, 0.016, abs(e - 0.36));
    float dia = abs(fq.x) + abs(fq.y);
    float motif = (1.0 - smoothstep(0.008, 0.018, abs(dia - 0.2))) + (1.0 - smoothstep(0.03, 0.05, dia));
    g *= 1.0 - 0.34 * clamp(inset + motif, 0.0, 1.0) * max(det, 0.4);
    float seamG = smoothstep(0.472, 0.495, e);
    c = mix(g, uPal[15] * 0.4, seamG);
    vec3 Vd = normalize(cameraPosition - vTW);
    float band = sin((vTW.x + vTW.z) * 0.55 - uTime * 0.7);
    float sheen = smoothstep(0.93, 1.0, band) * 0.4 + pow(1.0 - clamp(Vd.y, 0.0, 1.0), 3.0) * 0.25 + 0.05;
    emi += uPal[16] * sheen * (1.0 - 0.6 * seamG);
  } else if (t == 10) {
    vec3 st = FL * 0.92;
    vec2 cc = f - 0.5; float r = length(cc); float a = atan(cc.y, cc.x);
    float rune = (1.0 - smoothstep(0.008, 0.016, abs(r - 0.43))) + (1.0 - smoothstep(0.006, 0.013, abs(r - 0.33)));
    rune += 1.0 - smoothstep(0.006, 0.012, abs(r - 0.12));
    float seg = (a / 6.28318 + 0.5) * 14.0;
    float sf = fract(seg);
    float rr = (r - 0.345) / 0.075;
    float hh = ewH21(vec2(floor(seg), 5.0));
    float gl = (1.0 - smoothstep(0.05, 0.1, abs(sf - 0.5))) * step(0.12, rr) * step(rr, 0.88);
    gl += (1.0 - smoothstep(0.06, 0.12, abs(rr - (0.25 + 0.5 * hh)))) * step(0.22, sf) * step(sf, 0.78);
    gl += (1.0 - smoothstep(0.06, 0.12, abs(rr - 0.85 + 0.7 * sf))) * step(0.5, hh) * step(0.3, sf) * step(sf, 0.7);
    rune += clamp(gl, 0.0, 1.0) * step(0.0, rr) * step(rr, 1.0);
    float spoke = abs(fract((a / 6.28318) * 6.0) - 0.5);
    rune += (1.0 - smoothstep(0.02, 0.05, spoke * r * 6.28)) * step(0.12, r) * step(r, 0.33) * 0.8;
    rune = clamp(rune, 0.0, 1.0);
    emi += uPal[26] * rune * (0.72 + 0.28 * sin(uTime * 2.0 + r * 9.0)) * 1.5;
    c = mix(st, uPal[26] * 0.55, rune);
  } else if (t == 11) {
    float edge = V.y - V.x;
    float w = 0.05 + 0.07 * N;
    float crack = 1.0 - smoothstep(w * 0.55, w, edge);
    float core = 1.0 - smoothstep(0.0, w * 0.45, edge);
    float pool = smoothstep(0.6, 0.68, F);
    float rim = (1.0 - smoothstep(w, w + 0.14, edge)) * (1.0 - crack);
    vec3 crust = mix(vec3(0.05, 0.022, 0.018), vec3(0.11, 0.045, 0.03), V.z) * (0.8 + 0.4 * N);
    float flick = 0.88 + 0.12 * sin(uTime * 2.3 + V.z * 9.0 + F * 6.0);
    float hot = max(crack, pool);
    c = mix(crust, vec3(0.28, 0.06, 0.02), hot);
    vec3 glowC = mix(vec3(1.0, 0.26, 0.04), vec3(1.0, 0.62, 0.16), max(core, pool * smoothstep(0.66, 0.8, F)));
    emi += glowC * hot * 1.25 * flick + vec3(0.45, 0.07, 0.01) * rim * 0.5;
  } else if (t == 12) {
    emi += uPal[27] * (0.03 + 0.07 * F);
    c = vec3(0.005, 0.004, 0.01);
  } else if (t == 13 || t == 17) {
    vec3 rk = mix(uPal[5], uPal[6], V.z) * (0.85 + 0.25 * (1.0 - V.x));
    rk *= mix(0.72, 1.0, smoothstep(0.02, 0.07, V.y - V.x));
    float snowy = max(step(uSnowY, topY), t == 17 ? 1.0 : 0.0);
    rk = mix(rk, G * 0.9, smoothstep(0.5, 0.56, F) * 0.85 * (1.0 - snowy));
    float sn = smoothstep(0.5, 0.56, F + 0.3 * (1.0 - V.x) - 0.1 * N + clamp((topY - uSnowY) * 0.06, 0.0, 0.25) - 0.06);
    c = mix(rk, uPal[19] * (0.93 + 0.07 * N), sn * snowy);
  } else if (t == 14) {
    c = mix(G * 0.8, uPal[22], smoothstep(0.42, 0.55, F) * 0.75);
    vec2 g = p * 9.0; vec2 gi = floor(g); vec2 gf = fract(g) - 0.5;
    float hh = ewH21(gi + 9.1);
    vec2 o = (ewH22(gi) - 0.5) * 0.5;
    vec2 dd = gf - o; dd = vec2(dd.x * 0.8 + dd.y * 0.6, dd.y * 0.8 - dd.x * 0.6);
    float l = length(dd * vec2(1.0, 2.2));
    c = mix(c, mix(uPal[23], uPal[2], fract(hh * 7.0)) * 0.85, step(0.72, hh) * (1.0 - smoothstep(0.12, 0.17, l)) * det);
  } else if (t == 15) {
    c = mix(uPal[20], uPal[21], smoothstep(0.3, 0.7, F));
    c = mix(c, c * 1.25, step(0.7, V.z) * (1.0 - smoothstep(0.2, 0.3, V.x)));
    c *= mix(1.0, 0.5, texture2D(uShore, (p - uShoreXf.xy) * uShoreXf.zw).g);
  } else if (t == 18) {
    c = mix(uPal[23], uPal[24], smoothstep(0.3, 0.7, F)) * 0.95;
    c = mix(c, uPal[9], step(0.9, ewH21(floor(p * vec2(30.0, 6.0)))) * 0.45 * det);
  } else if (t == 19) {
    c = mix(uPal[17], uPal[18], smoothstep(0.35, 0.65, F));
    float cr = 1.0 - smoothstep(0.015, 0.04, V.y - V.x);
    c *= 1.0 - 0.35 * cr;
    emi += vec3(1.0, 0.3, 0.05) * cr * step(0.6, V.z) * (0.35 + 0.25 * sin(uTime * 1.7 + V.z * 20.0));
    vec2 g = p * 11.0; float hh = ewH21(floor(g));
    emi += vec3(1.0, 0.45, 0.1) * step(0.965, hh) * (1.0 - smoothstep(0.05, 0.12, length(fract(g) - 0.5))) * (0.6 + 0.6 * sin(uTime * 3.0 + hh * 50.0)) * det;
  } else if (t == 21) {
    c = mix(uPal[28], uPal[29], V.z * 0.6 + 0.2);
    c *= mix(0.55, 1.12, smoothstep(0.1, 0.8, 1.0 - V.x));
    c *= mix(0.5, 1.0, smoothstep(0.02, 0.1, V.y - V.x)) * (0.92 + 0.16 * N);
    c = mix(mix(uPal[28], uPal[29], 0.45 + 0.3 * F) * 0.85, c, det);
  } else if (t == 22) {
    c = G * vec3(1.03, 1.0, 0.92);
    c = mix(c, uPal[6], step(0.9, V.z) * (1.0 - smoothstep(0.14, 0.2, V.x)) * det);
  }
  return c;
}

vec3 ewSide(int t, vec3 P, float u, float topY, float botY, float det, vec3 V, float F, float N, inout vec3 emi) {
  float depth = topY - P.y;
  bool grassy = (t == 0 || t == 1 || (t == 2 && uRoadSand < 0.5) || t == 14 || t == 22);
  float lip = 0.075 + 0.05 * N;
  vec3 c;
  if (t == 13 || t == 17 || t == 22) {
    float s = P.y * 4.0 + F * 1.4;
    c = mix(uPal[5], uPal[6], ewH21(vec2(floor(s), 1.0)));
    c = mix(c, uPal[7], smoothstep(0.84, 0.95, fract(s)) * 0.65);
    c *= mix(0.62, 1.0, smoothstep(0.02, 0.06, V.y - V.x));
    if (t == 22) c = mix(c, mix(uPal[3], uPal[4], 0.5), 0.45);
  } else if (t == 3 || t == 4 || t == 5 || t == 8 || t == 10 || t == 16 || t == 20) {
    float bh = 0.2; float bw = 0.42;
    float row = floor(P.y / bh); float x = u / bw + mod(row, 2.0) * 0.5;
    vec2 fq = vec2(fract(x), fract(P.y / bh));
    float e = min(min(fq.x, 1.0 - fq.x) * bw, min(fq.y, 1.0 - fq.y) * bh);
    c = mix(uPal[10], uPal[11], ewH21(vec2(floor(x), row))) * (0.88 + 0.14 * F);
    c *= 1.0 + 0.08 * (1.0 - smoothstep(0.0, 0.035, 1.0 - fq.y));
    c = mix(uPal[12], c, smoothstep(0.006, 0.016, e));
    if (t == 16) c = mix(c, uPal[0] * 0.8, smoothstep(0.35, 0.0, P.y - botY) * smoothstep(0.45, 0.6, N) * 0.7);
    if (t == 10) emi += uPal[26] * (1.0 - smoothstep(0.004, 0.012, abs(depth - 0.06))) * (0.8 + 0.2 * sin(uTime * 2.0));
  } else if (t == 6 || t == 7) {
    float s = P.y * 5.0 + F * 0.9;
    c = mix(uPal[8], uPal[9], ewH21(vec2(floor(s), 4.0))) * 0.88;
    c *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 0.09, fract(s)));
  } else if (t == 9) {
    c = mix(uPal[15], uPal[16], 0.5 + 0.3 * F);
    c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.08, abs(fract(P.y * 5.0) - 0.5)));
  } else if (t == 19 || t == 11 || t == 12) {
    float s = P.y * 3.5 + F * 1.3;
    c = mix(uPal[17], uPal[18], ewH21(vec2(floor(s), 2.0))) * 0.8;
    c *= mix(0.55, 1.0, smoothstep(0.02, 0.06, V.y - V.x));
  } else if (t == 21) {
    c = mix(uPal[28], uPal[29], V.z * 0.5) * mix(0.45, 0.85, 1.0 - V.x);
  } else if (t == 15) {
    c = uPal[21] * 0.7;
  } else {
    float s = P.y * 6.0 + F * 1.1;
    c = mix(uPal[3], uPal[4], ewH21(vec2(floor(s), 3.0)));
    c *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.08, fract(s)));
    c = mix(c, uPal[6] * (0.8 + 0.3 * V.z), step(0.76, V.z) * (1.0 - smoothstep(0.2, 0.28, V.x)) * det);
  }
  float lipEdge = grassy ? lip : 0.0;
  c *= mix(0.7, 1.0, smoothstep(0.0, 0.06, depth - lipEdge));
  c *= mix(0.6, 1.0, smoothstep(0.0, 0.32, P.y - botY));
  if (P.y < 0.25 && botY < 0.2 && botY > -1.0) c *= mix(1.0, 0.68, smoothstep(0.25, 0.2, P.y));
  if (grassy && depth < lip) {
    vec3 gc = t == 14 ? mix(uPal[22], uPal[0], 0.5) : uPal[1];
    c = mix(gc * 0.82, uPal[2] * 0.95, smoothstep(lip, 0.0, depth) * 0.55);
  }
  return c;
}

vec3 ewSurface(out vec3 emi) {
  emi = vec3(0.0);
  int t = int(vTA.x + 0.5);
  float topY = vTA.y; float botY = vTA.z; float outside = vTA.w;
  vec2 tile = vTB.xy; int m = int(vTB.z + 0.5); float glow = vTB.w;
  vec3 P = vTP; vec3 Nr = normalize(vTN);
  float fw = length(fwidth(P));
  float det = 1.0 - smoothstep(0.012, 0.05, fw);
  bool isTop = Nr.y > 0.5;
  float u = abs(Nr.x) > 0.5 ? P.z : P.x;
  vec2 flow = vec2(uTime * 0.045, uTime * 0.028);
  float F = ewFbm(isTop ? P.xz * 0.42 + (t == 11 ? flow * 2.6 : vec2(0.0)) : vec2(u * 1.1, P.y * 1.2));
  float N = ewN2(isTop ? P.xz * 1.9 + 3.1 : vec2(u * 8.0, topY * 3.7));
  vec2 vq = isTop ? P.xz * ewVScaleTop(t) + (t == 11 ? flow * 1.6 + F * 0.9 : vec2(t == 8 ? 0.5 : 0.0)) : ewSideVQ(t, u, P.y);
  vec3 V = ewVor(vq);
  vec3 alb;
  if (isTop) {
    vec2 f = P.xz - tile;
    int drop = m & 15; int rise = (m >> 4) & 15;
    alb = ewTop(t, P.xz, f, (m >> 8) & 15, topY, det, V, F, N, emi);
    bool grassy = (t == 0 || t == 1 || (t == 2 && uRoadSand < 0.5) || t == 14 || t == 22);
    float lip = grassy ? uLip : 0.0;
    float dE = 1.0 - f.x; float dW = f.x; float dS = 1.0 - f.y; float dN = f.y;
    float bev = 9.0;
    if ((drop & 1) != 0) bev = min(bev, dE + lip);
    if ((drop & 2) != 0) bev = min(bev, dW + lip);
    if ((drop & 4) != 0) bev = min(bev, dS + lip);
    if ((drop & 8) != 0) bev = min(bev, dN + lip);
    float bevOn = (t == 11 || t == 12 || t == 15) ? 0.0 : 1.0;
    alb *= 1.0 + 0.17 * (1.0 - smoothstep(0.012, 0.04, bev)) * bevOn;
    float ao = 9.0;
    if ((rise & 1) != 0) ao = min(ao, dE);
    if ((rise & 2) != 0) ao = min(ao, dW);
    if ((rise & 4) != 0) ao = min(ao, dS);
    if ((rise & 8) != 0) ao = min(ao, dN);
    alb *= mix(0.66, 1.0, smoothstep(0.0, 0.24, ao));
    int flat4 = 15 & ~(drop | rise);
    float sd = 9.0;
    if ((flat4 & 1) != 0) sd = min(sd, abs(dE));
    if ((flat4 & 2) != 0) sd = min(sd, abs(dW));
    if ((flat4 & 4) != 0) sd = min(sd, abs(dS));
    if ((flat4 & 8) != 0) sd = min(sd, abs(dN));
    alb *= 1.0 - (1.0 - smoothstep(0.0, 0.012 + fw * 0.9, sd)) * uSeam * (1.0 - outside);
  } else if (Nr.y < -0.5) {
    alb = vec3(0.04);
  } else {
    alb = ewSide(t, P, u, topY, botY, det, V, F, N, emi);
    if (glow > 0.5 && glow < 1.5) {
      emi += vec3(1.0, 0.33, 0.07) * exp(-max(P.y - 0.16, 0.0) * 6.5) * (0.85 + 0.3 * sin(uTime * 2.1 + u * 3.0)) * 0.9;
    } else if (glow > 1.5) {
      float dd = clamp((topY - P.y) / 2.6, 0.0, 1.0);
      alb *= 1.0 - 0.96 * smoothstep(0.02, 0.45, dd);
      emi += uPal[27] * smoothstep(0.8, 1.0, dd) * 0.07;
    }
  }
  float l = dot(alb, vec3(0.299, 0.587, 0.114));
  alb = mix(alb, vec3(l), outside * uOutside.x) * (1.0 - outside * uOutside.y);
  emi *= 1.0 - outside * 0.35;
  return alb;
}
`;

/**
 * Terrain material: MeshToonMaterial with procedural per-type surfaces driven by the aTA/aTB vertex attributes.
 * @param {object} U world uniforms (createWorldUniforms)
 * @param {THREE.Color[]} pal palette colours in PAL_SLOTS order
 * @param {THREE.Texture} shoreTex distance-to-shore field
 * @param {THREE.Vector4} shoreXf (originX, originZ, 1/sizeX, 1/sizeZ)
 */
export function terrainMaterial(U, pal, shoreTex, shoreXf, { seam = 0.1, lip = 0.03, roadSand = false } = {}) {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap('anime3') });
  mat.name = 'ew-terrain';
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime: U.uTime, uNight: U.uNight, uSnowY: U.uSnowY, uOutside: U.uOutside,
      uPal: { value: pal }, uShore: { value: shoreTex }, uShoreXf: { value: shoreXf },
      uSeam: { value: seam }, uLip: { value: lip }, uRoadSand: { value: roadSand ? 1 : 0 },
    });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTA = aTA; vTB = aTB; vTP = position; vTN = normal; vTW = (modelMatrix * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${TERRAIN_FRAG_PARS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 ewEmi;\ndiffuseColor.rgb = ewSurface(ewEmi);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ewEmi;');
  };
  mat.customProgramCacheKey = () => 'ew-terrain-v1';
  return mat;
}

// ------------------------------------------------------------------------------------------- water
const WATER_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform sampler2D uShore;
uniform vec4 uShoreXf;
uniform vec3 uWShallow;
uniform vec3 uWDeep;
uniform vec3 uWFoam;
uniform vec3 uWHigh;
uniform vec3 uWSky;
varying vec3 vWP;
varying vec3 vWW;
`;

const WATER_FRAG_MAIN = /* glsl */ `
vec3 ewWEmi = vec3(0.0);
{
  vec2 p = vWP.xz;
  float t = uTime;
  vec4 sh = texture2D(uShore, (p - uShoreXf.xy) * uShoreXf.zw);
  float d = sh.r; float deep = sh.g;
  float fw = length(fwidth(p));
  float det = 1.0 - smoothstep(0.015, 0.06, fw);
  float n1 = ewN2(p * 0.9 + vec2(t * 0.06, t * 0.04));
  vec3 col = mix(uWShallow, uWDeep, clamp(smoothstep(0.0, 0.8, d) * 0.65 + deep * 0.6, 0.0, 1.0));
  col *= 0.94 + 0.12 * n1;
  vec2 cq = p * 1.1 + vec2(t * 0.05, t * 0.035) + vec2(n1 * 0.8, -n1 * 0.6);
  float r1 = 1.0 - abs(ewN2(cq) * 2.0 - 1.0);
  float r2 = 1.0 - abs(ewN2(cq * 1.9 + vec2(-t * 0.07, t * 0.05) + 3.7) * 2.0 - 1.0);
  float lines = smoothstep(0.88, 0.97, r1) * 0.75 + smoothstep(0.9, 0.98, r2) * 0.45;
  float caus = lines * (0.55 + 0.45 * n1) * (1.0 - deep * 0.6) * smoothstep(0.04, 0.12, d);
  col = mix(col, uWHigh, smoothstep(0.3, 0.5, caus) * 0.2 * max(det, 0.3));
  float fn = ewN2(p * 6.5 + vec2(t * 0.35, -t * 0.28));
  float foam = 1.0 - smoothstep(0.045, 0.07, d + (fn - 0.5) * 0.05);
  float ring = abs(d - (0.15 + 0.035 * sin(t * 1.3 + fn * 3.0)));
  float foam2 = (1.0 - smoothstep(0.006, 0.016, ring)) * step(0.48, fn) * (1.0 - deep);
  foam = max(foam, foam2 * 0.6);
  vec2 gq = p * 7.0 + vec2(t * 0.25, t * 0.18);
  vec2 gi = floor(gq); vec2 gf = fract(gq) - 0.5;
  float gh = ewH21(gi);
  float star = (1.0 - smoothstep(0.02, 0.07, abs(gf.x) + abs(gf.y) * 2.4)) + (1.0 - smoothstep(0.02, 0.07, abs(gf.y) + abs(gf.x) * 2.4));
  float glint = step(0.94, gh) * clamp(star, 0.0, 1.0) * (0.5 + 0.5 * sin(t * 4.0 + gh * 40.0)) * det * smoothstep(0.08, 0.3, d);
  vec3 Vd = normalize(cameraPosition - vWW);
  float fres = pow(1.0 - clamp(Vd.y, 0.0, 1.0), 3.0);
  col = mix(col, uWSky, fres * 0.5 + 0.06);
  col = mix(col, uWFoam, foam * 0.85);
  diffuseColor.rgb = col;
  diffuseColor.a = max(mix(0.5, 0.86, smoothstep(0.0, 0.6, d + deep)), foam * 0.85);
  ewWEmi = uWHigh * glint * 1.2;
}
`;

/** Stylised river/sea surface: depth tint, moving caustic lines, shore foam, toon glints. */
export function waterMaterial(U, shoreTex, shoreXf, colors) {
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap('anime2'), transparent: true, depthWrite: true });
  mat.name = 'ew-water';
  const c = (h) => new THREE.Color(h);
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime: U.uTime, uNight: U.uNight, uShore: { value: shoreTex }, uShoreXf: { value: shoreXf },
      uWShallow: { value: c(colors.shallow) }, uWDeep: { value: c(colors.deep) }, uWFoam: { value: c(colors.foam) },
      uWHigh: { value: c(colors.high) }, uWSky: { value: c(colors.sky) },
    });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vWW = (modelMatrix * vec4(position, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${WATER_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_FRAG_MAIN}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ewWEmi;');
  };
  mat.customProgramCacheKey = () => 'ew-water-v1';
  return mat;
}

// ------------------------------------------------------------------------------------------- props (static merged)
function chain(mat, key, fn) {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (s, r) => { base(s, r); fn(s, r); };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Vertex-coloured toon material with per-vertex emission (aEmit: rgb, mode 0 = always, 1 = night only, 2 = pulsing). */
export function propMaterial(U, { rim = 0.8 } = {}) {
  const mat = toonMaterial({ vertexColors: true, gradient: 'anime3', rim, name: 'ew-props' });
  return chain(mat, 'ew-props-v1', (s) => {
    s.uniforms.uNight = U.uNight; s.uniforms.uTime = U.uTime;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aEmit;\nvarying vec4 vEmit;\nvarying float vEmitPh;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit; vEmitPh = position.x * 1.7 + position.z * 1.3 + position.y * 3.0;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vEmit;\nvarying float vEmitPh;\nuniform float uNight;\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float ewK = vEmit.a < 1.5 ? mix(1.0, uNight, vEmit.a) : (0.65 + 0.35 * sin(uTime * 2.2 + vEmitPh));
        totalEmissiveRadiance += vEmit.rgb * ewK;
      }`);
  });
}

// ------------------------------------------------------------------------------------------- cloth / swaying merged geometry
const CLOTH_VERT_PARS = /* glsl */ `
attribute vec4 aSway;
attribute vec3 aSwayDir;
uniform float uTime;
uniform vec4 uWind;
vec3 ewClothOff() {
  float w = aSway.z;
  if (w <= 0.0) return vec3(0.0);
  float t = uTime; float ph = aSway.x; float m = aSway.w;
  if (m < 0.5) {
    float wave = sin(t * 4.6 + ph - w * 6.5) * 0.65 + sin(t * 7.9 + ph * 1.7 - w * 10.0) * 0.25;
    return aSwayDir * wave * aSway.y * w;
  } else if (m < 1.5) {
    float s = sin(t * 1.5 + ph) * 0.7 + sin(t * 2.7 + ph * 1.3) * 0.3;
    return aSwayDir * s * aSway.y * w * w;
  }
  float s = sin(t * 1.7 + ph) * 0.7 + sin(t * 3.1 + ph * 0.7) * 0.3;
  return (vec3(uWind.x, 0.0, uWind.y) * s * uWind.z + vec3(0.0, -0.35 * abs(s), 0.0)) * aSway.y * w;
}
`;

/** Double-sided toon material whose vertices wave (flags, banners, palm fronds). */
export function clothMaterial(U) {
  const mat = toonMaterial({ vertexColors: true, gradient: 'anime3', rim: 0.6, side: THREE.DoubleSide, name: 'ew-cloth' });
  return chain(mat, 'ew-cloth-v1', (s) => {
    s.uniforms.uTime = U.uTime; s.uniforms.uWind = U.uWind;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${CLOTH_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += ewClothOff();');
  });
}

/** Shadow depth material matching clothMaterial's displacement. */
export function clothDepthMaterial(U) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.uTime; s.uniforms.uWind = U.uWind;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${CLOTH_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += ewClothOff();');
  };
  mat.customProgramCacheKey = () => 'ew-cloth-depth-v1';
  return mat;
}

// ------------------------------------------------------------------------------------------- instanced vegetation
const VEG_VERT_PARS = /* glsl */ `
attribute vec4 aVeg;
attribute float aTintW;
uniform float uTime;
uniform vec4 uWind;
uniform vec4 uFade;
varying float vEwFade;
vec3 ewVegSway(vec3 pos, out float fade) {
  fade = 0.0;
#ifdef USE_INSTANCING
  vec3 wp = (instanceMatrix * vec4(pos, 1.0)).xyz;
  float h = max(wp.y - aVeg.z, 0.0);
  float t = uTime * uWind.w + aVeg.x;
  float gust = 0.7 + 0.3 * sin(uTime * 0.43 + wp.x * 0.13 + wp.z * 0.09);
  float s = (sin(t) * 0.7 + sin(t * 2.31 + 1.3) * 0.3) * aVeg.y * h * h * gust * uWind.z;
  vec3 off = vec3(uWind.x * s, -abs(s) * 0.12, uWind.y * s);
  if (uFade.w > 0.0 && aVeg.w > 0.5) {
    float d = distance(instanceMatrix[3].xz, uFade.xy);
    fade = (1.0 - smoothstep(uFade.z * 0.55, uFade.z + 0.35, d)) * uFade.w;
  }
  mat3 m3 = mat3(instanceMatrix);
  float s2 = max(dot(m3[0], m3[0]), 1e-6);
  return pos * (1.0 - 0.3 * fade) + (transpose(m3) * off) / s2;
#else
  return pos;
#endif
}
`;

const VEG_SNOW_FRAG = /* glsl */ `
{
  float ewUp = smoothstep(0.45, 0.75, normalize(vEwWN).y);
  float ewHi = smoothstep(uSnowY - 0.05, uSnowY + 0.25, vEwWP.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), ewUp * ewHi);
}
`;

/**
 * Toon material for instanced vegetation/rocks: wind sway (aVeg = phase, amount, groundY, fadeable),
 * dithered fade around U.uFade, optional per-vertex instance-tint weight (aTintW) and snow on upward faces.
 */
export function vegMaterial(U, { snow = false, doubleSide = false, rim = 0.9, flatUp = false } = {}) {
  const mat = toonMaterial({ vertexColors: true, gradient: 'anime3', rim, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide, name: 'ew-veg' });
  return chain(mat, `ew-veg-v1-${snow ? 's' : ''}${flatUp ? 'u' : ''}`, (s) => {
    Object.assign(s.uniforms, { uTime: U.uTime, uWind: U.uWind, uFade: U.uFade, uSnowY: U.uSnowY });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VEG_VERT_PARS}\nvarying vec3 vEwWP;\nvarying vec3 vEwWN;`)
      .replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec4(1.0);
#endif
#ifdef USE_COLOR
  vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTintW);
#endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float ewF; transformed = ewVegSway(transformed, ewF); vEwFade = ewF; }')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 ewW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          ewW = instanceMatrix * ewW;
          vEwWN = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
        #else
          vEwWN = mat3(modelMatrix) * objectNormal;
        #endif
        vEwWP = (modelMatrix * ewW).xyz;
      }`);
    if (flatUp) s.vertexShader = s.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = vec3(0.0, 1.0, 0.0);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}\n${BAYER_GLSL}\nvarying float vEwFade;\nvarying vec3 vEwWP;\nvarying vec3 vEwWN;\nuniform float uSnowY;`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vEwFade > 0.002 && ewBayer(gl_FragCoord.xy) < vEwFade * 0.85) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${snow ? VEG_SNOW_FRAG : ''}`);
  });
}

/** Shadow depth material matching vegMaterial's sway (no fade so shade stays put). */
export function vegDepthMaterial(U) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uTime: U.uTime, uWind: U.uWind, uFade: U.uFade });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${VEG_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float ewF; transformed = ewVegSway(transformed, ewF); }');
  };
  mat.customProgramCacheKey = () => 'ew-veg-depth-v1';
  return mat;
}

const OUTLINE_PROJECT = /* glsl */ `#include <project_vertex>
{
  vec3 ewN = normal;
  #ifdef USE_INSTANCING
    ewN = mat3(instanceMatrix) * ewN;
  #endif
  vec3 ewVN = normalize(normalMatrix * ewN);
  vec2 ewDir = (projectionMatrix * vec4(ewVN, 0.0)).xy * uResolution;
  float ewLen = length(ewDir);
  if (ewLen > 1e-6) ewDir /= ewLen;
  gl_Position.xy += ewDir * uOutlineWidth * uOutlineScale * 2.0 / uResolution * gl_Position.w;
}`;

/**
 * Screen-space inverted-hull outline that applies the same vertex animation as the coloured mesh.
 * kind: 'veg' (instanced sway + fade) | 'cloth' (merged cloth waves)
 */
export function animatedOutlineMaterial(U, kind, { color = 0x231a1e, width = 1.6 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
  mat.name = `ew-outline-${kind}`;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uTime: U.uTime, uWind: U.uWind, uFade: U.uFade, uOutlineWidth: { value: width },
      uResolution: toonGlobals.resolution, uOutlineScale: toonGlobals.outlineScale,
    });
    const pars = kind === 'veg' ? VEG_VERT_PARS : CLOTH_VERT_PARS;
    const anim = kind === 'veg'
      ? '{ float ewF; transformed = ewVegSway(transformed, ewF); vEwFadeO = ewF; }'
      : 'transformed += ewClothOff(); vEwFadeO = 0.0;';
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${pars}\nuniform float uOutlineWidth;\nuniform vec2 uResolution;\nuniform float uOutlineScale;\nvarying float vEwFadeO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${anim}`)
      .replace('#include <project_vertex>', OUTLINE_PROJECT);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEwFadeO;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vEwFadeO > 0.2) discard;');
  };
  mat.customProgramCacheKey = () => `ew-outline-${kind}-v1`;
  return mat;
}

// ------------------------------------------------------------------------------------------- flames & glows (billboards)
const FX_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aF;
attribute vec3 aColor;
uniform float uTime;
varying vec2 vUv;
varying vec4 vF;
varying vec3 vCol;
#include <fog_pars_vertex>
void main() {
  vec3 c = position;
  float kind = aF.z;
  if (kind > 1.5 && kind < 2.5) {
    float ph = aF.y * 6.2831;
    float life = fract(uTime * 0.12 + aF.y);
    c.y += life * 1.6 + sin(uTime * 0.9 + ph) * 0.08;
    c.x += sin(uTime * 0.7 + ph * 1.3) * 0.12;
    c.z += cos(uTime * 0.6 + ph) * 0.12;
  }
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
  vec2 sz = kind < 0.5 ? vec2(aF.x * 0.5, aF.x * 0.75) : vec2(aF.x);
  vec2 off = aCorner * sz;
  if (kind < 0.5) off.y += aF.x * 0.6;
  mvPosition.xyz += normalize(-mvPosition.xyz) * aF.x * (kind < 0.5 ? 0.35 : 0.85);
  mvPosition.xy += off;
  vUv = aCorner; vF = aF; vCol = aColor;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FX_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vF;
varying vec3 vCol;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float kind = vF.z;
  float t = uTime + vF.y * 17.0;
  vec3 col; float a;
  if (kind < 0.5) {
    float y = vUv.y * 0.5 + 0.5;
    float fl = ewN2(vec2(vUv.x * 2.2 + vF.y * 9.0, y * 2.6 - t * 3.6));
    float fl2 = ewN2(vec2(vUv.x * 4.0 - vF.y * 5.0, y * 5.0 - t * 6.0));
    float sway = (fl - 0.5) * 0.45 * y + sin(t * 2.3) * 0.08 * y;
    float dx = abs(vUv.x + sway);
    float w = (1.0 - y) * 0.95 * sqrt(clamp(y * 3.0, 0.0, 1.0)) * (0.82 + 0.4 * fl2);
    float shape = w - dx;
    float outer = smoothstep(0.0, 0.05, shape);
    float mid = smoothstep(0.1, 0.15, shape + 0.08 - y * 0.25);
    float core = smoothstep(0.2, 0.25, shape + 0.06 - y * 0.35);
    col = mix(vCol, vec3(1.0, 0.62, 0.18), mid);
    col = mix(col, vec3(1.0, 0.93, 0.7), core);
    col *= (1.9 + 0.5 * fl) * vF.w;
    a = outer;
  } else if (kind < 1.5) {
    float r = length(vUv);
    float g = exp(-r * r * 4.2) * (1.0 - smoothstep(0.75, 1.0, r));
    float fl = 0.88 + 0.12 * sin(t * 7.0) * sin(t * 3.1 + 1.0);
    col = vCol * vF.w * fl;
    a = g;
  } else if (kind < 2.5) {
    float r = length(vUv);
    float life = fract(uTime * 0.12 + vF.y);
    float g = (1.0 - smoothstep(0.15, 1.0, r)) * sin(life * 3.14159);
    col = vCol * vF.w * (1.0 + 0.5 * (1.0 - smoothstep(0.0, 0.3, r)));
    a = g;
  } else {
    float r = length(vUv);
    float star = (1.0 - smoothstep(0.0, 0.12, abs(vUv.x) * abs(vUv.y) * 6.0 + r * 0.25)) * (1.0 - smoothstep(0.6, 1.0, r));
    col = vCol * vF.w;
    a = clamp(star + exp(-r * r * 9.0) * 0.6, 0.0, 1.0);
  }
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float ewFog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float ewFog = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - ewFog;
  #endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Additive billboard material for flames (kind 0), glows (1), drifting motes (2) and sparkles (3). */
export function fxMaterial(U) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: FX_VERT,
    fragmentShader: FX_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  mat.uniforms.uTime = U.uTime;
  mat.name = 'ew-fx';
  return mat;
}
