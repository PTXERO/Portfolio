// Diplomacy: where every village that isn't kin (or yours) stands with you. Gifts warm them,
// raids and betrayals sour them, and over time it drifts back toward what they are to you. At
// peace they don't come raiding; allies come to help when you're raided. And with strength
// enough at your back, the chief, there in person, can demand they submit without a fight.

import type { GameState } from './types';
import { record } from './chronicle';
import { chiefNear, DAY_SEC, giftCost, relation, rng, ruled, SEASON_DAYS, shoreOf, shoreWhen, type ShoreState, type Village } from './shore';
import { fighters, holders, ourStrength, theirStrength } from './war';

/** Where they start (and drift back to), by what they are to you. */
const BASE = { kin: 0, prey: 0, predator: -40, enemy: -70 } as const;
/** Enemies: nothing will ever change that (they never get to peace). */
const ENEMY_MOST = -20;
/** At peace, from here: they don't raid you. Allies, from here: they come when you're raided. */
export const PEACE = 20;
export const ALLY = 60;

export type Stance = 'hostile' | 'wary' | 'peace' | 'ally';
export const STANCE_NAME: Record<Stance, string> = { hostile: 'Hostile', wary: 'Wary', peace: 'At peace', ally: 'Allies' };

/** Whether a village has a standing with you at all (found, not kin, not yours, still there). */
export function foreign(s: ShoreState, v: Village): boolean {
  return v.found && !v.gone && !v.joined && !ruled(v) && relation(s, v) !== 'kin';
}

export function standingOf(s: ShoreState, v: Village): number {
  return v.standing ?? BASE[relation(s, v)];
}
export function stanceOf(s: ShoreState, v: Village): Stance {
  const n = standingOf(s, v);
  return n >= ALLY ? 'ally' : n >= PEACE ? 'peace' : n >= -30 ? 'wary' : 'hostile';
}
function setStanding(s: ShoreState, v: Village, n: number): void {
  v.standing = Math.max(-100, Math.min(relation(s, v) === 'enemy' ? ENEMY_MOST : 100, n));
}
export function nudge(s: ShoreState, v: Village, by: number): void {
  setStanding(s, v, standingOf(s, v) + by);
}

/** A gift of food to a village that isn't kin: it warms them (twice, brought by the chief;
 * less, the warmer they are already). Returns the standing won. */
export function giftForeign(state: GameState, id: number): number {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !foreign(s, v)) return 0;
  const cost = giftCost(v);
  if (s.food < cost) return 0;
  s.food -= cost;
  const before = standingOf(s, v);
  const gain = 10 * (chiefNear(s, v) ? 2 : 1) * Math.max(0.2, 1 - Math.max(0, before) / 120);
  nudge(s, v, gain);
  const won = Math.round((standingOf(s, v) - before) * 10) / 10;
  const now = stanceOf(s, v);
  if (now !== (before >= ALLY ? 'ally' : before >= PEACE ? 'peace' : before >= -30 ? 'wary' : 'hostile') && (now === 'peace' || now === 'ally')) {
    s.news.push(now === 'ally' ? `${cap(v.name)} are your allies now.` : `${cap(v.name)} are at peace with you now.`);
    record(state, now === 'ally' ? `${cap(v.name)} became allies of the hearth: when raiders come, they'll come too.` : `${cap(v.name)} made peace with the hearth, for the gifts. While it lasts, they won't come raiding.`, 'shore', shoreWhen(s));
  }
  return won;
}

/** What demanding they submit would come to: how much stronger you are than those who'd hold
 * their village, and the chance they give in. */
export function demandOdds(s: ShoreState, v: Village): { ratio: number; chance: number } {
  const ratio = ourStrength(s, fighters(s), false) / Math.max(0.1, theirStrength(v, holders(v)));
  // (Three times their strength, they give in; twice, they might; less, they laugh.)
  const chance = Math.max(0, Math.min(1, (ratio - 1.8) / 1.2)) * (standingOf(s, v) >= PEACE ? 1.2 : 1);
  return { ratio, chance: Math.min(1, chance) };
}
/** Whether the chief can demand it now: there in person, once a season. */
export function canDemand(s: ShoreState, v: Village): boolean {
  return foreign(s, v) && chiefNear(s, v) && (v.demanded === undefined || today(s) - v.demanded >= SEASON_DAYS);
}

/** The chief, there in person, demands they submit: if you're strong enough they do (a vassal,
 * and not a grudging one: no blood was shed); if not, they're insulted. */
export function demandSubmit(state: GameState, id: number): 'yes' | 'no' | null {
  const s = shoreOf(state);
  const v = s?.villages.find((x) => x.id === id);
  if (!s || !v || !canDemand(s, v)) return null;
  const { chance } = demandOdds(s, v);
  v.demanded = today(s);
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  if (rng(s.seed * 71 + s.day * 13 + v.id)() < chance) {
    v.vassal = { tax: 0.15, loyalty: 60 };
    v.standing = undefined;
    s.news.push(`${cap(v.name)} gave in without a fight. Their village is yours.`);
    record(state, `${chief} went to ${v.name} and told them to submit. Seeing the strength behind ${chief}, they did, and not a blow was struck.`, 'shore', shoreWhen(s));
    return 'yes';
  }
  nudge(s, v, -20);
  s.news.push(`${cap(v.name)} refused, and won't forget being asked.`);
  record(state, `${chief} went to ${v.name} and told them to submit. They laughed, and sent ${chief} away.`, 'shore', shoreWhen(s));
  return 'no';
}

/** A war band sent against them: at peace, that's a betrayal, and every village hears of it. */
export function struck(state: GameState, s: ShoreState, v: Village): void {
  const was = stanceOf(s, v);
  if (was === 'peace' || was === 'ally') {
    for (const x of s.villages) if (x !== v && foreign(s, x)) nudge(s, x, -15);
    s.news.push(`You broke the peace with ${v.name}. The island will remember.`);
    record(state, `The hearth broke its peace with ${v.name} and fell on them. Every village on the island heard of it, and trusted the hearth less.`, 'shore', shoreWhen(s));
  }
  setStanding(s, v, Math.min(standingOf(s, v) - 40, -60));
}

/** Each dawn, every standing drifts back toward what they are to you (slowly: a peace has to be
 * kept up; an alliance, less so). */
export function diplomacyDawn(s: ShoreState): void {
  for (const v of s.villages) {
    if (!foreign(s, v) || v.standing === undefined) continue;
    const base = BASE[relation(s, v)];
    const n = v.standing;
    const rate = n >= ALLY ? 0.5 : 1;
    v.standing = n > base ? Math.max(base, n - rate) : Math.min(base, n + rate);
    if (v.standing === base) v.standing = undefined;
  }
}

/** Allies near enough to reach the raid in time, and a share of them to send. */
export function alliesFor(s: ShoreState): Village[] {
  return s.villages.filter((v) => foreign(s, v) && stanceOf(s, v) === 'ally' && v.pop >= 6);
}

const today = (s: ShoreState) => s.day + s.clock / DAY_SEC;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
