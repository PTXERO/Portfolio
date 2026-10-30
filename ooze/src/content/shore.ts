// New Shore: the four come ashore on a big island that's already lived on, found a village
// around a hearth, and grow it toward a hundred, while the island's other villages join them,
// flee, or fight to the death. (The design is in docs/new-shore.md.)
//
// STORY: every line marked [STORY] is a placeholder for the real script.

import type { StageDef } from '../economy/types';

export const SHORE_STORY = {
  /** Walking up from the beach, the first morning. */
  arrive: '[STORY] They walked up from the beach to find a place to stay.',
  /** The hearth lit. */
  hearth: '[STORY] They lit a fire, and it was home.',
  /** The first born on the new shore. */
  firstBorn: '[STORY] The first of them born on the new shore.',
  /** One of the four dies (of old age). */
  founderDies: '[STORY] {name} crossed the sea, and is buried by the fire.',
  /** The last of the four. */
  lastFounder: '[STORY] The last of the four who crossed is gone. Only the stories are left.',
  /** Seeing another village for the first time. */
  found: '[STORY] Smoke, and huts, and others like them. Not like them.',
};

export type BuildId = 'hearth' | 'hut' | 'rack' | 'woodpile' | 'camp' | 'cutter' | 'scout' | 'longhouse' | 'elders' | 'pool' | 'granary' | 'weir' | 'lookout' | 'trails';

/** The Build tab's sorts of building. */
export type BuildCat = 'homes' | 'stores' | 'work' | 'explore';
export const BUILD_CATS: { id: BuildCat; name: string }[] = [
  { id: 'homes', name: 'Homes' },
  { id: 'stores', name: 'Stores' },
  { id: 'work', name: 'Work' },
  { id: 'explore', name: 'Exploring' },
];

export interface BuildDef {
  id: BuildId;
  name: string;
  cat: BuildCat;
  /** What it does, for the card. */
  does: string;
  /** Wood for the first; each after costs `growth` times the last. */
  wood: number;
  growth: number;
  /** At most this many (unset: no limit). */
  max?: number;
  /** Shown once this is built. */
  after?: BuildId;
  /** Only once it's been learned out on the island (at this kind of landmark). */
  learn?: PoiKind;
  /** What it adds (see Boosts). */
  fx?: Partial<Boosts>;
}

/** Everything buildings and relics can add to: shares (0.15 is +15%) except room, the stores
 * (food and wood kept) and sight (tiles). */
export interface Boosts {
  food: number;
  wood: number;
  births: number;
  grow: number;
  speed: number;
  sight: number;
  gift: number;
  room: number;
  foodCap: number;
  woodCap: number;
  /** How much of winter's slowdown is kept off (0 to 1). */
  winter: number;
  /** Tiles round the village seen from it. */
  watch: number;
}

export const BUILDS: BuildDef[] = [
  { id: 'hearth', cat: 'homes', name: 'The Hearth', does: 'A fire to gather round. Children are only born where there\'s a hearth.', wood: 6, growth: 1, max: 1 },
  { id: 'hut', cat: 'homes', name: 'Hut', does: 'Room for 4 more.', wood: 12, growth: 1.2, after: 'hearth' },
  { id: 'woodpile', cat: 'stores', name: 'Woodpile', does: 'Room for 50 more wood.', wood: 10, growth: 1.3, after: 'hearth' },
  { id: 'rack', cat: 'stores', name: 'Drying rack', does: 'Room for 40 more food.', wood: 14, growth: 1.3, after: 'hut' },
  { id: 'camp', cat: 'work', name: 'Gathering camp', does: 'Food comes in 10% faster, and the land round the village feeds 5 more gatherers.', wood: 35, growth: 1.5, after: 'hut' },
  { id: 'cutter', cat: 'work', name: 'Cutters\' shed', does: 'Wood comes in 10% faster.', wood: 35, growth: 1.5, after: 'woodpile' },
  { id: 'scout', cat: 'explore', name: 'Scout\'s hut', does: 'One of them goes out into the fog for you, finding what\'s out there (while you\'re away too).', wood: 20, growth: 2.2, max: 2, after: 'hut' },
  { id: 'elders', cat: 'homes', name: 'Elders\' fire', does: 'The old teach the young: children grow up 15% faster.', wood: 60, growth: 1, max: 1, after: 'hut', fx: { grow: 0.15 } },
  { id: 'longhouse', cat: 'homes', name: 'Longhouse', does: 'A great hall of a house: room for 12 more.', wood: 140, growth: 1.5, after: 'hut', learn: 'ruin', fx: { room: 12 } },
  { id: 'pool', cat: 'homes', name: 'Bathing pool', does: 'Warm water, piped from a spring: children are born 10% more often.', wood: 70, growth: 1, max: 1, after: 'hut', learn: 'spring', fx: { births: 0.1 } },
  { id: 'granary', cat: 'stores', name: 'Granary', does: 'Room for 120 more food, kept dry and cold: winter slows the food only half as much.', wood: 80, growth: 1.6, after: 'rack', learn: 'cave', fx: { foodCap: 120, winter: 0.5 } },
  { id: 'weir', cat: 'work', name: 'Fishing weir', does: 'Stakes in the shallows, the way the drowned raft\'s makers did it: food comes in 5% faster, and the land feeds 6 more gatherers.', wood: 45, growth: 1.6, after: 'hut', learn: 'wreck', fx: { food: 0.05 } },
  { id: 'lookout', cat: 'explore', name: 'Lookout', does: 'A platform up high, like the one in the great tree: the land 30 tiles round the village is seen, and scouts see further.', wood: 45, growth: 1, max: 1, after: 'hut', learn: 'bigtree', fx: { watch: 30, sight: 4 } },
  { id: 'trails', cat: 'explore', name: 'Trail markers', does: 'Cairns and blazes on the trees: the chief and the scouts walk 10% faster.', wood: 40, growth: 1, max: 1, after: 'scout', fx: { speed: 0.1 } },
];

