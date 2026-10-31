import { describe, expect, it } from 'vitest';
import { Biome, isLand } from '../src/economy/island';
import { createState } from '../src/economy/state';
import { poiHere, answerJoin, boosts, build, foodCap, stewardPick, sourcesOf, setTax, shoreIsland, takeRaft, walkChief, workPlan, DAY_SEC, gift, poisOf, relation, shoreOf, shoreTick, startShore } from '../src/economy/shore';
import { deserialize, serialize } from '../src/economy/save';
import { hostile, raidable, sendBand, fighters, setStance, stepIn, payCost, setWarRule } from '../src/economy/war';
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

/** Builds what a sensible player would (the elders' own choice). */
function autobuild(state: ReturnType<typeof fresh>) {
  const id = stewardPick(shoreOf(state)!);
  if (id) build(state, id);
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
  it('asks what to do, and waits for the answer however long; asked to wait, they come once there is room', () => {
    const { state, s, v } = setup();
    gift(state, v.id);
    expect(v.joined).toBeFalsy();
    expect(v.asking).toBeDefined();
    // Away a long while: nothing's decided for you.
    shoreTick(state, DAY_SEC * 20);
    expect(v.asking).toBeDefined();
    answerJoin(state, v.id, 'wait');
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
    s.wood = 50;
    const before = s.built.length;
    for (let i = 0; i < 1800; i++) shoreTick(state, 2);
    expect(s.built.length).toBeGreaterThan(before + 1);
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

describe('Resources of the land', () => {
  it('a joined village keeps an outpost that gives its land’s resources; buildings spend them', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 12; i++) now(state, 'hut');
    now(state, 'rack');
    const v = s.villages[0];
    v.habitat = 'river';
    v.found = true;
    v.trust = 99;
    v.pop = 6;
    s.food = foodCap(s);
    gift(state, v.id);
    expect(v.joined).toBe(true);
    expect(sourcesOf(s, 'clay').length).toBe(1);
    shoreTick(state, DAY_SEC * 12);
    expect(s.res?.clay ?? 0).toBeGreaterThan(20);
    expect(build(state, 'pottery')).toBe(true);
    expect(s.res!.clay!).toBeLessThan(10);
    // Without a village where there's salt, no salting shed.
    expect(sourcesOf(s, 'salt').length).toBe(0);
    s.wood = 1000;
    s.building = undefined;
    expect(build(state, 'salter')).toBe(false);
  });
});

describe('Raids', () => {
  /** A grown village of n, a while ashore. */
  function grown(diet: string, n: number) {
    const state = fresh(diet);
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 8; i++) now(state, 'hut');
    s.day = 40;
    while (s.people.length < n) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: 0, dies: 999 });
    s.food = 60;
    s.wood = 40;
    return { state, s };
  }
  it('nobody raids in the first years, or a small village', () => {
    const { state, s } = grown('grazer', 6);
    s.day = 0;
    for (let i = 0; i < 2000; i++) shoreTick(state, 2);
    expect(s.raid).toBeUndefined();
    expect(s.raids ?? 0).toBe(0);
  });
  it('predators come raiding: watched, seen coming, then a battle', () => {
    const { state, s } = grown('grazer', 30);
    expect(s.villages.some((v) => hostile(s, v))).toBe(true);
    let watched = false;
    let seen = false;
    for (let i = 0; i < 6000 && !(s.raids ?? 0); i++) {
      shoreTick(state, 2);
      if (s.raid) watched = true;
      if (s.raid?.seen !== undefined) seen = true;
      s.food = Math.max(s.food, 30);
    }
    expect(watched && seen).toBe(true);
    expect(s.raids).toBe(1);
    expect(s.battles?.length).toBe(1);
    expect(s.battles![0].rounds.length).toBeGreaterThan(0);
  });
  it('kin never raid, and prey can be raided and taken', () => {
    const { state, s } = grown('hunter', 40);
    expect(s.villages.some((v) => hostile(s, v) && !v.cannibal)).toBe(false);
    const prey = s.villages.find((v) => !v.cannibal && relation(s, v) === 'prey')!;
    prey.found = true;
    prey.pop = 10;
    expect(raidable(s, prey)).toBe(true);
    const before = fighters(s);
    expect(sendBand(state, s, prey.id, 30)).toBe(true);
    expect(fighters(s)).toBe(before - 30);
    for (let i = 0; i < 20000 && (s.warband || s.fight); i++) shoreTick(state, 2);
    expect(s.warband).toBeUndefined();
    expect(s.battles?.some((b) => b.attack === 'us' && b.won)).toBe(true);
    expect(prey.vassal?.conquered !== undefined || !!prey.gone).toBe(true);
  });
  /** A raid seen coming, here in a moment. */
  function coming(s: ReturnType<typeof shoreOf> & object) {
    const v = s.villages.find((x) => hostile(s, x))!;
    const now = s.day + s.clock / DAY_SEC;
    s.raid = { from: v.id, watched: now - 1, seen: now, arrives: now + 0.01, fighters: 8 };
    s.nextRaid = now + 100;
    return v;
  }
  it('paying them off: no fight, the stores pay, and they ask more next time', () => {
    const { state, s } = grown('grazer', 30);
    s.food = 200;
    s.wood = 100;
    const v = coming(s);
    const cost = payCost(v, 8);
    expect(setStance(s, 'pay')).toBe(true);
    for (let i = 0; i < 30; i++) shoreTick(state, 2);
    expect(s.fight).toBeUndefined();
    expect(s.battles ?? []).toHaveLength(0);
    expect(v.paid).toBe(1);
    expect(payCost(v, 8).food).toBeGreaterThan(cost.food);
  });
  it('the walls need a palisade', () => {
    const { s } = grown('grazer', 30);
    coming(s);
    expect(setStance(s, 'walls')).toBe(false);
  });
  it('a fight is fought a round at a time, and the chief can step in once', () => {
    const { state, s } = grown('grazer', 30);
    coming(s);
    for (let i = 0; i < 5 && !s.fight; i++) shoreTick(state, 2);
    expect(s.fight).toBeDefined();
    expect(s.fight!.rounds.length).toBeLessThan(3);
    s.chiefAt = { ...s.hearth };
    expect(stepIn(s)).toBe(true);
    expect(stepIn(s)).toBe(false);
    for (let i = 0; i < 100 && s.fight; i++) shoreTick(state, 2);
    expect(s.fight).toBeUndefined();
    expect(s.battles?.[0].chief).toBeDefined();
  });
  it('the war chief raids only by the rule given, and rallies the defence', () => {
    const { state, s } = grown('hunter', 40);
    const prey = s.villages.find((v) => !v.cannibal && relation(s, v) === 'prey')!;
    prey.found = true;
    prey.pop = 8;
    now(state, 'watch');
    now(state, 'warcamp');
    s.food = 200;
    for (let i = 0; i < 200; i++) shoreTick(state, 2);
    expect(s.warband).toBeUndefined();
    setWarRule(s, 'weaker');
    for (let i = 0; i < 400 && !s.warband; i++) {
      shoreTick(state, 2);
      s.food = 200;
    }
    expect(s.warband?.to).toBe(prey.id);
    // A raid with nothing said: the war chief rallies them.
    const { state: st2, s: s2 } = grown('grazer', 30);
    now(st2, 'watch');
    now(st2, 'warcamp');
    coming(s2);
    for (let i = 0; i < 5 && !s2.fight; i++) shoreTick(st2, 2);
    expect(s2.fight?.rallied).toBe(true);
  });
  it('raiders who fall leave loot; those who live run home; none fallen, nothing left', () => {
    const { state, s } = grown('grazer', 40);
    s.food = 10;
    s.wood = 10;
    coming(s);
    for (let i = 0; i < 200 && !(s.battles?.length); i++) shoreTick(state, 2);
    const b = s.battles![0];
    if (b.theirDead > 0) {
      expect(b.loot!.food + b.loot!.wood).toBeGreaterThan(0);
      expect(s.loot).toBeDefined();
    } else expect(b.loot).toBeUndefined();
    const left = b.rounds[b.rounds.length - 1][1];
    if (left > 0) expect(s.retreat?.n).toBe(left);
    // They get home, and the loot's gathered up.
    for (let i = 0; i < 4000 && (s.retreat || s.loot); i++) shoreTick(state, 2);
    expect(s.retreat).toBeUndefined();
    expect(s.loot).toBeUndefined();
  });
  it('a raid in progress survives a save', () => {
    const { state, s } = grown('grazer', 30);
    s.raid = { from: s.villages.find((v) => hostile(s, v))!.id, watched: 40, seen: 41, arrives: 42, fighters: 9 };
    const back = shoreOf(deserialize(serialize(state)))!;
    expect(back.raid?.fighters).toBe(9);
  });
});

