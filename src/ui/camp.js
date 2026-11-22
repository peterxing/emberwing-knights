// Camp between chapters: party overview & equipment, shop, saving — over a live 3D campfire stage.
import * as THREE from 'three';
import { h, esc, portraitPromoted } from './ui.js';
import { Arena } from '../gfx/arena.js';
import { VFX } from '../gfx/vfx.js';
import { createCharacter } from '../gfx/characters.js';
import { CHAPTERS } from '../game/data/chapters/index.js';
import { CLASSES, STAT_LABEL } from '../game/data/classes.js';
import { WEAPONS, ITEMS, shopStock, itemInfo } from '../game/data/items.js';
import { unitFromRecord } from '../game/unit.js';

class CampStage {
  constructor(game) {
    const { engine, state } = game;
    this.game = game;
    this.arena = new Arena(engine.renderer, { terrain: '.', preset: 'sunset' });
    this.scene = this.arena.scene;
    this.vfx = new VFX(this.scene);
    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 400);
    this.chars = [];
    const ids = state.roster;
    const front = ids.slice(0, 4), back = ids.slice(4);
    const place = (list, z, spacing, xo) => list.forEach((id, i) => {
      const u = unitFromRecord(state.party[id], 0, 0);
      const c = createCharacter(u.look, { team: 'player' });
      c.root.position.set((i - (list.length - 1) / 2) * spacing + xo, 0, z);
      c.setFacing(0.35, true);
      if (u.flying) c.setState('fly');
      this.scene.add(c.root);
      this.chars.push(c);
    });
    place(front, 0.55, 0.85, 0);
    place(back, -0.55, 0.95, 0.3);
    this.t = 0;
    engine.setView(this.scene, this.camera);
    const grade = this.arena.grade || this.arena.env?.preset || this.arena.environment?.preset;
    if (grade) engine.setGrade(grade);
    engine.setTiltShift({ enabled: false });
    this.unsub = engine.onUpdate((dt, el) => this.update(dt, el));
  }

  update(dt, el) {
    this.t += dt;
    const a = 0.3 + Math.sin(this.t * 0.07) * 0.16;
    this.camera.position.set(Math.sin(a) * 8.6, 1.55 + Math.sin(this.t * 0.13) * 0.12, Math.cos(a) * 8.6);
    this.camera.lookAt(0, 0.62, 0);
    const W = window.innerWidth, H = window.innerHeight;
    if (W > 900) this.camera.setViewOffset(W, H, -W * 0.27, 0, W, H); else this.camera.clearViewOffset();
    this.arena.update(dt, el, this.camera);
    this.vfx.update(dt, this.camera);
    for (const c of this.chars) c.update(dt);
    if (Math.random() < dt * 0.3) this.chars[Math.floor(Math.random() * this.chars.length)]?.play(Math.random() < 0.6 ? 'talk' : 'victory');
  }

  dispose() {
    this.unsub();
    for (const c of this.chars) c.dispose();
    this.vfx.dispose();
    this.arena.dispose();
  }
}

function statsHtml(u) {
  return `<div class="stats">${['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd', 'skl'].filter((k) => k !== 'mp' || u.maxMp > 0)
    .map((k) => `<div><span>${STAT_LABEL[k]}</span><b>${k === 'hp' ? u.maxHp : k === 'mp' ? u.maxMp : k === 'mag' ? u.magPower : u.stats[k]}</b></div>`).join('')}
    <div><span>MOV</span><b>${u.mov}</b></div></div>`;
}

