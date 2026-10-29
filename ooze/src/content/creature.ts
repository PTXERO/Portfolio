// The Creature stage: many cells became one body, and it crawls out of the water.
// A game of its own: build the body from parts, send it exploring, breed a line
// of generations, and roam the shore. It ends when the line is many.
//
// Numbers here are tuned with the simulator (npm run sim). Names and lines are
// placeholders until the real script is written.

import type { MilestoneDef, PartDef, PlaceDef, ReactionDef, StageDef, UpgradeDef } from '../economy/types';

export const PARTS: PartDef[] = [
  // Free starting parts (cost 0), worn from the start.
  { id: 'nubs', slot: 'legs', name: 'Nubs', flavor: 'Barely legs. It shuffles.', stats: { speed: 1 }, cost: 0 },
  { id: 'gums', slot: 'mouth', name: 'Soft Mouth', flavor: 'Good for mush.', stats: { strength: 1 }, cost: 0 },
  { id: 'eyespots', slot: 'eyes', name: 'Eyespots', flavor: 'Light and dark, roughly.', stats: { senses: 1 }, cost: 0 },
  { id: 'bare', slot: 'back', name: 'Bare Back', flavor: 'Nothing there yet.', stats: {}, cost: 0 },
  { id: 'stub', slot: 'tail', name: 'Stub Tail', flavor: 'More of an ending than a tail.', stats: {}, cost: 0 },
  // Grown with Biomass.
  { id: 'stubby', slot: 'legs', name: 'Stubby Legs', flavor: 'Short, sturdy, reliable.', stats: { speed: 3, toughness: 1 }, cost: 400 },
  { id: 'jaws', slot: 'mouth', name: 'Jaws', flavor: 'Hinged, and it knows how to use them.', stats: { strength: 4 }, cost: 2500 },
  { id: 'lensEyes', slot: 'eyes', name: 'Lens Eyes', flavor: 'Shapes, at last.', stats: { senses: 4 }, cost: 1.5e4 },
  { id: 'spines', slot: 'back', name: 'Spines', flavor: 'A row of needles down the back.', stats: { toughness: 4 }, cost: 8e4 },
  { id: 'finTail', slot: 'tail', name: 'Fin Tail', flavor: 'Still half a swimmer.', stats: { speed: 2, charm: 1 }, cost: 4e5 },
  // Found on expeditions (or inherited from a mate).
  { id: 'shell', slot: 'back', name: 'Shell', flavor: 'A house you carry.', stats: { toughness: 8 } },
  { id: 'stalkEyes', slot: 'eyes', name: 'Stalk Eyes', flavor: 'They see round corners. Almost.', stats: { senses: 7 } },
  { id: 'runner', slot: 'legs', name: 'Runner Legs', flavor: 'Long, light and quick.', stats: { speed: 8 } },
  { id: 'sail', slot: 'back', name: 'Back Sail', flavor: 'Bright, tall and very noticeable.', stats: { charm: 6, toughness: 1 } },
  { id: 'beak', slot: 'mouth', name: 'Beak', flavor: 'Cracks seeds and shells alike.', stats: { strength: 5, senses: 3 } },
  { id: 'crestTail', slot: 'tail', name: 'Crest Tail', flavor: 'Fanned out for anyone watching.', stats: { charm: 9 } },
  { id: 'climber', slot: 'legs', name: 'Climbing Claws', flavor: 'Rock is just a steep floor.', stats: { speed: 6, strength: 5 } },
  { id: 'clubTail', slot: 'tail', name: 'Club Tail', flavor: 'An argument at the end of a tail.', stats: { strength: 6, toughness: 4 } },
  { id: 'nightEyes', slot: 'eyes', name: 'Night Eyes', flavor: 'Wide, wet and made for the dark.', stats: { senses: 13 } },
  { id: 'tusks', slot: 'mouth', name: 'Tusks', flavor: 'Nothing argues with tusks.', stats: { strength: 12, toughness: 3 } },
];

