// Style test page: one world, two renderers, a toggle between them.

import { drawPixel } from './pixel';
import { drawVector } from './vector';
import { createWorld, poke, resize, setCount, step } from './world';

type Style = 'vector' | 'pixel';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const fpsEl = document.getElementById('fps')!;
/** Retina sharpness without paying for 3x on the newest phones. */
const dpr = Math.min(2, window.devicePixelRatio || 1);
const FRAME_MS = 1000 / 30;

let style: Style = (localStorage.getItem('ooze-style') as Style) || 'vector';
let world = createWorld(canvas.clientWidth, canvas.clientHeight, 40);

function fit(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (world.width === 0 || world.height === 0) world = createWorld(w, h, world.cells.length || 40);
  else resize(world, w, h);
}
fit();
window.addEventListener('resize', fit);

function select(group: string, attr: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`#${group} button`)) {
    b.classList.toggle('on', b.getAttribute(attr) === value);
  }
}
select('styles', 'data-style', style);

document.getElementById('styles')!.addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.style as Style | undefined;
  if (!v) return;
  style = v;
  localStorage.setItem('ooze-style', v);
  select('styles', 'data-style', v);
});

document.getElementById('counts')!.addEventListener('click', (e) => {
  const v = (e.target as HTMLElement).closest('button')?.dataset.count;
  if (!v) return;
  setCount(world, Number(v));
  select('counts', 'data-count', v);
});

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  poke(world, e.clientX - r.left, e.clientY - r.top);
});

// Frame loop capped at 30 fps; it stops by itself while the page is hidden.
let last = performance.now();
let acc = 0;
let frames = 0;
let drawMs = 0;
let fpsClock = last;
function frame(now: number): void {
  requestAnimationFrame(frame);
  acc += now - last;
  last = now;
  if (acc < FRAME_MS) return;
  const dt = Math.min(acc, 100) / 1000;
  acc %= FRAME_MS;

  const t0 = performance.now();
  step(world, dt);
  if (style === 'vector') drawVector(ctx, world, dpr);
  else drawPixel(ctx, world, dpr);
  drawMs += performance.now() - t0;
  frames++;

  if (now - fpsClock >= 1000) {
    fpsEl.textContent = `${frames} fps · ${(drawMs / frames).toFixed(1)} ms per frame · ${world.cells.length} cells`;
    frames = 0;
    drawMs = 0;
    fpsClock = now;
  }
}
requestAnimationFrame(frame);
