import { describe, expect, it } from 'vitest';
import { Biome, isLand } from '../src/economy/island';
import { createState } from '../src/economy/state';
import { answerJoin, boosts, build, foodCap, setTax, shoreIsland, takeRaft, walkChief, workPlan, buildCost, buildsOpen, DAY_SEC, gift, poisOf, relation, shoreOf, shoreTick, startShore } from '../src/economy/shore';
import { deserialize, serialize } from '../src/economy/save';
import type { TribeState } from '../src/economy/types';

function fresh(diet = 'grazer', cannibal = false) {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves', mouth: 'grinders' }, diet }, stats: { strength: 1, speed: 1, senses: 1, toughness: 1, charm: 1 },
    generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }],
    cannibal, landed: { seed: 777, day: 60 },
  } as TribeState;
  startShore(state);
  return state;
}

/** Builds it and lets it go up at once (for tests that need things standing). */
function now(state: ReturnType<typeof fresh>, id: Parameters<typeof build>[1]): boolean {
  const s = shoreOf(state)!;
  // (The wood for it, whatever the stores hold.)
  const keep = s.wood;
  s.wood = 1e6;
  const ok = build(state, id);
  s.wood = keep;
  if (s.building) {
    s.building.left = 0;
    shoreTick(state, 0.01);
  }
  return ok;
}

/** Builds what it can, cheapest first (the most an idle player would do with an auto-builder). */
function autobuild(state: ReturnType<typeof fresh>) {
  const s = shoreOf(state)!;
  for (;;) {
    const open = buildsOpen(s).sort((a, b) => buildCost(s, a.id) - buildCost(s, b.id));
    const pick = open.find((b) => buildCost(s, b.id) <= s.wood);
    if (!pick || !build(state, pick.id)) break;
  }
}

describe('New Shore', () => {
  it('lays out a world with villages for every diet', () => {
    for (const diet of ['grazer', 'hunter', 'omnivore']) {
      const s = shoreOf(fresh(diet))!;
      expect(s.villages.length).toBeGreaterThanOrEqual(5);
      const rel = s.villages.map((v) => relation(s, v));
      expect(rel).toContain('kin');
      expect(rel.some((r) => r === 'predator' || r === 'enemy')).toBe(true);
      expect(rel[0]).toBe('kin');
      const d0 = Math.hypot(s.villages[0].x - s.hearth.x, s.villages[0].y - s.hearth.y);
      expect(d0).toBeLessThan(90);
    }
    const c = shoreOf(fresh('hunter', true))!;
    expect(c.villages.every((v) => relation(c, v) === 'enemy')).toBe(true);
  });

  it('grows toward a hundred, and the four die of old age once children come', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const marks: string[] = [];
    let hundred = -1;
    takeRaft(state);
    for (let sec = 0; sec < 6 * 3600; sec += 10) {
      shoreTick(state, 10);
      if (sec % 60 === 0) autobuild(state);
      if (sec % 1800 === 0) marks.push(`${sec / 60}m: ${s.people.length} (${s.built.length} built, food ${Math.round(s.food)}, wood ${Math.round(s.wood)})`);
      if (hundred < 0 && s.people.length >= 100) hundred = sec;
    }
    console.log(marks.join('\n'), '\n100 at', hundred / 60, 'min', 'day', s.day, 'founders left', s.people.filter((p) => p.founder).length);
    expect(s.births).toBeGreaterThan(20);
    expect(s.people.filter((p) => p.founder).length).toBe(0);
    expect(s.day).toBeGreaterThan((6 * 3600) / DAY_SEC - 2);
  });

  it('saves and loads', () => {
    const state = fresh();
    shoreTick(state, 600);
    const back = deserialize(serialize(state));
    expect(shoreOf(back)).toEqual(shoreOf(state));
    expect(back.stages.shore.seen).toEqual(state.stages.shore.seen);
    expect(back.current).toBe('shore');
  });
});

