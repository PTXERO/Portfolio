// Phase 2: Culture, the Long Road. At about a hundred people the village turns (everyone at a
// great fire), and from then on its culture grows by itself: eight lanes, each gathering
// practice from what the people actually do, and each idea landing on its own when its practice
// fills (while you're away too). You steer by focusing a lane. Now and then a fork: a choice
// that makes your people yours (left too long, the elders choose). Each Age closes with a Great
// Work. This is the first Age, the Hearth; the road goes on later.

import type { Boosts } from '../content/shore';
import { record } from './chronicle';
import { count, DAY_SEC, isAdult, poisOf, poiDef, shoreWhen, type ShoreState } from './shore';
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

export type ForkId = 'dead';

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

/** The Hearth Age's ideas: two a lane. */
export const IDEAS: Idea[] = [
  { id: 'dried', lane: 'food', age: 1, name: 'Dried meat and fruit', does: 'Room for 40 more food.', fx: { foodCap: 40 } },
  { id: 'grounds', lane: 'food', age: 1, name: 'Known grounds', does: 'Food comes in 5% faster.', fx: { food: 0.05 } },
  { id: 'blades', lane: 'crafts', age: 1, name: 'Stone blades', does: 'Wood comes in 5% faster.', fx: { wood: 0.05 } },
  { id: 'baskets', lane: 'crafts', age: 1, name: 'Baskets', does: 'Room for 30 more food and 30 more wood.', fx: { foodCap: 30, woodCap: 30 } },
  { id: 'watchers', lane: 'war', age: 1, name: 'Watchers', does: 'Raiders are seen a day sooner.', fx: { warn: 1 } },
  { id: 'clubs', lane: 'war', age: 1, name: 'Clubs', does: 'They fight 10% harder.', fx: { arms: 0.1 } },
  { id: 'fourword', lane: 'rule', age: 1, name: 'The four\'s word', does: 'What the four said is law: gifts win 10% more trust.', fx: { gift: 0.1 } },
  { id: 'circle', lane: 'rule', age: 1, name: 'The elders\' circle', does: 'Children grow up 5% faster.', fx: { grow: 0.05 } },
  { id: 'hearths', lane: 'kin', age: 1, name: 'Mixed hearths', does: 'Children are born 5% more often.', fx: { births: 0.05 } },
  { id: 'songs', lane: 'kin', age: 1, name: 'Shared songs', does: 'Gifts win 10% more trust.', fx: { gift: 0.1 } },
  { id: 'dead', lane: 'rites', age: 1, name: 'The dead', does: 'How the dead are seen to: a choice.', fork: 'dead' },
  { id: 'feast', lane: 'rites', age: 1, name: 'The first feast', does: 'Children are born 5% more often.', fx: { births: 0.05 } },
  { id: 'crossing', lane: 'stories', age: 1, name: 'The Crossing told', does: 'A tenth fewer die when food runs short.', fx: { mend: 0.1 } },
  { id: 'farspear', lane: 'stories', age: 1, name: 'The spear far off', does: 'The chief and the scouts see 2 tiles further.', fx: { sight: 2 } },
  { id: 'names', lane: 'words', age: 1, name: 'Names for everything', does: 'The chief and the scouts walk 5% faster.', fx: { speed: 0.05 } },
  { id: 'fingers', lane: 'words', age: 1, name: 'Finger-counting', does: 'Room for 40 more wood.', fx: { woodCap: 40 } },
];

export const FORKS: Record<ForkId, { name: string; ask: string; options: { id: string; name: string; line: string; fx?: Partial<Boosts>; lane?: Lane; cannibal?: boolean }[] }> = {
  dead: {
    name: 'The dead',
    ask: 'How are the dead seen to?',
    options: [
      { id: 'bury', name: 'Bury them', line: 'Laid in the earth near the hearth, and remembered there.', lane: 'stories' },
      { id: 'burn', name: 'Burn them', line: 'Given to the fire, and gone up with the smoke.', lane: 'rites' },
      { id: 'eat', name: 'Eat them', line: 'Nothing is wasted. Not even them.', fx: { food: 0.05 }, cannibal: true },
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
export function practiceRate(s: ShoreState, lane: Lane, plan: { food: number; wood: number }): number {
  const c = s.culture;
  const grown = s.people.filter((p) => isAdult(s, p)).length;
  const today_ = today(s);
  const base = 0.3;
  let r = base;
  switch (lane) {
    case 'food':
      r += plan.food * 0.03 + (count(s, 'camp') + count(s, 'weir')) * 0.15;
      break;
    case 'crafts':
      r += plan.wood * 0.05 + s.built.length * 0.01;
      break;
    case 'war':
      r += (s.raids ?? 0) * 0.08 + (count(s, 'watch') + count(s, 'spears') + count(s, 'palisade')) * 0.3;
      break;
    case 'rule':
      r += count(s, 'council') * 0.4 + grown * 0.006;
      break;
    case 'kin':
      r += s.people.filter((p) => p.kind !== undefined).length * 0.02 + s.villages.filter((v) => v.joined || v.vassal).length * 0.25;
      break;
    case 'rites':
      r += count(s, 'hearth') * 0.3 + count(s, 'elders') * 0.3 + count(s, 'pool') * 0.2 + Math.min(1, s.deaths * 0.01);
      break;
    case 'stories':
      r += s.people.filter((p) => p.dies !== undefined && p.dies - today_ < 15).length * 0.03 + poisOf(s).filter((p) => p.done >= poiDef(p).layers.length).length * 0.15;
      break;
    case 'words':
      r += count(s, 'scout') * 0.25 + count(s, 'lookout') * 0.3 + grown * 0.004;
      break;
  }
  // The road chosen at a fork: its lane goes a little faster.
  for (const [f, o] of Object.entries(c?.forks ?? {})) if (FORKS[f as ForkId]?.options.find((x) => x.id === o)?.lane === lane) r *= 1.25;
  return r * (c?.focus === lane ? FOCUS : 1);
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
  if (s.culture || s.people.length < TURN_AT) return;
  s.culture = { since: today(s), age: 1, practice: {}, done: [], forks: {} };
  s.turned = true;
  record(state, 'They were a hundred. They gathered at a great fire, all of them at once. [STORY]', 'shore', shoreWhen(s));
}

/** Each day: practice gathered, ideas landing, a fork answered by the elders if left too long. */
export function cultureDay(state: GameState, s: ShoreState, plan: { food: number; wood: number }): void {
  const c = s.culture;
  if (!c) return;
  for (const l of LANES) {
    const next = nextIdea(c, l.id);
    if (!next) continue;
    c.practice[l.id] = (c.practice[l.id] ?? 0) + practiceRate(s, l.id, plan);
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

/** Whether the Age's Great Work can be begun. */
export function workReady(s: ShoreState): boolean {
  return !!s.culture && s.culture.age === 1 && lanesDone(s.culture) >= LANES_FOR_WORK;
}

/** The Great Hearth stands: the Hearth Age is over. */
export function ageOver(state: GameState, s: ShoreState): void {
  const c = s.culture;
  if (!c || c.age !== 1) return;
  c.age = 2;
  c.focus = undefined;
  s.news.push('The Hearth Age is over.');
  record(state, 'The Great Hearth was lit, and the Hearth Age was over. [STORY]', 'shore', shoreWhen(s));
}

/** How far a lane is toward its next idea (0 to 1). */
export function laneShare(c: Culture, lane: Lane): number {
  return Math.min(1, (c.practice[lane] ?? 0) / cost(c, lane));
}

export { LANES_FOR_WORK };
