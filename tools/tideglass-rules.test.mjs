// Run from the repository root: node --test tools/tideglass-rules.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, MAX_ROUND, SITES, newGame, act, legalMoves, forecast, readSave } from '../src/tideglass/rules.js';

// Canonical browser E2E route: only public commands, including a ward in the first surge.
const WINNING_ROUTE = [
  { type: 'move', x: 1, y: 1 }, { type: 'move', x: 0, y: 1 },
  { type: 'select', unit: 'drake' }, { type: 'move', x: 3, y: 0 }, { type: 'ward' }, { type: 'end' },
  { type: 'inspect', site: 'crest' }, { type: 'select', unit: 'drake' },
  { type: 'inspect', site: 'rose' }, { type: 'move', x: 6, y: 0 }, { type: 'end' },
  { type: 'select', unit: 'drake' }, { type: 'inspect', site: 'waylight' },
  { type: 'select', unit: 'iria' }, { type: 'signal' },
];

const move = (x, y) => ({ type: 'move', x, y });
const select = (unit) => ({ type: 'select', unit });
const inspect = (site) => ({ type: 'inspect', site });
const end = { type: 'end' }, ward = { type: 'ward' }, signal = { type: 'signal' };
const keys = (cells) => cells.map(({ x, y }) => `${x},${y}`).sort();

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

function step(state, command) {
  const result = act(freezeTree(state), freezeTree(command));
  assert.equal(result.ok, true, `${JSON.stringify(command)}: ${result.message}`);
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.trim());
  return result.state;
}

function refuse(state, command, reason = /\S/) {
  const result = act(freezeTree(state), freezeTree(command));
  assert.equal(result.ok, false, JSON.stringify(command));
  assert.strictEqual(result.state, state);
  assert.match(result.message, reason);
}

test('shared wire format: immutable sites, correct setup, independent plain JSON games', () => {
  assert.deepEqual([COLS, ROWS, MAX_ROUND], [7, 4, 8]);
  assert.ok(Object.isFrozen(SITES));
  assert.deepEqual(Object.keys(SITES).sort(), ['crest', 'lock', 'rose', 'waylight']);
  for (const [key, x, y] of [['crest', 0, 0], ['rose', 3, 1], ['waylight', 6, 0], ['lock', 0, 2]]) {
    const site = SITES[key];
    assert.ok(Object.isFrozen(site));
    assert.deepEqual([site.x, site.y], [x, y]);
    assert.ok(site.name.trim() && site.clue.trim());
  }
  const first = newGame(), second = newGame();
  assert.deepEqual(first, {
    version: 1, round: 1, phase: 'playing', active: 'iria',
    units: { iria: { x: 1, y: 3, hp: 3, ap: 2 }, drake: { x: 4, y: 2, hp: 3, ap: 2 } },
    clues: [], ward: [], log: [first.log[0]],
  });
  assert.ok(first.log[0].trim());
  assert.deepEqual(readSave(JSON.stringify(first)), first);
  first.units.iria.hp = 0;
  first.log.pop();
  assert.equal(second.units.iria.hp, 3);
  assert.equal(second.log.length, 1);
});

test('Iria walks up to two actual orthogonal steps; neither lock nor companion is a shortcut', () => {
  const start = newGame();
  assert.deepEqual(keys(legalMoves(start)), ['0,3', '1,1', '1,2', '2,2', '2,3', '3,3']);
  const corner = step(start, move(0, 3));
  refuse(corner, move(0, 2), /lock/i);
  refuse(corner, move(0, 1), /clear path/i);
  const blocked = [select('drake'), move(1, 2), select('iria')].reduce(step, start);
  refuse(blocked, move(1, 2), /occupies/i);
  refuse(blocked, move(1, 1), /clear path/i);
  assert.equal(step(blocked, move(2, 2)).units.iria.ap, 1); // there IS a path via (2,3)
});

test('drake flies up to three steps over either blocker, but cannot land on either', () => {
  let s = step(newGame(), select('drake'));
  assert.ok(keys(legalMoves(s)).includes('1,2'));
  refuse(s, move(0, 1), /three steps/i);
  s = step(s, move(2, 3));
  refuse(s, move(1, 3), /occupies/i);
  refuse(s, move(0, 2), /lock/i);
  s = step(s, move(0, 3)); // crosses Iria; going around would take four steps
  assert.deepEqual(legalMoves(s), []);
  s = [end, select('drake'), move(0, 1)].reduce(step, s); // crosses the lock
  assert.deepEqual(s.units.drake, { x: 0, y: 1, hp: 2, ap: 1 });
});

