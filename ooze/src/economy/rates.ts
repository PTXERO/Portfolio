import { STAGES, STAGE_ORDER } from '../content/stages';
import { D, Decimal, ZERO } from './num';
import type { GameState, GeneratorDef, StageId, UpgradeDef } from './types';

/** Owning this many of a generator doubles its output, each. Past 100, every further 100 counts too. */
export const MILESTONES = [10, 25, 50, 100];
/** How strongly a finished stage boosts the one after it. */
export const FEED_BASE = 0.15;

export function milestonesReached(owned: number): number {
  let n = MILESTONES.filter((m) => owned >= m).length;
  if (owned >= 200) n += Math.floor(owned / 100) - 1;
  return n;
}

export function nextMilestone(owned: number): number {
  const m = MILESTONES.find((x) => owned < x);
  return m ?? (Math.floor(owned / 100) + 1) * 100;
}

function ownedUpgrades(state: GameState, stage: StageId): UpgradeDef[] {
  const st = state.stages[stage];
  return STAGES[stage].upgrades.filter((u) => st.upgrades.includes(u.id));
}

function stageMult(state: GameState, stage: StageId): number {
  let m = 1;
  for (const u of ownedUpgrades(state, stage)) if (u.effect.kind === 'stageMult') m *= u.effect.mult;
  return m;
}

/** Multiplier this stage gets from the finished stage before it. */
export function feedMult(state: GameState, stage: StageId): number {
  const i = STAGE_ORDER.indexOf(stage);
  if (i <= 0) return 1;
  const prev = STAGE_ORDER[i - 1];
  if (!state.stages[prev].complete) return 1;
  let strength = FEED_BASE;
  for (const u of ownedUpgrades(state, stage)) if (u.effect.kind === 'feedMult') strength *= u.effect.mult;
  return 1 + strength * Math.log10(1 + stageRate(state, prev).toNumber());
}

export function generatorRate(state: GameState, stage: StageId, gen: GeneratorDef): Decimal {
  const owned = state.stages[stage].generators[gen.id] ?? 0;
  if (owned === 0) return ZERO;
  let m = Math.pow(2, milestonesReached(owned));
  for (const u of ownedUpgrades(state, stage)) {
    if (u.effect.kind === 'genMult' && u.effect.target === gen.id) m *= u.effect.mult;
  }
  return D(gen.baseRate * owned * m * stageMult(state, stage) * feedMult(state, stage));
}

/** Currency per second for a whole stage. */
export function stageRate(state: GameState, stage: StageId): Decimal {
  let total = ZERO;
  for (const g of STAGES[stage].generators) total = total.add(generatorRate(state, stage, g));
  return total;
}

export function tapValue(state: GameState): Decimal {
  const def = STAGES[state.current];
  if (def.tapBase === 0) return ZERO;
  let m = 1;
  let fromRate = 0;
  for (const u of ownedUpgrades(state, state.current)) {
    if (u.effect.kind === 'tapMult') m *= u.effect.mult;
    if (u.effect.kind === 'tapFromRate') fromRate += u.effect.seconds;
  }
  return D(def.tapBase * m).add(stageRate(state, state.current).mul(fromRate));
}
