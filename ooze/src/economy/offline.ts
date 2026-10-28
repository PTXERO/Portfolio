import { D } from './num';
import { tick } from './tick';
import type { Decimal } from './num';
import type { GameState, StageId } from './types';

/** Share of time away applied at once; the rest goes into the time bank. */
export const OFFLINE_APPLIED_SHARE = 0.8;
/** Shorter absences are simply caught up, with nothing banked. */
export const OFFLINE_MIN_SEC = 30;
/** Offline time is simulated in at most this many steps. */
const MAX_STEPS = 600;

export interface OfflineReport {
  awaySec: number;
  appliedSec: number;
  bankedSec: number;
  capped: boolean;
  earned: Partial<Record<StageId, Decimal>>;
}

/** The time bank holds up to a quarter of the offline cap. */
export function timeBankCap(state: GameState): number {
  return state.offlineCapSec / 4;
}

/** Catches the state up to `now`. Same tick math as live play, in bigger steps. */
export function applyOffline(state: GameState, now = Date.now()): OfflineReport {
  const raw = Math.max(0, (now - state.lastSeen) / 1000);
  const away = Math.min(raw, state.offlineCapSec);
  const short = away < OFFLINE_MIN_SEC;
  const applied = short ? away : away * OFFLINE_APPLIED_SHARE;
  const banked = short ? 0 : Math.min(away - applied, timeBankCap(state) - state.timeBank);

  const before = new Map(state.unlocked.map((id) => [id, D(state.stages[id].totalEarned)]));
  simulate(state, applied);
  state.timeBank += Math.max(0, banked);
  state.lastSeen = now;

  const earned: OfflineReport['earned'] = {};
  for (const [id, was] of before) earned[id] = state.stages[id].totalEarned.sub(was);
  return { awaySec: raw, appliedSec: applied, bankedSec: Math.max(0, banked), capped: raw > state.offlineCapSec, earned };
}

/** Runs `seconds` of game time in steps between 0.1 s and 60 s. */
export function simulate(state: GameState, seconds: number): void {
  if (seconds <= 0) return;
  const step = Math.min(60, Math.max(0.1, seconds / MAX_STEPS));
  let left = seconds;
  while (left > 1e-9) {
    const dt = Math.min(step, left);
    tick(state, dt);
    left -= dt;
  }
}
