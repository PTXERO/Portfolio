// The crossing: forty days and forty nights adrift. A pixel seascape full screen: the raft with
// the four on it, riding the swell; day and night going over (the sun across the sky, then the
// dark and the stars), with what happens on the way. The days go by quickly, but time slows,
// and the view closes in on the raft, for what matters: the storm, one of them falling sick,
// stars they've never seen. Then a dead calm, the food running low, and on the fortieth day a
// bird coming down onto the raft with something green in its beak. It opens out of black and
// ends in black, so the scenes either side fade into and out of it.
//
// The sea is drawn a pixel at a time in perspective: wave rows close together at the horizon
// and wide up close, a glitter road under the sun or moon, foam in the storm, and in the calm,
// the sky mirrored in it.

import { STORY } from '../content/tribal';
import { thunder } from '../audio/sound';
import { storyLine } from './strike';
import { drawMini, type CreatureLook } from '../scene/creatureLook';

const DAYS = 40;
/** Days a second, ordinarily; much slower through what matters. */
const RATE = 1;
const SLOW = 0.22;
/** What happens, by day: [from, to). The slow-in windows are the heart of each. */
const STORM: [number, number] = [8.5, 13];
const STORM_IN: [number, number] = [9, 12.5];
const CALM: [number, number] = [16.5, 21.5];
const SICK: [number, number] = [22.5, 29.5];
const SICK_IN: [number, number] = [23, 25];
const STARS: [number, number] = [32.8, 35.6];
const STARS_IN: [number, number] = [33, 35];
/** The story's lines through the crossing, by day. */
const LINES: [number, number, string][] = [
  [0, 6, STORY.crossFirst],
  [9, 12.6, STORY.crossStorm],
  [17, 21.5, STORY.crossCalm],
  [23, 25.2, STORY.crossSick],
  [29.5, 32.6, STORY.crossHunger],
  [33, 35.2, STORY.crossStars],
];
/** The raft and the four, drawn this many times larger than the sea about them. */
const S = 2;
/** Seconds to fade up out of black, and back down into it. */
const FADE = 1.4;
/** After the fortieth day (seconds): the bird comes down; then land rises into view, the camera
 * turning to it; then the end. */
const BIRD_FOR = 12;
const LAND_AT = 3;
/** The black bars top and bottom (a share of the height each), for the film of it. */
const BARS = 0.1;

/** How far into an event (0 outside it, 1 in its middle), easing in and out over a day. */
function within(day: number, [a, b]: [number, number], edge = 1): number {
  if (day <= a || day >= b) return 0;
  return Math.min(1, (day - a) / edge, (b - day) / edge);
}

