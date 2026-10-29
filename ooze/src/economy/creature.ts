// The Creature stage's own rules: stats from the body and training, expeditions
// that take real time and come back with finds, and breeding a line of generations.
// Everything here runs inside the tick, so it carries on while the game is closed.

import { STAGES } from '../content/stages';
import { D, Decimal } from './num';
import { herdMult, seasonOf, stageEffects, stageRate } from './rates';
import type { GameState, Mate, PartDef, PlaceDef, Role, Slot, Stat, StageId, StageState } from './types';
import { ROLES, SLOTS, STATS } from './types';
import { EVENTS } from '../content/creature';

export const CREATURE: StageId = 'creature';
/** Share of an expedition's time paid out as output, before Trail Memory. */
export const TRIP_PAYOUT = 0.6;
/** Seconds the first egg takes; each generation after takes longer. */
export const EGG_BASE_SEC = 600;
export const EGG_GROWTH = 1.6;
/** Output multiplier per generation bred. */
export const GENERATION_MULT = 1.25;
export const MAX_MATES = 3;

const NAMES = ['Mossback', 'Pebble', 'Driftwood', 'Sedge', 'Flint', 'Kelp', 'Ember', 'Thistle', 'Brine', 'Clover', 'Gravel', 'Fern', 'Silt', 'Bramble', 'Tide', 'Lichen'];

const st = (state: GameState): StageState => state.stages[CREATURE];
const def = () => STAGES[CREATURE];
export const partDef = (id: string) => def().parts!.find((p) => p.id === id)!;
export const placeDef = (id: string) => def().places!.find((p) => p.id === id)!;

// ---- The herd ----

/** Share of a forager's haul each member eats (so a quarter of the herd feeds everyone, in a good season). */
export const UPKEEP = 0.25;
/** Housing with no buildings at all. */
export const BASE_HOUSING = 10;

function effectProduct(state: GameState, kind: 'upkeepMult' | 'winterMult'): number {
  let m = 1;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === kind) m *= e.mult;
  return m;
}

/** How many the herd has room for: burrows, dens, territory, and diggers. */
export function housing(state: GameState): number {
  const s = st(state);
  const g = s.generators;
  return Math.floor(BASE_HOUSING + 5 * g.burrow + 40 * g.den + 200 * g.territory + 0.5 * s.roles.digger);
}

/** Births per second: a trickle, more with nesting grounds and carers, a boom in spring. */
export function birthRate(state: GameState): number {
  const s = st(state);
  return (0.03 + 0.04 * s.generators.nest) * (1 + 0.08 * s.roles.carer) * seasonOf(state).season.births;
}

/** Biomass the herd eats per second: less with watering holes and fat stores, more in winter. */
export function upkeep(state: GameState): number {
  const s = st(state);
  const water = Math.max(0.5, 1 - 0.04 * s.generators.waterhole);
  return Math.floor(s.pop) * UPKEEP * herdMult(state) * water * effectProduct(state, 'upkeepMult') * seasonOf(state).season.upkeep;
}

/** Share of the herd winter takes per second: less with guards, dens and thick coats. */
export function winterLoss(state: GameState): number {
  const s = st(state);
  if (!seasonOf(state).season.winter || s.pop < 1) return 0;
  const guarded = Math.min(0.9, (s.roles.guard / Math.max(1, s.pop)) * 4 + 0.03 * s.generators.den);
  return 0.0008 * (1 - guarded) * effectProduct(state, 'winterMult');
}

/** Food gathered minus food eaten, per second. Negative means the herd is going hungry. */
export function netRate(state: GameState): Decimal {
  return stageRate(state, CREATURE).sub(upkeep(state));
}

/** Moves members between roles (foraging is the default; `delta` can be negative). */
export function assign(state: GameState, role: Role, delta: number): boolean {
  const s = st(state);
  if (role === 'forager') return false;
  const next = Math.max(0, s.roles[role] + delta);
  const others = ROLES.filter((r) => r !== 'forager' && r !== role).reduce((n, r) => n + s.roles[r], 0);
  const cap = Math.max(0, Math.floor(s.pop) - others);
  const v = Math.min(next, cap);
  if (v === s.roles[role]) return false;
  s.roles[role] = v;
  return true;
}

/** If the herd shrinks, roles shrink with it (foragers first, then the rest evenly). */
function fitRoles(s: StageState): void {
  let over = ROLES.filter((r) => r !== 'forager').reduce((n, r) => n + s.roles[r], 0) - Math.floor(s.pop);
  for (const r of ['scout', 'digger', 'carer', 'guard'] as Role[]) {
    if (over <= 0) break;
    const take = Math.min(over, s.roles[r]);
    s.roles[r] -= take;
    over -= take;
  }
}

/** The creature's stats: 1 each, plus worn parts, training and other effects, plus 1 per generation. */
export function statsOf(state: GameState): Record<Stat, number> {
  const s = st(state);
  const out = Object.fromEntries(STATS.map((k) => [k, 1 + s.generation])) as Record<Stat, number>;
  for (const slot of SLOTS) {
    const id = s.equipped[slot];
    if (!id) continue;
    for (const [k, v] of Object.entries(partDef(id).stats)) out[k as Stat] += v ?? 0;
  }
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'stat') out[e.stat] += e.amount;
  return out;
}

