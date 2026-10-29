// The Creature stage's world: an island rolled from a seed, so every game has its own.
// Pure data (no drawing), shared by the rules (where places are, what's land) and the
// scene (what to paint). One tile is one step of the creature's walk.
//
// The Field Guide places are put where they belong (tide pools on the shore, caves in
// the mountains) but always within a set distance band from home, so whatever the
// seed, the Cliffs are about as far away and the pacing holds.

import type { PlaceDef } from './types';

/** Tiles across (and down) the whole map, sea included. */
export const ISLAND = 360;
/** Fog is kept per cell of this many tiles across. */
export const CELL = 3;
export const CELLS = ISLAND / CELL;

export const Biome = { Deep: 0, Sea: 1, Sand: 2, Grass: 3, Forest: 4, Marsh: 5, High: 6, Rock: 7, Peak: 8 } as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export interface Pt {
  x: number;
  y: number;
}

export interface Island {
  seed: number;
  biome: Uint8Array;
  /** Height above the sea, roughly 0 to 1 on land (below 0 is water). */
  height: Float32Array;
  home: Pt;
  places: Record<string, Pt>;
}

/** Where each kind of place likes to be, and how far from home (in tiles). */
export const PLACE_SPOTS: Record<string, { where: 'coast' | 'pools' | 'marsh' | 'forest' | 'cliff' | 'cave' | 'high'; dist: number }> = {
  shore: { where: 'coast', dist: 0 },
  tidePools: { where: 'pools', dist: 50 },
  marsh: { where: 'marsh', dist: 65 },
  forest: { where: 'forest', dist: 85 },
  cliffs: { where: 'cliff', dist: 105 },
  caves: { where: 'cave', dist: 135 },
  highlands: { where: 'high', dist: 165 },
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
}

