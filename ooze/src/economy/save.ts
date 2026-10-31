import { STAGES, STAGE_ORDER } from '../content/stages';
import { randomGenes } from './genes';
import { settleHabitat } from './actions';
import { MAX_SURVIVORS } from './tribal';
import { SHORE_CELLS } from './shore';
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
    stages[id] = { ...st, currency: st.currency.toString(), totalEarned: st.totalEarned.toString(), seen: id === 'creature' || id === 'shore' ? packSeen(st.seen) : '' };
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
          seen: id === 'shore' ? unpackSeen(s.seen, SHORE_CELLS) : s.seed !== undefined ? unpackSeen(s.seen) : fresh.seen,
          walk: s.seed !== undefined ? (s.walk ?? null) : null,
          autoRoam: s.autoRoam ?? true,
          roamOpts: { ...fresh.roamOpts, ...(s.roamOpts ?? {}) },
          nextFind: s.nextFind ?? 0,
          parties: s.seed !== undefined ? (s.parties ?? []) : [],
          partyReady: s.seed !== undefined ? { ...(s.partyReady ?? {}) } : {},
          sightings: { ...(s.sightings ?? {}) },
          shore: s.shore ? structuredClone(s.shore) : undefined,
          tribe: s.tribe ? { ...s.tribe, look: { ...s.tribe.look, parts: { ...s.tribe.look.parts } }, stats: { ...s.tribe.stats } } : undefined,
          nests: s.seed !== undefined ? [...(s.nests ?? [])] : [],
          nestSettle: s.seed !== undefined ? { ...(s.nestSettle ?? {}) } : {},
          trips: s.seed !== undefined ? { ...(s.trips ?? {}) } : {},
          // (Mates met before looks were kept get theirs now.)
          mates: (s.mates ?? []).map((m) => (m.genes ? m : { ...m, genes: randomGenes(Math.random) })),
          egg: s.egg ? { ...s.egg, mate: s.egg.mate.genes ? s.egg.mate : { ...s.egg.mate, genes: randomGenes(Math.random) } } : null,
          genes: s.genes,
          line: s.line,
          generation: s.generation ?? 0,
          keepBreeding: s.keepBreeding ?? true,
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
  capTribe(state);
  return state;
}

/** A tribe from before there was a limit (a great herd's quarter) is brought down to it: more
 * than the Extinction is made for, it was slow to run and to draw. Those let go take their
 * bonds with them; the leader and the raft's four stay if they can. */
function capTribe(state: GameState): void {
  const t = state.stages.tribal.tribe;
  if (!t) return;
  t.survivors = Math.min(t.survivors, MAX_SURVIVORS);
  t.pop = Math.min(t.pop, MAX_SURVIVORS);
  const ex = t.ex;
  if (!ex || ex.people.length <= MAX_SURVIVORS) return;
  const keep = new Set([ex.leader, ...(ex.family ?? [])]);
  const first = ex.people.filter((p) => keep.has(p.id));
  ex.people = [...first, ...ex.people.filter((p) => !keep.has(p.id))].slice(0, MAX_SURVIVORS);
  const ids = new Set(ex.people.map((p) => p.id));
  for (const p of ex.people) p.bonds = (p.bonds ?? []).filter((b) => ids.has(b.id));
  ex.family = (ex.family ?? []).filter((id) => ids.has(id));
  if (ex.leader !== undefined && !ids.has(ex.leader)) ex.leader = undefined;
  if (ex.whisper && ex.whisper.who.some((id) => !ids.has(id))) ex.whisper = undefined;
  if (ex.crisis?.who !== undefined && !ids.has(ex.crisis.who)) ex.crisis = undefined;
}

/** Save as a copyable text string, for backups (iOS can clear web storage). */
export function exportSave(state: GameState): string {
  let bin = '';
  for (const b of new TextEncoder().encode(serialize(state))) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Reads a save code. Forgiving about how it was copied: spaces, line breaks and stray
 * characters are dropped, and a few extra (or missing) characters at the end, as a phone's
 * copy and paste can add, are worked around.
 */
export function importSave(code: string): GameState {
  const clean = code.replace(/[^A-Za-z0-9+/]/g, '');
  let firstError: unknown = null;
  for (let cut = 0; cut <= 3 && cut < clean.length; cut++) {
    const body = clean.slice(0, clean.length - cut);
    try {
      const bytes = Uint8Array.from(atob(body + '='.repeat((4 - (body.length % 4)) % 4)), (c) => c.charCodeAt(0));
      return deserialize(new TextDecoder().decode(bytes));
    } catch (e) {
      firstError ??= e;
    }
  }
  throw firstError ?? new Error('empty save code');
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
