// The living island: the villages that aren't yours go on without you. Each dawn they grow back
// toward what their land holds; now and then one that hunts falls on one it preys on (driving it
// down, or making it pay tribute), and some of the beaten flee to you; and a crowded one sends
// some off to make a camp of their own on empty ground. You hear of it as smoke and rumour.

import type { GameState } from './types';
import { record } from './chronicle';
import { CHAIN, DAY_SEC, foundCamp, nameFrom, rng, roomLeft, ruled, shoreIsland, shoreWhen, type ShoreState, type Village } from './shore';
import { isLand } from './island';
import { personal } from './genes';
import { holders, raiders, theirStrength } from './war';
import { foreign, nudge } from './diplomacy';

/** The island's own: a village that isn't yours, still there. */
export function wild(v: Village): boolean {
  return !v.gone && !v.joined && !ruled(v) && v.outpost === undefined;
}

/** What a village's land holds (half again what it began at). */
export function homeOf(v: Village): number {
  return v.home ?? Math.max(10, Math.round(v.pop * 1.5));
}

/** Whether one village hunts another (by what they eat; those who eat their own, anyone). */
export function hunts(a: Village, b: Village): boolean {
  if (a.cannibal) return a.id !== b.id;
  return CHAIN.indexOf(a.diet) < CHAIN.indexOf(b.diet);
}

/** Most villages the island holds (old and new camps together). */
const MOST_VILLAGES = 14;
/** A day's chance a strong hunting village falls on one it preys on; and that a crowded one sends
 * some off to found a camp. */
const RAID_CHANCE = 0.03;
const CAMP_CHANCE = 0.02;
/** How far a raid reaches, and a new camp is made from its village. */
const RAID_REACH = 320;
const CAMP_REACH = 260;

const today = (s: ShoreState) => s.day + s.clock / DAY_SEC;
const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Each dawn, the island's own life: growing back, raids among them, new camps. */
export function worldDawn(state: GameState, s: ShoreState): void {
  const rand = rng(s.seed * 97 + s.day * 7919);
  for (const v of s.villages) {
    if (!wild(v)) continue;
    v.home ??= homeOf(v);
    // Back toward what the land holds: quick when few, slow near full (and slower paying
    // tribute to another).
    const room = Math.max(0, 1 - v.pop / v.home);
    v.pop = Math.min(v.home, v.pop + Math.max(0.5, v.pop * 0.05) * room * (v.overlord !== undefined ? 0.5 : 1));
    // (A tribute-taker gone, or taken by you: those who paid it are free.)
    const lord = v.overlord !== undefined ? s.villages.find((x) => x.id === v.overlord) : undefined;
    if (v.overlord !== undefined && (!lord || !wild(lord))) {
      v.overlord = undefined;
      if (lord && ruled(lord) && v.found) {
        nudge(s, v, 20);
        s.news.push(`${cap(v.name)} are free of ${lord.name}, and glad of you for it.`);
        record(state, `With ${lord.name} beaten, ${v.name} paid them tribute no more, and were grateful to the hearth.`, 'shore', shoreWhen(s));
      }
    }
  }
  // Raids among them: a hunting village, big enough, falls on the nearest it preys on.
  for (const a of s.villages) {
    if (!wild(a) || a.pop < 12 || a.overlord !== undefined || rand() > RAID_CHANCE) continue;
    const b = s.villages
      .filter((x) => x !== a && wild(x) && x.overlord !== a.id && hunts(a, x) && near(a, x) < RAID_REACH)
      .sort((x, y) => near(a, x) - near(a, y))[0];
    if (b) villageRaid(state, s, a, b, rand);
  }
  // New camps: a village near full sends some off to empty ground nearby.
  if (s.villages.filter((v) => !v.gone).length < MOST_VILLAGES) {
    for (const v of s.villages) {
      if (!wild(v) || v.pop < 30 || v.pop < homeOf(v) * 0.95 || rand() > CAMP_CHANCE) continue;
      const at = emptyGround(s, v, rand);
      if (!at) continue;
      const n = Math.round(v.pop * 0.25);
      v.pop -= n;
      const camp = foundCamp(s, at, v.diet, v.cannibal, n, rand);
      camp.home = Math.round(n * 2.5);
      s.villages.push(camp);
      if (v.found) {
        s.news.push(`Some of ${v.name} have gone off to make a camp of their own.`);
        record(state, `${cap(v.name)} had grown too many for their land. ${n} of them went off to make a camp of their own, somewhere out in the fog.`, 'shore', shoreWhen(s));
      }
      break;
    }
  }
}

