import { describe, expect, it } from 'vitest';
import { createPiece, createState } from '@/engine/core';
import { defaultGestures } from './gestures';

describe('defaultGestures', () => {
  const s = createState({ seed: 1 });
  const a = createPiece({ id: 'A', kind: 'k' });

  it('arrastar vira dropInto com o alvo resolvido pela tela', () => {
    expect(
      defaultGestures({ type: 'drag', id: 'A', target: { zone: null, x: 10, y: 20 } }, a, s),
    ).toEqual({ type: 'dropInto', id: 'A', zone: null, x: 10, y: 20 });
    expect(
      defaultGestures({ type: 'drag', id: 'A', target: { zone: 'deck', slot: 's1' } }, a, s),
    ).toEqual({ type: 'dropInto', id: 'A', zone: 'deck', slot: 's1' });
  });

  it('girar vira rotate', () => {
    expect(defaultGestures({ type: 'rotate', id: 'A', rotation: -90 }, a, s)).toEqual({
      type: 'rotate',
      id: 'A',
      rotation: -90,
    });
  });

  it('ativar não faz nada por padrão', () => {
    expect(defaultGestures({ type: 'activate', id: 'A' }, a, s)).toBeNull();
  });
});
