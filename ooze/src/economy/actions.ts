import { STAGES } from '../content/stages';
import { createStageState } from './state';
import { D, Decimal } from './num';
import { dialMax, tapValue } from './rates';
import type { BuyAmount, DialId, GameState, GeneratorDef, ReactionDef, StageId, UpgradeDef } from './types';
import { DIALS } from './types';

function generatorDef(stage: StageId, id: string): GeneratorDef {
  const g = STAGES[stage].generators.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown generator ${stage}/${id}`);
  return g;
}

/** Units bought with currency; free ones from reactions don't raise prices. */
function bought(state: GameState, stage: StageId, id: string): number {
  const st = state.stages[stage];
  return st.generators[id] - (st.free[id] ?? 0);
}

/** Cost of the next `count` units of a generator. */
export function generatorCost(state: GameState, stage: StageId, id: string, count = 1): Decimal {
  const g = generatorDef(stage, id);
  return Decimal.sumGeometricSeries(count, g.baseCost, g.growth, bought(state, stage, id));
}

/** How many units the stage's current currency can buy right now. */
export function affordableCount(state: GameState, stage: StageId, id: string): number {
  const g = generatorDef(stage, id);
  const st = state.stages[stage];
  return Decimal.affordGeometricSeries(st.currency, g.baseCost, g.growth, bought(state, stage, id)).toNumber();
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
  const r = u.requires;
  if (r?.generator && (st.generators[r.generator] ?? 0) < (r.owned ?? 1)) return false;
  if (r?.reaction && !st.discovered.includes(r.reaction)) return false;
  return true;
}

/** Generators the player can see: unlocked by a reaction, or the next tier up from what's owned. */
export function generatorVisible(state: GameState, stage: StageId, g: GeneratorDef): boolean {
  const def = STAGES[stage];
  const st = state.stages[stage];
  if (g.unlockedBy) return st.discovered.includes(g.unlockedBy);
  const i = def.generators.indexOf(g);
  return i === 0 || st.generators[g.id] > 0 || st.generators[def.generators[i - 1].id] > 0;
}

// ---- Dials and the whirlpool ----

export function setDial(state: GameState, stage: StageId, dial: DialId, level: number): boolean {
  const max = dialMax(state, stage, dial);
  if (level < 0 || level > max) return false;
  state.stages[stage].dials[dial] = level;
  return true;
}

/** Turns of a finger around the whirlpool. Strength builds with spinning and fades by itself. */
export const SWIRL_PER_TURN = 0.18;
export const SWIRL_FADE_PER_SEC = 0.06;

export function addSwirl(state: GameState, turns: number): void {
  if (state.current !== 'soup' || turns <= 0) return;
  state.started = true;
  state.swirl = Math.min(1, state.swirl + turns * SWIRL_PER_TURN);
}

// ---- Reactions ----

export function reactions(stage: StageId): ReactionDef[] {
  return STAGES[stage].reactions ?? [];
}

export interface ReactionCheck {
  gens: boolean;
  dials: boolean;
  swirl: boolean;
  cost: boolean;
  /** Each requirement, whether it holds, for hints and the recipe book. */
  parts: { label: string; ok: boolean }[];
}

/** Which of a reaction's conditions hold right now. */
export function checkReaction(state: GameState, stage: StageId, r: ReactionDef): ReactionCheck {
  const st = state.stages[stage];
  const def = STAGES[stage];
  const parts: ReactionCheck['parts'] = [];
  let gens = true;
  for (const [id, n] of Object.entries(r.needs.gens ?? {})) {
    const ok = (st.generators[id] ?? 0) >= n;
    gens &&= ok;
    parts.push({ label: `${n} ${def.generators.find((g) => g.id === id)?.name ?? id}`, ok });
  }
  let dials = true;
  for (const d of DIALS) {
    const range = r.needs.dials?.[d];
    if (!range) continue;
    const v = st.dials[d];
    const ok = v >= range[0] && v <= range[1];
    dials &&= ok;
    const word = d[0].toUpperCase() + d.slice(1);
    parts.push({ label: range[0] === range[1] ? `${word} exactly ${range[0]}` : range[1] >= 3 ? `${word} ${range[0]}+` : range[0] === 0 ? `${word} ${range[1]} or less` : `${word} ${range[0]}-${range[1]}`, ok });
  }
  const swirl = state.swirl >= (r.needs.swirl ?? 0);
  if (r.needs.swirl) parts.push({ label: 'a strong whirlpool', ok: swirl });
  const cost = !r.cost || st.currency.gte(r.cost);
  return { gens, dials, swirl, cost, parts };
}

export function reactionReady(state: GameState, stage: StageId, r: ReactionDef): boolean {
  const c = checkReaction(state, stage, r);
  return c.gens && c.dials && c.swirl && c.cost;
}

/** Discovers every ordinary reaction whose conditions hold. Called each tick. */
export function discoverReactions(state: GameState, stage: StageId): string[] {
  const st = state.stages[stage];
  const found: string[] = [];
  for (const r of reactions(stage)) {
    if (r.final || st.discovered.includes(r.id) || !reactionReady(state, stage, r)) continue;
    st.discovered.push(r.id);
    found.push(r.id);
  }
  if (found.length) state.news.push(...found);
  return found;
}

/**
 * The reaction to point the player at: the first unfound one whose molecules are
 * all there (only conditions missing), otherwise the first unfound one at all.
 */
export function nextReaction(state: GameState, stage: StageId): { r: ReactionDef; check: ReactionCheck } | null {
  const st = state.stages[stage];
  const open = reactions(stage).filter((r) => !st.discovered.includes(r.id));
  const ready = open.find((r) => checkReaction(state, stage, r).gens);
  const r = ready ?? open[0];
  return r ? { r, check: checkReaction(state, stage, r) } : null;
}

/** True when a reaction's dial and whirlpool conditions hold right now (molecules aside). */
export function conditionsHold(state: GameState, stage: StageId, r: ReactionDef): boolean {
  const c = checkReaction(state, stage, r);
  return c.dials && c.swirl;
}

// ---- Catalysis: discovered reactions make free product while their conditions hold ----

/** Free products per second at sqrt(1) ingredient, before the product's tier slows it down. */
export const CATALYSIS_BASE = 0.008;

/**
 * Free products per second a discovered reaction is making right now: zero
 * unless its dials and whirlpool conditions hold. More ingredients bond more
 * often (square root, so it grows gently); each tier up is half as fast; a
 * spinning whirlpool triples it at full strength.
 */
export function catalysisRate(state: GameState, stage: StageId, r: ReactionDef): number {
  const st = state.stages[stage];
  if (!r.unlocks || !r.pair || !st.discovered.includes(r.id) || !conditionsHold(state, stage, r)) return 0;
  const [a, b] = r.pair;
  const ingredients = a === b ? Math.floor(st.generators[a] / 2) : Math.min(st.generators[a], st.generators[b]);
  if (ingredients < 1) return 0;
  const tier = Math.max(0, STAGES[stage].generators.findIndex((g) => g.id === r.unlocks) - 1);
  return (CATALYSIS_BASE * Math.sqrt(ingredients) * (1 + 2 * state.swirl)) / Math.pow(2, tier);
}

/** Runs the stage's reactions for `dt` seconds, adding the free products they make. */
export function catalyze(state: GameState, stage: StageId, dt: number): void {
  const st = state.stages[stage];
  for (const r of reactions(stage)) {
    const rate = catalysisRate(state, stage, r);
    if (rate <= 0) continue;
    const progress = (st.catalysis[r.id] ?? 0) + rate * dt;
    const made = Math.floor(progress);
    st.catalysis[r.id] = progress - made;
    if (made > 0) {
      st.generators[r.unlocks!] += made;
      st.free[r.unlocks!] = (st.free[r.unlocks!] ?? 0) + made;
      // Only a few at a time are shown; long absences would flood the scene.
      for (let i = 0; i < Math.min(made, 3); i++) state.made.push(r.id);
      if (state.made.length > 12) state.made.splice(0, state.made.length - 12);
    }
  }
}

export function finalReaction(stage: StageId): ReactionDef | undefined {
  return reactions(stage).find((r) => r.final);
}

/** The ending: pays for and discovers the final reaction. The stage is then done. */
export function triggerFinale(state: GameState): boolean {
  const r = finalReaction(state.current);
  const st = state.stages[state.current];
  if (!r || st.discovered.includes(r.id) || !reactionReady(state, state.current, r)) return false;
  if (r.cost) st.currency = st.currency.sub(r.cost);
  st.discovered.push(r.id);
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

/** Progress toward the current stage's goal, 0 to 1: reactions found, or currency saved. */
export function goalProgress(state: GameState): number {
  const st = state.stages[state.current];
  const rs = reactions(state.current);
  if (rs.length) return st.discovered.length / rs.length;
  return Math.min(1, st.currency.div(STAGES[state.current].goal).toNumber());
}

/** Stages without reactions show their goal bar from 70%. It never names what comes next. */
export function goalShown(state: GameState): boolean {
  return reactions(state.current).length > 0 || goalProgress(state) >= 0.7;
}

export function canEvolve(state: GameState): boolean {
  const def = STAGES[state.current];
  if (!def.next) return false;
  const fin = finalReaction(state.current);
  if (fin) return state.stages[state.current].discovered.includes(fin.id);
  return goalProgress(state) >= 1;
}

export function evolve(state: GameState): boolean {
  if (!canEvolve(state)) return false;
  const def = STAGES[state.current];
  const st = state.stages[state.current];
  if (!finalReaction(state.current)) st.currency = st.currency.sub(D(def.goal));
  st.complete = true;
  const next = def.next!;
  state.stages[next] = createStageState(next, true);
  state.unlocked.push(next);
  state.current = next;
  return true;
}
