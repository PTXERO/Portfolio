// Balance check for DEAD//AIR: a careful bot plays N seeded runs.
//   node tools/dead_air_sim.js [runs] [riskThreshold]
const D = require('../dead-air/game.js');
const RUNS = +process.argv[2] || 200, THR = +process.argv[3] || 0.18;

// Chance each hidden panel is dead air, by counting every layout that fits the numbers.
function odds(g) {
  const s = g.seg, hidden = [], need = new Array(D.N).fill(-1);
  let dead = g.deadCount();
  for (let i = 0; i < D.N; i++) {
    if (s.known[i] || (s.shown[i] && s.panels[i].t === 'dead')) dead--;
    else if (!s.shown[i]) hidden.push(i);
  }
  for (let i = 0; i < D.N; i++) if (s.shown[i] && s.panels[i].t !== 'dead') {
    need[i] = s.hint[i] - D.NB[i].filter(j => s.known[j]).length;
  }
  const count = new Array(D.N).fill(0); let total = 0; const pick = [];
  (function rec(k, left) {
    if (left === 0) {
      for (let i = 0; i < D.N; i++) if (need[i] > 0) return;
      total++; pick.forEach(j => count[j]++); return;
    }
    if (hidden.length - k < left) return;
    const j = hidden[k];
    let ok = true;
    for (const n of D.NB[j]) if (need[n] === 0) { ok = false; break; }
    if (ok) {
      for (const n of D.NB[j]) if (need[n] > 0) need[n]--;
      pick.push(j); rec(k + 1, left - 1); pick.pop();
      for (const n of D.NB[j]) if (need[n] >= 0) need[n]++;
    }
    rec(k + 1, left);
  })(0, dead);
  return hidden.map(j => ({ j, p: total ? count[j] / total : 1 }));
}

function playSegment(g) {
  ['mic', 'stunt', 'cue', 'intern'].forEach(id => { const k = g.lifelines.indexOf(id); if (k >= 0) g.useLifeline(k); });
  while (g.phase === 'play' && !g.seg.done) {
    const s = g.seg, e = g.episode;
    if (s.flips === 0) { g.flip(g.pick(D.N)); continue; }
    const o = odds(g).sort((a, b) => a.p - b.p)[0];
    const pot = g.score(false).score, need = e.target - e.total;
    const mustPush = e.segsLeft === 1 && pot < need;
    if (o.p === 0 || mustPush || (pot < need && o.p < THR)) g.flip(o.j);
    else g.bank();
  }
}

function shop(g) {
  g.openDoors();
  const want = ['sponsor', 'upgrade', 'lifeline', 'cash'];
  g.pickDoor(g.doors.map((d, i) => [want.indexOf(d.kind), i]).sort((x, y) => x[0] - y[0])[0][1]);
  for (let pass = 0; pass < 2; pass++) {
    g.shop.items.forEach((it, i) => { if (g.canBuy(it)) g.buy(i); });
    if (pass === 0 && g.money >= g.shop.reroll + 5) g.reroll();
  }
}

const died = new Array(D.EPISODES + 1).fill(0), ratio = new Array(D.EPISODES).fill(0), reached = new Array(D.EPISODES).fill(0);
let wins = 0;
for (let r = 0; r < RUNS; r++) {
  const g = new D.Game(1000 + r, process.argv[4]);
  while (true) {
    g.startEpisode();
    while (g.phase === 'play') { playSegment(g); g.nextSegment(); }
    reached[g.ep - 1]++; ratio[g.ep - 1] += g.episode.total / g.episode.target;
    if (g.phase === 'won') { wins++; break; }
    if (g.phase === 'over') { died[g.ep]++; break; }
    shop(g);
  }
}
console.log(`runs ${RUNS}  risk ${THR}  wins ${(100 * wins / RUNS).toFixed(1)}%`);
for (let e = 0; e < D.EPISODES; e++)
  console.log(`ep${e + 1}  target ${String(D.TARGETS[e]).padStart(6)}  reached ${String(reached[e]).padStart(4)}  cancelled ${String(died[e + 1]).padStart(4)}  avg score/target ${(ratio[e] / (reached[e] || 1)).toFixed(2)}`);
