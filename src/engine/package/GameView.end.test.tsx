import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

/** Ações que encerram a partida: a Bia vence (com placar), ou empate. */
const regras = `
game.action({
  id: 'bia',
  label: 'Bia vence',
  command: () => ({
    type: 'endGame',
    winners: ['p2'],
    ranking: [
      { player: 'p2', score: 34, label: '$34', text: 'Compra um <b>chapéu</b> e tem [[sorte]]<script>alert(1)</script>' },
      { player: 'p1', score: 21 },
    ],
    message: 'Fim das 3 corridas',
  }),
});
game.action({ id: 'empate', label: 'Empate', command: () => ({ type: 'endGame', winners: ['p1', 'p2'] }) });
`;

const manifest = {
  format: 'bqgame/1',
  id: 'fim',
  name: 'Fim',
  players: { min: 2, max: 2, names: ['Ana', 'Bia'], colors: ['#cf222e', '#0969da'] },
  keywords: { sorte: { title: 'Sorte', text: 'Ganha de novo.' } },
  kinds: [{ kind: 'ficha' }],
  rules: 'data:text/javascript,' + encodeURIComponent(regras),
  setup: [{ pieces: [{ id: 'f1', kind: 'ficha', transform: { x: 100, y: 100 } }] }],
};

async function abrir(seat?: string) {
  const user = userEvent.setup();
  const game = await loadGame({ manifest });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByRole('button', { name: 'Bia vence' }, { timeout: 4000 });
  if (seat) await user.selectOptions(screen.getByRole('combobox', { name: /Ver como/ }), seat);
  return user;
}

const fim = () => within(screen.getByRole('dialog', { name: 'Fim de partida' }));

describe('GameView: fim de partida competitivo', () => {
  it('mesmo aparelho (a tela segue a vez): o nome de quem venceu e o placar', async () => {
    const user = await abrir();
    await user.click(screen.getByRole('button', { name: 'Bia vence' }));
    expect(fim().getByRole('heading')).toHaveTextContent('Vitória de Bia');
    expect(fim().getByText('Fim das 3 corridas')).toBeInTheDocument();
    const linhas = within(fim().getByRole('table', { name: 'Placar final' })).getAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringMatching(/^Bia\$34Compra um chapéu e tem Sorte$/),
      'Ana21', // sem label, o score
    ]);
    // texto rico: o negrito fica, o script some, a palavra-chave vira o título dela
    expect(fim().getByText('chapéu').tagName).toBe('B');
    expect(document.querySelector('.bq-end script')).toBeNull();
    expect(fim().getByText('Sorte')).toHaveAttribute('data-kw', 'sorte');
    expect(linhas[0]).toHaveClass('bq-end-winner');
  });

  it('na tela da Bia: "Você venceu!"', async () => {
    const user = await abrir('p2');
    await user.click(screen.getByRole('button', { name: 'Bia vence' }));
    expect(fim().getByRole('heading')).toHaveTextContent('Você venceu!');
    expect(screen.getByRole('dialog', { name: 'Fim de partida' })).toHaveClass('bq-end--win');
    expect(
      fim()
        .getByText(/\(você\)/)
        .closest('tr'),
    ).toHaveTextContent('Bia (você)');
  });

  it('na tela da Ana: a vitória da Bia, como derrota', async () => {
    const user = await abrir('p1');
    await user.click(screen.getByRole('button', { name: 'Bia vence' }));
    expect(fim().getByRole('heading')).toHaveTextContent('Vitória de Bia');
    expect(screen.getByRole('dialog', { name: 'Fim de partida' })).toHaveClass('bq-end--lose');
  });

  it('empate: os nomes de quem empatou, sem placar', async () => {
    const user = await abrir('p1');
    await user.click(screen.getByRole('button', { name: 'Empate' }));
    expect(fim().getByRole('heading')).toHaveTextContent('Empate: Ana e Bia');
    expect(fim().queryByRole('table')).not.toBeInTheDocument();
  });
});
