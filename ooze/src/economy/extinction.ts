// The Extinction: the survival game after the waking. Nothing grows here; the game is losing
// slower than the clock. Days pass only while you play (the clock stops when the game is
// closed). By day, the survivors work at what you set them to; at night everyone eats what
// there is, and whoever goes without gets hungrier, until they starve. Food is split by kind,
// and what a tribe can eat is the diet its line chose long ago: herbivores eat only plants,
// carnivores only meat, omnivores both (never quite as good at either). A tribe that eats its
// dead becomes cannibals for good. Ideas, heard from the spear, are the only way to more food.
// When fewer than two are left, it's over: back to just after the waking, to try again (the
// spear remembers what it taught, so those ideas come cheaper).

import { COST_STEP, MIND_NODE, modsOf, NODE_COST, reachable, type Mods } from './mindTree';
import type { GameState, TribeState } from './types';

export type Diet = 'herbivore' | 'carnivore' | 'omnivore' | 'cannibal';
export type JobId = 'forage' | 'scavenge' | 'dig' | 'fish' | 'listen' | 'rest';
export type TraitId = 'strong' | 'swift' | 'keen' | 'hardy' | 'frail' | 'old' | 'young';

export interface Survivor {
  id: number;
  name: string;
  trait: TraitId;
  /** 0 fed, 1 hungry, 2 starving; at their limit (about 3) they die. */
  hunger: number;
  job: JobId;
}

export interface NightReport {
  day: number;
  /** Rations eaten, and rations wanted. */
  ate: number;
  wanted: number;
  starved: { name: string; trait: TraitId }[];
  spoiled: number;
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
}

/** Seconds of play in a day. */
export const DAY_SEC = 45;

export const JOBS: { id: JobId; name: string; does: string }[] = [
  { id: 'forage', name: 'Forage the ash', does: 'Plants, from what the fire left. It runs out.' },
  { id: 'scavenge', name: 'Scavenge the dead', does: 'Meat, from what the strike killed. It rots away.' },
  { id: 'dig', name: 'Dig for roots', does: 'Plants. Roots live through fire, but there are only so many.' },
  { id: 'fish', name: 'Fish the shore', does: 'Meat. The sea still has fish, but the shore holds only so many lines.' },
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
  if (job === 'listen' || job === 'rest') return null;
  const plain = job === 'forage' || job === 'dig' ? 'plants' : 'meat';
  if (diet === 'omnivore') return plain;
  const want = diet === 'herbivore' ? 'plants' : 'meat';
  return want;
}

/** A job as a diet knows it. */
export function jobInfo(diet: Diet, job: JobId): { id: JobId; name: string; does: string } {
  const j = JOBS.find((x) => x.id === job)!;
  const plain = job === 'forage' || job === 'dig' ? 'plants' : job === 'listen' || job === 'rest' ? null : 'meat';
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
  strong: { scavenge: 1.4, dig: 1.3 },
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
const YIELD: Record<JobId, number> = { forage: 1.3, scavenge: 1.9, dig: 1.1, fish: 1.3, listen: 1, rest: 0 };
/** Roots and fish keep coming, but only so much a day (a share of how many lived through the
 * strike). */
/** Insight a day from the square root of the listening done. */
const LISTEN = 1.4;
const DIG_CAP = 0.32;
const FISH_CAP = 0.36;
/** Overnight: meat rots (much slower once dried), plants a little; carrion on the ground too. */
const MEAT_KEEP = 0.62;
const PLANT_KEEP = 0.95;
const CARRION_KEEP = 0.86;
/** Each of the dead, eaten: this much meat. */
const CORPSE_MEAT = 2.5;

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
  if (job === 'listen' || job === 'rest') return 1;
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
    // They've had nothing since the strike.
    people.push({ id: i, name, trait, hunger: 1, job: 'rest' });
  }
  return {
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
    carrion: n * 5,
    ideas: [],
    ration: 1,
    fallen: 'undecided',
    today: { plants: 0, meat: 0, insight: 0 },
    last: null,
    over: false,
  };
}

export function exOf(state: GameState): ExtinctionState | undefined {
  return state.stages.tribal.tribe?.ex;
}

