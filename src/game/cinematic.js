// FD2-style side-view battle cutscenes: two combatants on a themed stage with choreographed
// camera moves, spells, hit-stop, damage numbers, deaths and an HP HUD.
import * as THREE from 'three';
import { Arena } from '../gfx/arena.js';
import { createCharacter } from '../gfx/characters.js';
import { VFX } from '../gfx/vfx.js';
import { tweens, ease, wait } from '../core/util.js';
import { SPELLS } from './data/spells.js';
import { WEAPONS } from './data/items.js';

const ELEMENT_COLOR = { fire: 0xff7a2a, ice: 0x7fd8ff, thunder: 0xffe45a, holy: 0xfff0a8, dark: 0xb04dff, heal: 0x7dffb0 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Cinematic {
  constructor(engine, ui, audio, getSettings) {
    this.engine = engine;
    this.ui = ui;
    this.audio = audio;
    this.getSettings = getSettings;
    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 400);
    this.arena = null;
    this.vfx = null;
    this.models = new Map();
    this.camPos = V(0, 1.3, 7.5);
    this.camLook = V(0, 0.75, 0);
    this.drift = 0;
    this.fast = false;
    this.unsub = engine.onUpdate((dt, el) => this.update(dt, el));
    this.active = false;
  }

  _ensureArena(terrain, preset, palette) {
    if (!this.arena) {
      this.arena = new Arena(this.engine.renderer, { terrain, preset, palette });
      this.vfx = new VFX(this.arena.scene);
    } else this.arena.setTerrain(terrain, preset, palette);
  }

  /** Build the stage and compile its shaders ahead of the first fight (call while the screen is faded out). */
  async prewarm(terrain, preset, palette) {
    this._ensureArena(terrain || '.', preset || 'day', palette);
    try { this.vfx.precompile?.(this.engine.renderer, this.camera); await this.engine.renderer.compileAsync(this.arena.scene, this.camera); } catch (e) { /* compile lazily */ }
  }

  _model(u) {
    const k = `${u.uid}|${u.promoted ? 1 : 0}`;
    let m = this.models.get(k);
    if (!m) { m = createCharacter(u.look, { team: u.side, quality: 'high' }); this.models.set(k, m); }
    return m;
  }

  /** Drop cached models (call when a chapter ends). */
  clearModels() {
    for (const m of this.models.values()) { m.root.parent?.remove(m.root); m.dispose(); }
    this.models.clear();
  }

  update(dt, el) {
    if (!this.active) return;
    const sdt = dt * (this.fast ? 2.5 : 1) * tweens.timeScale;
    for (const m of this.inScene || []) m.update(sdt);
    this.vfx?.update(sdt, this.camera);
    this.arena?.update(sdt, el, this.camera);
    this.drift += dt;
    this.camera.position.copy(this.camPos);
    this.camera.position.x += Math.sin(this.drift * 0.6) * 0.04;
    this.camera.position.y += Math.sin(this.drift * 0.9) * 0.02;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT / 0.35);
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
    }
    this.camera.lookAt(this.camLook);
  }

  shake(m = 0.12) { this.shakeMag = m; this.shakeT = 0.35; }

  camTo(pos, look, dur = 0.6, e = ease.inOutCubic) {
    if (this.big) { pos = pos.clone(); pos.z = pos.z * 1.45 + 1.0; pos.y += 0.9; look = look.clone(); look.y += 0.55; }
    const p0 = this.camPos.clone(), l0 = this.camLook.clone();
    return tweens.run(dur, (t) => { this.camPos.lerpVectors(p0, pos, t); this.camLook.lerpVectors(l0, look, t); }, e);
  }

  async hitStop(sec = 0.12) {
    tweens.timeScale = 0.12;
    await new Promise((r) => setTimeout(r, sec * 1000));
    tweens.timeScale = this.fast ? 2.5 : 1;
  }

  /**
   * Play a combat or heal result.
   * ctx: { terrain, preset, grade, music, resumeMusic }
   */
  async play(res, ctx) {
    const st = this.getSettings();
    this.fast = false;
    const heal = res.kind === 'heal';
    const A = heal ? res.caster : res.attacker;
    const D = heal ? res.target : res.defender;
    const prev = { scene: this.engine.scene, camera: this.engine.camera };
    const tiltOn = this.engine.tiltPass.uniforms.uEnabled.value;
    const done = await this.ui.wipe();
    this.audio.playMusic(ctx.music || 'battle', { fade: 0.25 });
    this._ensureArena(ctx.terrain || '.', ctx.preset || 'day', ctx.palette);
    const aRight = heal ? true : (A.side !== 'enemy');
    const leftU = aRight ? D : A, rightU = aRight ? A : D;
    const mL = this._model(leftU), mR = this._model(rightU);
    const spread = !heal && res.dist >= 2 ? 1.0 : 0;
    const homeL = this.arena.leftSpot.clone().add(V(-spread - (leftU.big ? 1.4 : 0), 0, 0));
    const homeR = this.arena.rightSpot.clone().add(V(spread + (rightU.big ? 1.4 : 0), 0, 0));
    this.big = !!(A.big || D.big);
    if (A === D) { mR.root.position.copy(homeR); } else { mL.root.position.copy(homeL); mR.root.position.copy(homeR); }
    mL.setFacing(Math.PI / 2, true); mR.setFacing(-Math.PI / 2, true);
    mL.setDissolve(0); mR.setDissolve(0); mL.setGreyed(false); mR.setGreyed(false);
    this.inScene = A === D ? [mR] : [mL, mR];
    for (const m of this.inScene) {
      this.arena.scene.add(m.root);
      m.setState((m === mL ? leftU : rightU).flying ? 'fly' : 'ready');
      m.setExpression('angry');
    }
    this.homes = new Map([[leftU, homeL], [rightU, homeR]]);
    this.side = new Map([[leftU, 'left'], [rightU, 'right']]);
    this.mdl = new Map([[leftU, mL], [rightU, mR]]);
    this.engine.setView(this.arena.scene, this.camera);
    this.engine.setTiltShift({ enabled: false });
    if (this.arena.grade || this.arena.env?.preset || this.arena.environment?.preset) this.engine.setGrade(this.arena.grade || this.arena.env?.preset || this.arena.environment?.preset);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.camPos.set(0, 1.5, 9.5);
    this.camLook.set(0, 0.8, 0);
    this.active = true;
    this.ui.showHud(false);
    this.ui.setCine(true);
    const info = (u) => {
      if (heal) return { unit: u, hp: u === D ? res.heals[0]?.hpBefore ?? u.hp : u.hp, label: u === A ? SPELLS[res.spell].name : '' };
      const isA = u === A;
      const spell = isA ? res.spell : res.counterSpell;
      return {
        unit: u, hp: isA ? res.hpBefore.a : res.hpBefore.d,
        label: spell ? SPELLS[spell].name : (WEAPONS[u.weapon]?.name || ''),
        stats: isA ? ctx.forecast?.atk : ctx.forecast?.def,
      };
    };
    this.ui.battleHud(info(leftU), info(rightU));
    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn small cine-skip interactive';
    skipBtn.textContent = 'Fast ▸▸';
    skipBtn.onclick = () => { this.fast = true; tweens.timeScale = 2.5; skipBtn.remove(); };
    this.ui.cineRoot.appendChild(skipBtn);
    const keySkip = (e) => { if (e.key === ' ' || e.key === 'Enter') { this.fast = true; tweens.timeScale = 2.5; } };
    window.addEventListener('keydown', keySkip);
    done();
    await this.camTo(V(0, 1.25, 7.4), V(0, 0.8, 0), 0.7, ease.outCubic);

    try {
      if (heal) await this._heal(res);
      else {
        for (const s of res.strikes) {
          await this._strike(res, s);
          if (s.hpAfter <= 0) break;
        }
      }
      await wait(0.55);
    } catch (e) {
      console.error('cinematic error', e);
    }

    window.removeEventListener('keydown', keySkip);
    skipBtn.remove();
    const fin = await this.ui.wipe();
    tweens.timeScale = 1;
    for (const m of this.inScene) { this.arena.scene.remove(m.root); m.setDissolve(0); m.setState('idle'); }
    this.inScene = [];
    this.vfx.clear();
    this.active = false;
    this.ui.setCine(false);
    this.ui.showHud(true);
    this.engine.setView(prev.scene, prev.camera);
    this.engine.setTiltShift({ enabled: !!tiltOn });
    if (ctx.grade) this.engine.setGrade(ctx.grade);
    if (ctx.resumeMusic) this.audio.playMusic(ctx.resumeMusic, { fade: 0.6 });
    fin();
  }

  _mode(res, s) {
    const striker = s.by === 'a' ? res.attacker : res.defender;
    const spellId = s.by === 'a' ? res.spell : res.counterSpell;
    const sp = spellId ? SPELLS[spellId] : null;
    if (sp && sp.kind === 'magic') return { mode: 'magic', sp, spellId };
    const w = WEAPONS[striker.weapon];
    if (w && w.type === 'bow') return { mode: 'bow', sp };
    if (res.dist >= 2) return { mode: 'throw', sp };
    return { mode: sp && sp.kind === 'physical' ? 'skill' : 'melee', sp, spellId };
  }

  async _strike(res, s) {
    const S = s.by === 'a' ? res.attacker : res.defender;
    const T = s.by === 'a' ? res.defender : res.attacker;
    const sm = this.mdl.get(S), tm = this.mdl.get(T);
    const home = this.homes.get(S);
    const dir = Math.sign(this.homes.get(T).x - home.x) || 1;
    const { mode, sp, spellId } = this._mode(res, s);
    const tgtChest = tm.getAnchor('chest');
    const impact = () => this._impact(res, s, S, T, sm, tm, mode, sp);

    if (s.crit) {
      this.audio.sfx('magicCharge', { pitch: 1.5, volume: 0.7 });
      this.engine.flash(0xffffff, 0.35, 0.25);
      sm.setExpression('angry');
      this.vfx.burst(sm.getAnchor('chest'), { count: 40, color: 0xffd35a, speed: 2.2, life: 0.6, size: 0.12, texture: 'star' });
      await this.camTo(V(home.x * 0.85, 1.0, 3.6), V(home.x + dir * 0.4, 0.85, 0), 0.4);
      await wait(0.2);
    }

    if (mode === 'melee' || mode === 'skill') {
      await this.camTo(V(home.x * 0.25, 1.05, 5.6), V((home.x + this.homes.get(T).x) / 2, 0.8, 0), 0.35);
      const contact = this.homes.get(T).clone().add(V(-dir * (T.big ? 1.6 : 0.95), 0, 0));
      contact.y = home.y;
      sm.setState(S.flying ? 'fly' : 'run');
      this.audio.sfx('step', { volume: 0.6 });
      await tweens.run(0.3, (t) => sm.root.position.lerpVectors(home, contact, t), ease.inQuad);
      sm.setState(S.flying ? 'fly' : 'ready');
      if (mode === 'skill') {
        this.vfx.magicCircle(sm.getAnchor('feet'), { color: 0xff7a2a, radius: 0.9, duration: 1.0 });
        this.audio.sfx('fire');
      }
      this.audio.sfx('swing');
      const cam = this.camTo(V(contact.x + dir * 0.6, 0.95, 4.2), V(contact.x + dir * 0.55, 0.8, 0), 0.45, ease.outQuad);
      const p = sm.play(s.crit ? 'attack2' : 'attack', { onImpact: () => impact(), speed: this.fast ? 2.5 : 1 });
      if (mode === 'skill') this.vfx.spell('dragonFang', { from: sm.getAnchor('weapon'), to: tgtChest, ground: tm.getAnchor('feet') });
      await Promise.all([p, cam]);
      await wait(0.18);
      if (S.hp > 0) {
        sm.setState(S.flying ? 'fly' : 'run');
        await tweens.run(0.28, (t) => sm.root.position.lerpVectors(contact, home, t), ease.inOutQuad);
        sm.setState(S.flying ? 'fly' : 'ready');
      }
    } else if (mode === 'bow' || mode === 'throw') {
      await this.camTo(V(home.x - dir * 1.3, 1.1, 3.0), V(home.x + dir * 1.6, 0.9, 0), 0.4);
      if (mode === 'bow') this.audio.sfx('bowDraw');
      let proj = null;
      await sm.play(mode === 'bow' ? 'shoot' : 'attack', {
        speed: this.fast ? 2.5 : 1,
        onImpact: () => {
          this.audio.sfx(mode === 'bow' ? 'arrow' : 'swing');
          const from = sm.getAnchor(mode === 'bow' ? 'hand' : 'weapon');
          proj = this.vfx.projectile('arrow', from, tgtChest.clone(), { speed: 12, arc: mode === 'throw' ? 0.6 : 0.15, onImpact: () => impact() });
          this.camTo(V(this.homes.get(T).x * 0.5, 1.0, 4.6), V(this.homes.get(T).x * 0.85, 0.8, 0), 0.45);
        },
      });
      if (proj) await proj;
      await wait(0.25);
    } else if (mode === 'magic') {
      const col = ELEMENT_COLOR[sp.element] || 0xb48cff;
      await this.camTo(V(home.x - dir * 1.4, 1.15, 2.6), V(home.x + dir * 1.2, 0.9, 0), 0.45);
      const circle = this.vfx.magicCircle(sm.getAnchor('feet'), { color: col, radius: 0.85, duration: 1.6 });
      this.audio.sfx('magicCharge');
      let spellP = null;
      await sm.play('cast', {
        speed: this.fast ? 2.5 : 1,
        onImpact: () => {
          this.audio.sfx({ fire: 'fire', ice: 'ice', thunder: 'thunder', holy: 'holy', dark: 'dark' }[sp.element] || 'fire');
          spellP = this.vfx.spell(sp.fx, { from: sm.getAnchor('chest'), to: tgtChest.clone(), ground: tm.getAnchor('feet'), onImpact: () => impact() });
          this.camTo(V(this.homes.get(T).x * 0.3, 1.25, 5.6), V(this.homes.get(T).x * 0.8, 0.95, 0), 0.6);
        },
      });
      if (spellP) await spellP;
      circle?.stop?.();
      await wait(0.2);
    }
  }

  _impact(res, s, S, T, sm, tm, mode, sp) {
    const chest = tm.getAnchor('chest');
    const head = tm.getAnchor('overhead');
    const side = this.side.get(T);
    if (!s.hit) {
      tm.play('dodge');
      this.audio.sfx('miss');
      this.vfx.floatText(head, 'MISS', { color: '#d6e4ff' });
      return;
    }
    const big = s.crit || s.dmg >= T.maxHp * 0.4;
    tm.play('hit');
    tm.flash(0xffffff, 0.12);
    tm.setExpression('hurt');
    if (mode === 'melee' || mode === 'skill') {
      this.vfx.slash(chest, { color: mode === 'skill' ? 0xff8a3a : (s.crit ? 0xffd35a : 0xbfe4ff), dir: V(Math.sign(chest.x - sm.root.position.x), -0.4, 0), crit: s.crit, thrust: WEAPONS[S.weapon]?.type === 'lance' });
    }
    if (mode !== 'magic') this.vfx.hitSpark(chest, { crit: s.crit, color: s.crit ? 0xffd35a : 0xfff2c0 });
    this.audio.sfx(s.crit ? 'crit' : (mode === 'bow' || mode === 'throw') ? 'arrowHit' : big ? 'heavyHit' : 'hit');
    if (s.crit) { this.audio.duck(0.35, 0.6); this.engine.flash(0xfff4d0, 0.5, 0.3); this.vfx.floatText(V(head.x, head.y + 0.35, head.z), 'CRITICAL!', { color: '#ffd35a', size: 0.8 }); }
    this.vfx.floatText(head, String(s.dmg), { color: s.crit ? '#ffcf4a' : '#ffffff', crit: s.crit, size: s.crit ? 1.3 : 1 });
    this.shake(s.crit ? 0.22 : big ? 0.14 : 0.08);
    this.hitStop(s.crit ? 0.16 : 0.07);
    const startHp = s.hpAfter + s.dmg;
    tweens.run(0.45, (t) => this.ui.setBattleHp(side, startHp - s.dmg * t, T.maxHp), ease.outCubic);
    if (s.drain) {
      const sside = this.side.get(S);
      this.vfx.floatText(sm.getAnchor('overhead'), `+${s.drain}`, { color: '#7dffb0', heal: true });
      this.ui.setBattleHp(sside, s.attackerHpAfter, S.maxHp);
    }
    if (s.hpAfter <= 0) this._death(T, tm);
  }

  async _death(T, tm) {
    await wait(0.35);
    this.audio.sfx('death');
    await tm.play('death');
    this.vfx.deathBurst(tm.getAnchor('feet'), T.side === 'player' ? 0x7fc8ff : 0xff8a5a);
    await tweens.run(0.8, (t) => tm.setDissolve(t), ease.inQuad);
  }

  async _heal(res) {
    const A = res.caster, T = res.target;
    const sm = this.mdl.get(A), tm = this.mdl.get(T) || sm;
    const home = this.homes.get(A);
    await this.camTo(V(home.x * 0.2, 1.2, 5.8), V(0, 0.9, 0), 0.4);
    const circle = this.vfx.magicCircle(sm.getAnchor('feet'), { color: 0x7dffb0, radius: 0.85, duration: 1.6 });
    this.audio.sfx('magicCharge', { pitch: 1.3 });
    let p = null;
    await sm.play('cast', {
      onImpact: () => {
        this.audio.sfx('heal');
        p = this.vfx.spell(SPELLS[res.spell].fx === 'healAll' ? 'healAll' : 'heal', {
          from: sm.getAnchor('chest'), to: tm.getAnchor('chest'), ground: tm.getAnchor('feet'),
          onImpact: () => {
            const h = res.heals.find((x) => x.unit === T) || res.heals[0];
            if (!h) return;
            this.vfx.floatText(tm.getAnchor('overhead'), `+${h.amount}`, { color: '#7dffb0', heal: true });
            tweens.run(0.6, (t) => this.ui.setBattleHp(this.side.get(T) || 'right', h.hpBefore + h.amount * t, T.maxHp), ease.outCubic);
            tm.setExpression('happy');
          },
        });
      },
    });
    if (p) await p;
    circle?.stop?.();
    tm.play('victory');
    await wait(0.4);
  }

  dispose() {
    this.unsub?.();
    this.clearModels();
    this.vfx?.dispose();
    this.arena?.dispose();
  }
}
