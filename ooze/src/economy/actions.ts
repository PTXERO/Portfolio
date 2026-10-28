import { STAGES } from '../content/stages';
import { createStageState } from './state';
import { D, Decimal } from './num';
import { tapValue } from './rates';
import type { BuyAmount, GameState, GeneratorDef, StageId, UpgradeDef } from './types';

function generatorDef(stage: StageId, id: string): GeneratorDef {
  const g = STAGES[stage].generators.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown generator ${stage}/${id}`);
  return g;
}

/** Cost of the next `count` units of a generator. */
export function generatorCost(state: GameState, stage: StageId, id: string, count = 1): Decimal {
  const g = generatorDef(stage, id);
  return Decimal.sumGeometricSeries(count, g.baseCost, g.growth, state.stages[stage].generators[id]);
}

/** How many units the stage's current currency can buy right now. */
export function affordableCount(state: GameState, stage: StageId, id: string): number {
  const g = generatorDef(stage, id);
  const st = state.stages[stage];
  return Decimal.affordGeometricSeries(st.currency, g.baseCost, g.growth, st.generators[id]).toNumber();
}

/** Number of units a press of the buy button would buy with the given setting. */
export function buyCount(state: GameState, stage: StageId, id: string, amount: BuyAmount): number {
  if (amount === 'max') return Math.max(1, affordableCount(state, stage, id));
  return amount;
}

/** Buys `count` units if affordable. Returns whether anything was bought. */
export function buyGenerator(state: GameState, stage: StageId, id: string, count = 1): boolean {
  if (count < 1) return false;
  const cost = generatorCost(state, stage, id, count);
  const st = state.stages[stage];
  if (st.currency.lt(cost)) return false;
  st.currency = st.currency.sub(cost);
  st.generators[id] += count;
  return true;
}

export function upgradeVisible(state: GameState, stage: StageId, u: UpgradeDef): boolean {
  const st = state.stages[stage];
  if (st.upgrades.includes(u.id)) return false;
  if (u.requires && (st.generators[u.requires.generator] ?? 0) < u.requires.owned) return false;
  return true;
}

export function visibleUpgrades(state: GameState, stage: StageId): UpgradeDef[] {
  return STAGES[stage].upgrades.filter((u) => upgradeVisible(state, stage, u));
}

export function buyUpgrade(state: GameState, stage: StageId, id: string): boolean {
  const u = STAGES[stage].upgrades.find((x) => x.id === id);
  const st = state.stages[stage];
  if (!u || !upgradeVisible(state, stage, u) || st.currency.lt(u.cost)) return false;
  st.currency = st.currency.sub(u.cost);
  st.upgrades.push(u.id);
  return true;
}

export function tap(state: GameState): Decimal {
  const v = tapValue(state);
  if (v.lte(0)) return v;
  // The first stir is what starts life: production only begins after it.
  state.started = true;
  const st = state.stages[state.current];
  st.currency = st.currency.add(v);
  st.totalEarned = st.totalEarned.add(v);
  state.taps++;
  return v;
}

/** Progress toward the current stage's goal, 0 to 1. */
export function goalProgress(state: GameState): number {
  const st = state.stages[state.current];
  return Math.min(1, st.currency.div(STAGES[state.current].goal).toNumber());
}

/** The next stage's button shows (greyed out) from 70% of the goal. */
export function nextStageTeased(state: GameState): boolean {
  return state.stages[state.current].complete || goalProgress(state) >= 0.7;
}

export function canEvolve(state: GameState): boolean {
  const def = STAGES[state.current];
  return !!def.next && goalProgress(state) >= 1;
}

export function evolve(state: GameState): boolean {
  if (!canEvolve(state)) return false;
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  st.currency = st.currency.sub(D(def.goal));
  st.complete = true;
  const next = def.next!;
  state.stages[next] = createStageState(next, true);
  state.unlocked.push(next);
  state.current = next;
  return true;
}