/** Layered noise in about [0, 1). */
function fbm(x: number, y: number, seed: number, scale: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let f = 1 / scale;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += noise(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

const cache = new Map<number, Island>();

/** The island for a seed (built once, then kept). */
export function islandOf(seed: number, places: PlaceDef[] = []): Island {
  const hit = cache.get(seed);
  if (hit) return hit;
  const N = ISLAND;
  const rand = rng(seed);
  const height = new Float32Array(N * N);
  const biome = new Uint8Array(N * N);
  // A mountain range somewhere off-centre gives the island a spine.
  const ma = rand() * Math.PI * 2;
  const mx = N / 2 + Math.cos(ma) * N * 0.12;
  const my = N / 2 + Math.sin(ma) * N * 0.12;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // Distance from the middle, with a wobbly coastline.
      const dx = (x - N / 2) / (N * 0.44);
      const dy = (y - N / 2) / (N * 0.44);
      const warp = (fbm(x, y, seed + 7, 60, 3) - 0.5) * 0.55;
      const d = Math.sqrt(dx * dx + dy * dy) + warp;
      const ridge = Math.max(0, 1 - Math.hypot(x - mx, y - my) / (N * 0.2));
      const h = fbm(x, y, seed, 45) * 0.7 + 0.42 - d * d * 1.05 + ridge * ridge * 0.45;
      height[y * N + x] = h;
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = height[i];
      const wet = fbm(x, y, seed + 31, 35, 3);
      let b: number;
      if (h < -0.12) b = Biome.Deep;
      else if (h < 0) b = Biome.Sea;
      else if (h < 0.035) b = Biome.Sand;
      else if (h > 0.72) b = Biome.Peak;
      else if (h > 0.58) b = Biome.Rock;
      else if (h > 0.46) b = Biome.High;
      else if (wet > 0.6 && h < 0.22) b = Biome.Marsh;
      else if (wet > 0.5) b = Biome.Forest;
      else b = Biome.Grass;
      biome[i] = b;
    }
  }
  const at = (x: number, y: number): number => biome[Math.round(y) * N + Math.round(x)];
  const land = (b: number) => b >= Biome.Sand;

  // Home: the Shoreline, where it first crawled out of the sea, with grass just inland.
  let home: Pt = { x: N / 2, y: N / 2 };
  const ha = rand() * Math.PI * 2;
  for (let k = 0; k < 24; k++) {
    const a = ha + k * 0.26;
    let beach: Pt | null = null;
    for (let r = N / 2 - 2; r > 4; r -= 1) {
      const x = N / 2 + Math.cos(a) * r;
      const y = N / 2 + Math.sin(a) * r;
      if (land(at(x, y))) {
        beach = { x, y };
        break;
      }
    }
    if (!beach) continue;
    const p = { x: Math.round(beach.x - Math.cos(a) * 2), y: Math.round(beach.y - Math.sin(a) * 2) };
    const inland = { x: beach.x - Math.cos(a) * 9, y: beach.y - Math.sin(a) * 9 };
    if (land(at(p.x, p.y)) && at(inland.x, inland.y) === Biome.Grass) {
      home = p;
      break;
    }
  }

  // The places, each in its band and its kind of ground.
  const near = (x: number, y: number, r: number, test: (b: number) => boolean) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (test(at(Math.max(0, Math.min(N - 1, x + i)), Math.max(0, Math.min(N - 1, y + j))))) return true;
    return false;
  };
  const fits: Record<string, (x: number, y: number) => boolean> = {
    coast: (x, y) => at(x, y) === Biome.Sand && near(x, y, 1, (b) => b <= Biome.Sea),
    pools: (x, y) => at(x, y) === Biome.Sand && near(x, y, 2, (b) => b <= Biome.Sea) && near(x, y, 6, (b) => b >= Biome.High),
    marsh: (x, y) => at(x, y) === Biome.Marsh && near(x, y, 2, (b) => b === Biome.Marsh),
    forest: (x, y) => at(x, y) === Biome.Forest && !near(x, y, 3, (b) => b !== Biome.Forest),
    cliff: (x, y) => at(x, y) === Biome.Rock && near(x, y, 2, (b) => b === Biome.Grass || b === Biome.Forest || b === Biome.High),
    cave: (x, y) => at(x, y) === Biome.Rock && near(x, y, 3, (b) => b === Biome.Peak),
    high: (x, y) => at(x, y) === Biome.High && !near(x, y, 3, (b) => b < Biome.High),
  };
  const placesOut: Record<string, Pt> = {};
  const taken: Pt[] = [home];
  for (const p of places) {
    const spot = PLACE_SPOTS[p.id];
    if (!spot) continue;
    if (spot.dist === 0) {
      // The place you start at.
      placesOut[p.id] = { ...home };
      continue;
    }
    let best: Pt | null = null;
    let bestScore = Infinity;
    for (let tries = 0; tries < 4 && !best; tries++) {
      const slack = spot.dist * (0.15 + tries * 0.15);
      for (let y = 2; y < N - 2; y += 2) {
        for (let x = 2; x < N - 2; x += 2) {
          const d = Math.hypot(x - home.x, y - home.y);
          if (Math.abs(d - spot.dist) > slack) continue;
          if (tries < 3 ? !fits[spot.where](x, y) : !land(at(x, y))) continue;
          if (taken.some((q) => Math.hypot(q.x - x, q.y - y) < 18)) continue;
          // Seeded jitter picks among the good spots.
          const score = Math.abs(d - spot.dist) + hash2(x, y, seed + 977) * slack;
          if (score < bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
    }
    best ??= { x: Math.round(home.x + spot.dist * 0.7), y: home.y };
    placesOut[p.id] = best;
    taken.push(best);
    // A place that had to settle for plain ground gets its ground made right around it.
    if (!fits[spot.where](best.x, best.y)) stamp(biome, best, spot.where);
  }
  const island: Island = { seed, biome, height, home, places: placesOut };
  cache.set(seed, island);
  // Only the last few are kept (the game uses one; tests and the simulator roll many).
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return island;
}

function stamp(biome: Uint8Array, p: Pt, where: string): void {
  const b: number = where === 'marsh' ? Biome.Marsh : where === 'forest' ? Biome.Forest : where === 'high' ? Biome.High : where === 'coast' || where === 'pools' ? Biome.Sand : Biome.Rock;
  for (let j = -7; j <= 7; j++) {
    for (let i = -7; i <= 7; i++) {
      if (i * i + j * j > 49) continue;
      const x = p.x + i;
      const y = p.y + j;
      if (x < 0 || y < 0 || x >= ISLAND || y >= ISLAND) continue;
      const k = y * ISLAND + x;
      if (biome[k] >= Biome.Sand) biome[k] = b;
    }
  }
  if (where === 'cave') biome[p.y * ISLAND + p.x] = Biome.Peak;
}

export function isLand(island: Island, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= ISLAND || yi >= ISLAND) return false;
  return island.biome[yi * ISLAND + xi] >= Biome.Sand;
}

// ---- Fog: which cells have been seen ----

export function cellOf(x: number, y: number): number {
  const cx = Math.max(0, Math.min(CELLS - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(CELLS - 1, Math.floor(y / CELL)));
  return cy * CELLS + cx;
}

/** Marks every cell within `r` tiles of a point seen. Returns how many were new (land only). */
export function reveal(island: Island, seen: Uint8Array, x: number, y: number, r: number): number {
  let fresh = 0;
  const c0x = Math.floor((x - r) / CELL);
  const c1x = Math.floor((x + r) / CELL);
  const c0y = Math.floor((y - r) / CELL);
  const c1y = Math.floor((y + r) / CELL);
  for (let cy = Math.max(0, c0y); cy <= Math.min(CELLS - 1, c1y); cy++) {
    for (let cx = Math.max(0, c0x); cx <= Math.min(CELLS - 1, c1x); cx++) {
      const i = cy * CELLS + cx;
      if (seen[i]) continue;
      const mx = cx * CELL + CELL / 2;
      const my = cy * CELL + CELL / 2;
      if ((mx - x) ** 2 + (my - y) ** 2 > r * r) continue;
      seen[i] = 1;
      if (isLand(island, mx, my)) fresh++;
    }
  }
  return fresh;
}

/** Share of the island's land that has been seen, 0 to 1. */
export function seenShare(island: Island, seen: Uint8Array): number {
  let landCells = 0;
  let seenLand = 0;
  for (let i = 0; i < CELLS * CELLS; i++) {
    const x = (i % CELLS) * CELL + CELL / 2;
    const y = Math.floor(i / CELLS) * CELL + CELL / 2;
    if (!isLand(island, x, y)) continue;
    landCells++;
    if (seen[i]) seenLand++;
  }
  return landCells ? seenLand / landCells : 0;
}

/** The seen-cells map as text for the save (a bitset in base64), and back. */
export function packSeen(seen: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(seen.length / 8));
  for (let i = 0; i < seen.length; i++) if (seen[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackSeen(text: string | undefined): Uint8Array {
  const seen = new Uint8Array(CELLS * CELLS);
  if (!text) return seen;
  try {
    const s = atob(text);
    for (let i = 0; i < seen.length; i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) seen[i] = 1;
  } catch {
    /* a damaged map just starts unexplored */
  }
  return seen;
}
