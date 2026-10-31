import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { build, DAY_SEC, relation, shoreOf, shoreTick, startShore, takeRaft } from '../src/economy/shore';
import { ALLY, canDemand, demandSubmit, giftForeign, PEACE, stanceOf, standingOf } from '../src/economy/diplomacy';
import { hostile, sendBand } from '../src/economy/war';
import type { TribeState } from '../src/economy/types';

function fresh(diet = 'grazer', cannibal = false) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet }, stats: { strength: 1, speed: 1, senses: 1, toughness: 1, charm: 1 },
    generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }],
    cannibal, landed: { seed: 777, day: 60 },
  } as TribeState;
  startShore(state);
  takeRaft(state);
  const s = shoreOf(state)!;
  s.wood = 1e6;
  build(state, 'hearth');
  if (s.building) s.building.left = 0;
  shoreTick(state, 0.01);
  return { state, s };
}

/** A village of a kind, found, with the chief standing at it. */
function visit(s: ReturnType<typeof fresh>['s'], rel: 'prey' | 'predator' | 'enemy') {
  const v = s.villages.find((x) => relation(s, x) === rel)!;
  v.found = true;
  s.chiefAt = { x: v.x + 2, y: v.y + 2 };
  s.chiefTo = null;
  return v;
}

describe('Diplomacy', () => {
  it('gifts win a predator village round to peace (they stop raiding) and on to allies', () => {
    const { state, s } = fresh();
    const v = visit(s, 'predator');
    expect(standingOf(s, v)).toBe(-40);
    expect(hostile(s, v)).toBe(true);
    s.food = 1e5;
    for (let i = 0; i < 40 && standingOf(s, v) < PEACE; i++) giftForeign(state, v.id);
    expect(stanceOf(s, v)).toBe('peace');
    expect(hostile(s, v)).toBe(false);
    for (let i = 0; i < 80 && standingOf(s, v) < ALLY; i++) giftForeign(state, v.id);
    expect(stanceOf(s, v)).toBe('ally');
  });
  it('left alone, a standing drifts back to what they were', () => {
    const { state, s } = fresh();
    const v = visit(s, 'predator');
    v.standing = 30;
    shoreTick(state, DAY_SEC * 5.05);
    expect(standingOf(s, v)).toBeLessThan(30);
    expect(standingOf(s, v)).toBeGreaterThan(-40);
    void state;
  });
  it('enemies never come to peace', () => {
    const { state, s } = fresh('grazer', true);
    const v = visit(s, 'enemy');
    s.food = 1e5;
    for (let i = 0; i < 60; i++) giftForeign(state, v.id);
    expect(standingOf(s, v)).toBeLessThan(PEACE);
  });
  it('a war band against a village at peace is a betrayal every village hears of', () => {
    const { state, s } = fresh('omnivore');
    const v = visit(s, 'prey');
    const other = s.villages.find((x) => x !== v && relation(s, x) === 'predator')!;
    other.found = true;
    v.standing = 40;
    other.standing = 10;
    while (s.people.length < 20) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    expect(sendBand(state, s, v.id, 6)).toBe(true);
    expect(standingOf(s, v)).toBeLessThanOrEqual(-60);
    expect(standingOf(s, other)).toBe(-5);
  });
  it('strong enough, the chief there in person can make a village submit without a fight; weak, they refuse', () => {
    const { state, s } = fresh('omnivore');
    const v = visit(s, 'prey');
    v.pop = 6;
    while (s.people.length < 80) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    expect(canDemand(s, v)).toBe(true);
    expect(demandSubmit(state, v.id)).toBe('yes');
    expect(v.vassal).toBeDefined();
    expect(v.vassal!.conquered).toBeUndefined();
    // Weak, against a big one: refused, and once a season.
    const w = visit(s, 'predator');
    w.pop = 60;
    s.people.length = 6;
    const before = standingOf(s, w);
    expect(demandSubmit(state, w.id)).toBe('no');
    expect(standingOf(s, w)).toBe(before - 20);
    expect(canDemand(s, w)).toBe(false);
  });
  it('allies near enough come to help when you are raided', async () => {
    const war = await import('../src/economy/war');
    const { state, s } = fresh('omnivore');
    while (s.people.length < 30) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    const foe = s.villages.find((x) => relation(s, x) === 'predator')!;
    const friend = s.villages.filter((x) => relation(s, x) === 'prey').sort((a, b) => Math.hypot(a.x - s.hearth.x, a.y - s.hearth.y) - Math.hypot(b.x - s.hearth.x, b.y - s.hearth.y))[0];
    friend.found = true;
    friend.standing = 80;
    friend.pop = 20;
    // (Near enough to get there in time.)
    friend.x = s.hearth.x + 15;
    friend.y = s.hearth.y;
    s.day = 40;
    s.raid = { from: foe.id, watched: 39, fighters: 8, arrives: 60 };
    s.raid.seen = undefined;
    s.raid.watched = 38;
    shoreTick(state, DAY_SEC * 1.01);
    expect(s.raid?.allies?.some((a) => a.from === friend.id)).toBe(true);
    void war;
  });
});
