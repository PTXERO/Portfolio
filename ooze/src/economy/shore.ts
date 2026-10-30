// New Shore, Phase 1: settling. The four found a village around a hearth on a big, fogged
// island, and grow it toward a hundred. The village gathers food and wood by itself (you set
// what it leans toward), lays out what you choose to build around the hearth, and has children
// where there's a fire, room and food to spare. The four grow old and die once the line goes
// on. The chief (one of the four, then their heirs) walks the island, and the fog draws back;
// out there are other villages, other kinds (see docs/new-shore.md).
//
// Time is counted in days (DAY_SEC each). Everything runs offline too.

import { BUILDS, buildName, POIS, RELICS, SHORE_STORY, type Boosts, type BuildId, type Find, type PoiKind, type RelicId } from '../content/shore';
import { record } from './chronicle';
import { Biome, CELL, isLand, islandOf, reveal, type Island, type Pt } from './island';
import { generateTerrain, TERRAIN_V, type Terrain } from './terrain';
import type { CreatureLook } from '../scene/creatureLook';
import type { GameState, TribeState } from './types';

/** Tiles across New Shore's island: eight times the area of the spear's. */
export const SHORE_N = 1020;
export const SHORE_CELLS = SHORE_N / CELL;
/** Seconds in a day. */
export const DAY_SEC = 120;
/** Days in a season (the year is four, from the spring they landed in). */
export const SEASON_DAYS = 4;
/** Days a child takes to grow up (and start working). */
export const GROW_DAYS = 10;
/** What a day's work brings in, each worker, before bonuses; and what each eats a day. */
const FOOD_PER = 2.5;
const WOOD_PER = 3;
const EAT = 1;
const EAT_CHILD = 0.5;
/** Food a birth takes, and how often a pair of adults has a child (a day) with all well. */
const BIRTH_FOOD = 12;
const PAIR_RATE = 0.15;
/** What's kept with nothing built to keep it in. */
const FOOD_CAP = 40;
const WOOD_CAP = 50;
/** Room before any huts (under the raft's planks). */
const BASE_ROOM = 4;
/** How far the chief sees, and walks in a second (tiles). */
export const CHIEF_SIGHT = 16;
const CHIEF_SPEED = 5;
/** The village's own ground: seen from the start. */
const HOME_SIGHT = 22;
/** Winning a village over: trust a gift brings (twice as much brought by the chief in person),
 * a day of the chief's company, and the grazers' Welcome (kin drifting toward them). */
const GIFT_TRUST = 4;
const VISIT_TRUST = 2;
const WELCOME_TRUST = 0.7;
/** How near the chief must be to count as visiting (tiles). */
export const VISIT_NEAR = 14;
/** Scouts: how fast they go and how far they see (tiles). */
const SCOUT_SPEED = CHIEF_SPEED / 2;
const SCOUT_SIGHT = 12;
/** Trust a village of your own kin starts at, once found. */
const FIRST_TRUST = 10;

export type Lean = 'food' | 'balanced' | 'wood';
export type Relation = 'kin' | 'prey' | 'predator' | 'enemy';

export interface ShorePerson {
  id: number;
  name: string;
  /** The day they were born (founders: before the landing, so they're grown). */
  born: number;
  /** One of the four who crossed. */
  founder?: boolean;
  trait?: string;
  /** The day they'll die of old age. */
  dies?: number;
  /** Of another kind: the village they came from (its id), and the day they joined. */
  kind?: number;
  joined?: number;
}

export interface Village {
  id: number;
  name: string;
  x: number;
  y: number;
  /** grazer, hunter or omnivore (the diets' own names on the map). */
  diet: string;
  cannibal?: boolean;
  pop: number;
  /** Their kind: how they look. */
  look: CreatureLook;
  /** Where they live (shapes their name, their kind, their huts). */
  habitat?: Habitat;
  /** Seen by the chief (or the village's own lookouts). */
  found: boolean;
  /** Kin only: how far they've been won over (0 to 100), and whether they've joined you. */
  trust?: number;
  joined?: boolean;
  /** Won over, but there wasn't room: waiting for your answer (since this day), or waiting for
   * room (since this day; they lose patience). */
  asking?: number;
  waiting?: number;
  /** Kept their own village, as yours: what you take of what they make (0 to 0.6), and how loyal
   * they are (0 to 100; at nothing, they throw you off). */
  vassal?: { tax: number; loyalty: number };
  /** Turned away: gone from the island's map (to the village they went to, that day). */
  gone?: { to: number; day: number };
}

export type JoinAnswer = 'crowd' | 'vassal' | 'wait' | 'away';

export interface Scout {
  at: Pt;
  to: Pt | null;
  /** Seconds before giving up on where they're headed (stuck behind water, say). */
  left: number;
}

/** A landmark out on the island: where, found yet, and how many of its layers are explored
 * (and how far into the next). */
export interface Poi {
  id: number;
  kind: PoiKind;
  x: number;
  y: number;
  found: boolean;
  /** Noticed by you: tapped, or the chief's been near it (only then is it listed). */
  known?: boolean;
  done: number;
  t: number;
}

export interface ShoreState {
  seed: number;
  /** Which generation of island it stands on (unset: the first). */
  terrain?: number;
  /** Days since landfall, and seconds into the day. */
  day: number;
  clock: number;
  food: number;
  wood: number;
  people: ShorePerson[];
  nextId: number;
  births: number;
  deaths: number;
  /** The day the first child was born (the four start growing old then). */
  firstBirth?: number;
  /** Toward the next birth (one at 1). */
  birthT: number;
  /** Days in a row with nothing to eat. */
  hungry: number;
  lean: Lean;
  /** What's built, in the order it went up, and where (laid out around the hearth). */
  built: { id: BuildId; x: number; y: number; day: number }[];
  graves: Pt[];
  /** Where the hearth is (the village's heart), and the beach they came ashore on. */
  hearth: Pt;
  beach: Pt;
  /** Who leads (a person's id), where they are and where they're walking. */
  chief: number;
  chiefAt: Pt;
  chiefTo: Pt | null;
  /** The look and diet the line carries, and whether they eat their own. */
  look: CreatureLook;
  cannibal: boolean;
  villages: Village[];
  /** What's going up now (one at a time): where, and seconds left of how many. */
  building?: { id: BuildId; x: number; y: number; left: number; total: number };
  /** Whether the raft they came on has been broken up for its wood. */
  raftTaken?: boolean;
  /** Scouts out exploring (one per scout's hut). */
  scouts?: Scout[];
  /** The island's landmarks (placed the first time they're needed), the relics found at them,
   * the buildings learned there, and what's been found since the interface last looked. */
  pois?: Poi[];
  relics?: RelicId[];
  learned?: BuildId[];
  finds?: { poi: number; find: Find; dup?: boolean }[];
  /** How far round the village its lookout has shown. */
  watched?: number;
  /** Things the interface should show (and clear): births, deaths, finds. */
  news: string[];
  /** Ids of villages found since the interface last looked. */
  newFinds: number[];
}

