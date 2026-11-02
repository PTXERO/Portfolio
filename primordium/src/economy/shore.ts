// New Shore, Phase 1: settling. The four found a village around a hearth on a big, fogged
// island, and grow it toward a hundred. The village gathers food and wood by itself (you set
// what it leans toward), lays out what you choose to build around the hearth, and has children
// where there's a fire, room and food to spare. The four grow old and die once the line goes
// on. The chief (one of the four, then their heirs) walks the island, and the fog draws back;
// out there are other villages, other kinds (see docs/new-shore.md).
//
// Time is counted in days (DAY_SEC each). Everything runs offline too.

import { buildName, POIS, RELICS, SHORE_STORY, type Boosts, type BuildId, type Find, type PoiKind, type RelicId } from '../content/shore';
import { record, recordName } from './chronicle';
import { Biome, CELL, isLand, islandOf, reveal, type Island, type Pt } from './island';
import { generateTerrain, TERRAIN_V, type Terrain } from './terrain';
import { findPath } from './paths';
import { inherit, personal } from './genes';
import { ageOver, cultureDay, cultureFx, maybeTurn, workReady, type Culture } from './culture';
import { GENS, PERKS, UPGRADES, WORKS, type GenId, type PerkId } from '../content/idle';
import type { CreatureLook } from '../scene/creatureLook';
import type { GameState, Genes, TribeState } from './types';

/** Tiles across New Shore's island: eight times the area of the spear's. */
export const SHORE_N = 1020;
export const SHORE_CELLS = SHORE_N / CELL;
/** Seconds in a day. */
export const DAY_SEC = 120;
/** Days in a season (the year is four, from the spring they landed in). */
export const SEASON_DAYS = 4;
/** Days a child takes to grow up (and start working). */
export const GROW_DAYS = 10;
/** The most one hearth holds: past this the land round it feeds no more, and the village grows
 * only in its settlements. */
export const HEARTH_MOST = 150;

/** The heart of the village, as the Ages go on: each Age's Great Work raises it, and it holds
 * twice as many. (Those to come are named, to be built in their Ages.) */
export const CENTRES: { id: BuildId | null; name: string; most: number; age: number }[] = [
  { id: 'hearth', name: 'The Hearth', most: HEARTH_MOST, age: 1 },
  { id: 'greathearth', name: 'The Great Hearth', most: 300, age: 1 },
  { id: 'square', name: 'The Town Square', most: 600, age: 2 },
  { id: null, name: 'The City Centre', most: 1200, age: 3 },
];

/** What the heart of the village is now, and what it'll be next. */
export function centre(s: ShoreState): { now: (typeof CENTRES)[number]; next?: (typeof CENTRES)[number] } {
  let i = 0;
  for (let k = 1; k < CENTRES.length; k++) if (CENTRES[k].id && count(s, CENTRES[k].id!)) i = k;
  return { now: CENTRES[i], next: CENTRES[i + 1] };
}

/** The most the village round the hearth holds now. */
export function hearthMost(s: ShoreState): number {
  return centre(s).now.most;
}
const PAIR_RATE = 0.12;
/** Room before any huts (under the raft's planks). */
const BASE_ROOM = 4;
/** How far the chief sees, and walks in a second (tiles). */
export const CHIEF_SIGHT = 16;
/** A steady walk for a creature their size (about a body length a second). */
const CHIEF_SPEED = 2;
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
  /** Their coat: from their parents (the four, from the line). */
  genes?: Genes;
  /** Their mother and father (ids), if born here. */
  parents?: [number, number?];
  /** Moved away to live in a vassal village (its name), and when. */
  moved?: string;
  movedOn?: number;
  /** Dead: the day they died, and of what. */
  died?: number;
  cause?: string;
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
  /** Whether you've ever brought them a gift. */
  gifted?: boolean;
  /** Where they live (shapes their name, their kind, their huts). */
  habitat?: Habitat;
  /** Seen by the chief (or the village's own lookouts). */
  found: boolean;
  /** Kin only: how far they've been won over (0 to 100), and whether they've joined you. */
  trust?: number;
  /** Critters who've moved between them and the hearth, either way (ties of family). */
  ties?: number;
  /** Told already that the rest would come, if there were room. */
  wouldCome?: boolean;
  /** Danced with: when last, and how worn out they were then (they rest it off over a season). */
  danced?: { day: number; got: number; worn?: boolean };
  /** Won for good (since this day): kin won over, or others beaten. Their village stays, under
   * your flag, and everything brings in more for it. */
  won?: number;
  /** (Older saves, before the idle way: joined, a settlement, a vassal, an outpost. All are won,
   * now; read once, to convert.) */
  joined?: boolean;
  settled?: number;
  vassal?: unknown;
  outpost?: number;
  /** Turned away: gone from the island's map (to the village they went to, that day). */
  gone?: { to: number; day: number };
}

export interface Scout {
  at: Pt;
  to: Pt | null;
  /** The way there (round water), the next point first. */
  path?: Pt[];
  /** Seconds before giving up on where they're headed (stuck behind water, say). */
  left: number;
  /** Seconds resting before setting out again. */
  rest?: number;
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
  /** Food: everything's bought with it. */
  food: number;
  /** Food ever brought in (for the record, and what's shown next). */
  earned?: number;
  /** Embers carried from island to island (each one: all food +EMBER_MORE, for good), and how
   * many crossings they've made since the first shore. */
  embers?: number;
  crossings?: number;
  /** Embers spent in the ember shop (the rest are there to spend), and what they bought. */
  embersSpent?: number;
  perks?: Partial<Record<PerkId, number>>;
  /** What's been bought that brings food in or houses critters; and the upgrades, for good. */
  gens: Partial<Record<GenId, number>>;
  ups: string[];
  /** The council buying by itself (once there's a council). */
  auto?: boolean;
  /** A boost going (the fire danced up): everything brings in this much more, till then (seconds
   * of the island's clock, as day * DAY_SEC + clock). */
  boost?: { mult: number; until: number };
  /** How hot the hearth is, 0 to 1 (worked out from the fuel on it: see fireHeat). A hot fire
   * cooks more of what's brought in (everything, up to fireMost more). */
  heat?: number;
  /** Older saves given the features that used to be free (see keepFeatures). */
  featuresKept?: boolean;
  /** What's been piled on the fire: every stoke adds some, and it burns away by itself. */
  fuel?: number;
  people: ShorePerson[];
  nextId: number;
  births: number;
  deaths: number;
  /** The day the first child was born (the four start growing old then). */
  firstBirth?: number;
  /** Toward the next birth (one at 1). */
  birthT: number;
  /** What stands on the map, in the order it went up, and where (laid out round the hearth). */
  built: { id: BuildId; x: number; y: number; day: number }[];
  graves: Pt[];
  /** Where the hearth is (the village's heart), and the beach they came ashore on. */
  hearth: Pt;
  beach: Pt;
  /** Who leads (a person's id), where they are and where they're walking. */
  chief: number;
  chiefAt: Pt;
  chiefTo: Pt | null;
  /** The way there (round lakes and along shores), the next point first. */
  chiefPath?: Pt[];
  /** The look and diet the line carries, and whether they eat their own. */
  look: CreatureLook;
  cannibal: boolean;
  villages: Village[];
  /** A new Age begun, not yet shown (its card). */
  agesNew?: number[];
  /** Everyone who's died, remembered (for the family trees). */
  dead?: ShorePerson[];
  /** The culture, once the village has turned (and whether the turn's yet to be shown). */
  culture?: Culture;
  turned?: boolean;
  /** Lakes seen across (by their number): seen from any shore, the whole lake is. */
  lakes?: number[];
  /** Things the Chronicle has already told of, so it tells them once. */
  told?: string[];
  /** The last day the envoy took a gift. */
  envoyDay?: number;
  /** Whether the raft they came on has been broken up (the hearth lit from it). */
  raftTaken?: boolean;
  /** Scouts out exploring (once there are scouts). */
  scouts?: Scout[];
  /** The island's landmarks (placed the first time they're needed), the relics found at them,
   * and what's been found since the interface last looked. */
  pois?: Poi[];
  relics?: RelicId[];
  learned?: BuildId[];
  finds?: { poi: number; find: Find; dup?: boolean }[];
  /** How far round the village it's been seen. */
  watched?: number;
  /** Things the interface should show (and clear): births, deaths, finds. */
  news: string[];
  /** Ids of villages found since the interface last looked. */
  newFinds: number[];
}

