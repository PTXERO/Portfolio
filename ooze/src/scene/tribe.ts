// The Extinction's map: the island after the strike. The same 2.5D, lit land as the
// Creature's (this builds on its scene), all of it burnt grey and black and still smouldering,
// fissures torn out from the spear, which stands in a small lake at the island's heart. The
// survivors huddle at the old home; one of them (the one you were) walks out to the spear, and
// when you touch it they wake. After that they go about the ash on their own.

import { PAL } from '../art/sprites';
import { SEASON_SEC } from '../economy/rates';
import { CELLS, ISLAND, isLand, type Island, type Pt } from '../economy/island';
import { BURNT, LAKE, ashenFor, tribeOf } from '../economy/tribal';
import type { GameState } from '../economy/types';
import { creatureLookOf } from './creatureLook';
import { hash, type Frame } from './paint';
import { RangeScene } from './range';

interface Person {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
  /** Where it's headed next, and seconds before it picks somewhere else. */
  goal: Pt | null;
  wait: number;
  /** When the waking reached it (scene seconds; -1 not yet). */
  lit: number;
}

/** Every cell seen: there is no fog on what's left (they know every step of it). */
const ALL_SEEN = new Uint8Array(CELLS * CELLS).fill(1);
const DAY_SEC = 120;
/** How long the fire takes to run over the island after the strike (seconds). */
const BURN_SEC = 9;
/** How fast the waking spreads back over the ash to the others (tiles a second, at the least),
 * and how long it takes to reach the camp however far it is. */
const SPREAD_SPEED = 9;
const SPREAD_SEC = 4;
/** How fast the spear turns in its pool. */
const SPIN = 1.2;

export class TribeScene extends RangeScene {
  private people: Person[] = [];
  /** The one that walks to the spear: where it is, and whether it's got there. */
  private walker: Pt | null = null;
  arrived = false;
  /** Holds the walk (while the strike is still playing over it). */
  hold = false;
  /** The shockwave when they wake: seconds since it went out (-1 when there isn't one). */
  private wave = -1;
  private smoke: { x: number; y: number; z: number; life: number }[] = [];
  private placed = false;
  /** The camera handed on from the Creature's map at the strike. */
  private handed: { x: number; y: number; z: number } | null = null;
  /** The burning after the strike: when it started (scene seconds), whether it's over, and the
   * ground it's painting (green and ash, and the order each cell catches). */
  private burnAt = -1;
  private burnReach = 1;
  private burnDone = false;
  private burn: { cv: HTMLCanvasElement; img: ImageData; green: Uint8ClampedArray; ash: Uint8ClampedArray; order: Float32Array; v: number; season: number } | null = null;
  /** When the strike let go of the walk (scene seconds). */
  private released = -1;
  /** The waking spreading to the others: when it set out (scene seconds), or asked for. */
  private spreadAt = -1;
  private spreadPending = false;
  /** Woken before this scene was opened (a reload): everyone's already lit. */
  private allLit = false;
  private firstLook = true;
  private seedSeen = -1;

  reset(): void {
    super.reset();
    this.people = [];
    this.walker = null;
    this.arrived = false;
    this.handed = null;
    this.burnAt = -1;
    this.burnDone = false;
    this.burn = null;
    this.released = -1;
    this.spreadAt = -1;
    this.spreadPending = false;
    this.allLit = false;
    this.firstLook = true;
    this.placed = false;
    this.auto = false;
  }

  tap(state: GameState, ax: number, ay: number): void {
    const t = tribeOf(state);
    if (!t || !this.island) return;
    const { spear } = ashenFor(state);
    // The spear: once the walker has reached it, touching it is how they wake.
    const X = this.sx(spear.x);
    const Y = this.py(spear.x, spear.y);
    const tall = this.spearHeight();
    if (!t.awake && this.arrived && Math.abs(ax - X) < Math.max(8, tall * 0.25) && ay > Y - tall - 4 && ay < Y + 4) {
      this.events.push({ type: 'spear', x: X, y: Y - tall });
      this.wave = 0;
    }
  }

  /** Sends the waking out from the one at the spear to the others. */
  spreadWake(): void {
    this.spreadPending = true;
  }

