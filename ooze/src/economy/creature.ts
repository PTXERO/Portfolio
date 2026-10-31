// The Creature stage's own rules: stats from the body and training, roaming trips
// that take real time and come back with finds, and breeding a line of generations.
// Everything here runs inside the tick, so it carries on while the game is closed.

import { STAGES } from '../content/stages';
import { D, Decimal } from './num';
import { herdMult, seasonOf, stageEffects, stageRate } from './rates';
import type { GameState, Mate, PartDef, PlaceDef, Role, Slot, Stat, StageId, StageState } from './types';
import { ROLES, SLOTS, STATS } from './types';
import { EVENTS } from '../content/creature';
import { inherit, randomGenes, whatsNew } from './genes';
import { CELL, CELLS, cellOf, ISLAND, islandOf, isLand, reveal, seenShare, type Island, type Pt } from './island';

export const CREATURE: StageId = 'creature';
/** Share of a roam's time paid out as output, before Trail Memory. */
export const TRIP_PAYOUT = 0.6;
/** Seconds the first egg takes; each generation after takes longer. */
export const EGG_BASE_SEC = 1900;
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
export const BASE_HOUSING = 8;

function effectProduct(state: GameState, kind: 'upkeepMult' | 'winterMult' | 'eggMult'): number {
  let m = 1;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === kind) m *= e.mult;
  return m;
}

/** How many the herd has room for: nests (one each), burrows, caves, its range, and what the
 * burrowers dig. */
export function housing(state: GameState): number {
  const s = st(state);
  const g = s.generators;
  return Math.floor((BASE_HOUSING + g.nest + 3 * g.burrow + 15 * g.den + 50 * g.territory + 0.5 * s.roles.digger) * (1 + 0.5 * settledNests(state).length));
}

/** Births per second: a trickle, more with nests and nesters, a boom in spring. */
export function birthRate(state: GameState): number {
  const s = st(state);
  // Nests help less and less as there get to be many; nesters help by the share of the
  // herd they are (not their number), so a big herd doesn't refill in moments.
  return (0.02 + 0.03 * Math.sqrt(s.generators.nest)) * (1 + 2 * (s.roles.carer / Math.max(1, s.pop))) * seasonOf(state).season.births * statFx(state).births;
}

/** Biomass the herd eats per second: less with marsh grazing and fat stores, more in winter. */
export function upkeep(state: GameState): number {
  const s = st(state);
  const water = Math.max(0.5, 1 - 0.04 * s.generators.waterhole);
  return Math.floor(s.pop) * UPKEEP * herdMult(state) * water * effectProduct(state, 'upkeepMult') * seasonOf(state).season.upkeep;
}

/** Share of the herd winter takes per second: less with sentries, caves and thick coats. */
export function winterLoss(state: GameState): number {
  const s = st(state);
  if (!seasonOf(state).season.winter || s.pop < 1) return 0;
  const guarded = Math.min(0.9, (s.roles.guard / Math.max(1, s.pop)) * 4 + 0.03 * s.generators.den);
  return (0.0008 * (1 - guarded) * effectProduct(state, 'winterMult')) / statFx(state).hardship;
}

/** Food gathered minus food eaten, per second. Negative means the herd is going hungry. */
export function netRate(state: GameState): Decimal {
  return stageRate(state, CREATURE).sub(upkeep(state));
}

/** Share of the herd each instinct claims (whatever's left forages). */
export function instinctShares(state: GameState): Record<Role, number> {
  const out = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'instinct') out[e.role] += e.share;
  return out;
}

