import { sealed, tribeTick } from './tribal';
import { STAGES } from '../content/stages';
import { affordableCount, buyGenerator, buyUpgrade, catalyze, discoverReactions, SWIRL_FADE_PER_SEC, visibleUpgrades } from './actions';
import { creatureTick } from './creature';
import { shoreTick } from './shore';
import { ACCLIM_SEC, stageRate } from './rates';
import type { GameState, StageId } from './types';

export const TICK_SEC = 0.1;

/** Buys everything a stage can afford, top tier first. Finished stages no longer do this on
 * their own (the player goes back to grow them); the simulator still uses it. */
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
  // Sealed eras (everything before the Tribal) are gone: they neither earn nor change.
  const rates = state.unlocked.filter((id) => !sealed(state, id)).map((id) => [id, stageRate(state, id)] as const);
  for (const [id, rate] of rates) {
    const st = state.stages[id];
    const gain = rate.mul(dt);
    st.currency = st.currency.add(gain);
    st.totalEarned = st.totalEarned.add(gain);
  }
  // Known reactions keep making their products in every open stage, finished or not (they
  // used to stop once a stage was done, or while you were in another, and the Lab's countdowns
  // froze). New ones are found only in the stage you're in, until it's finished. (Reactions
  // run before the whirlpool fades, so a spin that's strong now counts now.)
  for (const id of state.unlocked) if (!sealed(state, id)) catalyze(state, id, dt);
  if (!state.stages[state.current].complete) discoverReactions(state, state.current);
  if (!sealed(state, 'creature')) creatureTick(state, dt);
  tribeTick(state, dt);
  shoreTick(state, dt);
  // Your cell settles into whichever habitat it's living in (Cell stage).
  for (const id of state.unlocked) {
    const st = state.stages[id];
    if (STAGES[id].habitats && st.habitat) st.acclim[st.habitat] = Math.min(1, (st.acclim[st.habitat] ?? 0) + dt / ACCLIM_SEC);
  }
  state.swirl = Math.max(0, state.swirl - SWIRL_FADE_PER_SEC * dt);
  state.playTime += dt;
  // The newest stage's own clock, for its finish screen (visits to old stages count toward it).
  const newest = state.stages[state.unlocked[state.unlocked.length - 1]];
  if (!newest.complete) newest.time += dt;
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
