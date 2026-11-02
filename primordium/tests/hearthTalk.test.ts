import { describe, expect, it } from 'vitest';
import { pickTalk, type Speaker, type TalkCtx } from '../src/content/hearthTalk';

const ctx = (a: Speaker, b: Speaker, more: Partial<TalkCtx> = {}): TalkCtx => ({ a, b, heat: 0.5, season: 'Spring', critters: 20, food: '1K', rate: 50, won: 1, age: 1, foragers: 10, huts: 5, council: false, crossings: 0, ...more });
const sp = (name: string, age: Speaker['age'], temper: Speaker['temper'] = 'cheerful'): Speaker => ({ name, age, temper, crossed: false });

describe('Talk round the fire', () => {
  it('two little ones never talk about the food stores or the council', () => {
    for (let i = 0; i < 400; i++) {
      const t = pickTalk(ctx(sp('Pip', 'little'), sp('Oru', 'little'), { council: true, rate: 1e5, foragers: 50 }));
      const all = t.lines.join(' ');
      expect(all).not.toMatch(/elders bought|more food than we can eat|counted \d+ this morning|Where do I sleep/);
    }
  });
  it('a little one and an elder: the little one asks, the elder answers (whoever was picked first)', () => {
    let kidAsks = 0;
    for (let i = 0; i < 400; i++) {
      const t = pickTalk(ctx(sp('Grey', 'elder', 'wise'), sp('Pip', 'little')));
      if (t.lines[0] === 'Were you ever little?') {
        kidAsks++;
        expect(t.first).toBe(1);
      }
    }
    expect(kidAsks).toBeGreaterThan(0);
  });
  it('tempers show: a grumpy one grumbles', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickTalk(ctx(sp('Grum', 'grown', 'grumpy'), sp('Sun', 'grown', 'cheerful'))).lines[0]);
    expect([...seen].some((l) => /Too loud|Too many of us|always smiling/.test(l))).toBe(true);
  });
});
