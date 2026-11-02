// Soft-bodied blobs: several round "cores" whose fields add up, so cores that
// drift close together melt into one body (metaballs). Used for colonies: the
// member cells fuse into a single morphing amoeba with a nucleus each. Predators
// are blobs too, in their own colours.

import { PAL } from '../art/sprites';

export interface Core {
  x: number;
  y: number;
  r: number;
  /** Draw a nucleus at this core (member cells do; pseudopods don't). */
  nucleus: boolean;
}

function rgba(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colours for a blob: its outline (also the shine), body and nuclei. */
export interface BlobStyle {
  edge: string;
  body: string;
  nucleus: string;
}

export const MINT: BlobStyle = { edge: PAL.g, body: PAL.G, nucleus: PAL.n };

const rgbCache = new Map<string, [number, number, number]>();
const rgb = (hex: string) => {
  let c = rgbCache.get(hex);
  if (!c) rgbCache.set(hex, (c = rgba(hex)));
  return c;
};

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d')!;

/**
 * Draws the blob formed by `cores` (art pixels) onto `b`. Draw every blob once
 * with `insideOnly` false, then again with it true: the second pass paints over
 * outlines where blobs overlap, so touching blobs merge into one body.
 */
export function drawBlob(b: CanvasRenderingContext2D, cores: Core[], style: BlobStyle = MINT, insideOnly = false): void {
  if (!cores.length) return;
  const EDGE = rgb(style.edge);
  const BODY = rgb(style.body);
  const SHINE = EDGE;
  const NUCLEUS = rgb(style.nucleus);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cores) {
    x0 = Math.min(x0, c.x - c.r * 1.6);
    y0 = Math.min(y0, c.y - c.r * 1.6);
    x1 = Math.max(x1, c.x + c.r * 1.6);
    y1 = Math.max(y1, c.y + c.r * 1.6);
  }
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  const w = Math.ceil(x1) - x0 + 1;
  const h = Math.ceil(y1) - y0 + 1;
  if (w <= 0 || h <= 0 || w > 200 || h > 200) return;

  // Which pixels are inside: the summed field of all cores reaches 1.
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x + 0.5;
      const py = y0 + y + 0.5;
      let f = 0;
      for (const c of cores) {
        const dx = px - c.x;
        const dy = py - c.y;
        f += (c.r * c.r) / (dx * dx + dy * dy + 0.01);
      }
      if (f >= 1) inside[y * w + x] = 1;
    }
  }

  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const img = sctx.createImageData(w, h);
  const d = img.data;
  const put = (x: number, y: number, [r, g, bl]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = bl;
    d[i + 3] = 255;
  };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside[y * w + x] === 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
      if (edge && insideOnly) continue;
      // A light rim on the outline, and a little shine where the top-left edge is near.
      const shine = !edge && (!at(x - 1, y - 1) || !at(x - 2, y - 2)) && !at(x, y - 3);
      put(x, y, edge ? EDGE : shine ? SHINE : BODY);
    }
  }
  for (const c of cores) {
    if (!c.nucleus) continue;
    const nx = Math.round(c.x - x0);
    const ny = Math.round(c.y - y0);
    put(nx, ny, NUCLEUS);
    put(nx + 1, ny, NUCLEUS);
    put(nx, ny - 1, NUCLEUS);
    put(nx + 1, ny - 1, NUCLEUS);
  }
  sctx.clearRect(0, 0, w, h);
  sctx.putImageData(img, 0, 0);
  b.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
}
