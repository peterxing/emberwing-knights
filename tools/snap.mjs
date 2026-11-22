// Headless screenshot helper using the system Microsoft Edge (no browser download needed).
// Usage: node tools/snap.mjs <url> [out.png] [waitMs=3000] [width=1280] [height=720]
// Optional env: SNAP_JS="<js to evaluate after load>"  SNAP_JS2="<js evaluated just before the shot>"
import { chromium } from 'playwright-core';

const [, , url, out = '.snaps/snap.png', wait = '3000', w = '1280', h = '720'] = process.argv;
if (!url) { console.error('usage: node tools/snap.mjs <url> [out.png] [waitMs] [w] [h]'); process.exit(1); }

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  if (process.env.SNAP_JS) await page.evaluate(process.env.SNAP_JS);
  await page.waitForTimeout(+wait);
  if (process.env.SNAP_JS2) await page.evaluate(process.env.SNAP_JS2);
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} catch (e) {
  console.log('[snap-error]', e.message);
}
if (logs.length) console.log(logs.slice(-60).join('\n'));
await browser.close();
