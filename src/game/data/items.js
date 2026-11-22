// Weapons (one equipped per unit) and consumable items (shared party inventory).

// type: sword | lance | axe | bow | dagger | staff | rod | fang | claw | fist
// mt: might, hit: base hit %, crit: base crit %, range: [min, max], mag: magic bonus (staves/rods),
// effective: unit tags taking double might (e.g. bows vs flying)
export const WEAPONS = {
  ironSword: { name: 'Iron Sword', type: 'sword', mt: 5, hit: 90, crit: 0, range: [1, 1], price: 400 },
  steelSword: { name: 'Steel Sword', type: 'sword', mt: 8, hit: 85, crit: 0, range: [1, 1], price: 900 },
  silverSword: { name: 'Silver Sword', type: 'sword', mt: 12, hit: 85, crit: 5, range: [1, 1], price: 2000 },
  emberBrand: { name: 'Ember Brand', type: 'sword', mt: 14, hit: 92, crit: 10, range: [1, 1], price: 0, unique: true, desc: 'The flame-forged blade of the Emberwing captains.' },
  rustySword: { name: 'Rusted Blade', type: 'sword', mt: 4, hit: 80, crit: 0, range: [1, 1], price: 0 },
  greatsword: { name: 'Greatsword', type: 'sword', mt: 11, hit: 75, crit: 5, range: [1, 1], price: 0 },
  hexScythe: { name: 'Hex Scythe', type: 'sword', mt: 10, hit: 80, crit: 10, range: [1, 1], price: 0 },

  ironLance: { name: 'Iron Lance', type: 'lance', mt: 6, hit: 80, crit: 0, range: [1, 1], price: 450 },
  javelin: { name: 'Javelin', type: 'lance', mt: 5, hit: 70, crit: 0, range: [1, 2], price: 700 },
  steelLance: { name: 'Steel Lance', type: 'lance', mt: 9, hit: 75, crit: 0, range: [1, 1], price: 950 },
  silverLance: { name: 'Silver Lance', type: 'lance', mt: 13, hit: 78, crit: 0, range: [1, 1], price: 2100 },
  skyPiercer: { name: 'Sky Piercer', type: 'lance', mt: 14, hit: 85, crit: 5, range: [1, 2], price: 0, unique: true, desc: 'A rider-lance that strikes from the clouds.' },

  ironAxe: { name: 'Iron Axe', type: 'axe', mt: 7, hit: 70, crit: 0, range: [1, 1], price: 450 },
  handAxe: { name: 'Hand Axe', type: 'axe', mt: 5, hit: 60, crit: 0, range: [1, 2], price: 0 },
  steelAxe: { name: 'Steel Axe', type: 'axe', mt: 10, hit: 65, crit: 0, range: [1, 1], price: 0 },
  warAxe: { name: 'War Axe', type: 'axe', mt: 13, hit: 65, crit: 5, range: [1, 1], price: 0 },

  shortBow: { name: 'Short Bow', type: 'bow', mt: 4, hit: 85, crit: 0, range: [2, 2], price: 450, effective: ['flying'] },
  steelBow: { name: 'Steel Bow', type: 'bow', mt: 7, hit: 80, crit: 0, range: [2, 2], price: 950, effective: ['flying'] },
  longbow: { name: 'Longbow', type: 'bow', mt: 6, hit: 70, crit: 0, range: [2, 3], price: 1200, effective: ['flying'] },
  silverBow: { name: 'Silver Bow', type: 'bow', mt: 11, hit: 80, crit: 0, range: [2, 2], price: 2200, effective: ['flying'] },
  galeBow: { name: 'Gale Bow', type: 'bow', mt: 12, hit: 90, crit: 10, range: [2, 3], price: 0, unique: true, effective: ['flying'], desc: 'Arrows ride the wind itself.' },

  dagger: { name: 'Dagger', type: 'dagger', mt: 3, hit: 95, crit: 10, range: [1, 1], price: 350 },
  stiletto: { name: 'Stiletto', type: 'dagger', mt: 6, hit: 95, crit: 15, range: [1, 1], price: 900 },
  shadowFang: { name: 'Shadow Fang', type: 'dagger', mt: 9, hit: 98, crit: 25, range: [1, 1], price: 0, unique: true, desc: 'A black blade that finds every gap.' },
  ritualKnife: { name: 'Ritual Knife', type: 'dagger', mt: 5, hit: 90, crit: 5, range: [1, 1], price: 0 },

  oakStaff: { name: 'Oak Staff', type: 'staff', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 1, price: 300 },
  silverStaff: { name: 'Silver Staff', type: 'staff', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 3, price: 1100 },
  sunStaff: { name: 'Sunlit Staff', type: 'staff', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 5, price: 0, unique: true, desc: 'Warm as the first light of morning.' },

  apprenticeRod: { name: 'Apprentice Rod', type: 'rod', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 1, price: 300 },
  arcaneRod: { name: 'Arcane Rod', type: 'rod', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 3, price: 1200 },
  starRod: { name: 'Starfall Rod', type: 'rod', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 5, price: 0, unique: true, desc: 'Holds a sliver of a fallen star.' },
  gloomRod: { name: 'Gloom Rod', type: 'rod', mt: 0, hit: 0, crit: 0, range: [1, 1], mag: 3, price: 0 },

  fang: { name: 'Fangs', type: 'fang', mt: 5, hit: 85, crit: 5, range: [1, 1], price: 0 },
  claw: { name: 'Claws', type: 'claw', mt: 6, hit: 80, crit: 5, range: [1, 1], price: 0 },
  fist: { name: 'Stone Fists', type: 'fist', mt: 9, hit: 70, crit: 0, range: [1, 1], price: 0 },
  wyrmJaw: { name: 'Gloom Fangs', type: 'fang', mt: 12, hit: 85, crit: 5, range: [1, 1], price: 0 },
};

