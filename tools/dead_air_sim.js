// Balance check for DEAD//AIR: a bot plays N seeded seasons headless.
//   node tools/dead_air_sim.js [runs] [timing error in ms] [contestant]
// The bot aims for the best prize and misses by a human-sized timing error.
const D = require('../dead-air/game.js');
const RUNS = +process.argv[2] || 300, ERR = (+process.argv[3] || 45) / 1000, WHO = process.argv[4];
const DT = 1 / 60, N = D.N;

function gauss(g) { return Math.sqrt(-2 * Math.log(1 - g.rand())) * Math.cos(2 * Math.PI * g.rand()); }
const worth = p => p.kind === 'gold' ? p.val * 5 : p.kind === 'cash' ? p.val : p.kind === 'spin' ? 60 : p.kind === 'box' ? 70 : 45;
const bad = (g, i) => i < 0 || i >= N ? false : !g.isUp(i);

function playRound(g) {
  while (g.phase === 'sweep' || g.phase === 'resolve') {
    if (g.phase === 'resolve') { g.step(DT); continue; }
    const up = g.upList(), need = g.target(g.ep) - g.total, pot = g.score();
    const dark = N - up.length;
    const last = g.roundsLeft === 1;
    // Bank once the strip is mostly burnt out or the target is covered, unless it is now or never.
    if (g.buzzes > 0 && (pot >= need || (!(last && pot < need) && dark >= 6 + Math.min(2, g.bleeps)))) { g.bank(); continue; }
    // Prefer valuable prizes whose neighbours are safe.
    let best = up[0], bestS = -1e9;
    for (const i of up) { const s = worth(g.strip[i]) - (bad(g, i - 1) ? 25 : 0) - (bad(g, i + 1) ? 25 : 0); if (s > bestS) { bestS = s; best = i; } }
    if (dark >= 3) g.slowmo();
    // Hidden prizes and a jumping light are harder to time: a wider error, and sometimes the wrong podium.
    const hard = g.is('mystery') ? 1.5 : g.is('conveyor') ? 1.25 : 1;
    let hit = best + 0.5 + gauss(g) * ERR * hard * g.speed();
    if (g.is('strobe')) hit = g.rand() < 0.78 ? best + 0.2 + g.rand() * 0.6 : g.pick(N) + 0.5;
    g.u = Math.max(0.001, Math.min(N - 0.001, hit));
    g.buzz();
  }
}

const scores = Array.from({ length: D.EPISODES }, () => []);
const died = new Array(D.EPISODES).fill(0), reached = new Array(D.EPISODES).fill(0);
let wins = 0, kit = 0;
for (let r = 0; r < RUNS; r++) {
  const g = new D.Game(7000 + r, WHO);
  for (;;) {
    g.startEpisode(); reached[g.ep - 1]++;
    while (g.phase !== 'cleared' && g.phase !== 'won' && g.phase !== 'over') { playRound(g); g.events.length = 0; g.next(); }
    scores[g.ep - 1].push(g.total);
    if (g.phase === 'over') { died[g.ep - 1]++; break; }
    if (g.phase === 'won') { wins++; kit += Object.values(g.levels).reduce((a, b) => a + b, 0); break; }
    g.openWheel(); g.takeOffer(g.pick(3));
    while (g.spins > 0) g.spin();
    g.wheelDone(); g.pickFormat(g.pick(2));
  }
}
const q = (a, f) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * f)] : 0;
console.log(`runs ${RUNS}  timing error ${ERR * 1000}ms  season wins ${(100 * wins / RUNS).toFixed(1)}%  gimmick levels at a win ${(kit / (wins || 1)).toFixed(1)}`);
for (let e = 0; e < D.EPISODES; e++)
  console.log(`ep${e + 1}  target ${String(D.TARGETS[e]).padStart(6)}  reached ${String(reached[e]).padStart(4)}  cancelled ${String(died[e]).padStart(4)}  score p25 ${String(q(scores[e], .25)).padStart(6)}  p50 ${String(q(scores[e], .5)).padStart(6)}  p75 ${String(q(scores[e], .75)).padStart(7)}`);
