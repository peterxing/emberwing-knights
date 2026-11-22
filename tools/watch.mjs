// Watch a game session: periodic screenshots + live error log. Usage:
// node tools/watch.mjs "<url>" <outPrefix> <count=10> <intervalMs=4000>
import { chromium } from 'playwright-core';

const [, , url, out = '.snaps/watch', count = '10', interval = '4000'] = process.argv;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/X3595|X4000/.test(t)) console.log('CONSOLE.ERROR', t); });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('NAVIGATED', f.url()); });
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
for (let i = 0; i < +count; i++) {
  await page.waitForTimeout(+interval);
  let st = '';
  try {
    st = await page.evaluate(() => { const b = window.__game?.battle; return b ? `turn ${b.turn} ${b.phase} mode=${b.mode} over=${b.over} result=${b.result} players=${b.board.alive.filter((u) => u.side === 'player').length} enemies=${b.board.alive.filter((u) => u.side === 'enemy').length} fps=${window.__game.engine.fps.toFixed(0)}` : 'no battle'; });
  } catch (e) { st = 'eval failed: ' + e.message; }
  await page.screenshot({ path: `${out}-${String(i).padStart(2, '0')}.png` }).catch(() => {});
  console.log(i, st);
}
await browser.close();
