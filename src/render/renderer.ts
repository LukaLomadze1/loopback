/**
 * Draws the game on one Canvas 2D context. The arena is always 960 by 600 in its own coordinates, and on
 * a tall screen the whole thing is turned on its side, so the simulation never knows about phones.
 */
import { STEPS, STEP_TICKS, degreeOf, stepOf, DEGREES } from '../audio/score.ts';
import type { WayOut } from '../bot/wayout.ts';
import { CYCLE_TICKS, GRACE_TICKS, HEIGHT, HIT_REWIND_TICKS, LOOP_TICKS, MAX_CHARGES, REWIND_TICKS, START_INTEGRITY, WIDTH, quotaFor } from '../sim/constants.ts';
import type { Echo, Game } from '../sim/game.ts';
import type { Fx } from './fx.ts';
import {
  DISPLAY_FONT,
  ECHO_BODY,
  INK,
  MONO_FONT,
  MUSTARD,
  MUTED,
  PAPER,
  VERMILION,
  drawCross,
  drawDiamond,
  eraInk,
  fillPaper,
  tracePath,
} from './ink.ts';

const LIVE_EXPOSURE = 0.42;
const FADED_EXPOSURE = 0.13;
const EXPOSURE_SCALE = 1.5;
const EXPOSURE_LINE = 2.2;
const TAU = Math.PI * 2;

export interface Scene {
  g: Game;
  prevX: number;
  prevY: number;
  /** How far between the last two ticks this frame falls, from 0 to 1. */
  alpha: number;
  fx: Fx;
  hud: boolean;
  /** Seconds since the page loaded, for things that shimmer. */
  time: number;
  /** 0 during play, rising to 1 as the finished print develops. */
  develop: number;
  wayOut: WayOut | null;
  /** Point at the first echo and say what it is, the first time someone sees one. */
  labelFirstEcho: boolean;
  replaySpeed: number | null;
}

interface Layout {
  width: number;
  height: number;
  dpr: number;
  hudHeight: number;
  scale: number;
  originX: number;
  originY: number;
  rotated: boolean;
  /** Narrow screens put the sequencer on its own row. */
  stacked: boolean;
}

const easeInOut = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

function sample(values: Float32Array, t: number): number {
  const low = Math.floor(t);
  const high = Math.min(LOOP_TICKS, low + 1);
  return values[low] + (values[high] - values[low]) * (t - low);
}

