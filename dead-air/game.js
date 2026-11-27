// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine: rules and timing, no drawing.
//  index.html renders this state and turns g.events into effects.
//  tools/dead_air_sim.js runs it headless to check the difficulty.
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const N = 12;                 // prize podiums on the strip
  const EPISODES = 8;
  const ROUND_TIME = 16;        // seconds of moving light per round
  const TARGETS = [2000, 3000, 4200, 6000, 8500, 12000, 17000, 24000];

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
    { id: 'wide',   tag: 'WD', color: '#ffffff', max: 4, name: 'FOLLOW SPOT',     d: l => `The PERFECT zone is ${['', 'bigger', 'much bigger', 'huge', 'nearly the whole podium'][Math.min(l, 4)]}. PERFECT stops pay double.` },
    { id: 'gold',   tag: 'AU', color: '#ffd24a', max: 4, name: 'GOLD RUSH',       d: l => `${l} gold prize${l > 1 ? 's' : ''} on every strip, worth five times as much.` },
    { id: 'budget', tag: '$$', color: '#5fe08a', max: 5, name: 'PRIZE BUDGET',    d: l => 'A bigger prize pool: every cash and gold prize is worth $' + (10 * l) + ' more.' },
    { id: 'jack',   tag: 'JK', color: '#ff6bd6', max: 4, name: 'DIAMOND PODIUM',  d: l => `Once a round, a diamond that multiplies the whole pot by ${1.5 + 0.5 * l}.` },
    { id: 'hypeman',tag: 'HY', color: '#42d4f5', max: 5, name: 'HYPE MAN',        d: l => `Hype prizes give +${1 + l} instead of +1.` },
    { id: 'net',    tag: 'SN', color: '#42f5b0', max: 3, name: 'SAFETY NET',      d: l => `Dead air still banks ${Math.min(100, 25 * l)}% of the pot.` },
    { id: 'encore', tag: '+1', color: '#c8f542', max: 3, name: 'ENCORE',          d: l => `+${l} round${l > 1 ? 's' : ''} every episode.` },
    { id: 'clock',  tag: 'XT', color: '#ffd24a', max: 4, name: 'EXTENDED CUT',    d: l => `+${4 * l} seconds on the clock every round.` },
    { id: 'slowmo', tag: 'SL', color: '#7fe0ff', max: 3, name: 'DRAMATIC PAUSE',  d: l => `+${l} slow-mo use${l > 1 ? 's' : ''} every round.` },

    // Headliners: rare, one level only, and each one changes a rule instead of a number.
    { id: 'ghost',  rare: true, tag: 'GH', color: '#e9e9ff', max: 1, name: 'GHOST LIGHT',      d: () => 'Burnt-out podiums are no longer dead air. Stopping on one just wastes the buzz.' },
    { id: 'streak', rare: true, tag: 'HS', color: '#ff7a2e', max: 1, name: 'HOT STREAK',       d: () => 'PERFECT stops in a row pay x2, then x3, then x4 and up. One miss resets it.' },
    { id: 'combo',  rare: true, tag: 'CC', color: '#f5a542', max: 1, name: 'CROWD COMBO',      d: () => 'Every prize after the first in a single buzz adds +0.5 hype.' },
    { id: 'midas',  rare: true, tag: 'MD', color: '#ffd24a', max: 1, name: 'MIDAS TOUCH',      d: () => 'Every PERFECT stop turns two cash prizes to gold.' },
    { id: 'steady', rare: true, tag: 'SC', color: '#9d8cff', max: 1, name: 'STEADY CAM',       d: () => 'The light never speeds up.' },
    { id: 'life',   rare: true, tag: 'RR', color: '#ff5a7a', max: 1, name: 'RERUN',            d: () => 'Once an episode, dead air does not end the round: you lose half the cash and play on.' },
    { id: 'double', rare: true, tag: 'DN', color: '#ffd24a', max: 1, name: 'DOUBLE OR NOTHING', d: () => 'Every bank flips a coin: the pot pays x2.5, or half.' },
    { id: 'static', rare: true, tag: 'ST', color: '#f542a8', max: 1, name: 'STATIC CLING',     d: () => 'Start every round with +1 hype for each dead air TV on the strip.' },
  ];
  const common = g => !g.rare;

  // Show formats: each one changes how the stage behaves. spins = bonus spins for clearing it.
  const FORMATS = [
    { id: 'classic',  color: '#c8f542', spins: 0, name: 'CLASSIC NIGHT', desc: 'The show as written. No surprises.' },
    { id: 'turbo',    color: '#ff9a2e', spins: 0, name: 'DOUBLE TIME',   desc: 'The light moves 35% faster. Cash and gold pay double.' },
    { id: 'mystery',  color: '#9d8cff', spins: 1, name: 'MYSTERY NIGHT', desc: 'Every prize is under a cloth. You only see what the light is passing over.' },
    { id: 'conveyor', color: '#42d4f5', spins: 1, name: 'CONVEYOR',      desc: 'The whole strip slides one podium along every second or so.' },
    { id: 'strobe',   color: '#ffffff', spins: 1, name: 'STROBE',        desc: 'The light does not sweep. It jumps to a random podium, again and again.' },
    { id: 'pendulum', color: '#42f5b0', spins: 0, name: 'PENDULUM',      desc: 'The light swings: slow at the ends, very fast through the middle.' },
    { id: 'high',     color: '#ff6bd6', spins: 0, name: 'HIGH ROLLER',   desc: 'One fewer round, but every round starts with +2 hype.' },
    { id: 'goldnight',color: '#ffd24a', spins: 0, name: 'GOLD NIGHT',    desc: 'Three extra gold prizes on every strip, and one extra dead air.' },
    { id: 'censors',  color: '#f542a8', spins: 1, name: "CENSORS' NIGHT", desc: 'Two extra dead air on every strip. You get one free bleep a round.' },
  ];
  const SPECIALS = ['box', 'bomb', 'x2', 'restock'];

  // Things you can do to the wheel itself.
  const WHEEL_UPS = [
    { id: 'trim', tag: 'CUT', color: '#f542a8', name: 'TRIM THE WHEEL', desc: 'Remove the DEAD AIR wedge, or a toaster if it is already gone.', ok: g => g.wheel.some(w => w.type === 'dead' || w.type === 'junk') },
    { id: 'fat',  tag: 'FAT', color: '#42d4f5', name: 'WEIGHTED WHEEL', desc: 'Every gimmick wedge gets 30% wider.', ok: () => true },
    { id: 'gold', tag: 'x2',  color: '#ffd24a', name: 'GOLDEN WEDGE',   desc: 'Add a golden wedge: land on it for two random gimmicks at once.', ok: g => g.wheel.filter(w => w.type === 'gold').length < 2 },
    { id: 'spin', tag: '+1',  color: '#c8f542', name: 'FREE SPIN',      desc: '+1 spin, right now.', ok: () => true },
  ];

  const CONTESTANTS = [
    { id: 'rookie', name: 'THE ROOKIE',  desc: 'A buzzer and a dream.', start: [], need: null },
    { id: 'stunt',  name: 'THE STUNT COORDINATOR', desc: 'Starts with PYROTECHNICS and FOLLOW SPOT.', start: ['pyro', 'wide'], need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'nerd',   name: 'THE AV NERD', desc: 'Starts with LIVE WIRE and a CAMERA DRONE.', start: ['wire', 'drone'], need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    { id: 'diva',   name: 'THE DIVA',    desc: 'Starts with ENCORE and CROWD PLEASER.', start: ['encore', 'crowd'], need: 'Win a season', ok: st => st.wins >= 1 },
  ];

  // Dressing room: permanent upgrades bought with prize money. cost(l) = price of level l + 1.
  const PERKS = [
    { id: 'head',   icon: 'spin',    max: 3, name: 'HEAD START',         cost: l => [6000, 15000, 30000][l], d: l => `Start every season with ${l} spin${l > 1 ? 's' : ''} on the wheel.` },
    { id: 'time',   icon: 'clock',   max: 5, name: 'LONGER SLOT',        cost: l => 3000 * (l + 1),          d: l => `+${l} second${l > 1 ? 's' : ''} on the clock every round.` },
    { id: 'warm',   icon: 'hypeman', max: 4, name: 'WARM-UP ACT',        cost: l => 5000 * (l + 1),          d: l => `Every round starts with +${0.5 * l} hype.` },
    { id: 'budget', icon: 'budget',  max: 5, name: 'BIGGER BUDGET',      cost: l => 2500 * (l + 1),          d: l => `Every cash and gold prize is worth $${5 * l} more.` },
    { id: 'trim',   icon: 'trim',    max: 3, name: 'LOADED WHEEL',       cost: l => 8000 * (l + 1),          d: l => `Your wheel starts with ${l} fewer toaster${l > 1 ? 's' : ''}.` },
    { id: 'censor', icon: 'bleep',   max: 2, name: 'CENSOR ON RETAINER', cost: l => [12000, 30000][l],       d: l => `${l} free bleep${l > 1 ? 's' : ''} every round.` },
    { id: 'agent',  icon: 'gold',    max: 5, name: 'A BETTER AGENT',     cost: l => 4000 * (l + 1),          d: l => `+${20 * l}% prize money from everything you bank.` },
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

  function Game(seed, who, perks) {
    this.perks = perks || {};
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
    const pool = this.shuffle(GIMMICKS.filter(g => common(g) && !start.includes(g.id))).slice(0, 4 - start.length).map(g => g.id);
    this.wheel = start.concat(pool).map(id => ({ type: 'g', id, w: 1 }));
    for (let i = 0; i < 3 - (this.perks.trim || 0); i++) this.wheel.push({ type: 'junk', w: 1 });
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
  P.perk = function (id) { return this.perks[id] || 0; };
  // In endless the level caps come off (headliners stay one-offs).
  P.capOf = function (g) { return this.endless && !g.rare ? 99 : g.max; };
  P.emit = function (o) { if (this.events.length < 2000) this.events.push(o); };
  P.later = function (dt, fn) { this.q.push({ at: this.t + dt, fn }); };
  P.target = function (ep) {
    if (ep <= EPISODES) return TARGETS[ep - 1];
    return Math.round(TARGETS[EPISODES - 1] * Math.pow(1.6, ep - EPISODES) / 100) * 100;
  };
  P.gain = function (id) { this.levels[id] = this.lv(id) + 1; };
  // Interference: from episode 5 static strikes burn prizes off the strip, faster every episode.
  P.stormEvery = function () { return this.ep < 5 ? Infinity : Math.max(0.9, 5.5 - 0.5 * (this.ep - 5)); };
  P.storm = function (dt) {
    this.stormT -= dt;
    if (this.stormT > 0) return;
    this.stormT = this.stormEvery();
    const up = this.upList();
    if (up.length > 1) { const i = up[this.pick(up.length)]; this.strip[i].state = 'burnt'; this.emit({ t: 'storm', i }); }
  };
  P.is = function (id) { return !!this.format && this.format.id === id; };
  P.deadCount = function () {
    return Math.min(7, 1 + Math.ceil(this.ep / 2) + (this.is('goldnight') ? 1 : 0) + (this.is('censors') ? 2 : 0));
  };

  // ── Episode / round ─────────────────────────────────────────────
  P.startEpisode = function (formatId) {
    this.ep++;
    this.total = 0;
    this.format = byId(FORMATS, formatId || this.nextFormat) || FORMATS[0];
    this.nextFormat = null;
    this.lifeUsed = false;
    this.rounds = Math.max(2, 3 + this.lv('encore') - (this.is('high') ? 1 : 0));
    this.roundsLeft = this.rounds;
    this.tokenOut = this.rand() < 0.5;        // a wheel token only turns up in about half the episodes
    this.startRound();
    this.emit({ t: 'episode' });
  };

  P.startRound = function () {
    this.strip = [];
    for (let i = 0; i < N; i++) this.strip.push({ kind: 'cash', val: 10, state: 'up' });
    this.jackOut = false;
    this.specialsLeft = (this.ep >= 4 ? 1 : 0) + (this.ep >= 2 && this.rand() < 0.6 ? 1 : 0) + (this.ep >= 6 && this.rand() < 0.5 ? 1 : 0);
    const order = this.shuffle(this.strip.slice());
    for (let i = 0; i < this.deadCount(); i++) order[i].kind = 'dead';
    this.dress(order.slice(this.deadCount()));
    const tvs = this.strip.filter(q => q.kind === 'dead').length;
    this.pot = { cash: 10 * this.toasters, hype: 1 + 0.5 * this.perk('warm') + (this.is('high') ? 2 : 0) + (this.lv('static') ? tvs : 0), xm: 1, next2: false };
    this.buzzes = 0; this.bleeps = this.lv('bleep') + this.perk('censor') + (this.is('censors') ? 1 : 0);
    this.slowLeft = 1 + this.lv('slowmo'); this.slowT = 0;
    this.clockMax = ROUND_TIME + 4 * this.lv('clock') + this.perk('time'); this.clock = this.clockMax;
    this.stormT = this.stormEvery();
    this.streak = 0; this.inBuzz = false;
    this.convT = 1.4; this.strobeT = 0.6;
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
    take(this.lv('gold') + (this.is('goldnight') ? 3 : 0), 'gold');
    // Oddities: a mystery box, a firework crate, a x2 card or a restock crate.
    while (this.specialsLeft > 0 && k < list.length - 1) { take(1, SPECIALS[this.pick(SPECIALS.length)]); this.specialsLeft--; }
  };

  // What a cash prize pays, including the PRIZE BUDGET top-up.
  P.cashVal = function (p) { return (p.val + 10 * this.lv('budget') + 5 * this.perk('budget')) * (this.is('turbo') ? 2 : 1); };
  P.isUp = function (i) { const p = this.strip[i]; return !!p && p.state === 'up' && p.kind !== 'dead'; };
  P.upList = function () { const o = []; for (let i = 0; i < N; i++) if (this.isUp(i)) o.push(i); return o; };
  P.speed = function () {                                   // podiums per second
    return (3.6 + 0.4 * Math.min(this.ep, 12)) * (1 + (this.lv('steady') ? 0 : 0.09 * this.buzzes)) *
      (this.is('turbo') ? 1.35 : 1) * (this.slowT > 0 ? 0.35 : 1);
  };
  // Slow-motion: a couple of seconds of a much slower light. A few uses per round.
  P.slowmo = function () {
    if (this.phase !== 'sweep' || this.slowLeft <= 0 || this.slowT > 0) return false;
    this.slowLeft--; this.slowT = 2.4;
    this.emit({ t: 'slow' });
    return true;
  };
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
    // The round clock only runs while the light is moving. Slow-mo does not slow it.
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0;
      this.emit({ t: 'timeup' });
      if (!this.bank()) { this.phase = 'resolve'; this.later(0.6, () => this.endRound(this.score(), false)); }
      return;
    }
    const slow = this.slowT > 0 ? 0.35 : 1;
    if (this.slowT > 0) this.slowT -= dt;
    this.storm(dt * slow);
    if (this.is('strobe')) {
      // The light jumps from podium to podium instead of sweeping.
      this.strobeT -= dt * slow;
      if (this.strobeT <= 0) {
        this.u = this.pick(N) + 0.2 + this.rand() * 0.6;
        this.strobeT = Math.max(0.4, 0.72 - 0.02 * this.ep) / (1 + (this.lv('steady') ? 0 : 0.05 * this.buzzes));
        this.emit({ t: 'jump' });
      }
    } else if (this.is('pendulum')) {
      this.u += this.speed() * (0.4 + 1.5 * Math.sin(Math.PI * this.fold(this.u) / N)) * dt;
    } else this.u += this.speed() * dt;
    if (this.is('conveyor')) {
      this.convT -= dt * slow;
      if (this.convT <= 0) { this.convT = 1.3; this.strip.unshift(this.strip.pop()); this.emit({ t: 'shift' }); }
    }
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
    let val = 0, gain = 0, note = '';
    const doubled = pot.next2 && (p.kind === 'cash' || p.kind === 'gold' || p.kind === 'hype');
    if (doubled) { mult *= 2; pot.next2 = false; }
    if (p.kind === 'cash') { val = this.cashVal(p) * mult; pot.cash += val; }
    else if (p.kind === 'gold') { val = this.cashVal(p) * 5 * mult; pot.cash += val; }
    else if (p.kind === 'hype') { gain = (1 + this.lv('hypeman')) * mult; pot.hype += gain; }
    else if (p.kind === 'jack') { gain = 1.5 + 0.5 * this.lv('jack'); pot.xm *= gain; }
    else if (p.kind === 'spin') { this.spins++; }
    else if (p.kind === 'x2') { pot.next2 = true; }
    else if (p.kind === 'box') {
      // Mystery box: could be anything.
      const r = this.rand();
      if (r < 0.4) { val = (100 + 20 * this.lv('budget')) * (this.is('turbo') ? 2 : 1); pot.cash += val; note = 'JACKPOT'; }
      else if (r < 0.65) { gain = 2; pot.hype += 2; note = 'HYPE'; }
      else if (r < 0.73) { this.spins++; note = 'SPIN'; }
      else { this.toasters++; note = 'TOASTER'; }
    } else if (p.kind === 'bomb') {
      // Firework crate: takes out the prizes either side of it (and sets off other crates).
      this.later(0.12, () => { this.emit({ t: 'boom', i }); this.win(i - 1, 'bomb', 1); this.win(i + 1, 'bomb', 1); });
    } else if (p.kind === 'restock') {
      const vals = [20, 20, 30, 50];
      this.strip.forEach((q, j) => {
        if (q.state === 'up' || j === i) return;
        q.kind = 'cash'; q.val = vals[this.pick(vals.length)]; q.state = 'up';
        this.emit({ t: 'toss', i: j });
      });
    }
    let combo = false;
    if (this.inBuzz && via !== 'main' && this.lv('combo')) { pot.hype += 0.5; combo = true; }
    p.state = 'burnt';
    this.emit({ t: 'win', i, kind: p.kind, val, gain, via, mult, note, doubled, combo });
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

    this.inBuzz = true;
    if (!this.isUp(i)) {
      this.streak = 0;
      if (p.kind !== 'dead' && this.lv('ghost')) {
        // GHOST LIGHT: a burnt-out podium is just an empty podium.
        this.emit({ t: 'whiff', i });
        this.later(0.35, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else if (this.bleeps > 0) {
        this.bleeps--; p.state = 'gone';
        this.emit({ t: 'bleep', i });
        this.later(0.45, () => { this.inBuzz = false; this.phase = 'sweep'; });
      } else {
        if (this.lv('life') && !this.lifeUsed) {
          // RERUN: once an episode the show goes on, minus half the cash.
          this.lifeUsed = true; this.pot.cash = Math.floor(this.pot.cash / 2); p.state = 'gone';
          this.emit({ t: 'rerun', i });
          this.later(0.9, () => { this.inBuzz = false; this.phase = 'sweep'; });
          return true;
        }
        const kept = Math.floor(this.score() * Math.min(1, 0.25 * this.lv('net')));
        this.emit({ t: 'bust', i, kept });
        this.later(0.2, () => this.endRound(kept, true));
      }
      return true;
    }

    let at = 0;
    const add = (dt, fn) => { at += dt; this.later(at, fn); };
    const kind = p.kind;
    this.streak = perfect ? this.streak + 1 : 0;
    this.win(i, 'main', perfect ? (this.lv('streak') ? 1 + this.streak : 2) : 1);
    if (perfect && this.lv('midas')) add(0.1, () => {
      const cash = this.shuffle(this.upList().filter(j => this.strip[j].kind === 'cash')).slice(0, 2);
      cash.forEach(j => { this.strip[j].kind = 'gold'; this.emit({ t: 'midas', i: j }); });
    });

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
    add(0.3, () => { this.refillIfEmpty(true); this.inBuzz = false; this.phase = 'sweep'; });
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
    if (this.lv('double')) {
      at += 0.3;
      this.later(at, () => { const up = this.rand() < 0.5; this.pot.xm *= up ? 2.5 : 0.5; this.emit({ t: 'coin', up }); });
      at += 1.0;
    }
    this.later(at + 0.25, () => this.endRound(this.score(), false));
    return true;
  };

  P.endRound = function (score, bust) {
    const pot = this.pot;
    this.total += score;
    this.banked = (this.banked || 0) + score;
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
      // Spins: one for clearing, one for doubling the target, one if the format was a tough one.
      this.earned = [['EPISODE CLEARED', 1]];
      if (this.total >= 2 * tgt) this.earned.push(['DOUBLED THE TARGET', 1]);
      if (this.format.spins) this.earned.push([this.format.name, this.format.spins]);
      this.earned.forEach(e => { this.spins += e[1]; });
      this.phase = this.ep === EPISODES && !this.endless ? 'won' : 'cleared';
    } else if (this.roundsLeft <= 0) this.phase = 'over';
    else this.startRound();
  };

  // ── The wheel ───────────────────────────────────────────────────
  // After an episode: pick one of three things to bolt onto the wheel.
  P.openWheel = function () {
    if (this.phase === 'won') this.endless = true;
    const gs = this.shuffle(GIMMICKS.filter(g => common(g) && this.lv(g.id) < this.capOf(g))).slice(0, 2);
    // Now and then a headliner turns up in place of an ordinary wedge.
    const rares = this.shuffle(GIMMICKS.filter(g => g.rare && !this.lv(g.id) && !this.wheel.some(w => w.id === g.id)));
    if (rares.length && this.ep >= 2 && this.rand() < 0.45) gs[this.pick(gs.length)] = rares[0];
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
    else if (o.def.id === 'spin') this.spins += 1;
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
      if (this.lv(id) < this.capOf(g)) { this.gain(id); res.got.push(g); return; }
      // Already maxed: the wedge pays out some other gimmick instead.
      const pool = GIMMICKS.filter(o => common(o) && this.lv(o.id) < this.capOf(o));
      res.maxed = g;
      if (pool.length) { const o = pool[this.pick(pool.length)]; this.gain(o.id); res.got.push(o); }
    };
    if (w.type === 'g') give(w.id);
    else if (w.type === 'gold') this.shuffle(GIMMICKS.filter(g => common(g) && this.lv(g.id) < this.capOf(g))).slice(0, 2).forEach(g => give(g.id));
    else if (w.type === 'junk') this.toasters++;
    return res;
  };

  // Spins spent: now choose tomorrow's show from two formats.
  P.wheelDone = function () {
    if (this.phase !== 'wheel' || this.spins > 0) return false;
    this.formats = this.shuffle(FORMATS.filter(f => f !== this.format)).slice(0, 2);
    this.phase = 'pick';
    return true;
  };
  P.pickFormat = function (i) {
    if (this.phase !== 'pick' || !this.formats[i]) return false;
    this.nextFormat = this.formats[i].id; this.formats = null;
    this.phase = 'ready';
    return true;
  };

  const api = { Game, N, EPISODES, TARGETS, GIMMICKS, WHEEL_UPS, CONTESTANTS, FORMATS, PERKS, byId };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
