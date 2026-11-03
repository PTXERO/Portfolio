import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { cross, shoreOf, startShore, takeRaft } from '../src/economy/shore';
import { fightPirate, gunsTime, havensLeft, pirateChance, raided, setPirateDice, conquer, conquerCost, giftCost, giveGift, joinedMult, ours, sendVoyage, voyageTarget, buySailUp, buyShips, coastAt, gust, level, makeWorld, MASK, openCost, openRoute, routeOptions, routeRate, sailRate, setSail, shipCost, sightOf } from '../src/economy/sail';
import { tick } from '../src/economy/tick';
import { D } from '../src/economy/num';
import { deserialize, serialize } from '../src/economy/save';
import type { TribeState } from '../src/economy/types';

function fresh() {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves', mouth: 'grinders' }, diet: 'grazer' }, stats: { strength: 1, speed: 1, senses: 1, toughness: 1, charm: 1 },
    generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }],
    landed: { seed: 777, day: 60 },
  } as TribeState;
  startShore(state);
  takeRaft(state);
  return state;
}

describe('The Age of Sail: the world map', () => {
  it('the islands hopped are on it, in order, home in the middle; the rest found only near yours', () => {
    const state = fresh();
    const s = shoreOf(state)!;
    while (s.people.length < 12) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -30 + s.people.length });
    for (const v of s.villages) v.won = s.day;
    expect(cross(state)).toBe(true);
    const n = shoreOf(state)!;
    expect(n.past![0].mask).toBeTruthy();
    const world = makeWorld(n);
    const mine = world.isles.filter((i) => i.mine !== undefined);
    expect(mine.map((i) => i.mine)).toEqual([0, -1]);
    const home = mine.find((i) => i.mine === -1)!;
    expect(home.x).toBe(world.w / 2);
    expect(world.isles.length).toBeGreaterThan(20);
    // (An island's coast is its own: some land, some sea.)
    let land = 0;
    for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK; x++) if (coastAt(home.mask, x, y)) land++;
    expect(land).toBeGreaterThan(MASK * MASK * 0.1);
    expect(land).toBeLessThan(MASK * MASK * 0.95);
    for (const i of world.isles) {
      if (i.mine !== undefined) continue;
      const near = mine.some((m) => Math.hypot(m.x - i.x, m.y - i.y) < sightOf(world) + m.r * 0.5 + i.r * 0.5);
      expect(i.found).toBe(near);
    }
  });
  it('sets sail only once the Republic stands; the world is kept in the save', () => {
    const state = fresh();
    expect(setSail(state)).toBe(false);
    shoreOf(state)!.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
    expect(setSail(state)).toBe(true);
    expect(state.current).toBe('sail');
    expect(state.unlocked).toContain('sail');
    const back = deserialize(serialize(state));
    expect(back.stages.sail.world?.isles.length).toBe(state.stages.sail.world!.isles.length);
  });
  it('trade: a free first route earns by itself; ships cost more each; routes open; upgrades multiply; a gust doubles', () => {
    const state = fresh();
    shoreOf(state)!.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
    setSail(state);
    const world = state.stages.sail.world!;
    expect(world.routes).toHaveLength(1);
    expect(world.routes![0].ships).toBe(1);
    const before = sailRate(state);
    expect(before).toBeGreaterThan(0);
    tick(state, 60);
    expect(state.stages.sail.currency.toNumber()).toBeCloseTo(before * 60, 0);
    const r = world.routes![0];
    expect(shipCost(world, { to: r.to, ships: 20 })).toBeGreaterThan(shipCost(world, { to: r.to, ships: 10 }) * 3);
    state.stages.sail.currency = D(1e12);
    expect(buyShips(state, 0, 9)).toBe(true);
    // (10 ships: the route's first ×2.)
    expect(routeRate(state, world, r)).toBeCloseTo(before * 10 * 2, 5);
    const next = routeOptions(world)[0];
    const c = openCost(world, next.id);
    expect(openRoute(state, next.id)).toBe(true);
    expect(state.stages.sail.currency.toNumber()).toBeCloseTo(1e12 - shipCost({ ...world, routes: [{ to: r.to, ships: 1 }] } as never, { to: r.to, ships: 1 }, 9) - c, -3);
    const sails = routeRate(state, world, r);
    expect(buySailUp(state, 'sails')).toBe(true);
    expect(level(world, 'sails')).toBe(1);
    expect(routeRate(state, world, r)).toBeCloseTo(sails * 1.3, 5);
    gust(world, 0);
    expect(routeRate(state, world, r, 0)).toBeCloseTo(sails * 1.3 * 2, 5);
    // (Charts: further seen, more to trade with.)
    const sight = sightOf(world);
    const found = world.isles.filter((i) => i.found).length;
    state.stages.sail.currency = D(1e12);
    expect(buySailUp(state, 'charts')).toBe(true);
    expect(sightOf(world)).toBeGreaterThan(sight);
    expect(world.isles.filter((i) => i.found).length).toBeGreaterThanOrEqual(found);
  });
  it('passage buys ships for you, then opens routes', () => {
    const state = fresh();
    shoreOf(state)!.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
    setSail(state);
    const world = state.stages.sail.world!;
    world.ups = { passage: 2 };
    state.stages.sail.currency = D(1e9);
    // (Passage spends half of what comes in; here, a budget to spend already.)
    world.passBudget = 1e6;
    tick(state, 1);
    expect(world.routes!.length).toBeGreaterThan(1);
    expect(world.routes![0].ships).toBeGreaterThan(1);
  });
  it('voyages find islands one at a time; each people is won with gifts, by trade, or taken; joined islands add to everything', () => {
    const state = fresh();
    shoreOf(state)!.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
    setSail(state);
    const world = state.stages.sail.world!;
    state.stages.sail.currency = D(1e30);
    // A voyage: out a while, then the island it made for is found, and its people met.
    const target = voyageTarget(world)!.to;
    expect(target.found).toBe(false);
    expect(sendVoyage(state)).toBe(true);
    expect(sendVoyage(state)).toBe(false);
    tick(state, 61);
    expect(target.found).toBe(true);
    expect(world.met).toContain(target.id);
    // Gifts: trust, and dearer each time; at 100 they join.
    const before = giftCost(world, target);
    expect(giveGift(state, target.id)).toBe(true);
    expect(target.trust).toBeGreaterThan(0);
    expect(giftCost(world, target)).toBeGreaterThan(before);
    while (!target.joined) giveGift(state, target.id);
    expect(ours(target)).toBe(true);
    expect(joinedMult(world)).toBeCloseTo(1.15, 5);
    // Taken: ships enough and Influence; then the next is dearer.
    const foe = world.isles.find((i) => i.found && !ours(i))!;
    const need = conquerCost(world, foe);
    world.routes![0].ships = need.ships;
    expect(conquer(state, foe.id)).toBe(true);
    expect(foe.joined).toBe(true);
    const next = world.isles.find((i) => i.found && !ours(i));
    if (next) expect(conquerCost(world, next).influence).toBeGreaterThan(0);
    // Trade: a route to a people wins their trust by itself.
    const partner = world.routes!.map((r) => world.isles[r.to]).find((i) => !ours(i));
    if (partner) {
      const t0 = partner.trust ?? 0;
      tick(state, 600);
      expect(partner.trust ?? 0).toBeGreaterThan(t0);
    }
  });
  it('pirates: they come once there are routes, raid one (no pay, ships taken), are driven off for loot; Guns fight them; havens only taken', () => {
    const state = fresh();
    shoreOf(state)!.culture = { since: 0, age: 6, practice: {}, done: [], forks: {} };
    setSail(state);
    const world = state.stages.sail.world!;
    expect(havensLeft(world)).toBe(3);
    const haven = world.isles.find((i) => i.haven)!;
    haven.found = true;
    state.stages.sail.currency = D(1e30);
    expect(giveGift(state, haven.id)).toBe(false);
    // None for the first quarter-hour, nor with a single route.
    expect(pirateChance(world)).toBe(0);
    openRoute(state, routeOptions(world)[0].id);
    world.routes![0].ships = 20;
    world.age = 1000;
    expect(pirateChance(world)).toBeGreaterThan(0);
    setPirateDice(() => 0);
    tick(state, 0.5);
    setPirateDice(() => 0.999);
    expect(world.pirates).toHaveLength(1);
    const p = world.pirates![0];
    expect(raided(world, p.route)).toBe(true);
    expect(routeRate(state, world, world.routes![p.route], p.route)).toBe(0);
    const ships = world.routes![p.route].ships;
    tick(state, 16);
    expect(world.routes![p.route].ships).toBe(ships - 1);
    // Driven off: four hits, and the loot.
    state.stages.sail.currency = D(1000);
    const had = state.stages.sail.currency.toNumber();
    for (let k = 0; k < 3; k++) expect(fightPirate(state, 0)).toBe(0);
    expect(fightPirate(state, 0)).toBeGreaterThan(0);
    expect(world.pirates).toHaveLength(0);
    expect(state.stages.sail.currency.toNumber()).toBeGreaterThan(had);
    // Guns: the ships see them off by themselves.
    world.ups = { ...world.ups, guns: 3 };
    expect(gunsTime(world)).toBeLessThan(16);
    world.pirates!.push({ route: 0, at: 0.5, hp: 4, left: 90, next: 15 });
    tick(state, gunsTime(world) * 4 + 1);
    expect(world.pirates).toHaveLength(0);
    // Every haven taken, fewer raids; all three, none.
    const before = pirateChance(world);
    for (const h of world.isles.filter((i) => i.haven)) h.joined = true;
    expect(pirateChance(world)).toBeLessThan(before);
    expect(pirateChance(world)).toBe(0);
    setPirateDice(Math.random);
  });
});
