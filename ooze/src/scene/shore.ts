// New Shore on screen: the big island under its fog, the village laid out round the hearth
// (huts, racks, woodpiles, the camps), its people out at work by day and home round the fire
// by night, the chief walking wherever you send them, the graves of the four, and out in the
// fog the island's other villages, their smoke going up.

import { PAL } from '../art/sprites';
import { Biome, CELL, isLand, type Island, type Pt } from '../economy/island';
import { raidTarget } from '../economy/war';
import { findPath } from '../economy/paths';
import { DAY_SEC, terrainReady, walkTo, type Habitat, isAdult, poiDef, poiHere, poisOf, relation, shoreIsland, shoreOf, shoreSeason, workPlan, type ShoreState, type Village } from '../economy/shore';
import type { GameState, Genes } from '../economy/types';
import type { CreatureLook } from './creatureLook';
import type { BuildId } from '../content/shore';
import { RangeScene } from './range';
import type { Sprite } from './wild';
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

/** How a kind squeaks: higher or lower, and quicker or slower (your own line is 1 and 1). */
interface Voice {
  pitch: number;
  pace: number;
}
const OURS: Voice = { pitch: 1, pace: 1 };
/** Each other kind's voice, from its village (the same every time). */
function voiceOf(v: Village | undefined): Voice {
  if (!v) return OURS;
  const a = hash(v.id * 13 + v.x, 71);
  const b = hash(v.id * 17 + v.y, 73);
  // Away from your own: never quite the same as yours.
  const pitch = a < 0.5 ? 0.62 + a * 0.6 : 1.18 + (a - 0.5) * 0.7;
  return { pitch, pace: 0.6 + b * 1.1 };
}

/** Flag colours for what another village is to yours. */
const REL_COL = { kin: '#8acf6a', prey: PAL.y, predator: '#e8615a', enemy: '#9a2a2a' } as const;

export class ShoreScene extends RangeScene {
  override get clouds(): boolean {
    return true;
  }

