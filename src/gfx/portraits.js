/**
 * Anime-style dialogue portraits generated as SVG from the shared cast data (game/data/cast.js).
 * Every portrait is a 512×512 head-and-shoulders bust drawn in a clean cel style: warm dark
 * contours, one hue-shifted shadow tone, highlight bands and expressive eyes. Output is fully
 * deterministic, so identical requests always produce identical markup.
 */
import { CAST, GENERIC, lookFor } from '../game/data/cast.js';
import {
  Doc, hex, mix, tone, spline, ell, fill, line, op, clipTo, moved, inked, ribbon, PROF, INK,
  frameOf, paletteOf, outfitPal, facePts, earsSVG, neckSVG, eyeSVG, browSVG, noseSVG, mouthSVG,
  angerMark, sweatDrop, tearDrop, scratchMarks, hairSVG, HAIR, OUTFIT, HEADGEAR, capeSVG, scarfSVG,
  facialSVG, wolfPeltSVG, CREATURES, placeholderSVG,
} from './portrait-parts.js';

/** Supported expression names; anything else renders as 'neutral'. */
export const EXPRESSIONS = ['neutral', 'smile', 'grin', 'angry', 'sad', 'surprised', 'determined', 'hurt', 'smirk', 'worried', 'shout'];

// brow: [innerDy, outerDy, arch, pull]; eye: lid/iris modifiers (see eyeSVG)
const EXPR = {
  neutral: { brow: [0, 0, 3, 0], mouth: 'neutral' },
  smile: { brow: [-3, 0, 5, 0], eye: { lower: 0.16 }, mouth: 'smile', blush: 0.35 },
  grin: { brow: [-4, -3, 5, 0], eye: { lower: 0.22 }, mouth: 'grin', blush: 0.25 },
  angry: { brow: [12, -6, -3, 4], eye: { tilt: 0.16, open: 0.92, iris: 0.86 }, mouth: 'clench', anger: true, furrow: true },
  sad: { brow: [-10, 6, 2, 1], eye: { droop: 0.14, lower: 0.06, iris: 0.96 }, mouth: 'frown', tear: true },
  surprised: { brow: [-15, -12, 8, -1], eye: { open: 1.2, iris: 0.68 }, mouth: 'o' },
  determined: { brow: [7, -2, 0, 2], eye: { open: 0.88, tilt: 0.07 }, mouth: 'firm' },
  hurt: { brow: [-9, 5, 1, 2], browFar: [9, 3, 0, 3], eye: { lower: 0.1, open: 0.86 }, eyeFar: { closed: 'squeeze' }, mouth: 'grit', sweat: true, scratch: true },
  smirk: { brow: [3, 0, 1, 0], browFar: [-8, -5, 7, 0], eye: { lower: 0.14, open: 0.92 }, eyeFar: { lower: 0.06, open: 0.98 }, mouth: 'smirk' },
  worried: { brow: [-11, 4, 2, 1], eye: { droop: 0.06, iris: 0.9 }, mouth: 'wobble', sweat: true, blush: 0.15 },
  shout: { brow: [14, -8, -3, 5], eye: { open: 1.08, tilt: 0.12, iris: 0.8 }, mouth: 'shout', furrow: true },
};

// Per-character art direction drawn from each cast entry's portrait hint.
const TWEAKS = {
  kael: { emberCrest: true, gem: 0xd8362a },
  lyra: { gem: 0x2f6fd6 },
  garrick: { scar: 'brow', greyTemples: true, beard: 'short' },
  fenn: { hoodDown: true, leaves: true },
  vex: { earring: true, streak: 0xa86bff },
  mira: { ribbons: 0xf2c14e },
  sora: { sideBraid: true, braidTie: 0xd9b55a, feathered: true, gem: 0x2d8fb3 },
  gorran: { beard: 'braided', braidTie: 0xb08a50 },
  rask: { lowTail: true, wolfPelt: true },
  varga: { scar: 'cheek', undercut: true, spikes: true },
  selene: { sheenC: 0x9f6cff },
  malzaar: { beard: 'long', sweptBack: true },
  elder: { beard: 'long' },
  warPriest: { braidTie: 0x8c1d26 },
  cultist: { maskColor: 0x1a0c10 },
  imperialArcher: { featherC: 0xe8e4da },
};

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function auraSVG(doc, c) {
  return fill(ell(256, 270, 262, 262), doc.rad([[0, hex(c), 0.5], [0.55, hex(c), 0.18], [1, hex(c), 0]]));
}

