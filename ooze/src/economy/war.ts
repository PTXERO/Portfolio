// War on New Shore: raids, theirs and yours.
//
// Your predators (and, for cannibals, everyone) come raiding once the village is worth it: first
// someone's seen watching from the trees, then the raiders are seen coming, and a day or two later
// they're there. Everyone grown fights at home. Your prey you raid yourself, when you choose: a war
// band goes out, and (the chief leading it, if they're there) falls on them; win, and the village
// is yours, paying tribute.
//
// Battles are Kairosoft-style: two lines trade blows for a few rounds until one side breaks. Worked
// out here in full when they happen (offline too); the screen only plays them back.

import type { GameState } from './types';
import { record } from './chronicle';
import { boosts, DAY_SEC, foodCap, isAdult, killed, relation, shoreWhen, woodCap, type ShoreState, type Village } from './shore';

/** How hard each diet fights (a fighter's worth). */
const KIND: Record<string, number> = { hunter: 1.3, omnivore: 1.15, grazer: 1 };

/** No one raids in the first two years ashore, nor a village of fewer than this. */
const GRACE_DAYS = 32;
const GRACE_PEOPLE = 20;
/** Days between one raid and the next (more or less). */
const RAID_GAP = 14;
/** Days from being seen coming to arriving (more with a watch post). */
const WARN_DAYS = 1;
/** A village beaten off this many times leaves you be. */
const COWED = 3;
/** The chief leading a raid; the defenders rallied. */
const LEAD = 0.25;
const RALLY = 0.2;
/** How fast a war band walks (tiles a second). */
const BAND_SPEED = 1.2;

export interface Battle {
  village: number;
  /** Who fell on whom. */
  attack: 'us' | 'them';
  ours: number;
  theirs: number;
  /** After each round: how many still stand on each side. */
  rounds: [number, number][];
  won: boolean;
  /** Of ours who fell, how many died (the rest are hurt, and mend). */
  dead: number;
  /** Of theirs who fell. */
  theirDead: number;
  took?: { food: number; wood: number };
  led?: boolean;
  rallied?: boolean;
  when: string;
}

export interface Raid {
  from: number;
  /** When they were seen watching, seen coming, and when they'll be here (days since landfall). */
  watched: number;
  seen?: number;
  arrives?: number;
  fighters: number;
  rallied?: boolean;
}

export interface WarBand {
  to: number;
  fighters: number;
  /** When it set out and when it gets there (days since landfall). */
  left: number;
  arrives: number;
}

const today = (s: ShoreState) => s.day + s.clock / DAY_SEC;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Whether they'd come raiding you: predators (and, if you or they eat their own, anyone), still
 * there, not yours, not yet beaten off for good. */
export function hostile(s: ShoreState, v: Village): boolean {
  const r = relation(s, v);
  return (r === 'predator' || r === 'enemy') && !v.gone && !v.vassal && !v.joined && (v.beaten ?? 0) < COWED;
}

/** Whether you can raid them: prey (or, for cannibals, anyone not yours), found, still there. */
export function raidable(s: ShoreState, v: Village): boolean {
  const r = relation(s, v);
  return v.found && (r === 'prey' || r === 'enemy') && !v.gone && !v.vassal && !v.joined;
}

/** The grown, who fight (less any out with the war band). */
export function fighters(s: ShoreState): number {
  return Math.max(0, s.people.filter((p) => isAdult(s, p)).length - (s.warband?.fighters ?? 0));
}

/** A side's strength: fighters × their kind × arms (× walls, at home). */
export function ourStrength(s: ShoreState, n: number, home: boolean, extra = 0): number {
  const bo = boosts(s);
  return n * (KIND[s.look.diet] ?? 1) * (1 + bo.arms + extra) * (home ? 1 + bo.guard : 1);
}
export function theirStrength(v: Village, n: number): number {
  return n * (KIND[v.diet] ?? 1) * (v.cannibal ? 1.15 : 1);
}

/** How many a village sends raiding, and how many hold it against a raid. */
export function raiders(v: Village): number {
  return Math.max(2, Math.round(v.pop * 0.35));
}
export function holders(v: Village): number {
  return Math.max(2, Math.round(v.pop * 0.6));
}

/** A word on the odds, not a number: what the elders would say. */
export function odds(us: number, them: number): string {
  const r = us / Math.max(0.1, them);
  return r > 1.8 ? 'They\'d be no match for us.' : r > 1.2 ? 'We\'re the stronger.' : r > 0.85 ? 'It could go either way.' : r > 0.55 ? 'They\'re the stronger.' : 'We\'d be cut to pieces.';
}

/** Two lines trade blows until one breaks (down to under half of what it started with) or,
 * after eight rounds, the one with fewer standing gives way. */
