// The Age of Sail: the world, as a map. The islands they hopped are the first shapes on it (each
// its own coast, from its own land), the last of them (the Republic) home, in the middle; the
// rest of the world is islands still in the fog. (Ships, routes and Influence come next.)

import type { GameState } from './types';
import type { Pt } from './island';
import { MASK, coastOfIsland, packCoast } from './coast';
import { baseRate, shoreIsland, shoreOf, terrainReady, type PastIsland, type ShoreState } from './shore';

export { MASK, coastAt } from './coast';

/** An island on the world map: where, how big, its coast (a little grid, packed), whose. */
export interface WorldIsle {
  id: number;
  x: number;
  y: number;
  /** Its size on the map (map units across). */
  r: number;
  /** Its coast: MASK × MASK cells, land 1, packed as hex. */
  mask: string;
  /** Yours: which of the islands hopped (0: the first), or -1 for home. Unset: someone else's. */
  mine?: number;
  /** Seen from your islands (out of the fog). */
  found: boolean;
}
export interface World {
  seed: number;
  /** The map's size (map units). */
  w: number;
  h: number;
  isles: WorldIsle[];
  /** The trade routes sailed from home: to which island, and how many ships run it. */
  routes?: Route[];
  /** The network's upgrades: each branch's level. */
  ups?: Partial<Record<SailUp, number>>;
}
export interface Route {
  to: number;
  ships: number;
}

/** How far from your islands the fog's lifted (map units), before Charts. */
export const SIGHT = 110;
/** How much further each level of Charts sees. */
const CHART_SIGHT = 45;
export function sightOf(world: World): number {
  return SIGHT + CHART_SIGHT * level(world, 'charts');
}

function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An island's coast from its own land (its height map, shrunk). */
export function coastOf(seed: number): string {
  return coastOfIsland(shoreIsland(seed));
}

/** A coast made up (for an island never set foot on): a lumpy blob, a bay or two bitten out. */
export function blobCoast(seed: number): string {
  const r = rng(seed);
  const bumps = Array.from({ length: 7 }, () => ({ a: r() * Math.PI * 2, k: 0.12 + r() * 0.22, f: 2 + Math.floor(r() * 4) }));
  const bites = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ x: 0.2 + r() * 0.6, y: 0.2 + r() * 0.6, s: 0.08 + r() * 0.14 }));
  const cells: boolean[] = [];
  for (let y = 0; y < MASK; y++)
    for (let x = 0; x < MASK; x++) {
      const dx = (x + 0.5) / MASK - 0.5;
      const dy = (y + 0.5) / MASK - 0.5;
      const a = Math.atan2(dy, dx);
      let edge = 0.36;
      for (const b of bumps) edge += Math.sin(a * b.f + b.a) * b.k * 0.25;
      let land = Math.hypot(dx, dy) < edge;
      for (const b of bites) if (Math.hypot(dx + 0.5 - b.x, dy + 0.5 - b.y) < b.s && Math.hypot(dx, dy) > edge * 0.55) land = false;
      cells.push(land);
    }
  return packCoast(cells);
}

/** The world made, once, when they set sail: the islands hopped, in the order they came to
 * them (a hop apart, the last of them home in the middle), and the rest scattered in the fog. */
export function makeWorld(s: ShoreState): World {
  const seed = (s.seed * 7919 + 17) % 2147483647;
  const r = rng(seed);
  const W = 1000;
  const H = 1400;
  const isles: WorldIsle[] = [];
  const past: PastIsland[] = s.past ?? [];
  // Home in the middle; the islands before it back along the way they came, a hop each.
  const home = { x: W / 2, y: H / 2 };
  let dir = r() * Math.PI * 2;
  const chain: Pt[] = [];
  let at = { ...home };
  for (let k = past.length - 1; k >= 0; k--) {
    dir += (r() - 0.5) * 1.4;
    at = { x: at.x + Math.cos(dir) * 120, y: at.y + Math.sin(dir) * 120 };
    chain.unshift({ ...at });
  }
  past.forEach((p, k) => isles.push({ id: isles.length, x: chain[k].x, y: chain[k].y, r: 60, mask: p.mask ?? (terrainReady(p.seed) ? coastOf(p.seed) : blobCoast(p.seed)), mine: k, found: true }));
  isles.push({ id: isles.length, x: home.x, y: home.y, r: 70, mask: terrainReady(s.seed) ? coastOf(s.seed) : blobCoast(s.seed), mine: -1, found: true });
  // Neighbours: a few islands a short sail from home (the first routes go to them).
  for (let tries = 0, near = 0; tries < 2000 && near < 3; tries++) {
    const a = r() * Math.PI * 2;
    const d = 115 + r() * 50;
    const x = home.x + Math.cos(a) * d;
    const y = home.y + Math.sin(a) * d;
    const size = 26 + r() * 20;
    if (isles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + size) * 0.75 + 14)) continue;
    isles.push({ id: isles.length, x, y, r: size, mask: blobCoast(seed + 7 + tries * 17), found: false });
    near++;
  }
  // The rest of the world: islands scattered over the sea, none too close to another.
  for (let tries = 0; tries < 4000 && isles.length < 60; tries++) {
    const x = 40 + r() * (W - 80);
    const y = 40 + r() * (H - 80);
    const size = 22 + r() * r() * 70;
    if (isles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + size) * 0.75 + 14)) continue;
    isles.push({ id: isles.length, x, y, r: size, mask: blobCoast(seed + tries * 131), found: false });
  }
  const world: World = { seed, w: W, h: H, isles, routes: [], ups: {} };
  chart(world);
  // (The first route, to the nearest island, comes free, with a ship on it: it starts going.)
  const first = routeOptions(world)[0];
  if (first) world.routes!.push({ to: first.id, ships: 1 });
  return world;
}

