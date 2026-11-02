import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { build, DAY_SEC, relation, room, shoreOf, shoreTick, startShore, takeRaft } from '../src/economy/shore';
import { hunts, villageRaid, wild } from '../src/economy/world';
import { standingOf } from '../src/economy/diplomacy';
import { sendBand } from '../src/economy/war';
import type { TribeState } from '../src/economy/types';

function fresh(diet = 'omnivore') {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet }, stats: { strength: 1, speed: 1, senses: 1, toughness: 1, charm: 1 },
    generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 777, day: 60 },
  } as TribeState;
  startShore(state);
  takeRaft(state);
  const s = shoreOf(state)!;
  s.wood = 1e6;
  for (const id of ['hearth', 'hut', 'hut', 'hut', 'hut'] as const) {
    build(state, id);
    if (s.building) s.building.left = 0;
    shoreTick(state, 0.01);
  }
  s.food = 500;
  return { state, s };
}

describe('The living island', () => {
  it('a village not yours grows back toward what its land holds, and no further', () => {
    const { state, s } = fresh();
    const v = s.villages.find((x) => wild(x))!;
    v.home = 20;
    v.pop = 5;
    shoreTick(state, DAY_SEC * 10);
    expect(v.pop).toBeGreaterThan(8);
    shoreTick(state, DAY_SEC * 200);
    expect(v.pop).toBeLessThanOrEqual(20.001);
  });
  it('a hunting village falls on one it preys on: beaten hard, the prey pays it tribute, and some flee to the hearth', () => {
    const { state, s } = fresh('grazer');
    const a = s.villages.find((x) => x.diet === 'hunter')!;
    const b = s.villages.find((x) => x.diet === 'grazer' && x !== a)!;
    expect(hunts(a, b)).toBe(true);
    expect(hunts(b, a)).toBe(false);
    a.pop = 60;
    b.pop = 20;
    b.found = true;
    const n = s.people.length;
    expect(room(s)).toBeGreaterThan(n + 4);
    villageRaid(state, s, a, b, () => 0.5);
    expect(b.pop).toBeLessThan(20);
    expect(b.overlord).toBe(a.id);
    expect(s.people.length).toBeGreaterThan(n);
    expect(s.people.filter((p) => p.kind === b.id).length).toBe(s.people.length - n);
    expect(s.news.some((x) => x.includes('Smoke over'))).toBe(true);
  });
  it('a beaten raider loses some of its own', () => {
    const { state, s } = fresh('grazer');
    const a = s.villages.find((x) => x.diet === 'hunter')!;
    const b = s.villages.find((x) => x.diet === 'grazer' && x !== a)!;
    a.pop = 10;
    b.pop = 60;
    villageRaid(state, s, a, b, () => 0.5);
    expect(a.pop).toBe(8);
    expect(b.overlord).toBeUndefined();
  });
  it('their master taken by you, a tribute-paying village is free, and glad of you', () => {
    const { state, s } = fresh('grazer');
    const a = s.villages.find((x) => x.diet === 'hunter')!;
    const b = s.villages.find((x) => x.diet !== 'grazer' && x !== a && relation(s, x) !== 'kin') ?? s.villages.find((x) => x !== a)!;
    b.found = true;
    b.overlord = a.id;
    const before = standingOf(s, b);
    a.vassal = { tax: 0.2, loyalty: 50 };
    shoreTick(state, DAY_SEC * 1.01);
    expect(b.overlord).toBeUndefined();
    expect(standingOf(s, b)).toBeGreaterThan(before);
  });
  it('a war band against one village sours its own kind across the island', () => {
    const { state, s } = fresh('hunter');
    const prey = s.villages.filter((x) => x.diet === 'grazer');
    expect(prey.length).toBeGreaterThanOrEqual(2);
    const [target, kin] = prey;
    target.found = true;
    kin.found = true;
    const before = standingOf(s, kin);
    while (s.people.length < 30) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    expect(sendBand(state, s, target.id, 6)).toBe(true);
    expect(standingOf(s, kin)).toBe(before - 10);
  });
  it('a crowded village sends some off to make a camp of their own, out in the fog', () => {
    const { state, s } = fresh();
    const v = s.villages.find((x) => wild(x))!;
    v.home = 40;
    v.pop = 40;
    const before = s.villages.length;
    for (let d = 0; d < 300 && s.villages.length === before; d++) {
      v.pop = 40;
      shoreTick(state, DAY_SEC);
    }
    expect(s.villages.length).toBe(before + 1);
    const camp = s.villages[s.villages.length - 1];
    expect(camp.found).toBe(false);
    expect(camp.pop).toBeGreaterThan(5);
    expect(Math.hypot(camp.x - s.hearth.x, camp.y - s.hearth.y)).toBeGreaterThan(60);
  });
});
