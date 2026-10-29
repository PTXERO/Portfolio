// The Extinction: the first part of the Tribal era. A spear falls from the sky and burns the
// island to ash; a quarter of the herd lives through it. One walks out to the spear, standing
// in a small lake at the island's heart, and touches it, and they wake: they know they are.
// Then they have to live, on almost nothing, long enough to build a raft; most won't. Only a
// few (a family) cross to the next island, where the rivals already are.
//
// STORY: every line marked [STORY] is a placeholder for the real script.

import type { StageDef } from '../economy/types';

/** The words of the strike and the waking, in order. Placeholders until the script is written. */
export const STORY = {
  /** Over the night sky, before the spear falls. */
  omen: '[STORY] The night was quiet. Then the sky split.',
  /** As it strikes. */
  strike: '[STORY] Something fell from beyond the sky, and the world burned.',
  /** The first look at what's left. */
  after: '[STORY] When the fire burned down, the island was ash. A few of them were left.',
  /** The walk out to the spear. */
  approach: '[STORY] The others kept away from it. One did not.',
  /** At the spear: the prompt to touch it. */
  touch: 'Touch the spear.',
  /** The waking. */
  wake: '[STORY] It touched the spear, and for the first time, it knew that it was.',
  /** Shown under the waking. */
  wakeSub: '[STORY] The others felt it too. They looked at each other differently now.',
};

export const tribal: StageDef = {
  id: 'tribal',
  name: 'Extinction',
  currency: 'Food',
  goal: 0,
  intro: '[STORY] What was left of them huddled in the ash.',
  tapBase: 0,
  startingGenerators: 0,
  tribal: true,
  generators: [],
  upgrades: [],
};
