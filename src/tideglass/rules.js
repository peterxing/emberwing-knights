/**
 * Tideglass chapter, v1. The board uses zero-based (x, y), with (0, 0) at the top left.
 * newGame() and successful act() results are plain JSON snapshots. Render from them;
 * submit commands rather than editing them. Persist with JSON.stringify(state).
 * clues contains site keys in discovery order; ward contains "x,y" keys fixed to the
 * board until the surge. log is a plain-text journal, oldest entry first (max 41).
 * Display as many lines as needed, but persist the full journal: readSave verifies it.
 */
export const COLS = 7;
export const ROWS = 4;
export const MAX_ROUND = 8;

export const SITES = Object.freeze({
  crest: Object.freeze({ name: 'Heron Crest', x: 0, y: 0, clue: 'The heron has no painted eye. A pinhole lets a single star of light through.' }),
  rose: Object.freeze({ name: 'Compass Rose', x: 3, y: 1, clue: 'Only the west petal is mirror-bright. It turns the star toward the lock.' }),
  waylight: Object.freeze({ name: 'Waylight', x: 6, y: 0, clue: 'A lamp still burns under the salt. Its shutter fits the crest like a second eyelid.' }),
  lock: Object.freeze({ name: 'Tideglass Lock', x: 0, y: 2, clue: 'No keyhole, just a glass eye. Bring the three readings here and let Iria signal.' }),
});

const UNITS = ['iria', 'drake'];
const READINGS = ['crest', 'rose', 'waylight'];
const NAME = { iria: 'Iria', drake: 'Drake' };
const AP = 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cellKey = (x, y) => `${x},${y}`;
const onBoard = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < COLS && y < ROWS;
const at = (cell, x, y) => cell.x === x && cell.y === y;
const near = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
const partner = (id) => id === 'iria' ? 'drake' : 'iria';

export function newGame() {
  return {
    version: 1, round: 1, phase: 'playing', active: 'iria',
    units: { iria: { x: 1, y: 3, hp: 3, ap: AP }, drake: { x: 4, y: 2, hp: 3, ap: AP } },
    clues: [], ward: [],
    log: ['Low water. Read the Heron Crest, Compass Rose and Waylight; signal the lock before the eighth bell.'],
  };
}

/** Fresh {x,y} destinations for 1 AP: Iria walks 1–2 steps, the drake flies 1–3. A downed partner still blocks landing. */
export function legalMoves(state) {
  const { active, units } = state;
  const unit = units[active];
  if (state.phase !== 'playing' || !unit.hp || !unit.ap) return [];
  const flying = active === 'drake';
  const range = flying ? 3 : 2;
  const seen = new Set([cellKey(unit.x, unit.y)]);
  const queue = [[unit.x, unit.y, 0]];
  const moves = [];
  for (let i = 0; i < queue.length; i++) {
    const [x, y, distance] = queue[i];
    if (distance === range) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const key = cellKey(nx, ny);
      if (!onBoard(nx, ny) || seen.has(key)) continue;
      seen.add(key);
      const blocked = at(SITES.lock, nx, ny) || at(units[partner(active)], nx, ny);
      if (!blocked) moves.push({ x: nx, y: ny });
      if (!blocked || flying) queue.push([nx, ny, distance + 1]);
    }
  }
  return moves;
}

/** Fresh {x,y} cells struck by this round's end: 1 damage per unwarded occupant. No surge after game over. */
export function forecast(state) {
  const cells = [];
  if (state.phase === 'playing') {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        // Three diagonal channels. Each bell shifts the breaking wave one cell west.
        if ((x + y + state.round - 1) % 3 === 0) cells.push({ x, y });
      }
    }
  }
  return cells;
}

function copyState(state) {
  return {
    ...state, units: { iria: { ...state.units.iria }, drake: { ...state.units.drake } },
    clues: [...state.clues], ward: [...state.ward], log: [...state.log],
  };
}

