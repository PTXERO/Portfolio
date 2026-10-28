// Headless balance simulator: plays the economy with scripted player types and
// prints how long each stage takes, against the design doc's targets.
// Run with: npm run sim

import { STAGES, STAGE_ORDER } from '../src/content/stages';
import {
  buyGenerator,
  buyUpgrade,
  canEvolve,
  checkReaction,
  evolve,
  finalReaction,
  generatorCost,
  generatorVisible,
  goalProgress,
  reactionReady,
  reactions,
  tap,
  triggerFinale,
  visibleUpgrades,
} from '../src/economy/actions';
import { formatTime } from '../src/economy/num';
import { dialMax, stageRate, tapValue } from '../src/economy/rates';
import { cloneState, createState } from '../src/economy/state';
import { tick } from '../src/economy/tick';
import { DIALS, type DialId, type GameState, type ReactionDef, type StageId } from '../src/economy/types';

interface Strategy {
  name: string;
  /** Seconds between visits where the player spends. */
  checkEvery: number;
  tapsPerSec: number;
}

const STRATEGIES: Strategy[] = [
  { name: 'active (taps 4/s)', checkEvery: 1, tapsPerSec: 4 },
  { name: 'engaged (30 s visits)', checkEvery: 30, tapsPerSec: 0 },
  { name: 'casual (5 min visits)', checkEvery: 300, tapsPerSec: 0 },
  { name: 'idle (30 min visits)', checkEvery: 1800, tapsPerSec: 0 },
];

/** Target seconds per stage for an engaged player (design doc, First run table). */
const TARGETS: Record<StageId, [number, number]> = {
  soup: [50 * 60, 70 * 60],
  cell: [10 * 60, 20 * 60],
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
    const trial = cloneState(s);
    trial.stages[stage].upgrades.push(u.id);
    out.push({ cost: u.cost, gain: effectiveRate(trial, tapsPerSec) - base, apply: (x) => buyUpgrade(x, stage, u.id) });
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
function visit(s: GameState, tapsPerSec: number): void {
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
    // Unlocks (dials, the whirlpool) have no direct payback; players buy them when they can.
    const unlock = visibleUpgrades(s, s.current).find((u) => (u.effect.kind === 'dialMax' || u.effect.kind === 'swirlMult') && u.cost <= money);
    if (unlock) {
      buyUpgrade(s, s.current, unlock.id);
      continue;
    }
    const rate = effectiveRate(s, tapsPerSec);
    const goal = fin ? (checkReaction(s, s.current, fin).gens ? fin.cost ?? 0 : Infinity) : STAGES[s.current].goal;
    const toGoal = (goal - money) / Math.max(rate, 1e-9);
    const affordable = options(s, tapsPerSec)
      .filter((o) => o.cost <= money)
      .sort((a, b) => a.cost / a.gain - b.cost / b.gain);
    const best = affordable[0];
    if (!best || best.cost / best.gain > toGoal) break;
    best.apply(s);
  }
  if (s.current === stage && fin) chaseReaction(s);
}

function run(strategy: Strategy) {
  const s = createState(0);
  tap(s); // every player's first action; nothing runs before it
  const done: Partial<Record<StageId, number>> = {};
  let t = 0;
  let nextVisit = 0;
  const last = STAGE_ORDER[STAGE_ORDER.length - 1];
  const seen = new Set<string>();
  while (t < LIMIT_SEC) {
    if (process.env.SIM_TRACE && strategy.name.startsWith(process.env.SIM_TRACE)) {
      for (const id of s.stages.soup.discovered) {
        if (!seen.has(id)) {
          seen.add(id);
          console.log(`  ${formatTime(t).padStart(8)}  ${id}`);
        }
      }
    }
    if (process.env.SIM_FREE && strategy.name.startsWith(process.env.SIM_FREE) && s.current === 'soup' && t % 600 === 0) {
      const st = s.stages.soup;
      console.log(`  ${formatTime(t).padStart(8)}  owned ${JSON.stringify(st.generators)}  free ${JSON.stringify(st.free)}`);
    }
    if (t >= nextVisit) {
      const before = s.current;
      visit(s, strategy.tapsPerSec);
      if (s.current !== before) done[before] = t;
      nextVisit += strategy.checkEvery;
    }
    if (s.current === last && goalProgress(s) >= 1) {
      done[last] = t;
      break;
    }
    // Active players keep a whirlpool going much of the time.
    if (strategy.tapsPerSec > 0 && s.current === 'soup') s.swirl = Math.max(s.swirl, 0.5);
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
