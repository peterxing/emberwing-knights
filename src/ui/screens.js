// Title screen (live 3D backdrop), settings modal, defeat screen, credits and loading screen.
import * as THREE from 'three';
import { h, esc } from './ui.js';
import { World } from '../gfx/world.js';
import { Environment } from '../gfx/environment.js';
import { VFX } from '../gfx/vfx.js';
import { createCharacter } from '../gfx/characters.js';
import { lookFor } from '../game/data/cast.js';
import { CHAPTERS } from '../game/data/chapters/index.js';
import { Settings } from '../game/state.js';
import { listSlots, writeSlot, deleteSlot, latestSave, describe, exportSave, importSaveFile, validSave, canSave as storageOK, makeSave } from '../game/saves.js';
import { wait } from '../core/util.js';

const TIPS = [
  'Archers deal double damage to flying units — keep Sora away from bows.',
  'Magic strikes RES instead of DEF. Send Mira against heavily armoured knights.',
  'Forts, gates and thrones restore HP every turn and boost defence.',
  'Vex can sense hidden treasure. Watch for sparkles near her.',
  'A unit that is 4+ SPD faster than its foe strikes twice.',
  'Striking from higher ground improves hit chance and damage.',
  'Press R to toggle the enemy danger zone. Q/E rotate the camera.',
  'Heroes reaching level 10 earn a class change and a unique weapon.',
];

// ------------------------------------------------------------------ title backdrop
export class TitleScene {
  constructor(game) {
    this.game = game;
    const { engine, settings } = game;
    const map = { ...CHAPTERS[0].map, environment: 'title', props: CHAPTERS[0].map.props };
    this.scene = new THREE.Scene();
    this.world = new World(map, { quality: settings.quality });
    this.scene.add(this.world.group);
    this.env = new Environment(this.scene, engine.renderer, 'title', { bounds: this.world.bounds, quality: settings.quality });
    this.vfx = new VFX(this.scene);
    this.amb = this.vfx.ambient('embers', this.world.bounds, { density: 0.8 });
    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 600);
    this.chars = [];
    const lineup = [['kael', 9, 10, true], ['lyra', 8, 11], ['garrick', 10, 11], ['mira', 7, 10], ['fenn', 10, 9], ['vex', 8, 9], ['sora', 6, 11, true]];
    for (const [id, x, y, promoted] of lineup) {
      const c = createCharacter(lookFor(id, !!promoted), { team: 'player' });
      this.world.tileCenter(x, y, c.root.position);
      c.setFacing(Math.PI / 4, true);
      if (id === 'sora') c.setState('fly');
      this.scene.add(c.root);
      this.chars.push(c);
    }
    this.center = this.world.tileCenter(9, 10.5).add(new THREE.Vector3(0, 0.55, 0));
    this.t = 0;
    engine.setView(this.scene, this.camera);
    engine.setGrade(this.env.preset || {});
    engine.setTiltShift({ enabled: settings.quality !== 'low', focusY: 0.5, range: 0.16, blur: 3.0, falloff: 0.32 });
    this.unsub = engine.onUpdate((dt, el) => this.update(dt, el));
  }

  update(dt, el) {
    this.t += dt;
    const W = window.innerWidth, H = window.innerHeight;
    const aspect = W / H;
    const portrait = aspect < 1;
    const fov = portrait ? 42 : 32;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const a = Math.PI / 4 + Math.sin(this.t * 0.06) * 0.32;
    const d = portrait ? 8.2 * Math.min(2.0, 1.15 / aspect) : 8.2;
    this.camera.position.set(this.center.x + Math.sin(a) * d, this.center.y + (portrait ? 4.6 : 3.1) + Math.sin(this.t * 0.11) * 0.3, this.center.z + Math.cos(a) * d);
    this.camera.lookAt(this.center.x, this.center.y + (portrait ? 0.9 : 0.35), this.center.z);
    if (W > 820 && !portrait) this.camera.setViewOffset(W, H, -W * 0.17, -H * 0.04, W, H); else this.camera.clearViewOffset();
    this.world.update(dt, el, this.camera);
    this.env.update(dt, el, this.camera);
    this.vfx.update(dt, this.camera);
    for (const c of this.chars) c.update(dt);
    if (Math.random() < dt * 0.25) this.chars[Math.floor(Math.random() * this.chars.length)].play(Math.random() < 0.5 ? 'talk' : 'jump');
  }

  dispose() {
    this.unsub();
    this.amb?.stop?.();
    for (const c of this.chars) c.dispose();
    this.vfx.dispose();
    this.env.dispose();
    this.world.dispose();
    this.scene.clear();
  }
}

