// New Shore, the idle way: food is everything. Buy what brings it in (each one dearer than the
// last), house the critters who come of it (they grow by themselves, and every one of them makes
// the work go better), stoke the fire to hurry it, and let upgrades and the council take the
// work off your hands. The villages out on the island are won, one by one, for good.

import type { BuildId } from './shore';

/** What there is to buy that brings food in, or houses critters. */
export type GenId = 'forager' | 'camp' | 'weir' | 'lodge' | 'garden' | 'granary' | 'market' | 'foundry' | 'harbour' | 'forge' | 'caravan' | 'hut' | 'longhouse' | 'house' | 'townhouse';

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
  /** Only from this Age on (the Bronze Age's own). */
  age?: number;
  /** The building it shows as on the map (some of them: not every one). */
  shows?: BuildId;
}

export const GENS: GenDef[] = [
  { id: 'forager', name: 'Foragers', does: 'Pick what the land gives.', cost: 10, growth: 1.12, rate: 0.4 },
  { id: 'camp', name: 'Gathering camp', does: 'A lean-to for the gathering.', cost: 110, growth: 1.13, rate: 3, critters: 6, shows: 'camp' },
  { id: 'weir', name: 'Fishing weir', does: 'Fish swim in, not out.', cost: 1300, growth: 1.14, rate: 22, critters: 12, shows: 'weir' },
  { id: 'lodge', name: 'Hunting lodge', does: 'Hunters out, game back.', cost: 16e3, growth: 1.15, rate: 170, critters: 25, shows: 'lodge' },
  { id: 'garden', name: 'Gardens', does: 'Plant what they gathered.', cost: 2.2e5, growth: 1.15, rate: 1400, critters: 45, shows: 'garden' },
  { id: 'granary', name: 'Granary', does: 'Nothing spoils.', cost: 3.2e6, growth: 1.16, rate: 1.2e4, critters: 80, shows: 'granary' },
  { id: 'market', name: 'Market', does: 'The island trades here.', cost: 5e7, growth: 1.17, rate: 1e5, critters: 140, shows: 'market' },
  { id: 'foundry', name: 'Bronze works', does: 'Copper and tin, poured.', cost: 1.2e9, growth: 1.18, rate: 1.3e6, critters: 500, age: 3, shows: 'foundry' },
  { id: 'harbour', name: 'Harbour', does: 'Boats bring the sea in.', cost: 3e10, growth: 1.19, rate: 1.9e7, critters: 560, age: 3, shows: 'harbour' },
  { id: 'forge', name: 'Iron forge', does: 'Bog iron, beaten hard.', cost: 1e12, growth: 1.19, rate: 3.6e8, critters: 1000, age: 4, shows: 'forge' },
  { id: 'caravan', name: 'Caravans', does: 'Roads bring the island in.', cost: 3e13, growth: 1.2, rate: 6e9, critters: 1100, age: 4, shows: 'caravan' },
  { id: 'hut', name: 'Hut', does: 'Beds for 4.', cost: 25, growth: 1.18, room: 4, shows: 'hut' },
  { id: 'longhouse', name: 'Longhouse', does: 'Beds for 12.', cost: 2500, growth: 1.2, room: 12, critters: 30, shows: 'longhouse' },
  { id: 'townhouse', name: 'Town house', does: 'Beds for 120.', cost: 2e9, growth: 1.2, room: 120, critters: 1000, age: 4, shows: 'townhouse' },
  { id: 'house', name: 'Stone house', does: 'Beds for 40.', cost: 4e6, growth: 1.2, room: 40, critters: 500, age: 3, shows: 'house' },
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
  | { kind: 'work'; age: number }
  /** The fire: hotter at its hottest (adds to the most it can add), more fuel a stoke, slower
   * to burn down, or never cold below a floor. */
  | { kind: 'fire'; more: number }
  | { kind: 'fireFuel'; mult: number }
  | { kind: 'fireCool'; mult: number }
  | { kind: 'fireFloor'; floor: number }
  /** The fire's heat speeds births and ideas too (at half its strength on food). */
  | { kind: 'fireAll' }
  /** Things the village can do once it's learned how: buy ten at once, buy as many as there's
   * food for, a tender who stokes the fire, keepers of lore who choose what's thought about. */
  | { kind: 'feature'; feature: 'buy10' | 'buymax' | 'tender' | 'focus' }
  /** The Far Voice: a sign learned (the first also starts the praying), or prayer ×. */
  | { kind: 'voice'; miracle: 'bolt' | 'rain' | 'light' | 'awe' }
  | { kind: 'prayer'; mult: number };

export interface UpgradeDef {
  id: string;
  name: string;
  does: string;
  cost: number;
  fx: UpgradeFx;
  /** Shown once there are this many of a generator. */
  needGen?: [GenId, number];
  /** Only after this upgrade. */
  needUp?: string;
  /** Only once a village has been won. */
  needWon?: boolean;
  /** Shown once there are this many critters. */
  critters?: number;
  /** Only from this Age on. */
  age?: number;
}

/** Each generator, at 10, 25 and 50 of them, can be made twice as good (the village learns the
 * trade); and the rest: stoking, the council, the envoy, the scouts. The Great Works close each
 * Age (their own rules: see the culture). */
const DOUBLERS: UpgradeDef[] = GENS.filter((g) => g.rate).flatMap((g) =>
  ([10, 25, 50] as const).map((n, i) => ({
    id: `${g.id}${n}`,
    name: [`Better ${g.name.toLowerCase()}`, `Skilled ${g.name.toLowerCase()}`, `Master ${g.name.toLowerCase()}`][i],
    does: `${g.name} ×2.`,
    cost: Math.round(g.cost * [12, 60, 400][i]),
    fx: { kind: 'gen' as const, gen: g.id, mult: 2 },
    needGen: [g.id, n] as [GenId, number],
  })),
);

export const UPGRADES: UpgradeDef[] = [
  { id: 'stoke1', name: 'Dry kindling', does: 'Stoke ×2.', cost: 50, fx: { kind: 'tap', mult: 2 } },
  { id: 'stoke2', name: 'A good blaze', does: 'Each stoke: +1s of food.', cost: 3000, fx: { kind: 'tapRate', share: 1 }, critters: 10 },
  { id: 'stoke3', name: 'The fire-keepers', does: 'Each stoke: +5s of food.', cost: 2e5, fx: { kind: 'tapRate', share: 4 }, critters: 40 },
  // The fire's own line: a hotter fire, easier to build up, slower to die down.
  { id: 'firering', name: 'A ring of stones', does: 'Fire max: food ×2.5.', cost: 600, fx: { kind: 'fire', more: 0.5 }, critters: 6 },
  { id: 'tinder', name: 'Tinder and kindling', does: 'Stokes add 2× fuel.', cost: 2500, fx: { kind: 'fireFuel', mult: 2 }, critters: 10 },
  { id: 'woodpile', name: 'A woodpile', does: 'Fire burns down 2× slower.', cost: 9000, fx: { kind: 'fireCool', mult: 0.5 }, critters: 16 },
  { id: 'firepit', name: 'A fire pit', does: 'Fire max: food ×3.5.', cost: 2e5, fx: { kind: 'fire', more: 1 }, critters: 35 },
  { id: 'embers', name: 'Banked embers', does: 'Fire never below ¼ heat.', cost: 4e6, fx: { kind: 'fireFloor', floor: 0.25 }, critters: 70 },
  { id: 'logs', name: 'Great logs', does: 'Stokes add 3× fuel.', cost: 3e7, fx: { kind: 'fireFuel', mult: 3 }, critters: 110 },
  { id: 'bonfire', name: 'The bonfire', does: 'Fire max: food ×6.', cost: 1e8, fx: { kind: 'fire', more: 2.5 }, critters: 140 },
  { id: 'tender', name: 'A fire-tender', does: 'Feeds the fire every second.', cost: 1500, fx: { kind: 'feature', feature: 'tender' }, critters: 10 },
  { id: 'warmth', name: 'Warm nights', does: 'The fire speeds births and ideas too.', cost: 4e5, fx: { kind: 'fireAll' }, critters: 45 },
  { id: 'tally', name: 'Tally sticks', does: 'Buy ×10.', cost: 200, fx: { kind: 'feature', feature: 'buy10' }, critters: 6 },
  { id: 'counting', name: 'Counting stones', does: 'Buy Max.', cost: 6000, fx: { kind: 'feature', feature: 'buymax' }, critters: 14 },
  { id: 'lore', name: 'Lore-keepers', does: 'Focus a culture lane: its ideas ×2.', cost: 3e6, fx: { kind: 'feature', feature: 'focus' }, critters: 100 },
  // The Far Voice: prayer at the fire, and the signs worked with it.
  { id: 'listen', name: 'Listening at night', does: 'They pray at the fire. Sign: the Bolt.', cost: 1500, fx: { kind: 'voice', miracle: 'bolt' }, critters: 10 },
  { id: 'rainsong', name: 'The rain song', does: 'Sign: Rain.', cost: 2e4, fx: { kind: 'voice', miracle: 'rain' }, critters: 25 },
  { id: 'seers', name: 'Seers', does: 'Sign: Light in the fog.', cost: 2e5, fx: { kind: 'voice', miracle: 'light' }, critters: 40 },
  { id: 'awe', name: 'The awe', does: 'Sign: Awe.', cost: 3e6, fx: { kind: 'voice', miracle: 'awe' }, critters: 70 },
  { id: 'vigils', name: 'Night vigils', does: 'Prayer ×2, holds ×2.', cost: 5e7, fx: { kind: 'prayer', mult: 2 }, critters: 120 },
  // The council: first it only buys gatherers and homes; it learns to save for the Great Work,
  // then to buy upgrades too.
  { id: 'council', name: 'The council', does: 'Buys gatherers and homes for you.', cost: 800, fx: { kind: 'auto' }, critters: 12, age: 2 },
  { id: 'council2', name: 'Elders who plan', does: 'The council saves for the Great Work, and raises it.', cost: 1e6, fx: { kind: 'auto' }, critters: 200, age: 2, needUp: 'council' },
  { id: 'council3', name: 'A council of the wise', does: 'The council buys upgrades too.', cost: 1e9, fx: { kind: 'auto' }, critters: 500, age: 3, needUp: 'council2' },
  { id: 'envoy', name: 'An envoy', does: 'Gifts kin for you.', cost: 2000, fx: { kind: 'envoy' }, critters: 15, needWon: true },
  { id: 'scouts', name: 'Scouts', does: 'Two scouts explore the fog.', cost: 400, fx: { kind: 'scouts' }, critters: 8 },
  { id: 'feast1', name: 'Feast days', does: 'All food ×1.25.', cost: 5e4, fx: { kind: 'all', mult: 1.25 }, critters: 30 },
  { id: 'games', name: 'The great games', does: 'All food ×2.', cost: 5e10, fx: { kind: 'all', mult: 2 }, critters: 900 },
  { id: 'bronzetools', name: 'Bronze tools', does: 'All food ×1.5.', cost: 2e9, fx: { kind: 'all', mult: 1.5 }, critters: 500, age: 3 },
  { id: 'ironworks', name: 'Ironworks', does: 'All food ×1.5.', cost: 5e12, fx: { kind: 'all', mult: 1.5 }, critters: 1000, age: 4 },
  { id: 'aqueduct', name: 'The aqueduct', does: 'All food ×2.', cost: 1e15, fx: { kind: 'all', mult: 2 }, critters: 1150, age: 4 },
  { id: 'feast2', name: 'The harvest festival', does: 'All food ×1.5.', cost: 4e6, fx: { kind: 'all', mult: 1.5 }, critters: 90 },
  ...DOUBLERS,
];

/** The Great Works: one closes each Age (bought with food once the culture's ready for it),
 * and the village round the hearth holds more after it. */
export const WORKS: { id: BuildId; age: number; name: string; does: string; cost: number; most: number }[] = [
  { id: 'greathearth', age: 1, name: 'The Great Hearth', does: 'Ends the Hearth Age. Holds 300.', cost: 4e5, most: 300 },
  { id: 'square', age: 2, name: 'The Town Square', does: 'Ends the Village Age. Holds 600.', cost: 6e7, most: 600 },
  { id: 'hall', age: 3, name: 'The Chief\'s Hall', does: 'Ends the Bronze Age. Holds 1200.', cost: 1e17, most: 1200 },
  { id: 'forum', age: 4, name: 'The Forum', does: 'Ends the Iron Age. Holds 2400.', cost: 6e20, most: 2400 },
];

/** What embers buy: for good, on every island after (each has levels, dearer each time). Spending
 * embers never takes from their passive boost: that goes by every ember ever brought. */
export type PerkId = 'seed' | 'crew' | 'trades' | 'coals' | 'fireborn' | 'warsongs' | 'charts' | 'council' | 'envoy' | 'tender';
export const PERKS: { id: PerkId; name: string; does: string; cost: number; growth: number; most: number }[] = [
  { id: 'seed', name: 'Seed stores', does: 'Land with ×10 food.', cost: 2, growth: 2, most: 6 },
  { id: 'trades', name: 'Remembered trades', does: 'All gatherers ×2.', cost: 4, growth: 3, most: 10 },
  { id: 'fireborn', name: 'Born of the fire', does: 'Births +25%.', cost: 3, growth: 2, most: 10 },
  { id: 'coals', name: 'Carried coals', does: 'Fire max: food +0.5.', cost: 3, growth: 2, most: 8 },
  { id: 'crew', name: 'A bigger raft', does: 'Raft carries one more.', cost: 5, growth: 2, most: 4 },
  { id: 'warsongs', name: 'War songs', does: 'Beating a village: 15% fewer critters.', cost: 6, growth: 2, most: 3 },
  { id: 'charts', name: 'Charts', does: 'Land knowing every village.', cost: 12, growth: 1, most: 1 },
  // (Who they bring the know-how of: without these, each island learns it all again.)
  { id: 'tender', name: 'A tender remembered', does: 'Land with the fire-tender.', cost: 5, growth: 1, most: 1 },
  { id: 'envoy', name: 'An envoy remembered', does: 'Land with the envoy.', cost: 8, growth: 1, most: 1 },
  { id: 'council', name: 'The council remembered', does: 'Land with the council, all it knew.', cost: 15, growth: 1, most: 1 },
];

/** What an island is like (each one after the first has a nature, seen from the raft before
 * setting out): it changes the run there, and what it's worth in embers when they leave. */
export type NatureId = 'still' | 'lush' | 'waters' | 'game' | 'fertile' | 'kin' | 'warlike' | 'stormy' | 'barren';
export interface NatureDef {
  id: NatureId;
  name: string;
  does: string;
  food?: number;
  gens?: Partial<Record<GenId, number>>;
  births?: number;
  gift?: number;
  take?: number;
  cool?: number;
  tap?: number;
  embers?: number;
}
export const NATURES: NatureDef[] = [
  { id: 'still', name: 'A quiet island', does: 'Nothing strange.' },
  { id: 'lush', name: 'A lush island', does: 'Foragers and gardens ×2.', gens: { forager: 2, garden: 2 } },
  { id: 'waters', name: 'Teeming waters', does: 'Weirs ×3.', gens: { weir: 3 } },
  { id: 'game', name: 'Game country', does: 'Hunting lodges ×3.', gens: { lodge: 3 } },
  { id: 'fertile', name: 'A fertile island', does: 'Births +50%.', births: 1.5 },
  { id: 'kin', name: 'Kin country', does: 'Gifts win ×2 trust.', gift: 2 },
  { id: 'warlike', name: 'A warlike island', does: 'Beating villages ×2 food. Embers ×1.5.', take: 2, embers: 1.5 },
  { id: 'stormy', name: 'A stormy island', does: 'Fire burns down 2× faster. Stokes ×3.', cool: 2, tap: 3 },
  { id: 'barren', name: 'A barren island', does: 'All food ×0.6. Embers ×2.', food: 0.6, embers: 2 },
];

/** The Far Voice's signs, worked with prayer at the Hearth (each learned by an upgrade). */
export type MiracleId = 'bolt' | 'rain' | 'light' | 'awe';
export const MIRACLES: { id: MiracleId; name: string; does: string; cost: number }[] = [
  { id: 'bolt', name: 'Bolt', does: 'Fire white-hot: its boost ×2 for 30s.', cost: 30 },
  { id: 'rain', name: 'Rain', does: 'Births ×3 for a day.', cost: 40 },
  { id: 'light', name: 'Light', does: 'Shows a hidden village or landmark.', cost: 50 },
  { id: 'awe', name: 'Awe', does: 'A village half won.', cost: 60 },
];