// ---- The world ----

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Islands of the second generation (see terrain.ts), as they're made or loaded, and which
 * seeds are older New Shores still on the first (their villages and landmarks stand on it). */
const made = new Map<number, Island>();
const firstGen = new Set<number>();

/** Hands over an island made elsewhere (in a worker, or loaded from the device). */
export function provideTerrain(seed: number, t: Terrain): void {
  made.set(seed, { seed, n: SHORE_N, biome: t.biome, height: t.height, home: t.home, places: {} });
}

/** Whether New Shore's island for a seed is ready to use without making it here and now. */
export function terrainReady(seed: number): boolean {
  return firstGen.has(seed) || made.has(seed);
}

export function shoreIsland(seed: number): Island {
  if (firstGen.has(seed)) return islandOf(seed, [], SHORE_N);
  let is = made.get(seed);
  if (!is) {
    // Not made ahead of time (tests, the simulator, or it wasn't ready): made now.
    provideTerrain(seed, generateTerrain(seed, SHORE_N));
    is = made.get(seed)!;
  }
  return is;
}

const SYL = ['ka', 'ri', 'mo', 'tu', 'na', 'sa', 'ke', 'lo', 'vi', 'ra', 'en', 'ul', 'ha', 'po', 'mi', 'zu', 'ta', 'ne', 'ok', 'ya', 'bo', 'li', 'fe', 'gu', 'da', 'shi'];
function nameFrom(rand: () => number): string {
  const n = 2 + (rand() < 0.25 ? 1 : 0);
  const s = Array.from({ length: n }, () => SYL[Math.floor(rand() * SYL.length)]).join('');
  return s[0].toUpperCase() + s.slice(1);
}

/** Where a village lives, which shapes everything about it: its name, its kind's body and
 * colours, and its huts. */
export type Habitat = 'river' | 'lake' | 'desert' | 'scrub' | 'forest' | 'meadow' | 'mountain' | 'coast' | 'marsh';

interface HabitatDef {
  /** Names: `the {word}folk`, `the {word} people`, `the {word} clan`. */
  words: string[];
  legs: string[];
  backs: string[];
  tails: string[];
  eyes: string[];
  /** Their colours (body, edge): a pair is picked. */
  hues: [string, string][];
  /** How well each diet does here (higher, likelier they settle here). */
  likes: Record<string, number>;
}

export const HABITATS: Record<Habitat, HabitatDef> = {
  river: { words: ['River', 'Ford', 'Rush', 'Stream'], legs: ['webbedFeet', 'paddles'], backs: ['bare', 'shell', 'barnacles'], tails: ['finTail', 'paddleTail', 'eelTail'], eyes: ['wetEyes', 'periscope'], hues: [['#2f5f8a', '#8ac0e8'], ['#2a7a7a', '#7ae0d0']], likes: { grazer: 2, omnivore: 3, hunter: 1 } },
  lake: { words: ['Lake', 'Still-water', 'Mere', 'Pool'], legs: ['webbedFeet', 'paddles'], backs: ['bare', 'shell', 'backFin'], tails: ['eelTail', 'finTail'], eyes: ['wetEyes', 'stalkEyes'], hues: [['#2a6a7a', '#80d0d8'], ['#3a5a8a', '#a0b8f0']], likes: { grazer: 3, omnivore: 2, hunter: 1 } },
  desert: { words: ['Dune', 'Sand', 'Dust', 'Sun'], legs: ['runner', 'springLegs', 'caveStriders'], backs: ['sail', 'spines', 'bare'], tails: ['feelerTail', 'balanceTail', 'spikeTail'], eyes: ['sideEyes', 'hawkEyes'], hues: [['#a8783a', '#f0c880'], ['#9a6a4a', '#e8b890']], likes: { grazer: 0.3, omnivore: 1, hunter: 3 } },
  scrub: { words: ['Dry-grass', 'Thorn', 'Brush', 'Dust'], legs: ['hooves', 'runner', 'stubby'], backs: ['woollyCoat', 'spines', 'bare'], tails: ['stub', 'curlTail', 'balanceTail'], eyes: ['sideEyes', 'lensEyes'], hues: [['#8a7a4a', '#d8c88a'], ['#7a6a3a', '#c8b070']], likes: { grazer: 1.5, omnivore: 1.5, hunter: 2 } },
  forest: { words: ['Wood', 'Bough', 'Fern', 'Leaf'], legs: ['treeClaws', 'climber', 'stubby'], backs: ['mossCoat', 'leafFrill', 'barkPlates'], tails: ['bushyTail', 'curlTail', 'balanceTail'], eyes: ['nightEyes', 'lensEyes', 'brightEyes'], hues: [['#3f6a3a', '#9ad88a'], ['#5a4a2a', '#b8a070']], likes: { grazer: 2, omnivore: 2, hunter: 3 } },
  meadow: { words: ['Meadow', 'Long-grass', 'Field', 'Flower'], legs: ['hooves', 'runner', 'springLegs'], backs: ['woollyCoat', 'bare', 'leafFrill'], tails: ['stub', 'crestTail', 'bushyTail'], eyes: ['sideEyes', 'brightEyes'], hues: [['#8a7a2a', '#f0dc78'], ['#7a5a8a', '#d8b0f0']], likes: { grazer: 3, omnivore: 2, hunter: 1 } },
  mountain: { words: ['Stone', 'Crag', 'High', 'Cliff'], legs: ['climber', 'caveStriders', 'hooves'], backs: ['stonePlates', 'woollyCoat', 'crystalSpines'], tails: ['clubTail', 'spikeTail', 'stub'], eyes: ['hawkEyes', 'farSight', 'nightEyes'], hues: [['#5a5a62', '#c0c4cc'], ['#4a4a5a', '#a8b0c8']], likes: { grazer: 1, omnivore: 1.5, hunter: 3 } },
  coast: { words: ['Shore', 'Tide', 'Shell', 'Salt'], legs: ['crabLegs', 'paddles', 'suckerFeet'], backs: ['shell', 'barnacles', 'backFin'], tails: ['finTail', 'paddleTail'], eyes: ['stalkEyes', 'wetEyes'], hues: [['#9a4a4a', '#f0a090'], ['#8a5a6a', '#f0b0c0']], likes: { grazer: 1, omnivore: 3, hunter: 2 } },
  marsh: { words: ['Reed', 'Fen', 'Bog', 'Mire'], legs: ['suckerFeet', 'webbedFeet'], backs: ['mossCoat', 'bare'], tails: ['reedTail', 'eelTail'], eyes: ['periscope', 'stalkEyes'], hues: [['#5a6a3a', '#b8c880'], ['#4a5a4a', '#a0b8a0']], likes: { grazer: 2, omnivore: 2.5, hunter: 1 } },
};

