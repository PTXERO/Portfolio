import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { boosts, build, buildsOpen, DAY_SEC, hearthMost, resCap, roadCost, roadUpgrade, shoreOf, shoreTick, startShore, vassalDay } from '../src/economy/shore';
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
  s.raftTaken = true;
  s.wood = 1e4;
  for (const id of ['hearth', 'hut', 'hut', 'hut', 'council', 'camp', 'woodpile', 'woodpile']) {
    s.wood = 1e4;
    build(state, id as never);
    if (s.building) s.building.left = 0;
    shoreTick(state, 0.01);
  }
  while (s.people.length < n) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
  s.food = 500;
  s.steward = { on: false, plan: 'balanced' };
  return { state, s };
}

describe('Culture', () => {
  it('turns at a hundred, and not before', () => {
    const { state, s } = village(TURN_AT - 1);
    shoreTick(state, DAY_SEC);
    expect(s.culture).toBeUndefined();
    s.people.push({ id: s.nextId++, name: 'Last', born: -30, dies: 9999 });
    shoreTick(state, DAY_SEC);
    expect(s.culture).toBeDefined();
    expect(s.turned).toBe(true);
  });
  it('ideas come by themselves; focus hurries a lane; a fork left alone the elders answer', () => {
    const { state, s } = village(TURN_AT);
    shoreTick(state, DAY_SEC);
    const plan = { food: 40, wood: 20 };
    const before = practiceRate(s, 'stories', plan);
    setFocus(s, 'stories');
    expect(practiceRate(s, 'stories', plan)).toBeCloseTo(before * 2, 5);
    setFocus(s, undefined);
    let firstIdeaDay = 0;
    for (let d = 0; d < 4000 && !(s.culture!.forks.dead && lanesDone(s.culture!) >= 4); d++) {
      shoreTick(state, DAY_SEC);
      s.food = 500;
      s.wood = 1e4;
      if (!firstIdeaDay && s.culture!.done.length) firstIdeaDay = d;
    }
    const c = s.culture!;
    console.log(`first idea after ${firstIdeaDay} days (${(firstIdeaDay / 30).toFixed(1)}h); 4 lanes done at ${s.day} days (${(s.day / 30).toFixed(1)}h); ${c.done.length} ideas; ${lanesDone(c)} lanes done; rates ${LANES.map((l) => `${l.id} ${practiceRate(s, l.id, plan).toFixed(2)}`).join(', ')}`);
    expect(c.done.length).toBeGreaterThan(0);
    // (Left to the elders, they follow the culture's leaning: the lane it's taken further.)
    const ahead = (lane: string) => c.done.filter((id) => ['dried', 'grounds', 'blades', 'baskets', 'watchers', 'clubs', 'fourword', 'circle', 'hearths', 'songs', 'dead', 'feast', 'crossing', 'farspear', 'names', 'fingers'].indexOf(id) >= 0 && (lane === 'stories' ? ['crossing', 'farspear'] : ['dead', 'feast']).includes(id)).length;
    expect(c.forks.dead).toBe(ahead('stories') > ahead('rites') ? 'bury' : 'burn');
  }, 60_000);
  it('the Great Hearth, once four lanes are done, closes the Hearth Age', () => {
    const { state, s } = village(TURN_AT);
    shoreTick(state, DAY_SEC);
    const c = s.culture!;
    expect(buildsOpen(s).some((b) => b.id === 'greathearth')).toBe(false);
    c.done.push('dried', 'grounds', 'blades', 'baskets', 'watchers', 'clubs', 'fourword', 'circle');
    expect(workReady(s)).toBe(true);
    s.res = { stone: 30 };
    s.building = undefined;
    s.wood = 1e4;
    expect(build(state, 'greathearth')).toBe(true);
    s.building!.left = 0;
    shoreTick(state, 0.01);
    expect(c.age).toBe(2);
  });
});