/** The fog lifted round your islands: what's within sight of one is found. */
export function chart(world: World): void {
  const mine = world.isles.filter((i) => i.mine !== undefined);
  const sight = sightOf(world);
  for (const i of world.isles) if (!i.found && mine.some((m) => Math.hypot(m.x - i.x, m.y - i.y) < sight + m.r * 0.5 + i.r * 0.5)) i.found = true;
}

/** Whether the Age of Sail's open (the Republic stands). */
export function canSail(state: GameState): boolean {
  const s = shoreOf(state);
  return !!s && (s.culture?.age ?? 0) >= 6;
}

/** Setting sail: the world made from the islands they hopped, and the Age of Sail opens. */
export function setSail(state: GameState): boolean {
  const s = shoreOf(state);
  if (!s || !canSail(state)) return false;
  const st = state.stages.sail;
  if (!st.world) {
    st.world = makeWorld(s);
  }
  if (!state.unlocked.includes('sail')) state.unlocked.push('sail');
  state.current = 'sail';
  return true;
}

// ---- The trade network: ships on routes, Influence per trip ----

export type SailUp = 'sails' | 'holds' | 'fleet' | 'charts' | 'passage';
/** The network's branches, levelled like the Cell's mutations: each level a pricier step. */
export const SAIL_UPS: { id: SailUp; name: string; does: string; most: number; cost: number; growth: number }[] = [
  { id: 'sails', name: 'Sails', does: 'Ships ×1.3 faster.', most: 10, cost: 300, growth: 9 },
  { id: 'holds', name: 'Holds', does: 'Each trip carries ×1.6.', most: 5, cost: 4000, growth: 40 },
  { id: 'fleet', name: 'Fleet', does: 'Every ship pays ×1.25.', most: 10, cost: 1500, growth: 11 },
  { id: 'charts', name: 'Charts', does: 'See further: new islands, new routes.', most: 5, cost: 6000, growth: 25 },
  { id: 'passage', name: 'Passage', does: '1: ships bought for you · 2: routes opened for you.', most: 2, cost: 1e5, growth: 300 },
];
export function level(world: World, id: SailUp): number {
  return world.ups?.[id] ?? 0;
}
export function upCost(world: World, id: SailUp): number | null {
  const u = SAIL_UPS.find((x) => x.id === id)!;
  const lv = level(world, id);
  return lv >= u.most ? null : Math.round(u.cost * u.growth ** lv);
}

