// The cast: one appearance spec per character, shared by the 3D model builder (gfx/characters.js)
// and the anime portrait generator (gfx/portraits.js) so both always match.
//
// look fields
//   kind     : 'humanoid' | 'wolf' | 'skeleton' | 'golem' | 'wraith' | 'wyrm'
//   gender   : 'm' | 'f'           body: 'slim' | 'normal' | 'heavy'
//   age      : 'young' | 'adult' | 'elder'  (every character is an adult, 18+)
//   skin     : hex                 eyes: { color, shape: 'bright'|'gentle'|'sharp'|'sleepy'|'fierce'|'cold' }
//   hair     : { style, color, shade, hint }  style: 'spiky'|'long'|'bob'|'ponytail'|'twintails'|'short'|
//              'messy'|'slick'|'mohawk'|'bald'|'braid'|'wild'|'sidecut'
//   facial   : optional array of 'beard'|'stubble'|'mustache'|'scar'|'eyepatch'|'mask'|'freckles'|'warpaint'
//   outfit   : { top, primary, secondary, trim, cape, scarf, belt, boots, pauldrons, crest }
//              top: 'lightArmor'|'heavyArmor'|'darkArmor'|'robe'|'priestRobe'|'mageRobe'|'leather'|
//                   'rogueGarb'|'furVest'|'cultistRobe'|'tunic'|'regalRobe'
//   headgear : null|'circlet'|'witchHat'|'hood'|'helmOpen'|'helmClosed'|'bandana'|'hornedCirclet'|'crown'|'cap'|'plumedHelm'
//   weapon   : 'sword'|'flameSword'|'greatsword'|'lance'|'axe'|'bow'|'longbow'|'staff'|'holyStaff'|'rod'|
//              'dagger'|'twinDaggers'|'claws'|'scythe'|'none'
//   blade / accent : weapon metal colour / weapon trim or gem colour
//   shield   : null | { color, trim }
//   mount    : null | { kind: 'wyvern', color, belly, wing, armor }
//   scale    : overall size multiplier (bosses ~1.15)
//   aura     : optional hex glow colour (bosses, undead)
// promotedLook : partial look merged over `look` after class change (deep merge of outfit / hair / mount)
// portrait  : { hint } — extra art direction for the 2D anime bust