describe('Families', () => {
  it('the four carry coats; children have two parents and a coat from them; the dead are remembered', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    expect(s.people.every((p) => p.genes)).toBe(true);
    now(state, 'hearth');
    for (let i = 0; i < 4; i++) now(state, 'hut');
    s.food = 200;
    for (let i = 0; i < 3000 && s.births < 3; i++) {
      shoreTick(state, 2);
      s.food = Math.max(s.food, 100);
    }
    const kids = s.people.filter((p) => p.parents);
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) {
      expect(k.genes).toBeDefined();
      expect(k.parents![0]).not.toBe(k.parents![1]);
    }
    for (let i = 0; i < 40000 && s.deaths < 1; i++) {
      shoreTick(state, 2);
      s.food = Math.max(s.food, 100);
    }
    expect(s.dead?.length).toBe(s.deaths);
    expect(s.dead![0].died).toBeDefined();
  });
});

describe('Landmarks, found and finished', () => {
  it('one a scout sees is known (listed) at once; one explored to the end is gone', async () => {
    const { poiDef } = await import('../src/economy/shore');
    const state = fresh();
    const s = shoreOf(state)!;
    const p = poisOf(s).find((x) => Math.hypot(x.x - s.chiefAt.x, x.y - s.chiefAt.y) > 50)!;
    const seen = state.stages.shore.seen;
    seen[Math.floor(p.y / 3) * 340 + Math.floor(p.x / 3)] = 1;
    shoreTick(state, 2);
    expect(p.found && p.known).toBe(true);
    expect(state.chronicle?.some((e) => e.text.startsWith('A scout came back'))).toBe(true);
    // Explored to the end: nothing left for the chief to explore there.
    p.done = poiDef(p).layers.length;
    s.chiefAt = { x: p.x, y: p.y };
    s.chiefTo = null;
    expect(poiHere(s)).toBeUndefined();
  });
});

