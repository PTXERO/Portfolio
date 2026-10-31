// New Shore, Phase 1: settling. The four found a village around a hearth on a big, fogged
// island, and grow it toward a hundred. The village gathers food and wood by itself (you set
// what it leans toward), lays out what you choose to build around the hearth, and has children
// where there's a fire, room and food to spare. The four grow old and die once the line goes
// on. The chief (one of the four, then their heirs) walks the island, and the fog draws back;
// out there are other villages, other kinds (see docs/new-shore.md).
//
// Time is counted in days (DAY_SEC each). Everything runs offline too.

import { BUILDS, buildName, POIS, RELICS, RES_NAME, SHORE_STORY, type Res, type Boosts, type BuildId, type Find, type PoiKind, type RelicId } from '../content/shore';
import { record } from './chronicle';
import { Biome, CELL, isLand, islandOf, reveal, type Island, type Pt } from './island';
import { generateTerrain, TERRAIN_V, type Terrain } from './terrain';
import { findPath, findRoute } from './paths';
import { inherit, personal } from './genes';
import { diplomacyDawn } from './diplomacy';
import { greatWork, isGreatWork, IDEAS, ageOver, cultureDay, cultureFx, maybeTurn, workReady, type Culture } from './culture';
import { away, stepWar, warDawn, type Battle, type Fight, type Raid, type WarBand, type WarRule } from './war';
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
/** What a day's work brings in, each worker, before bonuses; and what each eats a day. */
const FOOD_PER = 2.5;
const WOOD_PER = 3;
const EAT = 1;
const EAT_CHILD = 0.5;
/** Food a birth takes, and how often a pair of adults has a child (a day) with all well. */
const BIRTH_FOOD = 12;
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
/** What's kept with nothing built to keep it in. */
const FOOD_CAP = 40;
const WOOD_CAP = 50;
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
  joined?: boolean;
  /** Won over, and kept their own village (since this day): a settlement of yours, growing on
   * its own land, sending what it makes to the hearth (days on the road). */
  settled?: number;
  /** A road to the hearth: work done on it and work it takes (in days); travel along it, done,
   * is quicker by far. */
  road?: { done: number; need: number; tier?: number; up?: { done: number; need: number }; via?: number };
  /** A caravan each day along a finished road to a vassal. */
  trade?: Trade;
  /** What a settlement's gathered today, to send to the hearth at dawn. */
  load?: { food: number; wood: number; res?: Partial<Record<Res, number>> };
  /** A settlement's work (chosen by the chief, there in person): its trade. */
  focus?: SettleFocus;
  /** What a settlement's asking of the hearth, and till when; when it'll next ask. */
  ask?: SettleAsk;
  askNext?: number;
  /** Helped, they thrive (till this day); let down, they sulk (till this day). */
  thrive?: number;
  sulk?: number;
  /** How big it's grown, last we looked: 0 a camp, 1 a village, 2 a town. */
  stage?: number;
  /** Won over, but there wasn't room: waiting for your answer (since this day), or waiting for
   * room (since this day; they lose patience). */
  asking?: number;
  waiting?: number;
  /** Kept their own village, as yours: what you take of what they make (0 to 0.6), and how loyal
   * they are (0 to 100; at nothing, they throw you off). */
  vassal?: { tax: number; loyalty: number; conquered?: number; warm?: number; warned?: boolean };
  /** Not kin, not yours: where they stand with you (-100 to 100; unset, where they started), and
   * when the chief last demanded they submit. */
  standing?: number;
  demanded?: number;
  /** Times they've come raiding and been driven off; and been paid to go away. */
  beaten?: number;
  paid?: number;
  /** Driven out by the hearth (that day): their land's an outpost of yours, worked for its goods. */
  outpost?: number;
  /** Turned away: gone from the island's map (to the village they went to, that day). */
  gone?: { to: number; day: number };
}

export type JoinAnswer = 'crowd' | 'vassal' | 'wait' | 'away';
export type StewardPlan = 'balanced' | 'homes' | 'food' | 'stores';

/** Why the elders do what they do (or wait). */
export type ElderWhy = 'hearth' | 'busy' | 'homes' | 'food' | 'stores' | 'woodpile' | 'forest' | 'winter' | 'spare' | 'saving' | 'content' | 'off' | 'defence';

/** How the Chronicle tells of a building the elders chose: "The elders <saw…>: the hut was raised." */
const ELDER_SAW: Record<ElderWhy, string> = {
  hearth: 'wanted a fire first',
  busy: 'waited',
  homes: 'saw there were not beds enough for the children to come',
  food: 'saw the land near the hearth could feed no more gatherers',
  stores: 'saw food spoiling, with nowhere to keep it',
  woodpile: 'saw the woodpiles could not hold what they meant to build',
  forest: 'saw the woods thinning round the village',
  winter: 'kept back wood for the winter fires',
  spare: 'had wood to spare',
  saving: 'were saving wood',
  content: 'were content',
  off: 'left the building to the chief',
  defence: 'feared the raiders',
};

/** What the chief tells the elders, in the Chronicle. */
const PLAN_SAYS: Record<StewardPlan, string> = {
  balanced: 'to build as they saw fit',
  homes: 'to see to homes first',
  food: 'to see to food first',
  stores: 'to see to the stores first',
};

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
  /** The way there (round lakes and along shores), the next point first. */
  chiefPath?: Pt[];
  /** The look and diet the line carries, and whether they eat their own. */
  look: CreatureLook;
  cannibal: boolean;
  villages: Village[];
  /** What's going up now (one at a time): where, and seconds left of how many. */
  building?: { id: BuildId; x: number; y: number; left: number; total: number; why?: ElderWhy };
  /** What the elders have been thinking, newest last (a few dozen kept). */
  elders?: { when: string; why: ElderWhy; text: string }[];
  /** A raid on the way, the war band out, battles not yet shown, raids fought off or not, and
   * when the next is thought of. */
  raid?: Raid;
  warband?: WarBand;
  /** The war chief's rule, and when the band last went out. */
  warRule?: WarRule;
  lastBand?: number;
  /** Raiders running home after a fight; and what their fallen left lying (for a while). */
  retreat?: { from: number; n: number; left: number; arrives: number; sx?: number; sy?: number };
  /** The road whose crew the chief's working with (they keep up with it). */
  crewWith?: number;
  /** The goods the chief's gathered by hand, ever (told once each). */
  gathered?: Res[];
  /** A new Age begun, not yet shown (its card). */
  agesNew?: number[];
  /** A village beaten and at your mercy, waiting on what's to be done with them. */
  conquest?: { id: number; since: number };
  /** Goods on the road from the settlements to the hearth. */
  convoys?: { from: number; food: number; wood: number; res?: Partial<Record<Res, number>>; left: number; arrives: number; caravan?: boolean }[];
  loot?: { x: number; y: number; n: number; until: number };
  /** A fight going on now (a round every few seconds). */
  fight?: Fight;
  /** Hurt in the fighting: the chief walks slowly till then (days since landfall). */
  chiefHurt?: number;
  battles?: Battle[];
  raids?: number;
  nextRaid?: number;
  /** Everyone who's died, remembered (for the family trees). */
  dead?: ShorePerson[];
  /** Phase 2: the culture, once the village has turned (and whether the turn's yet to be shown). */
  culture?: Culture;
  turned?: boolean;
  /** Lakes seen across (by their number): seen from any shore, the whole lake is. */
  lakes?: number[];
  /** Things the Chronicle has already told of, so it tells them once (the woods thinning…). */
  told?: string[];
  /** The elders' council, once built: whether they build while you're away, and what for. */
  steward?: { on: boolean; plan: StewardPlan };
  /** The last day the envoy took a gift. */
  envoyDay?: number;
  /** Wood still standing in the woods round the village (see FOREST_MAX). */
  forest?: number;
  /** Winter days in a row with no firewood. */
  cold?: number;
  /** What's in store of the land's other resources (fish goes straight into the food). */
  res?: Partial<Record<Res, number>>;
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
      // (And a land that gives goods no village gives yet: every good to be had somewhere.)
      const fresh = RES_OF[h].filter((r) => r !== 'fish' && !villages.some((v) => v.habitat && RES_OF[v.habitat].includes(r))).length;
      const score = (HABITATS[h].likes[p.diet] ?? 1) - 1.3 * villages.filter((v) => v.habitat === h).length + rand() * 1.2 + spread + fresh * 1.5;
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
  const four = (tribe.family?.length ? tribe.family : [0, 1, 2, 3].map(() => ({ name: nameFrom(rand), trait: 'hardy' }))).slice(0, 4);
  const people: ShorePerson[] = four.map((p, i) => ({ id: i, name: p.name, trait: p.trait, born: -20, founder: true, genes: ('genes' in p ? (p.genes as Genes | undefined) : undefined) ?? personal(tribe.look.genes, i + 1) }));
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

const NO_BOOSTS: Boosts = { food: 0, wood: 0, births: 0, grow: 0, speed: 0, sight: 0, gift: 0, room: 0, foodCap: 0, woodCap: 0, winter: 0, watch: 0, cheap: 0, mend: 0, guard: 0, arms: 0, warn: 0, tribute: 0, loyalty: 0, standing: 0, build: 0, resCap: 0, trade: 0, roadCost: 0, crew: 0, levy: 0, wander: 0, feast: 0, settleGrow: 0 };
const boostCache = new WeakMap<ShoreState, { k: [number, number, number, number]; b: Boosts }>();

/** What the buildings and relics add up to (worked out again only when either changes). */
export function boosts(s: ShoreState): Boosts {
  // (Checked by counts, not a key built each call: it's asked for many times a step.)
  const built = s.built.length;
  const relics = s.relics?.length ?? 0;
  const ideas = s.culture?.done.length ?? 0;
  const forks = s.culture ? Object.keys(s.culture.forks).length : 0;
  const hit = boostCache.get(s);
  if (hit && hit.k[0] === built && hit.k[1] === relics && hit.k[2] === ideas && hit.k[3] === forks) return hit.b;
  const key: [number, number, number, number] = [built, relics, ideas, forks];
  const b = { ...NO_BOOSTS };
  const add = (fx: Partial<Boosts> | undefined, n = 1) => {
    for (const k of Object.keys(fx ?? {}) as (keyof Boosts)[]) b[k] += (fx![k] ?? 0) * n;
  };
  for (const def of BUILDS) if (def.fx) add(def.fx, count(s, def.id));
  for (const r of s.relics ?? []) add(RELICS.find((x) => x.id === r)?.fx);
  for (const fx of cultureFx(s)) add(fx);
  b.winter = Math.min(1, b.winter);
  boostCache.set(s, { k: key, b });
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
  const cheap = id === 'hut' ? 1 - boosts(s).cheap : 1;
  return Math.ceil(def.wood * def.growth ** count(s, id) * cheap);
}

// ---- The land's resources ----

/** What each kind of land gives (beyond food and wood). */
export const RES_OF: Record<Habitat, Res[]> = {
  river: ['fish', 'clay'],
  lake: ['fish', 'reeds'],
  marsh: ['reeds', 'herbs', 'clay'],
  desert: ['salt', 'flint'],
  scrub: ['flint', 'herbs'],
  forest: ['timber', 'herbs'],
  meadow: ['herbs'],
  mountain: ['stone', 'flint'],
  coast: ['fish', 'salt'],
};
/** Kept of each at most; a day's from each village that gives it; food a day from each with fish. */
export const RES_CAP = 60;
/** Kept of each of the land's goods now (more with kilns and the like). */
export function resCap(s: ShoreState): number {
  return RES_CAP + boosts(s).resCap;
}
const RES_DAY = 2;
const FISH_FOOD = 5;

