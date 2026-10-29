// Crises: moments only the player's own hand can answer. Every so often something happens out
// on the island that needs the right miracle, drawn in the right place, before time runs out:
// an ash storm rolling in, someone trapped in a fissure, a shoal glittering offshore, buried
// seed stirring, a cold night coming, a wounded beast. Answered, it goes far better than any
// miracle worked at random (or ordained); missed, it costs. Ordained miracles never answer them.

import { DAY_SEC, type ExtinctionState } from './extinction';
import { say, SPELL, type SpellId } from './miracles';
import { remember } from './society';

export type CrisisKind = 'storm' | 'trapped' | 'shoal' | 'seeds' | 'cold' | 'beast';

export interface Crisis {
  kind: CrisisKind;
  spell: SpellId;
  /** Where it is on the island (tiles), and when (seconds into the day) it's too late. */
  x: number;
  y: number;
  until: number;
  day: number;
  /** For one trapped: who. */
  who?: number;
}

export const CRISES: Record<CrisisKind, { spells: SpellId[]; call: string; how: string }> = {
  storm: { spells: ['rain'], call: 'An ash storm is rolling in.', how: 'Rain on it' },
  trapped: { spells: ['ward'], call: 'is trapped in a fissure.', how: 'Ward them' },
  shoal: { spells: ['shoals', 'kelp'], call: 'Something glitters offshore.', how: 'Drive it ashore from there' },
  seeds: { spells: ['quicken'], call: 'Buried seed is stirring in the ash.', how: 'Quicken it' },
  cold: { spells: ['lightning'], call: 'A cold night is coming.', how: 'Light a fire before dusk' },
  beast: { spells: ['dying'], call: 'A wounded beast is out in the ash.', how: 'Call it in from there' },
};

/** Seconds to answer one. */
export const CRISIS_SEC = 30;

function roll(ex: ExtinctionState): number {
  ex.luck = ((ex.luck ?? 1) * 1664525 + 1013904223) >>> 0;
  return ex.luck / 2 ** 32;
}

/** At dawn: whether something will happen today, what, and when. */
export function planCrisis(ex: ExtinctionState): void {
  ex.crisisPlan = undefined;
  if (ex.day < 4 || ex.crisis || roll(ex) > 0.5) return;
  const known = ex.powers ?? [];
  const kinds = (Object.keys(CRISES) as CrisisKind[]).filter((k) => CRISES[k].spells.some((s) => known.includes(s) && SPELL[s].diets.includes(ex.diet)));
  if (!kinds.length) return;
  const kind = kinds[Math.floor(roll(ex) * kinds.length)];
  ex.crisisPlan = { kind, at: 4 + roll(ex) * (DAY_SEC - CRISIS_SEC - 8) };
}

/** It happens (the scene has found where): it's on, with the clock running. */
export function startCrisis(ex: ExtinctionState, at: { x: number; y: number; who?: number }): Crisis | null {
  const plan = ex.crisisPlan;
  if (!plan) return null;
  ex.crisisPlan = undefined;
  const spell = CRISES[plan.kind].spells.find((s) => (ex.powers ?? []).includes(s))!;
  ex.crisis = { kind: plan.kind, spell, x: at.x, y: at.y, until: Math.min(DAY_SEC - 1, ex.clock + CRISIS_SEC), day: ex.day, who: at.who };
  return ex.crisis;
}

/** Answered in time (the miracle's own effect, doubled, is the caster's to apply). */
export function crisisAnswered(ex: ExtinctionState): string {
  const c = ex.crisis!;
  ex.crisis = undefined;
  ex.dread = Math.max(0, (ex.dread ?? 0) - 4);
  const who = c.who !== undefined ? ex.people.find((p) => p.id === c.who) : undefined;
  switch (c.kind) {
    case 'storm':
      say(ex, 'An ash storm came down on them, and rain met it in the air. The ash fell as mud, and they could breathe.');
      return 'The storm broke';
    case 'trapped':
      if (who) {
        who.hunger = Math.max(0, who.hunger - 0.5);
        remember(ex, who, 'was pulled from a fissure, wrapped in light');
        say(ex, `${who.name} had fallen into a fissure. A light came down round them, and they climbed out.`);
      }
      return 'Saved';
    case 'shoal':
      say(ex, 'A shoal had come close in. The sea drove it onto the sand, all of it.');
      return 'The whole shoal';
    case 'seeds':
      say(ex, 'Where the seed was stirring, the green came up thick.');
      return 'A thick crop';
    case 'cold':
      say(ex, 'A cold came down at dusk, but there was fire, and they lived through it.');
      return 'Fire for the cold';
    case 'beast':
      say(ex, 'A great wounded beast had been out on the ash. It came all the way in.');
      return 'The whole beast';
  }
}

/** Too late: what it costs. */
export function crisisMissed(ex: ExtinctionState): void {
  const c = ex.crisis!;
  ex.crisis = undefined;
  switch (c.kind) {
    case 'storm':
      for (const p of ex.people) p.hunger += 0.3;
      ex.ash *= 0.9;
      say(ex, 'The ash storm came down on them. They choked through the night, and it smothered what was growing.');
      break;
    case 'trapped': {
      const who = ex.people.find((p) => p.id === c.who);
      if (!who) break;
      ex.people = ex.people.filter((p) => p !== who);
      ex.deaths += 1;
      ex.corpses += ex.fallen === 'undecided' ? 1 : 0;
      say(ex, `${who.name} had fallen into a fissure. The others couldn't reach them. They called out until dark.`);
      break;
    }
    case 'shoal':
      say(ex, 'A shoal came close in, and went again.');
      break;
    case 'seeds':
      say(ex, 'Something had been stirring in the ash. It went still.');
      break;
    case 'cold':
      ex.coldTonight = true;
      say(ex, 'A cold came down at dusk, and there was no fire.');
      break;
    case 'beast':
      say(ex, 'A wounded beast had been out on the ash. It wandered off to die somewhere else.');
      break;
  }
}