  /** A point of light over a head (`age` seconds old): flaring, then fading upward. */
  private spark(b: CanvasRenderingContext2D, x: number, y: number, age: number): void {
    const a = age < 0.3 ? age / 0.3 : Math.max(0, 1 - (age - 0.3) / 2.7);
    if (a <= 0) return;
    const X = Math.round(this.sx(x));
    const Y = Math.round(this.py(x, y) - Math.max(6, 2.2 * this.zoom) - age * 2);
    b.globalAlpha = a;
    b.fillStyle = 'rgba(255, 236, 170, 0.996)';
    b.fillRect(X - 1, Y, 3, 1);
    b.fillRect(X, Y - 1, 1, 3);
    b.fillStyle = 'rgba(255, 255, 250, 0.996)';
    b.fillRect(X, Y, 1, 1);
    b.globalAlpha = 1;
  }

  /** Takes the camera as the Creature's map left it (so the strike lands where it looked). */
  takeCamera(x: number, y: number, z: number): void {
    this.handed = { x, y, z };
    this.placed = false;
  }

  /** Paints the ground part burnt: ash inside the fire's reach, a glowing front, green beyond. */
  private paintBurn(is: Island, si: number, spear: Pt, p: number): void {
    const N = ISLAND;
    if (!this.burn || this.burn.season !== si) {
      const read = (cv: HTMLCanvasElement) => cv.getContext('2d')!.getImageData(0, 0, N, N).data;
      const green = read(this.paintGround({ ...is, scar: undefined }, si));
      const ash = read(this.ground.get(si)!);
      const order = new Float32Array(N * N);
      let far = 1;
      for (let i = 0; i < N * N; i++) if (is.height[i] > 0) far = Math.max(far, Math.hypot((i % N) - spear.x, Math.floor(i / N) - spear.y));
      for (let i = 0; i < N * N; i++) {
        const x = i % N;
        const y = Math.floor(i / N);
        // Ragged: it runs ahead in some places and lags in others.
        const rag = 0.88 + 0.24 * hash(Math.floor(x / 5) + Math.floor(y / 5) * 97, 51) + 0.06 * hash(x, y);
        order[i] = (Math.hypot(x - spear.x, y - spear.y) / far) * rag;
      }
      const cv = document.createElement('canvas');
      cv.width = N;
      cv.height = N;
      const img = cv.getContext('2d')!.createImageData(N, N);
      this.burn = { cv, img, green, ash, order, v: 0, season: si };
    }
    const { img, green, ash, order } = this.burn;
    const d = img.data;
    // Eased: it races out from the blow and slows as it reaches the shore.
    const reach = 1 - (1 - Math.min(1, p)) ** 2;
    this.burnReach = reach;
    const front = 0.05;
    for (let i = 0; i < N * N; i++) {
      const o = order[i];
      const j = i * 4;
      if (o < reach - front) {
        d[j] = ash[j];
        d[j + 1] = ash[j + 1];
        d[j + 2] = ash[j + 2];
      } else if (o < reach) {
        // The fire itself: white-yellow at the leading edge, red behind it, going to char.
        const k = (reach - o) / front;
        d[j] = 255 - 120 * k;
        d[j + 1] = 220 - 190 * k;
        d[j + 2] = 120 - 100 * k;
      } else {
        d[j] = green[j];
        d[j + 1] = green[j + 1];
        d[j + 2] = green[j + 2];
      }
      d[j + 3] = 255;
    }
    this.burn.cv.getContext('2d')!.putImageData(img, 0, 0);
    this.burn.cv.dataset.v = String(++this.burn.v);
  }