/** Whether a village is yours to draw on: joined (their old village kept as an outpost) or a
 * vassal (what their land gives comes as tribute, more the more you take). */
export function held(v: Village): boolean {
  return !!v.habitat && (v.outpost !== undefined || (!v.gone && (!!v.joined || !!v.vassal || v.settled !== undefined)));
}

/** Under your rule, living in their own village: a settlement or a vassal. */
export function ruled(v: Village): boolean {
  return !v.gone && !v.joined && (!!v.vassal || v.settled !== undefined);
}

/** How loyal a village of yours is (a settlement is yours entirely). */
export function loyaltyOf(v: Village): number {
  return v.settled !== undefined ? 100 : v.vassal?.loyalty ?? 0;
}

/** Every critter of yours: by the hearth, and in the settlements. */
export function totalCritters(s: ShoreState): number {
  let n = s.people.length;
  for (const v of s.villages) if (v.settled !== undefined && !v.gone) n += Math.round(v.pop);
  return n;
}

/** Roads, as the Ages go on: dirt, then stone (once "Stone blades" is known, with stone from
 * the land), then paved (an Age to come). Each quicker to travel than the one before. */
export const ROAD_TIERS: { name: string; faster: number; walk: number; idea?: string; needs?: Partial<Record<Res, number>>; age?: number }[] = [
  { name: 'Dirt road', faster: 0.5, walk: 2 },
  { name: 'Stone road', faster: 0.35, walk: 2.5, idea: 'blades', needs: { stone: 20 } },
  { name: 'Paved road', faster: 0.25, walk: 3, age: 3 },
];
export function roadTier(v: { road?: Village['road'] }): number {
  return v.road?.tier ?? 0;
}

/** What a finished road does for its village (nothing, without one): goods go both ways, so
 * they make more; a vassal on the road is the more loyal; a settlement grows the quicker. */
export function roadPerks(v: { road?: Village['road'] }): { output: number; loyalty: number; growth: number } {
  if (!roadDone(v)) return { output: 1, loyalty: 0, growth: 1 };
  const t = roadTier(v);
  return { output: 1.15 + t * 0.05, loyalty: 8 + t * 4, growth: 1.3 + t * 0.15 };
}

/** The roads together: every village of yours they reach adds a little to the work at the
 * hearth (building, and the culture's practice). Three in a hundred each, to thirty. */
export function networkBonus(s: ShoreState): number {
  const n = s.villages.filter((v) => roadDone(v) && ruled(v)).length;
  return Math.min(0.3, n * 0.03);
}

/** Days to walk between the hearth and a village (a band's pace), and quicker by road. */
export const WALK_SPEED = 1.2;

/** A place on the road network: the hearth (-1), or a village. */
function nodeAt(s: ShoreState, id: number): Pt {
  if (id < 0) return s.hearth;
  const v = s.villages.find((x) => x.id === id);
  return v ? { x: v.x, y: v.y } : s.hearth;
}

/** The way between two places, round the water and the mountains, and what it costs (kept:
 * worked out once for each pair of places). */
const legs = new Map<string, { pts: Pt[]; cost: number; cum: number[]; total: number }>();
export function leg(s: ShoreState, a: Pt, b: Pt): { pts: Pt[]; cost: number; cum: number[]; total: number } {
  const key = `${s.seed}|${Math.round(a.x)},${Math.round(a.y)}|${Math.round(b.x)},${Math.round(b.y)}`;
  let r = legs.get(key);
  if (!r) {
    if (legs.size > 400) legs.clear();
    const { pts, cost } = findRoute(shoreIsland(s.seed), a, b, 120000);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    r = { pts, cost, cum, total: cum[cum.length - 1] || 1 };
    legs.set(key, r);
  }
  return r;
}
/** Days on foot along a way: three tiles a cell of open ground, more over rough ground and
 * climbs. */
export function legDays(s: ShoreState, a: Pt, b: Pt): number {
  return (leg(s, a, b).cost * 3) / WALK_SPEED / DAY_SEC;
}

/** The places a road can join: the hearth, and every village of yours a finished road reaches. */
export function roadNodes(s: ShoreState): number[] {
  return [-1, ...s.villages.filter((v) => roadDone(v) && ruled(v)).map((v) => v.id)];
}

/** Days from the hearth to a place along the road network (the hearth itself: none). */
function netDays(s: ShoreState, id: number, depth = 0): number {
  if (id < 0 || depth > 12) return 0;
  const v = s.villages.find((x) => x.id === id);
  if (!v || !roadDone(v)) return Infinity;
  const via = v.road!.via ?? -1;
  return legDays(s, nodeAt(s, via), v) * ROAD_TIERS[roadTier(v)].faster + netDays(s, via, depth + 1);
}

/** Days to get between the hearth and a village: by its own road if it has one; else on foot
 * from the hearth, or along the roads to the nearest village they reach and on foot from there,
 * whichever is quicker. */
export function travelDays(s: ShoreState, v: Village): number {
  if (roadDone(v)) return netDays(s, v.id);
  let best = legDays(s, s.hearth, v);
  for (const id of roadNodes(s)) {
    if (id < 0 || id === v.id) continue;
    const n = nodeAt(s, id);
    // (Not worth working out the way from somewhere further than the hearth is.)
    if (Math.hypot(n.x - v.x, n.y - v.y) * 1.2 > Math.hypot(s.hearth.x - v.x, s.hearth.y - v.y)) continue;
    best = Math.min(best, netDays(s, id) + legDays(s, n, v));
  }
  return best;
}
export function roadDone(v: { road?: Village['road'] }): boolean {
  return !!v.road && v.road.done >= v.road.need;
}

/** Where a new road to a village would join the network: the place nearest it, by the way. */
export function roadVia(s: ShoreState, v: Village): number {
  if (v.road) return v.road.via ?? -1;
  let best = -1;
  let days = legDays(s, s.hearth, v);
  for (const id of roadNodes(s)) {
    if (id < 0 || id === v.id) continue;
    const n = nodeAt(s, id);
    if (Math.hypot(n.x - v.x, n.y - v.y) > Math.hypot(s.hearth.x - v.x, s.hearth.y - v.y)) continue;
    const d = legDays(s, n, v);
    if (d < days) {
      days = d;
      best = id;
    }
  }
  return best;
}
/** The name of where a road joins. */
export function viaName(s: ShoreState, id: number): string {
  return id < 0 ? 'the hearth' : s.villages.find((x) => x.id === id)?.name ?? 'the hearth';
}

/** What a road to a village costs in wood (more the longer and rougher the way), and the days
 * it takes to lay: half again the days it takes to walk the way. */
export function roadCost(s: ShoreState, v: Village): { wood: number; days: number; via: number } {
  const via = roadVia(s, v);
  const days = legDays(s, nodeAt(s, via), v);
  return { wood: Math.round((20 + days * 30) * (1 - boosts(s).roadCost)), days: Math.round(days * 1.5 * 10) / 10, via };
}

/** A road being laid (or relaid, better), anywhere: one at a time. */
function roadBusy(s: ShoreState): boolean {
  return s.villages.some((x) => (x.road && !roadDone(x)) || x.road?.up);
}

/** Whether a road can be started to a village of yours (one at a time; wood in hand). */
export function canRoad(s: ShoreState, v: Village): boolean {
  return ruled(v) && !v.road && !roadBusy(s) && s.wood >= roadCost(s, v).wood;
}

/** Start a road to a village of yours: the wood's paid now, the road's laid a little each day. */
export function startRoad(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canRoad(s, v)) return false;
  const c = roadCost(s, v);
  s.wood -= c.wood;
  v.road = { done: 0, need: c.days, via: c.via >= 0 ? c.via : undefined };
  s.news.push(`A road to ${v.name} was begun${c.via >= 0 ? `, from ${viaName(s, c.via)}` : ''}.`);
  record(state, `They began a road to ${v.name}${c.via >= 0 ? ` from ${viaName(s, c.via)}, where the roads already reached` : ''}, ${c.wood} wood of it, to be laid over ${Math.ceil(c.days)} days.`, 'shore', shoreWhen(s));
  return true;
}

/** The next road a finished one could be relaid as, what it costs, and what's missing (if
 * anything). */
export function roadUpgrade(s: ShoreState, v: Village): { tier: number; wood: number; needs: Partial<Record<Res, number>>; days: number; missing?: string } | null {
  if (!roadDone(v) || v.road!.up) return null;
  const tier = roadTier(v) + 1;
  const def = ROAD_TIERS[tier];
  if (!def) return null;
  const c = roadCost(s, v);
  const days = Math.round(c.days * 0.8 * 10) / 10;
  const wood = Math.round(c.wood * (0.8 + tier * 0.4));
  let missing: string | undefined;
  if (def.age && (s.culture?.age ?? 1) < def.age) missing = 'an Age to come';
  else if (def.idea && !s.culture?.done.includes(def.idea)) missing = `the idea "${IDEAS.find((x) => x.id === def.idea)?.name ?? def.idea}"`;
  else if (def.needs && !Object.entries(def.needs).every(([r, n]) => (s.res?.[r as Res] ?? 0) >= (n ?? 0))) missing = Object.entries(def.needs).map(([r, n]) => `${n} ${RES_NAME[r as Res].toLowerCase()}`).join(', ');
  else if (s.wood < wood) missing = `${wood} wood`;
  else if (roadBusy(s)) missing = 'the road being laid to be done';
  return { tier, wood, needs: def.needs ?? {}, days, missing };
}

/** Relay a finished road, better: it's used as it was, meanwhile. */
export function upgradeRoad(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v) return false;
  const u = roadUpgrade(s, v);
  if (!u || u.missing) return false;
  s.wood -= u.wood;
  for (const [r, n] of Object.entries(u.needs) as [Res, number][]) s.res![r] = (s.res![r] ?? 0) - n;
  v.road!.up = { done: 0, need: u.days };
  s.news.push(`The road to ${v.name} is being relaid as a ${ROAD_TIERS[u.tier].name.toLowerCase()}.`);
  record(state, `They began to relay the road to ${v.name} as a ${ROAD_TIERS[u.tier].name.toLowerCase()}.`, 'shore', shoreWhen(s));
  return true;
}

/** The way a road runs, from where it joins the network to its village (the way the map draws
 * it), with how far along each point is. */