describe('Winning over', () => {
  it('gifts and visits raise trust until kin join, bringing their kind', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const v = s.villages[0];
    v.found = true;
    v.trust = 10;
    v.pop = 8;
    s.wood = 1000;
    now(state, 'hearth');
    for (let i = 0; i < 3; i++) now(state, 'hut');
    s.food = 1000;
    s.chiefAt = { x: s.hearth.x, y: s.hearth.y };
    expect(gift(state, v.id)).toBe(4);
    s.chiefAt = { x: v.x, y: v.y };
    s.chiefTo = null;
    expect(gift(state, v.id)).toBe(8);
    const before = s.people.length;
    for (let i = 0; i < 30 && !v.joined; i++) gift(state, v.id);
    expect(v.joined).toBe(true);
    expect(s.people.length).toBe(before + v.pop);
    expect(s.people.filter((p) => p.kind === v.id).length).toBe(v.pop);
    expect(gift(state, v.id)).toBe(0);
  });
  it('the chief staying a while wins them over by itself', () => {
    const state = fresh('hunter');
    const s = shoreOf(state)!;
    const v = s.villages[0];
    v.found = true;
    v.trust = 10;
    v.pop = 8;
    s.wood = 100000;
    now(state, 'hearth');
    for (let i = 0; i < 12; i++) now(state, 'hut');
    s.chiefAt = { x: v.x + 3, y: v.y + 3 };
    s.chiefTo = null;
    shoreTick(state, DAY_SEC * 50);
    expect(v.joined).toBe(true);
  });
});

describe('Scouts', () => {
  it('a scout explores the fog and finds villages on their own', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    s.wood = 200;
    now(state, 'hearth');
    now(state, 'hut');
    expect(now(state, 'scout')).toBe(true);
    const seen0 = state.stages.shore.seen.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 5400; i++) shoreTick(state, 2);
    const seen1 = state.stages.shore.seen.reduce((a, b) => a + b, 0);
    console.log('seen cells', seen0, '->', seen1, 'found', s.villages.filter((v) => v.found).length, 'of', s.villages.length);
    expect(seen1).toBeGreaterThan(seen0 * 5);
    expect(s.villages.some((v) => v.found)).toBe(true);
  });
});

describe('Landmarks', () => {
  it('are placed on their own ground; the chief explores them layer by layer for relics and know-how', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const pois = poisOf(s);
    expect(pois.length).toBeGreaterThan(15);
    const cave = pois.find((p) => p.kind === 'cave')!;
    cave.found = true;
    s.chiefAt = { x: cave.x, y: cave.y + 2 };
    s.chiefTo = null;
    s.wood = 0;
    shoreTick(state, 45);
    expect(cave.done).toBe(1);
    expect(s.learned).toContain('granary');
    shoreTick(state, 75);
    expect(s.relics).toContain('axe');
    expect(s.finds!.length).toBe(2);
    // The axe helps the wood along.
    expect(boosts(s).wood).toBeCloseTo(0.08);
    // Walking away stops it.
    s.chiefTo = { x: s.hearth.x, y: s.hearth.y };
    const t = cave.t;
    shoreTick(state, 5);
    expect(cave.t).toBe(t);
  });
  it('scouts find landmarks, but only the chief explores them', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    s.wood = 200;
    now(state, 'hearth');
    now(state, 'hut');
    now(state, 'scout');
    for (let i = 0; i < 1800; i++) shoreTick(state, 2);
    const found = poisOf(s).filter((p) => p.found);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((p) => p.done === 0 || Math.hypot(p.x - s.chiefAt.x, p.y - s.chiefAt.y) < 6)).toBe(true);
  });
});

