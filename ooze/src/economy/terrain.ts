// New Shore's island, second generation: land shaped the way land is. A ragged coast with
// capes and bays; mountain ranges running across it, jagged at their peaks; plateaus standing
// up out of the lowland with cliffs round them; rolling hills in some country and broad flat
// plains in other; then rain, worn into it (valleys cut by thousands of drops), filling the
// hollows into lakes and running off in rivers to the sea. The wind brings the rain from the
// west, so beyond the ranges the land is dry: scrub, then desert. Snow on the high peaks only.
//
// Pure and seeded (the same island for the same seed, everywhere): run once, in a worker while
// the crossing plays, and kept on the device after (see terrainStore.ts). Plain arrays in and
// out, nothing else, so it runs in a worker or in Node.

import { Biome } from './island';

/** Bump when the generator changes (stored islands from an older one are made again). */
export const TERRAIN_V = 2;

export interface Terrain {
  height: Float32Array;
  biome: Uint8Array;
  home: { x: number; y: number };
}

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
function fbm(x: number, y: number, seed: number, scale: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1 / scale;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += noise(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/** Ridged noise: sharp crests where plain noise crosses the middle (mountain spines). */
function ridged(x: number, y: number, seed: number, scale: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1 / scale;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let r = 1 - Math.abs(noise(x * f, y * f, seed + o * 131) * 2 - 1);
    r *= r * weight;
    weight = Math.min(1, r * 2);
    v += r * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return v / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A min-heap of cells by height (for flooding the land from the sea up). */
class Heap {
  private keys: Float32Array;
  private ids: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float32Array(cap);
    this.ids = new Int32Array(cap);
  }
  push(id: number, key: number): void {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= key) break;
      this.keys[i] = this.keys[p];
      this.ids[i] = this.ids[p];
      i = p;
    }
    this.keys[i] = key;
    this.ids[i] = id;
  }
  pop(): number {
    const top = this.ids[0];
    const key = this.keys[--this.size];
    const id = this.ids[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.ids[i] = this.ids[c];
      i = c;
    }
    this.keys[i] = key;
    this.ids[i] = id;
    return top;
  }
}