export function roadPath(s: ShoreState, v: Village): { pts: Pt[]; cum: number[]; total: number } {
  return leg(s, nodeAt(s, v.road?.via ?? roadVia(s, v)), v);
}
/** The point a fraction of the way along a road. */
export function roadAt(s: ShoreState, v: Village, k: number): Pt {
  const r = roadPath(s, v);
  const at = Math.max(0, Math.min(1, k)) * r.total;
  let j = 1;
  while (j < r.pts.length - 1 && r.cum[j] < at) j++;
  const a = r.pts[j - 1];
  const b = r.pts[j];
  const u = Math.max(0, Math.min(1, (at - r.cum[j - 1]) / Math.max(1e-6, r.cum[j] - r.cum[j - 1])));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/** Where the crew's working on a road: its front (laying it, or relaying it). */
export function roadFront(s: ShoreState, v: Village): Pt | null {
  if (!v.road) return null;
  const w = v.road.up ?? (roadDone(v) ? null : v.road);
  return w ? roadAt(s, v, w.done / Math.max(0.01, w.need)) : null;
}
/** The chief goes to work with a road's crew, and stays with them as the road goes on. */
export function joinCrew(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  const f = s && v ? roadFront(s, v) : null;
  if (!s || !v || !f) return false;
  goTo(s, { x: f.x, y: f.y + 1.2 });
  if (!s.crewWith) record(state, `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} went to work on the road to ${v.name} with the crew.`, 'shore', shoreWhen(s));
  s.crewWith = id;
  return true;
}
/** The chief leaves the crew to it (stays where they are). */
export function leaveCrew(state: GameState): void {
  const s = shoreOf(state);
  if (s) s.crewWith = undefined;
}

/** With the chief there among them, the crew lays twice as much. */
export const CREW_NEAR = 6;
export function chiefWithCrew(s: ShoreState, v: Village): boolean {
  const f = roadFront(s, v);
  return !!f && Math.hypot(s.chiefAt.x - f.x, s.chiefAt.y - f.y) < CREW_NEAR;
}

/** The waystations on a finished road: one halfway, or two on a long one. */
export function waystations(s: ShoreState, v: Village): Pt[] {
  if (!roadDone(v)) return [];
  const long = roadCost(s, v).days >= 4;
  return (long ? [1 / 3, 2 / 3] : [0.5]).map((k) => roadAt(s, v, k));
}

/** The tiles the finished roads run over, and how much quicker the chief walks each (worked out
 * once for each set of roads). */
const roadCache = new WeakMap<ShoreState, { sig: string; at: number; cells: Map<number, number> }>();
export function roadCells(s: ShoreState): Map<number, number> {
  // (Asked a thousand times a frame: the same moment, the same roads.)
  const at = s.day * DAY_SEC + s.clock;
  const hit = roadCache.get(s);
  if (hit && hit.at === at) return hit.cells;
  const done = s.villages.filter((v) => roadDone(v) && !v.gone);
  const sig = done.map((v) => `${v.id}.${roadTier(v)}`).join(',');
  if (hit && hit.sig === sig) {
    hit.at = at;
    return hit.cells;
  }
  const cells = new Map<number, number>();
  if (done.length) {
    const n = shoreIsland(s.seed).n;
    for (const v of done) {
      const walkK = ROAD_TIERS[roadTier(v)].walk;
      const { pts } = roadPath(s, v);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
        for (let j = 0; j <= m; j++) {
          const x = Math.floor(a.x + ((b.x - a.x) * j) / m);
          const y = Math.floor(a.y + ((b.y - a.y) * j) / m);
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const c = (y + dy) * n + x + dx;
              cells.set(c, Math.max(cells.get(c) ?? 1, walkK));
            }
          }
        }
      }
    }
  }
  roadCache.set(s, { sig, at, cells });
  return cells;
}

/** How much quicker the chief walks where they are (1 off the roads). */
export function roadWalk(s: ShoreState, p: Pt): number {
  const cells = roadCells(s);
  return cells.size ? cells.get(Math.floor(p.y) * shoreIsland(s.seed).n + Math.floor(p.x)) ?? 1 : 1;
}
/** How quick going is at each point, for finding the way (none, with no roads yet: the way's
 * found as it always was). */
const speedGrids = new WeakMap<Map<number, number>, Uint8Array>();
export function roadSpeed(s: ShoreState): ((x: number, y: number) => number) | undefined {
  const cells = roadCells(s);
  if (!cells.size) return undefined;
  const n = shoreIsland(s.seed).n;
  // (As a flat grid, made once for each set of roads: a way's found in a blink.)
  let grid = speedGrids.get(cells);
  if (!grid) {
    grid = new Uint8Array(n * n);
    for (const [c, k] of cells) if (c >= 0 && c < grid.length) grid[c] = Math.round(k * 10);
    speedGrids.set(cells, grid);
  }
  const g = grid;
  return (x, y) => g[Math.floor(y) * n + Math.floor(x)] / 10 || 1;
}

/** Whether a point's on a finished road. */
export function onRoad(s: ShoreState, p: Pt): boolean {
  return roadWalk(s, p) > 1;
}

function stepRoads(state: GameState, s: ShoreState, k: number): void {
  for (const v of s.villages) {
    if (!v.road || !ruled(v)) continue;
    const w = v.road.up ?? (roadDone(v) ? null : v.road);
    if (!w) continue;
    // (The chief among the crew: twice the work.)
    w.done = Math.min(w.need, w.done + k * (chiefWithCrew(s, v) ? 2 : 1) * (1 + boosts(s).crew));
    if (w.done < w.need) continue;
    if (v.road.up) {
      v.road.up = undefined;
      v.road.tier = roadTier(v) + 1;
      s.news.push(`The road to ${v.name} is a ${ROAD_TIERS[v.road.tier].name.toLowerCase()} now.`);
      record(state, `The road to ${v.name} was relaid as a ${ROAD_TIERS[v.road.tier].name.toLowerCase()}, and quicker for it.`, 'shore', shoreWhen(s));
    } else {
      s.news.push(`The road to ${v.name} is done.`);
      record(state, `The road to ${v.name} was finished. What took days to walk now takes half of them.`, 'shore', shoreWhen(s));
    }
  }
}

/** A trade along a finished road: what goes out each day, and what comes back. */
export type Trade = { give: 'food' | 'wood'; n: number; get: 'food' | 'wood' | Res; m: number };
export function tradesWith(v: Village): Trade[] {
  return [
    ...landGoods(v).map((r): Trade => ({ give: 'food', n: 8, get: r, m: 3 })),
    { give: 'food', n: 10, get: 'wood', m: 8 },
    { give: 'wood', n: 8, get: 'food', m: 10 },
  ];
}
export function setTrade(state: GameState, id: number, i: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !v.vassal || !roadDone(v)) return false;
  const tr = i < 0 ? undefined : tradesWith(v)[i];
  v.trade = tr;
  if (tr) record(state, `A caravan began to go to ${v.name} each day, ${tr.n} ${tr.give} out, ${tr.m} ${tradeWord(tr.get)} back.`, 'shore', shoreWhen(s));
  return true;
}
export function tradeWord(r: Trade['get']): string {
  return r === 'food' || r === 'wood' ? r : RES_NAME[r].toLowerCase();
}

/** Each dawn on the roads: the caravans set out (if there's enough to spare), and things happen
 * at the waystations: wanderers, things left by the way, and (with no watch post, and raiders
 * about) ambushes. */
function roadDawn(state: GameState, s: ShoreState, eat: number): void {
  const now = s.day + s.clock / DAY_SEC;
  for (const v of s.villages) {
    if (!ruled(v) || !roadDone(v)) continue;
    const tr = v.vassal ? v.trade : undefined;
    if (tr) {
      const have = tr.give === 'food' ? s.food : s.wood;
      const keep = tr.give === 'food' ? eat * 3 : burnPerDay(s) * 3;
      if (have - tr.n >= keep) {
        if (tr.give === 'food') s.food -= tr.n;
        else s.wood -= tr.n;
        const m = Math.round(tr.m * (1 + boosts(s).trade) * 10) / 10;
        const back = tr.get === 'food' || tr.get === 'wood' ? { food: tr.get === 'food' ? m : 0, wood: tr.get === 'wood' ? m : 0 } : { food: 0, wood: 0, res: { [tr.get]: m } };
        (s.convoys ??= []).push({ from: v.id, ...back, left: now, arrives: now + travelDays(s, v) * 2, caravan: true });
      }
    }
    const rand = rng(s.seed * 59 + s.day * 17 + v.id * 5);
    const roll = rand();
    const at = `the waystation on the road to ${v.name}`;
    const raiders = s.villages.some((x) => !x.gone && (relation(s, x) === 'predator' || relation(s, x) === 'enemy') && !x.vassal && x.settled === undefined && (x.beaten ?? 0) < 3);
    if (roll < 0.08 * (1 + boosts(s).wander) && roomLeft(s) > 0) {
      const id = s.nextId++;
      const name = nameFrom(rand);
      s.people.push({ id, name, born: now - GROW_DAYS - rand() * 10, dies: now + 50 + rand() * 30, kind: v.id, joined: now, genes: personal(undefined, id * 31 + v.id) });
      s.news.push(`A wanderer at ${at} asked to join you: ${name}.`);
      record(state, `${name}, a wanderer met at ${at}, came to live by the hearth.`, 'shore', shoreWhen(s));
    } else if (roll < 0.08 * (1 + boosts(s).wander) + 0.1) {
      const food = Math.round(8 + rand() * 12);
      s.food = Math.min(foodCap(s), s.food + food);
      s.news.push(`Travellers left ${food} food at ${at}, for the hearth.`);
    } else if (roll < 0.08 * (1 + boosts(s).wander) + 0.16 && raiders && !count(s, 'watch')) {
      const lost = s.convoys?.find((c) => c.from === v.id && c.arrives > now);
      if (lost) {
        s.convoys = s.convoys!.filter((c) => c !== lost);
        s.news.push(`Raiders fell on the road to ${v.name}, and took what was on it.`);
        record(state, `Raiders lay in wait on the road to ${v.name} and took what was being carried. A watch post would have seen them.`, 'shore', shoreWhen(s));
      }
    }
  }
}

/** A settlement's trade: a bit of everything, or mostly one thing. */
export type SettleFocus = 'mixed' | 'food' | 'wood' | 'goods';
export const FOCI: { id: SettleFocus; name: string; food: number; wood: number; goods: number }[] = [
  { id: 'mixed', name: 'A bit of all', food: 0.45, wood: 0.22, goods: 0 },
  { id: 'food', name: 'Food', food: 0.7, wood: 0.08, goods: 0 },
  { id: 'wood', name: 'Wood', food: 0.2, wood: 0.5, goods: 0 },
  { id: 'goods', name: 'Their land\'s goods', food: 0.25, wood: 0.08, goods: 0.08 },
];

/** What a settlement asks: food, wood, something of what the hearth has, or the chief in person. */
export type SettleAsk = { kind: 'food' | 'wood' | 'visit' | Res; n: number; since: number; until: number };

/** How big a settlement's grown: a camp, a village (15), a town (35). */
export const STAGES = ['camp', 'village', 'town'] as const;
export function stageOf(v: Village): number {
  return v.pop >= 35 ? 2 : v.pop >= 15 ? 1 : 0;
}

/** What their land gives besides fish (the goods a settlement can make its trade). */
export function landGoods(v: Village): Res[] {
  return v.habitat ? RES_OF[v.habitat].filter((r) => r !== 'fish') : [];
}

/** A settlement's day: what it sends to the hearth, and how it grows. (More, thriving, or a
 * town; less, sulking. A town holds more of them.) */
export function settledDay(v: Village, now = 0, s?: ShoreState): { food: number; wood: number; res: Partial<Record<Res, number>>; growth: number } {
  const f = FOCI.find((x) => x.id === (v.focus ?? 'mixed')) ?? FOCI[0];
  const thriving = (v.thrive ?? -1) > now;
  const sulking = (v.sulk ?? -1) > now;
  const road = roadPerks(v);
  const b = s ? boosts(s) : undefined;
  const k = (thriving ? 1.5 : 1) * (sulking ? 0.5 : 1) * (stageOf(v) === 2 ? 1.25 : 1) * road.output * (1 + (b?.tribute ?? 0));
  const res: Partial<Record<Res, number>> = {};
  if (f.goods) for (const r of landGoods(v)) res[r] = v.pop * f.goods * k;
  const most = stageOf(v) === 2 ? 100 : 70;
  return { food: v.pop * f.food * k, wood: v.pop * f.wood * k, res, growth: sulking ? 0 : v.pop * 0.05 * (thriving ? 2 : 1) * road.growth * (1 + (b?.settleGrow ?? 0)) * Math.max(0, 1 - v.pop / most) };
}

