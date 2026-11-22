// DOM-based HUD: chapter/turn info, unit & terrain cards, action menus, forecast, banners, toasts,
// cutscene HUD (letterbox + HP panels), EXP and level-up panels.
import { portraitURL } from '../gfx/portraits.js';
import { STAT_KEYS, STAT_LABEL } from '../game/data/classes.js';
import { WEAPONS } from '../game/data/items.js';
import { SPELLS } from '../game/data/spells.js';
import { CLASSES } from '../game/data/classes.js';

export function h(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const portraitCache = new Map();
export function portrait(id, expression = 'neutral', flip = false) {
  const k = `${id}|${expression}|${flip}`;
  if (!portraitCache.has(k)) {
    let url = '';
    try { url = portraitURL(id, { expression, flip }); } catch (e) { url = ''; }
    portraitCache.set(k, url);
  }
  return portraitCache.get(k);
}
export function portraitPromoted(id, expression = 'neutral', promoted = false, flip = false) {
  const k = `${id}|${expression}|${flip}|p${promoted}`;
  if (!portraitCache.has(k)) {
    let url = '';
    try { url = portraitURL(id, { expression, flip, promoted }); } catch (e) { url = ''; }
    portraitCache.set(k, url);
  }
  return portraitCache.get(k);
}

function hpClass(r) { return r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low'; }

export class UI {
  constructor(root, audio) {
    this.root = root;
    this.audio = audio;
    this.layer = h('div', 'layer');
    root.appendChild(this.layer);
    this.hud = h('div', 'hud hidden');
    this.layer.appendChild(this.hud);
    this._buildHud();
    this.toasts = h('div', 'toast-stack');
    this.layer.appendChild(this.toasts);
    this.cineRoot = h('div', 'cine-root');
    this.cineRoot.append(h('div', 'letterbox top'), h('div', 'letterbox bottom'));
    this.layer.appendChild(this.cineRoot);
    this.menuEl = null;
    this.forecastEl = null;
    this.hintEl = null;
  }

  sfx(name, o) { this.audio?.sfx(name, o); }

  // ------------------------------------------------------------ HUD
  _buildHud() {
    this.tl = h('div', 'hud-top-left panel ornate');
    this.tl.innerHTML = `<div class="chap"></div><div class="title"></div>
      <div class="row"><span class="turn"></span><span class="phase-pill player">Player</span></div>
      <div class="objective"></div>`;
    this.tr = h('div', 'hud-top-right');
    this.goldChip = h('div', 'gold-chip panel');
    this.btnDanger = h('button', 'btn small', 'Danger');
    this.btnDanger.title = 'Show every tile enemies can strike next turn (D)';
    this.btnEnd = h('button', 'btn small primary', 'End Turn');
    this.btnEnd.title = 'End the player phase (Enter)';
    this.btnSettings = h('button', 'btn small', '⚙');
    this.btnSettings.title = 'Settings';
    this.tr.append(this.goldChip, this.btnDanger, this.btnEnd, this.btnSettings);
    this.unitCard = h('div', 'unit-card panel ornate off');
    this.terrainCard = h('div', 'terrain-card panel hidden');
    this.hud.append(this.tl, this.tr, this.unitCard, this.terrainCard);
  }

  showHud(on) { this.hud.classList.toggle('hidden', !on); }
  setChapter(num, title) { this.tl.querySelector('.chap').textContent = num; this.tl.querySelector('.title').textContent = title; }
  setTurn(turn, phase) {
    this.tl.querySelector('.turn').textContent = `Turn ${turn}`;
    const p = this.tl.querySelector('.phase-pill');
    p.className = `phase-pill ${phase}`;
    p.textContent = phase === 'player' ? 'Player Phase' : 'Enemy Phase';
    this.btnEnd.disabled = phase !== 'player';
  }
  setObjective(t) { this.tl.querySelector('.objective').textContent = t; }
  setGold(g) { this.goldChip.textContent = `${g} G`; }

  showUnit(u, extra = {}) {
    if (!u) { this.unitCard.classList.add('off'); return; }
    const w = WEAPONS[u.weapon];
    const r = u.hp / u.maxHp;
    const tags = (u.boss ? '<span class="tag boss">BOSS</span>' : '') + (u.acted && u.side === 'player' ? '<span class="tag done">DONE</span>' : '');
    const spells = u.spells.filter((s) => SPELLS[s]).map((s) => SPELLS[s].name);
    const range = u.atkRange ? (u.atkRange[0] === u.atkRange[1] ? `${u.atkRange[0]}` : `${u.atkRange[0]}-${u.atkRange[1]}`) : '—';
    this.unitCard.className = `unit-card panel ornate ${u.side}`;
    this.unitCard.innerHTML = `
      <div class="portrait"><img src="${portraitPromoted(u.lookId, extra.expr || 'neutral', u.promoted)}" alt=""></div>
      <div>
        <div class="name">${esc(u.name)}${tags}</div>
        <div class="cls"><span>${esc(u.className)}</span><span>Lv <b>${u.level}</b></span></div>
        <div class="barrow"><span>HP</span><div class="bar hp ${hpClass(r)}"><i style="width:${r * 100}%"></i></div><span>${u.hp}/${u.maxHp}</span></div>
        ${u.maxMp > 0 ? `<div class="barrow"><span>MP</span><div class="bar mp"><i style="width:${(u.mp / u.maxMp) * 100}%"></i></div><span>${u.mp}/${u.maxMp}</span></div>` : ''}
        ${u.isHero && u.side === 'player' ? `<div class="barrow"><span>EXP</span><div class="bar exp"><i style="width:${u.exp}%"></i></div><span>${u.exp}/100</span></div>` : ''}
      </div>
      <div class="stats" style="grid-column:1/-1">
        ${['str', 'mag', 'def', 'res', 'spd', 'skl'].map((k) => `<div><span>${STAT_LABEL[k]}</span><b>${k === 'mag' ? u.magPower : u.stats[k]}</b></div>`).join('')}
        <div><span>MOV</span><b>${u.mov}</b></div><div><span>RNG</span><b>${range}</b></div>
      </div>
      <div class="weapon-line"><span>⚔ <b>${w ? esc(w.name) : '—'}</b>${w && w.mt ? ` Mt ${w.mt}` : ''}${w && w.mag ? ` Mag+${w.mag}` : ''}</span>
        ${spells.length ? `<span>✦ ${esc(spells.slice(0, 3).join(', '))}${spells.length > 3 ? '…' : ''}</span>` : ''}</div>`;
  }

  showTerrain(t, flying = false) {
    if (!t) { this.terrainCard.classList.add('hidden'); return; }
    this.terrainCard.classList.remove('hidden');
    const cost = t.cost.foot;
    this.terrainCard.innerHTML = `<div class="tname">${esc(t.name)}</div>
      <div class="trow"><span>Defence</span><b>+${t.def || 0}</b></div>
      <div class="trow"><span>Avoid</span><b>+${t.avo || 0}%</b></div>
      <div class="trow"><span>Move cost</span><b>${isFinite(cost) ? cost : '—'}</b></div>
      ${t.heal ? `<div class="trow"><span>Recovery</span><b>${t.heal}%</b></div>` : ''}`;
  }

  // ------------------------------------------------------------ menus
  /** items: [{ id, label, icon, note, disabled, sep }] -> Promise<id|null> */
  menu(items, pos, title = '') {
    this.closeMenu();
    return new Promise((resolve) => {
      const m = h('div', 'action-menu panel ornate interactive');
      if (title) m.appendChild(h('div', 'title', esc(title)));
      const els = [];
      items.forEach((it) => {
        if (it.sep) { m.appendChild(h('div', 'menu-sep')); return; }
        const e = h('div', `menu-item${it.disabled ? ' disabled' : ''}`, `<span class="ico">${it.icon || '•'}</span><span>${esc(it.label)}</span>${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}`);
        e.addEventListener('pointerenter', () => { this.sfx('cursor', { volume: 0.5 }); it.onHover?.(); els.forEach((o) => o.classList.remove('focus')); e.classList.add('focus'); });
        e.addEventListener('pointerleave', () => it.onLeave?.());
        e.addEventListener('click', (ev) => { ev.stopPropagation(); this.sfx('confirm'); finish(it.id); });
        els.push(e);
        m.appendChild(e);
      });
      const finish = (v) => { if (this.menuEl === m) { m.remove(); this.menuEl = null; window.removeEventListener('keydown', onKey, true); } resolve(v); };
      let fi = -1;
      const enabled = () => els.filter((e) => !e.classList.contains('disabled'));
      const onKey = (ev) => {
        const list = enabled();
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault(); ev.stopPropagation();
          fi = (fi + (ev.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          els.forEach((o) => o.classList.remove('focus')); list[fi]?.classList.add('focus'); this.sfx('cursor', { volume: 0.5 });
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          const f = list[fi] || list[0];
          if (f) { ev.preventDefault(); ev.stopPropagation(); f.click(); }
        } else if (ev.key === 'Escape' || ev.key === 'Backspace') {
          ev.preventDefault(); ev.stopPropagation(); this.sfx('cancel'); finish(null);
        }
      };
      window.addEventListener('keydown', onKey, true);
      m._cancel = () => finish(null);
      this.layer.appendChild(m);
      const W = window.innerWidth, H = window.innerHeight;
      const rect = m.getBoundingClientRect();
      const x = Math.min(Math.max(10, pos.x + 40), W - rect.width - 10);
      const y = Math.min(Math.max(70, pos.y - rect.height / 2), H - rect.height - 10);
      m.style.left = `${x}px`; m.style.top = `${y}px`;
      this.menuEl = m;
    });
  }
  closeMenu() { if (this.menuEl) { const c = this.menuEl._cancel; this.menuEl = null; c?.(); } document.querySelectorAll('.action-menu').forEach((e) => e.remove()); }

  // ------------------------------------------------------------ forecast
  forecast(a, d, fc, opts = {}) {
    this.hideForecast();
    const f = h('div', 'forecast panel ornate');
    const side = (u, st, cls, right, label) => {
      const n = st ? `<div class="nums"><span>DMG</span><span>HIT</span><span>CRIT</span>
        <b>${st.dmg}${st.count > 1 ? '<i class="x2">×2</i>' : ''}</b><b>${st.hit}</b><b>${st.crit}</b></div>` : '<div class="nums"><b style="grid-column:1/-1;color:#888">— no counter —</b></div>';
      return `<div class="side ${cls}${right ? ' right' : ''}"><div class="pimg"><img src="${portraitPromoted(u.lookId, 'neutral', u.promoted)}"></div>
        <div><div class="fname">${esc(u.name)}</div><div class="fhp">HP <b>${u.hp}</b>/${u.maxHp}</div>${n}<div class="weap">${esc(label)}</div></div></div>`;
    };
    const al = opts.spell ? SPELLS[opts.spell].name : (WEAPONS[a.weapon]?.name || '');
    const dl = fc.def ? (opts.counterSpell ? SPELLS[opts.counterSpell]?.name : WEAPONS[d.weapon]?.name) || '' : '';
    f.innerHTML = side(a, fc.atk, a.side === 'player' ? 'player' : 'enemy', false, al) +
      `<div class="mid"><div>⚔</div><div>VS</div></div>` +
      side(d, fc.def, d.side === 'player' ? 'player' : 'enemy', true, dl) +
      (opts.warn ? `<div class="warn">${esc(opts.warn)}</div>` : '');
    this.layer.appendChild(f);
    this.forecastEl = f;
  }
  healForecast(c, t, amount, spellName) {
    this.hideForecast();
    const f = h('div', 'forecast panel ornate');
    f.style.gridTemplateColumns = '1fr 64px 1fr';
    f.innerHTML = `<div class="side player"><div class="pimg"><img src="${portraitPromoted(c.lookId, 'smile', c.promoted)}"></div><div><div class="fname">${esc(c.name)}</div><div class="weap">${esc(spellName)}</div></div></div>
      <div class="mid"><div>✚</div><div>HEAL</div></div>
      <div class="side player right"><div class="pimg"><img src="${portraitPromoted(t.lookId, 'neutral', t.promoted)}"></div><div><div class="fname">${esc(t.name)}</div>
      <div class="fhp">HP <b>${t.hp}</b> → <b style="color:#7dffb0">${Math.min(t.maxHp, t.hp + amount)}</b> / ${t.maxHp}</div></div></div>`;
    this.layer.appendChild(f);
    this.forecastEl = f;
  }
  hideForecast() { this.forecastEl?.remove(); this.forecastEl = null; }

  // ------------------------------------------------------------ banners, cards, toasts, hints
  banner(text, sub = '', kind = 'player') {
    const b = h('div', `banner ${kind}`, `<div class="ribbon"></div><div class="txt">${esc(text)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`);
    this.layer.appendChild(b);
    this.sfx('turn');
    return new Promise((r) => setTimeout(() => { b.remove(); r(); }, 1600));
  }

  chapterCard(num, title) {
    const c = h('div', 'chapter-card', `<div class="num">${esc(num)}</div><div class="ttl">${esc(title)}</div><div class="line"></div>`);
    this.layer.appendChild(c);
    return new Promise((r) => setTimeout(() => { c.remove(); r(); }, 3600));
  }

  toast(text, icon = '✦') {
    const t = h('div', 'toast panel ornate', `<span class="ico">${icon}</span><span>${esc(text)}</span>`);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2900);
  }

  hint(text) {
    this.hintEl?.remove();
    const e = h('div', 'hint panel ornate interactive', `<span class="close">✕</span>${esc(text)}`);
    e.querySelector('.close').addEventListener('click', () => e.remove());
    this.layer.appendChild(e);
    this.hintEl = e;
    setTimeout(() => { if (this.hintEl === e) { e.style.transition = 'opacity .6s'; e.style.opacity = '0'; setTimeout(() => e.remove(), 600); } }, 16000);
  }

  // ------------------------------------------------------------ cutscene HUD
  setCine(on) { this.root.classList.toggle('cine', on); if (!on) this.clearBattleHud(); }

  battleHud(left, right) {
    this.clearBattleHud();
    const wrap = h('div', 'battle-hud');
    const mk = (s) => {
      const u = s.unit;
      const e = h('div', `bh-side panel ornate ${u.side === 'player' ? 'player' : 'enemy'}`);
      e.innerHTML = `<div class="pimg"><img src="${portraitPromoted(u.lookId, s.expr || 'determined', u.promoted)}"></div>
        <div><div class="nm"><span>${esc(u.name)}</span><small>${esc(s.label || '')}</small></div>
        <div class="hpbig"><div class="bar hp"><i></i></div><div class="hpnum"></div></div>
        <div class="bstats">${s.stats ? `<span>DMG <b>${s.stats.dmg}</b></span><span>HIT <b>${s.stats.hit}</b></span><span>CRIT <b>${s.stats.crit}</b></span>` : '<span>—</span>'}</div></div>`;
      e._unit = u;
      return e;
    };
    this.bhLeft = mk(left); this.bhRight = mk(right);
    wrap.append(this.bhLeft, this.bhRight);
    this.cineRoot.appendChild(wrap);
    this.bh = wrap;
    this.setBattleHp('left', left.hp, left.unit.maxHp, true);
    this.setBattleHp('right', right.hp, right.unit.maxHp, true);
  }
  setBattleHp(side, hp, max, instant = false) {
    const e = side === 'left' ? this.bhLeft : this.bhRight;
    if (!e) return;
    const bar = e.querySelector('.bar');
    const i = bar.querySelector('i');
    const r = Math.max(0, hp / max);
    if (instant) { i.style.transition = 'none'; requestAnimationFrame(() => { i.style.transition = ''; }); }
    i.style.width = `${r * 100}%`;
    bar.className = `bar hp ${hpClass(r)}`;
    e.querySelector('.hpnum').textContent = Math.max(0, Math.round(hp));
  }
  clearBattleHud() { this.bh?.remove(); this.bh = null; this.bhLeft = this.bhRight = null; }

  wipe() {
    const w = h('div', 'wipe in');
    this.layer.appendChild(w);
    return new Promise((r) => setTimeout(() => { r(() => { w.className = 'wipe out'; setTimeout(() => w.remove(), 400); }); }, 330));
  }

  // ------------------------------------------------------------ EXP & level up
  async expPop(u, gained, pos) {
    if (!gained) return;
    const e = h('div', 'exp-pop panel ornate', `<div class="lbl"><span>EXP</span><span>+${gained}</span></div><div class="bar exp"><i></i></div>`);
    e.style.left = `${Math.min(window.innerWidth - 240, Math.max(10, pos.x - 110))}px`;
    e.style.top = `${Math.max(70, pos.y - 110)}px`;
    this.layer.appendChild(e);
    const i = e.querySelector('i');
    const start = (u.exp - gained) % 100;
    i.style.transition = 'none';
    i.style.width = `${Math.max(0, start)}%`;
    await new Promise((r) => setTimeout(r, 60));
    i.style.transition = 'width 0.8s ease-out';
    const end = Math.min(100, start + gained);
    i.style.width = `${end}%`;
    this.sfx('item', { volume: 0.5, pitch: 1.4 });
    await new Promise((r) => setTimeout(r, 1100));
    e.remove();
  }

  /** rec = { level, gains, newSpells, promoted } */
  levelUp(u, rec) {
    return new Promise((resolve) => {
      const before = {};
      for (const k of STAT_KEYS) before[k] = u.stats[k] - (rec.gains[k] || 0) - (rec.promoted ? (CLASSES[rec.promoted.to].promoBonus?.[k] || 0) : 0);
      const e = h('div', 'levelup panel ornate interactive');
      const promo = rec.promoted;
      const rows = STAT_KEYS.filter((k) => k !== 'mp' || u.stats.mp > 0).map((k, i) => {
        const inc = (rec.gains[k] || 0) + (promo ? (CLASSES[promo.to].promoBonus?.[k] || 0) : 0);
        return `<div><span>${STAT_LABEL[k]}</span><b>${u.stats[k]}${inc ? `<i class="up" style="animation-delay:${0.25 + i * 0.12}s">+${inc}</i>` : ''}</b></div>`;
      }).join('');
      e.innerHTML = `<div class="lv-port"><img src="${portraitPromoted(u.lookId, 'grin', u.promoted)}"></div>
        <div><div class="lv-title${promo ? ' promo' : ''}">${promo ? 'CLASS CHANGE!' : 'LEVEL UP!'}</div>
        <div class="lv-name">${esc(u.name)} · ${promo ? `${esc(CLASSES[promo.from].name)} → <b style="color:#ffd35a">${esc(CLASSES[promo.to].name)}</b>` : esc(u.className)} · Lv ${rec.level}</div>
        <div class="lv-stats">${rows}</div></div>
        ${rec.newSpells?.length ? `<div class="lv-new">New ability: ${rec.newSpells.map((s) => esc(SPELLS[s]?.name || s)).join(', ')}</div>` : ''}
        <div class="lv-cont">Click to continue</div>`;
      this.layer.appendChild(e);
      let done = false;
      const close = () => { if (done) return; done = true; e.remove(); window.removeEventListener('keydown', onKey, true); resolve(); };
      const onKey = (ev) => { if (['Enter', ' ', 'Escape'].includes(ev.key)) { ev.preventDefault(); ev.stopPropagation(); close(); } };
      setTimeout(() => { e.addEventListener('click', close); window.addEventListener('keydown', onKey, true); }, 500);
      setTimeout(close, 6000);
    });
  }
}
