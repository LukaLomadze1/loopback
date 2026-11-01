/**
 * Two players that aren't people, both limited to the same input byte a person sends. PlannerBot knows
 * every echo's whole future and is the upper bound on what is survivable. ReflexBot is a stand-in for a
 * human: it reacts late, and it can only guess where an echo is going from where it was just heading.
 */
import { DASH_TICKS, DASH_SPEED, GRACE_TICKS, HEIGHT, HIT_DIST, KILL_DIST, LOOP_TICKS, PLAYER_RADIUS, PLAYER_SPEED, WIDTH } from '../sim/constants.ts';
import type { Game } from '../sim/game.ts';
import { DASH_BIT, HEADINGS, HEADING_X, HEADING_Y, headingToward, packInput } from '../sim/input.ts';
import { PLAN_STEP, planPath } from './planner.ts';

export interface Pilot {
  next(g: Game): number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export class PlannerBot implements Pilot {
  private queue: number[] = [];
  private cursor = 0;
  private expectedT = -1;
  private shardX = -1;
  private shardY = -1;
  private readonly margins: number[];
  private readonly maxExpansions: number;
  /** Dashes it keeps back for emergencies, spending only the ones above this on erasing echoes. */
  private readonly dashReserve: number;

  constructor(options: { margins?: number[]; maxExpansions?: number; dashReserve?: number } = {}) {
    this.margins = options.margins ?? [34, 27, 21];
    this.maxExpansions = options.maxExpansions ?? 3500;
    this.dashReserve = options.dashReserve ?? 1;
  }

  next(g: Game): number {
    if (g.phase !== 'play') {
      this.queue = [];
      return 0;
    }
    if (g.dashLeft > 0) {
      this.queue = [];
      return 0;
    }

    const dash = this.pickDash(g, g.charges > this.dashReserve);
    if (dash !== null) {
      this.queue = [];
      return dash;
    }

    const stale =
      this.cursor >= this.queue.length || g.t !== this.expectedT || g.shardX !== this.shardX || g.shardY !== this.shardY;
    if (stale && !this.replan(g)) {
      // Boxed in on every margin. Use a dash to get out if there is one.
      const escape = this.pickDash(g, g.charges > 0);
      if (escape !== null) return escape;
    }

    this.expectedT = g.t + 1;
    return this.queue[this.cursor++] ?? 0;
  }

  private replan(g: Game): boolean {
    this.shardX = g.shardX;
    this.shardY = g.shardY;
    this.cursor = 0;
    this.queue = [];
    for (const margin of this.margins) {
      const plan = planPath(g, { margin, maxExpansions: this.maxExpansions, seekShard: true });
      if (plan && (plan.reachedShard || plan.endT + PLAN_STEP > LOOP_TICKS)) {
        this.queue = plan.inputs;
        return true;
      }
    }
    const survival = planPath(g, { margin: HIT_DIST + 2, maxExpansions: this.maxExpansions, seekShard: false });
    if (survival) {
      this.queue = survival.inputs;
      return survival.endT + PLAN_STEP > LOOP_TICKS;
    }
    return false;
  }

  /** A dash that erases an echo and ends somewhere safe, if one exists from here. */
  private pickDash(g: Game, allowed: boolean): number | null {
    if (!allowed || g.t < GRACE_TICKS) return null;
    const reach = DASH_TICKS * DASH_SPEED;
    const end = Math.min(LOOP_TICKS, g.t + DASH_TICKS);
    for (const echo of g.echoes) {
      if (!echo.alive) continue;
      const toX = echo.xs[end] - g.x;
      const toY = echo.ys[end] - g.y;
      const dist = Math.hypot(toX, toY);
      if (dist > reach || dist < KILL_DIST) continue;

      const heading = headingToward(toX, toY);
      if (this.dashEndsSafe(g, heading)) return packInput(heading, true) | DASH_BIT;
    }
    return null;
  }

  private dashEndsSafe(g: Game, heading: number): boolean {
    const endX = clamp(g.x + HEADING_X[heading] * DASH_SPEED * DASH_TICKS, PLAYER_RADIUS, WIDTH - PLAYER_RADIUS);
    const endY = clamp(g.y + HEADING_Y[heading] * DASH_SPEED * DASH_TICKS, PLAYER_RADIUS, HEIGHT - PLAYER_RADIUS);
    for (let t = g.t + DASH_TICKS; t <= Math.min(LOOP_TICKS, g.t + DASH_TICKS + 24); t += 3) {
      for (const echo of g.echoes) {
        if (!echo.alive) continue;
        const dx = echo.xs[t] - endX;
        const dy = echo.ys[t] - endY;
        if (dx * dx + dy * dy < 40 * 40) return false;
      }
    }
    return true;
  }
}

export class ReflexBot implements Pilot {
  private input = 0;
  private readonly reaction: number;
  private readonly lookahead: number;
  private readonly caution: number;

