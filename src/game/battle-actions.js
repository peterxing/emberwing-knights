// Player/AI actions for the Battle controller (mixed into Battle.prototype).
import * as THREE from 'three';
import { forecast, resolveCombat, resolveHeal, combatExp, healExp, gainExp, counterSpell } from './combat.js';
import { SPELLS } from './data/spells.js';
import { ITEMS, WEAPONS, itemInfo } from './data/items.js';
import { RETREAT_LINES } from './data/chapters/index.js';
import { runScript, triggerEvents, talkTargets, giveGift } from './battle-script.js';
import { key, manhattan, wait, tweens, ease } from '../core/util.js';

const ICON = { attack: '⚔', magic: '✦', item: '◍', talk: '❝', visit: '⌂', open: '⧈', wait: '◷', back: '↩' };

export const actions = {
  // ------------------------------------------------------------------ menus
  actionItems(u) {
    const b = this.board;
    const items = [];
    const hostilesIn = (r) => r && b.hostilesInRange(u, u.x, u.y, r[0], r[1]).length > 0;
    if (u.canStrike) items.push({ id: 'attack', label: 'Attack', icon: ICON.attack, disabled: !hostilesIn(u.atkRange) });
    const usable = this.usableSpells(u);
    if (u.spells.length) items.push({ id: 'magic', label: u.clsData?.weapon === 'staff' || u.clsData?.weapon === 'rod' ? 'Magic' : 'Skill', icon: ICON.magic, note: `${u.mp} MP`, disabled: !usable.length });
    const inv = this.game.state.itemList().filter(([id]) => ITEMS[id]);
    if (inv.length) items.push({ id: 'item', label: 'Item', icon: ICON.item });
    if (talkTargets(this, u).length) items.push({ id: 'talk', label: 'Talk', icon: ICON.talk });
    const village = (this.ch.villages || []).find((v) => v.x === u.x && v.y === u.y && !this.visited.has(key(v.x, v.y)));
    if (village) items.push({ id: 'visit', label: 'Visit', icon: ICON.visit });
    if (this.chestNear(u)) items.push({ id: 'open', label: 'Open Chest', icon: ICON.open });
    items.push({ sep: true });
    items.push({ id: 'wait', label: 'Wait', icon: ICON.wait });
    return items;
  },

  usableSpells(u) {
    const b = this.board;
    return u.spells.filter((s) => {
      const sp = SPELLS[s];
      if (u.mp < sp.mp) return false;
      if (sp.target === 'self') return true;
      if (sp.target === 'enemy') return b.hostilesInRange(u, u.x, u.y, sp.range[0], sp.range[1]).length > 0;
      return b.friendsInRange(u, u.x, u.y, sp.range[0], sp.range[1]).some((o) => o !== u && o.hp < o.maxHp);
    });
  },

  chestNear(u) {
    return (this.ch.chests || []).find((c) => !this.opened.has(key(c.x, c.y)) && manhattan(c.x, c.y, u.x, u.y) <= 1) || null;
  },

  async openMenu(preTarget = null) {
    const u = this.sel;
    const { ui } = this.game;
    this.mode = 'menu';
    this.overlay.clearAll(['danger']);
    this.overlay.setCursor({ x: u.x, y: u.y });
    if (preTarget && u.canStrike && u.atkRange) {
      const d = manhattan(u.x, u.y, preTarget.x, preTarget.y);
      if (d >= u.atkRange[0] && d <= u.atkRange[1]) { this.startTargeting({ kind: 'attack' }, preTarget); return; }
    }
    const choice = await ui.menu(this.actionItems(u), this.screenPos(u), u.name);
    if (this.mode !== 'menu') return;
    if (choice === null) {
      this.undoMove();
      this.select(u);
      return;
    }
    if (choice === 'attack') this.startTargeting({ kind: 'attack' });
    else if (choice === 'magic') {
      const list = u.spells.map((s) => {
        const sp = SPELLS[s];
        const ok = this.usableSpells(u).includes(s);
        return { id: s, label: sp.name, icon: sp.kind === 'heal' ? '✚' : '✦', note: `${sp.mp} MP`, disabled: !ok };
      });
      list.push({ sep: true }, { id: 'back', label: 'Back', icon: ICON.back });
      const sp = await ui.menu(list, this.screenPos(u), 'Magic');
      if (!sp || sp === 'back') { await this.openMenu(); return; }
      const sd = SPELLS[sp];
      if (sd.target === 'self') { await this.executeHeal(u, u, sp); await this.commit(u); return; }
      this.startTargeting({ kind: 'spell', spell: sp });
    } else if (choice === 'item') {
      const list = this.game.state.itemList().filter(([id]) => ITEMS[id]).map(([id, n]) => ({ id, label: ITEMS[id].name, icon: ITEMS[id].icon || '◍', note: `×${n}` }));
      list.push({ sep: true }, { id: 'back', label: 'Back', icon: ICON.back });
      const it = await ui.menu(list, this.screenPos(u), 'Items');
      if (!it || it === 'back') { await this.openMenu(); return; }
      this.startTargeting({ kind: 'item', item: it });
    } else if (choice === 'talk') this.startTargeting({ kind: 'talk' });
    else if (choice === 'visit') { await this.doVisit(u); await this.commit(u); }
    else if (choice === 'open') { await this.doOpenChest(u); await this.commit(u); }
    else if (choice === 'wait') await this.commit(u);
  },

  startTargeting(spec, pre = null) {
    const u = this.sel;
    const b = this.board;
    let targets = [];
    let range = [1, 1];
    let layer = 'attack';
    if (spec.kind === 'attack') { range = u.atkRange; targets = b.hostilesInRange(u, u.x, u.y, range[0], range[1]); }
    else if (spec.kind === 'spell') {
      const sp = SPELLS[spec.spell];
      range = sp.range;
      if (sp.target === 'enemy') targets = b.hostilesInRange(u, u.x, u.y, range[0], range[1]);
      else { layer = 'heal'; targets = b.friendsInRange(u, u.x, u.y, range[0], range[1]).filter((o) => o !== u && o.hp < o.maxHp); }
    } else if (spec.kind === 'item') {
      layer = 'heal'; range = [0, 1];
      targets = b.friendsInRange(u, u.x, u.y, 0, 1).filter((o) => o.side === 'player');
    } else if (spec.kind === 'talk') {
      layer = 'heal';
      targets = talkTargets(this, u).map((t) => t.target);
    }
    this.targeting = { ...spec, targets };
    this.mode = 'target';
    this.overlay.setLayer(layer, b.tilesInRange(u.x, u.y, range[0], range[1]));
    this.overlay.setLayer('target', targets.map((t) => ({ x: t.x, y: t.y })));
    const first = pre && targets.includes(pre) ? pre : targets[0];
    if (first) { this.overlay.setCursor({ x: first.x, y: first.y }); this.hoverTile = { x: first.x, y: first.y }; this.previewTarget(first); }
  },

  previewTarget(t) {
    const { ui } = this.game;
    const tg = this.targeting;
    if (!tg || !t || !tg.targets.includes(t)) { ui.hideForecast(); this.overlay.clearLayer('aoe'); return; }
    const u = this.sel;
    if (tg.kind === 'attack' || (tg.kind === 'spell' && SPELLS[tg.spell].target === 'enemy')) {
      const fc = forecast(this.board, u, t, tg.kind === 'spell' ? tg.spell : null);
      const cs = !t.canStrike && fc.def ? counterSpell(t) : null;
      ui.forecast(u, t, fc, { spell: tg.kind === 'spell' ? tg.spell : null, counterSpell: cs });
      const sp = tg.kind === 'spell' ? SPELLS[tg.spell] : null;
      if (sp && sp.area) this.overlay.setLayer('aoe', this.board.tilesInRange(t.x, t.y, 0, sp.area));
      else this.overlay.clearLayer('aoe');
    } else if (tg.kind === 'spell') {
      const sp = SPELLS[tg.spell];
      ui.healForecast(u, t, sp.power + Math.floor(u.magPower / 2), sp.name);
    } else if (tg.kind === 'item') {
      const it = ITEMS[tg.item];
      if (it.heal) ui.healForecast(u, t, it.heal, it.name); else ui.hideForecast();
    } else ui.hideForecast();
  },

  cancelTargeting() {
    this.targeting = null;
    this.game.ui.hideForecast();
    this.overlay.clearLayer('target'); this.overlay.clearLayer('attack'); this.overlay.clearLayer('heal'); this.overlay.clearLayer('aoe');
    this.openMenu();
  },

  async confirmTarget(t) {
    const tg = this.targeting;
    const u = this.sel;
    this.mode = 'busy';
    this.game.ui.hideForecast();
    this.overlay.clearAll(['danger']);
    this.game.audio.sfx('confirm');
    if (tg.kind === 'attack') await this.executeAttack(u, t, null);
    else if (tg.kind === 'spell') {
      if (SPELLS[tg.spell].target === 'enemy') await this.executeAttack(u, t, tg.spell);
      else await this.executeHeal(u, t, tg.spell);
    } else if (tg.kind === 'item') await this.useItem(u, t, tg.item);
    else if (tg.kind === 'talk') await this.doTalk(u, t);
    if (this.over) return;
    if (u.alive) await this.commit(u);
    else { this.sel = null; this.mode = 'idle'; this.maybeAutoEnd(); }
  },

  async commit(u) {
    this.mode = 'busy';
    this.view(u)?.setSelected(false);
    u.acted = true;
    this.view(u)?.setGreyed(true);
    this.moveFrom = null;
    this.sel = null;
    this.reach = null;
    this.targeting = null;
    this.overlay.clearAll(['danger']);
    this.game.ui.hideForecast();
    this.world.setFoliageFade?.(-1, -1, 0);
    if (u.alive) {
      await this.checkHidden(u);
      await triggerEvents(this, { type: 'reach', unit: u });
    }
    if (this.checkEnd()) return;
    this.refreshDanger();
    this.mode = 'idle';
    this.game.ui.showUnit(null);
    this.maybeAutoEnd();
  },

  maybeAutoEnd() {
    if (this.over || this.phase !== 'player') return;
    const left = this.board.alive.filter((p) => p.side === 'player' && !p.acted);
    if (!left.length && this.game.settings.autoEnd) setTimeout(() => this.endPlayerPhase(), 350);
  },

  // ------------------------------------------------------------------ combat
  async executeAttack(a, d, spell) {
    const { ui, cinematic, settings, audio } = this.game;
    this.mode = 'busy';
    const va = this.view(a), vd = this.view(d);
    va.faceTile(d.x, d.y); vd.faceTile(a.x, a.y);
    const boss = [a, d].find((x) => x.boss && !this.bossSeen.has(x.id));
    if (boss && this.ch.bossLines?.[boss.id]) {
      this.bossSeen.add(boss.id);
      await this.rig.glide(this.world.tileCenter(boss.x, boss.y), { duration: 0.5 });
      await runScript(this, this.ch.bossLines[boss.id]);
      this.mode = 'busy';
    }
    const fc = forecast(this.board, a, d, spell);
    const res = resolveCombat(this.board, a, d, this.rng, spell);
    if (settings.anim === 'full') {
      const bossFight = a.boss || d.boss;
      await cinematic.play(res, {
        terrain: this.board.tchar(d.x, d.y), preset: this.mapDef.environment, palette: this.mapDef.palette, grade: this.env.preset, forecast: fc,
        music: bossFight ? (d.id === 'nidhvar' || a.id === 'nidhvar' ? 'final' : 'boss') : 'battle', resumeMusic: this.musicFor(this.phase),
      });
      va.refreshHp(); vd.refreshHp();
    } else {
      await this.mapCombatAnim(res);
    }
    for (const s of res.splash) {
      const v = this.view(s.unit);
      v.char.play(s.hit ? 'hit' : 'dodge');
      this.vfx.floatText(v.char.getAnchor('overhead'), s.hit ? String(s.dmg) : 'MISS', { size: 1.4 });
      v.animateHp(s.hpBefore, s.hpAfter);
    }
    if (res.splash.length) await wait(0.5);
    const dealtA = res.strikes.some((s) => s.by === 'a' && s.hit);
    const dealtD = res.strikes.some((s) => s.by === 'd' && s.hit);
    if (res.dDied) await this.killUnit(d, a);
    if (res.aDied) await this.killUnit(a, d);
    for (const s of res.splash) if (s.died && s.unit.alive !== false) await this.killUnit(s.unit, a);
    if (this.over && this.result === 'defeat') return;
    if (a.alive && a.side === 'player') {
      let exp = combatExp(a, d, { dealt: dealtA, kill: res.dDied });
      for (const s of res.splash) exp += combatExp(a, s.unit, { dealt: s.hit, kill: s.died }) >> 1;
      await this.giveExp(a, exp);
    }
    if (d.alive && d.side === 'player') await this.giveExp(d, combatExp(d, a, { dealt: dealtD, kill: res.aDied }));
    audio.sfx('menu', { volume: 0 });
    this.checkEnd();
  },

  async mapCombatAnim(res) {
    const A = res.attacker, D = res.defender;
    for (const s of res.strikes) {
      const S = s.by === 'a' ? A : D, T = s.by === 'a' ? D : A;
      const sv = this.view(S), tv = this.view(T);
      const spellId = s.by === 'a' ? res.spell : res.counterSpell;
      const sp = spellId ? SPELLS[spellId] : null;
      const w = WEAPONS[S.weapon];
      const chest = tv.char.getAnchor('chest');
      const impact = () => {
        if (!s.hit) { tv.char.play('dodge'); this.vfx.floatText(tv.char.getAnchor('overhead'), 'MISS', { size: 1.5 }); this.game.audio.sfx('miss'); return; }
        tv.char.play('hit'); tv.char.flash();
        if (!sp || sp.kind !== 'magic') this.vfx.hitSpark(chest, { crit: s.crit });
        this.vfx.floatText(tv.char.getAnchor('overhead'), String(s.dmg), { crit: s.crit, size: 1.6 });
        this.game.audio.sfx(s.crit ? 'crit' : 'hit');
        this.rig.shake(s.crit ? 0.25 : 0.1, 0.3);
        tv.animateHp(s.hpAfter + s.dmg, s.hpAfter);
        if (s.drain) sv.animateHp(s.attackerHpAfter - s.drain, s.attackerHpAfter);
      };
      if (sp && sp.kind === 'magic') {
        let p = null;
        await sv.char.play('cast', { onImpact: () => { p = this.vfx.spell(sp.fx, { from: sv.char.getAnchor('chest'), to: chest, ground: tv.char.getAnchor('feet'), onImpact: impact, scale: 1.4 }); } });
        if (p) await p;
      } else if ((w && w.type === 'bow') || res.dist >= 2) {
        let p = null;
        await sv.char.play(w && w.type === 'bow' ? 'shoot' : 'attack', { onImpact: () => { this.game.audio.sfx('arrow'); p = this.vfx.projectile('arrow', sv.char.getAnchor('hand'), chest, { onImpact: impact }); } });
        if (p) await p;
      } else {
        if (sp && sp.kind === 'physical') this.vfx.spell('dragonFang', { from: sv.char.getAnchor('weapon'), to: chest, ground: tv.char.getAnchor('feet'), scale: 1.3 });
        await sv.lunge(T.x, T.y, impact);
      }
      await wait(0.2);
      if (s.hpAfter <= 0) break;
    }
  },

  async executeHeal(c, t, spellId) {
    const { cinematic, settings } = this.game;
    this.mode = 'busy';
    const res = resolveHeal(this.board, c, t, spellId);
    const sp = SPELLS[spellId];
    if (settings.anim === 'full' && !sp.area) {
      await cinematic.play(res, { terrain: this.board.tchar(t.x, t.y), preset: this.mapDef.environment, palette: this.mapDef.palette, grade: this.env.preset, music: 'battle', resumeMusic: this.musicFor(this.phase) });
      for (const h of res.heals) this.view(h.unit)?.refreshHp();
    } else {
      const cv = this.view(c);
      let p = null;
      await cv.char.play('cast', {
        onImpact: () => {
          this.game.audio.sfx('heal');
          p = this.vfx.spell(sp.area ? 'healAll' : 'heal', { from: cv.char.getAnchor('chest'), to: this.view(t).char.getAnchor('chest'), ground: this.view(t).char.getAnchor('feet'), scale: 1.3 });
          for (const h of res.heals) {
            const v = this.view(h.unit);
            this.vfx.floatText(v.char.getAnchor('overhead'), `+${h.amount}`, { color: '#7dffb0', heal: true, size: 1.5 });
            v.animateHp(h.hpBefore, h.hpAfter);
          }
        },
      });
      if (p) await p;
    }
    if (c.side === 'player') await this.giveExp(c, healExp(c, res.heals.length));
  },

  async killUnit(u, killer) {
    const { state, ui, audio } = this.game;
    if (u._dying) return;
    u._dying = true;
    u.alive = false;
    const v = this.view(u);
    audio.sfx('death', { volume: 0.7 });
    this.vfx.deathBurst(v.char.getAnchor('chest'), u.side === 'player' ? 0x7fc8ff : 0xff8a5a);
    await v.die();
    if (u.side === 'enemy') {
      state.stats.kills++;
      if (u.gold) { state.gold += u.gold; ui.setGold(state.gold); ui.toast(`+${u.gold} gold`, '◈'); audio.sfx('gold', { volume: 0.6 }); }
      if (u.drops) { const info = itemInfo(u.drops); if (WEAPONS[u.drops]) state.addWeapon(u.drops); else state.addItem(u.drops); ui.toast(`Obtained ${info?.name || u.drops}`, '✦'); }
      if (this.ch.defeatLines?.[u.id]) await runScript(this, this.ch.defeatLines[u.id]);
    } else if (u.side === 'player') {
      const line = RETREAT_LINES[u.id];
      if (line) await runScript(this, [{ say: u.id, e: line.e, t: line.t }]);
    }
    await triggerEvents(this, { type: 'defeated', id: u.id });
    this.refreshDanger();
    this.checkEnd();
  },

  async giveExp(u, amount) {
    if (!amount || !u.alive || !u.isHero || u.side !== 'player') return;
    const { ui, audio } = this.game;
    const ups = gainExp(u, amount, this.rng);
    await ui.expPop(u, amount, this.screenPos(u));
    for (const rec of ups) {
      const v = this.view(u);
      const pos = this.world.tileCenter(u.x, u.y);
      if (rec.promoted) {
        audio.sfx('promote');
        await this.rig.glide(pos, { dist: 12, duration: 0.6 });
        this.vfx.promotion(pos);
        await wait(0.8);
        giveGift(this, u);
        v.rebuild();
        this.game.dialogue.promoted.add(u.id);
      } else {
        audio.sfx('levelUp');
        this.vfx.levelUp(pos);
      }
      v.char.play('levelup');
      v.refreshHp();
      await ui.levelUp(u, rec);
    }
  },

  // ------------------------------------------------------------------ items, villages, chests, talk, treasure
  async useItem(u, t, itemId) {
    const { state, ui, audio } = this.game;
    const it = ITEMS[itemId];
    if (!it || !state.useItem(itemId)) return;
    const v = this.view(t);
    const pos = v.char.getAnchor('chest');
    this.view(u).char.play('talk');
    if (it.heal) {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + it.heal);
      audio.sfx('heal');
      await this.vfx.spell('heal', { from: pos, to: pos, ground: v.char.getAnchor('feet'), scale: 1.2 });
      this.vfx.floatText(v.char.getAnchor('overhead'), `+${t.hp - before}`, { color: '#7dffb0', heal: true, size: 1.5 });
      await v.animateHp(before, t.hp);
    } else if (it.mp) {
      t.mp = Math.min(t.maxMp, t.mp + it.mp);
      audio.sfx('item');
      this.vfx.buff(pos, 0x8f7dff);
      this.vfx.floatText(v.char.getAnchor('overhead'), `+${it.mp} MP`, { color: '#b9adff', size: 1.4 });
      await wait(0.6);
    } else if (it.stat) {
      t.stats[it.stat] += it.amount;
      if (it.stat === 'hp') t.hp += it.amount;
      audio.sfx('levelUp');
      this.vfx.buff(pos, 0xffd35a);
      ui.toast(`${t.name}: ${it.desc}`, it.icon);
      await wait(0.8);
      v.refreshHp();
    }
    ui.showUnit(t);
  },

  async doVisit(u) {
    const { state, ui, audio } = this.game;
    const vil = (this.ch.villages || []).find((v) => v.x === u.x && v.y === u.y);
    if (!vil) return;
    this.visited.add(key(vil.x, vil.y));
    audio.sfx('door');
    this.world.setVillageVisited?.(vil.x, vil.y);
    await runScript(this, vil.lines || []);
    if (vil.gold) { state.gold += vil.gold; ui.setGold(state.gold); ui.toast(`Received ${vil.gold} gold`, '◈'); audio.sfx('gold'); }
    if (vil.item) {
      const info = itemInfo(vil.item);
      if (WEAPONS[vil.item]) state.addWeapon(vil.item); else state.addItem(vil.item, vil.qty || 1);
      ui.toast(`Received ${info?.name || vil.item}${vil.qty > 1 ? ` ×${vil.qty}` : ''}`, info?.icon || '✦');
      audio.sfx('item');
    }
  },

  async doOpenChest(u) {
    const { state, ui, audio } = this.game;
    const c = this.chestNear(u);
    if (!c) return;
    this.opened.add(key(c.x, c.y));
    this.view(u).faceTile(c.x, c.y);
    audio.sfx('chest');
    await this.world.openChest?.(c.x, c.y);
    const pos = this.world.tileCenter(c.x, c.y).add(new THREE.Vector3(0, 0.3, 0));
    this.vfx.chestOpen(pos);
    if (c.gold) { state.gold += c.gold; ui.setGold(state.gold); ui.toast(`Found ${c.gold} gold!`, '◈'); audio.sfx('gold'); }
    if (c.item) {
      const info = itemInfo(c.item);
      if (WEAPONS[c.item]) state.addWeapon(c.item); else state.addItem(c.item, c.qty || 1);
      ui.toast(`Found ${info?.name || c.item}!`, info?.icon || '⚔');
      audio.sfx('item');
    }
    await wait(0.5);
  },

  async doTalk(u, t) {
    const found = talkTargets(this, u).find((x) => x.target === t);
    if (!found) return;
    this.view(u).faceTile(t.x, t.y);
    this.view(t).faceTile(u.x, u.y);
    this.fired.add(found.eventIndex);
    await runScript(this, this.ch.events[found.eventIndex].actions);
  },

  async checkHidden(u) {
    if (u.side !== 'player') return;
    const h = (this.ch.hidden || []).find((x) => x.x === u.x && x.y === u.y && !this.found.has(key(x.x, x.y)));
    if (!h) return;
    const { state, ui, audio } = this.game;
    this.found.add(key(h.x, h.y));
    const info = itemInfo(h.item);
    if (WEAPONS[h.item]) state.addWeapon(h.item); else state.addItem(h.item, 1);
    const pos = this.world.tileCenter(u.x, u.y).add(new THREE.Vector3(0, 0.4, 0));
    this.vfx.chestOpen(pos);
    audio.sfx('item');
    ui.toast(`${u.name} dug up ${info?.name || h.item}!`, info?.icon || '✦');
    this.view(u).char.play('jump');
    await wait(0.6);
  },
};

export { tweens, ease };
