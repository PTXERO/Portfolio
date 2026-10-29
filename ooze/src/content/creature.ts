// The Creature stage: many cells became one body, and it crawls out of the water.
// A game of its own: not a price ladder but a herd to keep alive. Your line grows
// from births through a cycle of seasons, fed by whoever forages. Nobody is told
// what to do (these are animals): instincts bred into the line send a share of the
// herd to nest, burrow, keep watch or follow. You grow one body within an energy
// budget, roam with it (meeting things that need a snap decision), and breed
// generations. It ends when the line is many.
//
// Numbers here are tuned with the simulator (npm run sim). Names and lines are
// placeholders until the real script is written.

import type { MilestoneDef, PartDef, PlaceDef, ReactionDef, StageDef, TripEventDef, UpgradeDef } from '../economy/types';

export const PARTS: PartDef[] = [
  // Free starting parts (cost 0), worn from the start.
  { id: 'nubs', slot: 'legs', name: 'Nubs', flavor: 'Barely legs. It shuffles.', stats: { speed: 1 }, cost: 0, energy: 0 },
  { id: 'gums', slot: 'mouth', name: 'Soft Mouth', flavor: 'Good for mush.', stats: { strength: 1 }, cost: 0, energy: 0 },
  { id: 'eyespots', slot: 'eyes', name: 'Eyespots', flavor: 'Light and dark, roughly.', stats: { senses: 1 }, cost: 0, energy: 0 },
  { id: 'bare', slot: 'back', name: 'Bare Back', flavor: 'Nothing there yet.', stats: {}, cost: 0, energy: 0 },
  { id: 'stub', slot: 'tail', name: 'Stub Tail', flavor: 'More of an ending than a tail.', stats: {}, cost: 0, energy: 0 },
  // Grown with Biomass.
  { id: 'stubby', slot: 'legs', name: 'Stubby Legs', flavor: 'Short, sturdy, reliable.', stats: { speed: 3, toughness: 1 }, cost: 400 },
  { id: 'jaws', slot: 'mouth', name: 'Jaws', flavor: 'Hinged, and it knows how to use them.', stats: { strength: 4 }, cost: 2500 },
  { id: 'lensEyes', slot: 'eyes', name: 'Lens Eyes', flavor: 'Shapes, at last.', stats: { senses: 4 }, cost: 1.5e4 },
  { id: 'spines', slot: 'back', name: 'Spines', flavor: 'A row of needles down the back.', stats: { toughness: 4 }, cost: 8e4 },
  { id: 'finTail', slot: 'tail', name: 'Fin Tail', flavor: 'Still half a swimmer.', stats: { speed: 2, charm: 1 }, cost: 4e5 },
  // Found while roaming (or inherited from a mate): ten for each slot, each from its own part of the island.
  // Most reuse a shape with their own colour (`look` and `tint`).
  { id: 'paddles', slot: 'legs', name: 'Paddle Feet', flavor: 'Broad and flat, for wet sand.', stats: { speed: 2, toughness: 1 }, look: 'stubby', tint: '#5fa8bf' },
  { id: 'suckerFeet', slot: 'legs', name: 'Sucker Feet', flavor: 'They hold on to anything, briefly.', stats: { strength: 2, toughness: 2, speed: 1 }, look: 'stubby', tint: '#e68ab8' },
  { id: 'crabLegs', slot: 'legs', name: 'Crab Legs', flavor: 'Sideways is still a way.', stats: { toughness: 3, strength: 2 }, look: 'climber', tint: '#f2906c' },
  { id: 'runner', slot: 'legs', name: 'Runner Legs', flavor: 'Long, light and quick.', stats: { speed: 8 } },
  { id: 'webbedFeet', slot: 'legs', name: 'Webbed Feet', flavor: 'Half in the water, half out, all the time.', stats: { speed: 4, charm: 1, toughness: 1 }, look: 'stubby', tint: '#3f9c7e' },
  { id: 'springLegs', slot: 'legs', name: 'Spring Legs', flavor: 'Every step is half a jump.', stats: { speed: 6, charm: 1 }, look: 'runner', tint: '#b0e08a' },
  { id: 'treeClaws', slot: 'legs', name: 'Tree Claws', flavor: 'Bark is a ladder.', stats: { strength: 4, speed: 3 }, look: 'climber', tint: '#8a6a3a' },
  { id: 'climber', slot: 'legs', name: 'Climbing Claws', flavor: 'Rock is just a steep floor.', stats: { speed: 6, strength: 5 } },
  { id: 'caveStriders', slot: 'legs', name: 'Cave Striders', flavor: 'Long, pale and careful in the dark.', stats: { speed: 5, senses: 5 }, look: 'runner', tint: '#c8d2d8' },
  { id: 'hooves', slot: 'legs', name: 'Hooves', flavor: 'Made for open ground and a long way to go.', stats: { speed: 9, toughness: 4 }, look: 'runner', tint: '#56636c' },
  { id: 'filterMouth', slot: 'mouth', name: 'Filter Mouth', flavor: 'Strains the shallows for anything good.', stats: { senses: 1, toughness: 1, charm: 1 }, look: 'gums', tint: '#d8c08a' },
  { id: 'pincers', slot: 'mouth', name: 'Pincer Mouth', flavor: 'Two little claws, right at the front.', stats: { strength: 3, toughness: 1 }, look: 'jaws', tint: '#f2906c' },
  { id: 'snout', slot: 'mouth', name: 'Snout', flavor: 'Into every crack, nose first.', stats: { senses: 3, charm: 1 }, look: 'gums', tint: '#e68ab8' },
  { id: 'longTongue', slot: 'mouth', name: 'Long Tongue', flavor: 'Flies never see it coming.', stats: { senses: 3, speed: 2 }, look: 'beak', tint: '#e68ab8' },
  { id: 'mudSifter', slot: 'mouth', name: 'Mud Sifter', flavor: 'A wide scoop for the soft bottom.', stats: { toughness: 3, senses: 2 }, look: 'gums', tint: '#7a5a3a' },
  { id: 'beak', slot: 'mouth', name: 'Beak', flavor: 'Cracks seeds and shells alike.', stats: { strength: 5, senses: 3 } },
  { id: 'grinders', slot: 'mouth', name: 'Grinders', flavor: 'Flat teeth for tough leaves.', stats: { strength: 4, toughness: 2 }, look: 'jaws', tint: '#f2ead7' },
  { id: 'hookBeak', slot: 'mouth', name: 'Hook Beak', flavor: 'Curved for tearing, gold at the tip.', stats: { strength: 6, senses: 3 }, look: 'beak', tint: '#f5c45e' },
  { id: 'fangs', slot: 'mouth', name: 'Fangs', flavor: 'Long, white and quiet.', stats: { strength: 8, charm: 1 }, look: 'tusks', tint: '#f2ead7' },
  { id: 'tusks', slot: 'mouth', name: 'Tusks', flavor: 'Nothing argues with tusks.', stats: { strength: 12, toughness: 3 } },
  { id: 'wetEyes', slot: 'eyes', name: 'Wet Eyes', flavor: 'Clear in water, blurry out of it.', stats: { senses: 2, charm: 1 }, look: 'eyespots', tint: '#8fd3f0' },
  { id: 'stalkEyes', slot: 'eyes', name: 'Stalk Eyes', flavor: 'They see round corners. Almost.', stats: { senses: 7 } },
  { id: 'compoundEyes', slot: 'eyes', name: 'Compound Eyes', flavor: 'A hundred little pictures at once.', stats: { senses: 5 }, look: 'lensEyes', tint: '#7fe0b0' },
  { id: 'periscope', slot: 'eyes', name: 'Periscope Eyes', flavor: 'Up above the reeds, the rest below.', stats: { senses: 5, toughness: 1 }, look: 'stalkEyes', tint: '#5fbf78' },
  { id: 'sideEyes', slot: 'eyes', name: 'Wide-set Eyes', flavor: 'Nothing sneaks up from the side.', stats: { senses: 6, speed: 2 }, look: 'lensEyes', tint: '#f5c45e' },
  { id: 'brightEyes', slot: 'eyes', name: 'Bright Eyes', flavor: 'Big, shining, and hard to say no to.', stats: { senses: 4, charm: 4 }, look: 'lensEyes', tint: '#e68ab8' },
  { id: 'hawkEyes', slot: 'eyes', name: 'Hawk Eyes', flavor: 'A beetle, from the top of a cliff.', stats: { senses: 9, speed: 1 }, look: 'lensEyes', tint: '#f2906c' },
  { id: 'nightEyes', slot: 'eyes', name: 'Night Eyes', flavor: 'Wide, wet and made for the dark.', stats: { senses: 13 } },
  { id: 'glowEyes', slot: 'eyes', name: 'Glow Eyes', flavor: 'They light the way, and they look lovely.', stats: { senses: 9, charm: 4 }, look: 'nightEyes', tint: '#7fe0b0' },
  { id: 'farSight', slot: 'eyes', name: 'Far Sight', flavor: 'The whole valley, at a glance.', stats: { senses: 14, speed: 2 }, look: 'stalkEyes', tint: '#f5c45e' },
  { id: 'shell', slot: 'back', name: 'Shell', flavor: 'A house you carry.', stats: { toughness: 4 } },
  { id: 'barnacles', slot: 'back', name: 'Barnacles', flavor: 'Hitchhikers, but tough ones.', stats: { toughness: 4, charm: 1 }, look: 'spines', tint: '#c8d2d8' },
  { id: 'backFin', slot: 'back', name: 'Back Fin', flavor: 'Cuts the water, and the wind.', stats: { speed: 3, charm: 2 }, look: 'sail', tint: '#4c8fb3' },
  { id: 'sail', slot: 'back', name: 'Back Sail', flavor: 'Bright, tall and very noticeable.', stats: { charm: 6, toughness: 1 } },
  { id: 'mossCoat', slot: 'back', name: 'Moss Coat', flavor: 'Grows on it. It doesn\'t mind.', stats: { toughness: 3, charm: 2, senses: 1 }, look: 'shell', tint: '#5fbf78' },
  { id: 'barkPlates', slot: 'back', name: 'Bark Plates', flavor: 'Like a tree, from the outside.', stats: { toughness: 6, strength: 1 }, look: 'shell', tint: '#8a6a3a' },
  { id: 'leafFrill', slot: 'back', name: 'Leaf Frill', flavor: 'A crest of green, shaken at rivals.', stats: { charm: 6, speed: 1 }, look: 'sail', tint: '#5fbf78' },
  { id: 'stonePlates', slot: 'back', name: 'Stone Plates', flavor: 'Heavy, grey and nearly unbreakable.', stats: { toughness: 10 }, look: 'shell', tint: '#75848d' },
  { id: 'crystalSpines', slot: 'back', name: 'Crystal Spines', flavor: 'They catch the light in the dark.', stats: { toughness: 7, charm: 4 }, look: 'spines', tint: '#8fd3f0' },
  { id: 'woollyCoat', slot: 'back', name: 'Woolly Coat', flavor: 'Warm in the wind up high.', stats: { toughness: 9, charm: 3, strength: 2 }, look: 'shell', tint: '#f2ead7' },
  { id: 'paddleTail', slot: 'tail', name: 'Paddle Tail', flavor: 'A good push off the sand.', stats: { speed: 3 }, look: 'finTail', tint: '#5fa8bf' },
  { id: 'curlTail', slot: 'tail', name: 'Curl Tail', flavor: 'Wound up like a shell.', stats: { charm: 3, toughness: 1 }, look: 'crestTail', tint: '#f2906c' },
  { id: 'eelTail', slot: 'tail', name: 'Eel Tail', flavor: 'Long, slick and always moving.', stats: { speed: 4, senses: 1 }, look: 'finTail', tint: '#3e6e3a' },
  { id: 'reedTail', slot: 'tail', name: 'Reed Tail', flavor: 'Feathery, like the marsh tops.', stats: { senses: 3, charm: 3 }, look: 'crestTail', tint: '#a0884a' },
  { id: 'crestTail', slot: 'tail', name: 'Crest Tail', flavor: 'Fanned out for anyone watching.', stats: { charm: 9 } },
  { id: 'bushyTail', slot: 'tail', name: 'Bushy Tail', flavor: 'Mostly fluff. Very good fluff.', stats: { charm: 4, toughness: 2 }, look: 'crestTail', tint: '#c4613f' },
  { id: 'clubTail', slot: 'tail', name: 'Club Tail', flavor: 'An argument at the end of a tail.', stats: { strength: 6, toughness: 4 } },
  { id: 'balanceTail', slot: 'tail', name: 'Balance Tail', flavor: 'For narrow ledges and long drops.', stats: { speed: 5, strength: 3 }, look: 'finTail', tint: '#75848d' },
  { id: 'feelerTail', slot: 'tail', name: 'Feeler Tail', flavor: 'It knows what\'s behind.', stats: { senses: 6, speed: 2 }, look: 'finTail', tint: '#c8d2d8' },
  { id: 'spikeTail', slot: 'tail', name: 'Spike Tail', flavor: 'Spikes at the end, and it swings.', stats: { strength: 9, toughness: 4 }, look: 'clubTail', tint: '#f2ead7' },
];

