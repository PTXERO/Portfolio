// The Extinction: the survival game after the waking. Nothing grows here; the game is losing
// slower than the clock. Days pass only while you play (the clock stops when the game is
// closed). By day, the survivors work at what you set them to; at night everyone eats what
// there is, and whoever goes without gets hungrier, until they starve. Food is split by kind,
// and what a tribe can eat is the diet its line chose long ago: herbivores eat only plants,
// carnivores only meat, omnivores both (never quite as good at either). A tribe that eats its
// dead becomes cannibals for good: much more meat, but the shaking spreads through those who eat
// their own, and hungry cannibals kill their weakest. Ideas, heard from the spear, are the only
// way to more food. Half way through the ash winter comes (gathering worse, nights colder),
// then the first green. The way off is a raft: wood, work and rope, and food for the crossing;
// it carries four, the family that goes on.
// When fewer than two are left, it's over: back to just after the waking, to try again (the
// spear remembers what it taught, so those ideas come cheaper).

import { discover, ordainedNeeds, say, tribeLaunches, tribeThinks, type SpellId } from './miracles';
import { ensureSociety, flushNotes, mourn, nightTheft, sharing, socialNight, spirit, type Bond, type Quirk } from './society';
import { COST_STEP, MIND_NODE, modsOf, NODE_COST, reachable, type Mods } from './mindTree';
import type { GameState, TribeState } from './types';

export type Diet = 'herbivore' | 'carnivore' | 'omnivore' | 'cannibal';
export type JobId = 'forage' | 'scavenge' | 'dig' | 'fish' | 'wood' | 'build' | 'listen' | 'rest';
export type TraitId = 'strong' | 'swift' | 'keen' | 'hardy' | 'frail' | 'old' | 'young';

export interface Survivor {
  id: number;
  name: string;
  trait: TraitId;
  /** 0 fed, 1 hungry, 2 starving; at their limit (about 3) they die. */
  hunger: number;
  job: JobId;
  /** How much more (or less) hunger they can bear than others like them. */
  grit?: number;
  /** Days left to live with the shaking (from eating their own); unset if well. */
  sick?: number;
  /** Their nature, who they are to the others, and what's on them (days of grief or of a
   * hurt; broken for a day when pushed too far). */
  quirk?: Quirk;
  bonds?: Bond[];
  grief?: number;
  hurt?: number;
  broken?: boolean;
}

export interface NightReport {
  day: number;
  /** Rations eaten, and rations wanted. */
  ate: number;
  wanted: number;
  starved: { name: string; trait: TraitId }[];
  spoiled: number;
  /** Died of the shaking; killed in the night (and by whom); newly shaking. */
  shook?: string[];
  killed?: { name: string; by: string } | null;
  caught?: string[];
  /** Whether the fire was kept lit, and what the season did. */
  fire?: boolean;
  season?: 'winter' | 'green' | null;
}

export interface ExtinctionState {
  /** Days survived so far (the day now under way is day + 1). */
  day: number;
  /** Seconds into the day. */
  clock: number;
  diet: Diet;
  people: Survivor[];
  nextId: number;
  deaths: number;
  /** The dead not yet buried (or eaten). */
  corpses: number;
  /** Food in store, by kind, and the spear's insight. */
  plants: number;
  meat: number;
  insight: number;
  /** What the island still has: plants in the ash (they don't come back) and carrion from the
   * strike (rotting away). */
  ash: number;
  ashMax: number;
  carrion: number;
  /** Ideas learned from the spear (nodes of its web, see mindTree). */
  ideas: string[];
  /** Share of a full meal each gets at night: 1, 0.5 or 0.25. */
  ration: number;
  /** What's done with the dead: not yet decided, left to the ash, or eaten. */
  fallen: 'undecided' | 'leave' | 'eat';
  /** Gathered so far today (shown as it comes in). */
  today: { plants: number; meat: number; insight: number };
  last: NightReport | null;
  over: boolean;
  /** Wood cut, and charred trees left standing. */
  wood?: number;
  trees?: number;
  /** The raft: work done on each part, and the four chosen to go. */
  raft?: Record<RaftPart, number>;
  family?: number[];
  escaped?: boolean;
  /** For chance (the shaking, killings): seeded, so the countdown guesses true. */
  luck?: number;
  /** The tribe assigns itself each dawn (food first, then the focus), unless managed by hand. */
  auto?: boolean;
  focus?: Focus;
  /** The job the leader (the one who touched the spear) is working beside, if any: those at
   * it work harder. And how many times today the leader has gathered by hand. */
  lead?: JobId | null;
  hand?: number;
  /** The spear's will: prayer to spend on miracles, the dread they cause, the miracles found
   * (and not yet shown), how often each has been worked, those ordained, and the Chronicle. */
  prayer?: number;
  dread?: number;
  powers?: SpellId[];
  newPowers?: SpellId[];
  casts?: Partial<Record<SpellId, number>>;
  ordained?: SpellId[];
  log?: { day: number; text: string }[];
  /** A miracle's lasting touch: a rich shore today; fire and warmth tonight. */
  boost?: { day: number; fish: number };
  fireTonight?: boolean;
  warmTonight?: boolean;
  /** Among them: tonight's notable moments (the Chronicle keeps the few most telling), the
   * one they follow, and the last birth. */
  notes?: { weight: number; text: string }[];
  leader?: number;
  lastBirth?: number;
  births?: number;
  /** When each kind of moment was last told (so the Chronicle doesn't repeat itself). */
  told?: Record<string, number>;
  /** Food set aside for the crossing (wrapped and smoked: it keeps). */
  voyage?: number;
  /** Miracles the spear worked unasked last night (for the scene to show). */
  worked?: SpellId[];
}

