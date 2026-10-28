# Ooze to Orbit (working title)

An idle creature-evolution game for iPhone. The design doc lives in Claude Docs; this folder is the code.

**Status: M1, economy core.** The page is a plain numbers-and-buttons test of the economy (Soup and Cell). Art and the diorama come in M2.

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
- `src/content/stages.ts`: every stage, generator and upgrade as data. Balancing means editing this file and rerunning `npm run sim`.
- `src/main.ts`: the M1 test page.
- `tools/sim.ts`: the balance simulator.
- `tests/`: unit tests.

## Rules the code follows

- The economy never reads anything from the screen. Rendering only reads state.
- Offline progress is the same `tick` as live play, run in larger steps. 80% of time away is applied; 20% goes to the time bank (capped at a quarter of the offline cap).
- Finished stages keep producing and buy for themselves (automation), and feed the next stage a multiplier.
- Big numbers use break_infinity.js everywhere.
