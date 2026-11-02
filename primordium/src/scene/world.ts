// The world map (the Age of Sail): a sea, and on it the islands as shapes. Yours in colour (each
// its own coast, lights coming on at night), others found in grey, the rest of the world under
// fog. Pan with a finger, pinch to zoom, tap one of yours to go and see it.

import type { GameState } from '../economy/types';
import type { Frame } from './paint';
import { hash } from './paint';
import { MASK, SIGHT, coastAt, type World, type WorldIsle } from '../economy/sail';

export class WorldScene {
  private camX = 0;
  private camY = 0;
  /** Art pixels per map unit. */
  private zoom = 0;
  private W = 0;
  private H = 0;
  private top = 0;
  private bottom = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private fogImg: ImageData | null = null;
  private seedNow = -1;

  reset(): void {
    this.zoom = 0;
  }

  /** The middle of the view in art pixels (between the top bar and the sheet). */
  private midY(): number {
    return (this.top + (this.H - this.bottom)) / 2;
  }
  private sx(x: number): number {
    return (x - this.camX) * this.zoom + this.W / 2;
  }
  private sy(y: number): number {
    return (y - this.camY) * this.zoom + this.midY();
  }
  private toMap(ax: number, ay: number): { x: number; y: number } {
    return { x: this.camX + (ax - this.W / 2) / this.zoom, y: this.camY + (ay - this.midY()) / this.zoom };
  }

  /** Your islands framed, home in the middle (once, on first sight). */
  private frame(world: World): void {
    const mine = world.isles.filter((i) => i.mine !== undefined);
    const home = mine.find((i) => i.mine === -1) ?? mine[0];
    this.camX = home.x;
    this.camY = home.y;
    let span = 260;
    for (const m of mine) span = Math.max(span, Math.abs(m.x - home.x) * 2 + m.r * 2.4, Math.abs(m.y - home.y) * 2 + m.r * 2.4);
    this.zoom = Math.min(this.W / span, (this.H - this.top - this.bottom) / span);
  }

