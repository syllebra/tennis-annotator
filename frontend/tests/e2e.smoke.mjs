/**
 * End-to-end smoke test, **mouse only** (no keyboard shortcut required).
 * Expects a clean test video: delete `<video>.annotations.json` before running.
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
const click = (selector) => page.click(selector);
const text = async (selector) => (await page.textContent(selector)) ?? '';

await page.goto(base, { waitUntil: 'networkidle' });
step('library loaded');
await page.waitForSelector('.video-list li', { timeout: 10000 });
await page.click('.video-list li');
await page.waitForSelector('.stage-canvas', { timeout: 15000 });
await page.waitForTimeout(1000);
step('video opened');

const canvas = page.locator('.stage-canvas');
const box = await canvas.boundingBox();
const clickStage = async (x, y) => {
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await page.waitForTimeout(160);
};

// --- sequence, mouse only --------------------------------------------------
await click('.timeline button:has-text("IN")');
for (let i = 0; i < 2; i++) await click('.transport button:has-text("+10")');
await click('.timeline button:has-text("OUT")');
await click('.timeline button:has-text("Créer la séquence")');
await page.waitForTimeout(400);
const sequenceLabel = await page.inputValue('.side .panel input.field');
if (sequenceLabel !== 'Séquence 1') throw new Error(`séquence non créée (label="${sequenceLabel}")`);
step('sequence created with buttons');

// --- court, labelled wizard ------------------------------------------------
await click('.side button:has-text("Poser le court")');
const wizardHead = await text('.wizard-head');
if (!/Coin double|Coin simple|Centre du filet|Ligne service/.test(wizardHead)) {
  throw new Error(`wizard label missing: ${wizardHead}`);
}
const corners = [
  [0.2, 0.85],
  [0.8, 0.85],
  [0.62, 0.35],
  [0.38, 0.35],
];
for (let i = 0; i < corners.length; i++) {
  await clickStage(corners[i][0], corners[i][1]);
  if (i < corners.length - 1 && !(await text('.wizard-head')).includes(String(i + 2))) {
    throw new Error(`wizard did not advance to step ${i + 2}`);
  }
}
await page.waitForTimeout(400);
if (!(await text('.side')).includes('statique')) throw new Error('court keyframe not created');
step('court placed with labelled wizard');

// --- échange with two segments --------------------------------------------
await click('.side button:has-text("nouvel échange")');
await page.waitForTimeout(300);
await click('.side button:has-text("+ ancre")');
if (!(await text('.stage-hint')).includes('ancre')) throw new Error('armed hint missing');
// placement gesture: press shows the in-place magnifier, drag refines, release drops
const startX = box.x + box.width * 0.45;
const startY = box.y + box.height * 0.75;
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.waitForTimeout(350);
if (!(await page.locator('.glass').count())) throw new Error('in-place magnifier missing');
await page.mouse.move(startX + 45, startY + 12, { steps: 6 });
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(250);
if (await page.locator('.glass').count()) throw new Error('magnifier did not close on release');
await click('.side button:has-text("Bord")');
for (let i = 0; i < 10; i++) await click('.transport button:has-text("+1")');
await click('.side button:has-text("+ ancre")');
await clickStage(0.6, 0.45);
await click('.side button:has-text("Sol")');
for (let i = 0; i < 3; i++) await click('.transport button:has-text("−1")');
await click('.side button:has-text("+ point de passage")');
await clickStage(0.52, 0.6);
await page.waitForTimeout(400);

const panel = await text('.side');
if (!panel.includes('2 impact(s)')) throw new Error('expected 2 impacts');
if (!panel.includes('1 segment(s)')) throw new Error('expected 1 segment');
if (!panel.includes('#10')) throw new Error('impact chip missing');
step('échange annotated with buttons');

// --- zoom controls ---------------------------------------------------------
const zoomBefore = await text('.zoom-value');
await page.click('.zoom-group button:has-text("+")');
await page.waitForTimeout(200);
const zoomAfter = await text('.zoom-value');
if (zoomBefore === zoomAfter) throw new Error('timeline zoom button did nothing');
await page.click('.zoom-group button:has-text("tout")');
step('timeline zoom works');

// --- persistence -----------------------------------------------------------
await page.waitForTimeout(1200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.video-list li');
const status = await text('.video-list li .status');
if (!status.includes('en cours')) throw new Error(`unexpected status: ${status}`);
await page.click('.video-list li');
await page.waitForSelector('.stage-canvas');
await page.waitForTimeout(800);
const after = await text('.side');
if (!after.includes('Échange 1')) throw new Error('trajectory not persisted');
if (!(await page.locator('.impact-chips .impact').count())) throw new Error('impacts not persisted');
step('persistence verified');

await page.screenshot({ path: shot });
writeFileSync('/tmp/opencode/e2e/ui-errors.json', JSON.stringify(errors, null, 2));
console.log(errors.length === 0 ? 'OK   no console errors' : `FAIL ${errors.length} console errors`);
console.log(`screenshot: ${shot}`);
errors.forEach((error) => console.log('   ', error));
await browser.close();
if (errors.length > 0) process.exit(1);
