// How a cell looks, built from its mutations: diet colours it, a flagellum or
// two trail behind, cilia bristle, spikes stick out, a thick membrane doubles the
// outline, an eyespot sits at the front. Every look is drawn pixel by pixel once
// and cached, so a swarm of them costs no more than a sprite each.

import { PAL } from '../art/sprites';
import { dietOf, sizeOf } from '../economy/rates';
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
}

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
  const ry = Math.max(2, Math.round(rx * 0.75));
  const pad = 7;
  const w = rx * 2 + pad * 2 + 1;
  const h = ry * 2 + pad * 2 + 1;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const b = c.getContext('2d')!;
  const cx = pad + rx;
  const cy = pad + ry;
  const [fill, edge] = DIET_COLORS[look.diet ?? 'none'];
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const sx = squash ? 1.15 : 1;
  const sy = squash ? 0.85 : 1;
  // Small cells get a looser edge test, so they come out round rather than diamond.
  const edgeIn = 1 + 0.9 / rx;
  const inside = (x: number, y: number) => ((x - cx) / (rx * sx)) ** 2 + ((y - cy) / (ry * sy)) ** 2 <= edgeIn;

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
      px(x, y, rim ? edge : rim2 ? PAL.w : fill);
    }
  }
  // Your own cell catches the light along its top-left edge, a quiet way to tell it from its kin.
  if (inner) {
    for (let y = 0; y < cy; y++) {
      for (let x = 0; x < cx + 1; x++) {
        if (inside(x, y) && (!inside(x - 1, y) || !inside(x, y - 1))) px(x, y, PAL.w);
      }
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
  // Inside: a nucleus, organelles (hero only), and an eyespot at the front.
  px(cx, cy, PAL.n);
  px(cx + 1, cy, PAL.n);
  if (rx >= 4) px(cx, cy - 1, PAL.n);
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
  return [look.diet, look.flagella, look.cilia, look.spikes, look.toxin, look.thick, look.eyespot, inner ? look.organelles.join('.') : '', rx, frame, squash].join('|');
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
