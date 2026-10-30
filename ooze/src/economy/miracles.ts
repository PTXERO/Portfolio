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
  raftPart,
  VOYAGE_FOOD,
  type Diet,
  type ExtinctionState,
  type Focus,
  type Survivor,
} from './extinction';
import { remember } from './society';
import { chooseFour, leftBehind } from './whispers';
import type { GameState } from './types';

export type SpellId = 'lightning' | 'rain' | 'ward' | 'quicken' | 'kelp' | 'shoals' | 'dying';
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
  { id: 'lightning', name: 'Lightning', gesture: 'zigzag', how: 'Draw a zigzag down onto a charred tree.', does: 'The tree burns down to wood (+10), and tonight they have fire, even without knowing it. Brought down on one of them, it kills them.', cost: 6, dread: 12, diets: ALL, hint: '', found: () => true },
  { id: 'rain', name: 'Rain', gesture: 'spiral', how: 'Draw a spiral over the ash.', does: 'Rain falls and green comes up through the ash (its food grows back), and tonight is not cold.', cost: 8, dread: 6, diets: ALL, hint: 'When the ash runs thin.', found: (ex) => ex.day >= 5 && ex.ash < ex.ashMax * 0.45 },
  { id: 'ward', name: 'Ward', gesture: 'circle', how: 'Draw a circle round some of them.', does: 'Those inside are cured of the shaking, and the hunger eases a little.', cost: 9, dread: 4, diets: ALL, hint: 'When death comes for them in earnest.', found: (ex) => ex.day >= 4 && ex.deaths >= 4 },
  { id: 'quicken', name: 'Quicken the ash', gesture: 'line', how: 'Draw a line across the ash.', does: 'Seeds buried under the fire wake all at once: a furrow of fireweed springs up along the line (+16 plants).', cost: 8, dread: 8, diets: ['herbivore', 'omnivore'], hint: 'When the fallen fruit is gone.', found: (ex) => ex.day >= 7 && ex.carrion < carrionStart(ex) * 0.15 },
  { id: 'kelp', name: 'Kelp tide', gesture: 'line', how: 'Draw a line from the sea onto the shore.', does: 'A wave throws kelp up the beach (+14 plants), and the shallows are rich all day.', cost: 10, dread: 8, diets: ['herbivore'], hint: 'When they look to the sea.', found: (ex) => ex.day >= 10 && (ex.ideas.includes('line') || ex.day >= 16) },
  { id: 'shoals', name: 'Drive the shoals', gesture: 'line', how: 'Draw a line from the sea onto the shore.', does: 'Fish pile onto the beach (+14 meat), and the shore teems all day.', cost: 10, dread: 8, diets: ['carnivore', 'omnivore', 'cannibal'], hint: 'When they look to the sea.', found: (ex) => ex.day >= 10 && (ex.ideas.includes('line') || ex.day >= 16) },
  { id: 'dying', name: 'Call the dying', gesture: 'line', how: 'Draw a long line in toward their camp.', does: 'A wounded beast staggers in along it and falls by the camp (+22 meat to scavenge).', cost: 9, dread: 10, diets: ['carnivore', 'cannibal'], hint: 'When the carcasses are picked clean.', found: (ex) => ex.day >= 7 && ex.carrion < carrionStart(ex) * 0.15 },
];
export const SPELL: Record<SpellId, SpellDef> = Object.fromEntries(SPELLS.map((s) => [s.id, s])) as Record<SpellId, SpellDef>;

/** A diet's five. */
export function spellsFor(diet: Diet): SpellDef[] {
  return SPELLS.filter((s) => s.diets.includes(diet));
}

/** Prayer each night: from everyone left, and a little from the spear itself. */
export const PRAYER_MAX = 40;
const prayerFor = (alive: number) => 1.2 + 0.4 * Math.sqrt(alive);
/** Dread fades each night; past these they cower (work less), then walk into the sea. */
const DREAD_FADE = 2.5;
export const DREAD_COWER = 60;
export const DREAD_FLEE = 85;
/** Casts before a miracle can be ordained, and what the spear charges to work it unasked. */
export const ORDAIN_AFTER = 4;
export const ORDAIN_COST = 2;
/** What an ordained miracle does, next to one worked by hand (the spear's own are dimmer). */
export const ORDAIN_POWER = 0.5;

