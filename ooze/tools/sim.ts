// Headless balance simulator: plays the economy with scripted player types and
// prints how long each stage takes, against the design doc's targets.
// Run with: npm run sim

import { STAGES, STAGE_ORDER } from '../src/content/stages';
import {
  buyGenerator,
  buyUpgrade,
  canEvolve,
  checkReaction,
  engulfable,
  engulf,
  evolve,
  forage,
  habitatUnlocked,
  finalReaction,
  generatorCost,
  generatorVisible,
  goalProgress,
  reactionReady,
  reactions,
  payStage,
  tap,
  triggerFinale,
  upgradeCost,
  visibleUpgrades,
} from '../src/economy/actions';
import { formatTime } from '../src/economy/num';
import { dialMax, spawnMult, stageRate, tapValue } from '../src/economy/rates';
import { cloneState, createState } from '../src/economy/state';
import { birthRate, breed, buyPart, canWear, equipPart, housing, partDef, placeOpen, startTrip, statsOf, tripChance, upkeep } from '../src/economy/creature';
import { EVENTS } from '../src/content/creature';
import { herdMult } from '../src/economy/rates';
import { tick } from '../src/economy/tick';
import { DIALS, SLOTS, type DialId, type GameState, type ReactionDef, type StageId } from '../src/economy/types';

interface Strategy {
  name: string;
  /** Seconds between visits where the player spends. */
  checkEvery: number;
  tapsPerSec: number;
}

export const STRATEGIES: Strategy[] = [
  { name: 'active (taps 4/s)', checkEvery: 1, tapsPerSec: 4 },
  { name: 'engaged (30 s visits)', checkEvery: 30, tapsPerSec: 0 },
  { name: 'casual (5 min visits)', checkEvery: 300, tapsPerSec: 0 },
  { name: 'idle (30 min visits)', checkEvery: 1800, tapsPerSec: 0 },
];

/** Target seconds per stage for an engaged player (design doc, First run table). */
const TARGETS: Record<StageId, [number, number]> = {
  soup: [50 * 60, 70 * 60],
  cell: [120 * 60, 180 * 60],
  creature: [240 * 60, 360 * 60],
};

const LIMIT_SEC = 48 * 3600;

function effectiveRate(s: GameState, tapsPerSec: number): number {
  return stageRate(s, s.current).toNumber() + tapsPerSec * tapValue(s).toNumber();
}

type Option = { cost: number; gain: number; apply: (s: GameState) => boolean };

function options(s: GameState, tapsPerSec: number): Option[] {
  const stage = s.current;
  const base = effectiveRate(s, tapsPerSec);
  const out: Option[] = [];
  for (const g of STAGES[stage].generators) {
    if (!generatorVisible(s, stage, g)) continue;
    const apply = (x: GameState) => buyGenerator(x, stage, g.id, 1);
    const trial = cloneState(s);
    trial.stages[stage].generators[g.id] += 1;
    out.push({ cost: generatorCost(s, stage, g.id).toNumber(), gain: effectiveRate(trial, tapsPerSec) - base, apply });
  }
  for (const u of visibleUpgrades(s, stage)) {
    if (payStage(stage, u) !== stage) continue;
    const trial = cloneState(s);
    trial.stages[stage].currency = trial.stages[stage].currency.add(upgradeCost(s, stage, u));
    buyUpgrade(trial, stage, u.id);
    out.push({ cost: upgradeCost(s, stage, u).toNumber(), gain: effectiveRate(trial, tapsPerSec) - base, apply: (x) => buyUpgrade(x, stage, u.id) });
  }
  return out.filter((o) => o.gain > 0);
}

/** Every dial setting allowed right now, optionally limited to a reaction's ranges. */
function dialSettings(s: GameState, r?: ReactionDef): Record<DialId, number>[] {
  const stage = s.current;
  let out: Record<DialId, number>[] = [{ heat: 0, light: 0, charge: 0 }];
  for (const d of DIALS) {
    const max = dialMax(s, stage, d);
    const [lo, hi] = r?.needs.dials?.[d] ?? [0, 3];
    const next: Record<DialId, number>[] = [];
    for (const base of out) for (let v = lo; v <= Math.min(hi, max); v++) next.push({ ...base, [d]: v });
    out = next;
  }
  return out;
}

/** Sets the dials to the most productive setting (within a reaction's ranges, if given). */
function tuneDials(s: GameState, r?: ReactionDef): boolean {
  const st = s.stages[s.current];
  let best: Record<DialId, number> | null = null;
  let bestRate = -1;
  for (const d of dialSettings(s, r)) {
    st.dials = d;
    const rate = stageRate(s, s.current).toNumber();
    if (rate > bestRate) {
      bestRate = rate;
      best = d;
    }
  }
  if (best) st.dials = best;
  return !!best;
}