  constructor(options: { reaction?: number; lookahead?: number; caution?: number } = {}) {
    this.reaction = options.reaction ?? 15;
    this.lookahead = options.lookahead ?? 24;
    this.caution = options.caution ?? 40;
  }

  next(g: Game): number {
    if (g.phase !== 'play') return 0;
    if (g.t % this.reaction !== 0) return this.input;

    // What a person has taken in by now is where things were a moment ago, and which way they were moving.
    const seenAt = Math.max(0, g.t - this.reaction);
    const before = Math.max(0, seenAt - 6);
    const echoes = g.echoes
      .filter((echo) => echo.alive)
      .map((echo) => ({
        x: echo.xs[seenAt],
        y: echo.ys[seenAt],
        vx: (echo.xs[seenAt] - echo.xs[before]) / Math.max(1, seenAt - before),
        vy: (echo.ys[seenAt] - echo.ys[before]) / Math.max(1, seenAt - before),
      }));
    const armed = g.t + this.lookahead >= GRACE_TICKS;

    let bestInput = 0;
    let bestScore = -Infinity;
    let closestOverall = Infinity;
    for (let heading = -1; heading < HEADINGS; heading += heading === -1 ? 1 : 2) {
      const dx = heading < 0 ? 0 : HEADING_X[heading] * PLAYER_SPEED;
      const dy = heading < 0 ? 0 : HEADING_Y[heading] * PLAYER_SPEED;
      let closest = Infinity;
      let nearestShard = Math.hypot(g.x - g.shardX, g.y - g.shardY);
      const startDist = nearestShard;
      for (let k = 6; k <= this.lookahead; k += 6) {
        const endX = clamp(g.x + dx * k, PLAYER_RADIUS, WIDTH - PLAYER_RADIUS);
        const endY = clamp(g.y + dy * k, PLAYER_RADIUS, HEIGHT - PLAYER_RADIUS);
        nearestShard = Math.min(nearestShard, Math.hypot(endX - g.shardX, endY - g.shardY));
        if (!armed) continue;
        const elapsed = k + this.reaction;
        for (const echo of echoes) {
          closest = Math.min(closest, Math.hypot(echo.x + echo.vx * elapsed - endX, echo.y + echo.vy * elapsed - endY));
        }
      }
      const progress = startDist - nearestShard;
      const danger = closest < this.caution ? (this.caution - closest) * 12 : 0;
      const value = progress - danger;
      if (value > bestScore) {
        bestScore = value;
        bestInput = heading < 0 ? 0 : heading + 1;
        closestOverall = closest;
      }
    }

    // Even the best move still runs into something, so spend a dash if there is one.
    const panic = closestOverall < HIT_DIST + 6 && g.charges > 0 && g.dashLeft === 0;
    this.input = bestInput;
    return panic ? bestInput | DASH_BIT : bestInput;
  }
}
