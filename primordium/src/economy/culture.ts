// Phase 2: Culture, the Long Road. At about a hundred people the village turns (everyone at a
// great fire), and from then on its culture grows by itself: eight lanes, each gathering
// practice from what the people actually do, and each idea landing on its own when its practice
// fills (while you're away too). You steer by focusing a lane. Now and then a fork: a choice
// that makes your people yours (left too long, the elders choose). Each Age closes with a Great
// Work. This is the first Age, the Hearth; the road goes on later.

import type { BuildId, Boosts } from '../content/shore';
import { record } from './chronicle';
import { can, count, DAY_SEC, has, warmth, isAdult, poisOf, poiDef, relation, shoreWhen, totalCritters, type ShoreState } from './shore';
import type { GameState } from './types';

export type Lane = 'food' | 'crafts' | 'war' | 'rule' | 'kin' | 'rites' | 'stories' | 'words';

export const LANES: { id: Lane; name: string; from: string }[] = [
  { id: 'food', name: 'Food', from: 'the gatherers, and the camps and weirs' },
  { id: 'crafts', name: 'Crafts', from: 'the woodcutters, and everything built' },
  { id: 'war', name: 'War', from: 'raids fought, and the watch post, spears and palisade' },
  { id: 'rule', name: 'Rule', from: 'the council, and the size of the village' },
  { id: 'kin', name: 'Kin', from: 'other kinds living among you, and villages joined or held' },
  { id: 'rites', name: 'Rites', from: 'the hearth, the elders\' fire and the pool, and the dead' },
  { id: 'stories', name: 'Stories', from: 'the old, and the landmarks explored' },
  { id: 'words', name: 'Words', from: 'the scouts and lookout, and the size of the village' },
];

export type ForkId = 'dead' | 'law' | 'trade' | 'faith';

export interface Idea {
  id: string;
  lane: Lane;
  age: number;
  name: string;
  does: string;
  fx?: Partial<Boosts>;
  /** Landing, it asks a fork. */
  fork?: ForkId;
}

/** Each Age's ideas: two a lane. */
export const IDEAS: Idea[] = [
  { id: 'dried', lane: 'food', age: 1, name: 'Dried meat and fruit', does: 'All food +5%.', fx: { food: 0.05 } },
  { id: 'grounds', lane: 'food', age: 1, name: 'Known grounds', does: 'All food +10%.', fx: { food: 0.1 } },
  { id: 'blades', lane: 'crafts', age: 1, name: 'Stone blades', does: 'Stoke +50%.', fx: { tap: 0.5 } },
  { id: 'baskets', lane: 'crafts', age: 1, name: 'Baskets', does: 'All food +10%.', fx: { food: 0.1 } },
  { id: 'watchers', lane: 'war', age: 1, name: 'Watchers', does: 'Sight +2.', fx: { sight: 2 } },
  { id: 'clubs', lane: 'war', age: 1, name: 'Clubs', does: 'Stoke +50%.', fx: { tap: 0.5 } },
  { id: 'fourword', lane: 'rule', age: 1, name: 'The four\'s word', does: 'Gift trust +10%.', fx: { gift: 0.1 } },
  { id: 'circle', lane: 'rule', age: 1, name: 'The elders\' circle', does: 'Growing up +10%.', fx: { grow: 0.1 } },
  { id: 'hearths', lane: 'kin', age: 1, name: 'Mixed hearths', does: 'Births +10%.', fx: { births: 0.1 } },
  { id: 'songs', lane: 'kin', age: 1, name: 'Shared songs', does: 'Gift trust +15%.', fx: { gift: 0.15 } },
  { id: 'dead', lane: 'rites', age: 1, name: 'The dead', does: 'How the dead are seen to: a choice.', fork: 'dead' },
  { id: 'feast', lane: 'rites', age: 1, name: 'The first feast', does: 'All food +10%.', fx: { food: 0.1 } },
  { id: 'crossing', lane: 'stories', age: 1, name: 'The Crossing told', does: 'All food +10%.', fx: { food: 0.1 } },
  { id: 'farspear', lane: 'stories', age: 1, name: 'The spear far off', does: 'Sight +2.', fx: { sight: 2 } },
  { id: 'names', lane: 'words', age: 1, name: 'Names for everything', does: 'Walk +10%.', fx: { speed: 0.1 } },
  { id: 'fingers', lane: 'words', age: 1, name: 'Finger-counting', does: 'All food +10%.', fx: { food: 0.1 } },

  // The Village Age.
  { id: 'salting', lane: 'food', age: 2, name: 'Salted stores', does: 'All food +20%.', fx: { food: 0.2 } },
  { id: 'markets', lane: 'food', age: 2, name: 'Market days', does: 'How the villages deal with the hearth: a choice.', fork: 'trade' },
  { id: 'kilns', lane: 'crafts', age: 2, name: 'Fired clay', does: 'All food +20%.', fx: { food: 0.2 } },
  { id: 'roadcraft', lane: 'crafts', age: 2, name: 'Roadcraft', does: 'Walk +15%.', fx: { speed: 0.15 } },
  { id: 'levies', lane: 'war', age: 2, name: 'Sworn levies', does: 'Stoke ×2.', fx: { tap: 1 } },
  { id: 'shields', lane: 'war', age: 2, name: 'Hide shields', does: 'All food +15%.', fx: { food: 0.15 } },
  { id: 'oaths', lane: 'rule', age: 2, name: 'Oaths of fealty', does: 'Gift trust +25%.', fx: { gift: 0.25 } },
  { id: 'law', lane: 'rule', age: 2, name: 'The spoken law', does: 'Whose word is law: a choice.', fork: 'law' },
  { id: 'marriages', lane: 'kin', age: 2, name: 'Marriages between villages', does: 'Births +20%.', fx: { births: 0.2 } },
  { id: 'guests', lane: 'kin', age: 2, name: 'Guest-right', does: 'All food +15%.', fx: { food: 0.15 } },
  { id: 'faith', lane: 'rites', age: 2, name: 'What the fire is', does: 'What they keep faith with: a choice.', fork: 'faith' },
  { id: 'feastdays', lane: 'rites', age: 2, name: 'Feast days', does: 'All food +20%.', fx: { food: 0.2 } },
  { id: 'founding', lane: 'stories', age: 2, name: 'The foundings told', does: 'Growing up +20%.', fx: { grow: 0.2 } },
  { id: 'hidemaps', lane: 'stories', age: 2, name: 'Maps on hide', does: 'Sight +3.', fx: { sight: 3 } },
  { id: 'tallies', lane: 'words', age: 2, name: 'Tally sticks', does: 'All food +20%.', fx: { food: 0.2 } },
  { id: 'tithe', lane: 'words', age: 2, name: 'The tithe counted', does: 'All food +15%.', fx: { food: 0.15 } },
];

