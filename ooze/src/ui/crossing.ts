// The crossing: forty days and forty nights adrift. A pixel seascape full screen: the raft with
// the four on it, riding the swell; day and night going over (the sun across the sky, then the
// dark and the stars), with what happens on the way: a storm, a dead calm, one of them sick,
// the food running low, stars they've never seen; and on the fortieth day, a bird coming down
// onto the raft with something green in its beak. No sail, no oar: it goes where the sea takes it.

import { STORY } from '../content/tribal';
import { thunder } from '../audio/sound';
import { storyLine } from './strike';

const DAYS = 40;
/** Seconds a day takes on screen; the bird after the last, and the whole. */
const PER_DAY = 0.75;
const SPAN = DAYS * PER_DAY;
const BIRD = SPAN + 0.5;
const END = SPAN + 5.5;
/** What happens, by day: [from, to). */
const STORM: [number, number] = [8.5, 13.5];
const CALM: [number, number] = [16.5, 21.5];
const SICK: [number, number] = [22.5, 29.5];
const STARS: [number, number] = [32, 38.5];
/** The story's lines through the crossing, by day. */
const LINES: [number, number, string][] = [
  [0, 6, STORY.crossFirst],
  [9, 13.5, STORY.crossStorm],
  [17, 21.5, STORY.crossCalm],
  [23, 28, STORY.crossSick],
  [29.5, 32.5, STORY.crossHunger],
  [33, 38.5, STORY.crossStars],
];
/** The raft and the four, drawn this many times larger than the rest. */
const S = 2;

/** How far into an event (0 outside it, 1 in its middle), easing in and out over a day. */
function within(day: number, [a, b]: [number, number]): number {
  if (day <= a || day >= b) return 0;
  return Math.min(1, (day - a) / 1, (b - day) / 1);
}

