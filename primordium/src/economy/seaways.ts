// Ports and sea lanes for the world map. Every island has one port on its coast; a route sails
// from the port of whichever of your islands lies nearest its far end, to the port there, by the
// sea: round the islands in the way, never across them. (Only how a route is drawn and sailed on
// the map: what it earns is the trade network's business.)

import { MASK, coastAt } from './coast';
import { homeOf, ours, type World, type WorldIsle } from './sail';

export interface Pt {
  x: number;
  y: number;
}

/** Map units of sea kept clear of a coast (ships keep off the rocks). */
const OFFSHORE = 4;
/** Map units a cell of the sea's grid covers. */
const CELL = 4;

/** Whether a point on the map is land (or too near a coast to sail): any island's coast there. */
export function landAt(world: World, x: number, y: number, pad = OFFSHORE): boolean {
  for (const i of world.isles) {
    if (Math.abs(x - i.x) > i.r + pad || Math.abs(y - i.y) > i.r + pad) continue;
    if (landOf(i, x, y, pad)) return true;
  }
  return false;
}
/** Whether a point's on (or just off) one island's coast. */
function landOf(i: WorldIsle, x: number, y: number, pad: number): boolean {
  const k = MASK / (i.r * 2);
  const cx = (x - (i.x - i.r)) * k;
  const cy = (y - (i.y - i.r)) * k;
  const p = Math.ceil(pad * k);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -p; dy <= p; dy++)
    for (let dx = -p; dx <= p; dx++) {
      if (dx * dx + dy * dy > p * p + 1) continue;
      if (coastAt(i.mask, x0 + dx, y0 + dy)) return true;
    }
  return false;
}

const ports = new Map<string, Pt>();
/** An island's port: out on its coast, on the side facing where its trade comes from (home, for
 * every other island; home's own faces the nearest of its neighbours). */
export function portOf(world: World, i: WorldIsle): Pt {
  const key = `${world.seed}:${i.id}`;
  const had = ports.get(key);
  if (had) return had;
  const home = homeOf(world);
  let toward: WorldIsle = home;
  if (i === home) {
    let best = Infinity;
    for (const o of world.isles) {
      if (o === i) continue;
      const d = Math.hypot(o.x - i.x, o.y - i.y) - o.r;
      if (d < best) {
        best = d;
        toward = o;
      }
    }
  }
  // All round the island, out from its middle to the first open water past its own coast; of
  // those, the one nearest where its trade comes from.
  let at: Pt = { x: i.x, y: i.y + i.r };
  let best = Infinity;
  for (let a = 0; a < 72; a++) {
    const ux = Math.cos((a / 72) * Math.PI * 2);
    const uy = Math.sin((a / 72) * Math.PI * 2);
    // (Out to where its own coast ends, then on to where no coast at all is near.)
    let s = i.r * 1.2;
    while (s > 0 && !landOf(i, i.x + ux * s, i.y + uy * s, 0)) s -= 1;
    let p: Pt | null = null;
    for (let e = s + 1; e < s + 40; e += 1) {
      const x = i.x + ux * e;
      const y = i.y + uy * e;
      if (!landAt(world, x, y)) {
        p = { x, y };
        break;
      }
    }
    if (!p) continue;
    const d = Math.hypot(p.x - toward.x, p.y - toward.y) + Math.hypot(p.x - i.x, p.y - i.y) * 0.5;
    if (d < best) {
      best = d;
      at = p;
    }
  }
  ports.set(key, at);
  return at;
}

