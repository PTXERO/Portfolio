// The tribe among themselves: who they are to each other, how they feel, and what they do
// about it. The player never commands them, so they have to live: mates and parents and
// children, friends made over shared work and rivals over food, the kind who give away their
// share and the greedy who steal, fights, grief, births, breakdowns, preaching, and stories by
// the fire. All of it changes how they work and who lives, and the most telling of it each
// night goes into the Chronicle (a few lines, not a log).

import type { ExtinctionState, Survivor } from './extinction';
import { say } from './miracles';

export type Quirk = 'kind' | 'greedy' | 'brave' | 'devout' | 'bitter' | 'cheerful' | 'quarrelsome' | 'steady';
export type BondKind = 'mate' | 'parent' | 'child' | 'friend' | 'rival';
export interface Bond {
  id: number;
  kind: BondKind;
}

export const QUIRKS: Record<Quirk, string> = {
  kind: 'Kind',
  greedy: 'Greedy',
  brave: 'Brave',
  devout: 'Devout',
  bitter: 'Bitter',
  cheerful: 'Cheerful',
  quarrelsome: 'Quarrelsome',
  steady: 'Steady',
};
const QUIRK_LIST = Object.keys(QUIRKS) as Quirk[];

/** A roll of the Extinction's own dice (seeded, so the countdown's guess holds). */
function roll(ex: ExtinctionState): number {
  ex.luck = ((ex.luck ?? 1) * 1664525 + 1013904223) >>> 0;
  return ex.luck / 2 ** 32;
}
const pick = <T>(ex: ExtinctionState, list: T[]): T => list[Math.floor(roll(ex) * list.length)];

const byId = (ex: ExtinctionState, id: number) => ex.people.find((p) => p.id === id);
const bondOf = (p: Survivor, id: number) => p.bonds?.find((b) => b.id === id);
function bond(a: Survivor, b: Survivor, ab: BondKind, ba: BondKind): void {
  (a.bonds ??= []).push({ id: b.id, kind: ab });
  (b.bonds ??= []).push({ id: a.id, kind: ba });
}
function unbond(a: Survivor, b: Survivor): void {
  a.bonds = (a.bonds ?? []).filter((x) => x.id !== b.id);
  b.bonds = (b.bonds ?? []).filter((x) => x.id !== a.id);
}
/** What one is to another, in words ("their mate"). */
const whatIs: Record<BondKind, string> = { mate: 'mate', parent: 'child', child: 'parent', friend: 'friend', rival: 'rival' };

/** Gives a tribe its families and natures (at the start, or a run from before this). */
export function ensureSociety(ex: ExtinctionState): void {
  if (ex.people.every((p) => p.quirk)) return;
  for (const p of ex.people) p.quirk ??= pick(ex, QUIRK_LIST);
  // Mates among the grown, and children with their parents.
  const grown = ex.people.filter((p) => p.trait !== 'young' && !p.bonds?.length);
  for (let i = 0; i + 1 < grown.length; i += 2) if (roll(ex) < 0.6) bond(grown[i], grown[i + 1], 'mate', 'mate');
  const parents = ex.people.filter((p) => p.bonds?.some((b) => b.kind === 'mate'));
  for (const kid of ex.people.filter((p) => p.trait === 'young')) {
    if (!parents.length) break;
    const mum = pick(ex, parents);
    bond(mum, kid, 'parent', 'child');
    const other = mum.bonds?.find((b) => b.kind === 'mate');
    const dad = other && byId(ex, other.id);
    if (dad) bond(dad, kid, 'parent', 'child');
  }
  // A few old friendships and grudges from before.
  for (let k = 0; k < Math.floor(ex.people.length / 6); k++) {
    const a = pick(ex, ex.people);
    const b = pick(ex, ex.people);
    if (a !== b && !bondOf(a, b.id)) bond(a, b, roll(ex) < 0.6 ? 'friend' : 'rival', roll(ex) < 0.6 ? 'friend' : 'rival');
  }
}

/** How someone feels (about −100 to +30): hunger, grief, hurt, sickness, the dread of the
 * spear, the fire, their friends and their own nature. */
