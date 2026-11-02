// How a cell looks, built from its mutations: diet colours it, a flagellum or
// two trail behind, cilia bristle, spikes stick out, a thick membrane doubles the
// outline, an eyespot sits at the front. Every look is drawn pixel by pixel once
// and cached, so a swarm of them costs no more than a sprite each.

import { PAL } from '../art/sprites';
import { acclimOf, dietOf, sizeOf } from '../economy/rates';
import type { Diet, GameState, StageId } from '../economy/types';

export interface Look {
  diet: Diet | null;
  flagella: number;
  cilia: boolean;
  spikes: boolean;
  toxin: boolean;
  thick: boolean;
  eyespot: boolean;
  size: number;
  /** Organelle ids found, drawn inside the hero. */
  organelles: string[];
  /** Which habitat's kind of cell this is: each place grows its own. Unset for your own cell. */
  species?: 'shallows' | 'depths' | 'vents';
  /** Your own cell takes on the look of where it has settled: the habitat, and 0 to 3 steps of it. */
  settled?: { habitat: string; step: number };
}

/** Mixes two #rrggbb colours. */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * Each habitat's own kind of cell. Shallows cells wear the lineage's diet colours;
 * Depths cells are dark, slim and glow at the edge, with a little lure out front;
 * Vents cells are hot red rods bristling with hairs.
 */
const SPECIES = {
  depths: { fill: '#1c3550', edge: '#7fd3f0', nucleus: '#b8f0ff', squash: 0.55 },
  vents: { fill: '#c4452f', edge: '#f5c45e', nucleus: '#5a1a10', squash: 0.5 },
} as const;

export function lookOf(state: GameState, stage: StageId): Look {
  const st = state.stages[stage];
  const has = (u: string) => st.upgrades.includes(u);
  return {
    diet: dietOf(state, stage),
    flagella: has('twinFlagella') ? 2 : has('flagellum') ? 1 : 0,
    cilia: has('cilia'),
    spikes: has('spikes'),
    toxin: has('toxin'),
    thick: has('thickMembrane'),
    eyespot: has('eyespot'),
    size: sizeOf(state, stage),
    organelles: st.discovered,
    settled: { habitat: st.habitat, step: Math.floor(acclimOf(state, stage, st.habitat) * 3 + 1e-9) },
  };
}

/** Body colours (fill, outline) for each diet. */
export const DIET_COLORS: Record<string, [string, string]> = {
  none: [PAL.G, PAL.g],
  // Teal rather than leaf green, so grazers never look like the algae they eat.
  grazer: ['#2f8a8f', '#86dcd8'],
  hunter: ['#b8573f', '#f2906c'],
  omnivore: ['#b88a2e', '#f5c45e'],
};

export const ORGANELLE_COLORS: Record<string, string> = {
  chloroplast: PAL.l,
  mitochondrion: PAL.o,
  vacuole: PAL.b,
  peroxisome: PAL.p,
  golgi: PAL.y,
  lysosome: PAL.P,
  nucleus: PAL.n,
};

interface Baked {
  canvas: HTMLCanvasElement;
  /** Where the cell's centre sits inside the canvas. */
  cx: number;
  cy: number;
}

const cache = new Map<string, Baked>();

/**
 * Draws a cell facing right (flipped when facing left) at radius `rx`.
 * `frame` (0 or 1) animates the tail and cilia; `squash` makes it bulge.
 */
