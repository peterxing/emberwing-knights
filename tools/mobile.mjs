// Mobile audit: emulated phone (touch, high DPR) in portrait or landscape, driven by real taps.
// Usage: node tools/mobile.mjs [baseUrl] [portrait|landscape] [outPrefix]
import { chromium, webkit } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5191';
const orient = process.argv[3] || 'portrait';
const out = process.argv[4] || `.snaps/m-${orient}`;
const size = orient === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 };
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({
  viewport: size, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'warning' && /audio|webgl|WebGL/i.test(m.text())) console.log('WARN', m.text()); if (m.type() === 'error' && !/X3595|X4000/.test(m.text())) { errors.push(m.text()); console.log('CONSOLE.ERROR', m.text()); } });
const shot = (n) => page.screenshot({ path: `${out}-${n}.png` }).then(() => console.log('shot', n));
const until = async (fn, timeout = 90000, label = '') => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); } console.log('TIMEOUT', label); return false; };
const tap = async (x, y) => { await page.touchscreen.tap(x, y); await page.waitForTimeout(350); };
const tapSel = async (sel) => { const b = await page.locator(sel).first().boundingBox(); if (!b) { console.log('missing', sel); return false; } await tap(b.x + b.width / 2, b.y + b.height / 2); return true; };
const tileScreen = (x, y) => page.evaluate(([x, y]) => window.__game.battle.tileScreen(x, y), [x, y]);
const focus = (x, y) => page.evaluate(([x, y]) => { const b = window.__game.battle; b.rig.focus(b.world.tileCenter(x, y), { instant: true }); }, [x, y]);
const info = () => page.evaluate(() => { const b = window.__game?.battle; return b ? `mode=${b.mode} phase=${b.phase} sel=${b.sel?.id || '-'} q=${window.__game.engine.quality} fps=${window.__game.engine.fps.toFixed(0)}` : 'no battle'; });

try {
  // Title
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
  await until(() => !!document.querySelector('.press-start'), 90000, 'title');
  await page.waitForTimeout(1500);
  await shot('1-title-start');
  await tap(size.width / 2, size.height / 2);
  await until(() => !!document.querySelector('.title-menu'), 20000, 'menu');
  await page.waitForTimeout(1000);
  await shot('2-title-menu');
  // Settings modal
  await tapSel('.title-menu .tm[data-id="settings"]');
  await page.waitForTimeout(600);
  await shot('3-settings');
  await tapSel('.modal [data-close]');
  // Story + battle (chapter 1, dialogue on)
  await tapSel('.title-menu .tm[data-id="new"]');
  await until(() => !!document.querySelector('.dialogue:not(.hidden)'), 60000, 'dialogue');
  await page.waitForTimeout(1500);
  for (let i = 0; i < 6; i++) { await tap(size.width / 2, size.height - 80); await page.waitForTimeout(250); }
  await page.waitForTimeout(1200);
  await shot('4-dialogue');
  await tapSel('.dialogue .skip');
  await until(() => window.__game?.battle?.mode === 'idle', 60000, 'player phase');
  await page.waitForTimeout(1500);
  await shot('5-map');
  console.log(await info());
  // Select Kael by tapping him
  await focus(9, 11);
  await page.waitForTimeout(400);
  let p = await tileScreen(9, 11);
  await tap(p.x, p.y);
  await shot('6-selected');
  console.log('after tap kael:', await info());
  // Move two tiles north and open the menu
  p = await tileScreen(9, 9);
  await tap(p.x, p.y);
  await page.waitForTimeout(1200);
  await shot('7-menu');
  console.log('after move:', await info());
  await tapSel('.action-menu .menu-item:last-child');
  await page.waitForTimeout(800);
  console.log('after wait/cancel:', await info());
  await shot('8-after');
} catch (e) { console.log('MOBILE ERROR', e.message); }
console.log(`errors: ${errors.length}`);
await browser.close();