/** Empty ground for a new camp: open land near the village, away from everyone else. */
function emptyGround(s: ShoreState, from: Village, rand: () => number): { x: number; y: number } | null {
  const is = shoreIsland(s.seed);
  const taken = [s.hearth, ...s.villages.filter((v) => !v.gone || v.outpost !== undefined)];
  for (let k = 0; k < 60; k++) {
    const a = rand() * Math.PI * 2;
    const r = 70 + rand() * (CAMP_REACH - 70);
    const q = { x: Math.round(from.x + Math.cos(a) * r), y: Math.round(from.y + Math.sin(a) * r) };
    if (q.x < 12 || q.y < 12 || q.x > is.n - 12 || q.y > is.n - 12) continue;
    let ok = true;
    for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2 && ok; i++) if (!isLand(is, q.x + i, q.y + j)) ok = false;
    if (ok && taken.every((t) => near(t, q) >= 70)) return q;
  }
  return null;
}

/** One village falls on another, out of your sight: the stronger wins. Beaten badly, the
 * weaker pays the winner tribute; and some of the beaten flee, to you. */
export function villageRaid(state: GameState, s: ShoreState, a: Village, b: Village, rand: () => number): void {
  const att = theirStrength(a, raiders(a)) * (0.7 + rand() * 0.6);
  const def = theirStrength(b, holders(b)) * (0.7 + rand() * 0.6);
  const heard = a.found || b.found;
  if (att > def) {
    b.pop = Math.max(4, b.pop * 0.75);
    a.pop *= 1.05;
    const taken = att > def * 1.8 && b.overlord === undefined;
    if (taken) b.overlord = a.id;
    // Some of the beaten flee: to the hearth if there's room, else to a settlement of yours.
    const fled = b.found ? refugees(state, s, b, 2 + Math.floor(rand() * 3), rand) : 0;
    if (heard) {
      s.news.push(`Smoke over ${b.name}: ${a.name} fell on them${taken ? ', and made them pay tribute' : ''}.`);
      record(state, `${cap(a.name)} fell on ${b.name} and beat them${taken ? `. They pay ${a.name} tribute now` : ''}.${fled ? ` ${fled} of ${b.name} fled, and came to the hearth.` : ''}`, 'shore', shoreWhen(s));
    }
  } else {
    a.pop = Math.max(4, a.pop * 0.8);
    if (heard) {
      s.news.push(`${cap(b.name)} drove off ${a.name}.`);
      record(state, `${cap(a.name)} fell on ${b.name}, and were driven off.`, 'shore', shoreWhen(s));
    }
  }
}

/** Critters fleeing a beaten village come to you: by the hearth if there's room, else to the
 * biggest settlement with room. Returns how many came. */
function refugees(state: GameState, s: ShoreState, from: Village, n: number, rand: () => number): number {
  n = Math.min(n, Math.floor(from.pop - 4));
  if (n <= 0) return 0;
  const now = today(s);
  if (roomLeft(s) >= n) {
    for (let i = 0; i < n; i++) {
      const id = s.nextId++;
      const age = 12 + rand() * 20;
      s.people.push({ id, name: nameFrom(rand), born: now - age, dies: now - age + 70 + rand() * 30, kind: from.id, joined: now, genes: personal(undefined, id * 31 + from.id) });
    }
  } else {
    const to = s.villages.filter((v) => v.settled !== undefined && !v.gone && v.pop < 70).sort((x, y) => y.pop - x.pop)[0];
    if (!to) return 0;
    to.pop += n;
  }
  from.pop -= n;
  record(state, `${n} of ${from.name}, fleeing the raid, asked the hearth to take them in. They were taken in.`, 'shore', shoreWhen(s));
  return n;
}

/** Struck by the hearth: the villages kin to them (the same kind, the island's own) take it ill. */
export function friendsHear(s: ShoreState, v: Village): void {
  for (const x of s.villages) if (x !== v && foreign(s, x) && x.diet === v.diet && !!x.cannibal === !!v.cannibal) nudge(s, x, -10);
}

/** Raiders driven off by the hearth: the villages they prey on are glad of it. */
export function preyHear(s: ShoreState, raider: Village): void {
  for (const x of s.villages) if (foreign(s, x) && hunts(raider, x)) nudge(s, x, 4);
}
