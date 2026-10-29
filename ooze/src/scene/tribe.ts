// The Tribal era's map: what's left of the island after the strike. The same 2.5D, lit land
// as the Creature's (this builds on its scene), but broken off into one piece, with the
// spear standing in its crater. The survivors huddle at the old home, scared of it, until one
// goes and touches it; after that they're awake, and go about the land on their own.

import { PAL } from '../art/sprites';
import { SEASON_SEC } from '../economy/rates';
import { CELLS, isLand, type Pt } from '../economy/island';
import { fragmentFor, tribeOf } from '../economy/tribal';
import type { GameState } from '../economy/types';
import { creatureLookOf } from './creatureLook';
import { hash, type Frame } from './paint';
import { RangeScene } from './range';

interface Person {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  /** Where it's headed next, and seconds before it picks somewhere else. */
  goal: Pt | null;
  wait: number;
}

/** Every cell seen: there is no fog on what's left (they know every step of it). */
const ALL_SEEN = new Uint8Array(CELLS * CELLS).fill(1);
const DAY_SEC = 120;

export class TribeScene extends RangeScene {
  private people: Person[] = [];
  private placed = false;
  private seedSeen = -1;

  reset(): void {
    super.reset();
    this.people = [];
    this.placed = false;
    this.auto = false;
  }

  tap(state: GameState, ax: number, ay: number): void {
    const t = tribeOf(state);
    if (!t || !this.island) return;
    const { spear } = fragmentFor(state);
    // The spear: before they've woken, touching it is how they do.
    const X = this.sx(spear.x);
    const Y = this.py(spear.x, spear.y);
    const tall = this.spearHeight();
    if (!t.awake && Math.abs(ax - X) < Math.max(8, tall * 0.25) && ay > Y - tall - 4 && ay < Y + 4) {
      this.events.push({ type: 'spear', x: X, y: Y - tall });
      this.fx.pulse(Math.round(X), Math.round(Y - tall * 0.6), PAL.p);
    }
  }

  /** How tall the spear stands on screen (art px): a giant, whatever the zoom. */
  private spearHeight(): number {
    return Math.max(30, 15 * this.zoom);
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt } = f;
    this.W = W;
    this.H = H;
    if (!this.viewBottom) this.viewTop = f.top;
    const tribe = tribeOf(state);
    if (!tribe) return;
    const frag = fragmentFor(state);
    const is = frag.island;
    this.island = is;
    // First look: the camera over the camp and the crater.
    if (!this.placed || this.seedSeen !== is.seed) {
      this.camX = (frag.camp.x + frag.spear.x) / 2;
      this.camY = (frag.camp.y + frag.spear.y) / 2 - 4;
      this.zoom = 3;
      this.auto = false;
      this.placed = true;
      this.seedSeen = is.seed;
    }

