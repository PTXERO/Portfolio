import { STAGES, STAGE_ORDER } from '../content/stages';
import { D, Decimal, ZERO } from './num';
import type { DialId, Diet, Effect, GameState, GeneratorDef, HabitatDef, MilestoneDef, StageId, UpgradeDef } from './types';

/** Owning this many of a generator doubles its output, each. Past 100, every further 100 counts too. */
export const MILESTONES = [10, 25, 50, 100];
/** A finished stage multiplies the next one's output by its own output to this power. */
export const FEED_EXP = 0.05;
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

/** How many levels of an upgrade are owned (0 if none). */
export function upgradeLevel(state: GameState, stage: StageId, id: string): number {
  const st = state.stages[stage];
  return st.levels[id] ?? (st.upgrades.includes(id) ? 1 : 0);
}

export const maxLevel = (u: UpgradeDef) => u.levels ?? 1;

/** An effect taken `n` times: multipliers compound, amounts add up, switches stay switched. */
export function scaleEffect(e: Effect, n: number): Effect {
  if (n === 1) return e;
  switch (e.kind) {
    case 'genMult':
    case 'stageMult':
    case 'tapMult':
    case 'feedMult':
    case 'swirlMult':
    case 'heroSpeed':
    case 'forageMult':
    case 'spawnMult':
    case 'habitatMult':
      return { ...e, mult: Math.pow(e.mult, n) };
    case 'defense':
      return { ...e, amount: e.amount * n };
    case 'offlineHours':
      return { ...e, hours: e.hours * n };
    case 'guard':
      return { ...e, level: e.level * n };
    case 'tapFromRate':
      return { ...e, seconds: e.seconds * n };
    default:
      return e;
  }
}

/** True when a milestone in an earlier stage has been reached. */
export function milestoneMet(state: GameState, m: MilestoneDef): boolean {
  return state.unlocked.includes(m.stage) && (state.stages[m.stage].generators[m.gen] ?? 0) >= m.owned;
}

/** Every effect in force on a stage: upgrades at their levels, discoveries, and milestones met. */
export function stageEffects(state: GameState, stage: StageId): Effect[] {
  const st = state.stages[stage];
  const def = STAGES[stage];
  const out: Effect[] = [];
  for (const u of def.upgrades) {
    const n = upgradeLevel(state, stage, u.id);
    if (n > 0) for (const e of [u.effect, ...(u.extra ?? [])]) out.push(scaleEffect(e, n));
  }
  for (const r of def.reactions ?? []) if (r.bonus && st.discovered.includes(r.id)) out.push(r.bonus);
  for (const m of def.milestones ?? []) if (milestoneMet(state, m)) out.push(m.bonus);
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
  let strength = FEED_EXP;
  for (const e of stageEffects(state, stage)) if (e.kind === 'feedMult') strength *= e.mult;
  // Every 10x more output in the old stage is worth about 12% more here (26% with Soup Feeding).
  return Math.pow(Math.max(1, stageRate(state, prev).toNumber()), strength);
}

// ---- Cell stage: diet, defense and the habitat ----

/** The lineage's diet, or null before one is chosen (eats a bit of everything). */
export function dietOf(state: GameState, stage: StageId): Diet | null {
  let diet: Diet | null = null;
  for (const e of stageEffects(state, stage)) if (e.kind === 'diet') diet = e.diet;
  return diet;
}

/** Protection from predators, 0 to 0.9. */
export function defenseOf(state: GameState, stage: StageId): number {
  let d = 0;
  for (const e of stageEffects(state, stage)) if (e.kind === 'defense') d += e.amount;
  return Math.min(0.9, d);
}

export function sizeOf(state: GameState, stage: StageId): number {
  let size = 1;
  for (const e of stageEffects(state, stage)) if (e.kind === 'size') size = Math.max(size, e.size);
  return size;
}