/** Mouths go with what they eat. */
const MOUTHS: Record<string, string[]> = {
  grazer: ['grinders', 'beak', 'snout', 'filterMouth', 'mudSifter'],
  hunter: ['fangs', 'tusks', 'hookBeak', 'jaws', 'pincers'],
  omnivore: ['jaws', 'beak', 'snout', 'mudSifter', 'pincers'],
};

/** What a place is, from what's round it: rivers and lakes first (they matter most to whoever
 * lives there), then the sea, then whatever the ground mostly is. */
export function habitatAt(is: Island, x: number, y: number): Habitat {
  const N = is.n;
  const c: number[] = new Array(13).fill(0);
  let all = 0;
  for (let j = -10; j <= 10; j += 2) {
    for (let i = -10; i <= 10; i += 2) {
      if (i * i + j * j > 100) continue;
      const xx = Math.round(x + i);
      const yy = Math.round(y + j);
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      c[is.biome[yy * N + xx]]++;
      all++;
    }
  }
  const share = (b: number) => c[b] / Math.max(1, all);
  if (share(Biome.River) > 0.04) return 'river';
  if (share(Biome.Lake) > 0.1) return 'lake';
  if (share(Biome.Sea) + share(Biome.Deep) + share(Biome.Sand) > 0.25) return 'coast';
  if (share(Biome.Marsh) > 0.25) return 'marsh';
  if (share(Biome.Desert) > 0.35) return 'desert';
  if (share(Biome.High) + share(Biome.Rock) + share(Biome.Peak) > 0.35) return 'mountain';
  if (share(Biome.Scrub) > 0.35) return 'scrub';
  if (share(Biome.Forest) > 0.4) return 'forest';
  return 'meadow';
}

/** Who eats whom: hunters prey on omnivores, omnivores on grazers. */
const CHAIN = ['hunter', 'omnivore', 'grazer'];

/** What another village is to yours: the same diet can be won over, the rest is war. */
export function relation(s: Pick<ShoreState, 'look' | 'cannibal'>, v: Village): Relation {
  if (s.cannibal || v.cannibal) return 'enemy';
  const us = CHAIN.indexOf(s.look.diet);
  const them = CHAIN.indexOf(v.diet);
  if (us === them) return 'kin';
  return us < them ? 'prey' : 'predator';
}

/** Where they settle (a fair way up from the beach, on open ground), and the island's
 * villages: hidden in the fog, each its own kind; the nearest is the smoke they saw. */
export function shoreWorld(seed: number, look: CreatureLook, cannibal: boolean): { island: Island; hearth: Pt; beach: Pt; villages: Village[] } {
  const is = shoreIsland(seed);
  const N = is.n;
  const rand = rng(seed * 13 + 5);
  const at = (x: number, y: number) => is.biome[Math.round(y) * N + Math.round(x)];
  const open = (x: number, y: number) => {
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const b = at(x + i, y + j);
      if (b !== Biome.Grass && b !== Biome.Forest && b !== Biome.Sand) return false;
    }
    return true;
  };
  const beach = { ...is.home };
  // The village starts right where the raft came in: the nearest open ground just up from
  // the beach (a few steps inland, off the sand).
  let hearth = { ...beach };
  const inward = Math.atan2(N / 2 - beach.y, N / 2 - beach.x);
  search: for (let r = 5; r < 40; r++) {
    for (let k = 0; k < 24; k++) {
      // Inland first, then round to either side.
      const a = inward + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22;
      const p = { x: Math.round(beach.x + Math.cos(a) * r), y: Math.round(beach.y + Math.sin(a) * r) };
      if (open(p.x, p.y) && at(p.x, p.y) === Biome.Grass) {
        hearth = p;
        break search;
      }
    }
  }
  // The diets out there, chosen against yours: always some kin to win over (not for
  // cannibals) and something that hunts you; the nearest is kin (or, for cannibals, prey).
  const ours = look.diet === 'none' ? 'omnivore' : look.diet;
  const others = CHAIN.filter((d) => d !== ours);
  const predator = CHAIN[CHAIN.indexOf(ours) - 1];
  const plan: { diet: string; cannibal?: boolean }[] = [
    { diet: cannibal ? CHAIN[Math.min(2, CHAIN.indexOf(ours) + 1)] : ours },
    { diet: ours },
    predator ? { diet: predator } : { diet: ours, cannibal: true },
    { diet: others[0] },
    { diet: others[1] ?? others[0] },
    { diet: ours },
    { diet: others[Math.floor(rand() * others.length)] },
  ];
  // Each settles where its diet does well (grazers on the grass and by water, hunters in the
  // woods, the hills and the dry country, omnivores almost anywhere), spread out over the island
  // (the first within sight of the beach: the smoke they saw).
  const villages: Village[] = [];
  const taken: Pt[] = [hearth];
  const fine = (x: number, y: number) => {
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const b = at(x + i, y + j);
      if (!isLand(is, x + i, y + j) || b === Biome.River || b === Biome.Peak) return false;
    }
    return true;
  };
  plan.forEach((p, i) => {
    let best: { q: Pt; h: Habitat } | null = null;
    let bestScore = -Infinity;
    let valid = 0;
    for (let tries = 0; tries < 1500 && valid < 40; tries++) {
      const a = rand() * Math.PI * 2;
      const q =
        i === 0
          ? { x: Math.round(hearth.x + Math.cos(a) * (50 + rand() * 25)), y: Math.round(hearth.y + Math.sin(a) * (50 + rand() * 25)) }
          : { x: Math.round(N / 2 + Math.cos(a) * rand() * N * 0.42), y: Math.round(N / 2 + Math.sin(a) * rand() * N * 0.42) };
      if (q.x < 12 || q.y < 12 || q.x > N - 12 || q.y > N - 12 || !fine(q.x, q.y)) continue;
      const gap = i === 0 ? 30 : Math.max(60, 140 - tries / 12);
      if (taken.some((t) => Math.hypot(t.x - q.x, t.y - q.y) < gap)) continue;
      valid++;
      const h = habitatAt(is, q.x, q.y);
      // (A place already settled by another village is less likely again: the island's kinds vary.)
      const score = (HABITATS[h].likes[p.diet] ?? 1) - 1.3 * villages.filter((v) => v.habitat === h).length + rand() * 1.2;
      if (score > bestScore) {
        bestScore = score;
        best = { q, h };
      }
    }
    if (!best) return;
    taken.push(best.q);
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const hd = HABITATS[best.h];
    let name = '';
    for (let k = 0; k < 12 && (!name || villages.some((v) => v.name === name || v.name.split(' ')[1]?.startsWith(name.split(' ')[1]?.replace('folk', '') ?? ''))); k++) {
      const word = pick(hd.words);
      name = pick([`the ${word}folk`, `the ${word} clan`, `the ${word} people`]);
    }
    villages.push({
      id: i,
      name,
      x: best.q.x,
      y: best.q.y,
      diet: p.diet,
      cannibal: p.cannibal,
      habitat: best.h,
      pop: Math.round(8 + rand() * 32),
      look: { parts: { legs: pick(hd.legs), mouth: pick(MOUTHS[p.diet] ?? MOUTHS.omnivore), eyes: pick(hd.eyes), back: pick(hd.backs), tail: pick(hd.tails) }, diet: p.diet, hue: pick(hd.hues) },
      found: false,
    });
  });
  return { island: is, hearth, beach, villages };
}

