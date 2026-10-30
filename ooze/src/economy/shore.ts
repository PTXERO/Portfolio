// New Shore, Phase 1: settling. The four found a village around a hearth on a big, fogged
// island, and grow it toward a hundred. The village gathers food and wood by itself (you set
// what it leans toward), lays out what you choose to build around the hearth, and has children
// where there's a fire, room and food to spare. The four grow old and die once the line goes
// on. The chief (one of the four, then their heirs) walks the island, and the fog draws back;
// out there are other villages, other kinds (see docs/new-shore.md).
//
// Time is counted in days (DAY_SEC each). Everything runs offline too.

import { BUILDS, buildName, SHORE_STORY, type BuildId } from '../content/shore';
import { record } from './chronicle';
import { Biome, CELL, isLand, islandOf, reveal, type Island, type Pt } from './island';
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
export const GROW_DAYS = 6;
/** What a day's work brings in, each worker, before bonuses; and what each eats a day. */
const FOOD_PER = 3;
const WOOD_PER = 3;
const EAT = 1;
const EAT_CHILD = 0.5;
/** Food a birth takes, and how often a pair of adults has a child (a day) with all well. */
const BIRTH_FOOD = 8;
const PAIR_RATE = 0.35;
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
const GIFT_TRUST = 8;
const VISIT_TRUST = 4;
const WELCOME_TRUST = 1.5;
/** How near the chief must be to count as visiting (tiles). */
export const VISIT_NEAR = 14;
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
  /** Seen by the chief (or the village's own lookouts). */
  found: boolean;
  /** Kin only: how far they've been won over (0 to 100), and whether they've joined you. */
  trust?: number;
  joined?: boolean;
}

