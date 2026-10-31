// How the creature looks, built from the parts it wears: legs, mouth, eyes, back
// and tail, drawn side-on facing right. Colours come from the Cell diet it grew
// out of. Every look is drawn pixel by pixel once and cached, like the cells.

import { PAL } from '../art/sprites';
import { dietOf } from '../economy/rates';
import type { GameState, Genes, Slot } from '../economy/types';
import { DIET_COLORS } from './cellLook';
import { PARTS } from '../content/creature';

const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));

/** A part's shape (its own, or the part it borrows its look from) and its colour, if it has one. */
function shapeOf(id: string | undefined): { shape?: string; tint?: string } {
  const p = id ? PART_BY_ID.get(id) : undefined;
  return { shape: p?.look ?? id, tint: p?.tint };
}

/** A colour mixed toward another: darker toward ink, lighter toward cream. */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export interface CreatureLook {
  parts: Partial<Record<Slot, string>>;
  diet: string;
  /** Another kind's own colours (body, edge), in place of their diet's. */
  hue?: [string, string];
  /** The line's (or one animal's) coat, markings and colouring. */
  genes?: Genes;
}

/** A colour turned round the wheel and made lighter or darker. */
function shift(hex: string, deg: number, light: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + deg) % 360) + 360) % 360;
  l = Math.max(0.06, Math.min(0.94, l + light));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

/** The coat: body and edge colours (its diet's, or its kind's, as the genes have them), and the
 * colour its markings are drawn in. */
function coat(look: CreatureLook): [string, string, string] {
  let [fill, edge] = look.hue ?? DIET_COLORS[look.diet] ?? DIET_COLORS.none;
  const g = look.genes;
  if (g) {
    fill = shift(fill, g.hue, g.light);
    edge = shift(edge, g.hue, g.light);
    if (g.morph === 'albino') [fill, edge] = ['#eee6de', '#d8c4be'];
    else if (g.morph === 'melanistic') [fill, edge] = [mixHex(fill, '#14171f', 0.72), mixHex(edge, '#0b0d13', 0.6)];
  }
  const mark = g?.morph === 'albino' ? '#e2bcbc' : g?.morph === 'melanistic' ? mixHex(fill, '#000000', 0.5) : mixHex(fill, '#10141f', 0.42);
  return [fill, edge, mark];
}

/** A short key for the genes (for the drawing caches). */
export function genesKey(g?: Genes): string {
  return g ? `${Math.round(g.hue)}.${Math.round(g.light * 100)}.${g.pattern ?? ''}.${g.morph ?? ''}` : '';
}

/** Cream: socks, and a piebald's patches. */
const CREAM = '#f2ead7';

export function creatureLookOf(state: GameState): CreatureLook {
  return { parts: { ...state.stages.creature.equipped }, diet: dietOf(state, 'creature') ?? 'none', genes: state.stages.creature.genes };
}

const W = 30;
const H = 22;
/** Where the body's centre sits in the drawing. */
const CX = 15;
const CY = 11;
const cache = new Map<string, HTMLCanvasElement>();

