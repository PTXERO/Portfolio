import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { cross, shoreOf, startShore, takeRaft } from '../src/economy/shore';
import { coastAt, makeWorld, MASK, setSail, SIGHT } from '../src/economy/sail';
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
      const near = mine.some((m) => Math.hypot(m.x - i.x, m.y - i.y) < SIGHT + m.r * 0.5 + i.r * 0.5);
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
});
