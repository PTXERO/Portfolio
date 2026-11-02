import { describe, expect, it } from 'vitest';
import { Biome, isLand } from '../src/economy/island';
import { createState } from '../src/economy/state';
import { allMult, boosts, buyGen, buyUpgrade, canTake, councilPick, count, CRITTER_MORE, dance, DANCE_DAY, DAY_SEC, foodRate, genCost, genRate, gift, giftCost, hearthMost, idleShore, maxBuy, poiHere, poisOf, relation, room, shoreIsland, shoreOf, shoreTick, startShore, stoke, take, takeCost, takeRaft, tapValue, walkChief, WON_MORE, type ShoreState } from '../src/economy/shore';
import { deserialize, serialize } from '../src/economy/save';
import type { GenId } from '../src/content/idle';
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

/** The hearth lit, and these bought outright. */
function lit(state: ReturnType<typeof fresh>, gens: Partial<Record<GenId, number>> = {}) {
  const s = shoreOf(state)!;
  takeRaft(state);
  for (const [id, n] of Object.entries(gens)) s.gens[id as GenId] = n;
  return s;
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
  it('saves and loads', () => {
    const state = fresh();
    lit(state, { forager: 3, hut: 2 });
    shoreTick(state, 600);
    const back = deserialize(serialize(state));
    expect(shoreOf(back)).toEqual(shoreOf(state));
    expect(back.stages.shore.seen).toEqual(state.stages.shore.seen);
  });
});

