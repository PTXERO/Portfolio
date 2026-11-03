// The Age of Sail: the world, as a map. The islands they hopped are the first shapes on it (each
// its own coast, from its own land), the last of them (the Republic) home, in the middle; the
// rest of the world is islands still in the fog. (Ships, routes and Influence come next.)

import { milestonesReached } from './rates';
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
  /** Someone else's: how many of them, what they eat, how far they trust you (to 100: they
   * join), gifts given; and whether they've joined. */
  pop?: number;
  diet?: string;
  trust?: number;
  gifts?: number;
  joined?: boolean;
  /** A pirates' haven: only to be taken (and while it stands, pirates raid). */
  haven?: boolean;
}
/** Yours: hopped to (and kept) or joined since. */
export function ours(i: WorldIsle): boolean {
  return i.mine !== undefined || !!i.joined;
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
  /** A voyage out in the fog: from which of yours, toward which island, seconds left of how many. */
  voyage?: { from: number; to: number; left: number; total: number } | null;
  /** Voyages sent so far (each goes further, and takes longer). */
  voyages?: number;
  /** Peoples just met, not yet shown (first contact). */
  met?: number[];
  /** The diet of the critters who set sail (how they meet a new people). */
  diet?: string;
  /** Pirates out on the routes just now: which route, where along it, how many hits left in
   * them, seconds before they sail off, seconds till they take the next ship. */
  pirates?: Pirate[];
  /** What Passage has of the income to spend on ships (half of it). */
  passBudget?: number;
  /** Pirates driven off, ships they've taken, and seconds sailed (pirates come later on). */
  driven?: number;
  lost?: number;
  age?: number;
  /** Passage's harbourmaster told to stop (buying ships, opening routes, sending voyages). */
  passOff?: boolean;
  /** The island last won, still being settled (seconds left): none won till it's done. */
  settling?: { isle: number; left: number } | null;
}
export interface Pirate {
  route: number;
  at: number;
  hp: number;
  left: number;
  next: number;
}
export interface Route {
  to: number;
  ships: number;
}

/** Islands in the world (yours among them). */
const WORLD_ISLES = 46;
/** How far from your islands the fog's lifted (map units), before Charts. */
export const SIGHT = 110;
/** How much further each level of Charts sees. */
const CHART_SIGHT = 25;
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
  for (let tries = 0; tries < 4000 && isles.length < WORLD_ISLES; tries++) {
    const x = 40 + r() * (W - 80);
    const y = 40 + r() * (H - 80);
    const size = 22 + r() * r() * 70;
    if (isles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + size) * 0.75 + 14)) continue;
    isles.push({ id: isles.length, x, y, r: size, mask: blobCoast(seed + tries * 131), found: false });
  }
  // Every other island is a people of its own: bigger islands, more of them; any of the three
  // diets (theirs against yours decides how they're best met).
  const DIETS = ['grazer', 'hunter', 'omnivore'];
  for (const i of isles) {
    if (i.mine !== undefined) continue;
    i.pop = Math.round(10 + i.r * i.r * 0.06 * (0.6 + r() * 0.8));
    i.diet = DIETS[Math.floor(r() * 3)];
    i.trust = 0;
  }
  makeHavens(isles, home);
  const world: World = { seed, w: W, h: H, isles, routes: [], ups: {}, voyages: 0, met: [], diet: s.look.diet === 'none' ? 'omnivore' : s.look.diet };
  chart(world);
  // (The first route, to the nearest island, comes free, with a ship on it: it starts going.)
  const first = routeOptions(world)[0];
  if (first) world.routes!.push({ to: first.id, ships: 1 });
  return world;
}

/** The fog lifted round your islands: what's within sight of one is found. */
export function chart(world: World): void {
  const mine = world.isles.filter(ours);
  for (const i of world.isles) if (!i.found && mine.some((m) => Math.hypot(m.x - i.x, m.y - i.y) < sightFrom(world, m) + m.r * 0.5 + i.r * 0.5)) i.found = true;
}
/** How far the fog's lifted round one of your islands: the islands hopped see with Charts; one
 * joined only its own waters. */
