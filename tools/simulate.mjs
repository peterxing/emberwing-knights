// Headless campaign simulator: the AI plays both sides to smoke-test logic and gauge difficulty.
// Usage: node tools/simulate.mjs [runs=12] [chapterIndex|all]
import { CHAPTERS, STARTING_PARTY } from '../src/game/data/chapters/index.js';
import { Board } from '../src/game/board.js';
import { makeEnemy, heroRecord, unitFromRecord } from '../src/game/unit.js';
import { decide } from '../src/game/ai.js';
import { resolveCombat, resolveHeal, combatExp, healExp, gainExp, promote } from '../src/game/combat.js';
import { SPELLS } from '../src/game/data/spells.js';
import { RNG } from '../src/core/util.js';

const RUNS = +(process.argv[2] || 12);
const ONLY = process.argv[3] && process.argv[3] !== 'all' ? +process.argv[3] : null;

function runChapter(ch, party, rng) {
  const board = new Board(ch.map);
  const roster = Object.keys(party);
  const joinsIntro = [...(ch.joins || [])];
  for (const a of ch.intro || []) if (a.join) joinsIntro.push(a.join);
  for (const j of joinsIntro) if (!party[j.id]) party[j.id] = heroRecord(j.id);
  const starts = [...ch.starts];
  const placed = new Set();
  for (const j of joinsIntro) { board.addUnit(unitFromRecord(party[j.id], j.x, j.y)); placed.add(j.id); }
  for (const id of Object.keys(party)) {
    if (placed.has(id)) continue;
    const s = starts.shift();
    if (!s) break;
    board.addUnit(unitFromRecord(party[id], s[0], s[1]));
  }
  for (const e of ch.enemies) board.addUnit(makeEnemy(e));
  let objective = { ...ch.objective };
  const fired = new Set();
  const fire = (ev, idx) => {
    for (const a of ev.actions) {
      if (a.spawn) for (const s of a.spawn) {
        let { x, y } = s;
        if (board.unitAt(x, y)) {
          const alt = board.tilesInRange(x, y, 1, 2).find((t) => !board.unitAt(t.x, t.y) && board.standable(makeEnemy(s), t.x, t.y));
          if (!alt) continue;
          x = alt.x; y = alt.y;
        }
        board.addUnit(makeEnemy({ ...s, x, y }));
      }
      if (a.join && !board.units.find((u) => u.id === a.join.id)) {
        if (!party[a.join.id]) party[a.join.id] = heroRecord(a.join.id);
        const t = board.unitAt(a.join.x, a.join.y) ? board.tilesInRange(a.join.x, a.join.y, 1, 2).find((q) => !board.unitAt(q.x, q.y)) : a.join;
        board.addUnit(unitFromRecord(party[a.join.id], t.x, t.y));
      }
      if (a.recruit) {
        const u = board.units.find((v) => v.id === a.recruit && v.alive);
        if (u) { u.side = 'player'; u.isHero = true; party[u.id] = u.toRecord(); }
      }
      if (a.objective) objective = { ...a.objective };
    }
    if (!ev.repeat) fired.add(idx);
  };
  const checkEvents = (turn, phase) => {
    (ch.events || []).forEach((ev, i) => {
      if (fired.has(i)) return;
      const w = ev.when;
      const conds = w.any || [w];
      for (const c of conds) {
        if (c.turn && c.turn === turn && c.phase === phase) return fire(ev, i);
        if (c.every && phase === c.phase && turn >= c.from && (turn - c.from) % c.every === 0) {
          const al = c.alive ? board.units.find((u) => u.id === c.alive && u.alive) : true;
          if (al) return fire(ev, i);
        }
        if (c.talk && turn === 2 && phase === 'player') return fire(ev, i);
        if (c.reach) {
          const r = c.reach;
          if (board.alive.some((u) => u.side === 'player' && u.x >= r.x0 && u.x <= r.x1 && u.y >= r.y0 && u.y <= r.y1)) return fire(ev, i);
        }
      }
    });
  };
  const onDeath = (u) => {
    u.alive = false;
    (ch.events || []).forEach((ev, i) => {
      if (!fired.has(i) && ev.when.defeated === u.id) fire(ev, i);
    });
  };
  const act = (plan) => {
    const u = plan.unit;
    u.x = plan.to.x; u.y = plan.to.y;
    if (plan.action === 'attack' && plan.target && plan.target.alive) {
      const t = plan.target;
      const res = resolveCombat(board, u, t, rng, plan.spell);
      const dealtA = res.strikes.some((s) => s.by === 'a' && s.hit);
      const dealtD = res.strikes.some((s) => s.by === 'd' && s.hit);
      for (const sp of res.splash) if (sp.died) onDeath(sp.unit);
      if (res.dDied) onDeath(t);
      if (res.aDied) onDeath(u);
      if (u.alive) gainExp(u, combatExp(u, t, { dealt: dealtA, kill: res.dDied }), rng);
      if (t.alive) gainExp(t, combatExp(t, u, { dealt: dealtD, kill: res.aDied }), rng);
    } else if (plan.action === 'heal' && plan.target) {
      const r = resolveHeal(board, u, plan.target, plan.spell);
      gainExp(u, healExp(u, r.heals.length), rng);
    }
  };
  let turn = 1;
  for (; turn <= 40; turn++) {
    checkEvents(turn, 'player');
    for (const u of board.alive.filter((v) => v.side === 'player')) {
      if (!u.alive) continue;
      const saved = u.ai; u.ai = turn > 12 ? 'aggressive' : 'cautious';
      act(decide(board, u, turn));
      u.ai = saved;
      if (!board.units.find((v) => v.id === 'kael' && v.alive)) return { win: false, turn, why: 'kael' };
      const boss = board.units.find((v) => v.id === objective.target);
      if (boss && !boss.alive) {
        const b2 = board.units.find((v) => v.id === objective.target);
        if (!b2.alive) return { win: true, turn, board };
      }
    }
    // MP regen + terrain heal for players
    for (const u of board.alive) {
      const t = board.terrain(u.x, u.y);
      if (t.heal) u.hp = Math.min(u.maxHp, u.hp + Math.ceil(u.maxHp * t.heal / 100));
    }
    checkEvents(turn, 'enemy');
    for (const u of board.alive.filter((v) => v.side === 'enemy')) {
      if (!u.alive) continue;
      act(decide(board, u, turn));
      if (!board.units.find((v) => v.id === 'kael' && v.alive)) return { win: false, turn, why: 'kael' };
    }
    for (const u of board.alive) u.mp = Math.min(u.maxMp, u.mp + 1 + Math.floor(u.maxMp * 0.08));
  }
  return { win: false, turn, why: 'timeout' };
}