describe('The Village Age', () => {
  /** A village with the Great Hearth just lit: the Village Age begun. */
  function villageAge() {
    const { state, s } = village(120);
    s.culture = { since: 0, age: 1, practice: {}, done: IDEAS.filter((i) => i.age === 1).map((i) => i.id), forks: { dead: 'bury' } };
    s.res = { stone: 60, timber: 60, salt: 60, clay: 60, herbs: 60, flint: 60 };
    expect(workReady(s)).toBe(true);
    s.wood = 1e4;
    s.building = undefined;
    expect(build(state, 'greathearth')).toBe(true);
    s.building!.left = 0;
    shoreTick(state, 0.01);
    return { state, s };
  }
  it('the Great Hearth closes the Hearth Age: the Village Age begins, with ideas of its own, and the hearth holds 300', () => {
    const { s } = villageAge();
    expect(s.culture!.age).toBe(2);
    expect(ageName(2)).toBe('The Village Age');
    expect(s.agesNew).toEqual([2]);
    expect(LANES.every((l) => nextIdea(s.culture!, l.id)?.age === 2)).toBe(true);
    expect(hearthMost(s)).toBe(300);
    expect(workReady(s)).toBe(false);
  });
  it('its buildings come with its ideas, and spend the land\'s goods', () => {
    const { state, s } = villageAge();
    const open = () => buildsOpen(s).map((b) => b.id);
    expect(open()).not.toContain('kiln');
    s.culture!.done.push('kilns', 'roadcraft');
    expect(open()).toContain('kiln');
    expect(open()).toContain('workshop');
    s.wood = 1e4;
    s.building = undefined;
    const before = s.res!.timber!;
    expect(build(state, 'workshop')).toBe(true);
    expect(s.res!.timber).toBe(before - 20);
    s.building!.left = 0;
    shoreTick(state, 0.01);
    expect(boosts(s).build).toBeCloseTo(0.15);
  });
  it('its ideas do what they say: a tithe, oaths, roadcraft, room for goods', () => {
    const { s } = villageAge();
    const v = s.villages[0];
    v.vassal = { tax: 0.25, loyalty: 50 };
    v.pop = 20;
    const before = vassalDay(v, s);
    const cap0 = resCap(s);
    const road0 = roadCost(s, v).wood;
    s.culture!.done.push('tithe', 'oaths', 'roadcraft', 'kilns');
    expect(vassalDay(v, s).food).toBeCloseTo(before.food * 1.1);
    expect(vassalDay(v, s).loyalty).toBe(before.loyalty + 10);
    expect(resCap(s)).toBe(cap0 + 20);
    expect(roadCost(s, v).wood).toBeLessThan(road0);
  });
  it('four lanes done, the Town Square: it closes the Village Age, holds 600, and paved roads are known', () => {
    const { state, s } = villageAge();
    s.culture!.done.push(...IDEAS.filter((i) => i.age === 2 && ['food', 'crafts', 'war', 'rule'].includes(i.lane)).map((i) => i.id));
    expect(workReady(s)).toBe(true);
    expect(greatWork(s)).toBe('square');
    s.wood = 1e4;
    s.building = undefined;
    expect(build(state, 'square')).toBe(true);
    s.building!.left = 0;
    shoreTick(state, 0.01);
    expect(s.culture!.age).toBe(3);
    expect(hearthMost(s)).toBe(600);
    const v = s.villages[0];
    v.vassal = { tax: 0.1, loyalty: 80 };
    v.road = { done: 1, need: 1, tier: 1 };
    expect(roadUpgrade(s, v)?.missing ?? '').not.toMatch(/Age/);
  });
  it('the new choices offer their roads, and the elders answer if left', () => {
    const { state, s } = villageAge();
    s.culture!.practice.words = 1e6;
    s.culture!.done.push('tallies');
    s.culture!.done.push('tithe');
    // (Law: in the rule lane.)
    s.culture!.practice.rule = 1e6;
    s.culture!.done.push('oaths');
    shoreTick(state, DAY_SEC * 1.01);
    expect(s.culture!.done).toContain('law');
    expect(s.culture!.asking?.fork).toBe('law');
    shoreTick(state, DAY_SEC * 10);
    expect(['council', 'chief']).toContain(s.culture!.forks.law);
  });
});
