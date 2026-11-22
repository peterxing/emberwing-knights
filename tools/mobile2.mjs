// Mobile battle audit: tap-to-preview / tap-to-confirm attack, cutscene framing, camp layout.
// Usage: node tools/mobile2.mjs [baseUrl] [portrait|landscape] [outPrefix]
import { chromium, webkit } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5191';
const orient = process.argv[3] || 'portrait';
const out = process.argv[4] || `.snaps/mb-${orient}`;
const size = orient === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
let errors = 0;
page.on('pageerror', (e) => { errors++; console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/X3595|X4000/.test(m.text())) { errors++; console.log('CONSOLE.ERROR', m.text()); } });
const shot = (n) => page.screenshot({ path: `${out}-${n}.png` }).then(() => console.log('shot', n));
const until = async (fn, timeout = 90000, label = '') => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); } console.log('TIMEOUT', label); return false; };
const tap = async (x, y) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(400); };
const unitTap = async (id) => {
  await page.evaluate((id) => { const b = window.__game.battle; const u = b.board.units.find((v) => v.id === id); b.rig.focus(b.world.tileCenter(u.x, u.y), { instant: true }); }, id);
  await page.waitForTimeout(350);
  const p = await page.evaluate((id) => { const b = window.__game.battle; const u = b.board.units.find((v) => v.id === id); return b.tileScreen(u.x, u.y); }, id);
  await tap(p.x, p.y);
};
const state = () => page.evaluate(() => { const b = window.__game.battle; return `mode=${b.mode} sel=${b.sel?.id || '-'} previewed=${b.previewed?.id || '-'} cine=${document.querySelector('#ui').classList.contains('cine')}`; });

try {
  await page.goto(`${base}/?chapter=3&skip=1`, { waitUntil: 'load', timeout: 120000 });
  await until(() => window.__game?.battle?.mode === 'idle', 90000, 'idle');
  await page.evaluate(() => document.querySelector('.hint .close')?.click());
  await page.waitForTimeout(500);
  await unitTap('mira');
  console.log('1', await state());
  // tap an enemy in range: should go straight to targeting with a forecast, NOT attack yet
  const ep = await page.evaluate(() => { const b = window.__game.battle; const e = b.board.units.find((u) => u.id === 'soldier_14_11'); return b.tileScreen(e.x, e.y); });
  await tap(ep.x, ep.y);
  await page.waitForTimeout(800);
  console.log('2', await state());
  await shot('1-forecast');
  // second tap on the same (previewed) enemy confirms
  const ep2 = await page.evaluate(() => { const b = window.__game.battle; const e = b.board.units.find((u) => u.id === 'soldier_14_11'); return b.tileScreen(e.x, e.y); });
  await tap(ep2.x, ep2.y);
  await until(() => document.querySelector('#ui').classList.contains('cine'), 20000, 'cutscene');
  console.log('3', await state());
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(1100); await shot(`2-cine-${i}`); }
  await until(() => !document.querySelector('#ui').classList.contains('cine'), 30000, 'cutscene end');
  await page.waitForTimeout(2500);
  await shot('3-after');
  console.log('4', await state());
} catch (e) { console.log('ERR', e.message); }

try {
  await page.goto(`${base}/?campOnly=5`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(9000);
  await shot('4-camp');
  await tap(...(await page.locator('[data-tab="shop"]').boundingBox().then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
  await page.waitForTimeout(800);
  await shot('5-shop');
} catch (e) { console.log('ERR camp', e.message); }
console.log('errors:', errors);
await browser.close();
