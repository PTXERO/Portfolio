import { STAGES, STAGE_ORDER } from '../content/stages';
import { ZERO, D } from './num';
import { CELLS } from './island';
import type { GameState, StageDef, StageId, StageState } from './types';

export const BASE_OFFLINE_CAP_SEC = 8 * 3600;

/** The Creature stage starts with the free parts (no price) worn, one per slot. */
/** A fresh island for a new Creature: just its seed. The island itself is rolled the
 * first time it's needed (see islandFor), which also puts the creature at home. */
export function newIsland(def: StageDef, seed = Math.floor(Math.random() * 2 ** 31)): Pick<StageState, 'seed' | 'pos' | 'seen' | 'walk' | 'autoRoam' | 'nextFind' | 'parties' | 'partyReady' | 'sightings' | 'nests' | 'nestSettle' | 'roamOpts'> {
  return { seed: def.places ? seed : 0, pos: { x: -1, y: -1 }, seen: new Uint8Array(CELLS * CELLS), walk: null, autoRoam: true, roamOpts: { places: true, settle: true, mandatory: false, policy: 'ready' }, nextFind: 0, parties: [], partyReady: {}, sightings: {}, nests: [], nestSettle: {} };
}

function creatureStart(def: StageDef): Pick<StageState, 'parts' | 'equipped' | 'seed' | 'pos' | 'seen' | 'walk' | 'autoRoam' | 'nextFind' | 'parties' | 'partyReady' | 'sightings' | 'nests' | 'nestSettle' | 'roamOpts' | 'trips' | 'mates' | 'egg' | 'generation' | 'keepBreeding' | 'pop' | 'roles' | 'year'> {
  const starters = (def.parts ?? []).filter((p) => p.cost === 0);
  const equipped: StageState['equipped'] = {};
  for (const p of starters) equipped[p.slot] ??= p.id;
  return {
    parts: starters.map((p) => p.id),
    equipped,
    ...newIsland(def),
    trips: {},
    mates: [],
    egg: null,
    generation: 0,
    keepBreeding: true,
    pop: def.places ? 3 : 0,
    roles: { forager: 0, carer: 0, digger: 0, guard: 0, scout: 0 },
    year: 0,
  };
}

export function createStageState(id: StageId, opened: boolean): StageState {
  const def = STAGES[id];
  const generators: Record<string, number> = {};
  for (const g of def.generators) generators[g.id] = 0;
  if (opened && def.generators[0]) generators[def.generators[0].id] = def.startingGenerators;
  return { currency: ZERO, totalEarned: ZERO, generators, upgrades: [], levels: {}, complete: false, dials: { heat: 0, light: 0, charge: 0 }, discovered: [], free: {}, catalysis: {}, habitat: def.habitats?.[0].id ?? '', eaten: 0, acclim: {}, captured: {}, time: 0, ...creatureStart(def) };
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
    reports: [],
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
      levels: { ...st.levels },
      complete: st.complete,
      dials: { ...st.dials },
      discovered: [...st.discovered],
      free: { ...st.free },
      catalysis: { ...st.catalysis },
      habitat: st.habitat,
      eaten: st.eaten,
      acclim: { ...st.acclim },
      captured: { ...st.captured },
      time: st.time,
      parts: [...st.parts],
      equipped: { ...st.equipped },
      seed: st.seed,
      pos: { ...st.pos },
      seen: st.seen.slice(),
      walk: st.walk && { ...st.walk, event: st.walk.event && { ...st.walk.event } },
      autoRoam: st.autoRoam,
      roamOpts: { ...st.roamOpts },
      nextFind: st.nextFind,
      parties: st.parties.map((p) => ({ ...p })),
      partyReady: { ...st.partyReady },
      sightings: { ...st.sightings },
      tribe: st.tribe && { ...st.tribe, look: { ...st.tribe.look, parts: { ...st.tribe.look.parts } }, stats: { ...st.tribe.stats }, ex: st.tribe.ex && JSON.parse(JSON.stringify(st.tribe.ex)) },
      nests: [...st.nests],
      nestSettle: { ...st.nestSettle },
      trips: { ...st.trips },
      mates: st.mates.map((m) => ({ ...m, parts: { ...m.parts } })),
      egg: st.egg && { ...st.egg, mate: { ...st.egg.mate, parts: { ...st.egg.mate.parts } } },
      generation: st.generation,
      keepBreeding: st.keepBreeding,
      pop: st.pop,
      roles: { ...st.roles },
      year: st.year,
    };
  }
  return { ...s, unlocked: [...s.unlocked], stages, news: [...s.news], made: [...s.made], reports: [...s.reports] };
}