function bake(look: Look, rx: number, frame: number, squash: boolean, inner: boolean): Baked {
  const ry = Math.max(2, Math.round(rx * (look.species === 'depths' ? SPECIES.depths.squash : look.species === 'vents' ? SPECIES.vents.squash : 0.75)));
  const pad = 7;
  const w = rx * 2 + pad * 2 + 1;
  const h = ry * 2 + pad * 2 + 1;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const b = c.getContext('2d')!;
  const cx = pad + rx;
  const cy = pad + ry;
  const sp = look.species && look.species !== 'shallows' ? SPECIES[look.species] : null;
  let [fill, edge] = sp ? [sp.fill, sp.edge] : DIET_COLORS[look.diet ?? 'none'];
  // Settling in: the Depths dim your cell and give it a glowing edge; the Vents flush it red.
  const settle = inner && look.settled ? look.settled : null;
  if (settle?.habitat === 'depths' && settle.step >= 1) edge = mix(edge, SPECIES.depths.edge, settle.step >= 2 ? 1 : 0.5);
  if (settle?.habitat === 'depths' && settle.step >= 2) fill = mix(fill, SPECIES.depths.fill, 0.55);
  if (settle?.habitat === 'vents' && settle.step >= 1) fill = mix(fill, SPECIES.vents.fill, settle.step >= 2 ? 0.7 : 0.4);
  if (settle?.habitat === 'vents' && settle.step >= 3) edge = mix(edge, SPECIES.vents.edge, 0.7);
  const nucleus = sp ? sp.nucleus : PAL.n;
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const sx = squash ? 1.15 : 1;
  const sy = squash ? 0.85 : 1;
  // Small cells get a looser edge test, so they come out round rather than diamond.
  const edgeIn = 1 + 0.9 / rx;
  const ellipse = (x: number, y: number) => ((x - cx) / (rx * sx)) ** 2 + ((y - cy) / (ry * sy)) ** 2 <= edgeIn;
  // Vents cells are capsules: a straight middle with round ends.
  const capsule = (x: number, y: number) => {
    const half = rx * sx - ry * sy;
    const dx = Math.max(0, Math.abs(x - cx) - half);
    return dx * dx + (y - cy) ** 2 <= (ry * sy) ** 2 + 0.6;
  };
  const inside = look.species === 'vents' ? capsule : ellipse;

  // Flagella trail behind (to the left), whipping between two frames.
  for (let f = 0; f < look.flagella; f++) {
    const off = look.flagella === 2 ? (f === 0 ? -2 : 2) : 0;
    for (let i = 1; i <= (rx <= 4 ? 4 : rx + 4); i++) {
      const wave = Math.round(Math.sin(i * 0.9 + frame * Math.PI) * (i > 2 ? 1 : 0));
      px(cx - rx * sx - i + 1, cy + off + wave, edge);
    }
  }
  // Body: fill, then the outline (doubled for a thick membrane).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      const rim2 = look.thick && (!inside(x - 2, y) || !inside(x + 2, y) || !inside(x, y - 2) || !inside(x, y + 2));
      // A thick membrane shows as a second, inner outline in the body's own edge colour.
      px(x, y, rim || rim2 ? edge : fill);
    }
  }
  // Cilia: short hairs all round, alternating frames.
  if (look.cilia) {
    const n = Math.round(rx * 3);
    for (let i = 0; i < n; i++) {
      if ((i + frame) % 2) continue;
      const a = (i / n) * Math.PI * 2;
      px(cx + Math.cos(a) * (rx * sx + 1), cy + Math.sin(a) * (ry * sy + 1), edge);
    }
  }
  // Spikes: points sticking out; purple when toxic.
  if (look.spikes) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      for (let k = 1; k <= 2; k++) px(cx + Math.cos(a) * (rx * sx + k), cy + Math.sin(a) * (ry * sy + k), look.toxin ? PAL.p : PAL.w);
    }
  }
  // Vents cells bristle with short hairs that flicker in the heat (and so does yours, once settled there).
  if (look.species === 'vents' || (settle?.habitat === 'vents' && settle.step >= 2)) {
    for (let x = Math.round(cx - rx + 1); x <= cx + rx - 1; x += 2) {
      px(x + frame, cy - ry - 1, edge);
      px(x + 1 - frame, cy + ry + 1, edge);
    }
  }
  // Depths cells dangle a glowing lure in front, to draw prey in the dark.
  if (look.species === 'depths' || (settle?.habitat === 'depths' && settle.step >= 3)) {
    px(cx + rx, cy - ry, edge);
    px(cx + rx + 1, cy - ry - 1, edge);
    // The light itself holds still (a steady glow), at the spot lureTip() reports.
    px(cx + rx + 2, cy - ry - 1, '#fff6a0');
  }
  // Shallows cells carry a speck of green from all that sunlight.
  if (look.species === 'shallows' || (settle?.habitat === 'shallows' && settle.step >= 2)) px(cx - 2, cy + 1, PAL.l);
  if (settle?.habitat === 'shallows' && settle.step >= 3) px(cx + 1, cy + 2, PAL.l);
  // Inside: a nucleus, organelles (hero only), and an eyespot at the front.
  px(cx, cy, nucleus);
  px(cx + 1, cy, nucleus);
  if (rx >= 4 && look.species !== 'vents') px(cx, cy - 1, nucleus);
  if (inner) {
    look.organelles.forEach((o, i) => {
      const a = (i / Math.max(1, look.organelles.length)) * Math.PI * 2;
      const col = ORGANELLE_COLORS[o];
      if (!col) return;
      px(cx + Math.cos(a) * rx * 0.5, cy + Math.sin(a) * ry * 0.5, col);
    });
  }
  if (look.eyespot) px(cx + rx * sx - 2, cy - 1, '#e8615a');
  return { canvas: c, cx, cy };
}

function key(look: Look, rx: number, frame: number, squash: boolean, inner: boolean): string {
  return [look.species ?? '', look.diet, look.flagella, look.cilia, look.spikes, look.toxin, look.thick, look.eyespot, inner ? look.organelles.join('.') : '', inner && look.settled ? `${look.settled.habitat}${look.settled.step}` : '', rx, frame, squash].join('|');
}

/** Where a Depths cell's lure light sits when drawn at (x, y) with radius rx, so glows can line up. */
export function lureTip(x: number, y: number, rx: number, left: boolean): [number, number] {
  const ry = Math.max(2, Math.round(rx * SPECIES.depths.squash));
  return [Math.round(x) + (left ? -(rx + 2) : rx + 2), Math.round(y) - ry - 1];
}

const flipped = new Map<string, HTMLCanvasElement>();

/** Draws a cell centred on (x, y). */
export function drawCellLook(
  b: CanvasRenderingContext2D,
  look: Look,
  x: number,
  y: number,
  opts: { rx: number; left?: boolean; frame?: number; squash?: boolean; inner?: boolean },
): void {
  const frame = opts.frame ?? 0;
  const squash = !!opts.squash;
  const inner = !!opts.inner;
  const k = key(look, opts.rx, frame, squash, inner);
  let baked = cache.get(k);
  if (!baked) {
    if (cache.size > 300) cache.clear();
    baked = bake(look, opts.rx, frame, squash, inner);
    cache.set(k, baked);
  }
  let canvas = baked.canvas;
  let cx = baked.cx;
  if (opts.left) {
    let f = flipped.get(k);
    if (!f) {
      if (flipped.size > 300) flipped.clear();
      f = document.createElement('canvas');
      f.width = canvas.width;
      f.height = canvas.height;
      const fb = f.getContext('2d')!;
      fb.translate(f.width, 0);
      fb.scale(-1, 1);
      fb.drawImage(canvas, 0, 0);
      flipped.set(k, f);
    }
    canvas = f;
    cx = canvas.width - 1 - baked.cx;
  }
  b.drawImage(canvas, Math.round(x - cx), Math.round(y - baked.cy));
}
