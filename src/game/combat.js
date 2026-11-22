// Combat formulas: forecasts, resolution (mutates HP), healing, experience, level-ups and promotion.
import { CLASSES, STAT_KEYS, PROMOTE_LEVEL, MAX_LEVEL, classSpells } from './data/classes.js';
import { SPELLS, COUNTER_SPELL_ORDER } from './data/spells.js';
import { HEROES } from './data/heroes.js';
import { clamp, manhattan } from '../core/util.js';

export const DOUBLE_SPEED = 4;

function terrainMods(board, u) {
  if (u.flying) return { def: 0, avo: 0 };
  const t = board.terrain(u.x, u.y);
  return { def: t.def || 0, avo: t.avo || 0 };
}

function heightEdge(board, a, d) {
  const diff = board.level(a.x, a.y) - board.level(d.x, d.y);
  if (a.flying || d.flying) return 0;
  return diff >= 1 ? 1 : diff <= -2 ? -1 : 0;
}

/** The offensive spell a caster uses to counter (free of MP), or null. */
export function counterSpell(u) {
  const known = u.spells;
  for (const id of COUNTER_SPELL_ORDER) if (known.includes(id)) return id;
  return known.find((s) => SPELLS[s].kind === 'magic' && SPELLS[s].target === 'enemy') || null;
}

/** Range a unit can strike back at, as [min,max] or null. */
export function counterRange(u) {
  if (u.clsData?.noCounter) return null;
  if (u.canStrike) return u.atkRange;
  const sp = counterSpell(u);
  return sp ? SPELLS[sp].range : null;
}

/** Single-hit numbers for attacker -> defender with an optional spell/skill. */
export function strikeStats(board, a, d, spellId = null) {
  const tm = terrainMods(board, d);
  const edge = heightEdge(board, a, d);
  const sp = spellId ? SPELLS[spellId] : null;
  if (sp && sp.kind === 'magic') {
    let power = sp.power;
    if (sp.bonusVs === 'undead' && d.undead) power *= 2;
    const dmg = Math.max(1, a.magPower + power - (d.stats.res + tm.def));
    const hit = clamp((sp.hit || 85) + a.stats.skl - (d.stats.spd + Math.floor(tm.avo / 2)) + edge * 5, 0, 100);
    const crit = clamp(Math.floor(a.stats.skl / 4) - Math.floor(d.stats.skl / 5), 0, 30);
    return { dmg, hit, crit, magic: true };
  }
  const w = a.weaponData || { mt: 0, hit: 70, crit: 0 };
  let mt = w.mt;
  if (w.effective && w.effective.includes('flying') && d.flying) mt *= 2;
  let hitBonus = 0;
  if (sp && sp.kind === 'physical') { mt += sp.power; hitBonus += sp.hit || 0; }
  const dmg = Math.max(1, a.stats.str + mt + edge - (d.stats.def + tm.def));
  const hit = clamp(w.hit + 2 * a.stats.skl + hitBonus + edge * 10 - (2 * d.stats.spd + tm.avo), 0, 100);
  const crit = clamp((w.crit || 0) + Math.floor(a.stats.skl / 2) + (a.clsData?.critBonus || 0) - Math.floor(d.stats.skl / 3), 0, 60);
  return { dmg, hit, crit, magic: false };
}

/**
 * Forecast for the UI. Returns { atk: {dmg,hit,crit,count}, def: {...}|null }.
 * `spellId` = offensive spell/skill used by the attacker (null = weapon).
 */
export function forecast(board, a, d, spellId = null, fromX = a.x, fromY = a.y) {
  const ox = a.x, oy = a.y;
  a.x = fromX; a.y = fromY;
  const dist = manhattan(a.x, a.y, d.x, d.y);
  const A = strikeStats(board, a, d, spellId);
  A.count = a.stats.spd - d.stats.spd >= DOUBLE_SPEED ? 2 : 1;
  let D = null;
  const cr = counterRange(d);
  if (cr && dist >= cr[0] && dist <= cr[1]) {
    const cs = d.canStrike ? null : counterSpell(d);
    D = strikeStats(board, d, a, cs);
    D.count = d.stats.spd - a.stats.spd >= DOUBLE_SPEED ? 2 : 1;
  }
  a.x = ox; a.y = oy;
  return { atk: A, def: D, dist };
}

/**
 * Resolve a full exchange. Mutates HP/MP. Returns a script for the cutscene:
 * { kind, spell, attacker, defender, hpBefore:{a,d}, strikes:[{by:'a'|'d', hit, crit, dmg, hpAfter, drain}], splash:[...], aDied, dDied }
 */