// ---- The world ----

export function rng(seed: number): () => number {
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
export function nameFrom(rand: () => number): string {
  const n = 2 + (rand() < 0.25 ? 1 : 0);
  const s = Array.from({ length: n }, () => SYL[Math.floor(rand() * SYL.length)]).join('');
  return s[0].toUpperCase() + s.slice(1);
}

/** Where a village lives, which shapes everything about it: its name, its kind's body and
 * colours, and its huts. */
export type Habitat = 'river' | 'lake' | 'desert' | 'scrub' | 'forest' | 'meadow' | 'mountain' | 'coast' | 'marsh';

interface HabitatDef {
  /** Names: `the {word}folk`, `the {word} critters`, `the {word} clan`. */
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
export const CHAIN = ['hunter', 'omnivore', 'grazer'];

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
    for (let tries = 0; tries < 3000 && valid < 60; tries++) {
      const a = rand() * Math.PI * 2;
      // (The first near the beach, the smoke they saw; the rest anywhere on the island, every
      // spot as likely as any other, out to the far coasts.)
      const q =
        i === 0
          ? { x: Math.round(hearth.x + Math.cos(a) * (50 + rand() * 25)), y: Math.round(hearth.y + Math.sin(a) * (50 + rand() * 25)) }
          : { x: Math.round(12 + rand() * (N - 24)), y: Math.round(12 + rand() * (N - 24)) };
      if (q.x < 12 || q.y < 12 || q.x > N - 12 || q.y > N - 12 || !fine(q.x, q.y)) continue;
      const gap = i === 0 ? 30 : Math.max(60, 140 - tries / 12);
      if (taken.some((t) => Math.hypot(t.x - q.x, t.y - q.y) < gap)) continue;
      valid++;
      const h = habitatAt(is, q.x, q.y);
      // (A place already settled by another village is less likely again: the island's kinds vary.)
      // (And the further from everyone else the better: spread over the whole island, not
      // huddled in the middle.)
      const apart = Math.min(...taken.map((t) => Math.hypot(t.x - q.x, t.y - q.y)));
      const spread = i === 0 ? 0 : Math.min(6, (apart / (N * 0.2)) * 4);
      const score = (HABITATS[h].likes[p.diet] ?? 1) - 1.3 * villages.filter((v) => v.habitat === h).length + rand() * 1.2 + spread;
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
      name = pick([`the ${word}folk`, `the ${word} clan`, `the ${word} critters`]);
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
  const look: CreatureLook = { parts: { ...tribe.look.parts }, diet: tribe.look.diet, ...(tribe.look.genes ? { genes: tribe.look.genes } : {}) };
  const cannibal = !!tribe.cannibal;
  const w = shoreWorld(seed, look, cannibal);
  const rand = rng(seed + 99);
  // (Four crossed the first time; a bigger raft, later, carries more.)
  const four = (tribe.family?.length ? tribe.family : [0, 1, 2, 3].map(() => ({ name: nameFrom(rand), trait: 'hardy' }))).slice(0, 8);
  const people: ShorePerson[] = four.map((p, i) => ({ id: i, name: p.name, trait: p.trait, born: -20, founder: true, genes: ('genes' in p ? (p.genes as Genes | undefined) : undefined) ?? personal(tribe.look.genes, i + 1) }));
  return {
    seed,
    terrain: TERRAIN_V,
    day: 0,
    clock: 0,
    // Next to nothing: what they had went in the crossing (a little, to send the first out
    // foraging). The raft's on the beach, and its wood is the hearth.
    food: 10,
    gens: {},
    ups: [],
    people,
    nextId: people.length,
    births: 0,
    deaths: 0,
    birthT: 0,
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
    featuresKept: true,
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

/** How many of something there are: generators bought, the hearth lit, a Great Work raised. */
export function count(s: ShoreState, id: BuildId | GenId): number {
  if (GENS.some((g) => g.id === id)) return s.gens[id as GenId] ?? 0;
  if (id === 'hearth') return s.raftTaken ? 1 : 0;
  return s.ups.includes(id) ? 1 : 0;
}

/** How grown they are, 0 (just born) to 1 (grown up). */
export function growth(s: ShoreState, p: ShorePerson): number {
  const today = s.day + s.clock / DAY_SEC;
  return Math.min(1, Math.max(0, (today - p.born) / (GROW_DAYS / (1 + boosts(s).grow))));
}
export function isAdult(s: ShoreState, p: ShorePerson): boolean {
  return p.born <= adultCut(s);
}

/** Born on or before this day, they're grown (worked out once a moment, not once a person). */
const cutCache = new WeakMap<ShoreState, { t: number; g: number; cut: number }>();
function adultCut(s: ShoreState): number {
  const t = s.day * DAY_SEC + s.clock;
  const g = boosts(s).grow;
  const hit = cutCache.get(s);
  if (hit && hit.t === t && hit.g === g) return hit.cut;
  const cut = t / DAY_SEC - GROW_DAYS / (1 + g);
  cutCache.set(s, { t, g, cut });
  return cut;
}

/** How many are grown (counted once a moment). */
const grownCache = new WeakMap<ShoreState, { t: number; n: number; people: ShorePerson[]; grown: number }>();
export function grownCount(s: ShoreState): number {
  const t = s.day * DAY_SEC + s.clock;
  const hit = grownCache.get(s);
  if (hit && hit.t === t && hit.n === s.people.length && hit.people === s.people) return hit.grown;
  const cut = adultCut(s);
  let grown = 0;
  for (const p of s.people) if (p.born <= cut) grown++;
  grownCache.set(s, { t, n: s.people.length, people: s.people, grown });
  return grown;
}

const NO_BOOSTS: Boosts = { food: 0, tap: 0, births: 0, grow: 0, speed: 0, sight: 0, gift: 0 };
const boostCache = new WeakMap<ShoreState, { k: [number, number, number]; b: Boosts }>();

/** What the relics and the culture add up to (worked out again only when either changes). */
export function boosts(s: ShoreState): Boosts {
  const relics = s.relics?.length ?? 0;
  const ideas = s.culture?.done.length ?? 0;
  const forks = s.culture ? Object.keys(s.culture.forks).length : 0;
  const hit = boostCache.get(s);
  if (hit && hit.k[0] === relics && hit.k[1] === ideas && hit.k[2] === forks) return hit.b;
  const b = { ...NO_BOOSTS };
  const add = (fx: Partial<Boosts> | undefined) => {
    for (const k of Object.keys(fx ?? {}) as (keyof Boosts)[]) b[k] += fx![k] ?? 0;
  };
  for (const r of s.relics ?? []) add(RELICS.find((x) => x.id === r)?.fx);
  for (const fx of cultureFx(s)) add(fx);
  boostCache.set(s, { k: [relics, ideas, forks], b });
  return b;
}

/** The season now (0 spring, 1 summer, 2 autumn, 3 winter) and how far into it (0 to 1). */
export function shoreSeason(s: Pick<ShoreState, 'day' | 'clock'>): { si: number; into: number } {
  const y = ((s.day + s.clock / DAY_SEC) / SEASON_DAYS) % 4;
  return { si: Math.floor(y), into: y % 1 };
}

// ---- Food: what's bought with it, and what it buys ----

/** Beds: under the raft's planks at first, then what's been built. */
export function room(s: ShoreState): number {
  return BASE_ROOM + GENS.reduce((n, g) => n + (g.room ?? 0) * count(s, g.id), 0);
}

/** Every critter of yours. */
export function totalCritters(s: ShoreState): number {
  return s.people.length;
}

/** What one more of a generator costs (and so many more, together). */
export function genCost(s: ShoreState, id: GenId, n = 1): number {
  const g = GENS.find((x) => x.id === id)!;
  const have = count(s, id);
  // (A geometric run: first * growth^have * (growth^n - 1) / (growth - 1).)
  return Math.ceil((g.cost * Math.pow(g.growth, have) * (Math.pow(g.growth, n) - 1)) / (g.growth - 1));
}
/** As many as the food will buy now. */
export function maxBuy(s: ShoreState, id: GenId): number {
  let n = 0;
  while (n < 1000 && genCost(s, id, n + 1) <= s.food) n++;
  return n;
}
/** Whether a generator's on offer yet (the island opens up as the critters grow). */
export function genOpen(s: ShoreState, id: GenId): boolean {
  const g = GENS.find((x) => x.id === id)!;
  return !!s.raftTaken && (g.critters === undefined || totalCritters(s) >= g.critters || count(s, id) > 0);
}

/** Buy so many of a generator (as many as there's food for, up to that). Returns how many. */
export function buyGen(state: GameState, id: GenId, n = 1): number {
  const s = shoreOf(state);
  if (!s || !genOpen(s, id)) return 0;
  n = Math.min(n, maxBuy(s, id));
  if (n <= 0) return 0;
  s.food -= genCost(s, id, n);
  const before = count(s, id);
  s.gens[id] = before + n;
  const g = GENS.find((x) => x.id === id)!;
  if (!before) record(state, `The first ${g.name.toLowerCase().replace(/s$/, '')}${g.id === 'forager' ? '' : ''}: ${g.does}`, 'shore', shoreWhen(s));
  // Some of them stand on the map (not every one: a dozen of each at most, so it doesn't fill).
  if (g.shows) {
    const is = shoreIsland(s.seed);
    const shown = s.built.filter((b) => b.id === g.shows).length;
    for (let k = 0; k < n && shown + k < SHOWN_MOST; k++) s.built.push({ id: g.shows, ...placeFor(s, g.shows, is), day: s.day });
  }
  return n;
}
/** How many of each kind of building stand on the map at most. */
const SHOWN_MOST = 12;

/** Whether an upgrade's on offer (its generator's far enough on, the village big enough). */
export function upgradeOpen(s: ShoreState, id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || s.ups.includes(id) || !s.raftTaken) return false;
  if (u.needGen && count(s, u.needGen[0]) < u.needGen[1]) return false;
  return u.critters === undefined || totalCritters(s) >= u.critters;
}
export function buyUpgrade(state: GameState, id: string): boolean {
  const s = shoreOf(state);
  const u = UPGRADES.find((x) => x.id === id);
  if (!s || !u || !upgradeOpen(s, id) || s.food < u.cost) return false;
  s.food -= u.cost;
  s.ups.push(id);
  if (u.fx.kind === 'auto') s.auto = true;
  record(state, `${u.name}. ${u.does}`, 'shore', shoreWhen(s));
  return true;
}
export function has(s: ShoreState, id: string): boolean {
  return s.ups.includes(id);
}

/** Everything that multiplies what comes in: the upgrades, the culture and the relics, the
 * villages won, every critter, and the fire danced up. */
export function allMult(s: ShoreState): number {
  let m = 1;
  for (const id of s.ups) {
    const u = UPGRADES.find((x) => x.id === id);
    if (u?.fx.kind === 'all') m *= u.fx.mult;
  }
  const won = s.villages.filter((v) => v.won !== undefined).length;
  const now = s.day * DAY_SEC + s.clock;
  return m * (1 + (s.embers ?? 0) * EMBER_MORE) * (1 + boosts(s).food) * (1 + won * WON_MORE) * (1 + totalCritters(s) * CRITTER_MORE) * (s.boost && s.boost.until > now ? s.boost.mult : 1) * (1 + fireMore(s));
}
/** The fire at its hottest, before any upgrades: everything brings in this much more. */
export const FIRE_MOST = 1;
/** The fire's heat goes with the log of the fuel on it: the first few stokes count for a lot,
 * each one after for less, and it's roaring (full heat) at FIRE_FULL fuel. */
export const FIRE_FULL = 150;
/** The fuel burns away: this share of it a second, and a little more (so it does go out). */
export const FIRE_BURN = 0.04;
export const FIRE_BURN_MIN = 0.05;
function fireFx(s: ShoreState): { most: number; fuel: number; cool: number; floor: number } {
  const f = { most: FIRE_MOST + 0.5 * perk(s, 'coals'), fuel: 1, cool: 1, floor: 0 };
  for (const id of s.ups) {
    const fx = UPGRADES.find((x) => x.id === id)?.fx;
    if (fx?.kind === 'fire') f.most += fx.more;
    if (fx?.kind === 'fireFuel') f.fuel *= fx.mult;
    if (fx?.kind === 'fireCool') f.cool *= fx.mult;
    if (fx?.kind === 'fireFloor') f.floor = Math.max(f.floor, fx.floor);
  }
  return f;
}
/** The most the fire can add to everything (it grows with the fire upgrades). */
export function fireMost(s: ShoreState): number {
  return fireFx(s).most;
}
/** How hot the fire is, 0 to 1, from the fuel on it (never under the banked embers' floor). */
export function fireHeat(s: ShoreState): number {
  const h = Math.log1p(Math.max(0, s.fuel ?? 0)) / Math.log1p(FIRE_FULL);
  return Math.min(1, Math.max(fireFx(s).floor, h));
}
/** What the fire's heat adds to everything just now. */
export function fireMore(s: ShoreState): number {
  return fireMost(s) * Math.min(1, Math.max(0, s.heat ?? 0));
}
// ---- Setting out ----

/** Each ember: all food this much more, on every island after. */
export const EMBER_MORE = 0.1;
/** ...and births this much more (an island's settled by critters as much as food). */
export const EMBER_BIRTHS = 0.05;
/** What a whole island's food is worth in embers (the cube root: waiting longer brings more, but
 * less and less: better to set out than to sit). */
export function embersFor(s: ShoreState): number {
  return Math.floor(Math.cbrt((s.earned ?? 0) / 1e9));
}
/** A perk's level (what's been bought with embers). */
export function perk(s: ShoreState, id: PerkId): number {
  return s.perks?.[id] ?? 0;
}
/** Embers there to spend (every ember brought, less those spent). */
export function embersLeft(s: ShoreState): number {
  return (s.embers ?? 0) - (s.embersSpent ?? 0);
}
/** The next level of a perk: its cost in embers (null once it's as high as it goes). */
export function perkCost(s: ShoreState, id: PerkId): number | null {
  const p = PERKS.find((x) => x.id === id)!;
  const lv = perk(s, id);
  return lv >= p.most ? null : Math.round(p.cost * p.growth ** lv);
}
export function buyPerkOk(s: ShoreState, id: PerkId): boolean {
  const cost = perkCost(s, id);
  return cost !== null && embersLeft(s) >= cost;
}
export function buyPerk(state: GameState, id: PerkId): boolean {
  const s = shoreOf(state);
  const cost = s && perkCost(s, id);
  if (!s || cost === null || cost === undefined || embersLeft(s) < cost) return false;
  s.embersSpent = (s.embersSpent ?? 0) + cost;
  (s.perks ??= {})[id] = perk(s, id) + 1;
  // (Charts bought on an island already landed on: every village is known at once.)
  if (id === 'charts') for (const v of s.villages) chart(s, v);
  return true;
}
function chart(s: ShoreState, v: Village): void {
  if (v.found) return;
  v.found = true;
  if (relation(s, v) === 'kin') v.trust ??= FIRST_TRUST;
}

/** Every village won (or gone): the island's settled, and they can set out for another. */
export function canCross(s: ShoreState): boolean {
  return s.villages.length > 0 && s.villages.every((v) => v.won !== undefined || v.gone);
}
/** The next island's seed (a new one each crossing). */
export function nextIslandSeed(s: ShoreState): number {
  return (s.seed * 31 + 7919 * ((s.crossings ?? 0) + 1)) % 2147483647;
}
/** What crosses with them: the embers, and what the village knows how to do (buying ten, the
 * most, the council, the tender, the scouts, the envoy, the lore-keepers). The rest stays. */
const KEPT_ACROSS = new Set(['auto', 'feature', 'scouts', 'envoy']);
/** Setting out: the chief and three of the eldest take a raft to a new island; the rest stay to
 * keep the old one. Everything starts again there but the embers and the know-how. */
export function cross(state: GameState, seed = 0): boolean {
  const s = shoreOf(state);
  const t = state.stages.tribal.tribe;
  if (!s || !t || !canCross(s)) return false;
  const gained = embersFor(s);
  const own = s.people.filter((p) => p.kind === undefined && isAdult(s, p));
  const chief = own.find((p) => p.id === s.chief) ?? own[0];
  const crew = [chief, ...own.filter((p) => p !== chief).sort((a, b) => a.born - b.born).slice(0, 3 + perk(s, 'crew'))].filter(Boolean);
  const island = seed || nextIslandSeed(s);
  const tribe = { ...t, look: { ...t.look, parts: { ...s.look.parts }, diet: s.look.diet }, landed: { ...(t.landed ?? { day: 0 }), seed: island }, family: crew.map((p) => ({ name: p.name, trait: p.trait ?? 'hardy', genes: p.genes })) } as TribeState;
  const next = newShore(tribe);
  next.embers = (s.embers ?? 0) + gained;
  next.crossings = (s.crossings ?? 0) + 1;
  next.embersSpent = s.embersSpent;
  next.perks = s.perks ? { ...s.perks } : undefined;
  next.food = 10 * 10 ** perk(s, 'seed');
  if (perk(s, 'charts')) for (const v of next.villages) chart(next, v);
  next.ups = s.ups.filter((id) => KEPT_ACROSS.has(UPGRADES.find((u) => u.id === id)?.fx.kind ?? ''));
  next.auto = s.auto;
  record(state, `${crew.map((p) => p.name).join(', ')} set out for a new island, with ${gained} ember${gained === 1 ? '' : 's'} from the fire. The rest stayed.`, 'shore', shoreWhen(s));
  const st = state.stages.shore;
  st.shore = next;
  st.seen = new Uint8Array(SHORE_CELLS * SHORE_CELLS);
  reveal(shoreIsland(next.seed), st.seen, next.beach.x, next.beach.y, HOME_SIGHT);
  reveal(shoreIsland(next.seed), st.seen, next.hearth.x, next.hearth.y, HOME_SIGHT);
  poisOf(next);
  return true;
}

/** Each village won, and each critter, adds this much to everything. */
export const WON_MORE = 0.15;
export const CRITTER_MORE = 0.01;

/** Food a second from one kind of generator (all of them together). */
export function genRate(s: ShoreState, id: GenId): number {
  const g = GENS.find((x) => x.id === id)!;
  if (!g.rate) return 0;
  let m = 1;
  for (const uid of s.ups) {
    const u = UPGRADES.find((x) => x.id === uid);
    if (u?.fx.kind === 'gen' && u.fx.gen === id) m *= u.fx.mult;
  }
  return g.rate * count(s, id) * m * 2 ** perk(s, 'trades') * allMult(s);
}
/** Food a second, everything together. */
export function foodRate(s: ShoreState): number {
  return GENS.reduce((n, g) => n + genRate(s, g.id), 0);
}

/** Stoking the fire: a little food straight in (more with the upgrades, and some of every
 * second's worth once the fire-keepers know their work). */
/** Each stoke is worth this many seconds of what comes in, before any upgrades. */
export const TAP_SHARE = 0.25;
export function tapValue(s: ShoreState): number {
  let k = 1;
  let share = 0;
  for (const id of s.ups) {
    const fx = UPGRADES.find((x) => x.id === id)?.fx;
    if (fx?.kind === 'tap') k *= fx.mult;
    if (fx?.kind === 'tapRate') share += fx.share;
  }
  // (Always worth a quarter-second of everything coming in, so tapping matters at every size;
  // the stoking upgrades add whole seconds on top.)
  return (1 + (TAP_SHARE + share) * foodRate(s)) * k * (1 + boosts(s).tap);
}
export function stoke(state: GameState): number {
  const s = shoreOf(state);
  if (!s || !s.raftTaken) return 0;
  const got = tapValue(s);
  s.fuel = Math.min(FIRE_FULL * 1.5, (s.fuel ?? 0) + fireFx(s).fuel);
  s.heat = fireHeat(s);
  s.food += got;
  s.earned = (s.earned ?? 0) + got;
  return got;
}

/** The council's pick: whatever brings most food for its cost (and a home when the beds are
 * nearly full), when there's the food for it. */
export function councilPick(s: ShoreState): GenId | null {
  const open = GENS.filter((g) => genOpen(s, g.id));
  // (Homes when the beds are nearly full, but never before there's anything bringing food in.)
  if (s.people.length >= Math.min(room(s), hearthMost(s)) - 2 && room(s) < hearthMost(s) && foodRate(s) > 0) {
    const home = open.filter((g) => g.room).sort((a, b) => genCost(s, a.id) / a.room! - genCost(s, b.id) / b.room!)[0];
    if (home) return home.id;
  }
  const best = open
    .filter((g) => g.rate)
    .map((g) => ({ g, worth: (genRate(s, g.id) / Math.max(1, count(s, g.id)) || g.rate! * allMult(s)) / genCost(s, g.id) }))
    .sort((a, b) => b.worth - a.worth)[0];
  return best?.g.id ?? null;
}

// ---- The Great Works ----

/** The Great Work this Age, if the culture's ready for it and it isn't raised yet. */
export function workOpen(s: ShoreState): (typeof WORKS)[number] | undefined {
  const w = WORKS.find((x) => x.age === s.culture?.age);
  return w && workReady(s) && !s.ups.includes(w.id) ? w : undefined;
}
export function buyWork(state: GameState): boolean {
  const s = shoreOf(state);
  const w = s && workOpen(s);
  if (!s || !w || s.food < w.cost) return false;
  s.food -= w.cost;
  s.ups.push(w.id);
  s.built.push({ id: w.id, ...placeFor(s, w.id, shoreIsland(s.seed)), day: s.day });
  record(state, `${w.name} was raised. ${w.does}`, 'shore', shoreWhen(s));
  ageOver(state, s);
  return true;
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
      if (s.built.some((b) => Math.hypot(b.x - x, b.y - y) < 2.8) || s.graves.some((g) => Math.hypot(g.x - x, g.y - y) < 2)) continue;
      // Workshops and stores keep out of the huts' rings.
      if (!inner && ring < 3) continue;
      return { x, y };
    }
  }
  return { x: s.hearth.x + 4, y: s.hearth.y + 4 };
}

/** The raft they came on, broken up: its wood lights the hearth (there's no going back now). */
export function takeRaft(state: GameState): boolean {
  const s = shoreOf(state);
  if (!s || s.raftTaken) return false;
  s.raftTaken = true;
  s.built.push({ id: 'hearth', ...s.hearth, day: s.day });
  record(state, 'They broke up the raft that had carried them over the sea, and lit a fire with it.', 'shore', shoreWhen(s));
  record(state, SHORE_STORY.hearth, 'shore', shoreWhen(s));
  return true;
}

/** When something happened, for the Chronicle: the season and the year since they landed. */
export function shoreWhen(s: ShoreState): string {
  const year = Math.floor((s.day + s.clock / DAY_SEC) / (SEASON_DAYS * 4)) + 1;
  return `Year ${year}, ${SEASON_NAMES[shoreSeason(s).si]}`;
}

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

// ---- Older saves ----

/**
 * A New Shore from before the idle way, made over: what was built becomes what's been bought
 * (huts and longhouses, camps and weirs, the granaries and markets; the council, scouts and envoy
 * as upgrades; the Great Works as raised), the gatherers foragers, wood folded into the food, and
 * every village held (joined, settled, a vassal, an outpost) won for good. The critters, the
 * line, the dead, the landmarks and relics, the culture: all kept as they were. (A save already
 * the idle way passes through as it is.)
 */
export function idleShore(raw: ShoreState & Record<string, unknown>): ShoreState {
  if (raw.gens && raw.ups) return keepFeatures(raw);
  const built = (raw.built ?? []) as { id: string }[];
  const n = (id: string) => built.filter((b) => b.id === id).length;
  const gens: Partial<Record<GenId, number>> = {};
  for (const [from, to] of [['hut', 'hut'], ['longhouse', 'longhouse'], ['camp', 'camp'], ['weir', 'weir'], ['granary', 'granary'], ['market', 'market'], ['rack', 'garden'], ['cutter', 'lodge']] as const) {
    if (n(from)) gens[to] = (gens[to] ?? 0) + n(from);
  }
  // (The gatherers they had, as foragers: about half the grown.)
  if (raw.raftTaken || built.length) gens.forager = Math.max(5, Math.round((raw.people?.length ?? 0) / 2));
  const ups: string[] = [];
  if (n('council')) ups.push('council');
  if (n('scout')) ups.push('scouts');
  if (n('envoy')) ups.push('envoy');
  for (const w of WORKS) if (n(w.id)) ups.push(w.id);
  const day = raw.day ?? 0;
  for (const v of raw.villages ?? []) {
    if (v.won === undefined && (v.joined || v.settled !== undefined || v.vassal || v.outpost !== undefined)) v.won = day;
    for (const k of ['settled', 'vassal', 'outpost', 'joined', 'road', 'trade', 'load', 'focus', 'ask', 'askNext', 'thrive', 'sulk', 'stage', 'asking', 'waiting', 'standing', 'demanded', 'paid', 'home', 'overlord', 'ties', 'wouldCome'] as const) delete (v as unknown as Record<string, unknown>)[k];
    // (Driven out: their village is gone, but its land was won.)
  }
  const keep = new Set(['seed', 'terrain', 'day', 'clock', 'people', 'nextId', 'births', 'deaths', 'firstBirth', 'birthT', 'built', 'graves', 'hearth', 'beach', 'chief', 'chiefAt', 'chiefTo', 'chiefPath', 'look', 'cannibal', 'villages', 'agesNew', 'dead', 'culture', 'turned', 'lakes', 'told', 'envoyDay', 'raftTaken', 'scouts', 'pois', 'relics', 'learned', 'finds', 'watched', 'news', 'newFinds']);
  const s = Object.fromEntries(Object.entries(raw).filter(([k]) => keep.has(k))) as unknown as ShoreState;
  s.food = Math.max(10, (Number(raw.food) || 0) + (Number(raw.wood) || 0));
  s.gens = gens;
  s.ups = ups;
  s.auto = ups.includes('council') || undefined;
  // (What stands on the map: the hearth and the homes and works, a dozen of each at most.)
  const shown = new Map<string, number>();
  s.built = (raw.built ?? []).filter((b) => {
    const c = (shown.get(b.id) ?? 0) + 1;
    shown.set(b.id, c);
    return c <= SHOWN_MOST;
  });
  s.news = [...(raw.news ?? [])];
  s.newFinds = [...(raw.newFinds ?? [])];
  return keepFeatures(s);
}

/** Buying ten, buying the most, and focusing a lane were free before they were upgrades: a save
 * from then that's far enough on keeps them (once, when it's first loaded). */
function keepFeatures(s: ShoreState): ShoreState {
  if (s.featuresKept) return s;
  s.featuresKept = true;
  const owned = Object.values(s.gens).reduce((n, x) => n + (x ?? 0), 0);
  const give = (id: string) => !s.ups.includes(id) && s.ups.push(id);
  if (owned >= 15) give('tally');
  if (owned >= 40) give('counting');
  if (s.culture?.focus) give('lore');
  return s;
}

// ---- Winning the island ----

export function chiefNear(s: ShoreState, v: Village): boolean {
  return Math.hypot(s.chiefAt.x - v.x, s.chiefAt.y - v.y) < VISIT_NEAR;
}

/** Whether they can be won over by gifts now: found, kin, not yet won. */
export function canWin(s: ShoreState, v: Village): boolean {
  return v.found && v.won === undefined && !v.gone && relation(s, v) === 'kin';
}
/** Whether they can be taken (beaten, and made yours): found, not kin, not yet won. */
export function canTake(s: ShoreState, v: Village): boolean {
  return v.found && v.won === undefined && !v.gone && relation(s, v) !== 'kin';
}

/** Food a gift takes: more the bigger they are, and the further on the village is (a gift's
 * worth a while of what comes in). */
export function giftCost(s: ShoreState, v: Village): number {
  return Math.ceil(Math.max(10 + v.pop * 0.8, baseRate(s) * 20));
}
/** Food a second without the fire's heat (what prices go by: a hot fire doesn't make them dearer). */
export function baseRate(s: ShoreState): number {
  return foodRate(s) / (1 + fireMore(s));
}
/** With Warm nights, the fire's heat speeds births and ideas too (at half its strength on food). */
export function warmth(s: ShoreState): number {
  return has(s, 'warmth') ? 1 + fireMore(s) * 0.5 : 1;
}
/** Whether the village has learned to do something (an upgrade bought). */
export function can(s: ShoreState, feature: 'buy10' | 'buymax' | 'tender' | 'focus'): boolean {
  return s.ups.some((id) => {
    const fx = UPGRADES.find((u) => u.id === id)?.fx;
    return fx?.kind === 'feature' && fx.feature === feature;
  });
}
/** What beating them takes: food for the war band (more the bigger they are), and at least as
 * many critters as there are of them. */
export function takeCost(s: ShoreState, v: Village): { food: number; critters: number } {
  const k = relation(s, v) === 'prey' ? 1 : relation(s, v) === 'predator' ? 2 : 3;
  return { food: Math.ceil((200 + v.pop * v.pop * 6) * k * Math.pow(1.8, s.villages.filter((x) => x.won !== undefined).length)), critters: Math.ceil(v.pop * (1 - 0.15 * perk(s, 'warsongs'))) };
}

/** A gift of food: trust, twice as much with the chief there to give it. */
export function gift(state: GameState, id: number): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canWin(s, v)) return 0;
  const give = giftCost(s, v);
  if (s.food < give) return 0;
  s.food -= give;
  const gain = GIFT_TRUST * (1 + boosts(s).gift) * (chiefNear(s, v) ? 2 : 1);
  if (!v.gifted) {
    v.gifted = true;
    record(state, `They brought ${v.name} gifts of food for the first time.`, 'shore', shoreWhen(s));
  }
  addTrust(state, s, v, gain);
  return Math.round(gain);
}

