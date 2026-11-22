// Developer helpers: jump to a chapter with a levelled party, auto-battle, time scaling (via URL params).
import { GameState } from './state.js';
import { heroRecord, unitFromRecord } from './unit.js';
import { gainExp, promote } from './combat.js';
import { PROMOTION_GIFTS } from './data/heroes.js';
import { RNG } from '../core/util.js';

const EXPECTED = [
  { kael: 1, lyra: 1, garrick: 3 },
  { kael: 3, lyra: 3, garrick: 5 },
  { kael: 5, lyra: 5, garrick: 6, fenn: 5, vex: 6 },
  { kael: 7, lyra: 7, garrick: 8, fenn: 7, vex: 8, mira: 8 },
  { kael: 10, lyra: 9, garrick: 10, fenn: 9, vex: 10, mira: 10, sora: 10 },
  { kael: 13, lyra: 12, garrick: 13, fenn: 12, vex: 12, mira: 13, sora: 13 },
];

export function devParams() {
  const p = new URLSearchParams(location.search);
  return {
    chapter: p.has('chapter') ? Math.max(1, Math.min(6, +p.get('chapter'))) : 0,
    auto: p.get('auto') === '1',
    speed: p.has('speed') ? Math.max(0.25, Math.min(8, +p.get('speed'))) : 1,
    skip: p.get('skip') === '1',
    anim: p.get('anim') || null,
    quality: p.get('quality') || null,
    god: p.get('god') === '1',
  };
}

/** Fresh state for chapter index `ci` with heroes at the expected levels. */
export function devState(ci) {
  const rng = new RNG(4242 + ci);
  const s = GameState.fresh();
  s.chapter = ci;
  s.party = {};
  for (const [id, lv] of Object.entries(EXPECTED[ci])) {
    const u = unitFromRecord(heroRecord(id), 0, 0);
    while (u.level < lv) gainExp(u, 100, rng);
    if (!u.promoted && id === 'kael' && ci >= 4) promote(u);
    if (u.promoted && PROMOTION_GIFTS[id]) u.weapon = PROMOTION_GIFTS[id];
    s.party[id] = u.toRecord();
  }
  if (new URLSearchParams(location.search).get('god') === '1') for (const r of Object.values(s.party)) { r.stats.hp += 60; r.stats.str += 25; r.stats.mag += 25; r.stats.def += 25; r.stats.res += 25; r.stats.spd += 15; r.stats.skl += 30; }
  s.gold = 1500 + ci * 800;
  s.items = { herb: 4, potion: ci >= 2 ? 2 : 0, ether: 2 };
  return s;
}