  /** How tall the spear stands on screen (art px): a giant, whatever the zoom. */
  private spearHeight(): number {
    // A fixed size in the world: it shrinks with the land as you zoom out.
    return 15 * this.zoom;
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt } = f;
    this.W = W;
    this.H = H;
    if (!this.viewBottom) this.viewTop = f.top;
    const tribe = tribeOf(state);
    if (!tribe) return;
    const frag = ashenFor(state);
    const is = frag.island;
    this.island = is;
    if (this.firstLook) {
      this.firstLook = false;
      this.allLit = tribe.awake;
    }
    if (this.spreadPending) {
      this.spreadPending = false;
      this.spreadAt = t;
    }
    // First look: the camera where the Creature's left it (at the strike), or on the camp.
    if (!this.placed || this.seedSeen !== is.seed) {
      const h = this.handed;
      this.camX = h ? h.x : tribe.awake ? (frag.camp.x + frag.spear.x) / 2 : frag.camp.x;
      this.camY = h ? h.y : tribe.awake ? (frag.camp.y + frag.spear.y) / 2 : frag.camp.y;
      this.zoom = h ? h.z : 3;
      this.handed = null;
      this.auto = false;
      this.placed = true;
      this.seedSeen = is.seed;
    }

    // Seasons by the tribe's own clock.
    const y = tribe.year % (SEASON_SEC * 4);
    const si = Math.floor(y / SEASON_SEC);
    const into = (y % SEASON_SEC) / SEASON_SEC;
    const blend = Math.max(0, Math.min(1, (into - 0.45) / 0.55));
    const turn = blend * blend * (3 - 2 * blend);
    const next = (si + 1) % 4;
    this.seasonBlend = turn;
    this.seasonPair = [si, next];
    if (this.groundSeed !== is.seed) {
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
    }
    if (!this.ground.has(si)) this.ground.set(si, this.paintGround(is, si));
    if (!this.ground.has(next)) this.ground.set(next, this.paintGround(is, next));
    this.groundPair = [this.ground.get(si)!, this.ground.get(next)!];
    // The burning: the first time the burnt island is seen (just after the strike), the fire
    // runs out from the spear across the green, leaving ash behind it.
    if (!this.burnDone) {
      if (this.burnAt < 0) {
        if (tribe.awake || tribe.year > 40) this.burnDone = true;
        else this.burnAt = t;
      }
      const p = (t - this.burnAt) / BURN_SEC;
      if (this.burnDone || p >= 1.15) {
        this.burnDone = true;
        this.burn = null;
      } else {
        this.paintBurn(is, si, frag.spear, p);
        this.groundPair = [this.burn!.cv, this.burn!.cv];
      }
    }
    this.paintFog(ALL_SEEN);
    b.imageSmoothingEnabled = false;
    if (this.shaded) b.clearRect(0, 0, W, H);
    else {
      b.fillStyle = '#24506e';
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(si)!);
    }

    const dayT = (t % DAY_SEC) / DAY_SEC;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    const sprites: { y: number; draw: () => void }[] = [];
    const look = creatureLookOf(state);

    // The world still smoulders: smoke curling up off the ash and embers glowing in it,
    // dying down over the first days (never quite out). A red haze over all of it at first.
    const heat = Math.max(0.15, 1 - tribe.year / 900);
    // Embers and smoke come from the burnt cells in view (the same cells every time).
    const c0 = this.toWorld(0, 0);
    const c1 = this.toWorld(W, H);
    const x0 = Math.max(0, Math.floor(Math.min(c0.x, c1.x)) - 2);
    const x1 = Math.min(ISLAND - 1, Math.ceil(Math.max(c0.x, c1.x)) + 2);
    const y0 = Math.max(0, Math.floor(Math.min(c0.y, c1.y)) - 2);
    const y1 = Math.min(ISLAND - 1, Math.ceil(Math.max(c0.y, c1.y)) + 6);
    // Zoomed out, only every so many cells are looked at: on a grid fixed to the world (and
    // stepping in doublings), so the same embers glow wherever the view is moved.
    const stride = 2 ** Math.max(0, Math.ceil(Math.log2(Math.sqrt(((x1 - x0) * (y1 - y0)) / 6000))));
    const embers: Pt[] = [];
    for (let y = y0 - (y0 % stride); y <= y1; y += stride) {
      for (let x = x0 - (x0 % stride); x <= x1; x += stride) {
        if (is.scar?.[y * ISLAND + x] === BURNT && hash(x * 7 + y * 131, 49) < 0.035 && (!this.burn || this.burn.order[y * ISLAND + x] < this.burnReach)) embers.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    if (embers.length && Math.random() < heat * dt * 12) {
      const e = embers[Math.floor(Math.random() * embers.length)];
      this.smoke.push({ x: e.x, y: e.y, z: 0, life: 5 + Math.random() * 3 });
    }
    for (const m of this.smoke) {
      m.life -= dt;
      m.z += dt * 4;
      m.x += dt * 0.5;
    }
    this.smoke = this.smoke.filter((m) => m.life > 0);
    embers.forEach((e) => {
      const glow = Math.sin(t * (0.8 + hash(Math.floor(e.x), Math.floor(e.y))) + e.x) * 0.5 + 0.5;
      if (glow < 1 - heat * 0.8) return;
      b.fillStyle = glow > 0.85 ? 'rgba(255, 170, 80, 0.996)' : 'rgba(220, 60, 30, 0.996)';
      b.fillRect(Math.round(this.sx(e.x)), Math.round(this.py(e.x, e.y)), 1, 1);
    });

    // The survivors (up to 40 drawn; more are about, off where you can't see them).
    const shown = Math.min(40, Math.max(1, Math.round(tribe.pop)));
    while (this.people.length < shown) {
      const k = this.people.length;
      const a = hash(k, 3) * Math.PI * 2;
      const d = 1 + hash(k, 5) * 4;
      this.people.push({ x: frag.camp.x + Math.cos(a) * d, y: frag.camp.y + Math.sin(a) * d * 0.7, vx: 0, vy: 0, ph: hash(k, 7) * 10, goal: null, wait: hash(k, 9) * 4, lit: this.allLit ? -100 : -1 });
    }
    this.people.length = shown;
    const sleeping = night > 0.5;
    // The waking spreading out from the one at the spear, back over the ash to the others.
    const from = this.walker ?? frag.spear;
    const spreadSpeed = Math.max(SPREAD_SPEED, Math.hypot(frag.camp.x - from.x, frag.camp.y - from.y) / SPREAD_SEC);
    const spread = this.spreadAt >= 0 ? (t - this.spreadAt) * spreadSpeed : -1;
    this.people.forEach((p, i) => {
      if (p.lit < 0 && spread >= 0 && Math.hypot(p.x - from.x, p.y - from.y) < spread) {
        p.lit = t;
        p.goal = null;
        p.vx = 0;
        p.vy = 0;
      }
      // A while after it reaches them they're still, looking toward the spear.
      const struck = p.lit >= 0 && t - p.lit < 4;
      const woke = tribe.awake && p.lit !== -1 && !struck;
      // Before waking they keep close to the camp, away from the spear; after, they range
      // over what's left, and some stand looking up at it.
      p.wait -= dt;
      if (struck) p.goal = { x: p.x, y: p.y };
      else if (!p.goal || p.wait <= 0) {
        p.wait = 4 + hash(i, Math.floor(t / 7)) * 8;
        if (!woke || sleeping) {
          const a = hash(i, Math.floor(t / 9) + 1) * Math.PI * 2;
          const r = sleeping ? 2 + hash(i, 13) * 3 : 3 + hash(i, 11) * 7;
          p.goal = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r * 0.7 };
        } else if (i % 5 === 0) {
          const a = hash(i, Math.floor(t / 11)) * Math.PI * 2;
          p.goal = { x: frag.spear.x + Math.cos(a) * (LAKE + 2), y: frag.spear.y + Math.sin(a) * (LAKE + 2) };
        } else {
          for (let k = 0; k < 8; k++) {
            const a = hash(i * 13 + k, Math.floor(t / 13)) * Math.PI * 2;
            const r = 4 + hash(i * 7 + k, 17) * 24;
            const g = { x: frag.camp.x + Math.cos(a) * r, y: frag.camp.y + Math.sin(a) * r };
            if (isLand(is, g.x, g.y) && Math.hypot(g.x - frag.spear.x, g.y - frag.spear.y) > LAKE + 3) {
              p.goal = g;
              break;
            }
          }
        }
      }
      let gx = p.goal?.x ?? p.x;
      let gy = p.goal?.y ?? p.y;
      for (const o of this.people) {
        if (o === p) continue;
        const ox = p.x - o.x;
        const oy = p.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < 2.4) {
          gx += (ox / od) * (2.4 - od) * 2.5;
          gy += (oy / od) * (2.4 - od) * 2.5;
        }
      }
      const dx = gx - p.x;
      const dy = gy - p.y;
      const d = Math.hypot(dx, dy);
      const sp = d > 0.3 ? 0.8 : 0;
      p.vx += ((d ? (dx / d) * Math.min(sp, d) : 0) - p.vx) * Math.min(1, dt * 3);
      p.vy += ((d ? (dy / d) * Math.min(sp, d) : 0) - p.vy) * Math.min(1, dt * 3);
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (isLand(is, nx, ny)) {
        p.x = nx;
        p.y = ny;
      }
      const moving = Math.hypot(p.vx, p.vy) > 0.12;
      const left = moving ? p.vx < 0 : frag.spear.x < p.x;
      const x = p.x;
      const yy = p.y;
      const hop = moving ? Math.abs(Math.sin(t * 7 + p.ph * 3)) * 2 : 0;
      const lit = p.lit >= 0 ? t - p.lit : -1;
      sprites.push({
        y: yy,
        draw: () => {
          this.drawBeing(b, look, x, yy, { left, frame: moving ? Math.floor(t * 8 + p.ph) % 2 : 0, sleeping: sleeping && !struck, hop });
          // The spark as it reaches them: a point of light over each head, fading.
          if (lit >= 0 && lit < 3) this.spark(b, x, yy, lit);
        },
      });
    });
    if (spread >= 0) {
      // The wave itself: a soft ring of gold going out over the ground.
      const reach = Math.max(...this.people.map((p) => Math.hypot(p.x - from.x, p.y - from.y)), 10);
      if (spread < reach + 6) {
        const X = this.sx(from.x);
        const Y = this.py(from.x, from.y);
        const rr = spread * this.zoom;
        const steps = Math.ceil(rr * 3) + 8;
        b.fillStyle = `rgba(255, 220, 140, ${0.996})`;
        b.globalAlpha = Math.max(0, 0.8 - spread / (reach + 6) * 0.5);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = Math.round(X + Math.cos(a) * rr);
          const y = Math.round(Y + Math.sin(a) * rr * (this.shaded ? 0.6 : 1));
          if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
          b.fillRect(x, y, 1, 1);
        }
        b.globalAlpha = 1;
        // The camera goes with it, out to the others.
        const front = Math.min(1, spread / reach);
        const k = Math.min(1, dt * 2.5);
        this.camX += (from.x + (frag.camp.x - from.x) * front - this.camX) * k;
        this.camY += (from.y + (frag.camp.y - from.y) * front - 3 - this.camY) * k;
      }
    }

    // The walk: before they wake, the one you were walks alone from the camp out over the ash
    // to the lake's edge, the camera with it. Once the waking has reached the others, it
    // walks back to them.
    if (tribe.awake && this.walker) {
      const w = this.walker;
      // After the vision it runs back to the others, behind the light going out to them.
      const back = this.spreadAt >= 0 && t - this.spreadAt > 0.8;
      const dx = frag.camp.x - w.x;
      const dy = frag.camp.y - w.y;
      const d = Math.hypot(dx, dy);
      if (back && d < 2) this.walker = null;
      else {
        if (back) {
          const step = Math.min(d, Math.max(6, Math.hypot(frag.camp.x - frag.spear.x, frag.camp.y - frag.spear.y) / 7) * dt);
          w.x += (dx / d) * step;
          w.y += (dy / d) * step;
        }
        const wx = w.x;
        const wy = w.y;
        const sinceTouch = this.wave >= 0 ? this.wave : 99;
        sprites.push({
          y: wy,
          draw: () => {
            this.drawBeing(b, look, wx, wy, { left: back ? dx < 0 : frag.spear.x < wx, frame: back ? Math.floor(t * 10) % 2 : 0, sleeping: false, hop: back ? Math.abs(Math.sin(t * 10)) * 2 : 0 });
            if (sinceTouch < 4) this.spark(b, wx, wy, sinceTouch * 0.75);
          },
        });
      }
    }
    if (!tribe.awake) {
      if (!this.walker) this.walker = { ...frag.camp };
      const w = this.walker;
      const dx = frag.spear.x - w.x;
      const dy = frag.spear.y - w.y;
      const d = Math.hypot(dx, dy);
      const stop = LAKE + 1.2;
      // After the strike, a beat while the camera finds them, then the walk.
      if (!this.hold && this.released < 0) this.released = t;
      const finding = this.hold || t - this.released < 3;
      const moving = d > stop + 0.05 && !finding;
      if (moving) {
        const sp = Math.max(2.5, Math.hypot(frag.spear.x - frag.camp.x, frag.spear.y - frag.camp.y) / 14);
        const step = Math.min(d - stop, sp * dt);
        w.x += (dx / d) * step;
        w.y += (dy / d) * step;
      } else if (d <= stop + 0.05) this.arrived = true;
      if (!this.hold) {
        const k = Math.min(1, dt * (finding ? 1.4 : 2.5));
        this.camX += (w.x - this.camX) * k;
        this.camY += (w.y - 3 - this.camY) * k;
        this.zoom += (3 - this.zoom) * Math.min(1, dt * (finding ? 1.2 : 2));
      }
      const wx = w.x;
      const wy = w.y;
      const hop = moving ? Math.abs(Math.sin(t * 7)) * 2 : 0;
      sprites.push({ y: wy, draw: () => this.drawBeing(b, look, wx, wy, { left: dx < 0, frame: moving ? Math.floor(t * 8) % 2 : 0, sleeping: false, hop }) });
    }

    // The goop round its foot, bubbling: slow blisters of glowing red rising and popping.
    for (let k = 0; k < 14; k++) {
      const cyc = (t * 0.35 + hash(k, 61) * 7) % 1;
      const a = hash(k, Math.floor(t * 0.35 + hash(k, 61) * 7) + 63) * Math.PI * 2;
      const r = Math.sqrt(hash(k, Math.floor(t * 0.35 + hash(k, 61) * 7) + 67)) * (LAKE - 0.8);
      const bx = Math.round(this.sx(frag.spear.x + Math.cos(a) * r));
      const by = Math.round(this.py(frag.spear.x + Math.cos(a) * r, frag.spear.y + Math.sin(a) * r));
      const size = cyc < 0.8 ? Math.max(1, Math.round((cyc / 0.8) * Math.max(1, this.zoom * 0.5))) : 0;
      if (size) {
        b.fillStyle = 'rgba(190, 60, 100, 0.996)';
        b.fillRect(bx - Math.floor(size / 2), by - size, size, size);
        b.fillStyle = 'rgba(255, 170, 200, 0.996)';
        b.fillRect(bx - Math.floor(size / 2), by - size, 1, 1);
      } else if (cyc < 0.86) {
        // Pop.
        b.fillStyle = 'rgba(255, 150, 180, 0.996)';
        b.fillRect(bx - 1, by - 1, 1, 1);
        b.fillRect(bx + 1, by - 1, 1, 1);
      }
    }

    // The spear, standing in its lake.
    const sx = this.sx(frag.spear.x);
    const sy = this.py(frag.spear.x, frag.spear.y);
    sprites.push({ y: frag.spear.y, draw: () => this.drawSpear(b, sx, sy, t, tribe.awake) });

    sprites.sort((a, c) => a.y - c.y);
    for (const s of sprites) s.draw();
    for (const m of this.smoke) {
      const X = Math.round(this.sx(m.x));
      const Y = Math.round(this.py(m.x, m.y) - m.z * this.zoom * 0.6);
      const k = Math.min(1, m.life / 2) * Math.min(1, m.z) * 0.3;
      b.fillStyle = `rgba(110, 104, 100, ${k})`;
      const sz = Math.max(1, Math.round((0.6 + m.z * 0.12) * this.zoom * 0.35));
      b.fillRect(X - sz, Y - sz, sz * 2, sz * 2);
    }

    // A red haze over the burnt world, thinning as it cools.
    b.fillStyle = `rgba(150, 30, 20, ${0.16 * heat})`;
    b.fillRect(0, 0, W, H);

    // The waking: a shockwave of purple and red light rolls out from the spear across the
    // whole world (it glows: the shader blooms it), the air itself tinted for a moment.
    if (this.wave >= 0) {
      this.wave += dt;
      const w = this.wave;
      // A flash as it's touched, then the air tinted purple.
      if (w < 0.25) {
        b.fillStyle = `rgba(255, 245, 255, ${1 - w / 0.25})`;
        b.fillRect(0, 0, W, H);
      }
      if (w < 2) {
        b.fillStyle = `rgba(150, 50, 180, ${0.35 * (1 - w / 2)})`;
        b.fillRect(0, 0, W, H);
      }
      const tall = this.spearHeight();
      const cy = sy - tall * 0.15;
      for (let k = 0; k < 4; k++) {
        const r = (w - k * 0.22) * Math.max(W, H) * 0.9;
        if (r <= 0) continue;
        const fade = Math.max(0, 1 - r / (Math.max(W, H) * 1.6));
        if (fade <= 0) continue;
        const col = k % 2 ? `rgba(230, 60, 90, 0.996)` : `rgba(170, 70, 255, 0.996)`;
        const steps = Math.ceil(r * 3);
        b.globalAlpha = fade;
        b.fillStyle = col;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = Math.round(sx + Math.cos(a) * r);
          const y2 = Math.round(cy + Math.sin(a) * r * 0.62);
          if (x < -2 || x > W + 2 || y2 < -2 || y2 > H + 2) continue;
          b.fillRect(x, y2, 2, 1);
        }
        b.globalAlpha = 1;
      }
      if (w > 5) this.wave = -1;
    }

    // Once there: a pulse at the spear, so it's plain it's the thing to touch.
    if (!tribe.awake && this.arrived && Math.floor(t * 1.5) % 2) {
      const tall = this.spearHeight();
      b.fillStyle = PAL.y;
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 10), 3, 5);
      b.fillRect(Math.round(sx) - 1, Math.round(sy - tall - 3), 3, 2);
    }
    this.fx.run(f);
  }

  /** The spear: a long twisted shaft, dark red and black, forked at the head, faint light
   * running up it. Not a thing anyone here could have made. */
  private drawSpear(b: CanvasRenderingContext2D, X: number, Y: number, t: number, awake: boolean): void {
    const tall = this.spearHeight();
    const w = Math.max(1, Math.round(tall / 22));
    const x0 = Math.round(X);
    const y0 = Math.round(Y);
    // Shadow, and the scorch where it went in.
    b.fillStyle = 'rgba(0, 0, 0, 0.35)';
    b.fillRect(x0 - 3 * w, y0, 7 * w, w);
    for (let i = 0; i < tall; i++) {
      // Two strands twisting round each other.
      const k = i / tall;
      // The strands twist round each other as the whole spear turns.
      const tw = Math.sin(k * 14 + t * SPIN) * w;
      b.fillStyle = '#5a1018';
      b.fillRect(x0 - w + Math.round(tw), y0 - i, w, 1);
      b.fillStyle = '#2a0a10';
      b.fillRect(x0 - Math.round(tw), y0 - i, w, 1);
      // Light running up it now and then (it glows, so the shader blooms it).
      const run = (t * 0.35 + k) % 1;
      if (run < 0.06) {
        b.fillStyle = 'rgba(255, 90, 110, 0.996)';
        b.fillRect(x0, y0 - i, 1, 1);
      }
    }
    // The fork: two prongs curving apart at the head.
    const top = y0 - tall;
    const prong = Math.max(4, Math.round(tall * 0.22));
    b.fillStyle = '#6a1420';
    // Turning slowly: the prongs swing round (seen edge-on, they close together).
    const turn = Math.cos(t * SPIN * 0.5);
    for (let i = 0; i < prong; i++) {
      const spread = Math.round((i / prong) ** 1.5 * prong * 0.45 * turn);
      b.fillRect(x0 - spread - w, top - i, w, 1);
      b.fillRect(x0 + spread, top - i, w, 1);
    }
    if (!awake || Math.sin(t * 2) > 0.6) {
      const tip = Math.round(prong * 0.45 * turn);
      b.fillStyle = 'rgba(255, 120, 140, 0.996)';
      b.fillRect(x0 - tip - w, top - prong, w, 1);
      b.fillRect(x0 + tip, top - prong, w, 1);
    }
  }
}