/** The chief, there in person, sets a settlement's trade. */
export function setSettleFocus(state: GameState, id: number, focus: SettleFocus): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || v.settled === undefined || v.gone || !chiefNear(s, v)) return false;
  if (focus === 'goods' && !landGoods(v).length) return false;
  if ((v.focus ?? 'mixed') === focus) return true;
  v.focus = focus;
  record(state, `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} asked ${v.name} to turn their hands to ${FOCI.find((x) => x.id === focus)!.name.toLowerCase()}.`, 'shore', shoreWhen(s));
  return true;
}

/** Days a settlement waits on what it asked; days helped settlements thrive, and let-down ones
 * sulk. */
const ASK_DAYS = 4;
const THRIVE_DAYS = SEASON_DAYS;
const SULK_DAYS = 3;
/** Loyalty a vassal's request answered wins (and, unanswered, loses). */
const ASK_LOYALTY = 10;

/** What the hearth would hand over, for what's asked. */
function askHave(s: ShoreState, a: SettleAsk): number {
  return a.kind === 'food' ? s.food : a.kind === 'wood' ? s.wood : a.kind === 'visit' ? 0 : s.res?.[a.kind] ?? 0;
}
export function canAnswer(s: ShoreState, v: Village): boolean {
  return !!v.ask && v.ask.kind !== 'visit' && askHave(s, v.ask) >= v.ask.n;
}

/** Each dawn, a settlement may ask something of the hearth (now and then), and one kept waiting
 * too long sulks. */
function settledAsks(state: GameState, s: ShoreState): void {
  const now = s.day + s.clock / DAY_SEC;
  for (const v of s.villages) {
    if (!ruled(v)) continue;
    // Grown into a village, a town: worth telling.
    const st = stageOf(v);
    if (v.settled !== undefined && st > (v.stage ?? 0)) {
      s.news.push(`${cap(v.name)} have grown into a ${STAGES[st]}.`);
      record(state, `${cap(v.name)} grew into a ${STAGES[st]}${st === 2 ? ', with a fence round it and more to give' : ''}.`, 'shore', shoreWhen(s));
    }
    if (v.settled !== undefined) v.stage = Math.max(v.stage ?? 0, st);
    if (v.ask && now > v.ask.until) {
      // (A settlement sulks; a vassal's loyalty suffers.)
      if (v.vassal) v.vassal.loyalty = Math.max(0, v.vassal.loyalty - ASK_LOYALTY);
      else v.sulk = now + SULK_DAYS;
      s.news.push(`${cap(v.name)} are sore that no one came.`);
      record(state, `${cap(v.name)} asked the hearth for ${askWords(v.ask)}, and no one came. They were sore about it.`, 'shore', shoreWhen(s));
      v.ask = undefined;
      v.askNext = now + 5;
      continue;
    }
    const rand = rng(s.seed * 41 + s.day * 13 + v.id * 3);
    v.askNext ??= now + 3 + rand() * 4;
    if (v.ask || now < v.askNext) continue;
    const kinds: SettleAsk['kind'][] = ['food', 'wood', 'visit'];
    for (const r of Object.keys(s.res ?? {}) as Res[]) if ((s.res?.[r] ?? 0) >= 6 && !landGoods(v).includes(r) && r !== 'fish') kinds.push(r);
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const n = kind === 'food' ? Math.round(10 + v.pop * 0.8) : kind === 'wood' ? Math.round(8 + v.pop * 0.5) : kind === 'visit' ? 0 : 6;
    v.ask = { kind, n, since: now, until: now + ASK_DAYS };
    s.news.push(`${cap(v.name)} ask the hearth for ${askWords(v.ask)}.`);
  }
}

export function askWords(a: SettleAsk): string {
  return a.kind === 'visit' ? 'a visit from the chief' : `${a.n} ${a.kind === 'food' || a.kind === 'wood' ? a.kind : RES_NAME[a.kind].toLowerCase()}`;
}

/** What's asked, given: they thrive for a season, and now and then one of their young comes to
 * live by the hearth. */
export function answerAsk(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v?.ask) return false;
  const a = v.ask;
  if (a.kind === 'visit' ? !chiefNear(s, v) : askHave(s, a) < a.n) return false;
  if (a.kind === 'food') s.food -= a.n;
  else if (a.kind === 'wood') s.wood -= a.n;
  else if (a.kind !== 'visit') s.res![a.kind] = (s.res![a.kind] ?? 0) - a.n;
  const now = s.day + s.clock / DAY_SEC;
  v.ask = undefined;
  v.sulk = undefined;
  // (A settlement thrives for it; a vassal grows the more loyal.)
  if (v.vassal) {
    v.vassal.loyalty = Math.min(100, v.vassal.loyalty + ASK_LOYALTY);
    v.vassal.warm = Math.min(WARM_MAX, (v.vassal.warm ?? 0) + 10);
  } else v.thrive = now + THRIVE_DAYS;
  v.askNext = now + 5 + rng(s.seed + v.id * 7 + s.day)() * 5;
  s.news.push(`${cap(v.name)} are glad of it, and thriving.`);
  record(state, `${a.kind === 'visit' ? `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} came to ${v.name} when they asked` : `The hearth sent ${v.name} ${askWords(a)} when they asked`}, and ${v.vassal ? 'were the more loyal' : 'they thrived'} for it.`, 'shore', shoreWhen(s));
  return true;
}

/** Goods on the road from the settlements (and the vassals) to the hearth. */
function stepSettled(state: GameState, s: ShoreState, k: number): void {
  for (const v of s.villages) {
    if (v.settled === undefined || v.gone) continue;
    const d = settledDay(v, s.day + s.clock / DAY_SEC, s);
    v.pop += d.growth * k;
    const load = (v.load ??= { food: 0, wood: 0 });
    load.food += d.food * k;
    load.wood += d.wood * k;
    for (const [r, n] of Object.entries(d.res) as [Res, number][]) (load.res ??= {})[r] = (load.res[r] ?? 0) + n * k;
    // (Asked for the chief: the chief's being there is the answer.)
    if (v.ask?.kind === 'visit' && chiefNear(s, v)) answerAsk(state, v.id);
  }
}

/** Each dawn, what's gathered at each settlement sets out for the hearth, arriving days later. */
function sendConvoys(s: ShoreState): void {
  const now = s.day + s.clock / DAY_SEC;
  for (const v of s.villages) {
    if (!v.load || (v.load.food < 0.5 && v.load.wood < 0.5)) continue;
    const res = v.load.res && Object.fromEntries(Object.entries(v.load.res).map(([r, n]) => [r, Math.round(n * 10) / 10]));
    (s.convoys ??= []).push({ from: v.id, food: Math.round(v.load.food * 10) / 10, wood: Math.round(v.load.wood * 10) / 10, res, left: now, arrives: now + travelDays(s, v) });
    v.load = undefined;
  }
}

function stepConvoys(s: ShoreState): void {
  if (!s.convoys?.length) return;
  const now = s.day + s.clock / DAY_SEC;
  for (const c of s.convoys) {
    if (c.arrives > now) continue;
    s.food = Math.min(foodCap(s), s.food + c.food);
    s.wood = Math.min(woodCap(s), s.wood + c.wood);
    for (const [r, n] of Object.entries(c.res ?? {}) as [Res, number][]) (s.res ??= {})[r] = Math.min(resCap(s), (s.res[r] ?? 0) + n);
  }
  s.convoys = s.convoys.filter((c) => c.arrives > now);
}

/** Where the chief can gather each of the land's goods by hand (slowly), with no village of
 * yours to bring it: reeds at a lake or marsh, clay by a river, salt on a beach, and so on. So
 * no island leaves a building out of reach. */
export const RES_GROUND: Partial<Record<Res, { biomes: number[]; where: string }>> = {
  reeds: { biomes: [Biome.Lake, Biome.Marsh, Biome.River], where: 'by a lake, marsh or river' },
  clay: { biomes: [Biome.River, Biome.Marsh], where: 'by a river or in a marsh' },
  salt: { biomes: [Biome.Sand, Biome.Desert], where: 'on a beach, or in the desert' },
  herbs: { biomes: [Biome.Marsh, Biome.Scrub], where: 'in a marsh, or in the scrub' },
  timber: { biomes: [Biome.Forest], where: 'in the woods' },
  flint: { biomes: [Biome.Rock, Biome.Scrub], where: 'among rocks, or in the scrub' },
  stone: { biomes: [Biome.Rock, Biome.High, Biome.Peak], where: 'in the hills and rocks' },
};
/** Seconds of the chief's gathering for each one gathered. */
const GATHER_SEC = 5;

/** What the chief could gather standing here: the goods the ground round about gives. */
export function gatherHere(s: ShoreState): Res[] {
  const is = shoreIsland(s.seed);
  const seen = new Set<number>();
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const x = Math.round(s.chiefAt.x + i);
    const y = Math.round(s.chiefAt.y + j);
    if (x >= 0 && y >= 0 && x < is.n && y < is.n) seen.add(is.biome[y * is.n + x]);
  }
  return (Object.keys(RES_GROUND) as Res[]).filter((r) => RES_GROUND[r]!.biomes.some((b) => seen.has(b)));
}

/** The chief standing still: what the ground round about gives, gathered by hand (the one the
 * hearth has least of first; not at a landmark being explored, not past what can be kept). */
function chiefGathers(state: GameState, s: ShoreState, dt: number): void {
  if (s.chiefTo || poiHere(s) || !count(s, 'hearth')) return;
  const cap = resCap(s);
  // (Only what no village of yours brings: they're the way to have it, the chief's hands the stopgap.)
  const can = gatherHere(s).filter((r) => (s.res?.[r] ?? 0) < cap && !sourcesOf(s, r).length);
  if (!can.length) return;
  const r = can.sort((a, b) => (s.res?.[a] ?? 0) - (s.res?.[b] ?? 0))[0];
  (s.res ??= {})[r] = Math.min(cap, (s.res[r] ?? 0) + dt / GATHER_SEC);
  if (!s.gathered?.includes(r)) {
    (s.gathered ??= []).push(r);
    s.news.push(`${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} is gathering ${RES_NAME[r].toLowerCase()} by hand.`);
    record(state, `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} gathered ${RES_NAME[r].toLowerCase()} by hand, ${RES_GROUND[r]!.where}, with no village to bring it.`, 'shore', shoreWhen(s));
  }
}

/** Villages you hold that give a resource. */
export function sourcesOf(s: ShoreState, r: Res): Village[] {
  return s.villages.filter((v) => held(v) && RES_OF[v.habitat!].includes(r));
}

/** Whether there's enough of what a building needs beyond wood. */
export function hasNeeds(s: ShoreState, id: BuildId): boolean {
  const needs = BUILDS.find((b) => b.id === id)!.needs ?? {};
  return (Object.keys(needs) as Res[]).every((r) => (s.res?.[r] ?? 0) >= (needs[r] ?? 0));
}

function stepResources(s: ShoreState, k: number): void {
  for (const v of s.villages) {
    if (!held(v)) continue;
    const share = v.vassal ? 0.5 + v.vassal.tax : 1;
    for (const r of RES_OF[v.habitat!]) {
      if (r === 'fish') s.food = Math.min(foodCap(s), s.food + FISH_FOOD * share * k);
      else (s.res ??= {})[r] = Math.min(resCap(s), (s.res?.[r] ?? 0) + RES_DAY * share * k);
    }
  }
}