export const CAST = {
  // ------------------------------------------------------------------ heroes
  kael: {
    name: 'Kael', fullName: 'Kael Ardent', title: 'Heir of the Emberwing', side: 'player',
    bio: 'Son of the last Emberwing captain. Earnest, brave and a little reckless.',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'normal', skin: 0xf6d3b9,
      hair: { style: 'spiky', color: 0xcf3b25, shade: 0x8a1d16, hint: 'spiky shonen-hero hair swept up and back, two long bangs framing the face, one ahoge' },
      eyes: { color: 0xf3a51c, shape: 'bright' },
      outfit: { top: 'lightArmor', primary: 0x2c4c9e, secondary: 0xe3e8f0, trim: 0xd9ab47, cape: 0xb3262f, scarf: 0xb3262f, belt: 0x5a3a22, boots: 0x4a3020 },
      headgear: null, weapon: 'sword', blade: 0xdfe7f2, accent: 0xd9ab47, shield: null,
    },
    promotedLook: { outfit: { pauldrons: true, cape: 0xc0262f, trim: 0xffc94d, crest: 'dragon' }, headgear: 'circlet', weapon: 'flameSword', blade: 0xffb347 },
    portrait: { hint: 'determined heroic look, crimson scarf around the neck, silver breastplate with a gold ember crest over a blue tunic' },
  },
  lyra: {
    name: 'Lyra', fullName: 'Lyra Sol', title: 'Cleric of the Dawn', side: 'player',
    bio: "Kael's childhood friend and a gifted healer. Gentle, but never backs down.",
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xfae3d4,
      hair: { style: 'long', color: 0xf1e2b0, shade: 0xc9b27a, hint: 'very long straight platinum-blonde hair to the waist, soft side locks, straight bangs' },
      eyes: { color: 0x4aa3e8, shape: 'gentle' },
      outfit: { top: 'priestRobe', primary: 0xf4f4f8, secondary: 0x3d6fc4, trim: 0xd9b24c, cape: null, belt: 0x3d6fc4, boots: 0xe8e2d4 },
      headgear: 'circlet', weapon: 'staff', blade: 0xf0e6c8, accent: 0x7fd8ff, shield: null,
    },
    promotedLook: { outfit: { cape: 0xfaf6ea, trim: 0xffd76a, pauldrons: false }, weapon: 'holyStaff', accent: 0xbff3ff },
    portrait: { hint: 'kind soft smile, white and gold cleric robe with blue sash, small sapphire circlet on the forehead' },
  },
  garrick: {
    name: 'Garrick', fullName: 'Garrick Stone', title: 'Veteran Lancer', side: 'player',
    bio: "Served beside Kael's father. Dry-humoured, unshakable, built like a castle gate.",
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'heavy', skin: 0xe2b48f,
      hair: { style: 'short', color: 0x6b4a2e, shade: 0x40291a, hint: 'short cropped brown hair, slightly greying temples' },
      facial: ['beard', 'scar'],
      eyes: { color: 0x6f8f6a, shape: 'sharp' },
      outfit: { top: 'heavyArmor', primary: 0x9aa6b5, secondary: 0x2d4f9c, trim: 0xc9a24a, cape: 0x2d4f9c, belt: 0x4a3322, boots: 0x55606e, pauldrons: true },
      headgear: null, weapon: 'lance', blade: 0xd6dde6, accent: 0x2d4f9c, shield: { color: 0x2d4f9c, trim: 0xc9a24a },
    },
    promotedLook: { headgear: 'plumedHelm', outfit: { primary: 0xb7c0cc, trim: 0xe0b955, crest: 'dragon' } },
    portrait: { hint: 'rugged mentor, short beard, scar across left eyebrow, steel pauldrons with a blue tabard, calm confident half-smile' },
  },
  fenn: {
    name: 'Fenn', fullName: 'Fenn Wilder', title: 'Hunter of the Whispering Woods', side: 'player',
    bio: 'A cocky woodland archer who never misses — or so he claims.',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'slim', skin: 0xf0c9a6,
      hair: { style: 'messy', color: 0x4f9a3c, shade: 0x2d5e22, hint: 'messy shaggy green hair with a few leaves stuck in it, long fringe over one eye' },
      eyes: { color: 0x5fcf6a, shape: 'sleepy' },
      facial: ['freckles'],
      outfit: { top: 'leather', primary: 0x7a5232, secondary: 0x3f6b35, trim: 0xc8b07a, cape: 0x3f6b35, belt: 0x4a3020, boots: 0x3e2a1a },
      headgear: 'hood', weapon: 'bow', blade: 0x8a5a2b, accent: 0xc8b07a, shield: null,
    },
    promotedLook: { weapon: 'longbow', outfit: { cape: 0x2f5a2a, trim: 0xe2c56a }, headgear: 'cap' },
    portrait: { hint: 'cheeky lopsided grin, green hood down on the shoulders, leather jerkin, freckles' },
  },
  vex: {
    name: 'Vex', fullName: 'Vex', title: 'Shadow of the Brigands', side: 'enemy',
    bio: 'A sharp-tongued thief riding with the bandits. Her loyalty has a price — or a reason.',
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xf3d0bf,
      hair: { style: 'sidecut', color: 0x1f1b2e, shade: 0x0d0b14, hint: 'short black hair with a long violet-streaked side bang over one eye, shaved-ish other side' },
      eyes: { color: 0xa86bff, shape: 'sharp' },
      outfit: { top: 'rogueGarb', primary: 0x3a2a4f, secondary: 0x1d1a26, trim: 0xa86bff, cape: null, scarf: 0x23202d, belt: 0x2b2233, boots: 0x1d1a26 },
      headgear: null, weapon: 'twinDaggers', blade: 0xc9d1e0, accent: 0xa86bff, shield: null,
    },
    promotedLook: { headgear: 'hood', outfit: { cape: 0x2a1f3a, trim: 0xc59bff } },
    portrait: { hint: 'smirking, dark scarf pulled down under the chin, violet streak in black hair, small earring' },
  },
  mira: {
    name: 'Mira', fullName: 'Mira Vale', title: 'Prodigy of the Arcane', side: 'player',
    bio: 'The youngest of the company: a spell prodigy with a big hat and a bigger ego.',
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xfbe5d8,
      hair: { style: 'twintails', color: 0x9b5de5, shade: 0x5e2f9b, hint: 'long purple twin-tails tied with gold ribbons, blunt bangs' },
      eyes: { color: 0xff4fa3, shape: 'bright' },
      outfit: { top: 'mageRobe', primary: 0x5b2a86, secondary: 0x1f1530, trim: 0xf2c14e, cape: 0x2a1745, belt: 0xf2c14e, boots: 0x2a1745 },
      headgear: 'witchHat', weapon: 'rod', blade: 0x6b4a2e, accent: 0xff7a3d, shield: null,
    },
    promotedLook: { outfit: { cape: 0x1b1240, trim: 0xffd86b }, accent: 0x9ff0ff },
    portrait: { hint: 'proud confident smirk, oversized purple witch hat with a gold band and star pin, purple robe with gold trim' },
  },
  sora: {
    name: 'Sora', fullName: 'Sora Tempest', title: 'Last Wyvern Rider', side: 'player',
    bio: 'The final rider of the old Emberwing aerie, imprisoned with her wyvern Cinder.',
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xf5d5c0,
      hair: { style: 'bob', color: 0x3fa7e0, shade: 0x1f6a9e, hint: 'short sky-blue bob, windswept, a single thin braid at the side' },
      eyes: { color: 0x6fe0ff, shape: 'fierce' },
      outfit: { top: 'lightArmor', primary: 0xe9f1f6, secondary: 0x2d8fb3, trim: 0xd9b55a, cape: 0x2d8fb3, scarf: null, belt: 0x5a3a22, boots: 0x31495e },
      headgear: 'circlet', weapon: 'lance', blade: 0xdce6ee, accent: 0x2d8fb3, shield: null,
      mount: { kind: 'wyvern', color: 0xc8432b, belly: 0xf1c27d, wing: 0x8c2a1c, armor: null },
    },
    promotedLook: { outfit: { pauldrons: true, trim: 0xffd76a }, mount: { kind: 'wyvern', color: 0xd14a2c, belly: 0xffd08a, wing: 0x9c2c1c, armor: 0xd9b55a } },
    portrait: { hint: 'fierce determined look, windswept blue bob, light white-and-teal armor with feathered gold trim' },
  },

  // ------------------------------------------------------------------ villains / bosses
  gorran: {
    name: 'Gorran', fullName: 'Gorran the Red', title: 'Bandit Chief', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'heavy', skin: 0xd59a72, scale: 1.12,
      hair: { style: 'mohawk', color: 0xb8401f, shade: 0x7a2410, hint: 'red mohawk' },
      facial: ['beard', 'warpaint'],
      eyes: { color: 0xc94a2a, shape: 'fierce' },
      outfit: { top: 'furVest', primary: 0x6b4a30, secondary: 0x8a2c22, trim: 0xb08a50, belt: 0x3a2618, boots: 0x3a2618, pauldrons: true },
      headgear: null, weapon: 'axe', blade: 0xb9c1cc, accent: 0x8a2c22, shield: null,
    },
    portrait: { hint: 'huge brutish grin, red braided beard, war paint stripes, fur mantle' },
  },
  rask: {
    name: 'Rask', fullName: 'Rask the Houndmaster', title: 'Wolf-Tamer', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'normal', skin: 0xc99a7a, scale: 1.08,
      hair: { style: 'ponytail', color: 0x8d8d96, shade: 0x55555e, hint: 'grey hair tied in a rough low ponytail' },
      facial: ['eyepatch', 'stubble'],
      eyes: { color: 0xe3c04a, shape: 'sharp' },
      outfit: { top: 'leather', primary: 0x4b3a2c, secondary: 0x6e6e6e, trim: 0x9a7b4f, cape: 0x5c4b3b, belt: 0x2e2218, boots: 0x2e2218 },
      headgear: null, weapon: 'axe', blade: 0xb0b8c2, accent: 0x9a7b4f, shield: null,
    },
    portrait: { hint: 'wolf-pelt hood on shoulders, eyepatch, feral grin' },
  },
  draven: {
    name: 'Draven', fullName: 'Lieutenant Draven', title: 'Obsidian Lieutenant', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'normal', skin: 0xeccbb5, scale: 1.08,
      hair: { style: 'slick', color: 0x22222c, shade: 0x101016, hint: 'slicked-back black hair, a few loose strands' },
      eyes: { color: 0xd23a3a, shape: 'cold' },
      outfit: { top: 'darkArmor', primary: 0x2a2a33, secondary: 0x8c1d26, trim: 0xb59a5a, cape: 0x8c1d26, belt: 0x1d1d22, boots: 0x1d1d22, pauldrons: true },
      headgear: null, weapon: 'lance', blade: 0xc8ced8, accent: 0x8c1d26, shield: null,
    },
    portrait: { hint: 'arrogant cold sneer, black-and-crimson Obsidian Empire armor with high collar' },
  },
  varga: {
    name: 'Varga', fullName: 'Commander Varga', title: 'Iron Warden of Ashkeep', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'f', age: 'adult', body: 'normal', skin: 0xe8c3a8, scale: 1.12,
      hair: { style: 'short', color: 0xd6d9e0, shade: 0x9097a3, hint: 'short silver undercut hair' },
      facial: ['scar'],
      eyes: { color: 0xff8a3a, shape: 'fierce' },
      outfit: { top: 'darkArmor', primary: 0x30303a, secondary: 0xa8242c, trim: 0xd1a54a, cape: 0xa8242c, belt: 0x1d1d22, boots: 0x22222a, pauldrons: true, crest: 'obsidian' },
      headgear: null, weapon: 'greatsword', blade: 0xd0d6de, accent: 0xa8242c, shield: null,
    },
    portrait: { hint: 'stern battle-hardened female commander, scar across cheek, spiked black pauldrons, crimson cape' },
  },
  selene: {
    name: 'Selene', fullName: 'Selene the Hex', title: 'Witch of the Sands', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xf2e1e6, scale: 1.1, aura: 0x9b3dff,
      hair: { style: 'long', color: 0x1b1626, shade: 0x0b0910, hint: 'very long straight black hair with purple sheen' },
      eyes: { color: 0xff3355, shape: 'cold' },
      outfit: { top: 'regalRobe', primary: 0x2c1640, secondary: 0x0f0a16, trim: 0xb38cff, cape: 0x1a0f29, belt: 0xb38cff, boots: 0x0f0a16 },
      headgear: 'hornedCirclet', weapon: 'scythe', blade: 0xb6a8d6, accent: 0x9b3dff, shield: null,
    },
    portrait: { hint: 'cold, elegant villain smile, pale skin, horned silver circlet, deep purple robes' },
  },
  malzaar: {
    name: 'Malzaar', fullName: 'Chancellor Malzaar', title: 'Voice of the Gloom', side: 'enemy',
    look: {
      kind: 'humanoid', gender: 'm', age: 'elder', body: 'slim', skin: 0xd9c9bf, scale: 1.15, aura: 0xffc23d,
      hair: { style: 'long', color: 0xe8e4dc, shade: 0xa8a39a, hint: 'long white hair swept back' },
      facial: ['beard'],
      eyes: { color: 0xffc23d, shape: 'cold' },
      outfit: { top: 'regalRobe', primary: 0x1c1a2a, secondary: 0x5e1a1a, trim: 0xe0b44a, cape: 0x14121f, belt: 0xe0b44a, boots: 0x14121f },
      headgear: 'crown', weapon: 'rod', blade: 0x3a2a1a, accent: 0xffc23d, shield: null,
    },
    portrait: { hint: 'gaunt elderly sorcerer-chancellor, sharp cheekbones, long white hair and beard, glowing golden eyes, tall high collar with gold filigree' },
  },
  nidhvar: {
    name: 'Nidhvar', fullName: 'Nidhvar, the Gloom Wyrm', title: 'Devourer of Dawn', side: 'enemy',
    look: { kind: 'wyrm', color: 0x1d1a2b, belly: 0x3b2f4f, glow: 0xb04dff, horn: 0xe8dcc0, scale: 1.0, aura: 0x9b3dff },
    portrait: { hint: 'colossal black dragon head, violet glowing eyes and cracks, golden horns' },
  },
  elder: {
    name: 'Elder Brann', fullName: 'Elder Brann', title: 'Elder of Brightwater', side: 'ally',
    look: {
      kind: 'humanoid', gender: 'm', age: 'elder', body: 'normal', skin: 0xe6c2a4,
      hair: { style: 'bald', color: 0xdedede, shade: 0xaaaaaa, hint: 'bald top, white side hair' },
      facial: ['beard', 'mustache'],
      eyes: { color: 0x6b8fb0, shape: 'gentle' },
      outfit: { top: 'robe', primary: 0x7a6a4a, secondary: 0xd8cfb8, trim: 0x9a8a5a, belt: 0x4a3a22, boots: 0x4a3a22 },
      headgear: null, weapon: 'staff', blade: 0x7a5a3a, accent: 0x9a8a5a, shield: null,
    },
    portrait: { hint: 'kindly old village elder with a long white beard, worried eyes' },
  },
};

