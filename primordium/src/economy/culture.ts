// Phase 2: Culture, the Long Road. At about a hundred people the village turns (everyone at a
// great fire), and from then on its culture grows by itself: eight lanes, each gathering
// practice from what the people actually do, and each idea landing on its own when its practice
// fills (while you're away too). You steer by focusing a lane. Now and then a fork: a choice
// that makes your people yours (left too long, the elders choose). Each Age closes with a Great
// Work. This is the first Age, the Hearth; the road goes on later.

import type { BuildId, Boosts } from '../content/shore';
import { record } from './chronicle';
import { can, count, DAY_SEC, deeds, foodRate, has, warmth, isAdult, poisOf, poiDef, relation, shoreWhen, totalCritters, type ShoreState } from './shore';
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

export type ForkId = 'dead' | 'law' | 'trade' | 'faith' | 'many' | 'written';

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

  // The Bronze Age.
  { id: 'plough', lane: 'food', age: 3, name: 'The plough', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'herds', lane: 'food', age: 3, name: 'Herds kept', does: 'Births +25%.', fx: { births: 0.25 } },
  { id: 'bronze', lane: 'crafts', age: 3, name: 'Copper and tin', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'wheel', lane: 'crafts', age: 3, name: 'The wheel', does: 'Walk +25%.', fx: { speed: 0.25 } },
  { id: 'bronzearms', lane: 'war', age: 3, name: 'Bronze arms', does: 'All food +20%.', fx: { food: 0.2 } },
  { id: 'chariots', lane: 'war', age: 3, name: 'Chariots', does: 'Stoke ×2.', fx: { tap: 1 } },
  { id: 'many', lane: 'rule', age: 3, name: 'Many villages', does: 'One people, or many: a choice.', fork: 'many' },
  { id: 'households', lane: 'rule', age: 3, name: 'Great households', does: 'All food +25%.', fx: { food: 0.25 } },
  { id: 'clans', lane: 'kin', age: 3, name: 'Clans by kind', does: 'Births +20%.', fx: { births: 0.2 } },
  { id: 'tongue', lane: 'kin', age: 3, name: 'A common tongue', does: 'Gift trust +50%.', fx: { gift: 0.5 } },
  { id: 'shrines', lane: 'rites', age: 3, name: 'The first shrine', does: 'All food +25%.', fx: { food: 0.25 } },
  { id: 'calendar', lane: 'rites', age: 3, name: 'The calendar', does: 'Growing up +25%.', fx: { grow: 0.25 } },
  { id: 'heroes', lane: 'stories', age: 3, name: 'Heroes of the island', does: 'All food +25%.', fx: { food: 0.25 } },
  { id: 'crossingsongs', lane: 'stories', age: 3, name: 'Songs of the crossing', does: 'Sight +3.', fx: { sight: 3 } },
  { id: 'marks', lane: 'words', age: 3, name: 'Picture marks', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'seals', lane: 'words', age: 3, name: 'Seals on jars', does: 'All food +20%.', fx: { food: 0.2 } },

  // The Iron Age.
  { id: 'ironplough', lane: 'food', age: 4, name: 'Iron ploughshares', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'mills', lane: 'food', age: 4, name: 'Mills', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'iron', lane: 'crafts', age: 4, name: 'Bog iron', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'ships', lane: 'crafts', age: 4, name: 'Ships', does: 'Sight +4.', fx: { sight: 4 } },
  { id: 'ironarms', lane: 'war', age: 4, name: 'Iron arms', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'forts', lane: 'war', age: 4, name: 'Forts', does: 'Stoke ×2.', fx: { tap: 1 } },
  { id: 'onecouncil', lane: 'rule', age: 4, name: 'One council', does: 'Gift trust +50%.', fx: { gift: 0.5 } },
  { id: 'roads', lane: 'rule', age: 4, name: 'Roads between villages', does: 'Walk +30%.', fx: { speed: 0.3 } },
  { id: 'citizens', lane: 'kin', age: 4, name: 'Citizens and strangers', does: 'Births +25%.', fx: { births: 0.25 } },
  { id: 'tongue2', lane: 'kin', age: 4, name: 'One tongue', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'temples', lane: 'rites', age: 4, name: 'Temples', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'festivals', lane: 'rites', age: 4, name: 'The year\'s festivals', does: 'Growing up +30%.', fx: { grow: 0.3 } },
  { id: 'epics', lane: 'stories', age: 4, name: 'Epics', does: 'All food +30%.', fx: { food: 0.3 } },
  { id: 'scribes', lane: 'stories', age: 4, name: 'The scribes', does: 'The old tellings written down.' },
  { id: 'writtenlaw', lane: 'words', age: 4, name: 'Written law', does: 'What is written: a choice.', fork: 'written' },
  { id: 'schools', lane: 'words', age: 4, name: 'Schools', does: 'All food +40%.', fx: { food: 0.4 } },

  // The Republic.
  { id: 'terraces', lane: 'food', age: 5, name: 'Terraced hills', does: 'All food +50%.', fx: { food: 0.5 } },
  { id: 'fleets', lane: 'food', age: 5, name: 'Fishing fleets', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'glass', lane: 'crafts', age: 5, name: 'Glassblowing', does: 'All food +50%.', fx: { food: 0.5 } },
  { id: 'cranes', lane: 'crafts', age: 5, name: 'Cranes', does: 'Walk +30%.', fx: { speed: 0.3 } },
  { id: 'legions', lane: 'war', age: 5, name: 'Standing legions', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'citywalls', lane: 'war', age: 5, name: 'City walls', does: 'Stoke ×2.', fx: { tap: 1 } },
  { id: 'senate', lane: 'rule', age: 5, name: 'The senate', does: 'Gift trust +50%.', fx: { gift: 0.5 } },
  { id: 'votes', lane: 'rule', age: 5, name: 'The vote', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'citizensall', lane: 'kin', age: 5, name: 'Citizens of every kind', does: 'Births +30%.', fx: { births: 0.3 } },
  { id: 'colonies', lane: 'kin', age: 5, name: 'Colonies', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'oracles', lane: 'rites', age: 5, name: 'Oracles', does: 'Growing up +30%.', fx: { grow: 0.3 } },
  { id: 'feasts5', lane: 'rites', age: 5, name: 'Feasts of the Republic', does: 'All food +40%.', fx: { food: 0.4 } },
  { id: 'histories', lane: 'stories', age: 5, name: 'Written histories', does: 'All food +50%.', fx: { food: 0.5 } },
  { id: 'theatre', lane: 'stories', age: 5, name: 'The theatre', does: 'Growing up +30%.', fx: { grow: 0.3 } },
  { id: 'libraries', lane: 'words', age: 5, name: 'Libraries', does: 'All food +60%.', fx: { food: 0.6 } },
  { id: 'lawcodes', lane: 'words', age: 5, name: 'Codes of law', does: 'Gift trust +50%.', fx: { gift: 0.5 } },

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
      { id: 'spear', name: 'The spear\'s fire', line: 'It fell from the sky, and the fire came with it.', lane: 'rites' },
    ],
  },
  written: {
    name: 'What is written',
    ask: 'Which tellings go into the record?',
    options: [
      { id: 'astold', name: 'As they were told', line: 'Every telling, word for word, the strange ones too.', lane: 'stories', fx: { food: 0.25 } },
      { id: 'onlysure', name: 'Only what\'s sure', line: 'What can be counted and sworn to; the rest stays at the fire.', lane: 'words', fx: { gift: 0.4 } },
    ],
  },
  many: {
    name: 'Many villages',
    ask: 'One people, or many?',
    options: [
      { id: 'onehearth', name: 'One hearth', line: 'Every village feeds the one fire.', lane: 'rule', fx: { food: 0.25 } },
      { id: 'ownfires', name: 'Each their own fire', line: 'Every village keeps its own, and they meet as equals.', lane: 'kin', fx: { births: 0.2, gift: 0.25 } },
    ],
  },
};

