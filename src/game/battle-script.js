// Chapter scripting: dialogue/camera actions, spawns, joins, recruitment, promotions and event triggers.
import * as THREE from 'three';
import { makeEnemy, unitFromRecord, heroRecord } from './unit.js';
import { promote } from './combat.js';
import { PROMOTION_GIFTS } from './data/heroes.js';
import { WEAPONS, ITEMS } from './data/items.js';
import { wait, key, manhattan } from '../core/util.js';

/** Does the optional `cond` on a script line hold? */
function condOk(b, cond) {
  if (!cond) return true;
  if (cond.party && !b.game.state.party[cond.party]) return false;
  if (cond.notParty && b.game.state.party[cond.notParty]) return false;
  if (cond.alive && !b.board.units.find((u) => u.id === cond.alive && u.alive)) return false;
  return true;
}

/** Nearest free tile the unit can stand on. */
export function freeTileNear(b, u, x, y) {
  if (b.board.standable(u, x, y) && !b.board.unitAt(x, y)) return { x, y };
  for (let r = 1; r <= 4; r++) {
    for (const t of b.board.tilesInRange(x, y, r, r)) {
      if (b.board.standable(u, t.x, t.y) && !b.board.unitAt(t.x, t.y)) return t;
    }
  }
  return null;
}

export async function runScript(b, actions = []) {
  if (!actions || !actions.length) return;
  const { dialogue, audio, ui, engine, state } = b.game;
  const prevMode = b.mode;
  b.mode = 'busy';
  b.input && (b.input.enabled = false);
  dialogue.begin();
  for (const a of actions) {
    if (b.disposed) break;
    if (!condOk(b, a.cond)) continue;
    if (a.once) {
      const k = JSON.stringify(a);
      if (b.onceLines.has(k)) continue;
      b.onceLines.add(k);
    }
    if (a.say || a.n) { await dialogue.show(a); continue; }
    dialogue.hide();
    if (a.cam) {
      const [x, y] = a.cam;
      const p = b.world.tileCenter(Math.max(0, Math.min(b.board.W - 1, x)), Math.max(0, Math.min(b.board.H - 1, y)));
      if (dialogue.skipping) b.rig.focus(p, { dist: a.d, yaw: a.yaw, instant: true });
      else await b.rig.glide(p, { dist: a.d ?? b.rig.goalDist, yaw: a.yaw, duration: a.t ?? 1.1 });
    } else if (a.wait) { if (!dialogue.skipping) await wait(a.wait); }
    else if (a.music) audio.playMusic(a.music, { fade: 1.0 });
    else if (a.sfx) { if (!dialogue.skipping) audio.sfx(a.sfx); }
    else if (a.shake) { if (!dialogue.skipping) b.rig.shake(a.shake, 0.5); }
    else if (a.flash) { if (!dialogue.skipping) engine.flash(0xffffff, 0.8 * a.flash, 0.5); }
    else if (a.title) { dialogue.hide(); audio.sfx('promote', { volume: 0.5 }); await ui.chapterCard(a.title[0], a.title[1]); }
    else if (a.hint) { if (b.game.settings.hints !== false) ui.hint(a.hint); }
    else if (a.spawn) await spawnUnits(b, a.spawn, a.fx);
    else if (a.join) await joinHero(b, a.join);
    else if (a.recruit) await recruitUnit(b, a.recruit);
    else if (a.promote) await storyPromote(b, a.promote);
    else if (a.objective) { b.objective = { ...a.objective }; ui.setObjective(b.objective.text); }
    else if (a.gold) { state.gold += a.gold; ui.setGold(state.gold); ui.toast(`Received ${a.gold} gold`, '◈'); audio.sfx('gold'); }
    else if (a.item) { state.addItem(a.item, a.qty || 1); ui.toast(`Received ${ITEMS[a.item]?.name || a.item}${a.qty > 1 ? ` ×${a.qty}` : ''}`, ITEMS[a.item]?.icon || '✦'); }
    else if (a.remove) {
      const u = b.board.units.find((v) => v.id === a.remove && v.alive);
      if (u) { u.alive = false; await b.views.get(u.uid)?.die(); }
    }
  }
  dialogue.end();
  b.mode = prevMode === 'busy' ? 'idle' : prevMode;
  b.input && (b.input.enabled = true);
}

export async function spawnUnits(b, list, fx) {
  const { audio } = b.game;
  for (const s of list) {
    const u = makeEnemy(s);
    const t = freeTileNear(b, u, s.x, s.y);
    if (!t) continue;
    u.x = t.x; u.y = t.y;
    b.board.addUnit(u);
    const v = b.addView(u);
    const pos = b.world.tileCenter(t.x, t.y);
    if (fx === 'summon') { b.vfx.spell('summon', { from: pos, to: pos, ground: pos }); audio.sfx('summon'); }
    else b.vfx.dust(pos, { count: 20 });
    v.char.setDissolve(1);
    const start = performance.now();
    await new Promise((r) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / 600);
        v.char.setDissolve(1 - k);
        if (k < 1) requestAnimationFrame(step); else r();
      };
      step();
    });
  }
  b.refreshDanger();
}

