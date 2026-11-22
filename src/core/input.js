// Pointer/keyboard/touch input for the tactics map: hover & click tiles, drag-pan, right-drag rotate, wheel/pinch zoom.
import * as THREE from 'three';

export class MapInput {
  /**
   * handlers: { onHover(tile|null, ev), onClick(tile|null, ev), onCancel(ev), onKey(ev) }
   * pick(raycaster) -> {x,y}|null
   */
  constructor(canvas, rig, pick, handlers = {}) {
    this.canvas = canvas;
    this.rig = rig;
    this.pick = pick;
    this.h = handlers;
    this.enabled = true;
    this.cameraEnabled = true;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pointers = new Map();
    this.drag = null;
    this.lastTile = null;
    this.keys = new Set();
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    this._down = (e) => this.down(e);
    this._move = (e) => this.move(e);
    this._up = (e) => this.up(e);
    this._wheel = (e) => this.wheel(e);
    this._ctx = (e) => e.preventDefault();
    this._kd = (e) => this.keydown(e);
    this._ku = (e) => this.keys.delete(e.key.toLowerCase());
    c.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
    c.addEventListener('wheel', this._wheel, { passive: false });
    c.addEventListener('contextmenu', this._ctx);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
    c.removeEventListener('wheel', this._wheel);
    c.removeEventListener('contextmenu', this._ctx);
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
  }

  tileAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.rig.camera);
    return this.pick(this.ray);
  }

  down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    this.drag = { moved: false, button: e.button };
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7 && this.drag) this.drag.moved = true;
      if (this.cameraEnabled && this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (this.pinch.d > 0) this.rig.zoom(this.pinch.d / d);
        this.rig.rotate(-(ang - this.pinch.ang));
        this.pinch = { d, ang };
        return;
      }
      if (this.cameraEnabled && this.drag && this.drag.moved) {
        const scale = this.rig.dist / 900;
        if (p.button === 2 || p.button === 1) {
          this.rig.rotate(-dx * 0.006);
          this.rig.tilt(dy * 0.004);
        } else {
          this.rig.pan(-dx * scale * 1.6, -dy * scale * 2.2);
        }
      }
      return;
    }
    if (!this.enabled || e.target !== this.canvas) return;
    const t = this.tileAt(e.clientX, e.clientY);
    const same = t && this.lastTile && t.x === this.lastTile.x && t.y === this.lastTile.y;
    if (!same) { this.lastTile = t; this.h.onHover?.(t, e); }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;
    const wasDrag = this.drag && this.drag.moved;
    if (this.pointers.size === 0) this.drag = null;
    if (wasDrag || !this.enabled) return;
    if (p.button === 2) { this.h.onCancel?.(e); return; }
    if (p.button !== 0) return;
    const t = this.tileAt(e.clientX, e.clientY);
    this.lastTile = t;
    if (p.type !== 'mouse') this.h.onHover?.(t, e);
    this.h.onClick?.(t, e);
  }

  wheel(e) {
    e.preventDefault();
    if (!this.cameraEnabled) return;
    this.rig.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  }

  keydown(e) {
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (this.cameraEnabled) {
      if (k === 'q') this.rig.rotateStep(-1);
      if (k === 'e') this.rig.rotateStep(1);
      if (k === '=' || k === '+') this.rig.zoom(1 / 1.15);
      if (k === '-' || k === '_') this.rig.zoom(1.15);
    }
    this.h.onKey?.(e);
  }

  /** Continuous WASD panning; call each frame. */
  update(dt) {
    if (!this.cameraEnabled) return;
    const s = this.rig.dist * 0.9 * dt;
    let dx = 0, dz = 0;
    if (this.keys.has('a')) dx -= s;
    if (this.keys.has('d')) dx += s;
    if (this.keys.has('w')) dz -= s;
    if (this.keys.has('s')) dz += s;
    if (dx || dz) this.rig.pan(dx, dz);
  }
}