export function playCrossing(look: { body: string; belly: string }, onDone: () => void): void {
  const cv = document.createElement('canvas');
  cv.id = 'strike';
  const W = Math.ceil(window.innerWidth / 3);
  const H = Math.ceil(window.innerHeight / 3);
  cv.width = W;
  cv.height = H;
  document.body.append(cv);
  const counter = document.createElement('div');
  counter.className = 'crossing-day';
  document.body.append(counter);
  const b = cv.getContext('2d')!;
  const start = performance.now();
  let last = start;
  const stars = Array.from({ length: 60 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.45 }));
  // Stars they've never seen: a shape of bright ones, high in the middle of the sky.
  const strange = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    return { x: W * 0.5 + Math.cos(a) * W * (0.12 + (i % 3) * 0.05), y: H * 0.2 + Math.sin(a) * H * 0.07 };
  });
  const drops = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 120 + Math.random() * 80 }));
  const horizon = Math.round(H * 0.5);
  let flash = 0;
  let lineNow = '';
  let dayNow = -1;

  const say = (text: string) => {
    if (text === lineNow) return;
    lineNow = text;
    storyLine(text);
  };

  const frame = (now: number) => {
    const t = (now - start) / 1000;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const days = Math.min(DAYS, t / PER_DAY);
    const storm = within(days, STORM);
    const calm = within(days, CALM);
    const sick = within(days, SICK);
    const strangeK = within(days, STARS);
    const phase = days % 1; // 0 dawn, 0.5 dusk
    const sunUp = Math.sin(phase * Math.PI * 2); // 1 at noon (0.25), -1 at midnight (0.75)
    const light = Math.max(0, Math.min(1, 0.5 + sunUp * 0.7)) * (1 - storm * 0.6);
    // Sky: dark to blue to dawn-warm (greyed in the storm).
    const warm = phase < 0.12 || (phase > 0.4 && phase < 0.6) || phase > 0.92 ? 1.1 : 0.8;
    const grey = (c: number, g: number) => Math.round(c * (1 - storm * 0.5) + g * storm * 0.5);
    const top = [grey(10 + 60 * light, 30), grey(14 + 110 * light, 32), grey(30 + 170 * light, 38)];
    const low = [grey(20 + 200 * light * warm, 40), grey(20 + 150 * light, 42), grey(40 + 120 * light, 48)];
    for (let y = 0; y < horizon; y++) {
      const k = y / horizon;
      b.fillStyle = `rgb(${Math.round(top[0] + (low[0] - top[0]) * k)}, ${Math.round(top[1] + (low[1] - top[1]) * k)}, ${Math.round(top[2] + (low[2] - top[2]) * k)})`;
      b.fillRect(0, y, W, 1);
    }
    // Stars by night (hidden by the storm's cloud).
    const dark = Math.max(0, 0.4 - light) * 2 * (1 - storm);
    if (dark > 0) {
      b.fillStyle = `rgba(242, 234, 215, ${dark})`;
      for (const s of stars) b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      if (strangeK > 0) {
        // Ones they've never seen: brighter, in a shape, faintly joined.
        b.fillStyle = `rgba(180, 220, 255, ${dark * strangeK * 0.35})`;
        for (let i = 0; i < strange.length; i++) {
          const p = strange[i];
          const q = strange[(i + 1) % strange.length];
          for (let k = 0; k <= 1; k += 0.08) b.fillRect(Math.round(p.x + (q.x - p.x) * k), Math.round(p.y + (q.y - p.y) * k), 1, 1);
        }
        b.fillStyle = `rgba(220, 240, 255, ${dark * strangeK})`;
        for (const p of strange) b.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 1), b.fillRect(Math.round(p.x), Math.round(p.y) - 1, 1, 3);
      }
    }
    // The sun (by day) or the moon (by night), arcing over (behind the storm's cloud).
    if (storm < 0.8) {
      const arc = phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5;
      const ax = W * (0.1 + arc * 0.8);
      const ay = horizon - Math.sin(arc * Math.PI) * horizon * 0.8;
      b.globalAlpha = 1 - storm;
      if (phase < 0.5) {
        const g = b.createRadialGradient(ax, ay, 0, ax, ay, 18);
        g.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
        g.addColorStop(1, 'rgba(255, 200, 120, 0)');
        b.fillStyle = g;
        b.fillRect(ax - 18, ay - 18, 36, 36);
        b.fillStyle = '#fff4d0';
        b.fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 5, 5);
      } else {
        // A crescent: a disc, with the sky's own colour bitten out of it.
        const mx = Math.round(ax);
        const my = Math.round(ay);
        b.fillStyle = '#e8e4d8';
        b.fillRect(mx - 1, my - 3, 3, 7);
        b.fillRect(mx - 3, my - 1, 7, 3);
        b.fillRect(mx - 2, my - 2, 5, 5);
        const k = Math.max(0, Math.min(1, my / horizon));
        b.fillStyle = `rgb(${top.map((c, i) => Math.round(c + (low[i] - c) * k)).join(',')})`;
        b.fillRect(mx, my - 2, 3, 5);
        b.fillRect(mx + 1, my - 3, 2, 7);
      }
      b.globalAlpha = 1;
    }
    // The storm: heavy cloud low over the sea.
    if (storm > 0) {
      for (let k = 0; k < 7; k++) {
        const cx = ((k * 41 + t * 6) % (W + 60)) - 30;
        const cy = horizon * (0.15 + (k % 3) * 0.12);
        b.fillStyle = `rgba(30, 30, 38, ${0.7 * storm})`;
        b.fillRect(Math.round(cx), Math.round(cy), 46, 10 + (k % 2) * 5);
        b.fillRect(Math.round(cx) + 8, Math.round(cy) - 5, 26, 6);
      }
    }
    // The sea: bands of swell, glinting under the sun (still as glass in the calm).
    const swell = 1 + storm * 2.5 - calm * 0.9;
    for (let y = horizon; y < H; y++) {
      const k = (y - horizon) / (H - horizon);
      const shade = 0.35 + light * 0.65;
      b.fillStyle = `rgb(${Math.round((20 + 30 * k) * shade)}, ${Math.round((50 + 60 * k) * shade)}, ${Math.round((90 + 50 * k) * shade)})`;
      b.fillRect(0, y, W, 1);
      const tt = calm > 0.5 ? 0 : t;
      if ((y + Math.floor(tt * 6 * swell)) % 5 === 0) {
        b.fillStyle = `rgba(200, 225, 240, ${(0.15 + light * 0.25) * (1 + storm)})`;
        for (let x = (y * 37 + Math.floor(tt * 20 * swell)) % 23; x < W; x += 23) b.fillRect(x, y, 3 + (y % 3) + Math.round(storm * 3), 1);
      }
    }
    // The raft riding the swell, the four on it (and their food, going down day by day).
    const rx = Math.round(W * 0.5 + Math.sin(t * 0.4) * 4 * swell);
    const ry = Math.round(horizon + (H - horizon) * 0.2 + Math.sin(t * 2.2) * 2 * swell);
    const tilt = Math.sin(t * 1.7) * 1.2 * swell;
    const px = (x: number, y: number, w: number, h: number) => b.fillRect(rx + x * S, ry + y * S, w * S, h * S);
    b.fillStyle = '#6a4a30';
    for (let k = 0; k < 3; k++) px(-12, k, 24, 1);
    b.fillStyle = '#c8b080';
    px(-9, 0, 1, 3);
    px(8, 0, 1, 3);
    const food = Math.max(0, Math.round(4 * (1 - days / 36)));
    b.fillStyle = '#8a6a3c';
    for (let k = 0; k < food; k++) px(5 + (k % 2), -1 - Math.floor(k / 2), 1, 1);
    for (let i = 0; i < 4; i++) {
      const x = -10 + i * 4;
      const y = -3 + Math.round(tilt * (i - 1.5) * 0.3);
      // One of them falls sick: lying down, greyer, the others close about them.
      const down = i === 2 && sick > 0.3;
      b.fillStyle = down ? '#6f8f92' : look.body;
      if (down) px(x - 1, 1 + y, 5, 2);
      else px(x, y, 3, 3);
      b.fillStyle = look.belly;
      if (!down) px(x, y + 2, 3, 1);
      b.fillStyle = '#10141f';
      if (!down) px(x + (i % 2 ? 0 : 2), y, 1, 1);
    }
    // Rain, and lightning now and then (the thunder after).
    if (storm > 0) {
      b.fillStyle = `rgba(190, 200, 220, ${0.5 * storm})`;
      for (const d of drops) {
        d.y += d.v * dt;
        d.x -= d.v * 0.25 * dt;
        if (d.y > H) {
          d.y = -4;
          d.x = Math.random() * (W + 20);
        }
        b.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      }
      if (storm > 0.6 && Math.random() < dt * 0.9) {
        flash = 1;
        thunder({ level: 0.5 + Math.random() * 0.4, delay: 0.2 + Math.random() * 0.8 });
      }
    }
    if (flash > 0) {
      b.fillStyle = `rgba(220, 225, 255, ${0.35 * flash})`;
      b.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - dt * 3);
    }
    // The bird, on the last morning: it comes down onto the raft with green in its beak.
    if (t > BIRD) {
      const k = Math.min(1, (t - BIRD) / 2.5);
      const bx = Math.round(W * 0.95 - (W * 0.95 - rx) * k);
      const by = Math.round(H * 0.15 + (ry - 8 - H * 0.15) * k);
      const flap = k < 1 ? Math.floor(t * 8) % 2 : 0;
      b.fillStyle = '#f2ead7';
      b.fillRect(bx - 3, by - flap * 2, 3, 1);
      b.fillRect(bx + 2, by - flap * 2, 3, 1);
      b.fillRect(bx, by, 3, 3);
      b.fillStyle = '#5fbf78';
      b.fillRect(bx - 2, by + 1, 2, 1);
    }
    // The count of days, small, out of the way of the story.
    const d = Math.min(DAYS, Math.floor(days) + 1);
    if (d !== dayNow) {
      dayNow = d;
      counter.textContent = `Day ${d} of ${DAYS}`;
    }
    const line = t > BIRD + 1 ? STORY.crossBird : LINES.find(([a, z]) => days >= a && days < z)?.[2] ?? '';
    if (t < END - 0.5) say(line);
    if (t > END - 1) {
      cv.style.opacity = String(Math.max(0, END - t));
      counter.style.opacity = cv.style.opacity;
    }
    if (t < END) requestAnimationFrame(frame);
    else {
      cv.remove();
      counter.remove();
      storyLine('');
      onDone();
    }
  };
  requestAnimationFrame(frame);
}
