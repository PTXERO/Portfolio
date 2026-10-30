// Trails the herd wears into the ground: wherever feet go often, the grass gives way to a
// dirt path, and paths nobody uses grass over again. Over hours the island comes to show
// where your herd has lived. Kept in the browser (not the save) for each island.

import { ISLAND } from '../economy/island';

/** Tiles per cell of the trail map. */
const CELL = 2;
/** Wear a second of one walker adds, and how quickly paths grass over (share a second). */
const WEAR = 0.012;
const REGROW = 1 / 2400;
const KEY = 'ooze-to-orbit/trails/';

export class Trails {
  /** Cells across (the island's tiles over CELL). */
  private N = ISLAND / CELL;
  private wear = new Float32Array(this.N * this.N);
  readonly canvas = document.createElement('canvas');
  version = 0;
  private seed = -1;
  private sinceDraw = 0;
  private sinceSave = 0;

  constructor() {
    this.canvas.width = this.N;
    this.canvas.height = this.N;
  }

  /** Loads the island's trails (once per island). */
  private load(seed: number, n: number): void {
    this.seed = seed;
    if (n / CELL !== this.N) {
      this.N = n / CELL;
      this.wear = new Float32Array(this.N * this.N);
      this.canvas.width = this.N;
      this.canvas.height = this.N;
    }
    this.wear.fill(0);
    try {
      const raw = localStorage.getItem(KEY + seed);
      if (raw) {
        const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        for (let i = 0; i < Math.min(bytes.length, this.wear.length); i++) this.wear[i] = bytes[i] / 255;
      }
    } catch {
      /* no storage: trails start fresh */
    }
    this.redraw();
  }

  private save(): void {
    try {
      const bytes = new Uint8Array(this.wear.length);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.min(1, this.wear[i]) * 255);
      let s = '';
      for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096));
      localStorage.setItem(KEY + this.seed, btoa(s));
    } catch {
      /* full or private: they just won't last */
    }
  }

  private redraw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(this.N, this.N);
    for (let i = 0; i < this.wear.length; i++) img.data[i * 4 + 3] = Math.round(Math.min(1, this.wear[i]) * 255);
    ctx.putImageData(img, 0, 0);
    this.version++;
  }

  /** A frame: `feet` walked for `dt` seconds (only the ones moving count). */
  update(seed: number, feet: { x: number; y: number }[], dt: number, n = ISLAND): void {
    if (seed !== this.seed || n / CELL !== this.N) this.load(seed, n);
    const N = this.N;
    for (const p of feet) {
      const cx = Math.floor(p.x / CELL);
      const cy = Math.floor(p.y / CELL);
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      const i = cy * N + cx;
      this.wear[i] = Math.min(1.2, this.wear[i] + WEAR * dt);
    }
    this.sinceDraw += dt;
    if (this.sinceDraw >= 1) {
      const k = 1 - REGROW * this.sinceDraw;
      for (let i = 0; i < this.wear.length; i++) this.wear[i] *= k;
      this.sinceDraw = 0;
      this.redraw();
    }
    this.sinceSave += dt;
    if (this.sinceSave >= 30) {
      this.sinceSave = 0;
      this.save();
    }
  }
}