/** The Chronicle: what happened, day by day (newest last, the last 150 kept). */
export function say(ex: ExtinctionState, text: string): void {
  (ex.log ??= []).push({ day: ex.day + 1, text });
  ex.logN = (ex.logN ?? 0) + 1;
  if (ex.log.length > 150) ex.log.splice(0, ex.log.length - 150);
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
    // One a night at most: each is its own moment.
    break;
  }
  (ex.newPowers ??= []).push(...fresh);
  return fresh;
}

export function canCast(ex: ExtinctionState, id: SpellId, ordained = false): boolean {
  const s = SPELL[id];
  return !ex.over && !ex.escaped && (ex.powers ?? []).includes(id) && s.diets.includes(ex.diet) && (ex.prayer ?? 0) >= s.cost * (ordained ? ORDAIN_COST : 1);
}

/** Lightning on one of them: dead where they stood. The rest are terrified, and those who
 * loved them grieve; the island's madness feeds on it. */
function strikeDown(ex: ExtinctionState, p: Survivor): void {
  ex.people = ex.people.filter((q) => q !== p);
  ex.deaths += 1;
  ex.dread = Math.min(100, (ex.dread ?? 0) + 25);
  ex.madness = Math.min(100, (ex.madness ?? 0) + 5);
  for (const q of ex.people) {
    const bond = (q.bonds ?? []).find((b) => b.id === p.id);
    if (bond) {
      q.grief = 3;
      remember(ex, q, `saw ${p.name} struck down by the spear`);
    }
    q.bonds = (q.bonds ?? []).filter((b) => b.id !== p.id);
  }
  say(ex, `Lightning came down out of a clear sky onto ${p.name}. There was nothing left to bury. No one went near the spear for days.`);
}

/**
 * Works a miracle. `people` are the indexes (into ex.people) of those inside a Ward. Its
 * effect lands at once, and the tribe re-plans straight away (they run to what appeared).
 */
export function cast(ex: ExtinctionState, id: SpellId, opts: { people?: number[]; ordained?: boolean; power?: number; struck?: number } = {}): { ok: boolean; text: string } {
  if (!canCast(ex, id, opts.ordained)) return { ok: false, text: 'Not enough prayer.' };
  const s = SPELL[id];
  let text = '';
  // How much it does: a hand-worked miracle in full, an ordained one dimmer, one answering a
  // crisis twice over.
  const k = opts.power ?? (opts.ordained ? ORDAIN_POWER : 1);
  const n = (v: number) => Math.round(v * k);
  switch (id) {
    case 'lightning':
      // Brought down on one of them, it kills them.
      if (opts.struck !== undefined) {
        const p = ex.people[opts.struck];
        if (!p) return { ok: false, text: 'No one there.' };
        strikeDown(ex, p);
        text = `${p.name} is dead`;
        break;
      }
      ex.wood = (ex.wood ?? 0) + n(10);
      ex.trees = Math.max(0, (ex.trees ?? 0) - 3);
      ex.fireTonight = true;
      text = `+${n(10)} wood · fire tonight`;
      say(ex, 'Lightning came down out of a clear sky and set a dead tree burning. They kept the fire.');
      break;
    case 'rain':
      ex.ash = Math.min(ex.ashMax, ex.ash + ex.ashMax * 0.12 * k);
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
        remember(ex, p, p.sick !== undefined ? 'was cured of the shaking by a light from the spear' : 'felt a light from the spear ease the hunger');
        delete p.sick;
        p.hunger = Math.max(0, p.hunger - 0.25 * k);
      }
      text = cured ? `${cured} cured` : `${inside.length} strengthened`;
      say(ex, cured ? `A light came round ${inside.length} of them. ${cured === 1 ? 'One' : cured} stopped shaking.` : `A light came round ${inside.length} of them, and the hunger eased.`);
      break;
    }
    case 'quicken':
      ex.plants += n(16);
      text = `+${n(16)} plants`;
      say(ex, 'A line of green came up through the ash overnight, as if drawn there: fireweed, flowering pink.');
      break;
    case 'kelp':
      ex.plants += n(14);
      ex.boost = { day: ex.day, fish: k };
      text = `+${n(14)} plants · rich shallows`;
      say(ex, 'A wave out of a calm sea threw kelp the length of the beach.');
      break;
    case 'shoals':
      ex.meat += n(14);
      ex.boost = { day: ex.day, fish: k };
      text = `+${n(14)} meat · the shore teems`;
      say(ex, 'The water boiled with fish, and they leapt onto the sand.');
      break;
    case 'dying':
      ex.carrion += n(22);
      text = `+${n(22)} meat to scavenge`;
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

