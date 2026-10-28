// The Soup stage scene: a murky primordial pool. Each molecule drifts in it,
// the dials change how the pool looks (glowing vents, sunlight, crackling
// charge), circling fingers spin a whirlpool, and discoveries get their moment.

import { blit, PAL, type SpriteName } from '../art/sprites';
import { STAGES } from '../content/stages';
import { checkReaction, conditionsHold, nextReaction } from '../economy/actions';
import type { GameState, ReactionDef } from '../economy/types';
import { Effects, ease, glints, hash, ring, visibleCount, water, type Frame } from './paint';

type Displace = (x: number, y: number) => [number, number];

interface Kind {
  salt: number;
  cap: number;
  speed: number;
  draw: (f: Frame, x: number, y: number, i: number) => void;
}

const sprite = (name: SpriteName) => (f: Frame, x: number, y: number, i: number) => blit(f.b, name, x, y, i % 2 === 0);

const KINDS: Record<string, Kind> = {
  amino: {
    salt: 1,
    cap: 40,
    speed: 2,
    draw: (f, x, y, i) => {
      f.b.fillStyle = i % 3 ? PAL.y : PAL.Y;
      f.b.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (i % 4 === 0) f.b.fillRect(Math.round(x) + 1, Math.round(y), 1, 1);
    },
  },
  peptide: { salt: 5, cap: 20, speed: 1.8, draw: sprite('peptideSmall') },
  sugar: { salt: 6, cap: 16, speed: 1.2, draw: sprite('sugarSmall') },
  lipid: { salt: 2, cap: 16, speed: 1.5, draw: sprite('bubble') },
  nucleotide: { salt: 7, cap: 14, speed: 2.2, draw: sprite('nucleoSmall') },
  rna: { salt: 3, cap: 16, speed: 3, draw: (f, x, y, i) => blit(f.b, Math.floor(f.t * 4 + i) % 2 ? 'rnaA' : 'rnaB', x, y, i % 2 === 0) },
  protocell: { salt: 4, cap: 12, speed: 1, draw: sprite('protoSmall') },
};

/** Which molecule a boost improves, for its sparkle. */
const BOOSTED: Record<string, string> = {
  aminoChains: 'amino',
  peptideFolding: 'peptide',
  sugarCrystals: 'sugar',
  lipidLayers: 'lipid',
  baseStacking: 'nucleotide',
  catalyticRna: 'rna',
  protoMembranes: 'protocell',
};

export class SoupScene {
  private fx = new Effects();
  private W = 0;
  private floor = 0;
  private t = 0;
  private top = 0;
  /** Seconds left of the vents flaring after a heat boost. */
  private ventGlow = 0;
  /** Where the whirlpool is (art pixels) and which way it turns. */
  private whirlX = 0;
  private whirlY = 0;
  private whirlDir = 1;
  /** Swirl as last drawn, so molecules keep their place as it fades. */
  private swirl = 0;
  private finaleAt = -1;
  private nextBolt = 0;
  /** When the next pair of molecules meets in the scene. */
  private nextBond = 1;
  /** Molecules (`kind:index`) borrowed by a bonding animation, not drawn in place. */
  private busy = new Set<string>();
  private displace: Displace = (x, y) => [x, y];

  reset(): void {
    this.fx.clear();
    this.busy.clear();
    this.finaleAt = -1;
  }

  whirl(x: number, y: number, dir: number): void {
    // Ease toward the finger's circle so the vortex doesn't jump around.
    this.whirlX = this.swirl > 0.05 ? this.whirlX + (x - this.whirlX) * 0.2 : x;
    this.whirlY = this.swirl > 0.05 ? this.whirlY + (y - this.whirlY) * 0.2 : y;
    this.whirlDir = dir || 1;
  }

  private vents(): number[] {
    return [Math.floor(this.W * 0.2), Math.floor(this.W * 0.68)];
  }

