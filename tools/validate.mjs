// Validates chapter data: map shapes, placements, reachability. Usage: node tools/validate.mjs
import { CHAPTERS } from '../src/game/data/chapters/index.js';
import { TERRAIN } from '../src/game/data/terrain.js';
import { Board } from '../src/game/board.js';
import { makeEnemy, heroRecord, unitFromRecord } from '../src/game/unit.js';
import { CAST, GENERIC } from '../src/game/data/cast.js';
import { ITEMS, WEAPONS } from '../src/game/data/items.js';
import { distanceField } from '../src/game/ai.js';

let errors = 0;
const err = (ch, msg) => { errors++; console.log(`  ✗ [${ch.id}] ${msg}`); };

for (const ch of CHAPTERS) {
  const m = ch.map;
  console.log(`${ch.id} ${ch.title} (${m.width}x${m.height})`);
  if (m.tiles.length !== m.height) err(ch, `rows=${m.tiles.length} expected ${m.height}`);
  m.tiles.forEach((r, y) => {
    if (r.length !== m.width) err(ch, `row ${y} length ${r.length}: "${r}"`);
    for (const c of r) if (!TERRAIN[c]) err(ch, `row ${y} unknown terrain '${c}'`);
  });
  const board = new Board(m);
  const kaelRec = heroRecord('kael');
  const foot = unitFromRecord(kaelRec, 0, 0);
  const occupied = new Set();
  const check = (what, x, y, unit = foot) => {
    if (!board.inBounds(x, y)) return err(ch, `${what} out of bounds (${x},${y})`);
    if (!board.standable(unit, x, y)) err(ch, `${what} on unstandable tile (${x},${y}) '${board.tchar(x, y)}' blocked=${board.isBlocked(x, y)}`);
    const k = `${x},${y}`;
    if (occupied.has(k)) err(ch, `${what} overlaps another unit at (${x},${y})`);
    occupied.add(k);
  };
  ch.starts.forEach(([x, y], i) => check(`start#${i}`, x, y));
  for (const j of ch.joins || []) check(`join ${j.id}`, j.x, j.y);
  const enemies = [];
  for (const e of ch.enemies) {
    const u = makeEnemy(e);
    if (!CAST[u.lookId] && !GENERIC[u.lookId]) err(ch, `enemy look '${u.lookId}' missing`);
    if (!WEAPONS[u.weapon]) err(ch, `enemy weapon '${u.weapon}' missing`);
    check(`enemy ${u.id}`, e.x, e.y, u);
    enemies.push(u);
  }
  for (const c of ch.chests || []) {
    if (c.item && !ITEMS[c.item] && !WEAPONS[c.item]) err(ch, `chest item ${c.item} unknown`);
    if (!board.standable(foot, c.x, c.y)) err(ch, `chest on unstandable (${c.x},${c.y}) '${board.tchar(c.x, c.y)}'`);
  }
  for (const v of ch.villages || []) if (board.tchar(v.x, v.y) !== 'V') err(ch, `village at (${v.x},${v.y}) is '${board.tchar(v.x, v.y)}' not V`);
  for (const h of ch.hidden || []) {
    if (!ITEMS[h.item] && !WEAPONS[h.item]) err(ch, `hidden item ${h.item} unknown`);
    if (!board.standable(foot, h.x, h.y)) err(ch, `hidden on unstandable (${h.x},${h.y}) '${board.tchar(h.x, h.y)}'`);
  }
  // Reachability: can a foot unit from start #0 reach an attack position next to the boss?
  const boss = enemies.find((u) => u.id === ch.objective.target);
  if (boss) {
    const [sx, sy] = ch.starts[0];
    foot.x = sx; foot.y = sy;
    const field = distanceField(board, foot, [{ x: boss.x, y: boss.y }]);
    const d = field.get(`${sx},${sy}`);
    if (d === undefined) err(ch, `boss ${boss.id} unreachable by foot from start`);
    else console.log(`  boss ${boss.id} path cost from start: ${d}`);
    const armor = unitFromRecord(heroRecord('garrick'), sx, sy);
    const da = distanceField(board, armor, [{ x: boss.x, y: boss.y }]).get(`${sx},${sy}`);
    console.log(`  armor path cost: ${da ?? 'UNREACHABLE'}`);
  } else err(ch, `objective target ${ch.objective.target} not among enemies`);
  // Every enemy should be able to reach (or be reached)
  for (const u of enemies) {
    if (u.ai === 'boss' || u.ai === 'hold') continue;
    const f = distanceField(board, u, ch.starts.slice(0, 3).map(([x, y]) => ({ x, y })));
    if (f.get(`${u.x},${u.y}`) === undefined) console.log(`  ! enemy ${u.id} (${u.moveType}) cannot path to player start`);
  }
  console.log(`  enemies=${enemies.length} chests=${(ch.chests || []).length} hidden=${(ch.hidden || []).length}`);
}
console.log(errors ? `\n${errors} problem(s)` : '\nALL CHAPTERS VALID');
process.exit(errors ? 1 : 0);
