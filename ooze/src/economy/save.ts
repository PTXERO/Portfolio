import { STAGES, STAGE_ORDER } from '../content/stages';
import { settleHabitat } from './actions';
import { createStageState, createState } from './state';
import { D } from './num';
import { packSeen, unpackSeen } from './island';
import type { GameState, StageId, StageState } from './types';

const STORAGE_KEY = 'ooze-to-orbit/save';

type SavedStage = Omit<StageState, 'currency' | 'totalEarned' | 'seen'> & { currency: string; totalEarned: string; seen: string };
type SavedGame = Omit<GameState, 'stages'> & { stages: Record<string, SavedStage> };

export function serialize(state: GameState): string {
  const stages: Record<string, SavedStage> = {};
  for (const id of STAGE_ORDER) {
    const st = state.stages[id];
    stages[id] = { ...st, currency: st.currency.toString(), totalEarned: st.totalEarned.toString(), seen: id === 'creature' ? packSeen(st.seen) : '' };
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
          time: s.time ?? 0,
          parts: s.parts ?? fresh.parts,
          equipped: s.equipped ?? fresh.equipped,
          // Saves from before the island: a new one is rolled (and old trips start over).
          seed: s.seed ?? fresh.seed,
          pos: s.seed !== undefined && s.pos ? s.pos : fresh.pos,
          seen: s.seed !== undefined ? unpackSeen(s.seen) : fresh.seen,
          walk: s.seed !== undefined ? (s.walk ?? null) : null,
          autoRoam: s.autoRoam ?? true,
          nextFind: s.nextFind ?? 0,
          parties: s.seed !== undefined ? (s.parties ?? []) : [],
          partyReady: s.seed !== undefined ? { ...(s.partyReady ?? {}) } : {},
          sightings: { ...(s.sightings ?? {}) },
          nests: s.seed !== undefined ? [...(s.nests ?? [])] : [],
          trips: s.seed !== undefined ? { ...(s.trips ?? {}) } : {},
          mates: s.mates ?? [],
          egg: s.egg ?? null,
          generation: s.generation ?? 0,
          pop: s.pop ?? fresh.pop,
          roles: { ...fresh.roles, ...(s.roles ?? {}) },
          year: s.year ?? 0,
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
  // Older saves could hold two choices that now exclude each other (two diets): keep the later one.
  for (const id of STAGE_ORDER) {
    const st = stages[id];
    for (const u of [...STAGES[id].upgrades].reverse()) {
      if (st.upgrades.includes(u.id)) st.upgrades = st.upgrades.filter((x) => !(u.excludes ?? []).includes(x));
    }
  }
  const state: GameState = { ...base, ...saved, stages, started, swirl: 0, news: [], made: [], reports: saved.reports ?? [] };
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
