// Battle controller: builds a chapter's battlefield and runs phases, input, AI turns and victory/defeat.
import * as THREE from 'three';
import { World } from '../gfx/world.js';
import { Environment } from '../gfx/environment.js';
import { VFX } from '../gfx/vfx.js';
import { Overlay } from '../gfx/overlay.js';
import { UnitView } from '../gfx/unitview.js';
import { CameraRig } from '../core/camera.js';
import { MapInput } from '../core/input.js';
import { Board } from './board.js';
import { makeEnemy, unitFromRecord } from './unit.js';
import { decide } from './ai.js';
import { SPELLS } from './data/spells.js';
import { runScript, triggerEvents, freeTileNear, talkTargets as talkTargetsFor } from './battle-script.js';
import { actions } from './battle-actions.js';
import { RNG, key, manhattan, wait } from '../core/util.js';

export class Battle {
  constructor(game, chapter, index) {
    this.game = game;
    this.ch = chapter;
    this.index = index;
    this.rng = new RNG((Date.now() ^ (index * 7919)) >>> 0);
    this.over = false;
    this.result = null;
    this.turn = 1;
    this.phase = 'player';
    this.mode = 'busy';
    this.views = new Map();
    this.fired = new Set();
    this.onceLines = new Set();
    this.visited = new Set();
    this.opened = new Set();
    this.found = new Set();
    this.bossSeen = new Set();
    this.objective = { ...chapter.objective };
    this.sel = null;
    this.reach = null;
    this.hoverTile = null;
    this.dangerOn = !!game.settings.showDanger;
    this.disposed = false;
    this.sparkleT = 0;
  }

  // ------------------------------------------------------------------ setup
  async setup() {
    const { engine, ui, state, settings } = this.game;
    const ch = this.ch;
    const props = [...(ch.map.props || [])];
    for (const c of ch.chests || []) props.push({ type: 'chest', x: c.x, y: c.y });
    this.mapDef = { ...ch.map, props };
    this.board = new Board(this.mapDef);
    this.scene = new THREE.Scene();
    this.world = new World(this.mapDef, { quality: settings.quality });
    this.scene.add(this.world.group);
    this.env = new Environment(this.scene, engine.renderer, this.mapDef.environment || 'day', { bounds: this.world.bounds, quality: settings.quality });
    this.vfx = new VFX(this.scene);
    this.overlay = new Overlay(this.world, this.scene);
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 600);
    this.rig = new CameraRig(this.camera);
    const bb = this.world.bounds.clone();
    this.rig.setBounds(bb);
    engine.setView(this.scene, this.camera);
    engine.setGrade(this.env.preset || {});
    engine.setTiltShift({ enabled: settings.quality !== 'low', focusY: 0.5, range: 0.17, blur: 2.4, falloff: 0.32 });

    // units: chapter joins, party, enemies
    for (const j of ch.joins || []) state.addHero(j.id);
    const placed = new Set();
    for (const j of ch.joins || []) {
      const u = unitFromRecord(state.party[j.id], j.x, j.y);
      this.board.addUnit(u);
      placed.add(j.id);
    }
    const starts = [...ch.starts];
    for (const id of state.roster) {
      if (placed.has(id)) continue;
      const s = starts.shift();
      if (!s) break;
      this.board.addUnit(unitFromRecord(state.party[id], s[0], s[1]));
    }
    for (const e of ch.enemies) {
      if (e.hero && state.party[e.hero]) continue;
      const u = makeEnemy(e);
      const t = freeTileNear(this, u, u.x, u.y);
      if (t) { u.x = t.x; u.y = t.y; }
      this.board.addUnit(u);
    }
    for (const u of this.board.units) this.addView(u);
    for (const u of this.board.units) if (u.side === 'player' && u.id !== 'kael') this.game.dialogue.promoted.delete(u.id);
    for (const u of this.board.units) if (u.promoted) this.game.dialogue.promoted.add(u.id);

    if (this.mapDef.ambient) this.ambient = this.vfx.ambient(this.mapDef.ambient, this.world.bounds, { density: settings.quality === 'low' ? 0.5 : 1 });

    const kael = this.board.units.find((u) => u.id === 'kael') || this.board.units[0];
    this.rig.focus(this.world.tileCenter(kael.x, kael.y), { dist: 21, yaw: Math.PI / 4, pitch: 0.92, instant: true });

