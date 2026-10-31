import { STAGES, STAGE_ORDER } from '../content/stages';
import { randomGenes } from './genes';
import LZString from 'lz-string';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
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
  critters(state);
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

/**
 * Saves are compressed (lz-string): a few times smaller in the browser's storage, and as a
 * code to copy. The compressed forms carry a mark at the start, so older saves (plain JSON in
 * storage, plain base64 codes) are still read as they always were.
 */
const STORE_MARK = 'LZ1:';
/** Export codes: deflated and base64'd (~2); ~1 was lz-string's (read still). */
const CODE_MARK = '~2';
const CODE_MARK_LZ = '~1';

/** What a save leaves out: what's only for the moment (news not yet shown), and, past an era,
 * what only that era needed (the Extinction's long log once they're ashore). */
function slim(state: GameState): GameState {
  const shore = state.stages.shore.shore;
  const ex = state.stages.tribal.tribe?.ex;
  if (!shore && !(ex && state.current === 'shore')) return state;
  const copy: GameState = { ...state, stages: { ...state.stages } };
  if (shore) copy.stages.shore = { ...state.stages.shore, shore: { ...shore, news: shore.news.slice(-10) } };
  if (ex && state.current === 'shore') {
    const t = state.stages.tribal.tribe!;
    copy.stages.tribal = { ...state.stages.tribal, tribe: { ...t, ex: { ...ex, log: (ex.log ?? []).slice(-20), logN: ex.logN ?? ex.log?.length } } };
  }
  return copy;
}

/** The save as stored and exported (compact JSON). */
export function serializeSlim(state: GameState): string {
  // (Numbers to four places: no one can tell, and the save's a good deal smaller.)
  return JSON.stringify(JSON.parse(serialize(slim(state))), (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v));
}

/** They're critters, not people: clans named "the … people" in older saves are renamed, and
 * the Chronicle's older lines say critters too. */
function critters(state: GameState): void {
  const word = (s: string) => s.replace(/\bpeople\b/g, 'critters').replace(/\bPeople\b/g, 'Critters');
  for (const v of state.stages.shore.shore?.villages ?? []) v.name = word(v.name);
  for (const e of state.chronicle ?? []) e.text = word(e.text);
}

/** Save as a copyable text string, for backups (iOS can clear web storage). */
export function exportSave(state: GameState): string {
  const bytes = deflateSync(strToU8(serializeSlim(state)), { level: 9 });
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return CODE_MARK + btoa(bin);
}

/** The old kind of code: the save's JSON in plain base64. */
function exportPlain(state: GameState): string {
  let bin = '';
  for (const b of new TextEncoder().encode(serialize(state))) bin += String.fromCharCode(b);
  return btoa(bin);
}
export { exportPlain };

/**
 * Reads a save code. Forgiving about how it was copied: spaces, line breaks and stray
 * characters are dropped, and a few extra (or missing) characters at the end, as a phone's
 * copy and paste can add, are worked around.
 */
export function importSave(code: string): GameState {
  // A compressed code (from this version on).
  const at = code.indexOf(CODE_MARK);
  if (at >= 0 && at < 8) {
    const all = code.slice(at + CODE_MARK.length).replace(/[^A-Za-z0-9+/]/g, '');
    // (A character or three too many at the end, as a phone's copy and paste can add, is let go.)
    let firstError: unknown = null;
    for (let cut = 0; cut <= 3 && cut < all.length; cut++) {
      const body = all.slice(0, all.length - cut);
      try {
        const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
        return deserialize(strFromU8(inflateSync(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))));
      } catch (e) {
        firstError ??= e;
      }
    }
    throw firstError;
  }
  const lz = code.indexOf(CODE_MARK_LZ);
  if (lz >= 0 && lz < 8) {
    const text = LZString.decompressFromBase64(code.slice(lz + CODE_MARK_LZ.length).replace(/[^A-Za-z0-9+/=]/g, ''));
    if (!text) throw new Error('damaged save code');
    return deserialize(text);
  }
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
  localStorage.setItem(STORAGE_KEY, STORE_MARK + LZString.compressToUTF16(serializeSlim(state)));
}

export function loadFromStorage(): GameState | null {
  const text = localStorage.getItem(STORAGE_KEY);
  if (!text) return null;
  // (Older saves are plain JSON.)
  if (text.startsWith(STORE_MARK)) {
    const json = LZString.decompressFromUTF16(text.slice(STORE_MARK.length));
    if (!json) throw new Error('damaged save');
    return deserialize(json);
  }
  return deserialize(text);
}

export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}
