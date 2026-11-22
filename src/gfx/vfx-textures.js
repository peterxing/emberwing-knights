// Procedural canvas textures for the VFX module: particle atlas, rune circle and wing of light.
// Every texture is a white mask (luminance detail in RGB, coverage in A) tinted in the shaders,
// so all of them stay linear (NoColorSpace).
import * as THREE from 'three';

/** Particle atlas layout (cells of 128 px). */
export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;

/** Atlas cell indices. */
export const CELLS = Object.freeze({
  glow: 0, spark: 1, star: 2, smoke: 3,
  ring: 4, shard: 5, leaf: 6, flake: 7,
  ember: 8, feather: 9, fire: 10, rune: 11,
  drop: 12, dot: 13, plus: 14, wisp: 15,
});

/** Small fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/** Periodic 2D value noise + fbm built from a seeded lattice. */
function makeNoise(rand, period = 16) {
  const P = period;
  const g = new Float32Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const at = (x, y) => g[(((y % P) + P) % P) * P + (((x % P) + P) % P)];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y, oct = 4) => {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { s += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };
  return { noise, fbm };
}

/** Per-pixel painter: fn(nx, ny) -> [lum, alpha] with nx, ny in [-1, 1] (y down). */
function paintPixels(ctx, S, fn) {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = ((x + 0.5) / S) * 2 - 1, ny = ((y + 0.5) / S) * 2 - 1;
      const r = fn(nx, ny);
      const i = (y * S + x) * 4;
      const l = Math.round(clamp01(r[0]) * 255);
      d[i] = d[i + 1] = d[i + 2] = l;
      d[i + 3] = Math.round(clamp01(r[1]) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

const out2 = [1, 0];
const px = (l, a) => { out2[0] = l; out2[1] = a; return out2; };

// ------------------------------------------------------------------ atlas cells
const CELL_PAINTERS = {
  glow(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const r = Math.sqrt(x * x + y * y) / 0.96;
      if (r >= 1) return px(1, 0);
      const a = Math.exp(-r * r * 5.5) * 0.92 + Math.exp(-r * r * 28) * 0.35;
      return px(1, a * (1 - r * r) * 1.0);
    });
  },
  spark(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const ay = Math.abs(y) / 0.96;
      if (ay >= 1) return px(1, 0);
      const w = 0.3 * Math.pow(1 - ay, 0.8) + 0.03;
      const core = Math.exp(-(x * x) / (w * w * 0.3)) * Math.pow(1 - ay, 0.5);
      const halo = Math.exp(-(x * x) / (w * w * 1.6)) * Math.pow(1 - ay, 1.2) * 0.4;
      return px(1, Math.min(1, core + halo) * smooth(1, 0.8, Math.abs(x)));
    });
  },
  star(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const r2 = x * x + y * y;
      const ray = (u, v, len, w) => {
        const av = Math.abs(v) / len;
        if (av >= 1) return 0;
        const ww = w * Math.pow(1 - av, 1.2) + 0.004;
        return Math.exp(-(u * u) / (ww * ww)) * Math.pow(1 - av, 1.6);
      };
      const k = Math.SQRT1_2;
      const dx = (x + y) * k, dy = (x - y) * k;
      let a = ray(x, y, 0.97, 0.07) + ray(y, x, 0.97, 0.07);
      a += 0.45 * (ray(dx, dy, 0.5, 0.05) + ray(dy, dx, 0.5, 0.05));
      a += Math.exp(-r2 / 0.012) + 0.35 * Math.exp(-r2 / 0.07);
      return px(1, Math.min(1, a) * (r2 < 0.94 ? 1 : 0));
    });
  },
  smoke(ctx, S, rand) {
    const { fbm } = makeNoise(rand, 8);
    const blobs = [];
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.34;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.24 + rand() * 0.18]);
    }
    paintPixels(ctx, S, (x, y) => {
      let dens = 0;
      for (const [bx, by, br] of blobs) {
        const q = 1 - ((x - bx) ** 2 + (y - by) ** 2) / (br * br);
        if (q > 0) dens += q * q;
      }
      const n = fbm(x * 2.6 + 5.3, y * 2.6 + 1.7, 5);
      const a = (1 - Math.exp(-dens * (0.35 + 1.1 * n) * 1.6)) * smooth(0.97, 0.55, Math.sqrt(x * x + y * y));
      return px(0.74 + 0.26 * n, a * 0.9);
    });
  },
  ring(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const d = (r - 0.8) / 0.05;
      const q = (r - 0.8) / 0.15;
      const a = Math.exp(-d * d) + 0.3 * Math.exp(-q * q);
      return px(1, a * smooth(0.98, 0.9, r));
    });
  },
  shard(ctx, S) {
    const P = (u, v) => [u * S, v * S];
    const pts = [P(0.52, 0.05), P(0.72, 0.42), P(0.6, 0.95), P(0.36, 0.84), P(0.3, 0.36)];
    const mid = P(0.5, 0.5);
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = S * 0.05;
    const faces = [[0, 1, 0.95], [1, 2, 0.62], [2, 3, 0.78], [3, 4, 1.0], [4, 0, 0.86]];
    for (const [a, b, l] of faces) {
      const v = Math.round(l * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},0.92)`;
      ctx.beginPath(); ctx.moveTo(...mid); ctx.lineTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = S * 0.025;
    ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
    ctx.closePath(); ctx.stroke();
    ctx.lineWidth = S * 0.012;
    ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...mid); ctx.lineTo(...pts[2]); ctx.stroke();
    ctx.restore();
  },
  leaf(ctx, S) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(0.35);
    const h = S * 0.44, w = S * 0.2;
    const grad = ctx.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, 'rgb(190,190,190)'); grad.addColorStop(0.5, 'rgb(255,255,255)'); grad.addColorStop(1, 'rgb(170,170,170)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.bezierCurveTo(w * 1.3, -h * 0.45, w * 1.1, h * 0.55, 0, h * 0.82);
    ctx.bezierCurveTo(-w * 1.1, h * 0.55, -w * 1.3, -h * 0.45, 0, -h);
    ctx.fill();
    ctx.strokeStyle = 'rgb(120,120,120)';
    ctx.lineWidth = S * 0.018;
    ctx.beginPath(); ctx.moveTo(0, -h * 0.85); ctx.lineTo(0, h * 0.98); ctx.stroke();
    ctx.lineWidth = S * 0.01;
    for (let i = 0; i < 4; i++) {
      const yy = -h * 0.45 + i * h * 0.3;
      ctx.beginPath(); ctx.moveTo(0, yy + h * 0.12); ctx.lineTo(w * 0.75, yy - h * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, yy + h * 0.12); ctx.lineTo(-w * 0.75, yy - h * 0.05); ctx.stroke();
    }
    ctx.restore();
  },
  flake(ctx, S) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = S * 0.04;
    const L = S * 0.42;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.lineWidth = S * 0.04;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.stroke();
      ctx.lineWidth = S * 0.028;
      for (const [f, b] of [[0.45, 0.22], [0.72, 0.15]]) {
        ctx.beginPath(); ctx.moveTo(0, -L * f); ctx.lineTo(L * b, -L * (f + b)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -L * f); ctx.lineTo(-L * b, -L * (f + b)); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, S * 0.06, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  ember(ctx, S, rand) {
    const { noise } = makeNoise(rand, 8);
    paintPixels(ctx, S, (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      const ang = Math.atan2(y, x);
      const rad = 0.28 + 0.1 * noise(Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 + 3);
      const body = smooth(rad, rad * 0.35, r);
      const halo = Math.exp(-r * r * 9) * 0.35;
      return px(0.85 + 0.15 * smooth(rad, 0, r), Math.min(1, body + halo) * smooth(0.98, 0.85, r));
    });
  },
  feather(ctx, S) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-0.25);
    const h = S * 0.45;
    const grad = ctx.createLinearGradient(-S * 0.15, 0, S * 0.15, 0);
    grad.addColorStop(0, 'rgba(225,225,225,0.95)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(215,215,215,0.9)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.bezierCurveTo(S * 0.2, -h * 0.6, S * 0.17, h * 0.3, S * 0.02, h * 0.62);
    ctx.lineTo(-S * 0.02, h * 0.62);
    ctx.bezierCurveTo(-S * 0.13, h * 0.3, -S * 0.15, -h * 0.55, 0, -h);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = S * 0.014;
    for (const [side, yy] of [[1, -0.15], [1, 0.25], [-1, 0.05], [-1, 0.4]]) {
      ctx.beginPath(); ctx.moveTo(side * S * 0.2, h * yy - S * 0.06); ctx.lineTo(side * S * 0.06, h * yy + S * 0.02); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = S * 0.02;
    ctx.beginPath(); ctx.moveTo(0, -h * 0.92); ctx.quadraticCurveTo(S * 0.015, 0, 0, h); ctx.stroke();
    ctx.restore();
  },
  fire(ctx, S, rand) {
    const { fbm } = makeNoise(rand, 8);
    const blobs = [];
    for (let i = 0; i < 4; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.16;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d - 0.04, 0.42 + rand() * 0.14]);
    }
    paintPixels(ctx, S, (x, y) => {
      let dens = 0;
      for (const [bx, by, br] of blobs) {
        const q = 1 - ((x - bx) ** 2 + (y - by) ** 2) / (br * br);
        if (q > 0) dens += q * q;
      }
      const n = fbm(x * 2.2 + 7.1, y * 1.3 + 3.3, 5);
      const streak = fbm(x * 5.5 + 1.3, y * 1.6 + 8.2, 3);
      const a = (1 - Math.exp(-dens * (0.1 + 1.5 * n) * 1.4)) * smooth(0.95, 0.45, Math.sqrt(x * x + y * y));
      return px(0.4 + 0.45 * n + 0.15 * streak, a * 0.92);
    });
  },
  rune(ctx, S, rand) {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = S * 0.06;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = S * 0.08;
    drawGlyph(ctx, 0, 0, S * 0.62, rand, 5);
    ctx.restore();
  },
  drop(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const cy = -0.35, R = 0.3;
      const dc = Math.sqrt(x * x + (y - cy) * (y - cy));
      let d = dc - R;
      if (y > cy) {
        const t = clamp01((y - cy) / (0.95 - cy));
        const w = R * (1 - t) * (1 - t * 0.2);
        d = Math.min(d, Math.abs(x) - w);
      }
      const a = smooth(0.05, -0.08, d);
      const hl = Math.exp(-((x + 0.1) ** 2 + (y - cy + 0.1) ** 2) * 60) * 0.4;
      return px(0.8 + hl, a);
    });
  },
  dot(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const r = Math.sqrt(x * x + y * y);
      return px(1, smooth(0.42, 0.3, r) + 0.3 * Math.exp(-r * r * 6) * smooth(0.98, 0.8, r));
    });
  },
  plus(ctx, S) {
    paintPixels(ctx, S, (x, y) => {
      const ray = (u, v) => {
        const av = Math.abs(v) / 0.97;
        if (av >= 1) return 0;
        const w = 0.035 * (1 - av) + 0.006;
        return Math.exp(-(u * u) / (w * w)) * Math.pow(1 - av, 2.2);
      };
      const r2 = x * x + y * y;
      return px(1, Math.min(1, ray(x, y) + ray(y, x) + Math.exp(-r2 / 0.006) + 0.25 * Math.exp(-r2 / 0.04)));
    });
  },
  wisp(ctx, S, rand) {
    const { fbm } = makeNoise(rand, 8);
    const blobs = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      blobs.push([-0.62 + t * 1.24, Math.sin(t * Math.PI * 1.6) * 0.22, 0.12 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.2))]);
    }
    paintPixels(ctx, S, (x, y) => {
      let dens = 0;
      for (const [bx, by, br] of blobs) {
        const q = 1 - ((x - bx) ** 2 + (y - by) ** 2) / (br * br);
        if (q > 0) dens += q * q;
      }
      const n = fbm(x * 3.2 + 2.1, y * 3.2 + 9.4, 5);
      const a = clamp01(dens * (0.45 + 0.9 * n) * 1.4 - 0.08) * smooth(0.98, 0.8, Math.max(Math.abs(x), Math.abs(y)));
      return px(0.7 + 0.3 * n, Math.min(1, a));
    });
  },
};

/** Draws a procedural (invented) rune glyph centred at x, y with height h. */
export function drawGlyph(ctx, x, y, h, rand, strokes = 4) {
  const w = h * 0.7;
  const gx = (i) => x - w / 2 + (i / 2) * w;
  const gy = (j) => y - h / 2 + (j / 3) * h;
  ctx.beginPath();
  const spine = Math.floor(rand() * 3);
  ctx.moveTo(gx(spine), gy(0)); ctx.lineTo(gx(spine), gy(3));
  for (let s = 0; s < strokes; s++) {
    const kind = rand();
    const i0 = Math.floor(rand() * 3), j0 = Math.floor(rand() * 4);
    const i1 = Math.floor(rand() * 3), j1 = Math.floor(rand() * 4);
    if (kind < 0.62) {
      ctx.moveTo(gx(i0), gy(j0)); ctx.lineTo(gx(i1 === i0 ? (i0 + 1) % 3 : i1), gy(j1));
    } else if (kind < 0.85) {
      const rr = h * (0.08 + rand() * 0.08);
      ctx.moveTo(gx(i0) + rr, gy(j0)); ctx.arc(gx(i0), gy(j0), rr, 0, Math.PI * 2);
    } else {
      const xm = gx(i0), ym = gy(j0);
      ctx.moveTo(xm - w * 0.2, ym); ctx.quadraticCurveTo(xm, ym - h * 0.25, xm + w * 0.2, ym);
    }
  }
  ctx.stroke();
}

/** 4x4 particle atlas (128 px cells). */
export function createParticleAtlas(cell = 128, seed = 7) {
  const rand = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = cell * ATLAS_COLS;
  canvas.height = cell * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = cell;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  for (const [name, idx] of Object.entries(CELLS)) {
    tctx.clearRect(0, 0, cell, cell);
    tctx.save();
    CELL_PAINTERS[name](tctx, cell, rand);
    tctx.restore();
    const cx = (idx % ATLAS_COLS) * cell, cy = Math.floor(idx / ATLAS_COLS) * cell;
    ctx.drawImage(tmp, cx, cy);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Two-layer rune circle (outer layer r > 0.745, inner layer below) so the shader can
 * counter-rotate them. White strokes with baked glow.
 */
export function createRuneCircleTexture(size = 1024, seed = 1337) {
  const rand = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const R = size / 2;
  ctx.translate(R, R);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = size * 0.008;
  const ring = (r, w, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = w * size;
    ctx.beginPath(); ctx.arc(0, 0, r * R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  // outer layer
  ring(0.965, 0.011);
  ring(0.925, 0.0045);
  ring(0.79, 0.0045);
  const n = 26;
  ctx.lineWidth = size * 0.0052;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -0.857 * R);
    drawGlyph(ctx, 0, 0, 0.09 * R, rand, 3 + Math.floor(rand() * 3));
    ctx.restore();
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.save(); ctx.rotate(a);
    ctx.beginPath(); ctx.arc(0, -0.945 * R, 0.03 * R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = i % 6 === 0 ? 0.008 : 0.0045;
    ctx.beginPath(); ctx.arc(Math.cos(a) * 0.765 * R, Math.sin(a) * 0.765 * R, rr * size, 0, Math.PI * 2); ctx.fill();
  }
  // inner layer
  const hexR = 0.68;
  ctx.lineWidth = size * 0.0055;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = -Math.PI / 2 + k * Math.PI + (i / 3) * Math.PI * 2;
      const x = Math.cos(a) * hexR * R, y = Math.sin(a) * hexR * R;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * hexR * R, y = Math.sin(a) * hexR * R;
    ctx.lineWidth = size * 0.004;
    ctx.beginPath(); ctx.arc(x, y, 0.045 * R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 0.014 * R, 0, Math.PI * 2); ctx.fill();
  }
  ring(0.5, 0.005);
  ring(0.355, 0.004);
  ctx.lineWidth = size * 0.0045;
  const m = 12;
  for (let i = 0; i < m; i++) {
    ctx.save();
    ctx.rotate((i / m) * Math.PI * 2);
    ctx.translate(0, -0.428 * R);
    drawGlyph(ctx, 0, 0, 0.07 * R, rand, 3);
    ctx.restore();
  }
  ctx.lineWidth = size * 0.004;
  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-0.2 * R, -0.2 * R, 0.4 * R, 0.4 * R);
  ctx.restore();
  ctx.strokeRect(-0.2 * R, -0.2 * R, 0.4 * R, 0.4 * R);
  ring(0.13, 0.006);
  ring(0.06, 0.004);
  ctx.beginPath(); ctx.arc(0, 0, 0.022 * R, 0, Math.PI * 2); ctx.fill();
  // faint fill so the disc reads as a surface
  ctx.shadowBlur = 0;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.97);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.95, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.97, 0, Math.PI * 2); ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A single right-hand wing of light; root at the left-middle of the texture. */
export function createWingTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rootX = size * 0.06, rootY = size * 0.62;
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = size * 0.025;
  const feather = (ang, len, wid, alpha) => {
    ctx.save();
    ctx.translate(rootX, rootY);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.75, `rgba(255,255,255,${alpha * 0.85})`);
    g.addColorStop(1, `rgba(255,255,255,${alpha * 0.35})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(len * 0.05, 0);
    ctx.quadraticCurveTo(len * 0.55, -wid, len, -wid * 0.15);
    ctx.quadraticCurveTo(len * 0.6, wid * 0.55, len * 0.05, 0);
    ctx.fill();
    ctx.restore();
  };
  const L = size * 0.92;
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    feather(-1.05 + t * 1.25, L * (1.0 - t * 0.42), size * 0.07, 0.55);
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    feather(-0.95 + t * 1.15, L * (0.62 - t * 0.2), size * 0.06, 0.7);
  }
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    feather(-0.85 + t * 1.0, L * (0.34 - t * 0.08), size * 0.05, 0.9);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(rootX, rootY, 0, rootX, rootY, L);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  m.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