describe('Won over with no room', () => {
  const setup = () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const v = s.villages[0];
    v.found = true;
    v.trust = 99;
    v.pop = 20;
    s.food = 1000;
    return { state, s, v };
  };
  it('asks what to do; unanswered, they wait, and come once there is room', () => {
    const { state, s, v } = setup();
    gift(state, v.id);
    expect(v.joined).toBeFalsy();
    expect(v.asking).toBeDefined();
    shoreTick(state, DAY_SEC * 1.5);
    expect(v.asking).toBeUndefined();
    expect(v.waiting).toBeDefined();
    s.wood = 10000;
    now(state, 'hearth');
    for (let i = 0; i < 6; i++) now(state, 'hut');
    shoreTick(state, 4);
    expect(v.joined).toBe(true);
  });
  it('kept waiting too long, they give up', () => {
    const { state, v } = setup();
    gift(state, v.id);
    answerJoin(state, v.id, 'wait');
    shoreTick(state, DAY_SEC * 11);
    expect(v.waiting).toBeUndefined();
    expect(v.joined).toBeFalsy();
    expect(v.trust).toBeGreaterThanOrEqual(60);
    expect(v.trust).toBeLessThan(65);
  });
  it('as a vassal they pay tribute and grow; taxed hard they revolt', () => {
    const { state, s, v } = setup();
    gift(state, v.id);
    answerJoin(state, v.id, 'vassal');
    s.food = 0;
    s.wood = 0;
    shoreTick(state, DAY_SEC * 5);
    expect(s.food).toBeGreaterThan(0);
    expect(v.pop).toBeGreaterThan(20);
    setTax(state, v.id, 0.6);
    shoreTick(state, DAY_SEC * 40);
    expect(v.vassal).toBeUndefined();
  });
  it('turned away, they go to swell an enemy camp', () => {
    const { state, s, v } = setup();
    gift(state, v.id);
    const before = s.villages.filter((x) => x !== v).reduce((a, x) => a + x.pop, 0);
    answerJoin(state, v.id, 'away');
    expect(v.gone).toBeDefined();
    expect(s.villages.filter((x) => x !== v).reduce((a, x) => a + x.pop, 0)).toBe(before + 20);
  });
  it('a village too big for its food starves, more the shorter it is', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 100; i++) s.people.push({ id: 100 + i, name: 'X' + i, born: -10 });
    // (More than the land round a small camp can feed.)
    expect(workPlan(s).foodRate).toBeLessThan(workPlan(s).eat);
    s.food = 0;
    shoreTick(state, DAY_SEC * 4);
    expect(s.people.length).toBeLessThan(100);
  });
});

describe('Finding the way', () => {
  it('walks round a lake rather than stopping at its shore', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const is = shoreIsland(s.seed);
    const N = is.n;
    // A lake, and a point on its far side.
    let lakeAt = -1;
    for (let i = 0; i < N * N && lakeAt < 0; i += 7) if (is.biome[i] === Biome.Lake) lakeAt = i;
    expect(lakeAt).toBeGreaterThan(-1);
    const lx = lakeAt % N;
    const ly = Math.floor(lakeAt / N);
    let a: { x: number; y: number } | null = null;
    let b: { x: number; y: number } | null = null;
    for (let r = 1; r < 200 && !(a && b); r++) {
      if (!a && isLand(is, lx - r, ly)) a = { x: lx - r, y: ly };
      if (!b && isLand(is, lx + r + 40, ly)) b = { x: lx + r + 40, y: ly };
    }
    s.chiefAt = a!;
    walkChief(state, b!);
    for (let i = 0; i < 3000 && s.chiefTo; i++) shoreTick(state, 1);
    expect(Math.hypot(s.chiefAt.x - b!.x, s.chiefAt.y - b!.y)).toBeLessThan(2);
  });
  it('sent into the water, goes to the nearest shore', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    walkChief(state, { x: 5, y: 5 });
    for (let i = 0; i < 3000 && s.chiefTo; i++) shoreTick(state, 1);
    expect(s.chiefTo).toBeNull();
    expect(isLand(shoreIsland(s.seed), s.chiefAt.x, s.chiefAt.y)).toBe(true);
  });
});

describe('The elders and the envoy', () => {
  it('the elders build on their own once there is a council', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    now(state, 'hut');
    now(state, 'council');
    expect(s.steward?.on).toBe(true);
    const before = s.built.length;
    for (let i = 0; i < 1800; i++) shoreTick(state, 2);
    expect(s.built.length).toBeGreaterThan(before + 2);
  });
  it('the envoy takes gifts to kin by themselves', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    now(state, 'hut');
    now(state, 'envoy');
    const v = s.villages[0];
    v.found = true;
    v.trust = 10;
    v.pop = 8;
    for (let d = 0; d < 5; d++) {
      s.food = foodCap(s);
      shoreTick(state, DAY_SEC);
    }
    expect(v.trust!).toBeGreaterThan(20);
  });
});