export function moodOf(ex: ExtinctionState, p: Survivor): number {
  let m = 0;
  m -= p.hunger * 14;
  if (p.grief) m -= 25;
  if (p.hurt) m -= 12;
  if (p.sick !== undefined) m -= 20;
  m -= (ex.dread ?? 0) * (p.quirk === 'devout' ? 0.05 : p.quirk === 'brave' ? 0.12 : 0.25);
  if (ex.last?.fire) m += 6;
  m += Math.min(3, (p.bonds ?? []).filter((b) => b.kind !== 'rival' && byId(ex, b.id)).length) * 4;
  // Having eaten their own sits on all of them.
  if (ex.diet === 'cannibal') m -= p.quirk === 'bitter' ? 6 : 12;
  if (p.quirk === 'cheerful') m += 10;
  if (p.quirk === 'bitter') m -= 10;
  return Math.max(-100, Math.min(30, m));
}

/** Hope: the tribe's mood as a whole, 0 to 100 (50 is bearing up). High, children are born;
 * low, people break. */
export function hopeOf(ex: ExtinctionState): number {
  if (!ex.people.length) return 0;
  const avg = ex.people.reduce((a, p) => a + moodOf(ex, p), 0) / ex.people.length;
  return Math.round(Math.max(0, Math.min(100, 70 + avg * 1.1)));
}

/** Something that happened to someone, kept with them (the last few). */
export function remember(ex: ExtinctionState, p: Survivor, text: string): void {
  (p.memories ??= []).push(`Day ${ex.day + 1}: ${text}`);
  if (p.memories.length > 6) p.memories.splice(0, p.memories.length - 6);
}

/** How their mood and state shows in their work. */
export function spirit(ex: ExtinctionState, p: Survivor): number {
  const m = moodOf(ex, p);
  const mood = m < -60 ? 0.75 : m < -40 ? 0.88 : m > 5 ? 1.05 : 1;
  return mood * (p.grief ? 0.75 : 1) * (p.hurt ? 0.6 : 1) * (p.broken ? 0 : 1);
}

export function moodWord(ex: ExtinctionState, p: Survivor): string {
  if (p.broken) return 'Broken';
  if (p.grief) return 'Grieving';
  if (p.hurt) return 'Hurt';
  const m = moodOf(ex, p);
  return m < -60 ? 'Despairing' : m < -40 ? 'Miserable' : m < -15 ? 'Low' : m > 5 ? 'Content' : 'Bearing up';
}

/** The one the others follow: steady, strong, with the most who'd stand by them. */
export function leaderOf(ex: ExtinctionState): Survivor | null {
  let best: Survivor | null = null;
  let score = -Infinity;
  for (const p of ex.people) {
    if (p.trait === 'young') continue;
    const s = (p.bonds ?? []).filter((b) => b.kind !== 'rival').length * 2 - (p.bonds ?? []).filter((b) => b.kind === 'rival').length * 2 + (p.trait === 'strong' || p.trait === 'hardy' ? 2 : 0) + (p.quirk === 'brave' || p.quirk === 'steady' ? 3 : 0) - p.hunger + (p.id === ex.leader ? 2 : 0);
    if (s > score) {
      score = s;
      best = p;
    }
  }
  return best;
}

/** Tonight's notable moments, weighed; only the few most telling are kept. */
function note(ex: ExtinctionState, weight: number, text: string): void {
  (ex.notes ??= []).push({ weight, text });
}

/** Whether a kind of moment is due again (each has its own quiet spell after it's told). */
function due(ex: ExtinctionState, kind: string, days: number): boolean {
  const last = ex.told?.[kind];
  return last === undefined || ex.day - last >= days;
}
function told(ex: ExtinctionState, kind: string): void {
  (ex.told ??= {})[kind] = ex.day;
}
export function flushNotes(ex: ExtinctionState, keep = 3): void {
  const n = (ex.notes ?? []).sort((a, b) => b.weight - a.weight).slice(0, keep);
  for (const x of n) say(ex, x.text);
  ex.notes = [];
}

/** Before the meal: the greedy, starving, take from the stores in the dark; sometimes they're
 * caught. */
