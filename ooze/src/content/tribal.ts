// The Tribal era. A spear falls from the sky and breaks the island; a quarter of the herd
// lives through it, on the one piece of land left, around the crater where the spear still
// stands. Touching it, they wake: they know they are. From here on it is a different game:
// many hands, jobs you give, things built, and in time a boat to a new island (and the
// rivals already there).
//
// STORY: every line marked [STORY] is a placeholder for the real script.

import type { StageDef } from '../economy/types';

/** The words of the strike and the waking, in order. Placeholders until the script is written. */
export const STORY = {
  /** Over the night sky, before the spear falls. */
  omen: '[STORY] The night was quiet. Then the sky split.',
  /** As it strikes. */
  strike: '[STORY] Something fell from beyond the sky, and the island broke.',
  /** The first look at what's left. */
  after: '[STORY] When the sea settled, one piece of the land was left, and a few of them on it.',
  /** Before they touch it: the goal line. */
  approach: '[STORY] It stands in the crater, humming. They keep away. One does not.',
  /** The waking. */
  wake: '[STORY] It touched the spear, and for the first time, it knew that it was.',
  /** Shown under the waking. */
  wakeSub: '[STORY] The others felt it too. They looked at each other differently now.',
};

export const tribal: StageDef = {
  id: 'tribal',
  name: 'Tribal',
  currency: 'Food',
  goal: 0,
  intro: '[STORY] What was left of them gathered by the spear.',
  tapBase: 0,
  startingGenerators: 0,
  tribal: true,
  generators: [],
  upgrades: [],
};
