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

export class HearthView {
  readonly el: HTMLElement;
  private c: HTMLCanvasElement;
  private b: CanvasRenderingContext2D;
  private stats: HTMLElement;
  private bar: HTMLElement;
  private flames: Bit[] = [];
  private embers: Bit[] = [];
  private flare = 0;
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
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const got = this.onStoke(e.clientX, e.clientY);
      if (!got) return;
      this.flare = 1;
      for (let i = 0; i < 5; i++) this.spark(true);
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
    const ring: [number, number, boolean][] = [];
    for (let i = 0; i < seats; i++) {
      const a = Math.PI * 2 * ((i + 0.5) / seats) + 0.3;
      ring.push([FX + Math.cos(a) * 32, FY + 5 + Math.sin(a) * 9, Math.cos(a) > 0]);
    }
    ring.sort((p, q) => p[1] - q[1]);
    const back = ring.filter((r) => r[1] < FY + 5);
    const front = ring.filter((r) => r[1] >= FY + 5);
    if (s.look) for (const [x, y, left] of back) drawCreature(b, s.look, Math.round(x), Math.round(y), { left });

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
    if (s.look) for (const [x, y, left] of front) drawCreature(b, s.look, Math.round(x), Math.round(y), { left });

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
