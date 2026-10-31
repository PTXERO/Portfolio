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
