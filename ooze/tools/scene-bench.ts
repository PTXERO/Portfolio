// The New Shore map's own work each frame (not the GPU's) with a big village on screen:
// npx tsx tools/scene-bench.ts
// The canvas is stood in for (every call a no-op), so what's timed is the scene's own logic.
export {};
const noop = () => undefined;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w, height: h }) : k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern' ? () => ({ addColorStop: noop }) : k === 'measureText' ? () => ({ width: 5 }) : noop),
  set: () => true,
});
const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx, toDataURL: () => '' });
(globalThis as Record<string, unknown>).document = { createElement: canvas };
(globalThis as Record<string, unknown>).localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
(globalThis as Record<string, unknown>).window = globalThis;

const { createState } = await import('../src/economy/state');
const { shoreOf, startShore, takeRaft, shoreIsland } = await import('../src/economy/shore');
const { ShoreScene } = await import('../src/scene/shore');
const state = createState(0);
state.started = true;
state.unlocked.push('creature', 'tribal', 'shore');
state.current = 'shore';
state.stages.tribal.tribe = { awake: true, pop: 4, survivors: 4, look: { parts: { legs: 'hooves' }, diet: 'grazer' }, stats: {}, generations: 3, heritage: 1, seed: 1234, year: 0, family: [{ name: 'Ka', trait: 'hardy' }, { name: 'Ri', trait: 'keen' }, { name: 'Mo', trait: 'old' }, { name: 'Tu', trait: 'young' }], landed: { seed: 3703, day: 60 } } as never;
startShore(state);
takeRaft(state);
const s = shoreOf(state)!;
shoreIsland(s.seed);
s.built.push({ id: 'hearth', x: s.hearth.x, y: s.hearth.y, day: 0 } as never);
for (let i = 0; i < 400; i++) {
  const a = i * 2.4;
  const r = 4 + Math.sqrt(i) * 2.2;
  s.built.push({ id: i % 3 ? 'hut' : 'rack', x: s.hearth.x + Math.cos(a) * r, y: s.hearth.y + Math.sin(a) * r * 0.8, day: 0 } as never);
}
for (let i = 0; i < 1200; i++) s.people.push({ id: 5000 + i, name: 'C' + i, born: s.day - 40, dies: s.day + 900 });
// Everything seen (so nothing's skipped for the fog).
state.stages.shore.seen.fill(1);
const scene = new ShoreScene();
scene.shaded = true;
const frame = (t: number) => ({ b: ctx as CanvasRenderingContext2D, W: 390, H: 600, t, dt: 1 / 60, top: 0, bottom: 0 });
// (Warm up: the seasons' ground painted, everyone spread out from the hearth.)
for (let i = 0; i < 1200; i++) scene.draw(frame(i / 60), state);
for (const zoom of [3, 8]) {
  (scene as unknown as { zoom: number; auto: boolean }).zoom = zoom;
  (scene as unknown as { auto: boolean }).auto = false;
  const t0 = performance.now();
  const N = 300;
  for (let i = 0; i < N; i++) scene.draw(frame(20 + i / 60), state);
  console.log(`zoom ${zoom}: ${((performance.now() - t0) / N).toFixed(2)} ms a frame (scene logic, 1200 critters, 400 buildings)`);
}
