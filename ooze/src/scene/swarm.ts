// A swarm of swimming cells for the scene. Purely visual: steering is wander,
// keep apart and stay in the water. All units are art pixels.

export interface Swimmer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  phase: number;
  /** Seconds of panic left after a poke. */
  poked: number;
}

const SPEED = 9;
const R = 8;

let seed = 11;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

export class Swarm {
  cells: Swimmer[] = [];

  setCount(n: number, w: number, floor: number): void {
    while (this.cells.length < n) {
      const heading = rand() * Math.PI * 2;
      this.cells.push({
        x: 8 + rand() * (w - 16),
        y: 8 + rand() * (floor - 16),
        vx: Math.cos(heading) * SPEED,
        vy: Math.sin(heading) * SPEED,
        heading,
        phase: rand() * 10,
        poked: 0,
      });
    }
    this.cells.length = n;
  }

  step(dt: number, t: number, w: number, floor: number): void {
    const grid = new Map<number, Swimmer[]>();
    for (const c of this.cells) {
      const k = Math.floor(c.x / R) * 4096 + Math.floor(c.y / R);
      const list = grid.get(k);
      if (list) list.push(c);
      else grid.set(k, [c]);
    }
    for (const c of this.cells) {
      c.heading += Math.sin(t * 0.7 + c.phase * 3) * 1.4 * dt;
      let ax = Math.cos(c.heading) * SPEED - c.vx;
      let ay = Math.sin(c.heading) * SPEED - c.vy;
      const gx = Math.floor(c.x / R);
      const gy = Math.floor(c.y / R);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (const o of grid.get((gx + i) * 4096 + gy + j) ?? []) {
            if (o === c) continue;
            const dx = c.x - o.x;
            const dy = c.y - o.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0 && d2 < R * R) {
              const push = (R * R - d2) / (R * R);
              const d = Math.sqrt(d2);
              ax += (dx / d) * push * 20;
              ay += (dy / d) * push * 20;
            }
          }
        }
      }
      const m = 8;
      if (c.x < m) ax += (m - c.x) * 4;
      if (c.x > w - m) ax -= (c.x - (w - m)) * 4;
      if (c.y < m) ay += (m - c.y) * 4;
      if (c.y > floor - m) ay -= (c.y - (floor - m)) * 4;
      c.vx += ax * dt * 1.5;
      c.vy += ay * dt * 1.5;
      const sp = Math.hypot(c.vx, c.vy);
      const max = c.poked > 0 ? SPEED * 4 : SPEED * 1.6;
      if (sp > max) {
        c.vx *= max / sp;
        c.vy *= max / sp;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.poked > 0) c.poked = Math.max(0, c.poked - dt);
    }
  }

  /** Startles the cell nearest (x, y). Returns it, or null if none was close. */
  poke(x: number, y: number): Swimmer | null {
    let best = 12;
    let hit: Swimmer | null = null;
    for (const c of this.cells) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < best) {
        best = d;
        hit = c;
      }
    }
    // Everything nearby flinches away from the finger.
    for (const c of this.cells) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < 24) {
        const a = Math.atan2(c.y - y, c.x - x);
        c.vx = Math.cos(a) * SPEED * 4;
        c.vy = Math.sin(a) * SPEED * 4;
        c.heading = a;
        c.poked = 0.6;
      }
    }
    return hit;
  }
}