export const PLACES: PlaceDef[] = [
  { id: 'shore', name: 'Shoreline', flavor: 'Wet sand and things the tide forgot.', minutes: 2, needs: {  }, parts: ['paddles', 'filterMouth', 'wetEyes', 'shell', 'paddleTail'], mateChance: 0.6, bonus: { kind: 'stageMult', mult: 1.3 } },
  { id: 'tidePools', name: 'Tide Pools', flavor: 'Little worlds in every hollow.', minutes: 5, needs: { senses: 14 }, parts: ['suckerFeet', 'crabLegs', 'pincers', 'snout', 'stalkEyes', 'compoundEyes', 'barnacles', 'backFin', 'curlTail'], mateChance: 0.6, after: ['shore'], bonus: { kind: 'stageMult', mult: 1.3 } },
  { id: 'marsh', name: 'Marsh', flavor: 'Soft ground, tall reeds, and a lot of noise.', minutes: 8, needs: { speed: 31 }, parts: ['runner', 'webbedFeet', 'longTongue', 'mudSifter', 'periscope', 'sail', 'mossCoat', 'eelTail', 'reedTail'], mateChance: 0.6, unlocks: 'waterhole', after: ['shore'] },
  { id: 'forest', name: 'Forest Edge', flavor: 'Shade, seeds and something watching.', minutes: 12, needs: { senses: 25, speed: 25 }, parts: ['springLegs', 'treeClaws', 'beak', 'grinders', 'sideEyes', 'brightEyes', 'barkPlates', 'leafFrill', 'crestTail', 'bushyTail'], mateChance: 0.6, bonus: { kind: 'stageMult', mult: 1.6 }, after: ['tidePools', 'marsh'] },
  { id: 'cliffs', name: 'Cliffs', flavor: 'Wind, gulls and a long way down.', minutes: 18, needs: { strength: 19, toughness: 12 }, parts: ['climber', 'hookBeak', 'hawkEyes', 'stonePlates', 'clubTail', 'balanceTail'], mateChance: 0.6, bonus: { kind: 'forageMult', mult: 2 }, after: ['marsh'] },
  { id: 'caves', name: 'Caves', flavor: 'Cool, dark and full of echoes.', minutes: 25, needs: { senses: 33, toughness: 29 }, parts: ['caveStriders', 'fangs', 'nightEyes', 'glowEyes', 'crystalSpines', 'feelerTail'], mateChance: 0.6, unlocks: 'den', after: ['forest', 'cliffs'] },
  { id: 'highlands', name: 'Highlands', flavor: 'Open sky, far horizons, and room for everyone.', minutes: 40, needs: { speed: 23, strength: 24 }, parts: ['hooves', 'tusks', 'farSight', 'woollyCoat', 'spikeTail'], mateChance: 0.6, unlocks: 'territory', after: ['caves'] },
];

