import { act, render, screen, within } from '@testing-library/react';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { MesaDemo } from './MesaDemo';

const lastStage = () => Konva.stages[Konva.stages.length - 1]!;

describe('MesaDemo', () => {
  it('o painel acompanha o que acontece na mesa', () => {
    render(<MesaDemo />);
    const panel = screen.getByRole('table', { name: 'Estado das peças' });
    const row = (id: string) => within(panel).getByRole('cell', { name: id }).closest('tr')!;
    expect(within(row('Rabisco')).getByRole('cell', { name: 'faceUp' })).toBeInTheDocument();

    const node = lastStage().findOne('#Rabisco')!;
    act(() => {
      node.fire('dblclick');
    });
    expect(within(row('Rabisco')).getByRole('cell', { name: 'faceDown' })).toBeInTheDocument();

    act(() => {
      node.position({ x: 333, y: 222 });
      node.fire('dragend');
    });
    expect(within(row('Rabisco')).getByRole('cell', { name: '333' })).toBeInTheDocument();
    expect(within(row('Rabisco')).getByRole('cell', { name: '222' })).toBeInTheDocument();
  });
});