export async function joinHero(b, j) {
  const { state, audio, ui } = b.game;
  if (b.board.units.find((u) => u.id === j.id && u.alive)) return;
  state.addHero(j.id, heroRecord(j.id, { level: j.level }));
  const u = unitFromRecord(state.party[j.id], j.x, j.y);
  const t = freeTileNear(b, u, j.x, j.y);
  if (!t) return;
  u.x = t.x; u.y = t.y;
  b.board.addUnit(u);
  const v = b.addView(u);
  const pos = b.world.tileCenter(t.x, t.y);
  b.vfx.burst(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), { count: 40, color: 0x8fd0ff, speed: 1.6, life: 0.9, size: 0.12, texture: 'star' });
  audio.sfx('item');
  v.char.play('victory');
  ui.toast(`${u.name} joined the party!`, '★');
}

export async function recruitUnit(b, id) {
  const { state, audio, ui } = b.game;
  const u = b.board.units.find((v) => v.id === id && v.alive);
  if (!u) return;
  const oldView = b.views.get(u.uid);
  oldView?.dispose();
  b.views.delete(u.uid);
  u.side = 'player';
  u.isHero = true;
  u.ai = 'aggressive';
  u.acted = true;
  state.addHero(u.id, u.toRecord());
  const v = b.addView(u);
  v.setGreyed(true);
  b.vfx.burst(b.world.tileCenter(u.x, u.y).add(new THREE.Vector3(0, 0.6, 0)), { count: 50, color: 0x9fe0ff, speed: 1.8, life: 1, size: 0.13, texture: 'star' });
  audio.sfx('promote', { volume: 0.7 });
  ui.toast(`${u.name} joined the party!`, '★');
  b.refreshDanger();
}

/** Story-driven class change (e.g. Kael at the end of Chapter IV). */
export async function storyPromote(b, id) {
  const { state, audio, ui } = b.game;
  const u = b.board.units.find((v) => v.id === id);
  if (u && !u.promoted) {
    const rec = promote(u);
    if (rec) {
      giveGift(b, u);
      u.hp = u.maxHp;
      const v = b.views.get(u.uid);
      if (v && u.alive) {
        await b.rig.glide(b.world.tileCenter(u.x, u.y), { dist: 12, duration: 0.8 });
        audio.sfx('promote');
        b.vfx.promotion(b.world.tileCenter(u.x, u.y));
        await wait(0.9);
        v.rebuild();
        v.char.play('levelup');
      }
      b.game.dialogue.promoted.add(u.id);
      await ui.levelUp(u, { level: u.level, gains: {}, newSpells: u.spells.filter((s) => !['heal'].includes(s)).slice(-1), promoted: rec });
    }
  } else if (!u && state.party[id] && !state.party[id].promoted) {
    const tmp = unitFromRecord(state.party[id], 0, 0);
    promote(tmp);
    giveGift(b, tmp);
    state.party[id] = tmp.toRecord();
  }
}

/** Unique weapon on promotion; the old weapon goes to storage. */
export function giveGift(b, u) {
  const gift = PROMOTION_GIFTS[u.id];
  if (!gift || !WEAPONS[gift]) return;
  if (u.weapon) b.game.state.addWeapon(u.weapon);
  u.weapon = gift;
  b.game.ui.toast(`${u.name} received the ${WEAPONS[gift].name}!`, '⚔');
}

// ------------------------------------------------------------------ events
function inRect(u, r) { return u.x >= r.x0 && u.x <= r.x1 && u.y >= r.y0 && u.y <= r.y1; }

function matches(b, c, trig) {
  switch (trig.type) {
    case 'phase':
      if (c.turn !== undefined && c.turn === trig.turn && c.phase === trig.phase) return true;
      if (c.every && c.phase === trig.phase && trig.turn >= (c.from || 1) && (trig.turn - (c.from || 1)) % c.every === 0) {
        if (c.alive && !b.board.units.find((u) => u.id === c.alive && u.alive)) return false;
        return true;
      }
      return false;
    case 'defeated': return c.defeated === trig.id;
    case 'reach': return !!c.reach && trig.unit.side === (c.side || 'player') && inRect(trig.unit, c.reach);
    case 'talk': return !!c.talk && c.talk.includes(trig.a) && c.talk.includes(trig.b);
    default: return false;
  }
}

/** Fire all matching events for a trigger. Returns true if anything fired. */
export async function triggerEvents(b, trig) {
  const evs = b.ch.events || [];
  let any = false;
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (b.fired.has(i) && !ev.repeat) continue;
    const conds = ev.when.any || [ev.when];
    if (!conds.some((c) => matches(b, c, trig))) continue;
    if (!ev.repeat) b.fired.add(i);
    any = true;
    await runScript(b, ev.actions);
    if (b.over) break;
  }
  return any;
}

/** Units `u` may Talk to right now: [{ target, eventIndex }] */
export function talkTargets(b, u) {
  const out = [];
  const evs = b.ch.events || [];
  for (const o of b.board.alive) {
    if (o === u || manhattan(o.x, o.y, u.x, u.y) !== 1) continue;
    evs.forEach((ev, i) => {
      if (b.fired.has(i)) return;
      const conds = ev.when.any || [ev.when];
      if (conds.some((c) => c.talk && c.talk.includes(u.id) && c.talk.includes(o.id))) out.push({ target: o, eventIndex: i });
    });
  }
  return out;
}

export { key };
