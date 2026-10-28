import { STAGES } from '../content/stages';
import { affordableCount, buyGenerator, buyUpgrade, catalyze, discoverReactions, SWIRL_FADE_PER_SEC, visibleUpgrades } from './actions';
import { stageRate } from './rates';
import type { GameState, StageId } from './types';

export const TICK_SEC = 0.1;

/** A finished stage runs itself: it buys everything it can afford, top tier first. */
export function autobuy(state: GameState, stage: StageId): void {
  for (const u of visibleUpgrades(state, stage)) buyUpgrade(state, stage, u.id);
  const gens = STAGES[stage].generators;
  for (let i = gens.length - 1; i >= 0; i--) {
    buyGenerator(state, stage, gens[i].id, affordableCount(state, stage, gens[i].id));
  }
}

/** Advances the economy by `dt` game seconds. Every open stage keeps producing. */
export function tick(state: GameState, dt: number): void {
  if (!state.started) return;
  // Rates are read before any currency moves so the order of stages doesn't matter.
  const rates = state.unlocked.map((id) => [id, stageRate(state, id)] as const);
  for (const [id, rate] of rates) {
    const st = state.stages[id];
    const gain = rate.mul(dt);
    st.currency = st.currency.add(gain);
    st.totalEarned = st.totalEarned.add(gain);
  }
  for (const id of state.unlocked) if (state.stages[id].complete) autobuy(state, id);
  // Reactions are checked before the whirlpool fades, so a spin that's strong now counts now.
  if (!state.stages[state.current].complete) {
    catalyze(state, state.current, dt);
    discoverReactions(state, state.current);
  }
  state.swirl = Math.max(0, state.swirl - SWIRL_FADE_PER_SEC * dt);
  state.playTime += dt;
}

/**
 * Live play: `realDt` wall-clock seconds pass. While warp is on and the time bank
 * has seconds left, the game runs faster and drains the bank by the extra time.
 */
export function liveTick(state: GameState, realDt: number): void {
  let mult = 1;
  if (state.warp > 1 && state.timeBank > 0) {
    mult = Math.min(state.warp, 1 + state.timeBank / realDt);
    state.timeBank = Math.max(0, state.timeBank - realDt * (mult - 1));
    if (state.timeBank === 0) state.warp = 1;
  }
  tick(state, realDt * mult);
}