/** Points the dials (and a quick whirl) at the next reaction the molecules are ready for. */
function chaseReaction(s: GameState): ReactionDef | null {
  const st = s.stages[s.current];
  for (const r of reactions(s.current)) {
    if (st.discovered.includes(r.id) || !checkReaction(s, s.current, r).gens) continue;
    if (r.final) return r;
    if (!tuneDials(s, r)) continue;
    if (r.needs.swirl) s.swirl = Math.max(s.swirl, r.needs.swirl + 0.05);
    return r;
  }
  tuneDials(s);
  return null;
}

/** One visit: chase reactions, buy unlocks, then the best-payback items, saving for the finale when it's close. */
function visit(s: GameState, tapsPerSec: number, now = 0): void {
  const stage = s.current;
  const fin = finalReaction(stage);
  for (let i = 0; i < 2000; i++) {
    if (canEvolve(s)) {
      evolve(s);
      return;
    }
    if (fin && checkReaction(s, s.current, fin).gens && tuneDials(s, fin)) {
      s.swirl = 1;
      if (reactionReady(s, s.current, fin) && triggerFinale(s)) continue;
    }
    const st = s.stages[s.current];
    const money = st.currency.toNumber();
    // Unlocks (dials, the whirlpool, mutations) have no simple payback; players buy them when they can.
    // (Endless upgrades aren't unlocks: the Creature's training is bought separately.)
    const own = visibleUpgrades(s, s.current).filter((u) => payStage(s.current, u) === s.current && u.levels !== Infinity);
    const price = (u: (typeof own)[number]) => upgradeCost(s, s.current, u).toNumber();
    const unlock = own.find((u) => (u.effect.kind === 'dialMax' || u.effect.kind === 'swirlMult' || !!u.branch) && price(u) <= money);
    if (unlock) {
      buyUpgrade(s, s.current, unlock.id);
      continue;
    }
    // Something new to grow: players try one as soon as they can afford it.
    const fresh = STAGES[s.current].generators.find(
      (g) => st.generators[g.id] === 0 && generatorVisible(s, s.current, g) && generatorCost(s, s.current, g.id).toNumber() <= money,
    );
    if (fresh) {
      buyGenerator(s, s.current, fresh.id, 1);
      continue;
    }
    const rate = effectiveRate(s, tapsPerSec);
    // Boosts that cost under a minute of income get bought on sight, whatever their payback.
    const cheap = own.find((u) => price(u) <= money && price(u) <= rate * 60);
    if (cheap) {
      buyUpgrade(s, s.current, cheap.id);
      continue;
    }
    // Save for the finale once it's in reach, otherwise for the next mutation (players save for what they want).
    const nextMutation = own.filter((u) => !!u.branch).reduce((m, u) => Math.min(m, price(u)), Infinity);
    const goal = fin ? (checkReaction(s, s.current, fin).gens ? fin.cost ?? 0 : nextMutation) : STAGES[s.current].goal;
    const toGoal = (goal - money) / Math.max(rate, 1e-9);
    const affordable = options(s, tapsPerSec)
      .filter((o) => o.cost <= money)
      .sort((a, b) => a.cost / a.gain - b.cost / b.gain);
    const best = affordable[0];
    if (!best || best.cost / best.gain > toGoal) break;
    best.apply(s);
  }
  if (s.current === stage && STAGES[stage].places) creatureVisit(s);
  if (s.current === stage && STAGES[stage].habitats) cellVisit(s, now);
  else if (s.current === stage && fin) chaseReaction(s);
  spendPast(s);
}

/**
 * Engaged players go back to earlier stages too: they buy heirlooms with the old
 * currency, then grow the old stage with what's left (which feeds the new one).
 */
function spendPast(s: GameState): void {
  const now = s.current;
  for (const past of s.unlocked) {
    if (past === now || !s.stages[past].complete) continue;
    const wallet = s.stages[past];
    const heirlooms = visibleUpgrades(s, now).filter((u) => u.pay === past);
    for (let i = 0; i < 50; i++) {
      const u = heirlooms.filter((x) => visibleUpgrades(s, now).includes(x)).sort((a, b) => upgradeCost(s, now, a).cmp(upgradeCost(s, now, b)))[0];
      if (!u || !buyUpgrade(s, now, u.id)) break;
    }
    // Half of what's left goes into growing the old stage, best payback first.
    const floor = wallet.currency.toNumber() / 2;
    const gens = STAGES[past].generators.filter((g) => wallet.generators[g.id] > 0);
    for (let k = 0; k < 300; k++) {
      const base = stageRate(s, past).toNumber();
      let best: { id: string; score: number } | null = null;
      for (const g of gens) {
        const cost = generatorCost(s, past, g.id).toNumber();
        if (wallet.currency.toNumber() - cost < floor) continue;
        const trial = cloneState(s);
        trial.stages[past].generators[g.id] += 1;
        const score = cost / Math.max(1e-9, stageRate(trial, past).toNumber() - base);
        if (!best || score < best.score) best = { id: g.id, score };
      }
      const bought = !!best && buyGenerator(s, past, best.id, 1);
      if (!bought) break;
    }
  }
}