/** Shows the title menu. Resolves to { action: 'new' } or { action: 'load', save }. */
export async function showTitle(game) {
  const { ui, audio, engine } = game;
  const scene = new TitleScene(game);
  scene.update(0, 0);
  try { await engine.renderer.compileAsync(scene.scene, scene.camera); } catch (e) { /* compile lazily */ }
  await engine.fade(0, 1.2);
  const el = h('div', 'screen title-screen');
  el.innerHTML = `<div class="logo"><div class="pre">A TACTICAL RPG</div><h1>EMBERWING<br>KNIGHTS</h1>
    <div class="sub">THE LOST CITY OF AURELION</div><div class="flourish"></div></div>
    <div class="press-start">${game.touch ? 'TAP TO BEGIN' : 'CLICK TO BEGIN'}</div>
    <div class="title-foot">A tribute to the 1990s strategy RPGs we grew up with · Built with three.js · All characters, art, music and story are original</div>`;
  ui.layer.appendChild(el);
  await new Promise((r) => {
    // 'click' (not pointerdown) so the tap is fully consumed before the menu appears, and so iOS unlocks audio.
    const go = async (e) => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (started0) return; started0 = true;
      window.removeEventListener('keydown', go); el.removeEventListener('click', go); el.removeEventListener('pointerup', go);
      let started; try { started = audio.init().catch(() => {}); } catch (err) { console.warn('[audio] init failed', err); started = Promise.resolve(); }
      await Promise.race([started, new Promise((res) => setTimeout(res, 1500))]);
      r();
    };
    let started0 = false;
    window.addEventListener('keydown', go);
    el.addEventListener('click', go);
    el.addEventListener('pointerup', go);
  });
  audio.playMusic('title', { fade: 2 });
  audio.sfx('promote', { volume: 0.6 });
  el.querySelector('.press-start').remove();
  const menu = h('div', 'title-menu');
  const buildMenu = () => {
    const latest = latestSave((s) => s.location !== 'complete');
    const sub = latest ? `${latest.save.summary.chapterNum}${latest.save.location === 'battle' ? ` · Turn ${latest.save.summary.turn}` : ' · Camp'}` : '';
    const opts = [
      ['continue', latest ? `Continue<small class="tm-sub">${esc(sub)}</small>` : 'Continue', !latest],
      ['load', 'Load Game', false],
      ['new', 'New Game', false],
      ['tideglass', 'The First Signal<small class="tm-sub">Side story</small>', false],
      ['settings', 'Settings', false],
      ['credits', 'Credits', false],
    ];
    menu.innerHTML = '';
    for (const [id, label, dis] of opts) {
      const m = h(id === 'tideglass' ? 'a' : 'div', `tm${dis ? ' disabled' : ''}`, label);
      if (id === 'tideglass') m.href = './tideglass/';
      m.dataset.id = id;
      m.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') audio.sfx('cursor', { volume: 0.4 }); });
      menu.appendChild(m);
    }
    return latest;
  };
  let latest = buildMenu();
  el.appendChild(menu);
  const born = performance.now();
  let pick = null;
  menu.addEventListener('click', (e) => {
    const t = e.target.closest('.tm');
    if (!t || t.tagName === 'A' || t.classList.contains('disabled') || performance.now() - born < 300 || !pick) return;
    const p = pick; pick = null; p(t.dataset.id);
  });
  const leave = async (result) => {
    await engine.fade(1, 0.8);
    el.remove();
    scene.dispose();
    return result;
  };
  for (;;) {
    const id = await new Promise((r) => { pick = r; });
    audio.sfx('confirm');
    if (id === 'settings') { await openSettings(game); continue; }
    if (id === 'credits') { await showCredits(game, true); audio.playMusic('title'); continue; }
    if (id === 'continue' && latest) return leave({ action: 'load', save: latest.save });
    if (id === 'load') {
      const save = await openSlotPicker(game, { mode: 'load' });
      if (save) return leave({ action: 'load', save });
      latest = buildMenu();
      continue;
    }
    if (id === 'new' && listSlots().some((s) => s.save) && !(await confirmBox(game, 'Start a new game? Your manual save slots are kept, but the Autosave will be replaced once you play.'))) continue;
    return leave({ action: 'new' });
  }
}

