import { answerWhisper } from '../src/economy/whispers';
import { describe, expect, it } from 'vitest';
import { assign, count, jobFood, launch, raftDone, daysLeft, decideFallen, DAY_SEC, extinctionTick, ideaCost, learnIdea, startExtinction, tryAgain, type ExtinctionState } from '../src/economy/extinction';
import { MIND_TREE, NODE_COST, reachable } from '../src/economy/mindTree';
import { createState as newGame } from '../src/economy/state';
import type { GameState } from '../src/economy/types';

function game(diet: string, survivors = 100): GameState {
  const s = newGame();
  s.unlocked.push('tribal');
  s.current = 'tribal';
  s.stages.tribal.tribe = { awake: true, pop: survivors, survivors, look: { parts: {}, diet }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
  startExtinction(s);
  // Managed by hand unless a test says otherwise.
  const ex = s.stages.tribal.tribe!.ex!;
  ex.auto = false;
  for (const p of ex.people) p.job = 'rest';
  return s;
}

/** Plays days with a plan run each dawn; returns days survived (capped). */
function play(s: GameState, plan: (ex: ExtinctionState, s: GameState) => void, cap = 80): number {
  const ex = () => s.stages.tribal.tribe!.ex!;
  while (!ex().over && !ex().escaped && ex().day < cap) {
    plan(ex(), s);
    if (process.env.TRACE) { const e = ex(); console.log(`d${e.day} n${e.people.length} jobs ${['forage','scavenge','dig','fish','wood','build','listen','rest'].map((j) => j[0] + count(e, j as never)).join(' ')} meat ${e.meat.toFixed(0)} plants ${e.plants.toFixed(0)} wood ${(e.wood ?? 0).toFixed(0)} ideas ${e.ideas.length} r${e.ration}`); }
    if (ex().fallen === 'undecided' && ex().corpses > 0) decideFallen(s, !!process.env.EAT);
    if (ex().whisper) answerWhisper(ex(), 0);
    extinctionTick(s, DAY_SEC);
  }
  return ex().day;
}

function setJobs(ex: ExtinctionState, want: Partial<Record<string, number>>): void {
  for (const j of ['forage', 'scavenge', 'dig', 'fish', 'wood', 'build', 'listen'] as const) assign(ex, j, -count(ex, j));
  for (const [j, n] of Object.entries(want)) assign(ex, j as never, Math.round(n ?? 0));
}

const PATHS: Record<string, string[]> = {
  plants: ['green', 'stick', 'rootlore', 'tubers', 'warmth', 'fire', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
  meat: ['watch', 'line', 'bait', 'deeper', 'warmth', 'fire', 'nets', 'green', 'stick', 'rootlore', 'tubers', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
  both: ['watch', 'line', 'green', 'stick', 'bait', 'rootlore', 'warmth', 'fire', 'deeper', 'tubers', 'deeproots', 'mulch', 'rope', 'smoke', 'embers', 'racks', 'charcoal', 'hollow'],
};

/** A decent player: rushes a lasting food source and the ideas that stretch it, keeps the fire
 * fed, then builds the raft and picks a family once the food holds. */
const smart = (food: 'plants' | 'meat' | 'both') => (ex: ExtinctionState, s: GameState) => {
  const n = ex.people.length;
  const order = PATHS[food];
  // Strictly in order: save up for the next one rather than buying cheap ones off the path.
  for (const id of order) {
    if (ex.ideas.includes(id)) continue;
    if (!learnIdea(s, id)) break;
  }
  const need = order.some((id) => !ex.ideas.includes(id));
  const listen = need ? Math.min(6, Math.ceil(n * 0.12)) : 0;
  const woodNeed = (ex.ideas.includes('fire') ? 2 : 0) + (ex.ideas.includes('rope') || (ex.raft?.frame ?? 0) < 40 ? 2 : 0);
  const wood = (ex.wood ?? 0) > 40 && !ex.ideas.includes('rope') ? 1 : Math.min(n - listen, Math.ceil(woodNeed / 1.4));
  const stable = ex.day > 14 && (ex.last?.starved.length ?? 1) === 0;
  const build = stable && (ex.wood ?? 0) > 5 ? Math.min(3, n - listen - wood) : 0;
  const rest = Math.max(0, n - listen - wood - build);
  const w: Record<string, number> = { listen, wood, build };
  const dig = ex.ideas.includes('stick') && food !== 'meat';
  const fish = ex.ideas.includes('line') && food !== 'plants';
  if (dig && fish) { w.dig = rest * 0.4; w.fish = rest * 0.4; w.forage = rest * 0.1; w.scavenge = rest * 0.1; }
  else if (dig) { w.dig = rest * 0.7; w.forage = rest * 0.15; w.scavenge = rest * 0.15; }
  else if (fish) { w.fish = rest * 0.7; w.forage = rest * 0.15; w.scavenge = rest * 0.15; }
  else { w.forage = rest * 0.5; w.scavenge = rest * 0.5; }
  // Nobody sent to ground that's picked clean.
  if (ex.carrion < 5) { w.fish = (w.fish ?? 0) + (w.scavenge ?? 0) * (fish ? 1 : 0); w.dig = (w.dig ?? 0) + (w.scavenge ?? 0) * (!fish && dig ? 1 : 0); if (fish || dig) w.scavenge = 0; }
  setJobs(ex, w);
  ex.ration = n > 30 ? 0.5 : 1;
  if (raftDone(ex) && n >= 4) { ex.family = ex.people.slice(0, 4).map((p) => p.id); launch(s); }
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
  it('kills a tribe left to itself within a few weeks', () => {
    const s = game('omnivore');
    const d = play(s, () => {});
    console.log('idle omnivore:', d, 'days');
    expect(d).toBeLessThan(20);
    expect(s.stages.tribal.tribe!.ex!.over).toBe(true);
  });

  it('balance report', () => {
    for (const [diet, food] of [['omnivore', 'both'], ['grazer', 'plants'], ['hunter', 'meat']] as const) {
      const s = game(diet);
      const naive = play(game(diet), (ex) => setJobs(ex, { forage: food === 'meat' ? 0 : ex.people.length * (food === 'both' ? 0.5 : 1), scavenge: food === 'plants' ? 0 : ex.people.length * (food === 'both' ? 0.5 : 1) }));
      const good = play(s, smart(food));
      const ex = s.stages.tribal.tribe!.ex!;
      console.log(`${diet}: naive ${naive}d · smart ${good}d ${ex.escaped ? 'ESCAPED' : ex.over ? 'extinct' : 'holding'} alive ${ex.people.length} raft ${JSON.stringify(ex.raft)} ideas ${ex.ideas.join(',')}`);
    }
  }, 60_000);

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
    const before = ex.people.map((p) => p.hunger);
    extinctionTick(s, DAY_SEC);
    expect(ex.meat).toBeGreaterThan(500);
    expect(ex.people.every((p) => p.hunger > before[ex.people.indexOf(p)])).toBe(true);
  });

  it('left to itself (only a focus and ideas picked), the tribe gets by', () => {
    for (const [diet, food] of [['omnivore', 'both'], ['grazer', 'plants'], ['hunter', 'meat']] as const) {
      const s = game(diet);
      const ex = s.stages.tribal.tribe!.ex!;
      ex.auto = true;
      const d = play(s, (e) => {
        for (const id of PATHS[food]) {
          if (e.ideas.includes(id)) continue;
          if (!learnIdea(s, id)) break;
        }
        e.focus = e.ideas.includes('rope') || PATHS[food].every((id) => e.ideas.includes(id)) ? 'raft' : 'ideas';
        e.ration = e.people.length > 30 ? 0.5 : 1;
        if (raftDone(e) && e.people.length >= 4) { e.family = e.people.slice(0, 4).map((p) => p.id); launch(s); }
      });
      console.log(`auto ${diet}: ${d}d ${ex.escaped ? 'ESCAPED' : ex.over ? 'extinct' : 'holding'} alive ${ex.people.length} raft ${JSON.stringify(ex.raft)}`);
      expect(ex.over).toBe(false);
    }
  }, 60_000);

  it('sets every diet to work for food it can eat', () => {
    for (const job of ['forage', 'scavenge', 'dig', 'fish'] as const) {
      expect(jobFood('herbivore', job)).toBe('plants');
      expect(jobFood('carnivore', job)).toBe('meat');
      expect(jobFood('cannibal', job)).toBe('meat');
    }
    const s = game('grazer', 20);
    const ex = s.stages.tribal.tribe!.ex!;
    assign(ex, 'scavenge', 10);
    extinctionTick(s, DAY_SEC / 2);
    expect(ex.plants).toBeGreaterThan(0);
    expect(ex.meat).toBe(0);
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

describe('a great herd', () => {
  it('is cut down to the hundred the Extinction is made for, and an old save with more is too', async () => {
    const { startTribe, MAX_SURVIVORS } = await import('../src/economy/tribal');
    const { exportSave, importSave } = await import('../src/economy/save');
    const s = game('omnivore');
    s.stages.creature.pop = 2400;
    expect(startTribe(s).survivors).toBe(MAX_SURVIVORS);
    const big = game('omnivore', 593);
    expect(big.stages.tribal.tribe!.ex!.people.length).toBe(593);
    const back = importSave(exportSave(big));
    const ex = back.stages.tribal.tribe!.ex!;
    expect(ex.people.length).toBe(MAX_SURVIVORS);
    const ids = new Set(ex.people.map((p) => p.id));
    expect(ex.people.every((p) => (p.bonds ?? []).every((b) => ids.has(b.id)))).toBe(true);
  });
});
