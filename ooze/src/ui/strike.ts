// The strike: the cutscene between the Creature and the Tribal era, played once. Night falls
// over the island; a spear streaks down out of the sky; a white flash, the ground shakes,
// cracks run out from where it hit; and when the white clears, what's left is one piece of
// land and the spear standing in it. The era changes behind the flash (`onImpact`).

import { STORY } from '../content/tribal';

/** Seconds into the cutscene that each beat happens. */
const NIGHT = 2.2;
const FALL = 1.1;
const HIT = NIGHT + FALL;
const END = 10.5;

export function playStrike(onImpact: () => void): void {
  const app = document.getElementById('app')!;
  const cv = document.createElement('canvas');
  cv.id = 'strike';
  const W = Math.ceil(window.innerWidth / 3);
  const H = Math.ceil(window.innerHeight / 3);
  cv.width = W;
  cv.height = H;
  const words = document.createElement('div');
  words.id = 'strike-words';
  document.body.append(cv, words);
  const b = cv.getContext('2d')!;
  const start = performance.now();
  let hit = false;
  // Where it lands, and a few stars for the night.
  const at = { x: W * 0.5, y: H * 0.56 };
  const from = { x: W * 0.78, y: -20 };
  const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.6, p: Math.random() * 6 }));
  const cracks = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    return { a, len: 30 + Math.random() * 60, kinks: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5] };
  });
  const say = (text: string) => {
    if (words.dataset.text === text) return;
    words.dataset.text = text;
    words.classList.remove('in');
    void words.offsetWidth;
    words.textContent = text;
    if (text) words.classList.add('in');
  };

  const frame = (now: number) => {
    const t = (now - start) / 1000;
    b.clearRect(0, 0, W, H);
    // Night falls (the island still showing beneath).
    const dark = Math.min(1, t / NIGHT);
    if (t < HIT + 0.6) {
      b.fillStyle = `rgba(8, 10, 24, ${0.75 * dark})`;
      b.fillRect(0, 0, W, H);
      for (const s of stars) {
        if (Math.sin(t * 2 + s.p) > -0.3) {
          b.fillStyle = `rgba(242, 234, 215, ${0.8 * dark})`;
          b.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
        }
      }
    }
    // The spear falls: a red streak with a white-hot core, its trail fading behind.
    if (t > NIGHT && t < HIT) {
      const k = (t - NIGHT) / FALL;
      const e = k * k;
      const tip = { x: from.x + (at.x - from.x) * e, y: from.y + (at.y - from.y) * e };
      for (let i = 0; i < 40; i++) {
        const q = Math.max(0, e - i * 0.012);
        const x = from.x + (at.x - from.x) * q;
        const y = from.y + (at.y - from.y) * q;
        b.fillStyle = `rgba(232, 60, 80, ${1 - i / 40})`;
        b.fillRect(Math.round(x) - 1, Math.round(y), 3, 2);
      }
      b.fillStyle = '#fff6f0';
      b.fillRect(Math.round(tip.x) - 1, Math.round(tip.y) - 1, 2, 3);
      // A red glow ahead of it on the land.
      b.fillStyle = `rgba(255, 80, 90, ${0.25 * k})`;
      b.beginPath();
      b.ellipse(at.x, at.y, 30 * k, 12 * k, 0, 0, Math.PI * 2);
      b.fill();
    }
    // Impact: cracks run out, the screen goes white, the ground shakes.
    if (t >= HIT) {
      if (!hit) {
        hit = true;
        app.classList.add('quake');
      }
      const c = Math.min(1, (t - HIT) / 0.25);
      b.strokeStyle = '#ff5a6e';
      b.lineWidth = 1;
      for (const cr of cracks) {
        b.beginPath();
        b.moveTo(at.x, at.y);
        for (let j = 1; j <= 3; j++) {
          const r = (cr.len * c * j) / 3;
          b.lineTo(at.x + Math.cos(cr.a + cr.kinks[j - 1] * 0.5) * r, at.y + Math.sin(cr.a + cr.kinks[j - 1] * 0.5) * r * 0.6);
        }
        b.stroke();
      }
      const white = t < HIT + 0.35 ? (t - HIT) / 0.35 : Math.max(0, 1 - (t - HIT - 0.9) / 2.6);
      b.fillStyle = `rgba(255, 248, 240, ${Math.min(1, white)})`;
      b.fillRect(0, 0, W, H);
      // The world changes while all is white.
      if (t > HIT + 0.4 && !cv.dataset.changed) {
        cv.dataset.changed = '1';
        onImpact();
      }
      if (t > HIT + 1.4) app.classList.remove('quake');
    }
    if (t > 0.4 && t < HIT - 0.2) say(STORY.omen);
    else if (t > HIT + 0.5 && t < HIT + 3.6) say(STORY.strike);
    else if (t > HIT + 4 && t < END - 0.6) say(STORY.after);
    else say('');
    if (t < END) requestAnimationFrame(frame);
    else {
      cv.remove();
      words.remove();
      app.classList.remove('quake');
    }
  };
  requestAnimationFrame(frame);
}