export function confirmBox(game, text, { title = 'Are you sure?', ok = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back confirm-back');
    back.innerHTML = `<div class="modal panel ornate"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions"><button class="btn" data-v="0">Cancel</button><button class="btn primary" data-v="1">${esc(ok)}</button></div></div>`;
    game.ui.layer.appendChild(back);
    back.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { back.remove(); resolve(b.dataset.v === '1'); } });
  });
}

// ------------------------------------------------------------------ save slots
const slotName = (slot) => (slot === 'auto' ? 'Autosave' : `Slot ${slot}`);

/**
 * Save / load picker over the autosave and three manual slots, with export and import of save files.
 * mode 'save': opts.make() builds the save (or returns null if saving isn't possible now); resolves true once saved.
 * mode 'load': resolves to the chosen save (from a slot or an imported file), or null.
 * opts.warn: ask before loading (in-game, unsaved progress would be lost).
 */
export function openSlotPicker(game, { mode, make = null, warn = false } = {}) {
  const { ui, audio } = game;
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal panel ornate slot-modal');
    back.appendChild(box);
    ui.layer.appendChild(back);
    const born = performance.now();
    let busy = false;
    let saved = false;
    const close = (v) => { back.remove(); window.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && !busy && back.isConnected && back === ui.layer.lastElementChild) { e.stopPropagation(); audio.sfx('cancel'); close(mode === 'save' ? saved : null); } };
    window.addEventListener('keydown', onKey);
    const render = () => {
      const rows = listSlots().map(({ slot, save }) => {
        const d = describe(save);
        const usable = mode === 'save' ? slot !== 'auto' : !!save;
        const title = save ? d.title : mode === 'save' ? 'Empty — tap to save here' : 'Empty';
        return `<div class="slot${save ? '' : ' empty'}${usable ? '' : ' locked'}" data-slot="${slot}">
          <div class="slot-name">${slotName(slot)}${slot === 'auto' ? '<small>after every move</small>' : ''}</div>
          <div class="slot-info"><b>${esc(title)}</b>${save ? `<span>${esc(d.detail)}</span><span class="when">${esc(d.when)}</span>` : ''}</div>
          ${save ? `<div class="slot-tools"><button class="btn small" data-export title="Download this save as a file" aria-label="Export">⤓</button>${slot === 'auto' ? '' : '<button class="btn small" data-del title="Delete this save" aria-label="Delete">✕</button>'}</div>` : ''}
        </div>`;
      }).join('');
      box.innerHTML = `<h2>${mode === 'save' ? 'Save Game' : 'Load Game'}</h2>
        ${storageOK() ? '' : '<p class="slot-warn">This browser is blocking storage (private browsing?). Use <b>Export</b> to keep your progress in a file.</p>'}
        <div class="slot-list">${rows}</div>
        <p class="slot-hint">${mode === 'save' ? 'Pick a slot to save to. Export downloads your game as a file you can import on any device.' : 'Pick a save to load, or import a save file.'}</p>
        <div class="actions">
          ${mode === 'save' ? '<button class="btn" data-exportnow>Export to file</button>' : '<button class="btn" data-import>Import file…</button>'}
          <span class="grow"></span><button class="btn primary" data-close>${mode === 'save' && saved ? 'Done' : 'Close'}</button>
        </div>`;
    };
    render();
    back.addEventListener('click', (e) => {
      if (e.target === back && !busy && performance.now() - born >= 320) { audio.sfx('cancel'); close(mode === 'save' ? saved : null); }
    });
    box.addEventListener('click', async (e) => {
      if (busy || performance.now() - born < 320) return;
      const t = e.target;
      if (t.closest('[data-close]')) { audio.sfx('cancel'); close(mode === 'save' ? saved : null); return; }
      if (t.closest('[data-import]')) {
        audio.sfx('select');
        importSaveFile().then((save) => {
          if (save === null || !back.isConnected) return;
          if (!save) { audio.sfx('error'); ui.toast('That file is not an Emberwing Knights save', '⚠'); return; }
          audio.sfx('confirm');
          close(save);
        });
        return;
      }
      if (t.closest('[data-exportnow]')) {
        const s = make?.();
        if (!s) { audio.sfx('error'); ui.toast('You can save during your turn', '⏳'); return; }
        const name = exportSave(s);
        audio.sfx('confirm');
        ui.toast(`Exported ${name}`, '⤓');
        return;
      }
      const row = t.closest('.slot');
      if (!row) return;
      const slot = row.dataset.slot === 'auto' ? 'auto' : +row.dataset.slot;
      const save = listSlots().find((s) => s.slot === slot)?.save || null;
      if (t.closest('[data-export]') && save) { const name = exportSave(save); audio.sfx('confirm'); ui.toast(`Exported ${name}`, '⤓'); return; }
      busy = true;
      try {
        if (t.closest('[data-del]') && save) {
          if (await confirmBox(game, `Delete the save in ${slotName(slot)}? This cannot be undone.`, { title: 'Delete save', ok: 'Delete' })) {
            deleteSlot(slot);
            audio.sfx('cancel');
            render();
          }
          return;
        }
        if (mode === 'save') {
          if (slot === 'auto') { audio.sfx('error'); ui.toast('The Autosave updates itself — pick Slot 1, 2 or 3', 'ℹ'); return; }
          if (save && !(await confirmBox(game, `Overwrite ${slotName(slot)} (${describe(save).title})?`, { title: 'Overwrite save', ok: 'Overwrite' }))) return;
          const s = make?.();
          if (!s) { audio.sfx('error'); ui.toast('You can save during your turn', '⏳'); return; }
          if (!writeSlot(slot, s)) { audio.sfx('error'); ui.toast('Could not save — storage is full or blocked. Try Export.', '⚠'); return; }
          saved = true;
          audio.sfx('promote', { volume: 0.5 });
          ui.toast(`Saved to ${slotName(slot)}`, '💾');
          render();
          box.querySelector(`.slot[data-slot="${slot}"]`)?.classList.add('just-saved');
          return;
        }
        if (!save) return;
        if (warn && !(await confirmBox(game, `Load ${slotName(slot)}? Progress since your last save will be lost.`, { title: 'Load game', ok: 'Load' }))) return;
        audio.sfx('confirm');
        close(save);
      } finally { busy = false; }
    });
  });
}

