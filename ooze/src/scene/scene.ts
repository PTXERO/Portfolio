// The living diorama in the middle of the screen. It reads the game state and
// draws it; it never changes the economy except through the tap it reports.
//
// Everything is drawn into a small buffer in "art pixels", then scaled up with
// hard edges. How much of each thing appears follows the log of what's owned,
// so the scene fills up as you grow without ever drawing thousands of sprites.

import { blit, PAL, type SpriteName } from '../art/sprites';
import type { GameState } from '../economy/types';
import { Swarm } from './swarm';

const QUIPS = ['eep!', 'hey!', 'rude.', 'blub', '!!', 'boop', 'why', 'mrrp', 'oi'];

interface Ripple {
  x: number;
  y: number;
  age: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
}

/** How many of a thing to draw for `owned` of it. */
export function visibleCount(owned: number, cap: number): number {
  if (owned <= 0) return 0;
  return Math.min(cap, Math.round(2 + 5 * Math.log2(1 + owned)));
}

/** Stable pseudo-random number in [0, 1) for a given index and salt. */
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private buffer = document.createElement('canvas');
  private b: CanvasRenderingContext2D;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  /** CSS pixels per art pixel. */
  private px = 3;
  private W = 0;
  private H = 0;
  private time = 0;
  private ripples: Ripple[] = [];
  private floaters: Floater[] = [];
  private flash = 0;
  private swarm = new Swarm();
  private stage = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.b = this.buffer.getContext('2d')!;
    this.fit();
  }

  fit(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    // Aim for about 130 art pixels across, whatever the screen.
    this.px = Math.max(2, Math.round(w / 130));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.W = Math.ceil(w / this.px);
    this.H = Math.ceil(h / this.px);
    this.buffer.width = this.W;
    this.buffer.height = this.H;
  }

  /** Converts a tap in CSS pixels (relative to the canvas) to art pixels. */
  toArt(x: number, y: number): [number, number] {
    return [x / this.px, y / this.px];
  }

  ripple(cssX: number, cssY: number): void {
    const [x, y] = this.toArt(cssX, cssY);
    this.ripples.push({ x, y, age: 0 });
    if (this.ripples.length > 5) this.ripples.shift();
  }

  float(cssX: number, cssY: number, text: string, color: string): void {
    this.floaters.push({ x: cssX + (Math.random() - 0.5) * 16, y: cssY, text, color, age: 0 });
    if (this.floaters.length > 24) this.floaters.shift();
  }

  /** Startles the cells under a finger; returns a quip if one was hit. */
  poke(cssX: number, cssY: number): string | null {
    const [x, y] = this.toArt(cssX, cssY);
    return this.swarm.poke(x, y) ? QUIPS[Math.floor(Math.random() * QUIPS.length)] : null;
  }

  evolveFlash(): void {
    this.flash = 1;
  }

  draw(state: GameState, dt: number): void {
    if (!this.W) this.fit();
    if (!this.W) return;
    this.time += dt;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 1);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < 1.1);
    this.flash = Math.max(0, this.flash - dt * 1.5);

    if (this.stage !== state.current) {
      this.stage = state.current;
      this.swarm.cells = [];
    }
    if (state.current === 'soup') this.drawSoup(state);
    else this.drawCell(state, dt);
    this.drawRipples();

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.buffer, 0, 0, this.W * this.px * this.dpr, this.H * this.px * this.dpr);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '700 18px "Pixelify Sans", monospace';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const f of this.floaters) {
      const y = f.y - f.age * 46;
      ctx.globalAlpha = Math.min(1, (1.1 - f.age) * 3);
      ctx.lineWidth = 4;
      ctx.strokeStyle = PAL.k;
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(242, 234, 215, ${this.flash})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /** Push from recent ripples, so stirring visibly moves things. */
  private displace(x: number, y: number): [number, number] {
    let dx = 0;
    let dy = 0;
    for (const r of this.ripples) {
      const ex = x - r.x;
      const ey = y - r.y;
      const d = Math.hypot(ex, ey) || 1;
      const ring = r.age * 40;
      const near = 1 - Math.abs(d - ring) / 10;
      if (near > 0) {
        const f = near * (1 - r.age) * 5;
        dx += (ex / d) * f;
        dy += (ey / d) * f;
      }
    }
    return [x + dx, y + dy];
  }

  private drawRipples(): void {
    const b = this.b;
    for (const r of this.ripples) {
      const rad = r.age * 40;
      b.fillStyle = r.age < 0.5 ? PAL.w : PAL.b;
      b.globalAlpha = 1 - r.age;
      // Pixel circle: points around the ring, snapped to the grid.
      const steps = Math.max(12, Math.round(rad * 6));
      for (let i = 0; i < steps; i++) {
        if (i % 3 === 2) continue; // a broken ring reads as water, not a UI circle
        const a = (i / steps) * Math.PI * 2;
        b.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad * 0.7), 1, 1);
      }
    }
    b.globalAlpha = 1;
  }

  private water(top: string[], floorY: number): void {
    const b = this.b;
    const bandH = Math.ceil(floorY / top.length);
    top.forEach((col, i) => {
      b.fillStyle = col;
      b.fillRect(0, i * bandH, this.W, bandH);
      if (i > 0) {
        b.fillStyle = top[i - 1];
        for (let x = i % 2; x < this.W; x += 2) b.fillRect(x, i * bandH, 1, 1);
        for (let x = (i + 1) % 2; x < this.W; x += 4) b.fillRect(x, i * bandH + 1, 1, 1);
      }
    });
  }

  private glints(color: string, floorY: number): void {
    const b = this.b;
    b.fillStyle = color;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor((i * 37 + this.time * (2 + (i % 4))) % (this.W + 20)) - 10;
      const y = 4 + ((i * 23) % Math.max(1, floorY - 16));
      b.fillRect(x, y, 3 + (i %3) * 2, 1);
    }
  }

  private drawSoup(state: GameState): void {
    const b = this.b;
    const W = this.W;
    const H = this.H;
    const t = this.time;
    const floor = Math.floor(H * 0.86);
    const gens = state.stages.soup.generators;

    this.water(['#3d6b5c', '#2f5a50', '#244a44', '#1a3a37', '#122c2c'], floor);
    // Shafts of light from the surface: dithered diagonal bands that drift.
    b.fillStyle = '#467563';
    for (let s = 0; s < 3; s++) {
      const x0 = W * (0.12 + s * 0.32) + Math.sin(t * 0.2 + s * 2) * 5;
      const depth = floor * (0.55 + s * 0.1);
      for (let y = 0; y < depth; y++) {
        const x = Math.floor(x0 + y * 0.35);
        // Thin out toward the bottom so the light fades instead of stopping.
        const keep = y < depth * 0.6 ? 2 : 4;
        for (let k = 0; k < 6; k++) if ((x + k + y) % keep === 0) b.fillRect(x + k, y, 1, 1);
      }
    }
    this.glints('#5d8d75', floor);

    // Silt floor with dark vent rocks that breathe bubbles.
    b.fillStyle = '#3b3a2f';
    b.fillRect(0, floor, W, H - floor);
    b.fillStyle = '#2b2a22';
    for (let i = 0; i < 30; i++) b.fillRect((i * 29) % W, floor + 2 + ((i * 7) % Math.max(1, H - floor - 2)), 2, 1);
    const vents = [Math.floor(W * 0.2), Math.floor(W * 0.68)];
    for (const vx of vents) {
      for (let y = 0; y < 8; y++) {
        const half = Math.round((8 - y) * 0.9);
        b.fillStyle = y < 2 ? '#1c1b16' : '#2b2a22';
        b.fillRect(vx - half, floor - y, half * 2, 1);
      }
      b.fillStyle = '#e8615a';
      b.fillRect(vx - 1, floor - 8, 2, 1);
      for (let i = 0; i < 4; i++) {
        const age = (t * 0.5 + i / 4 + vx * 0.01) % 1;
        const by = floor - 9 - age * floor * 0.8;
        b.fillStyle = PAL.b;
        b.fillRect(Math.round(vx + Math.sin(age * 12 + i) * 2), Math.round(by), 1, 1);
      }
    }

    // Generators, drifting. Each kind moves its own way.
    const drift = (kind: number, n: number, speed: number, draw: (x: number, y: number, i: number) => void) => {
      for (let i = 0; i < n; i++) {
        const bx = hash(i, kind) * (W + 20);
        const by = 6 + hash(i, kind + 9) * (floor - 16);
        const dir = hash(i, kind + 3) < 0.5 ? -1 : 1;
        const sp = speed * (0.6 + hash(i, kind + 5) * 0.8);
        let x = ((bx + t * sp * dir) % (W + 20) + (W + 20)) % (W + 20) - 10;
        let y = by + Math.sin(t * (0.6 + hash(i, kind + 7)) + i) * 3;
        [x, y] = this.displace(x, y);
        draw(x, y, i);
      }
    };
    drift(1, visibleCount(gens.amino, 60), 2, (x, y, i) => {
      b.fillStyle = i % 3 ? PAL.y : PAL.Y;
      b.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (i % 4 === 0) b.fillRect(Math.round(x) + 1, Math.round(y), 1, 1);
    });
    drift(2, visibleCount(gens.lipid, 30), 1.5, (x, y) => blit(b, 'bubble', x, y));
    drift(3, visibleCount(gens.rna, 20), 3, (x, y, i) => blit(b, (Math.floor(t * 4 + i) % 2 ? 'rnaA' : 'rnaB') as SpriteName, x, y, i % 2 === 0));
    drift(4, visibleCount(gens.protocell, 12), 1, (x, y, i) => blit(b, 'protoSmall', x, y, i % 2 === 0));
  }

  private drawCell(state: GameState, dt: number): void {
    const b = this.b;
    const W = this.W;
    const H = this.H;
    const floor = Math.floor(H * 0.82);
    const gens = state.stages.cell.generators;

    this.water(['#2a7184', '#1d5a6e', '#184d60', '#134052', '#0d2b3a'], floor);
    this.glints('#3f8a99', floor);

    // Stromatolites grow as pillars at the back.
    const pillars = visibleCount(gens.stromatolite, 6);
    for (let i = 0; i < pillars; i++) {
      const px = Math.floor(W * (0.1 + 0.8 * hash(i, 41)));
      const ph = 10 + Math.floor(hash(i, 43) * 14);
      for (let y = 0; y < ph; y++) {
        b.fillStyle = (y >> 1) % 2 ? PAL.r : PAL.R;
        b.fillRect(px - 3, floor - y, 6, 1);
      }
      b.fillStyle = PAL.l;
      b.fillRect(px - 3, floor - ph, 6, 1);
    }

    // Sand.
    b.fillStyle = PAL.s;
    for (let x = 0; x < W; x++) {
      const top = floor + Math.round(Math.sin(x * 0.06) * 1.5);
      b.fillRect(x, top, 1, H - top);
    }
    b.fillStyle = PAL.S;
    for (let i = 0; i < 40; i++) b.fillRect((i * 29) % W, floor + 4 + ((i * 13) % Math.max(1, H - floor - 5)), 2, 1);

    // Microbial mats spread across the sand as you buy them.
    const matWidth = Math.min(W, gens.mat > 0 ? Math.round(W * (0.15 + 0.12 * Math.log2(1 + gens.mat))) : 0);
    for (let x = 0; x < matWidth; x++) {
      const mx = Math.floor((W - matWidth) / 2) + x;
      b.fillStyle = PAL.L;
      b.fillRect(mx, floor + 1, 1, 1);
      b.fillStyle = PAL.G;
      b.fillRect(mx, floor + 2, 1, 1);
    }

    // Rocks, with biofilm creeping over them.
    const film = visibleCount(gens.biofilm, 20);
    for (const [rx, r] of [
      [Math.floor(W * 0.78), 10],
      [Math.floor(W * 0.14), 7],
    ]) {
      for (let y = 0; y < r; y++) {
        const half = Math.round(Math.sqrt(1 - (y / r) ** 2) * r * 1.3);
        b.fillStyle = PAL.r;
        b.fillRect(rx - half, floor + 1 - y, half * 2, 1);
        if (y >= r - Math.ceil((film / 20) * r)) {
          b.fillStyle = y % 2 ? PAL.l : PAL.L;
          b.fillRect(rx - half, floor + 1 - y, half * 2, 1);
        }
      }
      b.fillStyle = PAL.R;
      b.fillRect(rx - Math.floor(r * 0.6), floor + 1 - Math.floor(r * 0.7), Math.floor(r * 0.6), 2);
    }

    // The swarm: dividing cells and colonies.
    this.swarm.setCount(visibleCount(gens.fission + gens.colony * 4, 120), W, floor);
    this.swarm.step(dt, this.time, W, floor);
    for (const c of this.swarm.cells) {
      const left = c.vx < 0;
      const flick = Math.floor(this.time * 8 + c.phase) % 2 === 0;
      blit(b, flick ? 'tailA' : 'tailB', c.x + (left ? 6 : -6), c.y, left);
      const squish = c.poked > 0 && Math.floor(this.time * 16) % 2 === 0;
      blit(b, squish ? 'cellSquish' : 'cell', c.x, c.y, left);
    }
  }
}
