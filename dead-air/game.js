// ─────────────────────────────────────────────────────────────────
//  DEAD//AIR — game engine (no DOM). Loaded by index.html, and by
//  node for balance simulation (tools/dead_air_sim.js).
// ─────────────────────────────────────────────────────────────────
(function (root) {
  const W = 5, H = 4, N = W * H;
  const EPISODES = 8;
  const TARGETS = [250, 700, 1500, 2800, 5000, 8000, 12500, 20000];
  const SPONSOR_SLOTS = 5, LIFELINE_SLOTS = 2;

  // Sponsors stack: signing one you already have raises its level (max 3).
  // d(lv) describes the effect at that level.
  const MAX_LV = 3;
  const SPONSORS = [
    { id: 'fizz',   name: 'FIZZ COLA',            cost: 4, d: l => `Every cash panel pays +${10 * l}.` },
    { id: 'beast',  name: 'HYPE BEAST ENERGY',    cost: 6, d: l => `Hype panels give +${l} extra hype.` },
    { id: 'edge',   name: 'EDGE INSURANCE',       cost: 6, d: l => `The first ${l > 1 ? l + ' dead airs' : 'dead air'} each episode ${l > 1 ? 'are' : 'is'} ignored.` },
    { id: 'corner', name: 'CORNER OFFICE REALTY', cost: 4, d: l => `Cash panels in the four corners pay x${2 + l}.` },
    { id: 'danger', name: 'DANGER PAY',           cost: 5, d: l => `Cash panels pay +${15 * l} for each dead air next to them.` },
    { id: 'slow',   name: 'SLOW BURN CANDLES',    cost: 5, d: l => `Every 4th flip in a segment: +${l} hype.` },
    { id: 'sweep',  name: 'SWEEP DETERGENT',      cost: 4, d: l => `Clean sweep pays x${2 + 2 * l} instead of x2.` },
    { id: 'cold',   name: 'COLD FEET SOCKS',      cost: 4, d: l => `Bank with 5 flips or fewer: x${1 + l}.` },
    { id: 'over',   name: 'OVERTIME UNION',       cost: 7, d: l => `+${l} segment${l > 1 ? 's' : ''} every episode.` },
    { id: 'piggy',  name: 'PIGGY BANK & TRUST',   cost: 5, d: l => `+$${3 * l} after every episode.` },
    { id: 'rerun',  name: 'RERUN NETWORK',        cost: 4, d: l => `First segment of each episode: x${1 + 0.5 * l}.` },
    { id: 'last',   name: 'LAST CALL LIQUOR',     cost: 5, d: l => `Final segment of each episode: x${1 + l}.` },
    { id: 'seven',  name: 'LUCKY 7 CASINO',       cost: 5, d: l => `Bank with exactly 7 flips: x${2 + l}.` },
    { id: 'snow',   name: 'SNOWBALL FRO-YO',      cost: 6, d: l => `Start every segment with +${0.5 * l} hype per episode cleared since signing.` },
    { id: 'row',    name: 'ROW HOUSE BUILDERS',   cost: 6, d: l => `Finish every safe panel in a row or column: +${l} hype.` },
    { id: 'zero',   name: 'ZERO SUGAR',           cost: 4, d: l => `Cash panels showing 0 pay +${25 * l}.` },
    { id: 'chain',  name: 'DOMINO TOY CO',        cost: 5, d: l => `Every panel flipped by a chain reaction: +${0.25 * l} hype.` },
    { id: 'tip',    name: 'TIP JAR',              cost: 4, d: l => `+$${l} every time you bank.` },
    { id: 'sever',  name: 'SEVERANCE PKG',        cost: 5, d: l => l >= 3 ? 'Dead air still banks your whole pot.' : `Dead air still banks ${25 + 25 * l}% of your pot.` },
    { id: 'golden', name: 'GOLDEN HOUR',          cost: 5, d: l => `All scores x${1 + 0.5 * l}, but +1 dead air on the board.` },
    { id: 'coupon', name: 'COUPON CLIPPERS',      cost: 3, d: l => `Everything in the green room costs $${l} less.` },
  ];

  // Contestants: different starts, unlocked by progress (cleared = best episode cleared).
  const CONTESTANTS = [
    { id: 'rookie', name: 'THE ROOKIE',     desc: '$4 and a dream. No gimmicks.', need: null },
    { id: 'acct',   name: 'THE ACCOUNTANT', desc: 'Starts with $10. Interest pays up to $6 instead of $3.', need: 'Clear episode 3', ok: st => st.bestEp >= 3 },
    { id: 'dare',   name: 'THE DAREDEVIL',  desc: 'Starts with GOLDEN HOUR and two STUNT DOUBLES.', need: 'Clear episode 5', ok: st => st.bestEp >= 5 },
    { id: 'nepo',   name: 'THE NEPO BABY',  desc: 'Starts with two random sponsors, but one fewer segment every episode.', need: 'Win a season', ok: st => st.wins >= 1 },
  ];

  const LIFELINES = [
    { id: 'cue',   name: 'CUE CARD',     cost: 3, desc: 'Marks one hidden dead air.' },
    { id: 'ad',    name: 'AD BREAK',     cost: 3, desc: 'Bank the pot now and keep playing this board. Hype stays.' },
    { id: 'stunt', name: 'STUNT DOUBLE', cost: 3, desc: 'The next dead air this segment is ignored.' },
    { id: 'mic',   name: 'HOT MIC',      cost: 3, desc: '+3 hype this segment.' },
    { id: 'intern',name: 'INTERN',       cost: 2, desc: 'Flips a random safe panel for you.' },
  ];

  const UPGRADES = [
    { id: 'gold',  name: 'GOLD PANEL',   cost: 4, desc: 'Your lowest cash panel becomes a 100.' },
    { id: 'hype',  name: 'HYPE PANEL',   cost: 4, desc: 'Your lowest cash panel becomes a +1 hype panel.' },
    { id: 'mult',  name: 'JACKPOT PANEL',cost: 6, desc: 'Your lowest cash panel becomes an x1.5 panel.' },
    { id: 'raise', name: 'PAY RAISE',    cost: 4, desc: 'Every cash panel is worth +10, permanently.' },
    { id: 'cut',   name: 'TIGHT EDIT',   cost: 7, desc: 'Remove one dead air from your board, permanently.' },
  ];

  const TWISTS = [
    { id: 'censor', name: 'CENSORS IN THE BOOTH', desc: '+2 dead air on every board.' },
    { id: 'budget', name: 'BUDGET CUTS',          desc: 'Cash panels pay half.' },
    { id: 'live',   name: 'RUNNING LONG',         desc: 'One fewer segment.' },
    { id: 'clock',  name: 'HARD OUT',             desc: 'Max 9 flips per segment, then you bank.' },
    { id: 'host',   name: 'HOSTILE HOST',         desc: 'Your first flip is not guaranteed safe.' },
    { id: 'static', name: 'BAD SIGNAL',           desc: 'Hype panels do not show a number.' },
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

  function neighbors(i) {
    const x = i % W, y = (i / W) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
    }
    return out;
  }
  const NB = Array.from({ length: N }, (_, i) => neighbors(i));
  const CORNERS = [0, W - 1, N - W, N - 1];

  function baseDeck() {
    const d = [];
    for (let i = 0; i < 4; i++) d.push({ t: 'dead' });
    for (let i = 0; i < 3; i++) d.push({ t: 'hype', v: 1 });
    [10, 10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 50, 50].forEach(v => d.push({ t: 'cash', v }));
    return d;
  }

  function Game(seed, who) {
    this.who = who || 'rookie';
    this.rand = seed == null ? Math.random : mulberry(seed);
    this.ep = 0;
    this.money = 4;
    this.sponsors = [];      // {id, since}
    this.lifelines = [];     // ids
    this.deck = baseDeck();
    this.phase = 'title';
    this.episode = null;
    this.seg = null;
    this.shop = null;
    this.best = 0;           // biggest single bank this run
    this.twistOrder = this.shuffle(TWISTS.slice());
    this.interestCap = 3;
    this.chains = 0;         // longest chain reaction this run
    if (this.who === 'acct') { this.money = 10; this.interestCap = 6; }
    if (this.who === 'dare') { this.sponsors.push({ id: 'golden', since: 0, lv: 1 }); this.lifelines.push('stunt', 'stunt'); }
    if (this.who === 'nepo') this.shuffle(SPONSORS.slice()).slice(0, 2).forEach(d => this.sponsors.push({ id: d.id, since: 0, lv: 1 }));
  }

  const P = Game.prototype;
  P.pick = function (n) { return (this.rand() * n) | 0; };
  P.shuffle = function (a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.pick(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  P.lv = function (id) { const s = this.sponsors.find(x => x.id === id); return s ? s.lv : 0; };
  P.has = function (id) { return this.lv(id) > 0; };
  P.target = function (ep) {
    if (ep <= EPISODES) return TARGETS[ep - 1];
    return Math.round(TARGETS[EPISODES - 1] * Math.pow(1.5, ep - EPISODES) / 100) * 100;
  };
  P.twist = function (id) { return !!(this.episode && this.episode.twist && this.episode.twist.id === id); };

  // Special episodes (3, 6 and the finale) each draw a different twist.
  P.twistFor = function (ep) {
    if (ep > EPISODES) return (ep - EPISODES) % 2 === 0 ? this.twistOrder[(2 + (ep - EPISODES) / 2) % TWISTS.length] : null;
    return ep === 3 ? this.twistOrder[0] : ep === 6 ? this.twistOrder[1] : ep === 8 ? this.twistOrder[2] : null;
  };

  // ── Episode / segment flow ──────────────────────────────────────
  P.startEpisode = function () {
    this.ep++;
    const twist = this.twistFor(this.ep);
    let segs = 3 + this.lv('over') - (twist && twist.id === 'live' ? 1 : 0) - (this.who === 'nepo' ? 1 : 0);
    segs = Math.max(2, segs);
    this.episode = {
      target: this.target(this.ep), total: 0, twist,
      segs, segsLeft: segs, shield: this.lv('edge'),
    };
    this.phase = 'play';
    this.startSegment();
  };

  P.deadCount = function () {
    let n = this.deck.filter(p => p.t === 'dead').length;
    n += this.ep >= 13 ? 4 : this.ep >= 10 ? 3 : this.ep >= 7 ? 2 : this.ep >= 4 ? 1 : 0;
    if (this.twist('censor')) n += 2;
    if (this.has('golden')) n += 1;
    return Math.min(n, N - 6);
  };

  P.startSegment = function () {
    // Build this board: the deck, with extra dead air overwriting the lowest cash panels.
    const panels = this.deck.map(p => ({ t: p.t, v: p.v }));
    let need = this.deadCount() - panels.filter(p => p.t === 'dead').length;
    const cash = panels.filter(p => p.t === 'cash').sort((a, b) => a.v - b.v);
    for (let i = 0; i < need && i < cash.length; i++) { cash[i].t = 'dead'; delete cash[i].v; }
    this.shuffle(panels);
    let hype = 1;
    const snow = this.sponsors.find(s => s.id === 'snow');
    if (snow) hype += 0.5 * snow.lv * (this.ep - 1 - snow.since);
    this.seg = {
      panels, shown: new Array(N).fill(false), flags: new Array(N).fill(false),
      known: new Array(N).fill(false),   // dead air revealed by cue card / defused
      hint: [], cash: 0, hype, xm: 1, flips: 0, shield: false, done: false,
      index: this.episode.segs - this.episode.segsLeft,   // 0-based
    };
    this.rehint();
  };

  P.rehint = function () {
    const s = this.seg;
    s.hint = s.panels.map((_, i) => NB[i].filter(j => s.panels[j].t === 'dead').length);
  };

  P.safeLeft = function () {
    const s = this.seg; let n = 0;
    for (let i = 0; i < N; i++) if (!s.shown[i] && s.panels[i].t !== 'dead') n++;
    return n;
  };

  // Score if banked right now. sweep = cleared every safe panel.
  P.score = function (sweep) {
    const s = this.seg, e = this.episode, parts = [];
    let v = s.cash * s.hype * s.xm;
    if (s.xm !== 1) parts.push(['JACKPOT', s.xm]);
    const mul = (label, m) => { v *= m; parts.push([label, m]); };
    if (this.has('cold') && s.flips >= 1 && s.flips <= 5) mul('COLD FEET', 1 + this.lv('cold'));
    if (this.has('seven') && s.flips === 7) mul('LUCKY 7', 2 + this.lv('seven'));
    if (this.has('rerun') && s.index === 0) mul('RERUN', 1 + 0.5 * this.lv('rerun'));
    if (this.has('last') && e.segsLeft === 1) mul('LAST CALL', 1 + this.lv('last'));
    if (this.has('golden')) mul('GOLDEN HOUR', 1 + 0.5 * this.lv('golden'));
    if (sweep) mul('CLEAN SWEEP', 2 + 2 * this.lv('sweep'));
    return { score: Math.floor(v), parts };
  };

  P.toggleFlag = function (i) {
    const s = this.seg;
    if (this.phase !== 'play' || s.done || s.shown[i] || s.known[i]) return;
    s.flags[i] = !s.flags[i];
  };

  // Flip a panel. Returns an event describing what happened, or null if not allowed.
  P.flip = function (i, viaIntern) {
    const s = this.seg, e = this.episode;
    if (this.phase !== 'play' || s.done || s.shown[i] || s.known[i]) return null;
    if (s.flags[i] && !viaIntern) return null;
    s.flags[i] = false;

    // First flip is safe (unless the host is hostile): move the dead air elsewhere.
    if (s.flips === 0 && s.panels[i].t === 'dead' && !this.twist('host')) {
      const spots = [];
      for (let j = 0; j < N; j++) if (j !== i && !s.shown[j] && s.panels[j].t !== 'dead') spots.push(j);
      const j = spots[this.pick(spots.length)];
      [s.panels[i], s.panels[j]] = [s.panels[j], s.panels[i]];
      this.rehint();
    }

    const p = s.panels[i];
    const ev = { i, kind: p.t, notes: [], end: null };

    if (p.t === 'dead') {
      if (s.shield) { s.shield = false; s.known[i] = true; ev.kind = 'saved'; ev.notes.push('STUNT DOUBLE'); return ev; }
      if (e.shield) { e.shield--; s.known[i] = true; ev.kind = 'saved'; ev.notes.push('EDGE INSURANCE'); return ev; }
      s.shown[i] = true;
      const keep = this.has('sever') ? Math.min(1, 0.25 + 0.25 * this.lv('sever')) : 0;
      const kept = Math.floor(this.score(false).score * keep);
      ev.end = 'bust';
      this.endSegment(ev, kept, kept ? [['SEVERANCE', keep]] : []);
      return ev;
    }

    Object.assign(ev, this.reveal(i, 0));
    // Chain reaction: a panel showing 0 flips its neighbours for free, and so on.
    ev.steps = [];
    const queue = [i];
    while (queue.length) {
      const c = queue.shift();
      if (s.hint[c] !== 0) continue;
      for (const n of NB[c]) if (!s.shown[n]) { ev.steps.push(this.reveal(n, ev.steps.length + 1)); queue.push(n); }
    }
    if (ev.steps.length > this.chains) this.chains = ev.steps.length;

    if (this.safeLeft() === 0) {
      ev.end = 'sweep';
      const r = this.score(true);
      this.endSegment(ev, r.score, r.parts);
    } else if (this.twist('clock') && s.flips >= 9) {
      ev.end = 'clock';
      const r = this.score(false);
      this.endSegment(ev, r.score, r.parts);
    }
    return ev;
  };

  // Turn one safe panel face up and pay it out. k = position in a chain (0 = flipped by hand).
  P.reveal = function (i, k) {
    const s = this.seg, p = s.panels[i];
    const ev = { i, kind: p.t, notes: [], chain: k };
    s.shown[i] = true; s.flags[i] = false; s.flips++;
    if (p.t === 'cash') {
      let v = p.v;
      if (this.twist('budget')) v = Math.ceil(v / 2);
      v += 10 * this.lv('fizz') + 15 * this.lv('danger') * s.hint[i] + 5 * k;
      if (s.hint[i] === 0) v += 25 * this.lv('zero');
      if (this.has('corner') && CORNERS.includes(i)) v *= 2 + this.lv('corner');
      s.cash += v; ev.gain = v;
    } else if (p.t === 'hype') {
      const v = p.v + this.lv('beast');
      s.hype += v; ev.gain = v;
    } else if (p.t === 'x') {
      s.xm *= p.v; ev.gain = p.v;
    }
    if (k && this.has('chain')) s.hype += 0.25 * this.lv('chain');
    if (this.has('slow') && s.flips % 4 === 0) { s.hype += this.lv('slow'); ev.notes.push('SLOW BURN'); }
    if (this.has('row')) {
      const x = i % W, y = (i / W) | 0;
      const done = cells => cells.every(j => s.shown[j] || s.panels[j].t === 'dead');
      const n = (done(Array.from({ length: W }, (_, c) => y * W + c)) ? 1 : 0) +
                (done(Array.from({ length: H }, (_, r) => r * W + x)) ? 1 : 0);
      if (n) { s.hype += n * this.lv('row'); ev.notes.push('ROW HOUSE'); }
    }
    ev.cashNow = s.cash; ev.hypeNow = s.hype;
    return ev;
  };

  P.bank = function () {
    const s = this.seg;
    if (this.phase !== 'play' || s.done || s.flips === 0) return null;
    const ev = { kind: 'bank', notes: [], end: 'bank' };
    const r = this.score(false);
    this.endSegment(ev, r.score, r.parts);
    return ev;
  };

  P.endSegment = function (ev, score, parts) {
    const s = this.seg, e = this.episode;
    s.done = true;
    ev.cash = s.cash; ev.hype = s.hype; ev.score = score; ev.parts = parts;
    e.total += score;
    if (score > this.best) this.best = score;
    if (ev.end !== 'bust' && this.has('tip')) { this.money += this.lv('tip'); ev.notes.push('TIP JAR'); }
    e.segsLeft--;
    if (e.total >= e.target) {
      ev.episode = 'win';
      const pay = [['EPISODE FEE', 4]];
      if (e.twist) pay.push(['SPECIAL EPISODE', 2]);
      if (e.segsLeft > 0) pay.push(['UNUSED SEGMENTS', e.segsLeft]);
      const interest = Math.min(this.interestCap, Math.floor(this.money / 5));
      if (interest) pay.push(['INTEREST ($1 PER $5)', interest]);
      if (this.has('piggy')) pay.push(['PIGGY BANK', 3 * this.lv('piggy')]);
      ev.pay = pay;
      pay.forEach(p => { this.money += p[1]; });
      this.phase = this.ep === EPISODES ? 'won' : 'payout';
    } else if (e.segsLeft <= 0) {
      ev.episode = 'lose';
      this.phase = 'over';
    }
  };

  // After a finished segment that did not end the episode.
  P.nextSegment = function () {
    if (this.phase === 'play' && this.seg.done) this.startSegment();
  };

  // ── Lifelines ───────────────────────────────────────────────────
  P.canUse = function (id) {
    const s = this.seg;
    if (this.phase !== 'play' || !s || s.done) return false;
    if (id === 'ad') return s.flips > 0 && s.cash > 0;
    if (id === 'stunt') return !s.shield;
    if (id === 'cue') return s.panels.some((p, i) => p.t === 'dead' && !s.shown[i] && !s.known[i]);
    if (id === 'intern') return this.safeLeft() > 0;
    return true;
  };

  P.useLifeline = function (idx) {
    const id = this.lifelines[idx], s = this.seg;
    if (!id || !this.canUse(id)) return null;
    this.lifelines.splice(idx, 1);
    const ev = { kind: 'lifeline', id, notes: [] };
    if (id === 'cue') {
      const spots = [];
      s.panels.forEach((p, i) => { if (p.t === 'dead' && !s.shown[i] && !s.known[i]) spots.push(i); });
      const i = spots[this.pick(spots.length)];
      s.known[i] = true; s.flags[i] = false; ev.i = i;
    } else if (id === 'ad') {
      const r = this.score(false);
      this.episode.total += r.score; ev.score = r.score;
      if (r.score > this.best) this.best = r.score;
      s.cash = 0; s.xm = 1;
      if (this.episode.total >= this.episode.target) {
        // Reaching the target mid-segment wraps the episode.
        const end = { kind: 'bank', notes: [], end: 'bank' };
        this.endSegment(end, 0, []);
        end.score = r.score; ev.wrap = end;
      }
    } else if (id === 'stunt') {
      s.shield = true;
    } else if (id === 'mic') {
      s.hype += 3;
    } else if (id === 'intern') {
      const spots = [];
      s.panels.forEach((p, i) => { if (p.t !== 'dead' && !s.shown[i]) spots.push(i); });
      if (s.flips === 0) { /* layout is already valid; nothing to move */ }
      ev.flip = this.flip(spots[this.pick(spots.length)], true);
    }
    return ev;
  };

  // ── Green room (shop) ───────────────────────────────────────────
  P.price = function (item) { return Math.max(1, item.cost - this.lv('coupon')); };

  P.upgradeOk = function (id) {
    const cash = this.deck.filter(p => p.t === 'cash').length;
    if (id === 'cut') return this.deck.filter(p => p.t === 'dead').length > 2;
    if (id === 'raise') return cash > 0;
    return cash > 4;
  };

  // Sponsors that can still be offered: new ones, and owned ones below max level.
  P.sponsorPool = function () {
    const pool = this.shuffle(SPONSORS.filter(s => this.lv(s.id) < MAX_LV));
    // With every slot taken, put the ones you can still level up first.
    if (this.sponsors.length >= SPONSOR_SLOTS) pool.sort((x, y) => (this.has(y.id) ? 1 : 0) - (this.has(x.id) ? 1 : 0));
    return pool;
  };

  P.rollShop = function () {
    const ups = this.shuffle(UPGRADES.filter(u => this.upgradeOk(u.id)));
    const items = [];
    this.sponsorPool().slice(0, 2).forEach(s => items.push({ kind: 'sponsor', def: s }));
    if (ups[0]) items.push({ kind: 'upgrade', def: ups[0] });
    items.push({ kind: 'lifeline', def: LIFELINES[this.pick(LIFELINES.length)] });
    return items;
  };

  // Is there room for this item (ignoring price)?
  P.fits = function (item) {
    if (item.kind === 'sponsor') return this.has(item.def.id) ? this.lv(item.def.id) < MAX_LV : this.sponsors.length < SPONSOR_SLOTS;
    if (item.kind === 'lifeline') return this.lifelines.length < LIFELINE_SLOTS;
    if (item.kind === 'upgrade') return this.upgradeOk(item.def.id);
    return true;
  };

  P.grant = function (item) {
    if (item.kind === 'sponsor') {
      const own = this.sponsors.find(s => s.id === item.def.id);
      if (own) own.lv++; else this.sponsors.push({ id: item.def.id, since: this.ep, lv: 1 });
    } else if (item.kind === 'lifeline') this.lifelines.push(item.def.id);
    else if (item.kind === 'upgrade') this.applyUpgrade(item.def.id);
    else if (item.kind === 'cash') this.money += item.def.amount;
  };

  // After a cleared episode: three prize doors, take one for free.
  P.openDoors = function () {
    const pool = [];
    this.sponsorPool().forEach(s => { const it = { kind: 'sponsor', def: s }; if (pool.length < 2 && this.fits(it)) pool.push(it); });
    const ups = this.shuffle(UPGRADES.filter(u => this.upgradeOk(u.id)));
    if (ups[0]) pool.push({ kind: 'upgrade', def: ups[0] });
    if (this.lifelines.length < LIFELINE_SLOTS) pool.push({ kind: 'lifeline', def: LIFELINES[this.pick(LIFELINES.length)] });
    const envelope = { kind: 'cash', def: { id: 'cash', name: 'CASH ENVELOPE', desc: '$5, no strings.', amount: 5 } };
    pool.push(envelope);
    this.shuffle(pool);
    while (pool.length < 3) pool.push(envelope);
    this.doors = pool.slice(0, 3);
    this.phase = 'doors';
  };

  P.pickDoor = function (idx) {
    if (this.phase !== 'doors' || !this.doors[idx]) return false;
    this.grant(this.doors[idx]);
    this.doors = null;
    this.openShop();
    return true;
  };

  P.openShop = function () {
    this.phase = 'shop';
    this.shop = { items: this.rollShop(), reroll: 2 };
  };

  P.canBuy = function (item) {
    return !!item && !item.sold && this.money >= this.price(item.def) && this.fits(item);
  };

  P.buy = function (idx) {
    const item = this.shop && this.shop.items[idx];
    if (this.phase !== 'shop' || !this.canBuy(item)) return false;
    this.money -= this.price(item.def);
    item.sold = true;
    this.grant(item);
    return true;
  };

  // Keep the cameras rolling after the finale.
  P.goEndless = function () { if (this.phase === 'won') { this.endless = true; this.phase = 'payout'; } };

  P.applyUpgrade = function (id) {
    const cash = this.deck.filter(p => p.t === 'cash').sort((a, b) => a.v - b.v);
    if (id === 'gold') cash[0].v = 100;
    else if (id === 'hype') { cash[0].t = 'hype'; cash[0].v = 1; }
    else if (id === 'mult') { cash[0].t = 'x'; cash[0].v = 1.5; }
    else if (id === 'raise') cash.forEach(p => { p.v += 10; });
    else if (id === 'cut') { const d = this.deck.find(p => p.t === 'dead'); d.t = 'cash'; d.v = 10; }
  };

  P.reroll = function () {
    if (this.phase !== 'shop' || this.money < this.shop.reroll) return false;
    this.money -= this.shop.reroll;
    this.shop.reroll++;
    this.shop.items = this.rollShop();
    return true;
  };

  P.sellValue = function (idx) { const s = this.sponsors[idx]; return Math.floor(byId(SPONSORS, s.id).cost * s.lv / 2); };
  P.sell = function (idx) {
    if (this.phase !== 'shop' || !this.sponsors[idx]) return false;
    this.money += this.sellValue(idx);
    this.sponsors.splice(idx, 1);
    return true;
  };

  const api = {
    Game, W, H, N, NB, EPISODES, TARGETS, SPONSORS, LIFELINES, UPGRADES, TWISTS,
    SPONSOR_SLOTS, LIFELINE_SLOTS, MAX_LV, CONTESTANTS, byId,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeadAir = api;
})(typeof window !== 'undefined' ? window : globalThis);