export const FORKS: Record<ForkId, { name: string; ask: string; options: { id: string; name: string; line: string; fx?: Partial<Boosts>; lane?: Lane; cannibal?: boolean }[] }> = {
  dead: {
    name: 'The dead',
    ask: 'How are the dead seen to?',
    options: [
      { id: 'bury', name: 'Bury them', line: 'Laid in the earth near the hearth, and remembered there.', lane: 'stories' },
      { id: 'burn', name: 'Burn them', line: 'Given to the fire, and gone up with the smoke.', lane: 'rites' },
      { id: 'eat', name: 'Eat them', line: 'Nothing is wasted. Not even them.', fx: { food: 0.1 }, cannibal: true },
    ],
  },
  law: {
    name: 'The spoken law',
    ask: 'Whose word is law, in the hearth and the villages it holds?',
    options: [
      { id: 'council', name: 'The council\'s', line: 'The elders sit, and talk it through, and their word holds everywhere.', lane: 'rule', fx: { gift: 0.2 } },
      { id: 'chief', name: 'The chief\'s', line: 'One voice, quick and sure, and the spears behind it.', lane: 'war', fx: { tap: 0.5 } },
    ],
  },
  trade: {
    name: 'Market days',
    ask: 'How do the villages and the hearth deal with each other?',
    options: [
      { id: 'barter', name: 'Barter', line: 'Goods for goods, on market days: everyone comes away with something.', lane: 'food', fx: { food: 0.2 } },
      { id: 'tribute', name: 'Tribute', line: 'What\'s owed the hearth is brought to it, and counted.', lane: 'rule', fx: { food: 0.15, gift: 0.15 } },
    ],
  },
  faith: {
    name: 'What the fire is',
    ask: 'What do they keep faith with?',
    options: [
      { id: 'hearthfire', name: 'The hearth-fire', line: 'The fire that never goes out: it warms the living, and new life comes to it.', lane: 'rites', fx: { births: 0.2 } },
      { id: 'ancestors', name: 'The ancestors', line: 'The four who crossed, and all who came after: they watch, and they keep the hungry alive.', lane: 'stories', fx: { grow: 0.2 } },
    ],
  },
};