export type Focus = 'wood' | 'raft' | 'ideas';
/** Lead by example: the job the leader stands by works this much harder. */
export const LEAD_BONUS = 0.25;
/** Gathering by hand: so many times a day, this much each. */
export const HAND_PER_DAY = 15;
const HAND_FOOD = 1.2;
const HAND_WOOD = 1;
const HAND_INSIGHT = 0.35;

export type RaftPart = 'frame' | 'lashing' | 'hull';
/** The raft's parts, in order: work and wood for each (lashing needs rope). */
export const RAFT: { id: RaftPart; name: string; work: number; wood: number; needs?: string }[] = [
  { id: 'frame', name: 'Frame', work: 30, wood: 50 },
  { id: 'lashing', name: 'Lashing', work: 20, wood: 15, needs: 'rope' },
  { id: 'hull', name: 'Hull', work: 45, wood: 70 },
];
/** It carries four, and needs food for them for the crossing. */
export const FAMILY = 4;
/** Work a day the raft can take, however many are on it (about six at it). */
const BUILD_CAP = 6;
/** Forty days adrift, a quarter meal a day for the four (no sails: it goes where it's carried). */
export const VOYAGE_FOOD = 40;
/** The ash winter, and the first green after. */
export const WINTER = [12, 26];

/** Seconds of play in a day. */
export const DAY_SEC = 45;

export const JOBS: { id: JobId; name: string; does: string }[] = [
  { id: 'forage', name: 'Forage the ash', does: 'Plants, from what the fire left. It runs out.' },
  { id: 'scavenge', name: 'Scavenge the dead', does: 'Meat, from what the strike killed. It rots away.' },
  { id: 'dig', name: 'Dig for roots', does: 'Plants. Roots live through fire, but there are only so many.' },
  { id: 'fish', name: 'Fish the shore', does: 'Meat. The sea still has fish, but the shore holds only so many lines.' },
  { id: 'wood', name: 'Cut charred trees', does: 'Wood, for the fire and the raft. The trees run out.' },
  { id: 'build', name: 'Build the raft', does: 'Turns wood and work into the raft, part by part.' },
  { id: 'listen', name: 'Listen to the spear', does: 'Insight, to learn ideas from it. No food.' },
  { id: 'rest', name: 'Rest', does: 'No work. Hunger comes on a little slower.' },
];

/** The same work, for a line that eats only the other food. */
const OTHER_FOOD: Partial<Record<JobId, { name: string; does: string }>> = {
  forage: { name: 'Grub in the ash', does: 'Meat: grubs and beetles in the ash. They run out.' },
  scavenge: { name: 'Gather fallen fruit', does: 'Plants: fruit and seed the strike shook down. It rots away.' },
  dig: { name: 'Set snares', does: 'Meat: small things that hid underground. There are only so many.' },
  fish: { name: 'Gather kelp', does: 'Plants: kelp from the shallows. The shallows hold only so many.' },
};

/** What a job brings in for a diet: each line works for the food it can eat. */
export function jobFood(diet: Diet, job: JobId): 'plants' | 'meat' | null {
  if (job === 'listen' || job === 'rest' || job === 'wood' || job === 'build') return null;
  const plain = job === 'forage' || job === 'dig' ? 'plants' : 'meat';
  if (diet === 'omnivore') return plain;
  const want = diet === 'herbivore' ? 'plants' : 'meat';
  return want;
}

/** A job as a diet knows it. */
export function jobInfo(diet: Diet, job: JobId): { id: JobId; name: string; does: string } {
  const j = JOBS.find((x) => x.id === job)!;
  const plain = job === 'forage' || job === 'dig' ? 'plants' : job === 'scavenge' || job === 'fish' ? 'meat' : null;
  const food = jobFood(diet, job);
  return plain && food !== plain ? { id: job, ...OTHER_FOOD[job]! } : j;
}


export const TRAITS: Record<TraitId, { name: string; does: string }> = {
  strong: { name: 'Strong', does: 'scavenges and digs well' },
  swift: { name: 'Swift', does: 'forages and fishes well' },
  keen: { name: 'Keen', does: 'hears the spear best' },
  hardy: { name: 'Hardy', does: 'lasts longer without food' },
  frail: { name: 'Frail', does: 'weak, and starves sooner' },
  old: { name: 'Old', does: 'slow, but hears the spear well' },
  young: { name: 'Young', does: 'a little slow, starves a little sooner' },
};

/** How good each trait is at each job. */
const SKILL: Record<TraitId, Partial<Record<JobId, number>> & { all?: number }> = {
  strong: { scavenge: 1.4, dig: 1.3, wood: 1.4, build: 1.3 },
  swift: { forage: 1.35, fish: 1.25 },
  keen: { listen: 1.5, fish: 1.15, forage: 1.1 },
  hardy: {},
  frail: { all: 0.75 },
  old: { all: 0.8, listen: 1.6 },
  young: { all: 0.9 },
};