export function resolveCombat(board, a, d, rng, spellId = null) {
  const sp = spellId ? SPELLS[spellId] : null;
  const fc = forecast(board, a, d, spellId);
  const res = {
    kind: sp ? (sp.kind === 'physical' ? 'skill' : 'magic') : (fc.dist > 1 ? 'ranged' : 'melee'),
    spell: spellId, attacker: a, defender: d, dist: fc.dist,
    hpBefore: { a: a.hp, d: d.hp }, strikes: [], splash: [], aDied: false, dDied: false,
    counterSpell: (!d.canStrike && fc.def) ? counterSpell(d) : null,
  };
  if (sp) a.mp = Math.max(0, a.mp - sp.mp);
  const order = [];
  order.push('a');
  if (fc.def) order.push('d');
  if (fc.atk.count > 1) order.push('a');
  if (fc.def && fc.def.count > 1) order.push('d');
  for (const who of order) {
    const s = who === 'a' ? a : d;
    const t = who === 'a' ? d : a;
    if (s.hp <= 0 || t.hp <= 0) break;
    const st = who === 'a' ? fc.atk : fc.def;
    const hit = rng.pct(st.hit);
    const crit = hit && rng.pct(st.crit);
    let dmg = hit ? (crit ? st.dmg * 2 : st.dmg) : 0;
    dmg = Math.min(dmg, t.hp);
    t.hp -= dmg;
    let drain = 0;
    const spUsed = who === 'a' ? sp : (res.counterSpell ? SPELLS[res.counterSpell] : null);
    if (hit && spUsed && spUsed.drain) { drain = Math.min(dmg, s.maxHp - s.hp); s.hp += drain; }
    res.strikes.push({ by: who, hit, crit, dmg, hpAfter: t.hp, attackerHpAfter: s.hp, drain });
  }
  // area splash (attacker's spell hits neighbours of the primary target; no counters)
  if (sp && sp.area && d) {
    for (const o of board.alive) {
      if (o === d || o === a || !board.hostile(a, o)) continue;
      if (manhattan(o.x, o.y, d.x, d.y) > sp.area) continue;
      const st = strikeStats(board, a, o, spellId);
      const hit = rng.pct(st.hit);
      const dmg = hit ? Math.min(o.hp, Math.max(1, Math.round(st.dmg * 0.75))) : 0;
      const before = o.hp;
      o.hp -= dmg;
      res.splash.push({ unit: o, hit, dmg, hpBefore: before, hpAfter: o.hp, died: o.hp <= 0 });
    }
  }
  res.aDied = a.hp <= 0;
  res.dDied = d.hp <= 0;
  return res;
}

/** Healing (single or area). Mutates HP/MP. */
export function resolveHeal(board, caster, target, spellId) {
  const sp = SPELLS[spellId];
  caster.mp = Math.max(0, caster.mp - sp.mp);
  const amount = sp.power + Math.floor(caster.magPower / 2);
  const targets = sp.area
    ? board.alive.filter((o) => !board.hostile(caster, o) && manhattan(o.x, o.y, caster.x, caster.y) <= sp.area)
    : [target];
  const heals = targets.map((u) => {
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    return { unit: u, amount: u.hp - before, hpBefore: before, hpAfter: u.hp };
  });
  return { kind: 'heal', spell: spellId, caster, target, heals };
}

/** Experience earned by `u` after fighting `o`. */
export function combatExp(u, o, { dealt, kill }) {
  if (!u.isHero || u.side !== 'player') return 0;
  const diff = o.level + (o.promoted ? 3 : 0) - (u.level + (u.promoted ? 3 : 0));
  let exp = dealt ? clamp(10 + diff * 2, 1, 30) : 2;
  if (kill) exp += clamp(22 + diff * 3, 6, 60) + (o.boss ? 40 : 0);
  return Math.round(exp);
}

export function healExp(u, count = 1) {
  if (!u.isHero) return 0;
  return 12 + (count - 1) * 4;
}

function growthOf(u) {
  const h = HEROES[u.id];
  if (h) return h.growth;
  return CLASSES[u.cls]?.growth || {};
}

/** Roll one level-up. Mutates stats. Returns gains {stat: n}. */
export function levelUp(u, rng) {
  const g = growthOf(u);
  const gains = {};
  let total = 0;
  for (const k of STAT_KEYS) {
    const rate = g[k] || 0;
    let n = Math.floor(rate / 100) + (rng.pct(rate % 100) ? 1 : 0);
    if (k === 'mp' && u.stats.mp === 0 && rate === 0) n = 0;
    gains[k] = n;
    total += n;
  }
  if (total === 0) {
    const best = STAT_KEYS.filter((k) => k !== 'mp').sort((a, b) => (g[b] || 0) - (g[a] || 0))[0];
    gains[best] = 1;
  }
  for (const k of STAT_KEYS) {
    u.stats[k] += gains[k];
    if (k === 'hp') u.hp += gains[k];
    if (k === 'mp') u.mp += gains[k];
  }
  u.level += 1;
  return gains;
}

/**
 * Add experience; returns an array of level-up records [{level, gains, newSpells, promoted}].
 * Promotion happens automatically when reaching PROMOTE_LEVEL.
 */
export function gainExp(u, amount, rng) {
  const ups = [];
  if (!amount || u.level >= MAX_LEVEL) return ups;
  u.exp += amount;
  while (u.exp >= 100 && u.level < MAX_LEVEL) {
    u.exp -= 100;
    const before = new Set(u.spells);
    const gains = levelUp(u, rng);
    const rec = { level: u.level, gains, newSpells: [], promoted: null };
    if (u.level >= PROMOTE_LEVEL && CLASSES[u.cls]?.promotesTo) rec.promoted = promote(u);
    rec.newSpells = u.spells.filter((s) => !before.has(s));
    ups.push(rec);
  }
  if (u.level >= MAX_LEVEL) u.exp = 0;
  return ups;
}

/** Promote to the next class tier. Returns { from, to, bonus }. */
export function promote(u) {
  const from = u.cls;
  const to = CLASSES[from]?.promotesTo;
  if (!to) return null;
  const bonus = CLASSES[to].promoBonus || {};
  u.cls = to;
  u.promoted = true;
  for (const k of STAT_KEYS) {
    u.stats[k] += bonus[k] || 0;
    if (k === 'hp') u.hp += bonus[k] || 0;
    if (k === 'mp') u.mp += bonus[k] || 0;
  }
  return { from, to, bonus };
}

export function spellsLearnedAt(cls, level) {
  const now = classSpells(cls, level);
  const before = classSpells(cls, level - 1);
  return now.filter((s) => !before.includes(s));
}
