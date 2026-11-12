/**
 * End-to-end smoke test against a running server.
 *
 *   XDG_CONFIG_HOME=... XDG_CACHE_HOME=... uv run python -m cli.main serve --port 8011
 *   node frontend/tests/e2e.smoke.mjs http://127.0.0.1:8011
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8011';
const shot = process.argv[3] ?? '/tmp/opencode/e2e/ui.png';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const step = (name) => console.log(`· ${name}`);

await page.goto(base, { waitUntil: 'networkidle' });
step('library loaded');
await page.waitForSelector('.video-list li', { timeout: 10000 });
await page.click('.video-list li');
await page.waitForSelector('.stage-canvas', { timeout: 15000 });
await page.waitForTimeout(1200);
step('video opened');

const frameLabel = async () => page.textContent('.tl-toolbar .mono');
console.log('   frame:', await frameLabel());

// sequence from frames 0..90
await page.keyboard.press('i');
for (let i = 0; i < 90; i++) await page.keyboard.press('ArrowRight');
await page.keyboard.press('o');
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(400);
const sequenceText = await page.textContent('.side .panel');
if (!sequenceText?.includes('Séquence')) throw new Error('sequence not created');
step('sequence created');

// court: 4 clicks in the canvas
await page.keyboard.press('c');
const box = await page.locator('.stage-canvas').boundingBox();
const corners = [
  [0.18, 0.93],
  [0.82, 0.93],
  [0.63, 0.42],
  [0.37, 0.42],
];
for (const [x, y] of corners) {
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
const hasCourt = await page.locator('.side').innerText();
if (!hasCourt.includes('statique')) throw new Error('court keyframe not created');
step('court placed');

// trajectory with two anchors and one path point
await page.keyboard.press('b');
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8);
await page.keyboard.press('a');
for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.5);
await page.keyboard.press('a');
await page.keyboard.press('3');
for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
await page.keyboard.press('p');
await page.waitForTimeout(400);
step('trajectory annotated');

// reload and verify persistence
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.video-list li');
const status = await page.textContent('.video-list li .status');
if (!status?.includes('en cours')) throw new Error(`unexpected status: ${status}`);
await page.click('.video-list li');
await page.waitForSelector('.stage-canvas');
await page.waitForTimeout(800);
const side = await page.locator('.side').innerText();
if (!side.includes('Trajet 1')) throw new Error('trajectory not persisted');
step('persistence verified');

await page.screenshot({ path: shot });
writeFileSync('/tmp/opencode/e2e/ui-errors.json', JSON.stringify(errors, null, 2));
console.log(errors.length === 0 ? 'OK   no console errors' : `FAIL ${errors.length} console errors`);
console.log(`screenshot: ${shot}`);
errors.forEach((error) => console.log('   ', error));
await browser.close();
if (errors.length > 0) process.exit(1);
