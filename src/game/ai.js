// Enemy / NPC decision making. Pure logic over the Board; returns a plan the battle controller animates.
import { forecast, strikeStats, DOUBLE_SPEED } from './combat.js';
import { SPELLS } from './data/spells.js';
import { key, manhattan } from '../core/util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Expected damage `u` could suffer on each tile during the opponents' next phase.
 * Map(tileKey -> expected damage). Used by cautious AI (and the auto-battle simulator).
 */
export function dangerMap(board, u) {
  const danger = new Map();
  for (const h of board.alive) {
    if (!board.hostile(u, h) || h.ai === 'idle') continue;
    const opts = attackOptions(h);
    if (!opts.length) continue;
    const stay = h.ai === 'boss' || h.ai === 'hold';
    const reach = board.reachable(h, { mov: stay ? 0 : h.mov });
    let best = 0;
    const ranges = [];
    for (const o of opts) {
      const st = strikeStats(board, h, u, o.spell);
      const count = h.stats.spd - u.stats.spd >= DOUBLE_SPEED ? 2 : 1;
      best = Math.max(best, st.dmg * (st.hit / 100) * count);
      ranges.push(o.range);
    }
    for (const k of board.threatTiles(h, ranges, reach)) danger.set(k, (danger.get(k) || 0) + best);
  }
  return danger;
}

/** Offensive options for a unit: [{ spell|null, range }] */
function attackOptions(u) {
  const out = [];
  if (u.canStrike && u.atkRange) out.push({ spell: null, range: u.atkRange });
  for (const s of u.spells) {
    const sp = SPELLS[s];
    if (sp.target !== 'enemy' || u.mp < sp.mp) continue;
    out.push({ spell: s, range: sp.range });
  }
  return out;
}

function healOptions(u) {
  return u.spells.filter((s) => SPELLS[s].kind === 'heal' && u.mp >= SPELLS[s].mp).map((s) => ({ spell: s, range: SPELLS[s].range, area: SPELLS[s].area || 0 }));
}

/** Reverse Dijkstra distance field (movement cost to reach any goal tile) for unit's move type. */
export function distanceField(board, u, goals) {
  const dist = new Map();
  const open = [];
  for (const g of goals) {
    const k = key(g.x, g.y);
    if (!dist.has(k)) { dist.set(k, 0); open.push({ x: g.x, y: g.y, d: 0 }); }
  }
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.d > (dist.get(key(cur.x, cur.y)) ?? Infinity)) continue;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!board.inBounds(nx, ny)) continue;
      // travelling nx,ny -> cur costs entering cur
      const c = board.stepCost(u, nx, ny, cur.x, cur.y);
      if (!isFinite(c) || !board.standable(u, nx, ny)) continue;
      const nd = cur.d + c;
      const k = key(nx, ny);
      if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); open.push({ x: nx, y: ny, d: nd }); }
    }
  }
  return dist;
}

function endTiles(board, u, reach) {
  const out = [];
  const leash = u.aiData.leash;
  const ox = u.aiData.originX ?? u.x, oy = u.aiData.originY ?? u.y;
  for (const k of reach.ends) {
    const n = reach.nodes.get(k);
    if (leash !== undefined && manhattan(n.x, n.y, ox, oy) > leash) continue;
    out.push(n);
  }
  return out;
}

function tileScore(board, x, y) {
  const t = board.terrain(x, y);
  return (t.def || 0) * 2 + (t.avo || 0) * 0.08 + (t.heal ? 2 : 0);
}

/** Evaluate attacking `t` from (x,y) with option. */
function scoreAttack(board, u, t, x, y, opt) {
  const fc = forecast(board, u, t, opt.spell, x, y);
  const a = fc.atk;
  const hitP = a.hit / 100;
  const critP = a.crit / 100;
  const expDmg = a.dmg * hitP * (1 + critP) * a.count;
  const killP = a.dmg * a.count >= t.hp ? hitP : (a.dmg * 2 >= t.hp ? hitP * critP : 0);
  let taken = 0;
  if (fc.def) taken = fc.def.dmg * (fc.def.hit / 100) * fc.def.count;
  let s = Math.min(expDmg, t.hp) * 1.2 + killP * 60 - taken * 0.6;
  if (t.clsData?.noCounter || !t.canStrike) s += 6;
  if (opt.spell) s -= SPELLS[opt.spell].mp * 0.2;
  const sp = opt.spell ? SPELLS[opt.spell] : null;
  if (sp && sp.area) {
    for (const o of board.alive) if (o !== t && board.hostile(u, o) && manhattan(o.x, o.y, t.x, t.y) <= sp.area) s += 10;
  }
  s += tileScore(board, x, y) * 0.5;
  return s;
}

