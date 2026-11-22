// Anime face decals: canvas-painted eyes / brows / mouth per eye shape and expression,
// projected onto a partial sphere that sits just above the head surface.
import * as THREE from 'three';
import { shade } from './toon.js';
import { makeRng, hashStr } from './char-anim.js';

// Decal coverage (degrees): phi spans the front of the head, theta runs from forehead to chin.
export const FACE = { PHI_HALF: 72, THETA0: 50, THETA1: 146, PPD: 2.6, RADIUS: 1.012 };

/** Partial-sphere geometry (unit head radius) whose UVs match the face canvas. */
export function faceDecalGeometry(quality = 'high') {
  const key = `face/${quality}`;
  let g = decalCache.get(key);
  if (!g) {
    const L = FACE.PHI_HALF * 2 * Math.PI / 180;
    const t0 = FACE.THETA0 * Math.PI / 180, tl = (FACE.THETA1 - FACE.THETA0) * Math.PI / 180;
    const hi = quality !== 'low';
    g = new THREE.SphereGeometry(FACE.RADIUS, hi ? 28 : 16, hi ? 16 : 10, Math.PI / 2 - L / 2, L, t0, tl);
    editFaceNormals(g);
    decalCache.set(key, g);
  }
  return g;
}

const _fn = new THREE.Vector3(), _fd = new THREE.Vector3(0, 0.3, 1).normalize();
/**
 * Anime-style "face normal editing": bend the normals of the front of a head sphere toward the
 * viewer so the face shades as one clean light area instead of a banded ball.
 */
export function editFaceNormals(geo, amount = 0.8) {
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    _fn.fromBufferAttribute(n, i);
    const w = amount * clamp01((_fn.z + 0.15) / 0.75) * clamp01((_fn.y + 0.95) / 0.6);
    _fn.lerp(_fd, w).normalize();
    n.setXYZ(i, _fn.x, _fn.y, _fn.z);
  }
  n.needsUpdate = true;
  return geo;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const decalCache = new Map();

// THREE.Color(hex) stores linear values; convert back to sRGB bytes for canvas strings.
const srgb = (hex, a = 1) => {
  const c = new THREE.Color(hex).convertLinearToSRGB();
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
};

const SHAPES = {
  bright: { w: 27, h: 31, tilt: 1.5, iris: 1.0, pupil: 1.0, lid: 0.0, lash: 1.0, brow: 3 },
  gentle: { w: 27, h: 28, tilt: -2.5, iris: 1.0, pupil: 0.9, lid: 0.1, lash: 0.85, brow: -3 },
  sharp: { w: 27, h: 22, tilt: 4.5, iris: 0.86, pupil: 0.8, lid: 0.08, lash: 1.1, brow: 9 },
  sleepy: { w: 26, h: 25, tilt: -1, iris: 0.96, pupil: 0.9, lid: 0.38, lash: 0.9, brow: -2 },
  fierce: { w: 27, h: 24, tilt: 4, iris: 0.84, pupil: 0.8, lid: 0.18, lash: 1.25, brow: 16, slant: 0.35 },
  cold: { w: 26, h: 21, tilt: 3, iris: 0.82, pupil: 0.55, lid: 0.22, lash: 1.0, brow: 6, slant: 0.15 },
};

export const EXPRESSIONS = ['neutral', 'angry', 'hurt', 'happy', 'closed'];

/** Stable identity for the painted face of a look (characters with equal keys share textures). */
export function faceKey(look) {
  const e = look.eyes || {};
  return [e.color, e.shape, look.gender, look.age, (look.facial || []).join('+'), look.skin, look.hair && look.hair.shade].join('|');
}

const texCache = new Map();

