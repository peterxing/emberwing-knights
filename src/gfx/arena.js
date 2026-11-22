// Battle-cutscene stage. Each theme is a small hand-shaped battlefield rendered with the same World builder
// as the tactical maps (so stages match the map art), lit by its own Environment.
import * as THREE from 'three';
import { World } from './world.js';
import { Environment } from './environment.js';

const W = 26, H = 19, ROW = 5, CX = 13;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// cell(x, y, r) -> terrain char; r = deterministic random in [0,1)
const THEMES = {
  field: { border: 'forest', props: [{ type: 'rock', x: 4, y: 3 }, { type: 'haystack', x: 21, y: 2 }],
    cell: (x, y, r) => (y <= 1 ? (r < 0.5 ? 'F' : r < 0.6 ? 'Y' : '.') : y === 2 ? (r < 0.25 ? 'Y' : r < 0.5 ? '"' : '.') : y >= 8 ? (r < 0.3 ? '"' : '.') : (r < 0.15 ? '"' : '.')) },
  forest: { border: 'forest', props: [{ type: 'boulder', x: 6, y: 3 }, { type: 'rock', x: 19, y: 3 }],
    cell: (x, y, r) => (y <= 2 ? (r < 0.55 ? 'F' : r < 0.85 ? 'P' : '.') : y === 3 ? (r < 0.35 ? 'F' : r < 0.5 ? 'Y' : '.') : y >= 9 ? (r < 0.25 ? 'Y' : '.') : (r < 0.12 ? '"' : '.')) },
  hills: { border: 'mountains', props: [{ type: 'rock', x: 8, y: 3 }, { type: 'boulder', x: 18, y: 2 }],
    cell: (x, y, r) => (y === 0 ? (r < 0.75 ? 'M' : 'H') : y === 1 ? (r < 0.4 ? 'M' : 'H') : y === 2 ? (r < 0.55 ? 'H' : '.') : y >= 9 ? (r < 0.2 ? 'H' : '.') : '.') },
  castle: { border: 'castle', props: [{ type: 'banner', x: 6, y: 1, color: 0xa8242c }, { type: 'banner', x: 20, y: 1, color: 0xa8242c }, { type: 'brazier', x: 9, y: 2 }, { type: 'brazier', x: 17, y: 2 }, { type: 'torch', x: 3, y: 2 }, { type: 'torch', x: 23, y: 2 }],
    cell: (x, y) => (y === 0 ? '#' : y === 1 ? (x % 4 === 1 ? 'O' : 'C') : y === ROW ? 'c' : 'C') },
  desert: { border: 'desert', props: [{ type: 'palm', x: 5, y: 2 }, { type: 'bones', x: 17, y: 7 }, { type: 'obelisk', x: 20, y: 1 }],
    cell: (x, y, r) => (y === 0 ? (r < 0.7 ? 'D' : 'R') : y === 1 ? (r < 0.35 ? 'R' : r < 0.6 ? 'D' : 'S') : y === 2 ? (r < 0.2 ? 'R' : 'S') : y >= 9 ? (r < 0.3 ? 'D' : 'S') : 'S') },
  bridge: { border: 'water', props: [{ type: 'rock', x: 3, y: 1 }],
    cell: (x, y, r) => (y <= 1 ? (r < 0.45 ? 'F' : '.') : y === 2 ? '.' : y === 3 ? '~' : y === ROW - 1 ? '~' : y === ROW ? '=' : y <= 9 ? '~' : '.') },
  temple: { border: 'lava', props: [{ type: 'goldenStatue', x: 7, y: 1 }, { type: 'goldenStatue', x: 19, y: 1 }, { type: 'brazier', x: 10, y: 2 }, { type: 'brazier', x: 16, y: 2 }, { type: 'crystal', x: 3, y: 2 }],
    cell: (x, y) => (y === 0 ? (x % 3 === 0 ? 'O' : 'g') : y === 1 ? 'L' : y === ROW ? 'c' : 'g') },
  village: { border: 'forest', props: [{ type: 'well', x: 20, y: 3 }, { type: 'cart', x: 6, y: 3 }, { type: 'lamppost', x: 10, y: 3 }, { type: 'lamppost', x: 16, y: 3 }],
    cell: (x, y, r) => (y === 0 ? (x % 5 === 2 ? 'h' : r < 0.5 ? 'F' : '.') : y === 1 ? (x % 5 === 2 ? 'V' : 'B') : y === 2 ? 'B' : (y === ROW) ? ',' : y >= 9 ? (r < 0.3 ? '"' : '.') : '.') },
};

