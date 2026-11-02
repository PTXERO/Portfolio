// The Age of Sail: the world, as a map. The islands they hopped are the first shapes on it (each
// its own coast, from its own land), the last of them (the Republic) home, in the middle; the
// rest of the world is islands still in the fog. (Ships, routes and Influence come next.)

import type { GameState } from './types';
import type { Pt } from './island';
import { MASK, coastOfIsland, packCoast } from './coast';
import { shoreIsland, shoreOf, terrainReady, type PastIsland, type ShoreState } from './shore';

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
}

/** How far from your islands the fog's lifted (map units). */
export const SIGHT = 70;

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
  // The rest of the world: islands scattered over the sea, none too close to another.
  for (let tries = 0; tries < 4000 && isles.length < 60; tries++) {
    const x = 40 + r() * (W - 80);
    const y = 40 + r() * (H - 80);
    const size = 22 + r() * r() * 70;
    if (isles.some((o) => Math.hypot(o.x - x, o.y - y) < (o.r + size) * 0.75 + 14)) continue;
    isles.push({ id: isles.length, x, y, r: size, mask: blobCoast(seed + tries * 131), found: false });
  }
  const world: World = { seed, w: W, h: H, isles };
  chart(world);
  return world;
}

/** The fog lifted round your islands: what's within sight of one is found. */
export function chart(world: World): void {
  const mine = world.isles.filter((i) => i.mine !== undefined);
  for (const i of world.isles) if (!i.found && mine.some((m) => Math.hypot(m.x - i.x, m.y - i.y) < SIGHT + m.r * 0.5 + i.r * 0.5)) i.found = true;
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