/** Energy a part takes to wear: half its stats, rounded up, unless it says. */
export function partEnergy(p: PartDef): number {
  return p.energy ?? Math.ceil(Object.values(p.stats).reduce((n, v) => n + (v ?? 0), 0) / 2);
}

/** The body's energy budget: grows with generations and Bigger Heart. */
export function energyBudget(state: GameState): number {
  let n = 6 + 3 * st(state).generation;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'energy') n += e.amount;
  return n;
}

export function energyUsed(state: GameState): number {
  const s = st(state);
  return SLOTS.reduce((n, slot) => n + (s.equipped[slot] ? partEnergy(partDef(s.equipped[slot]!)) : 0), 0);
}

/** Whether wearing a part fits the budget (swapping out whatever is in its slot). */
export function canWear(state: GameState, id: string): boolean {
  const s = st(state);
  const p = partDef(id);
  const current = s.equipped[p.slot];
  return energyUsed(state) - (current ? partEnergy(partDef(current)) : 0) + partEnergy(p) <= energyBudget(state);
}

function tripMult(state: GameState): number {
  let m = 1;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'tripMult') m *= e.mult;
  return m;
}

/** A place can be explored once the places before it have been. */
export function placeOpen(state: GameState, p: PlaceDef): boolean {
  return (p.after ?? []).every((id) => (st(state).trips[id] ?? 0) > 0);
}

/** Chance an expedition succeeds: each stat short of what the place needs cuts it, squared. */
export function tripChance(state: GameState, p: PlaceDef): number {
  const stats = statsOf(state);
  let c = 1;
  for (const [k, need] of Object.entries(p.needs)) c *= Math.min(1, stats[k as Stat] / (need ?? 1)) ** 2;
  return c;
}

/** Seconds an expedition takes: Speed shortens it. */
export function tripSeconds(state: GameState, p: PlaceDef): number {
  return (p.minutes * 60) / (1 + 0.02 * statsOf(state).speed) / (1 + 0.03 * st(state).roles.scout);
}

/** What a successful trip pays: a share of the time away in output. */
export function tripPay(state: GameState, p: PlaceDef): Decimal {
  return Decimal.max(stageRate(state, CREATURE).mul(p.minutes * 60 * TRIP_PAYOUT * tripMult(state)), 10 * p.minutes);
}

export function startTrip(state: GameState, placeId: string): boolean {
  const s = st(state);
  const p = placeDef(placeId);
  if (s.trip || !p || !placeOpen(state, p)) return false;
  const total = tripSeconds(state, p);
  // Most trips run into something halfway.
  const event = Math.random() < 0.7 ? { id: EVENTS[Math.floor(Math.random() * EVENTS.length)].id, choice: null } : undefined;
  s.trip = { place: p.id, left: total, total, event };
  state.started = true;
  return true;
}

function earn(state: GameState, amount: Decimal): void {
  const s = st(state);
  s.currency = s.currency.add(amount);
  s.totalEarned = s.totalEarned.add(amount);
}

function randomMate(state: GameState, p: PlaceDef): Mate {
  const s = st(state);
  // A mate wears parts from what's around: the place's finds and what the line already knows.
  const pool = [...new Set([...s.parts, ...p.parts])];
  const parts: Mate['parts'] = {};
  for (const slot of SLOTS) {
    const options = pool.filter((id) => partDef(id).slot === slot);
    if (options.length) parts[slot] = options[Math.floor(Math.random() * options.length)];
  }
  return { id: Date.now() + Math.floor(Math.random() * 1e6), name: NAMES[Math.floor(Math.random() * NAMES.length)], parts };
}

/** The expedition comes home: pays out, and on success may bring a page, a part and a mate. */
function finishTrip(state: GameState, rand: () => number): void {
  const s = st(state);
  const p = placeDef(s.trip!.place);
  const ev = s.trip!.event;
  s.trip = null;
  const success = rand() < tripChance(state, p);
  // The choice on the way: unanswered, it plays safe (the last option).
  let evMult = 1;
  let extra: 'part' | 'mate' | null = null;
  let evLine: string | undefined;
  if (ev && success) {
    const def = EVENTS.find((e) => e.id === ev.id)!;
    const opt = def.options[ev.choice ?? def.options.length - 1];
    const ok = !opt.stat || statsOf(state)[opt.stat] >= (opt.need ?? 0);
    evLine = `${def.text} ${opt.label}: ${ok ? opt.good : opt.bad ?? opt.good}`;
    if (ok && opt.stat) {
      if (opt.reward === 'pay') evMult = 1.8;
      else extra = opt.reward;
    } else if (!ok) evMult = 0.6;
  }
  const pay = tripPay(state, p).mul((success ? 1 : 0.2) * evMult);
  earn(state, pay);
  const report: GameState['reports'][number] = { kind: 'trip', place: p.id, success, earned: pay.toString(), parts: [], event: evLine };
  if (success) {
    const first = !(s.trips[p.id] > 0);
    s.trips[p.id] = (s.trips[p.id] ?? 0) + 1;
    if (first && !s.discovered.includes(p.id)) {
      s.discovered.push(p.id);
      report.found = p.id;
    }
    // The first visit always turns up a part; later ones sometimes do.
    const missing = p.parts.filter((id) => !s.parts.includes(id));
    if (missing.length && (first || extra === 'part' || rand() < 0.35 * (1 + 0.05 * s.roles.scout))) {
      const id = missing[Math.floor(rand() * missing.length)];
      s.parts.push(id);
      report.parts.push(id);
    }
    if (s.mates.length < MAX_MATES && (extra === 'mate' || (s.generation === 0 && s.mates.length === 0 && !s.egg) || rand() < p.mateChance)) {
      const m = randomMate(state, p);
      s.mates.push(m);
      report.mate = m.name;
    }
  }
  state.reports.push(report);
}