/** New Shore as it begins: the four, come up from the beach. */
export function newShore(tribe: TribeState): ShoreState {
  const seed = tribe.landed?.seed ?? tribe.seed + 1;
  const look: CreatureLook = { parts: { ...tribe.look.parts }, diet: tribe.look.diet };
  const cannibal = !!tribe.cannibal;
  const w = shoreWorld(seed, look, cannibal);
  const rand = rng(seed + 99);
  const four = (tribe.family?.length ? tribe.family : [0, 1, 2, 3].map(() => ({ name: nameFrom(rand), trait: 'hardy' }))).slice(0, 4);
  const people: ShorePerson[] = four.map((p, i) => ({ id: i, name: p.name, trait: p.trait, born: -20, founder: true }));
  return {
    seed,
    terrain: TERRAIN_V,
    day: 0,
    clock: 0,
    // Nothing: what they had went in the crossing. The raft's on the beach, though, and its
    // wood is the hearth.
    food: 0,
    wood: 0,
    people,
    nextId: people.length,
    births: 0,
    deaths: 0,
    birthT: 0,
    hungry: 0,
    lean: 'balanced',
    built: [],
    graves: [],
    hearth: w.hearth,
    beach: w.beach,
    chief: 0,
    chiefAt: { ...w.beach },
    chiefTo: { ...w.hearth },
    look,
    cannibal,
    villages: w.villages,
    news: [],
    newFinds: [],
  };
}

export function shoreOf(state: GameState): ShoreState | undefined {
  const s = state.stages.shore.shore;
  // (A New Shore begun before the second generation of island keeps its first.)
  if (s && s.terrain === undefined && !firstGen.has(s.seed)) firstGen.add(s.seed);
  return s;
}

/** Into New Shore: the stage opens, with the four on the beach. */
export function startShore(state: GameState): ShoreState | undefined {
  const t = state.stages.tribal.tribe;
  if (!t) return undefined;
  const st = state.stages.shore;
  if (!st.shore) {
    st.shore = newShore(t);
    st.seen = new Uint8Array(SHORE_CELLS * SHORE_CELLS);
    const s = st.shore;
    reveal(shoreIsland(s.seed), st.seen, s.beach.x, s.beach.y, HOME_SIGHT);
    reveal(shoreIsland(s.seed), st.seen, s.hearth.x, s.hearth.y, HOME_SIGHT);
    poisOf(s);
  }
  if (!state.unlocked.includes('shore')) state.unlocked.push('shore');
  state.current = 'shore';
  return st.shore;
}

// ---- The village ----

export function count(s: ShoreState, id: BuildId): number {
  return s.built.filter((b) => b.id === id).length;
}

export function isAdult(s: ShoreState, p: ShorePerson): boolean {
  return s.day + s.clock / DAY_SEC - p.born >= GROW_DAYS / (1 + boosts(s).grow);
}

const NO_BOOSTS: Boosts = { food: 0, wood: 0, births: 0, grow: 0, speed: 0, sight: 0, gift: 0, room: 0, foodCap: 0, woodCap: 0, winter: 0, watch: 0 };
const boostCache = new WeakMap<ShoreState, { key: string; b: Boosts }>();

/** What the buildings and relics add up to (worked out again only when either changes). */
export function boosts(s: ShoreState): Boosts {
  const key = `${s.built.length}|${s.relics?.length ?? 0}`;
  const hit = boostCache.get(s);
  if (hit && hit.key === key) return hit.b;
  const b = { ...NO_BOOSTS };
  const add = (fx: Partial<Boosts> | undefined, n = 1) => {
    for (const k of Object.keys(fx ?? {}) as (keyof Boosts)[]) b[k] += (fx![k] ?? 0) * n;
  };
  for (const def of BUILDS) if (def.fx) add(def.fx, count(s, def.id));
  for (const r of s.relics ?? []) add(RELICS.find((x) => x.id === r)?.fx);
  b.winter = Math.min(1, b.winter);
  boostCache.set(s, { key, b });
  return b;
}

/** The season now (0 spring, 1 summer, 2 autumn, 3 winter) and how far into it (0 to 1). */
export function shoreSeason(s: Pick<ShoreState, 'day' | 'clock'>): { si: number; into: number } {
  const y = ((s.day + s.clock / DAY_SEC) / SEASON_DAYS) % 4;
  return { si: Math.floor(y), into: y % 1 };
}

/** Food comes in slower in winter (and a little better at harvest). */
export function seasonFood(s: ShoreState): number {
  const { si } = shoreSeason(s);
  return si === 3 ? 1 - 0.3 * (1 - boosts(s).winter) : si === 2 ? 1.1 : 1;
}

export function room(s: ShoreState): number {
  return BASE_ROOM + count(s, 'hut') * 4 + boosts(s).room;
}
export function foodCap(s: ShoreState): number {
  return FOOD_CAP + count(s, 'rack') * 40 + boosts(s).foodCap;
}
export function woodCap(s: ShoreState): number {
  return WOOD_CAP + count(s, 'woodpile') * 50 + boosts(s).woodCap;
}

export function buildCost(s: ShoreState, id: BuildId): number {
  const def = BUILDS.find((b) => b.id === id)!;
  return Math.ceil(def.wood * def.growth ** count(s, id));
}

/** Builds on offer now: unlocked, and not at their limit. */
export function buildsOpen(s: ShoreState): typeof BUILDS {
  return BUILDS.filter((b) => (!b.after || count(s, b.after) > 0) && (!b.learn || learned(s, b.id)) && (b.max === undefined || count(s, b.id) + (s.building?.id === b.id ? 1 : 0) < b.max));
}

/** Whether a building that's learned out on the island has been. */
export function learned(s: ShoreState, id: BuildId): boolean {
  return !!s.learned?.includes(id);
}

/** Where the next of a kind of building goes: rings out from the hearth, huts in the inner
 * rings, stores and workshops further out, each in the first free spot on open ground. */
