/** The print: every route of a run, overprinted, at a size worth keeping. */
import { HEIGHT, WIDTH } from '../sim/constants.ts';
import type { Game } from '../sim/game.ts';
import { DISPLAY_FONT, INK, MONO_FONT, MUSTARD, MUTED, VERMILION, drawCross, drawDiamond, fillPaper, printRoutes } from './ink.ts';

const SCALE = 2.3;
const MARGIN = 100;
const CAPTION = 300;

export function renderPoster(g: Game, durationSeconds: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const arenaW = WIDTH * SCALE;
  const arenaH = HEIGHT * SCALE;
  canvas.width = arenaW + MARGIN * 2;
  canvas.height = arenaH + MARGIN + CAPTION;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  fillPaper(ctx, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(MARGIN, MARGIN);

  ctx.strokeStyle = 'rgba(24, 32, 58, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, arenaW, arenaH);

  ctx.scale(SCALE, SCALE);
  printRoutes(ctx, g, 2, 0.9);

  // Every shard the run took, as small marks in the order they were taken.
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = MUSTARD;
  for (const echo of g.echoes) {
    for (const pickup of echo.pickups) {
      drawDiamond(ctx, pickup.x, pickup.y, 4.5, 0);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = VERMILION;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(g.x, g.y, 9, 0, Math.PI * 2);
  ctx.stroke();
  drawCross(ctx, g.x, g.y, 3.6);
  ctx.restore();

  const baseline = arenaH + MARGIN + 130;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `800 104px ${DISPLAY_FONT}`;
  ctx.fillText('LOOPBACK', MARGIN, baseline);

  ctx.font = `500 30px ${MONO_FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`Seed ${g.seed >>> 0}`, MARGIN, baseline + 60);

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = String(durationSeconds % 60).padStart(2, '0');
  const lines = [
    `${g.loop} loops in ${minutes}:${seconds}`,
    `${g.score.toLocaleString('en-US')} points`,
    `${g.totalShards} shards taken, ${g.kills} echoes erased`,
  ];
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = `500 34px ${MONO_FONT}`;
  lines.forEach((line, i) => ctx.fillText(line, canvas.width - MARGIN, baseline - 60 + i * 52));

  return canvas;
}
