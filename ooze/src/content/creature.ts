// The Creature stage: many cells became one body, and it crawls out of the water.
// A game of its own: not a price ladder but a herd to run. Your line grows from
// births into a population you set to work (foragers, carers, diggers, guards,
// scouts) through a cycle of seasons. You build one body within an energy budget,
// send it on expeditions that throw up choices, and breed generations. It ends
// when the line is many.
//
// Numbers here are tuned with the simulator (npm run sim). Names and lines are
// placeholders until the real script is written.

import type { MilestoneDef, PartDef, PlaceDef, ReactionDef, StageDef, TripEventDef, UpgradeDef } from '../economy/types';

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
  { id: 'tidePools', name: 'Tide Pools', flavor: 'Little worlds in every hollow.', minutes: 5, needs: { senses: 4 }, parts: ['stalkEyes'], mateChance: 0.6, after: ['shore'], bonus: { kind: 'stageMult', mult: 1.3 } },
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
  hints: ['One is not enough.', 'Every place explored, a line six generations long, and a great herd across the land.'],
  needs: { found: 7, generation: 6, pop: 500, gens: { territory: 5 } },
  final: true,
  cost: 1e12,
};

/** Things that happen partway through an expedition. Unanswered, the creature plays safe (the last option). */
export const EVENTS: TripEventDef[] = [
  { id: 'rockslide', text: 'A rockslide blocks the path.', options: [
    { label: 'Climb over', stat: 'strength', need: 8, good: 'It scrambled over and found the way beyond.', bad: 'It slipped and limped home early.', reward: 'pay' },
    { label: 'Dig through', stat: 'toughness', need: 8, good: 'It dug a path, and something was buried there.', bad: 'Too hard. It gave up.', reward: 'part' },
    { label: 'Go around', good: 'The long way round. Nothing lost.', reward: 'pay' },
  ] },
  { id: 'tracks', text: 'Strange tracks cross the trail.', options: [
    { label: 'Follow them', stat: 'senses', need: 9, good: 'They led to another of its kind!', bad: 'It lost the trail in the scrub.', reward: 'mate' },
    { label: 'Ignore them', good: 'It kept to the path.', reward: 'pay' },
  ] },
  { id: 'rival', text: 'A rival blocks the way, puffed up and loud.', options: [
    { label: 'Fight', stat: 'strength', need: 12, good: 'The rival backed down, and left its stash behind.', bad: 'It came off worse.', reward: 'pay' },
    { label: 'Show off', stat: 'charm', need: 8, good: 'The rival was charmed, and followed it home.', bad: 'The rival was not impressed.', reward: 'mate' },
    { label: 'Back away', good: 'No harm done.', reward: 'pay' },
  ] },
  { id: 'storm', text: 'A storm rolls in fast.', options: [
    { label: 'Press on', stat: 'speed', need: 10, good: 'It outran the rain to a rich valley.', bad: 'Soaked and slowed.', reward: 'pay' },
    { label: 'Shelter', stat: 'toughness', need: 6, good: 'It waited it out under a ledge, and found something there.', bad: 'A cold, hungry night.', reward: 'part' },
    { label: 'Turn back', good: 'Home safe, a little early.', reward: 'pay' },
  ] },
  { id: 'glut', text: 'Fruit has fallen everywhere.', options: [
    { label: 'Feast', stat: 'toughness', need: 4, good: 'It ate its fill and carried more home.', bad: 'Too much. A sore belly.', reward: 'pay' },
    { label: 'Carry what it can', good: 'A little extra for the herd.', reward: 'pay' },
  ] },
  { id: 'nest', text: 'An abandoned nest, still warm.', options: [
    { label: 'Search it', stat: 'senses', need: 6, good: 'Tucked in the lining: something useful.', bad: 'Nothing but twigs.', reward: 'part' },
    { label: 'Leave it', good: 'Not its business.', reward: 'pay' },
  ] },
];