export const PLACES: PlaceDef[] = [
  { id: 'shore', name: 'Shoreline', flavor: 'Wet sand and things the tide forgot.', minutes: 2, needs: {}, parts: ['shell'], mateChance: 0.6, bonus: { kind: 'stageMult', mult: 1.3 } },
  { id: 'tidePools', name: 'Tide Pools', flavor: 'Little worlds in every hollow.', minutes: 5, needs: { senses: 4 }, parts: ['stalkEyes'], mateChance: 0.6, unlocks: 'nest', after: ['shore'] },
  { id: 'marsh', name: 'Marsh', flavor: 'Soft ground, tall reeds, and a lot of noise.', minutes: 8, needs: { speed: 6 }, parts: ['runner', 'sail'], mateChance: 0.6, unlocks: 'waterhole', after: ['shore'] },
  { id: 'forest', name: 'Forest Edge', flavor: 'Shade, seeds and something watching.', minutes: 12, needs: { senses: 9, speed: 9 }, parts: ['beak', 'crestTail'], mateChance: 0.6, bonus: { kind: 'stageMult', mult: 1.6 }, after: ['tidePools', 'marsh'] },
  { id: 'cliffs', name: 'Cliffs', flavor: 'Wind, gulls and a long way down.', minutes: 18, needs: { strength: 12, toughness: 8 }, parts: ['climber', 'clubTail'], mateChance: 0.6, bonus: { kind: 'forageMult', mult: 2 }, after: ['marsh'] },
  { id: 'caves', name: 'Caves', flavor: 'Cool, dark and full of echoes.', minutes: 25, needs: { senses: 16, toughness: 14 }, parts: ['nightEyes'], mateChance: 0.6, unlocks: 'den', after: ['forest', 'cliffs'] },
  { id: 'highlands', name: 'Highlands', flavor: 'Open sky, far horizons, and room for everyone.', minutes: 40, needs: { speed: 18, strength: 20 }, parts: ['tusks'], mateChance: 0.6, unlocks: 'territory', after: ['caves'] },
];

/** The Field Guide: one page per place, plus the ending. */
const pages: ReactionDef[] = PLACES.map((p) => ({
  id: p.id,
  name: p.name,
  flavor: p.flavor,
  hints: [`Somewhere out there: ${p.name.toLowerCase()}.`, 'Send your creature on an expedition to explore it.'],
  needs: {},
  manual: true,
  bonus: p.bonus,
  unlocks: p.unlocks,
}));

const final: ReactionDef = {
  id: 'many',
  name: 'Many',
  flavor: 'A line long enough to fill the land.',
  hints: ['One is not enough.', 'Every place explored, a line six generations long, and herds across the land.'],
  needs: { found: 7, generation: 6, gens: { herd: 40, territory: 10 } },
  final: true,
  cost: 1e16,
};

const UPGRADES: UpgradeDef[] = [
  // Training: endless, a little more each time.
  { id: 'trainSpeed', branch: 'Training', name: 'Sprint Practice', flavor: 'Run, rest, run again.', cost: 300, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'speed', amount: 1 } },
  { id: 'trainStrength', branch: 'Training', name: 'Wrestling', flavor: 'With rocks, mostly.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'strength', amount: 1 } },
  { id: 'trainSenses', branch: 'Training', name: 'Watching', flavor: 'Sit very still and notice things.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'senses', amount: 1 } },
  { id: 'trainToughness', branch: 'Training', name: 'Hard Knocks', flavor: 'Every bruise teaches something.', cost: 800, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'toughness', amount: 1 } },
  { id: 'trainCharm', branch: 'Training', name: 'Display', flavor: 'Puff up. Look grand. Hope.', cost: 1200, levels: Infinity, costGrowth: 2.3, effect: { kind: 'stat', stat: 'charm', amount: 1 } },
  // Boosts, one for each kind of life.
  { id: 'warmEggs', name: 'Warm Sand', flavor: 'Eggs laid in the sun hatch strong.', cost: 200, effect: { kind: 'genMult', target: 'hatchling', mult: 2 }, requires: { generator: 'hatchling', owned: 10 } },
  { id: 'deepBurrows', name: 'Deep Burrows', flavor: 'Room for the whole family.', cost: 6000, effect: { kind: 'genMult', target: 'burrow', mult: 2 }, requires: { generator: 'burrow', owned: 10 } },
  { id: 'herdSense', name: 'Herd Sense', flavor: 'One looks up, they all look up.', cost: 2.4e5, effect: { kind: 'genMult', target: 'herd', mult: 2 }, requires: { generator: 'herd', owned: 10 } },
  { id: 'nestGuard', name: 'Nest Guards', flavor: 'Someone always stays behind.', cost: 1e7, effect: { kind: 'genMult', target: 'nest', mult: 2 }, requires: { generator: 'nest', owned: 10 } },
  { id: 'wallow', name: 'Wallowing', flavor: 'Mud is good for the skin.', cost: 4e8, effect: { kind: 'genMult', target: 'waterhole', mult: 2 }, requires: { generator: 'waterhole', owned: 10 } },
  { id: 'denWarmth', name: 'Den Warmth', flavor: 'Huddled together through the cold.', cost: 1.6e10, effect: { kind: 'genMult', target: 'den', mult: 2 }, requires: { generator: 'den', owned: 10 } },
  { id: 'borders', name: 'Scent Borders', flavor: 'Everyone knows whose land this is.', cost: 6e11, effect: { kind: 'genMult', target: 'territory', mult: 2 }, requires: { generator: 'territory', owned: 10 } },
  { id: 'packMemory', name: 'Trail Memory', flavor: 'The way home, remembered.', cost: 5000, effect: { kind: 'tripMult', mult: 2 }, requires: { reaction: 'shore' } },
  { id: 'cellFeeding', name: 'Old Cell Lines', flavor: 'Every cell in it remembers the pond.', cost: 2e4, effect: { kind: 'feedMult', mult: 2 } },
  // Giving back: bought with Biomass, felt in the Cell and the Soup (which feed back up).
  { id: 'gutFlora', name: 'Gut Flora', flavor: 'Bacteria thrive inside the creature\'s gut, and spread wherever it goes.', cost: 1e4, levels: 5, costGrowth: 25, target: 'cell', effect: { kind: 'stageMult', mult: 1.5 } },
  { id: 'droppings', name: 'Droppings', flavor: 'What goes in comes out, and washes back into the Shallows.', cost: 1e7, target: 'cell', effect: { kind: 'habitatMult', habitat: 'shallows', mult: 3 } },
  { id: 'mudStirring', name: 'Stirred Mud', flavor: 'Feet churn the bottom mud and feed the dark below.', cost: 1e9, target: 'cell', effect: { kind: 'habitatMult', habitat: 'depths', mult: 3 } },
  { id: 'fallenGiants', name: 'Fallen Giants', flavor: 'When a big one dies at sea, it sinks and feeds the deep for years.', cost: 1e11, target: 'cell', effect: { kind: 'habitatMult', habitat: 'vents', mult: 3 } },
  { id: 'tidalRunoff', name: 'Tidal Runoff', flavor: 'Rain washes the land\'s leftovers back to the sea, where it all began.', cost: 1e13, target: 'soup', effect: { kind: 'stageMult', mult: 2 } },
  // Heirlooms, paid for in the Cell's DNA.
  { id: 'denseCells', name: 'Dense Tissue', flavor: 'Packed tighter than any cell before.', cost: 1e27, levels: 10, costGrowth: 5, pay: 'cell', effect: { kind: 'stageMult', mult: 1.15 } },
  { id: 'oldSenses', name: 'Old Senses', flavor: 'The eyespot was only the beginning.', cost: 3e27, levels: 5, costGrowth: 8, pay: 'cell', effect: { kind: 'stat', stat: 'senses', amount: 2 } },
  { id: 'oldLegs', name: 'Old Flagella', flavor: 'Tails became legs. They still remember how to push.', cost: 3e27, levels: 5, costGrowth: 8, pay: 'cell', effect: { kind: 'stat', stat: 'speed', amount: 2 } },
];