function placeFor(s: ShoreState, id: BuildId, is: Island): Pt {
  if (id === 'hearth') return { ...s.hearth };
  const inner = id === 'hut';
  const startRing = inner ? 1 : 2;
  for (let ring = startRing; ring < 30; ring++) {
    const r = 3 + ring * 3.2;
    const slots = Math.max(6, Math.floor((2 * Math.PI * r) / 3.4));
    for (let k = 0; k < slots; k++) {
      // (Offset each ring, and walk round it in a seeded order, so it doesn't look gridded.)
      const a = ((k * 7) % slots) / slots * Math.PI * 2 + ring * 0.7;
      const x = Math.round((s.hearth.x + Math.cos(a) * r) * 2) / 2;
      const y = Math.round((s.hearth.y + Math.sin(a) * r * 0.8) * 2) / 2;
      if (!isLand(is, x, y) || is.biome[Math.round(y) * is.n + Math.round(x)] === Biome.Sand) continue;
      if (s.built.some((b) => Math.hypot(b.x - x, b.y - y) < 2.8) || (s.building && Math.hypot(s.building.x - x, s.building.y - y) < 2.8) || s.graves.some((g) => Math.hypot(g.x - x, g.y - y) < 2)) continue;
      // Workshops and stores keep out of the huts' rings.
      if (!inner && ring < 3) continue;
      return { x, y };
    }
  }
  return { x: s.hearth.x + 4, y: s.hearth.y + 4 };
}

/** Seconds a building takes to put up: longer the bigger it is, quicker with more grown hands. */
export function buildTime(s: ShoreState, id: BuildId): number {
  const adults = s.people.filter((p) => isAdult(s, p)).length;
  return (30 + buildCost(s, id) * 1.8) / (1 + 0.03 * Math.min(adults, 40));
}

/** Starts a building (one at a time: it goes up over a while, then it's there). */
export function build(state: GameState, id: BuildId): boolean {
  const s = shoreOf(state);
  if (!s || s.building || !buildsOpen(s).some((b) => b.id === id)) return false;
  const cost = buildCost(s, id);
  if (s.wood < cost) return false;
  const total = buildTime(s, id);
  s.wood -= cost;
  const at = placeFor(s, id, shoreIsland(s.seed));
  s.building = { id, ...at, left: total, total };
  return true;
}

function finishBuilding(state: GameState, s: ShoreState): void {
  const b = s.building!;
  s.building = undefined;
  s.built.push({ id: b.id, x: b.x, y: b.y, day: s.day + s.clock / DAY_SEC });
  if (b.id === 'hearth') {
    s.news.push(SHORE_STORY.hearth);
    record(state, 'The hearth was lit.', 'shore', shoreWhen(s));
  } else s.news.push(`The ${buildName(b.id, s.look.diet).toLowerCase()} is built.`);
}

/** Wood the raft gives, broken up. */
export const RAFT_WOOD = 20;

/** The raft they came on, broken up for its wood (there's no going back now). */
export function takeRaft(state: GameState): number {
  const s = shoreOf(state);
  if (!s || s.raftTaken) return 0;
  s.raftTaken = true;
  const got = Math.min(RAFT_WOOD, Math.max(0, woodCap(s) + RAFT_WOOD - s.wood));
  s.wood += got;
  record(state, 'They broke up the raft that had carried them over the sea, for its wood.', 'shore', shoreWhen(s));
  return got;
}

export function setLean(state: GameState, lean: Lean): void {
  const s = shoreOf(state);
  if (s) s.lean = lean;
}

/** When something happened, for the Chronicle: not a count of days (this is just life now),
 * but whose time it was. */
export function shoreWhen(s: ShoreState): string {
  const chief = s.people.find((p) => p.id === s.chief);
  return chief ? `In ${chief.name}'s time` : 'New Shore';
}

/** The village's day: how many work at food and at wood, and what that brings in. */
export function workPlan(s: ShoreState): { food: number; wood: number; eat: number; foodRate: number; woodRate: number; land: number } {
  const adults = s.people.filter((p) => isAdult(s, p)).length;
  const kids = s.people.length - adults;
  const eat = adults * EAT + kids * EAT_CHILD;
  const bo = boosts(s);
  const foodEach = FOOD_PER * (1 + 0.1 * count(s, 'camp') + bo.food) * seasonFood(s);
  const woodEach = WOOD_PER * (1 + 0.1 * count(s, 'cutter') + bo.wood);
  // Leaning one way or the other; with the stores full, hands go to the other.
  let share = s.lean === 'food' ? 0.75 : s.lean === 'wood' ? Math.min(1, (eat * 1.05) / Math.max(1, adults) / foodEach) : Math.min(1, (eat * 1.5) / Math.max(1, adults) / foodEach + 0.15);
  if (s.food >= foodCap(s) - 0.5) share = Math.min(share, (eat * 1.0) / Math.max(1, adults) / foodEach);
  if (s.wood >= woodCap(s) - 0.5) share = 1;
  const food = Math.round(adults * Math.max(0, Math.min(1, share)));
  const wood = adults - food;
  // The land round the village feeds only so many: past that, each more brings in less.
  const land = landFor(s);
  const working = food <= land ? food : land + (food - land) * 0.15;
  // Before there's a hearth there's no village yet: no one gathers, and no one goes hungry
  // (they're still living on what the crossing left them).
  if (!count(s, 'hearth')) return { food: 0, wood: 0, eat: 0, foodRate: 0, woodRate: 0, land };
  return { food, wood, eat, foodRate: working * foodEach, woodRate: wood * woodEach, land };
}

/** How many gatherers the land round the village feeds fully (more camps and weirs, more). */
export function landFor(s: ShoreState): number {
  return 12 + 5 * count(s, 'camp') + 6 * count(s, 'weir');
}

// ---- Winning them over ----

export function chiefNear(s: ShoreState, v: Village): boolean {
  return Math.hypot(s.chiefAt.x - v.x, s.chiefAt.y - v.y) < VISIT_NEAR;
}

/** Food a gift takes: more for a bigger village. */
export function giftCost(v: Village): number {
  return Math.ceil(10 + v.pop * 0.8);
}

/** Whether they can be won over now: found, kin, not yet joined. */
export function canWin(s: ShoreState, v: Village): boolean {
  return v.found && !v.joined && !v.vassal && !v.gone && v.asking === undefined && v.waiting === undefined && relation(s, v) === 'kin';
}

/** Room left in the village (beds not yet slept in). */
export function roomLeft(s: ShoreState): number {
  return room(s) - s.people.length;
}

/** A gift of food: trust, twice as much with the chief there to give it. */
export function gift(state: GameState, id: number): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canWin(s, v) || s.food < giftCost(v)) return 0;
  s.food -= giftCost(v);
  const gain = Math.round(GIFT_TRUST * (1 + boosts(s).gift) * (chiefNear(s, v) ? 2 : 1));
  addTrust(state, s, v, gain);
  return gain;
}

function addTrust(state: GameState, s: ShoreState, v: Village, n: number): void {
  v.trust = Math.min(100, (v.trust ?? FIRST_TRUST) + n);
  if (v.trust < 100) return;
  // Won over. With room for them they simply come; without, it's for you to say.
  if (roomLeft(s) >= v.pop) join(state, s, v);
  else {
    v.asking = s.day + s.clock / DAY_SEC;
    s.news.push(`${cap(v.name)} would join you, but there's no room for them.`);
  }
}

