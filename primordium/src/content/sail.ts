// The Age of Sail: from the Republic out across the sea, until the world is one people. (The
// design is in the design doc's Age of Sail section.) For now, the world map; ships, routes and
// Influence come next.

import type { StageDef } from '../economy/types';

export const sail: StageDef = {
  id: 'sail',
  name: 'The Age of Sail',
  currency: 'Influence',
  goal: 0,
  intro: '[STORY] They looked out to sea, and the sea was wider than they knew.',
  tapBase: 0,
  startingGenerators: 0,
  sail: true,
  generators: [],
  upgrades: [],
};
