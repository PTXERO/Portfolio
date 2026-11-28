// Balance check for DEAD//AIR: a bot plays N seeded seasons headless.
//   node tools/dead_air_sim.js [runs] [timing error ms] [contestant]            win rates against the targets
//   node tools/dead_air_sim.js [runs] [timing error ms] --potential             what a round is worth, target ignored
//
// The bot is modelled on how a practised person plays: it buzzes about once a second,
// takes whichever safe prize is coming rather than waiting for a favourite, uses slow-mo
// when the strip gets dangerous, and keeps going until the clock runs out.
const D = require('../dead-air/game.js');
const RUNS = +process.argv[2] || 300, ERR = (+process.argv[3] || 45) / 1000;
const POTENTIAL = process.argv.includes('--potential');
const WHO = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : undefined;
const DT = 1 / 60;

function gauss(g) { return Math.sqrt(-2 * Math.log(1 - g.rand())) * Math.cos(2 * Math.PI * g.rand()); }
const bad = (g, i) => i < 0 || i >= g.n ? false : !g.isUp(i);

function playRound(g) {
  while (g.phase === 'sweep' || g.phase === 'resolve') {
    if (g.phase === 'resolve') { g.step(DT); continue; }
    const up = g.upList(), need = g.target(g.ep) - g.total, pot = g.score();
    const N = g.n, dark = N - up.length, last = g.roundsLeft === 1;
    if (g.clock <= 0) { if (!g.bank()) g.endRound(g.score(), false); continue; }
    // Bank when the target is covered (unless measuring potential), or when almost nothing safe is left.
    const covered = !POTENTIAL && pot >= need;
    const tooHot = dark >= 9 + Math.min(2, g.bleeps) && !(last && pot < need && !POTENTIAL);
    if (g.buzzes > 0 && (covered || tooHot)) { g.bank(); continue; }
    if (dark >= 4) g.slowmo();
    // Wait for the light with the show running (drones, storms, rivals, bosses, moving formats), then aim at what is there.
    let wait = g.is('strobe') ? 0.5 + g.rand() * 2 : 0.6 + g.rand() * 0.9;
    while (wait > 0 && g.phase === 'sweep') { g.step(DT); wait -= DT; }
    if (g.phase !== 'sweep') continue;
    const now = g.upList(); if (!now.length) continue;
    // Take a prize with safe neighbours if there is one, otherwise whatever is left.
    const safe = now.filter(i => !bad(g, i - 1) && !bad(g, i + 1));
    const pool = safe.length ? safe : now;
    const best = pool[g.pick(pool.length)];
    // Hidden prizes and a jumping light are harder to time: a wider error, and sometimes the wrong podium.
    const hard = g.is('mystery') ? 1.5 : g.is('conveyor') ? 1.25 : 1;
    let hit = best + 0.5 + gauss(g) * ERR * hard * g.speed();
    if (g.is('strobe')) hit = g.rand() < 0.78 ? best + 0.2 + g.rand() * 0.6 : g.pick(N) + 0.5;
    g.u = Math.max(0.001, Math.min(N - 0.001, hit));
    g.buzz();
  }
}

const q = (a, f) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * f)] : 0;
const pad = (v, n) => String(v).padStart(n);
const rounds = Array.from({ length: D.EPISODES }, () => []), totals = Array.from({ length: D.EPISODES }, () => []);
const died = new Array(D.EPISODES).fill(0), reached = new Array(D.EPISODES).fill(0);
let wins = 0, kit = 0;

for (let r = 0; r < RUNS; r++) {
  const g = new D.Game(7000 + r, WHO);
  for (;;) {
    g.startEpisode(); reached[g.ep - 1]++;
    let over = false;
    for (;;) {
      playRound(g); g.events.length = 0;
      rounds[g.ep - 1].push(g.last.score);
      if (POTENTIAL) {                       // play every round out, whatever the target says
        if (g.roundsLeft <= 0) break;
        g.startRound(); continue;
      }
      g.next();
      if (g.phase === 'ask') g.answer(g.rand() < 0.5);
      if (g.phase === 'cleared' || g.phase === 'won' || g.phase === 'over') break;
    }
    totals[g.ep - 1].push(g.total);
    if (POTENTIAL) {
      if (g.ep >= D.EPISODES) break;
      g.spins += 1 + (g.total >= 2 * g.target(g.ep) ? 1 : 0) + g.format.spins;   // roughly what a clear would have paid
      g.phase = 'cleared';
    } else {
      if (g.phase === 'over') { died[g.ep - 1]++; break; }
      if (g.phase === 'won') { wins++; kit += Object.values(g.levels).reduce((a, b) => a + b, 0); break; }
    }
    g.openWheel(); g.takeOffer(g.pick(3));
    while (g.spins > 0) g.spin();
    g.wheelDone();
    if (g.phase === 'pick') { const lanes = [0, 1, 2].filter(l => g.canReach(l)); g.pickFormat(lanes[g.pick(lanes.length)]); }
    if (g.phase === 'event') g.answerEvent(g.rand() < 0.5);
    while (g.phase === 'wheel' && g.spins > 0) g.spin();
    g.wheelDone();
  }
}

if (POTENTIAL) {
  console.log(`runs ${RUNS}  timing error ${ERR * 1000}ms  POTENTIAL (target ignored, every round played out)`);
  for (let e = 0; e < D.EPISODES; e++)
    console.log(`ep${e + 1}  one round: p25 ${pad(q(rounds[e], .25), 6)}  median ${pad(q(rounds[e], .5), 6)}  p75 ${pad(q(rounds[e], .75), 7)}   whole episode: p25 ${pad(q(totals[e], .25), 6)}  median ${pad(q(totals[e], .5), 7)}`);
} else {
  console.log(`runs ${RUNS}  timing error ${ERR * 1000}ms  season wins ${(100 * wins / RUNS).toFixed(1)}%  gimmick levels at a win ${(kit / (wins || 1)).toFixed(1)}`);
  for (let e = 0; e < D.EPISODES; e++)
    console.log(`ep${e + 1}  target ${pad(D.TARGETS[e], 6)}  reached ${pad(reached[e], 4)}  cancelled ${pad(died[e], 4)}`);
}
