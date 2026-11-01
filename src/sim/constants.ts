/** Every tuning number in the simulation. Changing one of these invalidates old replay links. */

export const TPS = 60;

/** Playable ticks in a loop. With the rewind after it, one cycle is exactly 8 seconds: 4 bars at 120 BPM. */
export const LOOP_TICKS = 450;
export const REWIND_TICKS = 30;
export const CYCLE_TICKS = LOOP_TICKS + REWIND_TICKS;

export const WIDTH = 960;
export const HEIGHT = 600;

export const PLAYER_RADIUS = 10;
export const ECHO_RADIUS = 12;
export const PLAYER_SPEED = 4.6;

/** Hitboxes are smaller than the drawings, so a pass that looks like a near miss is one. */
export const HIT_DIST = 17;
export const GRAZE_DIST = 44;
export const KILL_DIST = 32;

/** At the start of a loop, echoes are harmless for this long, so nothing can spawn on top of you. */
export const GRACE_TICKS = 45;

export const DASH_TICKS = 12;
export const DASH_SPEED = 14;
export const DASH_EXIT_INVULN = 8;
export const MAX_CHARGES = 3;
export const START_CHARGES = 1;
/** Meter gained per tick spent brushing past an echo. A full meter is one dash. */
export const GRAZE_METER = 1 / 150;
export const SHARD_METER = 0.04;

export const SHARD_RADIUS = 22;
export const SHARD_MARGIN = 48;
export const SHARD_MIN_TRAVEL = 180;
/** A spot is rejected for a new shard if an echo sits within this distance for too much of a loop. */
export const CAMP_DIST = 40;
export const CAMP_SHARE = 0.4;

export const START_INTEGRITY = 3;
/** Being hit sends you back this far in the current loop. Two seconds is exactly one bar. */
export const HIT_REWIND_SPAN = 120;
export const HIT_REWIND_TICKS = 36;
export const HIT_INVULN = 45;

export const SHARD_SCORE = 100;
export const BONUS_SHARD_SCORE = 150;
export const KILL_SCORE = 250;
export const LOOP_SCORE = 50;

/** How many shards a loop asks for. Missing the quota costs one integrity. */
export function quotaFor(loop: number): number {
  if (loop <= 2) return 1;
  if (loop <= 6) return 2;
  if (loop <= 14) return 3;
  return 4;
}
