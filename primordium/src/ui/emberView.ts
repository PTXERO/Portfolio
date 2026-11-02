// The ember bed: what the islands left behind, full screen. The embers to spend are coals in a
// glowing bed at the bottom (sparks going up off them); what they buy, for good, is over them,
// each lit up as it's raised. Spending one sends its coals up into what it bought.

import { PERKS, type PerkId } from '../content/idle';
import { buyPerkOk, EMBER_BIRTHS, EMBER_MORE, embersLeft, perk, perkCost, type ShoreState } from '../economy/shore';
import { D, format } from '../economy/num';

/** The art's width in pixels (the height follows the screen). */
const AW = 160;
const MOST_COALS = 99;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** Flying to a bought card: where to (art px), and the card's id. */
  to?: { x: number; y: number };
  hot: number;
}

/** What a perk does now, and what the next level makes it. */
function nowNext(id: PerkId, lv: number): [string, string] {
  switch (id) {
    case 'seed':
      return [`${format(D(10).pow(lv + 1))} food on landing`, `${format(D(10).pow(lv + 2))}`];
    case 'trades':
      return [`Gatherers ×${2 ** lv}`, `×${2 ** (lv + 1)}`];
    case 'fireborn':
      return [`Births +${25 * lv}%`, `+${25 * (lv + 1)}%`];
    case 'coals':
      return [`Fire max +${(0.5 * lv).toFixed(1)}`, `+${(0.5 * (lv + 1)).toFixed(1)}`];
    case 'crew':
      return [`Raft +${lv} seat${lv === 1 ? '' : 's'}`, `+${lv + 1}`];
    case 'warsongs':
      return [`Battles cost ${15 * lv}% fewer`, `${15 * (lv + 1)}%`];
    case 'charts':
      return [lv ? 'Every village known on landing' : 'Land knowing every village', ''];
    case 'tender':
      return [lv ? 'Lands with the fire-tender' : 'Land with the fire-tender', ''];
    case 'envoy':
      return [lv ? 'Lands with the envoy' : 'Land with the envoy', ''];
    case 'council':
      return [lv ? 'Lands with the council, all it knew' : 'Land with the council, all it knew', ''];
  }
}

export class EmberView {
  readonly el: HTMLElement;
  private c: HTMLCanvasElement;
  private b: CanvasRenderingContext2D;
  private list: HTMLElement;
  private head: HTMLElement;
  private key = '';
  private sparks: Spark[] = [];
  private t = 0;
  private H = 340;
  /** Coals shown (eases to the embers there are: bought ones go up as sparks). */
  private shownCoals = -1;
  shown = false;