// ---- Landmarks and relics ----

export type PoiKind = 'bones' | 'bigtree' | 'spring' | 'stones' | 'cave' | 'ruin' | 'wreck' | 'crater' | 'cairn';
export type RelicId = 'antler' | 'axe' | 'shell' | 'beads' | 'crystal' | 'wraps' | 'figure' | 'shard';

/** What a layer of a landmark gives when it's been explored. */
export interface Find {
  /** What they find (a line for the card and the Chronicle). [STORY] where it's the script's. */
  text: string;
  relic?: RelicId;
  learn?: BuildId;
  food?: number;
  wood?: number;
}

export interface PoiDef {
  id: PoiKind;
  name: string;
  /** natural, ruin or the strange. */
  sort: 'natural' | 'ruin' | 'strange';
  /** How it looks from a distance (on finding it). */
  seen: string;
  /** Where it's found: the kind of ground. */
  ground: 'sand' | 'grass' | 'forest' | 'high' | 'rock';
  /** How many of them on the island. */
  count: number;
  /** Layers, explored one after another; seconds of the chief's time each. */
  layers: { sec: number; find: Find }[];
}

export const POIS: PoiDef[] = [
  { id: 'bones', sort: 'natural', name: 'Great bones', seen: 'Ribs as tall as trees, bleached on the sand. Something huge died here, long ago.', ground: 'sand', count: 3, layers: [
    { sec: 30, find: { text: 'Among the ribs, a curved bone carved with lines. Someone was here before them.', relic: 'antler' } },
  ] },
  { id: 'bigtree', sort: 'natural', name: 'The great tree', seen: 'A tree older and taller than any other, its crown over the whole wood.', ground: 'forest', count: 2, layers: [
    { sec: 40, find: { text: 'Up in its crown, old planks lashed into a platform. From up there, you can see for ever.', learn: 'lookout' } },
    { sec: 60, find: { text: 'Fallen limbs, dry and sound: good wood for the taking.', wood: 60 } },
  ] },
  { id: 'spring', sort: 'natural', name: 'Hot spring', seen: 'Steam rising from a pool in the rocks, warm in any season.', ground: 'high', count: 2, layers: [
    { sec: 35, find: { text: 'They sit in the warm water, and are happier than they have been since the crossing.', learn: 'pool' } },
    { sec: 50, find: { text: 'Threaded on a root at the bottom of the pool: a string of stone beads.', relic: 'beads' } },
  ] },
  { id: 'stones', sort: 'ruin', name: 'Standing stones', seen: 'Tall stones set in a ring. They didn\'t stand themselves up.', ground: 'grass', count: 3, layers: [
    { sec: 45, find: { text: 'In the middle of the ring, a spiral shell laid on a flat stone, as if left as a gift.', relic: 'shell' } },
    { sec: 70, find: { text: '[STORY] Marks on the stones: people, a fire, and a long spear falling from the sky.' } },
  ] },
  { id: 'cave', sort: 'natural', name: 'Cave mouth', seen: 'A dark opening in the rock, cold air breathing out of it.', ground: 'rock', count: 3, layers: [
    { sec: 40, find: { text: 'Just inside, it\'s cold and dry: food kept here would last. They learn to build a granary.', learn: 'granary' } },
    { sec: 70, find: { text: 'Deeper in, an old axe-head of black stone, sharper than anything they can make.', relic: 'axe' } },
    { sec: 110, find: { text: '[STORY] At the very back, hand-prints on the wall. Hundreds of them, old and older.' } },
  ] },
  { id: 'ruin', sort: 'ruin', name: 'Fallen walls', seen: 'Low walls of stacked stone, overgrown: the outline of a great house.', ground: 'grass', count: 3, layers: [
    { sec: 50, find: { text: 'They pace out the walls: a house for many, all under one roof. They could build one.', learn: 'longhouse' } },
    { sec: 80, find: { text: 'Under the fallen roof, a little clay figure of someone holding a child.', relic: 'figure' } },
  ] },
  { id: 'wreck', sort: 'strange', name: 'A wrecked raft', seen: 'Old logs half-buried on the beach, lashed together. Someone else crossed the sea.', ground: 'sand', count: 2, layers: [
    { sec: 35, find: { text: 'Stakes and woven fences in the wreck: a fish trap. They learn to build a weir.', learn: 'weir' } },
    { sec: 45, find: { text: 'Wrapped in a hide, a pair of old foot-wraps, worn thin by walking.', relic: 'wraps' } },
  ] },
  { id: 'crater', sort: 'strange', name: 'The crater', seen: 'A round hollow in the ground, the earth thrown up around it. Something fell here.', ground: 'grass', count: 1, layers: [
    { sec: 60, find: { text: 'In the middle, half-buried, a black splinter that hums when held. It feels like the spear.', relic: 'shard' } },
    { sec: 90, find: { text: '[STORY] They sit at the crater\'s edge at night, and the Far Voice is louder here.' } },
  ] },
  { id: 'cairn', sort: 'ruin', name: 'Summit cairn', seen: 'A pile of stones on the heights, built by someone, a long time ago.', ground: 'high', count: 2, layers: [
    { sec: 45, find: { text: 'Tucked in the cairn, a stone so clear you can see through it. The world looks sharper through it.', relic: 'crystal' } },
  ] },
];

