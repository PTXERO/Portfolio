// A swarm of swimming cells for the scene. Purely visual: steering is wander,
// keep apart and stay in the water. All units are art pixels.
//
// The swarm grows the way cells do: when it should hold more, an existing cell
// stretches, pinches and splits in two. When it should hold fewer, extra cells
// blink out.

export interface Swimmer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  phase: number;
  /** Seconds of panic left after a poke. */
  poked: number;
  /** Seconds into a division, or -1. */
  split: number;
  /** Whether this division adds a cell (true) or is just for show (false). */
  grows: boolean;
  /** Seconds left before vanishing; 0 when not fading. */
  fade: number;
  dead: boolean;
  /** Seconds of the little squash after being born. */
  pop: number;
}

const SPEED = 9;
const R = 8;
/** Division timeline: stretch, then pinch, then split at SPLIT_AT seconds. */
export const STRETCH_UNTIL = 0.35;
export const SPLIT_AT = 0.65;

export class Swarm {
  cells: Swimmer[] = [];
  target = 0;
  private spawnTimer = 0;
  private burst = 0;
  private burstTimer = 0;

  private make(x: number, y: number, heading: number): Swimmer {
    return {
      x,
      y,
      vx: Math.cos(heading) * SPEED,
      vy: Math.sin(heading) * SPEED,
      heading,
      phase: Math.random() * 10,
      poked: 0,
      split: -1,
      grows: false,
      fade: 0,
      dead: false,
      pop: 0,
    };
  }

  /** Puts `n` cells in place at once, with no animation (loading a save). */
  fill(n: number, w: number, floor: number, top = 0): void {
    this.cells = [];
    for (let i = 0; i < n; i++) this.cells.push(this.make(8 + Math.random() * (w - 16), top + 8 + Math.random() * Math.max(1, floor - top - 16), Math.random() * Math.PI * 2));
    this.target = n;
  }

  /** Plays divisions just for show; the population stays on target. */
  divideBurst(n: number): void {
    this.burst += n;
  }

  private startDivision(grows: boolean): boolean {
    const free = this.cells.filter((c) => c.split < 0 && c.fade === 0);
    if (!free.length) return false;
    const c = free[Math.floor(Math.random() * free.length)];
    c.split = 0;
    c.grows = grows;
    return true;
  }

  step(dt: number, t: number, w: number, floor: number, top = 0): void {
    // Grow or shrink toward the target, one division at a time.
    const alive = this.cells.filter((c) => c.fade === 0).length;
    const growing = this.cells.filter((c) => c.split >= 0 && c.grows).length;
    this.spawnTimer -= dt;
    if (alive + growing < this.target && this.spawnTimer <= 0) {
      if (alive === 0) {
        const c = this.make(w / 2, (top + floor) / 2, Math.random() * Math.PI * 2);
        c.pop = 0.3;
        this.cells.push(c);
      } else this.startDivision(true);
      this.spawnTimer = 0.18;
    } else if (alive > this.target) {
      const c = this.cells.find((x) => x.fade === 0 && x.split < 0);
      if (c) c.fade = 0.6;
    }
    this.burstTimer -= dt;
    if (this.burst > 0 && this.burstTimer <= 0 && this.startDivision(false)) {
      this.burst--;
      this.burstTimer = 0.2;
    }

    const grid = new Map<number, Swimmer[]>();
    for (const c of this.cells) {
      const k = Math.floor(c.x / R) * 4096 + Math.floor(c.y / R);
      const list = grid.get(k);
      if (list) list.push(c);
      else grid.set(k, [c]);
    }
    const born: Swimmer[] = [];
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
      if (c.y < top + m) ay += (top + m - c.y) * 4;
      if (c.y > floor - m) ay -= (c.y - (floor - m)) * 4;
      c.vx += ax * dt * 1.5;
      c.vy += ay * dt * 1.5;
      const sp = Math.hypot(c.vx, c.vy);
      // A dividing cell slows almost to a stop.
      const max = c.split >= 0 ? SPEED * 0.2 : c.poked > 0 ? SPEED * 4 : SPEED * 1.6;
      if (sp > max) {
        c.vx *= max / sp;
        c.vy *= max / sp;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.poked > 0) c.poked = Math.max(0, c.poked - dt);
      if (c.pop > 0) c.pop = Math.max(0, c.pop - dt);
      if (c.fade > 0) {
        c.fade -= dt;
        if (c.fade <= 0) c.dead = true;
      }

      if (c.split >= 0) {
        c.split += dt;
        if (c.split >= SPLIT_AT) {
          // The split: two daughters push apart, sideways from the swim direction.
          c.split = -1;
          const side = c.vx < 0 ? -1 : 1;
          const d = this.make(c.x + 4 * side, c.y, c.heading);
          c.x -= 4 * side;
          c.vx = -SPEED * 2 * side;
          d.vx = SPEED * 2 * side;
          c.pop = d.pop = 0.3;
          born.push(d);
          if (!c.grows) {
            // A show division: someone else quietly leaves to keep the count.
            const other = this.cells.find((x) => x !== c && x.fade === 0 && x.split < 0);
            if (other) other.fade = 0.6;
          }
        }
      }
    }
    this.cells.push(...born);
    this.cells = this.cells.filter((c) => !c.dead);
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
    for (const c of this.cells) {
      if (c.split >= 0) continue;
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