/** (`from`: the day to start on; for looking at one part of it while working on it.) */
export function playCrossing(look: CreatureLook, onDone: () => void, from = 0): void {
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
  const out = cv.getContext('2d')!;
  out.imageSmoothingEnabled = false;
  // Everything's drawn here first, then shown (closer in, for what matters).
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const b = off.getContext('2d')!;
  const horizon = Math.round(H * 0.46);
  const sea = b.createImageData(W, H - horizon);
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * horizon * 0.95, tw: Math.random() * 6 }));
  // Stars they've never seen, high in the middle of the sky: a shelter, and a fire beside it
  // (of what's ahead: somewhere to stay). Cool stars for the hut, warm ones for the flame;
  // each run of points is joined, faintly, like a star chart.
  const u = W * 0.05;
  const at = (x: number, y: number) => ({ x: W * 0.5 + x * u, y: horizon * 0.42 + y * u });
  const hut = [
    [at(-2.6, -0.5), at(-1.0, -2.2), at(0.6, -0.5)],
    [at(-2.2, -0.5), at(-2.2, 1.4), at(0.2, 1.4), at(0.2, -0.5)],
    [at(-1.3, 1.4), at(-1.3, 0.4), at(-0.7, 0.4), at(-0.7, 1.4)],
  ];
  const fire = [[at(1.3, 1.4), at(1.6, 0.3), at(1.9, 0.9), at(2.2, -0.4), at(2.5, 0.7), at(2.8, 0.3), at(2.9, 1.4), at(1.3, 1.4)]];
  /** Where a star sits (the ends and corners of the shapes; some brighter than others). */
  const strange = [...hut, ...fire].flatMap((run, r) => run.map((p, i) => ({ ...p, warm: r >= hut.length, big: (i + r) % 3 === 0 })));
  const drops = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 130 + Math.random() * 90 }));
  const start = performance.now();
  let last = start;
  let days = from;
  let zoom = 1;
  let flash = 0;
  let birdAt = -1;
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
    // Time: the days go quickly, except through what matters (and slower in the calm).
    const focus = Math.max(within(days, STORM_IN, 0.8), within(days, SICK_IN, 0.8), within(days, STARS_IN, 0.8));
    const calm = within(days, CALM);
    if (days < DAYS) days = Math.min(DAYS, days + dt * RATE * (1 - (1 - SLOW) * focus) * (1 - 0.4 * calm));
    else if (birdAt < 0) birdAt = t;
    const storm = within(days, STORM);
    const sick = within(days, SICK);
    const strangeK = within(days, STARS);
    // (For the strange stars, it's night while we look.)
    const starsIn = within(days, STARS_IN, 0.8);
    const rawPhase = days % 1;
    const phase = rawPhase + (0.78 - rawPhase) * starsIn;
    const sunUp = Math.sin(phase * Math.PI * 2);
    const light = Math.max(0, Math.min(1, 0.5 + sunUp * 0.7)) * (1 - storm * 0.6);
    const warm = phase < 0.12 || (phase > 0.4 && phase < 0.6) || phase > 0.92 ? 1.1 : 0.8;
    const grey = (c: number, g: number) => Math.round(c * (1 - storm * 0.5) + g * storm * 0.5);
    const top = [grey(10 + 60 * light, 30), grey(14 + 110 * light, 32), grey(30 + 170 * light, 38)];
    const low = [grey(20 + 200 * light * warm, 40), grey(20 + 150 * light, 42), grey(40 + 120 * light, 48)];
    const skyAt = (y: number): number[] => {
      const k = Math.max(0, Math.min(1, y / horizon));
      return [top[0] + (low[0] - top[0]) * k, top[1] + (low[1] - top[1]) * k, top[2] + (low[2] - top[2]) * k];
    };

    // ---- The sky ----
    for (let y = 0; y < horizon; y++) {
      const c = skyAt(y);
      b.fillStyle = `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
      b.fillRect(0, y, W, 1);
    }
    const dark = Math.max(0, 0.4 - light) * 2 * (1 - storm);
    if (dark > 0) {
      for (const s of stars) {
        b.fillStyle = `rgba(242, 234, 215, ${dark * (0.6 + 0.4 * Math.sin(t * 2 + s.tw))})`;
        b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      }
      if (strangeK > 0) {
        // Ones they've never seen: brighter, in shapes, faintly joined.
        const joins = (runs: { x: number; y: number }[][], col: string) => {
          b.fillStyle = col;
          for (const run of runs) {
            for (let i = 0; i + 1 < run.length; i++) {
              const p = run[i];
              const q = run[i + 1];
              const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y));
              for (let k = 0; k <= n; k += 2) b.fillRect(Math.round(p.x + ((q.x - p.x) * k) / n), Math.round(p.y + ((q.y - p.y) * k) / n), 1, 1);
            }
          }
        };
        joins(hut, `rgba(150, 200, 255, ${dark * strangeK * 0.35})`);
        joins(fire, `rgba(255, 170, 110, ${dark * strangeK * 0.35})`);
        for (const p of strange) {
          const tw = 0.7 + 0.3 * Math.sin(t * 3 + p.x * 0.7 + p.y);
          b.fillStyle = p.warm ? `rgba(255, 200, 140, ${dark * strangeK * tw})` : `rgba(220, 240, 255, ${dark * strangeK * tw})`;
          if (p.big) {
            b.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 1);
            b.fillRect(Math.round(p.x), Math.round(p.y) - 1, 1, 3);
          } else b.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        }
      }
    }
    // The sun (by day) or the moon (by night), arcing over (behind the storm's cloud).
    const arc = phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5;
    const ax = W * (0.1 + arc * 0.8);
    const ay = horizon - Math.sin(arc * Math.PI) * horizon * 0.8;
    const day = phase < 0.5;
    if (storm < 0.8) {
      b.globalAlpha = 1 - storm;
      if (day) {
        const g = b.createRadialGradient(ax, ay, 0, ax, ay, 18);
        g.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
        g.addColorStop(1, 'rgba(255, 200, 120, 0)');
        b.fillStyle = g;
        b.fillRect(ax - 18, ay - 18, 36, 36);
        b.fillStyle = '#fff4d0';
        b.fillRect(Math.round(ax) - 2, Math.round(ay) - 2, 5, 5);
      } else {
        const mx = Math.round(ax);
        const my = Math.round(ay);
        b.fillStyle = '#e8e4d8';
        b.fillRect(mx - 1, my - 3, 3, 7);
        b.fillRect(mx - 3, my - 1, 7, 3);
        b.fillRect(mx - 2, my - 2, 5, 5);
        const c = skyAt(my);
        b.fillStyle = `rgb(${c.map(Math.round).join(',')})`;
        b.fillRect(mx, my - 2, 3, 5);
        b.fillRect(mx + 1, my - 3, 2, 7);
      }
      b.globalAlpha = 1;
    }
    if (storm > 0) {
      for (let k = 0; k < 8; k++) {
        const cx = ((k * 41 + t * 7) % (W + 60)) - 30;
        const cy = horizon * (0.12 + (k % 3) * 0.12);
        b.fillStyle = `rgba(28, 28, 36, ${0.75 * storm})`;
        b.fillRect(Math.round(cx), Math.round(cy), 48, 10 + (k % 2) * 6);
        b.fillRect(Math.round(cx) + 8, Math.round(cy) - 5, 28, 6);
      }
    }

    // ---- Islands on the horizon ----
    // Behind them at first, the spear's island, dark, with its red spark, sinking away; at the
    // end, ahead, green land rising out of the sea, smoke going up from it.
    const hump = (cx: number, w: number, h: number, fill: string, bumps: number) => {
      b.fillStyle = fill;
      for (let x = Math.floor(cx - w / 2); x <= cx + w / 2; x++) {
        const u = (x - cx) / (w / 2);
        const top = h * Math.sqrt(Math.max(0, 1 - u * u)) * (0.85 + 0.15 * Math.sin(u * bumps + cx));
        if (top >= 1) b.fillRect(x, Math.round(horizon - top), 1, Math.ceil(top) + 1);
      }
    };
    const behind = Math.max(0, 1 - days / 4.5);
    if (behind > 0) {
      const w = W * 0.32 * behind + 4;
      hump(W * 0.2, w, horizon * 0.14 * behind + 1, `rgba(24, 18, 22, ${0.85})`, 7);
      b.fillStyle = `rgba(255, 70, 70, ${0.6 + 0.4 * Math.sin(t * 3)})`;
      b.fillRect(Math.round(W * 0.2), Math.round(horizon - horizon * 0.14 * behind - 2), 1, 2);
    }
    const land = birdAt >= 0 ? Math.max(0, Math.min(1, (t - birdAt - LAND_AT) / 5)) : 0;
    const landX = W * 0.8;
    if (land > 0) {
      const e = 1 - (1 - land) * (1 - land);
      const lw = W * 0.5 * e;
      const lh = horizon * 0.2 * e;
      hump(landX, lw * 1.15, lh * 0.7, `rgba(${Math.round(60 + 40 * light)}, ${Math.round(90 + 50 * light)}, ${Math.round(90 + 40 * light)}, 0.9)`, 5);
      hump(landX - lw * 0.1, lw, lh, `rgba(${Math.round(30 + 40 * light)}, ${Math.round(70 + 70 * light)}, ${Math.round(40 + 30 * light)}, 0.95)`, 11);
      // A pale line of beach, and smoke from somewhere inland.
      b.fillStyle = `rgba(220, 205, 160, ${0.7 * e})`;
      b.fillRect(Math.round(landX - lw * 0.42), horizon - 1, Math.round(lw * 0.7), 1);
      for (let k = 0; k < 12; k++) {
        const h = ((t * 4 + k * 4) % 40) * e;
        b.fillStyle = `rgba(52, 46, 46, ${0.55 * e * (1 - h / 40)})`;
        b.fillRect(Math.round(landX + lw * 0.12 + Math.sin(h * 0.15 + k) * 1.5 + h * 0.2), Math.round(horizon - lh - 2 - h), 2, 2);
      }
    }

    // ---- The sea, in perspective, a pixel at a time ----
    const rough = 1 + storm * 1.8 - calm * 0.85;
    const glow = day ? [255, 226, 160] : [220, 226, 240];
    const glowK = (1 - storm) * (day ? 0.9 * light : 0.5 * (1 - light));
    const data = sea.data;
    const SH = H - horizon;
    for (let y = 0; y < SH; y++) {
      const d = (y + 1) / SH; // 0 far, 1 near
      const z = 1 / (d * 0.92 + 0.08);
      const shade = 0.3 + light * 0.7;
      const base = [(14 + 26 * d) * shade, (40 + 60 * d) * shade, (78 + 60 * d) * shade];
      const haze = Math.pow(1 - d, 6);
      const mirrorRow = skyAt(horizon - y * 1.6 - 2);
      const road = 3 + d * W * 0.12;
      for (let x = 0; x < W; x++) {
        const wx = ((x - W / 2) / W) * z * 5;
        const wz = z * 2.2;
        const w1 = Math.sin(wx * 1.6 + wz * 3.1 - t * 0.9);
        const w2 = Math.sin(wx * 3.4 - wz * 5.3 + t * 1.3) * 0.55;
        const w3 = Math.sin(wx * 7.1 + wz * 8.9 - t * 2.1) * 0.3;
        const wave = (w1 + w2 + w3) * rough;
        const slope = Math.cos(wx * 1.6 + wz * 3.1 - t * 0.9) * rough;
        let r = base[0] + slope * 10 * shade;
        let g = base[1] + slope * 14 * shade;
        let bl = base[2] + slope * 16 * shade;
        // In the calm, the sky lies on the water.
        if (calm > 0) {
          const m = calm * 0.7;
          r = r * (1 - m) + mirrorRow[0] * 0.85 * m;
          g = g * (1 - m) + mirrorRow[1] * 0.85 * m;
          bl = bl * (1 - m) + mirrorRow[2] * 0.9 * m;
        }
        // A glittering road under the sun or the moon.
        const fromRoad = Math.abs(x - ax) / road;
        if (glowK > 0 && fromRoad < 1 && w3 + w2 > 0.25 - calm * 0.5) {
          const k = glowK * (1 - fromRoad) * (0.6 + 0.4 * d);
          r += (glow[0] - r) * k;
          g += (glow[1] - g) * k;
          bl += (glow[2] - bl) * k;
        }
        // Crests: a fleck of foam, many in the storm.
        if (wave > 1.55 - storm * 0.4) {
          const f = Math.min(1, (wave - 1.4) * 0.8) * (0.5 + storm * 0.5) * (0.4 + 0.6 * d);
          r += (200 - r) * f;
          g += (215 - g) * f;
          bl += (225 - bl) * f;
        }
        // Far off, the sea goes into haze at the horizon.
        r = r * (1 - haze) + low[0] * haze;
        g = g * (1 - haze) + low[1] * haze;
        bl = bl * (1 - haze) + low[2] * haze;
        const i = (y * W + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = bl;
        data[i + 3] = 255;
      }
    }
    b.putImageData(sea, 0, horizon);

    // ---- The raft riding the swell, the four on it, and their food going down ----
    const swell = 1 + storm * 2.2 - calm * 0.9;
    const rx = Math.round(W * 0.5 + Math.sin(t * 0.4) * 3 * swell);
    const ry = Math.round(horizon + SH * 0.3 + Math.sin(t * 2.1) * 1.6 * swell);
    const tilt = Math.sin(t * 1.6) * 1.2 * swell;
    const px = (x: number, y: number, w: number, h: number) => b.fillRect(rx + x * S, ry + y * S, w * S, h * S);
    // A shadow on the water under it, and in the calm, its likeness.
    b.fillStyle = `rgba(4, 10, 20, ${0.35 + calm * 0.2})`;
    px(-13, 3, 26, 1);
    b.fillStyle = '#6a4a30';
    for (let k = 0; k < 3; k++) px(-12, k, 24, 1);
    b.fillStyle = '#c8b080';
    px(-9, 0, 1, 3);
    px(8, 0, 1, 3);
    const food = Math.max(0, Math.round(4 * (1 - days / 36)));
    b.fillStyle = '#8a6a3c';
    for (let k = 0; k < food; k++) px(5 + (k % 2), -1 - Math.floor(k / 2), 1, 1);
    // The four: the player's own kind (their parts, their colours), as small as on the map.
    for (let i = 0; i < 4; i++) {
      // One of them falls sick: lying down, the others drawn in close about them.
      const down = i === 2 && sick > 0.3;
      const huddle = sick > 0.3 && (i === 1 || i === 3) ? (i === 1 ? 2 : -2) : 0;
      const x = rx + (-15 + i * 10 + huddle);
      const y = ry + Math.round(tilt * (i - 1.5) * 0.6);
      drawMini(b, look, x, y, { left: i % 2 === 1, sleeping: down, frame: 0, hop: down || calm > 0.5 ? 0 : Math.abs(Math.sin(t * 1.5 + i)) * 0.6 });
    }
    // The bird, on the last morning: it comes down onto the raft with green in its beak.
    if (birdAt >= 0) {
      const k = Math.min(1, (t - birdAt) / 2.8);
      const bx = Math.round(W * 0.95 - (W * 0.95 - rx) * k);
      const by = Math.round(H * 0.12 + (ry - 9 - H * 0.12) * k);
      const flap = k < 1 ? Math.floor(t * 8) % 2 : 0;
      b.fillStyle = '#f2ead7';
      b.fillRect(bx - 3, by - flap * 2, 3, 1);
      b.fillRect(bx + 2, by - flap * 2, 3, 1);
      b.fillRect(bx, by, 3, 3);
      b.fillStyle = '#5fbf78';
      b.fillRect(bx - 2, by + 1, 2, 1);
    }

    // ---- Shown: closing in on the raft for what matters ----
    // The camera: a little in, drifting and swaying like a hand-held shot; closing in on the
    // raft for what matters; at the end, easing out and turning to the land as it rises.
    const turn = birdAt >= 0 ? Math.max(0, Math.min(1, (t - birdAt - LAND_AT + 0.5) / 4)) : 0;
    const te = turn * turn * (3 - 2 * turn);
    zoom += (1.18 + 1.2 * focus - 0.18 * te - zoom) * Math.min(1, dt * 0.9);
    const cw = W / zoom;
    const ch = H / zoom;
    const drift = { x: Math.sin(t * 0.11) * cw * 0.06 + Math.sin(t * 0.27) * cw * 0.02, y: Math.sin(t * 0.17 + 1) * ch * 0.03 };
    // (For the strange stars, the camera looks up from the raft to them.)
    const up = starsIn * starsIn * (3 - 2 * starsIn);
    const focusX = rx + (landX - rx) * 0.75 * te + (W * 0.5 - rx) * up + drift.x * (1 - te);
    const focusY = ry - 6 + (horizon - (ry - 6)) * 0.35 * te + (horizon * 0.42 - (ry - 6)) * up + drift.y;
    const cx = Math.max(0, Math.min(W - cw, focusX - cw / 2));
    const cy = Math.max(0, Math.min(H - ch, focusY - ch * 0.55));
    out.drawImage(off, cx, cy, cw, ch, 0, 0, W, H);
    // Rain across the view, and lightning now and then (the thunder after).
    if (storm > 0) {
      out.fillStyle = `rgba(190, 200, 220, ${0.5 * storm})`;
      for (const dd of drops) {
        dd.y += dd.v * dt;
        dd.x -= dd.v * 0.25 * dt;
        if (dd.y > H) {
          dd.y = -4;
          dd.x = Math.random() * (W + 20);
        }
        out.fillRect(Math.round(dd.x), Math.round(dd.y), 1, 3);
      }
      if (storm > 0.6 && Math.random() < dt * 0.8) {
        flash = 1;
        thunder({ level: 0.5 + Math.random() * 0.4, delay: 0.2 + Math.random() * 0.8 });
      }
    }
    if (flash > 0) {
      out.fillStyle = `rgba(220, 225, 255, ${0.35 * flash})`;
      out.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - dt * 3);
    }
    // The bars of the film.
    const bar = Math.round(H * BARS);
    out.fillStyle = '#000';
    out.fillRect(0, 0, W, bar);
    out.fillRect(0, H - bar, W, bar);
    // Out of black at the start, back into it at the end.
    const end = birdAt >= 0 ? birdAt + BIRD_FOR : Infinity;
    const black = Math.max(t < FADE ? 1 - t / FADE : 0, t > end - FADE ? Math.min(1, (t - (end - FADE)) / FADE) : 0);
    if (black > 0) {
      out.fillStyle = `rgba(0, 0, 0, ${black})`;
      out.fillRect(0, 0, W, H);
    }

    // The count of days, small, out of the way of the story; and the story's line.
    const dn = Math.min(DAYS, Math.floor(days) + 1);
    if (dn !== dayNow) {
      dayNow = dn;
      counter.textContent = `Day ${dn} of ${DAYS}`;
    }
    counter.style.opacity = String(0.8 * (1 - black));
    const line = birdAt >= 0 ? STORY.crossBird : LINES.find(([a, z]) => days >= a && days < z)?.[2] ?? '';
    say(t > end - FADE ? '' : line);
    if (t < end) requestAnimationFrame(frame);
    else {
      cv.remove();
      counter.remove();
      storyLine('');
      onDone();
    }
  };
  requestAnimationFrame(frame);
}
