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
  { id: 'forager', name: 'Foragers', does: 'Pick what the land gives.', cost: 10, growth: 1.12, rate: 0.4 },
  { id: 'camp', name: 'Gathering camp', does: 'A lean-to for the gathering.', cost: 110, growth: 1.13, rate: 3, critters: 6, shows: 'camp' },
  { id: 'weir', name: 'Fishing weir', does: 'Fish swim in, not out.', cost: 1300, growth: 1.14, rate: 22, critters: 12, shows: 'weir' },
  { id: 'lodge', name: 'Hunting lodge', does: 'Hunters out, game back.', cost: 16e3, growth: 1.15, rate: 170, critters: 25, shows: 'lodge' },
  { id: 'garden', name: 'Gardens', does: 'Plant what they gathered.', cost: 2.2e5, growth: 1.15, rate: 1400, critters: 45, shows: 'garden' },
  { id: 'granary', name: 'Granary', does: 'Nothing spoils.', cost: 3.2e6, growth: 1.16, rate: 1.2e4, critters: 80, shows: 'granary' },
  { id: 'market', name: 'Market', does: 'The island trades here.', cost: 5e7, growth: 1.17, rate: 1e5, critters: 140, shows: 'market' },
  { id: 'hut', name: 'Hut', does: 'Beds for 4.', cost: 25, growth: 1.18, room: 4, shows: 'hut' },
  { id: 'longhouse', name: 'Longhouse', does: 'Beds for 12.', cost: 2500, growth: 1.2, room: 12, critters: 30, shows: 'longhouse' },
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
  | { kind: 'feature'; feature: 'buy10' | 'buymax' | 'tender' | 'focus' };

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
  { id: 'tender', name: 'A fire-tender', does: 'Feeds the fire every 2s.', cost: 1500, fx: { kind: 'feature', feature: 'tender' }, critters: 10 },
  { id: 'warmth', name: 'Warm nights', does: 'The fire speeds births and ideas too.', cost: 4e5, fx: { kind: 'fireAll' }, critters: 45 },
  { id: 'tally', name: 'Tally sticks', does: 'Buy ×10.', cost: 200, fx: { kind: 'feature', feature: 'buy10' }, critters: 6 },
  { id: 'counting', name: 'Counting stones', does: 'Buy Max.', cost: 6000, fx: { kind: 'feature', feature: 'buymax' }, critters: 14 },
  { id: 'lore', name: 'Lore-keepers', does: 'Focus a culture lane: its ideas ×2.', cost: 3e6, fx: { kind: 'feature', feature: 'focus' }, critters: 100 },
  { id: 'council', name: 'The council', does: 'Buys the best deal for you.', cost: 800, fx: { kind: 'auto' }, critters: 12 },
  { id: 'envoy', name: 'An envoy', does: 'Gifts kin for you.', cost: 2000, fx: { kind: 'envoy' }, critters: 15 },
  { id: 'scouts', name: 'Scouts', does: 'Two scouts explore the fog.', cost: 400, fx: { kind: 'scouts' }, critters: 8 },
  { id: 'feast1', name: 'Feast days', does: 'All food ×1.25.', cost: 5e4, fx: { kind: 'all', mult: 1.25 }, critters: 30 },
  { id: 'feast2', name: 'The harvest festival', does: 'All food ×1.5.', cost: 4e6, fx: { kind: 'all', mult: 1.5 }, critters: 90 },
  ...DOUBLERS,
];

/** The Great Works: one closes each Age (bought with food once the culture's ready for it),
 * and the village round the hearth holds more after it. */
export const WORKS: { id: BuildId; age: number; name: string; does: string; cost: number; most: number }[] = [
  { id: 'greathearth', age: 1, name: 'The Great Hearth', does: 'Ends the Hearth Age. Holds 300.', cost: 4e5, most: 300 },
  { id: 'square', age: 2, name: 'The Town Square', does: 'Ends the Village Age. Holds 600.', cost: 6e7, most: 600 },
];