/** Hunger at which each dies. */
const LIMIT: Record<TraitId, number> = { strong: 3, swift: 3, keen: 3, hardy: 3.6, frail: 2.4, old: 2.7, young: 2.7 };

/** A day's work, per worker, before skill and hunger. */
const YIELD: Record<JobId, number> = { forage: 1.3, scavenge: 1.9, dig: 1.1, fish: 1.3, wood: 1.5, build: 1, listen: 1, rest: 0 };
/** Roots and fish keep coming, but only so much a day (a share of how many lived through the
 * strike). */
/** Insight a day from the square root of the listening done. */
const LISTEN = 1.4;
/** (Low on their own: the ideas taken raise them, so the path chosen sets how many can live.) */
const DIG_CAP = 0.11;
const FISH_CAP = 0.12;
/** Overnight: meat rots (much slower once dried), plants a little; carrion on the ground too. */
const MEAT_KEEP = 0.62;
const PLANT_KEEP = 0.95;
const CARRION_KEEP = 0.9;
/** Each of the dead, eaten: this much meat (a body feeds several). */
const CORPSE_MEAT = 8;
/** Each body eaten: the chance one of the living catches the shaking, and how long it takes
 * to kill them. Each night some are starving, the chance cannibals kill one of their own. */
const SHAKING_CHANCE = 0.3;
const SHAKING_DAYS = 10;
const KILL_CHANCE = 0.25;
/** A lit fire burns this much wood a night; the ash winter's toll on gathering and nights. */
const FIRE_WOOD = 2;
const WINTER_GATHER = 0.65;
const WINTER_COLD = 0.15;
const GREEN_REGROW = 0.015;

const SYL = ['ka', 'ri', 'mo', 'tu', 'na', 'sa', 'ke', 'lo', 'vi', 'ra', 'en', 'ul', 'ha', 'po', 'mi', 'zu', 'ta', 'ne', 'ok', 'ya', 'bo', 'li', 'fe', 'gu', 'da', 'shi'];

function rng(seed: number): () => number {
  let r = seed >>> 0 || 1;
  return () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 2 ** 32;
  };
}

/** The line's diet, from the choice made back in the Cell. */
export function dietFrom(look: string): Diet {
  return look === 'grazer' ? 'herbivore' : look === 'hunter' ? 'carnivore' : 'omnivore';
}

export function eatsPlants(d: Diet): boolean {
  return d === 'herbivore' || d === 'omnivore';
}
export function eatsMeat(d: Diet): boolean {
  return d !== 'herbivore';
}

/** How a diet does at a food job: specialists are better at their own food. */
function dietSkill(d: Diet, job: JobId): number {
  if (job === 'listen' || job === 'rest' || job === 'wood' || job === 'build') return 1;
  return d === 'omnivore' ? 0.85 : 1.1;
}

/** The Extinction as it begins, just after the waking. */
export function newExtinction(tribe: TribeState): ExtinctionState {
  const rand = rng(tribe.seed * 31 + 7);
  const n = Math.max(6, Math.round(tribe.survivors));
  const traits: TraitId[] = ['strong', 'swift', 'keen', 'hardy', 'frail', 'old', 'young'];
  // The body they carry shapes who they are: strong lines have more strong, and so on.
  const s = tribe.stats;
  const weight: Record<TraitId, number> = { strong: 1 + s.strength * 0.05, swift: 1 + s.speed * 0.05, keen: 1 + s.senses * 0.05, hardy: 1 + s.toughness * 0.05, frail: 1.2, old: 1, young: 1.2 };
  const total = traits.reduce((a, t) => a + weight[t], 0);
  const used = new Set<string>();
  const people: Survivor[] = [];
  for (let i = 0; i < n; i++) {
    let name = '';
    for (let k = 0; k < 20 && (!name || used.has(name)); k++) {
      const parts = 2 + (rand() < 0.25 ? 1 : 0);
      name = Array.from({ length: parts }, () => SYL[Math.floor(rand() * SYL.length)]).join('');
      name = name[0].toUpperCase() + name.slice(1);
    }
    used.add(name);
    let pick = rand() * total;
    let trait: TraitId = 'young';
    for (const t of traits) {
      pick -= weight[t];
      if (pick <= 0) {
        trait = t;
        break;
      }
    }
    // They've had little or nothing since the strike (some less than others).
    const hunger = Math.max(0, 0.3 + rand() * 1.4 + (trait === 'frail' ? 0.3 : trait === 'hardy' ? -0.2 : 0));
    people.push({ id: i, name, trait, hunger, job: 'rest', grit: (rand() - 0.5) * 0.6 });
  }
  const ex: ExtinctionState = {
    day: 0,
    clock: 0,
    diet: dietFrom(tribe.look.diet),
    people,
    nextId: n,
    deaths: 0,
    corpses: 0,
    plants: 0,
    meat: 0,
    insight: 0,
    ash: n * 3.2,
    ashMax: n * 3.2,
    carrion: n * 6,
    ideas: [],
    ration: 1,
    fallen: 'undecided',
    today: { plants: 0, meat: 0, insight: 0 },
    last: null,
    over: false,
    wood: 0,
    trees: n * 4,
    raft: { frame: 0, lashing: 0, hull: 0 },
    family: [],
    escaped: false,
    luck: (tribe.seed * 7 + 3) >>> 0,
    auto: true,
    focus: 'ideas',
    prayer: 6,
    dread: 0,
    powers: ['lightning'],
    newPowers: ['lightning'],
    casts: {},
    ordained: [],
    log: [{ day: 1, text: 'They woke on an island of ash, and knew that they were. They knew, too, that they were starving.' }],
    lead: null,
    hand: 0,
  };
  ensureSociety(ex);
  return ex;
}