/** Patience: days they'll wait for an answer (then they wait for room), and for room. */
const ASK_DAYS = 1;
const WAIT_DAYS = 10;

/** Your answer to a village won over when there isn't room for them. */
export function answerJoin(state: GameState, id: number, a: JoinAnswer): void {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || v.asking === undefined) return;
  v.asking = undefined;
  const today = s.day + s.clock / DAY_SEC;
  if (a === 'crowd') join(state, s, v);
  else if (a === 'wait') {
    v.waiting = today;
    record(state, `${cap(v.name)} were asked to wait until there was room for them.`, 'shore', shoreWhen(s));
  } else if (a === 'vassal') {
    v.vassal = { tax: 0.2, loyalty: 80 };
    s.news.push(`${cap(v.name)} keep their village, and are yours.`);
    record(state, `${cap(v.name)} kept their own village, and pay tribute to the hearth.`, 'shore', shoreWhen(s));
  } else {
    // They go. Where, no one says: they walk off to whoever will have them.
    const to = s.villages.filter((x) => x !== v && !x.joined && !x.gone && !x.vassal && relation(s, x) !== 'kin').sort((p, q) => Math.hypot(p.x - v.x, p.y - v.y) - Math.hypot(q.x - v.x, q.y - v.y))[0];
    v.gone = { to: to?.id ?? -1, day: today };
    if (to) to.pop += v.pop;
    s.news.push(`${cap(v.name)} left their village, and went away.`);
    record(state, `${cap(v.name)} were turned away. They left their village, and were not seen again.`, 'shore', shoreWhen(s));
  }
}

/** What you take from a vassal village. */
export function setTax(state: GameState, id: number, tax: number): void {
  const v = shoreOf(state)?.villages.find((x) => x.id === id);
  if (v?.vassal) v.vassal.tax = Math.max(0, Math.min(0.6, tax));
}

/** A vassal village's day: what they send you, how they grow (less, the more you take, and less
 * as they fill their land), and how loyal they are (they'll bear a light hand for ever, a heavy
 * one only so long). */
export function vassalDay(v: Village): { food: number; wood: number; growth: number; loyalty: number } {
  const t = v.vassal?.tax ?? 0;
  const cap = 70;
  return {
    food: v.pop * 0.9 * t,
    wood: v.pop * 0.45 * t,
    growth: v.pop * 0.05 * (1 - t * 1.8) * Math.max(0, 1 - v.pop / cap),
    loyalty: 100 - t * 170,
  };
}

function stepVassals(state: GameState, s: ShoreState, k: number): void {
  for (const v of s.villages) {
    if (!v.vassal) continue;
    const d = vassalDay(v);
    s.food = Math.min(foodCap(s), s.food + d.food * k);
    s.wood = Math.min(woodCap(s), s.wood + d.wood * k);
    v.pop = Math.max(4, v.pop + d.growth * k);
    // Loyalty settles toward what the tax makes it (5 a day), and a starving lord is no lord.
    const target = s.hungry > 1 ? Math.min(d.loyalty, 30) : d.loyalty;
    v.vassal.loyalty += Math.sign(target - v.vassal.loyalty) * Math.min(Math.abs(target - v.vassal.loyalty), 5 * k);
    if (v.vassal.loyalty <= 0) {
      v.vassal = undefined;
      v.trust = 30;
      s.news.push(`${cap(v.name)} have thrown off your rule.`);
      record(state, `${cap(v.name)} would pay no more, and threw off the hearth's rule.`, 'shore', shoreWhen(s));
    }
  }
}