export const JOINED_SIGHT = 30;
export function sightFrom(world: World, i: WorldIsle): number {
  return i.mine !== undefined ? sightOf(world) : JOINED_SIGHT;
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

export type SailUp = 'sails' | 'holds' | 'fleet' | 'charts' | 'passage' | 'guns' | 'winds';
/** The network's branches, levelled like the Cell's mutations: each level a pricier step. */
export const SAIL_UPS: { id: SailUp; name: string; does: string; flavor: string; branch: string; most: number; cost: number; growth: number }[] = [
  // (Each level thirty times the last, as the Cell's are; Passage a step of its own.)
  { id: 'sails', name: 'Sails', does: 'Ships ×1.3 faster.', flavor: 'More canvas, more wind.', branch: 'Speed', most: 10, cost: 300, growth: 30 },
  { id: 'holds', name: 'Holds', does: 'Each trip carries ×1.6.', flavor: 'Deeper hulls.', branch: 'Cargo', most: 5, cost: 4000, growth: 30 },
  { id: 'fleet', name: 'Fleet', does: 'Every ship pays ×1.25.', flavor: 'Better ships, better crews.', branch: 'Cargo', most: 10, cost: 1500, growth: 30 },
  { id: 'charts', name: 'Charts', does: 'See further: new islands, new routes.', flavor: 'The sea, written down.', branch: 'Charts', most: 5, cost: 6000, growth: 30 },
  { id: 'passage', name: 'Passage', does: '1: ships bought for you · 2: routes opened · 3: voyages sent.', flavor: 'The harbour runs itself.', branch: 'Harbour', most: 3, cost: 1e5, growth: 300 },
  { id: 'guns', name: 'Guns', does: 'Ships fight pirates off by themselves: sooner, more loot, fewer pirates.', flavor: 'Iron on the decks.', branch: 'Defence', most: 5, cost: 3000, growth: 30 },
  // (Never done, as the Cell's long simmer: a little more, a little dearer, for good.)
  { id: 'winds', name: 'Trade winds', does: 'Everything at sea ×1.03.', flavor: 'The sea learns your routes.', branch: 'Speed', most: Infinity, cost: 1e6, growth: 1.8 },
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
  const g = shipGrowth(world, r);
  let total = 0;
  for (let k = 0; k < n; k++) total += base * g ** (r.ships + k);
  return Math.ceil(total);
}
/** Each ship dearer than the last: 1.15 on the first route, steeper on each opened after (to
 * 1.22), as the Cell's later producers are. */
export function shipGrowth(world: World, r: Route): number {
  const i = Math.max(0, (world.routes ?? []).indexOf(r));
  return Math.min(1.22, 1.15 + 0.01 * i);
}
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
/** ×2 for each of 10, 25, 50 and 100 ships on a route, then every hundred from 200 (the Cell's
 * rule, the same as every stage). */
export function milestone(ships: number): number {
  return milestonesReached(ships);
}
/** Influence a trip brings in. */
export function tripPay(state: GameState, world: World, r: Route): number {
  // (A route to one of your own islands pays double; every island joined adds to all of them.)
  const own = ours(world.isles[r.to]) ? 2 : 1;
  return 3 * far(routeDist(world, r.to)) ** 2 * 1.6 ** level(world, 'holds') * 1.25 ** level(world, 'fleet') * 2 ** milestone(r.ships) * 1.03 ** level(world, 'winds') * foodMult(state) * own * joinedMult(world);
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
  // (A route with pirates on it pays nothing till they're gone.)
  if (i !== undefined && raided(world, i)) return 0;
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

/** The share of what comes in that Passage spends on ships. */
const PASSAGE_SHARE = 0.5;

/** The sea's own time: gusts die down, and Passage buys and opens for you. */
export function sailTick(state: GameState, dt: number): void {
  const world = state.stages.sail.world;
  if (!world) return;
  world.routes ??= [];
  // (A world made before islands had peoples: each gets its own now.)
  if (world.isles.some((i) => i.mine === undefined && i.pop === undefined)) {
    const r = rng(world.seed + 5);
    const DIETS = ['grazer', 'hunter', 'omnivore'];
    for (const i of world.isles) {
      if (i.mine !== undefined || i.pop !== undefined) continue;
      i.pop = Math.round(10 + i.r * i.r * 0.06 * (0.6 + r() * 0.8));
      i.diet = DIETS[Math.floor(r() * 3)];
      i.trust = 0;
    }
    world.diet ??= shoreOf(state)?.look.diet ?? 'omnivore';
  }
  if (!world.isles.some((i) => i.haven)) makeHavens(world.isles, homeOf(world));
  if (world.settling) {
    world.settling.left -= dt;
    if (world.settling.left <= 0) world.settling = null;
  }
  piratesTick(state, world, dt);
  // The voyage out: home when its time's up (the island found, its people met).
  if (world.voyage) {
    world.voyage.left -= dt;
    if (world.voyage.left <= 0) landfall(world);
  }
  // Trade wins trust: every route to a people not yet yours, a little a second.
  for (const r of world.routes) {
    const i = world.isles[r.to];
    if (!ours(i) && !i.haven) addTrust(world, i, tradeTrust(world, r) * dt);
  }
  const g = gusts.get(world);
  if (g) for (const [i, left] of g) left - dt <= 0 ? g.delete(i) : g.set(i, left - dt);
  const passage = world.passOff ? 0 : level(world, 'passage');
  if (passage >= 3 && !world.voyage && voyageTarget(world) && influence(state) >= voyageCost(world)) sendVoyage(state);
  if (passage >= 2) {
    const next = routeOptions(world)[0];
    if (next && influence(state) >= openCost(world, next.id)) openRoute(state, next.id);
  }
  if (passage >= 1) {
    // (Half of what comes in is the harbourmaster's to spend on ships, the cheapest there is;
    // the rest piles up for you, to save for a voyage or a haven.)
    world.passBudget = Math.min((world.passBudget ?? 0) + sailRate(state) * dt * PASSAGE_SHARE, influence(state));
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
      if (best < 0 || bestCost > world.passBudget || !buyShips(state, best, 1)) break;
      world.passBudget -= bestCost;
    }
  }
}

// ---- Voyages, first contact, and winning islands over ----

/** Every island joined: everything at sea +15% (added, not compounded). */
export const JOINED_MORE = 0.15;
export function joinedMult(world: World): number {
  return 1 + JOINED_MORE * joinedCount(world);
}
export function joinedCount(world: World): number {
  return world.isles.filter((i) => i.joined).length;
}
/** Each island won makes the next dearer to win (as each village beaten did, on the shore). */
export const WIN_DEARER = 1.2;
/** And every island's dear from the start (none of them handed over). */
export const WIN_BASE = 4;
function dearer(world: World): number {
  return WIN_DEARER ** joinedCount(world) * WIN_BASE;
}
/** How a people is best met, theirs against yours: kin take gifts gladly (and grazers give
 * them), hunters take islands, omnivores win them by trading. */
export function kin(world: World, i: WorldIsle): boolean {
  return !!i.diet && i.diet === world.diet;
}
/** Islands still to be found, and the nearest of them to any of yours (where a voyage goes). */
export function voyageTarget(world: World): { from: WorldIsle; to: WorldIsle } | null {
  const mine = world.isles.filter(ours);
  let best: { from: WorldIsle; to: WorldIsle; d: number } | null = null;
  for (const i of world.isles) {
    if (i.found) continue;
    for (const m of mine) {
      const d = Math.hypot(i.x - m.x, i.y - m.y);
      if (!best || d < best.d) best = { from: m, to: i, d };
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}
export function voyageCost(world: World): number {
  return Math.ceil(200 * 1.7 ** (world.voyages ?? 0));
}
/** Seconds a voyage takes: further and longer, each one (a minute at first, at most 20). */
export function voyageTime(world: World): number {
  return Math.min(1200, 60 * 1.3 ** (world.voyages ?? 0));
}
export function sendVoyage(state: GameState): boolean {
  const world = state.stages.sail.world;
  if (!world || world.voyage) return false;
  const go = voyageTarget(world);
  if (!go || !spend(state, voyageCost(world))) return false;
  const total = voyageTime(world);
  world.voyage = { from: go.from.id, to: go.to.id, left: total, total };
  world.voyages = (world.voyages ?? 0) + 1;
  return true;
}
/** A voyage home: the island it made for is found, and its people met. */
function landfall(world: World): void {
  const v = world.voyage!;
  world.voyage = null;
  const at = world.isles[v.to];
  if (at.found) return;
  at.found = true;
  if (!ours(at)) (world.met ??= []).push(at.id);
}

/** Influence a gift takes (more the bigger they are, and each more than the last). */
export function giftCost(world: World, i: WorldIsle): number {
  return Math.ceil(40 * (i.pop ?? 20) ** 1.5 * far(routeDist(world, i.id)) ** 2 * 1.4 ** (i.gifts ?? 0) * dearer(world));
}
/** Trust a gift wins: kin twice as much; grazers give twice as well. */
export function giftTrust(world: World, i: WorldIsle): number {
  return 9 * (kin(world, i) ? 2 : 1) * (world.diet === 'grazer' ? 2 : 1);
}
export function giveGift(state: GameState, id: number): boolean {
  const world = state.stages.sail.world;
  const i = world?.isles[id];
  // (No gift that couldn't win them more: at the brink while another's settled, they wait.)
  if (!world || !i || !i.found || ours(i) || i.haven || (settlingLeft(world) > 0 && (i.trust ?? 0) >= 99) || !spend(state, giftCost(world, i))) return false;
  i.gifts = (i.gifts ?? 0) + 1;
  addTrust(world, i, giftTrust(world, i));
  return true;
}
/** What taking an island takes: Influence for the fleet, and ships enough (as many as they are
 * three times over); hunters half the Influence. */
export function conquerCost(world: World, i: WorldIsle): { influence: number; ships: number } {
  return { influence: Math.ceil(300 * (i.pop ?? 20) ** 1.7 * far(routeDist(world, i.id)) ** 2 * (world.diet === 'hunter' ? 0.5 : 1) * dearer(world)), ships: (i.pop ?? 20) * 3 };
}
export function shipsOut(world: World): number {
  return (world.routes ?? []).reduce((n, r) => n + r.ships, 0);
}
export function conquer(state: GameState, id: number): boolean {
  const world = state.stages.sail.world;
  const i = world?.isles[id];
  if (!world || !i || !i.found || ours(i) || settlingLeft(world) > 0) return false;
  const c = conquerCost(world, i);
  if (shipsOut(world) < c.ships || !spend(state, c.influence)) return false;
  join(world, i);
  return true;
}
/** Trust a route to them wins a second (more ships, more; omnivores twice as fast). */
export function tradeTrust(world: World, r: Route): number {
  // (Slower, as gifts and taking get dearer, the more that are yours.)
  return (Math.min(1, 0.0012 * Math.sqrt(r.ships)) * (world.diet === 'omnivore' ? 2 : 1)) / dearer(world);
}
function addTrust(world: World, i: WorldIsle, n: number): void {
  // (While the last is settled, trust can build, but not tip them over.)
  i.trust = Math.min(settlingLeft(world) > 0 ? 99 : 100, (i.trust ?? 0) + n);
  if (i.trust >= 100) join(world, i);
}
/** Seconds an island won takes to settle: no other won till it has (one at a time, each one
 * built up). */
export const SETTLE_SECS = 1800;
export function settlingLeft(world: World): number {
  return Math.max(0, world.settling?.left ?? 0);
}
/** Joined: theirs is yours, and the fog lifts off their own waters. Then it's settled. */
function join(world: World, i: WorldIsle): void {
  i.joined = true;
  i.trust = 100;
  world.settling = { isle: i.id, left: SETTLE_SECS };
  chart(world);
}
/** The world's still to win: every island not yet yours. */
export function toWin(world: World): number {
  return world.isles.filter((i) => !ours(i)).length;
}

// ---- Pirates ----

/** The three islands furthest from home are pirates' havens (taken last). */
function makeHavens(isles: WorldIsle[], home: Pt): void {
  isles
    .filter((i) => i.mine === undefined && !i.joined)
    .sort((a, b) => Math.hypot(b.x - home.x, b.y - home.y) - Math.hypot(a.x - home.x, a.y - home.y))
    .slice(0, 3)
    .forEach((i, k) => {
      i.haven = true;
      i.diet = 'pirates';
      // (A pirates' band, not a people: fewer of them, the furthest the most.)
      i.pop = 40 + k * 15;
    });
}
export function havensLeft(world: World): number {
  return world.isles.filter((i) => i.haven && !i.joined).length;
}
/** Whether a route has pirates on it now. */
export function raided(world: World, route: number): boolean {
  return !!world.pirates?.some((p) => p.route === route);
}
/** Hits it takes to drive pirates off (taps, or the guns). */
export const PIRATE_HP = 4;
/** Seconds pirates stay on a route before sailing off with what they took. */
const PIRATE_STAY = 90;
/** Seconds between the ships they take. */
const PIRATE_TAKES = 15;
/** Pirates a second, on a network this big: more routes, more to raid; fewer for every haven
 * taken, and for Guns. None for the first quarter-hour at sea. */
export function pirateChance(world: World): number {
  const routes = world.routes?.length ?? 0;
  if (routes < 2 || (world.age ?? 0) < 900) return 0;
  return 0.0025 * Math.sqrt(routes) * (havensLeft(world) / 3) * (1 - 0.12 * level(world, 'guns'));
}
/** Seconds the ships take to drive pirates off by themselves (with Guns: sooner each level). */
export function gunsTime(world: World): number {
  const g = level(world, 'guns');
  return g ? 16 / (1 + g) : Infinity;
}
let pirateRng = Math.random;
/** (Tests and the simulator roll their own dice.) */
export function setPirateDice(f: () => number): void {
  pirateRng = f;
}
function piratesTick(state: GameState, world: World, dt: number): void {
  world.age = (world.age ?? 0) + dt;
  world.pirates ??= [];
  // A new raid, now and then, on a route that hasn't one.
  if (world.pirates.length < 3 && pirateRng() < pirateChance(world) * dt) {
    const free = (world.routes ?? []).map((_, i) => i).filter((i) => !raided(world, i));
    if (free.length) world.pirates.push({ route: free[Math.floor(pirateRng() * free.length)], at: 0.3 + pirateRng() * 0.4, hp: PIRATE_HP, left: PIRATE_STAY, next: PIRATE_TAKES });
  }
  const gt = gunsTime(world);
  for (const p of [...world.pirates]) {
    p.left -= dt;
    p.next -= dt;
    const r = world.routes?.[p.route];
    // They take a ship now and then (never the last one).
    if (p.next <= 0) {
      p.next += PIRATE_TAKES;
      if (r && r.ships > 1) {
        r.ships--;
        world.lost = (world.lost ?? 0) + 1;
      }
    }
    // The guns wear them down, a hit every so often.
    if (gt < Infinity) {
      const hits = Math.floor(((PIRATE_STAY - p.left) / gt) | 0) - (PIRATE_HP - p.hp);
      if (hits > 0) p.hp -= hits;
    }
    if (p.hp <= 0) drivenOff(state, world, p);
    else if (p.left <= 0) world.pirates.splice(world.pirates.indexOf(p), 1);
  }
}
/** Loot for pirates driven off: a while of what their route brings in (more with Guns). */
export function lootFor(state: GameState, world: World, p: Pirate): number {
  const r = world.routes?.[p.route];
  if (!r) return 0;
  return ((r.ships * tripPay(state, world, r)) / tripTime(world, r)) * 30 * (1 + 0.5 * level(world, 'guns'));
}
function drivenOff(state: GameState, world: World, p: Pirate): number {
  const loot = lootFor(state, world, p);
  world.pirates = (world.pirates ?? []).filter((x) => x !== p);
  world.driven = (world.driven ?? 0) + 1;
  const st = state.stages.sail;
  st.currency = st.currency.add(loot);
  st.totalEarned = st.totalEarned.add(loot);
  return loot;
}
/** A tap on pirates: a hit; the last hit drives them off (and the loot's yours). Returns the
 * loot when driven off, 0 for a hit, -1 if there were none there. */
export function fightPirate(state: GameState, k: number): number {
  const world = state.stages.sail.world;
  const p = world?.pirates?.[k];
  if (!world || !p) return -1;
  p.hp--;
  return p.hp <= 0 ? drivenOff(state, world, p) : 0;
}
