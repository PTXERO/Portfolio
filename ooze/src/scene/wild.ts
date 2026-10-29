// The island's own life, apart from your herd: things that grow and get eaten, and animals
// that go about their business. None of it is managed and none of it pays; it's there so
// the island feels lived in, the way the pond does.
//
// Berry bushes near home ripen through the year (not in winter) and the herd strips them;
// fruit trees at the forest's edge do the same in autumn. Crabs scuttle on the beaches and
// duck away from feet; small birds peck about and burst up when anything comes close; fish
// jump offshore; a little wild herd of grazers keeps to the far grass and bolts from you;
// and once in a while a few birds come down near a nest, until you get too close.

import { PAL } from '../art/sprites';
import { Biome, ISLAND, isLand, type Island, type Pt } from '../economy/island';
import { hash, type Effects } from './paint';

/** What the wild needs from the map's camera. */
export interface WildView {
  zoom: number;
  W: number;
  H: number;
  sx(x: number): number;
  py(x: number, y: number): number;
  fx: Effects;
  /** The ground under a screen point. */
  toWorld(x: number, y: number): Pt;
}

export interface Sprite {
  y: number;
  draw: () => void;
}

export interface Bush {
  x: number;
  y: number;
  /** 0 bare to 1 laden. */
  ripe: number;
  tree: boolean;
}

interface Crab {
  x: number;
  y: number;
  ph: number;
  /** Seconds left hiding in the sand. */
  hide: number;
}

interface Flock {
  x: number;
  y: number;
  /** Seconds since it took off (-1 while on the ground), and which way it went. */
  up: number;
  dir: number;
  /** Seconds before it lands somewhere new. */
  away: number;
}

interface Grazer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

/** How fast bushes ripen (a share a second) in each season, and trees (autumn only). */
const BUSH_GROW = [0.012, 0.02, 0.008, 0];
const TREE_GROW = [0, 0.004, 0.02, 0];

const biomeAt = (is: Island, x: number, y: number) => is.biome[Math.round(y) * ISLAND + Math.round(x)];

export class Wild {
  bushes: Bush[] = [];
  private crabs: Crab[] = [];
  private flock: Flock | null = null;
  private flockTimer = 120 + Math.random() * 120;
  private grazers: Grazer[] = [];
  private fishTimer = 3;
  private seed = -1;

  /** Lays out the island's bushes, beaches and wild herd (once per island). */
  private setup(is: Island): void {
    this.seed = is.seed;
    const h = is.home;
    const spots = (n: number, salt: number, r0: number, r1: number, ok: (x: number, y: number) => boolean): Pt[] => {
      const out: Pt[] = [];
      for (let i = 0; i < n * 40 && out.length < n; i++) {
        const a = hash(i, salt + is.seed % 997) * Math.PI * 2;
        const d = r0 + hash(i, salt + 7) * (r1 - r0);
        const x = h.x + Math.cos(a) * d;
        const y = h.y + Math.sin(a) * d;
        if (x > 2 && y > 2 && x < ISLAND - 2 && y < ISLAND - 2 && ok(x, y) && out.every((p) => Math.hypot(p.x - x, p.y - y) > 2.5)) out.push({ x, y });
      }
      return out;
    };
    const grass = (x: number, y: number) => biomeAt(is, x, y) === Biome.Grass;
    const sand = (x: number, y: number) => biomeAt(is, x, y) === Biome.Sand;
    // Forest edge: forest with open ground beside it.
    const edge = (x: number, y: number) => biomeAt(is, x, y) === Biome.Forest && [grass(x + 1.5, y), grass(x - 1.5, y), grass(x, y + 1.5), grass(x, y - 1.5)].some(Boolean);
    this.bushes = [
      ...spots(14, 11, 3, 22, grass).map((p) => ({ ...p, ripe: 0.5, tree: false })),
      ...spots(10, 23, 4, 40, edge).map((p) => ({ ...p, ripe: 0.3, tree: true })),
    ];
    this.crabs = spots(7, 37, 1, 45, sand).map((p, i) => ({ ...p, ph: i * 1.7, hide: 0 }));
    const far = spots(1, 53, 30, 70, (x, y) => grass(x, y) || biomeAt(is, x, y) === Biome.High)[0];
    this.grazers = far ? Array.from({ length: 5 }, (_, i) => ({ x: far.x + (hash(i, 59) - 0.5) * 4, y: far.y + (hash(i, 61) - 0.5) * 3, vx: 0, vy: 0, ph: i * 2.1 })) : [];
  }

