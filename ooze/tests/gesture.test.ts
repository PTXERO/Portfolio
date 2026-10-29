import { describe, expect, it } from 'vitest';
import { readGesture, type P } from '../src/ui/gesture';

const jitter = (pts: P[], j = 3) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * j, y: p.y + Math.cos(i * 2.3) * j }));
const along = (a: P, b: P, n = 12): P[] => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / (n - 1), y: a.y + ((b.y - a.y) * i) / (n - 1) }));

describe('reading drawn strokes', () => {
  it('reads a line, even a wobbly one', () => {
    expect(readGesture(along({ x: 0, y: 0 }, { x: 160, y: 60 }, 20))).toBe('line');
    expect(readGesture(jitter(along({ x: 0, y: 0 }, { x: 160, y: 60 }, 20), 5))).toBe('line');
  });
  it('reads a zigzag', () => {
    const z = [...along({ x: 0, y: 0 }, { x: 40, y: 40 }), ...along({ x: 40, y: 40 }, { x: 0, y: 80 }), ...along({ x: 0, y: 80 }, { x: 40, y: 120 })];
    expect(readGesture(z)).toBe('zigzag');
    expect(readGesture(jitter(z, 2))).toBe('zigzag');
  });
  it('reads a circle, and a spiral', () => {
    const circle = Array.from({ length: 40 }, (_, i) => ({ x: 80 + Math.cos((i / 39) * Math.PI * 2) * 60, y: 80 + Math.sin((i / 39) * Math.PI * 2) * 60 }));
    expect(readGesture(circle)).toBe('circle');
    expect(readGesture(jitter(circle, 4))).toBe('circle');
    const spiral = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 5;
      const r = 70 - i * 0.7;
      return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r };
    });
    expect(readGesture(spiral)).toBe('spiral');
  });
  it('ignores a tap', () => {
    expect(readGesture([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }])).toBe(null);
  });
});