function faceSVG(doc, G, pal, look, E, hair, HG, fac, faceD) {
  const cast = [...hair.cast, ...(HG.cast || [])].map((d) => fill(d, pal.skinS)).join('');
  let shade = moved(cast, 6, 10);
  shade += fill(spline([[362, 196], [358, 246], [350, 276], [332, 306], [306, 334], [316, 312], [332, 282], [340, 250], [344, 218]], true), pal.skinS);
  const blush = (G.male ? 0.12 : 0.42) + (E.blush || 0);
  if (blush > 0.05) {
    const g = doc.rad([[0, pal.blush, Math.min(0.85, blush)], [1, pal.blush, 0]]);
    shade += fill(ell(206, 282, 25, 11), g) + fill(ell(320, 280, 18, 9), g);
  }
  let s = inked([{ d: faceD, fill: pal.skin, after: clipTo(doc, faceD, shade) }], pal.skinInk, 3.6);
  s += hair.under + fac.under;
  const shape = look.eyes?.shape || 'bright';
  if (fac.hideEye !== 'near') s += eyeSVG(doc, G, pal, 'near', shape, E.eye || {});
  if (fac.hideEye !== 'far') s += eyeSVG(doc, G, pal, 'far', shape, { ...(E.eye || {}), ...(E.eyeFar || {}) });
  if (!fac.hideNose) s += noseSVG(G, pal);
  s += fac.beard;
  if (!fac.hideMouth) s += mouthSVG(doc, G, pal, E.mouth);
  s += fac.over;
  let brows = browSVG(G, pal, 'near', E.brow) + browSVG(G, pal, 'far', E.browFar || E.brow);
  if (E.furrow) brows += fill(ribbon([[G.mx - 7, 192], [G.mx - 5, 200], [G.mx - 6, 208]], 1.8, PROF.both, 10), pal.skinLine, op(0.6)) + fill(ribbon([[G.mx + 3, 194], [G.mx + 4, 202]], 1.6, PROF.both, 8), pal.skinLine, op(0.5));
  return { face: s, brows };
}

function humanoid(doc, look, expr, tw) {
  const G = frameOf(look), pal = paletteOf(look), P = outfitPal(look), E = EXPR[expr];
  if (tw.sheenC) pal.hairL = hex(tw.sheenC);
  let hg = look.headgear;
  if (hg === 'hood' && tw.hoodDown) hg = 'hoodDown';
  const HG = hg && own(HEADGEAR, hg) ? HEADGEAR[hg](doc, G, P, look, tw, E) : {};
  const hide = HG.hide || {};
  const style = own(HAIR, look.hair?.style) ? HAIR[look.hair.style] : HAIR.short;
  const Hd = style(G, pal, { ...tw, headgear: hg });
  if (hide.top) Hd.front = (Hd.front || []).filter((x) => !x.top);
  if (hide.front) { Hd.front = []; Hd.under = ''; }
  if (hide.side) { Hd.side = []; Hd.extraFront = ''; }
  if (hide.back) Hd.back = [];
  const hair = hairSVG(doc, G, pal, Hd, HG.mid || '');
  const faceD = spline(facePts(G), true);
  const top = look.outfit?.top;
  const fit = (own(OUTFIT, top) ? OUTFIT[top] : OUTFIT.tunic)(doc, G, P, look, tw);
  const fac = facialSVG(doc, G, pal, look, tw, faceD);
  const scarf = P.scarf && top === 'lightArmor' ? scarfSVG(doc, G, P.scarf, 'wrap') : { back: '', front: '' };
  const pelt = tw.wolfPelt ? wolfPeltSVG(doc, G) : { back: '', front: '' };

  let s = look.aura ? auraSVG(doc, look.aura) : '';
  s += HG.back || '';
  s += hair.back + hair.extraBack;
  if (P.cape && top !== 'cultistRobe') s += capeSVG(doc, G, P.cape);
  s += scarf.back + pelt.back + (fit.back || '') + (HG.outfitBack || '');
  s += neckSVG(doc, G, pal, faceD).svg;
  s += fit.body + scarf.front + pelt.front;
  s += HG.outfitFront || '';
  if (!hide.face) {
    s += earsSVG(G, pal, tw.earring ? { earring: tone(look.outfit?.trim ?? 0xa86bff) } : {});
    const F = faceSVG(doc, G, pal, look, E, hair, HG, fac, faceD);
    s += F.face + hair.front + F.brows + (HG.over || '') + hair.extraFront;
  }
  s += (HG.top || '') + fac.top;
  if (E.anger) s += angerMark(156, 132);
  if (E.tear && !hide.face) s += tearDrop(G, pal);
  if (E.sweat) s += sweatDrop(366, 172);
  if (E.scratch && !hide.face) s += scratchMarks(194, 296);
  return s;
}

