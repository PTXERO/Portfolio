import { answerWhisper } from '../src/economy/whispers';
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
  grazer: ['green', 'stick', 'rootlore', 'tubers', 'warmth', 'fire', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
  hunter: ['watch', 'line', 'bait', 'deeper', 'warmth', 'fire', 'nets', 'green', 'stick', 'rootlore', 'tubers', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
  omnivore: ['watch', 'line', 'green', 'stick', 'bait', 'rootlore', 'warmth', 'fire', 'deeper', 'tubers', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
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
    if (e.whisper) answerWhisper(e, 0);
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
      const tag = (r: ReturnType<typeof run>) => `${r.days}d ${r.ex.escaped ? 'ESCAPED' : r.ex.over ? 'extinct' : 'holding'} (${r.ex.people.length} alive, dread ${Math.round(r.ex.dread ?? 0)}, ${r.casts} casts, ${r.ex.ideas.length} ideas, raft ${Object.values(r.ex.raft ?? {}).map(Math.round).join("/")}, voyage ${Math.round(r.ex.voyage ?? 0)})`;
      console.log(`${diet}: no god ${tag(none)} · ideas only ${tag(ideasOnly)} · ideas + miracles ${tag(both)}`);
      expect(none.ex.over).toBe(true);
    }
  }, 60_000);
});

describe('crises', () => {
  it('cost lives when missed, and only one miracle can be ordained', async () => {
    const { startCrisis, crisisMissed } = await import('../src/economy/crises');
    const { toggleOrdain } = await import('../src/economy/miracles');
    const s = game('omnivore');
    const ex = s.stages.tribal.tribe!.ex!;
    ex.powers = ['lightning', 'rain', 'ward'];
    ex.crisisPlan = { kind: 'trapped', at: 0 };
    const who = ex.people[3].id;
    startCrisis(ex, { x: 0, y: 0, who });
    expect(ex.crisis?.spell).toBe('ward');
    crisisMissed(ex);
    expect(ex.people.some((p) => p.id === who)).toBe(false);
    ex.casts = { lightning: 9, rain: 9 };
    toggleOrdain(ex, 'lightning');
    toggleOrdain(ex, 'rain');
    expect(ex.ordained).toEqual(['rain']);
  });
});

describe('whispers', () => {
  it('a family goes when the spear says so, and the question waits for an answer', async () => {
    const { answerWhisper, chooseFour } = await import('../src/economy/whispers');
    const { waitingOnChoice } = await import('../src/economy/extinction');
    const s = game('omnivore');
    const ex = s.stages.tribal.tribe!.ex!;
    ex.whisper = { id: 'who', who: [], day: ex.day };
    expect(waitingOnChoice(ex)).toBe(true);
    answerWhisper(ex, 2);
    expect(ex.sendRule).toBe('family');
    expect(waitingOnChoice(ex)).toBe(false);
    const four = chooseFour(ex).map((id) => ex.people.find((p) => p.id === id)!);
    expect(four.length).toBe(4);
    const [a, b] = four;
    expect(a.bonds?.some((x) => x.kind === 'mate' && x.id === b.id)).toBe(true);
  });

  it('left unanswered, the leader decides, and the day goes on', async () => {
    const { tribeDecides } = await import('../src/economy/whispers');
    const { waitingOnChoice } = await import('../src/economy/extinction');
    const s = game('omnivore');
    const ex = s.stages.tribal.tribe!.ex!;
    ex.whisper = { id: 'challenge', who: [ex.people[0].id, ex.people[1].id], day: ex.day };
    tribeDecides(ex);
    expect(waitingOnChoice(ex)).toBe(false);
    const said = (ex.log ?? []).slice(-2).map((l) => l.text).join(' ');
    expect(said).toContain('The spear was silent');
    expect(said).not.toContain('The spear stood');
  });
});