const THEME_OF = {
  '.': 'field', '"': 'field', ',': 'field', 'Y': 'field', 'W': 'field',
  'B': 'village', 'V': 'village', 'h': 'village',
  'F': 'forest', 'P': 'forest',
  'H': 'hills', 'M': 'hills', 'K': 'hills',
  'C': 'castle', 'c': 'castle', 'T': 'castle', 'G': 'castle', 'O': 'castle', '#': 'castle',
  'S': 'desert', 'D': 'desert', 'R': 'desert',
  '=': 'bridge', '~': 'bridge',
  'g': 'temple', 'A': 'temple', 'L': 'temple', 'X': 'temple',
};

const PALETTE_FOR = { desert: 'desert', temple: 'golden' };

// Open ground between the combatants and the cutscene camera (kept low so nothing blocks the shot).
const FRONT = {
  field: (x, y, r) => (r < 0.18 ? '\"' : '.'),
  forest: (x, y, r) => (r < 0.12 ? '\"' : '.'),
  hills: () => '.',
  castle: () => 'C',
  desert: () => 'S',
  bridge: (x, y) => (y >= H - 3 ? '.' : '~'),
  temple: (x, y) => (y === ROW + 5 ? 'L' : 'g'),
  village: (x, y, r) => (y === ROW + 3 ? ',' : r < 0.15 ? '\"' : '.'),
};

function buildMap(theme, preset, palette) {
  const T = THEMES[theme];
  const seed = theme.length * 31 + 7;
  const tiles = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      let ch = y >= ROW + 2 ? FRONT[theme](x, y, hash(x, y, seed)) : T.cell(x, y, hash(x, y, seed));
      if ((y === ROW) && (x === CX - 2 || x === CX + 1 || x === CX - 1 || x === CX)) ch = theme === 'bridge' ? '=' : theme === 'castle' || theme === 'temple' ? 'c' : theme === 'village' ? ',' : theme === 'desert' ? 'S' : '.';
      row += ch;
    }
    tiles.push(row);
  }
  return {
    id: `arena-${theme}`, width: W, height: H, tiles, props: T.props, environment: preset, border: T.border,
    palette: PALETTE_FOR[theme] || palette || 'temperate',
  };
}

export class Arena {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.leftSpot = new THREE.Vector3(-1.7, 0, 0);
    this.rightSpot = new THREE.Vector3(1.7, 0, 0);
    this.focus = new THREE.Vector3(0, 0.6, 0);
    this.cache = new Map();
    this.current = null;
    this.env = new Environment(this.scene, renderer, opts.preset || 'day', {
      bounds: new THREE.Box3(new THREE.Vector3(-7, -0.5, -4), new THREE.Vector3(7, 3, 4)), quality: opts.quality || 'high',
    });
    this.grade = this.env.preset;
    this.setTerrain(opts.terrain || '.', opts.preset || 'day', opts.palette);
  }

  setTerrain(terrainChar, preset = 'day', palette) {
    const theme = THEME_OF[terrainChar] || 'field';
    const pal = palette === 'ashen' && theme !== 'desert' && theme !== 'temple' ? 'ashen' : palette;
    const key = `${theme}|${preset}|${pal || ''}`;
    if (this.current?.key === key) return;
    if (this.current) this.scene.remove(this.current.world.group);
    let entry = this.cache.get(key);
    if (!entry) {
      const map = buildMap(theme, preset, pal);
      const world = new World(map, { quality: 'high' });
      const top = world.tileTop(CX, ROW);
      world.group.position.set(-CX, -top, -(ROW + 0.5));
      entry = { key, world, theme };
      this.cache.set(key, entry);
      if (this.cache.size > 6) {
        const [oldKey, old] = this.cache.entries().next().value;
        if (old !== this.current) { old.world.dispose(); this.cache.delete(oldKey); }
      }
    }
    this.current = entry;
    this.scene.add(entry.world.group);
    if (this.env.name !== preset) this.env.setPreset(preset);
    this.grade = this.env.preset;
  }

  update(dt, elapsed, camera) {
    if (!this.current) return;
    this.current.world.update(dt, elapsed, camera);
    this.env.update(dt, elapsed, camera);
  }

  dispose() {
    for (const e of this.cache.values()) e.world.dispose();
    this.cache.clear();
    this.env.dispose();
    this.scene.clear();
  }
}
