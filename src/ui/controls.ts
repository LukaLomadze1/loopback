/**
 * Keyboard, mouse and touch, all reduced to the same input byte. Whichever was touched last is in charge.
 *
 *     keys     WASD or arrows to move, Space or Shift to dash
 *     mouse    the player heads for the pointer, click to dash
 *     touch    drag anywhere to steer, tap or use a second finger to dash
 */
import type { Game } from '../sim/game.ts';
import { headingToward, packInput } from '../sim/input.ts';
import type { Renderer } from '../render/renderer.ts';

const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const DASH = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyJ']);
const MOVEMENT = new Set([...LEFT, ...RIGHT, ...UP, ...DOWN]);

const STICK_DEADZONE = 10;
const TAP_MS = 170;
const POINTER_DEADZONE2 = 36;
const MOUSE_TAKEOVER = 2;

interface Stick {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  startedAt: number;
  steering: boolean;
}

export class Controls {
  private readonly renderer: Renderer;
  private readonly held = new Set<string>();
  private device: 'keys' | 'mouse' | 'touch' = 'keys';
  private mouse: { x: number; y: number } | null = null;
  private stick: Stick | null = null;
  private dashQueued = false;
  enabled = false;

  constructor(target: HTMLElement, renderer: Renderer) {
    this.renderer = renderer;

    window.addEventListener('keydown', (event) => {
      if (!this.enabled) return;
      if (!MOVEMENT.has(event.code) && !DASH.has(event.code)) return;
      event.preventDefault();
      this.device = 'keys';
      if (DASH.has(event.code) && !event.repeat) this.dashQueued = true;
      this.held.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.held.delete(event.code));
    window.addEventListener('blur', () => this.held.clear());

    target.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') {
        // A real movement, not a bumped desk, is what hands control from the keys to the mouse.
        if (this.enabled && Math.abs(event.movementX) + Math.abs(event.movementY) > MOUSE_TAKEOVER) this.device = 'mouse';
        this.mouse = { x: event.clientX, y: event.clientY };
      } else if (this.stick?.id === event.pointerId) {
        this.stick.dx = event.clientX - this.stick.startX;
        this.stick.dy = event.clientY - this.stick.startY;
        if (Math.hypot(this.stick.dx, this.stick.dy) > STICK_DEADZONE) this.stick.steering = true;
      }
    });

    target.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.pointerType === 'mouse') {
        this.device = 'mouse';
        this.mouse = { x: event.clientX, y: event.clientY };
        this.dashQueued = true;
        return;
      }
      this.device = 'touch';
      if (this.stick) {
        this.dashQueued = true;
      } else {
        this.stick = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          dx: 0,
          dy: 0,
          startedAt: performance.now(),
          steering: false,
        };
      }
    });

    const release = (event: PointerEvent): void => {
      if (this.stick?.id !== event.pointerId) return;
      if (!this.stick.steering && performance.now() - this.stick.startedAt < TAP_MS) this.dashQueued = true;
      this.stick = null;
    };
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
  }

  reset(): void {
    this.held.clear();
    this.stick = null;
    this.dashQueued = false;
  }

  /** The input for the next tick, in the form the simulation and the replay both use. */
  read(g: Game): number {
    let heading: number | null = null;

    if (this.device === 'keys') {
      const dx = (this.isHeld(RIGHT) ? 1 : 0) - (this.isHeld(LEFT) ? 1 : 0);
      const dy = (this.isHeld(DOWN) ? 1 : 0) - (this.isHeld(UP) ? 1 : 0);
      if (dx !== 0 || dy !== 0) {
        const direction = this.renderer.directionToArena(dx, dy);
        heading = headingToward(direction.x, direction.y);
      }
    } else if (this.device === 'mouse' && this.mouse) {
      const aim = this.renderer.toArena(this.mouse.x, this.mouse.y);
      const dx = aim.x - g.x;
      const dy = aim.y - g.y;
      if (dx * dx + dy * dy > POINTER_DEADZONE2) heading = headingToward(dx, dy);
    } else if (this.device === 'touch' && this.stick?.steering) {
      const direction = this.renderer.directionToArena(this.stick.dx, this.stick.dy);
      heading = headingToward(direction.x, direction.y);
    }

    const dash = this.dashQueued || this.isHeld(DASH);
    this.dashQueued = false;
    return packInput(heading, dash);
  }

  private isHeld(codes: Set<string>): boolean {
    for (const code of codes) if (this.held.has(code)) return true;
    return false;
  }
}
