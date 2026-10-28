// The Soup stage scene: a murky primordial pool. Each generator drifts in it,
// and purchases pop in with a sparkle; some boosts get their own moment.

import { blit, PAL, type SpriteName } from '../art/sprites';
import type { GameState } from '../economy/types';
import { Effects, glints, hash, ring, visibleCount, water, type Frame } from './paint';

type Displace = (x: number, y: number) => [number, number];

const KINDS: Record<string, { salt: number; cap: number; speed: number }> = {
  amino: { salt: 1, cap: 60, speed: 2 },
  lipid: { salt: 2, cap: 30, speed: 1.5 },
  rna: { salt: 3, cap: 20, speed: 3 },
  protocell: { salt: 4, cap: 12, speed: 1 },
};

export class SoupScene {
  private fx = new Effects();
  private W = 0;
  private floor = 0;
  private t = 0;
  private top = 0;
  /** Seconds left of the vents' glow after Warm Vents. */
  private ventGlow = 0;

  reset(): void {
    this.fx.clear();
  }

  private position(kind: string, i: number, displace: Displace): [number, number] {
    const k = KINDS[kind];
    const W = this.W;
    const bx = hash(i, k.salt) * (W + 20);
    const by = this.top + 6 + hash(i, k.salt + 9) * Math.max(1, this.floor - this.top - 16);
    const dir = hash(i, k.salt + 3) < 0.5 ? -1 : 1;
    const sp = k.speed * (0.6 + hash(i, k.salt + 5) * 0.8);
    const x = (((bx + this.t * sp * dir) % (W + 20)) + (W + 20)) % (W + 20) - 10;
    const y = by + Math.sin(this.t * (0.6 + hash(i, k.salt + 7)) + i) * 3;
    return displace(x, y);
  }

  private vents(): number[] {
    return [Math.floor(this.W * 0.2), Math.floor(this.W * 0.68)];
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
    switch (id) {
      case 'lightning':
        fx.add(0.5, (f, age) => {
          if (age > 0.35) return;
          // A jagged bolt from the surface to the floor, flickering.
          if (Math.floor(age * 30) % 3 === 2) return;
          const b = f.b;
          let x = this.W * 0.55;
          b.fillStyle = PAL.w;
          for (let y = 0; y < this.floor; y++) {
            if (y % 3 === 0) x += Math.round(hash(y, 77) * 4 - 2);
            b.fillRect(Math.round(x), y, 1, 1);
            if (y % 7 === 0) {
              b.fillStyle = PAL.y;
              b.fillRect(Math.round(x) + 1, y, 1, 1);
              b.fillStyle = PAL.w;
            }
          }
        });
        fx.add(0.3, (f, age) => {
          f.b.fillStyle = `rgba(242, 234, 215, ${0.5 * (1 - age / 0.3)})`;
          f.b.fillRect(0, 0, f.W, f.H);
        });
        break;
      case 'warmVents':
        this.ventGlow = 2.5;
        for (const vx of this.vents()) for (let i = 0; i < 6; i++) fx.pulse(vx, this.floor - 9, PAL.o, i * 0.15);
        break;
      case 'tidalMixing':
        fx.add(1.4, (f, age) => ring(f.b, this.W / 2, this.floor / 2, 6 + age * 40, PAL.b, 0.4));
        fx.add(1.4, (f, age) => ring(f.b, this.W / 2, this.floor / 2, 6 + age * 30, PAL.w, 0.4), 0.2);
        break;
      case 'aminoChains':
      case 'lipidFolding':
      case 'catalyticRna': {
        const kind = id === 'aminoChains' ? 'amino' : id === 'lipidFolding' ? 'lipid' : 'rna';
        const n = visibleCount(gens[kind], KINDS[kind].cap);
        for (let i = 0; i < Math.min(n, 12); i++) {
          const [x, y] = this.position(kind, i, displace);
          fx.sparkle(x, y, i * 0.05);
        }
        break;
      }
    }
  }

  draw(f: Frame, state: GameState, displace: Displace): void {
    const { b, W, H, t, dt, top } = f;
    const floor = Math.floor(H * 0.86);
    this.top = top;
    this.W = W;
    this.floor = floor;
    this.t = t;
    this.ventGlow = Math.max(0, this.ventGlow - dt);
    const st = state.stages.soup;
    const gens = st.generators;
    const warm = st.upgrades.includes('warmVents');

    water(f, ['#3d6b5c', '#2f5a50', '#244a44', '#1a3a37', '#122c2c'], floor);
    // Shafts of light from the surface: dithered diagonal bands that drift.
    b.fillStyle = '#467563';
    for (let s = 0; s < 3; s++) {
      const x0 = W * (0.12 + s * 0.32) + Math.sin(t * 0.2 + s * 2) * 5;
      const depth = floor * (0.55 + s * 0.1);
      for (let y = 0; y < depth; y++) {
        const x = Math.floor(x0 + y * 0.35);
        // Thin out toward the bottom so the light fades instead of stopping.
        const keep = y < depth * 0.6 ? 2 : 4;
        for (let k = 0; k < 6; k++) if ((x + k + y) % keep === 0) b.fillRect(x + k, y, 1, 1);
      }
    }
    glints(f, '#5d8d75', floor);

    // Silt floor with dark vent rocks that breathe bubbles; warmer once Warm Vents is bought.
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
      const glow = this.ventGlow > 0 && Math.floor(t * 10) % 2 === 0;
      b.fillStyle = glow ? PAL.y : warm ? PAL.o : '#e8615a';
      b.fillRect(vx - (warm ? 2 : 1), floor - 8, warm ? 4 : 2, 1);
      const bubbles = warm ? 7 : 4;
      for (let i = 0; i < bubbles; i++) {
        const age = (t * (warm ? 0.7 : 0.5) + i / bubbles + vx * 0.01) % 1;
        const by = floor - 9 - age * floor * 0.8;
        b.fillStyle = PAL.b;
        b.fillRect(Math.round(vx + Math.sin(age * 12 + i) * 2), Math.round(by), 1, 1);
      }
    }

    // Generators, drifting. Each kind moves its own way.
    const each = (kind: string, draw: (x: number, y: number, i: number) => void) => {
      const n = visibleCount(gens[kind], KINDS[kind].cap);
      for (let i = 0; i < n; i++) {
        const [x, y] = this.position(kind, i, displace);
        draw(x, y, i);
      }
    };
    const chained = st.upgrades.includes('aminoChains');
    each('amino', (x, y, i) => {
      b.fillStyle = i % 3 ? PAL.y : PAL.Y;
      b.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (chained || i % 4 === 0) b.fillRect(Math.round(x) + 1, Math.round(y), 1, 1);
      if (chained) b.fillRect(Math.round(x) + 2, Math.round(y) + 1, 1, 1);
    });
    each('lipid', (x, y) => blit(b, 'bubble', x, y));
    each('rna', (x, y, i) => blit(b, (Math.floor(t * 4 + i) % 2 ? 'rnaA' : 'rnaB') as SpriteName, x, y, i % 2 === 0));
    each('protocell', (x, y, i) => blit(b, 'protoSmall', x, y, i % 2 === 0));

    this.fx.run(f);
  }
}
