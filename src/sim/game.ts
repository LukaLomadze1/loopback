/**
 * The whole game, with no access to the DOM, the clock or Math.random. A run is a pure function of its
 * seed and its inputs, which is what makes everything else possible: echoes are the player's own past,
 * being hit rewinds by re-simulating, a replay fits in a URL, and a bot can search the future.
 */
import {
  BONUS_SHARD_SCORE,
  CAMP_DIST,
  CAMP_SHARE,
  DASH_EXIT_INVULN,
  DASH_SPEED,
  DASH_TICKS,
  GRACE_TICKS,
  GRAZE_DIST,
  GRAZE_METER,
  HEIGHT,
  HIT_DIST,
  HIT_INVULN,
  HIT_REWIND_SPAN,
  HIT_REWIND_TICKS,
  KILL_DIST,
  KILL_SCORE,
  LOOP_SCORE,
  LOOP_TICKS,
  MAX_CHARGES,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  REWIND_TICKS,
  SHARD_MARGIN,
  SHARD_METER,
  SHARD_MIN_TRAVEL,
  SHARD_RADIUS,
  SHARD_SCORE,
  START_CHARGES,
  START_INTEGRITY,
  WIDTH,
  quotaFor,
} from './constants.ts';
import { DASH_BIT, HEADING_X, HEADING_Y, MOVE_MASK } from './input.ts';

export type Phase = 'play' | 'loopRewind' | 'hitRewind' | 'over';

export interface Pickup {
  t: number;
  x: number;
  y: number;
}

/** One finished loop of the player, replaying forever until it is erased. */
export interface Echo {
  loop: number;
  xs: Float32Array;
  ys: Float32Array;
  pickups: Pickup[];
  alive: boolean;
  /** Where it was erased, in the loop it was erased, for the print. */
  erasedAt: { x: number; y: number } | null;
}

export type GameEvent =
  | { type: 'shard'; x: number; y: number; pickup: Pickup; collected: number; quota: number }
  | { type: 'graze'; x: number; y: number; echoX: number; echoY: number }
  | { type: 'charge'; charges: number }
  | { type: 'dash'; x: number; y: number; dirX: number; dirY: number }
  | { type: 'kill'; x: number; y: number; loop: number }
  | { type: 'hit'; x: number; y: number; echoLoop: number; integrity: number }
  | { type: 'missedQuota'; integrity: number }
  | { type: 'loopEnd'; loop: number; quotaMet: boolean }
  | { type: 'loopStart'; loop: number }
  | { type: 'resumed' }
  | { type: 'over'; cause: 'hit' | 'quota' };

/** The part of the state that a rewind restores. Integrity and the hit count deliberately aren't in it. */
export interface Moment {
  rng: number;
  x: number;
  y: number;
  headX: number;
  headY: number;
  dashX: number;
  dashY: number;
  dashLeft: number;
  dashHeld: boolean;
  charges: number;
  meter: number;
  invuln: number;
  shardX: number;
  shardY: number;
  collected: number;
  score: number;
  totalShards: number;
  kills: number;
  dashes: number;
  grazeTicks: number;
  grazing: boolean;
}

export interface Game extends Moment {
  seed: number;
  /** Ticks since the run began. Unlike t, this never goes backward. */
  tick: number;
  phase: Phase;
  /** Ticks left in the current rewind. */
  timer: number;
  loop: number;
  /** Ticks into the current loop. */
  t: number;
  integrity: number;
  hits: number;
  missed: number;
  rewindFrom: number;
  rewindTo: number;
  echoes: Echo[];
  /** The current loop so far, which becomes the next echo. */
  xs: Float32Array;
  ys: Float32Array;
  pickups: Pickup[];
  loopInputs: Uint8Array;
  checkpoint: Moment;
  aliveAtStart: boolean[];
  cause: 'hit' | 'quota' | null;
  killedBy: Echo | null;
  /** What happened during the last step, for the renderer and the audio. Never read by the simulation. */
  events: GameEvent[];
}