/** The size at which the village turns to its culture. */
export const TURN_AT = 40;
/** Practice an idea takes: a lane's first in the Age, then more for each after. */
const IDEA_COST = 100;
const IDEA_MORE = 100;
/** What an idea takes: its Age's price (each in a lane dearer than the one before it), half
 * for one left over from an Age gone by, and less again once something done has sped it. */
export function ideaCost(c: Culture, idea: Idea): number {
  const before = IDEAS.filter((i) => i.lane === idea.lane && i.age === idea.age && IDEAS.indexOf(i) < IDEAS.indexOf(idea)).length;
  return (IDEA_COST + before * IDEA_MORE) * (AGE_HARDER[idea.age] ?? 1) * (idea.age < c.age ? LEFTOVER : 1) * (c.boosted?.includes(idea.id) ? 1 - BOOST : 1);
}
function cost(c: Culture, lane: Lane): number {
  const next = nextIdea(c, lane);
  return next ? ideaCost(c, next) : Infinity;
}
/** An idea left over from an Age gone by: half the practice. */
const LEFTOVER = 0.5;
/** An idea sped by something done: this much less practice. */
export const BOOST = 0.4;
/** Later Ages' ideas take more practice (the village doing more, more is needed to learn). */
const AGE_HARDER: Record<number, number> = { 3: 3, 4: 8, 5: 20 };
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
  /** Ideas sped by something done (each once). */
  boosted?: string[];
}