describe('Families, not too close', () => {
  it('a child never has parents who are parent and child, or brother and sister', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 6; i++) now(state, 'hut');
    for (let i = 0; i < 20000 && s.births < 40; i++) {
      shoreTick(state, 2);
      s.food = Math.max(s.food, 100);
    }
    const all = new Map([...(s.dead ?? []), ...s.people].map((p) => [p.id, p]));
    for (const c of all.values()) {
      const [a, b] = (c.parents ?? []).map((i) => (i === undefined ? undefined : all.get(i)));
      if (!a || !b) continue;
      expect(a.parents?.includes(b.id) || b.parents?.includes(a.id)).toBeFalsy();
      expect(a.parents?.some((x) => x !== undefined && b.parents?.includes(x))).toBeFalsy();
    }
  }, 60_000);
});

describe('Dancing', () => {
  it('wins trust with the chief there, more on a streak, and tires out for the day', async () => {
    const { dance, DANCE_DAY } = await import('../src/economy/shore');
    const state = fresh();
    const s = shoreOf(state)!;
    const v = s.villages.find((x) => relation(s, x) === 'kin')!;
    v.found = true;
    v.trust = 10;
    expect(dance(state, v.id, 0)).toBe(0);
    s.chiefAt = { x: v.x + 2, y: v.y + 2 };
    const one = dance(state, v.id, 0);
    const five = dance(state, v.id, 5);
    expect(one).toBeGreaterThan(0);
    expect(five).toBeGreaterThan(one);
    let total = one + five;
    for (let i = 0; i < 100; i++) total += dance(state, v.id, 5);
    expect(total).toBeCloseTo(DANCE_DAY, 5);
    expect(dance(state, v.id, 5)).toBe(0);
  });
});

describe('Coming and going with vassals', () => {
  function vassalGame() {
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 8; i++) now(state, 'hut');
    const v = s.villages.find((x) => relation(s, x) === 'kin')!;
    v.found = true;
    v.vassal = { tax: 0.1, loyalty: 90 };
    v.pop = 30;
    s.food = 300;
    return { state, s, v };
  }
  it('with beds free, a content vassal\'s young come to live by the hearth, and tie them closer', () => {
    const { state, s, v } = vassalGame();
    const before = s.people.length;
    for (let i = 0; i < 3000 && s.people.length === before; i++) {
      shoreTick(state, 2);
      s.food = Math.max(s.food, 300);
    }
    const came = s.people.filter((p) => p.kind === v.id);
    expect(came.length).toBeGreaterThan(0);
    // (A vassal grows on its own too: fewer than it would have been, not an exact count.)
    expect(v.pop).toBeLessThan(31);
    expect(v.ties).toBe(came.length);
  });
  it('crowded, some go to live with the vassal (kept in the family trees, not dead)', () => {
    const { state, s, v } = vassalGame();
    while (s.people.length < 50) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    const deaths = s.deaths;
    for (let i = 0; i < 2000 && !s.dead?.some((p) => p.moved); i++) {
      shoreTick(state, 2);
      s.food = Math.max(s.food, 300);
    }
    const gone = s.dead!.filter((p) => p.moved);
    expect(gone.length).toBeGreaterThan(0);
    expect(gone[0].moved).toBe(v.name);
    expect(gone[0].died).toBeUndefined();
    expect(s.deaths).toBe(deaths);
  });
  it('with ties enough and room, the rest of the vassal come too', () => {
    const { state, v } = vassalGame();
    v.pop = 8;
    v.ties = 8;
    for (let i = 0; i < 120 && !v.joined; i++) shoreTick(state, 2);
    expect(v.joined).toBe(true);
    expect(v.vassal).toBeUndefined();
  });
});