/**
 * Build the portrait SVG for a cast or generic id.
 * @param {string} id cast id (e.g. 'kael') or generic id (e.g. 'bandit'); unknown ids give a hooded placeholder
 * @param {{expression?: string, promoted?: boolean, flip?: boolean, idPrefix?: string}} [opts]
 *   expression: one of EXPRESSIONS (default 'neutral'); promoted: use the class-change look;
 *   flip: mirror horizontally for right-hand speakers; idPrefix: override the deterministic def-id prefix
 * @returns {string} complete <svg> markup, viewBox 0 0 512 512, transparent background
 */
export function portraitSVG(id, opts = { expression: 'neutral', promoted: false, flip: false }) {
  const o = opts || {};
  const expression = EXPRESSIONS.includes(o.expression) ? o.expression : 'neutral';
  const promoted = !!o.promoted, flip = !!o.flip;
  const known = hasPortrait(id);
  const uid = o.idPrefix || `ewp${hash(`${known ? id : '?'}|${expression}|${promoted ? 1 : 0}|${flip ? 1 : 0}`)}`;
  const doc = new Doc(uid);
  const look = known ? lookFor(id, promoted) : null;
  let body;
  if (!look) body = placeholderSVG(doc);
  else if (look.kind === 'humanoid') body = humanoid(doc, look, expression, own(TWEAKS, id) ? TWEAKS[id] : {});
  else if (own(CREATURES, look.kind)) body = CREATURES[look.kind](doc, look, expression);
  else body = placeholderSVG(doc);
  const defs = doc.defs.length ? `<defs>${doc.defs.join('')}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}<g${flip ? ' transform="matrix(-1 0 0 1 512 0)"' : ''}>${body}</g></svg>`;
}

const urlCache = new Map();

/**
 * Cached data URL of a portrait, ready for <img src> or CSS backgrounds.
 * @param {string} id
 * @param {{expression?: string, promoted?: boolean, flip?: boolean}} [opts]
 * @returns {string} 'data:image/svg+xml;charset=utf-8,…'
 */
export function portraitURL(id, opts = {}) {
  const o = opts || {};
  const expression = EXPRESSIONS.includes(o.expression) ? o.expression : 'neutral';
  const key = `${hasPortrait(id) ? id : '?'}|${expression}|${o.promoted ? 1 : 0}|${o.flip ? 1 : 0}`;
  let url = urlCache.get(key);
  if (!url) {
    url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(portraitSVG(id, { expression, promoted: !!o.promoted, flip: !!o.flip }));
    urlCache.set(key, url);
  }
  return url;
}

/**
 * Whether a dedicated portrait exists for this id (cast or generic); others render the placeholder.
 * @param {string} id
 * @returns {boolean}
 */
export function hasPortrait(id) {
  return typeof id === 'string' && (own(CAST, id) || own(GENERIC, id));
}
