import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';
import type { KeyPrefs } from './keys';

const regras = `
game.command({ type: 'terminar', expand: () => [{ type: 'setGlobal', key: 'fim', delta: 1 }] });
game.action({ id: 'terminar', label: 'Terminar turno', key: 'E', command: () => ({ type: 'terminar' }) });
game.action({ id: 'disco-p1', label: 'Skill Disc de Alpha', enabled: () => 'sem discos', command: () => ({ type: 'terminar' }) });
`;

const manifest = {
  format: 'bqgame/1',
  id: 'atalhos',
  name: 'Atalhos',
  players: { min: 2, max: 2 },
  kinds: [{ kind: 'zona' }],
  rules: 'data:text/javascript,' + encodeURIComponent(regras),
  setup: [
    {
      pieces: [
        {
          id: 'mao',
          kind: 'zona',
          faces: { default: 'Mão' },
          size: { w: 200, h: 100 },
          transform: { x: 200, y: 200 },
          zone: { layout: 'fan' },
        },
      ],
    },
  ],
  hud: [{ label: 'Fim', global: 'fim' }],
};

async function abrir(props: { keyPrefs?: KeyPrefs; onKeyPrefs?: (p: KeyPrefs) => void } = {}) {
  const game = await loadGame({ manifest });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} {...props} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Placar', {}, { timeout: 4000 });
}

const tecla = (code: string, key: string, mods: Partial<KeyboardEventInit> = {}) =>
  act(() => void fireEvent.keyDown(window, { code, key, ...mods }));
const fim = () => within(screen.getByLabelText('Placar')).getByText('Fim').nextSibling;
const rotulo = () =>
  Konva.stages[Konva.stages.length - 1]!.findOne<Konva.Group>('#mao')!
    .find<Konva.Text>('Text')
    .map((t) => t.text());

async function abrirAtalhos(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Configurações' }));
  await user.click(screen.getByRole('tab', { name: 'Atalhos' }));
}

describe('atalhos configuráveis', () => {
  it('padrões de hoje e o atalho de fábrica de uma ação do jogo', async () => {
    await abrir();
    tecla('KeyE', 'e');
    expect(fim()).toHaveTextContent('1'); // E: Terminar turno (key do pacote)
    expect(rotulo()).toEqual(['Mão']);
    tecla('KeyG', 'g');
    expect(rotulo()).toEqual([]); // G: contornos das zonas
  });

  it('trocar um atalho: popup espera a combinação, Enter confirma; o antigo deixa de valer', async () => {
    const user = userEvent.setup();
    const salvos = vi.fn();
    await abrir({ onKeyPrefs: salvos });
    await abrirAtalhos(user);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar atalho' }), 'contornos');
    await user.click(screen.getByRole('button', { name: /Atalho de .*Contornos das zonas: G/ }));
    const popup = within(screen.getByRole('dialog', { name: 'Novo atalho' }));
    tecla('KeyT', '†', { altKey: true, shiftKey: true });
    expect(popup.getByText('Alt+Shift+T')).toBeInTheDocument();
    tecla('Enter', 'Enter');
    expect(screen.queryByRole('dialog', { name: 'Novo atalho' })).toBeNull();
    expect(
      screen.getByRole('button', { name: /Contornos das zonas: Alt\+Shift\+T/ }),
    ).toBeInTheDocument();
    expect(salvos).toHaveBeenLastCalledWith({ global: { 'hud:guides': 'Alt+Shift+T' }, game: {} });
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    tecla('KeyG', 'g');
    expect(rotulo()).toEqual(['Mão']); // G não faz mais nada
    tecla('KeyT', '†', { altKey: true, shiftKey: true });
    expect(rotulo()).toEqual([]);
  });

  it('combinação em uso ou reservada bloqueia o Enter; Esc cancela sem fechar as configurações', async () => {
    const user = userEvent.setup();
    await abrir();
    await abrirAtalhos(user);
    await user.click(screen.getByRole('button', { name: /Atalho de Desfazer: nenhum/ }));
    tecla('KeyJ', 'j');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Já usado por: Mostrar ou esconder: Jogadores',
    );
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    tecla('Enter', 'Enter');
    expect(screen.getByRole('dialog', { name: 'Novo atalho' })).toBeInTheDocument(); // não confirmou
    tecla('KeyW', 'w', { metaKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent('reservada: fecha a aba do navegador');
    tecla('Escape', 'Escape');
    expect(screen.queryByRole('dialog', { name: 'Novo atalho' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeInTheDocument();
  });

  it('ação do jogo sem atalho de fábrica; desabilitada, o atalho mostra o motivo; restaurar e remover', async () => {
    const user = userEvent.setup();
    await abrir();
    await abrirAtalhos(user);
    await user.click(screen.getByRole('button', { name: /Atalho de Skill Disc de Alpha: nenhum/ }));
    tecla('KeyD', '∂', { altKey: true });
    tecla('Enter', 'Enter');
    await user.click(screen.getByRole('button', { name: /Remover o atalho de Terminar turno/ }));
    expect(
      screen.getByRole('button', { name: /Atalho de Terminar turno: nenhum/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Restaurar o padrão de Terminar turno/ }));
    expect(screen.getByRole('button', { name: /Atalho de Terminar turno: E/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fechar' }));
    tecla('KeyD', '∂', { altKey: true });
    expect(screen.getByRole('status')).toHaveTextContent('Skill Disc de Alpha: sem discos');
    expect(fim()).toHaveTextContent('—'); // não rodou
  });

  it('os atalhos guardados pelo site valem ao abrir', async () => {
    await abrir({ keyPrefs: { global: { 'hud:guides': null }, game: { 'game:terminar': 'X' } } });
    tecla('KeyE', 'e');
    expect(fim()).toHaveTextContent('—');
    tecla('KeyX', 'x');
    expect(fim()).toHaveTextContent('1');
    tecla('KeyG', 'g');
    expect(rotulo()).toEqual(['Mão']); // sem atalho
  });
});