  /** A molecule's place: drifting, pushed by stirs, and caught by the whirlpool. */
  private position(kind: string, i: number, displace: Displace): [number, number] {
    const k = KINDS[kind];
    const W = this.W;
    const bx = hash(i, k.salt) * (W + 20);
    const by = this.top + 6 + hash(i, k.salt + 9) * Math.max(1, this.floor - this.top - 16);
    const dir = hash(i, k.salt + 3) < 0.5 ? -1 : 1;
    const sp = k.speed * (0.6 + hash(i, k.salt + 5) * 0.8);
    let x = (((bx + this.t * sp * dir) % (W + 20)) + (W + 20)) % (W + 20) - 10;
    let y = by + Math.sin(this.t * (0.6 + hash(i, k.salt + 7)) + i) * 3;
    if (this.swirl > 0) {
      const dx = x - this.whirlX;
      const dy = y - this.whirlY;
      const d = Math.hypot(dx, dy);
      const reach = 30 + this.swirl * 25;
      if (d < reach) {
        const pull = (1 - d / reach) * this.swirl;
        const a = Math.atan2(dy, dx) + this.whirlDir * pull * (this.t * 3 + i);
        const r = d * (1 - pull * 0.6);
        x = this.whirlX + Math.cos(a) * r;
        y = this.whirlY + Math.sin(a) * r * 0.7;
      }
    }
    return displace(x, y);
  }

  purchase(state: GameState, id: string, displace: Displace): void {
    const fx = this.fx;
    const gens = state.stages.soup.generators;
    if (KINDS[id]) {
      // Sparkle where the newest one appeared.
      const n = visibleCount(gens[id], KINDS[id].cap);
      const [x, y] = this.position(id, Math.max(0, n - 1), displace);
      fx.sparkle(x, y);
      return;
    }
    if (BOOSTED[id]) {
      const kind = BOOSTED[id];
      const n = visibleCount(gens[kind], KINDS[kind].cap);
      for (let i = 0; i < Math.min(n, 12); i++) {
        const [x, y] = this.position(kind, i, displace);
        fx.sparkle(x, y, i * 0.05);
      }
      return;
    }
    switch (id) {
      case 'lightning':
      case 'thunderhead':
        this.bolt(this.W * (0.3 + Math.random() * 0.4), true);
        break;
      case 'warmVents':
      case 'volcanic':
        this.ventGlow = 2.5;
        for (const vx of this.vents()) for (let i = 0; i < 6; i++) fx.pulse(vx, this.floor - 9, PAL.o, i * 0.15);
        break;
      case 'sunlit':
      case 'clearSkies':
        fx.add(1.2, (f, age) => {
          f.b.fillStyle = `rgba(255, 236, 170, ${0.35 * (1 - age / 1.2)})`;
          f.b.fillRect(0, 0, f.W, this.floor);
        });
        break;
      case 'tidalMixing':
      case 'warmHands':
      case 'undertow':
        fx.add(1.4, (f, age) => ring(f.b, this.W / 2, this.floor / 2, 6 + age * 40, PAL.b, 0.4));
        fx.add(1.4, (f, age) => ring(f.b, this.W / 2, this.floor / 2, 6 + age * 30, PAL.w, 0.4), 0.2);
        break;
    }
  }

  /** A jagged bolt from the surface down, flickering; optionally with a flash. */
  private bolt(x0: number, flash: boolean): void {
    const seed = Math.random() * 100;
    this.fx.add(0.5, (f, age) => {
      if (age > 0.35 || Math.floor(age * 30) % 3 === 2) return;
      let x = x0;
      f.b.fillStyle = PAL.w;
      for (let y = 0; y < this.floor; y++) {
        if (y % 3 === 0) x += Math.round(hash(y, seed) * 4 - 2);
        f.b.fillRect(Math.round(x), y, 1, 1);
      }
    });
    if (flash) {
      this.fx.add(0.3, (f, age) => {
        f.b.fillStyle = `rgba(242, 234, 215, ${0.5 * (1 - age / 0.3)})`;
        f.b.fillRect(0, 0, f.W, f.H);
      });
    }
  }

  /** A reaction was discovered: two sparks race together and burst. */
  discovery(): void {
    const cx = this.W / 2;
    const cy = this.top + (this.floor - this.top) / 2;
    this.fx.add(0.7, (f, age) => {
      const k = ease(age / 0.7);
      blit(f.b, 'sparkA', cx - 30 + 30 * k, cy - 10 + 10 * k);
      blit(f.b, 'sparkA', cx + 30 - 30 * k, cy + 10 - 10 * k);
    });
    for (let i = 0; i < 3; i++) this.fx.pulse(cx, cy, i % 2 ? PAL.y : PAL.w, 0.7 + i * 0.15);
    for (let i = 0; i < 10; i++) this.fx.sparkle(cx + (Math.random() - 0.5) * 60, cy + (Math.random() - 0.5) * 40, 0.75 + Math.random() * 0.4);
  }