function bake(look: CreatureLook, frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const b = c.getContext('2d')!;
  const [fill, edge, mark] = coat(look);
  const g = look.genes;
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const rect = (x: number, y: number, w: number, h: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(x, y, w, h);
  };
  const p = look.parts;
  const rx = 7;
  const ry = 4;
  const inside = (x: number, y: number) => ((x - CX) / rx) ** 2 + ((y - CY) / ry) ** 2 <= 1.15;
  const step = frame ? 1 : -1;

  // Tail, behind the body (to the left).
  const tx = CX - rx;
  const tail = shapeOf(p.tail);
  const tE = tail.tint ?? edge;
  const tF = tail.tint ? mixHex(tail.tint, '#10141f', 0.25) : fill;
  switch (tail.shape) {
    case 'finTail':
      for (let i = 0; i < 4; i++) for (let j = -i; j <= i; j++) px(tx - 1 - i, CY + j * 0.7, i === 3 || Math.abs(j) === i ? tE : tF);
      break;
    case 'clubTail':
      for (let i = 0; i < 4; i++) px(tx - i, CY - 1 + (i >> 1), edge);
      rect(tx - 7, CY, 3, 3, tail.tint ?? PAL.r);
      px(tx - 6, CY, tail.tint ? mixHex(tail.tint, '#f2ead7', 0.4) : PAL.R);
      break;
    case 'crestTail': {
      for (let i = 0; i < 3; i++) px(tx - i, CY - 1, edge);
      const [c1, c2, c3] = tail.tint ? [tail.tint, mixHex(tail.tint, '#f2ead7', 0.4), mixHex(tail.tint, '#10141f', 0.3)] : [PAL.p, PAL.y, PAL.o];
      for (const [dx, dy, col] of [[-3, -4, c1], [-4, -3, c2], [-5, -1, c1], [-4, 1, c3], [-3, -2, c3]] as const) {
        px(tx + dx, CY + dy, col);
        px(tx + dx + 1, CY + dy + 1, col);
      }
      break;
    }
    default:
      px(tx - 1, CY, edge);
  }

  // Legs, under the body, stepping between two frames.
  const footY = CY + ry;
  const legsAt = [CX - 4, CX + 3];
  const legs = shapeOf(p.legs);
  const lE = g?.pattern === 'socks' ? CREAM : legs.tint ?? edge;
  legsAt.forEach((lx, i) => {
    const s = i % 2 ? step : -step;
    const edge = lE;
    switch (legs.shape) {
      case 'stubby':
        rect(lx + (s > 0 ? 1 : 0), footY, 2, 3, edge);
        break;
      case 'runner':
        for (let k = 0; k < 6; k++) px(lx + (k < 3 ? 0 : s * (k - 2) * 0.5), footY + k, edge);
        px(lx + s * 2 + 1, footY + 5, edge);
        break;
      case 'climber':
        for (let k = 0; k < 4; k++) px(lx + (k < 2 ? 0 : s), footY + k, edge);
        px(lx + s - 1, footY + 4, PAL.w);
        px(lx + s + 1, footY + 4, PAL.w);
        break;
      default:
        rect(lx + (s > 0 ? 1 : 0), footY, 1, 2, edge);
    }
  });

  // Body.
  for (let y = CY - ry - 1; y <= CY + ry + 1; y++) {
    for (let x = CX - rx - 1; x <= CX + rx + 1; x++) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      px(x, y, rim ? edge : fill);
    }
  }
  // A paler belly.
  for (let x = CX - 4; x <= CX + 4; x++) px(x, CY + 2, edge);
  // Markings, and a piebald's white patches.
  const on = (x: number, y: number, col: string) => {
    if (inside(x, y) && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)) px(x, y, col);
  };
  if (g?.pattern === 'stripes') for (const sx of [CX - 4, CX - 1, CX + 2]) for (let y = CY - ry; y <= CY + 1; y++) on(sx + (y < CY - 1 ? 1 : 0), y, mark);
  else if (g?.pattern === 'spots') for (const [dx, dy] of [[-4, -1], [-1, -2], [2, -2], [3, 0], [-2, 1], [0, 0], [5, -1]]) on(CX + dx, CY + dy, mark);
  else if (g?.pattern === 'saddle') for (let y = CY - ry; y <= CY - 1; y++) for (let x = CX - 3; x <= CX + 2; x++) on(x, y, mark);
  else if (g?.pattern === 'mask') for (let y = CY - 2; y <= CY; y++) for (let x = CX + 4; x <= CX + 6; x++) on(x, y, mark);
  if (g?.morph === 'piebald') for (const [dx, dy] of [[-5, 0], [-4, 0], [-4, 1], [-1, -2], [0, -2], [0, -1], [3, 1], [4, 1], [4, 0]]) on(CX + dx, CY + dy, CREAM);

  // Back.
  const back = shapeOf(p.back);
  const bT = back.tint;
  switch (back.shape) {
    case 'spines':
      for (let k = -4; k <= 3; k += 2) {
        px(CX + k, CY - ry - 1, bT ?? PAL.w);
        px(CX + k, CY - ry - 2, bT ? mixHex(bT, '#f2ead7', 0.4) : PAL.w);
      }
      break;
    case 'shell':
      for (let y = CY - ry - 3; y <= CY - 1; y++) {
        for (let x = CX - 6; x <= CX + 4; x++) {
          if (((x - CX + 1) / 6) ** 2 + ((y - CY + 1) / 5) ** 2 > 1) continue;
          px(x, y, (x + y) % 3 === 0 ? (bT ? mixHex(bT, '#10141f', 0.3) : PAL.S) : bT ?? PAL.Y);
        }
      }
      break;
    case 'sail':
      for (let k = 0; k < 7; k++) for (let h = 0; h < 4 - Math.abs(k - 3) * 0.8 + 2; h++) px(CX - 4 + k, CY - ry - 1 - h, h % 2 ? (bT ? mixHex(bT, '#10141f', 0.25) : PAL.o) : bT ?? PAL.p);
      break;
  }

  // Head end (right): mouth and eyes.
  const hx = CX + rx;
  const mouth = shapeOf(p.mouth);
  const mT = mouth.tint;
  switch (mouth.shape) {
    case 'jaws':
      rect(hx, CY + 1, 3, 1, edge);
      px(hx + 1, CY + 2, mT ?? PAL.w);
      px(hx + 2, CY + 2, mT ?? PAL.w);
      break;
    case 'beak':
      rect(hx, CY, 2, 2, mT ?? PAL.y);
      px(hx + 2, CY + 1, mT ? mixHex(mT, '#10141f', 0.3) : PAL.Y);
      break;
    case 'tusks':
      px(hx, CY + 2, mT ?? PAL.w);
      px(hx + 1, CY + 2, mT ?? PAL.w);
      px(hx + 2, CY + 1, mT ?? PAL.w);
      px(hx + 2, CY, mT ?? PAL.w);
      break;
    default:
      px(hx - 1, CY + 1, PAL.k);
      if (mT) {
        // A snout or a scoop, in its own colour.
        px(hx, CY + 1, mT);
        px(hx + 1, CY + 1, mT);
        px(hx, CY, mT);
      }
  }
  const eyes = shapeOf(p.eyes);
  const eT = eyes.tint;
  switch (eyes.shape) {
    case 'lensEyes':
      rect(hx - 4, CY - 2, 2, 2, PAL.w);
      if (eT) px(hx - 4, CY - 1, eT);
      px(hx - 3, CY - 2, PAL.k);
      break;
    case 'stalkEyes':
      px(hx - 3, CY - ry - 1, edge);
      px(hx - 3, CY - ry - 2, edge);
      rect(hx - 4, CY - ry - 4, 2, 2, eT ?? PAL.w);
      px(hx - 3, CY - ry - 4, PAL.k);
      break;
    case 'nightEyes':
      rect(hx - 5, CY - 3, 3, 3, eT ?? PAL.y);
      px(hx - 4, CY - 2, PAL.k);
      break;
    default:
      px(hx - 3, CY - 1, PAL.k);
      if (eT) px(hx - 4, CY - 1, eT);
  }
  return c;
}

