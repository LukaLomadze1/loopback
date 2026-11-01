import { expect, test, type Page } from '@playwright/test';
import type { Game } from '../src/sim/game.ts';

declare global {
  interface Window {
    loopback: { game: () => Game; setSpeed: (speed: number) => void };
  }
}

const read = <T>(page: Page, pick: (g: Game) => T): Promise<T> =>
  page.evaluate(`(${pick.toString()})(window.loopback.game())`) as Promise<T>;

/** Fails the test if the page throws or logs an error at any point. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('the title screen plays itself, and Enter starts a run', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('title')).toBeVisible();

  const before = await read(page, (g) => g.tick);
  await page.waitForTimeout(600);
  expect(await read(page, (g) => g.tick)).toBeGreaterThan(before);

  await page.keyboard.press('Enter');
  await expect(page.getByTestId('title')).toBeHidden();
  await expect.poll(() => read(page, (g) => g.loop)).toBe(1);
  expect(await read(page, (g) => g.tick)).toBeLessThan(120);
  expect(errors).toEqual([]);
});

test('the keyboard moves the player and dashes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play').click();
  // That click was a mouse, so take a moment for the keys to take over.
  const startX = await read(page, (g) => g.x);

  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowRight');
  const movedX = await read(page, (g) => g.x);
  expect(movedX).toBeGreaterThan(startX + 40);

  const charges = await read(page, (g) => g.charges);
  await page.keyboard.press('Space');
  await expect.poll(() => read(page, (g) => g.dashes)).toBe(1);
  expect(await read(page, (g) => g.charges)).toBe(charges - 1);
});

test('the mouse steers toward the pointer, and a click dashes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play').click();

  const box = page.viewportSize()!;
  await page.mouse.move(box.width * 0.1, box.height * 0.55);
  await page.mouse.move(box.width * 0.1 + 8, box.height * 0.55);
  const startX = await read(page, (g) => g.x);
  await page.waitForTimeout(400);
  expect(await read(page, (g) => g.x)).toBeLessThan(startX - 40);

  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => read(page, (g) => g.dashes)).toBe(1);
});

test('touch steers with a drag and dashes with a tap', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('play').tap();

  const touch = (type: string, x: number, y: number): Promise<void> =>
    page.evaluate(
      ([eventType, px, py]) => {
        document.getElementById('stage')!.dispatchEvent(
          new PointerEvent(eventType as string, { pointerId: 5, pointerType: 'touch', clientX: px as number, clientY: py as number, bubbles: true }),
        );
      },
      [type, x, y],
    );

  // On a phone the arena is on its side, so dragging down the screen moves along the arena's long axis.
  const startX = await read(page, (g) => g.x);
  await touch('pointerdown', 200, 400);
  await touch('pointermove', 200, 500);
  await page.waitForTimeout(400);
  await touch('pointerup', 200, 500);
  expect(await read(page, (g) => g.x)).toBeGreaterThan(startX + 40);

  await touch('pointerdown', 200, 400);
  await touch('pointerup', 200, 400);
  await expect.poll(() => read(page, (g) => g.dashes)).toBe(1);
  await context.close();
});

test('pausing stops time, and resuming carries on from the same tick', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play').click();
  await page.waitForTimeout(200);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause')).toBeVisible();
  const paused = await read(page, (g) => g.tick);
  await page.waitForTimeout(300);
  expect(await read(page, (g) => g.tick)).toBe(paused);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause')).toBeHidden();
  await expect.poll(() => read(page, (g) => g.tick)).toBeGreaterThan(paused);
});

test('a finished run makes a print and a replay link that reproduces it exactly', async ({ page, context }) => {
  const errors = watchForErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/?bot=reflex&speed=8');
  await expect(page.getByTestId('over')).toBeVisible({ timeout: 80_000 });
  const headline = await page.getByTestId('over-headline').textContent();
  const stats = await page.getByTestId('over-stats').textContent();
  expect(await page.getByTestId('over-verdict').textContent()).not.toBe('');

  const download = page.waitForEvent('download');
  await page.getByTestId('save-print').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^loopback-\d+-loops\.png$/);

  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('toast')).toContainText('Replay copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#r=');

  // A fresh page that has never seen this run works out the same result from the link alone.
  await page.goto('about:blank');
  await page.goto(link);
  const watch = page.getByTestId('watch-shared');
  await expect(watch).toBeVisible();
  const loops = headline!.match(/\d+/)![0];
  await expect(watch).toContainText(`${loops} loops`);

  await watch.click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  await page.getByRole('button', { name: '4x' }).click();
  await page.evaluate(() => window.loopback.setSpeed(16));
  await expect(page.getByTestId('over')).toBeVisible({ timeout: 80_000 });
  expect(await page.getByTestId('over-stats').textContent()).toBe(stats);
  expect(errors).toEqual([]);
});

test('a damaged replay link says so instead of playing nonsense', async ({ page }) => {
  await page.goto('/#r=AAAA');
  await expect(page.getByTestId('title-meta')).toContainText('another version');
});

test('the music of a deep run neither clips nor falls silent', async ({ page }) => {
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => window.ready);
  const result = await page.evaluate(() => window.renderMusic(20));
  expect(result.loop).toBe(20);
  expect(result.nan).toBe(0);
  expect(result.peak).toBeLessThanOrEqual(1);
  expect(result.peak).toBeGreaterThan(0.2);
  expect(result.rms).toBeGreaterThan(0.02);
  expect(result.rms).toBeLessThan(0.4);
  console.log(`Audio with ${result.echoes} echoes: peak ${result.peak.toFixed(3)}, RMS ${result.rms.toFixed(3)}`);
});
