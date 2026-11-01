/**
 * Plays a lot of runs with no human, to measure the game instead of guessing at it. The numbers in the
 * README come from here.
 *
 *     npm run evaluate -- --seeds 200
 */
import { PlannerBot, ReflexBot, type Pilot } from '../src/bot/pilots.ts';
import { findWayOut, wayOutHolds } from '../src/bot/wayout.ts';
import { createGame, stateHash, step } from '../src/sim/game.ts';
import { Recording, decodeReplay, simulateReplay } from '../src/sim/replay.ts';

const argument = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
};

const SEEDS = argument('seeds', 200);
const MAX_LOOPS = argument('max-loops', 60);

interface RunResult {
  loops: number;
  score: number;
  echoesAtEnd: number;
  kills: number;
  shards: number;
  cause: string;
  replayChars: number;
  wayOut: boolean | null;
  replayMatches: boolean;
  maxStepMs: number;
}

function play(seed: number, pilot: Pilot): RunResult {
  const g = createGame(seed);
  const recording = new Recording(seed);
  let maxStepMs = 0;
  while (g.phase !== 'over' && g.loop <= MAX_LOOPS) {
    const started = performance.now();
    const input = pilot.next(g);
    maxStepMs = Math.max(maxStepMs, performance.now() - started);
    recording.push(input);
    step(g, input);
  }

  const code = recording.encode();
  const replay = decodeReplay(code);
  const again = replay ? simulateReplay(replay) : null;

  // A route only counts if it survives being played through the real simulation.
  const way = g.cause === 'hit' ? findWayOut(g) : null;
  const wayOut = g.cause === 'hit' ? way !== null && wayOutHolds(g, way) : null;

  return {
    loops: g.loop,
    score: g.score,
    echoesAtEnd: g.echoes.filter((echo) => echo.alive).length,
    kills: g.kills,
    shards: g.totalShards,
    cause: g.phase === 'over' ? (g.cause ?? '') : 'cap',
    replayChars: code.length,
    wayOut,
    replayMatches: again !== null && stateHash(again) === stateHash(g),
    maxStepMs,
  };
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

function report(name: string, makePilot: () => Pilot): void {
  const started = performance.now();
  const runs = Array.from({ length: SEEDS }, (_, i) => play(i + 1, makePilot()));
  const seconds = (performance.now() - started) / 1000;

  const loops = runs.map((run) => run.loops);
  const count = (cause: string): number => runs.filter((run) => run.cause === cause).length;
  const wayOuts = runs.filter((run) => run.wayOut !== null);

  console.log(`\n${name} (${SEEDS} runs, cap ${MAX_LOOPS} loops, ${seconds.toFixed(1)}s)`);
  console.log(`  loops survived   p10 ${quantile(loops, 0.1)}  median ${quantile(loops, 0.5)}  p90 ${quantile(loops, 0.9)}  max ${Math.max(...loops)}`);
  console.log(`  ended by         hit ${count('hit')}  quota ${count('quota')}  reached cap ${count('cap')}`);
  console.log(`  echoes alive     median ${quantile(runs.map((run) => run.echoesAtEnd), 0.5)}`);
  console.log(`  erased           median ${quantile(runs.map((run) => run.kills), 0.5)}`);
  console.log(`  shards           median ${quantile(runs.map((run) => run.shards), 0.5)}`);
  console.log(`  score            median ${quantile(runs.map((run) => run.score), 0.5)}`);
  console.log(`  replay link      median ${quantile(runs.map((run) => run.replayChars), 0.5)} chars  max ${Math.max(...runs.map((run) => run.replayChars))}`);
  console.log(`  worst bot tick   ${Math.max(...runs.map((run) => run.maxStepMs)).toFixed(1)} ms`);
  if (wayOuts.length > 0) {
    console.log(`  way out existed  ${wayOuts.filter((run) => run.wayOut).length} of ${wayOuts.length} deaths by a hit`);
  }
  const mismatches = runs.filter((run) => !run.replayMatches).length;
  console.log(`  replays          ${runs.length - mismatches} of ${runs.length} reproduced the run exactly`);
}

report('Reflex bot (late reactions, guesses where echoes go)', () => new ReflexBot());
report('Planner bot (sees every echo\'s whole future)', () => new PlannerBot());