/**
 * Draws the creature with its feet on `groundY`, centred on x. `scale` (1 or more,
 * whole numbers) draws it bigger for portraits; `frame` steps the legs.
 */
export function drawCreature(b: CanvasRenderingContext2D, look: CreatureLook, x: number, groundY: number, opts: { left?: boolean; frame?: number; scale?: number } = {}): void {
  const frame = opts.frame ?? 0;
  const key = `${look.diet}|${look.hue ?? ''}|${genesKey(look.genes)}|${Object.values(look.parts).join('.')}|${frame}`;
  let c = cache.get(key);
  if (!c) {
    if (cache.size > 200) cache.clear();
    c = bake(look, frame);
    cache.set(key, c);
  }
  const s = opts.scale ?? 1;
  // Feet sit at the bottom of the legs: the body centre is CY, legs reach about CY + 10.
  const top = groundY - (CY + 10) * s;
  b.save();
  b.imageSmoothingEnabled = false;
  if (opts.left) {
    b.translate(Math.round(x + (W / 2) * s), Math.round(top));
    b.scale(-s, s);
  } else {
    b.translate(Math.round(x - (W / 2) * s), Math.round(top));
    b.scale(s, s);
  }
  b.drawImage(c, 0, 0);
  b.restore();
}

/** An <img> portrait of a look, for the interface. */
export function creatureIcon(look: CreatureLook, scale = 3): string {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  drawCreature(c.getContext('2d')!, look, W / 2, H - 1);
  return `<img class="px-icon" src="${c.toDataURL()}" width="${W * scale}" height="${H * scale}" alt="" draggable="false">`;
}

/** The herd-size sprite: 14 by 11 pixels, facing right. */
const MW = 14;
const MH = 11;
const miniCache = new Map<string, { c: HTMLCanvasElement; foot: number }>();

