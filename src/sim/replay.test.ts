import { describe, expect, it } from 'vitest';
import { PlannerBot, ReflexBot, type Pilot } from '../bot/pilots.ts';
import { createGame, stateHash, step } from './game.ts';
import { Recording, decodeReplay, simulateReplay } from './replay.ts';

function record(seed: number, pilot: Pilot, maxLoops: number): { hash: number; code: string; ticks: number } {
  const g = createGame(seed);
  const recording = new Recording(seed);
  while (g.phase !== 'over' && g.loop <= maxLoops) {
    const input = pilot.next(g);
    recording.push(input);
    step(g, input);
  }
  return { hash: stateHash(g), code: recording.encode(), ticks: g.tick };
}

describe('replays', () => {
  it('survive the trip through a URL and reproduce the run exactly', () => {
    for (const seed of [1, 2, 3, -123456, 2147483647]) {
      const run = record(seed, new ReflexBot(), 20);
      const replay = decodeReplay(run.code);
      expect(replay).not.toBeNull();
      expect(replay?.seed).toBe(seed);
      expect(replay?.inputs.length).toBe(run.ticks);
      expect(stateHash(simulateReplay(replay!))).toBe(run.hash);
    }
  });

  it('are small enough to share, even after a long run', () => {
    const run = record(5, new PlannerBot(), 20);
    expect(run.code.length).toBeLessThan(ticksToCharsLimit(run.ticks));
    expect(run.code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('refuse anything that is not a replay', () => {
    expect(decodeReplay('')).toBeNull();
    expect(decodeReplay('not base64 at all!!')).toBeNull();
    // A valid-looking header from a future format.
    expect(decodeReplay('_wE')).toBeNull();
    // A run with a zero-length stretch of input, and one cut off halfway through a number.
    expect(decodeReplay(btoa('\x01\x05\x01\x00').replace(/=+$/, ''))).toBeNull();
    expect(decodeReplay(btoa('\x01\x05\x01\xff').replace(/=+$/, ''))).toBeNull();
  });

  it('refuse a run claiming an absurd length, rather than allocating it', () => {
    const huge = String.fromCharCode(1, 5, 1, 0xff, 0xff, 0xff, 0xff, 0x7f);
    expect(decodeReplay(btoa(huge).replace(/=+$/, ''))).toBeNull();
  });
});

/** Run-length encoding has to beat one byte per tick by a wide margin, or the links get unwieldy. */
function ticksToCharsLimit(ticks: number): number {
  return ticks / 2;
}
