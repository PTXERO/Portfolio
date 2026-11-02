// The Hearth tab: the whole screen is the fire. Tap anywhere to stoke it. Every stoke cooks a
// batch of what's been brought in (food, there and then), and builds the fire up; a big fire
// cooks more of everything while it lasts, and it dies down by itself if it's left.

import { DAY_SEC, fireMost, fireMore, growth, knowsSign, praying, prayerMost, signReady, foodRate, shoreSeason, SEASON_NAMES, tapValue, type ShorePerson, type ShoreState } from '../economy/shore';
import { drawCreature, type CreatureLook } from '../scene/creatureLook';
import { MIRACLES, type MiracleId } from '../content/idle';
import { pickTalk, temperOf, type Age, type Speaker, type TalkCtx } from '../content/hearthTalk';
import { squeak } from '../audio/sound';
import { D, format } from '../economy/num';

/** The art's own size: drawn small, shown big, hard pixel edges. */
const AW = 90;
const AH = 160;
const FX = AW / 2;
const FY = 110;

interface Bit { x: number; y: number; vx: number; vy: number; life: number; age: number; hot: number }
/** What a critter round the fire is doing: hopping (seconds into it, after a moment's delay). */
interface Seat { hop: number; wait: number; high: number; turn: number; id: number; name: string; look?: CreatureLook; pitch: number; size: number }
/** Two of them talking: who (seats), what, which line they're on, and how long it's been up. */
interface Chat { who: [number, number]; lines: string[]; at: number; t: number }
/** Where each one sits (and is, mid-hop), in the art's pixels, for the words over their heads. */
interface Spot { x: number; y: number; base: number; left: boolean; i: number }
const LINE_SECS = 2.8;
/** A little picture over a critter's head: glad, startled, a song, love, sleepy. */
type EmoteKind = 'bang' | 'note' | 'heart' | 'zzz' | 'sweat';
interface Emote { seat: number; kind: EmoteKind; age: number }

/** The emotes, as tiny pixel pictures (x = the colour). */
const EMOTES: Record<EmoteKind, { rows: string[]; color: string }> = {
  bang: { rows: ['x', 'x', 'x', '.', 'x'], color: '#ffe9b0' },
  note: { rows: ['.xx', '.x.', '.x.', 'xx.', 'xx.'], color: '#9fe8c8' },
  heart: { rows: ['x.x', 'xxx', 'xxx', '.x.'], color: '#ff6a7a' },
  zzz: { rows: ['xxx', '.x.', 'x..', 'xxx'], color: '#a8b8e8' },
  sweat: { rows: ['.x', 'xx', 'xx'], color: '#7ac8ff' },
};
const HOP_TIME = 0.32;

export class HearthView {
  readonly el: HTMLElement;
  private c: HTMLCanvasElement;
  private b: CanvasRenderingContext2D;
  private stats: HTMLElement;
  private bar: HTMLElement;
  private flames: Bit[] = [];
  private embers: Bit[] = [];
  private flare = 0;
  private seats: Seat[] = [];
  private emotes: Emote[] = [];
  /** Taps in a row (each within a moment of the last): the faster, the more they cheer. */
  private streak = 0;
  private lastTap = -9;
  private still = 0;
  /** The Far Voice: when a streak last crossed the sky, when the next will, and a sign's show
   * (which, and how far into it). */
  private streakAt = -999;
  private nextStreak = 60 + Math.random() * 120;
  private sky: { x0: number; y0: number; x1: number; y1: number; t: number } | null = null;
  private shown_: { id: MiracleId; t: number } | null = null;
  private signsKey = '';
  private seatKey = '';
  private spots: Spot[] = [];
  private chat: Chat | null = null;
  private nextChat = 4;
  private lastTalks: number[] = [];
  private bubble!: HTMLElement;
  /** The rest of the game's state the talk needs (set each frame). */
  private council = false;
  private t = 0;
  shown = false;