/** A roll of the Extinction's own dice. */
function roll(ex: ExtinctionState): number {
  ex.luck = ((ex.luck ?? 1) * 1664525 + 1013904223) >>> 0;
  return ex.luck / 2 ** 32;
}

/** Whether the ash winter is on (and the green after). */
export function seasonOf(ex: ExtinctionState): 'before' | 'winter' | 'green' {
  return ex.day < WINTER[0] ? 'before' : ex.day < WINTER[1] ? 'winter' : 'green';
}

export function exOf(state: GameState): ExtinctionState | undefined {
  return state.stages.tribal.tribe?.ex;
}

/** Starts the Extinction (once the waking is over), keeping how it began for trying again. */
export function startExtinction(state: GameState): ExtinctionState | undefined {
  const t = state.stages.tribal.tribe;
  if (!t || !t.awake) return undefined;
  if (t.ex) {
    // (A run begun before the spear's will: it gets its powers, and runs itself.)
    const ex = t.ex;
    if (!ex.powers) {
      ex.powers = ['lightning'];
      ex.newPowers = ['lightning'];
      ex.prayer = 6;
      ex.dread = 0;
      ex.log = [];
    }
    ex.auto = true;
    ensureSociety(ex);
    ex.powers = (ex.powers as string[]).map((p) => (p === 'shake' ? 'quicken' : p)) as SpellId[];
  } else {
    t.ex = newExtinction(t);
    autoAssign(t.ex);
    t.start = JSON.stringify(t.ex);
  }
  return t.ex;
}

/** Back to just after the waking, after everyone's gone. */
export function tryAgain(state: GameState): void {
  const t = state.stages.tribal.tribe;
  if (!t?.start || !t.ex) return;
  t.best = Math.max(t.best ?? 0, t.ex.day);
  t.attempts = (t.attempts ?? 0) + 1;
  t.ex = JSON.parse(t.start) as ExtinctionState;
  t.pop = t.ex.people.length;
}

/** An idea's cost in insight: by its size, and half if the spear taught it before (in a run
 * that failed). */
export function ideaCost(state: GameState, id: string): number {
  const n = MIND_NODE[id];
  if (!n) return Infinity;
  const known = state.stages.tribal.tribe?.ex?.ideas.length ?? 0;
  const c = NODE_COST[n.kind] + COST_STEP * known;
  return Math.ceil((state.stages.tribal.tribe?.remembered ?? []).includes(id) ? c / 2 : c);
}

/** Learns an idea: it must be next to one already known, and paid for in insight. */
export function learnIdea(state: GameState, id: string): boolean {
  const t = state.stages.tribal.tribe;
  const ex = t?.ex;
  if (!t || !ex || ex.over || ex.escaped || !reachable(ex.ideas, id)) return false;
  const cost = ideaCost(state, id);
  if (ex.insight < cost) return false;
  ex.insight -= cost;
  ex.ideas.push(id);
  t.remembered = [...new Set([...(t.remembered ?? []), id])];
  return true;
}

export function jobOpen(ex: ExtinctionState, job: JobId): boolean {
  if (job === 'build') return raftPart(ex) !== null;
  return (job !== 'dig' && job !== 'fish') || modsOf(ex.ideas, ex.diet).unlock.has(job);
}

/** How well one survivor works at a job today. */
function workOf(ex: ExtinctionState, p: Survivor, job: JobId, m = modsOf(ex.ideas, ex.diet)): number {
  const sk = SKILL[p.trait];
  const weak = Math.max(0.45, 1 - 0.12 * p.hunger);
  const ideas = Math.max(0.1, 1 + m.gather[job] + m.gather.all);
  const trait = (p.trait === 'keen' ? 1 + m.keen : 1) * (p.trait === 'strong' ? 1 + m.strong : 1 + m.others);
  const shaking = p.sick !== undefined ? 0.5 : 1;
  const cold = seasonOf(ex) === 'winter' && (job === 'forage' || job === 'scavenge' || job === 'dig') ? WINTER_GATHER : 1;
  const lead = ex.lead === job && job !== 'rest' ? 1 + LEAD_BONUS : 1;
  const cower = (ex.dread ?? 0) >= 60 ? 0.85 : 1;
  return (sk[job] ?? 1) * (sk.all ?? 1) * weak * dietSkill(ex.diet, job) * ideas * trait * shaking * cold * lead * cower * spirit(ex, p);
}

/** Hunger now (for sorting who's weakest). */
const p0 = (p: Survivor) => p.hunger;

/** Hunger someone can bear before dying. */
function limitOf(p: Survivor, m: Mods): number {
  const weak = p.trait === 'frail' || p.trait === 'old' || p.trait === 'young' ? m.weak : 0;
  const first = m.strongFirst ? (p.job === 'rest' ? -0.5 : 0.3) : 0;
  return LIMIT[p.trait] + m.limit + weak + first + (p.grit ?? 0);
}