/** Runs the camp until the player marches on. */
export async function showCamp(game) {
  const { ui, audio, engine, state } = game;
  const stage = new CampStage(game);
  audio.playMusic('camp', { fade: 1.2 });
  state.save();
  stage.update(0, 0);
  try { await engine.renderer.compileAsync(stage.scene, stage.camera); } catch (e) { /* compile lazily */ }
  await engine.fade(0, 0.8);
  const next = CHAPTERS[state.chapter];
  const el = h('div', 'screen camp');
  el.innerHTML = `<div class="side panel ornate"><h2>Camp</h2>
      <div class="next">Next battle<b>${esc(next.num)} — ${esc(next.title)}</b></div>
      <div class="gold-chip panel" style="align-self:flex-start"></div>
      <div class="tabs">
        <button class="btn" data-tab="party">Party &amp; Equipment</button>
        <button class="btn" data-tab="shop">Shop</button>
        <button class="btn" data-tab="items">Inventory</button>
        <button class="btn" data-tab="save">Save Game</button>
      </div>
      <div style="flex:1"></div>
      <button class="btn primary" data-go>March On ▸</button></div>
    <div class="main panel ornate"></div>`;
  ui.layer.appendChild(el);
  const main = el.querySelector('.main');
  const goldChip = el.querySelector('.gold-chip');
  const refreshGold = () => { goldChip.textContent = `${state.gold} G`; };
  refreshGold();

  const tabs = {
    party() {
      main.innerHTML = '<h3>The Company</h3><div class="hero-grid"></div>';
      const grid = main.querySelector('.hero-grid');
      for (const id of state.roster) {
        const rec = state.party[id];
        const u = unitFromRecord(rec, 0, 0);
        const wtype = CLASSES[u.cls].weapon;
        const spare = [...new Set(state.weapons.filter((w) => WEAPONS[w]?.type === wtype))];
        const card = h('div', 'hero-card');
        card.innerHTML = `<div class="pimg"><img src="${portraitPromoted(id, 'smile', u.promoted)}"></div>
          <div><div class="hn">${esc(u.name)}</div><div class="hc">${esc(u.className)} · Lv ${u.level} · EXP ${u.exp}</div>
          <div class="hc">⚔ ${esc(WEAPONS[u.weapon]?.name || '—')}</div></div>${statsHtml(u)}
          <div class="eq"><span>Equip</span><select ${spare.length ? '' : 'disabled'}><option value="">${spare.length ? 'Choose a weapon…' : 'No spare weapons'}</option>
          ${spare.map((w) => `<option value="${w}">${esc(WEAPONS[w].name)} (Mt ${WEAPONS[w].mt || 0}${WEAPONS[w].mag ? `, Mag+${WEAPONS[w].mag}` : ''})</option>`).join('')}</select></div>`;
        card.querySelector('select').addEventListener('change', (e) => {
          if (!e.target.value) return;
          state.equip(id, e.target.value);
          audio.sfx('item');
          tabs.party();
        });
        grid.appendChild(card);
      }
    },
    shop() {
      const stock = shopStock(state.chapter);
      main.innerHTML = '<h3>Merchant</h3><div class="shop-list"></div><h3 style="margin-top:16px">Sell</h3><div class="shop-list sell"></div>';
      const list = main.querySelector('.shop-list');
      for (const id of [...stock.items, ...stock.weapons]) {
        const it = itemInfo(id);
        const own = WEAPONS[id] ? state.weapons.filter((w) => w === id).length : (state.items[id] || 0);
        const row = h('div', 'shop-row');
        row.innerHTML = `<div><b>${esc(it.name)}</b><div class="desc">${esc(it.desc || (WEAPONS[id] ? `${it.type} · Mt ${it.mt}${it.mag ? ` · Mag+${it.mag}` : ''} · Hit ${it.hit} · Rng ${it.range.join('-')}` : ''))}</div></div>
          <div class="own">Owned ${own}</div><div class="price">${it.price} G</div><button class="btn small" ${state.gold < it.price ? 'disabled' : ''}>Buy</button>`;
        row.querySelector('button').addEventListener('click', () => {
          if (state.gold < it.price) return;
          state.gold -= it.price;
          if (WEAPONS[id]) state.addWeapon(id); else state.addItem(id);
          audio.sfx('gold');
          refreshGold();
          tabs.shop();
        });
        list.appendChild(row);
      }
      const sell = main.querySelector('.sell');
      const sellables = [...new Set(state.weapons)].map((w) => ['w', w]).concat(Object.keys(state.items).filter((i) => ITEMS[i]?.price).map((i) => ['i', i]));
      if (!sellables.length) sell.innerHTML = '<div class="desc" style="color:var(--muted)">Nothing to sell.</div>';
      for (const [kind, id] of sellables) {
        const it = itemInfo(id);
        const price = Math.floor((it.price || 300) / 2);
        const row = h('div', 'shop-row');
        row.innerHTML = `<div><b>${esc(it.name)}</b></div><div class="own">×${kind === 'w' ? state.weapons.filter((w) => w === id).length : state.items[id]}</div><div class="price">${price} G</div><button class="btn small">Sell</button>`;
        row.querySelector('button').addEventListener('click', () => {
          if (kind === 'w') state.removeWeapon(id); else state.useItem(id);
          state.gold += price;
          audio.sfx('gold');
          refreshGold();
          tabs.shop();
        });
        sell.appendChild(row);
      }
    },
    items() {
      main.innerHTML = '<h3>Supplies</h3><div class="shop-list"></div><h3 style="margin-top:16px">Armoury</h3><div class="shop-list arm"></div>';
      const list = main.querySelector('.shop-list');
      const inv = state.itemList();
      if (!inv.length) list.innerHTML = '<div style="color:var(--muted)">No items.</div>';
      for (const [id, n] of inv) {
        const it = ITEMS[id];
        const row = h('div', 'shop-row');
        row.innerHTML = `<div><b>${it.icon || ''} ${esc(it.name)}</b><div class="desc">${esc(it.desc)}</div></div><div class="own">×${n}</div><div></div><div></div>`;
        list.appendChild(row);
      }
      const arm = main.querySelector('.arm');
      const ws = [...new Set(state.weapons)];
      if (!ws.length) arm.innerHTML = '<div style="color:var(--muted)">No spare weapons.</div>';
      for (const w of ws) {
        const it = WEAPONS[w];
        const row = h('div', 'shop-row');
        row.innerHTML = `<div><b>${esc(it.name)}</b><div class="desc">${esc(it.desc || `${it.type} · Mt ${it.mt}`)}</div></div><div class="own">×${state.weapons.filter((x) => x === w).length}</div><div></div><div></div>`;
        arm.appendChild(row);
      }
      main.insertAdjacentHTML('beforeend', '<p style="color:var(--muted);font-size:13px;margin-top:14px">Stat seeds and potions are used from the Item command during battle.</p>');
    },
    save() {
      const ok = state.save();
      audio.sfx(ok ? 'confirm' : 'error');
      main.innerHTML = `<h3>Save</h3><p>${ok ? 'Progress saved. Choose <b>Continue</b> on the title screen to resume from this camp.' : 'Saving failed (storage unavailable).'}</p>`;
    },
  };

  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { audio.sfx('select'); tabs[b.dataset.tab](); }));
  tabs.party();
  await new Promise((r) => el.querySelector('[data-go]').addEventListener('click', r, { once: true }));
  audio.sfx('confirm');
  state.save();
  await engine.fade(1, 0.7);
  el.remove();
  stage.dispose();
}
