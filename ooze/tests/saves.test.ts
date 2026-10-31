// Saves from every part of the game, exported and imported (and stored and loaded): nothing that
// matters lost. The only differences allowed are the ones meant: numbers to four places, the
// news not yet shown trimmed, and (once ashore) the Extinction's long log trimmed.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createState } from '../src/economy/state';
import { deserialize, exportPlain, exportSave, importSave, serialize } from '../src/economy/save';
import { tick } from '../src/economy/tick';
import { DAY_SEC as EX_DAY, extinctionTick, launch, startExtinction } from '../src/economy/extinction';
import { answerJoin, build, gift, shoreOf, shoreTick, startShore, takeRaft } from '../src/economy/shore';
import { sendBand, setWarRule } from '../src/economy/war';
import type { GameState, TribeState } from '../src/economy/types';
import { unpackSeen } from '../src/economy/island';
import { SHORE_CELLS } from '../src/economy/shore';

/** Every difference between two saves, as paths (with what was, what is). */
function diffs(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length > 40) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-4 * Math.max(1, Math.abs(a))) out.push(`${path}: ${a} → ${b}`);
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b && !(a === undefined && b === undefined)) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 60)} → ${JSON.stringify(b)?.slice(0, 60)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  for (const k of keys) {
    const x = (a as Record<string, unknown>)[k];
    const y = (b as Record<string, unknown>)[k];
    if (x === undefined && y === undefined) continue;
    diffs(x, y, `${path}.${k}`, out);
  }
  return out;
}

/** What may differ by design (trimmed transient lists). */
const MEANT = [/\.shore\.news(\.|$)/, /\.tribe\.ex\.log(\.|$)/, /\.tribe\.ex\.logN$/, /^\.made(\.|$)/, /^\.news(\.|$)/, /^\.swirl$/];

/** A save's explored maps as the cells seen (the same land, however big the packed map). */
function maps(save: { stages: Record<string, { seen?: string }> }) {
  for (const [id, st] of Object.entries(save.stages)) {
    if (!st.seen) continue;
    const bits = unpackSeen(st.seen, id === 'shore' ? SHORE_CELLS : undefined);
    const on: number[] = [];
    bits.forEach((b, i) => b && on.push(i));
    st.seen = on.join(',') as never;
  }
  return save;
}

/** Saved and loaded both ways (as a code, and as the old plain code): only what's meant differs. */
function roundTrip(name: string, state: GameState): void {
  const before = maps(JSON.parse(serialize(state)));
  for (const [how, back] of [
    ['code', importSave(exportSave(state))],
    ['old code', importSave(exportPlain(state))],
    ['plain', deserialize(serialize(state))],
  ] as const) {
    const after = maps(JSON.parse(serialize(back)));
    const lost = diffs(before, after).filter((d) => !MEANT.some((m) => m.test(d.split(':')[0])));
    expect(lost, `${name} (${how}) lost: \n${lost.join('\n')}`).toEqual([]);
  }
}

function shoreGame(diet = 'grazer'): GameState {
  const state = createState(0);
  state.started = true;
  state.unlocked.push('cell', 'creature', 'tribal', 'shore');
  state.current = 'shore';
  state.stages.creature.genes = { hue: 12, light: -0.05, pattern: 'stripes', morph: 'piebald' };
  state.stages.creature.line = [{ generation: 1, mate: 'Pell', mateGenes: { hue: 30, light: 0, pattern: 'stripes' }, before: { hue: 0, light: 0 }, genes: state.stages.creature.genes, parts: ['jaws'], year: 3 }];
  state.stages.tribal.tribe = {
    awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet, genes: state.stages.creature.genes }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0,
    family: [{ name: 'Ka', trait: 'hardy', genes: { hue: 10, light: 0, pattern: 'stripes' } }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 },
  } as unknown as TribeState;
  startShore(state);
  return state;
}