  /** The nearest bush or tree with fruit worth walking to, within `r` tiles of a point. */
  ripeNear(p: Pt, r: number): Bush | null {
    let best: Bush | null = null;
    let bd = r;
    for (const b of this.bushes) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (b.ripe > 0.6 && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Stripped by the herd: a burst of what was on it. */
  eat(v: WildView, bush: Bush): void {
    if (bush.ripe <= 0.6) return;
    bush.ripe = 0;
    const X = Math.round(v.sx(bush.x));
    const Y = Math.round(v.py(bush.x, bush.y)) - (bush.tree ? 6 : 2);
    v.fx.add(0.5, (f, age) => {
      f.b.fillStyle = bush.tree ? PAL.o : PAL.p;
      for (let i = 0; i < 4; i++) f.b.fillRect(X + Math.round(Math.cos(i * 1.6) * age * 8), Y - Math.round(age * 6 - age * age * 14) + i % 2, 1, 1);
    });
  }

  /**
   * Moves everything on a step and queues it to be drawn. `feet` are where your creature and
   * herd are (crabs and birds keep clear of them); `me` is your creature (the grazers fear it).
   */
  update(v: WildView, is: Island, sprites: Sprite[], o: { b: CanvasRenderingContext2D; t: number; dt: number; nests: Pt[]; season: number; night: number; feet: Pt[]; me: Pt }): void {
    if (this.seed !== is.seed) this.setup(is);
    const { t, dt } = o;
    const z = v.zoom;
    const near = (x: number, y: number, r: number) => o.feet.some((p) => Math.hypot(p.x - x, p.y - y) < r);
    const on = (X: number, Y: number) => X > -8 && X < v.W + 8 && Y > -8 && Y < v.H + 8;

    // Bushes and fruit trees: ripen, and show what's on them.
    for (const b of this.bushes) {
      b.ripe = Math.min(1, b.ripe + (b.tree ? TREE_GROW : BUSH_GROW)[o.season] * dt);
      if (z < 1.6) continue;
      const X = Math.round(v.sx(b.x));
      const Y = Math.round(v.py(b.x, b.y));
      if (!on(X, Y)) continue;
      const k = z >= 6 ? 2 : 1;
      const n = Math.floor(b.ripe * 4);
      sprites.push({ y: b.y, draw: () => drawBush(o.b, X, Y, k, b.tree, n, o.season) });
    }

    // Crabs on the sand: sideways in little bursts; feet nearby send them under.
    if (z >= 1.6) {
      for (const c of this.crabs) {
        if (near(c.x, c.y, 2.2)) c.hide = 6;
        c.hide = Math.max(0, c.hide - dt);
        if (c.hide > 0) continue;
        const dx = Math.sin(t * 0.8 + c.ph) > 0.3 ? Math.sign(Math.sin(t * 0.3 + c.ph)) * 0.6 * dt : 0;
        if (biomeAt(is, c.x + dx, c.y) === Biome.Sand) c.x += dx;
        const X = Math.round(v.sx(c.x));
        const Y = Math.round(v.py(c.x, c.y));
        if (!on(X, Y)) continue;
        const legs = Math.floor(t * 10 + c.ph) % 2;
        sprites.push({ y: c.y, draw: () => drawCrab(o.b, X, Y, z >= 6 ? 2 : 1, dx !== 0 && legs === 1) });
      }
    }

    // Now and then (rarely) a few little birds come down to peck about near a nest. They stay
    // until your creature comes close, then burst up and away, and it's a while before any
    // come back.
    if (!this.flock) {
      this.flockTimer -= dt;
      if (this.flockTimer <= 0 && o.night < 0.5 && o.nests.length) {
        this.flockTimer = 180 + Math.random() * 240;
        const n = o.nests[Math.floor(Math.random() * o.nests.length)];
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = 5 + Math.random() * 7;
          const x = n.x + Math.cos(a) * d;
          const y = n.y + Math.sin(a) * d;
          if (biomeAt(is, x, y) === Biome.Grass && Math.hypot(o.me.x - x, o.me.y - y) > 6) {
            this.flock = { x, y, up: -1, dir: 1, away: 0 };
            break;
          }
        }
      }
    }
    const f = this.flock;
    if (f) {
      if (f.up < 0 && Math.hypot(o.me.x - f.x, o.me.y - f.y) < 3.5) {
        f.up = 0;
        f.dir = o.me.x < f.x ? 1 : -1;
      }
      if (f.up >= 0) f.up += dt;
      if (f.up > 3) this.flock = null;
      else if (!(o.night > 0.5 && f.up < 0)) {
        const X = v.sx(f.x);
        const Y = v.py(f.x, f.y);
        const lift = Math.max(0, f.up);
        if (on(X, Y) || lift > 0) sprites.push({ y: f.y + (lift > 0 ? 50 : 0), draw: () => drawFlock(o.b, X, Y, z, t, lift, f.dir) });
      }
    }

    // Fish jump now and then, just off the shore in view.
    this.fishTimer -= dt;
    if (this.fishTimer <= 0 && o.night < 0.5) {
      this.fishTimer = 2 + Math.random() * 5;
      for (let i = 0; i < 8; i++) {
        const X = Math.random() * v.W;
        const Y = Math.random() * v.H;
        const w = v.toWorld(X, Y);
        if (isLand(is, w.x, w.y) || !isLand(is, w.x + 4, w.y) && !isLand(is, w.x - 4, w.y) && !isLand(is, w.x, w.y + 4) && !isLand(is, w.x, w.y - 4)) continue;
        const s = Math.max(1, Math.min(3, z / 2));
        v.fx.add(0.9, (fr, age) => {
          const a = age / 0.6;
          if (a < 1) {
            fr.b.fillStyle = '#cfe4ee';
            const hx = Math.round(X - s * 3 + a * s * 6);
            const hy = Math.round(Y - Math.sin(a * Math.PI) * s * 4);
            fr.b.fillRect(hx, hy, Math.max(1, Math.round(s)), 1);
          }
          if (age > 0.55) {
            fr.b.fillStyle = 'rgba(207, 228, 238, 0.8)';
            const r = (age - 0.55) * 10 * s;
            fr.b.fillRect(Math.round(X + s * 3 - r), Math.round(Y), 1, 1);
            fr.b.fillRect(Math.round(X + s * 3 + r), Math.round(Y), 1, 1);
          }
        });
        break;
      }
    }

    // The wild grazers: drift about the far grass, and bolt from your creature.
    if (this.grazers.length) {
      const cx = this.grazers.reduce((a, g) => a + g.x, 0) / this.grazers.length;
      const cy = this.grazers.reduce((a, g) => a + g.y, 0) / this.grazers.length;
      const scared = Math.hypot(o.me.x - cx, o.me.y - cy) < 7;
      for (const g of this.grazers) {
        let gx = cx + Math.cos(t * 0.05 + g.ph) * 2.5;
        let gy = cy + Math.sin(t * 0.04 + g.ph) * 1.8;
        if (scared) {
          const d = Math.hypot(g.x - o.me.x, g.y - o.me.y) || 1;
          gx = g.x + ((g.x - o.me.x) / d) * 8;
          gy = g.y + ((g.y - o.me.y) / d) * 8;
        }
        const dx = gx - g.x;
        const dy = gy - g.y;
        const d = Math.hypot(dx, dy) || 1;
        const sp = scared ? 3.2 : d > 0.3 ? 0.4 : 0;
        g.vx += ((dx / d) * sp - g.vx) * Math.min(1, dt * 3);
        g.vy += ((dy / d) * sp - g.vy) * Math.min(1, dt * 3);
        const nx = g.x + g.vx * dt;
        const ny = g.y + g.vy * dt;
        if (isLand(is, nx, ny)) {
          g.x = nx;
          g.y = ny;
        }
        const X = Math.round(v.sx(g.x));
        const Y = Math.round(v.py(g.x, g.y));
        if (!on(X, Y)) continue;
        const moving = Math.hypot(g.vx, g.vy) > 0.1;
        const left = moving ? g.vx < 0 : Math.sin(g.ph) < 0;
        const step = moving ? Math.floor(t * (scared ? 14 : 6) + g.ph) % 2 : 0;
        const graze = !moving && Math.sin(t * 0.7 + g.ph) > 0.2;
        sprites.push({ y: g.y, draw: () => drawGrazer(o.b, X, Y, z, left, step, graze, o.night > 0.5) });
      }
    }
  }

}

function drawBush(b: CanvasRenderingContext2D, X: number, Y: number, k: number, tree: boolean, fruit: number, season: number): void {
  if (tree) {
    // Fruit hangs in the crown (the tree itself is part of the ground's forest).
    b.fillStyle = season === 2 ? PAL.o : PAL.y;
    const spots = [
      [-2, -6],
      [1, -7],
      [3, -5],
      [-1, -4],
    ];
    for (let i = 0; i < fruit; i++) b.fillRect(X + spots[i][0] * k, Y + spots[i][1] * k, k, k);
    return;
  }
  b.fillStyle = season === 3 ? '#6c7a72' : '#2f6a3c';
  b.fillRect(X - 2 * k, Y - 2 * k, 5 * k, 2 * k);
  b.fillRect(X - k, Y - 3 * k, 3 * k, k);
  b.fillStyle = season === 3 ? '#8d9a92' : '#4e8f4a';
  b.fillRect(X - k, Y - 3 * k, 2 * k, k);
  b.fillStyle = season === 2 ? '#7a3a6a' : '#d0466a';
  const spots = [
    [-2, -2],
    [1, -3],
    [2, -2],
    [0, -1],
  ];
  for (let i = 0; i < fruit; i++) b.fillRect(X + spots[i][0] * k, Y + spots[i][1] * k, k, k);
}

function drawCrab(b: CanvasRenderingContext2D, X: number, Y: number, k: number, step: boolean): void {
  b.fillStyle = '#c4492f';
  b.fillRect(X - k, Y - k, 3 * k, k);
  b.fillStyle = '#e8615a';
  b.fillRect(X, Y - 2 * k, k, k);
  b.fillStyle = '#8a2e1e';
  b.fillRect(X - 2 * k, Y - (step ? 2 : 1) * k, k, k);
  b.fillRect(X + 2 * k, Y - (step ? 1 : 2) * k, k, k);
}

function drawFlock(b: CanvasRenderingContext2D, X: number, Y: number, z: number, t: number, lift: number, dir: number): void {
  const k = z >= 6 ? 2 : 1;
  for (let i = 0; i < 4; i++) {
    const ox = (i - 1.5) * 3 * k + (lift > 0 ? dir * lift * lift * 10 * (1 + i * 0.2) : 0);
    const oy = lift > 0 ? -lift * (14 + i * 3) : 0;
    const x = Math.round(X + ox);
    const y = Math.round(Y + oy - (i % 2));
    if (lift > 0) {
      // Flapping.
      const up = Math.floor(t * 12 + i) % 2;
      b.fillStyle = '#4a4038';
      b.fillRect(x - k, y - up * k, k, k);
      b.fillRect(x + k, y - up * k, k, k);
      b.fillRect(x, y, k, k);
    } else {
      // Pecking: heads bob.
      const peck = Math.sin(t * 5 + i * 2) > 0.5 ? 1 : 0;
      b.fillStyle = '#6a5a48';
      b.fillRect(x, y - k, 2 * k, k);
      b.fillStyle = '#3c3228';
      b.fillRect(x + (i % 2 ? -1 : 2) * k, y - (2 - peck) * k, k, k);
    }
  }
}

function drawGrazer(b: CanvasRenderingContext2D, X: number, Y: number, z: number, left: boolean, step: number, graze: boolean, night: boolean): void {
  if (z < 1.6) {
    b.fillStyle = '#b08850';
    b.fillRect(X, Y - 1, 1, 1);
    return;
  }
  const k = z >= 6 ? 2 : 1;
  const d = left ? -1 : 1;
  b.fillStyle = 'rgba(0, 0, 0, 0.25)';
  b.fillRect(X - 3 * k, Y, 6 * k, k);
  // Legs (two pairs, stepping), body, neck and head (down when grazing), white tail.
  b.fillStyle = '#5a4430';
  b.fillRect(X - 2 * k, Y - (2 - step) * k, k, (2 - step) * k);
  b.fillRect(X + k, Y - (1 + step) * k, k, (1 + step) * k);
  b.fillStyle = '#b08850';
  b.fillRect(X - 3 * k, Y - 4 * k, 6 * k, 2 * k);
  b.fillStyle = '#c9a06a';
  b.fillRect(X - 2 * k, Y - 4 * k, 4 * k, k);
  const hx = X + d * 3 * k - (d < 0 ? k : 0);
  if (graze) b.fillRect(hx, Y - 2 * k, k, 2 * k);
  else {
    b.fillRect(hx, Y - 6 * k, k, 2 * k);
    b.fillRect(hx + d * k, Y - 6 * k, k, k);
    b.fillStyle = '#5a4430';
    b.fillRect(hx, Y - 7 * k, k, k);
  }
  b.fillStyle = night ? '#9a9ab0' : PAL.w;
  b.fillRect(X - d * 3 * k - (d > 0 ? k : 0), Y - 4 * k, k, k);
}