/** The war band sent, and they're beaten: theirs is yours, for good. */
export function take(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canTake(s, v)) return false;
  const c = takeCost(s, v);
  if (s.food < c.food || totalCritters(s) < c.critters) return false;
  s.food -= c.food;
  win(state, s, v, `The war band went out against ${v.name} and beat them. Their village is the hearth's now.`);
  return true;
}

function win(state: GameState, s: ShoreState, v: Village, line: string): void {
  v.won = s.day + s.clock / DAY_SEC;
  s.news.push(`${cap(v.name)} are yours: +${Math.round(WON_MORE * 100)}% food.`);
  record(state, line, 'shore', shoreWhen(s));
}

/** Trust a day's dancing can win with a village (they tire); and each good step's worth. */
export const DANCE_DAY = 12;
const DANCE_STEP = 0.6;
/** Days for a village to rest off a full day's dancing. */
const DANCE_REST = SEASON_DAYS;
/** A turn round the fire with a village: everything brings in this much more, for this long
 * (seconds), each turn adding to it (up to the most). */
const DANCE_BOOST = 2;
const DANCE_SECS = 8;
const DANCE_MOST = 120;

/** How much dancing's left in them: worn out by dancing, rested again over a season. */
export function danceLeft(s: ShoreState, v: Village): number {
  if (!v.danced) return DANCE_DAY;
  const now = s.day + s.clock / DAY_SEC;
  if (v.danced.worn) return now - v.danced.day >= DANCE_REST ? DANCE_DAY : 0;
  const worn = Math.max(0, v.danced.got - ((now - v.danced.day) * DANCE_DAY) / DANCE_REST);
  return Math.max(0, DANCE_DAY - worn);
}
/** Whether the chief can dance with them: there, any village found and still there. */
export function canDance(s: ShoreState, v: Village): boolean {
  return v.found && !v.gone && chiefNear(s, v);
}

