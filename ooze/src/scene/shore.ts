// New Shore on screen: the big island under its fog, the village laid out round the hearth
// (huts, racks, woodpiles, the camps), its people out at work by day and home round the fire
// by night, the chief walking wherever you send them, the graves of the four, and out in the
// fog the island's other villages, their smoke going up.

import { PAL } from '../art/sprites';
import { Biome, CELL, isLand, type Pt } from '../economy/island';
import { isAdult, relation, shoreIsland, shoreOf, shoreSeason, workPlan, type ShoreState, type Village } from '../economy/shore';
import type { GameState } from '../economy/types';
import type { BuildId } from '../content/shore';
import { RangeScene } from './range';
import { herdInView, squeak } from '../audio/sound';
import { hash, type Frame } from './paint';

interface Walker {
  id: number;
  x: number;
  y: number;
  goal: Pt | null;
  wait: number;
  ph: number;
  /** What they're out at: food, wood, or round the village. */
  job: 'food' | 'wood' | 'home';
}

/** Flag colours for what another village is to yours. */
const REL_COL = { kin: '#8acf6a', prey: PAL.y, predator: '#e8615a', enemy: '#9a2a2a' } as const;

export class ShoreScene extends RangeScene {
  // A new era, a new game: the land stands up more, seen from lower down, with the far side
  // fading into the air.
  protected lift = 30;
  protected tilt = 0.62;
  depth = 0.85;
  /** A season's ground being painted, a few rows a frame (the island's too big for one go). */
  private painting: { si: number; job: Generator<void, HTMLCanvasElement> } | null = null;
  private walkers: Walker[] = [];
  private locals = new Map<number, Walker[]>();
  private woods: Pt[] = [];
  private woodsSeed = -1;
  /** When each building first showed (scene seconds), for it to go up. */
  private raised = new Map<number, number>();
  private placed = -1;
  private lastT = 0;
  private chatter = 1;
  /** Looking at somewhere you chose (a village): the camera stays there, even as the sheet
   * opens or closes, until you send the chief somewhere. */
  private looking = false;

  reset(): void {
    super.reset();
    this.walkers = [];
    this.locals.clear();
    this.raised.clear();
    this.placed = -1;
  }

  /** Looks at a point (a found village, the hearth). */
  lookAt(p: Pt, zoom = 3): void {
    this.pinned = false;
    this.auto = false;
    this.looking = true;
    this.camX = p.x;
    this.camY = this.shaded ? p.y - (this.heightAt(p.x, p.y) * this.lift) / this.tilt : p.y;
    this.zoom = zoom;
  }

  /** Follow the chief again. */
  follow(): void {
    this.auto = true;
    this.looking = false;
  }

  setView(top: number, bottom: number): void {
    super.setView(top, bottom);
    if (this.looking) this.auto = false;
  }

  tap(state: GameState, ax: number, ay: number): void {
    const s = shoreOf(state);
    if (!s || !this.island) return;
    // A found village's flag, or one of your own.
    for (const v of s.villages) {
      if (!v.found || v.joined) continue;
      const X = this.sx(v.x);
      const Y = this.py(v.x, v.y);
      if (Math.hypot(ax - X, ay - (Y - 5)) < Math.max(8, this.zoom * 3)) {
        this.events.push({ type: 'village', id: v.id, x: X, y: Y - 10 });
        return;
      }
    }
    let best: Walker | null = null;
    let d0 = Math.max(5, this.zoom * 1.6);
    for (const w of this.walkers) {
      const d = Math.hypot(this.sx(w.x) - ax, this.py(w.x, w.y) - Math.max(2, this.zoom) - ay);
      if (d < d0) {
        d0 = d;
        best = w;
      }
    }
    if (best) {
      this.events.push({ type: 'villager', id: best.id, x: this.sx(best.x), y: this.py(best.x, best.y) - Math.max(8, this.zoom * 3) });
      return;
    }
    // Anywhere else on land: the chief walks there (and the camera goes with them).
    const at = this.toWorld(ax, ay);
    if (isLand(this.island, at.x, at.y)) {
      s.chiefTo = { x: at.x, y: at.y };
      this.follow();
    }
  }

