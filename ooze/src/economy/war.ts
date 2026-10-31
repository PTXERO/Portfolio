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
import { boosts, DAY_SEC, foodCap, isAdult, killed, relation, shoreSeason, shoreWhen, woodCap, type ShoreState, type Village } from './shore';

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
/** What each of their fallen leaves behind. */
const LOOT_FOOD = 3;
const LOOT_WOOD = 2;
/** Seconds a round of blows takes (a fight's over in half a minute or so). */
const ROUND_SEC = 3;
/** The chief in the front line: that round they hit this much harder; and the chance they're
 * hurt doing it (then they walk slowly a few days). */
const CHIEF_HIT = 2.5;
const CHIEF_HURT = 0.3;
const HURT_DAYS = 3;
/** Behind the palisade: they fight this much harder again, and fewer of those who fall die; but
 * the fields outside are theirs to strip while it lasts. */
const WALLS = 0.5;
const FIELDS = 0.1;

export interface Battle {
  /** Which fight it was (when it began, in days): the one on screen live, or one to replay. */
  id: number;
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
  /** What their fallen left behind (raids on you). */
  loot?: { food: number; wood: number };
  led?: boolean;
  rallied?: boolean;
  /** Held behind the walls. */
  walls?: boolean;
  /** The round the chief stepped into the line, and whether they were hurt doing it. */
  chief?: number;
  hurt?: boolean;
  /** Fought at a vassal's village (its id); and how many came from elsewhere to help. */
  at?: number;
  helpers?: number;
  when: string;
}

/** How to meet a raid: stand and fight, hold behind the palisade, or pay them to go away. */
export type Stance = 'fight' | 'walls' | 'pay';

/** A fight going on now: a round every few seconds, till one side breaks. */
export interface Fight {
  id: number;
  village: number;
  /** At a vassal's village (its id), not the hearth; and who came to help, from where (-1: the
   * hearth). The fight's 'ours' is all of them. */
  at?: number;
  side?: { from: number; n: number }[];
  attack: 'us' | 'them';
  ours: number;
  theirs: number;
  /** Still standing. */
  x: number;
  y: number;
  /** What each fighter's worth on each side. */
  aEach: number;
  bEach: number;
  rounds: [number, number][];
  /** Seconds to the next round. */
  next: number;
  rallied?: boolean;
  led?: boolean;
  walls?: boolean;
  /** A strike timed well by the player: the next round's blows count this much more. */
  push?: number;
  /** The round the chief steps in (the next, once asked), and whether they were hurt. */
  chief?: number;
  hurt?: boolean;
}

export interface Raid {
  from: number;
  /** When they were seen watching, seen coming, and when they'll be here (days since landfall). */
  watched: number;
  seen?: number;
  arrives?: number;
  fighters: number;
  rallied?: boolean;
  /** How the chief means to meet them (unset: stand and fight). */
  stance?: Stance;
  /** Where they're headed: a vassal village (its id), or (unset) the hearth. */
  target?: number;
  /** Help on its way to whoever's attacked: from a vassal (its id) or the hearth (-1), how many,
   * and when it gets there. */
  allies?: Ally[];
  /** The chief's answer when a vassal's attacked: help sent, or none. */
  help?: 'send' | 'none';
}

export interface Ally {
  from: number;
  n: number;
  arrives: number;
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
  return Math.max(0, s.people.filter((p) => isAdult(s, p)).length - away(s));
}

