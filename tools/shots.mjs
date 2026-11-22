// Captures README screenshots (JPEG) from a running build. Usage: node tools/shots.mjs [baseUrl]
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5191';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const shot = (name) => page.screenshot({ path: `docs/${name}.jpg`, type: 'jpeg', quality: 86 }).then(() => console.log('saved', name));
const until = async (fn, timeout = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(250); } return false; };
const focus = (x, y, dist) => page.evaluate(([x, y, dist]) => { const b = window.__game.battle; b.rig.focus(b.world.tileCenter(x, y), { dist, instant: true }); }, [x, y, dist]);

// 1. title
await page.goto(`${base}/`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.mouse.click(640, 400);
await page.waitForTimeout(4500);
await shot('title');

// 2. tactics map with a selected unit
await page.goto(`${base}/?chapter=1&skip=1`, { waitUntil: 'load' });
await until(() => window.__game?.battle?.mode === 'idle');
await page.evaluate(() => document.querySelector('.hint .close')?.click());
await focus(9, 9, 17);
await page.waitForTimeout(700);
let p = await page.evaluate(() => { const b = window.__game.battle; const u = b.board.units.find((v) => v.id === 'kael'); return b.tileScreen(u.x, u.y); });
await page.mouse.move(p.x, p.y);
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(500);
p = await page.evaluate(() => window.__game.battle.tileScreen(9, 8));
await page.mouse.move(p.x, p.y);
await page.waitForTimeout(700);
await shot('tactics');

// 3. dialogue with portrait
await page.goto(`${base}/?chapter=2`, { waitUntil: 'load' });
await until(() => !!document.querySelector('.dialogue:not(.hidden) .portrait img'));
await page.waitForTimeout(2500);
await shot('dialogue');

// 4. battle cutscene (Mira's spell on the bridge)
await page.goto(`${base}/?chapter=3&skip=1`, { waitUntil: 'load' });
await until(() => window.__game?.battle?.mode === 'idle');
await page.evaluate(() => document.querySelector('.hint .close')?.click());
await page.evaluate(() => { const b = window.__game.battle; const m = b.board.units.find((u) => u.id === 'mira'); b.rig.focus(b.world.tileCenter(m.x, m.y), { instant: true }); });
await page.waitForTimeout(400);
p = await page.evaluate(() => { const b = window.__game.battle; const m = b.board.units.find((u) => u.id === 'mira'); return b.tileScreen(m.x, m.y); });
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(400);
p = await page.evaluate(() => { const b = window.__game.battle; const e = b.board.units.find((u) => u.id === 'soldier_14_11'); return b.tileScreen(e.x, e.y); });
await page.mouse.click(p.x, p.y);
await until(() => window.__game.battle.mode === 'target', 20000);
await page.waitForTimeout(600);
await shot('forecast');
await page.mouse.click(p.x, p.y);
await until(() => document.querySelector('#ui').classList.contains('cine'), 20000);
await page.waitForTimeout(2600);
await shot('battle');

// 5. desert & finale maps
for (const [ch, name, x, y, d] of [[5, 'desert', 11, 8, 22], [6, 'finale', 9, 7, 22], [4, 'fortress', 9, 9, 22]]) {
  await page.goto(`${base}/?chapter=${ch}&skip=1`, { waitUntil: 'load' });
  await until(() => window.__game?.battle?.mode === 'idle');
  await page.evaluate(() => document.querySelector('.hint .close')?.click());
  await focus(x, y, d);
  await page.waitForTimeout(1200);
  await shot(name);
}

// 6. camp
await page.goto(`${base}/?campOnly=5`, { waitUntil: 'load' });
await page.waitForTimeout(9000);
await shot('camp');
await browser.close();