  /** Ways across the island, worked out once and kept (raiders, helpers, the war band). */
  private routes = new Map<string, { pts: Pt[]; cum: number[]; total: number }>();
  private route(is: Island, from: Pt, to: Pt): { pts: Pt[]; cum: number[]; total: number } {
    const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}`;
    let r = this.routes.get(key);
    if (!r) {
      if (this.routes.size > 40) this.routes.clear();
      const pts = [{ ...from }, ...findPath(is, from, to, 60000)];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      r = { pts, cum, total: cum[cum.length - 1] || 1 };
      this.routes.set(key, r);
    }
    return r;
  }

  /** A villager's own look: their kind's, in their own coat (kept, not made each frame). */
  private looks = new Map<number, { base: CreatureLook; look: CreatureLook }>();
  private lookOf(p: { id: number; genes?: Genes }, base: CreatureLook): CreatureLook {
    if (!p.genes) return base;
    const hit = this.looks.get(p.id);
    if (hit && hit.base === base) return hit.look;
    const look = { ...base, genes: p.genes };
    this.looks.set(p.id, { base, look });
    return look;
  }

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
  /** Where the last building going up was (so it doesn't rise a second time when it's done). */
  private wasBuilding: Pt | null = null;
  /** Who's hopping about on screen this frame: where, and their kind's voice. */
  private movers: { x: number; voice: Voice }[] = [];
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
      if (!v.found || v.gone) continue;
      const X = this.sx(v.x);
      const Y = this.py(v.x, v.y);
      if (Math.hypot(ax - X, ay - (Y - 5)) < Math.max(8, this.zoom * 3)) {
        this.events.push({ type: 'village', id: v.id, x: X, y: Y - 10 });
        return;
      }
    }
    for (const p of poisOf(s)) {
      // (Only close enough in to see them.)
      if (!p.found || p.done >= poiDef(p).layers.length || this.zoom < 1.6) continue;
      const X = this.sx(p.x);
      const Y = this.py(p.x, p.y);
      if (Math.hypot(ax - X, ay - (Y - 4)) < Math.max(7, this.zoom * 3)) {
        this.events.push({ type: 'poi', id: p.id, x: X, y: Y - 10 });
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
    // (Water too: they go round to the nearest shore.)
    {
      walkTo(s, at);
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
    // The island's still being made (or loaded): the fog, until it's there.
    if (!terrainReady(s.seed)) {
      b.fillStyle = '#c8ced4';
      b.fillRect(0, 0, W, H);
      this.island = null;
      return;
    }
    this.keepWeather(state, 'shore');
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

    // The day goes by the village's own clock (carrying on where it was after a reload).
    this.dayAt = s.clock / DAY_SEC;
    const dayT = this.dayAt;
    const night = Math.max(0, Math.min(1, (0.125 - Math.abs(dayT - 0.875)) * 40));
    this.stepWeather(dt, si, next, turn, dayT);
    // In a storm (or a winter night) they keep to the village.
    const indoors = this.storm > 0.4;
    const z = Math.max(1, Math.round(this.zoom / 2.4));
    const close = this.zoom >= 1.6;
    const sprites: Sprite[] = [];
    const fogged = (x: number, y: number) => !seen[Math.floor(y / CELL) * (is.n / CELL) + Math.floor(x / CELL)];
    const onScreen = (X: number, Y: number, m = 20) => X > -m && X < W + m && Y > -m * 2 && Y < H + m;

    // ---- The village ----
    s.built.forEach((bd, i) => {
      // (One just finished has already gone up, as it was being built.)
      if (!this.raised.has(i)) this.raised.set(i, this.wasBuilding && Math.hypot(this.wasBuilding.x - bd.x, this.wasBuilding.y - bd.y) < 0.5 ? -99 : t);
      const X = Math.round(this.sx(bd.x));
      const Y = Math.round(this.py(bd.x, bd.y));
      if (!onScreen(X, Y)) return;
      // Going up: it rises out of the ground over a few seconds, with dust.
      const up = Math.min(1, (t - this.raised.get(i)!) / 3);
      if (up < 1 && Math.random() < dt * 6) this.fx.dust(X, Y, 2);
      sprites.push({ y: bd.y, at: bd, draw: () => this.drawBuild(b, bd.id, X, Y, z, close, up, t, s) });
    });
    // What's going up: it rises as the work goes on, dust kicked up round it.
    this.wasBuilding = s.building ? { x: s.building.x, y: s.building.y } : this.wasBuilding;
    if (s.building) {
      const bd = s.building;
      const X = Math.round(this.sx(bd.x));
      const Y = Math.round(this.py(bd.x, bd.y));
      if (onScreen(X, Y)) {
        const up = Math.max(0.05, 1 - bd.left / bd.total);
        if (close && Math.random() < dt * 3) this.fx.dust(X, Y, 2);
        sprites.push({ y: bd.y, at: bd, draw: () => this.drawBuild(b, bd.id, X, Y, z, close, up, t, s) });
      }
    }
    for (const g of s.graves) {
      const X = Math.round(this.sx(g.x));
      const Y = Math.round(this.py(g.x, g.y));
      if (!close || !onScreen(X, Y)) continue;
      sprites.push({
        y: g.y,
        at: g,
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
        at: s.hearth,
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
    this.movers = [];
    const look = s.look;
    // (Those out with the war band are with it, not here.)
    let awayLeft = s.warband?.fighters ?? 0;
    for (const w of this.walkers) {
      const p = s.people.find((q) => q.id === w.id);
      if (!p) continue;
      const grown = isAdult(s, p);
      const isChief = p.id === s.chief;
      if (grown && !isChief && awayLeft > 0) {
        awayLeft--;
        continue;
      }
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
      if (moving && Y > this.viewTop && Y < (this.viewBottom || H)) this.movers.push({ x: X, voice: p.kind !== undefined ? voiceOf(s.villages.find((v) => v.id === p.kind)) : OURS });
      const left = moving ? (isChief ? (s.chiefPath?.[0]?.x ?? s.chiefTo?.x ?? x) < x : (w.goal?.x ?? x) < x) : hash(w.id, Math.floor(t / 5)) < 0.5;
      const sleeping = night > 0.5 && !moving && !isChief;
      const kin = this.lookOf(p, p.kind !== undefined ? s.villages.find((v) => v.id === p.kind)?.look ?? look : look);
      sprites.push({ y, draw: () => this.drawBeing(b, kin, x, y, { left, frame: moving ? Math.floor(t * 7 + w.ph) % 2 : 0, sleeping, hero: isChief, hop: moving ? Math.abs(Math.sin(t * 7 + w.ph)) * 1.5 : 0 }) });
    }
    // The raft they came on, pulled up on the beach where it landed (until it's broken up).
    if (!s.raftTaken) {
      const r = { x: s.beach.x - 2, y: s.beach.y + 1 };
      const X = Math.round(this.sx(r.x));
      const Y = Math.round(this.py(r.x, r.y));
      if (close && onScreen(X, Y)) {
        sprites.push({
          y: r.y - 0.5,
          at: r,
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
    // The scouts, out in the fog for you (seen wherever they are).
    for (const sc of s.scouts ?? []) {
      const moving = !!sc.to;
      const x = sc.at.x;
      const y = sc.at.y;
      const X = this.sx(x);
      const Y = this.py(x, y);
      if (!onScreen(X, Y)) continue;
      if (moving && Y > this.viewTop && Y < (this.viewBottom || H)) this.movers.push({ x: X, voice: OURS });
      const left = (sc.to?.x ?? x) < x;
      sprites.push({
        y,
        draw: () => this.drawBeing(b, look, x, y, { left, frame: moving ? Math.floor(t * 7) % 2 : 0, hop: moving ? Math.abs(Math.sin(t * 7)) * 1.5 : 0 }),
      });
    }
    // War: someone watching from the trees, raiders on the way in, the war band on the way out.
    // Drawn as they are, a band walking, nothing over their heads.
    const now = s.day + s.clock / DAY_SEC;
    const band = (look: typeof s.look, from: Pt, to: Pt, k: number, n: number, seed: number, pace = 7, fighting = false) => {
      // Along the way there (round lakes, along shores), as far as they've got; facing the way
      // they're going.
      const r = this.route(is, from, to);
      const at = Math.max(0, Math.min(1, k)) * r.total;
      let j = 1;
      while (j < r.pts.length - 1 && r.cum[j] < at) j++;
      const a = r.pts[j - 1];
      const c = r.pts[j];
      const seg = Math.max(1e-6, r.cum[j] - r.cum[j - 1]);
      const u = Math.max(0, Math.min(1, (at - r.cum[j - 1]) / seg));
      const hx = a.x + (c.x - a.x) * u;
      const hy = a.y + (c.y - a.y) * u;
      const dx = c.x - a.x || to.x - from.x;
      const dy = c.y - a.y || to.y - from.y;
      const d = Math.hypot(dx, dy) || 1;
      for (let i = 0; i < Math.min(9, n); i++) {
        const back = (i % 3) * 1.6 + Math.floor(i / 3) * 0.8;
        const side = ((i % 3) - 1) * 1.4 + (hash(seed + i, 2) - 0.5);
        const x = hx - (dx / d) * back - (dy / d) * side;
        const y = hy - (dy / d) * back + (dx / d) * side;
        if (!isLand(is, x, y) || fogged(x, y)) continue;
        const X = this.sx(x);
        const Y = this.py(x, y);
        if (!onScreen(X, Y)) continue;
        const ph = hash(seed + i, 3) * 9;
        // (Fighting: lunging in and back, not walking.)
        const jx = fighting ? Math.sin(t * pace + ph) * 0.6 * (dx / d) : 0;
        const jy = fighting ? Math.sin(t * pace + ph) * 0.6 * (dy / d) : 0;
        sprites.push({ y, draw: () => this.drawBeing(b, look, x + jx, y + jy, { left: dx < 0, frame: Math.floor(t * pace + ph) % 2, hop: Math.abs(Math.sin(t * pace + ph)) * (fighting ? 2.5 : 1.5) }) });
      }
    };
    const raid = s.raid;
    const from = raid && s.villages.find((v) => v.id === raid.from);
    if (raid && from) {
      if (raid.seen === undefined) {
        // One of them, standing at the edge of the trees, looking in.
        const a = Math.atan2(from.y - s.hearth.y, from.x - s.hearth.x) + (hash(Math.floor(raid.watched), 4) - 0.5) * 0.8;
        const x = s.hearth.x + Math.cos(a) * 30;
        const y = s.hearth.y + Math.sin(a) * 30;
        if (isLand(is, x, y) && !fogged(x, y) && night < 0.6) {
          const X = this.sx(x);
          const Y = this.py(x, y);
          if (onScreen(X, Y)) sprites.push({ y, draw: () => this.drawBeing(b, from.look, x, y, { left: s.hearth.x < x, frame: 0 }) });
        }
      } else if (raid.arrives !== undefined) {
        // On their way in: a walk at first, a run at the end.
        const k = Math.max(0, Math.min(1, (now - raid.seen) / Math.max(0.01, raid.arrives - raid.seen)));
        const goal = raidTarget(s, raid);
        band(from.look, from, goal, 0.15 + (k * k * 0.4 + k * 0.6) * 0.83, raid.fighters, from.id * 31, k > 0.8 ? 11 : 7);
        // And those coming to help, from wherever they set out.
        for (const a of raid.allies ?? []) {
          const src = a.from === -1 ? s.hearth : s.villages.find((v) => v.id === a.from);
          const look = a.from === -1 ? s.look : (src as Village | undefined)?.look;
          if (!src || !look) continue;
          const ka = Math.max(0, Math.min(1, (now - raid.seen) / Math.max(0.01, a.arrives - raid.seen)));
          band(look, src, goal, ka * 0.95, a.n, (a.from + 7) * 53, 9);
        }
      }
    }
    // Roads to the villages that are yours: packed earth, as far as it's been laid.
    for (const v of s.villages) {
      if (!v.road || v.gone) continue;
      const r = this.route(is, s.hearth, v);
      const upto = Math.min(1, v.road.done / Math.max(0.01, v.road.need)) * r.total;
      const pts: { X: number; Y: number }[] = [];
      for (let j = 1; j < r.pts.length; j++) {
        const a = r.pts[j - 1];
        const c = r.pts[j];
        const seg = r.cum[j] - r.cum[j - 1];
        for (let u = 0; u < seg; u += 0.7) {
          if (r.cum[j - 1] + u > upto) break;
          const x = a.x + ((c.x - a.x) * u) / (seg || 1);
          const y = a.y + ((c.y - a.y) * u) / (seg || 1);
          if (fogged(x, y)) continue;
          const X = Math.round(this.sx(x));
          const Y = Math.round(this.py(x, y));
          if (onScreen(X, Y)) pts.push({ X, Y });
        }
      }
      if (!pts.length) continue;
      const w = Math.max(1, Math.round(z * 0.6));
      sprites.push({
        y: -1e6,
        draw: () => {
          b.fillStyle = 'rgba(122, 92, 58, 0.75)';
          for (const p of pts) b.fillRect(p.X - w, p.Y - Math.ceil(w / 2), w * 2, w);
        },
      });
    }
    // Goods on the road from the settlements: a couple of theirs, carrying it home.
    for (const c of s.convoys ?? []) {
      const v = s.villages.find((x) => x.id === c.from);
      if (!v) continue;
      const k = (now - c.left) / Math.max(0.01, c.arrives - c.left);
      if (k < 0 || k > 1) continue;
      band(v.look, v, s.hearth, k, 2, v.id * 17 + Math.floor(c.left), 6);
    }
    // The fight at the edge of the village: what's left of them, at it.
    const fight = s.fight;
    const foe = fight?.attack === 'them' ? s.villages.find((v) => v.id === fight.village) : undefined;
    const fightAt = fight?.at !== undefined ? s.villages.find((v) => v.id === fight.at) : undefined;
    if (fight && foe) band(foe.look, foe, fightAt ?? s.hearth, 0.98, Math.round(fight.y), foe.id * 31, 13, true);
    // Running home, those who lived; and what the fallen dropped, lying where they fell.
    const ret = s.retreat;
    const home = ret && s.villages.find((v) => v.id === ret.from);
    if (ret && home) {
      const d = Math.hypot(home.x - s.hearth.x, home.y - s.hearth.y) || 1;
      const k = Math.max(0, Math.min(1, (now - ret.left) / Math.max(0.01, ret.arrives - ret.left)));
      const start = { x: ret.sx ?? s.hearth.x, y: ret.sy ?? s.hearth.y };
      const d2 = Math.hypot(home.x - start.x, home.y - start.y) || d;
      band(home.look, start, home, Math.min(1, 2 / d2) + k * (1 - 2 / d2), ret.n, home.id * 31, 12);
    }
    const loot = s.loot;
    if (loot && !fogged(loot.x, loot.y)) {
      for (let i = 0; i < loot.n; i++) {
        const lx = loot.x + (hash(i, 61) - 0.5) * 4;
        const ly = loot.y + (hash(i, 62) - 0.5) * 3;
        const X = Math.round(this.sx(lx));
        const Y = Math.round(this.py(lx, ly));
        if (!onScreen(X, Y)) continue;
        sprites.push({
          y: ly,
          at: { x: lx, y: ly },
          draw: () => {
            // A dropped bundle: a sack tied at the neck, or a bundle of sticks.
            const k = z >= 6 ? 2 : 1;
            if (i % 2) {
              b.fillStyle = '#8a6a3a';
              b.fillRect(X - 2 * k, Y - 3 * k, 4 * k, 3 * k);
              b.fillStyle = '#c8a878';
              b.fillRect(X - k, Y - 4 * k, 2 * k, k);
            } else {
              b.fillStyle = '#6a4a30';
              b.fillRect(X - 3 * k, Y - 2 * k, 6 * k, k);
              b.fillRect(X - 2 * k, Y - 3 * k, 5 * k, k);
            }
          },
        });
      }
    }
    const w = s.warband;
    const to = w && s.villages.find((v) => v.id === w.to);
    if (w && to) band(s.look, s.hearth, to, Math.max(0, Math.min(1, (now - w.left) / Math.max(0.01, w.arrives - w.left))) * 0.92, w.fighters, 777);
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

    // ---- Landmarks ----
    const here = poiHere(s);
    for (const p of poisOf(s)) {
      // (Explored to the end, it's gone: nothing more there.)
      if (!p.found || p.done >= poiDef(p).layers.length) continue;
      const X = Math.round(this.sx(p.x));
      const Y = Math.round(this.py(p.x, p.y));
      if (!onScreen(X, Y, 40)) continue;
      const layers = poiDef(p).layers;
      const progress = p === here ? p.t / layers[p.done].sec : -1;
      sprites.push({ y: p.y, at: p, draw: () => this.drawPoi(b, p.kind, X, Y, z, close, t, progress) });
    }

    // ---- The island's other villages ----
    for (const v of s.villages) this.drawVillage(b, sprites, s, v, t, dt, z, close, fogged);
    // Out and about, they squeak, each kind in its own voice: higher or lower, chattier or
    // slower (heard up close, quieter as the view pulls back).
    const n = this.movers.length;
    herdInView(n > 0);
    if (n) {
      this.chatter -= dt * Math.min(3, 0.6 + n * 0.3);
      if (this.chatter <= 0) {
        const m = this.movers[Math.floor(Math.random() * n)];
        this.chatter = (0.5 + Math.random() * 1.4) / m.voice.pace;
        const near = Math.max(0, Math.min(1, (this.zoom - 1.2) / 6.8));
        squeak(0.45 * near ** 1.2, (m.x / W) * 2 - 1, m.voice.pitch);
      }
    }

    this.wild.update(this.wildView, is, sprites, { b, t, dt, nests: [s.hearth], season: si, night, feet: this.walkers, me: s.chiefAt });
    this.trails.update(is.seed, this.walkers.filter((w) => w.goal && Math.hypot(w.goal.x - w.x, w.goal.y - w.y) > 0.3), dt, is.n);
    sprites.sort((a, c) => a.y - c.y);
    // (Each hidden behind any ridge between it and the camera.)
    for (const sp of sprites) if (sp.at) this.behind(b, sp.at.x, sp.at.y, sp.draw);
    else sp.draw();
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

  /** A landmark: what it is (close in), and how far the chief's got exploring it. */
  private drawPoi(b: CanvasRenderingContext2D, kind: import('../content/shore').PoiKind, X: number, Y: number, z: number, close: boolean, t: number, progress: number): void {
    const r = (x: number, y: number, w: number, h: number, c: string) => {
      b.fillStyle = c;
      b.fillRect(X + x * z, Y + y * z, w * z, h * z);
    };
    let top = -8;
    // (Nothing marks them: from far out they're too small to see; close in, they're just there,
    // for whoever's looking.)
    if (!close) {
      if (progress < 0) return;
      top = -4;
    } else {
      switch (kind) {
        case 'bones':
          for (let k = 0; k < 4; k++) {
            r(-6 + k * 3, -6 + Math.abs(k - 1.5), 1, 6 - Math.abs(k - 1.5), '#e8e2d0');
          }
          r(-7, -1, 13, 1, '#c8c0a8');
          top = -9;
          break;
        case 'bigtree':
          r(-1, -10, 3, 10, '#5a4030');
          r(-6, -18, 13, 8, '#2f5a2a');
          r(-4, -20, 9, 3, '#3f7a3a');
          r(-5, -16, 3, 2, '#4f8a4a');
          top = -22;
          break;
        case 'spring': {
          r(-4, -2, 8, 2, '#5fb0c8');
          r(-3, -2, 6, 1, '#9ad8e8');
          for (let k = 0; k < 3; k++) {
            const h = (t * 3 + k * 2) % 6;
            b.fillStyle = `rgba(240, 244, 248, ${0.6 * (1 - h / 6)})`;
            b.fillRect(X + (k - 1) * 2 * z, Y - (3 + h) * z, z, z);
          }
          top = -10;
          break;
        }
        case 'stones':
          for (const [x, h] of [[-6, 6], [-3, 7], [1, 7], [4, 6]] as const) r(x, -h, 2, h, '#8a8a90');
          r(-6, -1, 12, 1, '#5a5a60');
          top = -10;
          break;
        case 'cave':
          r(-6, -7, 12, 7, '#6a6a70');
          r(-3, -5, 6, 5, '#141418');
          r(-2, -6, 4, 1, '#141418');
          top = -10;
          break;
        case 'ruin':
          r(-6, -3, 12, 1, '#9a948a');
          r(-6, -3, 1, 3, '#9a948a');
          r(5, -4, 1, 4, '#9a948a');
          r(-6, -1, 5, 1, '#7a746a');
          r(2, -1, 4, 1, '#7a746a');
          r(-2, -2, 1, 2, '#5a8a4a');
          top = -7;
          break;
        case 'wreck':
          r(-6, -2, 10, 1, '#6a4a30');
          r(-5, -3, 10, 1, '#5a3a24');
          r(-4, -1, 10, 1, '#6a4a30');
          r(2, -5, 1, 4, '#c8b080');
          top = -8;
          break;
        case 'crater':
          r(-6, -1, 12, 1, '#5a4a3a');
          r(-5, -2, 2, 1, '#7a6a5a');
          r(3, -2, 2, 1, '#7a6a5a');
          r(-2, -1, 4, 1, '#1a1410');
          if (Math.floor(t * 2) % 2) r(0, -2, 1, 1, '#c8a0ff');
          top = -7;
          break;
        case 'cairn':
          r(-3, -2, 6, 2, '#8a8a90');
          r(-2, -4, 4, 2, '#9a9aa0');
          r(-1, -6, 2, 2, '#aaaab0');
          top = -9;
          break;
      }
    }
    // Being explored: a bar filling over it.
    if (progress >= 0) {
      const w = 14;
      const gy = Y + top * z - 7;
      b.fillStyle = PAL.k;
      b.fillRect(X - w / 2 - 1, gy - 1, w + 2, 4);
      b.fillStyle = '#3a3e52';
      b.fillRect(X - w / 2, gy, w, 2);
      b.fillStyle = PAL.y;
      b.fillRect(X - w / 2, gy, Math.round(w * Math.min(1, progress)), 2);
    }
  }

  private drawVillage(b: CanvasRenderingContext2D, sprites: Sprite[], s: ShoreState, v: Village, t: number, dt: number, z: number, close: boolean, fogged: (x: number, y: number) => boolean): void {
    // Joined: their old village is an outpost now, a few still working its land for you (a
    // couple of their huts, a small fire, your gold flag).
    if (v.joined) {
      if (fogged(v.x, v.y)) return;
      const X = Math.round(this.sx(v.x));
      const Y = Math.round(this.py(v.x, v.y));
      if (X < -60 || X > this.W + 60 || Y < -80 || Y > this.H + 60) return;
      if (close) {
        for (let k = 0; k < 2; k++) {
          const hx = v.x + (k ? 3 : -3);
          const hy = v.y + (k ? -1 : 1);
          const HX = Math.round(this.sx(hx));
          const HY = Math.round(this.py(hx, hy));
          sprites.push({ y: hy, at: { x: hx, y: hy }, draw: () => drawHut(b, v.habitat ?? 'meadow', HX, HY, z, v.look.hue) });
        }
      }
      sprites.push({
        y: v.y + 0.2,
        at: v,
        draw: () => {
          const fy = Y - (close ? 10 * z + 4 : 8);
          b.fillStyle = PAL.k;
          b.fillRect(X, fy, 1, Y - fy);
          b.fillStyle = '#e8c86a';
          b.fillRect(X + 1, fy, 4, 3);
        },
      });
      return;
    }
    // Turned away: for a day or two they're seen on the road with what they could carry, going
    // to whoever will have them; after that the place is empty.
    if (v.gone) {
      const to = s.villages.find((x) => x.id === v.gone!.to);
      if (!to || s.day - v.gone.day > 2) return;
      let list = this.locals.get(v.id) ?? [];
      this.locals.set(v.id, list);
      for (const w of list) {
        w.goal = { x: to.x + (hash(w.id, 3) - 0.5) * 6, y: to.y + (hash(w.id, 4) - 0.5) * 4 };
        const dx = w.goal.x - w.x;
        const dy = w.goal.y - w.y;
        const d = Math.hypot(dx, dy);
        if (d < 1) continue;
        w.x += (dx / d) * Math.min(d, 1.1 * dt);
        w.y += (dy / d) * Math.min(d, 1.1 * dt);
        const x = w.x;
        const y = w.y;
        if (fogged(x, y)) continue;
        sprites.push({ y, draw: () => this.drawBeing(b, v.look, x, y, { left: dx < 0, frame: Math.floor(t * 6 + w.ph) % 2, hop: Math.abs(Math.sin(t * 6 + w.ph)) }) });
      }
      list = list.filter((w) => Math.hypot((w.goal?.x ?? 0) - w.x, (w.goal?.y ?? 0) - w.y) > 1);
      this.locals.set(v.id, list);
      return;
    }
    const X = Math.round(this.sx(v.x));
    const Y = Math.round(this.py(v.x, v.y));
    if (X < -150 || X > this.W + 150 || Y < -200 || Y > this.H + 200) return;
    const hidden = fogged(v.x, v.y);
    // Every camp's smoke goes up over the fog: a column to walk toward, all over the island.
    // (Not over villages that are yours already: they're no mystery.)
    if (!v.vassal && !v.joined && v.settled === undefined) {
      sprites.push({
        y: v.y + 0.1,
        at: v,
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
      const kind = v.habitat ?? 'meadow';
      for (let k = 0; k < huts; k++) {
        const a = k * 2.4 + v.id;
        const rr = 4 + (k % 3) * 2.5;
        const hx = v.x + Math.cos(a) * rr;
        const hy = v.y + Math.sin(a) * rr * 0.75;
        const HX = Math.round(this.sx(hx));
        const HY = Math.round(this.py(hx, hy));
        sprites.push({
          y: hy,
          at: { x: hx, y: hy },
          draw: () => drawHut(b, kind, HX, HY, z, v.look.hue),
        });
      }
      sprites.push({
        y: v.y,
        at: v,
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
        const LX = this.sx(x);
        const LY = this.py(x, y);
        if (moving && LX > 0 && LX < this.W && LY > this.viewTop && LY < (this.viewBottom || this.H)) this.movers.push({ x: LX, voice: voiceOf(v) });
        sprites.push({ y, draw: () => this.drawBeing(b, v.look, x, y, { left: moving ? dx < 0 : hash(w.id, Math.floor(t / 5)) < 0.5, frame: moving ? Math.floor(t * 7 + w.ph) % 2 : 0, hop: moving ? Math.abs(Math.sin(t * 7 + w.ph)) * 1.5 : 0 }) });
      }
    }
    // A flag over it in what they are to you (always, so it's easy to tap), with their
    // colours under it.
    sprites.push({
      y: v.y + 0.2,
      at: v,
      draw: () => {
        const fy = Y - (close ? 10 * z + 4 : 8);
        b.fillStyle = PAL.k;
        b.fillRect(X, fy, 1, Y - fy);
        b.fillStyle = v.vassal || v.settled !== undefined ? '#e8c86a' : REL_COL[rel];
        b.fillRect(X + 1, fy, 4, 3);
        b.fillStyle = v.look.hue?.[1] ?? PAL.w;
        b.fillRect(X + 1, fy + 3, 4, 1);
      },
    });
  }
}

/** Another village's hut, as where they live makes it: up on stilts by water, hide tents in the
 * desert, stone in the hills, leaf and bark in the woods, driftwood on the shore, thatch on the
 * open grass. (Their own colours in the trim.) */
function drawHut(b: CanvasRenderingContext2D, kind: Habitat, X: number, Y: number, z: number, hue?: [string, string]): void {
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    b.fillStyle = c;
    b.fillRect(X + x * z, Y + y * z, w * z, h * z);
  };
  const trim = hue?.[1] ?? '#c8a060';
  switch (kind) {
    case 'river':
    case 'lake':
    case 'marsh':
      // On stilts over the wet ground, a reed roof.
      r(-3, -2, 1, 2, '#4a3828');
      r(2, -2, 1, 2, '#4a3828');
      r(-4, -3, 8, 1, '#6a5038');
      r(-3, -6, 6, 3, kind === 'marsh' ? '#7a7a4a' : '#8a7a5a');
      r(-2, -7, 4, 1, kind === 'marsh' ? '#6a6a3a' : '#7a6a4a');
      r(-1, -5, 2, 2, '#2a1e18');
      r(-4, -6, 1, 1, trim);
      break;
    case 'desert':
    case 'scrub':
      if (kind === 'desert') {
        // A low hide tent, its poles crossed at the top.
        r(-4, -2, 8, 2, '#c8a070');
        r(-3, -3, 6, 1, '#c8a070');
        r(-2, -4, 4, 1, '#b8905a');
        r(-1, -5, 1, 1, '#5a4030');
        r(1, -5, 1, 1, '#5a4030');
        r(-1, -2, 2, 2, '#3a2818');
        r(-4, -2, 1, 1, trim);
      } else {
        r(-4, -3, 8, 3, '#a8905a');
        r(-3, -5, 6, 2, '#a8905a');
        r(-2, -6, 4, 1, '#8a7a4a');
        r(-1, -2, 2, 2, '#2a1e18');
        r(-4, -3, 8, 1, trim);
      }
      break;
    case 'mountain':
      // Round, of stacked stone, a smoke hole.
      r(-4, -3, 8, 3, '#8a8a90');
      r(-3, -5, 6, 2, '#9a9aa0');
      r(-3, -2, 2, 1, '#6a6a70');
      r(1, -4, 2, 1, '#6a6a70');
      r(-1, -6, 2, 1, '#5a5a60');
      r(-1, -2, 2, 2, '#1e1a18');
      r(3, -3, 1, 1, trim);
      break;
    case 'forest':
      // A dome of bark and leaves.
      r(-4, -3, 8, 3, '#5a4030');
      r(-3, -5, 6, 2, '#4a6a3a');
      r(-2, -6, 4, 1, '#5a8a4a');
      r(-3, -4, 1, 1, '#6a9a5a');
      r(-1, -2, 2, 2, '#1e1610');
      r(2, -5, 1, 1, trim);
      break;
    case 'coast':
      // A lean-to of driftwood, grey from the sea.
      r(-4, -1, 8, 1, '#8a8478');
      r(-3, -2, 7, 1, '#9a948a');
      r(-2, -3, 6, 1, '#8a8478');
      r(-1, -4, 5, 1, '#9a948a');
      r(2, -5, 1, 5, '#6a6458');
      r(-3, -1, 2, 1, '#2a2420');
      r(3, -5, 1, 1, trim);
      break;
    default:
      // Thatch, on the open grass.
      r(-4, -3, 8, 3, '#b08a4a');
      r(-3, -5, 6, 2, '#b08a4a');
      r(-2, -6, 4, 1, '#9a7a3a');
      r(-1, -2, 2, 2, '#2a1e18');
      r(-4, -3, 8, 1, trim);
  }
}
