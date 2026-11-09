// Takes light/dark, wide/narrow screenshots of a running dashboard (the demo by default) with the
// installed Edge (or Chrome). Usage: npm run screenshots -- [url] [outDir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4318/'; // npm run demo
const outDir = path.resolve(process.argv[3] || 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try { return await chromium.launch({ channel }); } catch { /* try the next */ }
  }
  throw new Error('Needs Microsoft Edge or Google Chrome installed.');
}

const browser = await launch();
const shots = [
  { name: 'wide-light', width: 1600, height: 1000, scheme: 'light' },
  { name: 'wide-dark', width: 1600, height: 1000, scheme: 'dark' },
  { name: 'narrow-light', width: 390, height: 844, scheme: 'light' },
  { name: 'narrow-dark', width: 390, height: 844, scheme: 'dark' },
];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, colorScheme: s.scheme, deviceScaleFactor: s.width < 600 ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('#live.on', { timeout: 15000 });
  await page.waitForSelector('#needs-list > *', { state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('#pr-age')?.textContent.startsWith('Checking'), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(file, errors.length ? `errors: ${errors.join(' | ')}` : '');
  if (s.name === 'wide-light') {
    await page.locator('.scard').nth(1).click();
    await page.waitForTimeout(400);
    const f2 = path.join(outDir, 'wide-light-drawer.png');
    await page.screenshot({ path: f2 });
    console.log(f2);
  }
  await ctx.close();
}
await browser.close();
