// Finding the way over the island: round lakes, along shores, never into the sea. A* over a
// coarse grid (a cell every few tiles), then straightened, so they walk in natural lines rather
// than from cell to cell. Rivers can be waded (they're land, for walking).

import { Biome, isLand, type Island, type Pt } from './island';

/** Tiles per cell of the walking grid. */
const PC = 3;

class Heap {
  private keys: number[] = [];
  private ids: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const k = this.keys;
    const v = this.ids;
    let i = v.length;
    k.push(key);
    v.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = id;
  }
  pop(): number {
    const k = this.keys;
    const v = this.ids;
    const top = v[0];
    const key = k.pop()!;
    const id = v.pop()!;
    if (v.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= v.length) break;
        if (c + 1 < v.length && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = key;
      v[i] = id;
    }
    return top;
  }
}

/** Whether a straight walk between two points stays on land the whole way. */
export function clearLine(is: Island, a: Pt, b: Pt): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.ceil(d / 0.7);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!isLand(is, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/**
 * The way from one point to another, as the points to walk to in turn (the last is where
 * they're going, or, if that's in the water or can't be reached, the nearest they can get).
 * Empty if they're there already.
 */
export function findPath(is: Island, from: Pt, to: Pt, limit = 120000, speedAt?: (x: number, y: number) => number): Pt[] {
  // (With roads about, the way's weighed by how quick each stretch is: the roads favoured.)
  const fast = speedAt ? (c: number) => speedAt((c % G) * PC + PC / 2, Math.floor(c / G) * PC + PC / 2) : null;
  // (Hopeful about the roads, but not too: the way found quickly, and near enough the best.)
  const top = fast ? 2 : 1;
  /** Whether a straight walk between two points keeps off the roads the whole way. */
  function offRoad(a: Pt, b: Pt): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / 1.5));
    for (let i = 0; i <= n; i++) if (speedAt!(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n) > 1) return false;
    return true;
  }
  if (clearLine(is, from, to) && (!speedAt || offRoad(from, to))) return [{ ...to }];
  const G = Math.floor(is.n / PC);
  const cell = (p: Pt) => Math.max(0, Math.min(G - 1, Math.floor(p.y / PC))) * G + Math.max(0, Math.min(G - 1, Math.floor(p.x / PC)));
  const mid = (c: number): Pt => ({ x: (c % G) * PC + PC / 2, y: Math.floor(c / G) * PC + PC / 2 });
  const walkable = (c: number) => {
    const m = mid(c);
    return isLand(is, m.x, m.y);
  };
  const start = cell(from);
  const goal = cell(to);
  const gx = goal % G;
  const gy = Math.floor(goal / G);
  const h = (c: number) => {
    const dx = Math.abs((c % G) - gx);
    const dy = Math.abs(Math.floor(c / G) - gy);
    return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) / top;
  };
  const cost = new Float32Array(G * G).fill(Infinity);
  const from_ = new Int32Array(G * G).fill(-1);
  const closed = new Uint8Array(G * G);
  const open = new Heap();
  cost[start] = 0;
  open.push(start, h(start));
  // The nearest they could get, should the goal be out of reach (in a lake, over the sea).
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  while (open.size && expanded < limit) {
    const c = open.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    expanded++;
    const hc = h(c);
    if (hc < bestH) {
      bestH = hc;
      best = c;
    }
    if (c === goal) break;
    const cx = c % G;
    const cy = Math.floor(c / G);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const n = ny * G + nx;
        if (closed[n] || !walkable(n)) continue;
        // (No cutting a corner between two water cells.)
        if (dx && dy && (!walkable(cy * G + nx) || !walkable(ny * G + cx))) continue;
        const nc = cost[c] + (dx && dy ? 1.414 : 1) * (fast ? 2 / (fast(c) + fast(n)) : 1);
        if (nc >= cost[n]) continue;
        cost[n] = nc;
        from_[n] = c;
        open.push(n, nc + h(n));
      }
    }
  }
  const end = closed[goal] ? goal : best;
  const cells: Pt[] = [];
  for (let c = end; c !== start && c >= 0; c = from_[c]) cells.unshift(mid(c));
  // The goal itself, if it's on land and reached; else the middle of the nearest cell.
  const last = end === goal && isLand(is, to.x, to.y) ? { ...to } : cells.length ? cells[cells.length - 1] : { ...from };
  if (cells.length) cells[cells.length - 1] = last;
  else cells.push(last);
  // Straightened: from each point, on to the furthest one that can be walked to in a line.
  const out: Pt[] = [];
  let at = from;
  let i = 0;
  while (i < cells.length) {
    // (Looking a fair way ahead, not the whole way: long walks stay quick to work out.)
    let j = Math.min(cells.length - 1, i + 50);
    // (Straightened only off the roads: on them, the way keeps to the road.)
    while (j > i && !(clearLine(is, at, cells[j]) && (!speedAt || offRoad(at, cells[j])))) j--;
    out.push(cells[j]);
    at = cells[j];
    i = j + 1;
  }
  return out;
}

