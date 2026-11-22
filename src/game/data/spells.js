// Spells and skills. kind: 'magic' (MAG vs RES), 'physical' (STR vs DEF, weapon-like skill), 'heal'.
// target: 'enemy' | 'ally' | 'self'   area: radius (Manhattan) around the target tile (0 = single)
// fx: VFX spell name used by the cutscene / map effects.

export const SPELLS = {
  heal: { name: 'Heal', kind: 'heal', mp: 4, power: 12, range: [1, 1], target: 'ally', fx: 'heal', desc: 'Restore HP to an adjacent ally.' },
  cure: { name: 'Cure', kind: 'heal', mp: 7, power: 22, range: [1, 2], target: 'ally', fx: 'heal', desc: 'Restore a lot of HP from up to 2 tiles away.' },
  nova: { name: 'Sanctuary', kind: 'heal', mp: 12, power: 16, range: [0, 0], area: 2, target: 'self', fx: 'healAll', desc: 'Heal every ally within 2 tiles.' },
  holy: { name: 'Holy Light', kind: 'magic', element: 'holy', mp: 5, power: 7, hit: 90, range: [1, 2], target: 'enemy', fx: 'holy', bonusVs: 'undead', desc: 'Searing light. Double damage to the undead.' },

  flame: { name: 'Flame', kind: 'magic', element: 'fire', mp: 4, power: 7, hit: 90, range: [1, 2], target: 'enemy', fx: 'flame', desc: 'Hurl a ball of fire.' },
  frost: { name: 'Frost Spear', kind: 'magic', element: 'ice', mp: 6, power: 10, hit: 85, range: [1, 2], target: 'enemy', fx: 'frost', desc: 'Ice erupts beneath the foe.' },
  bolt: { name: 'Thunderbolt', kind: 'magic', element: 'thunder', mp: 9, power: 13, hit: 80, range: [1, 3], target: 'enemy', fx: 'bolt', desc: 'Call lightning from the sky. Long range.' },
  inferno: { name: 'Inferno', kind: 'magic', element: 'fire', mp: 13, power: 13, hit: 85, range: [1, 3], area: 1, target: 'enemy', fx: 'inferno', desc: 'A pillar of flame that engulfs neighbouring foes.' },
  blizzard: { name: 'Blizzard', kind: 'magic', element: 'ice', mp: 14, power: 15, hit: 85, range: [1, 2], area: 1, target: 'enemy', fx: 'blizzard', desc: 'A freezing storm over an area.' },
  tempest: { name: 'Tempest', kind: 'magic', element: 'thunder', mp: 18, power: 20, hit: 80, range: [1, 3], target: 'enemy', fx: 'tempest', desc: 'The sky itself answers.' },

  dragonFang: { name: 'Dragon Fang', kind: 'physical', mp: 6, power: 9, hit: 10, range: [1, 1], target: 'enemy', fx: 'dragonFang', desc: 'A flame-wreathed strike: STR + 9 might, +10 hit.' },

  darkBolt: { name: 'Shadow Bolt', kind: 'magic', element: 'dark', mp: 4, power: 7, hit: 85, range: [1, 2], target: 'enemy', fx: 'dark', desc: 'A bolt of gloom.' },
  drain: { name: 'Drain', kind: 'magic', element: 'dark', mp: 8, power: 9, hit: 80, range: [1, 2], target: 'enemy', fx: 'drain', drain: true, desc: 'Steal life from the target.' },
  breath: { name: 'Gloom Breath', kind: 'magic', element: 'dark', mp: 0, power: 14, hit: 90, range: [1, 3], area: 1, target: 'enemy', fx: 'breath', desc: 'Violet dragonfire.' },
};

export const COUNTER_SPELL_ORDER = ['flame', 'darkBolt', 'holy'];
