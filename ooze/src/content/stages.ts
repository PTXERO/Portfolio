import type { StageDef, StageId } from '../economy/types';

// Names and flavor lines are placeholders until the real script is written.
// Numbers are tuned with `npm run sim` against the targets in the design doc.

const soup: StageDef = {
  id: 'soup',
  name: 'Primordial Soup',
  currency: 'Nutrients',
  goal: 2.5e4,
  intro: 'Something stirs in the warm shallows.',
  tapBase: 1,
  startingGenerators: 1,
  next: 'cell',
  generators: [
    { id: 'amino', name: 'Amino Drift', flavor: 'Loose building blocks, bumping into each other.', baseCost: 10, growth: 1.07, baseRate: 0.5 },
    { id: 'lipid', name: 'Lipid Bubble', flavor: 'A wall around nothing yet.', baseCost: 100, growth: 1.08, baseRate: 3 },
    { id: 'rna', name: 'RNA Strand', flavor: 'It copies itself. Mostly correctly.', baseCost: 1100, growth: 1.09, baseRate: 20 },
    { id: 'protocell', name: 'Protocell', flavor: 'Almost alive. Almost.', baseCost: 12000, growth: 1.1, baseRate: 140 },
  ],
  upgrades: [
    { id: 'warmVents', name: 'Warm Vents', flavor: 'Stirring gets easier near the heat.', cost: 30, effect: { kind: 'tapMult', mult: 2 } },
    { id: 'aminoChains', name: 'Amino Chains', flavor: 'Blocks start holding hands.', cost: 150, effect: { kind: 'genMult', target: 'amino', mult: 2 }, requires: { generator: 'amino', owned: 10 } },
    { id: 'tidalMixing', name: 'Tidal Mixing', flavor: 'Every stir moves the whole pool.', cost: 800, effect: { kind: 'tapFromRate', seconds: 0.1 } },
    { id: 'lipidFolding', name: 'Lipid Folding', flavor: 'Bubbles inside bubbles.', cost: 1500, effect: { kind: 'genMult', target: 'lipid', mult: 2 }, requires: { generator: 'lipid', owned: 10 } },
    { id: 'lightning', name: 'Lightning Strike', flavor: 'A jolt of energy through the whole soup.', cost: 5000, effect: { kind: 'stageMult', mult: 1.5 } },
    { id: 'catalyticRna', name: 'Catalytic RNA', flavor: 'Strands that speed up other strands.', cost: 15000, effect: { kind: 'genMult', target: 'rna', mult: 2 }, requires: { generator: 'rna', owned: 10 } },
  ],
};

const cell: StageDef = {
  id: 'cell',
  name: 'Cell',
  currency: 'DNA',
  goal: 5e8,
  intro: 'A membrane closes. Something is inside, and it wants more.',
  tapBase: 0,
  startingGenerators: 1,
  generators: [
    { id: 'fission', name: 'Dividing Cell', flavor: 'One becomes two becomes four.', baseCost: 15, growth: 1.12, baseRate: 1 },
    { id: 'colony', name: 'Colony', flavor: 'Safety in numbers.', baseCost: 200, growth: 1.13, baseRate: 7 },
    { id: 'biofilm', name: 'Biofilm', flavor: 'A slick city on a rock.', baseCost: 2500, growth: 1.14, baseRate: 50 },
    { id: 'mat', name: 'Microbial Mat', flavor: 'Layer upon layer upon layer.', baseCost: 3e4, growth: 1.15, baseRate: 360 },
    { id: 'stromatolite', name: 'Stromatolite', flavor: 'Living rock, a billion years in the making.', baseCost: 4e5, growth: 1.15, baseRate: 2600 },
  ],
  upgrades: [
    { id: 'fastFission', name: 'Fast Fission', flavor: 'Divide first, ask questions later.', cost: 200, effect: { kind: 'genMult', target: 'fission', mult: 2 }, requires: { generator: 'fission', owned: 10 } },
    { id: 'soupFeeding', name: 'Soup Feeding', flavor: 'The old soup still has plenty to give.', cost: 1000, effect: { kind: 'feedMult', mult: 2 } },
    { id: 'quorum', name: 'Quorum Sensing', flavor: 'The colony starts talking.', cost: 2500, effect: { kind: 'genMult', target: 'colony', mult: 2 }, requires: { generator: 'colony', owned: 10 } },
    { id: 'slime', name: 'Extracellular Slime', flavor: 'Gross, but effective.', cost: 3e4, effect: { kind: 'genMult', target: 'biofilm', mult: 2 }, requires: { generator: 'biofilm', owned: 10 } },
    { id: 'endosymbiosis', name: 'Endosymbiosis', flavor: 'Swallowed a neighbour. Kept it.', cost: 1e5, effect: { kind: 'stageMult', mult: 2 } },
    { id: 'layering', name: 'Sediment Layering', flavor: 'Every layer traps a little more.', cost: 4e5, effect: { kind: 'genMult', target: 'mat', mult: 2 }, requires: { generator: 'mat', owned: 10 } },
  ],
};

export const STAGES: Record<StageId, StageDef> = { soup, cell };
export const STAGE_ORDER: StageId[] = ['soup', 'cell'];