describe('Vassals and the hearth defend each other', () => {
  async function setup() {
    const war = await import('../src/economy/war');
    const state = fresh();
    const s = shoreOf(state)!;
    now(state, 'hearth');
    for (let i = 0; i < 8; i++) now(state, 'hut');
    while (s.people.length < 30) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
    s.food = 300;
    s.day = 40;
    const kin = s.villages.filter((x) => relation(s, x) === 'kin');
    const foe = s.villages.find((x) => war.hostile(s, x))!;
    return { war, state, s, kin, foe };
  }
  it('a loyal vassal near enough sends help to the hearth; one too far does not', async () => {
    const { war, state, s, kin, foe } = await setup();
    const [near, far] = kin;
    near.vassal = { tax: 0.1, loyalty: 90 };
    near.pop = 20;
    near.x = s.hearth.x + 10;
    near.y = s.hearth.y;
    far.vassal = { tax: 0.1, loyalty: 90 };
    far.pop = 20;
    far.x = s.hearth.x + 900;
    s.raid = { from: foe.id, watched: s.day - 1.01, fighters: 8 };
    s.nextRaid = s.day + 100;
    shoreTick(state, DAY_SEC);
    const allies = s.raid?.allies ?? [];
    expect(allies.some((a) => a.from === near.id)).toBe(true);
    expect(allies.some((a) => a.from === far.id)).toBe(false);
    for (let i = 0; i < 400 && !s.fight && !s.battles?.length; i++) shoreTick(state, 2);
    expect(s.fight?.side?.some((a) => a.from === near.id) ?? s.battles?.[0].helpers).toBeTruthy();
    void war;
  });
  it('raiders on a vassal: help goes only if it gets there in time, and loyalty remembers', async () => {
    const { war, state, s, kin, foe } = await setup();
    const v = kin[0];
    v.vassal = { tax: 0.1, loyalty: 70 };
    v.pop = 12;
    v.x = s.hearth.x + 20;
    v.y = s.hearth.y;
    const d = s.day + s.clock / DAY_SEC;
    s.raid = { from: foe.id, watched: d - 1, seen: d, arrives: d + 2, fighters: 6, target: v.id };
    expect(war.canHelp(s)).toBe(true);
    expect(war.answerHelp(state, s, true)).toBe(true);
    expect(s.raid.allies?.some((a) => a.from === -1)).toBe(true);
    const before = v.vassal.loyalty;
    for (let i = 0; i < 2000 && !s.battles?.length; i++) shoreTick(state, 2);
    const b = s.battles![0];
    expect(b.at).toBe(v.id);
    expect(v.vassal!.loyalty).not.toBe(before);
    // Too far to get there in time: no help can be sent.
    s.raid = { from: foe.id, watched: d, seen: s.day + s.clock / DAY_SEC, arrives: s.day + s.clock / DAY_SEC + 0.01, fighters: 6, target: v.id };
    v.x = s.hearth.x + 600;
    expect(war.canHelp(s)).toBe(false);
  });
});

describe('Striking in a fight', () => {
  it('a strike makes the next round hit harder, once a round; raids are rallied by themselves', async () => {
    const war = await import('../src/economy/war');
    const { state, s } = (() => {
      const state = fresh();
      const s = shoreOf(state)!;
      now(state, 'hearth');
      for (let i = 0; i < 8; i++) now(state, 'hut');
      while (s.people.length < 30) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30, dies: 9999 });
      s.food = 300;
      s.day = 40;
      return { state, s };
    })();
    const foe = s.villages.find((x) => war.hostile(s, x))!;
    s.raid = { from: foe.id, watched: s.day - 1.01, fighters: 10 };
    s.nextRaid = s.day + 100;
    shoreTick(state, DAY_SEC);
    expect(s.raid?.rallied).toBe(true);
    for (let i = 0; i < 400 && !s.fight; i++) shoreTick(state, 2);
    expect(s.fight).toBeDefined();
    expect(war.strike(s, 1)).toBe(2);
    expect(war.strike(s, 1)).toBe(0);
    const y = s.fight!.y;
    shoreTick(state, 3);
    expect(s.fight?.push ?? undefined).toBeUndefined();
    expect((s.fight?.y ?? 0) < y || !s.fight).toBe(true);
  });
});