/**
 * Creature stage: wear the best parts for the next place, train what's short,
 * breed whenever there's a mate, and keep the creature out exploring: the next
 * new place once it's safe enough, otherwise the best-paying safe one.
 */
function creatureVisit(s: GameState): void {
  const st = s.stages.creature;
  const def = STAGES.creature;
  const next = def.places!.find((p) => !(st.trips[p.id] > 0) && placeOpen(s, p));
  const want = (k: string) => 1 + (next?.needs[k as keyof typeof next.needs] ? 3 : 0);
  // Buy shop parts as they become affordable (cheapest first), then wear the best in each slot.
  for (const p of def.parts!.filter((x) => x.cost && !st.parts.includes(x.id)).sort((a, b) => a.cost! - b.cost!)) {
    if (st.currency.toNumber() >= p.cost! * 2) buyPart(s, p.id);
  }
  // Grow a bigger heart while a better part is waiting that the body can't power.
  const heart = def.upgrades.find((u) => u.id === 'bigHeart')!;
  const income = stageRate(s, 'creature').toNumber();
  for (let i = 0; i < 20; i++) {
    const blocked = SLOTS.some((slot) => {
      const score = (id: string) => Object.entries(partDef(id).stats).reduce((n, [k, v]) => n + (v ?? 0) * want(k), 0);
      const best = st.parts.filter((id) => partDef(id).slot === slot).sort((a, b) => score(b) - score(a))[0];
      return best && st.equipped[slot] !== best && !canWear(s, best);
    });
    if (!blocked || upgradeCost(s, 'creature', heart).toNumber() > income * 300 || !buyUpgrade(s, 'creature', heart.id)) break;
  }
  // Wear the best part per slot that fits the energy budget (big slots first).
  for (const slot of SLOTS) {
    const score = (id: string) => Object.entries(partDef(id).stats).reduce((n, [k, v]) => n + (v ?? 0) * want(k), 0);
    const best = st.parts.filter((id) => partDef(id).slot === slot && canWear(s, id)).sort((a, b) => score(b) - score(a))[0];
    if (best) equipPart(s, best);
  }
  herdVisit(s);
  // Train the stats the next place needs, while it costs under a few minutes of output.
  const rate = stageRate(s, 'creature').toNumber();
  for (let i = 0; i < 50 && next; i++) {
    const stats = statsOf(s);
    const short = Object.entries(next.needs).find(([k, n]) => stats[k as keyof typeof stats] < (n ?? 0));
    if (!short) break;
    const u = def.upgrades.find((x) => x.effect.kind === 'stat' && x.effect.stat === short[0] && x.levels === Infinity)!;
    const cost = upgradeCost(s, 'creature', u).toNumber();
    if (cost > rate * 300 || !buyUpgrade(s, 'creature', u.id)) break;
  }
  if (!st.egg && st.mates.length) breed(s, st.mates[0].id);
  if (!st.trip) {
    if (next && tripChance(s, next) >= 0.75) startTrip(s, next.id);
    else {
      // Short trips while a mate is wanted (more chances to meet one), long ones otherwise.
      const wantMate = !st.egg && !st.mates.length;
      const safe = def.places!.filter((p) => placeOpen(s, p) && tripChance(s, p) >= 0.9);
      const best = safe.sort((a, b) => (wantMate ? a.minutes - b.minutes : b.minutes - a.minutes))[0];
      if (best) startTrip(s, best.id);
    }
  }
  // Answer the trip's event with the first option whose check passes (the player sees the numbers).
  const ev = st.trip?.event;
  if (ev && ev.choice === null) {
    const stats = statsOf(s);
    const d = EVENTS.find((e) => e.id === ev.id)!;
    const i = d.options.findIndex((o) => o.stat && stats[o.stat] >= (o.need ?? 0));
    ev.choice = i >= 0 ? i : d.options.length - 1;
  }
  s.reports = [];
}