/** Won over: they leave their village and move into yours, another kind among you. */
function join(state: GameState, s: ShoreState, v: Village): void {
  if (v.joined) return;
  v.joined = true;
  const rand = rng(s.seed * 17 + v.id * 977);
  const today = s.day + s.clock / DAY_SEC;
  const used = new Set(s.people.map((p) => p.name));
  for (let i = 0; i < v.pop; i++) {
    let name = nameFrom(rand);
    for (let k = 0; k < 10 && used.has(name); k++) name = nameFrom(rand);
    used.add(name);
    // Mostly grown, some children; each with their years ahead of them.
    const age = rand() < 0.25 ? rand() * GROW_DAYS : GROW_DAYS + rand() * 40;
    s.people.push({ id: s.nextId++, name, born: today - age, dies: today - age + 70 + rand() * 30, kind: v.id, joined: today });
  }
  s.news.push(`${cap(v.name)} have joined you: ${v.pop} of them.`);
  record(state, `${cap(v.name)} joined them: ${v.pop} people of another kind, come to live by their hearth.`, 'shore', shoreWhen(s));
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The chief walks somewhere (on the island). */
export function walkChief(state: GameState, to: Pt): void {
  const s = shoreOf(state);
  if (!s) return;
  s.chiefTo = { x: Math.max(2, Math.min(SHORE_N - 3, to.x)), y: Math.max(2, Math.min(SHORE_N - 3, to.y)) };
}

export function chiefOf(s: ShoreState): ShorePerson | undefined {
  return s.people.find((p) => p.id === s.chief);
}

/** Advances New Shore by `dt` seconds (in steps, so offline time works the same). */
export function shoreTick(state: GameState, dt: number): void {
  const s = shoreOf(state);
  if (!s) return;
  let left = dt;
  while (left > 0) {
    const step = Math.min(left, 2);
    left -= step;
    stepShore(state, s, step);
  }
}

function stepShore(state: GameState, s: ShoreState, dt: number): void {
  const k = dt / DAY_SEC;
  // The day's work comes in as it's done, and is eaten as it goes.
  const plan = workPlan(s);
  s.food = Math.min(foodCap(s), s.food + (plan.foodRate - plan.eat) * k);
  s.wood = Math.min(woodCap(s), s.wood + plan.woodRate * k);
  if (s.food < 0) s.food = 0;
  s.clock += dt;
  if (s.clock >= DAY_SEC) {
    s.clock -= DAY_SEC;
    s.day++;
    dawn(state, s, plan);
  }
  // Children: where there's a fire, room, food to spare, and grown pairs.
  const adults = s.people.filter((p) => isAdult(s, p)).length;
  if (count(s, 'hearth') && s.people.length < room(s) && s.food >= BIRTH_FOOD && adults >= 2) {
    s.birthT += Math.floor(adults / 2) * PAIR_RATE * (1 + boosts(s).births) * k;
    if (s.birthT >= 1) {
      s.birthT = 0;
      s.food -= BIRTH_FOOD;
      born(state, s);
    }
  }
  if (s.building) {
    s.building.left -= dt;
    if (s.building.left <= 0) finishBuilding(state, s);
  }
  walk(state, s, dt);
  stepVassals(state, s, k);
  // Won over and waiting: with no answer, they wait for room; once there's room, they come; kept
  // waiting too long, they give up on you.
  const today = s.day + s.clock / DAY_SEC;
  for (const v of s.villages) {
    if (v.asking !== undefined && today - v.asking > ASK_DAYS) answerJoin(state, v.id, 'wait');
    if (v.waiting === undefined) continue;
    if (roomLeft(s) >= v.pop) {
      v.waiting = undefined;
      join(state, s, v);
    } else if (today - v.waiting > WAIT_DAYS) {
      v.waiting = undefined;
      v.trust = 60;
      s.news.push(`${cap(v.name)} grew tired of waiting.`);
      record(state, `${cap(v.name)} grew tired of waiting for room, and trust you less for it.`, 'shore', shoreWhen(s));
    }
  }
  // Trust grows by itself where the chief stays a while, and (for grazers) as kin drift in.
  for (const v of s.villages) {
    if (!canWin(s, v)) continue;
    const per = (chiefNear(s, v) ? VISIT_TRUST : 0) + (s.look.diet === 'grazer' ? WELCOME_TRUST : 0);
    if (per) addTrust(state, s, v, per * k);
  }
}

function born(state: GameState, s: ShoreState): void {
  const rand = rng(s.seed * 7 + s.nextId * 131);
  const used = new Set(s.people.map((p) => p.name));
  let name = nameFrom(rand);
  for (let i = 0; i < 10 && used.has(name); i++) name = nameFrom(rand);
  const today = s.day + s.clock / DAY_SEC;
  // The child is of one of the grown ones' kinds (as the village mixes, so do its children).
  const grown = s.people.filter((p) => isAdult(s, p));
  const parent = grown[Math.floor(rand() * grown.length)];
  s.people.push({ id: s.nextId++, name, born: today, dies: today + 70 + rand() * 30, kind: parent?.kind });
  s.births++;
  if (s.firstBirth === undefined) {
    s.firstBirth = s.day;
    s.news.push(SHORE_STORY.firstBorn);
    record(state, `${name} was born: the first born on the new shore.`, 'shore', shoreWhen(s));
    // The four begin to grow old now (the line goes on): a while apart, not all at once.
    s.people.filter((p) => p.founder).forEach((p, i) => (p.dies = s.day + 16 + i * 8 + rand() * 5));
  } else s.news.push(`${name} was born.`);
}

function dawn(state: GameState, s: ShoreState, plan: ReturnType<typeof workPlan>): void {
  // Old age.
  for (const p of [...s.people]) {
    if (p.dies === undefined || s.day < p.dies) continue;
    die(state, s, p, 'old age');
  }
  // Hunger: a day with no food and not enough coming in. After a couple, the weakest begin to
  // die, more the shorter the food is (a village far bigger than its fields starves fast).
  if (s.food < 0.5 && plan.foodRate < plan.eat) {
    s.hungry++;
    if (s.hungry >= 2 && s.people.length > 2) {
      const short = 1 - plan.foodRate / plan.eat;
      const n = Math.max(1, Math.round(s.people.length * short * 0.15));
      const weakest = [...s.people].filter((p) => p.id !== s.chief).sort((a, b) => Number(!!b.founder) - Number(!!a.founder) || a.born - b.born);
      for (const p of weakest.slice(0, n)) die(state, s, p, 'hunger');
    }
  } else s.hungry = 0;
}

function die(state: GameState, s: ShoreState, p: ShorePerson, why: 'old age' | 'hunger'): void {
  s.people = s.people.filter((q) => q !== p);
  s.deaths++;
  // Buried a little way out from the hearth, together.
  const n = s.graves.length;
  const a = 2.4 + (n % 7) * 0.18;
  s.graves.push({ x: s.hearth.x + Math.cos(a) * (13 + Math.floor(n / 7) * 1.6) + (n % 7) * 1.1, y: s.hearth.y + Math.sin(a) * 9 + Math.floor(n / 7) * 1.4 });
  if (p.founder) {
    const left = s.people.filter((q) => q.founder).length;
    const line = left ? SHORE_STORY.founderDies.replace('{name}', p.name) : SHORE_STORY.lastFounder;
    s.news.push(line);
    record(state, `${p.name}, one of the four who crossed, died of old age.${left ? '' : ' The last of them.'}`, 'shore', shoreWhen(s));
  } else {
    s.news.push(why === 'hunger' ? `${p.name} died of hunger.` : `${p.name} died of old age.`);
    if (why === 'hunger') record(state, `${p.name} died of hunger.`, 'shore', shoreWhen(s));
  }
  if (p.id === s.chief) {
    // The heir: the eldest of the four left, else the eldest grown.
    const heir = [...s.people].filter((q) => q.founder || isAdult(s, q)).sort((a, b) => Number(!!b.founder) - Number(!!a.founder) || a.born - b.born)[0] ?? s.people[0];
    if (heir) {
      s.chief = heir.id;
      s.news.push(`${heir.name} leads them now.`);
      record(state, `${heir.name} became chief.`, 'shore', shoreWhen(s));
    }
  }
}

/** The chief's walk: straight toward where they're going, round water where it can; what's
 * near them is seen, and villages they come in sight of are found. */
/** A step toward `to`: straight on if it's land, else edging along the shore. Null if there's
 * no way on from here. */
function stepToward(is: Island, at: Pt, to: Pt, speed: number, dt: number): Pt | null {
  const dx = to.x - at.x;
  const dy = to.y - at.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.3) return { ...to };
  const stepLen = Math.min(d, speed * dt);
  const ux = dx / d;
  const uy = dy / d;
  for (const t of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const nx = at.x + (ux * c - uy * sn) * stepLen;
    const ny = at.y + (ux * sn + uy * c) * stepLen;
    if (isLand(is, nx, ny)) return { x: nx, y: ny };
  }
  return null;
}

/** Where a scout heads next: the nearest unseen land a fair way off (else the smoke of a camp
 * not yet found, else anywhere). Seeded by the scout and the day, so offline runs the same. */