    this.input = new MapInput(engine.canvas, this.rig, (ray) => this.world.pick(ray), {
      onHover: (t) => this.onHover(t),
      onClick: (t) => this.onClick(t),
      onCancel: () => this.onCancel(),
      onKey: (e) => this.onKey(e),
    });
    this.unsub = engine.onUpdate((dt, el) => this.update(dt, el));

    ui.setChapter(ch.num, ch.title);
    ui.setObjective(this.objective.text);
    ui.setGold(state.gold);
    ui.setTurn(1, 'player');
    ui.btnEnd.onclick = () => { if (this.phase === 'player' && (this.mode === 'idle' || this.mode === 'selected')) this.endPlayerPhase(); };
    ui.btnDanger.onclick = () => this.toggleDanger();
    ui.btnDanger.classList.toggle('toggled', this.dangerOn);
    ui.btnSettings.onclick = () => this.game.openSettings();
  }

  addView(u) {
    const v = new UnitView(u, this.world, this.scene, { quality: this.game.settings.quality });
    this.views.set(u.uid, v);
    return v;
  }

  view(u) { return this.views.get(u.uid); }

  update(dt, el) {
    if (this.disposed) return;
    this.rig.update(dt);
    this.input.update(dt);
    this.world.update(dt, el, this.camera);
    this.env.update(dt, el, this.camera);
    this.vfx.update(dt, this.camera);
    this.overlay.update(dt, el);
    for (const v of this.views.values()) v.update(dt, el);
    this.sparkleT -= dt;
    if (this.sparkleT <= 0) { this.sparkleT = 1.4; this.treasureSense(); }
  }

  treasureSense() {
    const seers = this.board.alive.filter((u) => u.side === 'player' && u.clsData?.treasureSense);
    if (!seers.length) return;
    for (const h of this.ch.hidden || []) {
      const k = key(h.x, h.y);
      if (this.found.has(k)) continue;
      if (seers.some((s) => manhattan(s.x, s.y, h.x, h.y) <= 5)) this.vfx.sparkle(this.world.tileCenter(h.x, h.y).add(new THREE.Vector3(0, 0.15, 0)));
    }
  }

  screenPos(u) {
    const v = this.view(u);
    const p = v ? v.root.position.clone() : this.world.tileCenter(u.x, u.y);
    p.y += (v?.char.height || 1) * 0.6;
    p.project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  /** Screen position of a tile's centre (used by automated tests). */
  tileScreen(x, y) {
    const p = this.world.tileCenter(x, y).project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ------------------------------------------------------------------ main loop
  async run() {
    await this.setup();
    const { ui, engine, audio } = this.game;
    ui.showHud(false);
    await engine.fade(0, 0.8);
    await runScript(this, this.ch.intro);
    const lead = this.board.units.find((u) => u.id === 'kael' && u.alive);
    if (lead) this.rig.focus(this.world.tileCenter(lead.x, lead.y), { dist: Math.max(this.rig.goalDist, 19.5), pitch: 0.92 });
    ui.showHud(true);
    while (!this.over) {
      await this.playerPhase();
      if (this.over) break;
      await this.enemyPhase();
      if (this.over) break;
      this.turn++;
      this.game.state.stats.turns++;
    }
    this.mode = 'busy';
    this.overlay.clearAll();
    this.overlay.setCursor(null);
    ui.closeMenu();
    ui.hideForecast();
    if (this.result === 'victory') {
      audio.playMusic('victory', { fade: 0.2 });
      for (const v of this.views.values()) if (v.unit.alive && v.unit.side === 'player') { v.setGreyed(false); v.char.play('victory'); }
      await ui.banner('VICTORY', this.objective.text, 'player');
      await wait(0.6);
      ui.showHud(false);
      await runScript(this, this.ch.outro);
      this.persistParty();
    } else {
      audio.playMusic('defeat', { fade: 0.3 });
      engine.setDesaturate(0.85);
      await ui.banner('DEFEAT', 'Kael has fallen', 'enemy');
      engine.setDesaturate(0);
    }
    return this.result;
  }

  persistParty() {
    const { state } = this.game;
    for (const u of this.board.units) {
      if (u.isHero && u.side === 'player' && state.party[u.id]) {
        const rec = u.toRecord();
        rec.weapon = u.weapon;
        state.party[u.id] = rec;
      }
    }
  }

  win() { if (this.over) return; this.over = true; this.result = 'victory'; this._phaseResolve?.(); }
  lose() { if (this.over) return; this.over = true; this.result = 'defeat'; this._phaseResolve?.(); }

  checkEnd() {
    if (this.over) return true;
    const lord = this.board.units.find((u) => u.lord);
    if (lord && !lord.alive) { this.lose(); return true; }
    const o = this.objective;
    if (o.type === 'boss') {
      const b = this.board.units.find((u) => u.id === o.target);
      if (b && !b.alive) { this.win(); return true; }
    } else if (o.type === 'rout') {
      if (!this.board.alive.some((u) => u.side === 'enemy')) { this.win(); return true; }
    }
    return false;
  }

  phaseStart(side) {
    for (const u of this.board.alive) {
      if (u.side !== side) continue;
      u.acted = false; u.moved = false;
      this.view(u)?.setGreyed(false);
      const t = this.board.terrain(u.x, u.y);
      if (t.heal && u.hp < u.maxHp) {
        const amt = Math.min(u.maxHp - u.hp, Math.ceil((u.maxHp * t.heal) / 100));
        u.hp += amt;
        this.view(u)?.refreshHp();
        this.vfx.floatText(this.view(u).char.getAnchor('overhead'), `+${amt}`, { color: '#7dffb0', heal: true, size: 1.4 });
      }
      if (u.maxMp > 0) u.mp = Math.min(u.maxMp, u.mp + 1 + Math.floor(u.maxMp * 0.08));
    }
  }

  async playerPhase() {
    const { ui, audio } = this.game;
    this.phase = 'player';
    ui.setTurn(this.turn, 'player');
    audio.playMusic(this.musicFor('player'), { fade: 0.8 });
    await ui.banner('PLAYER PHASE', `Turn ${this.turn}`, 'player');
    await triggerEvents(this, { type: 'phase', turn: this.turn, phase: 'player' });
    if (this.checkEnd()) return;
    this.phaseStart('player');
    this.refreshDanger();
    this.mode = 'idle';
    this.input.enabled = true;
    if (this.game.auto) {
      await this.autoPlayerPhase();
      this.deselect();
      this.mode = 'busy';
      return;
    }
    const first = this.nextReady();
    if (first && this.turn > 1) this.rig.focus(this.world.tileCenter(first.x, first.y));
    await new Promise((r) => { this._phaseResolve = r; });
    this._phaseResolve = null;
    this.deselect();
    this.mode = 'busy';
  }

  /** AI-controlled player phase (dev/testing: ?auto=1). */
  async autoPlayerPhase() {
    for (const u of this.board.alive.filter((p) => p.side === 'player' && !p.acted)) {
      if (this.over) return;
      if (!u.alive) continue;
      const saved = u.ai;
      u.ai = this.turn > 14 ? 'aggressive' : 'cautious';
      const plan = decide(this.board, u, this.turn);
      u.ai = saved;
      this.mode = 'busy';
      this.rig.focus(this.world.tileCenter(plan.to.x, plan.to.y));
      if (plan.path.length > 1) { await this.view(u).moveAlong(plan.path); u.x = plan.to.x; u.y = plan.to.y; }
      if (plan.action === 'attack' && plan.target?.alive) await this.executeAttack(u, plan.target, plan.spell || null);
      else if (plan.action === 'heal' && plan.target?.alive) await this.executeHeal(u, plan.target, plan.spell);
      if (this.over) return;
      if (!u.alive) continue;
      if (this.chestNear(u)) await this.doOpenChest(u);
      const vil = (this.ch.villages || []).find((v) => v.x === u.x && v.y === u.y && !this.visited.has(key(v.x, v.y)));
      if (vil) await this.doVisit(u);
      const talks = talkTargetsFor(this, u);
      if (talks.length) await this.doTalk(u, talks[0].target);
      await this.commit(u);
      if (this.over) return;
    }
  }

  musicFor(phase) {
    const boss = this.board.units.find((u) => u.id === this.objective.target && u.alive);
    if (boss && boss.id === 'nidhvar') return 'final';
    if (phase === 'enemy') return 'enemy';
    return 'player';
  }

  endPlayerPhase() {
    if (this.phase !== 'player' || this.over) return;
    this.game.ui.closeMenu();
    this.game.ui.hideForecast();
    this.overlay.clearAll(['danger']);
    this._phaseResolve?.();
  }

  nextReady(after = null) {
    const list = this.board.alive.filter((u) => u.side === 'player' && !u.acted);
    if (!list.length) return null;
    if (!after) return list[0];
    const i = list.indexOf(after);
    return list[(i + 1) % list.length];
  }

  async enemyPhase() {
    const { ui, audio } = this.game;
    this.phase = 'enemy';
    this.mode = 'busy';
    this.input.enabled = false;
    ui.setTurn(this.turn, 'enemy');
    ui.showUnit(null);
    audio.playMusic(this.musicFor('enemy'), { fade: 0.8 });
    await ui.banner('ENEMY PHASE', `Turn ${this.turn}`, 'enemy');
    await triggerEvents(this, { type: 'phase', turn: this.turn, phase: 'enemy' });
    if (this.checkEnd()) return;
    this.phaseStart('enemy');
    const order = this.board.alive.filter((u) => u.side === 'enemy').sort((a, b) => (a.boss - b.boss) || (this.distToPlayers(a) - this.distToPlayers(b)));
    for (const u of order) {
      if (this.over) return;
      if (!u.alive) continue;
      const plan = decide(this.board, u, this.turn);
      if (plan.action === 'wait' && plan.path.length <= 1) continue;
      const v = this.view(u);
      const dest = this.world.tileCenter(plan.to.x, plan.to.y);
      const near = this.rig.goal.distanceTo(dest) < 5;
      if (!near) await this.rig.glide(dest.clone().lerp(this.world.tileCenter(u.x, u.y), 0.4), { duration: 0.45 });
      this.overlay.setCursor({ x: u.x, y: u.y }, 0xff6a5a);
      ui.showUnit(u);
      if (plan.path.length > 1) {
        await v.moveAlong(plan.path, { speed: 1.35 });
        u.x = plan.to.x; u.y = plan.to.y;
      }
      if (plan.action === 'attack' && plan.target?.alive) await this.executeAttack(u, plan.target, plan.spell || null);
      else if (plan.action === 'heal' && plan.target?.alive) await this.executeHeal(u, plan.target, plan.spell);
      u.acted = true;
      if (this.checkEnd()) return;
      await wait(0.08);
    }
    this.overlay.setCursor(null);
    for (const u of this.board.alive) if (u.side === 'enemy') this.view(u)?.setGreyed(false);
  }

  distToPlayers(u) {
    let best = 99;
    for (const p of this.board.alive) if (p.side === 'player') best = Math.min(best, manhattan(p.x, p.y, u.x, u.y));
    return best;
  }

  // ------------------------------------------------------------------ danger zone & ranges
  toggleDanger() {
    this.dangerOn = !this.dangerOn;
    this.game.settings.showDanger = this.dangerOn;
    this.game.ui.btnDanger.classList.toggle('toggled', this.dangerOn);
    this.refreshDanger();
    this.game.audio.sfx('select');
  }

  refreshDanger() {
    if (!this.overlay) return;
    if (!this.dangerOn) { this.overlay.clearLayer('danger'); return; }
    const set = new Set();
    for (const u of this.board.alive) {
      if (u.side !== 'enemy') continue;
      for (const k of this.threatOf(u)) set.add(k);
    }
    this.overlay.setLayer('danger', [...set].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }));
  }

  /** Tiles a unit threatens next turn (respecting stationary AI). */
  threatOf(u) {
    const ranges = [];
    if (u.atkRange) ranges.push(u.atkRange);
    for (const s of u.spells) { const sp = SPELLS[s]; if (sp.target === 'enemy' && u.mp >= sp.mp) ranges.push(sp.range); }
    if (!ranges.length) return new Set();
    const stay = u.ai === 'boss' || u.ai === 'hold';
    const reach = this.board.reachable(u, { mov: stay ? 0 : u.mov });
    return this.board.threatTiles(u, ranges, reach);
  }

  showRanges(u, layerMove = 'move', layerAtk = 'attack') {
    const reach = this.board.reachable(u);
    const moveTiles = [...reach.ends].map((k) => reach.nodes.get(k));
    const ranges = [];
    if (u.atkRange) ranges.push(u.atkRange);
    let healOnly = !u.atkRange;
    for (const s of u.spells) {
      const sp = SPELLS[s];
      if (u.mp < sp.mp) continue;
      if (sp.target === 'enemy') { ranges.push(sp.range); healOnly = false; }
    }
    if (healOnly) for (const s of u.spells) { const sp = SPELLS[s]; if (sp.kind === 'heal' && sp.range[1] > 0 && u.mp >= sp.mp) ranges.push(sp.range); }
    const threat = this.board.threatTiles(u, ranges, reach);
    const mv = new Set(reach.ends);
    const atk = [...threat].filter((k) => !mv.has(k)).map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
    this.overlay.setLayer(layerMove, moveTiles, layerMove === 'inspect' ? 0xff8a6a : undefined);
    this.overlay.setLayer(healOnly ? 'heal' : layerAtk, atk);
    return reach;
  }

  // ------------------------------------------------------------------ input
  onHover(t) {
    if (this.mode === 'busy') return;
    this.hoverTile = t;
    const { ui } = this.game;
    this.overlay.setCursor(t);
    const u = t ? this.board.unitAt(t.x, t.y) : null;
    ui.showUnit(u || this.sel);
    ui.showTerrain(t ? this.board.terrain(t.x, t.y) : null);
    if (t) this.game.audio.sfx('cursor', { volume: 0.25 });
    if (this.mode === 'idle') {
      this.overlay.clearLayer('inspect'); this.overlay.clearLayer('move'); this.overlay.clearLayer('attack'); this.overlay.clearLayer('heal');
      if (u && u.side === 'enemy') this.showRanges(u, 'inspect', 'attack');
      else if (u && u.side === 'player' && !u.acted) this.showRanges(u);
    } else if (this.mode === 'selected') {
      if (t && this.reach.ends.has(key(t.x, t.y))) this.overlay.setPath(this.board.pathTo(this.reach, t.x, t.y));
      else if (u && this.board.hostile(this.sel, u)) {
        const from = this.bestAttackTile(this.sel, u);
        this.overlay.setPath(from ? this.board.pathTo(this.reach, from.x, from.y) : null);
      } else this.overlay.setPath(null);
    } else if (this.mode === 'target') {
      this.previewTarget(u);
    }
  }

  async onClick(t) {
    if (this.mode === 'busy' || this.phase !== 'player') return;
    const u = t ? this.board.unitAt(t.x, t.y) : null;
    if (this.mode === 'idle') {
      if (u && u.side === 'player' && !u.acted) this.select(u);
      else if (u) { this.game.audio.sfx('select', { volume: 0.5 }); this.game.ui.showUnit(u); }
      return;
    }
    if (this.mode === 'selected') {
      if (!t) return;
      if (u === this.sel) { await this.openMenu(); return; }
      if (u && u.side === 'player' && !u.acted) { this.select(u); return; }
      if (this.reach.ends.has(key(t.x, t.y))) { await this.moveSelected(t); await this.openMenu(); return; }
      if (u && this.board.hostile(this.sel, u)) {
        const from = this.bestAttackTile(this.sel, u);
        if (from) {
          if (from.x !== this.sel.x || from.y !== this.sel.y) await this.moveSelected(from);
          await this.openMenu(u);
          return;
        }
      }
      this.game.audio.sfx('cancel');
      this.deselect();
      return;
    }
    if (this.mode === 'target') {
      if (u && this.targeting.targets.includes(u)) await this.confirmTarget(u);
      else { this.game.audio.sfx('cancel'); this.cancelTargeting(); }
    }
  }

  onCancel() {
    if (this.mode === 'selected') { this.game.audio.sfx('cancel'); this.deselect(); }
    else if (this.mode === 'target') { this.game.audio.sfx('cancel'); this.cancelTargeting(); }
    else if (this.mode === 'menu') this.game.ui.closeMenu();
  }

  onKey(e) {
    const k = e.key;
    if (this.mode === 'busy' || this.phase !== 'player') return;
    if (k === 'Escape' || k === 'Backspace') { this.onCancel(); return; }
    if (k.toLowerCase() === 'r' && !e.repeat) this.toggleDanger();
    if (k === 'Tab') {
      e.preventDefault();
      const n = this.nextReady(this.sel);
      if (n) { this.select(n); this.rig.focus(this.world.tileCenter(n.x, n.y)); }
      return;
    }
    if (k.startsWith('Arrow')) {
      e.preventDefault();
      const cur = this.hoverTile || (this.sel ? { x: this.sel.x, y: this.sel.y } : { x: 0, y: 0 });
      const f = this.rig.groundForward(new THREE.Vector3());
      const r = this.rig.groundRight(new THREE.Vector3());
      const dir = { ArrowUp: f, ArrowDown: f.clone().negate(), ArrowRight: r, ArrowLeft: r.clone().negate() }[k];
      const dx = Math.abs(dir.x) > Math.abs(dir.z) ? Math.sign(dir.x) : 0;
      const dy = dx === 0 ? Math.sign(dir.z) : 0;
      const nt = { x: Math.max(0, Math.min(this.board.W - 1, cur.x + dx)), y: Math.max(0, Math.min(this.board.H - 1, cur.y + dy)) };
      this.onHover(nt);
      this.rig.focus(this.world.tileCenter(nt.x, nt.y));
      return;
    }
    if ((k === 'Enter' || k === ' ') && this.hoverTile && this.mode !== 'menu') { e.preventDefault(); this.onClick(this.hoverTile); }
  }

  select(u) {
    this.deselect();
    this.sel = u;
    this.mode = 'selected';
    this.view(u).setSelected(true);
    this.overlay.clearAll(['danger']);
    this.reach = this.showRanges(u);
    this.game.ui.showUnit(u);
    this.game.audio.sfx('select');
    this.view(u).char.play('talk');
    this.world.setFoliageFade?.(u.x, u.y, 2.5);
  }

  deselect() {
    if (this.sel) this.view(this.sel)?.setSelected(false);
    this.sel = null;
    this.reach = null;
    this.targeting = null;
    if (this.overlay) { this.overlay.clearAll(['danger']); }
    this.game.ui.hideForecast();
    this.world?.setFoliageFade?.(-1, -1, 0);
    if (this.mode !== 'busy') this.mode = 'idle';
  }

  bestAttackTile(u, target) {
    if (!this.reach) return null;
    const ranges = [];
    if (u.atkRange) ranges.push(u.atkRange);
    for (const s of u.spells) { const sp = SPELLS[s]; if (sp.target === 'enemy' && u.mp >= sp.mp) ranges.push(sp.range); }
    let best = null;
    for (const k of this.reach.ends) {
      const n = this.reach.nodes.get(k);
      const d = manhattan(n.x, n.y, target.x, target.y);
      if (!ranges.some(([a, b]) => d >= a && d <= b)) continue;
      const hv = this.hoverTile && this.hoverTile.x === n.x && this.hoverTile.y === n.y ? -5 : 0;
      const score = n.cost - (this.board.terrain(n.x, n.y).def || 0) * 0.5 + hv;
      if (!best || score < best.score) best = { x: n.x, y: n.y, score };
    }
    return best;
  }

  async moveSelected(t) {
    const u = this.sel;
    this.mode = 'busy';
    this.overlay.clearAll(['danger']);
    const path = this.board.pathTo(this.reach, t.x, t.y);
    this.moveFrom = { x: u.x, y: u.y };
    await this.view(u).moveAlong(path, { onStep: () => this.game.audio.sfx('step', { volume: 0.35 }) });
    u.x = t.x; u.y = t.y;
    u.moved = true;
    this.world.setFoliageFade?.(u.x, u.y, 2.5);
  }

  undoMove() {
    const u = this.sel;
    if (!u || !this.moveFrom) return;
    u.x = this.moveFrom.x; u.y = this.moveFrom.y;
    this.view(u).placeAt(u.x, u.y);
    this.moveFrom = null;
    u.moved = false;
  }

  dispose() {
    this.disposed = true;
    this.unsub?.();
    this.input?.dispose();
    this.ambient?.stop?.();
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.overlay?.dispose();
    this.vfx?.dispose();
    this.env?.dispose();
    this.world?.dispose();
    this.game.cinematic?.clearModels();
    this.scene?.clear();
  }
}

Object.assign(Battle.prototype, actions);