/**
 * Decide what `u` does this phase.
 * Returns { unit, to:{x,y}, path, action: 'attack'|'heal'|'wait', target, spell }
 */
export function decide(board, u, turn) {
  const ai = u.ai;
  if (ai === 'idle') return wait(u);
  if (ai === 'wait' && turn < (u.aiData.untilTurn ?? 999) && !u.aiData.triggered) return wait(u);

  const reach = board.reachable(u, { mov: (ai === 'boss' || ai === 'hold') ? 0 : u.mov });
  const ends = endTiles(board, u, reach);
  const hostiles = board.alive.filter((o) => board.hostile(u, o));
  if (!hostiles.length) return wait(u);
  const cautious = ai === 'cautious';
  const danger = cautious ? dangerMap(board, u) : null;
  const risk = (n, hpLeft = u.hp) => {
    if (!danger) return 0;
    const d = danger.get(key(n.x, n.y)) || 0;
    return d * 0.9 + (d >= hpLeft ? 45 : 0);
  };

  // guards wake up when a hostile could reach them next turn
  if (ai === 'guard' && !u.aiData.triggered) {
    const wake = u.aiData.wake ?? (u.mov + 2);
    if (hostiles.some((h) => manhattan(h.x, h.y, u.x, u.y) <= wake)) u.aiData.triggered = true;
    else return wait(u);
  }

  // healers first look after allies
  const heals = healOptions(u);
  if (heals.length) {
    let best = null;
    for (const n of ends) {
      for (const h of heals) {
        const sp = SPELLS[h.spell];
        if (sp.area) {
          const hurt = board.alive.filter((o) => !board.hostile(u, o) && manhattan(o.x, o.y, n.x, n.y) <= sp.area && o.hp < o.maxHp * 0.8);
          const s = hurt.reduce((acc, o) => acc + (o.maxHp - o.hp), 0) - risk(n);
          if (hurt.length >= 2 && (!best || s > best.s)) best = { s, n, h, target: u };
          continue;
        }
        for (const o of board.alive) {
          if (board.hostile(u, o) || o.hp >= o.maxHp * 0.75) continue;
          const d = manhattan(n.x, n.y, o.x, o.y);
          if (o === u) continue;
          if (d < sp.range[0] || d > sp.range[1]) continue;
          const s = (o.maxHp - o.hp) + (o.boss ? 15 : 0) + (o.lord ? 8 : 0) + tileScore(board, n.x, n.y) - risk(n);
          if (!best || s > best.s) best = { s, n, h, target: o };
        }
      }
    }
    if (best && best.s >= 8) return plan(board, u, reach, best.n, 'heal', best.target, best.h.spell);
  }

  // attacks
  const opts = attackOptions(u);
  let best = null;
  for (const n of ends) {
    for (const opt of opts) {
      for (const t of hostiles) {
        const d = manhattan(n.x, n.y, t.x, t.y);
        if (d < opt.range[0] || d > opt.range[1]) continue;
        let s = scoreAttack(board, u, t, n.x, n.y, opt);
        if (cautious) {
          const fc = forecast(board, u, t, opt.spell, n.x, n.y);
          const taken = fc.def ? fc.def.dmg * (fc.def.hit / 100) * fc.def.count : 0;
          s -= risk(n, u.hp - taken);
        }
        if (!best || s > best.s) best = { s, n, t, opt };
      }
    }
  }
  if (best && best.s > (cautious ? 0 : -5)) return plan(board, u, reach, best.n, 'attack', best.t, best.opt.spell);

  if (ai === 'boss' || ai === 'hold') return wait(u);

  // advance toward the nearest hostile (healers keep to the second line, cautious units avoid lethal tiles)
  const goals = hostiles.map((h) => ({ x: h.x, y: h.y }));
  const field = distanceField(board, u, goals);
  let bestTile = null;
  let bestVal = Infinity;
  const healer = heals.length && !opts.length;
  for (const n of ends) {
    let v = field.get(key(n.x, n.y));
    if (v === undefined) v = 999 + manhattan(n.x, n.y, goals[0].x, goals[0].y);
    if (healer) v = Math.abs(v - 4);
    v -= tileScore(board, n.x, n.y) * 0.15;
    v += risk(n) * 0.5;
    if (v < bestVal) { bestVal = v; bestTile = n; }
  }
  if (!bestTile) return wait(u);
  return plan(board, u, reach, bestTile, 'wait', null, null);
}

function wait(u) { return { unit: u, to: { x: u.x, y: u.y }, path: [{ x: u.x, y: u.y }], action: 'wait' }; }

function plan(board, u, reach, n, action, target, spell) {
  return { unit: u, to: { x: n.x, y: n.y }, path: board.pathTo(reach, n.x, n.y) || [{ x: u.x, y: u.y }], action, target, spell };
}
