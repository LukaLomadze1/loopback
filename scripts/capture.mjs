/**
 * Records the screenshots and the hero GIF for the README, from the real game. The page runs on a fake
 * clock, so every frame lands exactly on time however long the screenshot itself takes.
 *
 *     npx vite --port 5198 --strictPort &
 *     npm run capture [-- --gif-only]
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import gifenc from 'gifenc';
import { PNG } from 'pngjs';

const { GIFEncoder, applyPalette, quantize } = gifenc;
const BASE = 'http://localhost:5198/';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

const gameValue = (page, expression) => page.evaluate(`window.loopback.game().${expression}`);

/** Runs a bot at high speed to a given loop, then drops to real time. */
async function fastForward(page, loop) {
  await page.clock.install();
  await page.goto(`${BASE}?bot=planner&speed=8`);
  while ((await gameValue(page, 'loop')) < loop) await page.clock.runFor(1000);
  await page.evaluate(() => window.loopback.setSpeed(1));
}

// ----- Stills --------------------------------------------------------------------------------------

async function stills() {
  const title = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await title.goto(BASE);
  await title.waitForTimeout(13_000);
  await title.screenshot({ path: `${OUT}/title.png` });
  await title.close();

  const play = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await fastForward(play, 18);
  while ((await gameValue(play, 't')) < 220) await play.clock.runFor(100);
  await play.screenshot({ path: `${OUT}/play.png` });
  while (!(await play.evaluate(() => document.getElementById('stage').classList.contains('negative')))) {
    await play.clock.runFor(16);
  }
  await play.clock.runFor(180);
  await play.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await play.waitForTimeout(150);
  await play.screenshot({ path: `${OUT}/rewind.png` });
  await play.close();

  const over = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (let attempt = 0; attempt < 10; attempt++) {
    await over.goto(`${BASE}?bot=reflex&speed=8`);
    await over.getByTestId('over').waitFor({ state: 'visible', timeout: 90_000 });
    const verdict = await over.getByTestId('over-verdict').textContent();
    if (verdict.includes('dotted') && (await gameValue(over, 'loop')) >= 6) break;
  }
  await over.waitForTimeout(1800);
  await over.screenshot({ path: `${OUT}/way-out.png` });
  await over.close();

  const print = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await print.goto(`${BASE}?bot=planner&speed=8`);
  await print.getByTestId('over').waitFor({ state: 'visible', timeout: 300_000 });
  const download = print.waitForEvent('download');
  await print.getByTestId('save-print').click();
  await (await download).saveAs(`${OUT}/print.png`);
  await print.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await phone.goto(`${BASE}?bot=planner`);
  await phone.waitForTimeout(24_000);
  await phone.screenshot({ path: `${OUT}/phone.png` });
  await phone.close();
}

// ----- The GIF -------------------------------------------------------------------------------------

/**
 * Snaps the paper's speckle to one flat colour. At GIF quality the grain barely shows, and random noise
 * is the worst case for GIF compression, so this makes the file several times smaller. The commonest
 * colour stands in for the paper, because during a rewind the paper is dark.
 */
function flattenPaper(data) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4 * 53) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const paper = [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const r = paper >> 16;
  const g = (paper >> 8) & 255;
  const b = paper & 255;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 92) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
}

async function hero() {
  const FRAME_MS = 66;
  const FRAMES = 150;
  const page = await browser.newPage({ viewport: { width: 840, height: 540 } });
  await fastForward(page, 13);

  // Start a few seconds before a rewind, so it arrives early in the GIF.
  while ((await gameValue(page, 'phase')) !== 'play' || (await gameValue(page, 't')) < 240) await page.clock.runFor(100);

  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    await page.clock.runFor(FRAME_MS);
    const frame = PNG.sync.read(await page.screenshot());
    flattenPaper(frame.data);
    frames.push(frame);
  }
  await page.close();

  // One palette for the whole GIF, taken from across it, so both the print and its negative look right.
  const { width, height } = frames[0];
  const sampled = new Uint8Array(frames[0].data.length * 6);
  let filled = 0;
  for (const i of [0, 30, 60, 90, 120, 149]) {
    sampled.set(frames[i].data, filled);
    filled += frames[i].data.length;
  }
  const palette = quantize(sampled, 48);

  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    gif.writeFrame(applyPalette(frame.data, palette), width, height, i === 0 ? { palette, delay: FRAME_MS } : { delay: FRAME_MS });
  });
  gif.finish();
  writeFileSync(`${OUT}/hero.gif`, gif.bytes());
  console.log(`hero.gif: ${(statSync(`${OUT}/hero.gif`).size / 1e6).toFixed(1)} MB, ${width}x${height}, ${FRAMES} frames`);
}

if (!process.argv.includes('--gif-only')) await stills();
await hero();
await browser.close();
