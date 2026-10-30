import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { build, buildCost, buildsOpen, DAY_SEC, relation, shoreOf, shoreTick, startShore } from '../src/economy/shore';
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
