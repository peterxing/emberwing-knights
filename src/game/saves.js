// Save slots: an autosave plus three manual slots in localStorage, with export/import as JSON files.
// A save holds the campaign state and, when made mid-battle, a full battle snapshot to resume from.
import { CHAPTERS } from './data/chapters/index.js';

export const SAVE_VERSION = 2;
export const SLOTS = ['auto', 1, 2, 3];
const KEY = (slot) => `emberwing.slot.${slot}`;
const LEGACY_KEY = 'emberwing.save.v1';

function storage() {
  try { const s = window.localStorage; s.setItem('emberwing.probe', '1'); s.removeItem('emberwing.probe'); return s; } catch { return null; }
}

/** True when the browser lets us persist saves. */
export function canSave() { return !!storage(); }

export function readSlot(slot) {
  const s = storage();
  if (!s) return null;
  try {
    const d = JSON.parse(s.getItem(KEY(slot)));
    return validSave(d) ? d : null;
  } catch { return null; }
}

export function writeSlot(slot, save) {
  const s = storage();
  if (!s) return false;
  try { s.setItem(KEY(slot), JSON.stringify({ ...save, slot })); return true; } catch { return false; }
}

export function deleteSlot(slot) { storage()?.removeItem(KEY(slot)); }

export function listSlots() { return SLOTS.map((slot) => ({ slot, save: readSlot(slot) })); }

/** Most recent save across all slots (what "Continue" loads). `accept` can filter saves out. */
export function latestSave(accept = () => true) {
  let best = null;
  for (const { slot, save } of listSlots()) if (save && accept(save) && (!best || save.savedAt > best.save.savedAt)) best = { slot, save };
  return best;
}

/**
 * Build a save object.
 * battle: Battle#serialize() output, or null for a between-chapters (camp) save.
 */
export function makeSave(game, battle = null) {
  const st = game.state;
  const ci = battle ? battle.chapterIndex : st.chapter;
  const ch = CHAPTERS[Math.min(ci, CHAPTERS.length - 1)];
  const lead = battle ? battle.units.find((u) => u.id === 'kael') : st.party.kael;
  const heroes = battle ? battle.units.filter((u) => u.isHero && u.side === 'player').length : Object.keys(st.party).length;
  // deep copy: callers may keep the save in memory while the live state keeps changing
  return JSON.parse(JSON.stringify({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    location: battle ? 'battle' : (ci >= CHAPTERS.length ? 'complete' : 'camp'),
    campaign: st.toJSON(),
    battle,
    summary: {
      chapterNum: ch.num, chapterTitle: ch.title, turn: battle ? battle.turn : 0,
      leadLevel: lead ? lead.level : 1, heroes, gold: st.gold, playTime: Math.round(st.stats.playTime || 0),
    },
  }));
}

export function formatPlayTime(sec = 0) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function describe(save) {
  if (!save) return { title: 'Empty', detail: '', when: '' };
  const s = save.summary || {};
  const where = save.location === 'battle' ? `Turn ${s.turn}` : save.location === 'complete' ? 'Campaign complete' : 'At camp';
  const when = new Date(save.savedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return {
    title: `${s.chapterNum} — ${s.chapterTitle}`,
    detail: `${where} · Kael Lv ${s.leadLevel} · ${s.heroes} heroes · ${s.gold} G · ${formatPlayTime(s.playTime)} played`,
    when,
  };
}

/** One-time migration of the old single camp save into the autosave slot. */
export function migrateLegacy() {
  const s = storage();
  if (!s) return;
  try {
    const raw = s.getItem(LEGACY_KEY);
    if (!raw) return;
    const old = JSON.parse(raw);
    if (old && old.version === 1 && !readSlot('auto')) {
      const ch = CHAPTERS[Math.min(old.chapter, CHAPTERS.length - 1)];
      writeSlot('auto', {
        version: SAVE_VERSION, savedAt: old.savedAt || Date.now(), location: 'camp', battle: null,
        campaign: { ...old, stats: { playTime: 0, ...(old.stats || {}) } },
        summary: { chapterNum: ch.num, chapterTitle: ch.title, turn: 0, leadLevel: old.party?.kael?.level || 1, heroes: Object.keys(old.party || {}).length, gold: old.gold, playTime: 0 },
      });
    }
    s.removeItem(LEGACY_KEY);
  } catch { /* ignore corrupt legacy data */ }
}

/** Download a save as a .json file (works on desktop, Android and iOS Files). */
export function exportSave(save) {
  const s = save.summary || {};
  const name = `emberwing-${String(s.chapterNum || 'save').toLowerCase().replace(/[^a-z0-9]+/g, '-')}${save.location === 'battle' ? `-turn${s.turn}` : ''}.json`;
  const blob = new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  return name;
}

/**
 * Ask for a save file and parse it. Resolves to a save object, false (not a valid save) or null (cancelled).
 * Callers must not block on this: very old browsers never report a cancelled picker.
 */
export function importSaveFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; input.remove(); resolve(v); };
    input.addEventListener('cancel', () => done(null));
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return done(null);
      if (f.size > 2e6) return done(false);
      try {
        const d = JSON.parse(await f.text());
        done(validSave(d) ? d : false);
      } catch { done(false); }
    });
    input.click();
  });
}

/** Structural check for saves (imported files are untrusted: names end up in the UI). */
export function validSave(d) {
  if (!d || d.version !== SAVE_VERSION || !d.campaign || typeof d.campaign !== 'object') return false;
  if (!d.summary || typeof d.summary !== 'object' || !Number.isFinite(d.savedAt)) return false;
  if (/[<>]/.test(JSON.stringify(d))) return false;
  const c = d.campaign;
  if (!c.party || typeof c.party !== 'object' || !c.party.kael || !Number.isInteger(c.chapter)) return false;
  if (c.chapter < 0 || c.chapter > CHAPTERS.length) return false;
  if (d.battle) {
    const b = d.battle;
    if (!Number.isInteger(b.chapterIndex) || b.chapterIndex < 0 || b.chapterIndex >= CHAPTERS.length) return false;
    if (!Array.isArray(b.units) || !b.units.length) return false;
  }
  return true;
}