/** Builds on offer now: unlocked, and not at their limit. */
export function buildsOpen(s: ShoreState): typeof BUILDS {
  return BUILDS.filter((b) => (!isGreatWork(b.id) || (workReady(s) && greatWork(s) === b.id)) && (!b.age || (s.culture?.age ?? 0) >= b.age) && (!b.idea || !!s.culture?.done.includes(b.idea)) && (!b.after || count(s, b.after) > 0) && (!b.learn || learned(s, b.id)) && (b.max === undefined || count(s, b.id) + (s.building?.id === b.id ? 1 : 0) < b.max));
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
/** Work a builder does a second. */
const BUILD_RATE = 0.28;

/** How many are at the building (taken off gathering while it goes up): a few, more in a
 * bigger village. */
export function builders(s: ShoreState): number {
  if (!s.building) return 0;
  const adults = grownCount(s);
  return Math.max(Math.min(1, adults), Math.min(6, Math.round(adults * 0.2)));
}

/** The work a building takes: more for a bigger one, and more the further out it goes (the
 * wood hauled from the stores by the hearth, and the ground cleared). */
function buildWork(s: ShoreState, id: BuildId, at: Pt): number {
  const d = Math.hypot(at.x - s.hearth.x, at.y - s.hearth.y);
  return (20 + buildCost(s, id) * 1.5) * (1 + d / 40);
}

/** Seconds left on what's going up, at the pace the builders are going. */
export function buildLeftSec(s: ShoreState): number {
  return s.building ? s.building.left / Math.max(0.01, builders(s) * BUILD_RATE * (1 + networkBonus(s) + boosts(s).build)) : 0;
}

// ---- Firewood and the woods ----

/** The woods round the village, at most (wood still standing to be cut), and how fast they grow
 * back a day on their own and with each forester. */
export const FOREST_MAX = 400;
const REGROW = 3;
const REGROW_FORESTER = 10;

/** Firewood the village burns a day (the hearth, homes kept warm): twice as much in winter. */
export function burnPerDay(s: ShoreState): number {
  let b = 0;
  for (const def of BUILDS) if (def.burn) b += def.burn * count(s, def.id);
  return b * (shoreSeason(s).si === 3 ? 2 : 1);
}

/** How thick the woods round the village still are (0 to 1); cutting's slower as they thin. */
export function forestShare(s: ShoreState): number {
  return (s.forest ?? FOREST_MAX) / FOREST_MAX;
}

/** Whether there's the wood (and whatever else) for it. (Half a log short is near enough: the
 * fires nibble at a full woodpile, and a build costing what it holds should still go up.) */
export function canPay(s: ShoreState, id: BuildId): boolean {
  return s.wood + 0.5 >= buildCost(s, id) && hasNeeds(s, id);
}

/** Starts a building (one at a time: it goes up over a while, then it's there). */
export function build(state: GameState, id: BuildId): boolean {
  const s = shoreOf(state);
  if (!s || s.building || !buildsOpen(s).some((b) => b.id === id)) return false;
  const cost = buildCost(s, id);
  if (!canPay(s, id)) return false;
  s.wood = Math.max(0, s.wood - cost);
  const needs = BUILDS.find((b) => b.id === id)!.needs ?? {};
  for (const r of Object.keys(needs) as Res[]) s.res![r] = (s.res?.[r] ?? 0) - (needs[r] ?? 0);
  const at = placeFor(s, id, shoreIsland(s.seed));
  const total = buildWork(s, id, at);
  s.building = { id, ...at, left: total, total };
  return true;
}

/** What the elders would build next, by what you've said matters most (null: nothing yet, or
 * they're saving up for what's needed). */
export function stewardPick(s: ShoreState): BuildId | null {
  return elderThink(s).pick;
}

/** The elders' word when the building's left to the chief. */
export const ELDERS_OFF = { pick: null, why: 'off' as ElderWhy, text: '"The chief builds. We only watch, and remember."' };

/** The elders' thinking: what they'd build next and why, or why they're waiting, in their words. */
export function elderThink(s: ShoreState): { pick: BuildId | null; why: ElderWhy; text: string } {
  const name = (id: BuildId) => buildName(id, s.look.diet).toLowerCase();
  const an = (id: BuildId) => `${/^[aeiou]/.test(name(id)) ? 'an' : 'a'} ${name(id)}`;
  const An = (id: BuildId) => an(id).charAt(0).toUpperCase() + an(id).slice(1);
  if (s.building) return { pick: null, why: 'busy', text: `"The ${name(s.building.id)} is going up. Nothing more until it stands."` };
  const open = new Set(buildsOpen(s).map((b) => b.id));
  if (open.has('hearth')) return { pick: 'hearth', why: 'hearth', text: '"First, a fire."' };
  const plan = workPlan(s);
  const free = room(s) - s.people.length;
  const homes = (): BuildId | null => (room(s) >= hearthMost(s) ? null : open.has('longhouse') && buildCost(s, 'longhouse') / 12 < buildCost(s, 'hut') / 4 ? 'longhouse' : open.has('hut') ? 'hut' : null);
  const food = (): BuildId | null => (open.has('weir') && buildCost(s, 'weir') < buildCost(s, 'camp') ? 'weir' : open.has('camp') ? 'camp' : null);
  // Stores: whichever holds the most food for its wood (that they have what it needs for).
  const HOLDS: [BuildId, number][] = [['rack', 40], ['granary', 120], ['pottery', 100], ['salter', 40]];
  // (Stores: when the food's near full, or the stock the season asks for won't fit.)
  const want = stockTargets(s, plan.eat).want;
  // (Never past what's worth keeping: twelve days' eating, or the season's stock if more.)
  const enough = foodCap(s) >= Math.max(want, plan.eat * 12);
  const stores = (): BuildId | null =>
    !enough && (s.food >= foodCap(s) * 0.9 || (foodCap(s) < want && s.food >= foodCap(s) * 0.7)) ? HOLDS.filter(([id]) => open.has(id) && hasNeeds(s, id)).sort((a, b) => buildCost(s, a[0]) / a[1] - buildCost(s, b[0]) / b[1])[0]?.[0] ?? null : null;
  const p = s.steward?.plan ?? 'balanced';
  const homesW: [ElderWhy, () => BuildId | null] = ['homes', () => (free <= (p === 'homes' ? 4 : 2) ? homes() : null)];
  const foodW: [ElderWhy, () => BuildId | null] = ['food', () => (plan.food > plan.land - (p === 'food' ? 2 : 0) ? food() : null)];
  const storesW: [ElderWhy, () => BuildId | null] = ['stores', stores];
  // Going hungry (not just winter's lean), more gathering ground comes before anything.
  const starving = s.hungry > 0 || (plan.foodRate < plan.eat && s.food < plan.eat * 3);
  const hungerW: [ElderWhy, () => BuildId | null] = ['food', () => (starving ? food() : null)];
  const wants = [hungerW, ...(p === 'homes' ? [homesW, foodW] : p === 'food' ? [foodW, homesW, storesW] : p === 'stores' ? [storesW, homesW, foodW] : [homesW, foodW, storesW])];
  // Come autumn they keep wood back for the winter's fires (six days of it).
  const si = shoreSeason(s).si;
  const reserve = si >= 2 ? burnPerDay(s) * (si === 3 ? 1 : 2) * 6 : 0;
  const short = (id: BuildId) => !canPay(s, id) || s.wood + 0.5 - buildCost(s, id) < (id === 'forester' || id === 'woodpile' ? 0 : reserve);
  const go = (id: BuildId, why: ElderWhy, text: string) => {
    if (!short(id)) return { pick: id, why, text };
    if (canPay(s, id)) return { pick: null, why: 'winter' as ElderWhy, text: `"${text.slice(1, -1)} But ${si === 3 ? 'it is winter' : 'winter is coming'}, and the fires come first: we keep back ${Math.ceil(reserve)} wood for them."` };
    const needs = BUILDS.find((d) => d.id === id)!.needs;
    const lacking = needs && !hasNeeds(s, id) ? Object.keys(needs).map((r) => RES_NAME[r as Res].toLowerCase()).join(' and ') : '';
    return { pick: null, why: 'saving' as ElderWhy, text: `"${text.slice(1, -1)} ${lacking ? `We have not the ${lacking} for it.` : `We are saving wood for it: ${Math.floor(s.wood)} of ${buildCost(s, id)}.`}"` };
  };
  // The woods thinning: a forester, before anything else.
  if (open.has('forester') && forestShare(s) < 0.5 && count(s, 'forester') < 1 + s.people.length / 30) return go('forester', 'forest', '"The woods round the village are thinning. Someone must plant, or our children will have nothing to burn."');
  const SAY: Partial<Record<ElderWhy, (id: BuildId) => string>> = {
    homes: (id) => `"There are not beds enough for children to come. ${An(id)}."`,
    food: (id) => `"The land near the hearth feeds only so many gatherers. ${An(id)}, to feed more."`,
    stores: (id) => `"Food spoils with nowhere to keep it. ${An(id)}."`,
  };
  for (const [why, w] of wants) {
    const need = w();
    if (!need) continue;
    // More than the woodpiles hold: a woodpile first.
    if (buildCost(s, need) + reserve > woodCap(s) && open.has('woodpile')) return go('woodpile', 'woodpile', `"We need ${an(need)}, but the woodpiles cannot hold the wood for it. Another woodpile first."`);
    return go(need, why, SAY[why]!(need));
  }
  // Nothing pressing: something useful, if the wood's piling up. By use, not by cheapness (and
  // never another woodpile just to hold more: that's only for a build that won't fit).
  // (Every building they know is weighed here or above: the hearth, homes, food, stores and
  // woodpiles, and the forester, when they're needed; the rest when there's wood to spare. All
  // but war: the watch post, arms and the palisade are the chief's to decide, like every fight.)
  const unseen = s.villages.some((v) => !v.found) || poisOf(s).some((q) => !q.found);
  const useful: [BuildId, boolean][] = [
    ['council', true],
    ['envoy', s.villages.some((v) => canWin(s, v))],
    ['elders', true],
    ['thatcher', true],
    ['pool', true],
    ['healer', true],
    ['toolmaker', true],
    ['salter', true],
    ['forester', forestShare(s) < 0.8 && count(s, 'forester') < 1 + s.people.length / 30],
    ['scout', unseen && count(s, 'scout') < 2],
    ['granary', !enough && s.food >= foodCap(s) * 0.7],
    ['pottery', !enough && s.food >= foodCap(s) * 0.7],
    ['cutter', plan.wood >= 3 && count(s, 'cutter') < 1 + s.people.length / 30],
    ['weir', plan.food > plan.land - 3],
    ['camp', plan.food > plan.land - 3],
    ['lookout', true],
    ['trails', true],
    ['longhouse', free <= 6 && room(s) < hearthMost(s)],
    // (The Village Age's: the workshop and the shrine whenever there's what they need; the
    // market once there are caravans or villages sending; a kiln when the stores are filling.)
    ['workshop', true],
    ['shrine', s.villages.some((v) => v.vassal && !v.gone)],
    ['market', s.villages.some((v) => ruled(v))],
    ['kiln', !enough || Object.values(s.res ?? {}).some((n) => (n ?? 0) >= resCap(s) - 5)],
  ];
  // Spare: what's left after a few days' firewood (and, come autumn, the winter's).
  const keep = Math.max(5, burnPerDay(s) * WOOD_KEEP_DAYS) + reserve;
  // (Nothing for comfort while they're hungry.)
  const next = starving ? undefined : useful.find(([id, worth]) => worth && open.has(id) && hasNeeds(s, id))?.[0];
  if (next && s.wood + 0.5 - buildCost(s, next) >= keep) return { pick: next, why: 'spare', text: `"Nothing presses, and there's wood to spare. ${An(next)} would serve us."` };
  // (More than the woodpiles will ever hold, with what's kept back: a woodpile first.)
  if (next && buildCost(s, next) + keep > woodCap(s) && open.has('woodpile')) return go('woodpile', 'woodpile', `"${An(next)} would serve us, but the woodpiles cannot hold the wood for it. Another woodpile first."`);
  // What they'd see to next, and when.
  const soon: string[] = [];
  if (open.has('hut') || open.has('longhouse')) soon.push(free > 2 ? `when only two beds are left (${free} free now), ${an(homes() ?? 'hut')}` : '');
  if (next) soon.push(`with ${Math.ceil(buildCost(s, next) + keep)} wood put by, ${an(next)}`);
  const then = soon.filter(Boolean).join('; ');
  if (reserve > 0 && s.wood < reserve * 1.5) return { pick: null, why: 'winter', text: `"Nothing presses. ${si === 3 ? 'It is winter' : 'Winter is coming'}: the wood is for the fires.${then ? ` After, ${then}.` : ''}"` };
  return { pick: null, why: 'content', text: `"All is well. There are beds, and food, and wood.${then ? ` Next, ${then}.` : ' We wait, and watch.'}"` };
}

/** The elders' thoughts, kept when they change (what they're waiting on, mostly); the Chronicle
 * hears of it when they start keeping wood back for the winter, or the woods thin. */
function noteElders(state: GameState, s: ShoreState, think: ReturnType<typeof elderThink>): void {
  const log = (s.elders ??= []);
  const last = log[log.length - 1];
  if (think.why === 'busy') return;
  if (last && last.why === think.why && (think.why !== 'saving' || last.text.split(':')[0] === think.text.split(':')[0])) return;
  log.push({ when: shoreWhen(s), why: think.why, text: think.text });
  if (log.length > 40) log.splice(0, log.length - 40);
  const y = Math.floor((s.day + s.clock / DAY_SEC) / (SEASON_DAYS * 4));
  if (think.why === 'winter') tellOnce(state, s, `winter${y}`, 'The elders kept back wood for the winter fires.');
}

export function setSteward(state: GameState, on: boolean, plan?: StewardPlan): void {
  const s = shoreOf(state);
  if (!s || !count(s, 'council')) return;
  const was = s.steward;
  s.steward = { on, plan: plan ?? s.steward?.plan ?? 'balanced' };
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  if (was?.on !== on) record(state, on ? `${chief} left the building to the elders.` : `${chief} took the building back from the elders.`, 'shore', shoreWhen(s));
  else if (was?.plan !== s.steward.plan) record(state, `${chief} told the elders ${PLAN_SAYS[s.steward.plan]}.`, 'shore', shoreWhen(s));
}

function finishBuilding(state: GameState, s: ShoreState): void {
  const b = s.building!;
  s.building = undefined;
  s.built.push({ id: b.id, x: b.x, y: b.y, day: s.day + s.clock / DAY_SEC });
  if (b.id === 'council') s.steward ??= { on: true, plan: 'balanced' };
  if (isGreatWork(b.id)) ageOver(state, s);
  if (b.id === 'hearth') {
    s.news.push(SHORE_STORY.hearth);
    record(state, 'The hearth was lit.', 'shore', shoreWhen(s));
  } else {
    const name = buildName(b.id, s.look.diet).toLowerCase();
    s.news.push(`The ${name} is built.`);
    const n = count(s, b.id);
    const def = BUILDS.find((d) => d.id === b.id)!;
    const what = def.max === 1 ? `The ${name} was raised` : n === 1 ? `The first ${name} was raised` : `Another ${name} was raised (${n} now)`;
    record(state, b.why ? `The elders ${ELDER_SAW[b.why]}: ${what.charAt(0).toLowerCase() + what.slice(1)}.` : `${what}.`, 'shore', shoreWhen(s));
  }
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
  if (!s || s.lean === lean) return;
  s.lean = lean;
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  record(state, lean === 'food' ? `${chief} sent more of them out for food.` : lean === 'wood' ? `${chief} sent more of them to cut wood.` : `${chief} let them share the work as they saw fit.`, 'shore', shoreWhen(s));
}

/** When something happened, for the Chronicle: the season and the year since they landed. */
export function shoreWhen(s: ShoreState): string {
  const year = Math.floor((s.day + s.clock / DAY_SEC) / (SEASON_DAYS * 4)) + 1;
  return `Year ${year}, ${SEASON_NAMES[shoreSeason(s).si]}`;
}

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Tells the Chronicle something once (until it's forgotten with `untell`, to be told again). */
function tellOnce(state: GameState, s: ShoreState, key: string, text: string): void {
  const told = (s.told ??= []);
  if (told.includes(key)) return;
  told.push(key);
  record(state, text, 'shore', shoreWhen(s));
}
function untell(s: ShoreState, key: string): void {
  if (s.told?.includes(key)) s.told = s.told.filter((k) => k !== key);
}

/** What the village means to keep in store (the work's planned toward it, the elders make room
 * for it, the envoy and the war chief leave it be): food, a few days' eating (ten come autumn,
 * against the winter; four in it); wood, the fires' (at winter's rate from autumn) and enough to
 * build with. `want` is the food the season asks for, whether or not the stores hold it. */
export function stockTargets(s: ShoreState, eat?: number): { food: number; wood: number; burn: number; want: number } {
  const si = shoreSeason(s).si;
  const e = eat ?? s.people.reduce((a, p) => a + (isAdult(s, p) ? EAT : EAT_CHILD), 0);
  const burn = burnPerDay(s) * (si === 2 ? 2 : 1);
  const want = e * (si === 2 ? 10 : si === 3 ? 4 : 6);
  return { food: Math.min(foodCap(s) * 0.95, want), wood: Math.min(woodCap(s) * 0.95, Math.max(burn * 8, woodCap(s) * 0.6)), burn, want };
}

/** The village's day: how many work at food and at wood, and what that brings in. */
type Plan = { food: number; wood: number; rest?: number; eat: number; foodRate: number; woodRate: number; land: number };
/** The plan, kept for the moment it was made in (it's asked for several times a step; anything
 * it depends on changing makes it again). */
const planCache = new WeakMap<ShoreState, { k: unknown[]; plan: Plan }>();
export function workPlan(s: ShoreState): Plan {
  const k = [s.day * DAY_SEC + s.clock, s.food, s.wood, s.people.length, s.built.length, s.building?.id, s.warband?.fighters, s.lean, s.forest, s.culture?.done.length, s.relics?.length];
  const hit = planCache.get(s);
  if (hit && hit.k.every((v, i) => v === k[i])) return hit.plan;
  const plan = makePlan(s);
  planCache.set(s, { k, plan });
  return plan;
}

function makePlan(s: ShoreState): Plan {
  const grown = grownCount(s);
  const kids = s.people.length - grown;
  const eat = grown * EAT + kids * EAT_CHILD;
  // (Those building aren't gathering.)
  const adults = Math.max(0, grown - builders(s) - away(s));
  const bo = boosts(s);
  const foodEach = FOOD_PER * (1 + 0.1 * count(s, 'camp') + bo.food) * seasonFood(s);
  // Cutting's slower as the woods round the village thin out.
  const woodEach = WOOD_PER * (1 + 0.1 * count(s, 'cutter') + bo.wood) * Math.max(0.25, Math.min(1, forestShare(s) * 2));
  // Planned by need. Food: enough to eat, and the stores brought up toward a few days' eating
  // (more come autumn, against the winter; less in it, when gathering's poor). Wood: the fires
  // (from autumn, at winter's doubled rate), and the woodpiles kept well stocked for building.
  // Each stock is refilled over a few days, not all at once. Then the lean tips it.
  const land = landFor(s);
  const fCap = foodCap(s);
  const wCap = woodCap(s);
  const { food: foodTarget, wood: woodTarget, burn } = stockTargets(s, eat);
  const tip = s.lean === 'food' ? [1.35, 0.75] : s.lean === 'wood' ? [0.8, 1.35] : [1, 1];
  let needF = ((eat + Math.max(0, foodTarget - s.food) / 3) / foodEach) * tip[0];
  let needW = ((burn + Math.max(0, woodTarget - s.wood) / 3) / woodEach) * tip[1];
  // (Past what the land feeds, gatherers bring in little: unless they're hungry, no more than
  // the land takes.)
  if (s.food > eat * 2) needF = Math.min(needF, land);
  if (s.wood >= wCap - 0.5) needW = Math.min(needW, burn / woodEach);
  let food: number;
  if (needF + needW <= adults) {
    // Hands to spare: where they'll count (food while the land and the stores have room, else
    // wood; with both full, they gather a little and rest).
    food = Math.ceil(needF);
    const spare = adults - food - Math.ceil(needW);
    if (spare > 0 && s.food < fCap - 0.5 && food < land) food += Math.min(spare, Math.max(0, land - food));
  } else {
    // Short-handed: eating first, then the fires, then the rest by need.
    const eatHands = Math.min(adults, Math.ceil(eat / foodEach));
    const fireHands = s.food > eat * 2 ? Math.min(adults - eatHands, Math.ceil(burn / woodEach)) : 0;
    const left = adults - eatHands - fireHands;
    const extraF = Math.max(0, needF - eatHands);
    const extraW = Math.max(0, needW - fireHands);
    food = eatHands + Math.round(left * (extraF + extraW > 0 ? extraF / (extraF + extraW) : 0.5));
  }
  food = Math.max(0, Math.min(adults, food));
  // Wood: what's needed; any more only while the woodpiles have room (as many as fill them in a
  // day). The rest rest.
  const fill = s.wood < wCap - 0.5 ? Math.ceil((burn + (wCap - s.wood)) / woodEach) : 0;
  const wood = Math.min(adults - food, Math.max(Math.ceil(needW), fill));
  const rest = adults - food - wood;
  // The land round the village feeds only so many: past that, each more brings in less.
  const working = food <= land ? food : land + (food - land) * 0.15;
  // Before there's a hearth there's no village yet: no one gathers, and no one goes hungry
  // (they're still living on what the crossing left them).
  if (!count(s, 'hearth')) return { food: 0, wood: 0, eat: 0, foodRate: 0, woodRate: 0, land };
  return { food, wood, rest, eat, foodRate: working * foodEach, woodRate: wood * woodEach, land };
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
  return v.found && !v.joined && v.settled === undefined && !v.vassal && !v.gone && v.asking === undefined && v.waiting === undefined && relation(s, v) === 'kin';
}

/** Room left in the village (beds not yet slept in). */
export function roomLeft(s: ShoreState): number {
  return Math.min(room(s), hearthMost(s)) - s.people.length;
}

/** A gift of food: trust, twice as much with the chief there to give it. */
export function gift(state: GameState, id: number, amount?: number): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canWin(s, v)) return 0;
  // (A smaller gift, from the envoy when there's not a full one to spare, wins less.)
  const give = Math.min(giftCost(v), amount ?? giftCost(v));
  if (give <= 0 || s.food < give) return 0;
  s.food -= give;
  const gain = GIFT_TRUST * (1 + boosts(s).gift) * (chiefNear(s, v) ? 2 : 1) * (give / giftCost(v));
  if (!v.gifted) {
    v.gifted = true;
    record(state, `They brought ${v.name} gifts of food for the first time.`, 'shore', shoreWhen(s));
  }
  addTrust(state, s, v, gain);
  return Math.round(gain);
}