/** The size at which the village turns to its culture. */
export const TURN_AT = 100;
/** Practice an idea takes: a lane's first in the Age, then more for each after. */
const IDEA_COST = 100;
const IDEA_MORE = 100;
function cost(c: Culture, lane: Lane): number {
  const had = IDEAS.filter((i) => i.lane === lane && i.age === c.age && c.done.includes(i.id)).length;
  return IDEA_COST + had * IDEA_MORE;
}
/** A focused lane gathers this much more. */
const FOCUS = 2;
/** Days a fork waits for an answer before the elders give one. */
const FORK_DAYS = 8;
/** Lanes to have finished the Age's ideas in, for its Great Work. */
const LANES_FOR_WORK = 4;

export interface Culture {
  /** When the turn came (days since landfall). */
  since: number;
  age: number;
  practice: Partial<Record<Lane, number>>;
  done: string[];
  focus?: Lane;
  /** Forks taken (fork → option), and one waiting to be answered (and since when). */
  forks: Partial<Record<ForkId, string>>;
  asking?: { fork: ForkId; since: number };
  /** New ideas not yet shown. */
  fresh?: string[];
}

const today = (s: ShoreState) => s.day + s.clock / DAY_SEC;

/** A lane's next idea in this Age (none: its Age is done). */
export function nextIdea(c: Culture, lane: Lane): Idea | undefined {
  return IDEAS.find((i) => i.lane === lane && i.age === c.age && !c.done.includes(i.id));
}

/** Practice a lane gathers a day, from what the village does. */
export function practiceRate(s: ShoreState, lane: Lane): number {
  const c = s.culture;
  const grown = s.people.filter((p) => isAdult(s, p)).length;
  const today_ = today(s);
  const gens = (ids: string[]) => ids.reduce((n, id) => n + count(s, id as never), 0);
  const won = s.villages.filter((v) => v.won !== undefined);
  let r = 0.3;
  switch (lane) {
    case 'food':
      r += gens(['forager', 'camp', 'weir', 'lodge', 'garden']) * 0.02;
      break;
    case 'crafts':
      r += gens(['camp', 'weir', 'lodge', 'garden', 'granary', 'market', 'hut', 'longhouse']) * 0.012;
      break;
    case 'war':
      r += won.filter((v) => relation(s, v) !== 'kin').length * 0.5 + gens(['lodge']) * 0.03;
      break;
    case 'rule':
      r += (has(s, 'council') ? 0.4 : 0) + grown * 0.006;
      break;
    case 'kin':
      r += s.people.filter((p) => p.kind !== undefined).length * 0.02 + won.filter((v) => relation(s, v) === 'kin').length * 0.4;
      break;
    case 'rites':
      r += count(s, 'hearth') * 0.3 + Math.min(1, s.deaths * 0.01) + (has(s, 'feast1') ? 0.3 : 0);
      break;
    case 'stories':
      r += s.people.filter((p) => p.dies !== undefined && p.dies - today_ < 15).length * 0.03 + poisOf(s).filter((p) => p.done >= poiDef(p).layers.length).length * 0.15;
      break;
    case 'words':
      r += (has(s, 'scouts') ? 0.5 : 0) + grown * 0.004;
      break;
  }
  // The road chosen at a fork: its lane goes a little faster.
  for (const [f, o] of Object.entries(c?.forks ?? {})) if (FORKS[f as ForkId]?.options.find((x) => x.id === o)?.lane === lane) r *= 1.25;
  return r * (c?.focus === lane && can(s, 'focus') ? FOCUS : 1) * warmth(s);
}

/** What the culture's ideas and forks add (folded into the village's boosts). */
export function cultureFx(s: ShoreState): Partial<Boosts>[] {
  const c = s.culture;
  if (!c) return [];
  const out: Partial<Boosts>[] = [];
  for (const id of c.done) {
    const i = IDEAS.find((x) => x.id === id);
    if (i?.fx) out.push(i.fx);
  }
  for (const [f, o] of Object.entries(c.forks)) {
    const fx = FORKS[f as ForkId]?.options.find((x) => x.id === o)?.fx;
    if (fx) out.push(fx);
  }
  return out;
}

/** The turn: at a hundred, everyone at a great fire, and the culture begins. */
export function maybeTurn(state: GameState, s: ShoreState): void {
  if (s.culture || totalCritters(s) < TURN_AT) return;
  s.culture = { since: today(s), age: 1, practice: {}, done: [], forks: {} };
  s.turned = true;
  record(state, 'They were a hundred. They gathered at a great fire, all of them at once. [STORY]', 'shore', shoreWhen(s));
}