    // Seasons by the tribe's own clock.
    const y = tribe.year % (SEASON_SEC * 4);
    const si = Math.floor(y / SEASON_SEC);
    const into = (y % SEASON_SEC) / SEASON_SEC;
    const blend = Math.max(0, Math.min(1, (into - 0.45) / 0.55));
    const turn = blend * blend * (3 - 2 * blend);
    const next = (si + 1) % 4;
    this.seasonBlend = turn;
    this.seasonPair = [si, next];
    if (this.groundSeed !== is.seed) {
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
    }
    if (!this.ground.has(si)) this.ground.set(si, this.paintGround(is, si));
    if (!this.ground.has(next)) this.ground.set(next, this.paintGround(is, next));
    this.groundPair = [this.ground.get(si)!, this.ground.get(next)!];
    this.paintFog(ALL_SEEN);
    b.imageSmoothingEnabled = false;
    if (this.shaded) b.clearRect(0, 0, W, H);
    else {
      b.fillStyle = '#24506e';
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(si)!);
    }

    const dayT = (t % DAY_SEC) / DAY_SEC;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    const sprites: { y: number; draw: () => void }[] = [];
    const look = creatureLookOf(state);

    // The survivors (up to 40 drawn; more are about, off where you can't see them).
    const shown = Math.min(40, Math.max(1, Math.round(tribe.pop)));
    while (this.people.length < shown) {
      const k = this.people.length;
      const a = hash(k, 3) * Math.PI * 2;
      const d = 1 + hash(k, 5) * 4;
      this.people.push({ x: frag.camp.x + Math.cos(a) * d, y: frag.camp.y + Math.sin(a) * d * 0.7, vx: 0, vy: 0, ph: hash(k, 7) * 10, goal: null, wait: hash(k, 9) * 4 });
    }
    this.people.length = shown;
    const sleeping = night > 0.5;
    this.people.forEach((p, i) => {
      // Before waking they keep close to the camp, away from the spear; after, they range
      // over what's left, and some stand looking up at it.
      p.wait -= dt;
      if (!p.goal || p.wait <= 0) {
        p.wait = 4 + hash(i, Math.floor(t / 7)) * 8;
        if (!tribe.awake || sleeping) {
          const a = hash(i, Math.floor(t / 9) + 1) * Math.PI * 2;
          const r = sleeping ? 1.5 : 3 + hash(i, 11) * 3;
          p.goal = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r * 0.7 };
        } else if (i % 5 === 0) {
          const a = hash(i, Math.floor(t / 11)) * Math.PI * 2;
          p.goal = { x: frag.spear.x + Math.cos(a) * 10, y: frag.spear.y + Math.sin(a) * 7 };
        } else {
          for (let k = 0; k < 8; k++) {
            const a = hash(i * 13 + k, Math.floor(t / 13)) * Math.PI * 2;
            const r = 4 + hash(i * 7 + k, 17) * 24;
            const g = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r };
            if (isLand(is, g.x, g.y) && Math.hypot(g.x - frag.spear.x, g.y - frag.spear.y) > 9) {
              p.goal = g;
              break;
            }
          }
        }
      }
      let gx = p.goal?.x ?? p.x;
      let gy = p.goal?.y ?? p.y;
      for (const o of this.people) {
        if (o === p) continue;
        const ox = p.x - o.x;
        const oy = p.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < 1.8) {
          gx += (ox / od) * (1.8 - od) * 2;
          gy += (oy / od) * (1.8 - od) * 2;
        }
      }
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d = Math.hypot(dx, dy);
      const sp = d > 0.3 ? 0.8 : 0;
      p.vx += ((d ? (dx / d) * Math.min(sp, d) : 0) - p.vx) * Math.min(1, dt * 3);
      p.vy += ((d ? (dy / d) * Math.min(sp, d) : 0) - p.vy) * Math.min(1, dt * 3);
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (isLand(is, nx, ny)) {
        p.x = nx;
        p.y = ny;
      }
      const moving = Math.hypot(p.vx, p.vy) > 0.12;
      const left = moving ? p.vx < 0 : frag.spear.x < p.x;
      const x = p.x;
      const yy = p.y;
      const hop = moving ? Math.abs(Math.sin(t * 7 + p.ph * 3)) * 2 : 0;
      sprites.push({ y: yy, draw: () => this.drawBeing(b, look, x, yy, { left, frame: moving ? Math.floor(t * 8 + p.ph) % 2 : 0, sleeping, hop }) });
    });

    // The spear, standing in its crater.
    const sx = this.sx(frag.spear.x);
    const sy = this.py(frag.spear.x, frag.spear.y);
    sprites.push({ y: frag.spear.y, draw: () => this.drawSpear(b, sx, sy, t, tribe.awake) });

    sprites.sort((a, c) => a.y - c.y);
    for (const s of sprites) s.draw();

    // Before they wake: a pulse at the spear, so it's plain it's the thing to touch.
    if (!tribe.awake && Math.floor(t * 1.5) % 2) {
      const tall = this.spearHeight();
      b.fillStyle = PAL.y;
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 10), 3, 5);
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 3), 3, 2);
    }
    this.fx.run(f);
  }

  /** The spear: a long twisted shaft, dark red and black, forked at the head, faint light
   * running up it. Not a thing anyone here could have made. */
  private drawSpear(b: CanvasRenderingContext2D, X: number, Y: number, t: number, awake: boolean): void {
    const tall = this.spearHeight();
    const w = Math.max(1, Math.round(tall / 22));
    const x0 = Math.round(X);
    const y0 = Math.round(Y);
    // Shadow, and the scorch where it went in.
    b.fillStyle = 'rgba(0, 0, 0, 0.35)';
    b.fillRect(x0 - 3 * w, y0, 7 * w, w);
    for (let i = 0; i < tall; i++) {
      // Two strands twisting round each other.
      const k = i / tall;
      const tw = Math.sin(k * 14 + t * 0.4) * w;
      b.fillStyle = '#5a1018';
      b.fillRect(x0 - w + Math.round(tw), y0 - i, w, 1);
      b.fillStyle = '#2a0a10';
      b.fillRect(x0 - Math.round(tw), y0 - i, w, 1);
      // Light running up it now and then (it glows, so the shader blooms it).
      const run = (t * 0.35 + k) % 1;
      if (run < 0.06) {
        b.fillStyle = 'rgba(255, 90, 110, 0.996)';
        b.fillRect(x0, y0 - i, 1, 1);
      }
    }
    // The fork: two prongs curving apart at the head.
    const top = y0 - tall;
    const prong = Math.max(4, Math.round(tall * 0.22));
    b.fillStyle = '#6a1420';
    for (let i = 0; i < prong; i++) {
      const spread = Math.round((i / prong) ** 1.5 * prong * 0.45);
      b.fillRect(x0 - spread - w, top - i, w, 1);
      b.fillRect(x0 + spread, top - i, w, 1);
    }
    if (!awake || Math.sin(t * 2) > 0.6) {
      b.fillStyle = 'rgba(255, 120, 140, 0.996)';
      b.fillRect(x0 - Math.round(prong * 0.45) - w, top - prong, w, 1);
      b.fillRect(x0 + Math.round(prong * 0.45), top - prong, w, 1);
    }
  }
}
