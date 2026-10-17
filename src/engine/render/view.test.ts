import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, zoomAt, type View } from './view';

const tablePoint = (v: View, p: { x: number; y: number }) => ({
  x: (p.x - v.x) / v.scale,
  y: (p.y - v.y) / v.scale,
});

describe('zoomAt', () => {
  it('mantém fixo o ponto da mesa sob o cursor', () => {
    const view: View = { x: 30, y: -20, scale: 1.5 };
    const pointer = { x: 400, y: 250 };
    const next = zoomAt(view, pointer, 2);
    expect(next.scale).toBe(3);
    const before = tablePoint(view, pointer);
    const after = tablePoint(next, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('respeita os limites de zoom', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE);
  });
});
