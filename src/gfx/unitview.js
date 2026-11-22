// On-map representation of a Unit: animated character model, team ring, HP bar and path movement.
import * as THREE from 'three';
import { createCharacter } from './characters.js';
import { tweens, ease, wait } from '../core/util.js';

const TEAM_COLOR = { player: 0x46b4ff, enemy: 0xff4d4d, ally: 0x5be08c };
const BOSS_COLOR = 0xffc23d;

let ringGeo = null;
let glowTex = null;
function sharedRing() {
  if (!ringGeo) ringGeo = new THREE.RingGeometry(0.34, 0.42, 48).rotateX(-Math.PI / 2);
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  return { ringGeo, glowTex };
}

export class UnitView {
  constructor(unit, world, scene, opts = {}) {
    this.unit = unit;
    this.world = world;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = `unit-${unit.id}`;
    this.quality = opts.quality || 'high';
    this.char = createCharacter(unit.look, { team: unit.side, quality: this.quality });
    this.root.add(this.char.root);
    const { ringGeo: rg, glowTex: gt } = sharedRing();
    const col = new THREE.Color(unit.boss ? BOSS_COLOR : TEAM_COLOR[unit.side] || 0xffffff);
    this.ringMat = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.position.y = 0.03;
    this.ring.renderOrder = 8;
    this.glowMat = new THREE.MeshBasicMaterial({ map: gt, color: col, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05).rotateX(-Math.PI / 2), this.glowMat);
    this.glow.position.y = 0.025;
    this.glow.renderOrder = 7;
    const ringScale = unit.big ? 2.4 : 1;
    this.ring.scale.setScalar(ringScale);
    this.glow.scale.setScalar(ringScale);
    this.root.add(this.ring, this.glow);
    this._buildHpBar(col);
    scene.add(this.root);
    this.selected = false;
    this.greyed = false;
    this.placeAt(unit.x, unit.y);
    this.char.setFacing(unit.side === 'player' ? Math.PI : 0, true);
    if (unit.flying) this.char.setState('fly');
  }