  /**
   * Two molecules meet. If the reaction's conditions hold they bond, flash and
   * release the product; if not (the reaction you're close to), they fizzle and
   * bounce apart. Either way the pool shows whether the dials are right.
   */
  private bond(state: GameState, r: ReactionDef, works: boolean): void {
    const [ka, kb] = r.pair!;
    const gens = state.stages.soup.generators;
    const na = visibleCount(gens[ka], KINDS[ka].cap);
    const nb = visibleCount(gens[kb], KINDS[kb].cap);
    const free = (k: string, n: number, not = -1) => {
      const opts = Array.from({ length: n }, (_, i) => i).filter((i) => i !== not && !this.busy.has(`${k}:${i}`));
      return opts.length ? opts[Math.floor(Math.random() * opts.length)] : -1;
    };
    const ia = free(ka, na);
    const ib = free(kb, nb, ka === kb ? ia : -1);
    if (ia < 0 || ib < 0) return;
    const keyA = `${ka}:${ia}`;
    const keyB = `${kb}:${ib}`;
    const [ax, ay] = this.position(ka, ia, this.displace);
    const [bx0, by0] = this.position(kb, ib, this.displace);
    // Pull the partner in close first, so pairs never fly across the whole pool.
    const d = Math.hypot(bx0 - ax, by0 - ay) || 1;
    const reach = Math.min(d, 18);
    const bx = ax + ((bx0 - ax) / d) * reach;
    const by = ay + ((by0 - ay) / d) * reach;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    this.busy.add(keyA);
    this.busy.add(keyB);
    const life = works ? 1.4 : 1.1;
    this.fx.add(life, (f, age) => {
      const b = f.b;
      if (age >= life - f.dt * 1.5) {
        this.busy.delete(keyA);
        this.busy.delete(keyB);
      }
      if (works) {
        if (age < 0.6) {
          const k = ease(age / 0.6);
          const pa = [ax + (mx - ax) * k, ay + (my - ay) * k];
          const pb = [bx + (mx - bx) * k, by + (my - by) * k];
          b.globalAlpha = 0.8;
          ring(b, pa[0], pa[1], 4, PAL.w, 1);
          ring(b, pb[0], pb[1], 4, PAL.w, 1);
          b.globalAlpha = 1;
          KINDS[ka].draw(f, pa[0], pa[1], ia);
          KINDS[kb].draw(f, pb[0], pb[1], ib);
          if (age > 0.3) {
            // A bond forming between them.
            b.fillStyle = PAL.w;
            for (let s = 0; s <= 4; s++) b.fillRect(Math.round(pa[0] + ((pb[0] - pa[0]) * s) / 4), Math.round(pa[1] + ((pb[1] - pa[1]) * s) / 4), 1, 1);
          }
        } else {
          const k = (age - 0.6) / (life - 0.6);
          if (age < 0.75) blit(b, 'sparkA', mx, my);
          if (age < 1.1) {
            b.globalAlpha = 1 - (age - 0.6) / 0.5;
            ring(b, mx, my, 3 + (age - 0.6) * 22, PAL.y, 0.8);
            b.globalAlpha = 1;
          }
          if (r.unlocks && KINDS[r.unlocks]) {
            b.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
            KINDS[r.unlocks].draw(f, mx, my - k * 4, 0);
            b.globalAlpha = 1;
          } else if (Math.floor(age * 10) % 2) blit(b, 'sparkB', mx, my - k * 4);
        }
      } else {
        // Close, but no: they bump, puff, and drift apart again.
        const k = age < 0.45 ? ease(age / 0.45) * 0.7 : 0.7 * (1 - ease((age - 0.45) / 0.65));
        if (age < 0.45) {
          b.globalAlpha = 0.7;
          ring(b, ax + (mx - ax) * k, ay + (my - ay) * k, 4, '#9aa6a2', 1);
          ring(b, bx + (mx - bx) * k, by + (my - by) * k, 4, '#9aa6a2', 1);
          b.globalAlpha = 1;
        }
        KINDS[ka].draw(f, ax + (mx - ax) * k, ay + (my - ay) * k, ia);
        KINDS[kb].draw(f, bx + (mx - bx) * k, by + (my - by) * k, ib);
        if (age > 0.4 && age < 0.9) {
          const p = (age - 0.4) / 0.5;
          b.fillStyle = '#7d8a86';
          b.globalAlpha = 1 - p;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            b.fillRect(Math.round(mx + Math.cos(a) * (1 + p * 7)), Math.round(my + Math.sin(a) * (1 + p * 5) - p * 3), 2, 1);
          }
          b.globalAlpha = 1;
        }
      }
    });
  }

  /** Picks which pairs are meeting right now. */
  private chemistry(state: GameState): void {
    if (this.t < this.nextBond || this.finaleAt >= 0) return;
    const st = state.stages.soup;
    const gens = st.generators;
    const has = (k: string, n: number) => visibleCount(gens[k], KINDS[k].cap) >= n;
    const options: { r: ReactionDef; works: boolean }[] = [];
    const next = nextReaction(state, 'soup');
    for (const r of STAGES.soup.reactions ?? []) {
      if (!r.pair) continue;
      const [a, b] = r.pair;
      if (!has(a, a === b ? 2 : 1) || !has(b, 1)) continue;
      if (st.discovered.includes(r.id)) {
        if (conditionsHold(state, 'soup', r)) options.push({ r, works: true });
      } else if (next?.r === r && checkReaction(state, 'soup', r).gens) {
        options.push({ r, works: conditionsHold(state, 'soup', r) });
      }
    }
    // Faster chemistry in a spinning whirlpool.
    this.nextBond = this.t + (1.3 - this.swirl * 0.8) * (0.6 + Math.random() * 0.8);
    if (!options.length) return;
    const pick = options[Math.floor(Math.random() * options.length)];
    this.bond(state, pick.r, pick.works);
  }

  /** The Spark of Life: everything is drawn into the middle, then light. */
  finale(): void {
    this.finaleAt = this.t;
  }

  draw(f: Frame, state: GameState, displace: Displace): void {
    const { b, W, H, t, dt, top } = f;
    const floor = Math.floor(H * 0.86);
    this.W = W;
    this.floor = floor;
    this.t = t;
    this.top = top;
    this.swirl = state.swirl;
    this.displace = displace;
    this.ventGlow = Math.max(0, this.ventGlow - dt);
    const st = state.stages.soup;
    const { heat, light, charge } = st.dials;

    // Warmer water as the heat goes up.
    const bands = [
      ['#3d6b5c', '#2f5a50', '#244a44', '#1a3a37', '#122c2c'],
      ['#41705a', '#33604f', '#284f43', '#1e3f36', '#16302b'],
      ['#4a7058', '#3c624c', '#305341', '#264536', '#1e372b'],
      ['#56705a', '#48634c', '#3b5440', '#314636', '#2a382b'],
    ][heat];
    water(f, bands, floor);

    // Sunlight: more and brighter shafts as Light turns up.
    const shafts = [1, 2, 3, 4][light];
    b.fillStyle = ['#3f6b5a', '#467563', '#5a8a70', '#7aa585'][light];
    for (let s = 0; s < shafts; s++) {
      const x0 = W * (0.08 + s * (0.85 / shafts)) + Math.sin(t * 0.2 + s * 2) * 5;
      const depth = floor * (0.5 + light * 0.1 + s * 0.05);
      for (let y = 0; y < depth; y++) {
        const x = Math.floor(x0 + y * 0.35);
        const keep = y < depth * 0.6 ? 2 : 4;
        for (let k = 0; k < 4 + light * 2; k++) if ((x + k + y) % keep === 0) b.fillRect(x + k, y, 1, 1);
      }
    }
    glints(f, '#5d8d75', floor);

    // Silt floor with vents that glow and bubble harder with heat.
    b.fillStyle = '#3b3a2f';
    b.fillRect(0, floor, W, H - floor);
    b.fillStyle = '#2b2a22';
    for (let i = 0; i < 30; i++) b.fillRect((i * 29) % W, floor + 2 + ((i * 7) % Math.max(1, H - floor - 2)), 2, 1);
    for (const vx of this.vents()) {
      for (let y = 0; y < 8; y++) {
        const half = Math.round((8 - y) * 0.9);
        b.fillStyle = y < 2 ? '#1c1b16' : '#2b2a22';
        b.fillRect(vx - half, floor - y, half * 2, 1);
      }
      const flare = this.ventGlow > 0 && Math.floor(t * 10) % 2 === 0;
      b.fillStyle = flare ? PAL.y : ['#6b3a33', '#e8615a', PAL.o, PAL.y][heat];
      b.fillRect(vx - 1 - heat, floor - 8, 2 + heat * 2, 1);
      const bubbles = 2 + heat * 3;
      for (let i = 0; i < bubbles; i++) {
        const age = (t * (0.4 + heat * 0.2) + i / bubbles + vx * 0.01) % 1;
        b.fillStyle = PAL.b;
        b.fillRect(Math.round(vx + Math.sin(age * 12 + i) * 2), Math.round(floor - 9 - age * floor * 0.8), 1, 1);
      }
    }

    // Charge: sparks crackle through the water; at full charge, small bolts.
    if (charge > 0) {
      b.fillStyle = PAL.y;
      for (let i = 0; i < charge * 3; i++) {
        const k = Math.floor(t * 6 + i * 7);
        if (hash(k, i) > 0.35) continue;
        const x = Math.floor(hash(k, i + 50) * W);
        const y = top + Math.floor(hash(k, i + 90) * (floor - top));
        b.fillRect(x, y, 1, 1);
        b.fillRect(x + 1, y + 1, 1, 1);
        b.fillRect(x, y + 2, 1, 1);
      }
      if (charge === 3 && t >= this.nextBolt) {
        this.bolt(W * (0.15 + Math.random() * 0.7), false);
        this.nextBolt = t + 2 + Math.random() * 3;
      }
    }

    // The whirlpool: bold spiral arms around where the finger is circling,
    // with a dark eye in the middle.
    if (this.swirl > 0.02) {
      const arms = 3;
      const len = 16 + this.swirl * 30;
      const fade = Math.min(1, this.swirl * 2);
      b.fillStyle = '#10241f';
      b.globalAlpha = fade * 0.6;
      b.fillRect(Math.round(this.whirlX) - 2, Math.round(this.whirlY) - 1, 4, 3);
      for (let a = 0; a < arms; a++) {
        for (let s = 0; s < len; s++) {
          const ang = this.whirlDir * (t * (2 + this.swirl * 4)) + (a / arms) * Math.PI * 2 + s * 0.2 * this.whirlDir;
          const r = 3 + s * 1.1;
          const x = Math.round(this.whirlX + Math.cos(ang) * r);
          const y = Math.round(this.whirlY + Math.sin(ang) * r * 0.7);
          b.globalAlpha = fade * (1 - s / len);
          b.fillStyle = s < len * 0.4 ? PAL.w : PAL.b;
          b.fillRect(x, y, 2, 1);
        }
      }
      b.globalAlpha = 1;
    }

    // Molecules. During the finale, everything drifts into the middle.
    const fin = this.finaleAt >= 0 ? ease((t - this.finaleAt) / 3) : 0;
    const cx = W / 2;
    const cy = top + (floor - top) / 2;
    for (const g of STAGES.soup.generators) {
      const kind = KINDS[g.id];
      const n = visibleCount(st.generators[g.id], kind.cap);
      for (let i = 0; i < n; i++) {
        if (this.busy.has(`${g.id}:${i}`)) continue;
        let [x, y] = this.position(g.id, i, displace);
        if (fin > 0) {
          x += (cx - x) * fin;
          y += (cy - y) * fin;
        }
        kind.draw(f, x, y, i);
      }
    }
    if (fin > 0) {
      const glow = Math.min(1, (t - this.finaleAt - 2.5) / 1.5);
      if (glow > 0) {
        b.fillStyle = `rgba(242, 234, 215, ${glow})`;
        b.fillRect(0, 0, W, H);
      }
      if (Math.floor(t * 3) % 2 === 0) ring(b, cx, cy, 4 + ((t - this.finaleAt) % 1) * 20, PAL.w);
    }

    this.chemistry(state);
    this.fx.run(f);
  }
}
