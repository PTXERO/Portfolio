import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { genOpen, upgradeOpen, allMult, buyWork, DAY_SEC, hearthMost, shoreOf, shoreTick, startShore, takeRaft, workOpen } from '../src/economy/shore';
import { ageName, greatWork, IDEAS, lanesDone, LANES, nextIdea, practiceRate, setFocus, TURN_AT, workReady } from '../src/economy/culture';
import type { TribeState } from '../src/economy/types';

function village(n: number) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet: 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 4242, year: 0,
    family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 777, day: 60 },
  } as unknown as TribeState;
  startShore(state);
  const s = shoreOf(state)!;
  takeRaft(state);
  s.gens = { forager: 20, camp: 10, hut: 40 };
  s.ups.push('council', 'scouts', 'lore');
  while (s.people.length < n) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
  return { state, s };
}

describe('Culture', () => {
  it('turns at a hundred, and not before', () => {
    const { state, s } = village(TURN_AT - 1);
    // (Every bed full: no child comes to tip it over.)
    s.gens.hut = 20;
    shoreTick(state, DAY_SEC);
    expect(s.culture).toBeUndefined();
    s.people.push({ id: s.nextId++, name: 'Last', born: -30, dies: 9999 });
    shoreTick(state, DAY_SEC);
    expect(s.culture).toBeDefined();
    expect(s.turned).toBe(true);
  });
  it('ideas come by themselves, and make everything bring in more; focus hurries a lane; a fork left alone the elders answer', () => {
    const { state, s } = village(TURN_AT);
    shoreTick(state, DAY_SEC);
    const before = practiceRate(s, 'stories');
    setFocus(s, 'stories');
    expect(practiceRate(s, 'stories')).toBeCloseTo(before * 2, 5);
    setFocus(s, undefined);
    const mult0 = allMult(s);
    let firstIdeaDay = 0;
    for (let d = 0; d < 4000 && !(s.culture!.forks.dead && lanesDone(s.culture!) >= 4); d++) {
      shoreTick(state, DAY_SEC);
      if (!firstIdeaDay && s.culture!.done.length) firstIdeaDay = d;
    }
    const c = s.culture!;
    console.log(`first idea after ${firstIdeaDay} days (${(firstIdeaDay / 30).toFixed(1)}h); 4 lanes done at ${s.day} days (${(s.day / 30).toFixed(1)}h)`);
    expect(c.done.length).toBeGreaterThan(4);
    expect(allMult(s)).toBeGreaterThan(mult0);
    expect(['bury', 'burn']).toContain(c.forks.dead);
  }, 60_000);
});

describe('The Ages', () => {
  function hearthAgeDone() {
    const { state, s } = village(120);
    s.culture = { since: 0, age: 1, practice: {}, done: IDEAS.filter((i) => i.age === 1).map((i) => i.id), forks: { dead: 'bury' } };
    return { state, s };
  }
  it('four lanes done, the Great Hearth is on offer; bought with food, it closes the Hearth Age and the hearth holds 300', () => {
    const { state, s } = hearthAgeDone();
    expect(workReady(s)).toBe(true);
    expect(workOpen(s)?.id).toBe('greathearth');
    s.food = 0;
    expect(buyWork(state)).toBe(false);
    s.food = workOpen(s)!.cost;
    expect(buyWork(state)).toBe(true);
    expect(s.culture!.age).toBe(2);
    expect(ageName(2)).toBe('The Village Age');
    expect(s.agesNew).toEqual([2]);
    expect(hearthMost(s)).toBe(300);
    expect(LANES.every((l) => nextIdea(s.culture!, l.id)?.age === 2)).toBe(true);
    expect(workReady(s)).toBe(false);
  });
  it('the Village Age\'s four lanes done: the Town Square closes it, and the hearth holds 600', () => {
    const { state, s } = hearthAgeDone();
    s.food = 1e12;
    buyWork(state);
    s.culture!.done.push(...IDEAS.filter((i) => i.age === 2 && ['food', 'crafts', 'war', 'rule'].includes(i.lane)).map((i) => i.id));
    expect(greatWork(s)).toBe('square');
    expect(buyWork(state)).toBe(true);
    expect(s.culture!.age).toBe(3);
    expect(hearthMost(s)).toBe(600);
  });
  it('the Bronze Age: its own things to buy, its ideas, and the Chief\'s Hall closes it (the hearth holds 1200)', () => {
    const { state, s } = hearthAgeDone();
    s.food = 1e15;
    buyWork(state);
    s.culture!.done.push(...IDEAS.filter((i) => i.age === 2 && ['food', 'crafts', 'war', 'rule'].includes(i.lane)).map((i) => i.id));
    while (s.people.length < 560) s.people.push({ id: s.nextId++, name: 'X', born: -30, dies: 9999 });
    expect(genOpen(s, 'foundry')).toBe(false);
    buyWork(state);
    expect(ageName(3)).toBe('The Bronze Age');
    expect(genOpen(s, 'foundry')).toBe(true);
    expect(genOpen(s, 'harbour')).toBe(true);
    expect(upgradeOpen(s, 'bronzetools')).toBe(true);
    expect(greatWork(s)).toBe('hall');
    expect(workReady(s)).toBe(false);
    s.culture!.done.push(...IDEAS.filter((i) => i.age === 3 && ['food', 'crafts', 'war', 'kin'].includes(i.lane)).map((i) => i.id));
    expect(workReady(s)).toBe(true);
    s.food = 1e18;
    expect(buyWork(state)).toBe(true);
    expect(s.culture!.age).toBe(4);
    expect(ageName(4)).toBe('The Iron Age');
    expect(hearthMost(s)).toBe(1200);
  });
  it('a new Age\'s choices are asked, and the elders answer if left', () => {
    const { state, s } = hearthAgeDone();
    s.food = 1e12;
    buyWork(state);
    s.culture!.practice.rule = 1e6;
    s.culture!.done.push('oaths');
    shoreTick(state, DAY_SEC * 1.01);
    expect(s.culture!.done).toContain('law');
    expect(s.culture!.asking?.fork).toBe('law');
    shoreTick(state, DAY_SEC * 10);
    expect(['council', 'chief']).toContain(s.culture!.forks.law);
  });
});