/** A turn round their fire with them: the fire danced up (everything brings in twice as much
 * for a while, longer the more turns), and trust with kin being won over. Returns what it won
 * (seconds of the boost added); nothing once they're worn out. */
export function dance(state: GameState, id: number, streak: number, mult = 1): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canDance(s, v)) return 0;
  const left = danceLeft(s, v);
  if (left <= 0) return 0;
  const gain = Math.min(left, DANCE_STEP * (1 + Math.min(5, streak) * 0.4) * mult);
  if (!v.danced) record(state, `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} danced with ${v.name} round their fire.`, 'shore', shoreWhen(s));
  const day = s.day + s.clock / DAY_SEC;
  v.danced = { day, got: DANCE_DAY - left + gain, worn: left - gain < 0.5 };
  const now = s.day * DAY_SEC + s.clock;
  const until = Math.min(now + DANCE_MOST, Math.max(now, s.boost && s.boost.until > now ? s.boost.until : now) + DANCE_SECS * (gain / DANCE_STEP));
  s.boost = { mult: DANCE_BOOST, until };
  if (canWin(s, v)) addTrust(state, s, v, gain * (1 + boosts(s).gift));
  return gain;
}

function addTrust(state: GameState, s: ShoreState, v: Village, n: number): void {
  v.trust = Math.min(100, (v.trust ?? FIRST_TRUST) + n);
  if (v.trust < 100 || v.won !== undefined) return;
  win(state, s, v, `${cap(v.name)} were won over. Their village is one with the hearth now.`);
}

