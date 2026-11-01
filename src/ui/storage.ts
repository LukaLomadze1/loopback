/** A few remembered values. Any of this can fail in a private window, and the game has to work anyway. */
const KEY = 'loopback.v1';

export interface Saved {
  bestLoops: number;
  bestScore: number;
  runs: number;
  muted: boolean;
}

const DEFAULTS: Saved = { bestLoops: 0, bestScore: 0, runs: 0, muted: false };

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Nothing to do: the values just won't survive a reload.
  }
}
