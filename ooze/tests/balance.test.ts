// Balance across every diet: herbivore, carnivore, omnivore, and cannibal (each of the three
// lines, having eaten its dead). Each is played three ways over several seeds: with no god (no
// ideas, no miracles), with ideas only, and with a good god (ideas and miracles, played well).
// What should hold: with no god they die; a good god gets the four away, still losing a good
// share of the tribe on the way.

import { describe, expect, it } from 'vitest';
import { DAY_SEC, decideFallen, eatsMeat, eatsPlants, extinctionTick, learnIdea, startExtinction, type ExtinctionState } from '../src/economy/extinction';
import { canCast, cast, spellsFor, type SpellId } from '../src/economy/miracles';
import { createState } from '../src/economy/state';

/** The ideas a sensible god teaches, for what the line can eat (both raft ideas last). */
function pathFor(ex: ExtinctionState): string[] {
  const plants = ['green', 'stick', 'watch', 'line', 'rootlore', 'tubers', 'warmth', 'fire', 'deeproots', 'bait', 'deeper', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'];
  const meat = ['watch', 'line', 'bait', 'deeper', 'warmth', 'fire', 'nets', 'green', 'stick', 'rootlore', 'tubers', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'];
  return eatsPlants(ex.diet) && !eatsMeat(ex.diet) ? plants : meat;
}

type Way = 'none' | 'ideas' | 'god';
function play(line: string, way: Way, eatDead: boolean, seed: number) {
  const s = createState();
  s.unlocked.push('tribal');
  s.current = 'tribal';
  s.stages.tribal.tribe = { awake: true, pop: 100, survivors: 100, look: { parts: {}, diet: line }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed, year: 0 };
  startExtinction(s);
  const ex = () => s.stages.tribal.tribe!.ex!;
  while (!ex().over && !ex().escaped && ex().day < 100) {
    const e = ex();
    if (way !== 'none') for (const id of pathFor(e)) {
      if (e.ideas.includes(id)) continue;
      if (!learnIdea(s, id)) break;
    }
    if (way === 'god') {
      const tryCast = (id: SpellId, people?: number[]) => {
        if (canCast(e, id)) cast(e, id, { people });
      };
      const weak = e.people.map((p, i) => [p, i] as const).filter(([p]) => p.sick !== undefined || p.hunger >= 2);
      if (weak.length >= 3) tryCast('ward', weak.slice(0, 10).map(([, i]) => i));
      const food = spellsFor(e.diet).filter((sp) => ['quicken', 'kelp', 'shoals', 'dying'].includes(sp.id)).map((sp) => sp.id);
      if ((e.last?.ate ?? 0) < (e.last?.wanted ?? 0) || e.ration < 1 || e.triage) for (const id of food) tryCast(id);
      if ((e.ideas.includes('fire') && (e.wood ?? 0) < 4) || (e.day >= 12 && e.day < 26 && !e.ideas.includes('fire'))) tryCast('lightning');
      if (e.ash < e.ashMax * 0.4) tryCast('rain');
    }
    if (e.fallen === 'undecided' && e.corpses > 0) decideFallen(s, eatDead);
    extinctionTick(s, DAY_SEC / 3);
  }
  const e = ex();
  return { escaped: !!e.escaped, over: e.over, day: e.day, lost: e.deaths, born: e.births ?? 0, diet: e.diet };
}

const LINES = [
  ['herbivore', 'grazer'],
  ['carnivore', 'hunter'],
  ['omnivore', 'omnivore'],
] as const;
const SEEDS = [1234, 777, 4242];

describe('balance, every diet', () => {
  for (const eatDead of [false, true]) {
    for (const [name, line] of LINES) {
      const label = eatDead ? `${name} → cannibal` : name;
      it(`${label}: no god dies; a good god escapes, losing a share`, () => {
        const none = SEEDS.map((sd) => play(line, 'none', eatDead, sd));
        const ideas = SEEDS.map((sd) => play(line, 'ideas', eatDead, sd));
        const god = SEEDS.map((sd) => play(line, 'god', eatDead, sd));
        const show = (rs: ReturnType<typeof play>[]) => rs.map((r) => `${r.escaped ? 'ESC' : r.over ? 'EXT' : 'hold'} d${r.day} lost ${r.lost}`).join(' | ');
        console.log(`${label.padEnd(22)} no god: ${show(none)}\n${''.padEnd(22)} ideas:  ${show(ideas)}\n${''.padEnd(22)} god:    ${show(god)}`);
        // With no god: gone.
        for (const r of none) expect(r.over).toBe(true);
        // A good god: the four get away in most runs, and it still costs.
        expect(god.filter((r) => r.escaped).length).toBeGreaterThanOrEqual(2);
        const avgLost = god.reduce((a, r) => a + r.lost, 0) / god.length;
        expect(avgLost).toBeGreaterThan(15);
      }, 120_000);
    }
  }
});
