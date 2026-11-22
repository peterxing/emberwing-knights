// Playable heroes (personal bases/growths) and generic enemy templates.

export const HEROES = {
  kael: { cls: 'squire', level: 1, lord: true, weapon: 'ironSword',
    base: { hp: 24, mp: 6, str: 7, mag: 3, def: 6, res: 3, spd: 9, skl: 8 },
    growth: { hp: 80, mp: 35, str: 55, mag: 20, def: 40, res: 30, spd: 55, skl: 55 } },
  lyra: { cls: 'cleric', level: 1, weapon: 'oakStaff',
    base: { hp: 17, mp: 18, str: 2, mag: 7, def: 2, res: 8, spd: 6, skl: 5 },
    growth: { hp: 55, mp: 70, str: 15, mag: 60, def: 20, res: 60, spd: 40, skl: 40 } },
  garrick: { cls: 'lancer', level: 3, weapon: 'ironLance',
    base: { hp: 30, mp: 0, str: 9, mag: 0, def: 10, res: 2, spd: 4, skl: 7 },
    growth: { hp: 85, mp: 0, str: 50, mag: 5, def: 55, res: 15, spd: 25, skl: 40 } },
  fenn: { cls: 'archer', level: 3, weapon: 'shortBow',
    base: { hp: 21, mp: 0, str: 7, mag: 1, def: 4, res: 3, spd: 9, skl: 10 },
    growth: { hp: 65, mp: 0, str: 50, mag: 10, def: 30, res: 25, spd: 60, skl: 65 } },
  vex: { cls: 'rogue', level: 4, weapon: 'dagger',
    base: { hp: 21, mp: 0, str: 7, mag: 2, def: 4, res: 5, spd: 13, skl: 12 },
    growth: { hp: 60, mp: 0, str: 40, mag: 10, def: 30, res: 35, spd: 70, skl: 60 } },
  mira: { cls: 'mage', level: 5, weapon: 'apprenticeRod',
    base: { hp: 19, mp: 26, str: 1, mag: 11, def: 3, res: 8, spd: 9, skl: 8 },
    growth: { hp: 50, mp: 75, str: 10, mag: 70, def: 15, res: 55, spd: 50, skl: 45 } },
  sora: { cls: 'wyvernRider', level: 8, weapon: 'steelLance',
    base: { hp: 29, mp: 0, str: 12, mag: 2, def: 9, res: 5, spd: 12, skl: 11 },
    growth: { hp: 70, mp: 0, str: 55, mag: 10, def: 40, res: 30, spd: 55, skl: 50 } },
};

export const HERO_ORDER = ['kael', 'lyra', 'garrick', 'fenn', 'vex', 'mira', 'sora'];

/** Unique weapon each hero receives on promotion. */
export const PROMOTION_GIFTS = {
  kael: 'emberBrand', lyra: 'sunStaff', fenn: 'galeBow', vex: 'shadowFang', mira: 'starRod', sora: 'skyPiercer',
};

// look = GENERIC id in cast.js; cls = class id; weapon default
export const ENEMY_TYPES = {
  bandit: { cls: 'brigand', look: 'bandit', weapon: 'ironAxe' },
  axeThrower: { cls: 'brigand', look: 'bandit', weapon: 'handAxe', name: 'Axe Thrower' },
  banditArcher: { cls: 'archer', look: 'banditArcher', weapon: 'shortBow', name: 'Brigand Archer' },
  wolf: { cls: 'wolf', look: 'wolf', weapon: 'fang' },
  soldier: { cls: 'soldier', look: 'soldier', weapon: 'ironLance' },
  javelinSoldier: { cls: 'soldier', look: 'soldier', weapon: 'javelin', name: 'Javelineer' },
  imperialArcher: { cls: 'archer', look: 'imperialArcher', weapon: 'steelBow', name: 'Obsidian Archer' },
  knight: { cls: 'knight', look: 'knight', weapon: 'steelLance' },
  darkMage: { cls: 'darkMage', look: 'darkMage', weapon: 'gloomRod' },
  warPriest: { cls: 'priest', look: 'warPriest', weapon: 'oakStaff' },
  cultist: { cls: 'cultist', look: 'cultist', weapon: 'ritualKnife' },
  skeleton: { cls: 'skeleton', look: 'skeleton', weapon: 'rustySword' },
  wraith: { cls: 'wraith', look: 'wraith', weapon: 'claw' },
  golem: { cls: 'golem', look: 'golem', weapon: 'fist', name: 'Sand Golem' },
  goldGolem: { cls: 'golem', look: 'goldGolem', weapon: 'fist', name: 'Gilded Golem', statBonus: { hp: 6, def: 2, res: 4 } },
  wyvernKnight: { cls: 'wyvernKnight', look: 'wyvernKnight', weapon: 'steelLance' },
};