test('AP belongs to each unit; free selection neither spends AP nor refreshes an exhausted unit', () => {
  const empty = [move(1, 1), move(0, 1)].reduce(step, newGame());
  assert.deepEqual(legalMoves(empty), []);
  refuse(empty, inspect('crest'), /no AP/i);
  refuse(empty, move(0, 0), /no AP/i);
  const other = step(empty, select('drake'));
  assert.equal(other.units.drake.ap, 2);
  const back = step(other, select('iria'));
  assert.deepEqual(back, empty);
  const fresh = step(other, end);
  assert.deepEqual([fresh.round, fresh.active, fresh.units.iria.ap, fresh.units.drake.ap], [2, 'iria', 2, 2]);
});

test('forecast is stable during play; end hits both exposed units exactly once and rotates the wave', () => {
  const start = newGame();
  const preview = forecast(start);
  assert.deepEqual(keys(preview), ['0,0', '0,3', '1,2', '2,1', '3,0', '3,3', '4,2', '5,1', '6,0', '6,3']);
  preview[0].x = -1;
  assert.deepEqual(forecast(start)[0], { x: 0, y: 0 });
  const exposed = step(start, move(1, 2));
  assert.deepEqual(forecast(exposed), forecast(start));
  assert.deepEqual([exposed.units.iria.hp, exposed.units.drake.hp], [3, 3]);
  const r2 = step(exposed, end);
  assert.deepEqual([r2.units.iria.hp, r2.units.drake.hp], [2, 2]);
  assert.notDeepEqual(forecast(r2), forecast(start));
  const r3 = step(r2, end);
  assert.deepEqual([r3.units.iria.hp, r3.units.drake.hp], [2, 2]);
  assert.deepEqual(forecast(step(r3, end)), forecast(start));
});

test('ward protects an adjacent ally, clips at the board edge, and expires on end', () => {
  const beside = [move(3, 3), select('drake'), move(4, 3)].reduce(step, newGame());
  const sheltered = step(beside, ward);
  assert.equal(sheltered.units.drake.ap, 0);
  assert.deepEqual([...sheltered.ward].sort(), ['3,3', '4,2', '4,3', '5,3']);
  assert.deepEqual(forecast(sheltered), forecast(beside));
  assert.equal(step(beside, end).units.iria.hp, 2);
  const next = step(sheltered, end);
  assert.deepEqual(next.ward, []);
  assert.equal(next.units.iria.hp, 3);
  assert.match(next.log.at(-1), /ward shelters Iria/);
});

test('a ward stays on the cast cells when the drake flies away', () => {
  const cast = [select('drake'), ward].reduce(step, newGame());
  assert.deepEqual([...cast.ward].sort(), ['3,2', '4,1', '4,2', '4,3', '5,2']);
  assert.equal(step(cast, end).units.drake.hp, 3);
  const flown = step(cast, move(3, 0));
  assert.deepEqual(flown.ward, cast.ward);
  assert.deepEqual(readSave(JSON.stringify(flown)), flown);
  assert.equal(step(flown, end).units.drake.hp, 2);
});

test('readings are shared and unique; diagonal inspections, wrong roles and early signals fail', () => {
  const start = newGame();
  refuse(start, ward, /only the drake/i);
  refuse(step(start, move(0, 3)), signal, /read/i);
  refuse(start, inspect('lock'), /inspect/i);
  const drake = step(start, select('drake'));
  refuse(drake, signal, /only Iria/i);
  refuse(drake, inspect('rose'), /orthogonally/i);
  const read = [move(3, 1), inspect('rose')].reduce(step, drake);
  assert.deepEqual(read.clues, ['rose']);
  assert.equal(read.units.drake.ap, 0);
  assert.ok(read.log.at(-1).includes(SITES.rose.clue));
  const besideRose = [end, move(1, 1), move(2, 1), end].reduce(step, read);
  refuse(besideRose, inspect('rose'), /already/i); // the other unit cannot claim it again
});

test('malformed and unknown commands never change state or consume a turn', () => {
  const start = newGame();
  for (const command of [
    null, false, [], 'end', {}, { type: 'win' }, { type: '__proto__' }, { type: 'constructor' },
    { type: 'move', x: 1 }, move('2', 3), move(1.5, 2), move(1, NaN), move(-1, 3), move(COLS, 0), move(0, ROWS),
    move(1, 3), select('toString'), inspect('__proto__'), { type: 'end', round: 8 },
  ]) refuse(start, command);
});

test('canonical E2E route wins in round three and resumes identically after every command', () => {
  let s = newGame();
  for (const command of WINNING_ROUTE) {
    const next = step(s, command);
    s = readSave(JSON.stringify(next));
    assert.deepEqual(s, next, `resume after ${JSON.stringify(command)}`);
  }
  assert.deepEqual([s.phase, s.round, s.active], ['won', 3, 'iria']);
  assert.deepEqual(s.clues, ['crest', 'rose', 'waylight']);
  assert.deepEqual(s.units, { iria: { x: 0, y: 1, hp: 3, ap: 1 }, drake: { x: 6, y: 0, hp: 3, ap: 1 } });
  assert.match(s.log.at(-1), /Tide Almanac/);
  assert.deepEqual(legalMoves(s), []);
  assert.deepEqual(forecast(s), []);
  for (const command of [end, ward, signal, move(0, 0), select('drake'), inspect('crest')]) refuse(s, command, /over/i);
});