function scoutGoal(s: ShoreState, seen: Uint8Array, is: Island, sc: Scout, k: number): Pt {
  const rand = rng(s.seed * 31 + s.day * 7 + k * 101 + Math.floor(sc.at.x) * 3);
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 80; i++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 130;
    const x = sc.at.x + Math.cos(a) * r;
    const y = sc.at.y + Math.sin(a) * r;
    if (!isLand(is, x, y) || seen[Math.floor(y / CELL) * SHORE_CELLS + Math.floor(x / CELL)]) continue;
    const d = Math.hypot(x - sc.at.x, y - sc.at.y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  if (best) return best;
  const v = s.villages.filter((x) => !x.found).sort((a, b) => Math.hypot(a.x - sc.at.x, a.y - sc.at.y) - Math.hypot(b.x - sc.at.x, b.y - sc.at.y))[0];
  return v ? { x: v.x, y: v.y } : { x: s.hearth.x + (rand() - 0.5) * 200, y: s.hearth.y + (rand() - 0.5) * 200 };
}

function walk(state: GameState, s: ShoreState, dt: number): void {
  const is = shoreIsland(s.seed);
  const seen = state.stages.shore.seen;
  const bo = boosts(s);
  if (s.chiefTo) {
    const next = stepToward(is, s.chiefAt, s.chiefTo, CHIEF_SPEED * (1 + bo.speed), dt);
    if (!next || Math.hypot(next.x - s.chiefTo.x, next.y - s.chiefTo.y) < 0.3) s.chiefTo = null;
    if (next) s.chiefAt = next;
  }
  if (seen.length !== SHORE_CELLS * SHORE_CELLS) return;
  reveal(is, seen, s.chiefAt.x, s.chiefAt.y, CHIEF_SIGHT + bo.sight);
  // A lookout shows the land round the village.
  if (bo.watch && (s.watched ?? 0) < bo.watch) {
    s.watched = bo.watch;
    reveal(is, seen, s.hearth.x, s.hearth.y, HOME_SIGHT + bo.watch);
  }
  // Scouts: one for each scout's hut, out in the fog on their own.
  // (Two at most, even where an older save built more huts.)
  const huts = Math.min(2, count(s, 'scout'));
  s.scouts ??= [];
  if (s.scouts.length > huts) s.scouts.length = huts;
  while (s.scouts.length < huts) s.scouts.push({ at: { ...s.hearth }, to: null, left: 0 });
  s.scouts.forEach((sc, k) => {
    if (!sc.to || sc.left <= 0) {
      sc.to = scoutGoal(s, seen, is, sc, k);
      sc.left = Math.hypot(sc.to.x - sc.at.x, sc.to.y - sc.at.y) / SCOUT_SPEED * 2 + 5;
    }
    sc.left -= dt;
    const next = stepToward(is, sc.at, sc.to, SCOUT_SPEED * (1 + bo.speed), dt);
    if (!next || Math.hypot(next.x - sc.to.x, next.y - sc.to.y) < 0.5) sc.to = null;
    if (next) sc.at = next;
    reveal(is, seen, sc.at.x, sc.at.y, SCOUT_SIGHT + bo.sight);
  });
  for (const v of s.villages) {
    if (v.found) continue;
    const c = Math.floor(v.y / CELL) * SHORE_CELLS + Math.floor(v.x / CELL);
    if (!seen[c]) continue;
    v.found = true;
    if (relation(s, v) === 'kin') v.trust ??= FIRST_TRUST;
    s.newFinds.push(v.id);
    record(state, `They found ${v.name}: ${v.pop} of them, ${v.cannibal ? 'eaters of their own kind' : `${v.diet}s`}.`, 'shore', shoreWhen(s));
  }
  // Landmarks come out of the fog as it's seen (by the chief or the scouts), quietly: nothing
  // says so. Only once you've noticed one (tapped it, or the chief's been by it) is it known.
  for (const p of poisOf(s)) {
    if (!p.found && seen[Math.floor(p.y / CELL) * SHORE_CELLS + Math.floor(p.x / CELL)]) p.found = true;
    if (p.found && !p.known && Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y) < 10) p.known = true;
  }
  explore(state, s, dt);
}

// ---- Landmarks ----

/** How near the chief must be to a landmark to explore it (tiles). */
export const EXPLORE_NEAR = 5;

export function poiDef(p: Poi): (typeof POIS)[number] {
  return POIS.find((d) => d.id === p.kind)!;
}
export function poiName(p: Poi): string {
  return poiDef(p).name;
}

/** The island's landmarks, each on its own kind of ground and spread out (placed once). */
export function poisOf(s: ShoreState): Poi[] {
  if (s.pois) return s.pois;
  const is = shoreIsland(s.seed);
  const N = is.n;
  const rand = rng(s.seed * 41 + 3);
  const at = (x: number, y: number) => is.biome[Math.round(y) * N + Math.round(x)];
  const fits: Record<string, (b: number) => boolean> = {
    sand: (b) => b === Biome.Sand,
    grass: (b) => b === Biome.Grass,
    forest: (b) => b === Biome.Forest,
    high: (b) => b === Biome.High,
    rock: (b) => b === Biome.Rock,
  };
  const taken: Pt[] = [s.hearth, ...s.villages];
  const out: Poi[] = [];
  for (const def of POIS) {
    for (let n = 0; n < def.count; n++) {
      for (let tries = 0; tries < 2000; tries++) {
        const x = 8 + rand() * (N - 16);
        const y = 8 + rand() * (N - 16);
        if (!fits[def.ground](at(x, y))) continue;
        // (Not right on top of anything else; if the island's crowded, a little closer.)
        const gap = tries < 1500 ? 40 : 15;
        if (taken.some((t) => Math.hypot(t.x - x, t.y - y) < gap)) continue;
        out.push({ id: out.length, kind: def.id, x: Math.round(x), y: Math.round(y), found: false, done: 0, t: 0 });
        taken.push({ x, y });
        break;
      }
    }
  }
  s.pois = out;
  return out;
}

/** The landmark the chief is at (one with more to find), if any. */
export function poiHere(s: ShoreState): Poi | undefined {
  if (s.chiefTo) return undefined;
  return poisOf(s).find((p) => p.found && p.done < poiDef(p).layers.length && Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y) < EXPLORE_NEAR);
}

/** Exploring: while the chief stays at a landmark, its next layer gives up what it holds. */
function explore(state: GameState, s: ShoreState, dt: number): void {
  const p = poiHere(s);
  if (!p) return;
  const layer = poiDef(p).layers[p.done];
  p.t += dt;
  if (p.t < layer.sec) return;
  p.t = 0;
  p.done++;
  const f = layer.find;
  // A relic or know-how they already have is no use twice: what's there is taken as wood.
  const dup = (f.relic && s.relics?.includes(f.relic)) || (f.learn && s.learned?.includes(f.learn));
  if (dup) s.wood = Math.min(woodCap(s), s.wood + 30);
  else {
    if (f.relic) (s.relics ??= []).push(f.relic);
    if (f.learn) (s.learned ??= []).push(f.learn);
    if (f.food) s.food = Math.min(foodCap(s), s.food + f.food);
    if (f.wood) s.wood = Math.min(woodCap(s), s.wood + f.wood);
  }
  (s.finds ??= []).push({ poi: p.id, find: f, dup: !!dup });
  record(state, `At the ${poiName(p).toLowerCase()}: ${f.text.replace('[STORY] ', '')}`, 'shore', shoreWhen(s));
}

export function relicName(id: RelicId): string {
  return RELICS.find((r) => r.id === id)!.name;
}

export { buildName };
