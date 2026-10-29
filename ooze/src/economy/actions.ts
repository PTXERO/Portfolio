import { STAGES } from '../content/stages';
import { createStageState } from './state';
import { D, Decimal } from './num';
import { dialMax, dietOf, forageMult, maxLevel, stageRate, tapValue, upgradeLevel } from './rates';
import type { BuyAmount, DialId, FoodKind, GameState, GeneratorDef, HabitatDef, ReactionDef, StageId, UpgradeDef } from './types';
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

/** Price of an upgrade's next level. */
export function upgradeCost(state: GameState, stage: StageId, u: UpgradeDef): Decimal {
  return D(u.cost).mul(Math.pow(u.costGrowth ?? 3, upgradeLevel(state, stage, u.id)));
}

/** The stage whose currency pays for an upgrade. */
export const payStage = (stage: StageId, u: UpgradeDef): StageId => u.pay ?? stage;

/** Whether the requirements to start buying an upgrade hold (ignoring whether it's maxed). */
export function upgradeUnlocked(state: GameState, stage: StageId, u: UpgradeDef): boolean {
  const st = state.stages[stage];
  const r = u.requires;
  if (u.pay && !state.unlocked.includes(u.pay)) return false;
  if (r?.habitat) {
    const h = STAGES[stage].habitats?.find((x) => x.id === r.habitat);
    if (h && !habitatUnlocked(state, stage, h)) return false;
  }
  if (r?.levels && !Object.entries(r.levels).every(([id, n]) => upgradeLevel(state, stage, id) >= n)) return false;
  if (r?.generator && (st.generators[r.generator] ?? 0) < (r.owned ?? 1)) return false;
  if (r?.reaction && !st.discovered.includes(r.reaction)) return false;
  if (r?.anyReaction && !r.anyReaction.some((x) => st.discovered.includes(x))) return false;
  if (r?.upgrades && !r.upgrades.every((x) => st.upgrades.includes(x))) return false;
  if (r?.found && st.discovered.length < r.found) return false;
  if (r?.generation && st.generation < r.generation) return false;
  if (r?.pop && st.pop < r.pop) return false;
  // A choice already made elsewhere (e.g. the other diet) hides this one.
  if (u.excludes?.some((x) => st.upgrades.includes(x))) return false;
  return true;
}

/**
 * What it takes to open a locked upgrade, as a short line (so a locked thing shows as a hint,
 * not a card). Null if nothing's in the way.
 */
export function lockHint(state: GameState, stage: StageId, u: UpgradeDef): string | null {
  const st = state.stages[stage];
  const def = STAGES[stage];
  const r = u.requires;
  if (!r) return null;
  const placeName = (id: string) => def.places?.find((p) => p.id === id)?.name ?? def.reactions?.find((x) => x.id === id)?.name ?? id;
  if (r.reaction && !st.discovered.includes(r.reaction)) return `find the ${placeName(r.reaction)}`;
  if (r.found && st.discovered.length < r.found) return `settle ${r.found} places`;
  if (r.generation && st.generation < r.generation) return r.generation === 1 ? 'hatch a first egg' : `breed generation ${r.generation}`;
  if (r.pop && st.pop < r.pop) return `grow the herd to ${r.pop}`;
  if (r.upgrades) {
    const need = r.upgrades.filter((x) => !st.upgrades.includes(x)).map((x) => def.upgrades.find((y) => y.id === x)?.name ?? x);
    if (need.length) return `get ${need.join(' and ')}`;
  }
  return null;
}

/** Buyable now or later: unlocked and not yet at its last level. */
export function upgradeVisible(state: GameState, stage: StageId, u: UpgradeDef): boolean {
  return upgradeLevel(state, stage, u.id) < maxLevel(u) && upgradeUnlocked(state, stage, u);
}