test('signaling still requires position and AP; the eighth round is playable', () => {
  let ready = WINNING_ROUTE.slice(0, -1).reduce(step, newGame());
  const diagonal = step(ready, move(1, 1));
  refuse(diagonal, signal, /beside/i);
  refuse(step(diagonal, move(0, 1)), signal, /no AP/i);
  while (ready.round < MAX_ROUND) ready = step(ready, end);
  assert.equal(step(ready, signal).phase, 'won');
  assert.equal(step(ready, end).phase, 'lost');
});

test('three surges can incapacitate Iria and end the chapter before the clock expires', () => {
  const s = [move(1, 2), end, move(1, 1), end, move(1, 0), end].reduce(step, newGame());
  assert.deepEqual([s.phase, s.round, s.units.iria.hp, s.units.iria.ap], ['lost', 3, 0, 0]);
  assert.match(s.log.at(-1), /Iria.*incapacitated/);
  assert.deepEqual(readSave(JSON.stringify(s)), s);
  assert.deepEqual(forecast(s), []);
  refuse(s, end, /over/i);
});

test('a downed drake blocks landing but not play; the final surge loses even with Iria alive', () => {
  let s = newGame();
  for (let i = 1; i < MAX_ROUND; i++) s = step(s, end);
  assert.deepEqual([s.phase, s.round, s.units.drake.hp, s.units.drake.ap], ['playing', 8, 0, 0]);
  refuse(s, select('drake'), /incapacitated/i);
  s = step(s, move(3, 3));
  refuse(s, move(4, 2), /occupies/i);
  s = step(s, end);
  assert.deepEqual([s.phase, s.round, s.units.iria.hp], ['lost', 8, 1]);
  assert.match(s.log.at(-1), /eighth bell/);
  assert.deepEqual(legalMoves(s), []);
  assert.deepEqual(readSave(JSON.stringify(s)), s);
});

test('save loading rejects corrupt, out-of-bounds and plausible but unreachable records', () => {
  for (const raw of [null, newGame(), '', '{', 'null', 'true', '[]', '{}', ' '.repeat(32769)]) {
    assert.equal(readSave(raw), null);
  }
  const mid = WINNING_ROUTE.slice(0, 5).reduce(step, newGame());
  assert.deepEqual(readSave(JSON.stringify(Object.fromEntries(Object.entries(mid).reverse()))), mid);
  const changes = {
    version: s => { s.version = 2; }, clock: s => { s.round = 9; }, phase: s => { s.phase = 'won'; },
    unit: s => { s.active = 'rose'; }, missing: s => { delete s.units.iria; }, overlap: s => { Object.assign(s.units.iria, s.units.drake); },
    outside: s => { s.units.drake.x = COLS; }, lock: s => { Object.assign(s.units.iria, { x: 0, y: 2 }); },
    fraction: s => { s.units.iria.y = 1.5; }, hp: s => { s.units.iria.hp = 2; }, ap: s => { s.units.drake.ap = 1; },
    clues: s => { s.clues = ['crest']; }, duplicateClue: s => { s.clues = ['rose', 'rose']; }, lockClue: s => { s.clues = ['lock']; },
    wardType: s => { s.ward = [{ x: 3, y: 0 }]; }, wardRange: s => { s.ward.push('7,0'); }, wardShape: s => { s.ward.push('6,3'); },
    repeatedWard: s => { s.ward.push(s.ward[0]); }, extra: s => { s.units.iria.invulnerable = true; },
    prose: s => { s.log[1] += ' — invented finding'; }, missingEntry: s => { s.log.pop(); },
    overspend: s => { s.log.push(s.log.at(-1)); }, overlong: s => { s.log = Array(42).fill(s.log[0]); },
  };
  for (const [label, change] of Object.entries(changes)) {
    const edited = structuredClone(mid);
    change(edited);
    assert.equal(readSave(JSON.stringify(edited)), null, label);
  }
});

test('the longest legal journal stays bounded and loadable despite extra selections', () => {
  let s = newGame();
  for (let round = 1; round <= MAX_ROUND; round++) {
    const commands = [select('drake'), select('iria'), move(1, 2), move(1, 3), select('drake'), ward, ward, end];
    s = commands.reduce(step, s);
  }
  assert.equal(s.log.length, 1 + 5 * MAX_ROUND);
  assert.deepEqual(readSave(JSON.stringify(s)), s);
});
