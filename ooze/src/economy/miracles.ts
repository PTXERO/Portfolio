// The spear's will: in the Extinction you aren't one of them any more. The tribe runs itself
// (who works where, how much they eat, when the raft goes and who's on it), and the Chronicle
// tells what they do and why. You are the voice in the spear: you teach ideas, you whisper at
// the turning points, and you work miracles, drawn on the world, paid for in their prayer.
// Every miracle saves lives, and every miracle frightens them a little more (Dread). Each diet
// has five miracles, found as the spear sees the need; one cast often enough can be ordained,
// and then the spear works it unasked when it's needed (at a higher price).

import {
  autoAssign,
  dayYield,
  eatsMeat,
  eatsPlants,
  FAMILY,
  jobFood,
  launch,
  provisions,
  raftDone,
  VOYAGE_FOOD,
  type Diet,
  type ExtinctionState,
  type Focus,
} from './extinction';
import type { GameState } from './types';

export type SpellId = 'lightning' | 'rain' | 'ward' | 'shake' | 'kelp' | 'shoals' | 'dying';
export type Gesture = 'zigzag' | 'spiral' | 'circle' | 'line';

export interface SpellDef {
  id: SpellId;
  name: string;
  gesture: Gesture;
  /** How to draw it, and what it does. */
  how: string;
  does: string;
  cost: number;
  dread: number;
  diets: Diet[];
  /** When the spear first sees the need (and a hint while it hasn't). */
  hint: string;
  found: (ex: ExtinctionState) => boolean;
}

const ALL: Diet[] = ['herbivore', 'carnivore', 'omnivore', 'cannibal'];
const carrionStart = (ex: ExtinctionState) => (ex.people.length + ex.deaths) * 6;

export const SPELLS: SpellDef[] = [
  { id: 'lightning', name: 'Lightning', gesture: 'zigzag', how: 'Draw a zigzag down onto a charred tree.', does: 'The tree burns down to wood (+10), and tonight they have fire, even without knowing it.', cost: 6, dread: 12, diets: ALL, hint: '', found: () => true },
  { id: 'rain', name: 'Rain', gesture: 'spiral', how: 'Draw a spiral over the ash.', does: 'Rain falls and green comes up through the ash (its food grows back), and tonight is not cold.', cost: 8, dread: 6, diets: ALL, hint: 'When the ash runs thin.', found: (ex) => ex.ash < ex.ashMax * 0.7 || ex.day >= 3 },
  { id: 'ward', name: 'Ward', gesture: 'circle', how: 'Draw a circle round some of them.', does: 'Those inside are cured of the shaking, and the hunger eases a little.', cost: 9, dread: 4, diets: ALL, hint: 'When the first of them dies.', found: (ex) => ex.deaths > 0 },
  { id: 'shake', name: 'Shake the trees', gesture: 'line', how: 'Draw a line down onto a tree.', does: 'Fruit and seed rain down into a pile (+24 plants).', cost: 8, dread: 8, diets: ['herbivore', 'omnivore'], hint: 'When the fallen fruit runs low.', found: (ex) => ex.carrion < carrionStart(ex) * 0.4 || ex.day >= 5 },
  { id: 'kelp', name: 'Kelp tide', gesture: 'line', how: 'Draw a line from the sea onto the shore.', does: 'A wave throws kelp up the beach (+20 plants), and the shallows are rich all day.', cost: 10, dread: 8, diets: ['herbivore'], hint: 'When they look to the sea.', found: (ex) => ex.day >= 6 },
  { id: 'shoals', name: 'Drive the shoals', gesture: 'line', how: 'Draw a line from the sea onto the shore.', does: 'Fish pile onto the beach (+20 meat), and the shore teems all day.', cost: 10, dread: 8, diets: ['carnivore', 'omnivore', 'cannibal'], hint: 'When they look to the sea.', found: (ex) => ex.day >= 6 },
  { id: 'dying', name: 'Call the dying', gesture: 'line', how: 'Draw a long line in toward their camp.', does: 'A wounded beast staggers in along it and falls by the camp (+30 meat to scavenge).', cost: 9, dread: 10, diets: ['carnivore', 'cannibal'], hint: 'When the carcasses run low.', found: (ex) => ex.carrion < carrionStart(ex) * 0.4 || ex.day >= 5 },
];
export const SPELL: Record<SpellId, SpellDef> = Object.fromEntries(SPELLS.map((s) => [s.id, s])) as Record<SpellId, SpellDef>;

/** A diet's five. */
export function spellsFor(diet: Diet): SpellDef[] {
  return SPELLS.filter((s) => s.diets.includes(diet));
}

/** Prayer each night: from everyone left, and a little from the spear itself. */
export const PRAYER_MAX = 40;
const prayerFor = (alive: number) => 1.5 + 0.5 * Math.sqrt(alive);
/** Dread fades each night; past these they cower (work less), then walk into the sea. */
const DREAD_FADE = 2.5;
export const DREAD_COWER = 60;
export const DREAD_FLEE = 85;
/** Casts before a miracle can be ordained, and what the spear charges to work it unasked. */
export const ORDAIN_AFTER = 4;
export const ORDAIN_COST = 1.5;