/** Trust a day's dancing can win with a village (they tire); and each good step's worth. */
export const DANCE_DAY = 12;
const DANCE_STEP = 0.6;

/** Most goodwill a vassal holds (raising where its loyalty settles). */
export const WARM_MAX = 40;

/** Days for a village to rest off a full day's dancing. */
const DANCE_REST = SEASON_DAYS;

/** How much dancing's left in them: worn out by dancing, rested again over a season. */
export function danceLeft(s: ShoreState, v: Village): number {
  if (!v.danced) return DANCE_DAY;
  const now = s.day + s.clock / DAY_SEC;
  // (Worn right out, they won't dance again till they've rested the whole season.)
  if (v.danced.worn) return now - v.danced.day >= DANCE_REST ? DANCE_DAY : 0;
  const worn = Math.max(0, v.danced.got - ((now - v.danced.day) * DANCE_DAY) / DANCE_REST);
  return Math.max(0, DANCE_DAY - worn);
}

/** A turn round their fire with them, the chief there: trust, more the longer the streak (to
 * five), times how well it was danced (`mult`: twice, danced their way; less, ragged); nothing
 * once they're worn out. Returns the trust won. */
export function dance(state: GameState, id: number, streak: number, mult = 1): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !(canWin(s, v) || (v.vassal && !v.gone)) || !chiefNear(s, v)) return 0;
  const left = danceLeft(s, v);
  if (left <= 0) return 0;
  const gain = Math.min(left, DANCE_STEP * (1 + Math.min(5, streak) * 0.4) * mult * (1 + boosts(s).gift));
  if (!v.danced) record(state, `${s.people.find((p) => p.id === s.chief)?.name ?? 'The chief'} danced with ${v.name}, and they warmed to us.`, 'shore', shoreWhen(s));
  const now = s.day + s.clock / DAY_SEC;
  v.danced = { day: now, got: DANCE_DAY - left + gain, worn: left - gain < 0.5 };
  // (With a vassal, it's their loyalty that warms: twice what it'd be in trust.)
  if (v.vassal) v.vassal.warm = Math.min(WARM_MAX, (v.vassal.warm ?? 0) + gain * 2);
  else addTrust(state, s, v, gain);
  return gain;
}

