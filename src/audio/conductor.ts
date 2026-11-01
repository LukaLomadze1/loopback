/**
 * Turns a run into a piece of music, by the same rule as the game itself: what you did keeps coming
 * back. Every shard plays a note, and from then on that echo plays it again at the same point in the
 * bar, like a loop pedal. Erase an echo and its notes stop.
 *
 * It reads the simulation and never touches it, so sound has no effect on a replay.
 */
import { LOOP_TICKS, REWIND_TICKS } from '../sim/constants.ts';
import type { Game, GameEvent } from '../sim/game.ts';
import { STEPS, STEPS_PER_BAR, STEP_SECONDS, STEP_TICKS, chordAt, noteOf, panOf, rootAt, stepOf } from './score.ts';
import type { Synth } from './synth.ts';

const LOOKAHEAD_TICKS = 3;
const CYCLE_SECONDS = STEPS * STEP_SECONDS;

/** Which parts of the band have come in by a given loop. */
const LAYERS = { kick: 2, bass: 2, hat: 5, rim: 9, pad: 13 };

/** Plays one eighth note of the arrangement, plus every note the living echoes recorded on it. */
export function playStep(synth: Synth, g: Game, step: number, when: number): void {
  const beat = step % STEPS_PER_BAR;
  const chord = chordAt(step);

  if (g.loop >= LAYERS.kick && beat % 4 === 0) synth.kick(when, 0.62);
  if (g.loop >= LAYERS.bass) {
    if (beat === 0) synth.bass(rootAt(step), when, 0.8, 0.3);
    if (beat === 6) synth.bass(rootAt(step) + 12, when, 0.3, 0.16);
  }
  if (g.loop >= LAYERS.hat && step % 2 === 1) synth.hat(when, 0.1, step % 4 === 1 ? -0.3 : 0.3);
  if (g.loop >= LAYERS.rim && beat % 4 === 2) synth.rim(when, 0.2);
  if (g.loop >= LAYERS.pad && beat === 0) synth.pad(chord.slice(1, 4), when, 2, 0.055);
  if (step === STEPS - 2) synth.swell(when, STEP_SECONDS * 2, 0.16);

  for (const echo of g.echoes) {
    if (!echo.alive) continue;
    const age = g.loop - echo.loop;
    for (const pickup of echo.pickups) {
      if (stepOf(pickup) !== step) continue;
      synth.pluck(noteOf(pickup), when, {
        gain: Math.max(0.05, 0.17 - age * 0.012),
        pan: panOf(pickup),
        brightness: Math.max(0, 0.55 - age * 0.05),
      });
    }
  }
}

export class Conductor {
  private readonly synth: Synth;
  /** The audio time of tick 0 of the current loop. */
  private anchor = 0;
  private lastStep = -1;
  private grazeCooldown = 0;
  private running = false;

  constructor(synth: Synth) {
    this.synth = synth;
  }

  private get now(): number {
    return this.synth.ctx.currentTime;
  }

  begin(): void {
    this.anchor = this.now + 0.06;
    this.lastStep = -1;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  /** Picks the music up from wherever the loop has got to, after anything that knocked it off the bar. */
  rejoin(g: Game): void {
    this.anchor = this.now + 0.04 - g.t / 60;
    this.lastStep = Math.floor(g.t / STEP_TICKS);
    this.running = true;
  }

  on(event: GameEvent, g: Game): void {
    const { synth, now } = this;
    switch (event.type) {
      case 'shard':
        synth.pluck(noteOf(event.pickup), now, { gain: 0.3, pan: panOf(event.pickup), brightness: 1 });
        break;
      case 'graze':
        if (this.grazeCooldown <= 0) {
          synth.grazeTick(now, g.meter);
          this.grazeCooldown = 7;
        }
        break;
      case 'charge':
        synth.charged(now);
        break;
      case 'dash':
        synth.whoosh(now);
        break;
      case 'kill':
        synth.shatter(now, (event.x / 960) * 1.2 - 0.6);
        break;
      case 'hit':
        synth.thud(now);
        if (g.phase === 'hitRewind') synth.tapeStop(now, 0.55, 0.16);
        this.running = g.phase !== 'over';
        break;
      case 'missedQuota':
        synth.thud(now);
        break;
      case 'loopStart': {
        // Stay locked to the bar unless something knocked us well out of it, like a stalled tab.
        const expected = this.anchor + CYCLE_SECONDS;
        const fresh = now + 0.04;
        this.anchor = Math.abs(expected - fresh) < 0.12 ? expected : fresh;
        this.lastStep = -1;
        break;
      }
      case 'resumed':
        this.rejoin(g);
        break;
      case 'over':
        synth.tapeStop(now, 1.6, 0.24);
        this.running = false;
        break;
      case 'loopEnd':
        break;
    }
  }

  /** Called once per simulation tick. Steps go to the audio clock a little early, so they land exactly. */
  tick(g: Game): void {
    if (this.grazeCooldown > 0) this.grazeCooldown--;
    if (!this.running) return;

    let position: number;
    if (g.phase === 'play') position = g.t;
    else if (g.phase === 'loopRewind') position = LOOP_TICKS + (REWIND_TICKS - g.timer);
    else return;

    const target = Math.min(STEPS - 1, Math.floor((position + LOOKAHEAD_TICKS) / STEP_TICKS));
    while (this.lastStep < target) {
      this.lastStep++;
      playStep(this.synth, g, this.lastStep, Math.max(this.now, this.anchor + this.lastStep * STEP_SECONDS));
    }
  }
}
