import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { TabuleiroDemo } from './TabuleiroDemo';

const stage = () => Konva.stages[Konva.stages.length - 1]!;
const node = (id: string) => stage().findOne(`#${id}`);

describe('TabuleiroDemo', () => {
  it('arrastar o tabuleiro leva o conteúdo junto', () => {
    render(<TabuleiroDemo />);
    const before = node('ana-tableau')!.position();
    const ficha = node('ana-foco-1')!.position();
    act(() => {
      node('ana')!.fire('dragstart');
      node('ana')!.position({ x: 240 + 30, y: 380 - 20 });
      node('ana')!.fire('dragmove');
      node('ana')!.fire('dragend');
    });
    expect(node('ana-tableau')!.position().x).toBeCloseTo(before.x + 30);
    expect(node('ana-tableau')!.position().y).toBeCloseTo(before.y - 20);
    expect(node('ana-foco-1')!.position().x).toBeCloseTo(ficha.x + 30);
  });

  it('adicionar tabuleiro cria tudo numa jogada; desfazer remove tudo', async () => {
    const user = userEvent.setup();
    render(<TabuleiroDemo />);
    await user.click(screen.getByRole('button', { name: /Adicionar tabuleiro/ }));
    for (const id of ['jogador-3', 'jogador-3-tableau', 'jogador-3-mao', 'jogador-3-foco-2']) {
      expect(node(id)).toBeDefined();
    }
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(node('jogador-3')).toBeUndefined();
    expect(node('jogador-3-tableau')).toBeUndefined();
  });
});
