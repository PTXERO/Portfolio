// Shared motion for the style test: both renderers draw the same world, so the
// comparison is only about looks. Steering is deliberately simple (wander, keep
// apart, stay in the pool); nothing here feeds back into the economy.

export interface Swimmer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  /** Animation clock, offset per swimmer so they don't move in lockstep. */
  phase: number;
  size: number;
  /** Seconds of wobble left after a poke. */
  poked: number;
  hue: number;
}

export interface Creature extends Swimmer {
  segments: number;
}

export interface Quip {
  x: number;
  y: number;
  text: string;
  age: number;
}

export interface World {
  width: number;
  height: number;
  /** Top of the sand; swimmers stay above it, the creature walks on it. */
  floor: number;
  time: number;
  cells: Swimmer[];
  creature: Creature;
  quips: Quip[];
}

const QUIPS = ['eep!', 'hey!', 'rude.', 'blub', '!!', 'boop', 'why', 'mrrp'];
const CELL_SPEED = 26;
const CREATURE_SPEED = 30;

// Seeded random so the scene looks the same every visit.
let seed = 7;
function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

function makeCell(w: World): Swimmer {
  const heading = rand() * Math.PI * 2;
  return {
    x: 20 + rand() * (w.width - 40),
    y: 20 + rand() * (w.floor - 40),
    vx: Math.cos(heading) * CELL_SPEED,
    vy: Math.sin(heading) * CELL_SPEED,
    heading,
    phase: rand() * 10,
    size: 7 + rand() * 4,
    poked: 0,
    hue: rand(),
  };
}

export function createWorld(width: number, height: number, count: number): World {
  seed = 7;
  const floor = height * 0.8;
  const w: World = {
    width,
    height,
    floor,
    time: 0,
    cells: [],
    creature: {
      x: width * 0.3,
      y: floor + 6,
      vx: CREATURE_SPEED,
      vy: 0,
      heading: 0,
      phase: 0,
      size: 14,
      poked: 0,
      hue: 0,
      segments: 3,
    },
    quips: [],
  };
  setCount(w, count);
  return w;
}

export function setCount(w: World, count: number): void {
  while (w.cells.length < count) w.cells.push(makeCell(w));
  w.cells.length = count;
}

export function resize(w: World, width: number, height: number): void {
  const sx = width / w.width;
  const sy = height / w.height;
  for (const c of w.cells) {
    c.x *= sx;
    c.y *= sy;
  }
  w.creature.x *= sx;
  w.width = width;
  w.height = height;
  w.floor = height * 0.8;
  w.creature.y = w.floor + 6;
}

/** Spatial grid so keeping apart stays cheap with hundreds of cells. */
function neighbours(cells: Swimmer[], cellSize: number): Map<number, Swimmer[]> {
  const grid = new Map<number, Swimmer[]>();
  for (const c of cells) {
    const k = Math.floor(c.x / cellSize) * 4096 + Math.floor(c.y / cellSize);
    const list = grid.get(k);
    if (list) list.push(c);
    else grid.set(k, [c]);
  }
  return grid;
}

export function step(w: World, dt: number): void {
  w.time += dt;
  const R = 22;
  const grid = neighbours(w.cells, R);
  for (const c of w.cells) {
    // Wander: the heading drifts smoothly.
    c.heading += Math.sin(w.time * 0.7 + c.phase * 3) * 1.4 * dt;
    let ax = Math.cos(c.heading) * CELL_SPEED - c.vx;
    let ay = Math.sin(c.heading) * CELL_SPEED - c.vy;

    // Keep apart.
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
            ax += (dx / Math.sqrt(d2)) * push * 60;
            ay += (dy / Math.sqrt(d2)) * push * 60;
          }
        }
      }
    }

    // Stay in the pool.
    const m = 24;
    if (c.x < m) ax += (m - c.x) * 4;
    if (c.x > w.width - m) ax -= (c.x - (w.width - m)) * 4;
    if (c.y < m) ay += (m - c.y) * 4;
    if (c.y > w.floor - m) ay -= (c.y - (w.floor - m)) * 4;

    c.vx += ax * dt * 1.5;
    c.vy += ay * dt * 1.5;
    const sp = Math.hypot(c.vx, c.vy);
    const max = c.poked > 0 ? CELL_SPEED * 4 : CELL_SPEED * 1.6;
    if (sp > max) {
      c.vx *= max / sp;
      c.vy *= max / sp;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (c.poked > 0) c.poked = Math.max(0, c.poked - dt);
  }

  // The creature strolls along the sand and turns at the edges.
  const cr = w.creature;
  const speed = cr.poked > 0 ? CREATURE_SPEED * 3 : CREATURE_SPEED;
  if (cr.x < 40) cr.vx = Math.abs(cr.vx);
  if (cr.x > w.width - 40) cr.vx = -Math.abs(cr.vx);
  cr.vx = Math.sign(cr.vx || 1) * speed;
  cr.x += cr.vx * dt;
  cr.y = w.floor + 6 + Math.sin(w.time * 9) * 1.2;
  cr.phase += dt * (speed / 10);
  if (cr.poked > 0) cr.poked = Math.max(0, cr.poked - dt);

  for (const q of w.quips) q.age += dt;
  w.quips = w.quips.filter((q) => q.age < 1.4);
}

/** Pokes whatever is under the finger. Returns true if something was hit. */
export function poke(w: World, x: number, y: number): boolean {
  const cr = w.creature;
  const hitCreature = Math.hypot(cr.x - x, cr.y - 8 - y) < 34;
  let target: Swimmer | null = hitCreature ? cr : null;
  if (!target) {
    let best = 30;
    for (const c of w.cells) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < best) {
        best = d;
        target = c;
      }
    }
  }
  if (!target) return false;
  target.poked = 0.7;
  if (target === cr) cr.vx = cr.x < x ? -1 : 1;
  else {
    const a = Math.atan2(target.y - y, target.x - x);
    target.vx = Math.cos(a) * CELL_SPEED * 4;
    target.vy = Math.sin(a) * CELL_SPEED * 4;
    target.heading = a;
  }
  w.quips.push({ x: target.x, y: target.y - 18, text: QUIPS[Math.floor(Math.random() * QUIPS.length)], age: 0 });
  return true;
}
