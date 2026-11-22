// Visual-novel style dialogue box with portraits, typewriter text and skip support.
import { h, esc, portraitPromoted } from './ui.js';
import { CAST } from '../game/data/cast.js';

const SPEEDS = { slow: 28, normal: 48, fast: 110, instant: 100000 };
const PLAYER_IDS = new Set(['kael', 'lyra', 'garrick', 'fenn', 'vex', 'mira', 'sora', 'elder']);

export class Dialogue {
  constructor(ui, audio, getSettings) {
    this.ui = ui;
    this.audio = audio;
    this.getSettings = getSettings;
    this.el = null;
    this.skipping = false;
    this.promoted = new Set();
  }

  _ensure() {
    if (this.el) return this.el;
    const e = h('div', 'dialogue interactive');
    e.innerHTML = `<div class="box"><div class="speaker"></div><div class="text"></div><div class="next">▼</div></div>
      <div class="portrait"></div><button class="btn small skip">Skip ▸▸</button>`;
    this.ui.layer.appendChild(e);
    this.el = e;
    e.querySelector('.skip').addEventListener('click', (ev) => { ev.stopPropagation(); this.skipping = true; this._advance?.(); });
    e.addEventListener('click', () => this._advance?.());
    this._key = (ev) => {
      if (!this.el || this.el.classList.contains('hidden')) return;
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); this._advance?.(); }
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.skipping = true; this._advance?.(); }
    };
    window.addEventListener('keydown', this._key, true);
    return e;
  }

  /** line: { say, e, t } | { n } ; side defaults: heroes left, others right */
  async show(line) {
    if (this.skipping) return;
    const e = this._ensure();
    e.classList.remove('hidden');
    const narrate = !!line.n;
    const id = line.say;
    const cast = id ? CAST[id] : null;
    const side = line.side || (id && !PLAYER_IDS.has(id) ? 'right' : 'left');
    e.className = `dialogue interactive ${narrate ? 'narrate' : side}${cast && cast.side === 'enemy' && id !== 'vex' ? ' enemyside' : ''}`;
    const sp = e.querySelector('.speaker');
    const port = e.querySelector('.portrait');
    const text = e.querySelector('.text');
    if (!narrate) {
      sp.textContent = line.name || cast?.name || id;
      const url = portraitPromoted(id, line.e || 'neutral', this.promoted.has(id), side === 'right');
      if (port.dataset.key !== `${id}|${line.e}|${side}`) {
        port.innerHTML = url ? `<img src="${url}" alt="">` : '';
        port.dataset.key = `${id}|${line.e}|${side}`;
      }
    } else {
      port.innerHTML = ''; port.dataset.key = '';
    }
    const full = narrate ? line.n : line.t;
    const cps = SPEEDS[this.getSettings().textSpeed] || SPEEDS.normal;
    e.querySelector('.next').style.visibility = 'hidden';
    await new Promise((resolve) => {
      let shown = 0;
      let typing = true;
      let lastBlip = 0;
      const start = performance.now();
      const tick = (now) => {
        if (!typing) return;
        const n = Math.min(full.length, Math.floor(((now - start) / 1000) * cps));
        if (n !== shown) {
          shown = n;
          text.innerHTML = esc(full.slice(0, n));
          if (n - lastBlip >= 3 && !narrate) { lastBlip = n; this.audio?.sfx('text', { volume: 0.35 }); }
        }
        if (n >= full.length) { typing = false; e.querySelector('.next').style.visibility = 'visible'; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      this._advance = () => {
        if (this.skipping) { typing = false; this._advance = null; resolve(); return; }
        if (typing) { typing = false; text.innerHTML = esc(full); e.querySelector('.next').style.visibility = 'visible'; return; }
        this._advance = null;
        this.audio?.sfx('select', { volume: 0.5 });
        resolve();
      };
    });
  }

  hide() { this.el?.classList.add('hidden'); }

  begin() { this.skipping = !!this.alwaysSkip; }
  end() { this.hide(); this.skipping = false; }

  dispose() {
    if (this._key) window.removeEventListener('keydown', this._key, true);
    this.el?.remove();
    this.el = null;
  }
}
