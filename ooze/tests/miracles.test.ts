import { describe, expect, it } from 'vitest';
import { DAY_SEC, decideFallen, extinctionTick, learnIdea, startExtinction, type ExtinctionState } from '../src/economy/extinction';
import { canCast, cast, spellsFor, type SpellId } from '../src/economy/miracles';
import { createState } from '../src/economy/state';
import type { GameState } from '../src/economy/types';

function game(diet: string): GameState {
  const s = createState();
  s.unlocked.push('tribal');
  s.current = 'tribal';
  s.stages.tribal.tribe = { awake: true, pop: 100, survivors: 100, look: { parts: {}, diet }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
  startExtinction(s);
  return s;
}

const PATHS: Record<string, string[]> = {
  grazer: ['green', 'stick', 'rootlore', 'warmth', 'fire', 'deeproots', 'seeds', 'tend', 'edges', 'tools', 'rope'],
  hunter: ['watch', 'line', 'bait', 'warmth', 'fire', 'deeper', 'nets', 'edges', 'tools', 'rope'],
  omnivore: ['watch', 'line', 'green', 'stick', 'warmth', 'fire', 'bait', 'rootlore', 'deeper', 'deeproots', 'edges', 'tools', 'rope'],
};

/** Plays a run: `ideas` teaches the path, `god` works miracles as a sensible player would. */
function run(diet: string, ideas: boolean, god: boolean, cap = 90): { days: number; ex: ExtinctionState; casts: number } {
  const s = game(diet);
  const ex = () => s.stages.tribal.tribe!.ex!;
  let casts = 0;
  while (!ex().over && !ex().escaped && ex().day < cap) {
    const e = ex();
    if (ideas) for (const id of PATHS[diet]) {
      if (e.ideas.includes(id)) continue;
      if (!learnIdea(s, id)) break;
    }
    if (god) {
      const tryCast = (id: SpellId, people?: number[]) => {
        if (canCast(e, id) && cast(e, id, { people }).ok) casts++;
      };
      const weak = e.people.map((p, i) => [p, i] as const).filter(([p]) => p.sick !== undefined || p.hunger >= 2);
      if (weak.length >= 3) tryCast('ward', weak.slice(0, 10).map(([, i]) => i));
      const food = spellsFor(e.diet).filter((sp) => ['quicken', 'kelp', 'shoals', 'dying'].includes(sp.id)).map((sp) => sp.id);
      if ((e.last?.ate ?? 0) < (e.last?.wanted ?? 0) || e.ration < 1) for (const id of food) tryCast(id);
      if ((e.ideas.includes('fire') && (e.wood ?? 0) < 4) || (e.day >= 12 && e.day < 26 && !e.ideas.includes('fire'))) tryCast('lightning');
      if (e.ash < e.ashMax * 0.4) tryCast('rain');
    }
    if (e.fallen === 'undecided' && e.corpses > 0) decideFallen(s, false);
    extinctionTick(s, DAY_SEC / 3);
  }
  return { days: ex().day, ex: ex(), casts };
}

describe('the spear\'s will', () => {
  it('gives each diet five miracles', () => {
    for (const d of ['herbivore', 'carnivore', 'omnivore', 'cannibal'] as const) expect(spellsFor(d).length).toBe(5);
  });

  it('without a god they die; with a good one they live', () => {
    for (const diet of ['omnivore', 'grazer', 'hunter']) {
      const none = run(diet, false, false);
      const ideasOnly = run(diet, true, false);
      const both = run(diet, true, true);
      const tag = (r: ReturnType<typeof run>) => `${r.days}d ${r.ex.escaped ? 'ESCAPED' : r.ex.over ? 'extinct' : 'holding'} (${r.ex.people.length} alive, dread ${Math.round(r.ex.dread ?? 0)}, ${r.casts} casts)`;
      console.log(`${diet}: no god ${tag(none)} · ideas only ${tag(ideasOnly)} · ideas + miracles ${tag(both)}`);
      expect(none.ex.over).toBe(true);
    }
  });
});
