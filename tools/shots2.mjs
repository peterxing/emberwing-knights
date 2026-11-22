// Retakes specific README shots. Usage: node tools/shots2.mjs [baseUrl]
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5191';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const until = async (fn, timeout = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await page.waitForTimeout(200); } return false; };
const shot = (name) => page.screenshot({ path: `docs/${name}.jpg`, type: 'jpeg', quality: 86 }).then(() => console.log('saved', name));

// Cutscene: Kael vs a bandit on the Chapter I field (direct API call for reliability)
await page.goto(`${base}/?chapter=3&skip=1`, { waitUntil: 'load' });
await until(() => window.__game?.battle?.mode === 'idle');
await page.evaluate(() => {
  const b = window.__game.battle;
  const m = b.board.units.find((u) => u.id === 'mira');
  const e = b.board.units.find((u) => u.id === 'soldier_14_11');
  b.executeAttack(m, e, 'frost');
});
await until(() => document.querySelector('#ui').classList.contains('cine'), 30000);
for (const [t, n] of [[1500, 'battle-cast'], [650, 'battle']]) { await page.waitForTimeout(t); await shot(n); }

// Finale map after the banner
await page.goto(`${base}/?chapter=6&skip=1`, { waitUntil: 'load' });
await until(() => window.__game?.battle?.mode === 'idle');
await page.evaluate(() => { document.querySelector('.hint .close')?.click(); const b = window.__game.battle; b.rig.focus(b.world.tileCenter(9, 6), { dist: 21, instant: true }); });
await page.waitForTimeout(2500);
await shot('finale');
await browser.close();
