import { describe, expect, it } from 'vitest';
import { Biome, type Island } from '../src/economy/island';
import { findRoute } from '../src/economy/paths';
import { createState } from '../src/economy/state';
import { roadCost, roadVia, shoreOf, startShore, takeRaft, travelDays } from '../src/economy/shore';
import type { TribeState } from '../src/economy/types';

describe('Roads keep to the low ground', () => {
  it('a road goes round a ridge of peaks, not over it, and the rough way costs more', () => {
    const n = 90;
    const biome = new Uint8Array(n * n).fill(Biome.Grass);
    const height = new Float32Array(n * n).fill(0.2);
    // A wall of peaks down the middle, open at the bottom.
    for (let y = 0; y < 75; y++) for (let x = 42; x < 48; x++) {
      biome[y * n + x] = Biome.Peak;
      height[y * n + x] = 0.9;
    }
    const is = { seed: 1, n, biome, height, home: { x: 0, y: 0 }, places: {} } as Island;
    const r = findRoute(is, { x: 20, y: 20 }, { x: 70, y: 20 });
    expect(r.pts.every((p) => biome[Math.floor(p.y) * n + Math.floor(p.x)] !== Biome.Peak)).toBe(true);
    expect(Math.max(...r.pts.map((p) => p.y))).toBeGreaterThan(70);
    // Flat and open, the same distance costs far less.
    const flat = findRoute(is, { x: 20, y: 82 }, { x: 70, y: 82 });
    expect(flat.cost).toBeLessThan(r.cost / 2);
  });
});

describe('The road network', () => {
  it('a new road joins at the nearest place the roads already reach, and travel goes through it', () => {
    const state = createState(0);
    state.started = true;
    state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: {}, diet: 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 4242, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 777, day: 60 } } as unknown as TribeState;
    startShore(state);
    takeRaft(state);
    const s = shoreOf(state)!;
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    // Two villages, one on the way to the other.
    let pair: [typeof s.villages[0], typeof s.villages[0]] | null = null;
    for (const a of s.villages) for (const b of s.villages) if (a !== b && d(a, b) < d(s.hearth, b) * 0.5 && d(s.hearth, a) < d(s.hearth, b)) pair ??= [a, b];
    expect(pair).not.toBeNull();
    const [near, far] = pair!;
    for (const v of [near, far]) {
      v.found = true;
      v.settled = 0;
    }
    const before = travelDays(s, far);
    expect(roadVia(s, far)).toBe(-1);
    near.road = { done: 1, need: 1 };
    expect(roadVia(s, far)).toBe(near.id);
    expect(roadCost(s, far).via).toBe(near.id);
    // On foot from the end of the road beats the whole way on foot.
    expect(travelDays(s, far)).toBeLessThan(before);
    far.road = { done: 1, need: 1, via: near.id };
    expect(travelDays(s, far)).toBeLessThan(before * 0.6);
  });
});