/** The moment of the loop being shown. During a rewind, this is what runs backward. */
export function displayTime(g: Game, alpha: number): number {
  if (g.phase === 'loopRewind') {
    const progress = Math.min(1, 1 - (g.timer - alpha) / REWIND_TICKS);
    return LOOP_TICKS * (1 - easeInOut(progress));
  }
  if (g.phase === 'hitRewind') {
    const progress = Math.min(1, 1 - (g.timer - alpha) / HIT_REWIND_TICKS);
    return g.rewindFrom + (g.rewindTo - g.rewindFrom) * easeInOut(progress);
  }
  if (g.phase === 'over') return g.t;
  return Math.max(0, g.t - 1 + alpha);
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paper = document.createElement('canvas');
  private readonly exposure = document.createElement('canvas');
  private readonly exposureCtx: CanvasRenderingContext2D;
  private exposedEchoes = 0;
  layout: Layout = { width: 1, height: 1, dpr: 1, hudHeight: 0, scale: 1, originX: 0, originY: 0, rotated: false, stacked: false };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser has no 2D canvas');
    this.ctx = ctx;

    this.exposure.width = WIDTH * EXPOSURE_SCALE;
    this.exposure.height = HEIGHT * EXPOSURE_SCALE;
    const exposureCtx = this.exposure.getContext('2d');
    if (!exposureCtx) throw new Error('This browser has no 2D canvas');
    exposureCtx.scale(EXPOSURE_SCALE, EXPOSURE_SCALE);
    this.exposureCtx = exposureCtx;
  }

  fit(options: { hud: boolean; reserveBottom: number }): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const stacked = width < 840;
    const hudHeight = options.hud ? (stacked ? 100 : 68) : 0;
    const pad = width < 600 ? 10 : 22;

    const availableW = width - pad * 2;
    const availableH = height - hudHeight - options.reserveBottom - pad * 2;
    const rotated = availableH > availableW * 1.15;
    const arenaW = rotated ? HEIGHT : WIDTH;
    const arenaH = rotated ? WIDTH : HEIGHT;
    const scale = Math.max(0.1, Math.min(availableW / arenaW, availableH / arenaH));
    const originX = (width - arenaW * scale) / 2;
    const originY = hudHeight + pad + Math.max(0, (availableH - arenaH * scale) / 2);

    this.layout = { width, height, dpr, hudHeight, scale, originX, originY, rotated, stacked };
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.bakePaper();
  }

  /** CSS pixels to arena coordinates. */
  toArena(clientX: number, clientY: number): { x: number; y: number } {
    const { originX, originY, scale, rotated } = this.layout;
    if (rotated) return { x: (clientY - originY) / scale, y: HEIGHT - (clientX - originX) / scale };
    return { x: (clientX - originX) / scale, y: (clientY - originY) / scale };
  }

  /** A direction on the screen to the same direction in the arena. */
  directionToArena(dx: number, dy: number): { x: number; y: number } {
    return this.layout.rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
  }

  private applyArena(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    const { dpr, scale, originX, originY, rotated } = this.layout;
    const s = scale * dpr;
    if (rotated) ctx.setTransform(0, s, -s, 0, (originX + HEIGHT * scale + offsetX) * dpr, (originY + offsetY) * dpr);
    else ctx.setTransform(s, 0, 0, s, (originX + offsetX) * dpr, (originY + offsetY) * dpr);
  }

  private bakePaper(): void {
    const { width, height, dpr, scale } = this.layout;
    this.paper.width = this.canvas.width;
    this.paper.height = this.canvas.height;
    const ctx = this.paper.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    fillPaper(ctx, width * dpr, height * dpr);

    this.applyArena(ctx);
    const px = 1 / scale;

    ctx.fillStyle = 'rgba(24, 32, 58, 0.17)';
    for (let x = 60; x < WIDTH; x += 60) {
      for (let y = 60; y < HEIGHT; y += 60) ctx.fillRect(x - px, y - px, 2 * px, 2 * px);
    }

    ctx.strokeStyle = 'rgba(24, 32, 58, 0.55)';
    ctx.lineWidth = px;
    ctx.strokeRect(0, 0, WIDTH, HEIGHT);

    // Printer's crop marks and registration targets, outside the frame.
    const mark = 12 * px;
    const gap = 5 * px;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [
      [0, 0, -1, -1],
      [WIDTH, 0, 1, -1],
      [0, HEIGHT, -1, 1],
      [WIDTH, HEIGHT, 1, 1],
    ]) {
      ctx.moveTo(x + sx * gap, y);
      ctx.lineTo(x + sx * (gap + mark), y);
      ctx.moveTo(x, y + sy * gap);
      ctx.lineTo(x, y + sy * (gap + mark));
    }
    ctx.stroke();
  }

  // ----- The long exposure ---------------------------------------------------------------------------

  /** Burns finished loops into the exposure. The loop in progress is drawn live, because it can still be rewound. */
  expose(g: Game): void {
    const ctx = this.exposureCtx;
    while (this.exposedEchoes < g.echoes.length) {
      const echo = g.echoes[this.exposedEchoes++];
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = EXPOSURE_LINE;
      ctx.strokeStyle = eraInk(echo.loop);
      tracePath(ctx, echo.xs, echo.ys, LOOP_TICKS);
      ctx.stroke();
      ctx.restore();
    }
  }

  clearExposure(): void {
    this.exposureCtx.clearRect(0, 0, WIDTH, HEIGHT);
    this.exposedEchoes = 0;
  }

  // ----- The frame -----------------------------------------------------------------------------------

  draw(scene: Scene): void {
    const { ctx, layout } = this;
    const { g, fx } = scene;
    const shakeX = fx.shake * (Math.random() - 0.5) * 2;
    const shakeY = fx.shake * (Math.random() - 0.5) * 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.paper, 0, 0);

    this.applyArena(ctx, shakeX, shakeY);

    const t = displayTime(g, scene.alpha);
    const rewinding = g.phase === 'loopRewind' || g.phase === 'hitRewind';
    const fade = 1 - scene.develop;

    // Old routes recede as they pile up, so a long run's print never hides the things that can hit you.
    const exposure = Math.max(FADED_EXPOSURE, LIVE_EXPOSURE - g.echoes.length * 0.013);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = exposure + (1 - exposure) * scene.develop;
    ctx.drawImage(this.exposure, 0, 0, WIDTH, HEIGHT);
    if (g.phase !== 'loopRewind') this.drawCurrentRoute(g, t);
    ctx.strokeStyle = INK;
    ctx.lineWidth = EXPOSURE_LINE;
    for (const echo of g.echoes) {
      if (echo.erasedAt) drawCross(ctx, echo.erasedAt.x, echo.erasedAt.y, 7);
    }
    ctx.globalAlpha = 1;

    if (fade > 0) {
      this.drawLoopStamp(g, t, scene);
      if (g.phase !== 'over') this.drawShard(g, scene.time);
      ctx.globalAlpha = fade;
      for (const echo of g.echoes) {
        if (echo.alive) this.drawEcho(echo, t, rewinding, fx.misregister);
      }
      ctx.globalAlpha = 1;
      if (scene.labelFirstEcho && g.phase === 'play') this.drawFirstEchoLabel(g, t);
    }

    this.drawParticles(fx);
    if (scene.wayOut) this.drawWayOut(g, scene.wayOut);

    const position = this.playerPosition(scene, t);
    if (g.phase === 'over') this.drawWreck(position.x, position.y);
    else this.drawPlayer(g, position.x, position.y, fx.misregister, scene.time);

    if (scene.hud) this.drawHud(scene, layout);
  }

  /** This loop's route so far. During a rewind it visibly reels back in. */
  private drawCurrentRoute(g: Game, t: number): void {
    const { ctx } = this;
    const end = Math.floor(t);
    if (end < 1) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = EXPOSURE_LINE;
    ctx.strokeStyle = eraInk(g.loop);
    tracePath(ctx, g.xs, g.ys, end);
    ctx.lineTo(sample(g.xs, t), sample(g.ys, t));
    ctx.stroke();
  }

  private playerPosition(scene: Scene, t: number): { x: number; y: number } {
    const { g, alpha, prevX, prevY } = scene;
    if (g.phase === 'hitRewind') return { x: sample(g.xs, t), y: sample(g.ys, t) };
    if (g.phase === 'play') return { x: prevX + (g.x - prevX) * alpha, y: prevY + (g.y - prevY) * alpha };
    return { x: g.x, y: g.y };
  }

  private upright(x: number, y: number, draw: () => void): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    if (this.layout.rotated) ctx.rotate(-Math.PI / 2);
    draw();
    ctx.restore();
  }

  private drawLoopStamp(g: Game, t: number, scene: Scene): void {
    const { ctx } = this;
    const rewinding = g.phase === 'loopRewind';
    const strength = rewinding ? 0.12 : g.phase === 'play' ? Math.max(0, 1 - t / 70) * 0.13 : 0;
    if (strength <= 0) return;
    ctx.save();
    ctx.globalAlpha = strength * (1 - scene.develop);
    ctx.fillStyle = INK;
    if (rewinding) {
      this.upright(WIDTH / 2, HEIGHT / 2, () => {
        for (const offset of [-52, 52]) {
          ctx.beginPath();
          ctx.moveTo(offset - 52, 0);
          ctx.lineTo(offset + 52, -70);
          ctx.lineTo(offset + 52, 70);
          ctx.closePath();
          ctx.fill();
        }
      });
    } else {
      this.upright(WIDTH / 2, HEIGHT / 2, () => {
        ctx.font = `800 300px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(g.loop), 0, 0);
      });
    }
    ctx.restore();
  }

  private drawShard(g: Game, time: number): void {
    const { ctx } = this;
    const pulse = (Math.sin(time * 5) + 1) / 2;
    const urgent = g.collected < quotaFor(g.loop) && g.phase === 'play' && g.t > LOOP_TICKS - 120;
    const turn = time * 0.9;

    ctx.lineWidth = 1.6;
    ctx.strokeStyle = urgent ? VERMILION : INK;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(g.shardX, g.shardY, 20 + pulse * 7, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = MUSTARD;
    drawDiamond(ctx, g.shardX + 2.4, g.shardY + 1.6, 13, turn);
    ctx.fill();
    ctx.fillStyle = urgent ? VERMILION : INK;
    drawDiamond(ctx, g.shardX, g.shardY, 13, turn);
    ctx.fill();
  }

  private drawEcho(echo: Echo, t: number, rewinding: boolean, misregister: number): void {
    const { ctx } = this;
    const x = sample(echo.xs, t);
    const y = sample(echo.ys, t);
    const ink = eraInk(echo.loop);
    const lethal = t >= GRACE_TICKS || rewinding;

    // Where it is about to go. All of this is known, so the game shows it.
    const near = Math.min(LOOP_TICKS, Math.ceil(t) + 21);
    const far = Math.min(LOOP_TICKS, Math.ceil(t) + 54);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const base = ctx.globalAlpha;
    ctx.strokeStyle = ECHO_BODY;
    ctx.lineWidth = rewinding ? 3 : 2.4;
    ctx.globalAlpha = base * (rewinding ? 0.75 : 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = Math.ceil(t); i <= near; i += 3) ctx.lineTo(echo.xs[i], echo.ys[i]);
    ctx.lineTo(echo.xs[near], echo.ys[near]);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = base * 0.28;
    ctx.beginPath();
    ctx.moveTo(echo.xs[near], echo.ys[near]);
    for (let i = near; i <= far; i += 3) ctx.lineTo(echo.xs[i], echo.ys[i]);
    ctx.lineTo(echo.xs[far], echo.ys[far]);
    ctx.stroke();
    ctx.globalAlpha = base;

    const radius = 12;
    if (lethal) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x + misregister, y + misregister * 0.6, radius, 0, TAU);
      ctx.fill();
      ctx.fillStyle = ECHO_BODY;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    } else {
      // Harmless for now. It fills up as the grace period runs out, so you can see how long you have.
      const filled = t / GRACE_TICKS;
      ctx.strokeStyle = ECHO_BODY;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ECHO_BODY;
      ctx.beginPath();
      ctx.arc(x, y, radius * filled * filled, 0, TAU);
      ctx.fill();
    }

    if (lethal) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = PAPER;
      ctx.font = `500 ${echo.loop > 99 ? 9 : 11}px ${MONO_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.upright(x, y + 0.5, () => ctx.fillText(String(echo.loop), 0, 0));
      ctx.restore();
    }
  }

  private drawFirstEchoLabel(g: Game, t: number): void {
    const echo = g.echoes[0];
    if (!echo?.alive) return;
    const { ctx } = this;
    const x = sample(echo.xs, t);
    const y = sample(echo.ys, t);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = INK;
    ctx.font = `500 13px ${MONO_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = x > WIDTH - 180 ? 'right' : 'left';
    const side = x > WIDTH - 180 ? -22 : 22;
    this.upright(x + (this.layout.rotated ? 0 : side), y + (this.layout.rotated ? 26 : 0), () => {
      ctx.fillText('you, 8 seconds ago', 0, 0);
    });
    ctx.restore();
  }

  private drawParticles(fx: Fx): void {
    const { ctx } = this;
    for (const particle of fx.particles) {
      const left = particle.life / particle.max;
      ctx.globalAlpha = Math.min(1, left * 1.4);
      if (particle.kind === 'ring') {
        const growth = 1 - left;
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 2.5 * left + 0.4;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (1 - (1 - growth) ** 3), 0, TAU);
        ctx.stroke();
      } else if (particle.kind === 'line') {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.05, particle.y - particle.vy * 0.05);
        ctx.stroke();
      } else {
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * left, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPlayer(g: Game, x: number, y: number, misregister: number, time: number): void {
    const { ctx } = this;
    ctx.save();

    if (g.dashLeft > 0) {
      ctx.fillStyle = VERMILION;
      for (let i = 1; i <= 5; i++) {
        ctx.globalAlpha = 0.34 - i * 0.05;
        ctx.beginPath();
        ctx.arc(x - g.dashX * i * 15, y - g.dashY * i * 15, 10 - i * 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (g.invuln > 0 && g.dashLeft === 0) ctx.globalAlpha = 0.45 + 0.4 * Math.sin(time * 34);

    ctx.fillStyle = MUSTARD;
    ctx.beginPath();
    ctx.arc(x - misregister * 0.7, y + misregister * 0.5, 10, 0, TAU);
    ctx.fill();
    ctx.fillStyle = VERMILION;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x + g.headX * 4.5, y + g.headY * 4.5, 2.6, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;

    // The dash meter lives on the player, because that is where everyone is looking.
    if (g.charges < MAX_CHARGES && g.meter > 0.005) {
      ctx.strokeStyle = VERMILION;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + TAU * g.meter);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    for (let i = 0; i < g.charges; i++) {
      const angle = time * 2.4 + (i * TAU) / Math.max(1, g.charges);
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * 21, y + Math.sin(angle) * 21, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawWreck(x: number, y: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = VERMILION;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2.4;
    drawCross(ctx, x, y, 5);
    ctx.restore();
  }

  /** Where the two timelines forked: what the player did, solid, and what the solver found, dotted. */
  private drawWayOut(g: Game, way: WayOut): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = VERMILION;
    ctx.fillStyle = VERMILION;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.xs[way.fromT], g.ys[way.fromT]);
    for (let t = way.fromT + 1; t <= g.t; t++) ctx.lineTo(g.xs[t], g.ys[t]);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.setLineDash([1, 8]);
    tracePath(ctx, way.xs, way.ys, way.xs.length - 1);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = PAPER;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(way.xs[0], way.ys[0], 6, 0, TAU);
    ctx.fill();
    ctx.stroke();

    const last = way.xs.length - 1;
    ctx.fillStyle = VERMILION;
    drawDiamond(ctx, way.xs[last], way.ys[last], 8, 0);
    ctx.fill();
    ctx.restore();
  }

  // ----- The bar across the top ----------------------------------------------------------------------

  private drawHud(scene: Scene, layout: Layout): void {
    const { ctx } = this;
    const { g } = scene;
    const { dpr, width, stacked } = layout;
    const pad = width < 600 ? 12 : 24;
    const rowY = stacked ? 34 : 38;
    // Phones have room for all of this only if every group gives a little.
    const compact = width < 600;
    const metrics = compact
      ? { quotaX: 50, diamond: 6, diamondGap: 15, score: 22, livesW: 60, life: 5.5, lifeGap: 15, dashW: 58, cell: 14, cellGap: 16 }
      : { quotaX: 62, diamond: 7.5, diamondGap: 20, score: 26, livesW: 92, life: 6.5, lifeGap: 19, dashW: 84, cell: 18, cellGap: 22 };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const label = (text: string, x: number, y: number): void => {
      ctx.font = `500 10px ${MONO_FONT}`;
      ctx.fillStyle = MUTED;
      ctx.fillText(text, x, y);
    };

    // Left: which loop, and how many shards it still wants.
    label(scene.replaySpeed === null ? 'LOOP' : `REPLAY ${scene.replaySpeed}x`, pad, rowY - 19);
    ctx.font = `800 30px ${DISPLAY_FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(String(g.loop).padStart(2, '0'), pad, rowY + 11);

    const quota = quotaFor(g.loop);
    const quotaX = pad + metrics.quotaX;
    label('QUOTA', quotaX, rowY - 19);
    for (let i = 0; i < quota; i++) {
      const done = i < g.collected;
      const x = quotaX + 8 + i * metrics.diamondGap;
      ctx.lineWidth = 1.6;
      drawDiamond(ctx, x, rowY + 2, metrics.diamond, 0);
      if (done) {
        ctx.fillStyle = INK;
        ctx.fill();
      } else {
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    if (g.collected > quota) {
      ctx.font = `500 ${compact ? 11 : 13}px ${MONO_FONT}`;
      ctx.fillStyle = INK;
      ctx.fillText(`+${g.collected - quota}`, quotaX + quota * metrics.diamondGap + 2, rowY + 7);
    }

    // Right: score, lives and dashes.
    ctx.textAlign = 'right';
    label('SCORE', width - pad, rowY - 19);
    ctx.font = `800 ${metrics.score}px ${DISPLAY_FONT}`;
    ctx.fillStyle = INK;
    const scoreText = g.score.toLocaleString('en-US');
    ctx.fillText(scoreText, width - pad, rowY + 10);
    const scoreWidth = Math.max(compact ? 62 : 68, ctx.measureText(scoreText).width);
    ctx.textAlign = 'left';

    const livesX = width - pad - scoreWidth - metrics.livesW;
    label('LIVES', livesX, rowY - 19);
    for (let i = 0; i < START_INTEGRITY; i++) {
      const x = livesX + 7 + i * metrics.lifeGap;
      ctx.beginPath();
      ctx.arc(x, rowY + 2, metrics.life, 0, TAU);
      if (i < g.integrity) {
        ctx.fillStyle = VERMILION;
        ctx.fill();
      } else {
        ctx.strokeStyle = MUTED;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    const dashX = livesX - metrics.dashW;
    label('DASH', dashX, rowY - 19);
    for (let i = 0; i < MAX_CHARGES; i++) {
      const x = dashX + i * metrics.cellGap;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.5, rowY - 3.5, metrics.cell, 10);
      const fill = i < g.charges ? 1 : i === g.charges ? g.meter : 0;
      if (fill > 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(x + 0.5, rowY - 3.5, metrics.cell * fill, 10);
      }
    }

    // Centre: the loop as a step sequencer, showing the tune this run has written so far.
    const left = stacked ? pad : pad + metrics.quotaX + metrics.diamondGap * Math.max(quota, 2) + 44;
    const right = stacked ? width - pad : dashX - 26;
    const top = stacked ? 60 : 12;
    const height = stacked ? 32 : 44;
    if (right - left > 120) this.drawSequencer(g, left, right - left, top, height);
  }

  private drawSequencer(g: Game, x: number, width: number, top: number, height: number): void {
    const { ctx } = this;
    const stepWidth = width / STEPS;
    const laneHeight = (height - 6) / DEGREES;

    ctx.fillStyle = 'rgba(24, 32, 58, 0.06)';
    ctx.fillRect(x + (LOOP_TICKS / CYCLE_TICKS) * width, top, (REWIND_TICKS / CYCLE_TICKS) * width, height);

    for (let step = 0; step <= STEPS; step++) {
      const major = step % 8 === 0;
      if (!major && step % 2 !== 0) continue;
      ctx.fillStyle = major ? 'rgba(24, 32, 58, 0.5)' : 'rgba(24, 32, 58, 0.16)';
      const tick = major ? height : 5;
      ctx.fillRect(x + step * stepWidth, major ? top : top + height - tick, 1, tick);
    }
    ctx.fillStyle = 'rgba(24, 32, 58, 0.5)';
    ctx.fillRect(x, top + height, width + 1, 1);

    const position = g.phase === 'play' ? g.t : g.phase === 'loopRewind' ? LOOP_TICKS + (REWIND_TICKS - g.timer) : g.t;
    const playingStep = Math.floor(position / STEP_TICKS);
    const size = Math.min(stepWidth * 0.5, 5);

    for (const echo of g.echoes) {
      if (!echo.alive) continue;
      for (const pickup of echo.pickups) {
        const step = stepOf(pickup);
        const lit = step === playingStep;
        ctx.fillStyle = lit ? VERMILION : ECHO_BODY;
        ctx.globalAlpha = lit ? 1 : 0.62;
        const y = top + 3 + (DEGREES - 1 - degreeOf(pickup)) * laneHeight;
        ctx.fillRect(x + step * stepWidth + stepWidth * 0.25, y, size, laneHeight - 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = VERMILION;
    for (const pickup of g.pickups) {
      const y = top + 3 + (DEGREES - 1 - degreeOf(pickup)) * laneHeight;
      ctx.fillRect(x + stepOf(pickup) * stepWidth + stepWidth * 0.25, y, size, laneHeight - 1);
    }

    ctx.fillRect(x + (position / CYCLE_TICKS) * width - 0.75, top - 2, 1.5, height + 4);
  }
}