/** Home: where every route sails from. */
export function homeOf(world: World): WorldIsle {
  return world.isles.find((i) => i.mine === -1)!;
}
/** How far a route sails (coast to coast, map units). */
export function routeDist(world: World, to: number): number {
  const h = homeOf(world);
  const i = world.isles[to];
  return Math.max(30, Math.hypot(i.x - h.x, i.y - h.y) - (h.r + i.r) * 0.4);
}
/** Islands a route could go to (found, none yet), nearest first. */
export function routeOptions(world: World): WorldIsle[] {
  const taken = new Set((world.routes ?? []).map((r) => r.to));
  return world.isles.filter((i) => i.found && i.mine !== -1 && !taken.has(i.id)).sort((a, b) => routeDist(world, a.id) - routeDist(world, b.id));
}
/** How a route's distance scales its prices and its pay (1 at a short hop). */
const far = (d: number) => d / 100;
export function openCost(world: World, to: number): number {
  return Math.ceil(40 * far(routeDist(world, to)) ** 5);
}
export function shipCost(world: World, r: Route, n = 1): number {
  const base = 6 * far(routeDist(world, r.to)) ** 2.6;
  let total = 0;
  for (let k = 0; k < n; k++) total += base * SHIP_GROWTH ** (r.ships + k);
  return Math.ceil(total);
}
const SHIP_GROWTH = 1.15;
/** As many ships as there's Influence for (at most `cap`). */
export function shipsAffordable(world: World, r: Route, have: number, cap = 1000): number {
  let n = 0;
  while (n < cap && shipCost(world, r, n + 1) <= have) n++;
  return n;
}
/** Map units a ship sails in a second. */
export function shipSpeed(world: World): number {
  return 12 * 1.3 ** level(world, 'sails');
}
/** ×2 for each of 10, 25, 50 and 100 ships on a route (the same rule as every stage). */
export function milestone(ships: number): number {
  return [10, 25, 50, 100].filter((n) => ships >= n).length;
}
/** Influence a trip brings in. */
export function tripPay(state: GameState, world: World, r: Route): number {
  return 3 * far(routeDist(world, r.to)) ** 2 * 1.6 ** level(world, 'holds') * 1.25 ** level(world, 'fleet') * 2 ** milestone(r.ships) * foodMult(state);
}
/** Seconds a ship takes there and back. */
export function tripTime(world: World, r: Route): number {
  return (2 * routeDist(world, r.to)) / shipSpeed(world);
}
/** Your islands' food still coming in: a multiplier on everything at sea. */
export function foodMult(state: GameState): number {
  const s = shoreOf(state);
  return 1 + Math.log10(1 + (s ? baseRate(s) : 0)) / 10;
}
/** Influence a second from one route (gusting: ×2 while the wind's in its sails). */
export function routeRate(state: GameState, world: World, r: Route, i?: number): number {
  return (r.ships * tripPay(state, world, r)) / tripTime(world, r) * (i !== undefined && gustLeft(world, i) > 0 ? 2 : 1);
}
export function sailRate(state: GameState): number {
  const world = state.stages.sail.world;
  if (!world?.routes) return 0;
  return world.routes.reduce((n, r, i) => n + routeRate(state, world, r, i), 0);
}

/** A tapped route: the wind fills its sails, ×2 for a few seconds. */
const gusts = new WeakMap<World, Map<number, number>>();
export const GUST_SECS = 6;
export function gust(world: World, i: number): void {
  if (!gusts.has(world)) gusts.set(world, new Map());
  gusts.get(world)!.set(i, GUST_SECS);
}
export function gustLeft(world: World, i: number): number {
  return gusts.get(world)?.get(i) ?? 0;
}

function influence(state: GameState): number {
  return state.stages.sail.currency.toNumber();
}
function spend(state: GameState, n: number): boolean {
  const st = state.stages.sail;
  if (st.currency.lt(n)) return false;
  st.currency = st.currency.sub(n);
  return true;
}
export function buyShips(state: GameState, i: number, n: number): boolean {
  const world = state.stages.sail.world;
  const r = world?.routes?.[i];
  if (!world || !r || n < 1) return false;
  if (!spend(state, shipCost(world, r, n))) return false;
  r.ships += n;
  return true;
}
export function openRoute(state: GameState, to: number): boolean {
  const world = state.stages.sail.world;
  if (!world || !routeOptions(world).some((x) => x.id === to)) return false;
  if (!spend(state, openCost(world, to))) return false;
  (world.routes ??= []).push({ to, ships: 1 });
  return true;
}
export function buySailUp(state: GameState, id: SailUp): boolean {
  const world = state.stages.sail.world;
  const cost = world && upCost(world, id);
  if (!world || cost === null || cost === undefined || !spend(state, cost)) return false;
  (world.ups ??= {})[id] = level(world, id) + 1;
  if (id === 'charts') chart(world);
  return true;
}

/** The sea's own time: gusts die down, and Passage buys and opens for you. */
export function sailTick(state: GameState, dt: number): void {
  const world = state.stages.sail.world;
  if (!world) return;
  world.routes ??= [];
  const g = gusts.get(world);
  if (g) for (const [i, left] of g) left - dt <= 0 ? g.delete(i) : g.set(i, left - dt);
  const passage = level(world, 'passage');
  if (passage >= 2) {
    const next = routeOptions(world)[0];
    if (next && influence(state) >= openCost(world, next.id)) openRoute(state, next.id);
  }
  if (passage >= 1) {
    // (The cheapest ship there is, as long as there's Influence for one.)
    for (let k = 0; k < 50; k++) {
      let best = -1;
      let bestCost = Infinity;
      world.routes.forEach((r, i) => {
        const c = shipCost(world, r);
        if (c < bestCost) {
          bestCost = c;
          best = i;
        }
      });
      if (best < 0 || !buyShips(state, best, 1)) break;
    }
  }
}