function addTrust(state: GameState, s: ShoreState, v: Village, n: number): void {
  v.trust = Math.min(100, (v.trust ?? FIRST_TRUST) + n);
  if (v.trust < 100) return;
  // Won over: they're yours, and stay in their own village, a settlement of the hearth.
  settle(state, s, v);
}

/** A vassal loyal enough (and past any grudge) can be brought into the hearth's fold: a
 * settlement, tribute no more, theirs and yours alike. It takes a feast. */
export const ANNEX_LOYALTY = 85;
export function annexCost(v: Village, s?: ShoreState): number {
  return Math.round((20 + v.pop) * (1 - (s ? boosts(s).feast : 0)));
}
export function annexWhy(s: ShoreState, v: Village): string | null {
  if (!v.vassal || v.gone) return 'not a vassal';
  if (v.vassal.conquered !== undefined && s.day - v.vassal.conquered < SEASON_DAYS * 6) return 'they still remember being beaten';
  if (v.vassal.loyalty < ANNEX_LOYALTY) return `loyalty of ${ANNEX_LOYALTY}`;
  if (s.food < annexCost(v, s)) return `${annexCost(v, s)} food for the feast`;
  return null;
}
export function annex(state: GameState, id: number): boolean {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || annexWhy(s, v)) return false;
  s.food -= annexCost(v, s);
  record(state, `A feast was held with ${v.name}, and they were brought into the hearth's fold: tribute no more, but kin of the hearth.`, 'shore', shoreWhen(s));
  v.road = v.road && roadDone(v) ? v.road : undefined;
  v.trade = undefined;
  settle(state, s, v);
  return true;
}

/** Won over: they keep their village, as yours. */
function settle(state: GameState, s: ShoreState, v: Village): void {
  if (v.joined || v.settled !== undefined) return;
  v.asking = undefined;
  v.waiting = undefined;
  v.vassal = undefined;
  v.settled = s.day + s.clock / DAY_SEC;
  s.news.push(`${cap(v.name)} are yours now: ${Math.round(v.pop)} of them, staying in their own village.`);
  record(state, `${cap(v.name)} were won over. They stayed in their own village, ${Math.round(v.pop)} of them, a settlement of the hearth now, and sent what they gathered home.`, 'shore', shoreWhen(s));
}

/** Days of eating the envoy leaves in the stores; days of firewood the elders keep back. */
const FOOD_KEEP_DAYS = 3;
const WOOD_KEEP_DAYS = 4;

/** A rare colouring out of nowhere, in a child born on New Shore: one birth in a thousand. */
const SHORE_MUTATE = 0.001;

/** Your answer to a village won over when there isn't room for them. */
export function answerJoin(state: GameState, id: number, a: JoinAnswer): void {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || v.asking === undefined) return;
  v.asking = undefined;
  const today = s.day + s.clock / DAY_SEC;
  if (a === 'crowd') {
    record(state, `${cap(v.name)} were taken in, though there was no room: they crowded in round the hearth.`, 'shore', shoreWhen(s));
    join(state, s, v);
  }
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
export function vassalDay(v: Village, s?: ShoreState): { food: number; wood: number; growth: number; loyalty: number } {
  const t = v.vassal?.tax ?? 0;
  const cap = 70;
  const road = roadPerks(v);
  const b = s ? boosts(s) : undefined;
  const more = road.output * (1 + (b?.tribute ?? 0));
  return {
    food: v.pop * 0.9 * t * more,
    wood: v.pop * 0.45 * t * more,
    growth: v.pop * 0.05 * (1 - t * 1.8) * Math.max(0, 1 - v.pop / cap),
    loyalty: 100 - t * 170 + road.loyalty + (b?.loyalty ?? 0),
  };
}

function stepVassals(state: GameState, s: ShoreState, k: number): void {
  for (const v of s.villages) {
    if (!v.vassal) continue;
    const d = vassalDay(v, s);
    // (What they send is carried to the hearth: days on foot, less by road.)
    const load = (v.load ??= { food: 0, wood: 0 });
    load.food += d.food * k;
    load.wood += d.wood * k;
    v.pop = Math.max(4, v.pop + d.growth * k);
    // Loyalty settles toward what the tax makes it (5 a day), and a starving lord is no lord.
    // (Taken by force, they're grudging for a season or two.)
    const grudge = v.vassal.conquered !== undefined && s.day - v.vassal.conquered < SEASON_DAYS * 6 ? 30 : 0;
    // (Goodwill, from the chief's visits and dancing, raises where loyalty settles; it fades
    // slowly, two a day.)
    const warm = v.vassal.warm ?? 0;
    v.vassal.warm = Math.max(0, warm - 2 * k);
    const target = s.hungry > 1 ? Math.min(d.loyalty, 30) : Math.min(100, d.loyalty - grudge + warm);
    v.vassal.loyalty += Math.sign(target - v.vassal.loyalty) * Math.min(Math.abs(target - v.vassal.loyalty), 5 * k);
    // Restless: a warning, once, while it can still be mended.
    if (v.vassal.loyalty < 20 && !v.vassal.warned) {
      v.vassal.warned = true;
      s.news.push(`${cap(v.name)} are restless. Take less, or go to them, or they'll throw off your rule.`);
      record(state, `There was talk in ${v.name} of paying the hearth no more.`, 'shore', shoreWhen(s));
    } else if (v.vassal.loyalty >= 40) v.vassal.warned = undefined;
    // (Asked for the chief: the chief's being there is the answer.)
    if (v.ask?.kind === 'visit' && chiefNear(s, v)) answerAsk(state, v.id);
    if (v.vassal && v.vassal.loyalty <= 0) {
      // Thrown off: those taken by force rise against you, enemies now; the rest just go
      // their own way.
      const forced = v.vassal.conquered !== undefined;
      v.vassal = undefined;
      v.ask = undefined;
      v.trust = 30;
      v.standing = forced ? -70 : -20;
      s.news.push(forced ? `${cap(v.name)} have risen against you!` : `${cap(v.name)} have thrown off your rule.`);
      record(state, forced ? `${cap(v.name)} rose against the hearth that had beaten them, threw off its rule, and swore to have their own back.` : `${cap(v.name)} would pay no more, and threw off the hearth's rule.`, 'shore', shoreWhen(s));
    }
  }
}

/** Won over: they leave their village and move into yours, another kind among you. */
/** Loyalty a vassal needs before its young come to live by the hearth; and before any of yours
 * will go to live there. */
const MOVE_IN_LOYALTY = 60;
const MOVE_OUT_LOYALTY = 40;
/** Most a vassal grows to (and so takes in). */
const VASSAL_CAP = 70;

/**
 * Each day, the coming and going between the hearth and the villages that are yours. With beds
 * free and food enough, a few young of a content vassal come to live by the hearth (another kind
 * among you); crowded or hungry, a few of yours go to live with a vassal that has room. Every move
 * ties them closer (a little loyalty), and once enough have, a vassal is of the hearth: a
 * settlement.
 */
