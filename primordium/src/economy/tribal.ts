// The Extinction (the first part of the Tribal era): its economy. A quarter of the herd lives through the strike (about the share
// of species that lived through the impact that ended the dinosaurs). They keep the Creature's
// look and stats; the eras before are sealed (the world they were part of is gone) and leave
// a lasting heritage instead.

import { STAGE_ORDER } from '../content/stages';
import { islandFor, statsOf } from './creature';
import { D, Decimal } from './num';
import { Biome, ISLAND, type Island, type Pt } from './island';
import type { GameState, StageId, TribeState } from './types';

const TRIBAL: StageId = 'tribal';
/** Share of the herd that lives through the strike. */
export const SURVIVE = 0.25;
/** Never fewer than this many (a tribe needs a few), and never more than the Extinction is
 * made for (it's balanced, and drawn, for about a hundred: a great herd doesn't make it easier). */
const MIN_SURVIVORS = 6;
export const MAX_SURVIVORS = 100;
/** Food a person gathers a second, by hand: before waking (huddled, scared) and after. */
const FORAGE_ASLEEP = 0.15;
const FORAGE_AWAKE = 0.6;

/** Once the Tribal era has begun, every era before it is sealed: no going back, nothing runs.
 * (And once they're ashore on the new island, the Extinction is behind them too.) */
export function sealed(state: GameState, id: StageId): boolean {
  if (state.unlocked.includes('shore')) return id !== 'shore';
  return id !== TRIBAL && id !== 'shore' && state.unlocked.includes(TRIBAL);
}

/** What the eras before leave: each tenfold of what they made adds a little, for good. */
export function heritageOf(state: GameState): number {
  let sum = 0;
  for (const id of STAGE_ORDER) {
    if (id === TRIBAL || id === 'shore') continue;
    const t = state.stages[id].totalEarned;
    if (t.gt(1)) sum += t.log10();
  }
  return 1 + 0.05 * sum;
}

/** The tribe as the strike leaves it, from the herd that was. */
export function startTribe(state: GameState): TribeState {
  const c = state.stages.creature;
  const survivors = Math.min(MAX_SURVIVORS, Math.max(MIN_SURVIVORS, Math.round(c.pop * SURVIVE)));
  return {
    awake: false,
    pop: survivors,
    survivors,
    look: { genes: c.genes, parts: { ...c.equipped }, diet: state.stages.cell.upgrades.includes('hunter') ? 'hunter' : state.stages.cell.upgrades.includes('grazer') ? 'grazer' : 'omnivore' },
    stats: statsOf(state),
    generations: c.generation,
    heritage: heritageOf(state),
    seed: islandFor(state).seed,
    year: 0,
  };
}

export function tribeOf(state: GameState): TribeState | undefined {
  return state.stages.tribal.tribe;
}

/** Food a second. */
export function tribalRate(state: GameState): Decimal {
  const t = tribeOf(state);
  if (!t || t.ex) return D(0);
  return D(t.pop * (t.awake ? FORAGE_AWAKE : FORAGE_ASLEEP) * t.heritage);
}

/** One of them touches the spear, and they wake. */
export function awaken(state: GameState): boolean {
  const t = tribeOf(state);
  if (!t || t.awake) return false;
  t.awake = true;
  return true;
}

export function tribeTick(state: GameState, dt: number): void {
  const t = tribeOf(state);
  if (!t) return;
  t.year += dt;
}

/** The island after the strike: all of it still there, all of it burnt, the spear standing in
 * a small lake at its heart, fissures torn out from it. */
export interface Ashen {
  island: Island;
  spear: Pt;
  /** Where the survivors huddle (the old home), and where the walk to the spear starts. */
  camp: Pt;
}

const ashen = new Map<number, Ashen>();
/** The lake round the spear's foot, in tiles. */
export const LAKE = 4.5;
/** How far out the blow flattened the land, beyond the lake. */
const BASIN = 34;

/** Scar marks on the burnt island: burnt ground, and the fissures. */
export const BURNT = 1;
export const FISSURE = 2;
export const LAKE_WATER = 3;

export function ashenFor(state: GameState): Ashen {
  const base = islandFor(state);
  const hit = ashen.get(base.seed);
  if (hit) return hit;
  const N = ISLAND;
  const height = new Float32Array(base.height);
  const biome = new Uint8Array(base.biome);
  const scar = new Uint8Array(N * N);
  // The spear came down at the island's heart (the middle of its land).
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (height[i] <= 0) continue;
      scar[i] = BURNT;
      sx += x;
      sy += y;
      n++;
    }
  }
  const spear = { x: n ? sx / n : N / 2, y: n ? sy / n : N / 2 };
  // The blow flattened the land for a long way round: a wide, shallow bowl, rising gently to
  // meet what's left standing.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (height[i] <= 0) continue;
      const d = Math.hypot(x - spear.x, y - spear.y);
      const k = Math.min(1, Math.max(0, (d - LAKE) / BASIN));
      const ease = k * k * (3 - 2 * k);
      const low = 0.012 + 0.0012 * (d - LAKE);
      height[i] = low + (height[i] - low) * ease;
      if (ease < 0.6 && biome[i] !== Biome.Sea && biome[i] !== Biome.Deep) biome[i] = Biome.Rock;
    }
  }
  // Fissures: jagged grooves torn out from the spear, sunk into the land itself.
  let r = (base.seed * 9301 + 49297) >>> 0;
  const rand = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 2 ** 32;
  };
  const carve = (x: number, y: number, a: number, len: number, depth: number) => {
    for (let d = 0; d < len; d += 0.5) {
      a += (rand() - 0.5) * 0.5;
      x += Math.cos(a) * 0.5;
      y += Math.sin(a) * 0.5;
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (cx < 1 || cy < 1 || cx >= N - 1 || cy >= N - 1) return;
      if (height[cy * N + cx] <= 0) return;
      // Wide near the spear, narrowing as it runs out.
      const cells = d < len * 0.45 ? [0, 1, N, N + 1] : [0];
      for (const o of cells) {
        const i = cy * N + cx + o;
        if (height[i] <= 0) continue;
        height[i] = Math.max(0.003, height[i] - 0.025);
        scar[i] = FISSURE;
      }
      if (depth < 1 && rand() < 0.012) carve(x, y, a + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5), len * 0.4, depth + 1);
    }
  };
  const arms = 12;
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2 + rand() * 0.4;
    carve(spear.x + Math.cos(a) * LAKE, spear.y + Math.sin(a) * LAKE, a, 40 + rand() * 80, 0);
  }
  // The lake round its foot, and a low burnt shore.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const d = Math.hypot(x - spear.x, y - spear.y);
      if (d < LAKE) {
        height[i] = -0.04;
        biome[i] = Biome.Sea;
        scar[i] = LAKE_WATER;
      } else if (d < LAKE + 3) {
        height[i] = Math.min(Math.max(height[i], 0.01), 0.01 + (d - LAKE) * 0.012);
        biome[i] = Biome.Rock;
        scar[i] = BURNT;
      }
    }
  }
  const out: Ashen = { island: { seed: base.seed + 7777, n: N, biome, height, home: { ...base.home }, places: {}, scar }, spear, camp: { ...base.home } };
  ashen.set(base.seed, out);
  return out;
}
