/**
 * Takes screenshots of the real game at the moments worth checking by eye, and reports anything the
 * browser complained about along the way.
 *
 *     npx vite --port 5198 --strictPort &
 *     node scripts/look.mjs [output folder]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5198/';
const OUT = process.argv[2] ?? 'test-results/look';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

function watch(page, label) {
  page.on('pageerror', (error) => problems.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label}: ${message.text()}`);
  });
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(desktop, 'desktop');

await desktop.goto(BASE);
await desktop.waitForTimeout(14_000);
await desktop.screenshot({ path: `${OUT}/title.png` });

// A real run, played by a bot through the whole pipeline.
await desktop.goto(`${BASE}?bot=planner`);
await desktop.waitForTimeout(5_000);
await desktop.screenshot({ path: `${OUT}/loop-1.png` });
await desktop.waitForTimeout(19_000);
await desktop.screenshot({ path: `${OUT}/loop-3.png` });

// Catch the half-second rewind between loops.
await desktop.waitForFunction(() => document.getElementById('stage').classList.contains('negative'), null, { polling: 16, timeout: 12_000 });
await desktop.waitForTimeout(160);
await desktop.screenshot({ path: `${OUT}/rewind.png` });

// Deep into a run, at normal speed, to judge whether a crowded arena can still be read.
await desktop.goto(`${BASE}?bot=planner&speed=8`);
await desktop.waitForFunction(() => window.loopback.game().loop >= 24, null, { timeout: 120_000 });
await desktop.evaluate(() => window.loopback.setSpeed(1));
await desktop.waitForFunction(() => window.loopback.game().t > 200, null, { timeout: 20_000 });
await desktop.screenshot({ path: `${OUT}/deep.png` });

// A real death, with the solver's answer drawn on it. Runs that end on a missed quota have no answer to show.
for (let attempt = 0; attempt < 6; attempt++) {
  await desktop.goto(`${BASE}?bot=reflex&speed=8`);
  await desktop.getByTestId('over').waitFor({ state: 'visible', timeout: 90_000 });
  const cause = await desktop.evaluate(() => window.loopback.game().cause);
  if (cause === 'hit') break;
}
await desktop.waitForTimeout(1_800);
await desktop.screenshot({ path: `${OUT}/over.png` });
console.log('verdict:', await desktop.getByTestId('over-verdict').textContent());

await desktop.goto(`${BASE}?bot=planner&speed=8`);
await desktop.getByTestId('over').waitFor({ state: 'visible', timeout: 200_000 });
const download = desktop.waitForEvent('download');
await desktop.getByTestId('save-print').click();
await (await download).saveAs(`${OUT}/print.png`);

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
watch(phone, 'phone');
await phone.goto(BASE);
await phone.waitForTimeout(5_000);
await phone.screenshot({ path: `${OUT}/phone-title.png` });
await phone.goto(`${BASE}?bot=planner`);
await phone.waitForTimeout(21_000);
await phone.screenshot({ path: `${OUT}/phone-play.png` });

await browser.close();
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'No page errors.');
