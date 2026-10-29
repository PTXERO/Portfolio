// Shared drawing helpers and the short-lived effects system for the scene.

import { blit, PAL } from '../art/sprites';

/** What a stage painter gets each frame. All units are art pixels. */
export interface Frame {
  b: CanvasRenderingContext2D;
  W: number;
  H: number;
  t: number;
  dt: number;
  /** Rows hidden behind the overlays at the top; keep life below this. */
  top: number;
  /** Rows the open tab sheet covers at the bottom; the floor sits above them. */
  bottom: number;
  /** How open the tab sheet is, 0 (closed) to 1, eased. */
  open: number;
}

/**
 * Where the floor sits: just above the sheet when it's open, and lower (with half
 * as much ground showing) when it's closed. `share` is how far down the open
 * view the floor sits. It glides between the two as the sheet moves.
 */
export function floorY(f: Frame, share: number): number {
  const groundOpen = f.H - Math.floor((f.H - f.bottom) * share);
  return f.H - Math.round(groundOpen * (0.5 + 0.5 * f.open));
}

/** Stable pseudo-random number in [0, 1) for a given index and salt. */
export function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** How many of a thing to draw for `owned` of it: one each at first, then the log. */
export function visibleCount(owned: number, cap: number): number {
  if (owned <= 0) return 0;
  if (owned <= cap / 2) return owned;
  return Math.min(cap, Math.round(cap / 2 + 4 * Math.log2(1 + owned - cap / 2)));
}

export const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export function water(f: Frame, bands: string[], floorY: number): void {
  const { b, W } = f;
  const bandH = Math.ceil(floorY / bands.length);
  bands.forEach((col, i) => {
    b.fillStyle = col;
    b.fillRect(0, i * bandH, W, bandH);
    if (i > 0) {
      b.fillStyle = bands[i - 1];
      for (let x = i % 2; x < W; x += 2) b.fillRect(x, i * bandH, 1, 1);
      for (let x = (i + 1) % 2; x < W; x += 4) b.fillRect(x, i * bandH + 1, 1, 1);
    }
  });
}

export function glints(f: Frame, color: string, floorY: number): void {
  const { b, W, t } = f;
  b.fillStyle = color;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor((i * 37 + t * (2 + (i % 4))) % (W + 20)) - 10;
    const y = 4 + ((i * 23) % Math.max(1, floorY - 16));
    b.fillRect(x, y, 3 + (i % 3) * 2, 1);
  }
}

/** Mixes two #rrggbb colours. */
export function mixColor(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * Sediment below the floor: wavy bands that darken with depth, so the ground
 * under the scene (seen with the tab sheet closed) looks like layers of time.
 */
export function strata(f: Frame, floor: number, sand: string, deep: string): void {
  const { b, W, H } = f;
  const start = floor + 8;
  for (let y = start; y < H; y++) {
    const band = Math.floor((y - start) / 5);
    b.fillStyle = mixColor(sand, deep, Math.min(0.8, 0.1 + band * 0.09));
    b.fillRect(0, y, W, 1);
  }
  // Each band's top edge wanders a little, and the odd pebble is buried in it.
  for (let band = 1; start + band * 5 < H; band++) {
    const y0 = start + band * 5;
    b.fillStyle = mixColor(sand, deep, Math.min(0.9, 0.2 + band * 0.09));
    for (let x = 0; x < W; x += 2) b.fillRect(x, y0 + Math.round(Math.sin(x * 0.08 + band * 1.7) * 1.2), 2, 1);
    if (band % 2) {
      b.fillStyle = mixColor(sand, '#ffffff', 0.15);
      b.fillRect(Math.floor(hash(band, 5) * (W - 3)), y0 + 2, 2, 1);
    }
  }
}

/** A dotted pixel ring, the same look as a tap ripple. */
export function ring(b: CanvasRenderingContext2D, x: number, y: number, rad: number, color: string, squash = 0.7): void {
  b.fillStyle = color;
  const steps = Math.max(12, Math.round(rad * 6));
  for (let i = 0; i < steps; i++) {
    if (i % 3 === 2) continue;
    const a = (i / steps) * Math.PI * 2;
    b.fillRect(Math.round(x + Math.cos(a) * rad), Math.round(y + Math.sin(a) * rad * squash), 1, 1);
  }
}

/** A short-lived animation: drawn every frame until its life runs out. */
export interface Fx {
  age: number;
  life: number;
  draw(f: Frame, age: number): void;
}

export class Effects {
  list: Fx[] = [];

  add(life: number, draw: Fx['draw'], delay = 0): void {
    this.list.push({ age: -delay, life, draw });
  }

  run(f: Frame): void {
    for (const fx of this.list) {
      fx.age += f.dt;
      if (fx.age >= 0) fx.draw(f, fx.age);
    }
    this.list = this.list.filter((fx) => fx.age < fx.life);
  }

  clear(): void {
    this.list = [];
  }

  /** A twinkling sparkle at a point. */
  sparkle(x: number, y: number, delay = 0): void {
    this.add(0.6, (f, age) => blit(f.b, Math.floor(age * 10) % 2 ? 'sparkA' : 'sparkB', x, y), delay);
  }

  /** Pixels falling from the top and settling at `toY`. */
  rain(color: string, count: number, x0: number, x1: number, toY: (x: number) => number, life = 1.4): void {
    for (let i = 0; i < count; i++) {
      const x = Math.round(x0 + Math.random() * (x1 - x0));
      const delay = Math.random() * life * 0.4;
      const y1 = toY(x);
      this.add(
        life * 0.6,
        (f, age) => {
          f.b.fillStyle = color;
          f.b.fillRect(x + Math.round(Math.sin(age * 9 + i) * 1.5), Math.round(ease(age / (life * 0.6)) * y1), 1, 1);
        },
        delay,
      );
    }
  }

  /** Expanding dotted rings from a point. */
  pulse(x: number, y: number, color: string, delay = 0): void {
    this.add(0.9, (f, age) => ring(f.b, x, y, 3 + age * 22, color), delay);
  }

  dust(x: number, y: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const a = Math.PI + (i / (count - 1)) * Math.PI;
      this.add(0.6, (f, age) => {
        f.b.fillStyle = age < 0.3 ? PAL.s : PAL.S;
        f.b.fillRect(Math.round(x + Math.cos(a) * age * 14), Math.round(y + Math.sin(a) * age * 9 + age * age * 10), 1, 1);
      });
    }
  }
}