describe('Food, the idle way', () => {
  it('stoking builds the fire up, less with each stoke: a hot fire makes everything bring in more, and it dies down if left', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    lit(state);
    buyGen(state, 'forager');
    const cold = foodRate(s);
    // (Logarithmic: the first stokes count for most.)
    const heats: number[] = [];
    for (let i = 0; i < 160; i++) {
      stoke(state);
      heats.push(s.heat!);
    }
    expect(heats[9] - heats[0]).toBeGreaterThan(heats[159] - heats[150]);
    expect(heats[9]).toBeGreaterThan(0.4);
    expect(s.heat).toBe(1);
    expect(foodRate(s)).toBeCloseTo(cold * 2, 6);
    shoreTick(state, 30);
    expect(s.heat).toBeGreaterThan(0);
    expect(s.heat).toBeLessThan(1);
    shoreTick(state, 300);
    expect(s.heat).toBe(0);
    expect(foodRate(s)).toBeCloseTo(cold, 6);
  });
  it('the fire\'s upgrades: hotter at its hottest, and banked embers never let it go cold', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    lit(state);
    buyGen(state, 'forager');
    const cold = foodRate(s);
    s.ups.push('firering', 'firepit', 'embers');
    shoreTick(state, 1);
    expect(s.heat).toBeCloseTo(0.25, 6);
    for (let i = 0; i < 300; i++) stoke(state);
    expect(foodRate(s)).toBeCloseTo(cold * 3.5, 6);
    shoreTick(state, 600);
    expect(foodRate(s)).toBeCloseTo(cold * (1 + 2.5 * 0.25), 6);
  });
  it('the hearth lit, stoking brings food; foragers bring it in by themselves; and it only ever goes up', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    expect(stoke(state)).toBe(0);
    lit(state);
    expect(count(s, 'hearth')).toBe(1);
    const f0 = s.food;
    expect(stoke(state)).toBe(1);
    expect(s.food).toBe(f0 + 1);
    expect(buyGen(state, 'forager')).toBe(1);
    expect(foodRate(s)).toBeGreaterThan(0);
    const f1 = s.food;
    shoreTick(state, 100);
    expect(s.food).toBeGreaterThan(f1);
    // Nothing's eaten, nothing spoils, no one starves: left a long while, it's only more.
    const f2 = s.food;
    const n = s.people.length;
    shoreTick(state, DAY_SEC * 40);
    expect(s.food).toBeGreaterThan(f2);
    expect(s.people.filter((p) => p.founder).length + (s.dead?.filter((p) => p.cause !== 'old age').length ?? 0)).toBeLessThanOrEqual(n);
  });
  it('each one costs more than the last; buying many costs what buying them one by one would', () => {
    const state = fresh();
    const s = lit(state);
    s.food = 1e6;
    const one = genCost(s, 'forager');
    const ten = genCost(s, 'forager', 10);
    buyGen(state, 'forager');
    expect(genCost(s, 'forager')).toBeGreaterThan(one);
    let sum = one;
    for (let i = 1; i < 10; i++) {
      sum += genCost(s, 'forager');
      buyGen(state, 'forager');
    }
    expect(ten).toBeCloseTo(sum, -1);
    s.food = genCost(s, 'forager', 3) + 1;
    expect(maxBuy(s, 'forager')).toBe(3);
  });
  it('homes bring critters (children born free), and every critter makes the work go better', () => {
    const state = fresh();
    const s = lit(state, { forager: 10, hut: 5 });
    expect(room(s)).toBe(24);
    for (let i = 0; i < 4000 && s.people.length < 20; i++) shoreTick(state, 2);
    expect(s.people.length).toBeGreaterThanOrEqual(20);
    const before = allMult(s);
    s.people.push({ id: 999, name: 'X', born: -30 });
    expect(allMult(s)).toBeCloseTo(before * (1 + (s.people.length * CRITTER_MORE)) / (1 + ((s.people.length - 1) * CRITTER_MORE)), 6);
    // Never past what the hearth holds.
    s.gens.hut = 200;
    expect(Math.min(room(s), hearthMost(s))).toBe(150);
  });
  it('upgrades: a doubler doubles its own, the fire-keepers put a second\'s worth in every stoke', () => {
    const state = fresh();
    const s = lit(state, { forager: 10 });
    s.food = 1e6;
    const r = genRate(s, 'forager');
    expect(buyUpgrade(state, 'forager10')).toBe(true);
    expect(genRate(s, 'forager')).toBeCloseTo(r * 2);
    expect(buyUpgrade(state, 'forager10')).toBe(false);
    // (Not on offer till the village is big enough.)
    expect(buyUpgrade(state, 'stoke2')).toBe(false);
    while (s.people.length < 10) s.people.push({ id: 1000 + s.people.length, name: 'X', born: -30 });
    expect(buyUpgrade(state, 'stoke2')).toBe(true);
    expect(tapValue(s)).toBeCloseTo(1 + foodRate(s), 5);
  });
  it('the council buys what\'s most worth buying, by itself', () => {
    const state = fresh();
    const s = lit(state, { forager: 5 });
    while (s.people.length < 12) s.people.push({ id: 1000 + s.people.length, name: 'X', born: -30 });
    s.food = 1e4;
    expect(buyUpgrade(state, 'council')).toBe(true);
    expect(s.auto).toBe(true);
    expect(councilPick(s)).toBeTruthy();
    const had = Object.values(s.gens).reduce((a, n) => a + (n ?? 0), 0);
    shoreTick(state, 60);
    expect(Object.values(s.gens).reduce((a, n) => a + (n ?? 0), 0)).toBeGreaterThan(had);
  });
  it('left to the council, a village grows to a hundred in a few hours', () => {
    const state = fresh();
    const s = lit(state);
    let hundred = -1;
    for (let sec = 0; sec < 6 * 3600 && hundred < 0; sec += 2) {
      shoreTick(state, 2);
      // (The player's first minutes: a few stokes, foragers and huts, then the council.)
      if (sec < 600 && sec % 4 === 0) stoke(state);
      if (sec % 30 === 0) {
        buyUpgrade(state, 'council');
        if (!s.auto) for (const id of ['forager', 'hut', 'camp'] as GenId[]) buyGen(state, id);
      }
      if (s.people.length >= 100) hundred = sec;
    }
    console.log('a hundred at', Math.round(hundred / 60), 'min');
    expect(hundred).toBeGreaterThan(0);
    expect(hundred).toBeLessThan(5 * 3600);
  }, 60_000);
});

