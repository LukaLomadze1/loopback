import { describe, expect, it } from 'vitest';
import { GRACE_TICKS, HEIGHT, HIT_REWIND_SPAN, HIT_REWIND_TICKS, LOOP_TICKS, REWIND_TICKS, START_INTEGRITY, WIDTH, quotaFor } from './constants.ts';
import { createGame, rewoundCopy, stateHash, step, type Game } from './game.ts';
import { DASH_BIT, HEADINGS, HEADING_X, HEADING_Y, headingToward, packInput } from './input.ts';

const EAST = packInput(0, false);

/** A repeatable stream of inputs that changes direction now and then, like a very unfocused person. */
function wander(seed: number): (tick: number) => number {
  let state = seed;
  let current = 1;
  return (tick) => {
    if (tick % 23 === 0) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      current = (state >>> 8) % (HEADINGS + 1);
    }
    return current;
  };
}

function runTicks(g: Game, ticks: number, input: (tick: number) => number): void {
  for (let i = 0; i < ticks && g.phase !== 'over'; i++) step(g, input(g.tick));
}

/** Steps with no input until the current loop has finished and the next has begun. */
function finishLoop(g: Game): void {
  const loop = g.loop;
  while (g.loop === loop && g.phase !== 'over') step(g, 0);
}

/** Puts an echo on a path that runs straight through a spot at a given tick, for testing collisions. */
function addEchoThrough(g: Game, x: number, y: number): void {
  const xs = new Float32Array(LOOP_TICKS + 1).fill(x);
  const ys = new Float32Array(LOOP_TICKS + 1).fill(y);
  g.echoes.push({ loop: g.echoes.length + 1, xs, ys, pickups: [], alive: true, erasedAt: null });
  g.aliveAtStart.push(true);
}

describe('the heading table', () => {
  it('has unit vectors that point the right way', () => {
    for (let i = 0; i < HEADINGS; i++) {
      const angle = (i / HEADINGS) * Math.PI * 2;
      expect(HEADING_X[i]).toBeCloseTo(Math.cos(angle), 12);
      expect(HEADING_Y[i]).toBeCloseTo(Math.sin(angle), 12);
    }
  });

  it('is exact on the axes, so walking straight never drifts', () => {
    expect([HEADING_X[0], HEADING_Y[0]]).toEqual([1, 0]);
    expect([HEADING_X[8], HEADING_Y[8]]).toEqual([0, 1]);
    expect(HEADING_X[16]).toBe(-1);
    expect(HEADING_Y[24]).toBe(-1);
  });

  it('turns a direction into the nearest heading', () => {
    expect(headingToward(1, 0)).toBe(0);
    expect(headingToward(0, 1)).toBe(8);
    expect(headingToward(-1, 0)).toBe(16);
    expect(headingToward(0, -1)).toBe(24);
    expect(headingToward(1, 1)).toBe(4);
  });
});

describe('determinism', () => {
  it('gives the same run for the same seed and inputs, on every tick', () => {
    const a = createGame(7);
    const b = createGame(7);
    const input = wander(99);
    for (let i = 0; i < 4000; i++) {
      const value = input(i);
      step(a, value);
      step(b, value);
      expect(stateHash(a)).toBe(stateHash(b));
    }
  });

  it('gives a different run for a different seed', () => {
    expect(stateHash(createGame(1))).not.toBe(stateHash(createGame(2)));
  });
});

