import { describe, expect, it } from 'vitest';
import { GRACE_TICKS, HIT_DIST, LOOP_TICKS } from '../sim/constants.ts';
import { createGame, rewoundCopy, step, type Game } from '../sim/game.ts';
import { packInput } from '../sim/input.ts';
import { PlannerBot, ReflexBot } from './pilots.ts';
import { planPath } from './planner.ts';
import { findWayOut, wayOutHolds } from './wayout.ts';

function addStillEcho(g: Game, x: number, y: number): void {
  const xs = new Float32Array(LOOP_TICKS + 1).fill(x);
  const ys = new Float32Array(LOOP_TICKS + 1).fill(y);
  g.echoes.push({ loop: g.echoes.length + 1, xs, ys, pickups: [], alive: true, erasedAt: null });
  g.aliveAtStart = g.echoes.map((echo) => echo.alive);
}

/** Puts an echo on a straight line across the arena, moving as fast as a player. */
function addMovingEcho(g: Game, fromX: number, fromY: number, dx: number, dy: number): void {
  const xs = new Float32Array(LOOP_TICKS + 1);
  const ys = new Float32Array(LOOP_TICKS + 1);
  for (let t = 0; t <= LOOP_TICKS; t++) {
    xs[t] = fromX + dx * t;
    ys[t] = fromY + dy * t;
  }
  g.echoes.push({ loop: g.echoes.length + 1, xs, ys, pickups: [], alive: true, erasedAt: null });
  g.aliveAtStart = g.echoes.map((echo) => echo.alive);
}

describe('the planner', () => {
  it('reaches the shard on an empty board, in about the straight-line time', () => {
    const g = createGame(3);
    const plan = planPath(g, { margin: 30, maxExpansions: 5000, seekShard: true });
    expect(plan?.reachedShard).toBe(true);
    const direct = Math.hypot(g.x - g.shardX, g.y - g.shardY) / 4.6;
    expect(plan!.inputs.length).toBeLessThan(direct * 1.3 + 12);
  });

  it('produces a path the real simulation agrees with', () => {
    const g = createGame(8);
    const start = g.totalShards;
    const plan = planPath(g, { margin: 30, maxExpansions: 5000, seekShard: true });
    for (const input of plan!.inputs) step(g, input);
    expect(g.totalShards).toBe(start + 1);
    expect(g.hits).toBe(0);
  });

  it('routes around a wall of echoes instead of through it', () => {
    const g = createGame(3);
    g.shardX = 860;
    g.shardY = 300;
    for (let y = 150; y <= 450; y += 30) addStillEcho(g, 640, y);
    const plan = planPath(g, { margin: 30, maxExpansions: 20_000, seekShard: true });
    expect(plan?.reachedShard).toBe(true);

    for (const input of plan!.inputs) step(g, input);
    expect(g.hits).toBe(0);
    expect(g.totalShards).toBe(1);
  });

  it('dodges moving echoes, using where they are going to be', () => {
    const g = createGame(3);
    g.shardX = 860;
    g.shardY = 300;
    addMovingEcho(g, 860, 100, -3, 1);
    addMovingEcho(g, 100, 500, 3.5, -0.8);
    addMovingEcho(g, 860, 500, -2, -1);
    const plan = planPath(g, { margin: HIT_DIST + 4, maxExpansions: 20_000, seekShard: true });
    expect(plan?.reachedShard).toBe(true);
    for (const input of plan!.inputs) step(g, input);
    expect(g.hits).toBe(0);
  });

  it('does not let a fast echo slip across the path between two checks', () => {
    const g = createGame(3);
    g.shardX = g.x + 400;
    g.shardY = g.y;
    g.t = GRACE_TICKS;
    // Faster than any player, crossing the straight line to the shard at right angles.
    for (const offset of [60, 120, 180, 240, 300]) addMovingEcho(g, g.x + offset, g.y - 280 + offset, 0, 14);
    const plan = planPath(g, { margin: HIT_DIST + 1, maxExpansions: 20_000, seekShard: true });
    expect(plan?.reachedShard).toBe(true);
    for (const input of plan!.inputs) step(g, input);
    expect(g.hits).toBe(0);
  });

  it('says so when there is nowhere to go', () => {
    const g = createGame(3);
    g.t = GRACE_TICKS;
    for (const [dx, dy] of [[30, 0], [-30, 0], [0, 30], [0, -30], [24, 24], [-24, 24], [24, -24], [-24, -24]]) {
      addStillEcho(g, g.x + dx, g.y + dy);
    }
    expect(planPath(g, { margin: 40, maxExpansions: 5000, seekShard: true })).toBeNull();
  });
});

describe('the pilots', () => {
  it('stay inside a tick budget that a 60 fps frame can afford', () => {
    const g = createGame(14);
    const bot = new PlannerBot();
    let worst = 0;
    while (g.phase !== 'over' && g.loop <= 25) {
      const started = performance.now();
      const input = bot.next(g);
      worst = Math.max(worst, performance.now() - started);
      step(g, input);
    }
    expect(worst).toBeLessThan(40);
  });

  it('are ordered as expected: seeing the future beats guessing at it', () => {
    const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const play = (make: () => PlannerBot | ReflexBot, seed: number): number => {
      const g = createGame(seed);
      const bot = make();
      while (g.phase !== 'over' && g.loop <= 30) step(g, bot.next(g));
      return g.loop;
    };
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    const planner = median(seeds.map((seed) => play(() => new PlannerBot(), seed)));
    const reflex = median(seeds.map((seed) => play(() => new ReflexBot(), seed)));
    expect(planner).toBeGreaterThan(reflex * 2);
    expect(reflex).toBeGreaterThanOrEqual(3);
  });
});

describe('the way out', () => {
  it('finds routes that really do survive when the simulation plays them', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const g = createGame(seed);
      const bot = new ReflexBot();
      while (g.phase !== 'over') step(g, bot.next(g));
      if (g.cause !== 'hit') continue;

      const way = findWayOut(g);
      if (!way) continue;
      expect(way.fromT).toBe(Math.max(0, g.t - 90));
      expect(wayOutHolds(g, way), `seed ${seed}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('allows for a dash that was already underway when the timelines forked', () => {
    const g = createGame(3);
    g.integrity = 1;
    const xs = new Float32Array(LOOP_TICKS + 1).fill(30);
    const ys = new Float32Array(LOOP_TICKS + 1).fill(30);
    g.echoes.push({ loop: 1, xs, ys, pickups: [], alive: true, erasedAt: null });
    g.aliveAtStart.push(true);

    // Dash at tick 50, then have the echo land on the player exactly 90 ticks after that dash began.
    while (g.t < 50) step(g, 0);
    step(g, packInput(0, true));
    while (g.t < 146) step(g, 0);
    xs.fill(g.x, 147);
    ys.fill(g.y, 147);
    step(g, 0);
    expect(g.cause).toBe('hit');
    expect(rewoundCopy(g, g.t - 90).dashLeft).toBeGreaterThan(0);

    const way = findWayOut(g);
    expect(way).not.toBeNull();
    expect(way!.inputs[0]).toBe(0);
    expect(wayOutHolds(g, way!)).toBe(true);
  });

  it('has nothing to say about a run that ended on a missed quota', () => {
    const g = createGame(1);
    g.integrity = 1;
    while (g.phase !== 'over') step(g, 0);
    expect(g.cause).toBe('quota');
    expect(findWayOut(g)).toBeNull();
  });
});