const today = (s: ShoreState) => s.day + s.clock / DAY_SEC;

/** A lane's next idea: any left over from an Age gone by first (nothing's ever lost), then this
 * Age's (none: the lane has nothing more to learn for now). */
export function nextIdea(c: Culture, lane: Lane): Idea | undefined {
  return IDEAS.find((i) => i.lane === lane && i.age <= c.age && !c.done.includes(i.id));
}
/** Whether a lane's done this Age's ideas (left-overs from before don't hold the Age up). */
function laneDoneThisAge(c: Culture, lane: Lane): boolean {
  return !IDEAS.some((i) => i.lane === lane && i.age === c.age && !c.done.includes(i.id));
}

/** Practice a lane gathers a day, from what the village does. */
export function practiceRate(s: ShoreState, lane: Lane): number {
  const c = s.culture;
  const grown = s.people.filter((p) => isAdult(s, p)).length;
  const today_ = today(s);
  const gens = (ids: string[]) => ids.reduce((n, id) => n + count(s, id as never), 0);
  const won = s.villages.filter((v) => v.won !== undefined);
  // (Every lane goes on by itself a little, as much more in a later Age as its ideas cost more:
  // no lane's left behind for want of what feeds it.)
  let r = DRIFT * (AGE_HARDER[c?.age ?? 1] ?? 1);
  switch (lane) {
    case 'food':
      r += gens(['forager', 'camp', 'weir', 'lodge', 'garden', 'harbour', 'caravan']) * 0.02;
      break;
    case 'crafts':
      r += gens(['camp', 'weir', 'lodge', 'garden', 'granary', 'market', 'hut', 'longhouse', 'foundry', 'house', 'forge', 'townhouse']) * 0.012;
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
  return r * (c?.focus === lane && can(s, 'focus') ? FOCUS : 1) * warmth(s) * plenty(s);
}
/** What every lane gathers a day by itself (times the Age's hardness). */
const DRIFT = 0.8;
/** A village with more coming in has more time to think: ideas come faster by how many tenfolds
 * of food a second it has (×1 at 10 a second, ×1.5 at 100 thousand, ×2 at ten billion). So an
 * island made rich by embers grows its culture as fast as its stores. */
export function plenty(s: ShoreState): number {
  return 1 + Math.max(0, Math.log10(1 + foodRate(s)) - 1) / 8;
}

/** What the sea brings to the culture each day (the Age of Sail): routes sailed, islands
 * joined, voyages made, pirates driven off. */
export function seaCulture(state: GameState, s: ShoreState): number {
  const w = state.stages.sail?.world;
  if (!w) return 0;
  const joined = w.isles.filter((i) => i.joined).length;
  return ((w.routes?.length ?? 0) * 0.4 + joined * 0.8 + (w.voyages ?? 0) * 0.3 + (w.driven ?? 0) * 0.1) * (AGE_HARDER[s.culture?.age ?? 1] ?? 1) * warmth(s) * plenty(s);
}

/** What speeds each idea: a thing done (Civilization VI's inspirations). Shown on the Long Road
 * for a lane's next idea, so it can be gone after. */
const won = (s: ShoreState) => s.villages.filter((v) => v.won !== undefined).length;
const beat = (s: ShoreState) => deeds(s, 'beat');
const gifted = (s: ShoreState) => Math.max(0, won(s) - beat(s));
const explored = (s: ShoreState) => deeds(s, 'explored');
const others = (s: ShoreState) => s.people.filter((p) => p.kind !== undefined).length;
const words = (s: ShoreState) => Object.keys(s.lang?.heard ?? {}).length;
const routes = (st: GameState) => st.stages.sail?.world?.routes?.length ?? 0;
export const BOOSTS: Record<string, { say: string; met: (s: ShoreState, state: GameState) => boolean }> = {
  dried: { say: 'Have 10 foragers', met: (s) => count(s, 'forager' as never) >= 10 },
  grounds: { say: 'Have 3 gathering camps', met: (s) => count(s, 'camp' as never) >= 3 },
  blades: { say: 'Have 10 huts', met: (s) => count(s, 'hut' as never) >= 10 },
  baskets: { say: 'Have 40 critters', met: (s) => s.people.length >= 40 },
  watchers: { say: 'Find 3 villages', met: (s) => s.villages.filter((v) => v.found).length >= 3 },
  clubs: { say: 'Beat a village', met: (s) => beat(s) >= 1 },
  fourword: { say: 'Win a village with gifts', met: (s) => gifted(s) >= 1 },
  circle: { say: 'Have 60 critters', met: (s) => s.people.length >= 60 },
  hearths: { say: 'Another kind living among you', met: (s) => others(s) >= 1 },
  songs: { say: 'Dance at a village', met: (s) => deeds(s, 'dance') >= 1 },
  dead: { say: 'Lose one of the four', met: (s) => s.deaths >= 1 },
  feast: { say: 'Bring the fire to full heat', met: (s) => (s.heat ?? 0) >= 0.98 },
  crossing: { say: 'Explore a landmark fully', met: (s) => explored(s) >= 1 },
  farspear: { say: 'Hear the Far Voice', met: (s) => has(s, 'listen') },
  names: { say: 'Hear 20 of their words', met: (s) => words(s) >= 20 },
  fingers: { say: 'Have 100 critters', met: (s) => s.people.length >= 100 },
  salting: { say: 'Build a granary', met: (s) => count(s, 'granary' as never) >= 1 },
  markets: { say: 'Build a market', met: (s) => count(s, 'market' as never) >= 1 },
  kilns: { say: 'Have 30 huts', met: (s) => count(s, 'hut' as never) >= 30 },
  roadcraft: { say: 'Win 4 villages', met: (s) => won(s) >= 4 },
  levies: { say: 'Beat 2 villages', met: (s) => beat(s) >= 2 },
  shields: { say: 'Beat 3 villages', met: (s) => beat(s) >= 3 },
  oaths: { say: 'Win 3 villages with gifts', met: (s) => gifted(s) >= 3 },
  law: { say: 'Have the council', met: (s) => has(s, 'council') },
  marriages: { say: 'Have 10 of another kind among you', met: (s) => others(s) >= 10 },
  guests: { say: 'A visitor out of the fog', met: (s) => deeds(s, 'visitor') >= 1 },
  faith: { say: 'Work a sign of the Far Voice', met: (s) => deeds(s, 'sign') >= 1 },
  feastdays: { say: 'Dance 20 times', met: (s) => deeds(s, 'dance') >= 20 },
  founding: { say: 'Have 200 critters', met: (s) => s.people.length >= 200 },
  hidemaps: { say: 'Explore 3 landmarks fully', met: (s) => explored(s) >= 3 },
  tallies: { say: 'Hear 40 of their words', met: (s) => words(s) >= 40 },
  tithe: { say: 'Win 6 villages', met: (s) => won(s) >= 6 },
  plough: { say: 'Have 100 gardens', met: (s) => count(s, 'garden' as never) >= 100 },
  herds: { say: 'Have 400 critters', met: (s) => s.people.length >= 400 },
  bronze: { say: 'Build a foundry', met: (s) => count(s, 'foundry' as never) >= 1 },
  wheel: { say: 'Win 10 villages', met: (s) => won(s) >= 10 },
  bronzearms: { say: 'Beat 6 villages', met: (s) => beat(s) >= 6 },
  chariots: { say: 'Beat 10 villages', met: (s) => beat(s) >= 10 },
  many: { say: 'Win villages on two islands', met: (s) => (s.crossings ?? 0) >= 1 && won(s) >= 1 },
  households: { say: 'Have 600 critters', met: (s) => s.people.length >= 600 },
  clans: { say: 'Have 50 of another kind among you', met: (s) => others(s) >= 50 },
  tongue: { say: 'Borrow a word from a village', met: (s) => Object.keys(s.lang?.from ?? {}).length >= 1 },
  shrines: { say: 'Work 10 signs', met: (s) => deeds(s, 'sign') >= 10 },
  calendar: { say: 'Live 10 years', met: (s) => s.day >= 160 },
  heroes: { say: 'Beat 15 villages', met: (s) => beat(s) >= 15 },
  crossingsongs: { say: 'Cross the sea again', met: (s) => (s.crossings ?? 0) >= 1 },
  marks: { say: 'Hear 60 of their words', met: (s) => words(s) >= 60 },
  seals: { say: 'Build a harbour', met: (s) => count(s, 'harbour' as never) >= 1 },
  ironplough: { say: 'Have 1000 critters', met: (s) => s.people.length >= 1000 },
  mills: { say: 'Have 300 gardens', met: (s) => count(s, 'garden' as never) >= 300 },
  iron: { say: 'Build a forge', met: (s) => count(s, 'forge' as never) >= 1 },
  ships: { say: 'Build 10 harbours', met: (s) => count(s, 'harbour' as never) >= 10 },
  ironarms: { say: 'Beat 25 villages', met: (s) => beat(s) >= 25 },
  forts: { say: 'Take a village on a third island', met: (s) => (s.crossings ?? 0) >= 2 && beat(s) >= 1 },
  onecouncil: { say: 'Win 30 villages', met: (s) => won(s) >= 30 },
  roads: { say: 'Build 10 caravans', met: (s) => count(s, 'caravan' as never) >= 10 },
  citizens: { say: 'Have 200 of another kind among you', met: (s) => others(s) >= 200 },
  tongue2: { say: 'Borrow 5 words', met: (s) => Object.keys(s.lang?.from ?? {}).length >= 5 },
  temples: { say: 'Work 30 signs', met: (s) => deeds(s, 'sign') >= 30 },
  festivals: { say: 'Dance 100 times', met: (s) => deeds(s, 'dance') >= 100 },
  epics: { say: 'Explore 10 landmarks fully', met: (s) => explored(s) >= 10 },
  scribes: { say: 'Hear 80 of their words', met: (s) => words(s) >= 80 },
  writtenlaw: { say: 'Have the council plan for you', met: (s) => has(s, 'council2') },
  schools: { say: 'Have 2000 critters', met: (s) => s.people.length >= 2000 },
  terraces: { say: 'Have 600 gardens', met: (s) => count(s, 'garden' as never) >= 600 },
  fleets: { say: 'Open 5 trade routes', met: (_s, st) => routes(st) >= 5 },
  glass: { say: 'Build 50 forges', met: (s) => count(s, 'forge' as never) >= 50 },
  cranes: { say: 'Build 100 townhouses', met: (s) => count(s, 'townhouse' as never) >= 100 },
  legions: { say: 'Beat 40 villages', met: (s) => beat(s) >= 40 },
  citywalls: { say: 'Have 3000 critters', met: (s) => s.people.length >= 3000 },
  senate: { say: 'Win 50 villages', met: (s) => won(s) >= 50 },
  votes: { say: 'Have the council of the wise', met: (s) => has(s, 'council3') },
  citizensall: { say: 'Have 500 of another kind among you', met: (s) => others(s) >= 500 },
  colonies: { say: 'Settle 4 islands', met: (s) => (s.crossings ?? 0) >= 3 },
  oracles: { say: 'Work 60 signs', met: (s) => deeds(s, 'sign') >= 60 },
  feasts5: { say: 'Dance 200 times', met: (s) => deeds(s, 'dance') >= 200 },
  histories: { say: 'Explore 20 landmarks fully', met: (s) => explored(s) >= 20 },
  theatre: { say: 'Hear 100 of their words', met: (s) => words(s) >= 100 },
  libraries: { say: 'Write down their tongue (the scribes)', met: (s) => !!s.lang?.scribed },
  lawcodes: { say: 'Borrow 10 words', met: (s) => Object.keys(s.lang?.from ?? {}).length >= 10 },
};
/** What speeds an idea, and whether it's been done. */
export function boostOf(s: ShoreState, state: GameState, id: string): { say: string; met: boolean } | null {
  const b = BOOSTS[id];
  return b ? { say: b.say, met: !!s.culture?.boosted?.includes(id) || b.met(s, state) } : null;
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

/** The turn: at forty, everyone at a great fire, and the culture begins. */
export function maybeTurn(state: GameState, s: ShoreState): void {
  if (s.culture || totalCritters(s) < TURN_AT) return;
  s.culture = { since: today(s), age: 1, practice: {}, done: [], forks: {} };
  s.turned = true;
  record(state, 'They were forty. They gathered at a great fire, all of them at once. [STORY]', 'shore', shoreWhen(s));
}

/** Each day: practice gathered, ideas landing, a fork answered by the elders if left too long. */
export function cultureDay(state: GameState, s: ShoreState): void {
  const c = s.culture;
  if (!c) return;
  // Things done speed the ideas that go with them (once each, for good).
  for (const [id, b] of Object.entries(BOOSTS)) {
    if (c.boosted?.includes(id) || c.done.includes(id)) continue;
    const idea = IDEAS.find((i) => i.id === id);
    if (!idea || idea.age > c.age + 1 || !b.met(s, state)) continue;
    (c.boosted ??= []).push(id);
    s.news.push(`${idea.age <= c.age ? idea.name : 'An idea to come'} is nearer: ${b.say.toLowerCase()}.`);
  }
  // One culture: what every lane gathers, and what the sea brings in. A lane with nothing left
  // to learn gives its share to the others (in proportion to their own), so none of it's lost.
  const rates = LANES.map((l) => ({ l: l.id, r: practiceRate(s, l.id), open: !!nextIdea(c, l.id) }));
  const openSum = rates.filter((x) => x.open).reduce((n, x) => n + x.r, 0);
  const spare = rates.filter((x) => !x.open).reduce((n, x) => n + x.r, 0) + seaCulture(state, s);
  for (const l of LANES) {
    const next = nextIdea(c, l.id);
    if (!next) continue;
    const own = rates.find((x) => x.l === l.id)!.r;
    c.practice[l.id] = (c.practice[l.id] ?? 0) + own + (openSum > 0 ? (spare * own) / openSum : 0);
    if ((c.practice[l.id] ?? 0) < cost(c, l.id)) continue;
    c.practice[l.id] = 0;
    c.done.push(next.id);
    (c.fresh ??= []).push(next.id);
    // (Picture marks: they write, from now on.)
    if (next.id === 'marks') s.writtenFrom ??= s.day;
    // (The scribes: what the words mean, written down, for good.)
    if (next.id === 'scribes' && s.lang) s.lang.scribed = true;
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
  return LANES.filter((l) => laneDoneThisAge(c, l.id)).length;
}

/** The Ages, and the Great Work that closes each. */
export const AGES: { name: string; work?: BuildId; workName?: string }[] = [
  { name: '' },
  { name: 'The Hearth Age', work: 'greathearth', workName: 'the Great Hearth' },
  { name: 'The Village Age', work: 'square', workName: 'the Town Square' },
  { name: 'The Bronze Age', work: 'hall', workName: 'the Chief\'s Hall' },
  { name: 'The Iron Age', work: 'forum', workName: 'the Forum' },
  { name: 'The Republic', work: 'senatehouse', workName: 'the Senate House' },
  // (New Shore's era ends with the Republic: the Senate House raised, the sea is next.)
  { name: 'The Age of Sail' },
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
  // The Republic's the last of New Shore's Ages: the era's done, and the sea's next.
  if (!AGES[c.age]?.work && !ageHasIdeas(c.age)) {
    s.news.push(`${was.name} stands. The island is theirs. The sea is next.`);
    s.eraEnd = true;
    record(state, `${cap(was.workName ?? 'The Great Work')} was raised. The Republic stood, the island one people of many kinds, and they looked out to sea. [STORY]`, 'shore', shoreWhen(s));
    // (No new Age's card: the era's own ending says it.)
    return;
  }
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