  /** Forest near the village, where the wood is cut (found once). */
  private woodsNear(s: ShoreState): Pt[] {
    if (this.woodsSeed === s.seed) return this.woods;
    const is = this.island!;
    const out: Pt[] = [];
    for (let r = 6; r < 60 && out.length < 40; r += 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + r;
        const x = Math.round(s.hearth.x + Math.cos(a) * r);
        const y = Math.round(s.hearth.y + Math.sin(a) * r);
        if (is.biome[y * is.n + x] === Biome.Forest) out.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    if (!out.length) out.push({ x: s.hearth.x + 12, y: s.hearth.y - 6 });
    this.woods = out;
    this.woodsSeed = s.seed;
    return out;
  }

  draw(f: Frame, state: GameState): void {
    const { b, W, H, t, dt } = f;
    this.W = W;
    this.H = H;
    if (!this.viewBottom) this.viewTop = f.top;
    const s = shoreOf(state);
    if (!s) return;
    const is = shoreIsland(s.seed);
    this.island = is;
    this.ash = 0;
    const seen = state.stages.shore.seen;
    this.seenNow = seen;
    if (this.placed !== s.seed) {
      this.placed = s.seed;
      this.camX = s.chiefAt.x;
      this.camY = s.chiefAt.y;
      this.zoom = 3;
      this.auto = true;
      this.snap = true;
      // (What was already built is just there.)
      s.built.forEach((_, i) => this.raised.set(i, -99));
    }
    // The camera follows the chief until you take it.
    if (this.auto) {
      const me = s.chiefAt;
      const k = this.snap ? 1 : Math.min(1, dt * 3);
      const ty = this.shaded ? me.y - (this.heightAt(me.x, me.y) * this.lift) / this.tilt : me.y;
      this.camX += (me.x - this.camX) * k;
      this.camY += (ty - this.camY) * k;
      this.snap = false;
    }
    if (this.groundSeed !== is.seed) {
      this.ground.clear();
      this.fog = null;
      this.fogKnown = null;
      this.groundSeed = is.seed;
      this.painting = null;
    }
    // The seasons, by the village's own clock: each blends into the next over its second half.
    // The season on show is painted at once if it must be; the rest are painted ahead, a few
    // rows a frame, and a turn waits until its ground is ready.
    const { si, into } = shoreSeason(s);
    const next = (si + 1) % 4;
    if (!this.ground.has(si)) this.ground.set(si, this.paintGround(is, si));
    this.paintAhead(is, next, 4);
    const ready = this.ground.has(next);
    const bl = Math.max(0, Math.min(1, (into - 0.45) / 0.55));
    const turn = ready ? bl * bl * (3 - 2 * bl) : 0;
    this.seasonBlend = turn;
    this.seasonPair = [si, next];
    this.groundPair = [this.ground.get(si)!, ready ? this.ground.get(next)! : this.ground.get(si)!];
    this.paintFog(seen);
    b.imageSmoothingEnabled = false;
    if (this.shaded) b.clearRect(0, 0, W, H);
    else {
      b.fillStyle = '#24506e';
      b.fillRect(0, 0, W, H);
      this.blitWorld(b, this.ground.get(si)!);
    }

    const dayT = (t % 120) / 120;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    this.stepWeather(dt, si, next, turn, dayT);
    // In a storm (or a winter night) they keep to the village.
    const indoors = this.storm > 0.4;
    const z = Math.max(1, Math.round(this.zoom / 2.4));
    const close = this.zoom >= 1.6;
    const sprites: { y: number; draw: () => void }[] = [];
    const fogged = (x: number, y: number) => !seen[Math.floor(y / CELL) * (is.n / CELL) + Math.floor(x / CELL)];
    const onScreen = (X: number, Y: number, m = 20) => X > -m && X < W + m && Y > -m * 2 && Y < H + m;

    // ---- The village ----
    s.built.forEach((bd, i) => {
      if (!this.raised.has(i)) this.raised.set(i, t);
      const X = Math.round(this.sx(bd.x));
      const Y = Math.round(this.py(bd.x, bd.y));
      if (!onScreen(X, Y)) return;
      // Going up: it rises out of the ground over a few seconds, with dust.
      const up = Math.min(1, (t - this.raised.get(i)!) / 3);
      if (up < 1 && Math.random() < dt * 6) this.fx.dust(X, Y, 2);
      sprites.push({ y: bd.y, draw: () => this.drawBuild(b, bd.id, X, Y, z, close, up, t, s) });
    });
    for (const g of s.graves) {
      const X = Math.round(this.sx(g.x));
      const Y = Math.round(this.py(g.x, g.y));
      if (!close || !onScreen(X, Y)) continue;
      sprites.push({
        y: g.y,
        draw: () => {
          b.fillStyle = '#5a5248';
          b.fillRect(X - 2 * z, Y - z, 4 * z, z);
          b.fillStyle = '#8a8478';
          b.fillRect(X - z, Y - 3 * z, 2 * z, 2 * z);
        },
      });
    }
    // The hearth's flag when far out (so the village can be found again).
    if (!close && s.built.length) {
      const X = Math.round(this.sx(s.hearth.x));
      const Y = Math.round(this.py(s.hearth.x, s.hearth.y));
      sprites.push({
        y: s.hearth.y,
        draw: () => {
          b.fillStyle = PAL.k;
          b.fillRect(X, Y - 7, 1, 7);
          b.fillStyle = PAL.y;
          b.fillRect(X + 1, Y - 7, 3, 2);
        },
      });
    }

    // Their people: out at work by day (food out on the land, wood in the trees), home round
    // the hearth at night. The chief is drawn where they really are.
    this.syncWalkers(s, t);
    const plan = workPlan(s);
    const woods = this.woodsNear(s);
    let foodLeft = plan.food;
    let hopping = 0;
    let hopX = 0;
    const look = s.look;
    for (const w of this.walkers) {
      const p = s.people.find((q) => q.id === w.id);
      if (!p) continue;
      const grown = isAdult(s, p);
      const isChief = p.id === s.chief;
      if (isChief) {
        w.x = s.chiefAt.x;
        w.y = s.chiefAt.y;
      } else {
        w.job = !grown || night > 0.5 || indoors ? 'home' : foodLeft-- > 0 ? 'food' : 'wood';
        w.wait -= dt;
        if (!w.goal || w.wait <= 0) {
          w.wait = 4 + hash(w.id, Math.floor(t / 7)) * 6;
          const a = hash(w.id * 7, Math.floor(t / 9)) * Math.PI * 2;
          let g: Pt;
          if (w.job === 'wood') g = woods[(w.id * 7 + Math.floor(t / 30)) % woods.length];
          else if (w.job === 'food') {
            const r = 14 + hash(w.id, 3 + Math.floor(t / 40)) * 22;
            g = { x: s.hearth.x + Math.cos(a) * r, y: s.hearth.y + Math.sin(a) * r * 0.8 };
          } else {
            const r = night > 0.5 ? 2 + hash(w.id, 5) * 3 : 2 + hash(w.id, 6) * 9;
            g = { x: s.hearth.x + Math.cos(a) * r, y: s.hearth.y + Math.sin(a) * r * 0.7 };
          }
          w.goal = isLand(is, g.x, g.y) ? g : { ...s.hearth };
        }
        const dx = w.goal.x - w.x;
        const dy = w.goal.y - w.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.3) {
          const sp = (grown ? 1.6 : 1.1) * dt;
          w.x += (dx / d) * Math.min(d, sp);
          w.y += (dy / d) * Math.min(d, sp);
        }
      }
      const moving = isChief ? !!s.chiefTo : !!w.goal && Math.hypot(w.goal.x - w.x, w.goal.y - w.y) > 0.3;
      const x = w.x;
      const y = w.y;
      if (fogged(x, y) && !isChief) continue;
      const X = this.sx(x);
      const Y = this.py(x, y);
      if (!onScreen(X, Y)) continue;
      if (moving && Y > this.viewTop && Y < (this.viewBottom || H)) {
        hopping++;
        hopX += X;
      }
      const left = moving ? (isChief ? (s.chiefTo?.x ?? x) < x : (w.goal?.x ?? x) < x) : hash(w.id, Math.floor(t / 5)) < 0.5;
      const sleeping = night > 0.5 && !moving && !isChief;
      const kin = p.kind !== undefined ? s.villages.find((v) => v.id === p.kind)?.look ?? look : look;
      sprites.push({ y, draw: () => this.drawBeing(b, kin, x, y, { left, frame: moving ? Math.floor(t * 7 + w.ph) % 2 : 0, sleeping, hero: isChief, hop: moving ? Math.abs(Math.sin(t * 7 + w.ph)) * 1.5 : 0 }) });
    }
    // The raft they came on, pulled up on the beach where it landed.
    {
      const r = { x: s.beach.x - 2, y: s.beach.y + 1 };
      const X = Math.round(this.sx(r.x));
      const Y = Math.round(this.py(r.x, r.y));
      if (close && onScreen(X, Y)) {
        sprites.push({
          y: r.y - 0.5,
          draw: () => {
            b.fillStyle = '#6a4a30';
            for (let k = 0; k < 4; k++) b.fillRect(X - 5 * z, Y - (4 - k) * z, 10 * z, z);
            b.fillStyle = '#c8b080';
            b.fillRect(X - 3 * z, Y - 4 * z, z, 4 * z);
            b.fillRect(X + 2 * z, Y - 4 * z, z, 4 * z);
          },
        });
      }
    }
    // The scouts, out in the fog for you (seen wherever they are, a pennant over them).
    for (const sc of s.scouts ?? []) {
      const moving = !!sc.to;
      const x = sc.at.x;
      const y = sc.at.y;
      const X = this.sx(x);
      const Y = this.py(x, y);
      if (!onScreen(X, Y)) continue;
      if (moving && Y > this.viewTop && Y < (this.viewBottom || H)) {
        hopping++;
        hopX += X;
      }
      const left = (sc.to?.x ?? x) < x;
      sprites.push({
        y,
        draw: () => {
          this.drawBeing(b, look, x, y, { left, frame: moving ? Math.floor(t * 7) % 2 : 0, hop: moving ? Math.abs(Math.sin(t * 7)) * 1.5 : 0 });
          const fy = Math.round(Y) - (close ? 6 * z + 6 : 6);
          b.fillStyle = PAL.k;
          b.fillRect(Math.round(X), fy, 1, 4);
          b.fillStyle = PAL.y;
          b.fillRect(Math.round(X) + 1, fy, 2, 2);
        },
      });
    }
    // Out and about, they squeak (heard up close, quieter as the view pulls back).
    herdInView(hopping > 0);
    if (hopping) {
      this.chatter -= dt * Math.min(3, 0.6 + hopping * 0.3);
      if (this.chatter <= 0) {
        this.chatter = 0.5 + Math.random() * 1.4;
        const near = Math.max(0, Math.min(1, (this.zoom - 1.2) / 6.8));
        squeak(0.45 * near ** 1.2, (hopX / hopping / W) * 2 - 1);
      }
    }
    // Where the chief is going: a small marker on the ground.
    if (s.chiefTo) {
      const X = Math.round(this.sx(s.chiefTo.x));
      const Y = Math.round(this.py(s.chiefTo.x, s.chiefTo.y));
      const blink = Math.floor(t * 3) % 2;
      b.fillStyle = blink ? PAL.y : PAL.w;
      b.fillRect(X - 2, Y, 1, 1);
      b.fillRect(X + 2, Y, 1, 1);
      b.fillRect(X, Y - 2, 1, 1);
      b.fillRect(X, Y + 2, 1, 1);
    }

    // ---- The island's other villages ----
    for (const v of s.villages) this.drawVillage(b, sprites, s, v, t, dt, z, close, fogged);

    this.wild.update(this.wildView, is, sprites, { b, t, dt, nests: [s.hearth], season: si, night, feet: this.walkers, me: s.chiefAt });
    this.trails.update(is.seed, this.walkers.filter((w) => w.goal && Math.hypot(w.goal.x - w.x, w.goal.y - w.y) > 0.3), dt, is.n);
    sprites.sort((a, c) => a.y - c.y);
    for (const sp of sprites) sp.draw();
    if (!this.shaded && night > 0) {
      b.fillStyle = `rgba(16, 24, 56, ${0.5 * night})`;
      b.fillRect(0, 0, W, H);
    }
    this.drawAir(f, si, next, turn, night, dayT);
    this.fx.run(f);
    this.lastT = t;
  }