function capture(g: Moment): Moment {
  return {
    rng: g.rng,
    x: g.x,
    y: g.y,
    headX: g.headX,
    headY: g.headY,
    dashX: g.dashX,
    dashY: g.dashY,
    dashLeft: g.dashLeft,
    dashHeld: g.dashHeld,
    charges: g.charges,
    meter: g.meter,
    invuln: g.invuln,
    shardX: g.shardX,
    shardY: g.shardY,
    collected: g.collected,
    score: g.score,
    totalShards: g.totalShards,
    kills: g.kills,
    dashes: g.dashes,
    grazeTicks: g.grazeTicks,
    grazing: g.grazing,
  };
}

function random(g: Moment): number {
  g.rng = (g.rng + 0x6d2b79f5) | 0;
  let n = g.rng;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

export function createGame(seed: number): Game {
  const start: Moment = {
    rng: seed | 0,
    x: WIDTH / 2,
    y: HEIGHT / 2,
    headX: 1,
    headY: 0,
    dashX: 1,
    dashY: 0,
    dashLeft: 0,
    dashHeld: false,
    charges: START_CHARGES,
    meter: 0,
    invuln: 0,
    shardX: 0,
    shardY: 0,
    collected: 0,
    score: 0,
    totalShards: 0,
    kills: 0,
    dashes: 0,
    grazeTicks: 0,
    grazing: false,
  };
  const g: Game = {
    ...start,
    seed: seed | 0,
    tick: 0,
    phase: 'play',
    timer: 0,
    loop: 1,
    t: 0,
    integrity: START_INTEGRITY,
    hits: 0,
    missed: 0,
    rewindFrom: 0,
    rewindTo: 0,
    echoes: [],
    xs: new Float32Array(LOOP_TICKS + 1),
    ys: new Float32Array(LOOP_TICKS + 1),
    pickups: [],
    loopInputs: new Uint8Array(LOOP_TICKS),
    checkpoint: start,
    aliveAtStart: [],
    cause: null,
    killedBy: null,
    events: [],
  };
  spawnShard(g);
  g.xs[0] = g.x;
  g.ys[0] = g.y;
  g.checkpoint = capture(g);
  return g;
}

/** Advances the game by one tick. Replaying a run means calling this with the same inputs. */
export function step(g: Game, input: number): void {
  g.events.length = 0;
  g.tick++;
  switch (g.phase) {
    case 'play':
      advance(g, input, true);
      break;
    case 'loopRewind':
      if (--g.timer <= 0) beginLoop(g);
      break;
    case 'hitRewind':
      if (--g.timer <= 0) finishHitRewind(g);
      break;
    case 'over':
      break;
  }
}

/** One tick of play. With live off it is re-simulating known history, so nothing can hit and nothing is announced. */
function advance(g: Game, input: number, live: boolean): void {
  if (live) g.loopInputs[g.t] = input;
  const move = input & MOVE_MASK;
  const wantsDash = (input & DASH_BIT) !== 0;
  if (move > 0) {
    g.headX = HEADING_X[move - 1];
    g.headY = HEADING_Y[move - 1];
  }

  if (wantsDash && !g.dashHeld && g.dashLeft === 0 && g.charges > 0) {
    g.charges--;
    g.dashes++;
    g.dashLeft = DASH_TICKS;
    g.dashX = g.headX;
    g.dashY = g.headY;
    if (live) g.events.push({ type: 'dash', x: g.x, y: g.y, dirX: g.dashX, dirY: g.dashY });
  }
  g.dashHeld = wantsDash;

  const dashing = g.dashLeft > 0;
  if (dashing) {
    g.x += g.dashX * DASH_SPEED;
    g.y += g.dashY * DASH_SPEED;
    g.dashLeft--;
    if (g.dashLeft === 0) g.invuln = Math.max(g.invuln, DASH_EXIT_INVULN);
  } else if (move > 0) {
    g.x += HEADING_X[move - 1] * PLAYER_SPEED;
    g.y += HEADING_Y[move - 1] * PLAYER_SPEED;
  }
  g.x = Math.min(WIDTH - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, g.x));
  g.y = Math.min(HEIGHT - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, g.y));

  g.t++;
  g.xs[g.t] = g.x;
  g.ys[g.t] = g.y;

  const invulnerable = g.invuln > 0 || dashing;
  if (g.invuln > 0) g.invuln--;

  collectShard(g, live);
  const hitBy = meetEchoes(g, dashing, invulnerable, live);

  if (!live) return;
  if (hitBy) {
    takeHit(g, hitBy);
    return;
  }
  if (g.t === LOOP_TICKS) finishLoop(g);
}

