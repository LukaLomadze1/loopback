/**
 * Every sound in the game, synthesized at runtime: there are no audio files. It takes any
 * BaseAudioContext, so a test can render it offline and measure the result.
 */
import { midiToHz } from './score.ts';

export class Synth {
  readonly ctx: BaseAudioContext;
  private readonly bus: GainNode;
  private readonly send: GainNode;
  private readonly noise: AudioBuffer;
  readonly master: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    compressor.connect(this.master);
    this.master.connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.connect(compressor);

    // A dotted-eighth tape delay, darker on every repeat. It is what makes one note sound like a place.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.375;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.send = ctx.createGain();
    this.send.gain.value = 0.4;
    this.send.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(compressor);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  private envelope(when: number, peak: number, attack: number, decay: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return gain;
  }

  private tone(type: OscillatorType, hz: number, when: number, seconds: number): OscillatorNode {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, when);
    osc.start(when);
    osc.stop(when + seconds + 0.02);
    return osc;
  }

  private noiseBurst(when: number, seconds: number): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.start(when, Math.random() * 0.9);
    source.stop(when + seconds + 0.02);
    return source;
  }

  /** The melodic voice: every shard is one of these, and every echo plays its own back quieter and duller. */
  pluck(midi: number, when: number, options: { gain: number; pan: number; brightness: number }): void {
    const hz = midiToHz(midi);
    const seconds = 0.7;
    const env = this.envelope(when, options.gain, 0.004, seconds);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(hz * (2 + 6 * options.brightness), when);
    filter.frequency.exponentialRampToValueAtTime(hz * 1.5, when + seconds * 0.6);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = options.pan;

    this.tone('triangle', hz, when, seconds).connect(env);
    const overtone = this.ctx.createGain();
    overtone.gain.value = 0.35;
    this.tone('sine', hz * 2.001, when, seconds).connect(overtone);
    overtone.connect(env);

    env.connect(filter);
    filter.connect(panner);
    panner.connect(this.bus);
    panner.connect(this.send);
  }

  kick(when: number, gain: number): void {
    const env = this.envelope(when, gain, 0.003, 0.26);
    const osc = this.tone('sine', 130, when, 0.3);
    osc.frequency.exponentialRampToValueAtTime(44, when + 0.12);
    osc.connect(env);
    env.connect(this.bus);
  }

  bass(midi: number, when: number, seconds: number, gain: number): void {
    const hz = midiToHz(midi);
    const env = this.envelope(when, gain, 0.02, seconds);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    this.tone('sawtooth', hz, when, seconds + 0.04).connect(filter);
    this.tone('sine', hz, when, seconds + 0.04).connect(filter);
    filter.connect(env);
    env.connect(this.bus);
  }

  hat(when: number, gain: number, pan: number): void {
    const env = this.envelope(when, gain, 0.002, 0.05);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    this.noiseBurst(when, 0.07).connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(this.bus);
  }

  rim(when: number, gain: number): void {
    const env = this.envelope(when, gain, 0.002, 0.11);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 1.4;
    this.noiseBurst(when, 0.14).connect(filter);
    filter.connect(env);
    env.connect(this.bus);
    env.connect(this.send);
  }

  /** A soft chord for the deep part of a run, when there is enough happening to hold up a bed under it. */
  pad(notes: number[], when: number, seconds: number, gain: number): void {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + seconds * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, when + seconds);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    for (const midi of notes) {
      this.tone('sawtooth', midiToHz(midi) * 0.998, when, seconds).connect(filter);
      this.tone('sawtooth', midiToHz(midi) * 1.002, when, seconds).connect(filter);
    }
    filter.connect(env);
    env.connect(this.bus);
    env.connect(this.send);
  }

  /** Noise rising into the downbeat, under the rewind. */
  swell(when: number, seconds: number, gain: number): void {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + seconds);
    env.gain.setValueAtTime(0.0001, when + seconds + 0.005);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(600, when);
    filter.frequency.exponentialRampToValueAtTime(7000, when + seconds);
    this.noiseBurst(when, seconds + 0.01).connect(filter);
    filter.connect(env);
    env.connect(this.bus);
  }

  grazeTick(when: number, meter: number): void {
    const env = this.envelope(when, 0.05, 0.002, 0.05);
    this.tone('sine', 1800 + 1500 * meter, when, 0.06).connect(env);
    env.connect(this.bus);
  }

  charged(when: number): void {
    [76, 83].forEach((midi, i) => {
      const at = when + i * 0.07;
      const env = this.envelope(at, 0.13, 0.003, 0.24);
      this.tone('square', midiToHz(midi), at, 0.26).connect(env);
      env.connect(this.bus);
      env.connect(this.send);
    });
  }

  whoosh(when: number): void {
    const env = this.envelope(when, 0.34, 0.01, 0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(3400, when);
    filter.frequency.exponentialRampToValueAtTime(420, when + 0.2);
    this.noiseBurst(when, 0.24).connect(filter);
    filter.connect(env);
    env.connect(this.bus);
  }

  shatter(when: number, pan: number): void {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    const env = this.envelope(when, 0.42, 0.002, 0.42);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2600, when);
    filter.frequency.exponentialRampToValueAtTime(700, when + 0.4);
    this.noiseBurst(when, 0.46).connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(this.bus);
    panner.connect(this.send);

    const low = this.envelope(when, 0.3, 0.002, 0.3);
    const osc = this.tone('triangle', 520, when, 0.32);
    osc.frequency.exponentialRampToValueAtTime(70, when + 0.3);
    osc.connect(low);
    low.connect(panner);
  }

  thud(when: number): void {
    const env = this.envelope(when, 0.75, 0.002, 0.5);
    const osc = this.tone('sine', 150, when, 0.54);
    osc.frequency.exponentialRampToValueAtTime(34, when + 0.42);
    osc.connect(env);
    env.connect(this.bus);
    const crackle = this.envelope(when, 0.3, 0.002, 0.16);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    this.noiseBurst(when, 0.2).connect(filter);
    filter.connect(crackle);
    crackle.connect(this.bus);
  }

  /** A tape running down: the sound of a hit's rewind, and much longer, of the run ending. */
  tapeStop(when: number, seconds: number, gain: number): void {
    const env = this.envelope(when, gain, 0.01, seconds);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, when);
    filter.frequency.exponentialRampToValueAtTime(120, when + seconds);
    const osc = this.tone('sawtooth', midiToHz(57), when, seconds + 0.04);
    osc.frequency.exponentialRampToValueAtTime(midiToHz(21), when + seconds);
    osc.connect(filter);
    filter.connect(env);
    env.connect(this.bus);
  }
}
