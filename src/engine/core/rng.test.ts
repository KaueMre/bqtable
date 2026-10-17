import { describe, expect, it } from 'vitest';
import { nextRandom, randomInt, shuffle } from './rng';

function generator(seed: number) {
  let state = seed;
  return () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
}

describe('rng', () => {
  it('é determinístico e fica em [0, 1)', () => {
    const a = generator(123);
    const b = generator(123);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randomInt cobre todo o intervalo', () => {
    const random = generator(1);
    const seen = new Set(Array.from({ length: 200 }, () => randomInt(random, 6)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('shuffle devolve uma permutação sem mexer na original', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(items, generator(9));
    expect(out).not.toEqual(items);
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
