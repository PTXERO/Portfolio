// The world map (the Age of Sail): a sea, and on it the islands as shapes. Yours in colour (each
// its own coast, lights coming on at night), others found in grey, the rest of the world under
// fog. Pan with a finger, pinch to zoom, tap one of yours to go and see it.

import type { GameState } from '../economy/types';
import type { Frame } from './paint';
import { hash } from './paint';
import { isleName } from '../ui/sailPanels';
import { alongLane, laneLength, portOf, routeFrom, seaLane, type Pt } from '../economy/seaways';
import { MASK, coastAt, gustLeft, level, ours, routeDist, shipSpeed, sightFrom, type World, type WorldIsle } from '../economy/sail';

export class WorldScene {
  private camX = 0;
  private camY = 0;
  /** Art pixels per map unit. */
  private zoom = 0;
  private W = 0;
  private H = 0;
  private top = 0;
  private bottom = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private fogImg: ImageData | null = null;
  private seedNow = -1;

  reset(): void {
    this.zoom = 0;
  }

  /** The middle of the view in art pixels (between the top bar and the sheet). */
  private midY(): number {
    return (this.top + (this.H - this.bottom)) / 2;
  }
  private sx(x: number): number {
    return (x - this.camX) * this.zoom + this.W / 2;
  }
  private sy(y: number): number {
    return (y - this.camY) * this.zoom + this.midY();
  }
  private toMap(ax: number, ay: number): { x: number; y: number } {
    return { x: this.camX + (ax - this.W / 2) / this.zoom, y: this.camY + (ay - this.midY()) / this.zoom };
  }

  /** Your islands framed, home in the middle (once, on first sight). */
  private frame(world: World): void {
    const mine = world.isles.filter((i) => i.mine !== undefined);
    const home = mine.find((i) => i.mine === -1) ?? mine[0];
    this.camX = home.x;
    this.camY = home.y;
    let span = 260;
    for (const m of mine) span = Math.max(span, Math.abs(m.x - home.x) * 2 + m.r * 2.4, Math.abs(m.y - home.y) * 2 + m.r * 2.4);
    this.zoom = Math.min(this.W / span, (this.H - this.top - this.bottom) / span);
  }

