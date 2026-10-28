// Vector style: everything drawn from shapes in code, at full screen resolution.

import type { Creature, Swimmer, World } from './world';

const C = {
  deep: '#0d2b3a',
  shallow: '#1d5a6e',
  caustic: 'rgba(160, 235, 230, 0.07)',
  sand: '#d8c08a',
  sandShade: '#b99f69',
  rock: '#56636c',
  rockLight: '#75848d',
  weed: '#2f8a5a',
  weedLight: '#5fbf78',
  membrane: '#9ef0cf',
  body: '#4fb39a',
  nucleus: '#2a6e63',
  creature: '#f2906c',
  creatureShade: '#c4613f',
  eye: '#f7f3e8',
  pupil: '#1b1b1b',
  quip: '#ffffff',
};

function background(ctx: CanvasRenderingContext2D, w: World): void {
  const g = ctx.createLinearGradient(0, 0, 0, w.floor);
  g.addColorStop(0, C.shallow);
  g.addColorStop(1, C.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w.width, w.height);

  // Drifting light from the surface.
  ctx.fillStyle = C.caustic;
  for (let i = 0; i < 9; i++) {
    const x = ((i * 97 + w.time * (8 + i)) % (w.width + 160)) - 80;
    const y = 30 + ((i * 53) % (w.floor - 60));
    ctx.beginPath();
    ctx.ellipse(x, y, 60 + (i % 3) * 25, 22, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Seaweed behind the sand line.
  for (let i = 0; i < 7; i++) {
    const bx = ((i + 0.5) / 7) * w.width + Math.sin(i * 5) * 20;
    const h = w.height * (0.25 + (i % 3) * 0.08);
    const sway = Math.sin(w.time * 0.9 + i) * 14;
    ctx.strokeStyle = i % 2 ? C.weed : C.weedLight;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, w.floor + 4);
    ctx.bezierCurveTo(bx - 10, w.floor - h * 0.4, bx + sway + 12, w.floor - h * 0.7, bx + sway, w.floor - h);
    ctx.stroke();
  }

  // Sand with a soft curved top.
  ctx.fillStyle = C.sand;
  ctx.beginPath();
  ctx.moveTo(0, w.floor);
  for (let x = 0; x < w.width + 20; x += 20) ctx.lineTo(Math.min(x, w.width), w.floor + Math.sin(Math.min(x, w.width) * 0.02) * 4);
  ctx.lineTo(w.width, w.height);
  ctx.lineTo(0, w.height);
  ctx.fill();
  ctx.fillStyle = C.sandShade;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    ctx.ellipse(((i * 71) % w.width) + 10, w.floor + 18 + ((i * 37) % (w.height - w.floor - 24)), 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Two rocks.
  for (const [rx, r] of [
    [w.width * 0.78, 30],
    [w.width * 0.12, 20],
  ]) {
    ctx.fillStyle = C.rock;
    ctx.beginPath();
    ctx.ellipse(rx, w.floor + 4, r * 1.3, r, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = C.rockLight;
    ctx.beginPath();
    ctx.ellipse(rx - r * 0.3, w.floor - r * 0.45, r * 0.5, r * 0.25, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cell(ctx: CanvasRenderingContext2D, c: Swimmer, t: number): void {
  const a = Math.atan2(c.vy, c.vx);
  const wobble = c.poked > 0 ? Math.sin(t * 40) * 0.25 * c.poked : 0;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(a);

  // Flagellum: a whipping tail behind the cell.
  ctx.strokeStyle = C.membrane;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-c.size, 0);
  for (let i = 1; i <= 8; i++) ctx.lineTo(-c.size - i * 2.2, Math.sin(t * 14 + c.phase + i * 0.9) * i * 0.5);
  ctx.stroke();

  // Blobby membrane.
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const th = (i / 16) * Math.PI * 2;
    const r = c.size * (1 + Math.sin(th * 3 + t * 3 + c.phase) * 0.06 + wobble * Math.sin(th * 2));
    const px = Math.cos(th) * r * 1.15;
    const py = Math.sin(th) * r * 0.9;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = C.body;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.membrane;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = C.nucleus;
  ctx.beginPath();
  ctx.arc(c.size * 0.15, 0, c.size * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function creature(ctx: CanvasRenderingContext2D, cr: Creature, t: number): void {
  const facing = Math.sign(cr.vx) || 1;
  const spacing = 13;
  const squash = cr.poked > 0 ? 1 + Math.sin(t * 30) * 0.15 * cr.poked : 1;

  // Body segments sit behind the head, drawn back to front.
  for (let s = cr.segments - 1; s >= 0; s--) {
    const x = cr.x - facing * s * spacing;
    const r = cr.size * (1 - s * 0.16);
    const y = cr.y - r + Math.sin(cr.phase * 2 + s) * 1.5;

    // Two legs per segment, stepping out of phase.
    ctx.strokeStyle = C.creatureShade;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const swing = Math.sin(cr.phase * 3 + s * 1.7 + (side > 0 ? Math.PI : 0)) * 5;
      ctx.beginPath();
      ctx.moveTo(x + side * r * 0.4, y + r * 0.6);
      ctx.lineTo(x + side * r * 0.5 + swing, cr.y + 2);
      ctx.stroke();
    }

    ctx.fillStyle = s === 0 ? C.creature : s % 2 ? C.creatureShade : C.creature;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.1 * squash, r / squash, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head details: an eye that looks where it's going, and a mouth.
  const hx = cr.x;
  const hy = cr.y - cr.size;
  ctx.fillStyle = C.eye;
  ctx.beginPath();
  ctx.arc(hx + facing * 5, hy - 4, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.pupil;
  ctx.beginPath();
  ctx.arc(hx + facing * 6.5, hy - 4, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.creatureShade;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(hx + facing * 9, hy + 4, 3, facing > 0 ? 0 : Math.PI / 2, facing > 0 ? Math.PI / 2 : Math.PI);
  ctx.stroke();
}

export function drawVector(ctx: CanvasRenderingContext2D, w: World, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  background(ctx, w);
  for (const c of w.cells) cell(ctx, c, w.time);
  creature(ctx, w.creature, w.time);
  ctx.font = '600 14px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  for (const q of w.quips) {
    ctx.globalAlpha = Math.max(0, 1 - q.age / 1.4);
    ctx.fillStyle = C.quip;
    ctx.fillText(q.text, q.x, q.y - q.age * 20);
  }
  ctx.globalAlpha = 1;
}
