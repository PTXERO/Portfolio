// New Shore, the idle way: food is everything. Buy what brings it in (each one dearer than the
// last), house the critters who come of it (they grow by themselves, and every one of them makes
// the work go better), stoke the fire to hurry it, and let upgrades and the council take the
// work off your hands. The villages out on the island are won, one by one, for good.

import type { BuildId } from './shore';

/** What there is to buy that brings food in, or houses critters. */
export type GenId = 'forager' | 'camp' | 'weir' | 'lodge' | 'garden' | 'granary' | 'market' | 'hut' | 'longhouse';

export interface GenDef {
  id: GenId;
  name: string;
  does: string;
  /** Food the first costs; each after costs `growth` times the one before. */
  cost: number;
  growth: number;
  /** Food a second each brings in (none: a home). */
  rate?: number;
  /** Critters each houses. */
  room?: number;
  /** Shown once there are this many critters (the island opens up as they grow). */
  critters?: number;
  /** The building it shows as on the map (some of them: not every one). */
  shows?: BuildId;
}

export const GENS: GenDef[] = [
  { id: 'forager', name: 'Foragers', does: 'Critters out picking what the land gives.', cost: 10, growth: 1.12, rate: 0.4 },
  { id: 'camp', name: 'Gathering camp', does: 'A lean-to out on the land, where the gathering\'s brought in.', cost: 110, growth: 1.13, rate: 3, critters: 6, shows: 'camp' },
  { id: 'weir', name: 'Fishing weir', does: 'Stakes across the water: the fish swim in and can\'t get out.', cost: 1300, growth: 1.14, rate: 22, critters: 12, shows: 'weir' },
  { id: 'lodge', name: 'Hunting lodge', does: 'Where the hunters set out from, and bring the game back to.', cost: 16e3, growth: 1.15, rate: 170, critters: 25, shows: 'lodge' },
  { id: 'garden', name: 'Gardens', does: 'What they gathered, planted: it grows where they want it.', cost: 2.2e5, growth: 1.15, rate: 1400, critters: 45, shows: 'garden' },
  { id: 'granary', name: 'Granary', does: 'Stores raised off the ground: nothing spoils, everything goes further.', cost: 3.2e6, growth: 1.16, rate: 1.2e4, critters: 80, shows: 'granary' },
  { id: 'market', name: 'Market', does: 'Market days: the island\'s plenty comes to the hearth.', cost: 5e7, growth: 1.17, rate: 1e5, critters: 140, shows: 'market' },
  { id: 'hut', name: 'Hut', does: 'Room for 4 more critters.', cost: 25, growth: 1.18, room: 4, shows: 'hut' },
  { id: 'longhouse', name: 'Longhouse', does: 'A long hall of beds: room for 12.', cost: 2500, growth: 1.2, room: 12, critters: 30, shows: 'longhouse' },
];

/** An upgrade: bought once, for good. */
export type UpgradeFx =
  | { kind: 'gen'; gen: GenId; mult: number }
  | { kind: 'all'; mult: number }
  | { kind: 'tap'; mult: number }
  | { kind: 'tapRate'; share: number }
  | { kind: 'auto' }
  | { kind: 'envoy' }
  | { kind: 'scouts' }
  | { kind: 'work'; age: number };

export interface UpgradeDef {
  id: string;
  name: string;
  does: string;
  cost: number;
  fx: UpgradeFx;
  /** Shown once there are this many of a generator. */
  needGen?: [GenId, number];
  /** Shown once there are this many critters. */
  critters?: number;
}

/** Each generator, at 10, 25 and 50 of them, can be made twice as good (the village learns the
 * trade); and the rest: stoking, the council, the envoy, the scouts. The Great Works close each
 * Age (their own rules: see the culture). */
const DOUBLERS: UpgradeDef[] = GENS.filter((g) => g.rate).flatMap((g) =>
  ([10, 25, 50] as const).map((n, i) => ({
    id: `${g.id}${n}`,
    name: [`Better ${g.name.toLowerCase()}`, `Skilled ${g.name.toLowerCase()}`, `Master ${g.name.toLowerCase()}`][i],
    does: `${g.name} bring in twice as much.`,
    cost: Math.round(g.cost * [12, 60, 400][i]),
    fx: { kind: 'gen' as const, gen: g.id, mult: 2 },
    needGen: [g.id, n] as [GenId, number],
  })),
);

export const UPGRADES: UpgradeDef[] = [
  { id: 'stoke1', name: 'Dry kindling', does: 'Stoking the fire brings twice as much.', cost: 50, fx: { kind: 'tap', mult: 2 } },
  { id: 'stoke2', name: 'A good blaze', does: 'Stoking the fire brings in a second\'s worth of everything else too.', cost: 3000, fx: { kind: 'tapRate', share: 1 }, critters: 10 },
  { id: 'stoke3', name: 'The fire-keepers', does: 'Stoking brings in five seconds\' worth.', cost: 2e5, fx: { kind: 'tapRate', share: 4 }, critters: 40 },
  { id: 'council', name: 'The council', does: 'The elders buy what\'s most worth buying, by themselves, whenever there\'s the food (turn it off and on in the Build tab).', cost: 800, fx: { kind: 'auto' }, critters: 12 },
  { id: 'envoy', name: 'An envoy', does: 'Carries gifts to the kin being won over, by themselves, when there\'s food to spare.', cost: 2000, fx: { kind: 'envoy' }, critters: 15 },
  { id: 'scouts', name: 'Scouts', does: 'Two scouts go out into the fog by themselves, finding villages and landmarks.', cost: 400, fx: { kind: 'scouts' }, critters: 8 },
  { id: 'feast1', name: 'Feast days', does: 'Everything brings in a quarter more.', cost: 5e4, fx: { kind: 'all', mult: 1.25 }, critters: 30 },
  { id: 'feast2', name: 'The harvest festival', does: 'Everything brings in half again as much.', cost: 4e6, fx: { kind: 'all', mult: 1.5 }, critters: 90 },
  ...DOUBLERS,
];

/** The Great Works: one closes each Age (bought with food once the culture's ready for it),
 * and the village round the hearth holds more after it. */
export const WORKS: { id: BuildId; age: number; name: string; does: string; cost: number; most: number }[] = [
  { id: 'greathearth', age: 1, name: 'The Great Hearth', does: 'A fire for all of them at once: it closes the Hearth Age, and the village round it holds 300.', cost: 4e5, most: 300 },
  { id: 'square', age: 2, name: 'The Town Square', does: 'Flagstones round a standing stone: it closes the Village Age, and the village round it holds 600.', cost: 6e7, most: 600 },
];