  constructor(
    parent: HTMLElement,
    private onStoke: (x: number, y: number) => number,
    private onSign: (id: MiracleId) => string,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'hearth';
    this.el.hidden = true;
    this.el.innerHTML = `<canvas width="${AW}" height="${AH}"></canvas>
      <div class="hearth-signs" hidden><div class="prayer"><span class="label">Prayer</span><div class="prayer-bar"><i></i></div></div><div class="signs"></div></div>
      <div class="hearth-info">
        <div class="hearth-heat"><span class="label">The fire</span><div class="heat-bar"><i></i></div></div>
        <div class="hearth-stats dim"></div>
      </div>
      <div class="hearth-tip label">Tap the fire to stoke it</div>
      <div class="hearth-say" hidden><b></b><span></span></div>`;
    // (Under the top bar, the hints and the cards: over the map.)
    parent.insertBefore(this.el, parent.querySelector('#overlay-top'));
    this.c = this.el.querySelector('canvas')!;
    this.b = this.c.getContext('2d')!;
    this.stats = this.el.querySelector('.hearth-stats')!;
    this.bar = this.el.querySelector('.heat-bar i')!;
    this.bubble = this.el.querySelector('.hearth-say')!;
    // (Taps here are for the fire only: none of them get through to the map underneath.)
    for (const ev of ['pointermove', 'pointerup', 'pointercancel', 'wheel', 'click'] as const) this.el.addEventListener(ev, (e) => e.stopPropagation());
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // (A sign worked, not the fire stoked.)
      const sign = (e.target as HTMLElement).closest<HTMLElement>('[data-sign]');
      if (sign) {
        if (!sign.classList.contains('off')) this.sign(sign.dataset.sign as MiracleId);
        return;
      }
      const got = this.onStoke(e.clientX, e.clientY);
      if (!got) return;
      this.flare = 1;
      for (let i = 0; i < 5; i++) this.spark(true);
      this.cheer();
      this.pop(e.clientX, e.clientY, `+${format(D(got))}`);
      this.el.querySelector('.hearth-tip')?.classList.add('gone');
    });
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.el.hidden = !on;
    if (!on) {
      this.chat = null;
      this.bubble.hidden = true;
      this.nextChat = 3 + Math.random() * 4;
    }
  }

  private pop(x: number, y: number, text: string): void {
    const r = this.el.getBoundingClientRect();
    const f = document.createElement('span');
    f.className = 'hearth-pop num';
    f.textContent = text;
    f.style.left = `${x - r.left}px`;
    f.style.top = `${y - r.top}px`;
    this.el.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }

  /** A stoke: they hop (the nearest first), and now and then one of them says something. */
  private cheer(): void {
    this.streak = this.t - this.lastTap < 0.6 ? this.streak + 1 : 1;
    this.lastTap = this.t;
    this.still = 0;
    // (Woken up: the sleepy ones startle.)
    const woke = this.emotes.some((e) => e.kind === 'zzz');
    this.emotes = this.emotes.filter((e) => e.kind !== 'zzz');
    const high = 2 + Math.min(5, this.streak * 0.4);
    this.seats.forEach((st, i) => {
      if (st.hop > 0 && st.hop < HOP_TIME * 0.6) return;
      st.hop = 0.0001;
      st.wait = Math.random() * 0.12 + (woke ? 0.15 : 0);
      st.high = high * (0.7 + Math.random() * 0.6);
      // (On a good run they spin round, one after another.)
      if (this.streak >= 8 && (this.streak + i) % 4 === 0) st.turn = 0.4;
    });
    const n = this.seats.length;
    if (!n) return;
    // (A squeak or two from the ring: not all of them at once.)
    for (let k = 0; k < Math.min(n, this.streak > 4 ? 2 : 1); k++) this.squeakFrom(Math.floor(Math.random() * n), 0.3);
    const say = (kind: EmoteKind) => {
      const free = [...Array(n).keys()].filter((i) => !this.emotes.some((e) => e.seat === i));
      if (free.length) this.emotes.push({ seat: free[Math.floor(Math.random() * free.length)], kind, age: 0 });
    };
    if (woke) for (let i = 0; i < Math.min(3, n); i++) say('bang');
    else if (this.streak === 1) { if (Math.random() < 0.5) say('bang'); }
    else if (this.streak % 6 === 0) say(this.streak >= 18 ? 'heart' : 'note');
    else if (Math.random() < 0.08) say('note');
  }

  /** One of them squeaks, in their own voice, from where they sit. */
  private squeakFrom(i: number, level: number, delay = 0): void {
    const st = this.seats[i];
    const sp = this.spots.find((q) => q.i === i);
    if (!st) return;
    // (The little ones squeak higher.)
    const go = () => squeak(level, sp ? (sp.x - FX) / FX : 0, st.pitch * (1 + (1 - st.size) * 0.8));
    if (delay) setTimeout(go, delay * 1000);
    else go();
  }

  /** Who sits at the fire: the first eight of the village's own (a stranger's kind looks another way). */
  private seat(s: ShoreState): void {
    // (The village's own: up to five grown, and up to three of the children, the eldest of them
    // first, so the little ones are at the fire too. Each child's size goes with how grown they are.)
    const own = s.people.filter((p: ShorePerson) => p.kind === undefined);
    const kids = own.filter((p) => growth(s, p) < 1).slice(0, 3);
    const grown = own.filter((p) => growth(s, p) >= 1).slice(0, 8 - kids.length);
    const sat = [...grown, ...kids];
    // (Kids sit between the grown, not all together.)
    const order = sat.map((p, i) => ({ p, k: i < grown.length ? i : (i - grown.length) * (grown.length / Math.max(1, kids.length)) + 0.5 })).sort((a, b) => a.k - b.k).map((x) => x.p);
    for (const st of this.seats) {
      const p = order.find((q) => q.id === st.id);
      if (p) st.size = childSize(growth(s, p));
    }
    const key = order.map((p) => p.id).join();
    if (key === this.seatKey) return;
    this.seatKey = key;
    const old = new Map(this.seats.map((st) => [st.id, st]));
    const talking = this.chat ? this.chat.who.map((i) => this.seats[i]?.id) : [];
    this.seats = order.map((p) => {
      const was = old.get(p.id);
      return was ?? { hop: 0, wait: 0, high: 0, turn: 0, id: p.id, name: p.name, look: s.look ? (p.genes ? { ...s.look, genes: p.genes } : s.look) : undefined, pitch: 0.85 + ((p.id * 37) % 40) / 100, size: childSize(growth(s, p)) };
    });
    // (A talk goes on if both talking are still at the fire.)
    const who = talking.map((id) => this.seats.findIndex((st) => st.id === id));
    if (this.chat && who.every((i) => i >= 0)) this.chat.who = [who[0], who[1]];
    else {
      this.chat = null;
      this.bubble.hidden = true;
    }
  }

  /** Now and then, two of them talk: a line each, back and forth, squeaking as they go. */
  private talk(s: ShoreState, dt: number): void {
    const n = this.seats.length;
    if (!this.chat) {
      this.nextChat -= dt;
      if (this.nextChat > 0 || n < 2) return;
      const i = Math.floor(Math.random() * n);
      let j = Math.floor(Math.random() * (n - 1));
      if (j >= i) j++;
      const byAge = [...s.people].sort((p, q) => p.born - q.born);
      const here = new Set([this.seats[i].id, this.seats[j].id]);
      const others = byAge.filter((p) => !here.has(p.id));
      const babe = others[others.length - 1];
      const ctx: TalkCtx = {
        a: speaker(s, this.seats[i].id),
        b: speaker(s, this.seats[j].id),
        crossings: s.crossings ?? 0,
        heat: s.heat ?? 0,
        season: SEASON_NAMES[shoreSeason(s).si] as TalkCtx['season'],
        critters: s.people.length,
        food: format(D(s.food)),
        rate: foodRate(s),
        won: s.villages.filter((v) => v.won !== undefined).length,
        age: s.culture?.age ?? 1,
        young: others.length > 2 && babe && growth(s, babe) < 0.3 ? babe.name : undefined,
        old: others.length > 2 ? others[0].name : undefined,
        foragers: s.gens.forager ?? 0,
        huts: (s.gens.hut ?? 0) + (s.gens.longhouse ?? 0),
        council: this.council,
        streak: this.t - this.streakAt < 45,
        spearFaith: s.culture?.forks.faith === 'spear',
      };
      const pick = pickTalk(ctx, this.lastTalks);
      this.lastTalks = [...this.lastTalks.slice(-8), pick.i];
      // (Whoever the talk fits opens it.)
      this.chat = { who: pick.first ? [j, i] : [i, j], lines: pick.lines, at: -1, t: LINE_SECS };
    }
    const c = this.chat;
    c.t += dt;
    if (c.t >= LINE_SECS) {
      c.at++;
      c.t = 0;
      if (c.at >= c.lines.length) {
        this.chat = null;
        this.bubble.hidden = true;
        this.nextChat = 10 + Math.random() * 14;
        return;
      }
      const who = c.who[c.at % 2];
      const line = c.lines[c.at];
      (this.bubble.firstElementChild as HTMLElement).textContent = this.seats[who].name;
      (this.bubble.lastElementChild as HTMLElement).textContent = line;
      this.bubble.hidden = false;
      this.el.querySelector('.hearth-tip')?.classList.add('gone');
      this.bubble.classList.remove('in');
      void this.bubble.offsetWidth;
      this.bubble.classList.add('in');
      // (Talking: a squeak a word or so, in their own voice, and a little hop on the first.)
      const words = Math.min(4, 1 + Math.floor(line.split(' ').length / 3));
      for (let k = 0; k < words; k++) this.squeakFrom(who, 0.16, k * 0.13);
      const st = this.seats[who];
      if (!st.hop) Object.assign(st, { hop: 0.0001, wait: 0, high: 1.5 });
    }
    // The words over the one speaking (they follow them as they hop).
    const who = c.who[Math.max(0, c.at) % 2];
    const sp = this.spots.find((q) => q.i === who);
    if (!sp || this.bubble.hidden) return;
    const r = this.el.getBoundingClientRect();
    const k = Math.max(r.width / AW, r.height / AH);
    const ox = (r.width - AW * k) * 0.5;
    const oy = (r.height - AH * k) * 0.8;
    const x = ox + sp.x * k;
    const y = oy + (sp.y - 23 * (this.seats[who]?.size ?? 1)) * k;
    const w = this.bubble.offsetWidth;
    this.bubble.style.left = `${Math.max(8, Math.min(r.width - w - 8, x - w / 2))}px`;
    this.bubble.style.top = `${Math.max(8, y - this.bubble.offsetHeight)}px`;
    this.bubble.style.setProperty('--tail', `${Math.max(12, Math.min(w - 12, x - Math.max(8, Math.min(r.width - w - 8, x - w / 2))))}px`);
  }

  /** The ground round the fire: this island's own pebbles and tufts, the season on them, and
   * what's been built there (the woodpile, the flagstones, the standing stone). Behind the ring. */
  private ground(s: ShoreState, heat: number): void {
    const b = this.b;
    const r = seeded(s.seed);
    const si = shoreSeason(s).si;
    // Pebbles and tufts, where this island has them (lit a little by the fire): more green on a
    // lush island, bare stone on a barren one.
    const nature = s.nature ?? 'still';
    const scatter = nature === 'lush' ? 48 : nature === 'barren' ? 14 : 26;
    for (let i = 0; i < scatter; i++) {
      const x = Math.floor(r() * AW);
      const y = Math.floor(FY - 6 + r() * (AH - FY + 6));
      const kind = r();
      const lit = Math.max(0, 1 - Math.hypot(x - FX, (y - FY) * 2) / 60) * heat;
      if (kind < (nature === 'barren' ? 0.85 : 0.4)) {
        b.fillStyle = mix('#2a2622', '#6a5040', lit);
        b.fillRect(x, y, 2, 1);
      } else {
        const col = si === 3 ? '#c8d0dc' : si === 2 ? (kind < 0.7 ? '#8a4a1e' : '#a0602a') : si === 0 && kind > 0.85 ? (kind > 0.93 ? '#d88aa8' : '#d8c860') : '#2a3a20';
        b.fillStyle = mix(col, '#c88040', lit * 0.4);
        b.fillRect(x, y, si === 3 ? 2 : 1, si === 3 ? 1 : si === 1 || si === 0 ? 2 : 1);
      }
    }
    if (!s.raftTaken) return;
    const age = s.culture?.age ?? 1;
    // The Great Hearth: flagstones laid round the fire.
    if (s.ups.includes('greathearth') || age >= 2) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.fillStyle = i % 2 ? '#4c4844' : '#56504a';
        b.fillRect(Math.round(FX + Math.cos(a) * 22 - 3), Math.round(FY + Math.sin(a) * 7 - 1), 6, 3);
      }
    }
    // The Town Square: a standing stone behind the fire, its face lit by it.
    if (s.ups.includes('square') || age >= 3) {
      b.fillStyle = '#3c3a3e';
      b.fillRect(FX - 26, FY - 30, 6, 22);
      b.fillRect(FX - 25, FY - 32, 4, 2);
      b.fillStyle = mix('#3c3a3e', '#c87840', 0.3 + heat * 0.4);
      b.fillRect(FX - 21, FY - 30, 1, 22);
    }
    // The Bronze Age: bronze bowls of fire on posts, either side (once the Chief's Hall stands,
    // two more, further out).
    if (age >= 3) {
      const bowls = s.ups.includes('hall') ? [-34, -24, 24, 34] : [-30, 30];
      for (const dx of bowls) {
        const x = FX + dx;
        const y = FY - 18;
        b.fillStyle = '#5a4a3a';
        b.fillRect(x, y, 1, 10);
        b.fillStyle = '#c8963a';
        b.fillRect(x - 2, y - 1, 5, 2);
        b.fillStyle = Math.floor(this.t * 6 + dx) % 2 ? '#ffc060' : '#ff8a3a';
        b.fillRect(x - 1, y - 3, 3, 2);
        b.fillRect(x, y - 4, 1, 1);
      }
    }
    // The woodpile: logs stacked behind, to the right.
    if (s.ups.includes('woodpile')) {
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < 3 - row; k++) {
          const x = FX + 22 + k * 4 + row * 2;
          const y = FY - 12 - row * 3;
          b.fillStyle = '#5a3a22';
          b.fillRect(x, y, 4, 3);
          b.fillStyle = '#a07850';
          b.fillRect(x, y + 1, 1, 1);
        }
    }
    // Tinder: a bundle of sticks by the fire, to the left.
    if (s.ups.includes('tinder')) {
      b.fillStyle = '#8a6a3a';
      for (let k = 0; k < 4; k++) b.fillRect(FX - 26 + k, FY - 9 - (k % 2), 1, 4);
      b.fillStyle = '#6a4a2a';
      b.fillRect(FX - 27, FY - 7, 6, 1);
    }
  }

  /** The fire's own place: a few stones at first; a ring of them; a pit; banked coals; great logs;
   * the bonfire's tall teepee. */
  private pit(s: ShoreState, heat: number): void {
    const b = this.b;
    const has = (id: string) => s.ups.includes(id);
    const ring = has('firering') || has('firepit');
    // A pit, dug down: dark inside the ring.
    if (has('firepit')) {
      b.fillStyle = '#100c0a';
      b.beginPath();
      b.ellipse(FX, FY - 1, 14, 4, 0, 0, Math.PI * 2);
      b.fill();
    }
    // Banked embers: a bed of coals, glowing as the fire breathes.
    if (has('embers')) {
      for (let i = 0; i < 18; i++) {
        const x = FX - 10 + ((i * 7) % 21);
        const y = FY - 2 + (i % 3);
        const glow = 0.5 + 0.5 * Math.sin(this.t * 2 + i * 1.7);
        b.fillStyle = glow > 0.6 ? '#ff7a2a' : glow > 0.3 ? '#c83a1a' : '#5a1a10';
        b.fillRect(x, y, 1, 1);
      }
    }
    // The stones: a few at first, then a full ring of bigger ones, lit on the side facing in.
    const n = ring ? 14 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const w = ring ? 5 : 4;
      const x = Math.round(FX + Math.cos(a) * (ring ? 16 : 15) - w / 2);
      const y = Math.round(FY + Math.sin(a) * (ring ? 5 : 4) - 1);
      b.fillStyle = ring ? (i % 2 ? '#5a5450' : '#4a4440') : '#4a4440';
      b.fillRect(x, y, w, 3);
      b.fillStyle = mix('#5a5450', '#e09050', 0.2 + heat * 0.5);
      b.fillRect(x, y, w, 1);
    }
    // The logs: crossed; great ones (thicker, longer) once there are.
    const big = has('logs');
    b.fillStyle = '#5a3a22';
    b.fillRect(FX - (big ? 14 : 12), FY - (big ? 4 : 3), big ? 28 : 24, big ? 4 : 3);
    b.fillStyle = '#6e4a2a';
    b.fillRect(FX - (big ? 10 : 8), FY - (big ? 7 : 5), big ? 20 : 16, big ? 3 : 2);
    b.fillStyle = heat > 0.05 ? '#ff7a2a' : '#7a3a1a';
    b.fillRect(FX - 6, FY - 4, 12, 1);
  }

  /** A sign worked: the show, the line it leaves, and the critters' wonder. */
  private sign(id: MiracleId): void {
    const said = this.onSign(id);
    if (!said) return;
    this.shown_ = { id, t: 0 };
    const r = this.el.getBoundingClientRect();
    this.pop(r.left + r.width / 2, r.top + r.height * 0.3, said);
    for (let i = 0; i < Math.min(4, this.seats.length); i++) this.emotes.push({ seat: i, kind: 'bang', age: -i * 0.15 });
    if (id === 'bolt') {
      this.flare = 1;
      for (let i = 0; i < 20; i++) this.spark(true);
    }
  }

  /** The Far Voice over the fire: the streak across the sky now and then, and a sign's show. */
  private voice(s: ShoreState, dt: number): void {
    const b = this.b;
    // A streak, far off, every few minutes: they look up.
    this.nextStreak -= dt;
    if (this.nextStreak <= 0 && s.raftTaken) {
      this.nextStreak = 90 + Math.random() * 150;
      const left = Math.random() < 0.5;
      this.sky = { x0: left ? -5 : AW + 5, y0: 6 + Math.random() * 20, x1: left ? AW * 0.7 : AW * 0.3, y1: 30 + Math.random() * 25, t: 0 };
      this.streakAt = this.t;
      this.seats.forEach((_, i) => i % 2 === 0 && this.emotes.push({ seat: i, kind: 'bang', age: -0.3 - i * 0.1 }));
      this.nextChat = Math.min(this.nextChat, 2);
    }
    if (this.sky) {
      const st = this.sky;
      st.t += dt;
      const k = Math.min(1, st.t / 1.4);
      for (let j = 0; j < 10; j++) {
        const q = Math.max(0, k - j * 0.025);
        const x = st.x0 + (st.x1 - st.x0) * q;
        const y = st.y0 + (st.y1 - st.y0) * q;
        b.fillStyle = j === 0 ? '#ffffff' : `rgba(200,220,255,${(1 - j / 10) * (1 - Math.max(0, st.t - 1.4))})`;
        b.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      if (st.t > 2.4) this.sky = null;
    }
    // The signs' shows.
    const sh = this.shown_;
    if (sh) {
      sh.t += dt;
      if (sh.id === 'bolt' && sh.t < 0.5) {
        b.fillStyle = `rgba(255,255,255,${0.6 * (1 - sh.t / 0.5)})`;
        b.fillRect(0, 0, AW, AH);
        b.fillStyle = '#ffffff';
        let x = FX + 6;
        for (let y = 0; y < FY - 6; y += 3) {
          x += Math.round((Math.random() - 0.5) * 6);
          b.fillRect(x, y, 1, 3);
        }
      }
      if (sh.id === 'light' && sh.t < 3) {
        const a = Math.sin((sh.t / 3) * Math.PI) * 0.35;
        b.fillStyle = `rgba(255,240,190,${a})`;
        b.fillRect(AW * 0.12, 0, 4, FY - 10);
      }
      if (sh.id === 'awe' && sh.t < 2.5) {
        b.strokeStyle = `rgba(255,220,120,${0.6 * (1 - sh.t / 2.5)})`;
        b.beginPath();
        b.ellipse(FX, FY - 2, 10 + sh.t * 18, 3 + sh.t * 6, 0, 0, Math.PI * 2);
        b.stroke();
      }
      if (sh.t > 3) this.shown_ = null;
    }
    // Rain falling (the sign, while it lasts).
    if ((s.rainUntil ?? 0) > s.day * DAY_SEC + s.clock) {
      b.fillStyle = 'rgba(150,180,230,0.5)';
      for (let i = 0; i < 50; i++) b.fillRect(Math.floor(((i * 31.3 + this.t * 30) % (AW + 10)) - 5), Math.floor((i * 19.7 + this.t * 160) % AH), 1, 3);
    }
  }

  /** The prayer meter and the signs known (redrawn only when something changes). */
  private signsUi(s: ShoreState): void {
    const box = this.el.querySelector<HTMLElement>('.hearth-signs')!;
    box.hidden = !praying(s);
    if (box.hidden) return;
    (box.querySelector('.prayer-bar i') as HTMLElement).style.width = `${Math.round(((s.prayer ?? 0) / prayerMost(s)) * 100)}%`;
    const known = MIRACLES.filter((m) => knowsSign(s, m.id));
    const key = known.map((m) => `${m.id}${signReady(s, m.id) ? 1 : 0}`).join();
    if (key === this.signsKey) return;
    this.signsKey = key;
    box.querySelector('.signs')!.innerHTML = known.map((m) => `<button class="px-btn sign${signReady(s, m.id) ? ' gold' : ' off'}" data-sign="${m.id}"><b>${m.name}</b><span class="tiny">${m.cost} · ${m.does}</span></button>`).join('');
  }

  /** The bonfire: long poles leaned together, standing in the flames (drawn over them). */
  private poles(s: ShoreState): void {
    if (!s.raftTaken || !s.ups.includes('bonfire')) return;
    const b = this.b;
    for (let k = 0; k < 4; k++) {
      const x0 = FX - 12 + k * 8;
      b.fillStyle = k % 2 ? '#3a2414' : '#4a2e1a';
      for (let y = 0; y < 26; y++) b.fillRect(Math.round(x0 + (FX - x0) * (y / 26)), FY - 4 - y, 1, 1);
    }
  }

  /** Set by the game each frame: whether the council's buying by itself (for the talk). */
  setCouncil(on: boolean): void {
    this.council = on;
  }

  private spark(burst = false): void {
    const a = (Math.random() - 0.5) * (burst ? 2.2 : 0.8);
    this.embers.push({ x: FX + (Math.random() - 0.5) * 14, y: FY - 6, vx: Math.sin(a) * (burst ? 40 : 8), vy: -(burst ? 50 : 20) - Math.random() * 30, life: 0.7 + Math.random(), age: 0, hot: 1 });
  }

  frame(s: ShoreState, dt: number): void {
    if (!this.shown) return;
    this.t += dt;
    const heat = s.raftTaken ? Math.min(1, s.heat ?? 0) : 0;
    const tip = this.el.querySelector<HTMLElement>('.hearth-tip');
    const tipText = s.raftTaken ? 'Tap the fire to stoke it' : 'Tap the raft: break it up, and light the hearth';
    if (tip && tip.textContent !== tipText) {
      tip.textContent = tipText;
      tip.classList.remove('gone');
    }
    const size = 0.35 + heat * 0.65 + this.flare * 0.25;
    this.flare = Math.max(0, this.flare - dt * 2.5);

    // New flames at the base, more and taller the hotter it is.
    const n = s.raftTaken ? Math.round((8 + heat * 26) * dt * 10) : 0;
    for (let i = 0; i < n; i++) {
      const w = 8 + size * 12;
      this.flames.push({ x: FX + (Math.random() - 0.5) * w, y: FY - 3, vx: (Math.random() - 0.5) * 4, vy: -(14 + Math.random() * 18) * (0.6 + size), life: 0.5 + Math.random() * 0.5 * size, age: 0, hot: Math.random() });
    }
    if (s.raftTaken && Math.random() < dt * (0.5 + heat * 4)) this.spark();
    for (const p of this.flames) {
      p.age += dt;
      p.x += (p.vx + (FX - p.x) * 1.6) * dt;
      p.y += p.vy * dt;
    }
    this.flames = this.flames.filter((p) => p.age < p.life);
    for (const p of this.embers) {
      p.age += dt;
      p.vx += Math.sin(this.t * 3 + p.y * 0.1) * 20 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.3;
    }
    this.embers = this.embers.filter((p) => p.age < p.life && p.y > -4);

    const b = this.b;
    b.imageSmoothingEnabled = false;
    // Night, warmer near the fire the bigger it is.
    const sky = b.createLinearGradient(0, 0, 0, AH);
    sky.addColorStop(0, '#0c0e1a');
    sky.addColorStop(0.62, mix('#141a2c', '#3a2418', heat * 0.6));
    sky.addColorStop(1, '#0e0c10');
    b.fillStyle = sky;
    b.fillRect(0, 0, AW, AH);
    // Stars, steady.
    b.fillStyle = '#c8d0e8';
    for (let i = 0; i < 26; i++) {
      const sx = (i * 47.3) % AW;
      const sy = (i * 29.7) % 70;
      if ((Math.sin(this.t * 0.8 + i) + 1) / 2 > 0.25 + heat * 0.5) b.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
    }
    // The ground, and the glow on it.
    b.fillStyle = '#1c1a16';
    b.fillRect(0, FY - 8, AW, AH - FY + 8);
    const glowR = 24 + size * 46 + Math.sin(this.t * 9) * 1.5;
    const g = b.createRadialGradient(FX, FY - 6, 2, FX, FY - 6, glowR);
    g.addColorStop(0, `rgba(255,170,70,${0.45 + 0.3 * heat})`);
    g.addColorStop(0.5, `rgba(220,90,30,${0.15 + 0.15 * heat})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    if (s.raftTaken) b.fillRect(0, 0, AW, AH);
    this.ground(s, heat);

    // Critters round the fire, lit on the side that faces it: the first eight of the village,
    // each in their own coat, with their own name and voice.
    this.seat(s);
    const seats = this.seats.length;
    this.emotes = this.emotes.filter((e) => e.seat < seats);
    // Left a while with the fire low, they nod off; with it roaring, they sit back from it.
    this.still += dt;
    if (seats && heat < 0.1 && this.still > 8 && Math.random() < dt * 0.3 && !this.emotes.some((e) => e.kind === 'zzz')) {
      this.emotes.push({ seat: Math.floor(Math.random() * seats), kind: 'zzz', age: 0 });
    }
    if (seats && heat > 0.85 && Math.random() < dt * 0.4 && !this.emotes.some((e) => e.kind === 'sweat')) {
      this.emotes.push({ seat: Math.floor(Math.random() * seats), kind: 'sweat', age: 0 });
    }
    const sitBack = 32 + heat * 4;
    const ring: Spot[] = [];
    for (let i = 0; i < seats; i++) {
      const a = Math.PI * 2 * ((i + 0.5) / seats) + 0.3;
      const st = this.seats[i];
      // (Now and then one hops by themselves: restless, or just glad of the fire.)
      // (Children can't sit still: they bounce about four times as often, and higher for their size.)
      const kid = st.size < 1;
      if (!st.hop && Math.random() < dt * (0.04 + heat * 0.08) * (kid ? 4 : 1)) {
        Object.assign(st, { hop: 0.0001, wait: 0, high: kid ? 2 + Math.random() * 2 : 1 + Math.random() * 1.5 });
        if (Math.random() < 0.3) this.squeakFrom(i, 0.08);
      }
      let lift = 0;
      if (st.hop > 0) {
        if (st.wait > 0) st.wait -= dt;
        else {
          st.hop += dt;
          const k = st.hop / HOP_TIME;
          lift = Math.sin(Math.min(1, k) * Math.PI) * st.high;
          if (k >= 1) st.hop = 0;
        }
      }
      if (st.turn > 0) st.turn = Math.max(0, st.turn - dt);
      const faceIn = Math.cos(a) > 0;
      const base = FY + 5 + Math.sin(a) * 9;
      ring.push({ x: FX + Math.cos(a) * sitBack, y: base - lift, base, left: st.turn > 0.2 ? !faceIn : faceIn, i });
    }
    // (Drawn back to front by where they sit, not where they've hopped to.)
    ring.sort((p, q) => p.base - q.base);
    this.spots = ring;
    const back = ring.filter((r) => r.base < FY + 5);
    const front = ring.filter((r) => r.base >= FY + 5);
    // Their shadows, thrown away from the fire: longer when it's low, flickering with it, and
    // smaller and fainter when they're up in the air.
    for (const r of s.raftTaken ? ring : []) {
      // (Away from the fire across the ground: the ground's seen at a slant, so it's squashed.)
      const dx = r.x - FX;
      const dy = (r.base - FY) * 2.5;
      const d = Math.hypot(dx, dy) || 1;
      const lift = r.base - r.y;
      const len = (9 + (1 - heat) * 7 + Math.sin(this.t * 11 + r.i) * 0.7) * (1 - lift / 14) * (this.seats[r.i]?.size ?? 1);
      const ux = dx / d;
      const uy = (dy / d) * 0.4;
      b.save();
      b.translate(r.x + ux * len * 0.5, r.base + uy * len * 0.5 + 0.5);
      b.rotate(Math.atan2(uy, ux));
      b.scale(1, 0.32);
      const sh = b.createRadialGradient(0, 0, 0, 0, 0, len * 0.62);
      const alpha = (0.5 + heat * 0.15) * (1 - lift / 10);
      sh.addColorStop(0, `rgba(0,0,0,${alpha.toFixed(3)})`);
      sh.addColorStop(0.7, `rgba(0,0,0,${(alpha * 0.6).toFixed(3)})`);
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = sh;
      b.beginPath();
      b.arc(0, 0, len * 0.62, 0, Math.PI * 2);
      b.fill();
      b.restore();
    }
    const critter = (r: Spot) => {
      const st = this.seats[r.i];
      if (!st.look) return;
      drawCreature(b, st.look, Math.round(r.x), Math.round(r.y), { left: r.left, frame: st.hop && st.wait <= 0 ? 1 : 0, size: st.size });
    };
    for (const r of back) critter(r);

    if (!s.raftTaken) {
      // Not lit yet: the raft they came on, pulled up the beach (planks lashed across), as big
      // as the crew it carried.
      const n = s.raft ?? 4;
      const half = Math.min(36, 12 + n * 2);
      const rows = 5 + Math.min(4, Math.floor(n / 3));
      for (let i = 0; i < rows; i++) {
        b.fillStyle = i % 2 ? '#7a5634' : '#6a4a2c';
        b.fillRect(FX - half, FY - 8 - (rows - 6) * 2 + i * 2, half * 2, 2);
      }
      b.fillStyle = '#c8a870';
      const lashes = Math.max(2, Math.floor(n / 2));
      for (let k = 0; k < lashes; k++) b.fillRect(Math.round(FX - half + 4 + (k * (half * 2 - 8)) / (lashes - 1)), FY - 9 - (rows - 6) * 2, 1, rows * 2 + 1);
    } else this.pit(s, heat);

    // The flames: white-hot at the heart, yellow, orange, red at the tips.
    for (const p of this.flames) {
      const k = p.age / p.life;
      const r = Math.max(1, Math.round((1 - k) * (2 + size * 4)));
      b.fillStyle = k < 0.15 ? '#fff4c8' : k < 0.4 ? '#ffd24a' : k < 0.7 ? '#ff8a2a' : '#c83a1a';
      b.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), r, r);
    }
    this.poles(s);
    // A stormy island: rain slanting through the firelight.
    if (s.nature === 'stormy') {
      b.fillStyle = 'rgba(160,180,220,0.45)';
      for (let i = 0; i < 40; i++) {
        const x = ((i * 37.7 + this.t * 60) % (AW + 20)) - 10;
        const y = (i * 23.3 + this.t * 140) % AH;
        b.fillRect(Math.floor(x), Math.floor(y), 1, 3);
      }
    }
    for (const p of this.embers) {
      b.fillStyle = p.age / p.life < 0.5 ? '#ffd24a' : '#e0602a';
      b.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    for (const r of front) critter(r);
    // What they're saying, over their heads (rising a little, then gone).
    for (const e of this.emotes) {
      e.age += dt;
      const r = ring.find((q) => q.i === e.seat);
      const pic = EMOTES[e.kind];
      if (!r) continue;
      const life = e.kind === 'zzz' ? 2.4 : 1.1;
      if (e.age > life) continue;
      const rise = Math.round(e.age * (e.kind === 'zzz' ? 3 : 5));
      const x0 = Math.round(r.x + (r.left ? -4 : 4) - pic.rows[0].length / 2);
      const y0 = Math.round(r.y - 22 * (this.seats[e.seat]?.size ?? 1) - rise - pic.rows.length);
      if (e.age > life - 0.3 && Math.floor(e.age * 12) % 2) continue;
      b.fillStyle = '#000';
      pic.rows.forEach((row, yy) => [...row].forEach((ch, xx) => ch === 'x' && b.fillRect(x0 + xx - 1, y0 + yy - 1, 3, 3)));
      b.fillStyle = pic.color;
      pic.rows.forEach((row, yy) => [...row].forEach((ch, xx) => ch === 'x' && b.fillRect(x0 + xx, y0 + yy, 1, 1)));
    }
    this.emotes = this.emotes.filter((e) => e.age <= (e.kind === 'zzz' ? 2.4 : 1.1));
    this.talk(s, dt);

    this.voice(s, dt);
    this.signsUi(s);
    // The words: how hot, and what it's worth.
    const more = fireMore(s);
    this.bar.style.width = `${Math.round(heat * 100)}%`;
    const text = `Stoke +${format(D(tapValue(s)))} · all food ×${(1 + more).toFixed(2)} (max ×${1 + fireMost(s)}) · ${format(D(foodRate(s)))}/s`;
    if (this.stats.textContent !== text) this.stats.textContent = text;
  }
}

/** How big a child is drawn as they grow (a newborn under half; nearly grown still clearly
 * smaller than the grown), and the grown at full size. */
export function childSize(g: number): number {
  return g >= 1 ? 1 : 0.35 + 0.3 * g;
}

/** A small seeded random (the same island, the same pebbles). */
function seeded(seed: number): () => number {
  let x = Math.imul(seed | 0, 2654435761 | 0) >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** Who someone is, for the talk: their name, how old they are, what they're like. */
function speaker(s: ShoreState, id: number): Speaker {
  const p = s.people.find((q) => q.id === id)!;
  const g = growth(s, p);
  const today = s.day + s.clock / DAY_SEC;
  const old = p.dies !== undefined && (p.dies - today) < (p.dies - p.born) * 0.3;
  const age: Age = g < 0.5 ? 'little' : g < 1 ? 'youngster' : old ? 'elder' : 'grown';
  const temper = temperOf(p);
  return { name: p.name, age, temper, crossed: !!p.founder };
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
}