describe('Saves keep everything', () => {
  it('a new game', () => roundTrip('new game', createState(0)));

  it('the Soup, a while in', () => {
    const s = createState(0);
    s.started = true;
    for (let i = 0; i < 600; i++) tick(s, 1);
    roundTrip('soup', s);
  });

  it('the shipped Creature save (late Creature, mates, parts, a herd)', () => {
    const s = importSave(readFileSync('public/creature-start.txt', 'utf8').trim());
    s.stages.creature.genes = { hue: -20, light: 0.1, pattern: 'spots', morph: 'albino' };
    s.stages.creature.mates = [{ id: 7, name: 'Pell', parts: { legs: 'runner' }, genes: { hue: 30, light: 0, pattern: 'mask' } }];
    for (let i = 0; i < 300; i++) tick(s, 1);
    roundTrip('creature', s);
  });

  it('the Extinction, days in, people with bonds and jobs', () => {
    const s = createState(0);
    s.unlocked.push('tribal');
    s.current = 'tribal';
    s.stages.tribal.tribe = { awake: true, pop: 60, survivors: 60, look: { parts: {}, diet: 'omnivore', genes: { hue: 5, light: 0, pattern: 'saddle' } }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
    startExtinction(s);
    const ex = s.stages.tribal.tribe!.ex!;
    ex.auto = true;
    for (let d = 0; d < 12 && !ex.over; d++) extinctionTick(s, EX_DAY);
    roundTrip('extinction', s);
  });

  it('New Shore early: the raft, the hearth, the first huts', () => {
    const s = shoreGame();
    takeRaft(s);
    shoreTick(s, 600);
    roundTrip('shore early', s);
  });

  it('New Shore late: a big village, joined clans, the dead, raids, culture, a war band out, a fight', () => {
    const s = shoreGame('hunter');
    const sh = shoreOf(s)!;
    takeRaft(s);
    for (const id of ['hearth', 'hut', 'council', 'envoy', 'scout', 'watch', 'warcamp'] as const) {
      sh.wood = 1e3;
      build(s, id);
      if (sh.building) sh.building.left = 0;
      shoreTick(s, 0.01);
    }
    for (let t = 0; t < 5 * 3600; t += 60) {
      shoreTick(s, 60);
      for (const v of sh.villages) if (v.asking !== undefined) answerJoin(s, v.id, 'crowd');
      for (const v of sh.villages) if (v.found) gift(s, v.id);
    }
    setWarRule(sh, 'weaker');
    const prey = sh.villages.find((v) => !v.joined && !v.gone && !v.vassal);
    if (prey) {
      prey.found = true;
      sendBand(s, sh, prey.id, 4);
    }
    sh.culture ??= { since: sh.day, age: 1, practice: { food: 50 }, done: ['dried'], forks: {}, focus: 'food' };
    expect(sh.people.length).toBeGreaterThan(20);
    expect(sh.dead?.length ?? 0).toBeGreaterThan(0);
    roundTrip('shore late', s);
    // And what matters, by name: nothing lost.
    const back = shoreOf(importSave(exportSave(s)))!;
    expect(back.people.map((p) => [p.id, p.name, p.parents, p.genes])).toEqual(sh.people.map((p) => [p.id, p.name, p.parents, p.genes]));
    expect(back.dead?.length).toBe(sh.dead?.length);
    expect(back.villages.map((v) => [v.id, v.joined, v.vassal, v.trust])).toEqual(sh.villages.map((v) => [v.id, v.joined, v.vassal, v.trust]));
    expect(back.built.length).toBe(sh.built.length);
    expect([back.culture?.age, back.culture?.done, back.culture?.forks, back.culture?.focus]).toEqual([sh.culture?.age, sh.culture?.done, sh.culture?.forks, sh.culture?.focus]);
    for (const [k, v] of Object.entries(sh.culture!.practice)) expect(back.culture!.practice[k as never]).toBeCloseTo(v!, 3);
    expect(back.warband?.to).toBe(sh.warband?.to);
  });

  it('ashore, the Extinction behind them: the family, the line and the escape kept', () => {
    const s = createState(0);
    s.unlocked.push('tribal');
    s.current = 'tribal';
    s.stages.creature.genes = { hue: 15, light: 0, pattern: 'socks' };
    s.stages.tribal.tribe = { awake: true, pop: 40, survivors: 40, look: { parts: {}, diet: 'grazer', genes: s.stages.creature.genes }, stats: { speed: 10, strength: 10, senses: 10, toughness: 10, charm: 10 }, generations: 6, heritage: 1.5, seed: 1234, year: 0 };
    startExtinction(s);
    const ex = s.stages.tribal.tribe!.ex!;
    ex.auto = true;
    for (let d = 0; d < 5; d++) extinctionTick(s, EX_DAY);
    ex.raft = { frame: 30, lashing: 20, hull: 20 } as never;
    ex.family = ex.people.slice(0, 4).map((p) => p.id);
    launch(s);
    roundTrip('after the escape', s);
  });
});
