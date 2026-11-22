// Campaign state (party, inventory, gold, progress) with localStorage save slots, plus user settings.
import { heroRecord } from './unit.js';
import { STARTING_PARTY, STARTING_GOLD, STARTING_ITEMS } from './data/chapters/index.js';
import { HERO_ORDER } from './data/heroes.js';

const SAVE_KEY = 'emberwing.save.v1';
const SETTINGS_KEY = 'emberwing.settings.v1';

export class GameState {
  constructor(data) {
    Object.assign(this, data);
  }

  static fresh() {
    const party = {};
    for (const id of STARTING_PARTY) party[id] = heroRecord(id);
    return new GameState({
      version: 1, chapter: 0, party, items: { ...STARTING_ITEMS }, weapons: [], gold: STARTING_GOLD,
      flags: {}, stats: { kills: 0, turns: 0, battles: 0 }, savedAt: null,
    });
  }

  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  static load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && d.version === 1 ? new GameState(d) : null;
    } catch { return null; }
  }

  static saveInfo() {
    const s = GameState.load();
    return s ? { chapter: s.chapter, savedAt: s.savedAt, gold: s.gold, party: Object.keys(s.party).length } : null;
  }

  toJSON() {
    return {
      version: this.version, chapter: this.chapter, party: this.party, items: this.items, weapons: this.weapons,
      gold: this.gold, flags: this.flags, stats: this.stats, savedAt: this.savedAt,
    };
  }

  save() {
    this.savedAt = Date.now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.toJSON())); return true; } catch { return false; }
  }

  snapshot() { return JSON.stringify(this.toJSON()); }
  restore(json) { Object.assign(this, JSON.parse(json)); }

  /** Heroes in canonical order. */
  get roster() { return HERO_ORDER.filter((id) => this.party[id]); }

  addHero(id, rec = null) { if (!this.party[id]) this.party[id] = rec || heroRecord(id); }

  addItem(id, qty = 1) { this.items[id] = (this.items[id] || 0) + qty; }
  useItem(id) {
    if (!this.items[id]) return false;
    this.items[id] -= 1;
    if (this.items[id] <= 0) delete this.items[id];
    return true;
  }
  itemList() { return Object.entries(this.items).filter(([, n]) => n > 0); }

  addWeapon(id) { this.weapons.push(id); }
  removeWeapon(id) { const i = this.weapons.indexOf(id); if (i >= 0) this.weapons.splice(i, 1); return i >= 0; }

  /** Equip a spare weapon on a hero, returning the old one to storage. */
  equip(heroId, weaponId) {
    const rec = this.party[heroId];
    if (!rec || !this.removeWeapon(weaponId)) return false;
    if (rec.weapon) this.weapons.push(rec.weapon);
    rec.weapon = weaponId;
    return true;
  }
}

export const DEFAULT_SETTINGS = {
  music: 0.6, sfx: 0.8, muted: false, anim: 'full', textSpeed: 'normal', quality: 'high', autoEnd: true, showDanger: false,
};

export const Settings = {
  load() {
    try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
  },
  save(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } },
};