function fight(rand: () => number, a: number, aEach: number, b: number, bEach: number): { rounds: [number, number][]; aWon: boolean } {
  let x = a;
  let y = b;
  const rounds: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const hitB = x * aEach * 0.18 * (0.75 + rand() * 0.5);
    const hitA = y * bEach * 0.18 * (0.75 + rand() * 0.5);
    x = Math.max(0, x - hitA);
    y = Math.max(0, y - hitB);
    rounds.push([Math.round(x), Math.round(y)]);
    if (x < a * 0.5 || y < b * 0.5) break;
  }
  return { rounds, aWon: x / a >= y / b };
}

function rngFor(s: ShoreState, salt: number): () => number {
  let r = (Math.floor(s.seed * 7919 + today(s) * 131 + salt * 104729) % 2147483646) + 1;
  return () => ((r = (r * 16807) % 2147483647) / 2147483647);
}

/** Of those who fell, the grown ones who die (the least hurt mend). Never the chief at home. */
function bury(state: GameState, s: ShoreState, n: number, home: boolean): number {
  const grown = s.people.filter((p) => isAdult(s, p) && (!home || p.id !== s.chief));
  const dead = grown.sort((a, b) => a.born - b.born).slice(0, Math.min(n, Math.max(0, grown.length - 2)));
  for (const p of dead) killed(state, s, p);
  return dead.length;
}

/** Each day: raids gathering, coming, arriving; the war band reaching where it's going. */
export function warDawn(state: GameState, s: ShoreState): void {
  const now = today(s);
  // A raid coming: seen watching, then seen coming, then here.
  const r = s.raid;
  if (r) {
    const v = s.villages.find((x) => x.id === r.from);
    if (!v || !hostile(s, v)) s.raid = undefined;
    else if (r.seen === undefined && now >= r.watched + 1) {
      r.seen = now;
      r.arrives = now + WARN_DAYS + boosts(s).warn;
      r.fighters = raiders(v);
      s.news.push(`Raiders! ${cap(v.name)} are coming.`);
      record(state, `${cap(v.name)} were seen coming, armed: about ${r.fighters} of them.`, 'shore', shoreWhen(s));
    }
  }
  // Someone new out there, watching: a raid's being thought of.
  if (!s.raid && now >= GRACE_DAYS && s.people.length >= GRACE_PEOPLE && now >= (s.nextRaid ?? 0)) {
    const hearth = s.hearth;
    const them = s.villages.filter((v) => hostile(s, v)).sort((a, b) => Math.hypot(a.x - hearth.x, a.y - hearth.y) - Math.hypot(b.x - hearth.x, b.y - hearth.y));
    const rand = rngFor(s, 1);
    // The nearest that think they'd win (they don't raid a fight they'd lose).
    const v = them.find((x) => theirStrength(x, raiders(x)) > ourStrength(s, fighters(s), true) * 0.45 * (0.8 + rand() * 0.4));
    s.nextRaid = now + RAID_GAP * (0.7 + rand() * 0.6);
    if (v) {
      s.raid = { from: v.id, watched: now, fighters: raiders(v) };
      s.news.push('Someone was seen watching from the trees.');
      record(state, `Strangers were seen watching the village from the trees${v.found ? `: ${v.name}, by the look of them` : ''}.`, 'shore', shoreWhen(s));
    }
  }
}

/** Through the day: raids arriving, the war band arriving. */
export function stepWar(state: GameState, s: ShoreState): void {
  const now = today(s);
  const r = s.raid;
  if (r?.arrives !== undefined && now >= r.arrives) {
    s.raid = undefined;
    const v = s.villages.find((x) => x.id === r.from);
    if (v && hostile(s, v)) defend(state, s, v, r);
  }
  const w = s.warband;
  if (w && now >= w.arrives) {
    s.warband = undefined;
    const v = s.villages.find((x) => x.id === w.to);
    if (v && raidable(s, v)) attack(state, s, v, w);
    else record(state, 'The war band found no one to fight, and came home.', 'shore', shoreWhen(s));
  }
}