const MILESTONES: MilestoneDef[] = [
  { id: 'cellColony100', stage: 'cell', gen: 'colony', owned: 100, bonus: { kind: 'stageMult', mult: 1.5 } },
  { id: 'cellFission300', stage: 'cell', gen: 'fission', owned: 300, bonus: { kind: 'stat', stat: 'speed', amount: 3 } },
  { id: 'cellPack40', stage: 'cell', gen: 'pack', owned: 40, bonus: { kind: 'stat', stat: 'strength', amount: 3 } },
  { id: 'cellReef40', stage: 'cell', gen: 'reef', owned: 40, bonus: { kind: 'stat', stat: 'toughness', amount: 3 } },
  { id: 'cellColony200', stage: 'cell', gen: 'colony', owned: 200, bonus: { kind: 'stageMult', mult: 2 } },
];

export const creature: StageDef = {
  id: 'creature',
  name: 'Creature',
  currency: 'Biomass',
  goal: 0,
  intro: 'It hauls itself out of the water, and the ground holds.',
  tapBase: 0,
  startingGenerators: 1,
  bookName: 'Field Guide',
  ending: { title: 'Many.', line: 'There were more of them now, and they were not all the same.' },
  generators: [
    { id: 'hatchling', name: 'Hatchling', flavor: 'Small, loud and always hungry.', baseCost: 15, growth: 1.15, baseRate: 1 },
    { id: 'burrow', name: 'Burrow', flavor: 'A hole in the bank, and a family in it.', baseCost: 600, growth: 1.16, baseRate: 12 },
    { id: 'herd', name: 'Grazing Herd', flavor: 'Heads down, tails up, all day long.', baseCost: 2.4e4, growth: 1.17, baseRate: 144 },
    { id: 'nest', name: 'Nesting Ground', flavor: 'Rows of eggs warming in the sand.', baseCost: 1e6, growth: 1.18, baseRate: 1700, unlockedBy: 'tidePools' },
    { id: 'waterhole', name: 'Watering Hole', flavor: 'Everyone comes here eventually.', baseCost: 4e7, growth: 1.19, baseRate: 2e4, unlockedBy: 'marsh' },
    { id: 'den', name: 'Cave Den', flavor: 'Out of the wind and out of sight.', baseCost: 1.6e9, growth: 1.2, baseRate: 2.5e5, unlockedBy: 'caves' },
    { id: 'territory', name: 'Territory', flavor: 'Land that is yours, as far as you can see.', baseCost: 6e10, growth: 1.21, baseRate: 3e6, unlockedBy: 'highlands' },
  ],
  upgrades: UPGRADES,
  reactions: [...pages, final],
  milestones: MILESTONES,
  parts: PARTS,
  places: PLACES,
};
