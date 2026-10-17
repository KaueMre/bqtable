import { act, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { childrenOf, createManager, type Manager } from '@/engine/core';
import { ManagerProvider, ViewerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1, players: ['ana', 'bia'] });
  m.registerKind({ kind: 'carta', defaults: { size: { w: 60, h: 90 } } });
  m.registerKind({ kind: 'zona' });
  const r = m.dispatch({
    type: 'batch',
    commands: [
      {
        id: 'mao',
        kind: 'zona',
        owner: 'ana',
        size: { w: 240, h: 110 },
        transform: { x: 200, y: 400 },
        zone: { layout: 'fan', hand: true, privacy: 'faceDown' },
      },
      { id: 'h1', kind: 'carta', parentId: 'mao', faces: { default: 'H1' } },
      { id: 'h2', kind: 'carta', parentId: 'mao', faces: { default: 'H2' }, transform: { z: 1 } },
      { id: 'solta', kind: 'carta', faces: { default: 'S' }, transform: { x: 500, y: 100 } },
    ].map((piece) => ({ type: 'createPiece', piece })),
  });
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

function renderAs(m: Manager, viewer: string) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={m}>
      <ViewerProvider viewer={viewer}>
        <Table stageRef={stageRef} />
      </ViewerProvider>
    </ManagerProvider>,
  );
  const stage = stageRef.current!;
  const node = (id: string) => stage.findOne<Konva.Group>(`#${id}`);
  const layerOf = (id: string) => node(id)?.getLayer()?.name() || 'mesa';
  const pointer = vi.spyOn(stage, 'getPointerPosition');
  /** Arrasta a peça soltando com o ponteiro neste ponto da tela. */
  const dragAt = (id: string, screen: { x: number; y: number }) =>
    act(() => {
      pointer.mockReturnValue(screen);
      const n = node(id)!;
      n.fire('dragstart');
      n.fire('dragmove');
      n.fire('dragend');
    });
  return { stage, node, layerOf, dragAt };
}

describe('Table: mão do jogador (faixa embaixo, fora da câmera)', () => {
  it('as cartas da minha mão ficam na faixa; a zona fica na mesa como lugar marcado', () => {
    const { layerOf, stage } = renderAs(setup(), 'ana');
    expect(layerOf('h1')).toBe('hand');
    expect(layerOf('h2')).toBe('hand');
    expect(layerOf('mao')).toBe('mesa');
    expect(layerOf('solta')).toBe('mesa');
    // a faixa não anda com a câmera: fica embaixo da tela (800 × 500 no jsdom)
    const y = stage.findOne<Konva.Group>('#h1')!.getAbsolutePosition().y;
    expect(y).toBeGreaterThan(380);
  });

  it('para outro jogador, a mão continua na mesa (virada)', () => {
    const { layerOf } = renderAs(setup(), 'bia');
    expect(layerOf('h1')).toBe('mesa');
  });

  it('arrastar da mão para a mesa joga a carta; da mesa para a faixa, volta para a mão', () => {
    const m = setup();
    const { layerOf, dragAt } = renderAs(m, 'ana');
    dragAt('h1', { x: 400, y: 150 }); // em cima da mesa
    expect(m.getState().pieces.h1!.parentId).toBeNull();
    expect(layerOf('h1')).toBe('mesa');
    dragAt('solta', { x: 10, y: 495 }); // na faixa, à esquerda de tudo
    expect(childrenOf(m.getState().pieces, 'mao').map((p) => p.id)).toEqual(['solta', 'h2']);
    expect(layerOf('solta')).toBe('hand');
  });

  it('o mouse sobre uma carta da mão a levanta', () => {
    const { node } = renderAs(setup(), 'ana');
    const antes = { y: node('h1')!.y(), s: node('h1')!.scaleX() };
    act(() => void node('h1')!.fire('mouseenter'));
    expect(node('h1')!.y()).toBeLessThan(antes.y);
    expect(node('h1')!.scaleX()).toBeGreaterThan(antes.s);
    act(() => void node('h1')!.fire('mouseleave'));
    expect(node('h1')!.y()).toBe(antes.y);
  });
});