/** Room left in the village (beds not yet slept in). */
export function roomLeft(s: ShoreState): number {
  return Math.min(room(s), hearthMost(s)) - s.people.length;
}

/** A rare colouring out of nowhere, in a child born on New Shore: one birth in a thousand. */
const SHORE_MUTATE = 0.001;

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The chief walks somewhere (on the island). */
export function walkChief(state: GameState, to: Pt): void {
  const s = shoreOf(state);
  if (s) walkTo(s, to);
}

/** Sends the chief somewhere: the way is found round any water (and if it's in the water or out
 * of reach, they go as near as they can). */
/** The chief sent somewhere (by you). */
export function walkTo(s: ShoreState, to: Pt): void {
  goTo(s, to);
}
function goTo(s: ShoreState, to: Pt): void {
  const want = { x: Math.max(2, Math.min(SHORE_N - 3, to.x)), y: Math.max(2, Math.min(SHORE_N - 3, to.y)) };
  const path = findPath(shoreIsland(s.seed), s.chiefAt, want, 120000);
  s.chiefPath = path;
  s.chiefTo = path.length ? path[path.length - 1] : null;
}

/** Times in a row the chief's walk has been blocked (not saved). */
const stuck = new WeakMap<ShoreState, number>();

/** One step along a way (the next point first): where they are now, and whether they're there. */
function along(is: Island, at: Pt, path: Pt[], speed: number, dt: number): { at: Pt; done: boolean; stuck: boolean } {
  let left = speed * dt;
  let here = at;
  while (path.length && left > 0) {
    const p = path[0];
    const d = Math.hypot(p.x - here.x, p.y - here.y);
    if (d <= left) {
      here = { ...p };
      left -= d;
      path.shift();
      continue;
    }
    const next = stepToward(is, here, p, left / dt, dt);
    if (!next) return { at: here, done: false, stuck: true };
    here = next;
    left = 0;
  }
  return { at: here, done: !path.length, stuck: false };
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
  if (s.raftTaken) {
    const f = fireFx(s);
    const k = FIRE_BURN * f.cool;
    // (A fire-tender feeds it every 2s: it settles where what's fed matches what burns, worked
    // out exactly, so it holds as well over a night away as over a minute.)
    const fed = can(s, 'tender') ? f.fuel / 2 : 0;
    if (fed) {
      const eq = Math.max(0, (fed - FIRE_BURN_MIN * f.cool) / k);
      s.fuel = eq + ((s.fuel ?? 0) - eq) * Math.exp(-k * dt);
    } else s.fuel = Math.max(0, (s.fuel ?? 0) * Math.exp(-k * dt) - FIRE_BURN_MIN * f.cool * dt);
    s.heat = fireHeat(s);
  }
  // What comes in, comes in (nothing's eaten, nothing spoils: it only ever goes up).
  const got = foodRate(s) * dt;
  s.food += got;
  s.earned = (s.earned ?? 0) + got;
  s.clock += dt;
  if (s.clock >= DAY_SEC) {
    s.clock -= DAY_SEC;
    s.day++;
    dawn(state, s);
  }
  // Children: wherever there's a fire and a bed free, and grown pairs.
  const adults = grownCount(s);
  if (count(s, 'hearth') && s.people.length < Math.min(room(s), hearthMost(s)) && adults >= 2) {
    s.birthT += Math.max(1, Math.floor(adults / 2)) * PAIR_RATE * (1 + boosts(s).births) * warmth(s) * (1 + (s.embers ?? 0) * EMBER_BIRTHS) * (1 + 0.25 * perk(s, 'fireborn')) * k;
    if (s.birthT >= 1) {
      s.birthT = 0;
      born(state, s);
    }
  }
  // The council buys what's most worth buying, by itself (every few seconds, if there's food).
  if (s.auto && has(s, 'council')) {
    councilT.set(s, (councilT.get(s) ?? 0) + dt);
    if ((councilT.get(s) ?? 0) >= COUNCIL_SEC) {
      councilT.set(s, 0);
      const pick = councilPick(s);
      if (pick) buyGen(state, pick, 1);
    }
  }
  walk(state, s, dt);
  // Trust grows by itself where the chief stays a while, and (for grazers) as kin drift in.
  for (const v of s.villages) {
    if (!canWin(s, v)) continue;
    const per = (chiefNear(s, v) ? VISIT_TRUST : 0) + (s.look.diet === 'grazer' ? WELCOME_TRUST : 0);
    if (per) addTrust(state, s, v, per * k);
  }
}
/** Seconds between the council's buys. */
const COUNCIL_SEC = 4;
const councilT = new WeakMap<ShoreState, number>();

