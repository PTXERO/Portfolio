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

export type BuildId = 'hearth' | 'hut' | 'rack' | 'woodpile' | 'camp' | 'cutter';

export interface BuildDef {
  id: BuildId;
  name: string;
  /** What it does, for the card. */
  does: string;
  /** Wood for the first; each after costs `growth` times the last. */
  wood: number;
  growth: number;
  /** At most this many (unset: no limit). */
  max?: number;
  /** Shown once this is built. */
  after?: BuildId;
}

export const BUILDS: BuildDef[] = [
  { id: 'hearth', name: 'The Hearth', does: 'A fire to gather round. Children are only born where there\'s a hearth.', wood: 6, growth: 1, max: 1 },
  { id: 'hut', name: 'Hut', does: 'Room for 4 more.', wood: 10, growth: 1.16, after: 'hearth' },
  { id: 'woodpile', name: 'Woodpile', does: 'Room for 50 more wood.', wood: 10, growth: 1.3, after: 'hearth' },
  { id: 'rack', name: 'Drying rack', does: 'Room for 40 more food.', wood: 14, growth: 1.3, after: 'hut' },
  { id: 'camp', name: 'Gathering camp', does: 'Food comes in 20% faster.', wood: 30, growth: 1.45, after: 'hut' },
  { id: 'cutter', name: 'Cutters\' shed', does: 'Wood comes in 20% faster.', wood: 30, growth: 1.45, after: 'woodpile' },
];

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