function bakeMini(look: CreatureLook, frame: number, sleeping: boolean): { c: HTMLCanvasElement; foot: number } {
  const c = document.createElement('canvas');
  c.width = MW;
  c.height = MH;
  const b = c.getContext('2d')!;
  const [fill, edge, mark] = coat(look);
  const g = look.genes;
  const dark = mix(fill, '#10141f', 0.45);
  const px = (x: number, y: number, col: string) => {
    b.fillStyle = col;
    b.fillRect(x, y, 1, 1);
  };
  const p = look.parts;
  const back = shapeOf(p.back);
  const tail = shapeOf(p.tail);
  const legs = shapeOf(p.legs);
  const eyes = shapeOf(p.eyes);
  const mouth = shapeOf(p.mouth);
  // The body's top row is `by`; it's four rows deep, with legs below it.
  const lift = sleeping ? 1 : 0;
  const by = 3 + lift;
  // Back first (behind the body's top edge).
  if (back.shape === 'shell') {
    const [a, c2] = back.tint ? [back.tint, mix(back.tint, '#10141f', 0.3)] : ['#b08850', '#8a6a3a'];
    for (let x = 4; x <= 9; x++) px(x, by - 1, x % 2 ? c2 : a);
    for (let x = 5; x <= 8; x++) px(x, by - 2, a);
  } else if (back.shape === 'spines') for (const x of [4, 6, 8]) px(x, by - 1, back.tint ?? PAL.w);
  else if (back.shape === 'sail') {
    const [a, c2] = back.tint ? [back.tint, mix(back.tint, '#10141f', 0.3)] : [PAL.p, PAL.P];
    for (let x = 5; x <= 8; x++) for (let y = by - 3 + Math.abs(x - 6.5) * 0.7; y < by; y++) px(x, Math.round(y), x === 6 || x === 7 ? a : c2);
  }
  // Body: an oval, light on top, dark underneath.
  const rows: [number, number, string][] = [
    [4, 9, edge],
    [3, 10, fill],
    [3, 10, fill],
    [4, 9, dark],
  ];
  rows.forEach(([x0, x1, col], j) => {
    for (let x = x0; x <= x1; x++) px(x, by + j, col);
  });
  px(3, by + 1, edge);
  // Markings, and a piebald's white patches.
  if (g?.pattern === 'stripes') for (const x of [5, 7, 9]) for (let y = by; y <= by + 2; y++) px(x, y, mark);
  else if (g?.pattern === 'spots') for (const [x, y] of [[5, by + 1], [8, by], [9, by + 2], [6, by + 2], [7, by + 1]]) px(x, y, mark);
  else if (g?.pattern === 'saddle') for (let x = 5; x <= 8; x++) for (let y = by; y <= by + 1; y++) px(x, y, mark);
  if (g?.morph === 'piebald') for (const [x, y] of [[4, by + 1], [5, by + 1], [8, by + 2], [9, by + 1], [9, by + 2]]) px(x, y, CREAM);
  // Head, at the front.
  px(11, by + 1, fill);
  px(11, by + 2, fill);
  px(12, by + 1, fill);
  px(12, by + 2, dark);
  px(11, by, edge);
  // Eyes.
  if (!sleeping) {
    if (eyes.shape === 'stalkEyes') {
      px(11, by - 1, edge);
      px(11, by - 2, eyes.tint ?? PAL.k);
    } else if (eyes.shape === 'nightEyes') {
      px(11, by + 1, eyes.tint ?? PAL.y);
      px(12, by + 1, PAL.k);
    } else if (eyes.shape === 'lensEyes') {
      px(11, by + 1, eyes.tint ?? PAL.w);
      px(12, by + 1, PAL.k);
    } else {
      px(12, by + 1, PAL.k);
      if (eyes.tint) px(11, by + 1, eyes.tint);
    }
  } else px(12, by + 1, dark);
  if (g?.pattern === 'mask') {
    px(11, by + 1, mark);
    px(12, by + 2, mark);
  }
  // Mouth.
  if (mouth.shape === 'jaws') px(13, by + 2, mouth.tint ?? PAL.w);
  else if (mouth.shape === 'beak') px(13, by + 2, mouth.tint ?? PAL.o);
  else if (mouth.shape === 'tusks') {
    px(13, by + 2, mouth.tint ?? PAL.w);
    px(13, by + 1, mouth.tint ?? PAL.w);
  } else if (mouth.tint) px(13, by + 2, mouth.tint);
  // Tail, at the back.
  const tE = tail.tint ?? edge;
  if (tail.shape === 'finTail') {
    px(2, by + 1, edge);
    px(1, by, tE);
    px(1, by + 2, tE);
  } else if (tail.shape === 'clubTail') {
    px(2, by + 1, edge);
    px(1, by + 1, tail.tint ?? PAL.r);
    px(0, by + 1, tail.tint ?? PAL.r);
    px(1, by + 2, tail.tint ? mix(tail.tint, '#10141f', 0.3) : PAL.R);
  } else if (tail.shape === 'crestTail') {
    px(2, by + 1, edge);
    px(1, by, tail.tint ?? PAL.p);
    px(1, by - 1, tail.tint ? mix(tail.tint, '#f2ead7', 0.4) : PAL.y);
    px(0, by, tail.tint ? mix(tail.tint, '#10141f', 0.3) : PAL.o);
  } else px(2, by + 2, edge);
  // Legs, stepping between frames. Their last row is where the creature stands.
  let foot = by + 3;
  if (!sleeping) {
    const step = frame ? 1 : 0;
    const long = legs.shape === 'runner' || legs.shape === 'climber' ? 2 : 1;
    const col = g?.pattern === 'socks' ? CREAM : legs.tint ?? (legs.shape === 'stubby' ? dark : PAL.k);
    for (const lx of [5 - step, 9 + step]) {
      for (let k = 0; k < long; k++) px(lx, by + 4 + k, col);
      if (legs.shape === 'climber') px(lx + 1, by + 4 + long - 1, PAL.w);
      if (legs.shape === 'stubby') px(lx + 1, by + 4, col);
    }
    foot = by + 3 + long;
  }
  return { c, foot };
}

