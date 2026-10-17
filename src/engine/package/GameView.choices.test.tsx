import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

/** Regras: cada ficha, com duplo clique, pede um tipo de escolha; "Verde" encerra a partida. */
const regras = `
game.command({ type: 'cor', expand: () => [{ type: 'ask', rule: 'r', prompt: 'Qual cor?', options: ['r', 'g'], labels: ['Vermelho', 'Verde'], context: 'cor' }] });
game.command({ type: 'uma', expand: () => [{ type: 'ask', rule: 'r', prompt: 'Qual ficha?', pick: 'piece', options: ['f1', 'f2'], context: 'ficha' }] });
game.command({ type: 'duas', expand: () => [{ type: 'ask', rule: 'r', prompt: 'Quais duas?', pick: 'piece', options: ['f1', 'f2', 'f3'], multiple: { min: 2, max: 2 }, context: 'duas' }] });
game.rule({
  id: 'r',
  resolve: (choice, value) => [{ type: 'setGlobal', key: choice.context, value: Array.isArray(value) ? value.join('+') : value }],
  react: (ev) => ev.type === 'globalChanged' && ev.key === 'cor' && ev.to === 'g'
    ? [{ type: 'endGame', result: 'win', message: 'Verde vence', score: 7 }] : [],
});
const pedidos = { f1: 'cor', f2: 'uma', f3: 'duas' };
game.gesture((g, p) => (g.type === 'activate' && pedidos[p.id] ? { type: pedidos[p.id] } : undefined));
`;

const manifest = {
  format: 'bqgame/1',
  id: 'escolhas',
  name: 'Escolhas',
  kinds: [{ kind: 'ficha' }],
  rules: 'data:text/javascript,' + encodeURIComponent(regras),
  setup: [
    {
      pieces: ['f1', 'f2', 'f3'].map((id, i) => ({
        id,
        kind: 'ficha',
        transform: { x: 100 + i * 120, y: 100 },
      })),
    },
  ],
  hud: [
    { label: 'Cor', global: 'cor' },
    { label: 'Ficha', global: 'ficha' },
    { label: 'Duas', global: 'duas' },
  ],
};

const stage = () => Konva.stages[Konva.stages.length - 1]!;
const fire = (id: string, type: string) =>
  act(() => {
    stage().findOne(`#${id}`)!.fire(type);
  });
const placar = (label: string) =>
  within(screen.getByLabelText('Placar')).getByText(label).nextSibling;
/** Contorno de escolha na peça (tracejado = pode escolher; cheio = marcada). */
const destaque = (id: string) =>
  stage()
    .findOne<Konva.Group>(`#${id}`)!
    .find<Konva.Rect>('Rect')
    .find((r) => r.strokeWidth() >= 4);

async function abrir() {
  const game = await loadGame({ manifest });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={1} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Placar');
}

describe('GameView: escolhas e fim de partida', () => {
  it('escolha com botões (rótulos)', async () => {
    const user = userEvent.setup();
    await abrir();
    fire('f1', 'dblclick');
    const painel = within(screen.getByLabelText('Escolha pendente'));
    expect(painel.getByText('Qual cor?')).toBeInTheDocument();
    await user.click(painel.getByRole('button', { name: 'Vermelho' }));
    expect(screen.queryByLabelText('Escolha pendente')).not.toBeInTheDocument();
    expect(placar('Cor')).toHaveTextContent('r');
  });

  it('escolha na mesa: as peças possíveis ficam destacadas e o clique responde', async () => {
    await abrir();
    fire('f2', 'dblclick');
    expect(screen.getByText('Clique numa das peças destacadas na mesa.')).toBeInTheDocument();
    expect(destaque('f1')).toBeDefined();
    expect(destaque('f3')).toBeUndefined(); // não é opção
    fire('f1', 'click');
    expect(placar('Ficha')).toHaveTextContent('f1');
    expect(destaque('f1')).toBeUndefined();
  });

  it('escolha de várias na mesa: marca, desmarca e confirma', async () => {
    const user = userEvent.setup();
    await abrir();
    fire('f3', 'dblclick');
    const confirmar = () => screen.getByRole('button', { name: /^Confirmar/ });
    fire('f1', 'click');
    fire('f2', 'click');
    fire('f2', 'click'); // desmarca
    expect(confirmar()).toHaveTextContent('Confirmar (1)');
    expect(confirmar()).toBeDisabled();
    fire('f3', 'click');
    expect(destaque('f3')!.strokeWidth()).toBe(5); // marcada: contorno cheio e mais grosso
    await user.click(confirmar());
    expect(placar('Duas')).toHaveTextContent('f1+f3');
  });

  it('fim de partida: tela por cima da mesa; desfazer volta para o jogo', async () => {
    const user = userEvent.setup();
    await abrir();
    fire('f1', 'dblclick');
    await user.click(screen.getByRole('button', { name: 'Verde' }));
    const fim = within(screen.getByRole('dialog', { name: 'Fim de partida' }));
    expect(fim.getByText('Vitória!')).toBeInTheDocument();
    expect(fim.getByText('Verde vence')).toBeInTheDocument();
    expect(fim.getByText('7 pontos')).toBeInTheDocument();
    await user.click(fim.getByRole('button', { name: 'Ver a mesa' }));
    expect(screen.queryByRole('dialog', { name: 'Fim de partida' })).not.toBeInTheDocument();
    fire('f2', 'dblclick');
    expect(screen.getByRole('status')).toHaveTextContent('Recusado: a partida acabou');
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(placar('Cor')).toHaveTextContent('—');
    fire('f2', 'dblclick');
    expect(screen.getByLabelText('Escolha pendente')).toBeInTheDocument();
  });
});
