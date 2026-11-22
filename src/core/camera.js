// Orbiting tactics camera with smoothing, 90° rotation steps, zoom, pan, shake and scripted moves.
import * as THREE from 'three';
import { clamp, tweens, ease } from './util.js';

const tmp = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.yaw = Math.PI / 4;
    this.goalYaw = this.yaw;
    this.pitch = 0.92;
    this.goalPitch = this.pitch;
    this.dist = 20;
    this.goalDist = this.dist;
    this.minDist = 7;
    this.maxDist = 36;
    this.bounds = null;
    this.shakeMag = 0;
    this.shakeT = 0;
    this.stiffness = 6;
    this.scripted = false;
  }

  setBounds(box) { this.bounds = box ? box.clone() : null; }

  /** Point the camera at world position `v`. opts: dist, yaw, pitch, instant */
  focus(v, opts = {}) {
    this.goal.copy(v);
    if (opts.dist !== undefined) this.goalDist = clamp(opts.dist, this.minDist, this.maxDist);
    if (opts.yaw !== undefined) this.goalYaw = this.nearestAngle(opts.yaw);
    if (opts.pitch !== undefined) this.goalPitch = opts.pitch;
    this.clampGoal();
    if (opts.instant) this.snap();
  }

  nearestAngle(a) {
    const twoPi = Math.PI * 2;
    let d = (a - this.goalYaw) % twoPi;
    if (d > Math.PI) d -= twoPi;
    if (d < -Math.PI) d += twoPi;
    return this.goalYaw + d;
  }

  snap() {
    this.target.copy(this.goal);
    this.yaw = this.goalYaw; this.pitch = this.goalPitch; this.dist = this.goalDist;
    this.apply(0);
  }

  clampGoal() {
    if (!this.bounds) return;
    this.goal.x = clamp(this.goal.x, this.bounds.min.x, this.bounds.max.x);
    this.goal.z = clamp(this.goal.z, this.bounds.min.z, this.bounds.max.z);
  }

  /** Pan in screen-aligned ground directions (units ~ tiles). */
  pan(dx, dz) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.goal.x += c * dx + s * dz;
    this.goal.z += -s * dx + c * dz;
    this.clampGoal();
  }

  rotateStep(dir) { this.goalYaw += dir * Math.PI / 2; }
  rotate(d) { this.goalYaw += d; }
  tilt(d) { this.goalPitch = clamp(this.goalPitch + d, 0.45, 1.35); }
  zoom(f) { this.goalDist = clamp(this.goalDist * f, this.minDist, this.maxDist); }

  shake(mag = 0.3, dur = 0.35) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
    this.shakeDur = Math.max(this.shakeDur || 0, dur);
  }

  /** Screen-space direction helpers for input mapping. */
  groundRight(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /** Smoothly move along a scripted path (used in intros). */
  async glide(to, { dist, yaw, pitch, duration = 1.6 } = {}) {
    const from = this.goal.clone();
    const d0 = this.goalDist, y0 = this.goalYaw, p0 = this.goalPitch;
    const y1 = yaw !== undefined ? this.nearestAngle(yaw) : y0;
    await tweens.run(duration, (t) => {
      this.goal.lerpVectors(from, to, t);
      if (dist !== undefined) this.goalDist = d0 + (dist - d0) * t;
      this.goalYaw = y0 + (y1 - y0) * t;
      if (pitch !== undefined) this.goalPitch = p0 + (pitch - p0) * t;
    }, ease.inOutCubic);
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * this.stiffness);
    this.target.lerp(this.goal, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.dist += (this.goalDist - this.dist) * k;
    this.apply(dt);
  }

  apply(dt) {
    const cp = Math.cos(this.pitch);
    tmp.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    this.camera.position.copy(this.target).add(tmp);
    if (this.shakeT > 0 && dt > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT / (this.shakeDur || 0.3));
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
      this.camera.position.z += (Math.random() - 0.5) * m;
      if (this.shakeT <= 0) { this.shakeMag = 0; this.shakeDur = 0; }
    }
    this.camera.lookAt(this.target);
  }
}
