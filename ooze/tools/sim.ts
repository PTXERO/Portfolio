// Headless balance simulator: plays the economy with scripted player types and
// prints how long each stage takes, against the design doc's targets.
// Run with: npm run sim

import { STAGES, STAGE_ORDER } from '../src/content/stages';
import { buyGenerator, buyUpgrade, canEvolve, evolve, generatorCost, goalProgress, visibleUpgrades } from '../src/economy/actions';
import { formatTime } from '../src/economy/num';
import { stageRate, tapValue } from '../src/economy/rates';
import { cloneState, createState } from '../src/economy/state';
import { tick } from '../src/economy/tick';
import type { GameState, StageId } from '../src/economy/types';

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
  soup: [3 * 60, 5 * 60],
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

/** One visit: evolve if possible, otherwise buy the best-payback items unless saving for the goal is faster. */
function visit(s: GameState, tapsPerSec: number): void {
  for (let i = 0; i < 2000; i++) {
    if (canEvolve(s)) {
      evolve(s);
      continue;
    }
    const st = s.stages[s.current];
    const money = st.currency.toNumber();
    const rate = effectiveRate(s, tapsPerSec);
    const toGoal = (STAGES[s.current].goal - money) / Math.max(rate, 1e-9);
    const affordable = options(s, tapsPerSec)
      .filter((o) => o.cost <= money)
      .sort((a, b) => a.cost / a.gain - b.cost / b.gain);
    const best = affordable[0];
    if (!best || best.cost / best.gain > toGoal) return;
    best.apply(s);
  }
}

function run(strategy: Strategy) {
  const s = createState(0);
  const done: Partial<Record<StageId, number>> = {};
  let t = 0;
  let nextVisit = 0;
  const last = STAGE_ORDER[STAGE_ORDER.length - 1];
  while (t < LIMIT_SEC) {
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