/** Ordains a miracle (once cast often enough): the spear works it when it's needed, dimmer
 * and dearer than by hand, and only one at a time. */
export function toggleOrdain(ex: ExtinctionState, id: SpellId): void {
  if ((ex.casts?.[id] ?? 0) < ORDAIN_AFTER) return;
  // Only one at a time: ordaining another lets the first go.
  ex.ordained = (ex.ordained ?? []).includes(id) ? [] : [id];
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
  const wasTriage = !!ex.triage;
  // Short for a while, they share it thin; but when the land itself can't feed them all
  // (what comes in each day is far short of what they need), sharing thin only kills everyone
  // slowly. Then the hard thing: full meals for the workers and the strong, and the weakest
  // go without.
  ex.triage = coming < n * 0.6 && have < n * 1.1;
  ex.ration = ex.triage || have >= n * 1.1 ? 1 : have >= n * 0.5 ? 0.5 : 0.25;
  const lead = ex.people.find((p) => p.id === ex.leader)?.name;
  const word = lead ? `On ${lead}'s word, they` : 'They';
  if (ex.triage && !wasTriage) say(ex, `There wasn't enough for everyone, and there wasn't going to be. ${lead ? `${lead} said it aloud: ` : ''}the ones who worked would eat, and the weakest would not.`);
  else if (!ex.triage && wasTriage) say(ex, 'There was enough to go round again. Everyone ate.');
  else if (ex.ration !== was) say(ex, ex.ration > was ? `There was enough again. They ate ${ex.ration === 1 ? 'full meals' : 'half meals'}.` : ex.ration === 0.5 ? `${word} halved the rations. The old ate last.` : `${word} cut the rations to scraps. Some stopped eating so the young could.`);
  // What to put spare hands to: ideas first, then the raft (wood for it before building).
  const was2 = ex.focus;
  ex.focus = aiFocus(ex);
  if (ex.focus !== was2 && ex.focus === 'raft' && !ex.told?.raft) {
    (ex.told ??= {}).raft = ex.day;
    const lead = ex.people.find((p) => p.id === ex.leader)?.name;
    say(ex, `“If we stay any longer we'll go mad. We need to get off this island.”${lead ? ` ${lead} said it, and no one argued.` : ''} Some started on a raft.`);
  }
}

function aiFocus(ex: ExtinctionState): Focus {
  const fed = (ex.last?.starved.length ?? 1) === 0;
  if (ex.ideas.length < 4 || (!fed && ex.day < 20)) return 'ideas';
  // The raft can't go on without an idea they haven't got: back to the spear for it.
  if (!raftDone(ex) && !raftPart(ex)) return 'ideas';
  return 'raft';
}

/** When the raft is ready and there's food for the crossing, they choose the four and go. */
export function tribeLaunches(state: GameState): boolean {
  const ex = state.stages.tribal.tribe?.ex;
  if (!ex || ex.escaped || ex.over || !raftDone(ex) || ex.people.length < FAMILY || (ex.voyage ?? 0) < VOYAGE_FOOD) return false;
  // The four: as the spear said (strongest, youngest, or a family).
  ex.family = chooseFour(ex);
  for (const p of ex.people) if (ex.family.includes(p.id)) remember(ex, p, 'was chosen to go on the raft');
  const names = ex.people.filter((p) => ex.family!.includes(p.id)).map((p) => p.name);
  say(ex, `The raft was ready. “We'll go mad if we stay.” ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} pushed it out past the breakers, with forty days of scraps.`);
  const went = launch(state);
  // And those left on the ash: the Chronicle tells what became of them.
  if (went) for (const line of leftBehind(ex, names)) say(ex, line);
  return went;
}