/** The Field Guide: one page per place, plus the ending. */
const pages: ReactionDef[] = PLACES.map((p) => ({
  id: p.id,
  name: p.name,
  flavor: p.flavor,
  hints: [`Somewhere out there: ${p.name.toLowerCase()}.`, 'Let your creature roam there.'],
  needs: {},
  manual: true,
  bonus: p.bonus,
  unlocks: p.unlocks,
}));

const final: ReactionDef = {
  id: 'many',
  name: 'Many',
  flavor: 'A line long enough to fill the land.',
  hints: ['One is not enough.', 'Every place roamed, a line six generations long, and a great herd across the land.'],
  needs: { found: 7, generation: 6, pop: 400, gens: { territory: 8 } },
  final: true,
  cost: 2e10,
};

/** Things it runs into partway through a roam. Left alone, instinct plays safe (the last option). */
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
  { id: 'trainStrength', branch: 'Training', name: 'Wrestling', flavor: 'With rocks, mostly.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'strength', amount: 1 }, requires: { found: 2 } },
  { id: 'trainSenses', branch: 'Training', name: 'Watching', flavor: 'Sit very still and notice things.', cost: 500, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'senses', amount: 1 } },
  { id: 'trainToughness', branch: 'Training', name: 'Hard Knocks', flavor: 'Every bruise teaches something.', cost: 800, levels: Infinity, costGrowth: 2.2, effect: { kind: 'stat', stat: 'toughness', amount: 1 }, requires: { reaction: 'marsh' } },
  { id: 'trainCharm', branch: 'Training', name: 'Display', flavor: 'Puff up. Look grand. Hope.', cost: 1200, levels: Infinity, costGrowth: 2.3, effect: { kind: 'stat', stat: 'charm', amount: 1 }, requires: { found: 2 } },
  { id: 'bigHeart', branch: 'Training', name: 'Bigger Heart', flavor: 'More blood, more body to move.', cost: 600, levels: Infinity, costGrowth: 2.6, effect: { kind: 'energy', amount: 1 }, requires: { found: 2 } },
  // Instincts: bred into the line, each sends a share of the herd to do something on its own.
  { id: 'nesting', branch: 'Instincts', name: 'Nesting Instinct', flavor: 'Some stay by the eggs, and will not be moved.', cost: 800, levels: 5, costGrowth: 8, effect: { kind: 'instinct', role: 'carer', share: 0.03 }, requires: { generation: 1 } },
  { id: 'burrowing', branch: 'Instincts', name: 'Burrowing', flavor: 'Claws that itch to dig.', cost: 6000, levels: 5, costGrowth: 8, effect: { kind: 'instinct', role: 'digger', share: 0.03 }, requires: { reaction: 'tidePools' } },
  { id: 'sentries', branch: 'Instincts', name: 'Sentries', flavor: 'Someone always has its head up.', cost: 5e4, levels: 5, costGrowth: 8, effect: { kind: 'instinct', role: 'guard', share: 0.02 }, requires: { reaction: 'marsh' } },
  { id: 'following', branch: 'Instincts', name: 'Follow the Leader', flavor: 'The young trail after the one who knows the way.', cost: 4e5, levels: 5, costGrowth: 8, effect: { kind: 'instinct', role: 'scout', share: 0.02 }, requires: { reaction: 'forest' } },
  // On the road.
  { id: 'goodPickings', branch: 'Wandering', name: 'Good Pickings', flavor: 'It learns where the best of each place grows.', cost: 2e4, levels: 6, costGrowth: 12, effect: { kind: 'tripMult', mult: 1.5 }, requires: { found: 3 } },
  { id: 'rounds', branch: 'Wandering', name: 'Foraging Rounds', flavor: 'It knows where everything grows, and tends it.', cost: 2e7, effect: { kind: 'rounds' }, requires: { reaction: 'forest' } },
  { id: 'parties', branch: 'Wandering', name: 'Foraging Parties', flavor: 'The young know the way now. They go without being led.', cost: 1e9, levels: 3, costGrowth: 8, effect: { kind: 'parties', count: 1 }, requires: { reaction: 'highlands', upgrades: ['rounds'] } },
  { id: 'curiosity', branch: 'Wandering', name: 'Curiosity', flavor: 'It can never leave a corner of the map alone.', cost: 3000, levels: 3, costGrowth: 60, effect: { kind: 'curiosity', level: 1 }, requires: { found: 2 } },
  // Herd and seasons.
  { id: 'fatStores', name: 'Fat Stores', flavor: 'Eat in summer, live on it in winter.', cost: 400, levels: 5, costGrowth: 6, effect: { kind: 'upkeepMult', mult: 0.85 }, requires: { pop: 10 } },
  { id: 'thickCoats', name: 'Thick Coats', flavor: 'Fur, feathers or blubber: whatever keeps the cold out.', cost: 2000, levels: 5, costGrowth: 6, effect: { kind: 'winterMult', mult: 0.7 }, requires: { found: 2 } },
  { id: 'foodSharing', name: 'Food Sharing', flavor: 'Whoever finds food calls the others.', cost: 1500, levels: 5, costGrowth: 7, effect: { kind: 'stageMult', mult: 1.3 }, requires: { pop: 15 } },
  { id: 'packMemory', name: 'Trail Memory', flavor: 'The way home, remembered.', cost: 5000, effect: { kind: 'tripMult', mult: 2 }, requires: { reaction: 'shore' } },
  { id: 'cellFeeding', name: 'Old Cell Lines', flavor: 'Every cell in it remembers the pond.', cost: 2e4, effect: { kind: 'feedMult', mult: 1.3 }, requires: { found: 3 } },
  { id: 'migration', name: 'Migration', flavor: 'When winter comes, the herd walks to where it is milder.', cost: 1e7, effect: { kind: 'winterMult', mult: 0.4 }, extra: [{ kind: 'upkeepMult', mult: 0.8 }], requires: { reaction: 'highlands' } },
  // Giving back: bought with Biomass, felt in the Cell and the Soup (which feed back up).
  { id: 'gutFlora', name: 'Gut Flora', flavor: 'Bacteria thrive inside the creature\'s gut, and spread wherever it goes.', cost: 1e4, levels: 5, costGrowth: 25, target: 'cell', effect: { kind: 'stageMult', mult: 1.5 }, requires: { found: 2 } },
  { id: 'droppings', name: 'Droppings', flavor: 'What goes in comes out, and washes back into the Shallows.', cost: 1e7, target: 'cell', effect: { kind: 'habitatMult', habitat: 'shallows', mult: 3 }, requires: { reaction: 'marsh' } },
  { id: 'mudStirring', name: 'Stirred Mud', flavor: 'Feet churn the bottom mud and feed the dark below.', cost: 1e9, target: 'cell', effect: { kind: 'habitatMult', habitat: 'depths', mult: 3 }, requires: { reaction: 'caves' } },
  { id: 'fallenGiants', name: 'Fallen Giants', flavor: 'When a big one dies at sea, it sinks and feeds the deep for years.', cost: 1e11, target: 'cell', effect: { kind: 'habitatMult', habitat: 'vents', mult: 3 }, requires: { reaction: 'highlands' } },
  { id: 'tidalRunoff', name: 'Tidal Runoff', flavor: 'Rain washes the land\'s leftovers back to the sea, where it all began.', cost: 1e13, target: 'soup', effect: { kind: 'stageMult', mult: 2 }, requires: { reaction: 'highlands' } },
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
  // Not producers: the herd forages (see economy/creature.ts). These are where it
  // lives and feeds, dug or found or spread into: births, room, food and shelter.
  generators: [
    { id: 'nest', name: 'Nests', flavor: 'Scraped hollows in the warm sand. More births.', baseCost: 1e3, growth: 1.15, baseRate: 0 },
    { id: 'burrow', name: 'Burrows', flavor: 'Holes dug into the bank: room for three more.', baseCost: 5.7e5, growth: 1.15, baseRate: 0 },
    { id: 'waterhole', name: 'Marsh Grazing', flavor: 'The herd spreads into the reeds: the same food goes further.', baseCost: 1e6, growth: 1.3, baseRate: 0, unlockedBy: 'marsh' },
    { id: 'den', name: 'Caves', flavor: 'Out of the wind: room for fifteen, and shelter from winter.', baseCost: 1.5e7, growth: 1.2, baseRate: 0, unlockedBy: 'caves' },
    { id: 'territory', name: 'Home Range', flavor: 'More land roamed and grazed: room for fifty, and richer foraging.', baseCost: 8e8, growth: 1.35, baseRate: 0, unlockedBy: 'highlands' },
  ],
  upgrades: UPGRADES,
  reactions: [...pages, final],
  milestones: MILESTONES,
  parts: PARTS,
  places: PLACES,
};