describe('Winning the island', () => {
  it('kin won with gifts (twice, with the chief there): theirs is yours, and everything brings in more', () => {
    const state = fresh();
    const s = lit(state, { forager: 5 });
    const v = s.villages[0];
    v.found = true;
    v.trust = 10;
    s.food = 1e6;
    s.chiefAt = { ...s.hearth };
    expect(gift(state, v.id)).toBe(4);
    s.chiefAt = { x: v.x, y: v.y };
    s.chiefTo = null;
    expect(gift(state, v.id)).toBe(8);
    const before = allMult(s);
    for (let i = 0; i < 30 && v.won === undefined; i++) gift(state, v.id);
    expect(v.won).toBeDefined();
    expect(allMult(s)).toBeCloseTo(before * (1 + WON_MORE), 6);
    expect(gift(state, v.id)).toBe(0);
    expect(giftCost(s, v)).toBeGreaterThan(0);
  });
  it('the rest are beaten: food for the war band, and critters enough', () => {
    const state = fresh('omnivore');
    const s = lit(state);
    const v = s.villages.find((x) => relation(s, x) !== 'kin')!;
    v.found = true;
    expect(canTake(s, v)).toBe(true);
    const c = takeCost(s, v);
    s.food = c.food;
    expect(take(state, v.id)).toBe(false);
    while (s.people.length < c.critters) s.people.push({ id: 1000 + s.people.length, name: 'X', born: -30 });
    expect(take(state, v.id)).toBe(true);
    expect(v.won).toBeDefined();
    expect(s.food).toBe(0);
    // (The next costs more.)
    const w = s.villages.find((x) => relation(s, x) !== 'kin' && x.won === undefined)!;
    w.found = true;
    w.pop = v.pop;
    expect(takeCost(s, w).food).toBeGreaterThan(c.food);
  });
  it('the chief staying a while wins kin over by themselves', () => {
    const state = fresh('hunter');
    const s = lit(state);
    const v = s.villages[0];
    v.found = true;
    v.trust = 10;
    s.chiefAt = { x: v.x + 3, y: v.y + 3 };
    s.chiefTo = null;
    shoreTick(state, DAY_SEC * 50);
    expect(v.won).toBeDefined();
  });
  it('dancing round their fire: the fire danced up (twice as much, a while), trust from kin, and they tire', () => {
    const state = fresh();
    const s = lit(state, { forager: 10 });
    const v = s.villages.find((x) => relation(s, x) === 'kin')!;
    v.found = true;
    v.trust = 10;
    expect(dance(state, v.id, 0)).toBe(0);
    s.chiefAt = { x: v.x + 2, y: v.y + 2 };
    s.chiefTo = null;
    const r0 = foodRate(s);
    const one = dance(state, v.id, 0);
    expect(one).toBeGreaterThan(0);
    expect(foodRate(s)).toBeCloseTo(r0 * 2, 5);
    const five = dance(state, v.id, 5);
    expect(five).toBeGreaterThan(one);
    let total = one + five;
    for (let i = 0; i < 100; i++) total += dance(state, v.id, 5);
    expect(total).toBeCloseTo(DANCE_DAY, 5);
    expect(dance(state, v.id, 5)).toBe(0);
    expect(v.trust).toBeGreaterThan(10);
    // The fire dies down.
    shoreTick(state, 200);
    expect(foodRate(s)).toBeCloseTo(r0 * (allMult(s) / allMult(s)), 0);
  });
});