export function nightTheft(ex: ExtinctionState): void {
  const thief = ex.people.find((p) => p.quirk === 'greedy' && p.hunger >= 1.6 && !p.broken && roll(ex) < 0.25);
  if (!thief) return;
  const took = Math.min(3, ex.meat + ex.plants);
  if (took <= 0) return;
  const fromMeat = Math.min(ex.meat, took);
  ex.meat -= fromMeat;
  ex.plants -= Math.min(ex.plants, took - fromMeat);
  thief.hunger = Math.max(0, thief.hunger - 0.6);
  remember(ex, thief, 'stole from the stores in the night');
  const witness = ex.people.find((p) => p !== thief && (p.quirk === 'brave' || p.quirk === 'quarrelsome') && roll(ex) < 0.5);
  if (!witness) {
    note(ex, 2, `Someone ate from the stores in the night. ${thief.name} slept well.`);
    return;
  }
  const kin = bondOf(witness, thief.id);
  if (kin && kin.kind !== 'rival') {
    note(ex, 3, `${witness.name} caught ${thief.name}, their ${whatIs[kin.kind]}, at the stores in the night, and said nothing.`);
    return;
  }
  fight(ex, witness, thief, `${witness.name} caught ${thief.name} stealing from the stores`);
}

/** A fight: one gets hurt (works badly for days), and they're rivals after. Rarely, worse. */
function fight(ex: ExtinctionState, a: Survivor, b: Survivor, why: string): void {
  const loser = roll(ex) < 0.5 ? a : b;
  const winner = loser === a ? b : a;
  loser.hurt = 3;
  remember(ex, loser, `fought ${winner.name}, and came off worse`);
  remember(ex, winner, `fought ${loser.name}`);
  if (!bondOf(a, b.id)) bond(a, b, 'rival', 'rival');
  else {
    const ab = bondOf(a, b.id)!;
    if (ab.kind === 'friend') {
      unbond(a, b);
      bond(a, b, 'rival', 'rival');
    }
  }
  if (loser.hunger >= 2.4 && roll(ex) < 0.2) {
    ex.people = ex.people.filter((p) => p !== loser);
    ex.deaths += 1;
    note(ex, 9, `${why}. They fought, and ${loser.name} didn't get up. ${winner.name} sat apart from the others after.`);
    return;
  }
  note(ex, 5, `${why}. They fought; ${loser.name} came off worse, and limped for days.`);
}

/** At the meal: the kind give part of their share to the starving they love. */
export function sharing(ex: ExtinctionState): void {
  for (const giver of ex.people) {
    if (giver.quirk !== 'kind' && !(giver.bonds ?? []).some((b) => b.kind === 'parent')) continue;
    if (giver.hunger >= 1.8) continue;
    const near = (giver.bonds ?? []).map((b) => [b, byId(ex, b.id)] as const).find(([b, q]) => q && q.hunger >= 2.2 && b.kind !== 'rival');
    if (!near) continue;
    const [b, q] = near;
    giver.hunger += 0.35;
    q!.hunger -= 0.35;
    remember(ex, giver, `gave half their share to ${q!.name}`);
    remember(ex, q!, `was given ${giver.name}'s share`);
    note(ex, b.kind === 'parent' ? 6 : 4, `${giver.name} gave half their share to ${q!.name}, their ${whatIs[b.kind]}.`);
  }
}

/** After the deaths: those who loved them grieve, and the Chronicle remembers who they were. */
export function mourn(ex: ExtinctionState, dead: Survivor[], how: string): void {
  for (const d of dead) {
    let mourner: { p: Survivor; kind: BondKind } | null = null;
    for (const b of d.bonds ?? []) {
      const p = byId(ex, b.id);
      if (!p || b.kind === 'rival') continue;
      p.grief = b.kind === 'friend' ? 2 : 4;
      remember(ex, p, `lost ${d.name}, their ${b.kind === 'parent' ? 'child' : b.kind === 'child' ? 'parent' : b.kind}`);
      p.bonds = (p.bonds ?? []).filter((x) => x.id !== d.id);
      if (!mourner || b.kind === 'parent' || b.kind === 'mate') mourner = { p, kind: b.kind };
    }
    if (mourner) {
      // (What the dead was to the mourner.)
      const was = mourner.kind === 'parent' ? 'parent' : mourner.kind === 'child' ? 'child' : mourner.kind;
      const line = pick(ex, [
        `${d.name} ${how}. ${mourner.p.name}, their ${was}, sat with the body all day and would not eat.`,
        `${d.name} ${how}. ${mourner.p.name} dug at the ash with bare hands to bury their ${was}.`,
        `${d.name} ${how}. ${mourner.p.name} kept calling for them after dark.`,
      ]);
      note(ex, mourner.kind === 'mate' || mourner.kind === 'parent' || mourner.kind === 'child' ? 7 : 4, line);
    }
  }
}

/** The rest of the night among them: friendships over shared work, quarrels, births, the
 * ones who break, the preaching, the stories by the fire, and who they follow. */