function defend(state: GameState, s: ShoreState, v: Village, r: Raid): void {
  const rand = rngFor(s, 2);
  const ours = fighters(s);
  const theirs = r.fighters;
  const aEach = ourStrength(s, 1, true, r.rallied ? RALLY : 0);
  const bEach = theirStrength(v, 1);
  const f = fight(rand, ours, aEach, theirs, bEach);
  const last = f.rounds[f.rounds.length - 1];
  const fell = ours - last[0];
  const theirDead = theirs - last[1];
  // Of ours who fell, a third die; beaten, they take what they can carry.
  const dead = bury(state, s, Math.round(fell / 3), true);
  v.pop = Math.max(0, v.pop - Math.round(theirDead * 0.6));
  const b: Battle = { village: v.id, attack: 'them', ours, theirs, rounds: f.rounds, won: f.aWon, dead, theirDead, rallied: r.rallied, when: shoreWhen(s) };
  if (f.aWon) {
    v.beaten = (v.beaten ?? 0) + 1;
    s.news.push(`${cap(v.name)} were driven off.`);
    record(state, `${cap(v.name)} fell on the village, and were driven off${dead ? `. ${dead} of ours died in the fighting` : ''}.${v.beaten >= COWED ? ' They will not come again.' : ''}`, 'shore', shoreWhen(s));
  } else {
    const food = Math.floor(s.food * 0.25);
    const wood = Math.floor(s.wood * 0.25);
    s.food -= food;
    s.wood -= wood;
    b.took = { food, wood };
    s.news.push(`${cap(v.name)} broke through, and took what they could carry.`);
    record(state, `${cap(v.name)} fell on the village and broke through. They carried off ${food} food and ${wood} wood${dead ? `, and ${dead} of ours died` : ''}.`, 'shore', shoreWhen(s));
  }
  flee(state, s, v);
  (s.battles ??= []).push(b);
  s.raids = (s.raids ?? 0) + 1;
}

function attack(state: GameState, s: ShoreState, v: Village, w: WarBand): void {
  const rand = rngFor(s, 3);
  const led = Math.hypot(s.chiefAt.x - v.x, s.chiefAt.y - v.y) < 14;
  const ours = w.fighters;
  const theirs = holders(v);
  const f = fight(rand, ours, ourStrength(s, 1, false, led ? LEAD : 0), theirs, theirStrength(v, 1));
  const last = f.rounds[f.rounds.length - 1];
  const fell = ours - last[0];
  const theirDead = theirs - last[1];
  const dead = bury(state, s, Math.round(fell / 3), false);
  v.pop = Math.max(0, v.pop - Math.round(theirDead * 0.6));
  const b: Battle = { village: v.id, attack: 'us', ours, theirs, rounds: f.rounds, won: f.aWon, dead, theirDead, led, when: shoreWhen(s) };
  if (f.aWon) {
    const food = Math.min(Math.round(v.pop * 2), Math.max(0, foodCap(s) - s.food));
    const wood = Math.min(Math.round(v.pop), Math.max(0, woodCap(s) - s.wood));
    s.food += food;
    s.wood += wood;
    b.took = { food, wood };
    if (v.pop >= 4) {
      // Theirs now: they work their land for you, grudgingly at first.
      v.vassal = { tax: 0.25, loyalty: 45, conquered: today(s) };
      s.news.push(`${cap(v.name)} are beaten. Their village is yours.`);
      record(state, `The war band fell on ${v.name}${led ? ', the chief at its head,' : ''} and beat them. Their village pays tribute to the hearth now.${dead ? ` ${dead} of ours died.` : ''}`, 'shore', shoreWhen(s));
    } else flee(state, s, v);
  } else {
    s.news.push(`The war band was beaten at ${v.name}.`);
    record(state, `The war band fell on ${v.name}${led ? ', the chief at its head,' : ''} and was beaten back.${dead ? ` ${dead} of ours died.` : ''}`, 'shore', shoreWhen(s));
  }
  (s.battles ??= []).push(b);
}

/** Too few left to hold their village: they leave the island's map. */
function flee(state: GameState, s: ShoreState, v: Village): void {
  if (v.pop >= 4 || v.gone || v.vassal) return;
  v.gone = { to: -1, day: today(s) };
  record(state, `What was left of ${v.name} left their village, and were not seen again.`, 'shore', shoreWhen(s));
}

/** Sends a war band (this many of the grown) against a village. */
export function sendBand(state: GameState, s: ShoreState, id: number, n: number): boolean {
  const v = s.villages.find((x) => x.id === id);
  if (!v || !raidable(s, v) || s.warband || n < 2 || n > fighters(s)) return false;
  const d = Math.hypot(v.x - s.hearth.x, v.y - s.hearth.y) * 1.3;
  const now = today(s);
  s.warband = { to: id, fighters: n, left: now, arrives: now + d / BAND_SPEED / DAY_SEC };
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  s.news.push(`The war band set out for ${v.name}.`);
  record(state, `${chief} sent ${n} out against ${v.name}.`, 'shore', shoreWhen(s));
  return true;
}

/** Rallying the defenders before the raiders arrive (once, while you're there). */
export function rally(s: ShoreState): boolean {
  if (!s.raid?.seen || s.raid.rallied) return false;
  s.raid.rallied = true;
  return true;
}

/** Whether there's a palisade or a watch post worth building yet: raids have come, or a
 * hostile village has been found. */
export function threatened(s: ShoreState): boolean {
  return (s.raids ?? 0) > 0 || !!s.raid || s.villages.some((v) => v.found && hostile(s, v));
}

/** Fighters on the war band don't work while away. */
export function away(s: ShoreState): number {
  return s.warband?.fighters ?? 0;
}