/** The Chronicle: what happened, day by day (newest last, the last forty kept). */
export function say(ex: ExtinctionState, text: string): void {
  (ex.log ??= []).push({ day: ex.day + 1, text });
  if (ex.log.length > 40) ex.log.splice(0, ex.log.length - 40);
}

/** Miracles found but not yet shown to the player (the discovery cards). */
export function discover(ex: ExtinctionState): SpellId[] {
  const known = (ex.powers ??= []);
  const fresh: SpellId[] = [];
  for (const s of spellsFor(ex.diet)) {
    if (known.includes(s.id) || !s.found(ex)) continue;
    known.push(s.id);
    fresh.push(s.id);
    if (s.id !== 'lightning') say(ex, `The spear stirred. Something new could be done: ${s.name}.`);
  }
  (ex.newPowers ??= []).push(...fresh);
  return fresh;
}

export function canCast(ex: ExtinctionState, id: SpellId, ordained = false): boolean {
  const s = SPELL[id];
  return !ex.over && !ex.escaped && (ex.powers ?? []).includes(id) && s.diets.includes(ex.diet) && (ex.prayer ?? 0) >= s.cost * (ordained ? ORDAIN_COST : 1);
}

/**
 * Works a miracle. `people` are the indexes (into ex.people) of those inside a Ward. Its
 * effect lands at once, and the tribe re-plans straight away (they run to what appeared).
 */
export function cast(ex: ExtinctionState, id: SpellId, opts: { people?: number[]; ordained?: boolean } = {}): { ok: boolean; text: string } {
  if (!canCast(ex, id, opts.ordained)) return { ok: false, text: 'Not enough prayer.' };
  const s = SPELL[id];
  let text = '';
  switch (id) {
    case 'lightning':
      ex.wood = (ex.wood ?? 0) + 10;
      ex.trees = Math.max(0, (ex.trees ?? 0) - 3);
      ex.fireTonight = true;
      text = '+10 wood · fire tonight';
      say(ex, 'Lightning came down out of a clear sky and set a dead tree burning. They kept the fire.');
      break;
    case 'rain':
      ex.ash = Math.min(ex.ashMax, ex.ash + ex.ashMax * 0.12);
      ex.warmTonight = true;
      text = 'green in the ash';
      say(ex, 'It rained, warm, on one patch of ash only. By evening there was green there.');
      break;
    case 'ward': {
      const inside = (opts.people ?? []).map((i) => ex.people[i]).filter(Boolean);
      if (!inside.length) return { ok: false, text: 'No one inside.' };
      let cured = 0;
      for (const p of inside) {
        if (p.sick !== undefined) cured++;
        delete p.sick;
        p.hunger = Math.max(0, p.hunger - 0.5);
      }
      text = cured ? `${cured} cured` : `${inside.length} strengthened`;
      say(ex, cured ? `A light came round ${inside.length} of them. ${cured === 1 ? 'One' : cured} stopped shaking.` : `A light came round ${inside.length} of them, and the hunger eased.`);
      break;
    }
    case 'shake':
      if (ex.diet === 'herbivore') ex.carrion += 24;
      else ex.plants += 24;
      text = '+24 plants';
      say(ex, 'The trees shook with no wind, and fruit came down.');
      break;
    case 'kelp':
      ex.plants += 20;
      ex.boost = { day: ex.day, fish: 1 };
      text = '+20 plants · rich shallows';
      say(ex, 'A wave out of a calm sea threw kelp the length of the beach.');
      break;
    case 'shoals':
      ex.meat += 20;
      ex.boost = { day: ex.day, fish: 1 };
      text = '+20 meat · the shore teems';
      say(ex, 'The water boiled with fish, and they leapt onto the sand.');
      break;
    case 'dying':
      ex.carrion += 30;
      text = '+30 meat to scavenge';
      say(ex, 'A wounded beast came out of the ash, walked into the camp, and lay down.');
      break;
  }
  ex.prayer = (ex.prayer ?? 0) - s.cost * (opts.ordained ? ORDAIN_COST : 1);
  ex.dread = Math.min(100, (ex.dread ?? 0) + s.dread);
  (ex.casts ??= {})[id] = (ex.casts[id] ?? 0) + 1;
  // They saw it: they go to what appeared.
  autoAssign(ex);
  return { ok: true, text };
}

/** Ordains a miracle (once cast often enough): the spear works it when it's needed. */
export function toggleOrdain(ex: ExtinctionState, id: SpellId): void {
  if ((ex.casts?.[id] ?? 0) < ORDAIN_AFTER) return;
  const o = (ex.ordained ??= []);
  const i = o.indexOf(id);
  if (i >= 0) o.splice(i, 1);
  else o.push(id);
}

