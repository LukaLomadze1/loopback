/**
 * The claim a shared replay rests on: a run recorded on one machine plays out identically on another.
 * The runs are recorded here in Node, then replayed in each browser engine (V8, SpiderMonkey and
 * JavaScriptCore), and the final state of every one has to match to the last bit.
 */
import { expect, test } from '@playwright/test';
import { PlannerBot, ReflexBot, type Pilot } from '../src/bot/pilots.ts';
import { createGame, stateHash, step } from '../src/sim/game.ts';
import { Recording } from '../src/sim/replay.ts';

const SEEDS = 24;

function record(seed: number, pilot: Pilot): { code: string; hash: number } {
  const g = createGame(seed);
  const recording = new Recording(seed);
  while (g.phase !== 'over' && g.loop <= 30) {
    const input = pilot.next(g);
    recording.push(input);
    step(g, input);
  }
  return { code: recording.encode(), hash: stateHash(g) };
}

const runs = Array.from({ length: SEEDS }, (_, i) =>
  record(i * 1009 + 1, i % 2 === 0 ? new PlannerBot() : new ReflexBot()),
);

declare global {
  interface Window {
    ready: boolean;
    replayHashes: (codes: string[]) => number[];
    renderMusic: (loops: number) => Promise<{ echoes: number; loop: number; peak: number; rms: number; nan: number }>;
  }
}

test('every engine replays a recorded run to exactly the same state as Node', async ({ browser, baseURL }) => {
  // Not the usual page fixture: on Windows, Firefox throws while closing a context, which would fail
  // this test after it had already passed. The browser's own shutdown cleans this page up instead.
  const page = await browser.newPage({ baseURL });
  await page.goto('/e2e/harness.html');
  await page.waitForFunction(() => window.ready);
  const hashes = await page.evaluate((codes) => window.replayHashes(codes), runs.map((run) => run.code));
  expect(hashes).toEqual(runs.map((run) => run.hash));
});