/** Generators the player can see: unlocked by a reaction, or the next tier up from what's owned. */
export function generatorVisible(state: GameState, stage: StageId, g: GeneratorDef): boolean {
  const def = STAGES[stage];
  const st = state.stages[stage];
  // Each habitat has its own lineup, opened with the habitat.
  const h = def.habitats?.find((x) => x.id === g.habitat);
  if (h && !habitatUnlocked(state, stage, h)) return false;
  if (g.unlockedBy) return st.discovered.includes(g.unlockedBy);
  const lineup = def.generators.filter((x) => x.habitat === g.habitat && !x.unlockedBy);
  const i = lineup.indexOf(g);
  return i <= 0 || st.generators[g.id] > 0 || st.generators[lineup[i - 1].id] > 0;
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
  for (const id of r.needs.upgrades ?? []) {
    const ok = st.upgrades.includes(id);
    gens &&= ok;
    parts.push({ label: def.upgrades.find((u) => u.id === id)?.name ?? id, ok });
  }
  if (r.needs.anyUpgrade) {
    const ok = r.needs.anyUpgrade.some((id) => st.upgrades.includes(id));
    gens &&= ok;
    parts.push({ label: r.needs.anyUpgrade.map((id) => def.upgrades.find((u) => u.id === id)?.name ?? id).join(' or '), ok });
  }
  if (r.needs.found) {
    const n = st.discovered.filter((x) => x !== r.id).length;
    const ok = n >= r.needs.found;
    gens &&= ok;
    parts.push({ label: def.places ? `${r.needs.found} places settled` : `${r.needs.found} ${def.bookName?.toLowerCase() ?? 'discoveries'} found`, ok });
  }
  if (r.needs.generation) {
    const ok = st.generation >= r.needs.generation;
    gens &&= ok;
    parts.push({ label: `Generation ${r.needs.generation}`, ok });
  }
  if (r.needs.pop) {
    const ok = st.pop >= r.needs.pop;
    gens &&= ok;
    parts.push({ label: `Population ${r.needs.pop}`, ok });
  }
  let dials = true;
  if (r.needs.habitat) {
    const ok = st.habitat === r.needs.habitat;
    dials &&= ok;
    const name = def.habitats?.find((h) => h.id === r.needs.habitat)?.name ?? r.needs.habitat;
    parts.push({ label: `Your cell in the ${name}`, ok });
    if (r.needs.settled) {
      const settledOk = (st.acclim[r.needs.habitat] ?? 0) >= r.needs.settled - 1e-9;
      dials &&= settledOk;
      parts.push({ label: `Settled in the ${name} ${Math.round(r.needs.settled * 100)}%`, ok: settledOk });
    }
  }
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
    if (r.final || r.manual || st.discovered.includes(r.id) || !reactionReady(state, stage, r)) continue;
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

/** How much slower each tier up the chain reacts. */
export const CATALYSIS_TIER_SLOWDOWN = 1.7;

/**
 * Free products per second a discovered reaction is making right now: zero
 * unless its dials are right. The whirlpool isn't needed once a reaction is
 * known; spinning one just speeds it up (×3 at full strength). More ingredients
 * bond more often (square root, so it grows gently); each tier up is slower.
 */
export function catalysisRate(state: GameState, stage: StageId, r: ReactionDef): number {
  const st = state.stages[stage];
  if (!r.unlocks || !r.pair || !st.discovered.includes(r.id) || !checkReaction(state, stage, r).dials) return 0;
  const [a, b] = r.pair;
  const ingredients = a === b ? Math.floor(st.generators[a] / 2) : Math.min(st.generators[a], st.generators[b]);
  if (ingredients < 1) return 0;
  const tier = Math.max(0, STAGES[stage].generators.findIndex((g) => g.id === r.unlocks) - 1);
  return (CATALYSIS_BASE * Math.sqrt(ingredients) * (1 + 2 * state.swirl)) / Math.pow(CATALYSIS_TIER_SLOWDOWN, tier);
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

// ---- Cell stage: habitats, foraging, predators, engulfing ----

export function habitatUnlocked(state: GameState, stage: StageId, h: HabitatDef): boolean {
  const st = state.stages[stage];
  if (h.unlock?.upgrade && upgradeLevel(state, stage, h.unlock.upgrade) < (h.unlock.level ?? 1)) return false;
  if (h.unlock?.reaction && !st.discovered.includes(h.unlock.reaction)) return false;
  return true;
}

/** Sends your cell back to the first habitat if the one it's in isn't open (older saves, changed rules). */
export function settleHabitat(state: GameState): void {
  for (const id of state.unlocked) {
    const hs = STAGES[id].habitats;
    const st = state.stages[id];
    const h = hs?.find((x) => x.id === st.habitat);
    if (hs && (!h || !habitatUnlocked(state, id, h))) st.habitat = hs[0].id;
  }
}

export function moveHabitat(state: GameState, stage: StageId, id: string): boolean {
  const h = STAGES[stage].habitats?.find((x) => x.id === id);
  if (!h || !habitatUnlocked(state, stage, h)) return false;
  state.stages[stage].habitat = id;
  return true;
}

/** Seconds of the stage's output one bite of food is worth, before diet and mutations. */
export const FORAGE_SECONDS = 1;
/** Seconds of output for driving off a predator. */
export const FEND_OFF_SECONDS = 15;

/** What a lineage can eat: nothing until it picks a diet, then only that diet's food (both for omnivores). */
export function canEat(state: GameState, stage: StageId, food: FoodKind): boolean {
  const diet = dietOf(state, stage);
  if (diet === 'grazer') return food === 'algae';
  if (diet === 'hunter') return food === 'bacteria';
  return diet === 'omnivore';
}

/** How much one piece of food is worth, in seconds of output: specialists get more from their food. */
export function foodValue(state: GameState, stage: StageId, food: FoodKind): number {
  if (!canEat(state, stage, food)) return 0;
  return dietOf(state, stage) === 'omnivore' ? 1.1 : 1.5;
}

function earn(state: GameState, stage: StageId, amount: Decimal): Decimal {
  const st = state.stages[stage];
  st.currency = st.currency.add(amount);
  st.totalEarned = st.totalEarned.add(amount);
  state.started = true;
  return amount;
}

/** The hero cell eats one piece of food. Returns the currency gained. */
export function forage(state: GameState, food: FoodKind): Decimal {
  const stage = state.current;
  if (!canEat(state, stage, food)) return D(0);
  const base = Decimal.max(stageRate(state, stage).mul(FORAGE_SECONDS), 1);
  state.stages[stage].eaten++;
  return earn(state, stage, base.mul(foodValue(state, stage, food) * forageMult(state, stage)));
}

/** A predator was driven off. Returns the reward. */
export function fendOff(state: GameState): Decimal {
  const stage = state.current;
  return earn(state, stage, Decimal.max(stageRate(state, stage).mul(FEND_OFF_SECONDS), 5));
}

/** Organelles that could be engulfed right now (their microbe can turn up in the pond). */
export function engulfable(state: GameState, stage: StageId): ReactionDef[] {
  const st = state.stages[stage];
  return reactions(stage).filter((r) => r.manual && !st.discovered.includes(r.id) && reactionReady(state, stage, r));
}

/**
 * The hero engulfs a rare microbe. Each organelle takes a few: returns 'caught'
 * for one more toward it, 'found' when that was the last, or false if it couldn't.
 */
export function engulf(state: GameState, stage: StageId, id: string): 'caught' | 'found' | false {
  const r = engulfable(state, stage).find((x) => x.id === id);
  if (!r) return false;
  const st = state.stages[stage];
  st.captured[id] = (st.captured[id] ?? 0) + 1;
  if (st.captured[id] < (r.captures ?? 1)) return 'caught';
  delete st.captured[id];
  st.discovered.push(r.id);
  state.news.push(r.id);
  return 'found';
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

/** Buys an upgrade's next level. (upgradeVisible also refuses a choice whose alternative is owned.) */
export function buyUpgrade(state: GameState, stage: StageId, id: string): boolean {
  const u = STAGES[stage].upgrades.find((x) => x.id === id);
  if (!u || !upgradeVisible(state, stage, u)) return false;
  const wallet = state.stages[payStage(stage, u)];
  const cost = upgradeCost(state, stage, u);
  if (wallet.currency.lt(cost)) return false;
  wallet.currency = wallet.currency.sub(cost);
  const st = state.stages[stage];
  const n = upgradeLevel(state, stage, id) + 1;
  if (!st.upgrades.includes(id)) st.upgrades.push(id);
  if (maxLevel(u) > 1) st.levels[id] = n;
  return true;
}

/** Switches the screen to an earlier (or the latest) stage. Everything keeps producing. */
export function visitStage(state: GameState, id: StageId): boolean {
  if (!state.unlocked.includes(id) || state.current === id) return false;
  state.current = id;
  return true;
}

/** The newest stage reached. */
export const frontier = (state: GameState): StageId => state.unlocked[state.unlocked.length - 1];

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
  if (!def.next || state.stages[state.current].complete) return false;
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