export interface RelicDef {
  id: RelicId;
  name: string;
  does: string;
  fx: Partial<Boosts>;
}

export const RELICS: RelicDef[] = [
  { id: 'antler', name: 'Carved bone', does: 'Food comes in 5% faster.', fx: { food: 0.05 } },
  { id: 'axe', name: 'Black stone axe', does: 'Wood comes in 8% faster.', fx: { wood: 0.08 } },
  { id: 'shell', name: 'Spiral shell', does: 'Gifts win 15% more trust.', fx: { gift: 0.15 } },
  { id: 'beads', name: 'Stone beads', does: 'Children are born 8% more often.', fx: { births: 0.08 } },
  { id: 'crystal', name: 'Clear stone', does: 'The chief and the scouts see 3 tiles further.', fx: { sight: 3 } },
  { id: 'wraps', name: 'Old foot-wraps', does: 'The chief and the scouts walk 8% faster.', fx: { speed: 0.08 } },
  { id: 'figure', name: 'Clay figure', does: 'Children grow up 8% faster.', fx: { grow: 0.08 } },
  { id: 'shard', name: 'Humming shard', does: 'Food and wood come in 3% faster. It hums like the spear.', fx: { food: 0.03, wood: 0.03 } },
];

export const POI_SORT = { natural: 'Landmark', ruin: 'Ruins', strange: 'Strange' } as const;

/** The camp that gathers food is the diet's own. */
export function buildName(id: BuildId, diet: string): string {
  if (id !== 'camp') return BUILDS.find((b) => b.id === id)!.name;
  return diet === 'hunter' ? 'Hunting lodge' : diet === 'grazer' ? 'Foragers\' shelter' : 'Gathering camp';
}

export const shore: StageDef = {
  id: 'shore',
  name: 'New Shore',
  currency: 'Food',
  goal: 0,
  intro: SHORE_STORY.arrive,
  tapBase: 0,
  startingGenerators: 0,
  shore: true,
  generators: [],
  upgrades: [],
};