/** Edible food in store and coming in today, against what they need. */
function short(ex: ExtinctionState): boolean {
  const y = dayYield(ex);
  let coming = 0;
  for (const j of ['forage', 'scavenge', 'dig', 'fish'] as const) {
    const f = jobFood(ex.diet, j);
    if ((f === 'plants' && eatsPlants(ex.diet)) || (f === 'meat' && eatsMeat(ex.diet))) coming += y[j];
  }
  return provisions(ex) + coming < ex.people.length * ex.ration;
}

/** The ordained miracles the spear works unasked: those needed now. Returns what was worked
 * (for the scene to show). */
export function ordainedNeeds(ex: ExtinctionState): SpellId[] {
  const worked: SpellId[] = [];
  for (const id of ex.ordained ?? []) {
    if (!canCast(ex, id, true)) continue;
    const sick = ex.people.map((p, i) => [p, i] as const).filter(([p]) => p.sick !== undefined || p.hunger >= 2.2);
    const need =
      id === 'lightning' ? (ex.ideas.includes('fire') && (ex.wood ?? 0) < 4) || (ex.day >= 12 && ex.day < 26 && !ex.ideas.includes('fire')) :
      id === 'rain' ? ex.ash < ex.ashMax * 0.35 :
      id === 'ward' ? sick.length >= 2 :
      short(ex);
    if (!need) continue;
    const r = cast(ex, id, { ordained: true, people: id === 'ward' ? sick.slice(0, 8).map(([, i]) => i) : undefined });
    if (r.ok) worked.push(id);
  }
  return worked;
}

/**
 * The tribe's own mind, each dawn: how much to eat, what to put the spare hands to, and who
 * the dread drives off. (Called after the night's meal, before they go to work.)
 */
export function tribeThinks(ex: ExtinctionState): void {
  const n = ex.people.length;
  if (!n) return;
  // Prayer, and dread fading (and what too much of it does).
  ex.prayer = Math.min(PRAYER_MAX, (ex.prayer ?? 0) + prayerFor(n));
  ex.dread = Math.max(0, (ex.dread ?? 0) - DREAD_FADE);
  if ((ex.dread ?? 0) >= DREAD_FLEE && n > 2) {
    const p = ex.people.splice(Math.floor(((ex.luck ?? 7) % 997) / 997 * n), 1)[0];
    ex.deaths += 1;
    say(ex, `${p.name} walked into the sea in the night, to get away from the voice.`);
  } else if ((ex.dread ?? 0) >= DREAD_COWER) say(ex, 'They cower from the spear now, and work with their eyes on it.');
  // Rations: from what there is and what's coming.
  const y = dayYield(ex);
  let coming = 0;
  for (const j of ['forage', 'scavenge', 'dig', 'fish'] as const) {
    const f = jobFood(ex.diet, j);
    if ((f === 'plants' && eatsPlants(ex.diet)) || (f === 'meat' && eatsMeat(ex.diet))) coming += y[j];
  }
  const have = provisions(ex) + coming;
  const was = ex.ration;
  ex.ration = have >= n * 1.1 ? 1 : have >= n * 0.5 ? 0.5 : 0.25;
  if (ex.ration !== was) say(ex, ex.ration > was ? `There was enough again. They ate ${ex.ration === 1 ? 'full meals' : 'half meals'}.` : ex.ration === 0.5 ? 'They halved the rations. The old ate last.' : 'They cut the rations to scraps. Some stopped eating so the young could.');
  // What to put spare hands to: ideas first, then the raft (wood for it before building).
  const was2 = ex.focus;
  ex.focus = aiFocus(ex);
  if (ex.focus !== was2 && ex.focus === 'raft') say(ex, 'They began to talk about the sea, and what lay past it. Some started on a raft.');
}

function aiFocus(ex: ExtinctionState): Focus {
  const fed = (ex.last?.starved.length ?? 1) === 0;
  if (ex.ideas.length < 4 || (!fed && ex.day < 20)) return 'ideas';
  return 'raft';
}

/** When the raft is ready and there's food for the crossing, they choose the four and go. */
export function tribeLaunches(state: GameState): boolean {
  const ex = state.stages.tribal.tribe?.ex;
  if (!ex || ex.escaped || ex.over || !raftDone(ex) || ex.people.length < FAMILY || provisions(ex) < VOYAGE_FOOD) return false;
  // The healthiest, favouring the young and the strong.
  const score = (p: ExtinctionState['people'][number]) => (p.sick !== undefined ? -10 : 0) - p.hunger + (p.trait === 'young' ? 1 : p.trait === 'strong' || p.trait === 'hardy' ? 0.6 : p.trait === 'frail' || p.trait === 'old' ? -1 : 0);
  ex.family = [...ex.people].sort((a, b) => score(b) - score(a)).slice(0, FAMILY).map((p) => p.id);
  const names = ex.people.filter((p) => ex.family!.includes(p.id)).map((p) => p.name);
  say(ex, `The raft was ready. ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} pushed it out past the breakers.`);
  return launch(state);
}
