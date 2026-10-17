import { act, render, screen } from '@testing-library/react';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { ZonasDemo } from './ZonasDemo';

const stage = () => Konva.stages[Konva.stages.length - 1]!;

/** Arrasto simulado: sem ponteiro no jsdom, o alvo é o centro da peça. */
function dragTo(id: string, to: { x: number; y: number }) {
  const node = stage().findOne(`#${id}`)!;
  act(() => {
    node.fire('dragstart');
    node.position(to);
    node.fire('dragmove');
    node.fire('dragend');
  });
}

const logText = () => screen.getByRole('list', { name: 'Log de eventos' }).textContent ?? '';

describe('ZonasDemo', () => {
  it('carta do baralho para a mão vira para cima; ficha no baralho é recusada', () => {
    render(<ZonasDemo />);

    dragTo('Pontilhismo', { x: 410, y: 470 }); // carta do topo → mão
    expect(logText()).toContain('statusChanged Pontilhismo: "faceDown" → "faceUp"');
    expect(stage().findOne('#Pontilhismo')!.position()).toEqual({ x: 410, y: 470 });

    dragTo('Respingo', { x: 412, y: 200 }); // perto do encaixe 0,1 do Tableau
    expect(logText()).toContain('"zone":"tableau","slot":"0,1"');

    dragTo('F1', { x: 90, y: 210 }); // ficha → baralho
    expect(screen.getByRole('status')).toHaveTextContent(
      'Recusado: zona "baralho" não aceita peças do tipo "ficha"',
    );
  });
});