  constructor(
    private onBuy: (id: PerkId) => boolean,
    private onClose: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'embers';
    this.el.hidden = true;
    this.el.innerHTML = `<canvas></canvas>
      <div class="ember-top"><button class="px-btn ember-back" data-ember="back">Back</button><span class="label">The embers</span></div>
      <div class="ember-head"></div>
      <div class="ember-list"></div>`;
    document.body.appendChild(this.el);
    this.c = this.el.querySelector('canvas')!;
    this.b = this.c.getContext('2d')!;
    this.list = this.el.querySelector('.ember-list')!;
    this.head = this.el.querySelector('.ember-head')!;
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ember]');
      if (!btn) return;
      const what = btn.dataset.ember!;
      if (what === 'back') {
        this.onClose();
        return;
      }
      const card = btn.closest<HTMLElement>('.ember-card');
      if (!this.onBuy(what as PerkId)) return;
      // Up they go: the coals spent fly into what they bought.
      if (card) {
        const r = card.getBoundingClientRect();
        const k = AW / window.innerWidth;
        const to = { x: (r.left + r.width / 2) * k, y: (r.top + r.height / 2) * k };
        for (let i = 0; i < 40; i++) {
          const from = this.coalAt(Math.floor(Math.random() * Math.max(1, this.shownCoals)));
          this.sparks.push({ x: from.x, y: from.y, vx: (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 40, life: 0, max: 0.7 + Math.random() * 0.5, to, hot: 1 });
        }
        card.classList.remove('lit');
        void card.offsetWidth;
        card.classList.add('lit');
      }
    });
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.el.hidden = !on;
    document.body.classList.toggle('embers-open', on);
    if (on) {
      this.key = '';
      this.shownCoals = -1;
      this.sparks = [];
    }
  }

  frame(s: ShoreState, dt: number): void {
    if (!this.shown) return;
    this.t += dt;
    this.render(s);
    this.draw(s, Math.min(dt, 0.05));
  }

  /** The cards and the count, redrawn only when something's changed. */
  private render(s: ShoreState): void {
    const left = embersLeft(s);
    const key = JSON.stringify([left, s.embers, s.perks]);
    if (key === this.key) return;
    const first = !this.key;
    this.key = key;
    const all = s.embers ?? 0;
    this.head.innerHTML = `<div class="ember-count num">${left}</div><div class="label ember-sub">to spend</div>
      <div class="tiny ember-ever">${all} ever · food +${Math.round(all * EMBER_MORE * 100)}% · births +${Math.round(all * EMBER_BIRTHS * 100)}%<br><span class="dim">Spending keeps that.</span></div>`;
    const cards = PERKS.map((p) => {
      const lv = perk(s, p.id);
      const cost = perkCost(s, p.id);
      const ok = buyPerkOk(s, p.id);
      const [now, next] = nowNext(p.id, lv);
      const pips = Array.from({ length: p.most }, (_, i) => `<i${i < lv ? ' class="on"' : ''}></i>`).join('');
      const what = lv === 0 && p.most > 1 ? p.does : `${now}${next && cost !== null ? ` <b>→ ${next}</b>` : ''}`;
      return `<div class="ember-card${ok ? ' can' : ''}${cost === null ? ' full' : ''}" data-id="${p.id}">
        <div class="ember-name">${p.name}</div>
        <div class="ember-pips">${pips}</div>
        <div class="ember-does tiny">${what}</div>
        ${cost === null ? '<div class="ember-cost label">Full</div>' : `<button class="px-btn ember-buy${ok ? ' gold' : ''}" data-ember="${p.id}"${ok ? '' : ' disabled'}><span class="num">${cost}</span> ✦</button>`}
      </div>`;
    }).join('');
    // (Redrawn in place: the cards keep where they were scrolled to, and a just-bought one its glow.)
    const lit = this.list.querySelector('.ember-card.lit')?.getAttribute('data-id');
    const top = this.list.scrollTop;
    this.list.innerHTML = cards;
    this.list.scrollTop = top;
    if (lit && !first) this.list.querySelector(`[data-id="${lit}"]`)?.classList.add('lit');
  }

  /** Where the n-th coal lies in the bed (a heap, widest at the bottom, each row set between
   * the coals of the one under it). */
  private coalAt(n: number): { x: number; y: number } {
    let row = 0;
    let width = 17;
    let k = n;
    while (k >= width) {
      k -= width;
      row++;
      width = Math.max(2, 17 - row * 2);
    }
    const x = AW / 2 + (k - (width - 1) / 2) * 6 + ((row * 7 + k * 13) % 3) - 1;
    const y = this.H - 7 - row * 4 - ((k * 31 + row) % 4 === 0 ? 1 : 0);
    return { x, y };
  }

  private draw(s: ShoreState, dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const H = Math.round((AW * h) / w);
    if (this.c.width !== AW || this.c.height !== H) {
      this.c.width = AW;
      this.c.height = H;
      this.H = H;
    }
    const b = this.b;
    const coals = Math.min(MOST_COALS, embersLeft(s));
    if (this.shownCoals < 0) this.shownCoals = coals;
    // (Spent coals go out one by one; new ones glow up.)
    this.shownCoals += Math.sign(coals - this.shownCoals) * Math.min(Math.abs(coals - this.shownCoals), dt * 60);
    const n = Math.round(this.shownCoals);
    const all = Math.min(1, (s.embers ?? 0) / 60);
    // The dark, warmer near the bed.
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07070d');
    g.addColorStop(0.6, '#120a10');
    g.addColorStop(1, `rgb(${40 + all * 30}, ${14 + all * 6}, 10)`);
    b.fillStyle = g;
    b.fillRect(0, 0, AW, H);
    // The bed's glow.
    const flick = 0.85 + 0.15 * Math.sin(this.t * 7) * Math.sin(this.t * 2.3);
    const glow = b.createRadialGradient(AW / 2, H, 4, AW / 2, H, 30 + Math.sqrt(n) * 9);
    glow.addColorStop(0, `rgba(255, 140, 40, ${0.55 * flick * Math.min(1, 0.25 + n / 30)})`);
    glow.addColorStop(1, 'rgba(255, 80, 20, 0)');
    b.fillStyle = glow;
    b.fillRect(0, 0, AW, H);
    // The coals: each its own flicker.
    for (let i = 0; i < n; i++) {
      const p = this.coalAt(i);
      const f = 0.5 + 0.5 * Math.sin(this.t * (1.3 + (i % 7) * 0.31) + i * 2.1);
      const r = Math.round(120 + 135 * f);
      const gg = Math.round(30 + 120 * f * f);
      const X = Math.round(p.x) - 2;
      const Y = Math.round(p.y) - 2;
      // (A coal: dark crust, a hot heart that comes and goes.)
      b.fillStyle = '#2a0c06';
      b.fillRect(X, Y, 5, 4);
      b.fillStyle = `rgb(${r}, ${gg}, ${Math.round(10 + 40 * f * f * f)})`;
      b.fillRect(X + 1, Y, 3, 3);
      if (f > 0.7) {
        b.fillStyle = `rgba(255, 236, 170, ${(f - 0.7) * 3})`;
        b.fillRect(X + 2, Y + 1, 1, 1);
      }
    }
    // Sparks off the bed (more, the more there are), and the ones flying up into a bought card.
    if (n > 0 && Math.random() < dt * (3 + Math.min(n, 80) * 0.25)) {
      const p = this.coalAt(Math.floor(Math.random() * n));
      this.sparks.push({ x: p.x, y: p.y - 1, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 18, life: 0, max: 1.5 + Math.random() * 2.5, hot: Math.random() });
    }
    // (Drifting motes, high up, even with no coals: the dark isn't empty.)
    if (Math.random() < dt * 0.8) this.sparks.push({ x: Math.random() * AW, y: H * (0.4 + Math.random() * 0.5), vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 4, life: 0, max: 4 + Math.random() * 3, hot: 0.2 });
    const keep: Spark[] = [];
    for (const sp of this.sparks) {
      sp.life += dt;
      if (sp.to) {
        // (Pulled to the card, faster as they go.)
        const k = Math.min(1, sp.life / sp.max);
        sp.vx += (sp.to.x - sp.x) * dt * 14 * k;
        sp.vy += (sp.to.y - sp.y) * dt * 14 * k;
        sp.vx *= 1 - dt * 3;
        sp.vy *= 1 - dt * 3;
        if (Math.hypot(sp.to.x - sp.x, sp.to.y - sp.y) < 3 && sp.life > 0.3) continue;
      } else {
        sp.vx += Math.sin(this.t * 3 + sp.y * 0.2) * dt * 8;
      }
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      if (sp.life > sp.max * (sp.to ? 2.5 : 1) || sp.y < -4) continue;
      keep.push(sp);
      const fade = sp.to ? 1 : 1 - sp.life / sp.max;
      const hot = sp.to ? 1 : sp.hot * fade;
      b.fillStyle = `rgba(255, ${Math.round(110 + 130 * hot)}, ${Math.round(40 + 120 * hot * hot)}, ${Math.max(0, fade)})`;
      b.fillRect(Math.round(sp.x), Math.round(sp.y), sp.to ? 2 : 1, sp.to ? 2 : 1);
    }
    this.sparks = keep.slice(-400);
  }
}
