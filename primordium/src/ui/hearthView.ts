// The Hearth tab: the whole screen is the fire. Tap anywhere to stoke it. Every stoke cooks a
// batch of what's been brought in (food, there and then), and builds the fire up; a big fire
// cooks more of everything while it lasts, and it dies down by itself if it's left.

import { fireMost, fireMore, foodRate, shoreSeason, SEASON_NAMES, tapValue, type ShorePerson, type ShoreState } from '../economy/shore';
import { drawCreature, type CreatureLook } from '../scene/creatureLook';
import { pickTalk, type TalkCtx } from '../content/hearthTalk';
import { squeak } from '../audio/sound';
import { D, format } from '../economy/num';

/** The art's own size: drawn small, shown big, hard pixel edges. */
const AW = 90;
const AH = 160;
const FX = AW / 2;
const FY = 110;

interface Bit { x: number; y: number; vx: number; vy: number; life: number; age: number; hot: number }
/** What a critter round the fire is doing: hopping (seconds into it, after a moment's delay). */
interface Seat { hop: number; wait: number; high: number; turn: number; id: number; name: string; look?: CreatureLook; pitch: number }
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

  constructor(parent: HTMLElement, private onStoke: (x: number, y: number) => number) {
    this.el = document.createElement('div');
    this.el.id = 'hearth';
    this.el.hidden = true;
    this.el.innerHTML = `<canvas width="${AW}" height="${AH}"></canvas>
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
    const go = () => squeak(level, sp ? (sp.x - FX) / FX : 0, st.pitch);
    if (delay) setTimeout(go, delay * 1000);
    else go();
  }

  /** Who sits at the fire: the first eight of the village's own (a stranger's kind looks another way). */
  private seat(s: ShoreState): void {
    const own = s.people.filter((p: ShorePerson) => p.kind === undefined).slice(0, 8);
    const key = own.map((p) => p.id).join();
    if (key === this.seatKey) return;
    this.seatKey = key;
    const old = new Map(this.seats.map((st) => [st.id, st]));
    this.seats = own.map((p) => {
      const was = old.get(p.id);
      return was ?? { hop: 0, wait: 0, high: 0, turn: 0, id: p.id, name: p.name, look: s.look ? (p.genes ? { ...s.look, genes: p.genes } : s.look) : undefined, pitch: 0.85 + ((p.id * 37) % 40) / 100 };
    });
    this.chat = null;
    this.bubble.hidden = true;
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
      const ctx: TalkCtx = {
        a: this.seats[i].name,
        b: this.seats[j].name,
        heat: s.heat ?? 0,
        season: SEASON_NAMES[shoreSeason(s).si] as TalkCtx['season'],
        critters: s.people.length,
        food: format(D(s.food)),
        rate: foodRate(s),
        won: s.villages.filter((v) => v.won !== undefined).length,
        age: s.culture?.age ?? 1,
        young: others.length > 2 && s.day - others[others.length - 1].born < 40 ? others[others.length - 1].name : undefined,
        old: others.length > 2 ? others[0].name : undefined,
        foragers: s.gens.forager ?? 0,
        huts: (s.gens.hut ?? 0) + (s.gens.longhouse ?? 0),
        council: this.council,
      };
      const pick = pickTalk(ctx, this.lastTalks);
      this.lastTalks = [...this.lastTalks.slice(-8), pick.i];
      this.chat = { who: [i, j], lines: pick.lines, at: -1, t: LINE_SECS };
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
    const y = oy + (sp.y - 23) * k;
    const w = this.bubble.offsetWidth;
    this.bubble.style.left = `${Math.max(8, Math.min(r.width - w - 8, x - w / 2))}px`;
    this.bubble.style.top = `${Math.max(8, y - this.bubble.offsetHeight)}px`;
    this.bubble.style.setProperty('--tail', `${Math.max(12, Math.min(w - 12, x - Math.max(8, Math.min(r.width - w - 8, x - w / 2))))}px`);
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
      if (!st.hop && Math.random() < dt * (0.04 + heat * 0.08)) {
        Object.assign(st, { hop: 0.0001, wait: 0, high: 1 + Math.random() * 1.5 });
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
      const len = (9 + (1 - heat) * 7 + Math.sin(this.t * 11 + r.i) * 0.7) * (1 - lift / 14);
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
      // (A dark spot right under them while they're up in the air.)
      if (st.hop && st.wait <= 0) {
        b.fillStyle = 'rgba(0,0,0,0.35)';
        b.fillRect(Math.round(r.x - 5), Math.round(r.base), 10, 1);
      }
      drawCreature(b, st.look, Math.round(r.x), Math.round(r.y), { left: r.left, frame: st.hop && st.wait <= 0 ? 1 : 0 });
    };
    for (const r of back) critter(r);

    if (!s.raftTaken) {
      // Not lit yet: the raft they came on, pulled up the beach (planks lashed across).
      for (let i = 0; i < 6; i++) {
        b.fillStyle = i % 2 ? '#7a5634' : '#6a4a2c';
        b.fillRect(FX - 16, FY - 8 + i * 2, 32, 2);
      }
      b.fillStyle = '#c8a870';
      b.fillRect(FX - 11, FY - 9, 1, 13);
      b.fillRect(FX + 10, FY - 9, 1, 13);
    } else {
      // Stones and logs.
      b.fillStyle = '#4a4440';
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        b.fillRect(Math.round(FX + Math.cos(a) * 15 - 2), Math.round(FY + Math.sin(a) * 4 - 1), 4, 3);
      }
      b.fillStyle = '#5a3a22';
      b.fillRect(FX - 12, FY - 3, 24, 3);
      b.fillStyle = '#6e4a2a';
      b.fillRect(FX - 8, FY - 5, 16, 2);
      b.fillStyle = heat > 0.05 ? '#ff7a2a' : '#7a3a1a';
      b.fillRect(FX - 6, FY - 4, 12, 1);
    }

    // The flames: white-hot at the heart, yellow, orange, red at the tips.
    for (const p of this.flames) {
      const k = p.age / p.life;
      const r = Math.max(1, Math.round((1 - k) * (2 + size * 4)));
      b.fillStyle = k < 0.15 ? '#fff4c8' : k < 0.4 ? '#ffd24a' : k < 0.7 ? '#ff8a2a' : '#c83a1a';
      b.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), r, r);
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
      const y0 = Math.round(r.y - 22 - rise - pic.rows.length);
      if (e.age > life - 0.3 && Math.floor(e.age * 12) % 2) continue;
      b.fillStyle = '#000';
      pic.rows.forEach((row, yy) => [...row].forEach((ch, xx) => ch === 'x' && b.fillRect(x0 + xx - 1, y0 + yy - 1, 3, 3)));
      b.fillStyle = pic.color;
      pic.rows.forEach((row, yy) => [...row].forEach((ch, xx) => ch === 'x' && b.fillRect(x0 + xx, y0 + yy, 1, 1)));
    }
    this.emotes = this.emotes.filter((e) => e.age <= (e.kind === 'zzz' ? 2.4 : 1.1));
    this.talk(s, dt);

    // The words: how hot, and what it's worth.
    const more = fireMore(s);
    this.bar.style.width = `${Math.round(heat * 100)}%`;
    const text = `Each stoke +${format(D(tapValue(s)))} · the fire's heat: everything ×${(1 + more).toFixed(2)} (up to ×${1 + fireMost(s)}) · ${format(D(foodRate(s)))}/s`;
    if (this.stats.textContent !== text) this.stats.textContent = text;
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
}
