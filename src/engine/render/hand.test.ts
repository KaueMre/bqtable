import { describe, expect, it } from 'vitest';
import { createPiece } from '@/engine/core';
import { HAND_CARD_HEIGHT, handIndexAt, inHandBand, layoutHand } from './hand';

const carta = (id: string) => createPiece({ id, kind: 'k', size: { w: 60, h: 90 } });
const tela = { width: 1000, height: 600 };

describe('faixa da mão', () => {
  it('centralizada embaixo, em leque leve; a carta sob o mouse sobe, cresce e fica reta', () => {
    const cards = ['a', 'b', 'c'].map(carta);
    const l = layoutHand(cards, tela, 1, null);
    const xs = ['a', 'b', 'c'].map((id) => l.slots.get(id)!.x);
    expect(xs[1]).toBe(500); // centro
    expect(xs[0]! < xs[1]! && xs[1]! < xs[2]!).toBe(true);
    expect(l.slots.get('a')!.rotation).toBeLessThan(0);
    expect(l.slots.get('c')!.rotation).toBeGreaterThan(0);
    expect(l.slots.get('b')!.scale).toBeCloseTo(HAND_CARD_HEIGHT / 90);
    const h = layoutHand(cards, tela, 1, 'a');
    expect(h.slots.get('a')).toMatchObject({ rotation: 0, scale: (HAND_CARD_HEIGHT / 90) * 1.2 });
    expect(h.slots.get('a')!.y).toBeLessThan(l.slots.get('a')!.y);
    expect(h.order.at(-1)).toBe('a'); // por cima das outras
  });

  it('aperta para caber; tamanho próprio (zoom) e espaço livre nas laterais', () => {
    const muitas = Array.from({ length: 30 }, (_, i) => carta(`c${i}`));
    const l = layoutHand(muitas, tela, 1, null);
    const xs = muitas.map((c) => l.slots.get(c.id)!.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(16);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1000 - 16);
    const grande = layoutHand([carta('a')], tela, 1.5, null);
    expect(grande.slots.get('a')!.scale).toBeCloseTo((HAND_CARD_HEIGHT * 1.5) / 90);
    const com = layoutHand([carta('a')], tela, 1, null, { left: 100, right: 300 });
    expect(com.slots.get('a')!.x).toBe((116 + 684) / 2);
  });

  it('a faixa recebe; a posição de entrada vem do x', () => {
    const cards = ['a', 'b', 'c'].map(carta);
    const l = layoutHand(cards, tela, 1, null);
    expect(inHandBand(l, { x: 500, y: 590 })).toBe(true);
    expect(inHandBand(l, { x: 500, y: 100 })).toBe(false);
    expect(handIndexAt(l, ['a', 'b', 'c'], 0)).toBe(0);
    expect(handIndexAt(l, ['a', 'b', 'c'], 500.5)).toBe(2);
    expect(handIndexAt(l, ['a', 'c'], 500.5)).toBe(1); // sem a que está sendo arrastada
  });
});
