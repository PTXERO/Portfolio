import { describe, expect, it } from 'vitest';
import { borrow, hear, newLanguage, shiftSounds, speak, syllables } from '../src/economy/language';

describe('Their tongue', () => {
  it('says a line in its own words and order, the same way every time; names kept', () => {
    const lang = newLanguage(1234, 'grazer');
    const a = speak(lang, 'Can I feed the fire?', new Set(['Pip']));
    const b = speak(lang, 'Can I feed the fire?', new Set(['Pip']));
    expect(a.text).toBe(b.text);
    expect(a.text).not.toMatch(/fire|feed/i);
    const c = speak(lang, 'Pip, the fire is big.', new Set(['Pip']));
    expect(c.text.startsWith('Pip')).toBe(true);
    // (The same meaning, the same word.)
    expect(c.said.find((x) => x.meaning === 'fire')!.word).toBe(a.said.find((x) => x.meaning === 'fire')!.word);
    // (Many, and past, marked.)
    const d = speak(lang, 'The children ate the fish.', new Set());
    expect(d.said.some((x) => x.meaning === 'child (many)')).toBe(true);
    expect(d.said.some((x) => x.meaning === 'eat (past)')).toBe(true);
  });
  it('grammar differs between tongues: a subject-object-verb one puts the verb last', () => {
    let seed = 1;
    let lang = newLanguage(seed, 'hunter');
    while (lang.order !== 'SOV') lang = newLanguage(++seed, 'hunter');
    const s = speak(lang, 'They eat fish.', new Set());
    expect(s.said[s.said.length - 1].meaning).toBe('eat');
  });
  it('heard words are counted, with when; the sounds shift a year on, the old forms kept; villages lend words', () => {
    const lang = newLanguage(77, 'omnivore');
    const s = speak(lang, 'The fire is cold.', new Set());
    hear(lang, s.said, 'grown · the fire low · winter');
    expect(lang.heard.fire).toBe(1);
    expect(lang.ctx.fire[0]).toContain('winter');
    let shifted = 0;
    for (let y = 1; y < 12; y++) if (shiftSounds(lang, y)) shifted++;
    expect(shifted).toBeGreaterThan(0);
    expect(Object.keys(lang.was).length).toBeGreaterThan(0);
    const took = borrow(lang, 'the Reed clan', 999, 'grazer', ['fish']);
    expect(took).toHaveLength(1);
    expect(lang.from.fish).toBe('the Reed clan');
    expect(syllables('molawen').length).toBeGreaterThan(1);
  });
});