// These headings and their text form the v1 save journal; never accept arbitrary imported prose.
const SEPARATOR = ' — ';
function heading(id, command) {
  switch (command.type) {
    case 'move': return `${NAME[id]} moves to (${command.x}, ${command.y})`;
    case 'inspect': return `${NAME[id]} reads the ${SITES[command.site].name}`;
    case 'ward': return 'Drake spreads a wing-ward';
    case 'signal': return 'Iria signals the Tideglass Lock';
    case 'end': return 'The tide turns';
  }
}

function record(next, id, command, detail) {
  const title = heading(id, command);
  const message = detail ? title + SEPARATOR + detail : title;
  next.log.push(message);
  return { ok: true, state: next, message };
}

function endRound(next) {
  const wave = forecast(next);
  const effects = [];
  for (const id of UNITS) {
    const u = next.units[id];
    if (!u.hp || !wave.some((cell) => at(cell, u.x, u.y))) continue;
    if (next.ward.includes(cellKey(u.x, u.y))) {
      effects.push(`The ward shelters ${NAME[id]}.`);
    } else {
      u.hp--;
      effects.push(`${NAME[id]} loses 1 HP${u.hp ? ` (${u.hp} left)` : ' and is incapacitated'}.`);
    }
  }
  if (!effects.length) effects.push('The wave passes without harm.');
  const bell = next.round;
  next.ward = [];
  next.active = 'iria';
  if (next.units.iria.hp === 0 || bell === MAX_ROUND) {
    next.phase = 'lost';
    effects.push(!next.units.iria.hp ? 'Iria cannot reach the shutter.' : 'The eighth bell sounds. The lock slips below the tide.');
  } else {
    next.round++;
    effects.push(`Round ${next.round} begins.`);
  }
  for (const u of Object.values(next.units)) u.ap = next.phase === 'playing' && u.hp > 0 ? AP : 0;
  return record(next, null, { type: 'end' }, `Bell ${bell}. ${effects.join(' ')}`);
}

const FIELDS = { select: ['unit'], move: ['x', 'y'], inspect: ['site'], ward: [], signal: [], end: [] };

/**
 * act(state, command) -> {ok, state, message}; a refusal returns the exact input snapshot.
 * {type:'select', unit:'iria'|'drake'} is free (even at 0 AP), never ends a round.
 * {type:'move', x, y}, {type:'inspect', site:'crest'|'rose'|'waylight'}, {type:'ward'}
 * and {type:'signal'} each cost the active unit 1 AP on success. Only the drake wards;
 * only Iria signals. {type:'end'} resolves the preview, clears wards and refocuses Iria.
 * Living units refresh to 2 AP next round. Round 8 is playable up to its final surge.
 */