function born(state: GameState, s: ShoreState): void {
  const rand = rng(s.seed * 7 + s.nextId * 131);
  const used = new Set(s.people.map((p) => p.name));
  let name = nameFrom(rand);
  for (let i = 0; i < 10 && used.has(name); i++) name = nameFrom(rand);
  const today = s.day + s.clock / DAY_SEC;
  // The child is of one of the grown ones' kinds (as the village mixes, so do its children).
  const grown = s.people.filter((p) => isAdult(s, p));
  const parent = grown[Math.floor(rand() * grown.length)];
  // The other parent: one of the same kind if there's one (else anyone grown).
  // (Never close kin: not a parent or child of theirs, nor a brother or sister.)
  const kin = (a: ShorePerson, b: ShorePerson) =>
    !!a.parents?.includes(b.id) || !!b.parents?.includes(a.id) || !!a.parents?.some((x) => x !== undefined && b.parents?.includes(x));
  const others = grown.filter((p) => p !== parent && (!parent || !kin(parent, p)));
  const same = others.filter((p) => p.kind === parent?.kind);
  const pool = same.length ? same : others;
  const other = pool[Math.floor(rand() * pool.length)];
  s.people.push({ id: s.nextId++, name, born: today, dies: today + 70 + rand() * 30, kind: parent?.kind, parents: parent ? [parent.id, other?.id] : undefined, genes: inherit(parent?.genes, other?.genes ?? parent?.genes, rand, 0.5, SHORE_MUTATE) });
  s.births++;
  // A rare colouring from nowhere: told of, it's so seldom.
  const child = s.people[s.people.length - 1];
  if (child.genes?.morph && child.genes.morph !== parent?.genes?.morph && child.genes.morph !== other?.genes?.morph) {
    const word = child.genes.morph === 'albino' ? 'white as bone' : child.genes.morph === 'melanistic' ? 'black all over' : 'patched with white';
    record(state, `${name} was born ${word}, like none before.`, 'shore', shoreWhen(s));
  }
  if (s.firstBirth === undefined) {
    s.firstBirth = s.day;
    s.news.push(SHORE_STORY.firstBorn);
    record(state, `${name} was born: the first born on the new shore.`, 'shore', shoreWhen(s));
    // The four begin to grow old now (the line goes on): a while apart, not all at once.
    s.people.filter((p) => p.founder).forEach((p, i) => (p.dies = s.day + 16 + i * 8 + rand() * 5));
  } else {
    s.news.push(`${name} was born.`);
    recordName(state, 'born', name, '{names} was born.', '{names} were born.', 'shore', shoreWhen(s));
  }
}

