// Unit model: pure data + derived stats. No rendering here.
import { CLASSES, classSpells, STAT_KEYS } from './data/classes.js';
import { WEAPONS } from './data/items.js';
import { HEROES, ENEMY_TYPES } from './data/heroes.js';
import { CAST, GENERIC, lookFor } from './data/cast.js';

let UID = 1;

export class Unit {
  constructor(o) {
    this.uid = UID++;
    this.id = o.id;                 // hero id / cast id / generated
    this.name = o.name;
    this.side = o.side;             // 'player' | 'enemy' | 'ally'
    this.cls = o.cls;
    this.level = o.level || 1;
    this.exp = o.exp || 0;
    this.stats = { ...o.stats };    // max stats
    this.hp = o.hp ?? this.stats.hp;
    this.mp = o.mp ?? this.stats.mp;
    this.weapon = o.weapon;
    this.lookId = o.lookId;         // id into CAST / GENERIC
    this.promoted = !!o.promoted;
    this.boss = !!o.boss;
    this.lord = !!o.lord;           // defeat = game over
    this.ai = o.ai || 'aggressive';
    this.aiData = o.aiData || {};
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.acted = false;
    this.moved = false;
    this.alive = true;
    this.drops = o.drops || null;
    this.gold = o.gold || 0;
    this.recruit = o.recruit || null; // { by: [heroIds], convo: [...] }
    this.extraSpells = o.extraSpells || [];
    this.isHero = !!o.isHero;
    this.big = !!CLASSES[this.cls]?.big;
  }

  get clsData() { return CLASSES[this.cls]; }
  get className() { return this.clsData?.name || this.cls; }
  get maxHp() { return this.stats.hp; }
  get maxMp() { return this.stats.mp; }
  get mov() { return this.clsData?.mov ?? 5; }
  get moveType() { return this.clsData?.move || 'foot'; }
  get flying() { return this.moveType === 'flying'; }
  get undead() { return !!this.clsData?.undead; }
  get weaponData() { return WEAPONS[this.weapon] || null; }
  get look() { return lookFor(this.lookId, this.promoted); }
  get title() { return CAST[this.lookId]?.title || ''; }

  /** Can this unit make (and counter with) physical attacks? */
  get canStrike() {
    const w = this.weaponData;
    return !!w && w.type !== 'staff' && w.type !== 'rod';
  }

  get atkRange() {
    const w = this.weaponData;
    if (!w || !this.canStrike) return null;
    const bonus = w.type === 'bow' ? (this.clsData?.rangeBonus || 0) : 0;
    return [w.range[0], w.range[1] + bonus];
  }

  /** Effective magic stat including staff/rod bonus. */
  get magPower() {
    const w = this.weaponData;
    return this.stats.mag + (w && w.mag ? w.mag : 0);
  }

  get spells() {
    const list = classSpells(this.cls, this.level);
    for (const s of this.extraSpells) if (!list.includes(s)) list.push(s);
    return list;
  }

  get hpRatio() { return this.hp / Math.max(1, this.maxHp); }

  /** Persistent party record (between chapters). */
  toRecord() {
    return {
      id: this.id, cls: this.cls, level: this.level, exp: this.exp, stats: { ...this.stats },
      weapon: this.weapon, promoted: this.promoted, lookId: this.lookId,
    };
  }
}

/** Default record for a hero joining the party. */
export function heroRecord(id, overrides = {}) {
  const h = HEROES[id];
  const cls = CLASSES[h.cls];
  const level = overrides.level || h.level;
  const stats = { ...h.base };
  // heroes joining above their base level get average growth for the extra levels
  for (let l = h.level; l < level; l++) {
    for (const k of STAT_KEYS) stats[k] += Math.round(h.growth[k] / 100);
  }
  return {
    id, cls: h.cls, level, exp: 0, stats, weapon: overrides.weapon || h.weapon, promoted: cls.tier === 2, lookId: id,
  };
}

/** Build a battle Unit from a party record. */
export function unitFromRecord(rec, x, y) {
  const c = CAST[rec.id];
  return new Unit({
    id: rec.id, name: c ? c.name : rec.id, side: 'player', cls: rec.cls, level: rec.level, exp: rec.exp,
    stats: rec.stats, weapon: rec.weapon, lookId: rec.lookId || rec.id, promoted: rec.promoted,
    lord: !!HEROES[rec.id]?.lord, x, y, isHero: true,
  });
}

/**
 * Build an enemy (or NPC) from a chapter spawn entry:
 * { type?, cast?, cls?, level, x, y, ai?, boss?, weapon?, stats?, statBonus?, name?, drops?, gold?, side?, recruit?, promoted? }
 */
export function makeEnemy(e) {
  const tpl = e.type ? ENEMY_TYPES[e.type] : null;
  const cls = e.cls || tpl?.cls || 'brigand';
  const C = CLASSES[cls];
  const level = e.level || 1;
  let stats;
  if (e.stats) stats = { ...e.stats };
  else if (e.hero && HEROES[e.hero]) {
    const rec = heroRecord(e.hero, { level });
    stats = rec.stats;
  } else {
    stats = {};
    for (const k of STAT_KEYS) stats[k] = C.base[k] + Math.round(((level - 1) * (C.growth[k] || 0)) / 100);
  }
  const bonus = { ...(tpl?.statBonus || {}), ...(e.statBonus || {}) };
  for (const [k, v] of Object.entries(bonus)) stats[k] = (stats[k] || 0) + v;
  const lookId = e.cast || e.look || tpl?.look || 'bandit';
  const name = e.name || (CAST[lookId] ? CAST[lookId].name : tpl?.name || GENERIC[lookId]?.name || C.name);
  return new Unit({
    id: e.id || e.cast || `${e.type || cls}_${e.x}_${e.y}`,
    name, side: e.side || 'enemy', cls, level, stats,
    weapon: e.weapon || tpl?.weapon || 'ironAxe', lookId, boss: !!e.boss, promoted: !!e.promoted,
    ai: e.ai || (e.boss ? 'boss' : 'aggressive'), aiData: e.aiData || {}, x: e.x, y: e.y,
    drops: e.drops || null, gold: e.gold ?? Math.round(30 + level * 12 + (e.boss ? 400 : 0)),
    recruit: e.recruit || null, extraSpells: e.spells || [],
    isHero: !!e.hero,
  });
}