/** What each job brings in over a whole day, as things stand. */
export function dayYield(ex: ExtinctionState): Record<JobId, number> {
  const out: Record<JobId, number> = { forage: 0, scavenge: 0, dig: 0, fish: 0, wood: 0, build: 0, listen: 0, rest: 0 };
  const m = modsOf(ex.ideas, ex.diet);
  for (const p of ex.people) out[p.job] += YIELD[p.job] * workOf(ex, p, p.job, m);
  const start = ex.people.length + ex.deaths;
  out.forage *= Math.sqrt(Math.max(0, ex.ash / ex.ashMax));
  out.forage = Math.min(out.forage, ex.ash);
  out.scavenge = Math.min(out.scavenge, ex.carrion);
  out.dig = Math.min(out.dig, start * DIG_CAP * (1 + m.digCap));
  const rich = ex.boost && ex.boost.day === ex.day ? ex.boost.fish : 0;
  out.fish = Math.min(out.fish, start * FISH_CAP * (1 + m.fishCap + rich));
  out.wood = Math.min(out.wood, ex.trees ?? 0);
  // Only so many hands fit round a raft.
  out.build = Math.min(out.build, BUILD_CAP);
  // The spear only says so much a day: more listening helps less and less.
  out.listen = LISTEN * Math.sqrt(out.listen);
  return out;
}

/**
 * The tribe sets itself to work: enough on food to feed everyone (best jobs first, as far as
 * the land allows), a fire kept going, then the rest to the focus (wood, the raft, or ideas),
 * with a few listening to the spear whatever the focus.
 */
export function autoAssign(ex: ExtinctionState): void {
  for (const p of ex.people) p.job = 'rest';
  const n = ex.people.length;
  if (!n) return;
  const m = modsOf(ex.ideas, ex.diet);
  // (Always for full meals: short rations are for when the work can't bring that in.)
  const need = (n / (1 + m.meal)) * 1.15;
  const start = n + ex.deaths;
  const food = (['forage', 'scavenge', 'dig', 'fish'] as const).filter((j) => jobOpen(ex, j) && edible(ex.diet, jobFood(ex.diet, j)));
  // What a job's raw work turns into, as far as the land allows (as in dayYield).
  const yieldOf = (j: JobId, raw: number): number => {
    if (j === 'forage') return Math.min(raw * Math.sqrt(Math.max(0, ex.ash / ex.ashMax)), ex.ash);
    if (j === 'scavenge') return Math.min(raw, ex.carrion);
    if (j === 'dig') return Math.min(raw, start * DIG_CAP * (1 + m.digCap));
    if (j === 'fish') return Math.min(raw, start * FISH_CAP * (1 + m.fishCap));
    return raw;
  };
  const free = new Set(ex.people);
  /** The best still free for a job (and how much they'd do there). */
  const bestFor = (j: JobId): [Survivor | null, number] => {
    let who: Survivor | null = null;
    let w = 0;
    for (const p of free) {
      const v = YIELD[j] * workOf(ex, p, j, m);
      if (v > w) {
        w = v;
        who = p;
      }
    }
    return [who, w];
  };
  const put = (j: JobId, k: number) => {
    for (let i = 0; i < k && free.size; i++) {
      const [who] = bestFor(j);
      if (!who) return;
      who.job = j;
      free.delete(who);
    }
  };
  // A few always listen (the spear is the only way to more food); a fire needs wood.
  put('listen', Math.max(1, Math.round(n * (ex.focus === 'ideas' ? 0.12 : 0.06))));
  if (ex.ideas.includes('fire') && (ex.wood ?? 0) < 6 && (ex.trees ?? 0) > 0) put('wood', 2);
  // Food: one at a time to whichever food job adds most, until there's enough (or more
  // workers would add next to nothing).
  const raw: Record<string, number> = {};
  let total = 0;
  for (const j of food) raw[j] = 0;
  while (free.size && total < need) {
    let pick: JobId | null = null;
    let who: Survivor | null = null;
    let add = 0;
    let gain = 0.15;
    for (const j of food) {
      const [p, w] = bestFor(j);
      if (!p) continue;
      const g = yieldOf(j, raw[j] + w) - yieldOf(j, raw[j]);
      if (g > gain) {
        gain = g;
        pick = j;
        who = p;
        add = w;
      }
    }
    if (!pick || !who) break;
    who.job = pick;
    free.delete(who);
    raw[pick] += add;
    total += gain;
  }
  // The rest: most to the focus, some to wood (the fire and the raft run on it).
  const rest = free.size;
  const focusJob: JobId = ex.focus === 'wood' ? 'wood' : ex.focus === 'raft' && jobOpen(ex, 'build') ? ((ex.wood ?? 0) > 8 ? 'build' : 'wood') : 'listen';
  put(focusJob, focusJob === 'build' ? Math.min(Math.round(rest * 0.6), 7) : Math.round(rest * 0.6));
  if ((ex.trees ?? 0) > 0) put('wood', Math.round(free.size * 0.4));
}

function edible(d: Diet, f: 'plants' | 'meat' | null): boolean {
  return f === 'plants' ? eatsPlants(d) : f === 'meat' ? eatsMeat(d) : false;
}

/** The leader gathers by hand at a job's ground (or listens at the spear): a little, a few
 * times a day. Returns what was got (0 when spent, or nothing there). */