/**
 * The herd: places to live by payback, keeping a winter's food in store.
 * (Instincts are upgrades, bought in the main loop like any boost.)
 */
function herdVisit(s: GameState): void {
  const st = s.stages.creature;
  const pop = Math.floor(st.pop);
  const room = housing(s);
  // Each room filled forages about this much, net of eating, over a year.
  const perHead = herdMult(s) * 0.44;
  const reserve = () => upkeep(s) * 1.4 * 150;
  for (let i = 0; i < 200; i++) {
    const money = st.currency.toNumber() - reserve();
    const g = st.generators;
    const cands: { id: string; cost: number; payback: number }[] = [];
    for (const def of STAGES.creature.generators) {
      if (!generatorVisible(s, 'creature', def)) continue;
      const cost = generatorCost(s, 'creature', def.id).toNumber();
      let gain = 0;
      const rooms = { burrow: 3, den: 15, territory: 50 }[def.id as 'burrow'];
      if (rooms) gain = rooms * perHead * (pop >= room - 2 ? 1 : 0.2);
      else if (def.id === 'nest') gain = pop < room ? ((0.04 * (room - pop)) / Math.max(0.05, birthRate(s))) * 0.02 * perHead : 0;
      else if (def.id === 'waterhole' && g.waterhole < 12) gain = upkeep(s) * 0.04;
      if (def.id === 'territory') gain += stageRate(s, 'creature').toNumber() * 0.02;
      if (gain > 0) cands.push({ id: def.id, cost, payback: cost / gain });
    }
    const best = cands.filter((c) => c.cost <= money).sort((a, b) => a.payback - b.payback)[0];
    if (!best || best.payback > 1200 || !buyGenerator(s, 'creature', best.id, 1)) break;
  }
}

/** When each simulated game last caught a rare microbe. */
const lastCatch = new WeakMap<GameState, number>();
/** Seconds per rare microbe caught: one turns up every ~55 s, and chasing it takes a while. */
const CATCH_SEC = 75;

/**
 * Cell stage: catch a rare microbe if one is about (one per CATCH_SEC, more with
 * a chemoreceptor), then decide where to live: where a microbe is about, else
 * where an organelle is waiting on the lineage to settle in, else where output is best.
 */
function cellVisit(s: GameState, t: number): void {
  const id = s.current;
  const st = s.stages[id];
  const habitats = (STAGES[id].habitats ?? []).filter((h) => habitatUnlocked(s, id, h));
  const findableIn = (h: string) => {
    const was = st.habitat;
    st.habitat = h;
    const out = engulfable(s, id);
    st.habitat = was;
    return out;
  };
  const due = (lastCatch.get(s) ?? -Infinity) + CATCH_SEC / spawnMult(s, id) <= t;
  const huntHere = habitats.find((h) => findableIn(h.id).length);
  if (huntHere && due) {
    st.habitat = huntHere.id;
    engulf(s, id, findableIn(huntHere.id)[0].id);
    lastCatch.set(s, t);
  }
  const waiting = reactions(id).find((r) => {
    if (!r.manual || !r.needs.habitat || st.discovered.includes(r.id)) return false;
    const was = st.habitat;
    st.habitat = r.needs.habitat;
    const missing = checkReaction(s, id, r).parts.filter((p) => !p.ok);
    st.habitat = was;
    return missing.length > 0 && missing.every((p) => p.label.startsWith('Settled'));
  });
  let best = habitats[0].id;
  let bestRate = -1;
  for (const h of habitats) {
    st.habitat = h.id;
    const rate = stageRate(s, id).toNumber();
    if (rate > bestRate) {
      bestRate = rate;
      best = h.id;
    }
  }
  st.habitat = huntHere?.id ?? waiting?.needs.habitat ?? best;
  s.news = [];
}

