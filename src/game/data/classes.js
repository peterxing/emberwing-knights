// Classes: movement, weapon type, stat bases/growths (used for enemies), promotions and spell learning.
// Stats: hp, mp, str, mag, def, res, spd, skl. Movement types: foot | armor | beast | flying.

export const STAT_KEYS = ['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd', 'skl'];
export const STAT_LABEL = { hp: 'HP', mp: 'MP', str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD', skl: 'SKL', mov: 'MOV' };

const S = (hp, mp, str, mag, def, res, spd, skl) => ({ hp, mp, str, mag, def, res, spd, skl });

export const CLASSES = {
  // ------------------------------------------------ hero classes (tier 1 -> tier 2)
  squire: { name: 'Squire', tier: 1, move: 'foot', mov: 5, weapon: 'sword', promotesTo: 'emberKnight',
    base: S(22, 6, 7, 3, 5, 3, 8, 8), growth: S(80, 35, 55, 20, 40, 30, 55, 55), spells: {} },
  emberKnight: { name: 'Emberwing Knight', tier: 2, move: 'foot', mov: 6, weapon: 'sword',
    promoBonus: S(6, 8, 3, 2, 3, 3, 2, 2), spells: { dragonFang: 0 }, critBonus: 5 },

  cleric: { name: 'Cleric', tier: 1, move: 'foot', mov: 5, weapon: 'staff', promotesTo: 'saint', noCounter: true,
    base: S(17, 18, 2, 7, 2, 8, 6, 5), growth: S(55, 70, 15, 60, 20, 60, 40, 40), spells: { heal: 1, holy: 3, cure: 6 } },
  saint: { name: 'Saint', tier: 2, move: 'foot', mov: 5, weapon: 'staff', noCounter: true,
    promoBonus: S(6, 10, 1, 3, 2, 4, 2, 2), spells: { nova: 0 } },

  lancer: { name: 'Lancer', tier: 1, move: 'armor', mov: 4, weapon: 'lance', promotesTo: 'general',
    base: S(28, 0, 9, 0, 10, 2, 4, 7), growth: S(85, 0, 50, 5, 55, 15, 25, 40), spells: {} },
  general: { name: 'General', tier: 2, move: 'armor', mov: 5, weapon: 'lance',
    promoBonus: S(8, 0, 3, 0, 5, 2, 1, 2), spells: {} },

  archer: { name: 'Archer', tier: 1, move: 'foot', mov: 5, weapon: 'bow', promotesTo: 'ranger',
    base: S(17, 0, 5, 0, 3, 2, 6, 7), growth: S(60, 0, 40, 5, 20, 15, 40, 45), spells: {} },
  ranger: { name: 'Ranger', tier: 2, move: 'foot', mov: 6, weapon: 'bow', rangeBonus: 1,
    promoBonus: S(5, 0, 2, 0, 2, 2, 3, 3), spells: {} },

  rogue: { name: 'Rogue', tier: 1, move: 'foot', mov: 6, weapon: 'dagger', promotesTo: 'shadowblade', treasureSense: true,
    base: S(18, 0, 6, 2, 4, 4, 11, 10), growth: S(60, 0, 40, 10, 30, 35, 70, 60), spells: {} },
  shadowblade: { name: 'Shadowblade', tier: 2, move: 'foot', mov: 7, weapon: 'dagger', treasureSense: true,
    promoBonus: S(5, 0, 3, 1, 2, 2, 3, 3), spells: {}, critBonus: 15 },

  mage: { name: 'Mage', tier: 1, move: 'foot', mov: 5, weapon: 'rod', promotesTo: 'archmage',
    base: S(16, 20, 1, 8, 2, 6, 7, 6), growth: S(50, 75, 10, 70, 15, 55, 50, 45), spells: { flame: 1, frost: 4, bolt: 8 } },
  archmage: { name: 'Archmage', tier: 2, move: 'foot', mov: 5, weapon: 'rod',
    promoBonus: S(5, 10, 0, 4, 1, 3, 2, 2), spells: { inferno: 0, blizzard: 12, tempest: 15 } },

  wyvernRider: { name: 'Wyvern Rider', tier: 1, move: 'flying', mov: 7, weapon: 'lance', promotesTo: 'wyvernLord',
    base: S(22, 0, 8, 1, 7, 2, 7, 6), growth: S(70, 0, 55, 10, 40, 30, 55, 50), spells: {} },
  wyvernLord: { name: 'Wyvern Lord', tier: 2, move: 'flying', mov: 8, weapon: 'lance',
    promoBonus: S(7, 0, 3, 1, 4, 2, 2, 2), spells: {} },

  // ------------------------------------------------ enemy classes
  brigand: { name: 'Brigand', tier: 1, move: 'foot', mov: 5, weapon: 'axe',
    base: S(18, 0, 5, 0, 2, 0, 4, 3), growth: S(80, 0, 45, 0, 25, 10, 30, 30) },
  wolf: { name: 'Dire Wolf', tier: 1, move: 'beast', mov: 6, weapon: 'fang',
    base: S(15, 0, 6, 0, 2, 1, 9, 6), growth: S(60, 0, 45, 0, 20, 10, 50, 40) },
  soldier: { name: 'Soldier', tier: 1, move: 'foot', mov: 5, weapon: 'lance',
    base: S(18, 0, 6, 0, 4, 1, 5, 5), growth: S(70, 0, 40, 0, 35, 15, 35, 35) },
  knight: { name: 'Knight', tier: 1, move: 'armor', mov: 4, weapon: 'lance',
    base: S(21, 0, 8, 0, 9, 1, 2, 4), growth: S(80, 0, 45, 0, 45, 10, 15, 30) },
  darkMage: { name: 'Dark Mage', tier: 1, move: 'foot', mov: 5, weapon: 'rod',
    base: S(16, 20, 1, 7, 2, 6, 5, 5), growth: S(50, 50, 5, 55, 15, 45, 35, 35), spells: { darkBolt: 1, drain: 9 } },
  priest: { name: 'War Priest', tier: 1, move: 'foot', mov: 5, weapon: 'staff', noCounter: true,
    base: S(16, 22, 1, 5, 2, 7, 4, 4), growth: S(50, 60, 5, 45, 15, 50, 30, 30), spells: { heal: 1, cure: 8 } },
  cultist: { name: 'Cultist', tier: 1, move: 'foot', mov: 5, weapon: 'dagger',
    base: S(18, 10, 5, 5, 3, 5, 7, 6), growth: S(60, 30, 40, 40, 25, 35, 45, 40), spells: { darkBolt: 1 } },
  skeleton: { name: 'Skeleton', tier: 1, move: 'foot', mov: 4, weapon: 'sword', undead: true,
    base: S(20, 0, 7, 0, 4, 0, 4, 5), growth: S(70, 0, 45, 0, 30, 5, 30, 35) },
  wraith: { name: 'Wraith', tier: 1, move: 'flying', mov: 5, weapon: 'claw', undead: true,
    base: S(18, 20, 6, 6, 2, 8, 8, 6), growth: S(55, 40, 40, 40, 15, 45, 45, 40), spells: { darkBolt: 1 } },
  golem: { name: 'Golem', tier: 1, move: 'armor', mov: 3, weapon: 'fist',
    base: S(30, 0, 10, 0, 9, 2, 1, 3), growth: S(90, 0, 50, 0, 50, 10, 10, 25) },
  wyvernKnight: { name: 'Wyvern Knight', tier: 1, move: 'flying', mov: 7, weapon: 'lance',
    base: S(22, 0, 8, 0, 7, 2, 7, 6), growth: S(70, 0, 50, 0, 40, 20, 45, 40) },

  // ------------------------------------------------ boss classes
  warlord: { name: 'Bandit Chief', tier: 2, move: 'foot', mov: 5, weapon: 'axe',
    base: S(24, 0, 8, 0, 4, 1, 5, 5), growth: S(85, 0, 50, 0, 30, 15, 30, 35) },
  beastmaster: { name: 'Beastmaster', tier: 2, move: 'foot', mov: 5, weapon: 'axe',
    base: S(26, 0, 8, 0, 5, 2, 8, 7), growth: S(80, 0, 45, 0, 30, 20, 40, 40) },
  paladin: { name: 'Obsidian Paladin', tier: 2, move: 'foot', mov: 6, weapon: 'lance',
    base: S(26, 0, 8, 1, 7, 4, 7, 7), growth: S(80, 0, 45, 10, 35, 25, 40, 40) },
  commander: { name: 'Iron Warden', tier: 2, move: 'armor', mov: 4, weapon: 'sword',
    base: S(30, 0, 10, 2, 10, 5, 6, 8), growth: S(80, 0, 45, 10, 40, 25, 30, 40) },
  hexer: { name: 'Hex Witch', tier: 2, move: 'foot', mov: 5, weapon: 'sword',
    base: S(28, 30, 5, 10, 5, 9, 9, 9), growth: S(65, 50, 25, 50, 25, 40, 40, 40), spells: { darkBolt: 1, drain: 1 } },
  sorcerer: { name: 'Gloom Sorcerer', tier: 2, move: 'foot', mov: 4, weapon: 'rod',
    base: S(34, 40, 4, 12, 7, 12, 8, 10), growth: S(70, 50, 20, 50, 30, 45, 35, 45), spells: { darkBolt: 1, drain: 1, bolt: 1 } },
  gloomWyrm: { name: 'Gloom Wyrm', tier: 2, move: 'flying', mov: 0, weapon: 'fang', big: true,
    base: S(90, 99, 17, 15, 13, 10, 8, 12), growth: S(0, 0, 0, 0, 0, 0, 0, 0), spells: { breath: 1 } },
};

/** Spells a class grants at `level` (tier-2 classes include their tier-1 list). */
export function classSpells(classId, level) {
  const out = [];
  const add = (cid, lv) => {
    const c = CLASSES[cid];
    if (!c || !c.spells) return;
    for (const [sp, need] of Object.entries(c.spells)) if (lv >= need && !out.includes(sp)) out.push(sp);
  };
  const cls = CLASSES[classId];
  if (cls && cls.tier === 2) {
    const base = Object.keys(CLASSES).find((k) => CLASSES[k].promotesTo === classId);
    if (base) add(base, 99);
  }
  add(classId, level);
  return out;
}

export const PROMOTE_LEVEL = 10;
export const MAX_LEVEL = 30;
