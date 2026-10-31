import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { annex, annexWhy, answerAsk, build, DAY_SEC, relation, shoreOf, shoreTick, startShore, takeRaft } from '../src/economy/shore';
import { ALLY, canDemand, demandSubmit, giftForeign, PEACE, stanceOf, standingOf } from '../src/economy/diplomacy';
import { decideConquest, hostile, levyFor, sendBand } from '../src/economy/war';
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

describe('Conquest', () => {
  const beaten = (pop = 20) => {
    const { state, s } = fresh('omnivore');
    const v = s.villages.find((x) => relation(s, x) === 'prey')!;
    v.found = true;
    v.pop = pop;
    v.habitat = 'mountain';
    s.conquest = { id: v.id, since: s.day };
    return { state, s, v };
  };
  it('left waiting, a beaten village is made vassals', () => {
    const { state, s, v } = beaten();
    shoreTick(state, DAY_SEC * 3);
    expect(s.conquest).toBeUndefined();
    expect(v.vassal?.conquered).toBeDefined();
  });
  it('plundered: a haul, and they stay free and hate you', () => {
    const { state, s, v } = beaten();
    s.food = 0;
    s.wood = 0;
    s.res = {};
    expect(decideConquest(state, s, 'plunder')).toBe(true);
    expect(s.food).toBeGreaterThan(0);
    expect(s.res.stone).toBe(6);
    expect(v.vassal).toBeUndefined();
    expect(standingOf(s, v)).toBeLessThan(-20);
  });
  it('driven out: their land an outpost of yours, giving its goods', () => {
    const { state, s, v } = beaten();
    expect(decideConquest(state, s, 'drive')).toBe(true);
    expect(v.gone).toBeDefined();
    expect(v.outpost).toBeDefined();
    s.res = {};
    shoreTick(state, DAY_SEC);
    expect(s.res.stone ?? 0).toBeGreaterThan(0);
  });
  it('captives: half of them come to live by the hearth', () => {
    const { state, s, v } = beaten(20);
    const n = s.people.length;
    expect(decideConquest(state, s, 'captives')).toBe(true);
    expect(s.people.length).toBe(n + 10);
    expect(s.people.filter((p) => p.kind === v.id)).toHaveLength(10);
    expect(v.pop).toBe(10);
  });
  it('loyal vassals near enough are called up to march with the war band', () => {
    const { state, s } = fresh('omnivore');
    while (s.people.length < 30) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    const prey = s.villages.filter((x) => relation(s, x) === 'prey');
    const [target, ours] = prey;
    target.found = true;
    ours.vassal = { tax: 0.1, loyalty: 80 };
    ours.pop = 20;
    ours.x = target.x + 5;
    ours.y = target.y;
    expect(levyFor(s, target)).toEqual([{ from: ours.id, n: 5 }]);
    expect(sendBand(state, s, target.id, 10, false, true)).toBe(true);
    expect(s.warband?.levy).toEqual([{ from: ours.id, n: 5 }]);
    expect(ours.vassal.loyalty).toBe(76);
    for (let i = 0; i < 20000 && !s.fight; i++) shoreTick(state, 2);
    expect(s.fight?.ours).toBe(15);
  });
});

describe('Vassals', () => {
  const vassal = (loyalty = 60, conquered?: number) => {
    const { state, s } = fresh('omnivore');
    const v = s.villages.find((x) => relation(s, x) === 'prey')!;
    v.found = true;
    v.pop = 20;
    v.vassal = { tax: 0.1, loyalty, conquered };
    return { state, s, v };
  };
  it('a vassal asks things of the hearth: answered, more loyal; ignored, less', () => {
    const { state, s, v } = vassal(60);
    s.food = 1000;
    s.wood = 1000;
    for (let i = 0; i < 12 && !v.ask; i++) shoreTick(state, DAY_SEC);
    expect(v.ask).toBeDefined();
    if (v.ask!.kind === 'visit') v.ask!.kind = 'wood';
    const before = v.vassal!.loyalty;
    expect(answerAsk(state, v.id)).toBe(true);
    expect(v.vassal!.loyalty).toBeGreaterThan(before);
    expect(v.thrive).toBeUndefined();
  });
  it('a loyal vassal, past its grudge, can be brought into the fold with a feast: a settlement', () => {
    const { state, s, v } = vassal(90, 0);
    s.food = 1000;
    expect(annexWhy(s, v)).toMatch(/remember/);
    s.day = 40;
    expect(annexWhy(s, v)).toBeNull();
    expect(annex(state, v.id)).toBe(true);
    expect(v.vassal).toBeUndefined();
    expect(v.settled).toBeDefined();
    expect(s.food).toBe(1000 - 40);
  });
  it('a conquered vassal pushed too far rises against you, an enemy; warned first', () => {
    const { state, s, v } = vassal(22, 0);
    v.vassal!.tax = 0.6;
    shoreTick(state, DAY_SEC * 0.3);
    shoreTick(state, DAY_SEC * 0.3);
    expect(v.vassal?.warned).toBe(true);
    expect(s.news.some((n) => /restless/.test(n))).toBe(true);
    for (let i = 0; i < 20 && v.vassal; i++) shoreTick(state, DAY_SEC);
    expect(v.vassal).toBeUndefined();
    expect(standingOf(s, v)).toBe(-70);
  });
});

