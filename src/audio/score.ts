/**
 * The music theory, with no sound in it. A loop is 32 eighth notes over four chords, and a shard's
 * position picks its note: higher on the screen is higher in the chord, so any route sounds in key.
 */
import { HEIGHT, LOOP_TICKS, REWIND_TICKS, WIDTH } from '../sim/constants.ts';
import type { Pickup } from '../sim/game.ts';

export const STEPS = 32;
export const STEP_TICKS = (LOOP_TICKS + REWIND_TICKS) / STEPS;
export const STEP_SECONDS = 0.25;
export const STEPS_PER_BAR = 8;
export const DEGREES = 6;

/** Am, F, C, G, as MIDI notes in ascending order. */
const CHORDS = [
  [57, 60, 64, 69, 72, 76],
  [53, 57, 60, 65, 69, 72],
  [55, 60, 64, 67, 72, 76],
  [55, 59, 62, 67, 71, 74],
];
const ROOTS = [33, 29, 36, 31];

const barOf = (step: number): number => Math.floor(step / STEPS_PER_BAR) % CHORDS.length;

export const chordAt = (step: number): number[] => CHORDS[barOf(step)];
export const rootAt = (step: number): number => ROOTS[barOf(step)];
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** The eighth note a pickup lands on when an echo plays it back. */
export const stepOf = (pickup: Pickup): number => Math.min(STEPS - 1, Math.ceil(pickup.t / STEP_TICKS));

/** 0 at the bottom of the arena, DEGREES - 1 at the top. */
export const degreeOf = (pickup: Pickup): number =>
  Math.max(0, Math.min(DEGREES - 1, DEGREES - 1 - Math.floor((pickup.y / HEIGHT) * DEGREES)));

export const panOf = (pickup: Pickup): number => (pickup.x / WIDTH) * 1.2 - 0.6;

export const noteOf = (pickup: Pickup): number => chordAt(stepOf(pickup))[degreeOf(pickup)];
