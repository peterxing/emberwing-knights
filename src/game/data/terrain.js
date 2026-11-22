// Terrain rules shared by gameplay (movement/defence) and rendering (world builder).
// Map tile (x, y) occupies world [x, x+1] x [y, y+1] on the XZ plane; grid y maps to world +Z.
// A tile's walkable surface is at world Y = level * H_UNIT.

export const H_UNIT = 0.4; // world units per height level
export const WATER_Y = 0.22; // water surface height (just below a level-1 tile top at 0.4)
export const LAVA_Y = 0.16;
export const MAX_STEP = 2; // ground units cannot move between tiles whose levels differ by more than this

const INF = Infinity;
// movement cost per move type: foot (infantry, mages, archers), armor (heavy), beast (wolves), flying
const C = (foot, armor, beast, flying = 1) => ({ foot, armor, beast, flying });

/**
 * id        : stable identifier used by renderers
 * name      : UI name
 * cost      : movement cost per move type (Infinity = impassable)
 * def / avo : defence bonus (flat) and avoid bonus (%)
 * heal      : % max HP restored at the start of the owner's phase
 * level     : default height level
 * visit     : can be "visited" (villages)
 * blocksSight: tall obstacle (pillars/walls) — purely visual hint
 */
export const TERRAIN = {
  '.': { id: 'grass', name: 'Plains', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  '"': { id: 'meadow', name: 'Meadow', cost: C(1, 1, 1), def: 0, avo: 5, level: 1 },
  ',': { id: 'road', name: 'Road', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'B': { id: 'paved', name: 'Cobblestone', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'Y': { id: 'bush', name: 'Thicket', cost: C(2, 2, 1), def: 0, avo: 10, level: 1 },
  'F': { id: 'forest', name: 'Forest', cost: C(2, 3, 1), def: 1, avo: 20, level: 1 },
  'P': { id: 'pines', name: 'Pine Woods', cost: C(2, 3, 1), def: 1, avo: 20, level: 1 },
  'H': { id: 'hill', name: 'Hill', cost: C(2, 3, 2), def: 1, avo: 15, level: 2 },
  'M': { id: 'mountain', name: 'Mountain', cost: C(3, INF, 3), def: 2, avo: 30, level: 3 },
  'K': { id: 'cliff', name: 'Crag', cost: C(INF, INF, INF, INF), def: 0, avo: 0, level: 5, blocksSight: true },
  '~': { id: 'water', name: 'River', cost: C(INF, INF, INF), def: 0, avo: 0, level: 0 },
  '=': { id: 'bridge', name: 'Bridge', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'S': { id: 'sand', name: 'Sand', cost: C(2, 3, 2), def: 0, avo: 5, level: 1 },
  'D': { id: 'dune', name: 'Dune', cost: C(3, 4, 2), def: 1, avo: 10, level: 2 },
  '#': { id: 'wall', name: 'Wall', cost: C(INF, INF, INF, INF), def: 0, avo: 0, level: 4, blocksSight: true },
  'C': { id: 'floor', name: 'Stone Floor', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'c': { id: 'carpet', name: 'Carpet', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'T': { id: 'throne', name: 'Throne', cost: C(1, 1, 1), def: 2, avo: 20, heal: 10, level: 1 },
  'G': { id: 'gate', name: 'Gate', cost: C(1, 1, 1), def: 1, avo: 15, heal: 10, level: 1 },
  'W': { id: 'fort', name: 'Fort', cost: C(1, 1, 1), def: 1, avo: 15, heal: 10, level: 1 },
  'V': { id: 'village', name: 'Village', cost: C(1, 1, 1), def: 1, avo: 10, level: 1, visit: true },
  'h': { id: 'house', name: 'House', cost: C(INF, INF, INF, INF), def: 0, avo: 0, level: 1, blocksSight: true },
  'R': { id: 'ruins', name: 'Ruins', cost: C(2, 2, 2), def: 1, avo: 15, level: 1 },
  'O': { id: 'pillar', name: 'Pillar', cost: C(INF, INF, INF, INF), def: 0, avo: 0, level: 1, blocksSight: true },
  'L': { id: 'lava', name: 'Lava', cost: C(INF, INF, INF, 1), def: 0, avo: 0, level: 0 },
  'g': { id: 'gold', name: 'Gilded Floor', cost: C(1, 1, 1), def: 0, avo: 0, level: 1 },
  'A': { id: 'altar', name: 'Altar', cost: C(1, 1, 1), def: 1, avo: 10, heal: 10, level: 2 },
  'X': { id: 'chasm', name: 'Chasm', cost: C(INF, INF, INF, 1), def: 0, avo: 0, level: -2 },
};

/** Map props that physically occupy their tile (impassable for everyone). */
export const PROP_BLOCKS = new Set([
  'tent', 'campfire', 'statue', 'well', 'cart', 'crate', 'barrel', 'brazier', 'obelisk', 'goldenStatue',
  'crystal', 'haystack', 'windmill', 'tree', 'deadTree', 'palm', 'rock', 'boulder', 'brokenPillar',
]);

export function terrainChar(mapDef, x, y) {
  if (x < 0 || y < 0 || x >= mapDef.width || y >= mapDef.height) return null;
  const row = mapDef.tiles[y];
  return row ? row[x] || '.' : '.';
}

export function terrainAt(mapDef, x, y) {
  const ch = terrainChar(mapDef, x, y);
  return ch == null ? null : TERRAIN[ch] || TERRAIN['.'];
}

/**
 * Deterministic height levels for every tile: heights[y][x].
 * mapDef.heights (optional) = array of strings; a digit 0-9 overrides the level, any other char = default.
 * Mountains become level 4 when 3+ orthogonal neighbours are also mountains.
 */
export function resolveHeights(mapDef) {
  const { width: W, height: H } = mapDef;
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = new Array(W);
    for (let x = 0; x < W; x++) {
      const ch = terrainChar(mapDef, x, y);
      const t = TERRAIN[ch] || TERRAIN['.'];
      let lv = t.level;
      if (ch === 'M') {
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (terrainChar(mapDef, x + dx, y + dy) === 'M') n++;
        if (n >= 3) lv = 4;
      }
      const hr = mapDef.heights && mapDef.heights[y];
      if (hr && hr[x] >= '0' && hr[x] <= '9') lv = +hr[x];
      row[x] = lv;
    }
    out.push(row);
  }
  return out;
}

/** World-space Y of the walkable surface of a tile (water/lava return their liquid surface). */
export function surfaceY(mapDef, heights, x, y) {
  const ch = terrainChar(mapDef, x, y);
  if (ch === '~') return WATER_Y;
  if (ch === 'L') return LAVA_Y;
  if (ch === 'X') return -0.2;
  return heights[y][x] * H_UNIT;
}