export function socialNight(ex: ExtinctionState, fire: boolean): number {
  let prayer = 0;
  if (ex.people.length < 2) return 0;
  // Days pass on grief and hurt; the broken come back to themselves.
  for (const p of ex.people) {
    if (p.grief) p.grief -= 1;
    if (p.hurt) p.hurt -= 1;
    if (p.broken) p.broken = false;
  }
  // Working side by side, two become friends.
  if (roll(ex) < 0.5 && due(ex, 'friend', 3)) {
    const a = pick(ex, ex.people);
    const mates = ex.people.filter((q) => q !== a && q.job === a.job && a.job !== 'rest' && !bondOf(a, q.id));
    if (mates.length) {
      const b = pick(ex, mates);
      bond(a, b, 'friend', 'friend');
      remember(ex, a, `became friends with ${b.name}`);
      remember(ex, b, `became friends with ${a.name}`);
      const at: Record<string, string> = { forage: 'picking over the ash', scavenge: 'at the carcasses', dig: 'digging', fish: 'at the shore', wood: 'cutting the dead trees', build: 'lashing the raft', listen: 'kneeling at the spear' };
      told(ex, 'friend');
      const where = at[a.job] ?? 'working';
      note(ex, 2, pick(ex, [
        `${a.name} and ${b.name}, ${where} together, began to talk. They're friends now.`,
        `${a.name} showed ${b.name} a better way of ${where.replace(/^at the |^kneeling at the /, (x) => (x.startsWith('at') ? 'working the ' : 'praying at the '))}. They've stuck together since.`,
        `${b.name} pulled ${a.name} out of a fissure ${where === 'at the shore' ? 'on the way to the shore' : 'on the way back'}. They've been inseparable since.`,
        `${a.name} and ${b.name} found they'd both lost someone in the strike. They sit together now.`,
      ]));
    }
  }
  // The quarrelsome and the starving go for each other.
  const angry = ex.people.filter((p) => !p.broken && (p.quirk === 'quarrelsome' || p.quirk === 'bitter') && p.hunger >= 1.5);
  if (angry.length && roll(ex) < 0.3) {
    const a = pick(ex, angry);
    const rival = (a.bonds ?? []).find((b) => b.kind === 'rival');
    const b = (rival && byId(ex, rival.id)) || pick(ex, ex.people.filter((q) => q !== a));
    if (b) fight(ex, a, b, pick(ex, [`${a.name} said ${b.name} wasn't working`, `${a.name} and ${b.name} argued over the last of the food`, `${a.name} blamed ${b.name} for the dead`]));
  }
  // Births: when there's Hope (and food for a full meal). The higher it is, the more often.
  const hope = hopeOf(ex);
  const fed = ex.ration >= 1 && !ex.triage && ex.people.reduce((s, p) => s + p.hunger, 0) / ex.people.length < 1;
  if (fed && hope >= 55 && ex.people.length < 120 && ex.day - (ex.lastBirth ?? -99) >= 2 && roll(ex) < (hope - 45) / 60) {
    const pairs = ex.people.filter((p) => p.bonds?.some((b) => b.kind === 'mate' && byId(ex, b.id)));
    if (pairs.length) {
      const a = pick(ex, pairs);
      const b = byId(ex, a.bonds!.find((x) => x.kind === 'mate')!.id)!;
      const name = babyName(ex);
      const kid: Survivor = { id: ex.nextId++, name, trait: 'young', hunger: 0.6, job: 'rest', grit: 0, quirk: pick(ex, QUIRK_LIST) };
      ex.people.push(kid);
      bond(a, kid, 'parent', 'child');
      bond(b, kid, 'parent', 'child');
      ex.lastBirth = ex.day;
      remember(ex, a, `had a child, ${name}`);
      remember(ex, b, `had a child, ${name}`);
      remember(ex, kid, `born to ${a.name} and ${b.name}`);
      ex.dread = Math.max(0, (ex.dread ?? 0) - 8);
      ex.births = (ex.births ?? 0) + 1;
      note(ex, 8, ex.births === 1 ? `A child was born to ${a.name} and ${b.name}, the first since the strike. They called it ${name}. For a night, no one spoke of the spear.` : pick(ex, [`${a.name} and ${b.name} had a child, ${name}. Another mouth, and still they were glad.`, `A child was born in the night: ${name}, to ${a.name} and ${b.name}. The others brought what food they could spare.`, `${name} was born to ${a.name} and ${b.name}. ${ex.births} born on the ash now.`]));
    }
  }
  // Breaking: pushed too far (one a night at most).
  const lowest = ex.people.filter((p) => !p.broken).map((p) => [p, moodOf(ex, p)] as const).sort((a, b) => a[1] - b[1])[0];
  if (lowest && lowest[1] < -65 && roll(ex) < 0.3) {
    const [p] = lowest;
    p.broken = true;
    remember(ex, p, 'broke under it all');
    const kind = roll(ex);
    if (kind < 0.4) note(ex, 6, `${p.name} walked out into the ash at dawn and wouldn't come back until dark.`);
    else if (kind < 0.75) {
      ex.dread = Math.min(100, (ex.dread ?? 0) + 3);
      note(ex, 6, `${p.name} stood screaming at the spear until their voice went. The others wouldn't look at it after.`);
    } else {
      const victim = pick(ex, ex.people.filter((q) => q !== p));
      if (victim) fight(ex, p, victim, `${p.name}, out of their mind with hunger, went for ${victim.name}`);
    }
  }
  // The devout preach, and the others pray harder; or doubt spreads.
  // (The devout keep the others praying whether or not it makes the Chronicle.)
  const devout = ex.people.filter((p) => p.quirk === 'devout' && !p.broken);
  if (devout.length && roll(ex) < 0.3) prayer += 1 + Math.min(2, devout.length * 0.2);
  const preacher = due(ex, 'preach', 5) ? devout.find(() => roll(ex) < 0.25) : undefined;
  if (preacher) {
    told(ex, 'preach');
    remember(ex, preacher, 'preached of the spear');
    note(ex, 3, pick(ex, [
      `${preacher.name} told them the spear had chosen them, and that it would not let them die. More knelt at it that night.`,
      `${preacher.name} said the miracles were the spear's answer, and that it wanted more of their prayers.`,
      `${preacher.name} began scratching marks into the spear's shaft, one for every day it had kept them alive.`,
      `${preacher.name} made the children say the names of the dead to the spear before they slept.`,
    ]));
  } else if (ex.people.some((p) => p.quirk === 'bitter') && (ex.dread ?? 0) > 50 && due(ex, 'doubt', 5) && roll(ex) < 0.2) {
    told(ex, 'doubt');
    const doubter = ex.people.find((p) => p.quirk === 'bitter')!;
    prayer -= 1;
    note(ex, 3, `${doubter.name} said aloud what some of them thought: that the spear did this to them.`);
  }
  // Stories by the fire, when there's a fire and enough to eat.
  if (fire && ex.ration >= 0.5 && due(ex, 'fire', 4) && roll(ex) < 0.3) {
    told(ex, 'fire');
    const old = ex.people.find((p) => p.trait === 'old') ?? pick(ex, ex.people);
    for (const p of ex.people) if (p.grief) p.grief = Math.max(0, p.grief - 1);
    note(ex, 3, pick(ex, [
      `By the fire, ${old.name} told of the green island before the spear, and the herd, and how far the grass went.`,
      `By the fire, ${old.name} sang something no one had taught them.`,
      `By the fire, they named the dead, one by one, so as not to forget them.`,
      `By the fire, ${old.name} drew the island in the ash with a stick, and where the spear had come down.`,
      `By the fire, the children played at being the spear, and for once the grown ones laughed.`,
      `By the fire, ${old.name} wondered aloud what lay past the sea. No one slept for a while.`,
    ]));
  }
  // Who they follow.
  const lead = leaderOf(ex);
  if (lead && lead.id !== ex.leader) {
    const had = ex.leader !== undefined;
    ex.leader = lead.id;
    note(ex, had ? 5 : 4, had ? `The others had begun to follow ${lead.name} now.` : `When there was something to decide, they looked to ${lead.name}.`);
  }
  return prayer;
}

const SYL = ['ka', 'ri', 'mo', 'tu', 'na', 'sa', 'ke', 'lo', 'vi', 'ra', 'en', 'ul', 'ha', 'po', 'mi', 'zu', 'ta', 'ne', 'ok', 'ya'];
function babyName(ex: ExtinctionState): string {
  for (let k = 0; k < 20; k++) {
    const n = pick(ex, SYL) + pick(ex, SYL);
    const name = n[0].toUpperCase() + n.slice(1);
    if (!ex.people.some((p) => p.name === name)) return name;
  }
  return 'Ash';
}
