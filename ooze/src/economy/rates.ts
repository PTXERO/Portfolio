import { STAGES, STAGE_ORDER } from '../content/stages';
import { D, Decimal, ZERO } from './num';
import type { DialId, Effect, GameState, GeneratorDef, StageId } from './types';

/** Owning this many of a generator doubles its output, each. Past 100, every further 100 counts too. */
export const MILESTONES = [10, 25, 50, 100];
/** How strongly a finished stage boosts the one after it. */
export const FEED_BASE = 0.15;
/** At full strength the whirlpool multiplies Soup output by 1 + this. */
export const SWIRL_BONUS = 1;

export function milestonesReached(owned: number): number {
  let n = MILESTONES.filter((m) => owned >= m).length;
  if (owned >= 200) n += Math.floor(owned / 100) - 1;
  return n;
}

export function nextMilestone(owned: number): number {
  const m = MILESTONES.find((x) => owned < x);
  return m ?? (Math.floor(owned / 100) + 1) * 100;
}

/** Every effect in force on a stage: bought upgrades plus discovered reactions. */
export function stageEffects(state: GameState, stage: StageId): Effect[] {
  const st = state.stages[stage];
  const def = STAGES[stage];
  const out: Effect[] = [];
  for (const u of def.upgrades) if (st.upgrades.includes(u.id)) out.push(u.effect);
  for (const r of def.reactions ?? []) if (r.bonus && st.discovered.includes(r.id)) out.push(r.bonus);
  return out;
}

function stageMult(effects: Effect[]): number {
  let m = 1;
  for (const e of effects) if (e.kind === 'stageMult') m *= e.mult;
  return m;
}

/** How far a dial can turn on this stage; 0 means it isn't unlocked yet. */
export function dialMax(state: GameState, stage: StageId, dial: DialId): number {
  let max = 0;
  for (const e of stageEffects(state, stage)) if (e.kind === 'dialMax' && e.dial === dial) max = Math.max(max, e.max);
  return max;
}

/** A generator's multiplier from the current dial settings. */
export function dialMult(state: GameState, stage: StageId, gen: GeneratorDef): number {
  let m = 1;
  const dials = state.stages[stage].dials;
  for (const [dial, curve] of Object.entries(gen.prefs ?? {})) m *= curve[dials[dial as DialId] ?? 0];
  return m;
}

/** Production multiplier from the whirlpool. Only the Soup has one. */
export function swirlMult(state: GameState, stage: StageId): number {
  if (stage !== 'soup' || state.swirl <= 0) return 1;
  let bonus = SWIRL_BONUS;
  for (const e of stageEffects(state, stage)) if (e.kind === 'swirlMult') bonus *= e.mult;
  return 1 + bonus * state.swirl;
}

/** Multiplier this stage gets from the finished stage before it. */
export function feedMult(state: GameState, stage: StageId): number {
  const i = STAGE_ORDER.indexOf(stage);
  if (i <= 0) return 1;
  const prev = STAGE_ORDER[i - 1];
  if (!state.stages[prev].complete) return 1;
  let strength = FEED_BASE;
  for (const e of stageEffects(state, stage)) if (e.kind === 'feedMult') strength *= e.mult;
  return 1 + strength * Math.log10(1 + stageRate(state, prev).toNumber());
}

export function generatorRate(state: GameState, stage: StageId, gen: GeneratorDef): Decimal {
  const owned = state.stages[stage].generators[gen.id] ?? 0;
  if (owned === 0) return ZERO;
  const effects = stageEffects(state, stage);
  let m = Math.pow(2, milestonesReached(owned));
  for (const e of effects) if (e.kind === 'genMult' && e.target === gen.id) m *= e.mult;
  m *= stageMult(effects) * dialMult(state, stage, gen) * swirlMult(state, stage);
  return D(gen.baseRate * owned * m * feedMult(state, stage));
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
  for (const e of stageEffects(state, state.current)) {
    if (e.kind === 'tapMult') m *= e.mult;
    if (e.kind === 'tapFromRate') fromRate += e.seconds;
  }
  return D(def.tapBase * m).add(stageRate(state, state.current).mul(fromRate));
}
