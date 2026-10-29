import { describe, expect, it } from 'vitest';
import { assign, count, daysLeft, decideFallen, DAY_SEC, extinctionTick, ideaCost, learnIdea, startExtinction, tryAgain, type ExtinctionState } from '../src/economy/extinction';
import { MIND_TREE, NODE_COST, reachable } from '../src/economy/mindTree';
import { createState as newGame } from '../src/economy/state';
import type { GameState } from '../src/economy/types';

function game(diet: string, survivors = 100): GameState {
  const s = newGame();
  s.unlocked.push('tribal');
  s.current = 'tribal';
  s.stages.tribal.tribe = { awake: true, pop: survivors, survivors, look: { parts: {}, diet }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
  startExtinction(s);
  return s;
}

/** Plays days with a plan run each dawn; returns days survived (capped). */
function play(s: GameState, plan: (ex: ExtinctionState, s: GameState) => void, cap = 80): number {
  const ex = () => s.stages.tribal.tribe!.ex!;
  while (!ex().over && ex().day < cap) {
    plan(ex(), s);
    if (ex().fallen === 'undecided' && ex().corpses > 0) decideFallen(s, false);
    extinctionTick(s, DAY_SEC);
  }
  return ex().day;
}

function setJobs(ex: ExtinctionState, want: Partial<Record<string, number>>): void {
  for (const j of ['forage', 'scavenge', 'dig', 'fish', 'listen'] as const) assign(ex, j, -count(ex, j));
  for (const [j, n] of Object.entries(want)) assign(ex, j as never, Math.round(n ?? 0));
}

const smart = (food: 'plants' | 'meat' | 'both') => (ex: ExtinctionState, s: GameState) => {
  const n = ex.people.length;
  const order: string[] = food === 'plants' ? ['green', 'stick', 'warmth', 'fire', 'rootlore', 'deeproots'] : food === 'meat' ? ['watch', 'line', 'warmth', 'fire', 'smoke', 'racks'] : ['warmth', 'fire', 'watch', 'line', 'green', 'stick'];
  for (const id of order) if (!ex.ideas.includes(id) && ex.insight >= ideaCost(s, id)) learnIdea(s, id);
  const need = order.some((id) => !ex.ideas.includes(id));
  const listen = need ? Math.ceil(n * 0.15) : 0;
  const rest = n - listen;
  const sustain = (food !== 'meat' && ex.ideas.includes('stick') ? 1 : 0) + (food !== 'plants' && ex.ideas.includes('line') ? 1 : 0);
  const plantShare = food === 'plants' ? 1 : food === 'meat' ? 0 : 0.5;
  const w: Record<string, number> = { listen };
  if (sustain) {
    w.dig = food !== 'meat' && ex.ideas.includes('stick') ? rest * plantShare : 0;
    w.fish = food !== 'plants' && ex.ideas.includes('line') ? rest * (1 - plantShare) : 0;
    if (!w.dig) w.forage = rest * plantShare;
    if (!w.fish) w.scavenge = rest * (1 - plantShare);
  } else {
    w.forage = rest * plantShare;
    w.scavenge = rest * (1 - plantShare);
  }
  setJobs(ex, w);
  ex.ration = ex.people.length > 40 ? 0.5 : 1;
};

describe('the spear\'s web of ideas', () => {
  it('is all linked up, and learned outward from the middle', () => {
    for (const n of MIND_TREE) for (const l of n.links) expect(MIND_TREE.find((o) => o.id === l)?.links).toContain(n.id);
    expect(reachable([], 'warmth')).toBe(true);
    expect(reachable([], 'fire')).toBe(false);
    expect(reachable(['warmth'], 'fire')).toBe(true);
    const s = game('omnivore', 10);
    s.stages.tribal.tribe!.ex!.insight = 100;
    expect(learnIdea(s, 'fire')).toBe(false);
    expect(learnIdea(s, 'warmth')).toBe(true);
    expect(learnIdea(s, 'fire')).toBe(true);
  });
});

describe('the Extinction', () => {
  it('kills a tribe that does nothing within a few days', () => {
    const s = game('omnivore');
    const d = play(s, () => {});
    console.log('idle omnivore:', d, 'days');
    expect(d).toBeLessThan(5);
    expect(s.stages.tribal.tribe!.ex!.over).toBe(true);
  });

  it('balance report', () => {
    for (const [diet, food] of [['omnivore', 'both'], ['grazer', 'plants'], ['hunter', 'meat']] as const) {
      const s = game(diet);
      const naive = play(game(diet), (ex) => setJobs(ex, { forage: food === 'meat' ? 0 : ex.people.length * (food === 'both' ? 0.5 : 1), scavenge: food === 'plants' ? 0 : ex.people.length * (food === 'both' ? 0.5 : 1) }));
      const good = play(s, smart(food));
      const ex = s.stages.tribal.tribe!.ex!;
      console.log(`${diet}: naive ${naive}d · smart ${good}d alive ${ex.people.length} ideas ${ex.ideas.join(',')}`);
    }
  });

  it('starts with everyone resting and projects the end', () => {
    const s = game('omnivore');
    const ex = s.stages.tribal.tribe!.ex!;
    expect(count(ex, 'rest')).toBe(100);
    expect(daysLeft(ex)).toBeGreaterThan(0);
  });

  it('only lets a diet eat its own food', () => {
    const s = game('grazer', 10);
    const ex = s.stages.tribal.tribe!.ex!;
    ex.meat = 1000;
    extinctionTick(s, DAY_SEC);
    expect(ex.meat).toBeGreaterThan(500);
    expect(ex.people.every((p) => p.hunger >= 1.75)).toBe(true);
  });

  it('eating the dead makes them cannibals for good', () => {
    const s = game('grazer', 10);
    const ex = s.stages.tribal.tribe!.ex!;
    ex.people[0].hunger = 5;
    extinctionTick(s, DAY_SEC);
    expect(ex.corpses).toBe(1);
    decideFallen(s, true);
    expect(ex.diet).toBe('cannibal');
    expect(ex.meat).toBeGreaterThan(0);
  });

  it('tries again from just after the waking, and the spear remembers', () => {
    const s = game('omnivore', 10);
    const t = s.stages.tribal.tribe!;
    t.ex!.insight = 50;
    learnIdea(s, 'warmth');
    play(s, () => {});
    tryAgain(s);
    expect(t.ex!.day).toBe(0);
    expect(t.ex!.people.length).toBe(10);
    expect(t.attempts).toBe(1);
    expect(ideaCost(s, 'warmth')).toBe(Math.ceil(NODE_COST.minor / 2));
  });
});