describe('the loop', () => {
  it('lasts exactly one 8 second cycle, rewind included', () => {
    const g = createGame(1);
    for (let i = 0; i < LOOP_TICKS; i++) step(g, 0);
    expect(g.phase).toBe('loopRewind');
    expect(g.loop).toBe(1);
    for (let i = 0; i < REWIND_TICKS; i++) step(g, 0);
    expect(g.phase).toBe('play');
    expect(g.loop).toBe(2);
    expect(g.t).toBe(0);
    expect(g.tick).toBe(480);
  });

  it('turns the finished loop into an echo that replays it exactly', () => {
    const g = createGame(5);
    const input = wander(3);
    const route: Array<[number, number]> = [[g.x, g.y]];
    for (let i = 0; i < LOOP_TICKS; i++) {
      step(g, input(i));
      route.push([g.x, g.y]);
    }
    expect(g.echoes).toHaveLength(1);
    const echo = g.echoes[0];
    for (let t = 0; t <= LOOP_TICKS; t++) {
      expect(echo.xs[t]).toBeCloseTo(route[t][0], 3);
      expect(echo.ys[t]).toBeCloseTo(route[t][1], 3);
    }
  });

  it('keeps the player where they stood when the loop turns over', () => {
    const g = createGame(5);
    for (let i = 0; i < LOOP_TICKS; i++) step(g, EAST);
    const { x, y } = g;
    finishLoop(g);
    expect([g.x, g.y]).toEqual([x, y]);
  });

  it('never lets the player leave the arena', () => {
    const g = createGame(11);
    for (const heading of [0, 8, 16, 24]) {
      for (let i = 0; i < 400; i++) step(g, packInput(heading, false));
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x).toBeLessThanOrEqual(WIDTH);
      expect(g.y).toBeGreaterThanOrEqual(0);
      expect(g.y).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it('asks for more shards as a run goes on', () => {
    expect(quotaFor(1)).toBeLessThan(quotaFor(5));
    expect(quotaFor(5)).toBeLessThan(quotaFor(10));
    expect(quotaFor(10)).toBeLessThan(quotaFor(30));
  });

  it('takes a life for a missed quota, and ends the run when they run out', () => {
    const g = createGame(1);
    for (let n = 0; n < START_INTEGRITY; n++) {
      finishLoop(g);
      // Standing still means standing in your own echo, so clear it to test the quota on its own.
      g.echoes.length = 0;
      g.aliveAtStart.length = 0;
    }
    expect(g.missed).toBe(START_INTEGRITY);
    expect(g.phase).toBe('over');
    expect(g.cause).toBe('quota');
  });
});

describe('echoes', () => {
  it('are harmless during the grace period, then lethal', () => {
    const g = createGame(1);
    addEchoThrough(g, g.x, g.y);
    for (let i = 0; i < GRACE_TICKS - 1; i++) step(g, 0);
    expect(g.hits).toBe(0);
    step(g, 0);
    expect(g.hits).toBe(1);
  });

  it('charge the dash meter when brushed past', () => {
    const g = createGame(1);
    addEchoThrough(g, g.x + 30, g.y);
    runTicks(g, GRACE_TICKS + 20, () => 0);
    expect(g.hits).toBe(0);
    expect(g.grazeTicks).toBeGreaterThan(0);
    expect(g.meter).toBeGreaterThan(0);
  });

  it('are erased by dashing through them, along with their notes', () => {
    const g = createGame(1);
    addEchoThrough(g, g.x + 80, g.y);
    runTicks(g, GRACE_TICKS, () => 0);
    const charges = g.charges;
    step(g, packInput(0, true));
    expect(g.charges).toBe(charges - 1);
    runTicks(g, 12, () => packInput(0, true));
    expect(g.echoes[0].alive).toBe(false);
    expect(g.kills).toBe(1);
    expect(g.hits).toBe(0);
  });

  it('only dash once per press, however long the button is held', () => {
    const g = createGame(1);
    g.charges = 3;
    runTicks(g, 60, () => packInput(0, true));
    expect(g.dashes).toBe(1);
  });
});

describe('being hit', () => {
  /** Plays to a tick, then walks an echo into the player, and returns the state from before the rewind. */
  function hitAt(tick: number): { g: Game; before: Game; rewoundTo: number } {
    const g = createGame(21);
    const input = wander(8);
    for (let i = 0; i < tick; i++) step(g, input(i));
    const rewoundTo = Math.max(0, g.t + 1 - HIT_REWIND_SPAN);
    const before = rewoundCopy(g, rewoundTo);
    addEchoThrough(g, g.x, g.y);
    step(g, 0);
    return { g, before, rewoundTo };
  }

  it('rewinds two seconds, costs a life, and restores the world exactly', () => {
    const { g, before, rewoundTo } = hitAt(300);
    expect(g.phase).toBe('hitRewind');
    expect(g.integrity).toBe(START_INTEGRITY - 1);
    for (let i = 0; i < HIT_REWIND_TICKS; i++) step(g, 0);

    expect(g.phase).toBe('play');
    expect(g.t).toBe(rewoundTo);
    for (const key of ['x', 'y', 'rng', 'score', 'meter', 'charges', 'shardX', 'shardY', 'collected', 'totalShards'] as const) {
      expect(g[key], key).toBe(before[key]);
    }
    expect(g.xs[g.t]).toBe(before.xs[g.t]);
  });

  it('never goes back further than the start of the loop', () => {
    const { g } = hitAt(GRACE_TICKS + 5);
    expect(g.rewindTo).toBe(0);
  });

  it('gives back an echo that was erased during the part that got rewound', () => {
    const g = createGame(1);
    addEchoThrough(g, g.x + 80, g.y);
    runTicks(g, GRACE_TICKS, () => 0);
    runTicks(g, 12, () => packInput(0, true));
    expect(g.echoes[0].alive).toBe(false);

    // Well inside the two seconds that the coming hit will take back.
    addEchoThrough(g, g.x, g.y);
    runTicks(g, 40, () => 0);
    expect(g.phase).toBe('hitRewind');
    runTicks(g, HIT_REWIND_TICKS, () => 0);
    expect(g.echoes[0].alive).toBe(true);
    expect(g.kills).toBe(0);
  });

  it('ends the run when the last life is gone', () => {
    const g = createGame(1);
    g.integrity = 1;
    addEchoThrough(g, g.x, g.y);
    runTicks(g, GRACE_TICKS + 1, () => 0);
    expect(g.phase).toBe('over');
    expect(g.cause).toBe('hit');
    expect(g.killedBy).toBe(g.echoes[0]);
  });

  it('survives repeated hits inside one loop without ever producing a phantom one', () => {
    const g = createGame(4);
    const input = wander(5);
    runTicks(g, 200, input);
    const hits: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      addEchoThrough(g, g.x, g.y);
      const hitsBefore = g.hits;
      runTicks(g, 5, () => 0);
      expect(g.hits).toBe(hitsBefore + 1);
      runTicks(g, HIT_REWIND_TICKS, () => 0);
      g.echoes.pop();
      g.aliveAtStart.pop();
      runTicks(g, 80, input);
      hits.push(g.hits);
    }
    expect(hits).toEqual([1, 2]);
    expect(g.phase).toBe('play');
  });

  it('keeps a replay exact across a rewind', () => {
    const play = (): Game => {
      const g = createGame(9);
      const input = wander(2);
      runTicks(g, 2000, input);
      return g;
    };
    const first = play();
    expect(first.hits + first.missed).toBeGreaterThan(0);
    expect(stateHash(play())).toBe(stateHash(first));
  });
});

describe('input bytes', () => {
  it('pack a heading and the dash button', () => {
    expect(packInput(null, false)).toBe(0);
    expect(packInput(0, false)).toBe(1);
    expect(packInput(31, false)).toBe(32);
    expect(packInput(3, true)).toBe(4 | DASH_BIT);
  });
});
