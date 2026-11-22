import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as rules from './rules.js';

const COLS = 7, ROWS = 4;
const CELLS = Array.from({ length: COLS * ROWS }, (_, i) => ({ x: i % COLS, y: Math.floor(i / COLS) }));
const wx = x => x - 3;
const wz = y => y - 1.5;
const cell = p => p && Number.isInteger(p.x) && p.x >= 0 && p.x < COLS &&
  Number.isInteger(p.y) && p.y >= 0 && p.y < ROWS;
const ACTORS = {
  iria: { file: 'IriaVale.glb', scale: .74, yaw: .22, idle: 'Iria Vale | Breathing Idle', cue: 'Iria Vale | Signal Raise' },
  drake: { file: 'VesperglassDrake.glb', scale: .46, yaw: -.30, idle: 'VD.Idle - Lantern Breathing', cue: 'VD.Greeting - Rosewindow Flare' },
};
const ease = t => t * t * (3 - 2 * t);
const turn = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// A matte sounding chart under the model, not another layer of playable tiles.
function makeSea(y) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(180, 180).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 water;
      void main() {
        water = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: `
      varying vec2 water;
      void main() {
        vec2 q = water * vec2(.78, 1.);
        vec2 light = q + vec2(1.8, 2.2);
        float shoal = exp(-.045 * dot(light, light));
        vec3 ink = mix(vec3(.009,.023,.041), vec3(.046,.153,.165), shoal);
        float r = length(q);
        float swell = water.y + .19 * sin(water.x * 1.12) + .13 * sin(water.x * .68 + water.y * .7);
        float lines = abs(fract(swell * 2.7) - .5);
        float trace = 1. - smoothstep(.016, .016 + fwidth(swell) * 2.7, lines);
        ink += vec3(.009,.026,.024) * trace * shoal * (.5 + .5 * sin(water.x + swell));
        float arc = min(abs(r - 4.35), abs(r - 4.49));
        float ruling = 1. - smoothstep(.010, .010 + fwidth(r), arc);
        ink += vec3(.075,.09,.061) * ruling * (.48 + .45 * cos(atan(q.y, q.x) * 3.));
        gl_FragColor = vec4(ink, 1.);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  }));
  mesh.position.y = y;
  return mesh;
}

function lightStudio(scene, renderer) {
  scene.add(new THREE.HemisphereLight(0xe4f5ff, 0x99a29a, 1.65));
  const key = new THREE.DirectionalLight(0xffe3bd, 2.55);
  key.position.set(-4.2, 8.5, 5);
  key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 5.5, bottom: -5.5, near: .2, far: 22 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .012;
  key.shadow.intensity = .67;
  const rim = new THREE.DirectionalLight(0xa7e4ff, 1.8);
  rim.position.set(3.3, 4.6, -5.2);
  scene.add(key, rim);

  // Give the brass and glass broad reflections without downloading an HDRI.
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) return;
  const w = 128, h = 64, pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const lat = ((y + .5) / h - .5) * Math.PI, up = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + .5) / w - .5) * Math.PI * 2;
      const dx = Math.cos(lat) * Math.cos(lon), dz = Math.cos(lat) * Math.sin(lon);
      const box = Math.max(0, -.63 * dx + .63 * up + .45 * dz) ** 10;
      const sky = .5 + .5 * up, i = 4 * (y * w + x);
      pixels[i] = Math.min(255, 19 + 92 * sky + 161 * box);
      pixels[i + 1] = Math.min(255, 25 + 122 * sky + 110 * box);
      pixels[i + 2] = Math.min(255, 34 + 154 * sky + 61 * box);
      pixels[i + 3] = 255;
    }
  }
  const sky = new THREE.DataTexture(pixels, w, h);
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.colorSpace = THREE.LinearSRGBColorSpace;
  sky.magFilter = sky.minFilter = THREE.LinearFilter;
  sky.needsUpdate = true;
  scene.environment = sky;
  scene.environmentIntensity = .8;
}

function drawInk(kind, anisotropy) {
  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = 256;
  const p = sheet.getContext('2d');
  if (!p) throw new Error('The Tideglass stage could not draw its survey markings.');
  p.scale(2.56, 2.56);
  p.lineJoin = p.lineCap = 'round';
  const line = (color, width, points) => {
    p.beginPath();
    points.forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y));
    p.strokeStyle = color; p.lineWidth = width; p.stroke();
  };
  const arc = (radius, color, width, start = 0, end = 2 * Math.PI) => {
    p.beginPath(); p.arc(50, 50, radius, start, end);
    p.strokeStyle = color; p.lineWidth = width; p.stroke();
  };
  if (kind === 'grid') {
    p.strokeStyle = '#a9cec254'; p.lineWidth = 1.1; p.strokeRect(1.5, 1.5, 97, 97);
  } else if (kind === 'route') {
    const rim = [[10, 17], [17, 10], [83, 10], [90, 17], [90, 83], [83, 90], [17, 90], [10, 83], [10, 17]];
    line('#173e47c9', 3.4, rim); p.fillStyle = '#55e6c329'; p.fill();
    line('#94ffe0e6', 1.8, rim);
    const diamond = [[50, 42], [58, 50], [50, 58], [42, 50], [50, 42]];
    line('#17414a', 5.5, diamond); line('#b2ffe6', 2.6, diamond);
  } else if (kind === 'tide') {
    const wash = p.createLinearGradient(0, 8, 0, 95);
    wash.addColorStop(0, '#fc987300'); wash.addColorStop(1, '#ff7f6761');
    p.fillStyle = wash; p.fillRect(4, 4, 92, 92);
    for (const h of [71, 79]) {
      p.beginPath(); p.moveTo(14, h);
      for (let i = 0; i < 3; i++) p.bezierCurveTo(22 + i * 24, h - 10, 29 + i * 24, h + 10, 38 + i * 24, h);
      p.strokeStyle = '#5c3139'; p.lineWidth = 5; p.stroke();
      p.strokeStyle = '#ffae8b'; p.lineWidth = 2.8; p.stroke();
    }
  } else if (kind === 'ward') {
    const shield = [[62, 18], [83, 18], [82, 30], [73, 38], [64, 30], [62, 18]];
    line('#273c60', 4.5, shield); p.fillStyle = '#505888'; p.fill();
    line('#d5d2ff', 2.4, shield); line('#e1e4ff', 2, [[68, 25], [72, 29], [77, 23]]);
  } else if (kind === 'reading') {
    const seal = [[26, 13], [36, 23], [26, 33], [16, 23], [26, 13]];
    line('#483e37', 4, seal); p.fillStyle = '#715334'; p.fill();
    line('#f9d693', 2, seal); line('#fff1ce', 2.5, [[21, 23], [25, 27], [31, 19]]);
  } else if (kind === 'focus') {
    for (let i = 0; i < 4; i++) {
      const angle = [[4, 24], [4, 8], [8, 4], [24, 4]];
      line('#243944', 6, angle); line('#fff1c4', 3, angle);
      p.translate(100, 0); p.rotate(Math.PI / 2);
    }
  } else if (kind === 'shadow') {
    const g = p.createRadialGradient(50, 50, 4, 50, 50, 48);
    g.addColorStop(0, '#12242c83'); g.addColorStop(.54, '#132a353f'); g.addColorStop(1, '#172b3200');
    p.fillStyle = g; p.fillRect(0, 0, 100, 100);
  } else if (kind === 'seal') {
    arc(43, '#283b47dc', 6);
    for (let i = 0; i < 4; i++) {
      arc(43, '#ffdb91', 2.7, .12, Math.PI / 2 - .12);
      line('#fff0c2', 2.7, [[50, 2], [50, 10]]);
      p.translate(100, 0); p.rotate(Math.PI / 2);
    }
  }
  const map = new THREE.CanvasTexture(sheet);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
}

function deckHeight(court) {
  court.updateMatrixWorld(true);
  const cast = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, .85);
  const heights = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    cast.ray.origin.set(wx(x) + .16, .45, wz(y) + .17);
    const hit = cast.intersectObject(court)[0];
    if (hit) heights.push(hit.point.y);
  }
  return heights.sort((a, b) => a - b)[Math.floor(heights.length * .65)] ?? 0;
}

function makeBoard(scene, deck, plane, ink) {
  function layer(kind, order) {
    const mesh = new THREE.InstancedMesh(plane, ink(kind), COLS * ROWS);
    mesh.count = 0; mesh.renderOrder = -10 + order; mesh.frustumCulled = false;
    scene.add(mesh);
    const matrix = new THREE.Matrix4();
    return cells => {
      let n = 0;
      for (const pos of cells) {
        if (!cell(pos) || n === COLS * ROWS) continue;
        matrix.makeTranslation(wx(pos.x), deck + .013 + order * .003, wz(pos.y));
        mesh.setMatrixAt(n++, matrix);
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    };
  }
  const grid = layer('grid', 0);
  grid(CELLS);
  return { routes: layer('route', 1), danger: layer('tide', 2), wards: layer('ward', 3),
    readings: layer('reading', 3), focus: layer('focus', 4) };
}

function performer(gltf, idleName, cueName) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  function action(name) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) throw new Error(`The Tideglass model is missing its “${name}” animation.`);
    return mixer.clipAction(clip);
  }
  const idle = idleName && action(idleName), cue = action(cueName);
  cue.setLoop(THREE.LoopOnce, 1);
  cue.clampWhenFinished = true;
  function reset() {
    mixer.stopAllAction();
    if (idle) idle.reset().play();
    mixer.update(0);
  }
  reset();
  return {
    mixer, cue, reset,
    celebrate(instant) {
      cue.reset().play();
      if (idle && !instant) idle.crossFadeTo(cue, .16, false);
      else if (idle) idle.stop();
      mixer.update(instant ? cue.getClip().duration : 0);
    },
  };
}

function makeActor(scene, gltf, spec, deck, plane, ink) {
  const root = new THREE.Group(), gesture = new THREE.Group(), mount = new THREE.Group();
  mount.scale.setScalar(spec.scale); mount.add(gltf.scene); gesture.add(mount); root.add(gesture); scene.add(root);
  const bounds = new THREE.Box3().setFromObject(mount);
  mount.position.y = -bounds.min.y;
  gesture.rotation.y = spec.yaw;
  const shadow = new THREE.Mesh(plane, ink('shadow')), seal = new THREE.Mesh(plane, ink('seal'));
  shadow.position.y = .023; shadow.renderOrder = -5;
  seal.position.y = .029; seal.renderOrder = -4;
  root.add(shadow, seal); root.position.y = deck; root.visible = false;
  return { root, gesture, seal, bounds, spec, cell: null, move: null, pose: performer(gltf, spec.idle, spec.cue) };
}

function locate(actor, pos, snap) {
  if (actor.cell?.x === pos.x && actor.cell?.y === pos.y && !snap) return;
  const { root, gesture, spec } = actor, x = wx(pos.x), z = wz(pos.y);
  if (!actor.cell || snap) {
    root.position.x = x; root.position.z = z;
    gesture.position.y = 0; gesture.rotation.set(0, spec.yaw, 0);
    actor.move = null;
  } else {
    const dx = x - root.position.x, dz = z - root.position.z;
    actor.move = { x: root.position.x, z: root.position.z, dx, dz, yaw: gesture.rotation.y,
      heading: Math.atan2(dx, dz), age: 0, duration: Math.min(.65, .23 + .10 * Math.hypot(dx, dz)) };
  }
  actor.cell = { x: pos.x, y: pos.y };
  root.visible = true;
}

function advance(actor, dt) {
  const m = actor.move;
  if (!m) return;
  const t = Math.min(1, (m.age += dt) / m.duration), k = ease(t), lift = Math.sin(t * Math.PI);
  const { root, gesture, spec } = actor;
  root.position.x = m.x + m.dx * k; root.position.z = m.z + m.dz * k;
  gesture.position.y = spec === ACTORS.drake ? .14 * lift : .060 * Math.abs(Math.sin(t * Math.PI * 2));
  const yaw = m.yaw + turn(m.yaw, m.heading) * ease(Math.min(1, 3 * t));
  gesture.rotation.y = yaw + turn(yaw, spec.yaw) * ease(Math.max(0, (t - .58) / .42));
  gesture.rotation.x = .075 * lift;
  if (t === 1) actor.move = null;
}

// Fit in camera space, including the pennant and an actor standing on ANY edge tile.
// The resulting composition doesn't shift when a unit moves or the lock opens.
function framing(camera, scenery, actors, deck) {
  camera.position.set(3.7, 10.5, 12);
  camera.lookAt(0, .3, 0); camera.updateMatrixWorld();
  const frame = new THREE.Box2(), v = new THREE.Vector3(), p = new THREE.Vector2();
  const axis = camera.matrixWorldInverse.elements, floorY = Math.hypot(axis[1], axis[9]);
  function include(x, y) { frame.expandByPoint(p.set(x, y)); }
  for (const group of scenery) {
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        v.set(x, y, z).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        include(v.x, v.y);
      }
    });
  }
  for (const { bounds: b } of actors) {
    const radius = Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.z, b.max.z));
    for (const x of [-3, 3]) for (const z of [-1.5, 1.5]) {
      v.set(x, deck, z).applyMatrix4(camera.matrixWorldInverse);
      include(v.x - radius, v.y - radius * floorY);
      include(v.x + radius, v.y + (b.max.y - b.min.y + .32) * axis[5] + radius * floorY);
    }
  }
  return frame;
}

function release(root) {
  const resources = new Set(), images = new Set();
  root.traverse(o => {
    if (o.geometry) resources.add(o.geometry);
    if (o.isInstancedMesh) resources.add(o);
    if (o.skeleton) resources.add(o.skeleton);
    if (o.shadow) o.shadow.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const tex of Object.values(m)) if (tex?.isTexture) {
        resources.add(tex);
        if (tex.source?.data?.close) images.add(tex.source.data);
      }
      resources.add(m);
    }
  });
  root.environment?.dispose();
  for (const r of resources) r.dispose();
  for (const image of images) image.close();
}

export async function createStage(container, { onCell, reducedMotion = false, assetRoot = new URL('./models/', document.baseURI) } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('aria-label', 'Tideglass Signal Court tactical diorama');
  canvas.title = 'Tideglass Signal Court';
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'manipulation' });
  const manager = new THREE.LoadingManager(), scene = new THREE.Scene(), listeners = new AbortController();
  const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, .1, 120);
  let gl, renderer, resizer, observer, disposed = false, raf = 0, lastTime = null;
  let onScreen = true, contextLost = false, width = 0, height = 0, phase = null, round = 0;
  let actors = [], poses = [];
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = null; };
  function dispose() {
    if (disposed) return;
    disposed = true; stop(); listeners.abort(); observer?.disconnect(); resizer?.disconnect(); manager.abort();
    for (const { mixer } of poses) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    release(scene); scene.clear(); renderer?.dispose();
    if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
  }
  try {
    // Probe only once. Three's default constructor retries and logs to the console on a disabled GPU.
    try { gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, powerPreference: 'default' }); }
    catch (cause) { throw new Error('The browser could not start WebGL 2 for the Tideglass diorama.', { cause }); }
    if (!gl || gl.isContextLost()) throw new Error('The Tideglass diorama needs WebGL 2, which is unavailable in this browser.');
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.transmissionResolutionScale = .5;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.background = new THREE.Color(0x192e3c);
    const loader = new GLTFLoader(manager), base = new URL(assetRoot, document.baseURI);
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    async function load(file) {
      let asset;
      try { asset = await loader.loadAsync(new URL(file, base).href); }
      catch (cause) { throw new Error(`Could not load the Tideglass model ${file}.`, { cause }); }
      if (disposed) { release(asset.scene); return asset; }
      scene.add(asset.scene); // Owned immediately, even if another parallel request fails.
      asset.scene.traverse(o => {
        if (!o.isMesh) return;
        o.receiveShadow = true;
        o.castShadow = ![].concat(o.material).every(m => m.transparent || m.transmission > 0);
      });
      return asset;
    }
    const [court, lock, iria, drake] = await Promise.all([
      load('SignalCourt.glb'), load('TideLock.glb'), load(ACTORS.iria.file), load(ACTORS.drake.file),
    ]);
    if (gl.isContextLost()) throw new Error('The graphics context was lost while loading the Tideglass diorama.');
    const deck = deckHeight(court.scene);
    lightStudio(scene, renderer);
    const sea = makeSea(Math.min(-.35, new THREE.Box3().setFromObject(court.scene).min.y - .06));
    const castShadow = new THREE.Mesh(sea.geometry, new THREE.ShadowMaterial({ opacity: .27, depthWrite: false }));
    castShadow.position.y = sea.position.y + .002; castShadow.receiveShadow = true; castShadow.renderOrder = -12;
    scene.add(sea, castShadow);
    lock.scene.position.set(-3, deck, .5);
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), inks = new Map();
    const ink = kind => {
      if (!inks.has(kind)) inks.set(kind, drawInk(kind, Math.min(8, renderer.capabilities.getMaxAnisotropy())));
      return inks.get(kind);
    };
    const board = makeBoard(scene, deck, plane, ink);
    actors = [makeActor(scene, iria, ACTORS.iria, deck, plane, ink), makeActor(scene, drake, ACTORS.drake, deck, plane, ink)];
    poses = [...actors.map(a => a.pose), performer(lock, null, 'TideLock | Unseal')];
    const frame = framing(camera, [court.scene, lock.scene], actors, deck);
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    if (gl.isContextLost()) throw new Error('The graphics context was lost while preparing the Tideglass diorama.');
    const canDraw = () => !disposed && !contextLost && onScreen && !document.hidden && width > 0 && height > 0;
    let dirty = true;
    function requestDraw(invalidate = true) {
      if (invalidate) dirty = true;
      if (!raf && canDraw()) raf = requestAnimationFrame(draw);
    }
    function draw(now) {
      raf = 0;
      if (!canDraw()) return;
      const dt = lastTime === null ? 0 : (now - lastTime) / 1000;
      if (!dirty && phase === 'playing' && !actors.some(a => a.move) && dt < .032) {
        requestDraw(false); return; // Idle breaths don't need a 120 Hz shadow pass.
      }
      dirty = false;
      lastTime = now;
      if (!reducedMotion) {
        for (const actor of actors) advance(actor, dt);
        if (phase === 'playing' || phase === 'won') for (const p of poses) p.mixer.update(dt);
      }
      renderer.render(scene, camera);
      if (!reducedMotion && (phase === 'playing' || actors.some(a => a.move) || poses.some(p => p.cue.isRunning()))) requestDraw(false);
      else lastTime = null;
    }
    function resize() {
      if (disposed || contextLost) return;
      const rect = canvas.getBoundingClientRect();
      width = Math.round(rect.width); height = Math.round(rect.height);
      if (!width || !height) { stop(); return; }
      const aspect = width / height, dx = frame.max.x - frame.min.x, dy = frame.max.y - frame.min.y;
      const h = Math.max(dy, dx / aspect) * .535;
      const cx = (frame.min.x + frame.max.x) / 2, cy = (frame.min.y + frame.max.y) / 2;
      camera.left = cx - h * aspect; camera.right = cx + h * aspect;
      camera.bottom = cy - h; camera.top = cy + h; camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, Math.sqrt(1800000 / (width * height))));
      renderer.setDrawingBufferSize(width, height, dpr);
      requestDraw();
    }
    function visibility() { if (canDraw()) requestDraw(); else stop(); }
    const listen = (target, type, fn) => target.addEventListener(type, fn, { passive: true, signal: listeners.signal });
    container.append(canvas);
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      resizer = new ResizeObserver(resize); resizer.observe(container);
    }
    listen(window, 'resize', resize);
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; visibility(); });
      observer.observe(canvas);
    }
    listen(document, 'visibilitychange', visibility);
    listen(canvas, 'webglcontextlost', () => { contextLost = true; stop(); });
    listen(canvas, 'webglcontextrestored', () => { contextLost = false; resize(); });

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -deck);
    let press = null, hover = null, focusCell = null;
    function pick(e) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      ndc.set(2 * (e.clientX - r.left) / r.width - 1, 1 - 2 * (e.clientY - r.top) / r.height);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(ground, hit)) return null;
      const p = { x: Math.floor(hit.x + 3.5), y: Math.floor(hit.z + 2) };
      return cell(p) ? p : null;
    }
    function showFocus() { board.focus([focusCell || hover]); requestDraw(); }
    function setHover(p) {
      if (p?.x === hover?.x && p?.y === hover?.y) return;
      hover = p; canvas.style.cursor = p && onCell ? 'pointer' : ''; showFocus();
    }
    listen(canvas, 'pointerdown', e => {
      press = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    });
    listen(canvas, 'pointermove', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press = null;
      if (e.pointerType === 'mouse' && !e.buttons) setHover(pick(e));
    });
    listen(canvas, 'pointerleave', () => { press = null; setHover(null); });
    listen(canvas, 'pointercancel', () => { press = null; setHover(null); });
    listen(canvas, 'pointerup', e => {
      const tap = press; press = null;
      if (!tap || tap.id !== e.pointerId || e.button !== 0 || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) return;
      const p = pick(e); if (p) onCell?.(p.x, p.y);
    });
    return {
      update(state, { moves = [], focus = null } = {}) {
        if (disposed) return;
        const reset = state.phase === 'playing' && (phase !== 'playing' || state.round < round);
        const instant = reducedMotion || !canDraw();
        if (reset) for (const p of poses) p.reset();
        if (state.phase === 'won' && phase !== 'won') for (const p of poses) p.celebrate(instant);
        phase = state.phase; round = state.round;
        for (const [i, id] of ['iria', 'drake'].entries()) {
          locate(actors[i], state.units[id], instant || reset);
          actors[i].seal.visible = phase === 'playing' && state.active === id;
        }
        board.routes(phase === 'playing' ? moves : []);
        board.danger(rules.forecast(state));
        board.wards(phase === 'playing' ? CELLS.filter(p => state.ward.includes(`${p.x},${p.y}`)) : []);
        board.readings(state.clues.map(id => rules.SITES?.[id]));
        focusCell = cell(focus) ? { x: focus.x, y: focus.y } : null;
        showFocus();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