  /** An island's picture, made once: land and sand from its coast, a hill in the middle. */
  private sprite(i: WorldIsle): HTMLCanvasElement {
    const key = `${i.id}|${i.mine !== undefined ? 'm' : i.found ? 'f' : 'u'}|${i.mask.length}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = MASK;
    c.height = MASK;
    const b = c.getContext('2d')!;
    const mine = i.mine !== undefined;
    const near = (x: number, y: number) => {
      let sea = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!coastAt(i.mask, x + dx, y + dy)) sea++;
      return sea;
    };
    for (let y = 0; y < MASK; y++)
      for (let x = 0; x < MASK; x++) {
        if (!coastAt(i.mask, x, y)) {
          // (The shallows round the coast, a lighter blue.)
          let shore = false;
          for (let dy = -2; dy <= 2 && !shore; dy++) for (let dx = -2; dx <= 2; dx++) if (coastAt(i.mask, x + dx, y + dy)) shore = true;
          if (shore) {
            b.fillStyle = 'rgba(120, 190, 210, 0.35)';
            b.fillRect(x, y, 1, 1);
          }
          continue;
        }
        const edge = near(x, y) > 0;
        const inner = Math.hypot(x - MASK / 2, y - MASK / 2) / (MASK / 2);
        const n = hash(x * 41 + y, i.id + 7);
        let col: string;
        if (mine) col = edge ? '#e6d29a' : inner < 0.25 + n * 0.1 ? '#4a7a3a' : n > 0.85 ? '#3e6a30' : '#6aa04a';
        else col = edge ? '#b8b4a4' : inner < 0.25 + n * 0.1 ? '#6c7468' : '#8a9284';
        b.fillStyle = col;
        b.fillRect(x, y, 1, 1);
      }
    this.sprites.set(key, c);
    return c;
  }

  draw(f: Frame, state: GameState): void {
    const world = state.stages.sail.world;
    const { b, W, H, t } = f;
    this.W = W;
    this.H = H;
    this.top = f.top;
    this.bottom = f.bottom;
    if (!world) {
      b.fillStyle = '#123a52';
      b.fillRect(0, 0, W, H);
      return;
    }
    if (this.seedNow !== world.seed) {
      this.seedNow = world.seed;
      this.sprites.clear();
      this.zoom = 0;
    }
    if (!this.zoom) this.frame(world);
    // The sea, and its glints.
    b.fillStyle = '#16465e';
    b.fillRect(0, 0, W, H);
    b.fillStyle = '#2a6684';
    for (let k = 0; k < 90; k++) {
      const gx = hash(k, 3) * world.w;
      const gy = hash(k, 5) * world.h;
      const X = Math.round(this.sx(gx) + Math.sin(t * 0.6 + k) * 2);
      const Y = Math.round(this.sy(gy));
      if (X < -2 || Y < -2 || X > W || Y > H) continue;
      if (Math.sin(t * 1.3 + k * 2.1) > 0.2) b.fillRect(X, Y, 2, 1);
    }
    // The islands (found ones only: the rest are under the fog).
    b.imageSmoothingEnabled = false;
    for (const i of world.isles) {
      if (!i.found) continue;
      const s = i.r * 2 * this.zoom;
      const X = this.sx(i.x) - s / 2;
      const Y = this.sy(i.y) - s / 2;
      if (X > W || Y > H || X + s < 0 || Y + s < 0) continue;
      b.drawImage(this.sprite(i), Math.round(X), Math.round(Y), Math.round(s), Math.round(s));
    }
    // Night: your islands' lights come on (the day goes round in two minutes, as on the shore).
    const day = (t % 120) / 120;
    const night = Math.max(0, Math.min(1, (day - 0.72) * 8)) * Math.max(0, Math.min(1, (1.02 - day) * 8));
    if (night > 0.05) {
      b.fillStyle = `rgba(10, 16, 40, ${0.45 * night})`;
      b.fillRect(0, 0, W, H);
      for (const i of world.isles) {
        if (i.mine === undefined) continue;
        for (let k = 0; k < (i.mine === -1 ? 14 : 7); k++) {
          const lx = (hash(k, i.id * 13 + 1) - 0.5) * i.r * 0.9;
          const ly = (hash(k, i.id * 13 + 2) - 0.5) * i.r * 0.9;
          if (!coastAt(i.mask, Math.floor(MASK / 2 + (lx / (i.r * 2)) * MASK), Math.floor(MASK / 2 + (ly / (i.r * 2)) * MASK))) continue;
          if (Math.sin(t * 2 + k * 3 + i.id) < -0.6) continue;
          b.fillStyle = `rgba(255, 214, 120, ${night})`;
          b.fillRect(Math.round(this.sx(i.x + lx)), Math.round(this.sy(i.y + ly)), 1, 1);
        }
      }
    }
    this.drawFog(b, world, t);
  }

  /** The fog over what's not been seen from your islands: soft, drifting cloud. */
  private drawFog(b: CanvasRenderingContext2D, world: World, t: number): void {
    const W = this.W;
    const H = this.H;
    if (!this.fogImg || this.fogImg.width !== W || this.fogImg.height !== H) this.fogImg = b.createImageData(W, H);
    const img = this.fogImg;
    const d = img.data;
    const mine = world.isles.filter((i) => i.mine !== undefined);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const m = this.toMap(x, y);
        let clear = 1e9;
        for (const i of mine) clear = Math.min(clear, Math.hypot(i.x - m.x, i.y - m.y) - (SIGHT + i.r * 0.6));
        // (The edge of what's seen wavers like cloud.)
        const wob = (Math.sin(m.x * 0.03 + t * 0.15) + Math.sin(m.y * 0.037 - t * 0.11)) * 9;
        const a = Math.max(0, Math.min(1, (clear + wob) / 40));
        const o = (y * W + x) * 4;
        const n = 220 + Math.sin(m.x * 0.05 + m.y * 0.04 + t * 0.2) * 14;
        d[o] = n;
        d[o + 1] = n + 4;
        d[o + 2] = n + 10;
        d[o + 3] = Math.round(a * 235);
      }
    }
    // (Laid over the picture through a canvas of its own, so it blends.)
    const c = (this.fogCanvas ??= document.createElement('canvas'));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
    b.drawImage(c, 0, 0);
  }
  private fogCanvas: HTMLCanvasElement | null = null;

  pan(dx: number, dy: number): void {
    if (!this.zoom) return;
    this.camX -= dx / this.zoom;
    this.camY -= dy / this.zoom;
  }
  zoomAt(ax: number, ay: number, factor: number): void {
    if (!this.zoom) return;
    const at = this.toMap(ax, ay);
    this.zoom = Math.max(0.05, Math.min(3, this.zoom * factor));
    this.camX = at.x - (ax - this.W / 2) / this.zoom;
    this.camY = at.y - (ay - this.midY()) / this.zoom;
  }
  /** The island under a tap, if any (found ones only). */
  isleAt(world: World, ax: number, ay: number): WorldIsle | null {
    const m = this.toMap(ax, ay);
    let best: WorldIsle | null = null;
    for (const i of world.isles) {
      if (!i.found) continue;
      const cx = Math.floor(((m.x - i.x) / (i.r * 2) + 0.5) * MASK);
      const cy = Math.floor(((m.y - i.y) / (i.r * 2) + 0.5) * MASK);
      if (coastAt(i.mask, cx, cy) || Math.hypot(m.x - i.x, m.y - i.y) < i.r * 0.4) best = i;
    }
    return best;
  }
}
