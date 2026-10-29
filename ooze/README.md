# Ooze to Orbit (working title)

An idle creature-evolution game for iPhone. The design doc lives in Claude Docs; this folder is the code.

**Status: M2 in progress.** Soup (about 1 hour), Cell (about 2½ hours) and Creature (about 4 to 6 hours) are playable from start to end, with the pixel-art scene and interface. Sprites are placeholders in the final palette.

## Commands

```sh
npm install
npm run dev        # dev server, also reachable from a phone on the same Wi-Fi (--host)
npm test           # unit tests
npm run sim        # balance simulator: time per stage for four player types
npm run build      # type-check and build to dist/
```

## Layout

- `src/economy/`: state, rates, actions, tick, offline progress, saves. Pure logic, no DOM.
- `src/content/stages.ts` (and `creature.ts`): every stage, generator, upgrade, part and place as data. Balancing means editing these and rerunning `npm run sim`.
- `src/economy/creature.ts`: the Creature stage's own rules (stats, expeditions, breeding).
- `src/art/sprites.ts`: every sprite as a grid of palette letters. Replace the grids with real art; names and sizes are free.
- `src/scene/`: the diorama. Draws the state into a small pixel buffer and scales it up. Never changes the economy: the Cell pond (`pond.ts`) reports what your cell ate, engulfed or drove off as events, and `main.ts` applies them.
- `src/ui/`: tab panels and the interface stylesheet (pixel boxes and buttons).
- `src/main.ts`: wires the screen together: scene in the middle (tap to stir the Soup, or steer your cell), tabs below.
- `tools/sim.ts`: the balance simulator.
- `tests/`: unit tests.

## Rules the code follows

- The economy never reads anything from the screen. Rendering only reads state.
- Offline progress is the same `tick` as live play, run in larger steps. 80% of time away is applied; 20% goes to the time bank (capped at a quarter of the offline cap).
- Finished stages keep producing and buy for themselves (automation), and feed the next stage a multiplier.
- Big numbers use break_infinity.js everywhere.
