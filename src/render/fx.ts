/** Purely decorative motion, fed by the simulation's events. Nothing here can affect a run. */
import type { GameEvent } from '../sim/game.ts';
import { ECHO_BODY, INK, MUSTARD, VERMILION, eraInk } from './ink.ts';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'dot' | 'ring' | 'line';
}

const BASE_MISREGISTER = 1.6;

export class Fx {
  particles: Particle[] = [];
  shake = 0;
  misregister = BASE_MISREGISTER;
  readonly reducedMotion: boolean;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  clear(): void {
    this.particles = [];
    this.shake = 0;
    this.misregister = BASE_MISREGISTER;
  }

  private burst(x: number, y: number, count: number, speed: number, life: number, size: number, colors: string[]): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const pace = speed * (0.3 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * pace,
        vy: Math.sin(angle) * pace,
        life: life * (0.6 + Math.random() * 0.6),
        max: life,
        size: size * (0.5 + Math.random()),
        color: colors[i % colors.length],
        kind: 'dot',
      });
    }
  }

  private ring(x: number, y: number, size: number, life: number, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life, max: life, size, color, kind: 'ring' });
  }

  on(event: GameEvent): void {
    switch (event.type) {
      case 'shard':
        this.ring(event.x, event.y, 60, 0.45, INK);
        this.burst(event.x, event.y, 12, 190, 0.45, 3, [INK, MUSTARD]);
        break;
      case 'graze': {
        if (Math.random() < 0.45) {
          const midX = (event.x + event.echoX) / 2;
          const midY = (event.y + event.echoY) / 2;
          this.particles.push({
            x: midX,
            y: midY,
            vx: (midY - event.y) * 3,
            vy: (event.x - midX) * 3,
            life: 0.18,
            max: 0.18,
            size: 7,
            color: VERMILION,
            kind: 'line',
          });
        }
        break;
      }
      case 'charge':
        this.misregister = Math.max(this.misregister, 4);
        break;
      case 'dash':
        this.shake = Math.max(this.shake, 2.5);
        break;
      case 'kill':
        this.ring(event.x, event.y, 90, 0.5, eraInk(event.loop));
        this.burst(event.x, event.y, 34, 340, 0.7, 4.5, [ECHO_BODY, eraInk(event.loop)]);
        this.shake = Math.max(this.shake, 8);
        this.misregister = Math.max(this.misregister, 7);
        break;
      case 'hit':
        this.burst(event.x, event.y, 40, 300, 0.7, 4.5, [VERMILION, INK]);
        this.ring(event.x, event.y, 150, 0.6, VERMILION);
        this.shake = Math.max(this.shake, 16);
        this.misregister = Math.max(this.misregister, 13);
        break;
      case 'missedQuota':
        this.shake = Math.max(this.shake, 10);
        this.misregister = Math.max(this.misregister, 9);
        break;
      default:
        break;
    }
    if (this.reducedMotion) this.shake = 0;
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 1 - 3.2 * dt;
      particle.vy *= 1 - 3.2 * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.shake = Math.max(0, this.shake - this.shake * 7 * dt - 0.2 * dt);
    this.misregister += (BASE_MISREGISTER - this.misregister) * Math.min(1, 5 * dt);
  }
}
