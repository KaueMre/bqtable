import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { childrenOf } from '@/engine/core';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

const stage = () => Konva.stages[Konva.stages.length - 1]!;
const node = (id: string) => stage().findOne<Konva.Group>(`#${id}`)!;
const label = (id: string) => node(id).findOne<Konva.Text>('Text')?.text();
async function renderPiramide() {
  const game = await loadGame({ url: '/exemplos/piramide.bqgame' });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} seed={3} />
      </DataBoundary>
    </AppProviders>,
  );
  // carrega o pacote e as imagens: com a suíte inteira rodando, pode passar do 1 s padrão
  await screen.findByRole('button', { name: 'Passar a vez' }, { timeout: 4000 });
  // a mesma partida (mesma semente) fora da tela, para saber o que está em cada mão
  return game.createMatch({ players: 2, seed: 3 }).manager.getState();
}

const linha = (nome: string) => screen.getByText(nome, { selector: 'strong' }).closest('li')!;

describe('GameView com jogadores', () => {
  it('mostra o jogador da vez e os recursos de cada um', async () => {
    await renderPiramide();
    const ana = within(linha('Jogador 1'));
    expect(ana.getByText('da vez')).toBeInTheDocument();
    expect(ana.getByText('na tela')).toBeInTheDocument();
    const recursos = within(screen.getByLabelText('Recursos de Jogador 2'));
    expect(recursos.getByText('Energia').nextSibling).toHaveTextContent('3');
    expect(recursos.getByText('Mão').nextSibling).toHaveTextContent('3');
    expect(recursos.getByText('Pontos').nextSibling).toHaveTextContent('0');
    // a reserva da Bia é escondida: o Jogador 1 (na tela) não sabe quantas cartas há lá
    expect(recursos.getByText('Reserva').nextSibling).toHaveTextContent('?');
    const minhas = within(screen.getByLabelText('Recursos de Jogador 1'));
    expect(minhas.getByText('Reserva').nextSibling).toHaveTextContent('0');
  });

  it('passar a vez troca a tela: a mão de quem saiu vira para o próximo', async () => {
    const user = userEvent.setup();
    const estado = await renderPiramide();
    const umaDoP1 = childrenOf(estado.pieces, 'p1-mao')[0]!.id;
    expect(node(umaDoP1).findOne('Image')).toBeDefined(); // o dono vê a frente (modelo de carta)
    // o fim do setup comprou cartas para o Jogador 2: no log do Jogador 1 elas aparecem ocultas
    expect(screen.getByLabelText('Log de eventos')).toHaveTextContent('(oculto)');

    await user.click(screen.getByRole('button', { name: 'Passar a vez' }));
    const bia = within(linha('Jogador 2'));
    expect(bia.getByText('da vez')).toBeInTheDocument();
    expect(bia.getByText('na tela')).toBeInTheDocument();
    // o próximo vê o verso: sem a frente e sem rótulo que revele a carta
    expect(node(umaDoP1).findOne('Image')).toBeUndefined();
    expect(label(umaDoP1)).toBe('');
  });

  it('"ver como" fixa a tela num jogador; só quem está na vez passa', async () => {
    const user = userEvent.setup();
    await renderPiramide();
    await user.selectOptions(screen.getByLabelText('Ver como'), 'p2');
    expect(within(linha('Jogador 2')).getByText('na tela')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Passar a vez' })).toBeDisabled();
  });
});