/** Lazily painted, cached face texture for a look and expression. */
export function faceTexture(look, expr = 'neutral') {
  const key = faceKey(look) + '#' + expr;
  let tex = texCache.get(key);
  if (!tex) {
    const W = Math.round(FACE.PHI_HALF * 2 * FACE.PPD), H = Math.round((FACE.THETA1 - FACE.THETA0) * FACE.PPD);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(FACE.PPD, 0, 0, FACE.PPD, FACE.PHI_HALF * FACE.PPD, -FACE.THETA0 * FACE.PPD);
    paintFace(ctx, look, expr);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    texCache.set(key, tex);
  }
  return tex;
}

/** Pre-paint the textures a look needs immediately (neutral + blink). */
export function warmFace(look) { faceTexture(look, 'neutral'); faceTexture(look, 'closed'); }

// ------------------------------------------------------------------ painting
const EYE_Y = 100, EYE_X = 23.5, BROW_GAP = 5, MOUTH_Y = 127.5;

function paintFace(ctx, look, expr) {
  const e = look.eyes || { color: 0x6a4a3a, shape: 'gentle' };
  const sp = SHAPES[e.shape] || SHAPES.gentle;
  const facial = look.facial || [];
  const fem = look.gender === 'f';
  const rng = makeRng(hashStr(faceKey(look)));
  const skin = look.skin || 0xf3d2bd;
  const browCol = look.hair ? shade(look.hair.shade !== undefined ? look.hair.shade : look.hair.color, -0.25) : 0x3a2a22;
  const patch = facial.includes('eyepatch');

  // soft cheek blush
  const blushA = expr === 'happy' ? 0.42 : expr === 'hurt' ? 0.1 : fem ? 0.26 : 0.12;
  for (const s of [-1, 1]) {
    const g = ctx.createRadialGradient(s * 27, 118, 0.5, s * 27, 118, 9);
    g.addColorStop(0, `rgba(255,120,130,${blushA})`);
    g.addColorStop(1, 'rgba(255,120,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(s * 27, 118, 10, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    if (expr === 'happy' || (fem && expr !== 'hurt')) {
      ctx.strokeStyle = `rgba(230,90,110,${expr === 'happy' ? 0.55 : 0.3})`;
      ctx.lineWidth = 0.6;
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(s * 27 + k * 2.6 - 0.8, 119.5); ctx.lineTo(s * 27 + k * 2.6 + 0.8, 116.5); ctx.stroke(); }
    }
  }
  if (facial.includes('stubble')) paintStubble(ctx, skin, rng);
  if (facial.includes('freckles')) {
    ctx.fillStyle = srgb(shade(skin, -0.38), 0.75);
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) {
      const x = s * (20 + rng() * 12), y = 113 + rng() * 7;
      ctx.beginPath(); ctx.ellipse(x, y, 0.65, 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (facial.includes('warpaint')) {
    ctx.fillStyle = 'rgba(178,30,26,0.88)';
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const y = 115 + k * 5;
        ctx.beginPath();
        ctx.moveTo(s * 15, y); ctx.lineTo(s * 36, y - 2.5); ctx.lineTo(s * 36, y + 0.5); ctx.lineTo(s * 15, y + 2.2);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.beginPath(); ctx.moveTo(-1.6, 60); ctx.lineTo(1.6, 60); ctx.lineTo(1.1, 84); ctx.lineTo(-1.1, 84); ctx.closePath(); ctx.fill();
  }

  for (const s of [-1, 1]) {
    if (patch && s === 1) continue;
    paintBrow(ctx, s, sp, expr, browCol, fem);
    paintEye(ctx, s, sp, expr, e.color, fem);
  }
  if (patch) paintPatch(ctx);
  if (facial.includes('scar')) {
    ctx.strokeStyle = 'rgba(170,70,64,0.85)'; ctx.lineCap = 'round'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-31, 76); ctx.lineTo(-22, 114); ctx.stroke();
    ctx.lineWidth = 0.6;
    for (let k = 0; k < 3; k++) { const t = 0.25 + k * 0.25; const x = -31 + 9 * t, y = 76 + 38 * t; ctx.beginPath(); ctx.moveTo(x - 2, y + 0.4); ctx.lineTo(x + 2, y - 0.4); ctx.stroke(); }
  }
  // nose: tiny shadow tick
  ctx.strokeStyle = srgb(shade(skin, -0.32), 0.85); ctx.lineWidth = 0.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0.8, 113.5); ctx.lineTo(-0.4, 115.2); ctx.stroke();
  if (!facial.includes('mask')) paintMouth(ctx, sp, expr, e.shape, look);
}