  _buildHpBar(col) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 20;
    this.hpCanvas = c;
    this.hpTex = new THREE.CanvasTexture(c);
    this.hpTex.colorSpace = THREE.SRGBColorSpace;
    this.hpColor = '#' + col.getHexString();
    const mat = new THREE.SpriteMaterial({ map: this.hpTex, depthTest: false, depthWrite: false, toneMapped: false, transparent: true });
    this.hpSprite = new THREE.Sprite(mat);
    this.hpSprite.scale.set(0.62, 0.097, 1);
    this.hpSprite.renderOrder = 40;
    this.root.add(this.hpSprite);
    this.refreshHp();
  }

  refreshHp(hp = this.unit.hp) {
    const g = this.hpCanvas.getContext('2d');
    const w = 128, h = 20;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(10,8,20,0.85)';
    g.beginPath(); g.roundRect(0, 0, w, h, 6); g.fill();
    const r = Math.max(0, Math.min(1, hp / this.unit.maxHp));
    const grd = g.createLinearGradient(0, 0, 0, h);
    const base = r > 0.5 ? this.hpColor : r > 0.25 ? '#ffc84a' : '#ff5a4a';
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, base); grd.addColorStop(1, base);
    g.fillStyle = grd;
    g.beginPath(); g.roundRect(3, 3, (w - 6) * r, h - 6, 4); g.fill();
    g.strokeStyle = 'rgba(255,240,210,0.8)'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, 6); g.stroke();
    this.hpTex.needsUpdate = true;
    this.hpSprite.position.y = (this.char.height || 1) + 0.28;
    if (this.unit.hpRatio < 0.3 && this.unit.alive) this.char.setState?.(this.unit.flying ? 'fly' : 'hurt');
  }

  /** Animate the HP bar between two values. */
  animateHp(from, to, dur = 0.5) {
    return tweens.run(dur, (t) => this.refreshHp(from + (to - from) * t), ease.outCubic);
  }

  worldPos(x, y, out = new THREE.Vector3()) { return this.world.tileCenter(x, y, out); }

  placeAt(x, y) {
    this.worldPos(x, y, this.root.position);
    if (this.unit.flying) this.root.position.y = Math.max(this.root.position.y, this.world.tileTop(x, y));
  }

  faceTile(x, y, immediate = false) {
    const p = this.worldPos(x, y);
    this.char.faceTowards(p, immediate);
  }

  setGreyed(on) {
    if (this.greyed === on) return;
    this.greyed = on;
    this.char.setGreyed(on);
    this.ringMat.opacity = on ? 0.3 : 0.85;
    this.glowMat.opacity = on ? 0.15 : 0.55;
  }

  setSelected(on) { this.selected = on; }
  setVisible(on) { this.root.visible = on; }
  setHpVisible(on) { this.hpSprite.visible = on; }

  /** Walk along a path of tiles. */
  async moveAlong(path, { speed = 1, onStep } = {}) {
    if (!path || path.length < 2) return;
    const fly = this.unit.flying;
    this.char.setState(fly ? 'fly' : 'run');
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 1; i < path.length; i++) {
      const p0 = path[i - 1], p1 = path[i];
      this.worldPos(p0.x, p0.y, a);
      this.worldPos(p1.x, p1.y, b);
      if (fly) { a.y = Math.max(a.y, 0.4); b.y = Math.max(b.y, 0.4); }
      this.char.faceTowards(b);
      const dh = b.y - a.y;
      const hop = Math.abs(dh) > 0.05 && !fly ? 0.25 + Math.abs(dh) * 0.5 : 0;
      const dur = (0.17 + (hop ? 0.08 : 0)) / speed;
      await tweens.run(dur, (t) => {
        this.root.position.lerpVectors(a, b, t);
        if (hop) this.root.position.y += Math.sin(t * Math.PI) * hop;
      }, ease.linear);
      onStep?.(p1, i);
    }
    this.char.setState(fly ? 'fly' : (this.unit.hpRatio < 0.3 ? 'hurt' : 'idle'));
  }

  /** Short forward lunge toward a tile (map-mode attacks). */
  async lunge(x, y, onImpact) {
    const start = this.root.position.clone();
    const dest = this.worldPos(x, y);
    dest.y = start.y;
    this.char.faceTowards(dest);
    const mid = start.clone().lerp(dest, 0.38);
    let fired = false;
    const p = this.char.play('attack', { onImpact: () => { fired = true; onImpact?.(); } });
    await tweens.run(0.16, (t) => this.root.position.lerpVectors(start, mid, t), ease.outQuad);
    await p;
    if (!fired) onImpact?.();
    await tweens.run(0.18, (t) => this.root.position.lerpVectors(mid, start, t), ease.inOutQuad);
  }

  async die() {
    this.hpSprite.visible = false;
    await this.char.play('death');
    await tweens.run(0.9, (t) => {
      this.char.setDissolve(t);
      this.ringMat.opacity = 0.85 * (1 - t);
      this.glowMat.opacity = 0.55 * (1 - t);
    }, ease.inQuad);
    this.root.visible = false;
  }

  /** Swap the model (e.g. after promotion). */
  rebuild() {
    const facing = this.char.facing;
    this.root.remove(this.char.root);
    this.char.dispose();
    this.char = createCharacter(this.unit.look, { team: this.unit.side, quality: this.quality });
    this.char.setFacing(facing, true);
    this.root.add(this.char.root);
    if (this.unit.flying) this.char.setState('fly');
    this.refreshHp();
  }

  update(dt, elapsed) {
    this.char.update(dt);
    const s = this.selected ? 1.12 + Math.sin(elapsed * 6) * 0.06 : 1;
    const base = this.unit.big ? 2.4 : 1;
    this.ring.scale.setScalar(base * s);
    this.ring.rotation.y += dt * (this.selected ? 1.6 : 0.3);
  }

  dispose() {
    this.scene.remove(this.root);
    this.char.dispose();
    this.hpTex.dispose();
    this.hpSprite.material.dispose();
    this.ringMat.dispose();
    this.glowMat.dispose();
    this.glow.geometry.dispose();
  }
}

export { wait };
