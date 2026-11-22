// End-to-end interaction test with real mouse input in headless Edge.
// Usage: node tools/e2e.mjs [baseUrl=http://127.0.0.1:5173] [outPrefix=.snaps/e2e]
import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const out = process.argv[3] || '.snaps/e2e';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = async (name) => { await page.screenshot({ path: `${out}-${name}.png` }); console.log('shot', name); };
const until = async (fn, timeout = 60000, label = '') => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(250); }
  console.log('TIMEOUT waiting for', label); return false;
};
const unitScreen = (id) => page.evaluate((id) => {
  const b = window.__game.battle; const u = b.board.units.find((v) => v.id === id && v.alive) || b.board.units.find((v) => v.side === 'player' && v.alive);
  return { ...b.tileScreen(u.x, u.y), x0: u.x, y0: u.y };
}, id);

try {
  await page.goto(`${base}/?chapter=${process.env.CH || 1}&skip=1&anim=${process.env.ANIM || 'full'}`, { waitUntil: 'load' });
  await until(() => window.__game?.battle?.mode === 'idle' && window.__game.battle.phase === 'player', 90000, 'player phase');
  await page.waitForTimeout(800);
  await shot('1-idle');
  const k = await unitScreen('kael');
  await page.mouse.move(k.x, k.y); await page.waitForTimeout(150);
  await page.mouse.click(k.x, k.y);
  await page.waitForTimeout(600);
  await shot('2-selected');
  // pick nearest attackable enemy
  const target = await page.evaluate(() => {
    const b = window.__game.battle; const u = b.sel;
    const foes = b.board.alive.filter((e) => e.side === 'enemy').map((e) => ({ e, t: b.bestAttackTile(u, e) })).filter((o) => o.t);
    if (!foes.length) return null;
    const f = foes[0];
    return { ...b.tileScreen(f.e.x, f.e.y), id: f.e.id };
  });
  console.log('target', JSON.stringify(target));
  if (target) {
    await page.mouse.move(target.x, target.y); await page.waitForTimeout(200);
    await shot('3-path');
    await page.mouse.click(target.x, target.y);
    await until(() => window.__game.battle.mode === 'target' || window.__game.battle.mode === 'menu', 15000, 'targeting');
    await page.waitForTimeout(500);
    await shot('4-forecast');
    const t2 = await page.evaluate((id) => { const b = window.__game.battle; const e = b.board.units.find((v) => v.id === id); return b.tileScreen(e.x, e.y); }, target.id);
    await page.mouse.click(t2.x, t2.y);
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(900); await shot(`5-battle-${i}`); }
    await until(() => window.__game.battle.mode === 'idle' || window.__game.battle.phase === 'enemy', 40000, 'after attack');
    await page.waitForTimeout(1500);
    await shot('6-after');
  } else {
    // no target: move somewhere and open the menu
    const reach = await page.evaluate(() => { const b = window.__game.battle; const k = [...b.reach.ends][3]; const [x, y] = k.split(',').map(Number); return b.tileScreen(x, y); });
    await page.mouse.click(reach.x, reach.y);
    await page.waitForTimeout(1500);
    await shot('4-menu');
  }
} catch (e) {
  console.log('E2E ERROR', e.message);
}
console.log(logs.filter((l) => !/X3595|X4000|uninitialized|vite/.test(l)).slice(-40).join('\n') || 'no errors');
await browser.close();
