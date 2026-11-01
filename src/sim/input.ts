/**
 * One tick of player input, packed into a byte so a whole run can be replayed from a list of them.
 *
 *     0        standing still
 *     1..32    moving along heading n - 1
 *     bit 6    dash held
 *
 * Headings come from a table instead of Math.sin and Math.cos, because the language spec lets every
 * engine round those differently, and one different bit would derail a replay on another browser.
 * Addition, multiplication and division are exact to the spec, so this table is the same everywhere.
 */
export const HEADINGS = 32;
export const MOVE_MASK = 63;
export const DASH_BIT = 64;

const QUARTER = HEADINGS / 4;

function seriesSin(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 10; n++) {
    term *= (-x * x) / (2 * n * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const SINE = Array.from({ length: QUARTER + 1 }, (_, i) => {
  if (i === 0) return 0;
  if (i === QUARTER) return 1;
  return seriesSin((i * Math.PI) / (2 * QUARTER));
});

export const HEADING_X = new Float64Array(HEADINGS);
export const HEADING_Y = new Float64Array(HEADINGS);
for (let i = 0; i < HEADINGS; i++) {
  const quadrant = Math.floor(i / QUARTER);
  const k = i % QUARTER;
  const s = SINE[k];
  const c = SINE[QUARTER - k];
  // Subtracting from zero rather than negating, so the table holds 0 and never -0.
  HEADING_X[i] = [c, 0 - s, 0 - c, s][quadrant];
  HEADING_Y[i] = [s, c, 0 - s, 0 - c][quadrant];
}

/** Packs a heading (or null for standing still) and the dash button into an input byte. */
export function packInput(heading: number | null, dash: boolean): number {
  return (heading === null ? 0 : heading + 1) | (dash ? DASH_BIT : 0);
}

/**
 * The nearest heading to a direction. This runs before the input is recorded, so unlike the simulation
 * it is free to use Math.atan2: a replay stores the heading that came out, not the sum that made it.
 */
export function headingToward(dx: number, dy: number): number {
  const turn = Math.atan2(dy, dx) / (2 * Math.PI);
  return ((Math.round(turn * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
}