function dawn(state: GameState, s: ShoreState): void {
  pruneDead(s);
  // (Undelivered news is only ever the latest few.)
  if (s.news.length > 30) s.news.splice(0, s.news.length - 30);
  maybeTurn(state, s);
  cultureDay(state, s);
  // Every village found is won, and some are still out in the fog (somewhere the scouts never
  // get to): their smoke is seen, one a day, so the island can always be settled.
  if (s.villages.every((v) => !v.found || v.won !== undefined || v.gone)) {
    const lost = s.villages.find((v) => !v.found && !v.gone);
    if (lost) {
      lost.found = true;
      if (relation(s, lost) === 'kin') lost.trust ??= FIRST_TRUST;
      s.newFinds.push(lost.id);
      record(state, `Smoke far off: ${lost.name}, ${Math.round(lost.pop)} of them.`, 'shore', shoreWhen(s));
    }
  }
  // The envoy's day: a gift to the nearest kin being won over, if there's a gift's worth spare.
  if (has(s, 'envoy') && s.envoyDay !== s.day) {
    const v = s.villages.filter((x) => canWin(s, x)).sort((a, b) => Math.hypot(a.x - s.hearth.x, a.y - s.hearth.y) - Math.hypot(b.x - s.hearth.x, b.y - s.hearth.y))[0];
    if (v && s.food >= giftCost(s, v) * 2) {
      s.envoyDay = s.day;
      gift(state, v.id);
    }
  }
  // Old age (the only way they go: no one starves or freezes while you're away).
  for (const p of [...s.people]) {
    if (p.dies === undefined || s.day < p.dies) continue;
    die(state, s, p, 'old age');
  }
}

/** Graves drawn at most; and the dead remembered beyond those a family tree still reaches. */
const GRAVES_KEPT = 70;
const DEAD_RECENT = 60;

/**
 * The dead the trees can still reach: the four, the parents and grandparents of anyone living,
 * and the most recent. The rest are let go (a tree shows a forgotten one as not recorded).
 */
function pruneDead(s: ShoreState): void {
  const dead = s.dead;
  if (!dead || dead.length <= DEAD_RECENT * 2) return;
  const byId = new Map<number, ShorePerson>();
  for (const p of dead) byId.set(p.id, p);
  for (const p of s.people) byId.set(p.id, p);
  const keep = new Set<number>();
  for (const p of s.people)
    for (const a of p.parents ?? []) {
      if (a === undefined) continue;
      keep.add(a);
      for (const g of byId.get(a)?.parents ?? []) if (g !== undefined) keep.add(g);
    }
  const recent = new Set(dead.slice(-DEAD_RECENT).map((p) => p.id));
  s.dead = dead.filter((p) => p.founder || keep.has(p.id) || recent.has(p.id));
}