describe('Scouts and landmarks', () => {
  it('scouts (an upgrade) explore the fog and find villages on their own', () => {
    const state = fresh();
    const s = lit(state);
    s.ups.push('scouts');
    const seen0 = state.stages.shore.seen.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 5400; i++) shoreTick(state, 2);
    const seen1 = state.stages.shore.seen.reduce((a, b) => a + b, 0);
    expect(seen1).toBeGreaterThan(seen0 * 5);
    expect(s.villages.some((v) => v.found)).toBe(true);
  });
  it('the chief explores a landmark layer by layer for relics; walking away stops it', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const pois = poisOf(s);
    expect(pois.length).toBeGreaterThan(15);
    const cave = pois.find((p) => p.kind === 'cave')!;
    cave.found = true;
    s.chiefAt = { x: cave.x, y: cave.y + 2 };
    s.chiefTo = null;
    shoreTick(state, 45);
    expect(cave.done).toBe(1);
    shoreTick(state, 75);
    expect(s.relics).toContain('axe');
    expect(boosts(s).tap).toBeCloseTo(0.25);
    s.chiefTo = { x: s.hearth.x, y: s.hearth.y };
    const t = cave.t;
    shoreTick(state, 5);
    expect(cave.t).toBe(t);
  });
  it('one a scout sees is known (listed) at once; one explored to the end is gone', async () => {
    const { poiDef } = await import('../src/economy/shore');
    const state = fresh();
    const s = shoreOf(state)!;
    const p = poisOf(s).find((x) => Math.hypot(x.x - s.chiefAt.x, x.y - s.chiefAt.y) > 50)!;
    const seen = state.stages.shore.seen;
    seen[Math.floor(p.y / 3) * 340 + Math.floor(p.x / 3)] = 1;
    shoreTick(state, 2);
    expect(p.found && p.known).toBe(true);
    p.done = poiDef(p).layers.length;
    s.chiefAt = { x: p.x, y: p.y };
    s.chiefTo = null;
    expect(poiHere(s)).toBeUndefined();
  });
});

describe('Older saves, made over', () => {
  it('what was built becomes what\'s bought; wood folds into food; every village held is won', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    const old = {
      ...s,
      raftTaken: true,
      food: 300,
      wood: 120,
      built: [{ id: 'hearth', x: 1, y: 1, day: 0 }, ...Array.from({ length: 20 }, () => ({ id: 'hut', x: 1, y: 1, day: 0 })), { id: 'camp', x: 1, y: 1, day: 0 }, { id: 'council', x: 1, y: 1, day: 0 }, { id: 'scout', x: 1, y: 1, day: 0 }],
      villages: s.villages.map((v, i) => ({ ...v, ...(i === 0 ? { settled: 3 } : i === 1 ? { vassal: { tax: 0.2, loyalty: 50 } } : {}) })),
      raid: { from: 2 },
      res: { stone: 5 },
    } as unknown as ShoreState & Record<string, unknown>;
    delete (old as Record<string, unknown>).gens;
    delete (old as Record<string, unknown>).ups;
    const n = idleShore(old);
    expect(n.food).toBe(420);
    expect(n.gens.hut).toBe(20);
    expect(n.gens.camp).toBe(1);
    expect(n.gens.forager).toBeGreaterThanOrEqual(5);
    expect(n.ups).toEqual(expect.arrayContaining(['council', 'scouts']));
    expect(n.auto).toBe(true);
    expect(n.villages[0].won).toBeDefined();
    expect(n.villages[1].won).toBeDefined();
    expect(n.villages[2].won).toBeUndefined();
    expect('raid' in n || 'res' in n || 'wood' in n).toBe(false);
    expect(n.built.filter((b) => b.id === 'hut').length).toBeLessThanOrEqual(12);
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

describe('Families', () => {
  it('the four carry coats; children have two parents and a coat from them; the dead are remembered', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    expect(s.people.every((p) => p.genes)).toBe(true);
    lit(state, { hut: 4 });
    for (let i = 0; i < 3000 && s.births < 3; i++) {
      shoreTick(state, 2);
    }
    const kids = s.people.filter((p) => p.parents);
    expect(kids.length).toBeGreaterThan(0);
    for (const k of kids) {
      expect(k.genes).toBeDefined();
      expect(k.parents![0]).not.toBe(k.parents![1]);
    }
    for (let i = 0; i < 40000 && s.deaths < 1; i++) {
      shoreTick(state, 2);
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
    lit(state, { hut: 6 });
    for (let i = 0; i < 20000 && s.births < 40; i++) {
      shoreTick(state, 2);
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