export function handGather(state: GameState, job: JobId): { amount: number; what: string } {
  const ex = exOf(state);
  if (!ex || ex.over || ex.escaped || (ex.hand ?? 0) >= HAND_PER_DAY) return { amount: 0, what: '' };
  let amount = 0;
  let what = '';
  if (job === 'listen') {
    amount = HAND_INSIGHT;
    ex.insight += amount;
    what = 'insight';
  } else if (job === 'wood') {
    amount = Math.min(HAND_WOOD, ex.trees ?? 0);
    ex.trees = (ex.trees ?? 0) - amount;
    ex.wood = (ex.wood ?? 0) + amount;
    what = 'wood';
  } else if (job === 'forage' || job === 'scavenge' || job === 'dig' || job === 'fish') {
    if (!jobOpen(ex, job)) return { amount: 0, what: '' };
    const pool = job === 'forage' ? ex.ash : job === 'scavenge' ? ex.carrion : Infinity;
    amount = Math.min(HAND_FOOD, pool);
    if (job === 'forage') ex.ash -= amount;
    if (job === 'scavenge') ex.carrion -= amount;
    const f = jobFood(ex.diet, job)!;
    if (f === 'plants') ex.plants += amount;
    else ex.meat += amount;
    what = f;
  }
  if (amount > 0) ex.hand = (ex.hand ?? 0) + 1;
  return { amount, what };
}

/** Moves `n` survivors onto a job (from resting), or off it (back to resting), best-suited
 * first on and worst-suited first off. */
export function assign(ex: ExtinctionState, job: JobId, n: number): void {
  if (job === 'rest' || !jobOpen(ex, job)) return;
  for (let k = 0; k < Math.abs(n); k++) {
    const pool = ex.people.filter((p) => (n > 0 ? p.job === 'rest' : p.job === job));
    if (!pool.length) return;
    pool.sort((a, b) => workOf(ex, b, job) - workOf(ex, a, job));
    (n > 0 ? pool[0] : pool[pool.length - 1]).job = n > 0 ? job : 'rest';
  }
}

export function count(ex: ExtinctionState, job: JobId): number {
  return ex.people.filter((p) => p.job === job).length;
}

/** Whether play waits on a choice (what to do with the dead). */
export function waitingOnChoice(ex: ExtinctionState): boolean {
  return ex.fallen === 'undecided' && ex.corpses > 0 && !ex.over;
}

/** What's done with the dead. Eating them makes the tribe cannibals, for good. */
export function decideFallen(state: GameState, eat: boolean): void {
  const ex = exOf(state);
  if (!ex || ex.fallen !== 'undecided') return;
  ex.fallen = eat ? 'eat' : 'leave';
  if (eat) {
    ex.diet = 'cannibal';
    eatDead(ex, ex.corpses, []);
  }
  ex.corpses = 0;
}

/** The dead, eaten: meat for all, and a chance one of the eaters catches the shaking. */
function eatDead(ex: ExtinctionState, bodies: number, caught: string[]): void {
  ex.meat += bodies * CORPSE_MEAT;
  // More bodies, more likely, but at most one falls sick a night.
  if (bodies <= 0 || roll(ex) >= Math.min(0.7, SHAKING_CHANCE + 0.04 * bodies)) return;
  const well = ex.people.filter((p) => p.sick === undefined);
  if (!well.length) return;
  const p = well[Math.floor(roll(ex) * well.length)];
  p.sick = SHAKING_DAYS;
  caught.push(p.name);
}

/** The raft part being built now (null once it's done, or when the next needs an idea not
 * known yet). */
export function raftPart(ex: ExtinctionState): (typeof RAFT)[number] | null {
  for (const part of RAFT) {
    if ((ex.raft?.[part.id] ?? 0) >= part.work) continue;
    return part.needs && !ex.ideas.includes(part.needs) ? null : part;
  }
  return null;
}

export function raftDone(ex: ExtinctionState): boolean {
  return RAFT.every((p) => (ex.raft?.[p.id] ?? 0) >= p.work);
}

/** Food the family could take (what they can eat). */
export function provisions(ex: ExtinctionState): number {
  return (eatsMeat(ex.diet) ? ex.meat : 0) + (eatsPlants(ex.diet) ? ex.plants : 0);
}

/** Picks (or unpicks) one of the four to go. */
export function toggleFamily(ex: ExtinctionState, id: number): void {
  const f = (ex.family ??= []);
  const i = f.indexOf(id);
  if (i >= 0) f.splice(i, 1);
  else if (f.length < FAMILY && ex.people.some((p) => p.id === id)) f.push(id);
}

/** What's still in the way of setting off (empty when they can). */
export function launchBlockers(ex: ExtinctionState): string[] {
  const out: string[] = [];
  if (!raftDone(ex)) out.push('The raft isn\'t finished.');
  const fam = (ex.family ?? []).filter((id) => ex.people.some((p) => p.id === id));
  if (ex.people.length < FAMILY) out.push(`It needs ${FAMILY} to go; only ${ex.people.length} are left.`);
  else if (fam.length < FAMILY) out.push(`Choose who goes: ${fam.length} of ${FAMILY} chosen.`);
  if ((ex.voyage ?? 0) < VOYAGE_FOOD) out.push(`Food set aside for the crossing: ${Math.floor(ex.voyage ?? 0)} of ${VOYAGE_FOOD}.`);
  return out;
}