const UPGRADES: UpgradeDef[] = [
  // Training: endless, a little more each time.
  { id: 'trainSpeed', branch: 'Training', name: 'Sprint Practice', flavor: 'Run, rest, run again.', cost: 300, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'speed', amount: 1 } },
  { id: 'trainStrength', branch: 'Training', name: 'Wrestling', flavor: 'With rocks, mostly.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'strength', amount: 1 } },
  { id: 'trainSenses', branch: 'Training', name: 'Watching', flavor: 'Sit very still and notice things.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'senses', amount: 1 } },
  { id: 'trainToughness', branch: 'Training', name: 'Hard Knocks', flavor: 'Every bruise teaches something.', cost: 800, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'toughness', amount: 1 } },
  { id: 'trainCharm', branch: 'Training', name: 'Display', flavor: 'Puff up. Look grand. Hope.', cost: 1200, levels: Infinity, costGrowth: 2.3, effect: { kind: 'stat', stat: 'charm', amount: 1 } },
  { id: 'bigHeart', branch: 'Training', name: 'Bigger Heart', flavor: 'More blood, more body to move.', cost: 600, levels: Infinity, costGrowth: 2.6, effect: { kind: 'energy', amount: 1 } },
  // Herd and seasons.
  { id: 'fatStores', name: 'Fat Stores', flavor: 'Eat in summer, live on it in winter.', cost: 400, levels: 5, costGrowth: 6, effect: { kind: 'upkeepMult', mult: 0.85 } },
  { id: 'thickCoats', name: 'Thick Coats', flavor: 'Fur, feathers or blubber: whatever keeps the cold out.', cost: 2000, levels: 5, costGrowth: 6, effect: { kind: 'winterMult', mult: 0.7 } },
  { id: 'foodSharing', name: 'Food Sharing', flavor: 'Whoever finds food calls the others.', cost: 1500, levels: 5, costGrowth: 7, effect: { kind: 'stageMult', mult: 1.3 } },
  { id: 'packMemory', name: 'Trail Memory', flavor: 'The way home, remembered.', cost: 5000, effect: { kind: 'tripMult', mult: 2 }, requires: { reaction: 'shore' } },
  { id: 'cellFeeding', name: 'Old Cell Lines', flavor: 'Every cell in it remembers the pond.', cost: 2e4, effect: { kind: 'feedMult', mult: 1.3 } },
  { id: 'migration', name: 'Migration', flavor: 'When winter comes, the herd walks to where it is milder.', cost: 1e7, effect: { kind: 'winterMult', mult: 0.4 }, extra: [{ kind: 'upkeepMult', mult: 0.8 }], requires: { reaction: 'highlands' } },
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
  // Buildings, not producers: the herd forages (see economy/creature.ts). Each one
  // shapes the herd instead: births, housing, food and shelter.
  generators: [
    { id: 'nest', name: 'Nesting Ground', flavor: 'Rows of eggs warming in the sand. More births.', baseCost: 1e3, growth: 1.15, baseRate: 0 },
    { id: 'burrow', name: 'Burrow', flavor: 'A hole in the bank: room for five more.', baseCost: 1e4, growth: 1.15, baseRate: 0 },
    { id: 'waterhole', name: 'Watering Hole', flavor: 'Everyone drinks, everyone eats a little less.', baseCost: 1e6, growth: 1.3, baseRate: 0, unlockedBy: 'marsh' },
    { id: 'den', name: 'Cave Den', flavor: 'Out of the wind: room for forty, and shelter from winter.', baseCost: 3e7, growth: 1.2, baseRate: 0, unlockedBy: 'caves' },
    { id: 'territory', name: 'Territory', flavor: 'Land that is yours: room for two hundred, and richer foraging.', baseCost: 3e10, growth: 1.25, baseRate: 0, unlockedBy: 'highlands' },
  ],
  upgrades: UPGRADES,
  reactions: [...pages, final],
  milestones: MILESTONES,
  parts: PARTS,
  places: PLACES,
};