/**
 * Your creature at herd size, built from the same parts as its portrait, so you and your
 * herd are plainly the same animal at any zoom. Drawn standing on (x, groundY), on its
 * shadow, at a whole-number scale; `hop` lifts it (but not its shadow) off the ground.
 */
export function drawMini(
  b: CanvasRenderingContext2D,
  look: CreatureLook,
  x: number,
  groundY: number,
  opts: { left?: boolean; frame?: number; sleeping?: boolean; scale?: number; hop?: number } = {},
): void {
  const k = Math.max(1, Math.round(opts.scale ?? 1));
  const key = `${look.diet}|${look.hue ?? ''}|${genesKey(look.genes)}|${Object.values(look.parts).join('.')}|${opts.frame ? 1 : 0}|${opts.sleeping ? 1 : 0}`;
  let m = miniCache.get(key);
  if (!m) {
    if (miniCache.size > 300) miniCache.clear();
    m = bakeMini(look, opts.frame ?? 0, !!opts.sleeping);
    miniCache.set(key, m);
  }
  const X = Math.round(x) - (MW / 2) * k;
  const G = Math.round(groundY);
  // The shadow sits on the ground under the feet, wider the closer the creature is to it.
  const hop = Math.round(opts.hop ?? 0);
  const shrink = Math.min(2, Math.floor(hop / k / 2));
  b.fillStyle = 'rgba(16,20,31,0.3)';
  b.fillRect(X + (3 + shrink) * k, G - k, (MW - 6 - shrink * 2) * k, k);
  b.save();
  b.imageSmoothingEnabled = false;
  // The feet's row lands on the shadow's row.
  const Y = G - (m.foot + 1) * k - hop;
  if (opts.left) {
    b.translate(X + MW * k, Y);
    b.scale(-k, k);
  } else {
    b.translate(X, Y);
    b.scale(k, k);
  }
  b.drawImage(m.c, 0, 0);
  b.restore();
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** An <img> of the herd-size creature (as it's drawn on the map), for the interface. */
export function miniIcon(look: CreatureLook, scale = 3): string {
  const m = bakeMini(look, 0, false);
  const c = document.createElement('canvas');
  c.width = m.c.width;
  c.height = m.foot + 1;
  c.getContext('2d')!.drawImage(m.c, 0, 0);
  return `<img class="px-icon" src="${c.toDataURL()}" width="${c.width * scale}" height="${c.height * scale}" alt="" draggable="false">`;
}
