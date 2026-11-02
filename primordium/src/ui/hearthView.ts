// The Hearth tab: the whole screen is the fire. Tap anywhere to stoke it. Every stoke cooks a
// batch of what's been brought in (food, there and then), and builds the fire up; a big fire
// cooks more of everything while it lasts, and it dies down by itself if it's left.

import { FIRE_MOST, fireMore, foodRate, tapValue, type ShoreState } from '../economy/shore';
import { drawCreature } from '../scene/creatureLook';
import { D, format } from '../economy/num';

/** The art's own size: drawn small, shown big, hard pixel edges. */
const AW = 90;
const AH = 160;
const FX = AW / 2;
const FY = 110;

interface Bit { x: number; y: number; vx: number; vy: number; life: number; age: number; hot: number }
/** What a critter round the fire is doing: hopping (seconds into it, after a moment's delay). */
interface Seat { hop: number; wait: number; high: number; turn: number }
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
      <div class="hearth-tip label">Tap the fire to stoke it</div>`;
    // (Under the top bar, the hints and the cards: over the map.)
    parent.insertBefore(this.el, parent.querySelector('#overlay-top'));
    this.c = this.el.querySelector('canvas')!;
    this.b = this.c.getContext('2d')!;
    this.stats = this.el.querySelector('.hearth-stats')!;
    this.bar = this.el.querySelector('.heat-bar i')!;
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
    const say = (kind: EmoteKind) => {
      const free = [...Array(n).keys()].filter((i) => !this.emotes.some((e) => e.seat === i));
      if (free.length) this.emotes.push({ seat: free[Math.floor(Math.random() * free.length)], kind, age: 0 });
    };
    if (woke) for (let i = 0; i < Math.min(3, n); i++) say('bang');
    else if (this.streak === 1) { if (Math.random() < 0.5) say('bang'); }
    else if (this.streak % 6 === 0) say(this.streak >= 18 ? 'heart' : 'note');
    else if (Math.random() < 0.08) say('note');
  }

  private spark(burst = false): void {
    const a = (Math.random() - 0.5) * (burst ? 2.2 : 0.8);
    this.embers.push({ x: FX + (Math.random() - 0.5) * 14, y: FY - 6, vx: Math.sin(a) * (burst ? 40 : 8), vy: -(burst ? 50 : 20) - Math.random() * 30, life: 0.7 + Math.random(), age: 0, hot: 1 });
  }

  frame(s: ShoreState, dt: number): void {
    if (!this.shown) return;
    this.t += dt;
    const heat = Math.min(1, s.heat ?? 0);
    const size = 0.35 + heat * 0.65 + this.flare * 0.25;
    this.flare = Math.max(0, this.flare - dt * 2.5);

    // New flames at the base, more and taller the hotter it is.
    const n = Math.round((8 + heat * 26) * dt * 10);
    for (let i = 0; i < n; i++) {
      const w = 8 + size * 12;
      this.flames.push({ x: FX + (Math.random() - 0.5) * w, y: FY - 3, vx: (Math.random() - 0.5) * 4, vy: -(14 + Math.random() * 18) * (0.6 + size), life: 0.5 + Math.random() * 0.5 * size, age: 0, hot: Math.random() });
    }
    if (Math.random() < dt * (0.5 + heat * 4)) this.spark();
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
    b.fillRect(0, 0, AW, AH);

    // Critters round the fire, lit on the side that faces it.
    // (As many as there are, up to eight: half behind the fire, half in front.)
    const seats = Math.min(8, Math.max(1, s.people.length));
    while (this.seats.length < seats) this.seats.push({ hop: 0, wait: 0, high: 0, turn: 0 });
    this.seats.length = seats;
    this.emotes = this.emotes.filter((e) => e.seat < seats);
    // Left a while with the fire low, they nod off; with it roaring, they sit back from it.
    this.still += dt;
    if (heat < 0.1 && this.still > 8 && Math.random() < dt * 0.3 && !this.emotes.some((e) => e.kind === 'zzz')) {
      this.emotes.push({ seat: Math.floor(Math.random() * seats), kind: 'zzz', age: 0 });
    }
    if (heat > 0.85 && Math.random() < dt * 0.4 && !this.emotes.some((e) => e.kind === 'sweat')) {
      this.emotes.push({ seat: Math.floor(Math.random() * seats), kind: 'sweat', age: 0 });
    }
    const sitBack = 32 + heat * 4;
    const ring: { x: number; y: number; left: boolean; i: number }[] = [];
    for (let i = 0; i < seats; i++) {
      const a = Math.PI * 2 * ((i + 0.5) / seats) + 0.3;
      const st = this.seats[i];
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
      ring.push({ x: FX + Math.cos(a) * sitBack, y: FY + 5 + Math.sin(a) * 9 - lift, left: st.turn > 0.2 ? !faceIn : faceIn, i });
    }
    // (Drawn back to front by where they sit, not where they've hopped to.)
    const base = (r: { i: number }) => FY + 5 + Math.sin(Math.PI * 2 * ((r.i + 0.5) / seats) + 0.3) * 9;
    ring.sort((p, q) => base(p) - base(q));
    const back = ring.filter((r) => base(r) < FY + 5);
    const front = ring.filter((r) => base(r) >= FY + 5);
    const critter = (r: { x: number; y: number; left: boolean; i: number }) => {
      const st = this.seats[r.i];
      // (Their shadow stays on the ground while they're up in the air.)
      if (st.hop && st.wait <= 0) {
        b.fillStyle = 'rgba(0,0,0,0.35)';
        b.fillRect(Math.round(r.x - 6), Math.round(base(r)), 12, 1);
      }
      drawCreature(b, s.look!, Math.round(r.x), Math.round(r.y), { left: r.left, frame: st.hop && st.wait <= 0 ? 1 : 0 });
    };
    if (s.look) for (const r of back) critter(r);

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
    if (s.look) for (const r of front) critter(r);
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

    // The words: how hot, and what it's worth.
    const more = fireMore(s);
    this.bar.style.width = `${Math.round(heat * 100)}%`;
    const text = `Each stoke +${format(D(tapValue(s)))} · the fire's heat: everything ×${(1 + more).toFixed(2)} (up to ×${1 + FIRE_MOST}) · ${format(D(foodRate(s)))}/s`;
    if (this.stats.textContent !== text) this.stats.textContent = text;
  }
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
}