  /** An island's picture, made once: land and sand from its coast, a hill in the middle. */
  private sprite(i: WorldIsle): HTMLCanvasElement {
    const key = `${i.id}|${ours(i) ? 'm' : i.found ? 'f' : 'u'}|${i.mask.length}`;
    let c = this.sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = MASK;
    c.height = MASK;
    const b = c.getContext('2d')!;
    const mine = ours(i);
    const near = (x: number, y: number) => {
      let sea = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!coastAt(i.mask, x + dx, y + dy)) sea++;
      return sea;
    };
    for (let y = 0; y < MASK; y++)
      for (let x = 0; x < MASK; x++) {
        if (!coastAt(i.mask, x, y)) {
          // (The shallows round the coast, a lighter blue.)
          let shore = false;
          for (let dy = -2; dy <= 2 && !shore; dy++) for (let dx = -2; dx <= 2; dx++) if (coastAt(i.mask, x + dx, y + dy)) shore = true;
          if (shore) {
            b.fillStyle = 'rgba(120, 190, 210, 0.35)';
            b.fillRect(x, y, 1, 1);
          }
          continue;
        }
        const edge = near(x, y) > 0;
        const inner = Math.hypot(x - MASK / 2, y - MASK / 2) / (MASK / 2);
        const n = hash(x * 41 + y, i.id + 7);
        let col: string;
        if (mine) col = edge ? '#e6d29a' : inner < 0.25 + n * 0.1 ? '#4a7a3a' : n > 0.85 ? '#3e6a30' : '#6aa04a';
        else col = edge ? '#b8b4a4' : inner < 0.25 + n * 0.1 ? '#6c7468' : '#8a9284';
        b.fillStyle = col;
        b.fillRect(x, y, 1, 1);
      }
    this.sprites.set(key, c);
    return c;
  }

  draw(f: Frame, state: GameState): void {
    const world = state.stages.sail.world;
    const { b, W, H, t } = f;
    this.W = W;
    this.H = H;
    this.top = f.top;
    this.bottom = f.bottom;
    if (!world) {
      b.fillStyle = '#123a52';
      b.fillRect(0, 0, W, H);
      return;
    }
    if (this.seedNow !== world.seed) {
      this.seedNow = world.seed;
      this.sprites.clear();
      this.zoom = 0;
    }
    if (!this.zoom) this.frame(world);
    // The sea, and its glints.
    b.fillStyle = '#16465e';
    b.fillRect(0, 0, W, H);
    b.fillStyle = '#2a6684';
    for (let k = 0; k < 90; k++) {
      const gx = hash(k, 3) * world.w;
      const gy = hash(k, 5) * world.h;
      const X = Math.round(this.sx(gx) + Math.sin(t * 0.6 + k) * 2);
      const Y = Math.round(this.sy(gy));
      if (X < -2 || Y < -2 || X > W || Y > H) continue;
      if (Math.sin(t * 1.3 + k * 2.1) > 0.2) b.fillRect(X, Y, 2, 1);
    }
    // The islands (found ones only: the rest are under the fog).
    b.imageSmoothingEnabled = false;
    for (const i of world.isles) {
      if (!i.found) continue;
      const s = i.r * 2 * this.zoom;
      const X = this.sx(i.x) - s / 2;
      const Y = this.sy(i.y) - s / 2;
      if (X > W || Y > H || X + s < 0 || Y + s < 0) continue;
      b.drawImage(this.sprite(i), Math.round(X), Math.round(Y), Math.round(s), Math.round(s));
    }
    this.drawRoutes(b, world, f.dt);
    this.drawPirates(b, world, t);
    // The voyage out: a ship making for the fog.
    if (world.voyage) {
      const a = world.isles[world.voyage.from];
      const z = world.isles[world.voyage.to];
      const k = 1 - world.voyage.left / world.voyage.total;
      const X = Math.round(this.sx(a.x + (z.x - a.x) * k));
      const Y = Math.round(this.sy(a.y + (z.y - a.y) * k));
      b.fillStyle = '#6a4a2a';
      b.fillRect(X - 2, Y + 1, 5, 1);
      b.fillStyle = '#fff6c8';
      b.fillRect(X - 1, Y - 2, 2, 3);
      if (Math.floor(t * 2) % 2) b.fillRect(X, Y - 4, 1, 1);
    }
    // Night: your islands' lights come on (the day goes round in two minutes, as on the shore).
    const day = (t % 120) / 120;
    const night = Math.max(0, Math.min(1, (day - 0.72) * 8)) * Math.max(0, Math.min(1, (1.02 - day) * 8));
    if (night > 0.05) {
      b.fillStyle = `rgba(10, 16, 40, ${0.45 * night})`;
      b.fillRect(0, 0, W, H);
      for (const i of world.isles) {
        if (!ours(i)) continue;
        for (let k = 0; k < (i.mine === -1 ? 14 : 7); k++) {
          const lx = (hash(k, i.id * 13 + 1) - 0.5) * i.r * 0.9;
          const ly = (hash(k, i.id * 13 + 2) - 0.5) * i.r * 0.9;
          if (!coastAt(i.mask, Math.floor(MASK / 2 + (lx / (i.r * 2)) * MASK), Math.floor(MASK / 2 + (ly / (i.r * 2)) * MASK))) continue;
          if (Math.sin(t * 2 + k * 3 + i.id) < -0.6) continue;
          b.fillStyle = `rgba(255, 214, 120, ${night})`;
          b.fillRect(Math.round(this.sx(i.x + lx)), Math.round(this.sy(i.y + ly)), 1, 1);
        }
      }
    }
    this.drawFog(b, world, t, night);
    // Every island found, named (drawn sharp over the picture by the scene).
    this.labels = world.isles
      .filter((i) => i.found)
      .map((i) => ({ x: this.sx(i.x), y: this.sy(i.y + i.r * 0.75) + 2, text: isleName(state, i), mine: ours(i) }))
      .filter((l) => l.x > -40 && l.x < W + 40 && l.y > -10 && l.y < H + 10);
  }
  /** The islands' names where they go (buffer pixels). */
  labels: { x: number; y: number; text: string; mine: boolean }[] = [];

  /** Where each route's ships are along it (0 to 1 there and back), kept frame to frame. */
  private phase = new Map<number, number>();
  /** A route's lane on the map: from the nearest of your ports to theirs, by the sea. */
  private lane(world: World, to: number): Pt[] {
    const i = world.isles[to];
    return seaLane(world, routeFrom(world, i), i);
  }
  /** The ports: a little jetty off each island found (yours lit). */
  private drawPorts(b: CanvasRenderingContext2D, world: World): void {
    for (const i of world.isles) {
      if (!i.found) continue;
      const p = portOf(world, i);
      const X = Math.round(this.sx(p.x));
      const Y = Math.round(this.sy(p.y));
      if (X < -4 || Y < -4 || X > this.W + 4 || Y > this.H + 4) continue;
      // (Pointing back at the island: a jetty out from the shore.)
      const d = Math.hypot(i.x - p.x, i.y - p.y) || 1;
      const ux = (i.x - p.x) / d;
      const uy = (i.y - p.y) / d;
      b.fillStyle = '#8a6440';
      for (let k = 0; k <= 3; k++) b.fillRect(Math.round(X + ux * k), Math.round(Y + uy * k), 1, 1);
      b.fillStyle = ours(i) ? '#ffd27a' : '#c8d4dc';
      b.fillRect(X, Y, 1, 1);
    }
  }
  /** The routes as faint dotted lanes, and their ships going back and forth on them. */
  private drawRoutes(b: CanvasRenderingContext2D, world: World, dt: number): void {
    (world.routes ?? []).forEach((r, i) => {
      const lane = this.lane(world, r.to);
      const len = laneLength(lane);
      b.fillStyle = 'rgba(190, 225, 240, 0.35)';
      const step = 5 / Math.max(0.2, this.zoom);
      for (let k = 0; k < len; k += step) {
        const at = alongLane(lane, k / len);
        b.fillRect(Math.round(this.sx(at.x)), Math.round(this.sy(at.y)), 1, 1);
      }
      // (A round trip takes its real time; a gust blows them along twice as fast.)
      const trip = (2 * routeDist(world, r.to)) / shipSpeed(world);
      const p = ((this.phase.get(i) ?? 0) + (dt / trip) * (gustLeft(world, i) > 0 ? 2 : 1)) % 1;
      this.phase.set(i, p);
      // (A sail for each doubling, not each ship: 1, 2, 4, 8, 16... ships show as 1, 2, 3, 4, 5.)
      const shown = Math.min(r.ships, 1 + Math.floor(Math.log2(r.ships)));
      for (let k = 0; k < shown; k++) {
        const q = (p + k / shown) % 1;
        const out = q < 0.5;
        const s = out ? q * 2 : 2 - q * 2;
        const at = alongLane(lane, s);
        // (Each keeps to its own side of the lane, so ships passing don't sail through each other.)
        const side = out ? 1.5 : -1.5;
        const X = Math.round(this.sx(at.x - at.dy * side));
        const Y = Math.round(this.sy(at.y + at.dx * side));
        const dir = (out ? at.dx : -at.dx) >= 0 ? 1 : -1;
        b.fillStyle = 'rgba(220, 240, 250, 0.5)';
        b.fillRect(X - dir * 3, Y + 1, 2, 1);
        b.fillStyle = '#6a4a2a';
        b.fillRect(X - 1, Y + 1, 3, 1);
        b.fillStyle = gustLeft(world, i) > 0 ? '#fff6c8' : '#f2ead7';
        b.fillRect(X, Y - 1, 1, 2);
      }
    });
    this.drawPorts(b, world);
  }
  /** Where along a route a share of the way is, on screen. */
  private onLane(world: World, to: number, s: number): [number, number] {
    const at = alongLane(this.lane(world, to), s);
    return [this.sx(at.x), this.sy(at.y)];
  }
  /** Pirates on the routes: dark sails, red when they're struck. */
  private drawPirates(b: CanvasRenderingContext2D, world: World, t: number): void {
    for (const p of world.pirates ?? []) {
      const r = world.routes?.[p.route];
      if (!r) continue;
      const [px, py] = this.onLane(world, r.to, p.at);
      const X = Math.round(px + Math.sin(t * 2 + p.route) * 2);
      const Y = Math.round(py);
      // (A ring that pulses: here's trouble.)
      const pulse = 4 + (Math.sin(t * 6) + 1) * 2;
      b.strokeStyle = 'rgba(232, 97, 90, 0.7)';
      b.beginPath();
      b.arc(X + 0.5, Y, pulse, 0, Math.PI * 2);
      b.stroke();
      b.fillStyle = '#2a1a14';
      b.fillRect(X - 3, Y + 1, 7, 2);
      b.fillStyle = '#1a1a1e';
      b.fillRect(X - 1, Y - 3, 3, 4);
      b.fillStyle = '#e8615a';
      b.fillRect(X, Y - 4, 1, 1);
    }
  }
  /** The pirates under a tap, if any (their index). */
  pirateAt(world: World, ax: number, ay: number): number | null {
    let best: number | null = null;
    let bestD = 10;
    (world.pirates ?? []).forEach((p, k) => {
      const r = world.routes?.[p.route];
      if (!r) return;
      const [px, py] = this.onLane(world, r.to, p.at);
      const d = Math.hypot(ax - px, ay - py);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /** The route under a tap (near its line), if any. */
  routeAt(world: World, ax: number, ay: number): number | null {
    let best: number | null = null;
    let bestD = 7;
    (world.routes ?? []).forEach((r, i) => {
      // (Nearest any stretch of its lane.)
      const lane = this.lane(world, r.to).map((q) => ({ x: this.sx(q.x), y: this.sy(q.y) }));
      let d = Infinity;
      for (let s = 1; s < lane.length; s++) {
        const [x1, y1, x2, y2] = [lane[s - 1].x, lane[s - 1].y, lane[s].x, lane[s].y];
        const L = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
        const k = Math.max(0, Math.min(1, ((ax - x1) * (x2 - x1) + (ay - y1) * (y2 - y1)) / L));
        d = Math.min(d, Math.hypot(ax - (x1 + (x2 - x1) * k), ay - (y1 + (y2 - y1) * k)));
      }
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  /** The fog over what's not been seen: New Shore's own fog of war, drawn flat. The seen edge
   * stirred and softened, then rolling cloud in two tones over everything past it, dimmer at
   * night. */
  private drawFog(b: CanvasRenderingContext2D, world: World, t: number, night: number): void {
    const W = this.W;
    const H = this.H;
    if (!this.fogImg || this.fogImg.width !== W || this.fogImg.height !== H) this.fogImg = b.createImageData(W, H);
    const img = this.fogImg;
    const d = img.data;
    const field = this.clearField(world);
    const bright = 1 - night * 0.55;
    const tone = 0.3 + bright * 0.72;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const m = this.toMap(x, y);
        // The edge stirred by the wind, as New Shore's is.
        const qx = m.x - t * 1.2;
        const qy = m.y - t * 0.7;
        const jx = (fogNoise(qx * 0.03, qy * 0.03) - 0.5) * 18;
        const jy = (fogNoise(qx * 0.03 + 9, qy * 0.03 + 9) - 0.5) * 18;
        const clear = field.at(m.x + jx, m.y + jy);
        const fogA = smoothstep(-20, 20, clear);
        // Rolling cloud: two drifts of it, crossing.
        const fn = fogFbm(m.x * 0.03 + t * 0.02, m.y * 0.03 - t * 0.013);
        const fn2 = fogFbm(m.x * 0.08 - t * 0.035, m.y * 0.08 - t * 0.02);
        const fog = smoothstep(0.3, 0.7, fogA + (fn - 0.5) * 0.6 + (fn2 - 0.5) * 0.2);
        const o = (y * W + x) * 4;
        if (fog <= 0) {
          d[o + 3] = 0;
          continue;
        }
        const k = smoothstep(0.3, 0.75, fn * 0.7 + fn2 * 0.3);
        d[o] = Math.round((0.7 + 0.25 * k) * tone * 255);
        d[o + 1] = Math.round((0.74 + 0.22 * k) * tone * 255);
        d[o + 2] = Math.round((0.79 + 0.18 * k) * tone * 255);
        d[o + 3] = Math.round(fog * 255);
      }
    }
    // (Laid over the picture through a canvas of its own, so it blends.)
    const c = (this.fogCanvas ??= document.createElement('canvas'));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
    b.drawImage(c, 0, 0);
  }
  private fogCanvas: HTMLCanvasElement | null = null;
  /** How far each bit of sea is from being seen (below 0: seen), on a coarse grid, worked out
   * again only when what's seen changes: round your islands as far as they see, round every
   * island found besides (one a voyage reached sits in a pocket of open sea), and along every
   * route your ships sail. */
  private field: { key: string; at: (x: number, y: number) => number } | null = null;
  private clearField(world: World): { at: (x: number, y: number) => number } {
    const key = JSON.stringify([world.seed, world.isles.map((i) => (ours(i) ? 2 : i.found ? 1 : 0)).join(''), (world.routes ?? []).map((r) => r.to), level(world, 'charts')]);
    if (this.field?.key === key) return this.field;
    const spots: { x: number; y: number; k: number }[] = world.isles.filter((i) => ours(i) || i.found).map((i) => ({ x: i.x, y: i.y, k: ours(i) ? sightFrom(world, i) + i.r * 0.6 : i.r * 0.8 + 14 }));
    // (A lane seen all along it, a little way either side: what the ships see from their decks.)
    for (const r of world.routes ?? []) {
      const lane = this.lane(world, r.to);
      const len = laneLength(lane);
      for (let s = 0; s <= len; s += 10) {
        const p = alongLane(lane, s / len);
        spots.push({ x: p.x, y: p.y, k: LANE_SIGHT });
      }
    }
    const C = 8;
    const gw = Math.ceil(world.w / C) + 1;
    const gh = Math.ceil(world.h / C) + 1;
    // (Fog past 60 map units out reads as fog all the same: each spot only reaches that far.)
    const FAR = 60;
    const g = new Float32Array(gw * gh).fill(FAR);
    for (const s of spots) {
      const reach = s.k + FAR;
      const x0 = Math.max(0, Math.floor((s.x - reach) / C));
      const x1 = Math.min(gw - 1, Math.ceil((s.x + reach) / C));
      const y0 = Math.max(0, Math.floor((s.y - reach) / C));
      const y1 = Math.min(gh - 1, Math.ceil((s.y + reach) / C));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const c = Math.hypot(s.x - x * C, s.y - y * C) - s.k;
          if (c < g[y * gw + x]) g[y * gw + x] = c;
        }
    }
    const at = (x: number, y: number) => {
      const fx = Math.max(0, Math.min(gw - 1.001, x / C));
      const fy = Math.max(0, Math.min(gh - 1.001, y / C));
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const ux = fx - ix;
      const uy = fy - iy;
      const a = g[iy * gw + ix] + (g[iy * gw + ix + 1] - g[iy * gw + ix]) * ux;
      const b = g[(iy + 1) * gw + ix] + (g[(iy + 1) * gw + ix + 1] - g[(iy + 1) * gw + ix]) * ux;
      // (Off the map's edge, nothing's seen.)
      const out = Math.max(0, -x, -y, x - world.w, y - world.h);
      return a + (b - a) * uy + out;
    };
    this.field = { key, at };
    return this.field;
  }

  pan(dx: number, dy: number): void {
    if (!this.zoom) return;
    this.camX -= dx / this.zoom;
    this.camY -= dy / this.zoom;
  }
  zoomAt(ax: number, ay: number, factor: number): void {
    if (!this.zoom) return;
    const at = this.toMap(ax, ay);
    this.zoom = Math.max(0.05, Math.min(3, this.zoom * factor));
    this.camX = at.x - (ax - this.W / 2) / this.zoom;
    this.camY = at.y - (ay - this.midY()) / this.zoom;
  }
  /** The island under a tap, if any (found ones only). */
  isleAt(world: World, ax: number, ay: number): WorldIsle | null {
    const m = this.toMap(ax, ay);
    let best: WorldIsle | null = null;
    for (const i of world.isles) {
      if (!i.found) continue;
      const cx = Math.floor(((m.x - i.x) / (i.r * 2) + 0.5) * MASK);
      const cy = Math.floor(((m.y - i.y) / (i.r * 2) + 0.5) * MASK);
      if (coastAt(i.mask, cx, cy) || Math.hypot(m.x - i.x, m.y - i.y) < i.r * 0.4) best = i;
    }
    return best;
  }
}

/** Map units seen either side of a route. */
const LANE_SIGHT = 26;

// Value noise for the fog (a fixed lattice, smoothly blended), and four octaves of it.
const LATTICE = (() => {
  const a = new Float32Array(256 * 256);
  let s = 12345;
  for (let i = 0; i < a.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    a[i] = s / 0x7fffffff;
  }
  return a;
})();
function fogNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const at = (a: number, b: number) => LATTICE[((b & 255) << 8) | (a & 255)];
  const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ux;
  const c = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ux;
  return a + (c - a) * uy;
}
function fogFbm(x: number, y: number): number {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += fogNoise(x, y) * a;
    x = x * 2.03 + 17;
    y = y * 2.03 + 17;
    a *= 0.5;
  }
  return v;
}
function smoothstep(e0: number, e1: number, x: number): number {
  const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
}
