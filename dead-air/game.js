// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine: rules and timing, no drawing.
//  index.html renders this state and turns g.events into effects.
//  tools/dead_air_sim.js runs it headless to check the difficulty.
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const N = 12;                 // prize podiums on the strip
  const EPISODES = 8;
  const TARGETS = [150, 400, 900, 1700, 3000, 5000, 8000, 13000];

  // Every gimmick is something you can see on the set. d(lv) = what it does at that level.
  const GIMMICKS = [
    { id: 'twin',   tag: 'TW', color: '#42d4f5', max: 3, name: 'TWIN SPOTS',      d: l => `${l} extra spotlight${l > 1 ? 's' : ''} sweep the strip and win whatever they stop on.` },
    { id: 'mirror', tag: 'MB', color: '#d8d8e0', max: 5, name: 'MIRROR BALL',     d: l => `Every buzz, the mirror ball throws ${l} stray beam${l > 1 ? 's' : ''} onto random prizes.` },
    { id: 'pyro',   tag: 'PY', color: '#ff9a2e', max: 4, name: 'PYROTECHNICS',    d: l => `A PERFECT stop fires flame jets that win ${l} prize${l > 1 ? 's' : ''} on each side.` },
    { id: 'wire',   tag: 'ZP', color: '#fff36b', max: 5, name: 'LIVE WIRE',       d: l => `Your prize arcs lightning to ${l} more of the same kind.` },
    { id: 'laser',  tag: 'LZ', color: '#f542a8', max: 4, name: 'LASER SHOW',      d: l => `Every 3rd buzz, a laser sweeps in and wins the first ${l + 1} prizes it crosses.` },
    { id: 'drone',  tag: 'DR', color: '#9d8cff', max: 4, name: 'CAMERA DRONE',    d: l => `${l} drone${l > 1 ? 's' : ''} pick off cash prizes while the light is moving.` },
    { id: 'cannon', tag: 'CN', color: '#c8f542', max: 5, name: 'T-SHIRT CANNONS', d: l => `When you bank, the cannons shoot ${l} more prize${l > 1 ? 's' : ''} into the pot first.` },
    { id: 'crowd',  tag: 'CR', color: '#f5a542', max: 4, name: 'CROWD PLEASER',   d: l => `After every buzz the audience throws ${l} fresh prize${l > 1 ? 's' : ''} onto burnt-out podiums.` },
    { id: 'bleep',  tag: 'BL', color: '#7fe0ff', max: 4, name: 'BLEEP BUTTON',    d: l => `The first ${l > 1 ? l + ' dead air stops' : 'dead air stop'} each round ${l > 1 ? 'are' : 'is'} bleeped out.` },
    { id: 'wide',   tag: 'WD', color: '#ffffff', max: 4, name: 'FOLLOW SPOT',     d: l => `The PERFECT zone is ${['', 'bigger', 'much bigger', 'huge', 'nearly the whole podium'][l]}. PERFECT stops pay double.` },
    { id: 'gold',   tag: 'AU', color: '#ffd24a', max: 4, name: 'GOLD RUSH',       d: l => `${l} gold prize${l > 1 ? 's' : ''} on every strip, worth five times as much.` },
    { id: 'budget', tag: '$$', color: '#5fe08a', max: 5, name: 'PRIZE BUDGET',    d: l => 'A bigger prize pool: every cash and gold prize is worth $' + (10 * l) + ' more.' },
    { id: 'jack',   tag: 'JK', color: '#ff6bd6', max: 4, name: 'DIAMOND PODIUM',  d: l => `Once a round, a diamond that multiplies the whole pot by ${1.5 + 0.5 * l}.` },
    { id: 'hypeman',tag: 'HY', color: '#42d4f5', max: 5, name: 'HYPE MAN',        d: l => `Hype prizes give +${1 + l} instead of +1.` },
    { id: 'net',    tag: 'SN', color: '#42f5b0', max: 3, name: 'SAFETY NET',      d: l => `Dead air still banks ${25 * l}% of the pot.` },
    { id: 'encore', tag: '+1', color: '#c8f542', max: 3, name: 'ENCORE',          d: l => `+${l} round${l > 1 ? 's' : ''} every episode.` },
  ];

  // Things you can do to the wheel itself.
  const WHEEL_UPS = [
    { id: 'trim', tag: 'CUT', color: '#f542a8', name: 'TRIM THE WHEEL', desc: 'Remove the DEAD AIR wedge, or a toaster if it is already gone.', ok: g => g.wheel.some(w => w.type === 'dead' || w.type === 'junk') },
    { id: 'fat',  tag: 'FAT', color: '#42d4f5', name: 'WEIGHTED WHEEL', desc: 'Every gimmick wedge gets 30% wider.', ok: () => true },
    { id: 'gold', tag: 'x2',  color: '#ffd24a', name: 'GOLDEN WEDGE',   desc: 'Add a golden wedge: land on it for two random gimmicks at once.', ok: g => g.wheel.filter(w => w.type === 'gold').length < 2 },
    { id: 'spin', tag: '+2',  color: '#c8f542', name: 'FREE SPINS',     desc: '+2 spins, right now.', ok: () => true },
  ];

  const CONTESTANTS = [
    { id: 'rookie', name: 'THE ROOKIE',  desc: 'A buzzer and a dream.', start: [], need: null },
    { id: 'stunt',  name: 'THE STUNT COORDINATOR', desc: 'Starts with PYROTECHNICS and FOLLOW SPOT.', start: ['pyro', 'wide'], need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'nerd',   name: 'THE AV NERD', desc: 'Starts with LIVE WIRE and a CAMERA DRONE.', start: ['wire', 'drone'], need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    { id: 'diva',   name: 'THE DIVA',    desc: 'Starts with ENCORE and CROWD PLEASER.', start: ['encore', 'crowd'], need: 'Win a season', ok: st => st.wins >= 1 },
  ];

  const byId = (list, id) => list.find(x => x.id === id);

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Game(seed, who) {
    this.rand = seed == null ? Math.random : mulberry(seed);
    this.who = who || 'rookie';
    this.ep = 0; this.total = 0;
    this.levels = {};
    this.phase = 'title';
    this.strip = []; this.pot = { cash: 0, hype: 1, xm: 1 };
    this.u = 0;                 // beam phase, 0..2N (it bounces end to end)
    this.events = []; this.q = [];
    this.t = 0; this.spins = 0; this.toasters = 0;
    this.best = 0; this.endless = false; this.droneT = [];
    const start = (byId(CONTESTANTS, this.who) || CONTESTANTS[0]).start;
    start.forEach(id => { this.levels[id] = 1; });
    // The wheel you start with: four gimmicks, three toasters and one dead air wedge.
    const pool = this.shuffle(GIMMICKS.filter(g => !start.includes(g.id))).slice(0, 4 - start.length).map(g => g.id);
    this.wheel = start.concat(pool).map(id => ({ type: 'g', id, w: 1 }));
    for (let i = 0; i < 3; i++) this.wheel.push({ type: 'junk', w: 1 });
    this.wheel.push({ type: 'dead', w: 1 });
    this.shuffle(this.wheel);
  }

  const P = Game.prototype;
  P.pick = function (n) { return (this.rand() * n) | 0; };
  P.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.pick(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  P.lv = function (id) { return this.levels[id] || 0; };
  P.emit = function (o) { if (this.events.length < 2000) this.events.push(o); };
  P.later = function (dt, fn) { this.q.push({ at: this.t + dt, fn }); };
  P.target = function (ep) {
    if (ep <= EPISODES) return TARGETS[ep - 1];
    return Math.round(TARGETS[EPISODES - 1] * Math.pow(1.6, ep - EPISODES) / 100) * 100;
  };
  P.gain = function (id) { this.levels[id] = this.lv(id) + 1; };
  P.deadCount = function () { return Math.min(6, 1 + Math.ceil(this.ep / 2)); };

  // ── Episode / round ─────────────────────────────────────────────
  P.startEpisode = function () {
    this.ep++;
    this.total = 0;
    this.rounds = 3 + this.lv('encore');
    this.roundsLeft = this.rounds;
    this.tokenOut = false;
    this.startRound();
    this.emit({ t: 'episode' });
  };

  P.startRound = function () {
    this.strip = [];
    for (let i = 0; i < N; i++) this.strip.push({ kind: 'cash', val: 10, state: 'up' });
    this.jackOut = false;
    const order = this.shuffle(this.strip.slice());
    for (let i = 0; i < this.deadCount(); i++) order[i].kind = 'dead';
    this.dress(order.slice(this.deadCount()));
    this.pot = { cash: 10 * this.toasters, hype: 1, xm: 1 };
    this.buzzes = 0; this.bleeps = this.lv('bleep');
    this.u = this.rand() * 2 * N;
    this.droneT = [];
    for (let i = 0; i < this.lv('drone'); i++) this.droneT.push(2 + i * 1.1);
    this.q = [];
    this.phase = 'sweep';
    this.emit({ t: 'round' });
  };

  // Put fresh prizes on a set of podiums.
  P.dress = function (list) {
    this.shuffle(list);
    const vals = [10, 10, 10, 20, 20, 20, 30, 30, 50, 50];
    list.forEach(p => { p.kind = 'cash'; p.val = vals[this.pick(vals.length)]; p.state = 'up'; });
    let k = 0;
    const take = (n, kind) => { for (let i = 0; i < n && k < list.length; i++) list[k++].kind = kind; };
    take(Math.min(2, list.length - 1), 'hype');
    if (!this.tokenOut && list.length > 3) { take(1, 'spin'); this.tokenOut = true; }
    if (this.lv('jack') && !this.jackOut && list.length > 3) { take(1, 'jack'); this.jackOut = true; }   // one diamond a round
    take(this.lv('gold'), 'gold');
  };

  // What a cash prize pays, including the PRIZE BUDGET top-up.
  P.cashVal = function (p) { return p.val + 10 * this.lv('budget'); };
  P.isUp = function (i) { const p = this.strip[i]; return !!p && p.state === 'up' && p.kind !== 'dead'; };
  P.upList = function () { const o = []; for (let i = 0; i < N; i++) if (this.isUp(i)) o.push(i); return o; };
  P.speed = function () { return (3.6 + 0.4 * Math.min(this.ep, 12)) * (1 + 0.09 * this.buzzes); };   // podiums per second
  P.fold = function (u) { u = ((u % (2 * N)) + 2 * N) % (2 * N); return u < N ? u : 2 * N - u; };
  // Where every spotlight is right now, main beam first.
  P.beams = function () {
    const n = this.lv('twin') + 1, out = [];
    for (let k = 0; k < n; k++) out.push(this.fold(this.u + k * 2 * N / n));
    return out;
  };
  P.score = function () { return Math.floor(this.pot.cash * this.pot.hype * this.pot.xm); };
  P.perfectZone = function () { return Math.min(0.45, 0.15 + 0.075 * this.lv('wide')); };

  P.step = function (dt) {
    this.t += dt;
    if (this.q.length) {
      const due = this.q.filter(a => a.at <= this.t);
      if (due.length) { this.q = this.q.filter(a => a.at > this.t); due.sort((a, b) => a.at - b.at).forEach(a => a.fn()); }
    }
    if (this.phase !== 'sweep') return;
    this.u += this.speed() * dt;
    for (let k = 0; k < this.droneT.length; k++) {
      this.droneT[k] -= dt;
      if (this.droneT[k] <= 0) {
        this.droneT[k] = 3.2;
        const open = this.upList().filter(i => this.strip[i].kind === 'cash' || this.strip[i].kind === 'gold');
        if (open.length) { const i = open[this.pick(open.length)]; this.emit({ t: 'zap', k, i }); this.win(i, 'drone', 1); this.refillIfEmpty(false); }
      }
    }
  };

  // Take a prize off a podium into the pot. Returns false if there was nothing to take.
  P.win = function (i, via, mult) {
    if (!this.isUp(i)) return false;
    const p = this.strip[i], pot = this.pot;
    let val = 0, gain = 0;
    if (p.kind === 'cash') { val = this.cashVal(p) * mult; pot.cash += val; }
    else if (p.kind === 'gold') { val = this.cashVal(p) * 5 * mult; pot.cash += val; }
    else if (p.kind === 'hype') { gain = (1 + this.lv('hypeman')) * mult; pot.hype += gain; }
    else if (p.kind === 'jack') { gain = 1.5 + 0.5 * this.lv('jack'); pot.xm *= gain; }
    else if (p.kind === 'spin') { this.spins++; }
    p.state = 'burnt';
    this.emit({ t: 'win', i, kind: p.kind, val, gain, via, mult });
    return true;
  };

  // Nothing left to win: the stage is re-dressed (dead air stays where it is).
  P.refillIfEmpty = function (bonus) {
    if (this.upList().length) return;
    this.dress(this.strip.filter(p => !(p.kind === 'dead' && p.state === 'up')));
    if (bonus) this.pot.hype += 2;
    this.emit({ t: 'refill', bonus });
  };

  // Hit the buzzer: every light stops where it is.
  P.buzz = function () {
    if (this.phase !== 'sweep') return false;
    this.phase = 'resolve';
    this.buzzes++;
    const beams = this.beams(), pos = Math.min(N - 0.001, beams[0]);
    const i = Math.floor(pos), frac = pos - i, p = this.strip[i];
    const perfect = Math.abs(frac - 0.5) < this.perfectZone();
    this.emit({ t: 'buzz', i, perfect, hit: this.isUp(i) });

    if (!this.isUp(i)) {
      if (this.bleeps > 0) {
        this.bleeps--; p.state = 'gone';
        this.emit({ t: 'bleep', i });
        this.later(0.45, () => { this.phase = 'sweep'; });
      } else {
        const kept = Math.floor(this.score() * 0.25 * this.lv('net'));
        this.emit({ t: 'bust', i, kept });
        this.later(0.2, () => this.endRound(kept, true));
      }
      return true;
    }

    let at = 0;
    const add = (dt, fn) => { at += dt; this.later(at, fn); };
    const kind = p.kind;
    this.win(i, 'main', perfect ? 2 : 1);

    for (let k = 1; k < beams.length; k++) {
      const j = Math.min(N - 1, Math.floor(beams[k]));
      add(0.12, () => this.win(j, 'twin', 1));
    }
    if (perfect) for (let d = 1; d <= this.lv('pyro'); d++) {
      add(0.09, () => { this.emit({ t: 'pyro', a: i - d, b: i + d }); this.win(i - d, 'pyro', 1); this.win(i + d, 'pyro', 1); });
    }
    for (let k = 0; k < this.lv('mirror'); k++) {
      add(0.1, () => { const up = this.upList(); if (!up.length) return; const j = up[this.pick(up.length)]; this.emit({ t: 'ray', i: j }); this.win(j, 'mirror', 1); });
    }
    if (this.lv('wire')) {
      let from = i;
      for (let k = 0; k < this.lv('wire'); k++) add(0.08, () => {
        const same = this.upList().filter(j => this.strip[j].kind === kind).sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
        if (!same.length) return;
        this.emit({ t: 'bolt', a: from, b: same[0] }); this.win(same[0], 'wire', 1); from = same[0];
      });
    }
    if (this.lv('laser') && this.buzzes % 3 === 0) {
      const fromLeft = this.rand() < 0.5;
      add(0.15, () => this.emit({ t: 'laser', fromLeft, n: this.lv('laser') + 1 }));
      for (let k = 0; k <= this.lv('laser'); k++) add(0.09, () => {
        const up = this.upList(); if (!up.length) return;
        this.win(fromLeft ? up[0] : up[up.length - 1], 'laser', 1);
      });
    }
    for (let k = 0; k < this.lv('crowd'); k++) add(0.14, () => {
      const dark = []; this.strip.forEach((q, j) => { if (q.state !== 'up') dark.push(j); });
      if (!dark.length) return;
      const j = dark[this.pick(dark.length)], q = this.strip[j];
      const vals = [10, 20, 20, 30, 50];
      q.kind = 'cash'; q.val = vals[this.pick(vals.length)]; q.state = 'up';
      this.emit({ t: 'toss', i: j });
    });
    add(0.3, () => { this.refillIfEmpty(true); this.phase = 'sweep'; });
    return true;
  };

  P.bank = function () {
    if (this.phase !== 'sweep' || this.buzzes === 0) return false;
    this.phase = 'resolve';
    let at = 0;
    for (let k = 0; k < this.lv('cannon'); k++) {
      at += 0.16;
      this.later(at, () => { const up = this.upList(); if (!up.length) return; const j = up[this.pick(up.length)]; this.emit({ t: 'cannon', i: j, left: k % 2 === 0 }); this.win(j, 'cannon', 1); });
    }
    this.later(at + 0.25, () => this.endRound(this.score(), false));
    return true;
  };

  P.endRound = function (score, bust) {
    const pot = this.pot;
    this.total += score;
    if (score > this.best) this.best = score;
    this.roundsLeft--;
    this.last = { cash: pot.cash, hype: pot.hype, xm: pot.xm, score, bust };
    this.phase = 'tally';
    this.emit({ t: 'roundEnd', cash: pot.cash, hype: pot.hype, xm: pot.xm, score, bust });
  };

  // Called by the UI once the tally has played.
  P.next = function () {
    if (this.phase !== 'tally') return;
    const tgt = this.target(this.ep);
    if (this.total >= tgt) {
      // Spins: one for clearing, one per round you did not need, one for doubling the target.
      this.earned = [['EPISODE CLEARED', 1]];
      if (this.roundsLeft > 0) this.earned.push(['ROUNDS TO SPARE', this.roundsLeft]);
      if (this.total >= 2 * tgt) this.earned.push(['DOUBLED THE TARGET', 1]);
      this.earned.forEach(e => { this.spins += e[1]; });
      this.phase = this.ep === EPISODES && !this.endless ? 'won' : 'cleared';
    } else if (this.roundsLeft <= 0) this.phase = 'over';
    else this.startRound();
  };

  // ── The wheel ───────────────────────────────────────────────────
  // After an episode: pick one of three things to bolt onto the wheel.
  P.openWheel = function () {
    if (this.phase === 'won') this.endless = true;
    const gs = this.shuffle(GIMMICKS.filter(g => this.lv(g.id) < g.max)).slice(0, 2);
    const ups = this.shuffle(WHEEL_UPS.filter(u => u.ok(this)));
    this.offers = gs.map(g => ({ type: 'g', def: g }));
    this.offers.push({ type: 'up', def: ups[0] });
    this.phase = 'load';
  };

  P.takeOffer = function (i) {
    const o = this.phase === 'load' && this.offers[i];
    if (!o) return null;
    let at = -1;
    if (o.type === 'g') at = this.addWedge({ type: 'g', id: o.def.id, w: 1 });
    else if (o.def.id === 'trim') {
      let k = this.wheel.findIndex(w => w.type === 'dead');
      if (k < 0) k = this.wheel.findIndex(w => w.type === 'junk');
      if (k >= 0) this.wheel.splice(k, 1);
    } else if (o.def.id === 'fat') this.wheel.forEach(w => { if (w.type === 'g' || w.type === 'gold') w.w *= 1.3; });
    else if (o.def.id === 'gold') at = this.addWedge({ type: 'gold', w: 1 });
    else if (o.def.id === 'spin') this.spins += 2;
    this.offers = null;
    this.phase = 'wheel';
    return { offer: o, at };
  };

  // A new wedge takes the place of a toaster while there is more than one, otherwise the wheel grows.
  P.addWedge = function (w) {
    const k = this.wheel.findIndex(x => x.type === 'junk');
    if (k >= 0 && this.wheel.filter(x => x.type === 'junk').length > 1) { this.wheel[k] = w; return k; }
    this.wheel.push(w); return this.wheel.length - 1;
  };

  P.wheelTotal = function () { return this.wheel.reduce((s, w) => s + w.w, 0); };

  // Spin once. The result is decided and applied here; the UI just has to land on `index`.
  P.spin = function () {
    if (this.phase !== 'wheel' || this.spins <= 0) return null;
    this.spins--;
    let r = this.rand() * this.wheelTotal(), index = 0;
    for (; index < this.wheel.length - 1; index++) { r -= this.wheel[index].w; if (r < 0) break; }
    const w = this.wheel[index], res = { index, type: w.type, got: [], frac: 0.15 + this.rand() * 0.7 };
    const give = id => {
      const g = byId(GIMMICKS, id);
      if (this.lv(id) < g.max) { this.gain(id); res.got.push(g); return; }
      // Already maxed: the wedge pays out some other gimmick instead.
      const pool = GIMMICKS.filter(o => this.lv(o.id) < o.max);
      res.maxed = g;
      if (pool.length) { const o = pool[this.pick(pool.length)]; this.gain(o.id); res.got.push(o); }
    };
    if (w.type === 'g') give(w.id);
    else if (w.type === 'gold') this.shuffle(GIMMICKS.filter(g => this.lv(g.id) < g.max)).slice(0, 2).forEach(g => give(g.id));
    else if (w.type === 'junk') this.toasters++;
    return res;
  };

  P.wheelDone = function () { if (this.phase === 'wheel' && this.spins <= 0) { this.phase = 'ready'; return true; } return false; };

  const api = { Game, N, EPISODES, TARGETS, GIMMICKS, WHEEL_UPS, CONTESTANTS, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