/** Of your islands, the one whose port lies nearest an island's: where its route sails from. */
export function routeFrom(world: World, to: WorldIsle): WorldIsle {
  const there = portOf(world, to);
  let best = homeOf(world);
  let bestD = Infinity;
  for (const i of world.isles) {
    if (!ours(i) || i === to) continue;
    const p = portOf(world, i);
    const d = Math.hypot(p.x - there.x, p.y - there.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const lanes = new Map<string, Pt[]>();
/** The way by sea from one island's port to another's: round whatever's in between, never over
 * land. Points along it, port to port. */
export function seaLane(world: World, from: WorldIsle, to: WorldIsle): Pt[] {
  const key = `${world.seed}:${from.id}>${to.id}`;
  const had = lanes.get(key);
  if (had) return had;
  const a = portOf(world, from);
  const b = portOf(world, to);
  const lane = smooth(world, pull(world, astar(world, a, b) ?? [a, b]));
  lanes.set(key, lane);
  return lane;
}

/** A* over the sea's grid, eight ways. */
function astar(world: World, a: Pt, b: Pt): Pt[] | null {
  const gw = Math.ceil(world.w / CELL);
  const gh = Math.ceil(world.h / CELL);
  const sea = new Int8Array(gw * gh).fill(-1);
  const open = (c: number) => {
    if (sea[c] < 0) sea[c] = landAt(world, (c % gw) * CELL + CELL / 2, Math.floor(c / gw) * CELL + CELL / 2) ? 0 : 1;
    return sea[c] === 1;
  };
  const cell = (p: Pt) => Math.max(0, Math.min(gh - 1, Math.floor(p.y / CELL))) * gw + Math.max(0, Math.min(gw - 1, Math.floor(p.x / CELL)));
  const start = cell(a);
  const goal = cell(b);
  const gx = goal % gw;
  const gy = Math.floor(goal / gw);
  const h = (c: number) => {
    const dx = Math.abs((c % gw) - gx);
    const dy = Math.abs(Math.floor(c / gw) - gy);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const g = new Float32Array(gw * gh).fill(Infinity);
  const back = new Int32Array(gw * gh).fill(-1);
  const done = new Uint8Array(gw * gh);
  // (A plain binary heap of [cost, cell].)
  const heap: number[] = [];
  const push = (f: number, c: number) => {
    heap.push(f, c);
    let i = heap.length / 2 - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p * 2] <= heap[i * 2]) break;
      [heap[p * 2], heap[i * 2]] = [heap[i * 2], heap[p * 2]];
      [heap[p * 2 + 1], heap[i * 2 + 1]] = [heap[i * 2 + 1], heap[p * 2 + 1]];
      i = p;
    }
  };
  const pop = (): number => {
    const c = heap[1];
    const lf = heap.pop()!;
    const lastF = heap.pop()!;
    if (heap.length) {
      heap[0] = lastF;
      heap[1] = lf;
      let i = 0;
      const n = heap.length / 2;
      for (;;) {
        let m = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < n && heap[l * 2] < heap[m * 2]) m = l;
        if (r < n && heap[r * 2] < heap[m * 2]) m = r;
        if (m === i) break;
        [heap[m * 2], heap[i * 2]] = [heap[i * 2], heap[m * 2]];
        [heap[m * 2 + 1], heap[i * 2 + 1]] = [heap[i * 2 + 1], heap[m * 2 + 1]];
        i = m;
      }
    }
    return c;
  };
  g[start] = 0;
  push(h(start), start);
  sea[start] = 1;
  sea[goal] = 1;
  while (heap.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === goal) break;
    const cx = c % gw;
    const cy = Math.floor(c / gw);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (done[n] || !open(n)) continue;
        if (dx && dy && (!open(cy * gw + nx) || !open(ny * gw + cx))) continue;
        const ng = g[c] + (dx && dy ? 1.414 : 1);
        if (ng >= g[n]) continue;
        g[n] = ng;
        back[n] = c;
        push(ng + h(n), n);
      }
  }
  if (!done[goal]) return null;
  const out: Pt[] = [];
  for (let c = goal; c >= 0; c = back[c]) out.unshift({ x: (c % gw) * CELL + CELL / 2, y: Math.floor(c / gw) * CELL + CELL / 2 });
  out[0] = a;
  out[out.length - 1] = b;
  return out;
}

/** Whether a straight run between two points keeps to open sea. */
function clear(world: World, a: Pt, b: Pt, pad = OFFSHORE): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5);
  for (let k = 1; k < n; k++) if (landAt(world, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n, pad)) return false;
  return true;
}
/** Straightened: on from each point to the furthest it can see in open sea. */
function pull(world: World, path: Pt[]): Pt[] {
  if (path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !clear(world, path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}
/** Its corners rounded (a sailing line, not a ruler's), only where the rounding stays at sea. */
function smooth(world: World, path: Pt[]): Pt[] {
  let p = path;
  for (let pass = 0; pass < 3; pass++) {
    if (p.length < 3) return p;
    const out: Pt[] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k];
      const b = p[k + 1];
      const q = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
      const r = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
      if (k > 0) out.push(landAt(world, q.x, q.y) ? a : q);
      if (k < p.length - 2) out.push(landAt(world, r.x, r.y) ? b : r);
    }
    out.push(p[p.length - 1]);
    // (Kept only if every stretch of it is still at sea: a rounding mustn't cut a headland.)
    if (!out.every((q, k) => k === 0 || clear(world, out[k - 1], q, 1))) break;
    p = out;
  }
  return p;
}

/** A lane's length, and the point a share of the way along it (with which way it's heading). */
export function laneLength(lane: Pt[]): number {
  let n = 0;
  for (let k = 1; k < lane.length; k++) n += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].y - lane[k - 1].y);
  return n;
}
export function alongLane(lane: Pt[], s: number): { x: number; y: number; dx: number; dy: number } {
  const total = laneLength(lane);
  let left = Math.max(0, Math.min(1, s)) * total;
  for (let k = 1; k < lane.length; k++) {
    const a = lane[k - 1];
    const b = lane[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= d || k === lane.length - 1) {
      const f = d ? Math.min(1, left / d) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / (d || 1), dy: (b.y - a.y) / (d || 1) };
    }
    left -= d;
  }
  const p = lane[0];
  return { x: p.x, y: p.y, dx: 1, dy: 0 };
}