export interface ShoreState {
  seed: number;
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

export function shoreIsland(seed: number): Island {
  return islandOf(seed, [], SHORE_N);
}

const SYL = ['ka', 'ri', 'mo', 'tu', 'na', 'sa', 'ke', 'lo', 'vi', 'ra', 'en', 'ul', 'ha', 'po', 'mi', 'zu', 'ta', 'ne', 'ok', 'ya', 'bo', 'li', 'fe', 'gu', 'da', 'shi'];
function nameFrom(rand: () => number): string {
  const n = 2 + (rand() < 0.25 ? 1 : 0);
  const s = Array.from({ length: n }, () => SYL[Math.floor(rand() * SYL.length)]).join('');
  return s[0].toUpperCase() + s.slice(1);
}

const LEGS = ['nubs', 'stubby', 'paddles', 'crabLegs', 'runner', 'webbedFeet', 'springLegs', 'climber', 'hooves', 'treeClaws'];
const MOUTHS = ['gums', 'jaws', 'filterMouth', 'pincers', 'snout', 'beak', 'grinders', 'hookBeak', 'fangs', 'tusks'];
const EYES = ['eyespots', 'lensEyes', 'periscope', 'stalkEyes', 'sideEyes', 'glowEyes', 'hawkEyes'];
const BACKS = ['bare', 'spines', 'sail', 'shell', 'mossCoat', 'woollyCoat', 'leafFrill', 'stonePlates'];
const TAILS = ['stub', 'finTail', 'clubTail', 'bushyTail', 'curlTail', 'spikeTail', 'crestTail'];
/** Kinds' own colours (body, edge): never quite the diet colours the player's line wears. */
const HUES: [string, string][] = [
  ['#6a5a9a', '#b8a6f0'],
  ['#3f7a4a', '#9ad88a'],
  ['#8a4a6a', '#e89ac0'],
  ['#4a6a8a', '#9ac8f0'],
  ['#8a7a3a', '#e8d88a'],
  ['#5a5a5a', '#c8c8c8'],
  ['#9a5a2a', '#f0a868'],
  ['#2a7a7a', '#7ae0d0'],
];

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
  const villages: Village[] = [];
  const taken: Pt[] = [hearth];
  plan.forEach((p, i) => {
    let best: Pt | null = null;
    for (let tries = 0; tries < 600 && !best; tries++) {
      // The first sits on a rise within sight of the beach; the rest spread out over the island.
      const a = rand() * Math.PI * 2;
      const r = i === 0 ? 50 + rand() * 25 : 120 + rand() * N * 0.4;
      const c = i === 0 ? hearth : { x: N / 2, y: N / 2 };
      const q = { x: Math.round(c.x + Math.cos(a) * (i === 0 ? r : rand() * N * 0.42)), y: Math.round(c.y + Math.sin(a) * (i === 0 ? r : rand() * N * 0.42)) };
      if (q.x < 10 || q.y < 10 || q.x > N - 10 || q.y > N - 10 || !open(q.x, q.y)) continue;
      const near = i === 0 ? 0 : 140 - tries / 10;
      if (taken.some((t) => Math.hypot(t.x - q.x, t.y - q.y) < Math.max(60, near))) continue;
      best = q;
    }
    if (!best) return;
    taken.push(best);
    const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
    const b = at(best.x, best.y);
    const where = b === Biome.Forest ? pick(['Wood', 'Fern', 'Bough']) : b === Biome.Sand ? pick(['Shore', 'Tide', 'Shell']) : pick(['Meadow', 'Hill', 'Reed', 'Stone', 'River', 'Mist']);
    const name = pick([`the ${where}folk`, `the ${where} clan`, `the ${where} people`]);
    villages.push({
      id: i,
      name,
      x: best.x,
      y: best.y,
      diet: p.diet,
      cannibal: p.cannibal,
      pop: Math.round(8 + rand() * 32),
      look: { parts: { legs: pick(LEGS), mouth: pick(MOUTHS), eyes: pick(EYES), back: pick(BACKS), tail: pick(TAILS) }, diet: p.diet, hue: HUES[(i * 3 + Math.floor(rand() * 8)) % HUES.length] },
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
    day: 0,
    clock: 0,
    // What they kept from the crossing, and the raft broken up for wood.
    food: 12,
    wood: 14,
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
  return state.stages.shore.shore;
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
  return s.day + s.clock / DAY_SEC - p.born >= GROW_DAYS;
}

/** The season now (0 spring, 1 summer, 2 autumn, 3 winter) and how far into it (0 to 1). */
export function shoreSeason(s: Pick<ShoreState, 'day' | 'clock'>): { si: number; into: number } {
  const y = ((s.day + s.clock / DAY_SEC) / SEASON_DAYS) % 4;
  return { si: Math.floor(y), into: y % 1 };
}

/** Food comes in slower in winter (and a little better at harvest). */
export function seasonFood(s: ShoreState): number {
  const { si } = shoreSeason(s);
  return si === 3 ? 0.7 : si === 2 ? 1.1 : 1;
}

export function room(s: ShoreState): number {
  return BASE_ROOM + count(s, 'hut') * 4;
}
export function foodCap(s: ShoreState): number {
  return FOOD_CAP + count(s, 'rack') * 40;
}
export function woodCap(s: ShoreState): number {
  return WOOD_CAP + count(s, 'woodpile') * 50;
}

export function buildCost(s: ShoreState, id: BuildId): number {
  const def = BUILDS.find((b) => b.id === id)!;
  return Math.ceil(def.wood * def.growth ** count(s, id));
}

/** Builds on offer now: unlocked, and not at their limit. */
export function buildsOpen(s: ShoreState): typeof BUILDS {
  return BUILDS.filter((b) => (!b.after || count(s, b.after) > 0) && (b.max === undefined || count(s, b.id) < b.max));
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

export function build(state: GameState, id: BuildId): boolean {
  const s = shoreOf(state);
  if (!s || !buildsOpen(s).some((b) => b.id === id)) return false;
  const cost = buildCost(s, id);
  if (s.wood < cost) return false;
  s.wood -= cost;
  const at = placeFor(s, id, shoreIsland(s.seed));
  s.built.push({ id, ...at, day: s.day + s.clock / DAY_SEC });
  if (id === 'hearth') {
    s.news.push(SHORE_STORY.hearth);
    record(state, 'The hearth was lit.', 'shore', shoreWhen(s));
  }
  return true;
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
export function workPlan(s: ShoreState): { food: number; wood: number; eat: number; foodRate: number; woodRate: number } {
  const adults = s.people.filter((p) => isAdult(s, p)).length;
  const kids = s.people.length - adults;
  const eat = adults * EAT + kids * EAT_CHILD;
  const foodEach = FOOD_PER * (1 + 0.2 * count(s, 'camp')) * seasonFood(s);
  const woodEach = WOOD_PER * (1 + 0.2 * count(s, 'cutter'));
  // Leaning one way or the other; with the stores full, hands go to the other.
  let share = s.lean === 'food' ? 0.75 : s.lean === 'wood' ? Math.min(1, (eat * 1.05) / Math.max(1, adults) / foodEach) : Math.min(1, (eat * 1.5) / Math.max(1, adults) / foodEach + 0.15);
  if (s.food >= foodCap(s) - 0.5) share = Math.min(share, (eat * 1.0) / Math.max(1, adults) / foodEach);
  if (s.wood >= woodCap(s) - 0.5) share = 1;
  const food = Math.round(adults * Math.max(0, Math.min(1, share)));
  const wood = adults - food;
  return { food, wood, eat, foodRate: food * foodEach, woodRate: wood * woodEach };
}

// ---- Winning them over ----

export function chiefNear(s: ShoreState, v: Village): boolean {
  return Math.hypot(s.chiefAt.x - v.x, s.chiefAt.y - v.y) < VISIT_NEAR;
}

/** Food a gift takes: more for a bigger village. */
export function giftCost(v: Village): number {
  return Math.ceil(6 + v.pop * 0.5);
}

/** Whether they can be won over now: found, kin, not yet joined. */
export function canWin(s: ShoreState, v: Village): boolean {
  return v.found && !v.joined && relation(s, v) === 'kin';
}

/** A gift of food: trust, twice as much with the chief there to give it. */
export function gift(state: GameState, id: number): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canWin(s, v) || s.food < giftCost(v)) return 0;
  s.food -= giftCost(v);
  const gain = GIFT_TRUST * (chiefNear(s, v) ? 2 : 1);
  addTrust(state, s, v, gain);
  return gain;
}

function addTrust(state: GameState, s: ShoreState, v: Village, n: number): void {
  v.trust = Math.min(100, (v.trust ?? FIRST_TRUST) + n);
  if (v.trust >= 100) join(state, s, v);
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
    s.birthT += Math.floor(adults / 2) * PAIR_RATE * k;
    if (s.birthT >= 1) {
      s.birthT = 0;
      s.food -= BIRTH_FOOD;
      born(state, s);
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
  // Hunger: a day with no food and not enough coming in; after a few, the weakest go.
  if (s.food < 0.5 && plan.foodRate < plan.eat) {
    s.hungry++;
    if (s.hungry >= 3 && s.people.length > 2) {
      const weakest = [...s.people].filter((p) => p.id !== s.chief).sort((a, b) => a.born - b.born)[0];
      if (weakest) die(state, s, weakest, 'hunger');
      s.hungry = 1;
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
function walk(state: GameState, s: ShoreState, dt: number): void {
  const is = shoreIsland(s.seed);
  const seen = state.stages.shore.seen;
  const to = s.chiefTo;
  if (to) {
    const dx = to.x - s.chiefAt.x;
    const dy = to.y - s.chiefAt.y;
    const d = Math.hypot(dx, dy);
    const stepLen = Math.min(d, CHIEF_SPEED * dt);
    if (d < 0.3) s.chiefTo = null;
    else {
      const ux = dx / d;
      const uy = dy / d;
      // Straight on if it's land; else edge along the shore (whichever side is land).
      const tries = [0, 0.5, -0.5, 1, -1, 1.5, -1.5];
      let moved = false;
      for (const t of tries) {
        const c = Math.cos(t);
        const sn = Math.sin(t);
        const vx = ux * c - uy * sn;
        const vy = ux * sn + uy * c;
        const nx = s.chiefAt.x + vx * stepLen;
        const ny = s.chiefAt.y + vy * stepLen;
        if (isLand(is, nx, ny)) {
          s.chiefAt = { x: nx, y: ny };
          moved = true;
          break;
        }
      }
      if (!moved) s.chiefTo = null;
    }
  }
  if (seen.length === SHORE_CELLS * SHORE_CELLS) {
    reveal(is, seen, s.chiefAt.x, s.chiefAt.y, CHIEF_SIGHT);
    for (const v of s.villages) {
      if (v.found) continue;
      const c = Math.floor(v.y / CELL) * SHORE_CELLS + Math.floor(v.x / CELL);
      if (!seen[c]) continue;
      v.found = true;
      if (relation(s, v) === 'kin') v.trust ??= FIRST_TRUST;
      s.newFinds.push(v.id);
      record(state, `They found ${v.name}: ${v.pop} of them, ${v.cannibal ? 'eaters of their own kind' : `${v.diet}s`}.`, 'shore', shoreWhen(s));
    }
  }
}

export { buildName };