export function generateTerrain(seed: number, N: number): Terrain {
  const rand = rng(seed * 7 + 13);
  const H = new Float32Array(N * N);
  const S = seed % 9973;

  // ---- The shape: an island stretched and turned its own way, its coast worn ragged ----
  const turn = rand() * Math.PI;
  const stretch = 0.8 + rand() * 0.35;
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const land = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const nx = (x / N - 0.5) * 2;
      const ny = (y / N - 0.5) * 2;
      const rx = (nx * ct - ny * st) / stretch;
      const ry = (nx * st + ny * ct) * stretch;
      // Big capes and bays, then smaller coves and headlands.
      const warp = (fbm(x, y, S + 7, 300, 3) - 0.5) * 0.8 + (fbm(x, y, S + 9, 90, 3) - 0.5) * 0.3 + (fbm(x, y, S + 11, 28, 3) - 0.5) * 0.08;
      const d = Math.sqrt(rx * rx + ry * ry) + warp;
      land[y * N + x] = 1 - smooth(0.58, 0.92, d);
    }
  }

  // ---- Mountain ranges: spines that wander across the island ----
  const rangeD = new Float32Array(N * N).fill(1e9);
  const ranges = 2 + Math.floor(rand() * 2);
  const spines: { x: number; y: number }[][] = [];
  for (let r = 0; r < ranges; r++) {
    const a0 = rand() * Math.PI * 2;
    let x = N / 2 + Math.cos(a0) * N * (0.05 + rand() * 0.22);
    let y = N / 2 + Math.sin(a0) * N * (0.05 + rand() * 0.22);
    let dir = rand() * Math.PI * 2;
    const len = N * (0.22 + rand() * 0.22);
    const pts: { x: number; y: number }[] = [];
    for (let s = 0; s < len; s += 4) {
      pts.push({ x, y });
      dir += (rand() - 0.5) * 0.18;
      x += Math.cos(dir) * 4;
      y += Math.sin(dir) * 4;
    }
    spines.push(pts);
    const R = 70;
    for (const p of pts) {
      const x0 = Math.max(0, Math.floor(p.x - R));
      const x1 = Math.min(N - 1, Math.ceil(p.x + R));
      const y0 = Math.max(0, Math.floor(p.y - R));
      const y1 = Math.min(N - 1, Math.ceil(p.y + R));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const d = Math.hypot(xx - p.x, yy - p.y);
          const i = yy * N + xx;
          if (d < rangeD[i]) rangeD[i] = d;
        }
      }
    }
  }

  // ---- Plateaus: tablelands with cliffs round them ----
  const plateaus: { x: number; y: number; r: number; level: number }[] = [];
  const nPlat = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < nPlat; k++) {
    const a = rand() * Math.PI * 2;
    const r0 = N * (0.12 + rand() * 0.2);
    plateaus.push({ x: N / 2 + Math.cos(a) * r0, y: N / 2 + Math.sin(a) * r0, r: 45 + rand() * 55, level: 0.3 + rand() * 0.14 });
  }

  // ---- The height: broad swells, hills here, plains there, the ranges and plateaus ----
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const L = land[i];
      const swell = (fbm(x, y, S + 21, 170, 4) - 0.5) * 0.22;
      const hillMask = smooth(0.42, 0.66, fbm(x, y, S + 31, 240, 3));
      const hills = (fbm(x, y, S + 41, 38, 4) - 0.5) * 0.32 * hillMask;
      const plainMask = smooth(0.52, 0.68, fbm(x, y, S + 51, 230, 3)) * (1 - hillMask);
      let h = 0.16 + swell + hills;
      // Plains: low and level, the swells smoothed away.
      h = h + (0.09 + swell * 0.25 - h) * plainMask * 0.85;
      // The ranges: a broad rise along each spine, with ridged peaks on it.
      const rd = rangeD[i];
      if (rd < 70) {
        const w = 30 + fbm(x, y, S + 61, 90, 2) * 25;
        const m = Math.exp(-((rd / w) ** 2));
        const rg = ridged(x + (fbm(x, y, S + 71, 60, 2) - 0.5) * 40, y, S + 81, 46, 5);
        h += m * (0.22 + rg * 0.78) * 0.95;
      }
      // Plateaus: flat on top (a little rolling), cliffs at the rim.
      for (const p of plateaus) {
        const pr = p.r * (0.82 + fbm(x, y, S + 91, 30, 3) * 0.36);
        const d = Math.hypot(x - p.x, y - p.y);
        const k = 1 - smooth(pr - 5, pr + 2, d);
        if (k > 0) h = h + (Math.max(h, p.level + (fbm(x, y, S + 97, 25, 2) - 0.5) * 0.04) - h) * k;
      }
      // Into the sea toward the coast (and off the shelf).
      H[i] = h * (0.25 + 0.75 * L) - (1 - L) * 0.42 + (L - 0.5) * 0.08;
    }
  }

  // ---- Rain: thousands of drops running downhill, cutting valleys and leaving silt ----
  erode(H, N, rand, 90000);

  // ---- Water: flood the land from the sea up. Hollows fill into lakes; every cell learns
  // which way its water goes, and rivers form where enough of it gathers. ----
  const filled = new Float32Array(H);
  const down = new Int32Array(N * N).fill(-1);
  const order = new Int32Array(N * N);
  let nOrder = 0;
  const done = new Uint8Array(N * N);
  const heap = new Heap(N * N);
  for (let i = 0; i < N * N; i++) {
    const x = i % N;
    const y = (i / N) | 0;
    // The sea, and the map's edge, are where all water ends.
    if (H[i] <= 0 || x === 0 || y === 0 || x === N - 1 || y === N - 1) {
      done[i] = 1;
      if (H[i] <= 0) {
        filled[i] = H[i];
        order[nOrder++] = i;
        // (Only sea cells that touch land need flooding from.)
        if ((x > 0 && H[i - 1] > 0) || (x < N - 1 && H[i + 1] > 0) || (y > 0 && H[i - N] > 0) || (y < N - 1 && H[i + N] > 0)) heap.push(i, 0);
      }
    }
  }
  const NB = [-1, 1, -N, N, -N - 1, -N + 1, N - 1, N + 1];
  while (heap.size) {
    const c = heap.pop();
    const cx = c % N;
    for (let k = 0; k < 8; k++) {
      const j = c + NB[k];
      if (j < 0 || j >= N * N || done[j]) continue;
      const jx = j % N;
      if (Math.abs(jx - cx) > 1) continue;
      done[j] = 1;
      // A cell lower than where its water would leave fills up to it (a little above, so
      // water always runs on).
      filled[j] = Math.max(H[j], Math.max(0, filled[c]) + 1e-5);
      down[j] = c;
      order[nOrder++] = j;
      heap.push(j, filled[j]);
    }
  }
  // Lakes: hollows filled deeper than a puddle, and big enough to be a lake. Small ones just
  // fill in (the land's level there).
  const lake = new Uint8Array(N * N);
  const lakeSeen = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    if (lakeSeen[i] || filled[i] - H[i] < 0.004 || H[i] <= 0) continue;
    // The whole hollow.
    const stack = [i];
    const cells: number[] = [];
    lakeSeen[i] = 1;
    let deepest = 0;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      deepest = Math.max(deepest, filled[c] - H[c]);
      const cx = c % N;
      for (let k = 0; k < 4; k++) {
        const j = c + NB[k];
        if (j < 0 || j >= N * N || lakeSeen[j] || Math.abs((j % N) - cx) > 1) continue;
        if (filled[j] - H[j] < 0.004 || H[j] <= 0) continue;
        lakeSeen[j] = 1;
        stack.push(j);
      }
    }
    const isLake = cells.length > 700 && deepest > 0.04;
    for (const c of cells) {
      if (isLake) lake[c] = 1;
      H[c] = filled[c];
    }
  }
  // How much water passes through each cell (rain falls heavier on the windward heights).
  const flow = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) flow[i] = H[i] > 0 ? 1 + Math.max(0, H[i]) * 1.5 : 0;
  for (let k = nOrder - 1; k >= 0; k--) {
    const c = order[k];
    if (down[c] >= 0) flow[down[c]] += flow[c];
  }
  const river = new Uint8Array(N * N);
  const RIVER = 1800;
  for (let i = 0; i < N * N; i++) {
    if (flow[i] < RIVER || H[i] <= 0 || lake[i]) continue;
    // Wider the more water it carries.
    const w = flow[i] > RIVER * 12 ? 1 : 0;
    const x = i % N;
    const y = (i / N) | 0;
    for (let dy = -w; dy <= w; dy++) {
      for (let dx = -w; dx <= w; dx++) {
        const j = (y + dy) * N + x + dx;
        if (x + dx < 0 || x + dx >= N || y + dy < 0 || y + dy >= N || H[j] <= 0 || lake[j]) continue;
        river[j] = 1;
      }
    }
  }
  // Rivers cut a little into their beds.
  for (let i = 0; i < N * N; i++) if (river[i]) H[i] = Math.max(0.004, H[i] - 0.008);

  // ---- Climate: wet near water and on the windward side; dry in the ranges' rain shadow ----
  const wetness = new Float32Array(N * N);
  // Nearness to fresh water and the sea (two passes of a distance sweep).
  const dist = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) dist[i] = H[i] <= 0 || lake[i] || river[i] ? 0 : 1e9;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - N] + 1);
    }
  }
  for (let y = N - 1; y >= 0; y--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = y * N + x;
      if (x < N - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y < N - 1) dist[i] = Math.min(dist[i], dist[i + N] + 1);
    }
  }
  // The rain shadow: the wind comes from the west, dropping its rain on the heights it
  // crosses; land in their lee gets little.
  const windAng = Math.PI + (rand() - 0.5) * 0.8;
  const wx = Math.cos(windAng);
  const wy = Math.sin(windAng);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (H[i] <= 0) continue;
      // Look upwind: how much higher ground stands between here and the sea.
      let shadow = 0;
      for (let s = 8; s <= 160; s += 8) {
        const sx = Math.round(x + wx * s);
        const sy = Math.round(y + wy * s);
        if (sx < 0 || sy < 0 || sx >= N || sy >= N) break;
        const hh = H[sy * N + sx];
        shadow = Math.max(shadow, (hh - H[i]) * (1 - s / 200));
      }
      const near = Math.exp(-dist[i] / 45);
      // (And a dry country somewhere, wherever the wind's left it: a broad tilt toward drought.)
      const arid = smooth(0.5, 0.75, fbm(x, y, S + 131, 380, 2)) * 0.28;
      wetness[i] = 0.55 * fbm(x, y, S + 111, 150, 3) + 0.35 * near + 0.14 - arid - Math.min(0.7, shadow * 1.6);
    }
  }

  // ---- Ground: what grows (or doesn't) where ----
  const biome = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = H[i];
      if (h <= 0) {
        biome[i] = h < -0.1 ? Biome.Deep : Biome.Sea;
        continue;
      }
      if (lake[i]) {
        biome[i] = Biome.Lake;
        continue;
      }
      if (river[i]) {
        biome[i] = Biome.River;
        continue;
      }
      const sl = Math.max(Math.abs(H[Math.min(i + 1, N * N - 1)] - h), Math.abs(H[Math.max(i - 1, 0)] - h), Math.abs(H[Math.min(i + N, N * N - 1)] - h), Math.abs(H[Math.max(i - N, 0)] - h));
      const wet = wetness[i];
      const cold = h + (1 - y / N) * 0.06;
      let b: number;
      if (h < 0.022 && dist[i] < 6) b = wet < 0.25 ? Biome.Desert : Biome.Sand;
      else if (cold > 0.8) b = Biome.Peak;
      else if (h > 0.62 || (sl > 0.03 && h > 0.18)) b = Biome.Rock;
      else if (h > 0.48) b = wet < 0.3 ? Biome.Rock : Biome.High;
      else if (wet < 0.2) b = Biome.Desert;
      else if (wet < 0.3) b = Biome.Scrub;
      else if (wet > 0.62 && h < 0.12 && dist[i] < 20) b = Biome.Marsh;
      else if (wet > 0.5 + (fbm(x, y, S + 121, 40, 2) - 0.5) * 0.2) b = Biome.Forest;
      else b = Biome.Grass;
      biome[i] = b;
    }
  }

  // ---- Where the raft comes in: a beach with green land behind it ----
  let home = { x: N / 2, y: N / 2 };
  const ha = rand() * Math.PI * 2;
  const at = (x: number, y: number) => biome[Math.round(y) * N + Math.round(x)];
  for (let k = 0; k < 60; k++) {
    const a = ha + k * 0.21;
    let beach: { x: number; y: number } | null = null;
    for (let r = N / 2 - 2; r > 4; r -= 1) {
      const x = N / 2 + Math.cos(a) * r;
      const y = N / 2 + Math.sin(a) * r;
      if (at(x, y) >= Biome.Sand && at(x, y) !== Biome.Lake) {
        beach = { x, y };
        break;
      }
    }
    if (!beach || at(beach.x, beach.y) !== Biome.Sand) continue;
    const p = { x: Math.round(beach.x - Math.cos(a) * 2), y: Math.round(beach.y - Math.sin(a) * 2) };
    const inland = at(beach.x - Math.cos(a) * 10, beach.y - Math.sin(a) * 10);
    if (at(p.x, p.y) === Biome.Sand && (inland === Biome.Grass || inland === Biome.Forest)) {
      home = p;
      break;
    }
  }
  void spines;
  return { height: H, biome, home };
}