// target: 'self' | 'ally' (adjacent ally or self)
export const ITEMS = {
  herb: { name: 'Healing Herb', desc: 'Restores 20 HP.', heal: 20, price: 60, icon: '🌿' },
  potion: { name: 'Elixir', desc: 'Fully restores HP.', heal: 999, price: 450, icon: '⚗️' },
  ether: { name: 'Ether', desc: 'Restores 15 MP.', mp: 15, price: 250, icon: '💧' },
  lifeSeed: { name: 'Life Seed', desc: 'Max HP +5.', stat: 'hp', amount: 5, price: 0, icon: '❤️' },
  powerSeed: { name: 'Power Seed', desc: 'STR +2.', stat: 'str', amount: 2, price: 0, icon: '💪' },
  mindSeed: { name: 'Mind Seed', desc: 'MAG +2.', stat: 'mag', amount: 2, price: 0, icon: '🔮' },
  guardSeed: { name: 'Guard Seed', desc: 'DEF +2.', stat: 'def', amount: 2, price: 0, icon: '🛡️' },
  wardSeed: { name: 'Ward Seed', desc: 'RES +2.', stat: 'res', amount: 2, price: 0, icon: '✨' },
  swiftSeed: { name: 'Swift Seed', desc: 'SPD +2.', stat: 'spd', amount: 2, price: 0, icon: '🪶' },
  skillSeed: { name: 'Skill Seed', desc: 'SKL +2.', stat: 'skl', amount: 2, price: 0, icon: '🎯' },
};

export function itemInfo(id) {
  return ITEMS[id] || WEAPONS[id] || null;
}
export function isWeapon(id) { return !!WEAPONS[id]; }

/** Shop stock per chapter index (0-based chapter about to be played). */
export function shopStock(chapterIndex) {
  const items = ['herb', 'ether'];
  if (chapterIndex >= 2) items.push('potion');
  const weapons = ['ironSword', 'ironLance', 'shortBow', 'dagger', 'oakStaff', 'apprenticeRod'];
  if (chapterIndex >= 1) weapons.push('steelSword', 'javelin', 'steelLance', 'steelBow', 'stiletto');
  if (chapterIndex >= 2) weapons.push('longbow', 'arcaneRod', 'silverStaff');
  if (chapterIndex >= 3) weapons.push('silverSword', 'silverLance', 'silverBow');
  return { items, weapons };
}

/** Which weapon types each hero class family can wield (by class weapon type). */
export function canEquip(classWeaponType, weaponId) {
  const w = WEAPONS[weaponId];
  return !!w && w.type === classWeaponType;
}