/** In-battle ☰ menu. Save/load/quit only while it's the player's turn and no unit is mid-action. */
export function openSystemMenu(game, battle) {
  const { ui, audio } = game;
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const render = () => {
      const can = battle.canSave();
      back.innerHTML = `<div class="modal panel ornate sys-menu"><h2>Menu</h2>
        <div class="sys-sub">${esc(battle.ch.num)} — ${esc(battle.ch.title)} · Turn ${battle.turn}</div>
        <div class="sys-list">
          <button class="btn" data-a="save"${can ? '' : ' disabled'}>💾 Save Game</button>
          <button class="btn" data-a="load"${can ? '' : ' disabled'}>📂 Load Game</button>
          <button class="btn" data-a="settings">⚙ Settings</button>
          <button class="btn" data-a="title"${can ? '' : ' disabled'}>⌂ Return to Title</button>
        </div>
        <p class="sys-note">${can ? 'Your progress is also autosaved after every move.' : 'Saving and loading are available during your turn.'}</p>
        <div class="actions"><button class="btn primary" data-a="close">Resume</button></div></div>`;
    };
    render();
    ui.layer.appendChild(back);
    const born = performance.now();
    let busy = false;
    const close = () => { back.remove(); window.removeEventListener('keydown', onKey); resolve(); };
    const onKey = (e) => { if (e.key === 'Escape' && !busy && back === ui.layer.lastElementChild) { audio.sfx('cancel'); close(); } };
    window.addEventListener('keydown', onKey);
    back.addEventListener('click', async (e) => {
      if (busy || performance.now() - born < 320) return;
      if (e.target === back) { audio.sfx('cancel'); close(); return; }
      const b = e.target.closest('button[data-a]');
      if (!b || b.disabled) return;
      const a = b.dataset.a;
      if (a === 'close') { audio.sfx('cancel'); close(); return; }
      audio.sfx('confirm');
      if (a !== 'settings' && !battle.canSave()) { ui.toast('Available during your turn', '⏳'); render(); return; }
      busy = true;
      back.classList.add('dim');
      try {
        if (a === 'settings') await openSettings(game);
        else if (a === 'save') await openSlotPicker(game, { mode: 'save', make: () => (battle.canSave() ? makeSave(game, battle.serialize()) : null) });
        else if (a === 'load') {
          const save = await openSlotPicker(game, { mode: 'load', warn: true });
          if (save && battle.canSave()) { game.pendingLoad = save; close(); battle.abort('load'); return; }
        } else if (a === 'title') {
          if (await confirmBox(game, 'Return to the title screen? Your progress is kept in the Autosave — choose Continue to pick up from here.', { title: 'Return to title', ok: 'Return' })) {
            if (battle.canSave()) { battle.autosave(); close(); battle.abort('title'); return; }
          }
        }
      } finally { busy = false; back.classList.remove('dim'); }
      if (back.isConnected) render();
    });
  });
}