  /** Paints a season's ground ahead of time, for at most `ms` this frame (then the one after
   * it, and so on round the year, so every season is ready long before it comes). */
  private paintAhead(is: import('../economy/island').Island, from: number, ms: number): void {
    const t0 = performance.now();
    for (let k = 0; k < 4 && performance.now() - t0 < ms; k++) {
      const si = (from + k) % 4;
      if (this.ground.has(si)) continue;
      if (!this.painting || this.painting.si !== si) this.painting = { si, job: this.paintGroundSteps(is, si) };
      while (performance.now() - t0 < ms) {
        const r = this.painting.job.next();
        if (r.done) {
          this.ground.set(si, r.value);
          this.painting = null;
          break;
        }
      }
      return;
    }
  }

  /** One figure on screen for each of the village's people, kept in step with who's alive. */
  private syncWalkers(s: ShoreState, t: number): void {
    const ids = new Set(s.people.map((p) => p.id));
    this.walkers = this.walkers.filter((w) => ids.has(w.id));
    for (const p of s.people) {
      if (this.walkers.some((w) => w.id === p.id)) continue;
      // The newborn come from the huts; the four (at first) come up from the beach with the chief;
      // those who've just joined walk in from their old village.
      const old = p.kind !== undefined && p.joined !== undefined && s.day - p.joined < 1 ? s.villages.find((v) => v.id === p.kind) : undefined;
      const from = old ?? (s.built.length ? s.hearth : s.chiefAt);
      this.walkers.push({ id: p.id, x: from.x + (hash(p.id, 1) - 0.5) * 3, y: from.y + (hash(p.id, 2) - 0.5) * 2, goal: null, wait: hash(p.id, 3) * 2, ph: hash(p.id, 4) * 9, job: 'home' });
    }
    // (Before the hearth is lit, the others follow the chief.)
    if (!s.built.length) {
      for (const w of this.walkers) {
        if (w.id === s.chief) continue;
        const k = this.walkers.indexOf(w);
        w.goal = { x: s.chiefAt.x - 1.5 + (k % 3) * 1.4, y: s.chiefAt.y + 1 + Math.floor(k / 3) };
        w.wait = 1;
        const dx = w.goal.x - w.x;
        const dy = w.goal.y - w.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.3) {
          const sp = Math.min(d, (d > 4 ? 6 : 2) * Math.min(0.1, t - this.lastT));
          w.x += (dx / d) * sp;
          w.y += (dy / d) * sp;
        }
      }
    }
  }

  private drawBuild(b: CanvasRenderingContext2D, id: BuildId, X: number, Y: number, z: number, close: boolean, up: number, t: number, s: ShoreState): void {
    if (!close) {
      b.fillStyle = id === 'hearth' ? 'rgba(255, 150, 60, 0.996)' : '#7a5a3a';
      b.fillRect(X, Y - 1, 1, 1);
      return;
    }
    // Rising: drawn clipped from the ground up.
    const tall = 9 * z;
    b.save();
    if (up < 1) {
      b.beginPath();
      b.rect(X - 8 * z, Y - Math.ceil(tall * up), 16 * z, Math.ceil(tall * up) + z);
      b.clip();
    }
    const r = (x: number, y: number, w: number, h: number, c: string) => {
      b.fillStyle = c;
      b.fillRect(X + x * z, Y + y * z, w * z, h * z);
    };
    switch (id) {
      case 'hearth': {
        // A ring of stones, logs, and the fire: it never goes out.
        r(-4, -1, 8, 1, '#6a6460');
        r(-3, -2, 1, 1, '#8a847c');
        r(2, -2, 1, 1, '#8a847c');
        r(-2, -2, 4, 1, '#3a2a20');
        const f = Math.floor(t * 8) % 3;
        r(-2, -4, 4, 2, 'rgba(255, 110, 40, 0.996)');
        r(-1, -5 - (f % 2), 2, 2 + (f % 2), 'rgba(255, 160, 60, 0.996)');
        r(f === 2 ? 1 : -2, -6 - (f % 2), 1, 1, 'rgba(255, 160, 60, 0.996)');
        r(f === 1 ? -1 : 0, -4, 1, 1, 'rgba(255, 235, 160, 0.996)');
        // Its smoke, a thin grey line going up.
        for (let k = 0; k < 6; k++) {
          const h = (t * 4 + k * 4) % 24;
          b.fillStyle = `rgba(90, 86, 82, ${0.35 * (1 - h / 24)})`;
          b.fillRect(X + Math.round(Math.sin(h * 0.2 + k) * 2), Y - 8 * z - Math.round(h * z), z, z);
        }
        break;
      }
      case 'hut': {
        // A round hut of thatch on a frame, a dark doorway.
        const th = '#b08a4a';
        r(-4, -3, 8, 3, th);
        r(-3, -5, 6, 2, th);
        r(-2, -6, 4, 1, th);
        r(-1, -7, 2, 1, '#8a6a3a');
        r(-4, -3, 8, 1, '#c8a060');
        r(-1, -2, 2, 2, '#2a1e18');
        break;
      }
      case 'rack': {
        // Two posts and a bar, strips of food drying on it.
        r(-4, -6, 1, 6, '#5a4030');
        r(3, -6, 1, 6, '#5a4030');
        r(-4, -6, 8, 1, '#7a5a3a');
        const col = s.look.diet === 'grazer' ? '#c86a3a' : '#a8443a';
        for (let k = 0; k < 3; k++) r(-2 + k * 2, -5, 1, 2 + (k % 2), col);
        break;
      }
      case 'woodpile': {
        r(-4, -1, 8, 1, '#5a4030');
        r(-4, -2, 8, 1, '#7a5a3a');
        r(-3, -3, 6, 1, '#5a4030');
        r(-2, -4, 4, 1, '#7a5a3a');
        r(-4, -2, 1, 1, '#c8a878');
        r(3, -1, 1, 1, '#c8a878');
        break;
      }
      case 'camp': {
        // A lean-to with what they've brought in: game, or baskets of greens.
        r(-4, -1, 7, 1, '#5a4030');
        r(-3, -2, 5, 1, '#8a6a3a');
        r(-2, -3, 4, 1, '#8a6a3a');
        r(-1, -4, 3, 1, '#8a6a3a');
        r(1, -5, 1, 5, '#5a4030');
        const hunt = s.look.diet === 'hunter';
        r(3, -2, 2, 2, hunt ? '#a8443a' : '#6aa04a');
        r(4, -3, 1, 1, hunt ? '#d8d0c0' : '#8acf6a');
        break;
      }
      case 'scout': {
        // A small hut with a tall pole and a pennant: the scouts' own.
        const th = '#b08a4a';
        r(-3, -3, 6, 3, th);
        r(-2, -5, 4, 2, th);
        r(-1, -2, 2, 2, '#2a1e18');
        r(3, -10, 1, 10, '#5a4030');
        r(4, -10, 3, 2, Math.floor(t * 2) % 2 ? PAL.y : '#e8a040');
        break;
      }
      case 'cutter': {
        // A stump with an axe in it, and split logs.
        r(-1, -2, 3, 2, '#7a5a3a');
        r(-1, -2, 3, 1, '#c8a878');
        r(1, -4, 1, 2, '#5a4030');
        r(1, -4, 2, 1, '#9aa6ad');
        r(-5, -1, 3, 1, '#c8a878');
        r(3, -1, 2, 1, '#c8a878');
        break;
      }
    }
    b.restore();
  }

  private drawVillage(b: CanvasRenderingContext2D, sprites: { y: number; draw: () => void }[], s: ShoreState, v: Village, t: number, dt: number, z: number, close: boolean, fogged: (x: number, y: number) => boolean): void {
    if (v.joined) return;
    const X = Math.round(this.sx(v.x));
    const Y = Math.round(this.py(v.x, v.y));
    if (X < -150 || X > this.W + 150 || Y < -200 || Y > this.H + 200) return;
    const hidden = fogged(v.x, v.y);
    // Every camp's smoke goes up over the fog: a column to walk toward, all over the island.
    {
      sprites.push({
        y: v.y + 0.1,
        draw: () => {
          const sz = Math.max(2, Math.round(this.zoom * 0.8));
          const tall = 90;
          for (let k = 0; k < 18; k++) {
            const h = (t * 5 + k * (tall / 18)) % tall;
            const g = 48 + Math.round(h / 6);
            b.fillStyle = `rgba(${g}, ${g - 4}, ${g - 4}, ${0.6 * (1 - h / tall)})`;
            b.fillRect(X + Math.round(Math.sin(h * 0.08 + k) * 3 + h * 0.25), Y - 8 - Math.round(h), sz + Math.round(h / 20), sz + Math.round(h / 20));
          }
        },
      });
    }
    if (hidden) return;
    const rel = relation(s, v);
    // Their huts (in their own colours), round their fire.
    const huts = Math.max(2, Math.round(v.pop / 5));
    if (close) {
      const thatch = v.look.hue?.[0] ?? '#8a6a3a';
      for (let k = 0; k < huts; k++) {
        const a = k * 2.4 + v.id;
        const rr = 4 + (k % 3) * 2.5;
        const hx = v.x + Math.cos(a) * rr;
        const hy = v.y + Math.sin(a) * rr * 0.75;
        const HX = Math.round(this.sx(hx));
        const HY = Math.round(this.py(hx, hy));
        sprites.push({
          y: hy,
          draw: () => {
            b.fillStyle = thatch;
            b.fillRect(HX - 4 * z, HY - 3 * z, 8 * z, 3 * z);
            b.fillRect(HX - 3 * z, HY - 5 * z, 6 * z, 2 * z);
            b.fillRect(HX - 2 * z, HY - 6 * z, 4 * z, z);
            b.fillStyle = '#2a1e18';
            b.fillRect(HX - z, HY - 2 * z, 2 * z, 2 * z);
          },
        });
      }
      sprites.push({
        y: v.y,
        draw: () => {
          const f = Math.floor(t * 8) % 3;
          b.fillStyle = '#3a2a20';
          b.fillRect(X - 2 * z, Y - z, 4 * z, z);
          b.fillStyle = 'rgba(255, 130, 50, 0.996)';
          b.fillRect(X - z, Y - (3 + (f % 2)) * z, 2 * z, (2 + (f % 2)) * z);
        },
      });
      // Their people, about their village (a few of them).
      let list = this.locals.get(v.id);
      if (!list) {
        list = Array.from({ length: Math.min(10, Math.ceil(v.pop / 3)) }, (_, k) => ({ id: k, x: v.x + (hash(k + v.id * 31, 7) - 0.5) * 8, y: v.y + (hash(k + v.id * 31, 8) - 0.5) * 6, goal: null, wait: hash(k, 9) * 3, ph: hash(k, 10) * 9, job: 'home' as const }));
        this.locals.set(v.id, list);
      }
      for (const w of list) {
        w.wait -= dt;
        if (!w.goal || w.wait <= 0) {
          w.wait = 3 + hash(w.id + v.id * 31, Math.floor(t / 6)) * 5;
          const a = hash(w.id * 7 + v.id, Math.floor(t / 8)) * Math.PI * 2;
          const rr = 2 + hash(w.id + v.id, 11) * 10;
          const g = { x: v.x + Math.cos(a) * rr, y: v.y + Math.sin(a) * rr * 0.75 };
          w.goal = isLand(this.island!, g.x, g.y) ? g : { x: v.x, y: v.y };
        }
        const dx = w.goal.x - w.x;
        const dy = w.goal.y - w.y;
        const d = Math.hypot(dx, dy);
        const moving = d > 0.3;
        if (moving) {
          w.x += (dx / d) * Math.min(d, 1.3 * dt);
          w.y += (dy / d) * Math.min(d, 1.3 * dt);
        }
        const x = w.x;
        const y = w.y;
        sprites.push({ y, draw: () => this.drawBeing(b, v.look, x, y, { left: moving ? dx < 0 : hash(w.id, Math.floor(t / 5)) < 0.5, frame: moving ? Math.floor(t * 7 + w.ph) % 2 : 0, hop: moving ? Math.abs(Math.sin(t * 7 + w.ph)) * 1.5 : 0 }) });
      }
    }
    // A flag over it in what they are to you (always, so it's easy to tap), with their
    // colours under it.
    sprites.push({
      y: v.y + 0.2,
      draw: () => {
        const fy = Y - (close ? 10 * z + 4 : 8);
        b.fillStyle = PAL.k;
        b.fillRect(X, fy, 1, Y - fy);
        b.fillStyle = REL_COL[rel];
        b.fillRect(X + 1, fy, 4, 3);
        b.fillStyle = v.look.hue?.[1] ?? PAL.w;
        b.fillRect(X + 1, fy + 3, 4, 1);
      },
    });
  }
}
