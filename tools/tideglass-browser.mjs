// Run against a production preview or the public Pages URL, with a fresh anonymous browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const url = new URL(process.argv[2] || 'http://127.0.0.1:5189/tideglass/');
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const board = '#board';
const errors = [];
const listen = page => page.on('pageerror', err => errors.push(err.message));
const click = (page, id) => page.locator('#' + id).click({ timeout: 7000 });

async function route(page, resume = false) {
  await page.locator('#cell-B4').focus();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  assert.match(await page.locator('#stats-iria').innerText(), /^B2 .*1 AP$/);
  await click(page, 'cell-A2'); await click(page, 'unit-drake'); await click(page, 'cell-D1');
  await click(page, 'ward'); await click(page, 'end');
  await click(page, 'inspect-crest');
  if (resume) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#marks')?.textContent === '1 / 3');
  }
  await click(page, 'unit-drake'); await click(page, 'inspect-rose'); await click(page, 'cell-G1'); await click(page, 'end');
  await click(page, 'unit-drake'); await click(page, 'inspect-waylight'); await click(page, 'unit-iria'); await click(page, 'signal');
  assert.equal(await page.locator(board).getAttribute('data-phase'), 'won');
  assert.equal(await page.locator('#result-title').innerText(), 'Tide Almanac recovered');
  assert.equal(await page.locator('#marks').innerText(), '3 / 3');
  assert.equal(await page.locator('#round').innerText(), '3 / 8');
  console.log('Victory through rendered controls: all three marks, round three.');
}

try {
  if (url.protocol === 'file:') {
    const ctx = await browser.newContext({ offline: true });
    const page = await ctx.newPage(); listen(page);
    await page.goto(url.href); await route(page, true);
    assert.ok(new URL(page.url()).hash.includes('journal='));
    await ctx.close();
  } else {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    assert.deepEqual(await ctx.cookies(), []);
    const page = await ctx.newPage(); listen(page);
    const models = new Set();
    page.on('response', r => { if (r.ok() && r.url().endsWith('.glb')) models.add(new URL(r.url()).pathname.split('/').pop()); });
    assert.equal((await page.goto(url.href, { waitUntil: 'domcontentloaded' })).status(), 200);
    await page.waitForFunction(() => document.querySelector('#visual-status')?.textContent.startsWith('Live 3D'), { }, { timeout: 90000 });
    assert.equal(await page.locator('#stage canvas').count(), 1);
    assert.deepEqual([...models].sort(), ['IriaVale.glb','SignalCourt.glb','TideLock.glb','VesperglassDrake.glb']);
    if (process.env.TIDEGLASS_SCREENSHOT) await page.screenshot({ path: process.env.TIDEGLASS_SCREENSHOT });
    const surface = page.locator('#stage canvas'), bounds = await surface.boundingBox();
    await surface.click({ position: { x: bounds.width * .5, y: bounds.height * .55 } });
    assert.notEqual(await page.locator('#feedback').innerText(), 'Select Iria or her drake to give an order.');
    await click(page, 'restart'); await click(page, 'reset');
    await route(page);
    console.log('Live 3D: four same-origin Blender models, no sign-in.');
    const campaign = new URL('../', url);
    assert.equal((await page.goto(campaign.href, { waitUntil: 'domcontentloaded' })).status(), 200);
    await page.locator('.press-start').click({ timeout: 90000, force: true });
    const link = page.locator('a[data-id="tideglass"]');
    await link.waitFor({ timeout: 15000 });
    assert.equal(new URL(await link.getAttribute('href'), page.url()).pathname, url.pathname);
    await ctx.close();

    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    const phone = await mobile.newPage(); listen(phone);
    const map = new URL(url); map.searchParams.set('view', 'map');
    await phone.goto(map.href);
    assert.equal(await phone.locator('#stage canvas').count(), 0);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await route(phone, true);
    await click(phone, 'replay'); await click(phone, 'restart'); await click(phone, 'keep');
    for (let i = 0; i < 8 && await phone.locator(board).getAttribute('data-phase') === 'playing'; i++) await click(phone, 'end');
    assert.equal(await phone.locator(board).getAttribute('data-phase'), 'lost');
    await mobile.close();

    const noGPU = await browser.newContext();
    await noGPU.addInitScript(() => {
      const native = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return /webgl/i.test(type) ? null : native.call(this, type, ...args);
      };
    });
    const fallback = await noGPU.newPage(); listen(fallback); await fallback.goto(url.href);
    await fallback.waitForFunction(() => document.querySelector('#visual-status')?.textContent.includes('3D unavailable'));
    await click(fallback, 'cell-B2'); assert.match(await fallback.locator('#stats-iria').innerText(), /^B2/);
    await noGPU.close();
    console.log('Mobile, autosave resume, loss/replay, no-WebGL fallback and campaign link passed.');
  }
  assert.deepEqual(errors, [], 'Uncaught browser errors.');
} finally {
  await browser.close();
}