/** Plays one strategy. `events` gets the time each upgrade, discovery and first generator happened. */
export function run(strategy: Strategy, events?: Map<string, number>, hook?: (s: GameState, t: number) => void, from?: { state: GameState; t: number }) {
  // Either a fresh game, or a saved point in one (the tuner replays a stage from its start).
  const s = from ? cloneState(from.state) : createState(0);
  if (!from) tap(s); // every player's first action; nothing runs before it
  const done: Partial<Record<StageId, number>> = {};
  let t = from?.t ?? 0;
  let nextVisit = t;
  const last = STAGE_ORDER[STAGE_ORDER.length - 1];
  const seen = new Set<string>();
  const seenUp = new Set<string>();
  while (t < LIMIT_SEC) {
    if (process.env.SIM_TRACE && strategy.name.startsWith(process.env.SIM_TRACE)) {
      for (const id of s.stages[s.current].discovered) {
        if (!seen.has(id)) {
          seen.add(id);
          console.log(`  ${formatTime(t).padStart(8)}  ${s.current}: found ${id}`);
        }
      }
      if (process.env.SIM_UPS) {
        for (const id of s.stages[s.current].upgrades) {
          if (!seenUp.has(id)) {
            seenUp.add(id);
            console.log(`  ${formatTime(t).padStart(8)}  ${s.current}: bought ${id}`);
          }
        }
        for (const [id, n] of Object.entries(s.stages[s.current].generators)) {
          if (n > 0 && !seenUp.has(`gen:${id}`)) {
            seenUp.add(`gen:${id}`);
            console.log(`  ${formatTime(t).padStart(8)}  ${s.current}: first ${id}`);
          }
        }
      }
    }
    if (process.env.SIM_FREE && strategy.name.startsWith(process.env.SIM_FREE) && s.current === 'soup' && t % 600 === 0) {
      const st = s.stages.soup;
      console.log(`  ${formatTime(t).padStart(8)}  owned ${JSON.stringify(st.generators)}  free ${JSON.stringify(st.free)}`);
    }
    if (process.env.SIM_CELL && strategy.name.startsWith(process.env.SIM_CELL) && s.current === 'cell' && t % 600 === 0) {
      const st = s.stages.cell;
      console.log(`  ${formatTime(t).padStart(8)} DNA ${st.currency.toExponential(2)} rate ${stageRate(s, 'cell').toNumber().toExponential(2)} ${st.habitat} found [${st.discovered}] gens ${JSON.stringify(st.generators)} ups ${st.upgrades.length}`);
    }
    hook?.(s, t);
    if (events) {
      const st = s.stages[s.current];
      const tag = (k: string) => {
        if (!events.has(`${s.current}:${k}`)) events.set(`${s.current}:${k}`, t);
      };
      for (const id of st.discovered) tag(id);
      for (const id of st.upgrades) tag(id);
      for (const [id, n] of Object.entries(st.levels)) tag(`${id}@${n}`);
      if (st.generation > 0) tag(`gen-${st.generation}`);
      for (const [id, n] of Object.entries(st.generators)) if (n > 0) tag(`gen:${id}`);
    }
    if (t >= nextVisit) {
      const before = s.current;
      visit(s, strategy.tapsPerSec, t);
      if (s.current !== before) done[before] = t;
      nextVisit += strategy.checkEvery;
    }
    if (s.current === last && goalProgress(s) >= 1) {
      done[last] = t;
      break;
    }
    // Active players keep a whirlpool going much of the time, and steer their cell to food.
    if (strategy.tapsPerSec > 0 && s.current === 'soup') s.swirl = Math.max(s.swirl, 0.5);
    if (strategy.tapsPerSec > 0 && STAGES[s.current].habitats && t % 3 === 0) forage(s, 'algae');
    if (strategy.tapsPerSec > 0) {
      for (let k = 0; k < strategy.tapsPerSec; k++) {
        const st = s.stages[s.current];
        const v = tapValue(s);
        st.currency = st.currency.add(v);
        st.totalEarned = st.totalEarned.add(v);
      }
    }
    tick(s, 1);
    t += 1;
  }
  return done;
}

function verdict(stage: StageId, sec: number | undefined): string {
  if (sec === undefined) return 'never';
  const [lo, hi] = TARGETS[stage];
  return sec < lo ? 'fast' : sec > hi ? 'slow' : 'on target';
}

if (process.argv[1]?.endsWith('sim.ts')) main();

function main(): void {
  const rows: string[][] = [['player', ...STAGE_ORDER.map((id) => STAGES[id].name), 'total']];
  for (const strat of STRATEGIES) {
    const done = run(strat);
    let prev = 0;
    const cells = STAGE_ORDER.map((id) => {
      const at = done[id];
      if (at === undefined) return 'not reached';
      const dur = at - prev;
      prev = at;
      return strat.name.startsWith('engaged') ? `${formatTime(dur)} (${verdict(id, dur)})` : formatTime(dur);
    });
    rows.push([strat.name, ...cells, done[STAGE_ORDER[STAGE_ORDER.length - 1]] !== undefined ? formatTime(prev) : '—']);
  }

  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)));
  for (const r of rows) console.log(r.map((cell, c) => cell.padEnd(widths[c])).join('  '));
  console.log(`\nTargets for the engaged player: ${STAGE_ORDER.map((id) => `${STAGES[id].name} ${TARGETS[id].map((x) => formatTime(x)).join('–')}`).join(', ')}`);
}
