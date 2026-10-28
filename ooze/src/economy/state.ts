import { STAGES, STAGE_ORDER } from '../content/stages';
import { ZERO, D } from './num';
import type { GameState, StageId, StageState } from './types';

export const BASE_OFFLINE_CAP_SEC = 8 * 3600;

export function createStageState(id: StageId, opened: boolean): StageState {
  const def = STAGES[id];
  const generators: Record<string, number> = {};
  for (const g of def.generators) generators[g.id] = 0;
  if (opened) generators[def.generators[0].id] = def.startingGenerators;
  return { currency: ZERO, totalEarned: ZERO, generators, upgrades: [], complete: false, dials: { heat: 0, light: 0, charge: 0 }, discovered: [], free: {}, catalysis: {} };
}

export function createState(now = Date.now()): GameState {
  const stages = {} as Record<StageId, StageState>;
  for (const id of STAGE_ORDER) stages[id] = createStageState(id, id === 'soup');
  return {
    version: 1,
    current: 'soup',
    unlocked: ['soup'],
    stages,
    timeBank: 0,
    warp: 1,
    offlineCapSec: BASE_OFFLINE_CAP_SEC,
    lastSeen: now,
    playTime: 0,
    buyAmount: 1,
    taps: 0,
    started: false,
    swirl: 0,
    news: [],
    made: [],
  };
}

/** Deep copy, used by the simulator and tests. */
export function cloneState(s: GameState): GameState {
  const stages = {} as Record<StageId, StageState>;
  for (const id of STAGE_ORDER) {
    const st = s.stages[id];
    stages[id] = {
      currency: D(st.currency),
      totalEarned: D(st.totalEarned),
      generators: { ...st.generators },
      upgrades: [...st.upgrades],
      complete: st.complete,
      dials: { ...st.dials },
      discovered: [...st.discovered],
      free: { ...st.free },
      catalysis: { ...st.catalysis },
    };
  }
  return { ...s, unlocked: [...s.unlocked], stages, news: [...s.news], made: [...s.made] };
}