function eyePath(ctx, w, h, tilt, lid, slant) {
  ctx.beginPath();
  ctx.moveTo(-w / 2, h * 0.1);
  ctx.bezierCurveTo(-w * 0.28, -h * 0.66 * (1 - lid) + slant * h * 0.62, w * 0.26, -h * 0.7 * (1 - lid) - tilt * 0.4, w / 2, -tilt + h * 0.02);
  ctx.bezierCurveTo(w * 0.4, h * 0.5, -w * 0.25, h * 0.62, -w / 2, h * 0.1);
  ctx.closePath();
}

function upperLid(ctx, w, h, tilt, lid, slant) {
  ctx.beginPath();
  ctx.moveTo(-w / 2, h * 0.1);
  ctx.bezierCurveTo(-w * 0.28, -h * 0.66 * (1 - lid) + slant * h * 0.62, w * 0.26, -h * 0.7 * (1 - lid) - tilt * 0.4, w / 2, -tilt + h * 0.02);
}

const LASH = '#24161d';

function paintEye(ctx, s, sp, expr, irisHex, fem) {
  const cx = s * EYE_X, cy = EYE_Y;
  const { w, h, tilt } = sp;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = LASH; ctx.fillStyle = LASH;
  if (expr === 'closed') {
    ctx.lineWidth = 1.9 * sp.lash;
    ctx.beginPath();
    ctx.moveTo(-w * 0.46, h * 0.12);
    ctx.quadraticCurveTo(0, h * 0.42, w * 0.47, -tilt * 0.5 + h * 0.06);
    ctx.stroke();
    if (fem) { ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.44, -tilt * 0.5 + h * 0.07); ctx.lineTo(w * 0.6, -tilt * 0.5 + h * 0.16); ctx.stroke(); }
    ctx.restore();
    return;
  }
  if (expr === 'happy') {
    ctx.lineWidth = 2.1 * sp.lash;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, h * 0.2);
    ctx.quadraticCurveTo(0, -h * 0.42, w * 0.44, h * 0.16);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (expr === 'hurt') {
    ctx.lineWidth = 2.0 * sp.lash;
    ctx.beginPath();
    ctx.moveTo(w * 0.4, -h * 0.3);
    ctx.lineTo(-w * 0.3, h * 0.02);
    ctx.lineTo(w * 0.4, h * 0.3);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const angry = expr === 'angry';
  const lid = sp.lid + (angry ? 0.12 : 0);
  const slant = (sp.slant || 0) + (angry ? 0.42 : 0);
  // eye white with a soft lid shadow
  eyePath(ctx, w, h, tilt, lid, slant);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#fbfaff';
  ctx.fillRect(-w, -h, w * 2, h * 2);
  const sh = ctx.createLinearGradient(0, -h * 0.55, 0, h * 0.1);
  sh.addColorStop(0, 'rgba(110,96,150,0.55)'); sh.addColorStop(1, 'rgba(110,96,150,0)');
  ctx.fillStyle = sh; ctx.fillRect(-w, -h, w * 2, h * 1.2);
  // iris
  const ix = 0.6, iy = h * 0.07, irx = w * 0.31 * sp.iris * (angry ? 0.92 : 1), iry = h * 0.47 * sp.iris;
  const ig = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
  ig.addColorStop(0, srgb(shade(irisHex, -0.62)));
  ig.addColorStop(0.42, srgb(irisHex));
  ig.addColorStop(1, srgb(shade(irisHex, 0.5)));
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = srgb(shade(irisHex, 0.62), 0.55);
  ctx.beginPath(); ctx.ellipse(ix, iy + iry * 0.48, irx * 0.68, iry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = srgb(shade(irisHex, -0.82));
  ctx.beginPath(); ctx.ellipse(ix, iy - iry * 0.05, irx * 0.4 * sp.pupil, iry * 0.42 * sp.pupil, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = srgb(shade(irisHex, -0.7), 0.9); ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // lashes: bold upper line with a flick, thin lower accent, lid crease
  ctx.strokeStyle = LASH;
  ctx.lineWidth = 2.3 * sp.lash;
  upperLid(ctx, w, h, tilt, lid, slant);
  ctx.stroke();
  const ox = w / 2, oy = -tilt + h * 0.02;
  ctx.beginPath();
  ctx.moveTo(ox - w * 0.22, oy - h * 0.16);
  ctx.quadraticCurveTo(ox + 1.2, oy - h * 0.1, ox + (fem ? 3.4 : 1.8), oy - (fem ? 2.6 : 0.8));
  ctx.lineTo(ox + 0.4, oy + 1.2);
  ctx.closePath();
  ctx.fill();
  if (fem) {
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(ox - 1.2, oy - h * 0.12); ctx.lineTo(ox + 2.2, oy - h * 0.3); ctx.stroke();
  }
  ctx.lineWidth = 0.75; ctx.strokeStyle = 'rgba(70,36,48,0.75)';
  ctx.beginPath(); ctx.moveTo(ox - 0.2, oy + 0.6); ctx.quadraticCurveTo(w * 0.36, h * 0.46, w * 0.02, h * 0.53); ctx.stroke();
  if (sp.lid < 0.2 && !angry) {
    ctx.strokeStyle = 'rgba(120,70,80,0.45)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-w * 0.18, -h * 0.6); ctx.quadraticCurveTo(w * 0.12, -h * 0.74, w * 0.38, -h * 0.5 - tilt * 0.5); ctx.stroke();
  }
  ctx.restore();
  // catchlights (same side for both eyes so the light reads consistently)
  const icx = cx + s * 0.6, icy = cy + h * 0.07;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.beginPath(); ctx.ellipse(icx - 2.4, icy - h * 0.19, 2.5 * sp.iris, 2.9 * sp.iris, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(icx + 2.3, icy + h * 0.2, 1.15, 1.0, 0, 0, Math.PI * 2); ctx.fill();
}

function paintBrow(ctx, s, sp, expr, hex, fem) {
  const { w, h } = sp;
  let ang = sp.brow, lift = 0;
  if (expr === 'angry') ang += 16;
  else if (expr === 'hurt') { ang -= 18; lift = -1.5; }
  else if (expr === 'happy') { ang -= 6; lift = -1.8; }
  ctx.save();
  ctx.translate(s * EYE_X, EYE_Y - h * 0.5 - BROW_GAP + lift);
  ctx.scale(s, 1);
  ctx.strokeStyle = srgb(hex);
  ctx.lineCap = 'round';
  ctx.lineWidth = fem ? 1.35 : 1.9;
  const inY = ang * 0.12, outY = -ang * 0.05 - 0.6;
  ctx.beginPath();
  ctx.moveTo(-w * 0.42, inY);
  ctx.quadraticCurveTo(w * 0.05, -2.4 - ang * 0.04, w * 0.46, outY + 1.4);
  ctx.stroke();
  ctx.restore();
}

function paintMouth(ctx, sp, expr, shape, look) {
  const y = MOUTH_Y;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = '#6e2a30', fill = '#5a1820', tongue = '#d9646f';
  if (expr === 'happy') {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(-4.6, y - 1.6); ctx.quadraticCurveTo(0, y - 0.6, 4.6, y - 1.6); ctx.quadraticCurveTo(3.6, y + 5.2, 0, y + 5.4); ctx.quadraticCurveTo(-3.6, y + 5.2, -4.6, y - 1.6); ctx.fill();
    ctx.fillStyle = tongue;
    ctx.beginPath(); ctx.ellipse(0, y + 3.9, 2.6, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (expr === 'angry' || expr === 'hurt') {
    const wTop = expr === 'angry' ? 4.2 : 4.8, wBot = expr === 'angry' ? 2.6 : 3.6, hh = expr === 'angry' ? 5 : 3.4;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(-wTop, y - 1); ctx.lineTo(wTop, y - 1.4); ctx.quadraticCurveTo(wBot + 0.8, y + hh, 0, y + hh); ctx.quadraticCurveTo(-wBot - 0.8, y + hh, -wTop, y - 1); ctx.fill();
    ctx.fillStyle = '#fbf6f2';
    ctx.fillRect(-wTop * 0.8, y - 1.2, wTop * 1.6, 1.2);
    if (expr === 'angry') { ctx.fillStyle = tongue; ctx.beginPath(); ctx.ellipse(0, y + hh - 1.2, 1.8, 0.9, 0, 0, Math.PI * 2); ctx.fill(); }
    return;
  }
  ctx.strokeStyle = line; ctx.lineWidth = 0.95;
  ctx.beginPath();
  if (shape === 'bright' || shape === 'gentle') {
    ctx.moveTo(-3.2, y - 0.6); ctx.quadraticCurveTo(0, y + 2.6, 3.2, y - 0.6);
  } else if (shape === 'fierce') {
    ctx.moveTo(-3.4, y + 0.8); ctx.quadraticCurveTo(0, y - 1.0, 3.4, y + 0.8);
  } else if (shape === 'sleepy') {
    ctx.moveTo(-2.4, y); ctx.quadraticCurveTo(0.4, y + 1.2, 2.6, y - 0.3);
  } else {
    ctx.moveTo(-2.8, y + 0.2); ctx.lineTo(2.8, y - 0.1);
  }
  ctx.stroke();
  if (look.gender === 'f' && (shape === 'bright' || shape === 'gentle')) {
    ctx.strokeStyle = 'rgba(200,90,100,0.35)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-1.4, y + 2.6); ctx.quadraticCurveTo(0, y + 3.2, 1.4, y + 2.6); ctx.stroke();
  }
}

function paintPatch(ctx) {
  const cx = EYE_X, cy = EYE_Y - 1;
  ctx.strokeStyle = '#1e1a1c'; ctx.lineWidth = 1.8; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(cx - 5, cy - 6); ctx.lineTo(-14, 50); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 7, cy - 1); ctx.lineTo(72, cy - 9); ctx.stroke();
  ctx.fillStyle = '#211c1e';
  ctx.beginPath(); ctx.ellipse(cx, cy, 9.5, 8.6, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.ellipse(cx - 1, cy - 1, 6.5, 5.5, -0.15, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
}

function paintStubble(ctx, skin, rng) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, 134, 33, 21, 0, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createLinearGradient(0, 112, 0, 146);
  g.addColorStop(0, srgb(shade(skin, -0.35), 0));
  g.addColorStop(0.35, srgb(shade(skin, -0.35), 0.28));
  g.addColorStop(1, srgb(shade(skin, -0.4), 0.42));
  ctx.fillStyle = g; ctx.fillRect(-40, 110, 80, 40);
  ctx.fillStyle = srgb(shade(skin, -0.55), 0.45);
  for (let k = 0; k < 140; k++) {
    const x = (rng() * 2 - 1) * 32, yy = 116 + rng() * 30;
    ctx.fillRect(x, yy, 0.45, 0.45);
  }
  ctx.restore();
}
