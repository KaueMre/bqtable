import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

/** Como os Eternals do Eternal Decks: o mesmo kind, cada um com a sua descrição (dos dados). */
const manifest = {
  format: 'bqgame/1',
  id: 'descricoes',
  name: 'Descrições',
  data: {
    eternos: [
      { id: 'phoenix', nome: 'Phoenix', curse: '1 não entra no Field', habilidade: 'estrela' },
      { id: 'mermaid', nome: 'Mermaid', curse: '4 não entra no Field', habilidade: 'estrela' },
    ],
  },
  keywords: {
    estrela: { title: 'Estrela', text: 'Ganha uma [[joia]] ao reviver.' },
    joia: { title: 'Joia', text: 'Recurso <b>raro</b>.' },
  },
  kinds: [
    {
      kind: 'eterno',
      data: 'eternos',
      statuses: ['faceUp', 'faceDown'],
      hiddenStatuses: ['faceDown'],
      defaults: { size: { w: 60, h: 90 } },
      description: '<b>{nome}</b><br>Curse: {curse}<br>Ability: [[{habilidade}]]',
    },
  ],
  setup: [
    {
      pieces: [
        {
          id: 'e1',
          kind: 'eterno',
          faces: { faceUp: 'Phoenix', faceDown: 'Verso' },
          attributes: { def: 'phoenix' },
          transform: { x: 100, y: 100 },
        },
        {
          id: 'e2',
          kind: 'eterno',
          faces: { faceUp: 'Mermaid', faceDown: 'Verso' },
          attributes: { def: 'mermaid' },
          transform: { x: 250, y: 100 },
        },
        {
          id: 'e3',
          kind: 'eterno',
          status: 'faceDown',
          faces: { faceUp: 'Phoenix', faceDown: 'Verso' },
          attributes: { def: 'phoenix' },
          transform: { x: 400, y: 100 },
        },
      ],
    },
  ],
};

async function abrir(m: object = manifest) {
  const game = await loadGame({ manifest: m });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={1} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Log de eventos');
}

const node = (id: string) => Konva.stages[Konva.stages.length - 1]!.findOne<Konva.Group>(`#${id}`)!;
const enter = (id: string) => act(() => void node(id).fire('mouseenter'));
const leave = (id: string) => act(() => void node(id).fire('mouseleave'));
const key = (type: 'keyDown' | 'keyUp', k: string) =>
  act(() => void fireEvent[type](window, { key: k }));
const descricao = () => screen.queryByRole('note', { name: 'Descrição' });
const caixas = () => screen.queryAllByRole('note').map((n) => n.getAttribute('aria-label'));

describe('descrição e palavras-chave', () => {
  it('cada peça do mesmo kind com a sua descrição; palavras-chave dentro de palavras-chave', async () => {
    await abrir();
    enter('e1');
    key('keyDown', 'Alt');
    expect(descricao()).toHaveTextContent(/^PhoenixCurse: 1 não entra no FieldAbility: Estrela$/);
    expect(caixas()).toEqual(['Estrela', 'Joia', 'Descrição']); // as caixas em cima
    key('keyUp', 'Alt');
    leave('e1');
    enter('e2');
    key('keyDown', 'Alt');
    expect(descricao()).toHaveTextContent('Curse: 4 não entra no Field');
    key('keyUp', 'Alt');
  });

  it('carta virada para todos não mostra descrição', async () => {
    await abrir();
    enter('e3');
    key('keyDown', 'Alt');
    expect(screen.getByRole('img', { name: 'Pré-visualização' })).toHaveTextContent('Verso');
    expect(descricao()).toBeNull();
  });

  it('compacto (K): só com Ctrl aparecem a descrição e as palavras-chave', async () => {
    await abrir();
    key('keyDown', 'k');
    enter('e1');
    key('keyDown', 'Alt');
    expect(screen.getByRole('img', { name: 'Pré-visualização' })).toBeInTheDocument();
    expect(descricao()).toBeNull();
    key('keyDown', 'Control');
    expect(descricao()).toHaveTextContent('Curse: 1');
    expect(caixas()).toContain('Estrela');
    key('keyUp', 'Control');
    expect(descricao()).toBeNull();
  });

  it('oculto (K, K): só no preview fixo, com o mouse sobre ele; palavras-chave em cadeia, no hover', async () => {
    const user = userEvent.setup();
    await abrir();
    key('keyDown', 'k');
    key('keyDown', 'k');
    enter('e1');
    key('keyDown', 'Alt');
    key('keyUp', 'Alt');
    key('keyDown', 'Alt'); // dois toques: fixa
    key('keyUp', 'Alt');
    const fixo = screen.getByRole('img', { name: 'Pré-visualização fixa' });
    expect(descricao()).toBeNull();
    await user.hover(fixo);
    expect(descricao()).toHaveTextContent('Curse: 1');
    expect(caixas()).toEqual(['Descrição']); // sem palavras-chave até passar sobre elas
    await user.hover(within(descricao()!).getByText('Estrela'));
    expect(caixas()).toEqual(['Estrela', 'Descrição']);
    await user.hover(within(screen.getByRole('note', { name: 'Estrela' })).getByText('Joia'));
    expect(caixas()).toEqual(['Estrela', 'Joia', 'Descrição']);
  });

  it('dica ao lado da peça: aparece com o mouse parado; T desliga', async () => {
    await abrir();
    enter('e1');
    const dica = await screen.findByRole('tooltip', {}, { timeout: 2000 });
    expect(within(dica).getByRole('note', { name: 'Descrição' })).toHaveTextContent('Curse: 1');
    leave('e1');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    key('keyDown', 't');
    enter('e2');
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('palavra-chave desconhecida é acusada ao abrir o jogo', async () => {
    await expect(
      loadGame({ manifest: { ...manifest, keywords: { a: { text: 'Ver [[b]].' } } } }),
    ).rejects.toThrow('keywords.a: palavra-chave desconhecida "b"');
    await expect(
      loadGame({
        manifest: {
          ...manifest,
          kinds: [{ ...manifest.kinds[0]!, description: 'Ganha [[nada]].' }],
        },
      }),
    ).rejects.toThrow('kind "eterno": palavra-chave desconhecida "nada"');
  });
});