// ------------------------------------------------------------------ generic enemies (no names)
export const GENERIC = {
  bandit: {
    name: 'Bandit',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'heavy', skin: 0xd8a47e,
      hair: { style: 'messy', color: 0x5a3b25, shade: 0x3a2516 }, facial: ['stubble'],
      eyes: { color: 0x6b4a2a, shape: 'fierce' },
      outfit: { top: 'furVest', primary: 0x7a5a3a, secondary: 0x9a3a2a, trim: 0x8a7a5a, belt: 0x3a2618, boots: 0x3a2618 },
      headgear: 'bandana', weapon: 'axe', blade: 0xaab2bc, accent: 0x9a3a2a, shield: null,
    },
  },
  banditArcher: {
    name: 'Brigand Archer',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'slim', skin: 0xe0b08a,
      hair: { style: 'short', color: 0x3a2a1a, shade: 0x22180e },
      eyes: { color: 0x5a4a2a, shape: 'sharp' }, facial: ['mask'],
      outfit: { top: 'leather', primary: 0x6a5238, secondary: 0x8a3a2a, trim: 0x7a6a4a, cape: 0x5a4430, belt: 0x3a2618, boots: 0x3a2618 },
      headgear: 'hood', weapon: 'bow', blade: 0x6a4a2a, accent: 0x8a3a2a, shield: null,
    },
  },
  soldier: {
    name: 'Obsidian Soldier',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'normal', skin: 0xe6c0a2,
      hair: { style: 'short', color: 0x2a2a2a, shade: 0x151515 },
      eyes: { color: 0x5a5a6a, shape: 'sharp' },
      outfit: { top: 'darkArmor', primary: 0x3a3a45, secondary: 0x8c1d26, trim: 0x8a7a5a, cape: null, belt: 0x1d1d22, boots: 0x22222a },
      headgear: 'helmOpen', weapon: 'lance', blade: 0xc0c7d0, accent: 0x8c1d26, shield: { color: 0x2a2a33, trim: 0x8c1d26 },
    },
  },
  imperialArcher: {
    name: 'Obsidian Archer',
    look: {
      kind: 'humanoid', gender: 'f', age: 'young', body: 'slim', skin: 0xf0cdb5,
      hair: { style: 'ponytail', color: 0x3a2a22, shade: 0x1e1612 },
      eyes: { color: 0x7a5a4a, shape: 'sharp' },
      outfit: { top: 'leather', primary: 0x33333d, secondary: 0x8c1d26, trim: 0x8a7a5a, cape: 0x8c1d26, belt: 0x1d1d22, boots: 0x22222a },
      headgear: 'cap', weapon: 'bow', blade: 0x3a2a22, accent: 0x8c1d26, shield: null,
    },
  },
  knight: {
    name: 'Obsidian Knight',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'heavy', skin: 0xe0b896,
      hair: { style: 'short', color: 0x2a2a2a, shade: 0x151515 },
      eyes: { color: 0xff4a3a, shape: 'cold' },
      outfit: { top: 'heavyArmor', primary: 0x2c2c36, secondary: 0x8c1d26, trim: 0xa08850, cape: 0x8c1d26, belt: 0x1d1d22, boots: 0x22222a, pauldrons: true },
      headgear: 'helmClosed', weapon: 'lance', blade: 0xc8ced8, accent: 0x8c1d26, shield: { color: 0x22222a, trim: 0xa08850 },
    },
  },
  darkMage: {
    name: 'Dark Mage',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'slim', skin: 0xcfc0c8, aura: 0x8a3dff,
      hair: { style: 'long', color: 0x2a1f33, shade: 0x150f1a },
      eyes: { color: 0xc04dff, shape: 'cold' },
      outfit: { top: 'mageRobe', primary: 0x2a1a3a, secondary: 0x140d1c, trim: 0x8a5ac0, cape: 0x1d1229, belt: 0x8a5ac0, boots: 0x140d1c },
      headgear: 'hood', weapon: 'rod', blade: 0x2a1f22, accent: 0xb04dff, shield: null,
    },
  },
  warPriest: {
    name: 'War Priest',
    look: {
      kind: 'humanoid', gender: 'f', age: 'adult', body: 'normal', skin: 0xeccab4,
      hair: { style: 'braid', color: 0x6a2a2a, shade: 0x3e1515 },
      eyes: { color: 0x9a6a4a, shape: 'gentle' },
      outfit: { top: 'priestRobe', primary: 0x2a2a33, secondary: 0x8c1d26, trim: 0xc9a24a, cape: null, belt: 0x8c1d26, boots: 0x22222a },
      headgear: 'hood', weapon: 'staff', blade: 0x4a3a2a, accent: 0xff5a5a, shield: null,
    },
  },
  cultist: {
    name: 'Gloom Cultist',
    look: {
      kind: 'humanoid', gender: 'm', age: 'adult', body: 'normal', skin: 0xbfb0b8, aura: 0xffb23d,
      hair: { style: 'bald', color: 0x222222, shade: 0x111111 }, facial: ['mask'],
      eyes: { color: 0xffb23d, shape: 'cold' },
      outfit: { top: 'cultistRobe', primary: 0x6a1420, secondary: 0x1a0c10, trim: 0xd4a43a, cape: 0x3a0a12, belt: 0xd4a43a, boots: 0x1a0c10 },
      headgear: 'hood', weapon: 'dagger', blade: 0xd4a43a, accent: 0xffb23d, shield: null,
    },
  },
  wyvernKnight: {
    name: 'Obsidian Wyvern Knight',
    look: {
      kind: 'humanoid', gender: 'm', age: 'young', body: 'normal', skin: 0xe6c0a2,
      hair: { style: 'short', color: 0x2a2a2a, shade: 0x151515 },
      eyes: { color: 0xd23a3a, shape: 'cold' },
      outfit: { top: 'darkArmor', primary: 0x30303a, secondary: 0x8c1d26, trim: 0xa08850, cape: 0x8c1d26, belt: 0x1d1d22, boots: 0x22222a, pauldrons: true },
      headgear: 'helmOpen', weapon: 'lance', blade: 0xc8ced8, accent: 0x8c1d26, shield: null,
      mount: { kind: 'wyvern', color: 0x2f3a33, belly: 0x8a8a6a, wing: 0x1e2621, armor: 0x5a1218 },
    },
  },
  wolf: { name: 'Dire Wolf', look: { kind: 'wolf', color: 0x6b6f7a, belly: 0xbfc3cc, eyes: 0xffd04a, scale: 1.0 } },
  skeleton: { name: 'Skeleton', look: { kind: 'skeleton', color: 0xe9e2cf, eyes: 0x6ff0ff, weapon: 'sword', shield: { color: 0x5a4a3a, trim: 0x8a7a5a }, aura: 0x6ff0ff } },
  wraith: { name: 'Wraith', look: { kind: 'wraith', color: 0x2a2440, glow: 0x8affd8, eyes: 0x8affd8, weapon: 'claws', aura: 0x8affd8 } },
  golem: { name: 'Sand Golem', look: { kind: 'golem', color: 0xc9a66b, rune: 0x5ff0ff, eyes: 0x5ff0ff, scale: 1.0 } },
  goldGolem: { name: 'Gilded Golem', look: { kind: 'golem', color: 0xe0b44a, rune: 0xff6a3a, eyes: 0xff6a3a, scale: 1.08 } },
};

/** Deep-merge helper for promotedLook. */
export function mergeLook(base, over) {
  if (!over) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null) out[k] = mergeLook(base[k], v);
    else out[k] = v;
  }
  return out;
}

/** Resolve the look for a cast id or generic id. */
export function lookFor(id, promoted = false) {
  const c = CAST[id] || GENERIC[id];
  if (!c) return null;
  return promoted && c.promotedLook ? mergeLook(c.look, c.promotedLook) : c.look;
}