/** The family sets off: the Extinction is survived. */
export function launch(state: GameState): boolean {
  const t = state.stages.tribal.tribe;
  const ex = t?.ex;
  if (!t || !ex || ex.over || ex.escaped || launchBlockers(ex).length) return false;
  ex.escaped = true;
  t.best = Math.max(t.best ?? 0, ex.day);
  t.family = ex.people.filter((p) => ex.family!.includes(p.id)).map((p) => ({ name: p.name, trait: p.trait }));
  t.cannibal = ex.diet === 'cannibal';
  // The spear's island is remembered as they left it; forty days adrift, they come ashore on
  // another.
  t.ashIsland = { seed: t.seed, left: ex.people.length - FAMILY, days: ex.day, cannibal: t.cannibal };
  t.landed = { seed: ((t.seed * 7919 + 104729) >>> 0) % 2 ** 31, day: ex.day + 40 };
  return true;
}

/** A stretch of the day: work comes in as it's done. */
function work(ex: ExtinctionState, sec: number): void {
  const y = dayYield(ex);
  const k = sec / DAY_SEC;
  let plants = 0;
  let meat = 0;
  for (const j of ['forage', 'scavenge', 'dig', 'fish'] as const) {
    if (jobFood(ex.diet, j) === 'plants') plants += y[j] * k;
    else meat += y[j] * k;
  }
  ex.ash = Math.max(0, ex.ash - y.forage * k);
  ex.carrion = Math.max(0, ex.carrion - y.scavenge * k);
  // Wood comes in; the raft takes wood as the work is done on it (none without wood).
  ex.trees = Math.max(0, (ex.trees ?? 0) - y.wood * k);
  ex.wood = (ex.wood ?? 0) + y.wood * k;
  const part = raftPart(ex);
  if (part && y.build > 0) {
    const perWork = part.wood / part.work;
    const done = Math.min(y.build * k, (ex.wood ?? 0) / perWork, part.work - ex.raft![part.id]);
    ex.raft![part.id] += done;
    ex.wood! -= done * perWork;
  }
  ex.plants += plants;
  ex.meat += meat;
  ex.insight += y.listen * k;
  ex.today.plants += plants;
  ex.today.meat += meat;
  ex.today.insight += y.listen * k;
}

/** Night: everyone eats what there is (the hungriest first), the hungry get hungrier, and some
 * don't see the morning. Then food spoils, and a new day starts. */
