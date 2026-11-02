import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { gathered, nameList, record, recordName } from '../src/economy/chronicle';

describe('The Chronicle', () => {
  it('names in a list, in words', () => {
    expect(nameList(['Ka'])).toBe('Ka');
    expect(nameList(['Ka', 'Ri'])).toBe('Ka and Ri');
    expect(nameList(['Ka', 'Ri', 'Mo'])).toBe('Ka, Ri and Mo');
    expect(nameList(['A', 'B', 'C', 'D', 'E'], 3)).toBe('A, B and 3 more');
  });
  it('everyone born in a season goes on one line, and so does everyone who died of old age', () => {
    const state = createState(0);
    recordName(state, 'born', 'Ka', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    recordName(state, 'born', 'Ri', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    recordName(state, 'old', 'Mo', '{names} died of old age.', '{names} died of old age.', 'shore', 'Year 1, Spring');
    recordName(state, 'born', 'Tu', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    record(state, 'Something else happened.', 'shore', 'Year 1, Spring');
    recordName(state, 'old', 'Pa', '{names} died of old age.', '{names} died of old age.', 'shore', 'Year 1, Spring');
    recordName(state, 'born', 'Zo', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Summer');
    expect(state.chronicle!.map((e) => e.text)).toEqual(['Ka, Ri and Tu were born.', 'Mo and Pa died of old age.', 'Something else happened.', 'Zo was born.']);
  });
  it('older saves\' one-a-line births and deaths are shown gathered', () => {
    expect(gathered(['Ka was born to Mo.', 'Ri was born to Tu.', 'Old One died of old age.', 'Bo died of old age.', 'Pip was born black all over, like none before.', 'Zo was born to Ka.', 'Lu died of old age.'])).toEqual([
      'Ka, Ri and Zo were born.',
      'Old One died of old age.',
      'Bo and Lu died of old age.',
      'Pip was born black all over, like none before.',
    ]);
  });
});