function collectShard(g: Game, live: boolean): void {
  const dx = g.shardX - g.x;
  const dy = g.shardY - g.y;
  if (dx * dx + dy * dy >= SHARD_RADIUS * SHARD_RADIUS) return;

  const pickup: Pickup = { t: g.t, x: g.shardX, y: g.shardY };
  const quota = quotaFor(g.loop);
  g.pickups.push(pickup);
  g.collected++;
  g.totalShards++;
  g.score += g.collected > quota ? BONUS_SHARD_SCORE : SHARD_SCORE;
  gainMeter(g, SHARD_METER, live);
  if (live) g.events.push({ type: 'shard', x: pickup.x, y: pickup.y, pickup, collected: g.collected, quota });
  spawnShard(g);
}

function gainMeter(g: Game, amount: number, live: boolean): void {
  if (g.charges >= MAX_CHARGES) {
    g.meter = 0;
    return;
  }
  g.meter += amount;
  if (g.meter >= 1) {
    g.meter -= 1;
    g.charges++;
    if (live) g.events.push({ type: 'charge', charges: g.charges });
  }
}

function meetEchoes(g: Game, dashing: boolean, invulnerable: boolean, live: boolean): Echo | null {
  g.grazing = false;
  if (g.t < GRACE_TICKS) return null;

  let hitBy: Echo | null = null;
  let grazed: Echo | null = null;
  for (const echo of g.echoes) {
    if (!echo.alive) continue;
    const dx = echo.xs[g.t] - g.x;
    const dy = echo.ys[g.t] - g.y;
    const dist2 = dx * dx + dy * dy;
    if (dashing) {
      if (dist2 < KILL_DIST * KILL_DIST) {
        echo.alive = false;
        echo.erasedAt = { x: echo.xs[g.t], y: echo.ys[g.t] };
        g.kills++;
        g.score += KILL_SCORE;
        if (live) g.events.push({ type: 'kill', x: echo.xs[g.t], y: echo.ys[g.t], loop: echo.loop });
      }
    } else if (dist2 < HIT_DIST * HIT_DIST) {
      if (!invulnerable) hitBy ??= echo;
    } else if (dist2 < GRAZE_DIST * GRAZE_DIST) {
      grazed ??= echo;
    }
  }

  if (grazed && !invulnerable) {
    g.grazing = true;
    g.grazeTicks++;
    g.score += 1;
    gainMeter(g, GRAZE_METER, live);
    if (live) g.events.push({ type: 'graze', x: g.x, y: g.y, echoX: grazed.xs[g.t], echoY: grazed.ys[g.t] });
  }
  return hitBy;
}

function takeHit(g: Game, echo: Echo): void {
  g.integrity--;
  g.hits++;
  g.events.push({ type: 'hit', x: g.x, y: g.y, echoLoop: echo.loop, integrity: g.integrity });
  if (g.integrity <= 0) {
    endRun(g, 'hit', echo);
    return;
  }
  g.phase = 'hitRewind';
  g.timer = HIT_REWIND_TICKS;
  g.rewindFrom = g.t;
  g.rewindTo = Math.max(0, g.t - HIT_REWIND_SPAN);
}

function endRun(g: Game, cause: 'hit' | 'quota', echo: Echo | null): void {
  g.phase = 'over';
  g.cause = cause;
  g.killedBy = echo;
  g.events.push({ type: 'over', cause });
}

/**
 * Restores the start of the loop and replays this loop's inputs up to a tick. There are no snapshots to
 * manage, because the simulation is deterministic: the past is just the same inputs run again.
 */