function product(state: GameState, stage: StageId, kind: 'heroSpeed' | 'forageMult' | 'spawnMult'): number {
  let m = 1;
  for (const e of stageEffects(state, stage)) if (e.kind === kind) m *= e.mult;
  return m;
}
export const heroSpeed = (state: GameState, stage: StageId) => product(state, stage, 'heroSpeed');
export const forageMult = (state: GameState, stage: StageId) => product(state, stage, 'forageMult');
export const spawnMult = (state: GameState, stage: StageId) => product(state, stage, 'spawnMult');
export const autopilot = (state: GameState, stage: StageId) => stageEffects(state, stage).some((e) => e.kind === 'autopilot');
/** Guard Instinct level: 0 means your cell leaves predators to you. */
export function guardLevel(state: GameState, stage: StageId): number {
  let n = 0;
  for (const e of stageEffects(state, stage)) if (e.kind === 'guard') n += e.level;
  return n;
}

/** The habitat on screen (where your own cell swims). */
export function habitatOf(state: GameState, stage: StageId): HabitatDef | undefined {
  const hs = STAGES[stage].habitats;
  return hs?.find((h) => h.id === state.stages[stage].habitat) ?? hs?.[0];
}

/** The habitat a generator lives in (the first one when it doesn't say). */
export function genHabitat(stage: StageId, gen: GeneratorDef): HabitatDef | undefined {
  const hs = STAGES[stage].habitats;
  return hs?.find((h) => h.id === gen.habitat) ?? hs?.[0];
}

/** How well a diet does on a habitat's food: grazers want algae, hunters bacteria. */
export function dietFit(diet: Diet | null, food: HabitatDef['food']): number {
  if (diet === 'grazer') return food.algae;
  if (diet === 'hunter') return food.bacteria;
  // A generalist: never the best anywhere, never starving either.
  if (diet === 'omnivore') return 0.6 * Math.max(food.algae, food.bacteria) + 0.3 * Math.min(food.algae, food.bacteria);
  return 0.6 * (food.algae + food.bacteria) / 2 + 0.4;
}

/** Share of output that survives predators here, given the lineage's defenses. */
export function survival(state: GameState, stage: StageId, h = habitatOf(state, stage)): number {
  if (!h) return 1;
  return 1 - h.danger * (1 - defenseOf(state, stage));
}

/** Seconds of living in a habitat to settle in fully. */
export const ACCLIM_SEC = 30 * 60;
/** A fully settled habitat's life produces this much more (×1.5). */
export const ACCLIM_BONUS = 0.5;

/** How settled the lineage is in a habitat, 0 to 1. */
export function acclimOf(state: GameState, stage: StageId, habitat: string): number {
  return state.stages[stage].acclim[habitat] ?? 0;
}

/** Output multiplier from where the lineage lives: food that suits its diet, minus predators. */
export function habitatMult(state: GameState, stage: StageId, h = habitatOf(state, stage)): number {
  if (!h) return 1;
  let boost = 1;
  for (const e of stageEffects(state, stage)) if (e.kind === 'habitatMult' && e.habitat === h.id) boost *= e.mult;
  return dietFit(dietOf(state, stage), h.food) * survival(state, stage, h) * (1 + ACCLIM_BONUS * acclimOf(state, stage, h.id)) * boost;
}

/** Extra seconds of time away that count, from effects on the current stage. */
export function offlineBonusSec(state: GameState): number {
  let hours = 0;
  for (const e of stageEffects(state, state.current)) if (e.kind === 'offlineHours') hours += e.hours;
  return hours * 3600;
}

export function generatorRate(state: GameState, stage: StageId, gen: GeneratorDef): Decimal {
  const owned = state.stages[stage].generators[gen.id] ?? 0;
  if (owned === 0) return ZERO;
  const effects = stageEffects(state, stage);
  let m = Math.pow(2, milestonesReached(owned));
  for (const e of effects) if (e.kind === 'genMult' && e.target === gen.id) m *= e.mult;
  m *= stageMult(effects) * dialMult(state, stage, gen) * swirlMult(state, stage) * habitatMult(state, stage, genHabitat(stage, gen));
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
