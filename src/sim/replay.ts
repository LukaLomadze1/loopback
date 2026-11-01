/**
 * A run is its seed and its inputs, so sharing one takes no server: the inputs are run-length encoded
 * and put in a URL. Players hold a direction for many ticks in a row, which makes that very compact.
 */
import { TPS } from './constants.ts';
import { createGame, step, type Game } from './game.ts';

/** Bump this with any change to the simulation, so an old link fails clearly instead of playing wrongly. */
const FORMAT = 1;
const MAX_TICKS = 3_000_000;

export interface Replay {
  seed: number;
  inputs: Uint8Array;
}

export class Recording {
  readonly seed: number;
  private values: number[] = [];
  private counts: number[] = [];

  constructor(seed: number) {
    this.seed = seed;
  }

  push(input: number): void {
    const last = this.values.length - 1;
    if (last >= 0 && this.values[last] === input) {
      this.counts[last]++;
    } else {
      this.values.push(input);
      this.counts.push(1);
    }
  }

  encode(): string {
    const bytes: number[] = [FORMAT];
    writeVarint(bytes, this.seed >>> 0);
    for (let i = 0; i < this.values.length; i++) {
      bytes.push(this.values[i]);
      writeVarint(bytes, this.counts[i]);
    }
    return toBase64Url(bytes);
  }
}

export function decodeReplay(code: string): Replay | null {
  const bytes = fromBase64Url(code);
  if (!bytes || bytes[0] !== FORMAT) return null;

  const cursor = { at: 1 };
  const seed = readVarint(bytes, cursor);
  if (seed === null) return null;

  const values: number[] = [];
  const counts: number[] = [];
  let total = 0;
  while (cursor.at < bytes.length) {
    const value = bytes[cursor.at++];
    const count = readVarint(bytes, cursor);
    if (count === null || count === 0) return null;
    total += count;
    if (total > MAX_TICKS) return null;
    values.push(value);
    counts.push(count);
  }

  const inputs = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < values.length; i++) {
    inputs.fill(values[i], at, at + counts[i]);
    at += counts[i];
  }
  return { seed: seed | 0, inputs };
}

/** Plays a replay from start to finish without drawing anything. Fast enough to run before the page shows. */
export function simulateReplay(replay: Replay): Game {
  const g = createGame(replay.seed);
  for (let i = 0; i < replay.inputs.length && g.phase !== 'over'; i++) step(g, replay.inputs[i]);
  return g;
}

/** How long a run took to play, counting every rewind. */
export function runSeconds(g: Game): number {
  return Math.round(g.tick / TPS);
}

function writeVarint(out: number[], value: number): void {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

function readVarint(bytes: Uint8Array, cursor: { at: number }): number | null {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 6; i++) {
    if (cursor.at >= bytes.length) return null;
    const byte = bytes[cursor.at++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return value;
    scale *= 0x80;
  }
  return null;
}

function toBase64Url(bytes: number[]): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): Uint8Array | null {
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
