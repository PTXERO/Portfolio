import { describe, expect, it } from 'vitest';
import { inherit, personal, randomGenes, whatsNew } from '../src/economy/genes';

let r = 7;
const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);

describe('Genes', () => {
  it('a child takes after both parents', () => {
    const a = { hue: 30, light: 0.1, pattern: 'stripes' as const };
    const b = { hue: -30, light: -0.1 };
    let striped = 0;
    for (let i = 0; i < 200; i++) {
      const g = inherit(a, b, rand);
      expect(g.hue).toBeGreaterThan(-30);
      expect(g.hue).toBeLessThan(30);
      if (g.pattern === 'stripes') striped++;
    }
    // One parent striped: the young are striped more often than not.
    expect(striped).toBeGreaterThan(90);
    expect(striped).toBeLessThan(160);
  });
  it('a rare colouring both parents carry always shows', () => {
    for (let i = 0; i < 50; i++) expect(inherit({ hue: 0, light: 0, morph: 'albino' }, { hue: 0, light: 0, morph: 'albino' }, rand).morph).toBe('albino');
  });
  it('the same animal always has the same coat, and never -0', () => {
    const g = randomGenes(rand);
    expect(personal(g, 42)).toEqual(personal(g, 42));
    expect(Object.is(personal({ hue: 0, light: 0 }, 3).light, -0)).toBe(false);
  });
  it('says what is new in the young', () => {
    expect(whatsNew({ hue: 0, light: 0 }, { hue: 0, light: 0, morph: 'albino' })).toMatch(/white/i);
    expect(whatsNew({ hue: 0, light: 0 }, { hue: 1, light: 0 })).toBeUndefined();
  });
});

import { createState } from '../src/economy/state';
import { deserialize, serialize } from '../src/economy/save';

describe('The line, saved', () => {
  it('keeps its looks and their history; mates met before looks were kept get theirs', () => {
    const state = createState(0);
    const c = state.stages.creature;
    c.genes = { hue: 12, light: 0.05, pattern: 'stripes' };
    c.line = [{ generation: 1, mate: 'Pell', mateGenes: { hue: 20, light: 0, pattern: 'stripes' }, before: { hue: 0, light: 0 }, genes: c.genes, parts: [], year: 3 }];
    c.mates = [{ id: 1, name: 'Old', parts: {} }];
    const back = deserialize(serialize(state)).stages.creature;
    expect(back.genes).toEqual(c.genes);
    expect(back.line?.[0].mate).toBe('Pell');
    expect(back.mates[0].genes).toBeDefined();
  });
});

import { breed, eggSeconds } from '../src/economy/creature';
import { tick } from '../src/economy/tick';

describe('Warm Brooding', () => {
  it('stacks, and speeds up the egg already in the nest', () => {
    const state = createState(0);
    state.started = true;
    state.unlocked.push('creature');
    state.current = 'creature';
    const c = state.stages.creature;
    const base = eggSeconds(state);
    c.levels = { brooding: 2 };
    expect(eggSeconds(state)).toBeCloseTo(base * 0.85 ** 2, 3);
    c.levels = {};
    c.mates = [{ id: 1, name: 'A', parts: {}, genes: { hue: 0, light: 0 } }];
    expect(breed(state, 1)).toBe(true);
    tick(state, 100);
    const done = 1 - c.egg!.left / c.egg!.total;
    c.levels = { brooding: 3 };
    tick(state, 0.001);
    // As far along as before, and the rest of it quicker.
    expect(1 - c.egg!.left / c.egg!.total).toBeCloseTo(done, 2);
    expect(c.egg!.total).toBeCloseTo(eggSeconds(state), 1);
  });
});