function resimulate(g: Game, to: number): void {
  Object.assign(g, g.checkpoint);
  g.echoes.forEach((echo, i) => {
    echo.alive = g.aliveAtStart[i];
    if (echo.alive) echo.erasedAt = null;
  });
  g.t = 0;
  g.pickups = [];
  for (let i = 0; i < to; i++) advance(g, g.loopInputs[i], false);
}

function finishHitRewind(g: Game): void {
  resimulate(g, g.rewindTo);
  g.invuln = HIT_INVULN;
  g.phase = 'play';
  g.events.push({ type: 'resumed' });
}

function finishLoop(g: Game): void {
  const quotaMet = g.collected >= quotaFor(g.loop);
  if (quotaMet) {
    g.score += LOOP_SCORE * g.loop;
  } else {
    g.integrity--;
    g.missed++;
    g.events.push({ type: 'missedQuota', integrity: g.integrity });
  }
  g.events.push({ type: 'loopEnd', loop: g.loop, quotaMet });

  if (g.integrity <= 0) {
    endRun(g, 'quota', null);
    return;
  }
  g.echoes.push({ loop: g.loop, xs: g.xs, ys: g.ys, pickups: g.pickups, alive: true, erasedAt: null });
  g.xs = new Float32Array(LOOP_TICKS + 1);
  g.ys = new Float32Array(LOOP_TICKS + 1);
  g.pickups = [];
  g.phase = 'loopRewind';
  g.timer = REWIND_TICKS;
}

function beginLoop(g: Game): void {
  g.loop++;
  g.t = 0;
  g.collected = 0;
  g.invuln = 0;
  g.xs[0] = g.x;
  g.ys[0] = g.y;
  g.phase = 'play';
  g.checkpoint = capture(g);
  g.aliveAtStart = g.echoes.map((echo) => echo.alive);
  g.events.push({ type: 'loopStart', loop: g.loop });
}

function spawnShard(g: Game): void {
  let x = WIDTH / 2;
  let y = HEIGHT / 2;
  for (let attempt = 0; attempt < 24; attempt++) {
    x = SHARD_MARGIN + random(g) * (WIDTH - 2 * SHARD_MARGIN);
    y = SHARD_MARGIN + random(g) * (HEIGHT - 2 * SHARD_MARGIN);
    const dx = x - g.x;
    const dy = y - g.y;
    if (dx * dx + dy * dy >= SHARD_MIN_TRAVEL * SHARD_MIN_TRAVEL && !isCamped(g, x, y)) break;
  }
  g.shardX = x;
  g.shardY = y;
}

/** True if an echo spends so much of a loop on a spot that a shard there could not fairly be reached. */
function isCamped(g: Game, x: number, y: number): boolean {
  const samples = Math.ceil(LOOP_TICKS / 6);
  for (const echo of g.echoes) {
    if (!echo.alive) continue;
    let near = 0;
    for (let t = 0; t < LOOP_TICKS; t += 6) {
      const dx = echo.xs[t] - x;
      const dy = echo.ys[t] - y;
      if (dx * dx + dy * dy < CAMP_DIST * CAMP_DIST) near++;
    }
    if (near > samples * CAMP_SHARE) return true;
  }
  return false;
}

/** A copy of the game as it was at an earlier tick of this loop, for asking "what if". */
export function rewoundCopy(g: Game, to: number): Game {
  const copy: Game = {
    ...g,
    echoes: g.echoes.map((echo) => ({ ...echo })),
    xs: g.xs.slice(),
    ys: g.ys.slice(),
    loopInputs: g.loopInputs.slice(),
    pickups: [],
    events: [],
    phase: 'play',
  };
  resimulate(copy, to);
  return copy;
}

/** FNV-1a over everything that matters, so two runs that differ by one bit have different hashes. */
export function stateHash(g: Game): number {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    view.setFloat64(0, value);
    for (let i = 0; i < 8; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193);
  };
  for (const value of [
    g.tick, g.loop, g.t, g.rng, g.x, g.y, g.shardX, g.shardY, g.score, g.charges,
    g.meter, g.integrity, g.kills, g.grazeTicks, g.invuln, g.dashLeft,
  ]) {
    mix(value);
  }
  for (const echo of g.echoes) mix(echo.alive ? 1 : 0);
  return hash >>> 0;
}