/** Rain wearing the land: each drop runs downhill picking up soil where it speeds up and
 * dropping it where it slows, so valleys deepen and the lowland silts up. */
function erode(H: Float32Array, N: number, rand: () => number, drops: number): void {
  const INERTIA = 0.08;
  const CAPACITY = 6;
  const MIN_SLOPE = 0.002;
  const ERODE = 0.25;
  const DEPOSIT = 0.2;
  const EVAPORATE = 0.03;
  const GRAVITY = 6;
  const LIFE = 40;
  const at = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const i = iy * N + ix;
    const a = H[i];
    const b = H[i + 1];
    const c = H[i + N];
    const d = H[i + N + 1];
    return { h: a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy, gx: (b - a) * (1 - fy) + (d - c) * fy, gy: (c - a) * (1 - fx) + (d - b) * fx };
  };
  const put = (x: number, y: number, amt: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const i = iy * N + ix;
    H[i] += amt * (1 - fx) * (1 - fy);
    H[i + 1] += amt * fx * (1 - fy);
    H[i + N] += amt * (1 - fx) * fy;
    H[i + N + 1] += amt * fx * fy;
  };
  for (let n = 0; n < drops; n++) {
    let x = 2 + rand() * (N - 4);
    let y = 2 + rand() * (N - 4);
    if (H[Math.floor(y) * N + Math.floor(x)] < 0.05) continue;
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let soil = 0;
    for (let life = 0; life < LIFE; life++) {
      const here = at(x, y);
      dx = dx * INERTIA - here.gx * (1 - INERTIA);
      dy = dy * INERTIA - here.gy * (1 - INERTIA);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      const ox = x;
      const oy = y;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= N - 2 || y >= N - 2) break;
      const nh = at(x, y).h;
      if (nh < 0) {
        // Into the sea: what it carries is dropped at the shore.
        put(ox, oy, soil * 0.5);
        break;
      }
      const dh = nh - here.h;
      const cap = Math.max(-dh, MIN_SLOPE) * speed * water * CAPACITY;
      if (soil > cap || dh > 0) {
        const drop = dh > 0 ? Math.min(dh, soil) : (soil - cap) * DEPOSIT;
        soil -= drop;
        put(ox, oy, drop);
      } else {
        const take = Math.min((cap - soil) * ERODE, -dh);
        soil += take;
        put(ox, oy, -take);
      }
      speed = Math.sqrt(Math.max(0, speed * speed + -dh * GRAVITY));
      water *= 1 - EVAPORATE;
    }
  }
}
