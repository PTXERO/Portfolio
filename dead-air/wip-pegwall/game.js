// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine: rules + physics, no drawing.
//  index.html renders this state and turns g.events into effects.
//  tools/dead_air_sim.js runs it headless to check the difficulty.
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const W = 540, H = 960;
  const L = 16, R = 524, TOP = 150, SLOT_Y = 806, POST_Y = 776;
  const SLOTS = 7, SLOT_W = (R - L) / SLOTS, MID = 3;
  const BASE_MULT = [1, 2, 3, 5, 3, 2, 1];
  const EPISODES = 8;
  const TARGETS = [600, 1400, 3000, 5500, 10000, 20000, 40000, 90000];
  const GRAV = 1500, MAX_BALLS = 90;

  // Every gimmick is something you can see on the set. d(lv) = what it does at that level.
  const GIMMICKS = [
    { id: 'split',  tag: 'SP', color: '#42d4f5', max: 6, name: 'SPLIT DECISION',  d: l => `The first peg each drop splits your ball into ${l + 1}.` },
    { id: 'wire',   tag: 'ZP', color: '#fff36b', max: 5, name: 'LIVE WIRE',       d: l => `Peg hits have a ${Math.min(90, 20 * l + 10)}% chance to arc lightning through ${l + 1} more pegs.` },
    { id: 'bomb',   tag: 'BM', color: '#ff5a3c', max: 5, name: 'PYROTECHNICS',    d: l => `${2 * l} bomb pegs on the wall. They blow up everything nearby.` },
    { id: 'pyro',   tag: 'FI', color: '#ff9a2e', max: 5, name: 'FIREBALL',        d: l => `Balls burn straight through their first ${3 * l} pegs.` },
    { id: 'laser',  tag: 'LZ', color: '#f542a8', max: 5, name: 'LASER SHOW',      d: l => `Every ${Math.max(4, 14 - 2 * l)} pegs lit, a laser sweeps a whole row.` },
    { id: 'drone',  tag: 'DR', color: '#9d8cff', max: 5, name: 'CAMERA DRONE',    d: l => `${l} drone${l > 1 ? 's' : ''} fly the wall zapping pegs while a ball is in play.` },
    { id: 'cannon', tag: 'CN', color: '#c8f542', max: 5, name: 'T-SHIRT CANNONS', d: l => `Each ball that lands fires ${l} mini ball${l > 1 ? 's' : ''} back up from the sides.` },
    { id: 'crowd',  tag: 'CR', color: '#f5a542', max: 3, name: 'CROWD SURF',      d: l => `${25 * l}% chance the audience throws a landing ball back up.` },
    { id: 'bumper', tag: 'BU', color: '#42f5b0', max: 4, name: 'PINBALL WIZARD',  d: l => `${l} bumper${l > 1 ? 's' : ''} on the wall. They kick balls hard and pay $${20 * l}.` },
    { id: 'magnet', tag: 'MG', color: '#ff6bd6', max: 4, name: 'MAGNETIC CHARM',  d: l => `The jackpot slot pulls falling balls toward it${l > 1 ? ' (strength ' + l + ')' : ''}.` },
    { id: 'shield', tag: 'SH', color: '#7fe0ff', max: 4, name: 'BLEEP BUTTON',    d: l => `Balls survive ${l} dead air hit${l > 1 ? 's' : ''} and smash the peg.` },
    { id: 'gold',   tag: 'AU', color: '#ffd24a', max: 5, name: 'GOLD RUSH',       d: l => `${4 * l} pegs turn gold and pay five times as much.` },
    { id: 'big',    tag: 'XL', color: '#d8d8e0', max: 3, name: 'BIG ENERGY',      d: l => `Balls are ${25 * l}% bigger.` },
    { id: 'encore', tag: '+1', color: '#c8f542', max: 4, name: 'ENCORE',          d: l => `+${l} ball${l > 1 ? 's' : ''} every episode.` },
    { id: 'rigged', tag: 'RG', color: '#ffd24a', max: 5, name: 'RIGGED JACKPOT',  d: l => `The centre slot is worth x${5 + 3 * l}.` },
    { id: 'hypeman',tag: 'HY', color: '#42d4f5', max: 5, name: 'HYPE MAN',        d: l => `Hype pegs give +${1 + l} instead of +1.` },
  ];

  const CONTESTANTS = [
    { id: 'rookie', name: 'THE ROOKIE',  desc: 'Five balls and a dream.', start: [], need: null },
    { id: 'stunt',  name: 'THE STUNT COORDINATOR', desc: 'Starts with FIREBALL and PYROTECHNICS.', start: ['pyro', 'bomb'], need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'nerd',   name: 'THE AV NERD', desc: 'Starts with LIVE WIRE and a CAMERA DRONE.', start: ['wire', 'drone'], need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    { id: 'diva',   name: 'THE DIVA',    desc: 'Starts with ENCORE and CROWD SURF.', start: ['encore', 'crowd'], need: 'Win a season', ok: st => st.wins >= 1 },
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

  // Peg layout: 10 staggered rows. Even rows run wall to wall so nothing wedges at the edge.
  const ROWS = 10, DX = (R - L) / 10, Y0 = 236, DY = 52;
  function layout() {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      const even = r % 2 === 0, n = even ? 11 : 10;
      for (let c = 0; c < n; c++) {
        out.push({ x: L + (even ? c : c + 0.5) * DX, y: Y0 + r * DY, row: r, edge: even && (c === 0 || c === n - 1) });
      }
    }
    return out;
  }

  function Game(seed, who) {
    this.rand = seed == null ? Math.random : mulberry(seed);
    this.who = who || 'rookie';
    this.ep = 0; this.total = 0; this.ballsLeft = 0;
    this.levels = {};
    this.phase = 'title';
    this.pegs = []; this.posts = []; this.balls = []; this.drones = [];
    this.events = []; this.q = [];
    this.t = 0; this.nextId = 1;
    this.d = null; this.last = null; this.doors = null;
    this.best = 0; this.endless = false;
    (byId(CONTESTANTS, this.who) || CONTESTANTS[0]).start.forEach(id => { this.levels[id] = 1; });   // drones spawn at episode start
    for (let i = 1; i < SLOTS; i++) this.posts.push({ x: L + i * SLOT_W, y: POST_Y, r: 5, kind: 'post' });
  }

  const P = Game.prototype;
  P.pick = function (n) { return (this.rand() * n) | 0; };
  P.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.pick(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  P.lv = function (id) { return this.levels[id] || 0; };
  P.emit = function (o) { if (this.events.length < 4000) this.events.push(o); };
  P.later = function (dt, fn) { this.q.push({ at: this.t + dt, fn }); };
  P.target = function (ep) {
    if (ep <= EPISODES) return TARGETS[ep - 1];
    return Math.round(TARGETS[EPISODES - 1] * Math.pow(2.2, ep - EPISODES) / 1000) * 1000;
  };
  P.slotMult = function (i) { return BASE_MULT[i] + (i === MID ? 3 * this.lv('rigged') : 0); };
  P.ballR = function () { return 9 * (1 + 0.25 * this.lv('big')); };
  P.deadCount = function () { return Math.min(14, 2 + this.ep); };

  // ── Episode setup ───────────────────────────────────────────────
  P.startEpisode = function () {
    this.ep++;
    this.total = 0;
    this.ballsLeft = 5 + this.lv('encore');
    this.ballsMax = this.ballsLeft;
    this.giftUsed = false;
    this.balls = []; this.q = [];
    this.buildWall();
    this.drones = [];
    for (let i = 0; i < this.lv('drone'); i++) this.addDrone();
    this.phase = 'aim';
    this.emit({ t: 'episode' });
  };

  P.addDrone = function () {
    const i = this.drones.length;
    this.drones.push({ x: 60 + i * 90, y: 120, target: null, cool: 0.3 + i * 0.25 });
  };

  // Gain a level of a gimmick. Wall dressing (bombs, gold, bumpers) shows up on the next wall.
  P.gain = function (id) {
    this.levels[id] = this.lv(id) + 1;
    if (id === 'drone') this.addDrone();
    if (id === 'encore' && (this.phase === 'aim' || this.phase === 'drop')) { this.ballsLeft++; this.ballsMax++; }
  };

  P.buildWall = function () {
    const spots = layout();
    this.pegs = spots.map(s => ({ id: this.nextId++, x: s.x, y: s.y, row: s.row, edge: s.edge, r: 8, kind: 'cash', lit: false, gone: false }));
    // Dead air and bumpers sit away from the top rows and the walls.
    const inner = this.shuffle(this.pegs.filter(p => p.row >= 2 && !p.edge));
    let k = 0;
    for (let i = 0; i < this.deadCount(); i++) inner[k++].kind = 'dead';
    const bumpSpots = inner.slice(k).filter(p => p.row >= 3 && p.row <= 8 && p.x > 90 && p.x < 450);
    for (let i = 0; i < this.lv('bumper') && i < bumpSpots.length; i++) { bumpSpots[i].kind = 'bumper'; bumpSpots[i].r = 17; }
    this.dress(this.pegs.filter(p => p.kind === 'cash'));
  };

  // Hand out hype / bomb / gold among a set of plain pegs.
  P.dress = function (list) {
    this.shuffle(list);
    let k = 0;
    const take = (n, kind) => { for (let i = 0; i < n && k < list.length; i++) list[k++].kind = kind; };
    list.forEach(p => { p.kind = 'cash'; p.lit = false; p.gone = false; });
    if (!this.pegs.some(p => p.kind === 'gift' && !list.includes(p)) && !this.giftUsed) take(1, 'gift');
    take(5, 'hype');
    take(2 * this.lv('bomb'), 'bomb');
    take(4 * this.lv('gold'), 'gold');
  };

  P.scoring = p => p.kind !== 'dead' && p.kind !== 'bumper';
  P.remaining = function () { let n = 0; for (const p of this.pegs) if (!p.gone && !p.lit && this.scoring(p)) n++; return n; };

  // ── Dropping ────────────────────────────────────────────────────
  P.drop = function (x) {
    if (this.phase !== 'aim' || this.ballsLeft <= 0) return false;
    this.ballsLeft--;
    this.d = { cash: 0, hype: 1, slot: 0, hits: 0, split: false, landed: 0, died: 0, t0: this.t,
               laserAt: Math.max(4, 14 - 2 * this.lv('laser')), sweeps: 0, peak: 1 };
    const r = this.ballR();
    x = Math.max(L + r + 2, Math.min(R - r - 2, x));
    this.spawn(x, TOP + 6, (this.rand() - 0.5) * 30, 40, {});
    this.phase = 'drop';
    this.emit({ t: 'drop', x });
    return true;
  };

  P.spawn = function (x, y, vx, vy, o) {
    if (this.balls.length >= MAX_BALLS) return null;
    const b = { id: this.nextId++, x, y, vx, vy, r: o.mini ? 6 : this.ballR(), mini: !!o.mini,
                pierce: o.mini ? 0 : 3 * this.lv('pyro'), shield: this.lv('shield'),
                thrown: false, bumps: 0, still: 0, ignore: 0, alive: true };
    this.balls.push(b);
    if (this.d && this.balls.length > this.d.peak) this.d.peak = this.balls.length;
    return b;
  };

  P.step = function (dt) {
    this.t += dt;
    if (this.q.length) {
      const due = this.q.filter(a => a.at <= this.t);
      if (due.length) { this.q = this.q.filter(a => a.at > this.t); due.forEach(a => a.fn()); }
    }
    this.moveDrones(dt);
    if (this.phase !== 'drop') return;
    const d = this.d, mag = this.lv('magnet'), midX = L + (MID + 0.5) * SLOT_W;

    for (const b of this.balls) {
      b.vy += GRAV * dt;
      if (mag && b.y > 420) b.vx += Math.max(-1, Math.min(1, (midX - b.x) / 160)) * 420 * mag * dt;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 1500) { b.vx *= 1500 / sp; b.vy *= 1500 / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < L + b.r) { b.x = L + b.r; b.vx = Math.abs(b.vx) * 0.6; }
      if (b.x > R - b.r) { b.x = R - b.r; b.vx = -Math.abs(b.vx) * 0.6; }
      if (b.y < TOP + b.r) { b.y = TOP + b.r; b.vy = Math.abs(b.vy) * 0.5; }

      for (const p of this.pegs) {
        if (p.gone) continue;
        const dx = b.x - p.x, dy = b.y - p.y, rr = b.r + p.r;
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) { if (b.ignore === p.id) b.ignore = 0; continue; }
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) { if (b.ignore === p.id) b.ignore = 0; continue; }
        if (b.ignore === p.id) continue;
        this.touch(b, p, dx, dy, Math.sqrt(d2) || 0.01, rr);
        if (!b.alive) break;
      }
      if (!b.alive) continue;
      if (b.y > POST_Y - 12) for (const p of this.posts) {
        const dx = b.x - p.x, dy = b.y - p.y, rr = b.r + p.r, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) this.bounce(b, dx, dy, Math.sqrt(d2) || 0.01, rr, 0.45);
      }
      if (b.y > SLOT_Y) { this.land(b); continue; }

      // Anything that settles on a peg gets a shove.
      if (sp < 30) { b.still += dt; if (b.still > 0.5) { b.vx = (this.rand() - 0.5) * 400; b.vy = -200; b.still = 0; } }
      else b.still = 0;
    }
    if (this.balls.some(b => !b.alive)) this.balls = this.balls.filter(b => b.alive);

    if (this.t - d.t0 > 30) this.balls.slice().forEach(b => { b.thrown = true; this.land(b); });
    if (this.balls.some(b => !b.alive)) this.balls = this.balls.filter(b => b.alive);
    if (!this.balls.length && !this.q.length) this.endDrop();
  };

  P.bounce = function (b, dx, dy, dist, rr, e) {
    const nx = dx / dist, ny = dy / dist;
    b.x += nx * (rr - dist); b.y += ny * (rr - dist);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
      b.vx += (this.rand() - 0.5) * 30;
    }
  };

  // A ball has touched a peg.
  P.touch = function (b, p, dx, dy, dist, rr) {
    const d = this.d;
    if (p.kind === 'dead') {
      if (b.shield > 0) {
        b.shield--; p.gone = true;
        this.emit({ t: 'bleep', x: p.x, y: p.y });
        this.bounce(b, dx, dy, dist, rr, 0.6);
      } else {
        b.alive = false; d.died++;
        this.emit({ t: 'dead', x: b.x, y: b.y, id: b.id, last: this.balls.filter(o => o.alive).length === 0 });
      }
      return;
    }
    if (p.kind === 'bumper') {
      this.bounce(b, dx, dy, dist, rr, 0.6);
      if (b.bumps < 10) {
        b.bumps++;
        const nx = dx / dist, ny = dy / dist;
        b.vx = nx * 820; b.vy = ny * 820 - 120;
        const pay = 20 * this.lv('bumper');
        d.cash += pay;
        this.emit({ t: 'bump', x: p.x, y: p.y, id: p.id, val: pay });
      }
      return;
    }
    const fresh = !p.lit;
    if (fresh) {
      if (!d.split && this.lv('split')) {
        d.split = true;
        const n = this.lv('split');
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.5 + (this.rand() - 0.5) * 0.3;
          this.spawn(b.x, b.y - 4, Math.cos(a) * 380, Math.sin(a) * 380, {});
        }
        this.emit({ t: 'split', x: b.x, y: b.y, n });
      }
      this.hit(p, 'ball');
      if (b.pierce > 0) { b.pierce--; b.ignore = p.id; this.emit({ t: 'burn', x: p.x, y: p.y }); return; }
    }
    this.bounce(b, dx, dy, dist, rr, 0.62);
  };

  // Light a peg and pay it out. via = what lit it: ball | bolt | bomb | laser | drone.
  P.hit = function (p, via) {
    const d = this.d;
    if (!d || p.gone || p.lit || !this.scoring(p)) return;
    p.lit = true; d.hits++;
    let val = 0, gain = 0;
    if (p.kind === 'hype') { gain = 1 + this.lv('hypeman'); d.hype += gain; }
    else { val = p.kind === 'gold' ? 50 : p.kind === 'gift' ? 0 : 10; d.cash += val; }
    if (p.kind === 'gift') {
      // The mystery prize: a random gimmick, live on the set straight away.
      this.giftUsed = true;
      const pool = GIMMICKS.filter(g => this.lv(g.id) < g.max);
      if (pool.length) { const g = pool[this.pick(pool.length)]; this.gain(g.id); this.emit({ t: 'gift', x: p.x, y: p.y, g }); }
    }
    this.emit({ t: 'hit', x: p.x, y: p.y, id: p.id, kind: p.kind, val, gain, via, n: d.hits });

    if (p.kind === 'bomb') {
      this.emit({ t: 'boom', x: p.x, y: p.y, r: 105 });
      for (const b of this.balls) {
        const dx = b.x - p.x, dy = b.y - p.y, dist = Math.hypot(dx, dy) || 1;
        if (dist < 130) { b.vx += dx / dist * 520; b.vy += dy / dist * 520 - 150; }
      }
      const near = this.pegs.filter(o => !o.gone && !o.lit && this.scoring(o) && Math.hypot(o.x - p.x, o.y - p.y) < 105);
      this.later(0.07, () => near.forEach(o => this.hit(o, 'bomb')));
    }

    if (via === 'ball' && this.lv('wire') && this.rand() < Math.min(0.9, 0.1 + 0.2 * this.lv('wire'))) {
      let from = p;
      const used = new Set([p.id]);
      for (let i = 0; i <= this.lv('wire'); i++) {
        let bestP = null, bestD = 230;
        for (const o of this.pegs) {
          if (o.gone || o.lit || used.has(o.id) || !this.scoring(o)) continue;
          const dd = Math.hypot(o.x - from.x, o.y - from.y);
          if (dd < bestD) { bestD = dd; bestP = o; }
        }
        if (!bestP) break;
        used.add(bestP.id);
        const a = from, b2 = bestP;
        this.later(0.05 * (i + 1), () => { this.emit({ t: 'bolt', x1: a.x, y1: a.y, x2: b2.x, y2: b2.y }); this.hit(b2, 'bolt'); });
        from = bestP;
      }
    }

    if (this.lv('laser') && d.hits >= d.laserAt) {
      d.laserAt += Math.max(4, 14 - 2 * this.lv('laser'));
      const rows = new Array(ROWS).fill(0);
      for (const o of this.pegs) if (!o.gone && !o.lit && this.scoring(o)) rows[o.row]++;
      const row = rows.indexOf(Math.max(...rows));
      if (rows[row] > 0) {
        const y = Y0 + row * DY, fromLeft = this.rand() < 0.5;
        this.emit({ t: 'laser', y, fromLeft });
        for (const o of this.pegs) if (o.row === row && !o.gone && !o.lit && this.scoring(o)) {
          this.later(0.12 + 0.25 * (fromLeft ? (o.x - L) : (R - o.x)) / (R - L), () => this.hit(o, 'laser'));
        }
      }
    }

    // Whole wall lit: it refills on the spot and the hype jumps.
    if (this.remaining() === 0) {
      d.sweeps++; d.hype += 2;
      this.later(0.25, () => {
        this.dress(this.pegs.filter(o => this.scoring(o)));
        this.emit({ t: 'sweep' });
      });
    }
  };

  P.land = function (b) {
    const d = this.d;
    const i = Math.max(0, Math.min(SLOTS - 1, Math.floor((b.x - L) / SLOT_W)));
    if (this.lv('crowd') && !b.thrown && this.rand() < 0.25 * this.lv('crowd')) {
      b.thrown = true; b.y = SLOT_Y - 2;
      b.vy = -(1000 + this.rand() * 250); b.vx = (this.rand() - 0.5) * 320;
      this.emit({ t: 'crowd', x: b.x, i });
      return;
    }
    const mult = b.mini ? 1 : this.slotMult(i);
    d.slot += mult; d.landed++;
    b.alive = false;
    this.emit({ t: 'slot', i, x: b.x, mult, mini: b.mini });
    if (!b.mini) for (let k = 0; k < this.lv('cannon'); k++) {
      const left = (k + d.landed) % 2 === 0;
      this.later(0.12 + 0.1 * k, () => {
        const x = left ? L + 14 : R - 14;
        this.spawn(x, 748, (left ? 1 : -1) * (140 + this.rand() * 260), -(950 + this.rand() * 250), { mini: true });
        this.emit({ t: 'cannon', left });
      });
    }
  };

  P.moveDrones = function (dt) {
    const active = this.phase === 'drop';
    this.drones.forEach((dr, i) => {
      if (active && !dr.target) {
        dr.cool -= dt;
        if (dr.cool <= 0) {
          const open = this.pegs.filter(p => !p.gone && !p.lit && this.scoring(p) && !this.drones.some(o => o.target === p));
          if (open.length) dr.target = open[this.pick(open.length)];
        }
      }
      if (!active) dr.target = null;
      const tx = dr.target ? dr.target.x : 70 + i * 100 + Math.sin(this.t * 1.3 + i * 2) * 24;
      const ty = dr.target ? dr.target.y - 26 : 186 + Math.cos(this.t * 1.7 + i) * 8;
      const dx = tx - dr.x, dy = ty - dr.y, dist = Math.hypot(dx, dy);
      const sp = 560 * dt;
      if (dist <= sp) { dr.x = tx; dr.y = ty; } else { dr.x += dx / dist * sp; dr.y += dy / dist * sp; }
      if (dr.target && dist <= sp + 2) {
        const p = dr.target; dr.target = null; dr.cool = 0.75;
        if (!p.lit && !p.gone) { this.emit({ t: 'zap', x1: dr.x, y1: dr.y, x2: p.x, y2: p.y }); this.hit(p, 'drone'); }
      }
    });
  };

  P.endDrop = function () {
    const d = this.d;
    d.score = Math.floor(d.cash * d.hype * d.slot);
    this.total += d.score;
    if (d.score > this.best) this.best = d.score;
    this.last = d;
    for (const p of this.pegs) if (p.lit && !p.gone) { p.gone = true; this.emit({ t: 'clear', x: p.x, y: p.y, kind: p.kind }); }
    if (this.remaining() === 0) this.dress(this.pegs.filter(o => this.scoring(o)));
    this.phase = 'tally';
    this.emit({ t: 'dropEnd', cash: d.cash, hype: d.hype, slot: d.slot, score: d.score, bust: d.slot === 0 });
  };

  // Called by the UI once the tally has played.
  P.next = function () {
    if (this.phase !== 'tally') return;
    if (this.ballsLeft > 0) { this.phase = 'aim'; return; }
    if (this.total >= this.target(this.ep)) {
      this.bonus = this.total >= 2 * this.target(this.ep);
      this.phase = this.ep === EPISODES && !this.endless ? 'won' : 'cleared';
    } else this.phase = 'over';
  };

  // ── Prize doors: one free gimmick per cleared episode, two if you doubled the target ──
  P.openDoors = function () {
    if (this.phase === 'won') this.endless = true;
    this.picks = this.bonus ? 3 : 2;
    this.rollDoors();
    this.phase = 'doors';
  };
  P.rollDoors = function () {
    this.doors = this.shuffle(GIMMICKS.filter(g => this.lv(g.id) < g.max)).slice(0, 3);
  };
  P.pickDoor = function (i) {
    if (this.phase !== 'doors' || !this.doors[i]) return null;
    const g = this.doors[i];
    this.gain(g.id);
    this.picks--;
    if (this.picks > 0) this.rollDoors(); else { this.doors = null; this.phase = 'ready'; }
    return g;
  };

  const api = {
    Game, W, H, L, R, TOP, SLOT_Y, POST_Y, SLOTS, SLOT_W, MID, EPISODES, TARGETS, GIMMICKS, CONTESTANTS, byId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
