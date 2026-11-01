/**
 * After a run ends, this asks the solver one question: from a moment earlier, was there a way to live?
 * It only uses what the player could see at the time, and the answer is drawn over the final print.
 */
import { HIT_DIST, LOOP_TICKS, START_INTEGRITY } from '../sim/constants.ts';
import { rewoundCopy, step, type Game } from '../sim/game.ts';
import { PLAN_STEP, planPath, type Plan } from './planner.ts';

export const WAY_OUT_TICKS = 90;
const SEARCH_LIMIT = 30_000;

export interface WayOut {
  inputs: number[];
  xs: number[];
  ys: number[];
  /** The tick of the loop the alternative starts from, which is where the two timelines fork. */
  fromT: number;
  reachesShard: boolean;
  /** The answer was to not move at all. */
  standsStill: boolean;
}

export function findWayOut(g: Game): WayOut | null {
  if (g.cause !== 'hit') return null;

  const fromT = Math.max(0, g.t - WAY_OUT_TICKS);
  const before = rewoundCopy(g, fromT);

  // A dash that was already underway at that moment can't be called off, so the search starts after it.
  const lead: number[] = [];
  while (before.dashLeft > 0) {
    step(before, 0);
    lead.push(0);
  }

  const build = (plan: Plan, reachesShard: boolean): WayOut => ({
    inputs: [...lead, ...plan.inputs],
    xs: [g.xs[fromT], ...plan.xs],
    ys: [g.ys[fromT], ...plan.ys],
    fromT,
    reachesShard,
    standsStill: !reachesShard && lead.length === 0 && plan.inputs.every((input) => input === 0),
  });

  const margin = HIT_DIST + 1;
  const toShard = planPath(before, { margin, maxExpansions: SEARCH_LIMIT, seekShard: true });
  if (toShard?.reachedShard) return build(toShard, true);

  const toEnd = planPath(before, { margin, maxExpansions: SEARCH_LIMIT, seekShard: false });
  if (!toEnd || toEnd.endT + PLAN_STEP <= LOOP_TICKS) return null;
  return build(toEnd, false);
}

/** Takes the fork for real: back to that moment, then the solver's inputs through the actual simulation. */
export function wayOutHolds(g: Game, way: WayOut): boolean {
  const fork = rewoundCopy(g, way.fromT);
  const shards = fork.totalShards;
  fork.integrity = START_INTEGRITY;
  fork.hits = 0;
  for (const input of way.inputs) step(fork, input);
  return fork.hits === 0 && (!way.reachesShard || fork.totalShards > shards);
}
