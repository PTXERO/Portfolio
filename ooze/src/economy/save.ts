import { STAGES, STAGE_ORDER } from '../content/stages';
import { settleHabitat } from './actions';
import { createStageState, createState } from './state';
import { D } from './num';
import type { GameState, StageId, StageState } from './types';

const STORAGE_KEY = 'ooze-to-orbit/save';

type SavedStage = Omit<StageState, 'currency' | 'totalEarned'> & { currency: string; totalEarned: string };
type SavedGame = Omit<GameState, 'stages'> & { stages: Record<string, SavedStage> };

export function serialize(state: GameState): string {
  const stages: Record<string, SavedStage> = {};
  for (const id of STAGE_ORDER) {
    const st = state.stages[id];
    stages[id] = { ...st, currency: st.currency.toString(), totalEarned: st.totalEarned.toString() };
  }
  return JSON.stringify({ ...state, stages } satisfies SavedGame);
}

/** Restores a save, filling anything missing (new stages, new generators) with defaults. */
export function deserialize(text: string): GameState {
  const saved = JSON.parse(text) as SavedGame;
  if (saved.version !== 1) throw new Error(`Unsupported save version ${saved.version}`);
  const base = createState(saved.lastSeen);
  const stages = {} as Record<StageId, StageState>;
  for (const id of STAGE_ORDER) {
    const s = saved.stages[id];
    const fresh = createStageState(id, false);
    stages[id] = s
      ? {
          currency: D(s.currency),
          totalEarned: D(s.totalEarned),
          generators: { ...fresh.generators, ...s.generators },
          upgrades: [...s.upgrades],
          levels: { ...(s.levels ?? {}) },
          complete: s.complete,
          dials: { ...fresh.dials, ...s.dials },
          discovered: [...(s.discovered ?? [])],
          free: { ...(s.free ?? {}) },
          catalysis: { ...(s.catalysis ?? {}) },
          habitat: s.habitat || fresh.habitat,
          eaten: s.eaten ?? 0,
          acclim: { ...(s.acclim ?? {}) },
          captured: { ...(s.captured ?? {}) },
        }
      : base.stages[id];
    // Saves from before reactions existed: anything owned counts as discovered.
    const rs = STAGES[id].reactions ?? [];
    for (const g of STAGES[id].generators) {
      if (!g.unlockedBy || !(stages[id].generators[g.id] > 0)) continue;
      for (const r of rs.slice(0, rs.findIndex((x) => x.id === g.unlockedBy) + 1)) {
        if (!stages[id].discovered.includes(r.id)) stages[id].discovered.push(r.id);
      }
    }
  }
  // Saves from before the start flag existed: anyone who had played has started.
  const started = saved.started ?? (saved.playTime > 0 || saved.taps > 0);
  const state: GameState = { ...base, ...saved, stages, started, swirl: 0, news: [], made: [] };
  settleHabitat(state);
  return state;
}

/** Save as a copyable text string, for backups (iOS can clear web storage). */
export function exportSave(state: GameState): string {
  let bin = '';
  for (const b of new TextEncoder().encode(serialize(state))) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function importSave(code: string): GameState {
  const bytes = Uint8Array.from(atob(code.trim()), (c) => c.charCodeAt(0));
  return deserialize(new TextDecoder().decode(bytes));
}

export function saveToStorage(state: GameState): void {
  localStorage.setItem(STORAGE_KEY, serialize(state));
}

export function loadFromStorage(): GameState | null {
  const text = localStorage.getItem(STORAGE_KEY);
  return text ? deserialize(text) : null;
}

export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}
