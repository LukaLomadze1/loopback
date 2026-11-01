/**
 * A* search through space and time. Every hazard in this game is a recording of the past, so the future
 * is fully known, and "how do I reach that shard without touching anything" has an exact answer. The
 * search only uses what a player can see on screen: the echoes, and the shard that is currently out.
 *
 * Nodes keep their exact position, and the grid is only used to skip places already visited at that time.
 */
import { GRACE_TICKS, HEIGHT, LOOP_TICKS, PLAYER_RADIUS, PLAYER_SPEED, SHARD_RADIUS, WIDTH } from '../sim/constants.ts';
import type { Echo, Game } from '../sim/game.ts';
import { HEADING_X, HEADING_Y } from '../sim/input.ts';

export const PLAN_STEP = 6;
const CELL = 12;

/** Standing still, then sixteen evenly spaced headings, as input bytes. */
const MOVES = [0, ...Array.from({ length: 16 }, (_, i) => i * 2 + 1)];

const CAPACITY = 150_000;
const COLS = Math.ceil(WIDTH / CELL) + 1;
const ROWS = Math.ceil(HEIGHT / CELL) + 1;
const LAYERS = Math.ceil(LOOP_TICKS / PLAN_STEP) + 2;

const nodeX = new Float64Array(CAPACITY);
const nodeY = new Float64Array(CAPACITY);
const nodeF = new Float64Array(CAPACITY);
const nodeT = new Int32Array(CAPACITY);
const nodeParent = new Int32Array(CAPACITY);
const nodeMove = new Uint8Array(CAPACITY);
const heap = new Int32Array(CAPACITY);
const seen = new Uint32Array(COLS * ROWS * LAYERS);
let stamp = 0;
let nodes = 0;
let heapSize = 0;

function heapPush(node: number): void {
  let i = heapSize++;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (nodeF[heap[parent]] <= nodeF[node]) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = node;
}

function heapPop(): number {
  const top = heap[0];
  const last = heap[--heapSize];
  let i = 0;
  for (;;) {
    let child = 2 * i + 1;
    if (child >= heapSize) break;
    if (child + 1 < heapSize && nodeF[heap[child + 1]] < nodeF[heap[child]]) child++;
    if (nodeF[heap[child]] >= nodeF[last]) break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return top;
}

function addNode(x: number, y: number, t: number, parent: number, move: number, f: number): number {
  const node = nodes++;
  nodeX[node] = x;
  nodeY[node] = y;
  nodeT[node] = t;
  nodeParent[node] = parent;
  nodeMove[node] = move;
  nodeF[node] = f;
  heapPush(node);
  return node;
}

function safeAt(echoes: Echo[], t: number, x: number, y: number, margin2: number): boolean {
  if (t < GRACE_TICKS) return true;
  for (const echo of echoes) {
    const dx = echo.xs[t] - x;
    const dy = echo.ys[t] - y;
    if (dx * dx + dy * dy < margin2) return false;
  }
  return true;
}

function clampX(x: number): number {
  return Math.min(WIDTH - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, x));
}

function clampY(y: number): number {
  return Math.min(HEIGHT - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, y));
}

export interface PlanOptions {
  /** How far from every echo the path has to stay. */
  margin: number;
  maxExpansions: number;
  /** Head for the shard. Without this it only tries to stay alive until the loop ends. */
  seekShard: boolean;
}

export interface Plan {
  /** One input byte per tick. */
  inputs: number[];
  /** Positions every PLAN_STEP ticks, from the start of the plan. */
  xs: number[];
  ys: number[];
  reachedShard: boolean;
  /** The tick of the loop the plan gets to. */
  endT: number;
}

export function planPath(g: Game, options: PlanOptions): Plan | null {
  const { margin, maxExpansions, seekShard } = options;
  const echoes = g.echoes.filter((echo) => echo.alive);
  const margin2 = margin * margin;
  const reach2 = (SHARD_RADIUS - 2) * (SHARD_RADIUS - 2);
  const start = g.t;

  // Fractions of a tick nudge the search toward later nodes, so equal routes don't all get explored.
  const score = (x: number, y: number, t: number): number => {
    if (!seekShard) return -t;
    return t - start + Math.hypot(x - g.shardX, y - g.shardY) / PLAYER_SPEED - t * 1e-3;
  };

  stamp++;
  nodes = 0;
  heapSize = 0;
  addNode(g.x, g.y, start, -1, 0, score(g.x, g.y, start));

  let best = 0;
  let bestT = start;
  let bestDist = Infinity;

  for (let expansions = 0; heapSize > 0 && expansions < maxExpansions; expansions++) {
    const node = heapPop();
    const x = nodeX[node];
    const y = nodeY[node];
    const t = nodeT[node];

    const dist = Math.hypot(x - g.shardX, y - g.shardY);
    if (t > bestT || (t === bestT && dist < bestDist)) {
      best = node;
      bestT = t;
      bestDist = dist;
    }

    if (t + PLAN_STEP > LOOP_TICKS) {
      if (!seekShard) return buildPlan(node, false);
      continue;
    }

    const nextT = t + PLAN_STEP;
    const layer = Math.floor(nextT / PLAN_STEP);
    for (const move of MOVES) {
      const dx = move === 0 ? 0 : HEADING_X[move - 1] * PLAYER_SPEED;
      const dy = move === 0 ? 0 : HEADING_Y[move - 1] * PLAYER_SPEED;
      const endX = clampX(x + dx * PLAN_STEP);
      const endY = clampY(y + dy * PLAN_STEP);

      const cell = (Math.floor(endX / CELL) + Math.floor(endY / CELL) * COLS) * LAYERS + layer;
      if (seen[cell] === stamp) continue;

      // Every tick, exactly as the simulation will check it. Sampling less often would miss an echo
      // that crosses the path between two samples. The end goes first, as it rejects the most moves.
      if (!safeAt(echoes, nextT, endX, endY, margin2)) continue;
      let safe = true;
      let reached = false;
      for (let sub = 1; sub <= PLAN_STEP && safe; sub++) {
        const stepX = clampX(x + dx * sub);
        const stepY = clampY(y + dy * sub);
        safe = safeAt(echoes, t + sub, stepX, stepY, margin2);
        const toShardX = stepX - g.shardX;
        const toShardY = stepY - g.shardY;
        if (toShardX * toShardX + toShardY * toShardY < reach2) reached = true;
      }
      if (!safe) continue;

      seen[cell] = stamp;
      if (nodes >= CAPACITY) continue;
      const child = addNode(endX, endY, nextT, node, move, score(endX, endY, nextT));
      if (seekShard && reached) return buildPlan(child, true);
    }
  }

  return best === 0 ? null : buildPlan(best, false);
}

function buildPlan(end: number, reachedShard: boolean): Plan {
  const chain: number[] = [];
  for (let node = end; node !== -1; node = nodeParent[node]) chain.push(node);
  chain.reverse();

  const inputs: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  chain.forEach((node, i) => {
    xs.push(nodeX[node]);
    ys.push(nodeY[node]);
    if (i > 0) for (let n = 0; n < PLAN_STEP; n++) inputs.push(nodeMove[node]);
  });
  return { inputs, xs, ys, reachedShard, endT: nodeT[end] };
}
