// The Creature stage's own rules: stats from the body and training, expeditions
// that take real time and come back with finds, and breeding a line of generations.
// Everything here runs inside the tick, so it carries on while the game is closed.

import { STAGES } from '../content/stages';
import { D, Decimal } from './num';
import { stageEffects, stageRate } from './rates';
import type { GameState, Mate, PlaceDef, Slot, Stat, StageId, StageState } from './types';
import { SLOTS, STATS } from './types';

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
  return (p.minutes * 60) / (1 + 0.02 * statsOf(state).speed);
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
  s.trip = { place: p.id, left: total, total };
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
  s.trip = null;
  const success = rand() < tripChance(state, p);
  const pay = tripPay(state, p).mul(success ? 1 : 0.2);
  earn(state, pay);
  const report: GameState['reports'][number] = { kind: 'trip', place: p.id, success, earned: pay.toString(), parts: [] };
  if (success) {
    const first = !(s.trips[p.id] > 0);
    s.trips[p.id] = (s.trips[p.id] ?? 0) + 1;
    if (first && !s.discovered.includes(p.id)) {
      s.discovered.push(p.id);
      report.found = p.id;
    }
    // The first visit always turns up a part; later ones sometimes do.
    const missing = p.parts.filter((id) => !s.parts.includes(id));
    if (missing.length && (first || rand() < 0.35)) {
      const id = missing[Math.floor(rand() * missing.length)];
      s.parts.push(id);
      report.parts.push(id);
    }
    if (s.mates.length < MAX_MATES && (s.generation === 0 && s.mates.length === 0 && !s.egg ? true : rand() < p.mateChance)) {
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
  return (EGG_BASE_SEC * EGG_GROWTH ** st(state).generation) / (1 + 0.04 * statsOf(state).charm);
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
  s.equipped[p.slot] = id;
  return true;
}

export function equipPart(state: GameState, id: string): boolean {
  const s = st(state);
  if (!s.parts.includes(id)) return false;
  s.equipped[partDef(id).slot as Slot] = id;
  return true;
}

/** Counts down the expedition and the egg. Called every tick, live or offline. */
export function creatureTick(state: GameState, dt: number, rand: () => number = Math.random): void {
  if (!state.unlocked.includes(CREATURE)) return;
  const s = st(state);
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
