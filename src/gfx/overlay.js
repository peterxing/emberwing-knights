// Tile highlight layers (move / attack / heal / danger / aoe), animated cursor and path arrow.
import * as THREE from 'three';

const LAYER_STYLE = {
  move: { color: 0x3c9dff, fill: 0.34, edge: 0.9, order: 1 },
  attack: { color: 0xff4040, fill: 0.3, edge: 0.85, order: 2 },
  heal: { color: 0x41e08a, fill: 0.3, edge: 0.85, order: 2 },
  danger: { color: 0xc23cff, fill: 0.18, edge: 0.55, order: 0 },
  target: { color: 0xffd24a, fill: 0.42, edge: 1.0, order: 4 },
  aoe: { color: 0xff8a2a, fill: 0.38, edge: 0.9, order: 3 },
  inspect: { color: 0xff6a6a, fill: 0.22, edge: 0.6, order: 1 },
  deploy: { color: 0x6fd0ff, fill: 0.26, edge: 0.7, order: 1 },
};

const tileVS = /* glsl */ `
  attribute float aPhase;
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    vUv = uv; vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }`;
const tileFS = /* glsl */ `
  uniform vec3 uColor; uniform float uTime, uFill, uEdge, uAlpha;
  varying vec2 vUv; varying float vPhase;
  float rbox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = vUv - 0.5;
    float d = rbox(p, vec2(0.46), 0.08);
    if (d > 0.0) discard;
    float edge = smoothstep(-0.07, -0.005, d);
    float pulse = 0.82 + 0.18 * sin(uTime * 3.2 + vPhase);
    float a = (uFill * pulse + edge * uEdge) * uAlpha;
    vec3 col = uColor * (1.0 + edge * 0.9);
    gl_FragColor = vec4(col, a);
  }`;

export class Overlay {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'overlay';
    scene.add(this.group);
    this.max = world.width * world.height;
    this.layers = new Map();
    this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const ph = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) ph[i] = (i % 7) * 0.9;
    this.geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    this.time = { value: 0 };
    this._m = new THREE.Matrix4();
    this._buildCursor();
    this._buildPath();
  }

  _layer(name) {
    if (this.layers.has(name)) return this.layers.get(name);
    const st = LAYER_STYLE[name] || LAYER_STYLE.move;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(st.color) }, uTime: this.time, uFill: { value: st.fill }, uEdge: { value: st.edge }, uAlpha: { value: 1 } },
      vertexShader: tileVS, fragmentShader: tileFS, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(this.geo, mat, this.max);
    mesh.count = 0;
    mesh.renderOrder = 10 + st.order;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.layers.set(name, mesh);
    return mesh;
  }

  /** tiles: iterable of {x,y} */
  setLayer(name, tiles, color) {
    const mesh = this._layer(name);
    if (color !== undefined) mesh.material.uniforms.uColor.value.set(color);
    let i = 0;
    for (const t of tiles) {
      if (i >= this.max) break;
      const y = this.world.tileTop(t.x, t.y) + 0.025 + (LAYER_STYLE[name]?.order || 0) * 0.004;
      this._m.makeTranslation(t.x + 0.5, y, t.y + 0.5);
      mesh.setMatrixAt(i++, this._m);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }

  clearLayer(name) { const m = this.layers.get(name); if (m) m.count = 0; }
  clearAll(except = []) { for (const [n, m] of this.layers) if (!except.includes(n)) m.count = 0; this.setPath(null); }

  _buildCursor() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.45), toneMapped: false, transparent: true, depthWrite: false });
    const bar = new THREE.BoxGeometry(0.26, 0.035, 0.05);
    for (let i = 0; i < 4; i++) {
      const corner = new THREE.Group();
      const a = new THREE.Mesh(bar, mat); a.position.set(0.12, 0, 0);
      const b = new THREE.Mesh(bar, mat); b.rotation.y = Math.PI / 2; b.position.set(0, 0, 0.12);
      corner.add(a, b);
      corner.rotation.y = -i * Math.PI / 2;
      const cx = [-1, 1, 1, -1][i] * 0.47, cz = [-1, -1, 1, 1][i] * 0.47;
      corner.position.set(cx, 0, cz);
      corner.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][i];
      g.add(corner);
    }
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 4).rotateX(Math.PI), mat);
    arrow.position.y = 1.55;
    g.add(arrow);
    g.renderOrder = 30;
    g.traverse((o) => { o.renderOrder = 30; });
    g.visible = false;
    this.cursor = g;
    this.cursorArrow = arrow;
    this.cursorMat = mat;
    this.group.add(g);
    this.cursorTile = null;
    this.cursorPos = new THREE.Vector3();
  }

  setCursor(t, color) {
    this.cursorTile = t;
    this.cursor.visible = !!t;
    if (!t) return;
    if (color !== undefined) this.cursorMat.color.set(color).multiplyScalar(1.5);
    const y = this.world.tileTop(t.x, t.y) + 0.04;
    this.cursorPos.set(t.x + 0.5, y, t.y + 0.5);
    if (!this._cursorInit) { this.cursor.position.copy(this.cursorPos); this._cursorInit = true; }
  }

  _buildPath() {
    this.pathMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.35, 0.8), toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
    const dot = new THREE.CylinderGeometry(0.075, 0.075, 0.02, 12);
    this.pathDots = new THREE.InstancedMesh(dot, this.pathMat, 64);
    this.pathDots.count = 0;
    this.pathDots.renderOrder = 25;
    this.pathDots.frustumCulled = false;
    const head = new THREE.ConeGeometry(0.2, 0.36, 3).rotateX(Math.PI / 2);
    this.pathHead = new THREE.Mesh(head, this.pathMat);
    this.pathHead.visible = false;
    this.pathHead.renderOrder = 25;
    this.group.add(this.pathDots, this.pathHead);
  }

  /** path: array of {x,y} from start to destination (or null) */
  setPath(path) {
    if (!path || path.length < 2) { this.pathDots.count = 0; this.pathHead.visible = false; return; }
    let n = 0;
    const m = this._m;
    for (let i = 0; i < path.length - 1 && n < 60; i++) {
      const a = path[i], b = path[i + 1];
      const ya = this.world.tileTop(a.x, a.y), yb = this.world.tileTop(b.x, b.y);
      for (let s = 0; s < 3; s++) {
        const t = (s + (i === 0 ? 1 : 0.5)) / 3;
        if (i === 0 && s === 2) continue;
        m.makeTranslation(a.x + 0.5 + (b.x - a.x) * t, Math.max(ya, yb) + 0.06, a.y + 0.5 + (b.y - a.y) * t);
        this.pathDots.setMatrixAt(n++, m);
      }
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
    const end = path[path.length - 1], prev = path[path.length - 2];
    this.pathHead.position.set(end.x + 0.5, this.world.tileTop(end.x, end.y) + 0.12, end.y + 0.5);
    this.pathHead.rotation.set(0, Math.atan2(end.x - prev.x, end.y - prev.y), 0);
    this.pathHead.visible = true;
  }

  update(dt, elapsed) {
    this.time.value = elapsed;
    if (this.cursor.visible) {
      this.cursor.position.lerp(this.cursorPos, 1 - Math.exp(-dt * 18));
      this.cursorArrow.position.y = 1.5 + Math.sin(elapsed * 4) * 0.08;
      this.cursorArrow.rotation.y += dt * 2;
      const s = 1 + Math.sin(elapsed * 5) * 0.03;
      this.cursor.scale.set(s, 1, s);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  }
}
