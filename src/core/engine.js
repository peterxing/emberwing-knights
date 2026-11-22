// Renderer, post-processing chain, quality tiers and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { TiltShiftShader, GradeShader } from './postfx.js';
import { setToonResolution, toonGlobals } from '../gfx/toon.js';
import { tweens, ease } from './util.js';

export const QUALITY = {
  high: { dpr: 2, msaa: 4, bloom: true, tilt: true, shadow: true },
  medium: { dpr: 1.5, msaa: 2, bloom: true, tilt: true, shadow: true },
  low: { dpr: 1, msaa: 0, bloom: false, tilt: false, shadow: false },
};

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
    this.updaters = new Set();
    this.elapsed = 0;
    this.fps = 60;
    this.paused = false;
    this.flashTw = null;
    this._buildComposer(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.paused = true; this.onContextLost?.(); }, false);
  }

  _buildComposer(quality) {
    this.quality = quality;
    const q = QUALITY[quality] || QUALITY.high;
    this.q = q;
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = q.shadow;
    if (this.composer) this.composer.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const ext = this.renderer.extensions;
    this.floatOK = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: this.floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: this.floatOK ? q.msaa : Math.min(q.msaa, 2),
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.tiltPass = new ShaderPass(TiltShiftShader);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.42, 0.85);
    this.outputPass = new OutputPass();
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.tiltPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.gradePass);
    this.tiltPass.enabled = q.tilt;
    this.bloomPass.enabled = q.bloom && this.floatOK;
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    const keep = { tilt: this.tiltPass.uniforms, grade: this.gradePass.uniforms, bloom: { s: this.bloomPass.strength, t: this.bloomPass.threshold } };
    this._buildComposer(quality);
    for (const k of Object.keys(keep.tilt)) if (k !== 'tDiffuse') this.tiltPass.uniforms[k].value = keep.tilt[k].value;
    for (const k of Object.keys(keep.grade)) if (k !== 'tDiffuse') this.gradePass.uniforms[k].value = keep.grade[k].value;
    this.bloomPass.strength = keep.bloom.s; this.bloomPass.threshold = keep.bloom.t;
    this.renderPass.scene = this.scene; this.renderPass.camera = this.camera;
    this.resize();
  }

  /** Switch what is being rendered. */
  setView(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.resize();
  }

  /** Apply an environment preset's grading values. */
  setGrade(p = {}) {
    const g = this.gradePass.uniforms;
    if (p.exposure !== undefined) this.renderer.toneMappingExposure = p.exposure;
    if (p.bloomStrength !== undefined) this.bloomPass.strength = p.bloomStrength;
    if (p.bloomThreshold !== undefined) this.bloomPass.threshold = p.bloomThreshold;
    if (p.saturation !== undefined) g.uSaturation.value = p.saturation;
    if (p.contrast !== undefined) g.uContrast.value = p.contrast;
    if (p.vignette !== undefined) g.uVignette.value = p.vignette;
    if (p.tint) g.uTint.value.set(p.tint[0], p.tint[1], p.tint[2]);
  }

  setTiltShift({ enabled, focusY, range, blur, falloff } = {}) {
    const u = this.tiltPass.uniforms;
    if (enabled !== undefined) u.uEnabled.value = enabled ? 1 : 0;
    if (focusY !== undefined) u.uFocusY.value = focusY;
    if (range !== undefined) u.uRange.value = range;
    if (blur !== undefined) u.uBlur.value = blur;
    if (falloff !== undefined) u.uFalloff.value = falloff;
  }

  /** Full-screen flash that decays. */
  flash(color = 0xffffff, strength = 0.8, duration = 0.35) {
    const c = new THREE.Color(color);
    const u = this.gradePass.uniforms.uFlash;
    u.value.set(c.r, c.g, c.b, strength);
    return tweens.run(duration, (t) => { u.value.w = strength * (1 - t); }, ease.outQuad);
  }

  /** Fade to black (to=1) or back in (to=0). */
  fade(to = 1, duration = 0.5) {
    const u = this.gradePass.uniforms.uFade;
    const from = u.value;
    return tweens.run(duration, (t) => { u.value = from + (to - from) * t; }, ease.inOutQuad);
  }

  setDesaturate(v) { this.gradePass.uniforms.uDesat.value = v; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (this.camera && this.camera.isPerspectiveCamera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.tiltPass.uniforms.uResolution.value.set(size.x, size.y);
    setToonResolution(w, h, this.renderer.getPixelRatio());
    for (const fn of this.updaters) if (fn.onResize) fn.onResize(w, h);
  }

  /** Register fn(dt, elapsed); returns an unsubscribe function. */
  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  start() {
    let last = performance.now();
    let acc = 0, frames = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt; frames++;
      if (acc > 1) { this.fps = frames / acc; acc = 0; frames = 0; }
      if (this.paused) return;
      dt *= this.timeScale || 1;
      this.elapsed += dt;
      toonGlobals.time.value = this.elapsed;
      this.gradePass.uniforms.uTime.value = this.elapsed;
      tweens.update(dt);
      for (const fn of [...this.updaters]) fn(dt, this.elapsed);
      this.composer.render(dt);
    };
    requestAnimationFrame(loop);
  }
}