function night(ex: ExtinctionState): void {
  const m = modsOf(ex.ideas, ex.diet);
  // The fire (once they know it) burns wood each night; without wood, no cooking and no warmth.
  const fireKnown = ex.ideas.includes('fire');
  const burnt = fireKnown && (ex.wood ?? 0) >= FIRE_WOOD;
  if (burnt) ex.wood! -= FIRE_WOOD;
  // (A lightning-lit fire burns tonight whether they know fire or not.)
  const fire = burnt || !!ex.fireTonight;
  const season = seasonOf(ex);
  const cold = season === 'winter' && !fire && !ex.warmTonight ? WINTER_COLD : 0;
  // Cooking: what fire they know, or (by lightning) the plain good of a cooked meal.
  const cooking = fireKnown ? (fire ? m.meal : 0) : fire ? 0.35 : m.meal;
  ex.fireTonight = false;
  ex.warmTonight = false;
  const value = (1 + cooking) * (ex.ration < 1 ? 1 + m.ration : 1);
  // In the dark, before the meal, the greedy may help themselves.
  nightTheft(ex);
  // The hungriest eat first (or, if the strong eat first, the workers do).
  const order = [...ex.people].sort((a, b) => (m.strongFirst ? Number(a.job === 'rest') - Number(b.job === 'rest') : 0) || b.hunger - a.hunger);
  let ate = 0;
  for (const p of order) {
    let want = ex.ration / value;
    let got = 0;
    // Meat first (it spoils sooner), then plants, as far as the diet allows.
    if (eatsMeat(ex.diet)) {
      const m = Math.min(want, ex.meat);
      ex.meat -= m;
      got += m;
      want -= m;
    }
    if (eatsPlants(ex.diet)) {
      const v = Math.min(want, ex.plants);
      ex.plants -= v;
      got += v;
    }
    const meal = got * value;
    ate += meal;
    const rest = p.job === 'rest' ? 0.25 + m.rest : 0;
    const listen = p.job === 'listen' ? m.listenHunger : 0;
    p.hunger = Math.max(0, p.hunger + 1 - 1.5 * meal - rest - m.night + listen + cold);
  }
  // The kind give from their share to the starving they love.
  sharing(ex);
  // The shaking runs its course.
  const shookDead: Survivor[] = [];
  for (const p of ex.people) {
    if (p.sick === undefined) continue;
    p.sick -= 1;
    if (p.sick <= 0) shookDead.push(p);
  }
  const shook = shookDead.map((p) => p.name);
  if (shook.length) {
    ex.people = ex.people.filter((p) => p.sick === undefined || p.sick > 0);
    ex.deaths += shook.length;
    mourn(ex, shookDead, 'died of the shaking');
  }
  // Cannibals with starving among them: some nights, the strong take one of the weak.
  const caught: string[] = [];
  let killed: NightReport['killed'] = null;
  if (ex.diet === 'cannibal' && ex.people.length > 2 && ex.people.some((p) => p.hunger >= 2) && roll(ex) < KILL_CHANCE) {
    const weak = [...ex.people].sort((a, b) => limitOf(a, m) - p0(a) - (limitOf(b, m) - p0(b)))[0];
    const killer = ex.people.filter((p) => p !== weak && p.sick === undefined).sort((a, b) => workOf(ex, b, 'scavenge', m) - workOf(ex, a, 'scavenge', m))[0];
    if (weak && killer) {
      ex.people = ex.people.filter((p) => p !== weak);
      ex.deaths += 1;
      killed = { name: weak.name, by: killer.name };
      mourn(ex, [weak], `was killed in the night, and eaten`);
      eatDead(ex, 1, caught);
    }
  }
  const starved = ex.people.filter((p) => p.hunger >= limitOf(p, m));
  ex.people = ex.people.filter((p) => p.hunger < limitOf(p, m));
  ex.deaths += starved.length;
  mourn(ex, starved, 'starved in the night');
  // The rest of the night among them (and the prayer the devout stir up).
  ex.prayer = Math.max(0, (ex.prayer ?? 0) + socialNight(ex, fire));
  if (ex.fallen === 'eat') eatDead(ex, starved.length, caught);
  else if (ex.fallen === 'undecided') ex.corpses += starved.length;
  // Once the raft's built, a share of what's left each night is wrapped and smoked for the
  // crossing (it keeps), until there's enough.
  if (raftDone(ex) && (ex.voyage ?? 0) < VOYAGE_FOOD && ex.people.length >= FAMILY) {
    const want = VOYAGE_FOOD - (ex.voyage ?? 0);
    const fromMeat = eatsMeat(ex.diet) ? Math.min(ex.meat * 0.35, want) : 0;
    const fromPlants = eatsPlants(ex.diet) ? Math.min(ex.plants * 0.35, want - fromMeat) : 0;
    ex.meat -= fromMeat;
    ex.plants -= fromPlants;
    if (!ex.voyage && fromMeat + fromPlants > 0) say(ex, 'They began setting food aside for the crossing, wrapped in leaves and smoked.');
    ex.voyage = (ex.voyage ?? 0) + fromMeat + fromPlants;
  }
  const before = ex.meat + ex.plants;
  ex.meat *= Math.min(0.95, MEAT_KEEP + m.meatKeep);
  ex.plants *= Math.min(0.995, PLANT_KEEP + m.plantKeep);
  ex.carrion *= CARRION_KEEP;
  ex.ash = Math.min(ex.ashMax, ex.ash + ex.ashMax * (m.ashRegrow + (season === 'green' ? GREEN_REGROW : 0)));
  ex.family = (ex.family ?? []).filter((id) => ex.people.some((p) => p.id === id));
  ex.day += 1;
  ex.hand = 0;
  ex.clock = 0;
  ex.today = { plants: 0, meat: 0, insight: 0 };
  ex.last = { day: ex.day, ate, wanted: (ex.people.length + starved.length) * ex.ration, starved: starved.map((p) => ({ name: p.name, trait: p.trait })), spoiled: before - ex.meat - ex.plants, shook, killed, caught, fire, season: ex.day === WINTER[0] ? 'winter' : ex.day === WINTER[1] ? 'green' : null };
  if (ex.people.length < 2) ex.over = true;
  else {
    // A new day: the tribe thinks (rations, what to work toward), the spear finds new powers
    // and works the ordained ones where they're needed, and everyone goes to work.
    flushNotes(ex);
    tribeThinks(ex);
    discover(ex);
    autoAssign(ex);
    ex.worked = ordainedNeeds(ex);
  }
  if (ex.people.length < 2) ex.over = true;
}

/** Runs the Extinction on (only ever while being played). Returns true when a night passed. */
export function extinctionTick(state: GameState, dt: number): boolean {
  const t = state.stages.tribal.tribe;
  const ex = t?.ex;
  if (!t || !ex || ex.over || ex.escaped || waitingOnChoice(ex)) return false;
  let nights = false;
  let left = dt;
  while (left > 0 && !ex.over && !waitingOnChoice(ex)) {
    const step = Math.min(left, DAY_SEC - ex.clock);
    work(ex, step);
    ex.clock += step;
    left -= step;
    if (ex.clock >= DAY_SEC - 1e-9) {
      night(ex);
      nights = true;
      if (tribeLaunches(state)) break;
    }
  }
  t.pop = ex.people.length;
  return nights;
}

/** Days until there's no one left, if things carry on as they are (null if they'd hold on). */
export function daysLeft(ex: ExtinctionState): number | null {
  if (ex.over) return 0;
  const sim = JSON.parse(JSON.stringify(ex)) as ExtinctionState;
  // Dead go as decided (an undecided tribe leaves them, for the guess).
  if (sim.fallen === 'undecided') sim.fallen = 'leave';
  const startDay = sim.day;
  work(sim, DAY_SEC - sim.clock);
  night(sim);
  for (let i = 0; i < 60 && !sim.over; i++) {
    work(sim, DAY_SEC);
    night(sim);
  }
  return sim.over ? sim.day - startDay : null;
}

/** How hungry someone is, in words. */
export function hungerWord(ex: ExtinctionState, p: Survivor): string {
  const near = limitOf(p, modsOf(ex.ideas, ex.diet)) - p.hunger;
  if (p.sick !== undefined) return 'Shaking';
  return near <= 1 ? 'Dying' : p.hunger >= 2 ? 'Starving' : p.hunger >= 1 ? 'Hungry' : 'Fed';
}