/** How many of the hearth's are out helping a vassal (on their way, or fighting there). */
function helping(s: ShoreState): number {
  const fromHearth = (s.raid?.allies ?? []).filter((a) => a.from === -1).reduce((x, a) => x + a.n, 0);
  const inFight = (s.fight?.side ?? []).filter((a) => a.from === -1).reduce((x, a) => x + a.n, 0);
  return fromHearth + inFight;
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

/** A word on the odds, not a number. */
export function odds(us: number, them: number): string {
  const r = us / Math.max(0.1, them);
  return r > 1.8 ? 'They\'d be no match for us.' : r > 1.2 ? 'We\'re the stronger.' : r > 0.85 ? 'It could go either way.' : r > 0.55 ? 'They\'re the stronger.' : 'We\'d be cut to pieces.';
}

/** One round of blows. (The chief, stepping in, makes their side's round count for more.) */
function blows(s: ShoreState, f: Fight): void {
  const rand = rngFor(s, f.rounds.length + 7);
  const k = (f.chief === f.rounds.length ? CHIEF_HIT : 1) * (f.push ?? 1);
  f.push = undefined;
  const hitB = f.x * f.aEach * 0.18 * k * (0.75 + rand() * 0.5);
  const hitA = f.y * f.bEach * 0.18 * (0.75 + rand() * 0.5);
  f.x = Math.max(0, f.x - hitA);
  f.y = Math.max(0, f.y - hitB);
  f.rounds.push([Math.round(f.x), Math.round(f.y)]);
  if (k > 1 && rand() < CHIEF_HURT) {
    f.hurt = true;
    s.chiefHurt = today(s) + HURT_DAYS;
  }
}

/** Over: one side down to under half of what it started with, or eight rounds fought (the side
 * with fewer standing gives way). */
function over(f: Fight): boolean {
  return f.rounds.length >= 8 || f.x < f.ours * 0.5 || f.y < f.theirs * 0.5;
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

/** The war chief's rule for raiding while you're away. */
export type WarRule = 'off' | 'weaker' | 'ready';
/** Days the war chief rests the band between raids. */
const BAND_REST = 6;

/** Whether there's a war chief. */
export function hasWarChief(s: ShoreState): boolean {
  return s.built.some((b) => b.id === 'warcamp');
}

/** The war chief's raid, by the rule: half the grown against the weakest prey that fits it,
 * never short of food, never with raiders on the way, and with the band rested. */
function warChiefRaids(state: GameState, s: ShoreState): void {
  const rule = s.warRule ?? 'off';
  if (rule === 'off' || !hasWarChief(s) || s.warband || s.fight || s.raid || s.hungry > 0) return;
  if (today(s) - (s.lastBand ?? -99) < BAND_REST || s.food < Math.min(foodCap(s) * 0.4, s.people.length * 2)) return;
  // Not in winter (the fires need every hand); and enough kept home to hold off the strongest
  // that might come raiding while the band's away.
  if (shoreSeason(s).si === 3) return;
  const threat = Math.max(0, ...s.villages.filter((x) => hostile(s, x)).map((x) => theirStrength(x, raiders(x))));
  const home = Math.ceil((threat * 1.1) / Math.max(0.1, ourStrength(s, 1, true)));
  const n = Math.min(Math.floor(fighters(s) / 2), fighters(s) - home);
  if (n < 4) return;
  const need = rule === 'weaker' ? 1.5 : 0.95;
  const v = s.villages
    .filter((x) => raidable(s, x))
    .map((x) => ({ x, r: ourStrength(s, n, false) / Math.max(0.1, theirStrength(x, holders(x))) }))
    .filter((o) => o.r >= need)
    .sort((a, b) => b.r - a.r)[0]?.x;
  if (!v) return;
  if (sendBand(state, s, v.id, n, true)) record(state, `The war chief led ${n} out against ${v.name}, as ${rule === 'weaker' ? 'they had been told: only the weaker' : 'they had been told: whenever ready'}.`, 'shore', shoreWhen(s));
}

/** Each day: raids gathering, coming, arriving; the war band reaching where it's going. */
export function warDawn(state: GameState, s: ShoreState): void {
  const now = today(s);
  warChiefRaids(state, s);
  // A raid coming: seen watching, then seen coming, then here.
  const r = s.raid;
  if (r) {
    const v = s.villages.find((x) => x.id === r.from);
    if (!v || !hostile(s, v)) s.raid = undefined;
    else if (r.seen === undefined && now >= r.watched + 1) {
      r.seen = now;
      r.arrives = now + WARN_DAYS + boosts(s).warn;
      r.fighters = raiders(v);
      // (Everyone's rallied: spears out, the young behind the fire.)
      r.rallied = true;
      const at = raidTarget(s, r);
      // (Walking to a vassal takes them as long as it takes.)
      if (at.v) r.arrives = Math.max(r.arrives, now + walkDays(v, at) * 0.5);
      r.allies = vassalHelp(s, r, now);
      s.news.push(at.v ? `Raiders! ${cap(v.name)} are heading for ${at.v.name}.` : `Raiders! ${cap(v.name)} are coming.`);
      record(state, `${cap(v.name)} were seen coming, armed: about ${r.fighters} of them${at.v ? `, making for ${at.v.name}` : ''}.`, 'shore', shoreWhen(s));
      for (const a of r.allies) {
        const from = s.villages.find((x) => x.id === a.from);
        if (from) record(state, `${cap(from.name)} sent ${a.n} to help${at.v ? ` ${at.v.name}` : ' the hearth'}.`, 'shore', shoreWhen(s));
      }
      // (A vassal attacked, and a war chief: they send help if it'll get there in time.)
      if (at.v && hasWarChief(s) && canHelp(s)) answerHelp(state, s, true);
    }
  }
  // Someone new out there, watching: a raid's being thought of.
  if (!s.raid && now >= GRACE_DAYS && s.people.length >= GRACE_PEOPLE && now >= (s.nextRaid ?? 0)) {
    const hearth = s.hearth;
    const them = s.villages.filter((v) => hostile(s, v)).sort((a, b) => Math.hypot(a.x - hearth.x, a.y - hearth.y) - Math.hypot(b.x - hearth.x, b.y - hearth.y));
    const rand = rngFor(s, 1);
    // The nearest that think they'd win (they don't raid a fight they'd lose).
    // (Bolder in winter, when they're hungry too; and bolder against a village that's paid them.)
    const bold = (x: Village) => (shoreSeason(s).si === 3 ? 0.85 : 1) * (1 - 0.12 * Math.min(3, x.paid ?? 0));
    const v = them.find((x) => theirStrength(x, raiders(x)) > ourStrength(s, fighters(s), true) * 0.45 * bold(x) * (0.8 + rand() * 0.4));
    s.nextRaid = now + RAID_GAP * (0.7 + rand() * 0.6);
    // (Or one of your vassals: the weakest near enough, sometimes, if it's weaker than the hearth.)
    const raider = v ?? them[0];
    const soft = raider && s.villages.filter((x) => x.vassal && !x.gone && !x.joined && Math.hypot(x.x - raider.x, x.y - raider.y) < 400).sort((a, b) => a.pop - b.pop)[0];
    const atVassal = !!soft && rand() < 0.35 && theirStrength(raider, raiders(raider)) > theirStrength(soft, holders(soft)) * 0.6;
    if (v || atVassal) {
      s.raid = { from: raider.id, watched: now, fighters: raiders(raider), target: atVassal ? soft!.id : undefined };
      if (!atVassal) {
        s.news.push('Someone was seen watching from the trees.');
        record(state, `Strangers were seen watching the village from the trees${raider.found ? `: ${raider.name}, by the look of them` : ''}.`, 'shore', shoreWhen(s));
      }
    }
  }
}

/** Through the day: raids arriving, the war band arriving, and a fight going on, a round at a
 * time. */
export function stepWar(state: GameState, s: ShoreState, dt: number): void {
  const now = today(s);
  // (Those who ran home get there; what the fallen left is gathered up.)
  if (s.retreat && now >= s.retreat.arrives) s.retreat = undefined;
  if (s.loot && now >= s.loot.until) s.loot = undefined;
  const f = s.fight;
  if (f) {
    f.next -= dt;
    while (s.fight && f.next <= 0) {
      f.next += ROUND_SEC;
      blows(s, f);
      if (over(f)) finish(state, s, f);
    }
    return;
  }
  const r = s.raid;
  if (r?.arrives !== undefined && now >= r.arrives) {
    s.raid = undefined;
    const v = s.villages.find((x) => x.id === r.from);
    if (v && hostile(s, v)) meet(state, s, v, r);
    return;
  }
  const w = s.warband;
  if (w && now >= w.arrives) {
    s.warband = undefined;
    const v = s.villages.find((x) => x.id === w.to);
    if (!v || !raidable(s, v)) {
      record(state, 'The war band found no one to fight, and came home.', 'shore', shoreWhen(s));
      return;
    }
    const led = chiefLeads(s, v);
    s.fight = { id: now, village: v.id, attack: 'us', ours: w.fighters, theirs: holders(v), x: w.fighters, y: holders(v), aEach: ourStrength(s, 1, false, led ? LEAD : 0), bEach: theirStrength(v, 1), rounds: [], next: ROUND_SEC, led };
    s.news.push(`The war band falls on ${v.name}!`);
  }
}

/** What paying them off would cost (more each time: they learn you pay). */
export function payCost(v: Village, n: number): { food: number; wood: number } {
  const k = 1.5 ** (v.paid ?? 0);
  return { food: Math.ceil(n * 3 * k), wood: Math.ceil(n * 2 * k) };
}

/** Whether the palisade's there to hold behind. */
export function hasWalls(s: ShoreState): boolean {
  return s.built.some((b) => b.id === 'palisade');
}

/** The raiders are here: met as the chief said (paid, if there's still the food and wood for it;
 * else fought, from behind the walls if there are walls and that's what was said). */
function meet(state: GameState, s: ShoreState, v: Village, r: Raid): void {
  const now = today(s);
  // Whoever's come to help, and got there in time.
  const came = (r.allies ?? []).filter((a) => a.arrives <= now + 1e-6);
  const allyStrength = (a: { from: number; n: number }) => {
    const from = s.villages.find((x) => x.id === a.from);
    return a.from === -1 ? ourStrength(s, a.n, false) : from ? theirStrength(from, a.n) : 0;
  };
  const at = raidTarget(s, r);
  if (at.v) {
    // At the vassal's village: its own hold it, with whoever came.
    const own = holders(at.v);
    const side = [{ from: at.v.id, n: own }, ...came.map((a) => ({ from: a.from, n: a.n }))];
    const n = side.reduce((x, a) => x + a.n, 0);
    const str = side.reduce((x, a) => x + (a.from === at.v!.id ? theirStrength(at.v!, a.n) : allyStrength(a)), 0);
    s.fight = { id: now, village: v.id, at: at.v.id, side, attack: 'them', ours: n, theirs: r.fighters, x: n, y: r.fighters, aEach: str / Math.max(1, n), bEach: theirStrength(v, 1), rounds: [], next: ROUND_SEC };
    s.news.push(`${cap(v.name)} fall on ${at.v.name}!`);
    return;
  }
  const cost = payCost(v, r.fighters);
  if (r.stance === 'pay' && s.food >= cost.food && s.wood >= cost.wood) {
    s.food -= cost.food;
    s.wood -= cost.wood;
    v.paid = (v.paid ?? 0) + 1;
    // (They'll be back the sooner for it.)
    s.nextRaid = Math.min(s.nextRaid ?? now, now + RAID_GAP * 0.5);
    s.raids = (s.raids ?? 0) + 1;
    s.news.push(`${cap(v.name)} took the tribute, and went away.`);
    record(state, `${cap(v.name)} came, and were paid ${cost.food} food and ${cost.wood} wood to go away. They went.`, 'shore', shoreWhen(s));
    return;
  }
  // (Left unsaid, the war chief rallies them, and holds the palisade if there is one.)
  if (r.stance === undefined && hasWarChief(s)) {
    r.rallied = true;
    if (hasWalls(s)) r.stance = 'walls';
  }
  const walls = r.stance === 'walls' && hasWalls(s);
  if (walls) {
    const fields = Math.floor(s.food * FIELDS);
    s.food -= fields;
  }
  const own = fighters(s);
  const side = [{ from: -1, n: own }, ...came.map((a) => ({ from: a.from, n: a.n }))];
  const n = side.reduce((x, a) => x + a.n, 0);
  const ownEach = ourStrength(s, 1, true, (r.rallied ? RALLY : 0) + (walls ? WALLS : 0));
  const str = own * ownEach + came.reduce((x, a) => x + allyStrength(a), 0);
  s.fight = { id: now, village: v.id, side: came.length ? side : undefined, attack: 'them', ours: n, theirs: r.fighters, x: n, y: r.fighters, aEach: str / Math.max(1, n), bEach: theirStrength(v, 1), rounds: [], next: ROUND_SEC, rallied: r.rallied, walls };
  s.news.push(`${cap(v.name)} fall on the village!`);
}

/** Whether the chief's there to lead (with the war band at their village, or at home). */
export function chiefLeads(s: ShoreState, v: Village): boolean {
  return Math.hypot(s.chiefAt.x - v.x, s.chiefAt.y - v.y) < 14;
}
export function chiefHome(s: ShoreState): boolean {
  return Math.hypot(s.chiefAt.x - s.hearth.x, s.chiefAt.y - s.hearth.y) < 24;
}

/** Whether the chief can step into the line now (there, and not done it yet this fight). */
export function canStepIn(s: ShoreState): boolean {
  const f = s.fight;
  if (!f || f.chief !== undefined) return false;
  const v = s.villages.find((x) => x.id === f.village);
  const at = f.at !== undefined ? s.villages.find((x) => x.id === f.at) : undefined;
  return at ? chiefLeads(s, at) : f.attack === 'them' ? chiefHome(s) : !!v && chiefLeads(s, v);
}

/** A strike, timed (0 to 1, how near the mark): the next round's blows count up to twice as much.
 * One a round. Returns the strength it gives (0 if there's no fight, or a strike's waiting). */
export function strike(s: ShoreState, quality: number): number {
  const f = s.fight;
  if (!f || f.push !== undefined) return 0;
  f.push = 1 + Math.max(0, Math.min(1, quality));
  return f.push;
}

/** The chief steps into the front line: the next round is theirs. */
export function stepIn(s: ShoreState): boolean {
  if (!canStepIn(s)) return false;
  s.fight!.chief = s.fight!.rounds.length;
  return true;
}

/** A fight over: the dead buried, what was taken taken, and the Chronicle told. */
function finish(state: GameState, s: ShoreState, f: Fight): void {
  s.fight = undefined;
  const v = s.villages.find((x) => x.id === f.village);
  if (!v) return;
  const won = f.x / f.ours >= f.y / f.theirs;
  const fell = f.ours - Math.round(f.x);
  const theirDead = f.theirs - Math.round(f.y);
  const home = f.attack === 'them';
  // Of ours who fell, a third die (a sixth, behind walls); the rest are hurt, and mend. With
  // others fighting alongside, each loses its share.
  const side = f.side ?? [{ from: -1, n: f.ours }];
  const mine = side.filter((a) => a.from === -1).reduce((x, a) => x + a.n, 0);
  const dead = mine ? bury(state, s, Math.round(((fell * mine) / Math.max(1, f.ours)) / (f.walls ? 6 : 3)), home) : 0;
  for (const a of side) {
    if (a.from === -1) continue;
    const ally = s.villages.find((x) => x.id === a.from);
    if (ally) ally.pop = Math.max(1, ally.pop - Math.round(((fell * a.n) / Math.max(1, f.ours)) / 3));
  }
  v.pop = Math.max(0, v.pop - Math.round(theirDead * 0.6));
  const at = f.at !== undefined ? s.villages.find((x) => x.id === f.at) : undefined;
  const helpers = side.filter((a) => a.from !== (at ? at.id : -1)).reduce((x, a) => x + a.n, 0);
  if (at?.vassal) {
    // At a vassal's: won or lost there. Help from the hearth is remembered (and so is none).
    const sent = mine > 0;
    const dist = Math.hypot(v.x - at.x, v.y - at.y);
    const fled = Math.round(f.y);
    if (fled > 0) s.retreat = { from: v.id, n: fled, left: today(s), arrives: today(s) + dist / (BAND_SPEED * 1.6) / DAY_SEC, sx: at.x, sy: at.y };
    if (won) {
      v.beaten = (v.beaten ?? 0) + 1;
      at.vassal.loyalty = Math.min(100, at.vassal.loyalty + (sent ? 12 : 3));
    } else {
      at.pop = Math.max(2, at.pop * 0.85);
      at.vassal.loyalty = Math.max(0, at.vassal.loyalty - (sent ? 5 : 15));
    }
    s.news.push(won ? `${cap(at.name)} drove off ${v.name}.` : `${cap(v.name)} broke into ${at.name}.`);
    record(state, `${cap(v.name)} fell on ${at.name}${won ? ', and were driven off' : ' and broke through'}.${helpers ? ` ${helpers} had come to help them${sent ? ', some from the hearth' : ''}.` : ' No one came to help them.'}${dead ? ` ${dead} of ours died there.` : ''}`, 'shore', shoreWhen(s));
    (s.battles ??= []).push({ id: f.id, village: v.id, attack: 'them', ours: f.ours, theirs: f.theirs, rounds: f.rounds, won, dead, theirDead, at: at.id, helpers, when: shoreWhen(s) });
    flee(state, s, v);
    s.raids = (s.raids ?? 0) + 1;
    return;
  }
  const b: Battle = { id: f.id, village: v.id, attack: f.attack, ours: f.ours, theirs: f.theirs, rounds: f.rounds, won, dead, theirDead, rallied: f.rallied, led: f.led, walls: f.walls, chief: f.chief, hurt: f.hurt, helpers: helpers || undefined, when: shoreWhen(s) };
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  const front = f.chief !== undefined ? ` ${chief} fought in the front line${f.hurt ? ', and was hurt' : ''}.` : '';
  if (home) {
    // Their survivors run for home; their fallen leave behind what they carried (none fallen,
    // nothing left).
    const fled = Math.round(f.y);
    const dist = Math.hypot(v.x - s.hearth.x, v.y - s.hearth.y);
    if (fled > 0) s.retreat = { from: v.id, n: fled, left: today(s), arrives: today(s) + dist / (BAND_SPEED * 1.6) / DAY_SEC, sx: s.hearth.x, sy: s.hearth.y };
    const fallen = Math.max(0, Math.round(theirDead));
    if (fallen > 0) {
      const food = Math.min(fallen * LOOT_FOOD, Math.max(0, Math.floor(foodCap(s) - s.food)));
      const wood = Math.min(fallen * LOOT_WOOD, Math.max(0, Math.floor(woodCap(s) - s.wood)));
      s.food += food;
      s.wood += wood;
      b.loot = { food, wood };
      const k = Math.min(1, 6 / Math.max(1, dist));
      s.loot = { x: s.hearth.x + (v.x - s.hearth.x) * k, y: s.hearth.y + (v.y - s.hearth.y) * k, n: Math.min(6, fallen), until: today(s) + 2 };
    }
    if (won) {
      v.beaten = (v.beaten ?? 0) + 1;
      s.news.push(`${cap(v.name)} were driven off.`);
      record(state, `${cap(v.name)} fell on the village${f.walls ? ', and broke on the palisade' : ', and were driven off'}.${front}${dead ? ` ${dead} of ours died in the fighting.` : ''}${b.loot ? ` Their fallen left behind ${b.loot.food} food and ${b.loot.wood} wood.` : ''}${v.beaten >= COWED ? ' They will not come again.' : ''}`, 'shore', shoreWhen(s));
    } else {
      const food = Math.floor(s.food * 0.25);
      const wood = Math.floor(s.wood * 0.25);
      s.food -= food;
      s.wood -= wood;
      b.took = { food, wood };
      s.news.push(`${cap(v.name)} broke through, and took what they could carry.`);
      record(state, `${cap(v.name)} fell on the village and broke through. ${food || wood ? `They carried off ${food} food and ${wood} wood.` : 'They found nothing to carry off.'}${front}${dead ? ` ${dead} of ours died.` : ''}`, 'shore', shoreWhen(s));
    }
    flee(state, s, v);
    s.raids = (s.raids ?? 0) + 1;
  } else if (won) {
    const food = Math.min(Math.round(v.pop * 2), Math.max(0, foodCap(s) - s.food));
    const wood = Math.min(Math.round(v.pop), Math.max(0, woodCap(s) - s.wood));
    s.food += food;
    s.wood += wood;
    b.took = { food, wood };
    if (v.pop >= 4) {
      // Theirs now: they work their land for you, grudgingly at first.
      v.vassal = { tax: 0.25, loyalty: 45, conquered: today(s) };
      s.news.push(`${cap(v.name)} are beaten. Their village is yours.`);
      record(state, `The war band fell on ${v.name}${f.led ? ', the chief at its head,' : ''} and beat them. Their village pays tribute to the hearth now.${front}${dead ? ` ${dead} of ours died.` : ''}`, 'shore', shoreWhen(s));
    } else flee(state, s, v);
  } else {
    s.news.push(`The war band was beaten at ${v.name}.`);
    record(state, `The war band fell on ${v.name}${f.led ? ', the chief at its head,' : ''} and was beaten back.${front}${dead ? ` ${dead} of ours died.` : ''}`, 'shore', shoreWhen(s));
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
export function sendBand(state: GameState, s: ShoreState, id: number, n: number, byWarChief = false): boolean {
  const v = s.villages.find((x) => x.id === id);
  if (!v || !raidable(s, v) || s.warband || n < 2 || n > fighters(s)) return false;
  const d = Math.hypot(v.x - s.hearth.x, v.y - s.hearth.y) * 1.3;
  const now = today(s);
  s.warband = { to: id, fighters: n, left: now, arrives: now + d / BAND_SPEED / DAY_SEC };
  s.lastBand = now;
  s.news.push(`The war band set out for ${v.name}.`);
  if (byWarChief) return true;
  const chief = s.people.find((p) => p.id === s.chief)?.name ?? 'The chief';
  record(state, `${chief} sent ${n} out against ${v.name}.`, 'shore', shoreWhen(s));
  return true;
}

/** How the chief means to meet the raid coming. */
export function setWarRule(s: ShoreState, rule: WarRule): void {
  if (hasWarChief(s)) s.warRule = rule;
}

export function setStance(s: ShoreState, stance: Stance): boolean {
  if (s.raid?.seen === undefined) return false;
  if (stance === 'walls' && !hasWalls(s)) return false;
  s.raid.stance = stance;
  return true;
}

/** Rallying the defenders before the raiders arrive (once, while you're there). */
export function rally(s: ShoreState): boolean {
  if (s.raid?.seen === undefined || s.raid.rallied) return false;
  s.raid.rallied = true;
  return true;
}

/** Fighters on the war band don't work while away. */
export function away(s: ShoreState): number {
  return (s.warband?.fighters ?? 0) + helping(s);
}

/** Where a raid's headed: the vassal's village, or the hearth. */
export function raidTarget(s: ShoreState, r: Raid): { x: number; y: number; v?: Village } {
  const v = r.target !== undefined ? s.villages.find((x) => x.id === r.target && x.vassal && !x.gone) : undefined;
  return v ? { x: v.x, y: v.y, v } : { x: s.hearth.x, y: s.hearth.y };
}

/** Days for a band to walk from one place to another. */
function walkDays(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (Math.hypot(a.x - b.x, a.y - b.y) * 1.3) / BAND_SPEED / DAY_SEC;
}

/** Help a loyal vassal can send: a quarter of them, if it's loyal enough and near enough to get
 * there before the raiders do. */
const ALLY_LOYALTY = 50;
function vassalHelp(s: ShoreState, r: Raid, now: number): Ally[] {
  const at = raidTarget(s, r);
  const out: Ally[] = [];
  for (const v of s.villages) {
    if (!v.vassal || v.gone || v.joined || v.id === r.target || v.vassal.loyalty < ALLY_LOYALTY) continue;
    const arrives = now + walkDays(v, at);
    const n = Math.floor(v.pop * 0.25);
    if (n >= 1 && arrives <= (r.arrives ?? now)) out.push({ from: v.id, n, arrives });
  }
  return out;
}

/** Whether the hearth can still get help to the vassal being raided in time (and hasn't said). */
export function canHelp(s: ShoreState): boolean {
  const r = s.raid;
  if (!r || r.seen === undefined || r.target === undefined || r.help) return false;
  const at = raidTarget(s, r);
  return !!at.v && today(s) + walkDays(s.hearth, at) <= (r.arrives ?? 0) && helpSize(s) >= 2;
}
export function helpSize(s: ShoreState): number {
  return Math.max(0, Math.floor(fighters(s) / 3));
}

/** The chief's answer: send a third of the fighters to the vassal being raided, or leave them. */
export function answerHelp(state: GameState, s: ShoreState, send: boolean): boolean {
  const r = s.raid;
  if (!r || r.target === undefined || r.help) return false;
  const at = raidTarget(s, r);
  if (!at.v) return false;
  if (!send) {
    r.help = 'none';
    record(state, `No help was sent to ${at.v.name}.`, 'shore', shoreWhen(s));
    return true;
  }
  if (!canHelp(s)) return false;
  const n = helpSize(s);
  r.help = 'send';
  (r.allies ??= []).push({ from: -1, n, arrives: today(s) + walkDays(s.hearth, at) });
  s.news.push(`${n} set out to help ${at.v.name}.`);
  record(state, `${n} set out from the hearth to help ${at.v.name} against the raiders.`, 'shore', shoreWhen(s));
  return true;
}

