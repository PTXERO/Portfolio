import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { build, buildsOpen, DAY_SEC, shoreOf, shoreTick, startShore } from '../src/economy/shore';
import { lanesDone, LANES, practiceRate, setFocus, TURN_AT, workReady } from '../src/economy/culture';
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
    expect(c.forks.dead).toBe('bury');
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
