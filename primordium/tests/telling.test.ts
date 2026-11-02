import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { record, recordName } from '../src/economy/chronicle';
import { cross, shoreOf, startShore, takeRaft } from '../src/economy/shore';
import { setVillageView, shoreLayout } from '../src/ui/shorePanels';
import type { TribeState } from '../src/economy/types';

function shore() {
  const state = createState(0);
  state.started = true;
  state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet: 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 } } as unknown as TribeState;
  startShore(state);
  takeRaft(state);
  record(state, 'The Soup was long ago.', 'soup', '1 min');
  return { state, s: shoreOf(state)! };
}
const tell = (state: ReturnType<typeof createState>) => {
  setVillageView('story');
  return shoreLayout(state, 'chronicle');
};

describe('The telling', () => {
  it('told exactly while it\'s recent; counted, not named, some seasons on; only the big things, as legend, long after', () => {
    const { state, s } = shore();
    s.day = 2;
    record(state, 'Pip was born: the first born on the new shore.', 'shore', 'Year 1, Spring');
    recordName(state, 'born', 'Oru', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    recordName(state, 'born', 'Feln', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    record(state, 'They brought the Mire clan gifts of food for the first time.', 'shore', 'Year 1, Spring');
    s.day = 10;
    let t = tell(state);
    expect(t).toContain('The telling');
    expect(t).toContain('Oru and Feln were born.');
    expect(t).toContain('Year 1, Spring');
    s.day = 40;
    t = tell(state);
    expect(t).toContain('Some seasons ago');
    expect(t).toContain('Two were born.');
    expect(t).not.toContain('Oru');
    s.day = 200;
    t = tell(state);
    expect(t).toContain('In the first years');
    expect(t).toContain('The first child was born on the new shore.');
    expect(t).not.toContain('gifts of food for the first time');
    expect(t).toContain('What the spear remembers');
    expect(t).toContain('The Soup was long ago.');
  });
  it('once they write, it stays as it was', () => {
    const { state, s } = shore();
    s.day = 5;
    s.writtenFrom = 0;
    recordName(state, 'born', 'Oru', '{names} was born.', '{names} were born.', 'shore', 'Year 1, Spring');
    s.day = 300;
    const t = tell(state);
    expect(t).toContain('The record');
    expect(t).toContain('Oru was born.');
  });
  it('an island left behind is legend: before the crossing', () => {
    const { state, s } = shore();
    s.day = 3;
    record(state, 'Ka became chief.', 'shore', 'Year 1, Spring');
    for (const v of s.villages) v.won = s.day;
    while (s.people.length < 8) s.people.push({ id: s.nextId++, name: `P${s.people.length}`, born: -60 });
    expect(cross(state)).toBe(true);
    const t = tell(state);
    expect(t).toContain('Before the crossing');
    expect(t).toContain('A new chief was chosen.');
    expect(t).toContain('Some of them set out for a new island. The rest stayed.');
    expect(t).not.toContain('Ka became chief');
  });
});