function vassalMoves(state: GameState, s: ShoreState): void {
  const today = s.day + s.clock / DAY_SEC;
  for (const v of s.villages) {
    if (!ruled(v)) continue;
    const loyal = loyaltyOf(v);
    const raise = (n: number) => { if (v.vassal) v.vassal.loyalty = Math.min(100, v.vassal.loyalty + n); };
    const rand = rng(s.seed * 13 + s.day * 31 + v.id * 7);
    const free = roomLeft(s);
    const plan = workPlan(s);
    // In: a few young, now and then.
    if (loyal >= MOVE_IN_LOYALTY && free > 0 && !s.hungry && s.food >= plan.eat * 2 && v.pop > 6 && rand() < 0.25) {
      const n = Math.min(free, 1 + Math.floor(rand() * 3), Math.floor(v.pop * 0.1));
      if (n > 0) {
        const used = new Set(s.people.map((p) => p.name));
        const names: string[] = [];
        for (let i = 0; i < n; i++) {
          let name = nameFrom(rand);
          for (let k = 0; k < 10 && used.has(name); k++) name = nameFrom(rand);
          used.add(name);
          names.push(name);
          const age = GROW_DAYS + rand() * 8;
          const id = s.nextId++;
          s.people.push({ id, name, born: today - age, dies: today - age + 70 + rand() * 30, kind: v.id, joined: today, genes: personal(undefined, id * 31 + v.id) });
        }
        v.pop -= n;
        v.ties = (v.ties ?? 0) + n;
        raise(2 * n);
        s.news.push(`${n === 1 ? names[0] : `${n} young`} of ${v.name} came to live by the hearth.`);
        record(state, `${n === 1 ? `${names[0]}, one of the young of ${v.name},` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}, young of ${v.name},`} came to live by the hearth.`, 'shore', shoreWhen(s));
      }
    }
    // Out: when the village is crowded or hungry, a few go to live with a vassal that has room.
    const crowded = free < 0 || s.hungry > 0;
    if (crowded && loyal >= MOVE_OUT_LOYALTY && v.pop < VASSAL_CAP - 2 && rand() < 0.35) {
      const can = s.people.filter((p) => isAdult(s, p) && p.id !== s.chief && !p.founder);
      const n = Math.min(can.length, Math.max(1, Math.min(3, -free)), Math.floor(VASSAL_CAP - v.pop));
      if (n > 0) {
        // (Those of their own kind first: going home, near enough.)
        const go = can.sort((a, b) => Number(b.kind === v.id) - Number(a.kind === v.id) || b.born - a.born).slice(0, n);
        s.people = s.people.filter((p) => !go.includes(p));
        for (const p of go) (s.dead ??= []).push({ ...p, moved: v.name, movedOn: today });
        v.pop += n;
        v.ties = (v.ties ?? 0) + n;
        raise(n);
        s.news.push(`${n === 1 ? go[0].name : `${n} of yours`} went to live with ${v.name}.`);
        record(state, `${go.map((p) => p.name).join(', ')} went to live with ${v.name}${s.hungry ? ', where there was more to eat' : ', where there was room'}.`, 'shore', shoreWhen(s));
      }
    }
    // Enough ties, and content: they're of the hearth now, a vassal no longer (a settlement,
    // staying where they are).
    if (v.vassal && v.vassal.loyalty >= 75 && (v.ties ?? 0) >= Math.max(6, v.pop * 0.6)) {
      record(state, `So many of ${v.name} had family by the hearth now that they paid no tribute any more: they were of the hearth.`, 'shore', shoreWhen(s));
      settle(state, s, v);
    }
  }
}

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
    const id = s.nextId++;
    s.people.push({ id, name, born: today - age, dies: today - age + 70 + rand() * 30, kind: v.id, joined: today, genes: personal(undefined, id * 31 + v.id) });
  }
  s.news.push(`${cap(v.name)} have joined you: ${Math.round(v.pop)} of them.`);
  record(state, `${cap(v.name)} joined them: ${Math.round(v.pop)} critters of another kind, come to live by their hearth.`, 'shore', shoreWhen(s));
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The chief walks somewhere (on the island). */
export function walkChief(state: GameState, to: Pt): void {
  const s = shoreOf(state);
  if (s) walkTo(s, to);
}

/** Sends the chief somewhere: the way is found round any water (and if it's in the water or out
 * of reach, they go as near as they can). */
/** The chief sent somewhere (by you): off whatever they were at, the road crew included. */
export function walkTo(s: ShoreState, to: Pt): void {
  s.crewWith = undefined;
  goTo(s, to);
}
function goTo(s: ShoreState, to: Pt): void {
  const want = { x: Math.max(2, Math.min(SHORE_N - 3, to.x)), y: Math.max(2, Math.min(SHORE_N - 3, to.y)) };
  const path = findPath(shoreIsland(s.seed), s.chiefAt, want, 120000, roadSpeed(s));
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
  // The day's work comes in as it's done, and is eaten as it goes.
  const plan = workPlan(s);
  s.food = Math.min(foodCap(s), s.food + (plan.foodRate - plan.eat) * k);
  // Wood comes in from the woods (thinning them), and the fires burn it.
  // (Only what there's room for is cut: a full woodpile leaves the trees standing.)
  s.wood = Math.max(0, s.wood - burnPerDay(s) * k);
  const cut = Math.max(0, Math.min(plan.woodRate * k, s.forest ?? FOREST_MAX, woodCap(s) - s.wood));
  s.wood += cut;
  s.forest = Math.min(FOREST_MAX, (s.forest ?? FOREST_MAX) - cut + (REGROW + REGROW_FORESTER * count(s, 'forester')) * k);
  if (s.food < 0) s.food = 0;
  s.clock += dt;
  if (s.clock >= DAY_SEC) {
    s.clock -= DAY_SEC;
    s.day++;
    dawn(state, s, plan);
  }
  // Children: where there's a fire, room, food to spare, and grown pairs.
  const adults = s.people.filter((p) => isAdult(s, p)).length;
  if (count(s, 'hearth') && s.people.length < Math.min(room(s), hearthMost(s)) && s.food >= BIRTH_FOOD && adults >= 2) {
    s.birthT += Math.floor(adults / 2) * PAIR_RATE * (1 + boosts(s).births) * k;
    if (s.birthT >= 1) {
      s.birthT = 0;
      s.food -= BIRTH_FOOD;
      born(state, s);
    }
  }
  if (s.building) {
    s.building.left -= builders(s) * BUILD_RATE * (1 + networkBonus(s) + boosts(s).build) * dt;
    if (s.building.left <= 0) finishBuilding(state, s);
  }
  // The elders build, when they're asked to and nothing's going up.
  if (count(s, 'council') && s.steward) {
    const think = s.steward.on ? elderThink(s) : ELDERS_OFF;
    if (think.pick && build(state, think.pick)) s.building!.why = think.why;
    else noteElders(state, s, think);
  }
  walk(state, s, dt);
  chiefGathers(state, s, dt);
  stepWar(state, s, dt);
  stepVassals(state, s, k);
  stepResources(s, k);
  // (From older days: won over, and waiting on room or an answer. They needn't now.)
  for (const v of s.villages) if ((v.waiting !== undefined || v.asking !== undefined) && !v.gone) settle(state, s, v);
  stepSettled(state, s, k);
  stepRoads(state, s, k);
  stepConvoys(s);
  // A vassal's loyalty warms while the chief's with them (three a day).
  for (const v of s.villages) if (v.vassal && !v.gone && chiefNear(s, v)) v.vassal.warm = Math.min(WARM_MAX, (v.vassal.warm ?? 0) + 3 * k);
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
    record(state, `${name} was born${parent ? ` to ${parent.name}` : ''}.`, 'shore', shoreWhen(s));
  }
}

function dawn(state: GameState, s: ShoreState, plan: ReturnType<typeof workPlan>): void {
  warDawn(state, s);
  sendConvoys(s);
  diplomacyDawn(s);
  roadDawn(state, s, plan.eat);
  settledAsks(state, s);
  vassalMoves(state, s);
  pruneDead(s);
  // (Undelivered news is only ever the latest few.)
  if (s.news.length > 30) s.news.splice(0, s.news.length - 30);
  maybeTurn(state, s);
  cultureDay(state, s, plan);
  // The envoy's day: a gift to the nearest kin being won over, if there's food to spare.
  if (count(s, 'envoy') && s.envoyDay !== s.day) {
    const v = s.villages.filter((x) => canWin(s, x)).sort((a, b) => Math.hypot(a.x - s.hearth.x, a.y - s.hearth.y) - Math.hypot(b.x - s.hearth.x, b.y - s.hearth.y))[0];
    // What's spare: the food past three days' eating. A full gift if there's that much; else
    // what there is, if it's half a gift or more.
    // (Never the season's stock: past three days' eating, or what autumn and winter ask; nothing
    // while they're hungry or raiders are coming.)
    const si = shoreSeason(s).si;
    const keep = Math.max(plan.eat * FOOD_KEEP_DAYS, si >= 2 ? stockTargets(s, plan.eat).food : 0);
    const spare = s.hungry > 0 || s.raid?.seen !== undefined ? 0 : s.food - keep;
    if (v && spare >= giftCost(v) * 0.5) {
      s.envoyDay = s.day;
      gift(state, v.id, spare);
    }
  }
  // Old age.
  for (const p of [...s.people]) {
    if (p.dies === undefined || s.day < p.dies) continue;
    die(state, s, p, 'old age');
  }
  // Cold: a winter's day with no firewood. After a couple, the youngest and the oldest begin
  // to die of it.
  if (shoreSeason(s).si === 3 && s.wood < 0.5 && burnPerDay(s) > 0 && plan.woodRate < burnPerDay(s)) {
    s.cold = (s.cold ?? 0) + 1;
    tellOnce(state, s, 'cold', 'Winter, and the wood ran out. The fires went cold.');
    if (s.cold >= 2 && s.people.length > 2) {
      const today = s.day + s.clock / DAY_SEC;
      const frail = [...s.people].filter((p) => p.id !== s.chief).sort((a, b) => Math.min(today - b.born, (b.dies ?? 999) - today) - Math.min(today - a.born, (a.dies ?? 999) - today));
      const n = Math.max(1, Math.round(s.people.length * 0.04));
      for (const p of frail.slice(-n)) die(state, s, p, 'cold');
    }
  } else {
    s.cold = 0;
    if (s.wood > 5) untell(s, 'cold');
  }
  // The woods thinning round the village (and, with care, coming back).
  if (forestShare(s) < 0.5) tellOnce(state, s, 'thin', 'The woods round the village were thinning: they walked further for wood each day.');
  else if (forestShare(s) > 0.85 && s.told?.includes('thin')) {
    untell(s, 'thin');
    record(state, 'The woods round the village grew thick again.', 'shore', shoreWhen(s));
  }
  // Hunger: a day with no food and not enough coming in. After a couple, the weakest begin to
  // die, more the shorter the food is (a village far bigger than its fields starves fast).
  if (s.food < 0.5 && plan.foodRate < plan.eat) {
    s.hungry++;
    tellOnce(state, s, 'hunger', 'The food ran out, and they went hungry.');
    if (s.hungry >= 2 && s.people.length > 2) {
      const short = 1 - plan.foodRate / plan.eat;
      const n = Math.max(1, Math.round(s.people.length * short * 0.15 * (1 - boosts(s).mend)));
      const weakest = [...s.people].filter((p) => p.id !== s.chief).sort((a, b) => Number(!!b.founder) - Number(!!a.founder) || a.born - b.born);
      for (const p of weakest.slice(0, n)) die(state, s, p, 'hunger');
    }
  } else {
    s.hungry = 0;
    if (s.food > 5) untell(s, 'hunger');
  }
}

/** Fallen in a fight (the battle's own Chronicle line counts them). */
export function killed(state: GameState, s: ShoreState, p: ShorePerson): void {
  die(state, s, p, 'battle');
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
    record(state, `${p.name} died of ${why === 'cold' ? 'the cold, with no wood for the fire' : why === 'hunger' ? 'hunger' : 'old age'}.`, 'shore', shoreWhen(s));
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
  // With the road crew: the chief keeps up with them as the road goes on (till it's done, or
  // you send the chief elsewhere).
  if (s.crewWith !== undefined) {
    const cv = s.villages.find((x) => x.id === s.crewWith);
    const f = cv ? roadFront(s, cv) : null;
    if (!f) s.crewWith = undefined;
    else {
      const spot = { x: f.x, y: f.y + 1.2 };
      const aim = s.chiefTo ?? s.chiefAt;
      if (Math.hypot(aim.x - spot.x, aim.y - spot.y) > 1.5) goTo(s, spot);
    }
  }
  if (s.chiefTo) {
    // (A walk from before ways were found, or one knocked off its line: the way, found now.)
    if (!s.chiefPath?.length) goTo(s, s.chiefTo);
    if (s.chiefTo && s.chiefPath) {
      const r = along(is, s.chiefAt, s.chiefPath, CHIEF_SPEED * (1 + bo.speed) * ((s.chiefHurt ?? 0) > s.day + s.clock / DAY_SEC ? 0.5 : 1) * roadWalk(s, s.chiefAt), dt);
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
    // (A breather between one walk and the next: longer if they got nowhere, so a scout who's
    // stuck, or has nowhere left to go, isn't finding a new way every step.)
    if ((sc.rest ?? 0) > 0) {
      sc.rest = (sc.rest ?? 0) - dt;
      return;
    }
    if (!sc.to || sc.left <= 0 || !sc.path) {
      sc.to = scoutGoal(s, seen, is, sc, k);
      sc.path = findPath(is, sc.at, sc.to, 30000, roadSpeed(s));
      sc.left = sc.path.reduce((a, p, i) => a + Math.hypot(p.x - (i ? sc.path![i - 1].x : sc.at.x), p.y - (i ? sc.path![i - 1].y : sc.at.y)), 0) / SCOUT_SPEED * 1.5 + 5;
    }
    sc.left -= dt;
    const r = along(is, sc.at, sc.path, SCOUT_SPEED * (1 + bo.speed) * roadWalk(s, sc.at), dt);
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
  if (dup) s.wood = Math.min(woodCap(s), s.wood + 30);
  else {
    if (f.relic) (s.relics ??= []).push(f.relic);
    if (f.learn) (s.learned ??= []).push(f.learn);
    if (f.food) s.food = Math.min(foodCap(s), s.food + f.food);
    if (f.wood) s.wood = Math.min(woodCap(s), s.wood + f.wood);
  }
  (s.finds ??= []).push({ poi: p.id, find: f, dup: !!dup });
  record(state, `At the ${poiName(p).toLowerCase().replace(/^(the|a) /, '')}: ${f.text.replace('[STORY] ', '')}`, 'shore', shoreWhen(s));
}

export function relicName(id: RelicId): string {
  return RELICS.find((r) => r.id === id)!.name;
}

export { buildName };
