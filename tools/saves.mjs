// End-to-end test of saving: autosave, manual slots, Continue after reload, load mid-battle,
// export/import, retry from turn start, delete, camp saves and resuming after enemy turns.
// Usage: node tools/saves.mjs [baseUrl=http://127.0.0.1:5191] [outPrefix=.snaps/saves]
//   VIEW=desktop|landscape|portrait   BROWSER=edge|webkit
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright-core';

const base = process.argv[2] || 'http://127.0.0.1:5191';
const out = process.argv[3] || '.snaps/saves';
const VIEW = process.env.VIEW || 'desktop';
const WK = process.env.BROWSER === 'webkit';
const touch = VIEW !== 'desktop';
const viewport = { desktop: { width: 1280, height: 720 }, landscape: { width: 844, height: 390 }, portrait: { width: 390, height: 844 } }[VIEW];

const browser = WK
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport, isMobile: touch && !WK ? true : undefined, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));

let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };
const shot = (name) => page.screenshot({ path: `${out}-${VIEW}-${name}.png` });
const until = async (fn, timeout = 60000, label = '', arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await page.waitForTimeout(200); }
  console.log('TIMEOUT waiting for', label); return false;
};
const press = async (loc) => { await loc.waitFor({ state: 'visible', timeout: 15000 }); if (touch) await loc.tap(); else await loc.click(); };
const tapAt = async (x, y) => { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
const idle = () => { const b = window.__game?.battle; return !!b && b.phase === 'player' && b.mode === 'idle' && !b.over && !document.querySelector('.banner'); };
const snap = () => page.evaluate(() => {
  const b = window.__game.battle;
  return { turn: b.turn, units: b.board.units.map((u) => [u.id, u.side, u.x, u.y, u.hp, u.mp, u.level, u.exp, u.acted ? 1 : 0, u.alive ? 1 : 0].join('|')).sort(), opened: [...b.opened].sort().join(';'), gold: window.__game.state.gold };
});
const slot = (s) => page.evaluate((s) => JSON.parse(localStorage.getItem(`emberwing.slot.${s}`) || 'null'), s);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toTitle = async () => {
  await page.locator('.press-start').waitFor({ timeout: 60000 });
  await page.waitForTimeout(300);
  await press(page.locator('.title-screen'));
  await page.locator('.title-menu .tm').first().waitFor();
  await page.waitForTimeout(450);
};
const titlePick = async (id) => { await press(page.locator(`.title-menu .tm[data-id="${id}"]`)); };
const openMenu = async () => { await press(page.locator('.menu-btn')); await page.locator('.sys-menu').waitFor(); await page.waitForTimeout(400); };
const sys = async (a) => { await press(page.locator(`.sys-menu button[data-a="${a}"]`)); };
const waitNewBattle = async (old) => {
  await until((o) => window.__game?.battle && window.__game.battle !== window[o] && window.__game.battle.phase === 'player' && window.__game.battle.mode === 'idle' && !document.querySelector('.banner'), 90000, 'new battle', old);
  await page.waitForTimeout(400);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-saves-'));
try {
  // ---------------------------------------------------------------- new game, autosave on turn 1
  await page.goto(`${base}/?skip=1&anim=map&speed=3`, { waitUntil: 'load' });
  await toTitle();
  ok(await page.locator('.tm[data-id="continue"].disabled').count() === 1, 'fresh browser: Continue disabled');
  await titlePick('new');
  ok(await until(idle, 120000, 'player phase'), 'new game reaches player phase');
  let auto = await slot('auto');
  ok(auto && auto.location === 'battle' && auto.summary.turn === 1, 'autosave written at the start of turn 1');
  const turnStart = await snap();

  // ---------------------------------------------------------------- move Kael and Wait -> autosave
  const k = await page.evaluate(() => {
    const b = window.__game.battle; const u = b.board.units.find((v) => v.id === 'kael');
    b.rig.focus(b.world.tileCenter(u.x, u.y), { instant: true, dist: 21 });
    return { x: u.x, y: u.y };
  });
  await page.waitForTimeout(400);
  const kp = await page.evaluate(({ x, y }) => window.__game.battle.tileScreen(x, y), k);
  await tapAt(kp.x, kp.y);
  await until(() => window.__game.battle.mode === 'selected', 8000, 'selected');
  const dest = await page.evaluate(() => {
    const b = window.__game.battle; const u = b.sel;
    const ends = [...b.reach.ends].map((s) => s.split(',').map(Number)).filter(([x, y]) => (x !== u.x || y !== u.y) && !b.board.unitAt(x, y));
    ends.sort((a, c) => (Math.abs(c[0] - u.x) + Math.abs(c[1] - u.y)) - (Math.abs(a[0] - u.x) + Math.abs(a[1] - u.y)));
    const [x, y] = ends[Math.min(1, ends.length - 1)];
    const s = b.tileScreen(x, y);
    return { tx: x, ty: y, x: s.x, y: s.y };
  });
  await tapAt(dest.x, dest.y);
  if (!(await until(() => window.__game.battle.mode === 'menu', 4000, 'menu (1st tap)'))) { await tapAt(dest.x, dest.y); await until(() => window.__game.battle.mode === 'menu', 8000, 'menu'); }
  await page.waitForTimeout(400);
  await press(page.locator('.menu-item', { hasText: 'Wait' }));
  await until(idle, 30000, 'idle after wait');
  await page.waitForTimeout(300);
  auto = await slot('auto');
  const kaelSaved = auto?.battle?.units.find((u) => u.id === 'kael');
  ok(kaelSaved && kaelSaved.x === dest.tx && kaelSaved.y === dest.ty && kaelSaved.acted, `autosave after a move (Kael at ${dest.tx},${dest.ty}, acted)`);
  ok(await page.locator('.save-blip.on').count() === 1, 'saved indicator flashes');

  // ---------------------------------------------------------------- manual save to slot 1
  await openMenu();
  await shot('1-menu');
  await sys('save');
  await page.locator('.slot-modal').waitFor(); await page.waitForTimeout(400);
  await shot('2-save-picker');
  await press(page.locator('.slot[data-slot="1"]'));
  await page.waitForTimeout(500);
  const s1 = await slot(1);
  ok(s1 && s1.location === 'battle' && s1.battle.units.find((u) => u.id === 'kael').x === dest.tx, 'saved to Slot 1');
  ok(await page.locator('.toast', { hasText: 'Saved to Slot 1' }).count() > 0, 'save toast shown');
  await shot('3-saved');
  await press(page.locator('.slot-modal [data-close]'));
  await page.waitForTimeout(400);
  await sys('close');
  const afterMove = await snap();

  // ---------------------------------------------------------------- reload -> Continue resumes exactly
  await page.reload({ waitUntil: 'load' });
  await toTitle();
  const contText = await page.locator('.tm[data-id="continue"]').innerText();
  ok(/Turn 1/i.test(contText) && !(await page.locator('.tm[data-id="continue"].disabled').count()), `Continue offered after reload ("${contText.replace(/\s+/g, ' ')}")`);
  await shot('4-title');
  await titlePick('continue');
  ok(await until(idle, 120000, 'resumed'), 'Continue resumes the battle');
  const resumed = await snap();
  ok(same(resumed.units, afterMove.units) && resumed.turn === afterMove.turn, 'resumed board matches (positions, HP, MP, EXP, acted)');
  ok(await page.evaluate(() => window.__game.battle.views.size === window.__game.battle.board.units.filter((u) => u.alive).length), 'views rebuilt for living units');

  // ---------------------------------------------------------------- load Slot 1 from the battle menu
  await page.evaluate(() => { window.__old = window.__game.battle; });
  await openMenu();
  await sys('load');
  await page.locator('.slot-modal').waitFor(); await page.waitForTimeout(400);
  await press(page.locator('.slot[data-slot="1"] .slot-info'));
  await page.locator('.confirm-back').waitFor();
  await press(page.locator('.confirm-back button[data-v="1"]'));
  await waitNewBattle('__old');
  ok(same((await snap()).units, afterMove.units), 'Load Game (Slot 1) mid-battle restores the board');

  // ---------------------------------------------------------------- export + import
  if (!WK || process.env.WK_FILES === '1') {
    await openMenu();
    await sys('load');
    await page.locator('.slot-modal').waitFor(); await page.waitForTimeout(400);
    const [dl] = await Promise.all([page.waitForEvent('download'), press(page.locator('.slot[data-slot="1"] [data-export]'))]);
    const file = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(exported.version === 2 && exported.battle && /emberwing-chapter-i-turn1\.json/.test(dl.suggestedFilename()), `export downloads ${dl.suggestedFilename()}`);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    const [fc1] = await Promise.all([page.waitForEvent('filechooser'), press(page.locator('.slot-modal [data-import]'))]);
    await fc1.setFiles(bad);
    await page.waitForTimeout(600);
    ok(await page.locator('.toast', { hasText: 'not an Emberwing Knights save' }).count() > 0 && await page.locator('.slot-modal').count() === 1, 'invalid file rejected, picker stays open');
    await page.evaluate(() => { window.__old = window.__game.battle; });
    const [fc2] = await Promise.all([page.waitForEvent('filechooser'), press(page.locator('.slot-modal [data-import]'))]);
    await fc2.setFiles(file);
    await waitNewBattle('__old');
    ok(same((await snap()).units, afterMove.units), 'importing the exported file restores the board');
  }

  // ---------------------------------------------------------------- defeat -> retry from turn start
  await page.evaluate(() => window.__game.battle.lose());
  await page.locator('.end-screen.defeat button[data-v="turn"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(300);
  await shot('5-gameover');
  ok(await page.locator('.end-screen.defeat button').count() === 4, 'Game Over offers Retry from Turn / Retry Chapter / Load / Title');
  await page.evaluate(() => { window.__old = window.__game.battle; });
  await press(page.locator('.end-screen.defeat button[data-v="turn"]'));
  await waitNewBattle('__old');
  const retried = await snap();
  ok(same(retried.units, turnStart.units) && retried.turn === 1, 'Retry from Turn restores the true start of the turn (even after loading mid-turn)');

  // ---------------------------------------------------------------- return to title, manage slots
  await openMenu();
  await sys('title');
  await page.locator('.confirm-back').waitFor();
  await press(page.locator('.confirm-back button[data-v="1"]'));
  await toTitle();
  ok(await page.locator('.tm[data-id="continue"]:not(.disabled)').count() === 1, 'back at title with Continue available');
  await titlePick('load');
  await page.locator('.slot-modal').waitFor(); await page.waitForTimeout(400);
  ok(await page.locator('.slot-modal .slot').count() === 4 && await page.locator('.slot-modal .slot.empty').count() === 2, 'Load Game lists Autosave + 3 slots (2 empty)');
  await shot('6-load-picker');
  await press(page.locator('.slot[data-slot="1"] [data-del]'));
  await press(page.locator('.confirm-back button[data-v="1"]'));
  await page.waitForTimeout(300);
  ok(!(await slot(1)) && await page.locator('.slot[data-slot="1"].empty').count() === 1, 'delete clears Slot 1');
  await press(page.locator('.slot-modal [data-close]'));
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- camp: autosave + slot save, Continue to camp
  await page.goto(`${base}/?campOnly=2&skip=1&anim=map&speed=3`, { waitUntil: 'load' });
  await page.locator('.camp').waitFor({ timeout: 60000 });
  auto = await slot('auto');
  ok(auto && auto.location === 'camp' && auto.summary.chapterNum === 'Chapter II', 'camp autosaves on arrival');
  await press(page.locator('.camp [data-tab="save"]'));
  await page.waitForTimeout(300);
  await shot('7-camp-save');
  await press(page.locator('.camp-save [data-s="save"]'));
  await page.locator('.slot-modal').waitFor(); await page.waitForTimeout(400);
  await press(page.locator('.slot[data-slot="2"]'));
  await page.waitForTimeout(400);
  ok((await slot(2))?.location === 'camp', 'camp save to Slot 2');
  await press(page.locator('.slot-modal [data-close]'));
  await page.goto(`${base}/?skip=1&anim=map&speed=3`, { waitUntil: 'load' });
  await toTitle();
  ok(/Camp/i.test(await page.locator('.tm[data-id="continue"]').innerText()), 'Continue points at the newest save (camp)');
  await titlePick('continue');
  ok(await page.locator('.camp').waitFor({ timeout: 60000 }).then(() => true, () => false), 'Continue from a camp save opens the camp');
  await press(page.locator('.camp [data-go]'));
  ok(await until(idle, 120000, 'chapter 2'), 'March On starts Chapter II');
  auto = await slot('auto');
  ok(auto?.location === 'battle' && auto.summary.chapterNum === 'Chapter II', 'Chapter II autosaves in battle');

  // ---------------------------------------------------------------- resume after enemy turns (AI plays)
  await page.goto(`${base}/?chapter=1&auto=1&skip=1&anim=map&speed=6`, { waitUntil: 'load' });
  await until(() => { const s = JSON.parse(localStorage.getItem('emberwing.slot.auto') || 'null'); return s && s.location === 'battle' && s.summary.turn >= 3; }, 240000, 'turn 3 autosave');
  await page.goto(`${base}/?skip=1&anim=map&speed=3`, { waitUntil: 'load' });
  await toTitle();
  const t3 = await slot('auto');
  const want = t3.battle.units.map((u) => [u.id, u.side, u.x, u.y, u.hp, u.mp, u.level, u.exp, u.acted ? 1 : 0, u.alive !== false ? 1 : 0].join('|')).sort();
  await titlePick('continue');
  ok(await until(idle, 120000, 'resume turn 3'), `resume an AI-played battle at turn ${t3.summary.turn}`);
  const got = await snap();
  ok(same(got.units, want) && got.turn === t3.battle.turn, 'board after enemy phases matches the save (incl. damage and deaths)');
  ok(got.gold === t3.campaign.gold, 'gold matches the save');
  await shot('8-resumed');
} catch (e) {
  failures++;
  console.log('SAVE TEST ERROR', e.message);
  await shot('error').catch(() => {});
}
fs.rmSync(tmp, { recursive: true, force: true });
const errs = logs.filter((l) => !/X3595|X4000|uninitialized|vite|GPU stall|WebGL/.test(l));
console.log(errs.slice(-30).join('\n') || 'no console errors');
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL SAVE TESTS PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
