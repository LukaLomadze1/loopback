/**
 * The look of the game: a riso print. Flat inks on warm paper, overprinted with multiply so crossings
 * go darker, and very slightly out of register. Vermilion belongs to the player and nothing else.
 */
import { LOOP_TICKS } from '../sim/constants.ts';
import type { Game } from '../sim/game.ts';

export const PAPER = '#f3eee2';
export const INK = '#18203a';
export const MUTED = '#6d6c64';
export const VERMILION = '#ef4a25';
export const ECHO_BODY = '#1e2e7e';
export const MUSTARD = '#e3a21a';

/** Each stretch of five loops prints in the next ink, so a finished print shows the order things happened. */
const ERA_INKS = ['#2b4fd8', '#e8488f', '#0e9488', '#e3a21a'];

export const eraInk = (loop: number): string => ERA_INKS[Math.floor((loop - 1) / 5) % ERA_INKS.length];

export const DISPLAY_FONT = '"Bricolage Grotesque Variable", "Arial Narrow", system-ui, sans-serif';
export const MONO_FONT = '"DM Mono", ui-monospace, Consolas, monospace';

export function tracePath(ctx: CanvasRenderingContext2D, xs: ArrayLike<number>, ys: ArrayLike<number>, end: number): void {
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let t = 1; t <= end; t++) ctx.lineTo(xs[t], ys[t]);
}

/** Draws every route of a run into arena coordinates, overprinted. Used for the live print and the saved one. */
export function printRoutes(ctx: CanvasRenderingContext2D, g: Game, lineWidth: number, alpha: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = alpha;
  for (const echo of g.echoes) {
    ctx.strokeStyle = eraInk(echo.loop);
    tracePath(ctx, echo.xs, echo.ys, LOOP_TICKS);
    ctx.stroke();
  }
  if (g.phase !== 'loopRewind' && g.t > 0) {
    ctx.strokeStyle = eraInk(g.loop);
    tracePath(ctx, g.xs, g.ys, g.t);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = Math.min(1, alpha + 0.2);
  for (const echo of g.echoes) {
    if (echo.erasedAt) drawCross(ctx, echo.erasedAt.x, echo.erasedAt.y, lineWidth * 3.5);
  }
  ctx.restore();
}

export function drawCross(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
}

export function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, turn: number): void {
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const angle = turn + (i * Math.PI) / 2;
    const px = x + Math.cos(angle) * size;
    const py = y + Math.sin(angle) * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Paper with a fine speckle, like uncoated stock. The result is baked, so this only runs on a resize. */
export function fillPaper(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const tile = document.createElement('canvas');
  tile.width = 256;
  tile.height = 256;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return;
  const image = tileCtx.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const speck = Math.random();
    const dark = speck > 0.985 ? 48 : speck > 0.8 ? 14 : 0;
    image.data[i] = 90;
    image.data[i + 1] = 80;
    image.data[i + 2] = 60;
    image.data[i + 3] = dark;
  }
  tileCtx.putImageData(image, 0, 0);

  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
}