/** Starts the Extinction (once the waking is over), keeping how it began for trying again. */
export function startExtinction(state: GameState): ExtinctionState | undefined {
  const t = state.stages.tribal.tribe;
  if (!t || !t.awake) return undefined;
  if (!t.ex) {
    t.ex = newExtinction(t);
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
  if (!t || !ex || ex.over || !reachable(ex.ideas, id)) return false;
  const cost = ideaCost(state, id);
  if (ex.insight < cost) return false;
  ex.insight -= cost;
  ex.ideas.push(id);
  t.remembered = [...new Set([...(t.remembered ?? []), id])];
  return true;
}

export function jobOpen(ex: ExtinctionState, job: JobId): boolean {
  return (job !== 'dig' && job !== 'fish') || modsOf(ex.ideas, ex.diet).unlock.has(job);
}

/** How well one survivor works at a job today. */
function workOf(ex: ExtinctionState, p: Survivor, job: JobId, m = modsOf(ex.ideas, ex.diet)): number {
  const sk = SKILL[p.trait];
  const weak = Math.max(0.3, 1 - 0.18 * p.hunger);
  const ideas = Math.max(0.1, 1 + m.gather[job] + m.gather.all);
  const trait = (p.trait === 'keen' ? 1 + m.keen : 1) * (p.trait === 'strong' ? 1 + m.strong : 1 + m.others);
  return (sk[job] ?? 1) * (sk.all ?? 1) * weak * dietSkill(ex.diet, job) * ideas * trait;
}

/** Hunger someone can bear before dying. */
function limitOf(p: Survivor, m: Mods): number {
  const weak = p.trait === 'frail' || p.trait === 'old' || p.trait === 'young' ? m.weak : 0;
  const first = m.strongFirst ? (p.job === 'rest' ? -0.5 : 0.3) : 0;
  return LIMIT[p.trait] + m.limit + weak + first;
}

/** What each job brings in over a whole day, as things stand. */
export function dayYield(ex: ExtinctionState): Record<JobId, number> {
  const out: Record<JobId, number> = { forage: 0, scavenge: 0, dig: 0, fish: 0, listen: 0, rest: 0 };
  const m = modsOf(ex.ideas, ex.diet);
  for (const p of ex.people) out[p.job] += YIELD[p.job] * workOf(ex, p, p.job, m);
  const start = ex.people.length + ex.deaths;
  out.forage *= Math.sqrt(Math.max(0, ex.ash / ex.ashMax));
  out.forage = Math.min(out.forage, ex.ash);
  out.scavenge = Math.min(out.scavenge, ex.carrion);
  out.dig = Math.min(out.dig, start * DIG_CAP * (1 + m.digCap));
  out.fish = Math.min(out.fish, start * FISH_CAP * (1 + m.fishCap));
  // The spear only says so much a day: more listening helps less and less.
  out.listen = LISTEN * Math.sqrt(out.listen);
  return out;
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
    ex.meat += ex.corpses * CORPSE_MEAT;
  }
  ex.corpses = 0;
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
  const value = (1 + m.meal) * (ex.ration < 1 ? 1 + m.ration : 1);
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
    p.hunger = Math.max(0, p.hunger + 1 - 1.5 * meal - rest - m.night + listen);
  }
  const starved = ex.people.filter((p) => p.hunger >= limitOf(p, m));
  ex.people = ex.people.filter((p) => p.hunger < limitOf(p, m));
  ex.deaths += starved.length;
  if (ex.fallen === 'eat') ex.meat += starved.length * CORPSE_MEAT;
  else if (ex.fallen === 'undecided') ex.corpses += starved.length;
  const before = ex.meat + ex.plants;
  ex.meat *= Math.min(0.95, MEAT_KEEP + m.meatKeep);
  ex.plants *= Math.min(0.995, PLANT_KEEP + m.plantKeep);
  ex.carrion *= CARRION_KEEP;
  ex.ash = Math.min(ex.ashMax, ex.ash + ex.ashMax * m.ashRegrow);
  ex.day += 1;
  ex.clock = 0;
  ex.today = { plants: 0, meat: 0, insight: 0 };
  ex.last = { day: ex.day, ate, wanted: (ex.people.length + starved.length) * ex.ration, starved: starved.map((p) => ({ name: p.name, trait: p.trait })), spoiled: before - ex.meat - ex.plants };
  if (ex.people.length < 2) ex.over = true;
}

/** Runs the Extinction on (only ever while being played). Returns true when a night passed. */
export function extinctionTick(state: GameState, dt: number): boolean {
  const t = state.stages.tribal.tribe;
  const ex = t?.ex;
  if (!t || !ex || ex.over || waitingOnChoice(ex)) return false;
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
  return near <= 1 ? 'Dying' : p.hunger >= 2 ? 'Starving' : p.hunger >= 1 ? 'Hungry' : 'Fed';
}
