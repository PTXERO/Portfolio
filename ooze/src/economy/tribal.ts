// The Tribal era's economy. A quarter of the herd lives through the strike (about the share
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
/** Never fewer than this many (a tribe needs a few). */
const MIN_SURVIVORS = 6;
/** Food a person gathers a second, by hand: before waking (huddled, scared) and after. */
const FORAGE_ASLEEP = 0.15;
const FORAGE_AWAKE = 0.6;

/** Once the Tribal era has begun, every era before it is sealed: no going back, nothing runs. */
export function sealed(state: GameState, id: StageId): boolean {
  return id !== TRIBAL && state.unlocked.includes(TRIBAL);
}

/** What the eras before leave: each tenfold of what they made adds a little, for good. */
export function heritageOf(state: GameState): number {
  let sum = 0;
  for (const id of STAGE_ORDER) {
    if (id === TRIBAL) continue;
    const t = state.stages[id].totalEarned;
    if (t.gt(1)) sum += t.log10();
  }
  return 1 + 0.05 * sum;
}

/** The tribe as the strike leaves it, from the herd that was. */
export function startTribe(state: GameState): TribeState {
  const c = state.stages.creature;
  const survivors = Math.max(MIN_SURVIVORS, Math.round(c.pop * SURVIVE));
  return {
    awake: false,
    pop: survivors,
    survivors,
    look: { parts: { ...c.equipped }, diet: state.stages.cell.upgrades.includes('hunter') ? 'hunter' : state.stages.cell.upgrades.includes('grazer') ? 'grazer' : 'omnivore' },
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
  if (!t) return D(0);
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

/** What's left of the island after the strike, and where the spear stands. */
export interface Fragment {
  island: Island;
  spear: Pt;
  /** The camp: where the survivors huddle (the old home). */
  camp: Pt;
}

const fragments = new Map<number, Fragment>();

/**
 * The island, broken: one ragged piece of land around the old home, cliffs where it sheared
 * off, deep sea everywhere else, and a scorched crater a little inland where the spear went in.
 */
export function fragmentFor(state: GameState): Fragment {
  const base = islandFor(state);
  const hit = fragments.get(base.seed);
  if (hit) return hit;
  const N = ISLAND;
  const home = base.home;
  // The spear fell a little inland from home (toward the old island's heart).
  const ix = N / 2 - home.x;
  const iy = N / 2 - home.y;
  const il = Math.hypot(ix, iy) || 1;
  const spear = { x: home.x + (ix / il) * 15, y: home.y + (iy / il) * 15 };
  const mid = { x: (home.x + spear.x) / 2, y: (home.y + spear.y) / 2 };
  const height = new Float32Array(base.height);
  const biome = new Uint8Array(base.biome);
  // A ragged edge: the radius wanders with the angle.
  const wobble = (a: number) => 36 + Math.sin(a * 3 + base.seed) * 6 + Math.sin(a * 7 + base.seed * 0.3) * 3 + Math.sin(a * 13) * 1.5;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = x - mid.x;
      const dy = y - mid.y;
      const d = Math.hypot(dx, dy);
      const edge = wobble(Math.atan2(dy, dx));
      if (d > edge) {
        height[i] = -0.28;
        biome[i] = Biome.Deep;
        continue;
      }
      // Sheared cliffs along the break (only where there was land to break).
      if (d > edge - 3 && height[i] > -0.02) {
        height[i] = Math.max(height[i], 0.12 + (edge - d) * 0.02);
        biome[i] = Biome.Rock;
      }
      // The crater: a scorched bowl with a raised lip.
      const cd = Math.hypot(x - spear.x, y - spear.y);
      if (cd < 9) {
        // A flat scorched floor, low, inside a ring wall of thrown-up rock.
        const k = cd / 9;
        height[i] = k < 0.72 ? 0.015 : Math.max(height[i], 0.16 * (1 - Math.abs(k - 0.86) / 0.14));
        biome[i] = Biome.Rock;
      }
    }
  }
  const frag: Fragment = { island: { seed: base.seed + 7777, biome, height, home: { ...home }, places: {} }, spear, camp: { ...home } };
  fragments.set(base.seed, frag);
  return frag;
}
