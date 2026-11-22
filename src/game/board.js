// Board: the logical battlefield (terrain, heights, units) plus movement & range queries.
import { TERRAIN, terrainChar, resolveHeights, MAX_STEP, PROP_BLOCKS } from './data/terrain.js';
import { key, manhattan } from '../core/util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Board {
  constructor(mapDef) {
    this.map = mapDef;
    this.W = mapDef.width;
    this.H = mapDef.height;
    this.heights = resolveHeights(mapDef);
    this.units = [];
    this.blocked = new Set();
    for (const p of mapDef.props || []) if (PROP_BLOCKS.has(p.type)) this.blocked.add(key(p.x, p.y));
  }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tchar(x, y) { return terrainChar(this.map, x, y); }
  terrain(x, y) { return TERRAIN[this.tchar(x, y)] || TERRAIN['.']; }
  level(x, y) { return this.heights[y][x]; }
  isBlocked(x, y) { return this.blocked.has(key(x, y)); }

  get alive() { return this.units.filter((u) => u.alive); }
  unitAt(x, y) { return this.units.find((u) => u.alive && u.x === x && u.y === y) || null; }
  addUnit(u) { this.units.push(u); return u; }
  removeUnit(u) { u.alive = false; }
  sideUnits(side) { return this.units.filter((u) => u.alive && u.side === side); }

  /** Player and allies are friends; enemies oppose both. */
  hostile(a, b) {
    if (a.side === b.side) return false;
    if ((a.side === 'player' && b.side === 'ally') || (a.side === 'ally' && b.side === 'player')) return false;
    return true;
  }

  /** Cost for `unit` to enter tile (x,y) coming from (fx,fy); Infinity if impossible. */
  stepCost(unit, fx, fy, x, y) {
    if (!this.inBounds(x, y) || this.isBlocked(x, y)) return Infinity;
    const t = this.terrain(x, y);
    const c = t.cost[unit.moveType] ?? t.cost.foot;
    if (!isFinite(c)) return Infinity;
    if (unit.moveType !== 'flying' && Math.abs(this.level(x, y) - this.level(fx, fy)) > MAX_STEP) return Infinity;
    return c;
  }

  /** Can the unit stand on this tile at all (ignoring occupancy)? */
  standable(unit, x, y) {
    if (!this.inBounds(x, y) || this.isBlocked(x, y)) return false;
    const t = this.terrain(x, y);
    const c = t.cost[unit.moveType] ?? t.cost.foot;
    return isFinite(c);
  }

  /**
   * Dijkstra flood fill. Returns { nodes: Map(key -> {x,y,cost,prev}), ends: Set(key) }
   * nodes include pass-through tiles (friendly-occupied); ends = tiles the unit may finish on.
   */
  reachable(unit, { mov = unit.mov, ignoreUnits = false, fromX = unit.x, fromY = unit.y } = {}) {
    const nodes = new Map();
    const start = { x: fromX, y: fromY, cost: 0, prev: null };
    nodes.set(key(fromX, fromY), start);
    const open = [start];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].cost < open[bi].cost) bi = i;
      const cur = open.splice(bi, 1)[0];
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const c = this.stepCost(unit, cur.x, cur.y, nx, ny);
        if (!isFinite(c)) continue;
        const nc = cur.cost + c;
        if (nc > mov) continue;
        if (!ignoreUnits) {
          const occ = this.unitAt(nx, ny);
          if (occ && occ !== unit && this.hostile(unit, occ)) continue;
        }
        const k = key(nx, ny);
        const ex = nodes.get(k);
        if (ex && ex.cost <= nc) continue;
        const node = { x: nx, y: ny, cost: nc, prev: cur };
        nodes.set(k, node);
        open.push(node);
      }
    }
    const ends = new Set();
    for (const [k, n] of nodes) {
      const occ = ignoreUnits ? null : this.unitAt(n.x, n.y);
      if (!occ || occ === unit) ends.add(k);
    }
    return { nodes, ends };
  }

  /** Path (array of {x,y}) from the reach origin to (x,y). */
  pathTo(reach, x, y) {
    const n = reach.nodes.get(key(x, y));
    if (!n) return null;
    const out = [];
    for (let c = n; c; c = c.prev) out.push({ x: c.x, y: c.y });
    return out.reverse();
  }

  /** All in-bounds tiles with min <= manhattan distance <= max from (x,y). */
  tilesInRange(x, y, min, max) {
    const out = [];
    for (let dy = -max; dy <= max; dy++) {
      for (let dx = -max; dx <= max; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < min || d > max) continue;
        const tx = x + dx, ty = y + dy;
        if (this.inBounds(tx, ty)) out.push({ x: tx, y: ty });
      }
    }
    return out;
  }

  /** Union of tiles attackable after moving (used for range display, danger zone and AI). */
  threatTiles(unit, ranges, reach = null) {
    const r = reach || this.reachable(unit);
    const out = new Set();
    for (const k of r.ends) {
      const n = r.nodes.get(k);
      for (const [mn, mx] of ranges) for (const t of this.tilesInRange(n.x, n.y, mn, mx)) out.add(key(t.x, t.y));
    }
    return out;
  }

  distance(a, b) { return manhattan(a.x, a.y, b.x, b.y); }

  /** Units of the opposing side(s) within [min,max] of (x,y). */
  hostilesInRange(unit, x, y, min, max) {
    return this.alive.filter((o) => this.hostile(unit, o) && (() => { const d = manhattan(x, y, o.x, o.y); return d >= min && d <= max; })());
  }

  friendsInRange(unit, x, y, min, max) {
    return this.alive.filter((o) => !this.hostile(unit, o) && (() => { const d = manhattan(x, y, o.x, o.y); return d >= min && d <= max; })());
  }
}
