// Custom post-processing shaders: diorama tilt-shift and an anime colour-grade/vignette/flash pass.
import * as THREE from 'three';

/** Variable-radius disc blur driven by distance from a horizontal focus band (HD-2D miniature look). */
export const TiltShiftShader = {
  name: 'TiltShiftShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uFocusY: { value: 0.5 },
    uRange: { value: 0.2 },
    uFalloff: { value: 0.35 },
    uBlur: { value: 3.0 },
    uEnabled: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocusY, uRange, uFalloff, uBlur, uEnabled;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float d = abs(vUv.y - uFocusY);
      float amt = smoothstep(uRange, uRange + uFalloff, d) * uBlur * uEnabled;
      if (amt < 0.05) { gl_FragColor = base; return; }
      vec2 px = 1.0 / uResolution;
      vec4 acc = base;
      float wsum = 1.0;
      const float GOLDEN = 2.39996323;
      for (int i = 1; i < 14; i++) {
        float fi = float(i);
        float r = sqrt(fi / 14.0) * amt;
        float a = fi * GOLDEN;
        vec2 off = vec2(cos(a), sin(a)) * r * px;
        acc += texture2D(tDiffuse, vUv + off);
        wsum += 1.0;
      }
      gl_FragColor = acc / wsum;
    }`,
};

/** Runs after OutputPass (display-referred): saturation/contrast/tint, vignette, grain, screen flash and fade. */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uBrightness: { value: 0.0 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uFade: { value: 0 },
    uAberration: { value: 0.0015 },
    uDesat: { value: 0 },
  },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation, uContrast, uBrightness, uVignette, uGrain, uTime, uFade, uAberration, uDesat;
    uniform vec3 uTint;
    uniform vec4 uFlash;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + uTime * 0.37) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 dir = c * uAberration * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir).b;
      col *= uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      col = (col - 0.5) * uContrast + 0.5 + uBrightness;
      float vig = smoothstep(0.85, 0.2, r2 * 2.2);
      col *= mix(1.0, vig, uVignette);
      col += (rand(vUv * 731.0) - 0.5) * uGrain;
      col = mix(col, uFlash.rgb, uFlash.a);
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