/** Chance a visitor on the shore agrees to join the line: better with Charm. */
export function courtChance(state: GameState): number {
  return Math.min(1, 0.35 + 0.04 * statsOf(state).charm);
}

/** A tap on a visiting creature on the shore: it may join as a mate. Returns its name, or null. */
export function court(state: GameState, rand: () => number = Math.random): string | null {
  const s = st(state);
  if (s.mates.length >= MAX_MATES || rand() >= courtChance(state)) return null;
  const m = randomMate(state, placeDef('shore'));
  s.mates.push(m);
  return m.name;
}

/** Seconds the next egg will take: longer each generation, shorter with Charm. */
export function eggSeconds(state: GameState): number {
  return (EGG_BASE_SEC * EGG_GROWTH ** st(state).generation) / (1 + 0.04 * statsOf(state).charm) / (1 + 0.01 * st(state).roles.carer);
}

/** Answers the choice the expedition ran into. */
export function chooseEvent(state: GameState, option: number): boolean {
  const ev = st(state).trip?.event;
  if (!ev || ev.choice !== null || !tripEventDue(state)) return false;
  ev.choice = option;
  return true;
}

/** True once the trip is halfway and its event is waiting on a choice. */
export function tripEventDue(state: GameState): boolean {
  const t = st(state).trip;
  return !!t?.event && t.event.choice === null && t.left <= t.total / 2;
}

export function breed(state: GameState, mateId: number): boolean {
  const s = st(state);
  const i = s.mates.findIndex((m) => m.id === mateId);
  if (s.egg || i < 0) return false;
  const [mate] = s.mates.splice(i, 1);
  const total = eggSeconds(state);
  s.egg = { mate, left: total, total };
  return true;
}

export function releaseMate(state: GameState, mateId: number): boolean {
  const s = st(state);
  const i = s.mates.findIndex((m) => m.id === mateId);
  if (i < 0) return false;
  s.mates.splice(i, 1);
  return true;
}

/** The egg hatches: a new generation, and the mate's parts join the line. */
function hatch(state: GameState): void {
  const s = st(state);
  const mate = s.egg!.mate;
  s.egg = null;
  s.generation++;
  const parts = Object.values(mate.parts).filter((id): id is string => !!id && !s.parts.includes(id));
  s.parts.push(...parts);
  state.reports.push({ kind: 'hatch', success: true, earned: '0', parts, mate: mate.name, generation: s.generation });
}

export function buyPart(state: GameState, id: string): boolean {
  const s = st(state);
  const p = partDef(id);
  if (!p || p.cost === undefined || s.parts.includes(id) || s.currency.lt(p.cost)) return false;
  s.currency = s.currency.sub(p.cost);
  s.parts.push(id);
  if (canWear(state, id)) s.equipped[p.slot] = id;
  return true;
}

export function equipPart(state: GameState, id: string): boolean {
  const s = st(state);
  if (!s.parts.includes(id) || !canWear(state, id)) return false;
  s.equipped[partDef(id).slot as Slot] = id;
  return true;
}

/** Counts down the expedition and the egg. Called every tick, live or offline. */
export function creatureTick(state: GameState, dt: number, rand: () => number = Math.random): void {
  if (!state.unlocked.includes(CREATURE)) return;
  const s = st(state);
  // Seasons turn; the herd eats, is born, and (in winter) is thinned.
  s.year += dt;
  const eat = upkeep(state) * dt;
  const hungry = s.currency.lt(eat);
  s.currency = hungry ? D(0) : s.currency.sub(eat);
  // Hungry, the herd thins by 1% a second; fed, it grows toward what housing allows.
  if (hungry) s.pop = Math.max(1, s.pop * Math.exp(-0.01 * dt));
  else s.pop = Math.max(Math.min(s.pop, housing(state)), Math.min(housing(state), s.pop + birthRate(state) * dt));
  s.pop = Math.max(1, s.pop * Math.exp(-winterLoss(state) * dt));
  fitRoles(s);
  if (s.trip) {
    s.trip.left -= dt;
    if (s.trip.left <= 0) finishTrip(state, rand);
  }
  if (s.egg) {
    s.egg.left -= dt;
    if (s.egg.left <= 0) hatch(state);
  }
}

export { D };