/** What each kind of ground costs to cross (a road, or a long walk): rock and peaks dear, high
 * ground and marsh more than the plain; and every climb or drop costs too. */
const GROUND: Record<number, number> = { [Biome.Peak]: 6, [Biome.Rock]: 3, [Biome.High]: 1.7, [Biome.Marsh]: 1.8, [Biome.River]: 1.5, [Biome.Forest]: 1.2, [Biome.Sand]: 1.1 };
const CLIMB = 24;

/**
 * The way a road would go (or a long walk, the sensible way): round the water as `findPath`
 * does, and round the mountains too, weighing the ground and the climbs. As the cells to pass
 * through (not straightened: it keeps to the low ground), and what the way costs (one for each
 * cell of flat open ground).
 */
export function findRoute(is: Island, from: Pt, to: Pt, limit = 120000): { pts: Pt[]; cost: number } {
  const G = Math.floor(is.n / PC);
  const cell = (p: Pt) => Math.max(0, Math.min(G - 1, Math.floor(p.y / PC))) * G + Math.max(0, Math.min(G - 1, Math.floor(p.x / PC)));
  const mid = (c: number): Pt => ({ x: (c % G) * PC + PC / 2, y: Math.floor(c / G) * PC + PC / 2 });
  const tile = (c: number) => {
    const m = mid(c);
    return Math.floor(m.y) * is.n + Math.floor(m.x);
  };
  const walkable = (c: number) => {
    const m = mid(c);
    return isLand(is, m.x, m.y);
  };
  const ground = (c: number) => GROUND[is.biome[tile(c)]] ?? 1;
  const start = cell(from);
  const goal = cell(to);
  const gx = goal % G;
  const gy = Math.floor(goal / G);
  const h = (c: number) => {
    const dx = Math.abs((c % G) - gx);
    const dy = Math.abs(Math.floor(c / G) - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const cost = new Float32Array(G * G).fill(Infinity);
  const back = new Int32Array(G * G).fill(-1);
  const closed = new Uint8Array(G * G);
  const open = new Heap();
  cost[start] = 0;
  open.push(start, h(start));
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  while (open.size && expanded < limit) {
    const c = open.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    expanded++;
    const hc = h(c);
    if (hc < bestH) {
      bestH = hc;
      best = c;
    }
    if (c === goal) break;
    const cx = c % G;
    const cy = Math.floor(c / G);
    const hgt = is.height[tile(c)];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const n = ny * G + nx;
        if (closed[n] || !walkable(n)) continue;
        if (dx && dy && (!walkable(cy * G + nx) || !walkable(ny * G + cx))) continue;
        const step = (dx && dy ? 1.414 : 1) * (ground(c) + ground(n)) * 0.5 + Math.abs(is.height[tile(n)] - hgt) * CLIMB;
        const nc = cost[c] + step;
        if (nc >= cost[n]) continue;
        cost[n] = nc;
        back[n] = c;
        open.push(n, nc + h(n));
      }
    }
  }
  const end = closed[goal] ? goal : best;
  const pts: Pt[] = [];
  for (let c = end; c !== start && c >= 0; c = back[c]) pts.unshift(mid(c));
  pts.unshift({ ...from });
  if (end === goal && isLand(is, to.x, to.y)) pts[pts.length - 1] = { ...to };
  // (Not reached, by water or too far to search: the rest of the way still counts, the long way
  // round, so somewhere out of reach never looks near.)
  const rest = end === goal ? 0 : Math.hypot(to.x - mid(end).x, to.y - mid(end).y) / PC * 1.5;
  return { pts, cost: (cost[end] === Infinity ? h(start) : cost[end]) + rest };
}