/** Each day: practice gathered, ideas landing, a fork answered by the elders if left too long. */
export function cultureDay(state: GameState, s: ShoreState): void {
  const c = s.culture;
  if (!c) return;
  for (const l of LANES) {
    const next = nextIdea(c, l.id);
    if (!next) continue;
    c.practice[l.id] = (c.practice[l.id] ?? 0) + practiceRate(s, l.id);
    if ((c.practice[l.id] ?? 0) < cost(c, l.id)) continue;
    c.practice[l.id] = 0;
    c.done.push(next.id);
    (c.fresh ??= []).push(next.id);
    s.news.push(`${next.name}: a new idea.`);
    record(state, `${l.name}: ${next.name}. ${next.does}`, 'shore', shoreWhen(s));
    if (next.fork && !c.forks[next.fork] && !c.asking) c.asking = { fork: next.fork, since: today(s) };
    // (A lane finished: the focus moves off it.)
    if (c.focus === l.id && !nextIdea(c, l.id)) c.focus = undefined;
  }
  if (c.asking && today(s) - c.asking.since > FORK_DAYS) {
    // (By the culture's leaning: the road whose lane it has taken furthest.)
    const lean = (o: ReturnType<typeof forkOptions>[number]) => (o.lane ? IDEAS.filter((i) => i.lane === o.lane && c.done.includes(i.id)).length * 1000 + (c.practice[o.lane] ?? 0) : o.cannibal ? 500 : 0);
    const opts = [...forkOptions(s, c.asking.fork)].sort((a, b) => lean(b) - lean(a));
    choose(state, s, c.asking.fork, opts[0].id, true);
  }
}

/** The options a fork offers these people (eating the dead only for those who eat their own). */
export function forkOptions(s: ShoreState, fork: ForkId) {
  return FORKS[fork].options.filter((o) => !o.cannibal || s.cannibal);
}

/** The chief's answer to a fork (or the elders', given for them). */
export function choose(state: GameState, s: ShoreState, fork: ForkId, option: string, elders = false): boolean {
  const c = s.culture;
  const o = c && forkOptions(s, fork).find((x) => x.id === option);
  if (!c || !o || c.forks[fork]) return false;
  c.forks[fork] = option;
  if (c.asking?.fork === fork) c.asking = undefined;
  record(state, `${FORKS[fork].name}: ${elders ? 'left to the elders, they chose' : 'it was decided'}. ${o.name}. ${o.line}`, 'shore', shoreWhen(s));
  return true;
}

export function setFocus(s: ShoreState, lane: Lane | undefined): void {
  if (s.culture) s.culture.focus = lane && nextIdea(s.culture, lane) ? lane : undefined;
}

/** How many lanes have their Age's ideas done (the Great Work needs four). */
export function lanesDone(c: Culture): number {
  return LANES.filter((l) => !nextIdea(c, l.id)).length;
}

/** The Ages, and the Great Work that closes each. */
export const AGES: { name: string; work?: BuildId; workName?: string }[] = [
  { name: '' },
  { name: 'The Hearth Age', work: 'greathearth', workName: 'the Great Hearth' },
  { name: 'The Village Age', work: 'square', workName: 'the Town Square' },
  { name: 'The Town Age' },
];
export function ageName(age: number): string {
  return AGES[age]?.name ?? 'The Long Road';
}
/** The Great Work of the Age now (none: the road goes on in a future update). */
export function greatWork(s: ShoreState): BuildId | undefined {
  return s.culture ? AGES[s.culture.age]?.work : undefined;
}
export function isGreatWork(id: BuildId): boolean {
  return AGES.some((a) => a.work === id);
}
/** Whether this Age has ideas of its own to come by (later Ages, not yet). */
export function ageHasIdeas(age: number): boolean {
  return IDEAS.some((i) => i.age === age);
}

/** Whether the Age's Great Work can be begun. */
export function workReady(s: ShoreState): boolean {
  const work = greatWork(s);
  return !!s.culture && !!work && !count(s, work) && lanesDone(s.culture) >= LANES_FOR_WORK;
}

/** The Age's Great Work stands: the Age is over, and the next begins. */
export function ageOver(state: GameState, s: ShoreState): void {
  const c = s.culture;
  if (!c) return;
  const was = AGES[c.age];
  if (!was?.work || !count(s, was.work)) return;
  c.age++;
  c.focus = undefined;
  s.news.push(`${was.name} is over. ${ageName(c.age)} begins.`);
  record(state, `${cap(was.workName ?? 'The Great Work')} was finished, and ${was.name.toLowerCase()} was over. ${ageName(c.age)} began. [STORY]`, 'shore', shoreWhen(s));
  (s.agesNew ??= []).push(c.age);
}
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** How far a lane is toward its next idea (0 to 1). */
export function laneShare(c: Culture, lane: Lane): number {
  return Math.min(1, (c.practice[lane] ?? 0) / cost(c, lane));
}

export { LANES_FOR_WORK };
