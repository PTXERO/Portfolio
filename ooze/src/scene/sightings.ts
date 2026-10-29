// Rare sightings: every few minutes something unusual crosses the island, for a little
// while only. Tap it in time and the herd remembers it (a reward, and a note). A whale rolls
// offshore; an old tortoise trudges a beach; a comet creeps over the night; sky fire ripples
// on winter nights.

import { PAL } from '../art/sprites';
import { Biome, ISLAND, isLand, type Island } from '../economy/island';
import type { Sprite, WildView } from './wild';

interface Sighting {
  kind: string;
  /** World position (tiles), or screen position for things in the sky. */
  x: number;
  y: number;
  sky: boolean;
  age: number;
  life: number;
  dir: number;
}

export class Sightings {
  private cur: Sighting | null = null;
  private timer = 150 + Math.random() * 120;

  /** Something new, if one's due and there's a place in view for it. */
  private start(v: WildView, is: Island, night: number, winter: boolean): void {
    const kinds = night > 0.5 ? (winter ? ['aurora', 'comet'] : ['comet']) : winter ? ['whale'] : ['whale', 'tortoise'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const dir = Math.random() < 0.5 ? -1 : 1;
    if (kind === 'comet' || kind === 'aurora') {
      this.cur = { kind, x: dir > 0 ? -10 : v.W + 10, y: v.H * (0.2 + Math.random() * 0.25), sky: true, age: 0, life: 20, dir };
      return;
    }
    // On the map, in view: deep-ish water for the whale, a beach for the tortoise.
    for (let i = 0; i < 40; i++) {
      const w = v.toWorld(v.W * (0.15 + Math.random() * 0.7), v.H * (0.3 + Math.random() * 0.5));
      if (w.x < 2 || w.y < 2 || w.x > ISLAND - 3 || w.y > ISLAND - 3) continue;
      const b = is.biome[Math.round(w.y) * ISLAND + Math.round(w.x)];
      const ok = kind === 'whale' ? !isLand(is, w.x, w.y) && b === Biome.Deep : b === Biome.Sand;
      if (ok) {
        this.cur = { kind, x: w.x, y: w.y, sky: false, age: 0, life: kind === 'whale' ? 14 : 40, dir };
        return;
      }
    }
  }

  update(v: WildView, is: Island, sprites: Sprite[], o: { b: CanvasRenderingContext2D; t: number; dt: number; night: number; winter: boolean }): void {
    const { b, t, dt } = o;
    if (!this.cur) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 240 + Math.random() * 240;
        this.start(v, is, o.night, o.winter);
      }
      return;
    }
    const s = this.cur;
    s.age += dt;
    if (s.age > s.life) {
      this.cur = null;
      return;
    }
    const k = v.zoom >= 6 ? 2 : 1;
    const z = Math.max(1, Math.min(4, v.zoom / 1.5));
    switch (s.kind) {
      case 'whale': {
        // Surfaces, rolls along, blows, and sinks again.
        s.x += s.dir * 0.15 * dt;
        const X = v.sx(s.x);
        const Y = v.py(s.x, s.y);
        const up = Math.sin((s.age / s.life) * Math.PI);
        sprites.push({
          y: s.y,
          draw: () => {
            const L = Math.round(10 * z);
            const H = Math.max(1, Math.round(3 * z * up));
            b.fillStyle = '#2c3a4a';
            for (let i = 0; i < L; i++) {
              const h = Math.round(H * Math.sin((i / L) * Math.PI));
              if (h > 0) b.fillRect(Math.round(X - L / 2 + i), Math.round(Y - h), 1, h);
            }
            b.fillStyle = '#4a5c6e';
            b.fillRect(Math.round(X - L / 4), Math.round(Y - H), Math.round(L / 3), 1);
            if (up > 0.7 && Math.floor(s.age * 3) % 3 !== 0) {
              b.fillStyle = 'rgba(230, 240, 250, 0.85)';
              for (let i = 0; i < 4; i++) b.fillRect(Math.round(X + s.dir * L * 0.2 + (i - 1.5) * z), Math.round(Y - H - 2 * z - i * z * (i % 2 ? 0.6 : 1)), 1, 1);
            }
          },
        });
        break;
      }
      case 'tortoise': {
        if (!isLand(is, s.x + s.dir * 0.6, s.y)) s.dir = -s.dir;
        s.x += s.dir * 0.08 * dt;
        const x = s.x;
        const X = Math.round(v.sx(x));
        const Y = Math.round(v.py(x, s.y));
        const step = Math.floor(t * 2) % 2;
        sprites.push({
          y: s.y,
          draw: () => {
            if (v.zoom < 1.6) {
              b.fillStyle = '#6a7a4a';
              b.fillRect(X, Y - 2, 2, 2);
              return;
            }
            b.fillStyle = 'rgba(0, 0, 0, 0.25)';
            b.fillRect(X - 4 * k, Y, 9 * k, k);
            b.fillStyle = '#4a4030';
            b.fillRect(X - 3 * k, Y - (1 + step) * k, k, (1 + step) * k);
            b.fillRect(X + 2 * k, Y - (2 - step) * k, k, (2 - step) * k);
            b.fillStyle = '#5e6e3e';
            b.fillRect(X - 4 * k, Y - 4 * k, 8 * k, 3 * k);
            b.fillRect(X - 3 * k, Y - 5 * k, 6 * k, k);
            b.fillStyle = '#7e8e52';
            b.fillRect(X - 2 * k, Y - 4 * k, 2 * k, k);
            b.fillRect(X + k, Y - 3 * k, 2 * k, k);
            b.fillStyle = '#8a7a5a';
            b.fillRect(X + s.dir * 5 * k - (s.dir < 0 ? k : 0), Y - 3 * k, k, k);
          },
        });
        break;
      }
      case 'comet': {
        s.x += s.dir * 5 * dt;
        sprites.push({
          y: 2e9,
          draw: () => {
            b.fillStyle = PAL.w;
            b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
            for (let i = 1; i < 14; i++) {
              b.globalAlpha = 0.7 * (1 - i / 14);
              b.fillStyle = i < 4 ? '#e6f4ff' : '#8fd3f0';
              b.fillRect(Math.round(s.x - s.dir * i), Math.round(s.y - i * 0.3), 1, 1);
            }
            b.globalAlpha = 1;
          },
        });
        break;
      }
      case 'aurora': {
        const fade = Math.min(1, s.age / 3, (s.life - s.age) / 3);
        sprites.push({
          y: 2e9,
          draw: () => {
            for (let x = 0; x < v.W; x++) {
              const h = 6 + Math.sin(x * 0.11 + t * 0.6) * 3 + Math.sin(x * 0.04 - t * 0.3) * 4;
              const y0 = Math.round(v.H * 0.12 + Math.sin(x * 0.03 + t * 0.2) * 5);
              for (let j = 0; j < h; j++) {
                b.globalAlpha = 0.22 * fade * (1 - j / h);
                b.fillStyle = j < h * 0.4 ? '#7fe0b0' : '#a28ad8';
                b.fillRect(x, y0 + j, 1, 1);
              }
            }
            b.globalAlpha = 1;
          },
        });
        break;
      }
    }
  }

  /** A tap at a screen point: the sighting under it (cleared), if any. */
  hit(v: WildView, ax: number, ay: number): string | null {
    const s = this.cur;
    if (!s) return null;
    let near: boolean;
    if (s.kind === 'aurora') near = ay < v.H * 0.35;
    else if (s.sky) near = Math.hypot(s.x - ax, s.y - ay) < 14;
    else {
      near = Math.hypot(v.sx(s.x) - ax, v.py(s.x, s.y) - 3 - ay) < Math.max(12, v.zoom * 4);
    }
    if (!near) return null;
    this.cur = null;
    return s.kind;
  }
}
