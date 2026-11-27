// Balance check for DEAD//AIR: a bot plays N seeded seasons headless.
//   node dead-air/wip-pegwall/sim.js [runs] [contestant]
// It never gets cancelled, so every episode's score spread is visible next to its target.
const D = require('./game.js');
const RUNS = +process.argv[2] || 200, WHO = process.argv[3];
const DT = 1 / 120;

// Aim like a person would: pick the drop point with the most clear air under it.
function aim(g) {
  let best = 270, bestGap = -1;
  for (let k = 0; k < 14; k++) {
    const x = D.L + 30 + g.rand() * (D.R - D.L - 60);
    let gap = 999;
    for (const p of g.pegs) if (p.kind === 'dead' && !p.gone && Math.abs(p.x - x) < 45) gap = Math.min(gap, p.y);
    if (gap > bestGap) { bestGap = gap; best = x; }
  }
  return best;
}

const scores = Array.from({ length: D.EPISODES }, () => []);
const alive = new Array(D.EPISODES).fill(0);
let wins = 0, steps = 0, maxBalls = 0, longest = 0;
for (let r = 0; r < RUNS; r++) {
  const g = new D.Game(5000 + r, WHO);
  let ok = true;
  for (let e = 0; e < D.EPISODES; e++) {
    g.startEpisode();
    while (g.phase === 'aim') {
      g.drop(aim(g));
      const t0 = g.t;
      while (g.phase === 'drop') { g.step(DT); steps++; }
      g.events.length = 0;
      maxBalls = Math.max(maxBalls, g.last.peak); longest = Math.max(longest, g.t - t0);
      g.next();
    }
    scores[e].push(g.total);
    if (g.total < g.target(g.ep)) ok = false;
    if (ok) alive[e]++;
    // keep going even after a miss so later episodes still get measured
    g.bonus = g.total >= 2 * g.target(g.ep); g.phase = 'cleared';
    g.openDoors();
    while (g.phase === 'doors') g.pickDoor(g.pick(3));
  }
  if (ok) wins++;
}
const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * f)];
console.log(`runs ${RUNS}  season wins ${(100 * wins / RUNS).toFixed(1)}%  most balls at once ${maxBalls}  longest drop ${longest.toFixed(1)}s`);
for (let e = 0; e < D.EPISODES; e++)
  console.log(`ep${e + 1}  target ${String(D.TARGETS[e]).padStart(7)}  still on air ${String(alive[e]).padStart(4)}  score p25 ${String(q(scores[e], .25)).padStart(8)}  p50 ${String(q(scores[e], .5)).padStart(8)}  p75 ${String(q(scores[e], .75)).padStart(9)}`);
