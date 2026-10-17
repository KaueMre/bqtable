import { describe, expect, it } from 'vitest';
import { drawTemplate } from './cardTemplate';
import { CardTemplate } from './manifest';

type Mocked = CanvasRenderingContext2D & { __getEvents(): { type: string; props: unknown }[] };

describe('modelos de carta: polígono e texto girado', () => {
  it('desenha o polígono ponto a ponto e gira o texto em volta do ponto dele', () => {
    const template = CardTemplate.parse({
      size: { w: 60, h: 90 },
      scale: 1,
      elements: [
        { type: 'polygon', points: [0, 0, 60, 0, 0, 90], fill: '{cor}' },
        { type: 'text', x: 52, y: 80, text: '{n}', rotation: 180 },
      ],
    });
    const canvas = drawTemplate(template, { cor: '#cf222e', n: 5 }, { image: () => undefined })!;
    const events = (canvas.getContext('2d') as Mocked).__getEvents();
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(['moveTo', 'lineTo', 'closePath', 'fill', 'translate', 'rotate']),
    );
    expect(events.filter((e) => e.type === 'lineTo')).toHaveLength(2);
    expect(events.find((e) => e.type === 'rotate')!.props).toMatchObject({ angle: Math.PI });
    expect(events.find((e) => e.type === 'fillText')!.props).toMatchObject({
      text: '5',
      x: 0,
      y: 0,
    });
  });

  it('fonte que começa pelo peso: a altura da linha vem do tamanho em px', () => {
    const template = CardTemplate.parse({
      size: { w: 100, h: 100 },
      scale: 1,
      elements: [
        { type: 'text', x: 0, y: 20, text: 'um dois', font: '700 15px Georgia', maxWidth: 1 },
      ],
    });
    const canvas = drawTemplate(template, {}, { image: () => undefined })!;
    const linhas = (canvas.getContext('2d') as Mocked)
      .__getEvents()
      .filter((e) => e.type === 'fillText')
      .map((e) => (e.props as { y: number }).y);
    expect(linhas).toEqual([0, 18]); // 15 × 1,2; antes: NaN (ou 840 com "600 …")
  });

  it('polígono com pontos ímpares ou menos de 3 pontos é recusado', () => {
    const parse = (points: number[]) =>
      CardTemplate.safeParse({
        size: { w: 1, h: 1 },
        elements: [{ type: 'polygon', points }],
      }).success;
    expect(parse([0, 0, 1, 0, 1])).toBe(false);
    expect(parse([0, 0, 1, 1])).toBe(false);
    expect(parse([0, 0, 1, 0, 1, 1])).toBe(true);
  });
});