export function act(state, command) {
  const deny = (message) => ({ ok: false, state, message });
  if (state.phase !== 'playing') return deny('The chapter is over.');
  if (!command || typeof command !== 'object' || Array.isArray(command) || !Object.hasOwn(command, 'type')
      || typeof command.type !== 'string' || !Object.hasOwn(FIELDS, command.type)) return deny('Unknown chapter command.');
  const { type } = command;
  const fields = FIELDS[type];
  if (Object.keys(command).length !== fields.length + 1 || !fields.every((k) => Object.hasOwn(command, k))) {
    return deny(`Expected ${['type', ...fields].join(', ')} for the ${type} command.`);
  }
  if (type === 'select') {
    const { unit } = command;
    if (!UNITS.includes(unit)) return deny('Select Iria or the drake.');
    if (!state.units[unit].hp) return deny(`${NAME[unit]} is incapacitated.`);
    return { ok: true, state: { ...state, active: unit }, message: `${NAME[unit]} selected.` };
  }
  const next = copyState(state);
  if (type === 'end') return endRound(next);
  const id = next.active, u = next.units[id];
  if (!u.hp) return deny(`${NAME[id]} is incapacitated.`);
  if (!u.ap) return deny(`${NAME[id]} has no AP left. Switch units or end the round.`);

  let detail;
  switch (type) {
    case 'move': {
      const { x, y } = command;
      if (!onBoard(x, y)) return deny('Choose a board cell with whole-number coordinates.');
      if (at(u, x, y)) return deny(`${NAME[id]} is already there.`);
      if (at(SITES.lock, x, y)) return deny('The lock blocks that cell. Stand beside it instead.');
      if (at(next.units[partner(id)], x, y)) return deny('Your companion occupies that cell.');
      const landing = legalMoves(state).find((cell) => at(cell, x, y));
      if (!landing) return deny(id === 'iria' ? 'Iria needs a clear path of at most two steps.' : 'The drake can fly at most three steps.');
      Object.assign(u, landing);
      break;
    }
    case 'inspect': {
      const { site } = command;
      if (!READINGS.includes(site)) return deny('Inspect the crest, rose or waylight.');
      if (next.clues.includes(site)) return deny(`The ${SITES[site].name} reading is already recorded.`);
      if (!near(u, SITES[site])) return deny(`Stand on or orthogonally beside the ${SITES[site].name} to read it.`);
      next.clues.push(site);
      detail = SITES[site].clue;
      break;
    }
    case 'ward':
      if (id !== 'drake') return deny('Only the drake can lay a wing-ward.');
      for (const [dx, dy] of [[0, 0], ...DIRS]) {
        const x = u.x + dx, y = u.y + dy, key = cellKey(x, y);
        if (onBoard(x, y) && !next.ward.includes(key)) next.ward.push(key);
      }
      detail = 'This cell and its orthogonal neighbors are sheltered until the bell.';
      break;
    case 'signal':
      if (id !== 'iria') return deny('Only Iria can signal the lock.');
      if (!near(u, SITES.lock)) return deny('Stand Iria beside the Tideglass Lock to signal.');
      if (!READINGS.every((key) => next.clues.includes(key))) return deny('Read the crest, rose and waylight before signaling.');
      next.phase = 'won';
      detail = '“There. The light was the key.” The glass eye opens on the Tide Almanac.';
      break;
  }
  u.ap--;
  return record(next, id, command, detail);
}

// At most 4 paid actions and 1 surge per round. Free selections need no history:
// each paid action identifies its actor, and the final selection is stored as active.
const LOG_LIMIT = 1 + MAX_ROUND * (UNITS.length * AP + 1);
function indexHeadings() {
  const index = new Map();
  const add = (id, command) => index.set(heading(id, command), { id, command });
  for (const id of UNITS) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) add(id, { type: 'move', x, y });
    }
    for (const site of READINGS) add(id, { type: 'inspect', site });
  }
  add('drake', { type: 'ward' });
  add('iria', { type: 'signal' });
  add(null, { type: 'end' });
  return index;
}
const JOURNAL = indexHeadings();

// Compare only to engine-produced JSON, independent of object property order.
function sameSnapshot(expected, value) {
  if (expected === value) return true;
  if (!expected || !value || typeof expected !== 'object' || typeof value !== 'object'
      || Array.isArray(expected) !== Array.isArray(value)) return false;
  const keys = Object.keys(expected);
  return keys.length === Object.keys(value).length
    && keys.every((key) => Object.hasOwn(value, key) && sameSnapshot(expected[key], value[key]));
}

/** Load v1 JSON.stringify(state) or return null. Replay checks reachability, not just field ranges. */
export function readSave(raw) {
  if (typeof raw !== 'string' || raw.length > 32768) return null;
  let saved;
  try { saved = JSON.parse(raw); } catch { return null; }
  let state = newGame();
  if (!saved || saved.version !== 1 || !UNITS.includes(saved.active) || !Array.isArray(saved.log)
      || saved.log.length > LOG_LIMIT || saved.log[0] !== state.log[0]) return null;
  for (const line of saved.log.slice(1)) {
    if (typeof line !== 'string') return null;
    const entry = JOURNAL.get(line.split(SEPARATOR, 1)[0]);
    if (!entry) return null;
    if (entry.id && entry.id !== state.active) {
      const selected = act(state, { type: 'select', unit: entry.id });
      if (!selected.ok) return null;
      state = selected.state;
    }
    const result = act(state, entry.command);
    if (!result.ok || result.message !== line) return null;
    state = result.state;
  }
  if (saved.active !== state.active) {
    const selected = act(state, { type: 'select', unit: saved.active });
    if (!selected.ok) return null;
    state = selected.state;
  }
  return sameSnapshot(state, saved) ? state : null;
}