/** Nobody assigns anything: each instinct takes its share of the herd, the rest forage. */
function settleRoles(state: GameState): void {
  const s = st(state);
  const shares = instinctShares(state);
  for (const r of ROLES) if (r !== 'forager') s.roles[r] = Math.floor(Math.floor(s.pop) * shares[r]);
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

/**
 * What the body's stats do for the herd: Strength carries more home (found places, parties,
 * trips), Speed gets round the places sooner (they give again sooner), Senses spots more food
 * (the herd forages more), Toughness sees them through winter and hunger, Charm brings more
 * births. (Speed also walks faster, Senses sees further, Strength drives beasts off, Charm wins
 * mates and hurries eggs; and places and run-ins ask for stats.)
 */
export const STAT_FX = { carry: 0.05, regrow: 0.02, forage: 0.03, hardship: 0.04, births: 0.03 };
export function statFx(state: GameState): { carry: number; regrow: number; forage: number; hardship: number; births: number } {
  const s = statsOf(state);
  return {
    carry: 1 + STAT_FX.carry * s.strength,
    regrow: 1 + STAT_FX.regrow * s.speed,
    forage: 1 + STAT_FX.forage * s.senses,
    hardship: 1 + STAT_FX.hardship * s.toughness,
    births: 1 + STAT_FX.births * s.charm,
  };
}

/** Energy a part takes to wear: half its stats, rounded up, unless it says. */
export function partEnergy(p: PartDef): number {
  return p.energy ?? Math.ceil(Object.values(p.stats).reduce((n, v) => n + (v ?? 0), 0) / 2);
}

/** The body's energy budget: grows with generations and Bigger Heart. */
export function energyBudget(state: GameState): number {
  let n = 3 + 3 * st(state).generation;
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
  m *= statFx(state).carry;
  return m;
}

/** Tiles a second your creature walks, before Speed and followers. */
export const WALK_BASE = 0.5;
/** Seconds of output each newly seen bit of land is worth (before Trail Memory). */
export const EXPLORE_PAY_SEC = 0.6;
/** Seconds of walking between run-ins, and how long one waits for a choice. */
export const EVENT_GAP: [number, number] = [40, 90];
export const EVENT_WAIT = 30;
/** How close counts as arriving somewhere. */
const ARRIVE = 3;

/** The game's island. The first time, it's rolled and the creature set down at home, on the Shoreline. */
export function islandFor(state: GameState): Island {
  const s = st(state);
  const is = islandOf(s.seed, def().places!);
  if (s.pos.x < 0) {
    s.pos = { ...is.home };
    reveal(is, s.seen, is.home.x, is.home.y, 22);
  }
  // Home is the Shoreline: found from the start.
  if (!(s.trips.shore > 0)) {
    s.trips.shore = 1;
    if (!s.discovered.includes('shore')) s.discovered.push('shore');
  }
  return is;
}

/** Tiles a second: faster with Speed, and with followers to show the way. */
export function walkSpeed(state: GameState): number {
  return WALK_BASE * (1 + 0.04 * statsOf(state).speed) * (1 + 0.03 * st(state).roles.scout);
}

/** How far it sees, in tiles: everything within this clears as it walks. */
export function sightRadius(state: GameState): number {
  return 4 + 0.4 * statsOf(state).senses;
}

/** A place shows on the map once the fog over it has been cleared. */
export function placeSeen(state: GameState, id: string): boolean {
  const p = islandFor(state).places[id];
  return !!p && !!st(state).seen[cellOf(p.x, p.y)];
}

/** What a place still needs: the stats short of its requirements (empty when it can be entered). */
export function placeShort(state: GameState, p: PlaceDef): [Stat, number][] {
  const stats = statsOf(state);
  return (Object.entries(p.needs) as [Stat, number][]).filter(([k, n]) => stats[k] < n);
}

/** Seconds to walk from where it is to a point. */
export function walkSeconds(state: GameState, x: number, y: number): number {
  const s = st(state);
  return Math.hypot(x - s.pos.x, y - s.pos.y) / walkSpeed(state);
}

/** What finding a place pays: a share of its distance in output. */
export function tripPay(state: GameState, p: PlaceDef): Decimal {
  return Decimal.max(stageRate(state, CREATURE).mul(p.minutes * 60 * TRIP_PAYOUT * tripMult(state)), 10 * p.minutes);
}

/** Sends your creature walking to a point on the map. It uncovers what it sees on the way. */
export function walkTo(state: GameState, x: number, y: number): boolean {
  const s = st(state);
  if (s.walk?.event) return false;
  const tx = Math.max(1, Math.min(ISLAND - 2, x));
  const ty = Math.max(1, Math.min(ISLAND - 2, y));
  if (Math.hypot(tx - s.pos.x, ty - s.pos.y) < 0.5) return false;
  const gap = s.walk?.next ?? EVENT_GAP[0] + Math.random() * (EVENT_GAP[1] - EVENT_GAP[0]);
  s.walk = { tx, ty, next: gap };
  state.started = true;
  return true;
}

/** Calls it home. */
export function walkHome(state: GameState): boolean {
  const h = islandFor(state).home;
  return walkTo(state, h.x, h.y);
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
  return { id: Date.now() + Math.floor(Math.random() * 1e6), name: NAMES[Math.floor(Math.random() * NAMES.length)], parts, genes: randomGenes(Math.random) };
}

/** The place nearest to where it is (what's around shapes what it finds). */
function nearestPlace(state: GameState): PlaceDef {
  const s = st(state);
  const is = islandFor(state);
  return def().places!.reduce((a, p) => (Math.hypot(is.places[p.id].x - s.pos.x, is.places[p.id].y - s.pos.y) < Math.hypot(is.places[a.id].x - s.pos.x, is.places[a.id].y - s.pos.y) ? p : a));
}

/** It walks into a place: if its stats are up to it, the place is found. */
function arrive(state: GameState, p: PlaceDef, rand: () => number): void {
  const s = st(state);
  const short = placeShort(state, p);
  if (short.length) {
    // Turned back: stop just short, and say what it would take.
    const is = islandFor(state);
    const q = is.places[p.id];
    const d = Math.hypot(s.pos.x - q.x, s.pos.y - q.y) || 1;
    s.pos = { x: q.x + ((s.pos.x - q.x) / d) * (ARRIVE + 2), y: q.y + ((s.pos.y - q.y) / d) * (ARRIVE + 2) };
    s.walk = s.walk && { ...s.walk, tx: s.pos.x, ty: s.pos.y };
    state.reports.push({ kind: 'trip', place: p.id, success: false, earned: '0', parts: [], short: short.map(([k, n]) => `${k} ${n}`) });
    return;
  }
  const pay = tripPay(state, p);
  earn(state, pay);
  s.trips[p.id] = (s.trips[p.id] ?? 0) + 1;
  s.partyReady[p.id] = s.year + placeRest(state);
  // It stops to take the place in.
  s.walk = null;
  const report: GameState['reports'][number] = { kind: 'trip', place: p.id, success: true, earned: pay.toString(), parts: [] };
  if (!s.discovered.includes(p.id)) {
    s.discovered.push(p.id);
    report.found = p.id;
  }
  const missing = p.parts.filter((id) => !s.parts.includes(id));
  if (missing.length) {
    const id = missing[Math.floor(rand() * missing.length)];
    s.parts.push(id);
    report.parts.push(id);
  }
  if (s.mates.length < MAX_MATES && ((s.generation === 0 && s.mates.length === 0 && !s.egg) || rand() < p.mateChance)) {
    const m = randomMate(state, p);
    s.mates.push(m);
    report.mate = m.name;
  }
  state.reports.push(report);
}

/** Chance, per bit of new ground, of turning up a part from a found place close by. */
export const RUMMAGE_CHANCE = 0.004;
/** After a part turns up (rummaging or going back), seconds before another can. */
export const FIND_GAP = 480;
/** How close to a place counts as "around" it, in tiles. */
const AROUND = 30;

/** Poking about new ground near a place it has found: now and then, one of that place's parts. */
function rummage(state: GameState, fresh: number, rand: () => number): void {
  const s = st(state);
  const is = islandFor(state);
  const near = def().places!.find((p) => s.trips[p.id] > 0 && Math.hypot(is.places[p.id].x - s.pos.x, is.places[p.id].y - s.pos.y) < AROUND);
  if (!near) return;
  const missing = near.parts.filter((id) => !s.parts.includes(id));
  if (!missing.length || s.year < s.nextFind || rand() >= 1 - (1 - RUMMAGE_CHANCE) ** fresh) return;
  const id = missing[Math.floor(rand() * missing.length)];
  s.parts.push(id);
  s.nextFind = s.year + FIND_GAP;
  state.reports.push({ kind: 'event', success: true, earned: '0', parts: [id], event: `Rooting about near the ${near.name}, it turned something up.` });
}

/** Back at a place it already knows: maybe a mate there, maybe a part it missed. */
function revisit(state: GameState, p: PlaceDef, rand: () => number): void {
  const s = st(state);
  s.trips[p.id] = (s.trips[p.id] ?? 0) + 1;
  const report: GameState['reports'][number] = { kind: 'trip', place: p.id, success: true, earned: '0', parts: [] };
  const missing = p.parts.filter((id) => !s.parts.includes(id));
  if (missing.length && s.year >= s.nextFind && rand() < 0.25) {
    const id = missing[Math.floor(rand() * missing.length)];
    s.parts.push(id);
    report.parts.push(id);
    s.nextFind = s.year + FIND_GAP;
  }
  if (s.mates.length < MAX_MATES && rand() < p.mateChance * 0.6) {
    const m = randomMate(state, p);
    s.mates.push(m);
    report.mate = m.name;
  }
  // Only worth a word when something came of it.
  if (report.parts.length || report.mate) state.reports.push(report);
}

/** Settles the run-in on the road, with the choice made (or the safe one). */
/** A risky choice is a roll of a d20 against this; the safe one always works. */
export const EVENT_DC = 10;

type RunInOption = (typeof EVENTS)[number]['options'][number];

/** With the stat a choice asks for, it rolls with advantage (two dice, the better kept). */
export function hasAdvantage(state: GameState, opt: RunInOption): boolean {
  return !!opt.stat && statsOf(state)[opt.stat] >= (opt.need ?? 0);
}

/** Chance a choice comes off: certain if safe, else one d20 (or the better of two) at EVENT_DC or more. */
export function choiceOdds(state: GameState, opt: RunInOption): number {
  if (!opt.stat) return 1;
  const miss = (EVENT_DC - 1) / 20;
  return hasAdvantage(state, opt) ? 1 - miss * miss : 1 - miss;
}

/**
 * What it does when the choice is left to it. Without Instinct (the third level of Curiosity)
 * it just runs; with it, as set: always run, take on only what it has the stat for, or (smart)
 * also chance one it's nearly up to.
 */
export function instinctChoice(state: GameState, id: string): number {
  const d = EVENTS.find((e) => e.id === id)!;
  const safe = d.options.length - 1;
  const policy = curiosity(state) >= 3 ? (st(state).roamOpts?.policy ?? 'ready') : 'run';
  if (policy === 'run') return safe;
  const adv = d.options.findIndex((o) => hasAdvantage(state, o));
  if (adv >= 0) return adv;
  if (policy === 'ready') return safe;
  const stats = statsOf(state);
  let best = safe;
  let ratio = 0;
  d.options.forEach((o, i) => {
    if (!o.stat) return;
    const r = stats[o.stat] / (o.need ?? 1);
    if (r > ratio) {
      ratio = r;
      best = i;
    }
  });
  return ratio >= 0.66 ? best : safe;
}

function resolveEvent(state: GameState, rand: () => number): void {
  const s = st(state);
  const ev = s.walk!.event!;
  const evDef = EVENTS.find((e) => e.id === ev.id)!;
  const opt = evDef.options[ev.choice ?? instinctChoice(state, ev.id)];
  // The roll: one d20, or two with advantage (the better kept).
  let ok = true;
  let roll = '';
  if (opt.stat) {
    const a = 1 + Math.floor(rand() * 20);
    const adv = hasAdvantage(state, opt);
    const b = adv ? 1 + Math.floor(rand() * 20) : 0;
    const got = Math.max(a, b);
    ok = got >= EVENT_DC;
    roll = adv ? ` (rolled ${a} and ${b} with advantage, kept ${got}: needed ${EVENT_DC})` : ` (rolled ${got}: needed ${EVENT_DC})`;
  }
  const report: GameState['reports'][number] = { kind: 'event', success: ok, earned: '0', parts: [], event: `${evDef.text} ${opt.label}${roll}: ${ok ? opt.good : opt.bad ?? opt.good}` };
  let mult = ok ? (opt.stat ? 1.8 : 1) : 0.3;
  // A part only if one's due (finds are spaced out, on the road or off it).
  if (ok && opt.reward === 'part' && s.year >= s.nextFind) {
    const near = nearestPlace(state);
    const pool = [...new Set([...near.parts, ...def().places!.filter((p) => s.trips[p.id] > 0).flatMap((p) => p.parts)])].filter((id) => !s.parts.includes(id));
    if (pool.length) {
      const id = pool[Math.floor(rand() * pool.length)];
      s.parts.push(id);
      report.parts.push(id);
      s.nextFind = s.year + FIND_GAP;
      mult = 0.5;
    }
  } else if (ok && opt.reward === 'mate' && s.mates.length < MAX_MATES) {
    const m = randomMate(state, nearestPlace(state));
    s.mates.push(m);
    report.mate = m.name;
    mult = 0.5;
  }
  const pay = stageRate(state, CREATURE).mul(60 * mult * tripMult(state));
  earn(state, pay);
  report.earned = pay.toString();
  state.reports.push(report);
  s.walk = { ...s.walk!, event: undefined, next: EVENT_GAP[0] + rand() * (EVENT_GAP[1] - EVENT_GAP[0]) };
}

/** Walks for `dt` seconds: moves, clears the fog, finds places, runs into things. */
function walkTick(state: GameState, dt: number, rand: () => number): void {
  const s = st(state);
  const w = s.walk;
  if (!w) return;
  if (w.event) {
    // With choices mandatory, it waits for you (instinct never decides).
    if (!s.roamOpts?.mandatory) w.event.left -= dt;
    if (w.event.left <= 0) resolveEvent(state, rand);
    return;
  }
  const is = islandFor(state);
  const v = walkSpeed(state);
  const r = sightRadius(state);
  let left = dt;
  let fresh = 0;
  let arrived = false;
  while (left > 1e-9 && s.walk && !s.walk.event) {
    const cur = s.walk;
    const d = Math.hypot(cur.tx - s.pos.x, cur.ty - s.pos.y);
    if (d < 1e-6) {
      s.walk = null;
      break;
    }
    // Small steps, so fog and places along the way are never skipped.
    const step = Math.min(d, v * left, 2);
    s.pos = { x: s.pos.x + ((cur.tx - s.pos.x) / d) * step, y: s.pos.y + ((cur.ty - s.pos.y) / d) * step };
    const spent = step / v;
    left -= spent;
    cur.next -= spent;
    fresh += reveal(is, s.seen, s.pos.x, s.pos.y, r);
    for (const p of def().places!) {
      if (s.trips[p.id] > 0) continue;
      const q = is.places[p.id];
      if (Math.hypot(q.x - s.pos.x, q.y - s.pos.y) <= ARRIVE) {
        arrive(state, p, rand);
        arrived = true;
        break;
      }
    }
    if (!s.walk) break;
    if (Math.hypot(s.walk.tx - s.pos.x, s.walk.ty - s.pos.y) < 1e-6) {
      s.walk = null;
      // Walked to a place it already knows: a look around.
      const known = def().places!.find((p) => s.trips[p.id] > 0 && Math.hypot(is.places[p.id].x - s.pos.x, is.places[p.id].y - s.pos.y) <= ARRIVE);
      if (known && !arrived) revisit(state, known, rand);
      break;
    }
    // Something on the road (mostly away from home).
    if (s.walk.next <= 0 && Math.hypot(s.pos.x - is.home.x, s.pos.y - is.home.y) > 15) {
      s.walk.event = { id: EVENTS[Math.floor(rand() * EVENTS.length)].id, choice: null, left: EVENT_WAIT };
    }
  }
  if (fresh) {
    earn(state, stageRate(state, CREATURE).mul(fresh * EXPLORE_PAY_SEC * tripMult(state)));
    rummage(state, fresh, rand);
  }
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
  return ((EGG_BASE_SEC * EGG_GROWTH ** st(state).generation) / (1 + 0.04 * statsOf(state).charm) / (1 + 0.01 * st(state).roles.carer)) * effectProduct(state, 'eggMult');
}

/** Answers the run-in on the road; it's settled at once and the walk goes on. */
export function chooseEvent(state: GameState, option: number, rand: () => number = Math.random): boolean {
  const ev = st(state).walk?.event;
  if (!ev) return false;
  ev.choice = option;
  resolveEvent(state, rand);
  return true;
}

/** True while it's stopped on the road, waiting on a choice. */
export function tripEventDue(state: GameState): boolean {
  return !!st(state).walk?.event;
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

/** The egg hatches: a new generation, and one of the mate's parts (new to the line) joins it. */
function hatch(state: GameState): void {
  const s = st(state);
  const mate = s.egg!.mate;
  s.egg = null;
  s.generation++;
  const parts = Object.values(mate.parts)
    .filter((id): id is string => !!id && !s.parts.includes(id))
    .slice(0, 1);
  s.parts.push(...parts);
  // Their looks: the line's and the mate's, mixed (a mate met before genes were kept brings its
  // own, made up now).
  const before = s.genes;
  const genes = inherit(before, mate.genes ?? randomGenes(Math.random), Math.random, 0.6);
  s.genes = genes;
  (s.line ??= []).push({ generation: s.generation, mate: mate.name, mateGenes: mate.genes, mateParts: { ...mate.parts }, before, genes, parts, year: s.year });
  state.reports.push({ kind: 'hatch', success: true, earned: '0', parts, mate: mate.name, generation: s.generation, looks: whatsNew(before, genes) });
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

/** How curious the line is (0 = only goes where it's sent). */
export function curiosity(state: GameState): number {
  let n = 0;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'curiosity') n += e.level;
  return n;
}

/** Rare things that cross the island now and then; tapped in time, a reward and a note. */
export const SIGHTINGS: Record<string, { name: string; text: string; seconds: number }> = {
  whale: { name: 'Whale', text: 'Something vast rolled up out of the sea, blew, and was gone. The herd stood and stared.', seconds: 120 },
  tortoise: { name: 'Old Tortoise', text: 'An ancient tortoise trudged along the beach, older than anything on the island. It did not hurry.', seconds: 150 },
  comet: { name: 'Comet', text: 'A light with a long tail crept across the night. Nobody slept much.', seconds: 180 },
  aurora: { name: 'Sky Fire', text: 'Green and violet curtains rippled over the winter dark.', seconds: 200 },
};

/** You noticed it: a share of output as a reward, and it goes in the tally. */
export function spot(state: GameState, kind: string): boolean {
  const d = SIGHTINGS[kind];
  if (!d) return false;
  const s = st(state);
  const pay = Decimal.max(stageRate(state, CREATURE).mul(d.seconds), 50);
  earn(state, pay);
  s.sightings[kind] = (s.sightings[kind] ?? 0) + 1;
  state.reports.push({ kind: 'event', success: true, earned: pay.toString(), parts: [], event: d.text, sighting: kind });
  return true;
}

/** How many foraging parties the herd can have out at once. */
export function partySlots(state: GameState): number {
  let n = 0;
  for (const e of stageEffects(state, CREATURE)) if (e.kind === 'parties') n += e.count;
  return n;
}
/** Seconds a settled place takes to grow back before it gives again. */
export const PLACE_REST = 240;
/** Each time a settled place grows back, it gives this share of what finding it brought. */
export const FARM_PAY = 0.05;

/** Seconds a settled place takes to grow back (quicker with Foraging Rounds). */
export function placeRest(state: GameState): number {
  return (PLACE_REST * (foragesOnItsOwn(state) ? 0.6 : 1)) / statFx(state).regrow;
}

/** Found places give, each time they've grown back, without anyone needing to go there. */
function placeTick(state: GameState): void {
  const s = st(state);
  for (const p of def().places!) {
    if (!(s.trips[p.id] > 0) || !placeRested(state, p.id)) continue;
    const got = tripPay(state, p).mul(FARM_PAY);
    earn(state, got);
    s.partyReady[p.id] = s.year + placeRest(state);
    s.foraged = (s.foraged ?? 0) + 1;
    s.lastForage = got.toString();
    s.lastForagePlace = p.id;
  }
}

/** Whether a found place has grown back enough to forage again. */
export function placeRested(state: GameState, id: string): boolean {
  return (st(state).partyReady[id] ?? 0) <= st(state).year;
}

/** Seconds till a found place can be foraged again (0 when it's ready). */
export function placeRestLeft(state: GameState, id: string): number {
  return Math.max(0, (st(state).partyReady[id] ?? 0) - st(state).year);
}

/** Whether the found places grow back quicker (Foraging Rounds, a late Wandering upgrade). */
export function foragesOnItsOwn(state: GameState): boolean {
  return stageEffects(state, CREATURE).some((e) => e.kind === 'rounds');
}
/** A party brings home this share of what your creature's own trip there pays. */
export const PARTY_PAY = 0.5;
/** Parties walk a little quicker than the leader (they know the way). */
const PARTY_SPEED = 1.2;

/** New nests the herd has finished moving into (their bonuses count from then). */
export function settledNests(state: GameState): string[] {
  const s = st(state);
  return (s.nests ?? []).filter((id) => (s.nestSettle?.[id] ?? 0) <= s.year);
}

/** How far a new nest's settling has got, 0 to 1 (1 once settled). */
export function nestProgress(state: GameState, id: string): number {
  const s = st(state);
  const at = s.nestSettle?.[id] ?? 0;
  if (at <= s.year) return 1;
  const dur = nestTrek(state, id);
  return Math.max(0, Math.min(1, 1 - (at - s.year) / dur));
}

/** Seconds for the herd to walk from the nearest settled nest to a new one (the long way round). */
export function nestTrek(state: GameState, id: string): number {
  const is = islandFor(state);
  const p = is.places[id];
  const from = [is.home, ...settledNests(state).filter((n) => n !== id).map((n) => is.places[n])].reduce((a, n) => (Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? n : a));
  return Math.max(30, (Math.hypot(p.x - from.x, p.y - from.y) * 1.4) / NEST_WALK);
}
/** Tiles a second the herd covers moving house. */
const NEST_WALK = 0.9;

/** Where the herd lives: home, and the nests founded since (only those settled, unless asked). */
export function nestPoints(state: GameState, settling = false): Pt[] {
  const is = islandFor(state);
  const ids = settling ? st(state).nests : settledNests(state);
  return [is.home, ...ids.map((id) => is.places[id]).filter(Boolean)];
}

/** The nest nearest a place (parties set out from it and bring the food back to it). */
export function nearestNest(state: GameState, place: string): Pt {
  const p = islandFor(state).places[place];
  return nestPoints(state).reduce((a, n) => (Math.hypot(n.x - p.x, n.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? n : a));
}

/** Seconds a party takes to walk from its nest to a place (and the same back). */
export function partyLeg(state: GameState, place: string): number {
  const p = islandFor(state).places[place];
  const n = nearestNest(state, place);
  return Math.max(4, Math.hypot(p.x - n.x, p.y - n.y)) / (walkSpeed(state) * PARTY_SPEED);
}

/** Share of the island's land that must be seen before a new nest can be founded. */
export const NEST_SEEN = 0.97;
/** The most nests away from home. */
export const MAX_NESTS = 3;

/** A new nest costs a fortune, and ten times more each time. */
export function nestCost(state: GameState): Decimal {
  return D(5e9).mul(Decimal.pow(10, st(state).nests.length));
}

/** Once the whole island is known, the herd can found a new nest at a found place. */
export function nestsOpen(state: GameState): boolean {
  const s = st(state);
  return s.nests.length < MAX_NESTS && seenShare(islandFor(state), s.seen) >= NEST_SEEN;
}

/** Found places a nest could go: far from home and from the other nests. */
export function nestSites(state: GameState): PlaceDef[] {
  const s = st(state);
  const is = islandFor(state);
  return def().places!.filter((p) => s.trips[p.id] > 0 && !s.nests.includes(p.id) && nestPoints(state, true).every((n) => Math.hypot(is.places[p.id].x - n.x, is.places[p.id].y - n.y) > 25));
}

export function foundNest(state: GameState, id: string): boolean {
  const s = st(state);
  const cost = nestCost(state);
  if (!nestsOpen(state) || !nestSites(state).some((p) => p.id === id) || s.currency.lt(cost)) return false;
  s.currency = s.currency.sub(cost);
  s.nests.push(id);
  // The herd sets off; it's settled (and counts) once it's had time to get there.
  s.nestSettle[id] = s.year + nestTrek(state, id);
  return true;
}

/** Parties walk out, forage, walk home and drop off what they carry; then the next sets off. */
function partyTick(state: GameState, dt: number): void {
  const s = st(state);
  const slots = partySlots(state);
  if (!slots && !s.parties.length) return;
  for (const party of s.parties) party.t += dt;
  s.parties = s.parties.filter((party) => {
    if (party.t < 2 * partyLeg(state, party.place)) return true;
    const got = tripPay(state, def().places!.find((p) => p.id === party.place)!).mul(PARTY_PAY);
    earn(state, got);
    s.partiesHome = (s.partiesHome ?? 0) + 1;
    s.lastParty = got.toString();
    return false;
  });
  // Send the next party to the nearest found place (beyond home's own beach) that's rested
  // and nobody's bound for.
  while (s.parties.length < slots) {
    const next = def()
      .places!.filter((p) => s.trips[p.id] > 0 && partyLeg(state, p.id) * walkSpeed(state) > 12 && (s.partyReady[`party:${p.id}`] ?? 0) <= s.year && !s.parties.some((q) => q.place === p.id))
      .sort((a, b) => partyLeg(state, a.id) - partyLeg(state, b.id))[0];
    if (!next) break;
    s.parties.push({ place: next.id, t: 0 });
    // Each place is worth a party's while again only after a rest of its own.
    s.partyReady[`party:${next.id}`] = s.year + 2 * partyLeg(state, next.id) + PLACE_REST;
  }
}

/** Fog maps with no land left under them (not saved: found again after a load). */
const fullySeen = new WeakSet<Uint8Array>();

/** Curiosity at work: with nothing to do, it picks its own way. */
function autoRoam(state: GameState): void {
  const s = st(state);
  const level = curiosity(state);
  if (!level) return;
  const opts = s.roamOpts ?? { places: true, settle: true, mandatory: false };
  const ev = s.walk?.event;
  if (ev && level >= 3 && opts.settle) {
    // It answers at once, the way it's been set to.
    chooseEvent(state, instinctChoice(state, ev.id));
    return;
  }
  if (s.walk) return;
  const is = islandFor(state);
  if (level >= 2 && opts.places) {
    const ready = def().places!.find((p) => !(s.trips[p.id] > 0) && placeSeen(state, p.id) && !placeShort(state, p).length);
    if (ready) {
      walkTo(state, is.places[ready.id].x, is.places[ready.id].y);
      return;
    }
  }
  // The nearest fog over land.
  if (!s.autoRoam || fullySeen.has(s.seen)) return;
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < CELLS * CELLS; i++) {
    if (s.seen[i]) continue;
    const x = (i % CELLS) * CELL + CELL / 2;
    const y = Math.floor(i / CELLS) * CELL + CELL / 2;
    if (!isLand(is, x, y)) continue;
    const d = Math.hypot(x - s.pos.x, y - s.pos.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) fullySeen.add(s.seen);
  else walkTo(state, (best % CELLS) * CELL + CELL / 2, Math.floor(best / CELLS) * CELL + CELL / 2);
}

/** Counts down the roam and the egg. Called every tick, live or offline. */
export function creatureTick(state: GameState, dt: number, rand: () => number = Math.random): void {
  if (!state.unlocked.includes(CREATURE)) return;
  const s = st(state);
  // Seasons turn; the herd eats, is born, and (in winter) is thinned.
  s.year += dt;
  const eat = upkeep(state) * dt;
  const hungry = s.currency.lt(eat);
  s.currency = hungry ? D(0) : s.currency.sub(eat);
  // Hungry, the herd thins by 1% a second; fed, it grows toward what housing allows.
  if (hungry) s.pop = Math.max(1, s.pop * Math.exp((-0.01 / statFx(state).hardship) * dt));
  else s.pop = Math.max(Math.min(s.pop, housing(state)), Math.min(housing(state), s.pop + birthRate(state) * dt));
  s.pop = Math.max(1, s.pop * Math.exp(-winterLoss(state) * dt));
  settleRoles(state);
  fitRoles(s);
  walkTick(state, dt, rand);
  autoRoam(state);
  partyTick(state, dt);
  placeTick(state);
  if (s.egg) {
    // (Brooding bought, more charm, more nesters: the egg in the nest speeds up too, keeping how
    // far along it is.)
    const now = eggSeconds(state);
    if (Math.abs(now - s.egg.total) > 0.01) {
      s.egg.left *= now / s.egg.total;
      s.egg.total = now;
    }
    s.egg.left -= dt;
    if (s.egg.left <= 0) hatch(state);
  }
  // Left to itself (overnight, say), the line keeps breeding: whenever there's no egg and a
  // mate, the next is laid with the mate who'd bring the line the most new parts.
  if (!s.egg && s.keepBreeding && s.mates.length) {
    const fresh = (m: Mate) => Object.values(m.parts).filter((id) => !!id && !s.parts.includes(id)).length;
    const best = s.mates.reduce((a, m) => (fresh(m) > fresh(a) ? m : a));
    breed(state, best.id);
  }
}

export { D };