function die(state: GameState, s: ShoreState, p: ShorePerson, why: 'old age' | 'hunger' | 'cold' | 'battle'): void {
  s.people = s.people.filter((q) => q !== p);
  // Remembered (for the family trees).
  (s.dead ??= []).push({ ...p, died: s.day + s.clock / DAY_SEC, cause: why === 'battle' ? 'fell in the fighting' : why === 'old age' ? 'old age' : why });
  s.deaths++;
  // Buried a little way out from the hearth, together.
  const n = s.graves.length;
  const a = 2.4 + (n % 7) * 0.18;
  s.graves.push({ x: s.hearth.x + Math.cos(a) * (13 + Math.floor(n / 7) * 1.6) + (n % 7) * 1.1, y: s.hearth.y + Math.sin(a) * 9 + Math.floor(n / 7) * 1.4 });
  // (The burial ground keeps its first rows, the four among them, and the most recent; the
  // old ones between are grassed over.)
  if (s.graves.length > GRAVES_KEPT) s.graves.splice(8, s.graves.length - GRAVES_KEPT);
  if (p.founder && why === 'battle') {
    s.news.push(`${p.name}, one of the four who crossed, fell in the fighting.`);
    record(state, `${p.name}, one of the four who crossed, fell in the fighting.`, 'shore', shoreWhen(s));
  } else if (why === 'battle') s.news.push(`${p.name} fell in the fighting.`);
  else if (p.founder) {
    const left = s.people.filter((q) => q.founder).length;
    const line = left ? SHORE_STORY.founderDies.replace('{name}', p.name) : SHORE_STORY.lastFounder;
    s.news.push(line);
    record(state, `${p.name}, one of the four who crossed, died of old age.${left ? '' : ' The last of them.'}`, 'shore', shoreWhen(s));
  } else {
    s.news.push(why === 'hunger' ? `${p.name} died of hunger.` : why === 'cold' ? `${p.name} died of the cold.` : `${p.name} died of old age.`);
    if (why === 'cold' || why === 'hunger') record(state, `${p.name} died of ${why === 'cold' ? 'the cold, with no wood for the fire' : 'hunger'}.`, 'shore', shoreWhen(s));
    else recordName(state, 'old', p.name, '{names} died of old age.', '{names} died of old age.', 'shore', shoreWhen(s));
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
    // (A walk from before ways were found, or one knocked off its line: the way, found now.)
    if (!s.chiefPath?.length) goTo(s, s.chiefTo);
    if (s.chiefTo && s.chiefPath) {
      const r = along(is, s.chiefAt, s.chiefPath, CHIEF_SPEED * (1 + bo.speed), dt);
      s.chiefAt = r.at;
      if (r.done) {
        s.chiefTo = null;
        s.chiefPath = undefined;
      } else if (r.stuck) {
        // Knocked off the line (a narrow spit, say): the way's found again; if that doesn't
        // help either, they stop where they are.
        s.chiefPath = undefined;
        stuck.set(s, (stuck.get(s) ?? 0) + 1);
        if ((stuck.get(s) ?? 0) > 2) {
          s.chiefTo = null;
          stuck.set(s, 0);
        }
      } else stuck.set(s, 0);
    }
  }
  if (seen.length !== SHORE_CELLS * SHORE_CELLS) return;
  reveal(is, seen, s.chiefAt.x, s.chiefAt.y, CHIEF_SIGHT + bo.sight);
  // The land round the village, seen from it.
  if (!s.watched && s.raftTaken) {
    s.watched = 1;
    reveal(is, seen, s.hearth.x, s.hearth.y, HOME_SIGHT);
  }
  // Scouts: two of them once there are scouts, out in the fog on their own.
  const huts = has(s, 'scouts') ? 2 : 0;
  s.scouts ??= [];
  if (s.scouts.length > huts) s.scouts.length = huts;
  while (s.scouts.length < huts) s.scouts.push({ at: { ...s.hearth }, to: null, left: 0 });
  s.scouts.forEach((sc, k) => {
    // (A breather between one walk and the next: longer if they got nowhere, so a scout who's
    // stuck, or has nowhere left to go, isn't finding a new way every step.)
    if ((sc.rest ?? 0) > 0) {
      sc.rest = (sc.rest ?? 0) - dt;
      return;
    }
    if (!sc.to || sc.left <= 0 || !sc.path) {
      sc.to = scoutGoal(s, seen, is, sc, k);
      sc.path = findPath(is, sc.at, sc.to, 30000);
      sc.left = sc.path.reduce((a, p, i) => a + Math.hypot(p.x - (i ? sc.path![i - 1].x : sc.at.x), p.y - (i ? sc.path![i - 1].y : sc.at.y)), 0) / SCOUT_SPEED * 1.5 + 5;
    }
    sc.left -= dt;
    const r = along(is, sc.at, sc.path, SCOUT_SPEED * (1 + bo.speed), dt);
    sc.at = r.at;
    if (r.done || r.stuck) {
      sc.rest = r.stuck || Math.hypot(sc.to!.x - sc.at.x, sc.to!.y - sc.at.y) > 6 ? 20 : 3;
      sc.to = null;
      sc.path = undefined;
    }
    reveal(is, seen, sc.at.x, sc.at.y, SCOUT_SIGHT + bo.sight);
  });
  seeAcrossLakes(s, is, seen);
  for (const v of s.villages) {
    if (v.found) continue;
    const c = Math.floor(v.y / CELL) * SHORE_CELLS + Math.floor(v.x / CELL);
    if (!seen[c]) continue;
    v.found = true;
    if (relation(s, v) === 'kin') v.trust ??= FIRST_TRUST;
    s.newFinds.push(v.id);
    record(state, `They found ${v.name}: ${Math.round(v.pop)} of them, ${v.cannibal ? 'eaters of their own kind' : `${v.diet}s`}.`, 'shore', shoreWhen(s));
  }
  // Landmarks come out of the fog as it's seen, by the chief or the scouts; once seen they're
  // known, and on the Island tab's list (so none's left somewhere only a scout has been, and
  // never found again). No marker on the map: they're there to be noticed.
  for (const p of poisOf(s)) {
    if (!p.found && seen[Math.floor(p.y / CELL) * SHORE_CELLS + Math.floor(p.x / CELL)]) p.found = true;
    if (p.found && !p.known) {
      p.known = true;
      const chief = Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y) < 14;
      record(state, chief ? `They came upon something: ${poiDef(p).seen}` : `A scout came back with word of something: ${poiDef(p).seen}`, 'shore', shoreWhen(s));
    }
  }
  explore(state, s, dt);
}

/** The island's lakes, on the fog's grid: each lake's cells (cells whose middle is lake water). */
const lakeCache = new Map<number, number[][]>();
function lakesOf(is: Island, seed: number): number[][] {
  const hit = lakeCache.get(seed);
  if (hit) return hit;
  const G = is.n / CELL;
  const wet = (c: number) => is.biome[Math.floor((Math.floor(c / G) * CELL + CELL / 2)) * is.n + (c % G) * CELL + Math.floor(CELL / 2)] === Biome.Lake;
  const done = new Uint8Array(G * G);
  const lakes: number[][] = [];
  for (let c0 = 0; c0 < G * G; c0++) {
    if (done[c0] || !wet(c0)) continue;
    const cells: number[] = [];
    const stack = [c0];
    done[c0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const x = c % G;
      const y = Math.floor(c / G);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const n = ny * G + nx;
        if (done[n] || !wet(n)) continue;
        done[n] = 1;
        stack.push(n);
      }
    }
    lakes.push(cells);
  }
  lakeCache.set(seed, lakes);
  return lakes;
}

/** Open water hides nothing: once any of a lake is seen, all of it is (and its shores, a cell
 * deep). */
function seeAcrossLakes(s: ShoreState, is: Island, seen: Uint8Array): void {
  const lakes = lakesOf(is, s.seed);
  if (!lakes.length) return;
  const G = is.n / CELL;
  const known = (s.lakes ??= []);
  lakes.forEach((cells, i) => {
    if (known.includes(i) || !cells.some((c) => seen[c])) return;
    known.push(i);
    for (const c of cells) {
      const x = c % G;
      const y = Math.floor(c / G);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < G && ny < G) seen[ny * G + nx] = 1;
      }
    }
  });
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
  // (What's found to eat is worth a while of what comes in: as much as it says, or so many
  // seconds' worth, whichever's more.)
  const worth = (n: number) => Math.round(Math.max(n, baseRate(s) * n));
  if (dup) s.food += worth(30);
  else {
    if (f.relic) (s.relics ??= []).push(f.relic);
    if (f.learn) (s.learned ??= []).push(f.learn);
    if (f.food || f.wood) s.food += worth((f.food ?? 0) + (f.wood ?? 0));
  }
  (s.finds ??= []).push({ poi: p.id, find: f, dup: !!dup });
  record(state, `At the ${poiName(p).toLowerCase().replace(/^(the|a) /, '')}: ${f.text.replace('[STORY] ', '')}`, 'shore', shoreWhen(s));
}

export function relicName(id: RelicId): string {
  return RELICS.find((r) => r.id === id)!.name;
}

export { buildName };
