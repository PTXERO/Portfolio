import { describe, expect, it } from 'vitest';
import { borrow, grammarOf, hear, newLanguage, say, shiftSounds, syllables, talk, talkUnheard, wordOf, type Speaker } from '../src/economy/language';

const folk: Speaker[] = Array.from({ length: 24 }, (_, i) => ({ age: (['little', 'youngster', 'grown', 'elder'] as const)[i % 4], temper: ['bold', 'cheerful', 'grumpy', 'curious', 'dreamy', 'greedy'][i % 6] }));
const sit = { heat: 0.4, season: 0, night: false, rain: false, plenty: true, age: 1, won: 1, streak: false, crossed: false };

describe('Their tongue, made by them', () => {
  it('starts with no words at all; words are made when first needed, and kept', () => {
    const lang = newLanguage(1234, 'grazer');
    expect(Object.keys(lang.lex)).toHaveLength(0);
    const a = say(lang, { thing: 'fire', quality: 'big' }, folk[2], 1, 7);
    expect(a.said.map((x) => x.meaning)).toEqual(expect.arrayContaining(['fire', 'big']));
    expect(wordOf(lang, 'fire')).toBeTruthy();
    const b = say(lang, { thing: 'fire' }, folk[2], 1, 8);
    expect(b.said[0].word).toBe(wordOf(lang, 'fire'));
  });
  it('talk among them settles the words and the order: rivals fade, one way of putting it wins', () => {
    const lang = newLanguage(4242, 'hunter');
    for (let d = 1; d <= 3; d++) talkUnheard(lang, d, sit, folk);
    const early = grammarOf(lang).orderSure;
    for (let d = 4; d <= 80; d++) talkUnheard(lang, d, { ...sit, season: Math.floor(d / 4) % 4 }, folk);
    const g = grammarOf(lang);
    expect(g.orderSure).toBeGreaterThan(0.8);
    expect(g.orderSure).toBeGreaterThan(early);
    const rivals = Object.values(lang.lex).filter((v) => v.length > 1).length;
    expect(rivals).toBeLessThan(Object.keys(lang.lex).length / 3);
    // (No two things share a word made up for them.)
    const firsts = Object.values(lang.lex).map((v) => v[0].f);
    expect(new Set(firsts).size).toBeGreaterThan(firsts.length * 0.9);
  });
  it('something new is named out of words they have', () => {
    const lang = newLanguage(77, 'omnivore');
    say(lang, { thing: 'fire', quality: 'hard' }, folk[2], 1, 3);
    const bronze = say(lang, { thing: 'bronze' }, folk[2], 2, 4).said[0].word;
    expect(bronze.startsWith(syllables(wordOf(lang, 'fire')!)[0])).toBe(true);
  });
  it('talks come from what\'s going on and who\'s talking: a light in the sky gets talked about', () => {
    let r = 0.3;
    const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    const seen = new Set<string>();
    for (let k = 0; k < 60; k++) for (const t of talk({ ...sit, streak: true }, { ...folk[2], name: 'A' }, { ...folk[0], name: 'B' }, rnd)) if (t.thing) seen.add(t.thing);
    expect(seen.has('light')).toBe(true);
  });
  it('heard words are counted, with when; the sounds shift a year on; villages lend words that compete', () => {
    const lang = newLanguage(77, 'omnivore');
    for (let d = 1; d <= 10; d++) talkUnheard(lang, d, sit, folk);
    const s = say(lang, { thing: 'fire', quality: 'cold' }, folk[2], 11, 5);
    hear(lang, s.said, 'grown · the fire low · winter');
    expect(lang.heard.fire).toBe(1);
    expect(lang.ctx.fire[0]).toContain('winter');
    let shifted = 0;
    for (let y = 1; y < 15; y++) if (shiftSounds(lang, y)) shifted++;
    expect(shifted).toBeGreaterThan(0);
    const took = borrow(lang, 'the Reed clan', 999, 'grazer', ['fish'], 12);
    expect(took).toHaveLength(1);
    expect(lang.lex.fish.length).toBeGreaterThan(1);
    expect(lang.from.fish).toBe('the Reed clan');
  });
});