const EXPECTED = [
  { kael: 1, lyra: 1, garrick: 3 },
  { kael: 3, lyra: 3, garrick: 5 },
  { kael: 5, lyra: 5, garrick: 6, fenn: 5, vex: 6 },
  { kael: 7, lyra: 7, garrick: 8, fenn: 7, vex: 8, mira: 8 },
  { kael: 10, lyra: 9, garrick: 10, fenn: 9, vex: 10, mira: 10, sora: 10 },
  { kael: 13, lyra: 12, garrick: 13, fenn: 12, vex: 12, mira: 13, sora: 13 },
];

function partyAt(ci, rng) {
  const party = {};
  for (const [id, lv] of Object.entries(EXPECTED[ci])) {
    const u = unitFromRecord(heroRecord(id), 0, 0);
    while (u.level < lv) { u.exp = 100; gainExp(u, 0, rng); u.exp = 0; levelUpOnce(u, rng); }
    if (id === 'kael' && ci >= 4 && !u.promoted) promote(u);
    party[id] = u.toRecord();
  }
  return party;
}
function levelUpOnce(u, rng) { gainExp(u, 100, rng); }

const results = [];
for (let ci = 0; ci < CHAPTERS.length; ci++) {
  if (ONLY !== null && ONLY !== ci) continue;
  const ch = CHAPTERS[ci];
  for (let run = 0; run < RUNS; run++) {
    const rng = new RNG(1234 + run * 7919 + ci * 31);
    const party = partyAt(ci, rng);
    const before = Object.fromEntries(Object.entries(party).map(([k, v]) => [k, v.level + v.exp / 100]));
    const r = runChapter(ch, party, rng);
    let gained = {};
    if (r.win) for (const u of r.board.units) if (u.isHero && u.side === 'player') gained[u.id] = +(u.level + u.exp / 100 - (before[u.id] ?? u.level)).toFixed(2);
    results.push({ ch: ch.id, ...r, gained });
  }
}
const by = {};
for (const r of results) (by[r.ch] ||= []).push(r);
for (const [ch, rs] of Object.entries(by)) {
  const wins = rs.filter((r) => r.win);
  const avgT = wins.length ? (wins.reduce((a, r) => a + r.turn, 0) / wins.length).toFixed(1) : '-';
  const fails = rs.filter((r) => !r.win).map((r) => `${r.why}@${r.turn}`).join(' ');
  const g = {};
  for (const w of wins) for (const [k, v] of Object.entries(w.gained)) (g[k] ||= []).push(v);
  const avgG = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)]));
  console.log(`${ch}: win ${wins.length}/${rs.length}  avgTurns ${avgT}  ${fails}`);
  console.log(`   avg levels gained on win: ${JSON.stringify(avgG)}`);
}