// ------------------------------------------------------------------ settings
export function openSettings(game) {
  const { ui, audio, engine } = game;
  const s = game.settings;
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const seg = (name, opts) => `<div class="seg" data-name="${name}">${opts.map(([v, l]) => `<button class="btn small${s[name] === v ? ' toggled' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    back.innerHTML = `<div class="modal panel ornate"><h2>Settings</h2>
      <div class="setrow"><span>Music volume</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-name="music"></div>
      <div class="setrow"><span>Effects volume</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-name="sfx"></div>
      <div class="setrow"><span>Battle scenes</span>${seg('anim', [['full', 'Cinematic'], ['map', 'Quick (map)']])}</div>
      <div class="setrow"><span>Text speed</span>${seg('textSpeed', [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']])}</div>
      <div class="setrow"><span>Graphics</span>${seg('quality', [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])}</div>
      <div class="setrow"><span>Auto end turn</span>${seg('autoEnd', [[true, 'On'], [false, 'Off']])}</div>
      ${document.fullscreenEnabled ? `<div class="setrow"><span>Fullscreen</span><div class="seg"><button class="btn small" data-fs>${document.fullscreenElement ? 'Exit fullscreen' : 'Go fullscreen'}</button></div></div>` : ''}
      <div class="keys">${game.touch
        ? '<b>Tap</b> a unit, then a blue tile to move · <b>Tap</b> an enemy in red range to attack (tap again to confirm) · <b>Drag</b> to pan · <b>Pinch</b> to zoom · <b>Twist</b> two fingers to rotate · <b>✕</b> button cancels'
        : `<kbd>Click</kbd> select / move / act · <kbd>Right-click</kbd> / <kbd>Esc</kbd> cancel · <kbd>Drag</kbd> pan · <kbd>Right-drag</kbd> rotate · <kbd>Wheel</kbd> zoom<br>
      <kbd>WASD</kbd> pan · <kbd>Q</kbd>/<kbd>E</kbd> rotate 90° · <kbd>Arrows</kbd> move cursor · <kbd>Enter</kbd> confirm · <kbd>Tab</kbd> next unit · <kbd>R</kbd> danger zone`}</div>
      <div class="actions"><button class="btn primary" data-close>Done</button></div></div>`;
    ui.layer.appendChild(back);
    back.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      s[inp.dataset.name] = +inp.value;
      if (inp.dataset.name === 'music') audio.setMusicVolume(s.music); else { audio.setSfxVolume(s.sfx); audio.sfx('cursor'); }
    }));
    back.querySelectorAll('.seg').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      let v = b.dataset.v;
      if (v === 'true') v = true; else if (v === 'false') v = false;
      s[g.dataset.name] = v;
      g.querySelectorAll('button').forEach((x) => x.classList.toggle('toggled', x === b));
      if (g.dataset.name === 'quality') { engine.setQuality(v); s.qualityManual = true; }
      audio.sfx('select');
    }));
    back.querySelector('[data-fs]')?.addEventListener('click', async (e) => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch { /* not allowed */ }
      e.target.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Go fullscreen';
    });
    back.querySelector('[data-close]').addEventListener('click', () => { Settings.save(s); back.remove(); audio.sfx('confirm'); resolve(); });
  });
}

// ------------------------------------------------------------------ defeat
/**
 * Resolves to 'retry' (chapter start), 'title', or { action: 'load', save } (restart the turn / a chosen save).
 * opts.turnSave: snapshot from the start of the last player turn, if any.
 */
export function showGameOver(game, { turnSave = null } = {}) {
  const { ui, audio } = game;
  if (turnSave && !validSave(turnSave)) turnSave = null;
  return new Promise((resolve) => {
    const el = h('div', 'screen end-screen defeat');
    el.innerHTML = `<h1>DEFEAT</h1><p>The ember flickers... but it has not gone out.</p>
      <div class="row">${turnSave ? `<button class="btn primary" data-v="turn">Retry from Turn ${turnSave.summary.turn}</button>` : ''}
      <button class="btn${turnSave ? '' : ' primary'}" data-v="retry">Retry Chapter</button>
      <button class="btn" data-v="load">Load Game</button><button class="btn" data-v="title">Return to Title</button></div>`;
    ui.layer.appendChild(el);
    let busy = false;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || busy) return;
      audio.sfx('confirm');
      const v = b.dataset.v;
      if (v === 'load') {
        busy = true;
        const save = await openSlotPicker(game, { mode: 'load' });
        busy = false;
        if (!save) return;
        el.remove(); resolve({ action: 'load', save }); return;
      }
      el.remove();
      resolve(v === 'turn' ? { action: 'load', save: turnSave } : v);
    });
  });
}

// ------------------------------------------------------------------ credits
export async function showCredits(game, fromTitle = false) {
  const { ui, audio } = game;
  audio.playMusic('ending', { fade: 1.5 });
  const el = h('div', 'screen credits interactive');
  const s = game.state?.stats;
  el.innerHTML = `<div class="roll"><h1>Emberwing Knights</h1><p>The Lost City of Aurelion</p>
    ${s && !fromTitle ? `<h3>YOUR CAMPAIGN</h3><p>Enemies defeated: ${s.kills}</p><p>Turns taken: ${s.turns}</p>` : ''}
    <h3>DESIGN &amp; DEVELOPMENT</h3><p>Peter Xing</p><p>with GitHub Copilot</p>
    <h3>THE COMPANY</h3><p>Kael Ardent · Lyra Sol · Garrick Stone</p><p>Fenn Wilder · Vex · Mira Vale · Sora Tempest</p>
    <h3>TECHNOLOGY</h3><p>three.js · Web Audio API · Vite</p><p>Procedural cel-shaded models, portraits, music and effects</p>
    <h3>INSPIRATION</h3><p>A loving tribute to the Taiwanese and Japanese strategy RPGs of the 1990s,</p><p>especially Flame Dragon Knights II (Dynasty International, 1995).</p>
    <p>All characters, story, art and music in this game are original.</p>
    <h3>THANK YOU FOR PLAYING</h3><p>The Emberwing Knights ride again.</p></div>`;
  ui.layer.appendChild(el);
  await new Promise((r) => {
    const t = setTimeout(r, 46000);
    el.addEventListener('click', () => { clearTimeout(t); r(); });
  });
  el.remove();
}

// ------------------------------------------------------------------ loading
export function showLoading() {
  const el = h('div', 'loading');
  el.innerHTML = `<div class="ld-title">EMBERWING KNIGHTS</div><div class="ld-bar"><i></i></div><div class="ld-tip">${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}</div>`;
  document.getElementById('ui').appendChild(el);
  return {
    progress(p) { el.querySelector('i').style.width = `${Math.round(p * 100)}%`; },
    async done() { el.style.opacity = '0'; await wait(0.01); setTimeout(() => el.remove(), 650); },
  };
}

export function randomTip() { return TIPS[Math.floor(Math.random() * TIPS.length)]; }
