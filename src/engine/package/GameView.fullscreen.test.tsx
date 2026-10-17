import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

const manifest = {
  format: 'bqgame/1',
  id: 'tela-cheia',
  name: 'Tela cheia',
  version: '1.2',
  author: 'Fulana',
  players: { min: 1, max: 3, names: ['Ana', 'Bia'] },
  options: [{ id: 'stage', label: 'Stage', choices: ['A', 'B'], default: 'B' }],
  kinds: [{ kind: 'carta', defaults: { size: { w: 60, h: 90 } } }],
  setup: [
    {
      pieces: [
        { id: 'c1', kind: 'carta', faces: { default: 'Rosa' }, transform: { x: 100, y: 100 } },
      ],
    },
    { command: { type: 'setGlobal', key: 'pontos', value: 3 } },
  ],
  hud: [{ label: 'Pontos', global: 'pontos' }],
};

async function abrir() {
  const game = await loadGame({ manifest });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} options={{ stage: 'A' }} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Placar');
}

const barra = () => screen.queryByRole('toolbar', { name: 'Barra do jogo' });
const tecla = (key: string) => act(() => void fireEvent.keyDown(window, { key }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameView: tela cheia e HUD', () => {
  it('entra e sai: a mesa ocupa tudo e os painéis flutuam; a barra tem os botões', async () => {
    const user = userEvent.setup();
    await abrir();
    expect(barra()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    const b = within(barra()!);
    for (const nome of [
      'Desfazer',
      'Reiniciar',
      'Passar a vez',
      'HUD',
      'Configurações',
      'Sair da tela cheia',
    ]) {
      expect(b.getByRole('button', { name: nome })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Tela cheia' })).toBeNull();
    expect(screen.getByLabelText('Jogadores')).toBeInTheDocument();
    expect(screen.getByLabelText('Placar')).toBeInTheDocument();
    expect(screen.getByLabelText('Log de eventos')).toBeInTheDocument();
    // passar a vez fica na barra, não no painel
    expect(
      within(screen.getByLabelText('Jogadores')).queryByRole('button', { name: 'Passar a vez' }),
    ).toBeNull();
    await user.click(b.getByRole('button', { name: 'Sair da tela cheia' }));
    expect(barra()).toBeNull();
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeInTheDocument();
  });

  it('menu da HUD abre com o mouse em cima; clicar troca o modo do painel', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    await user.hover(screen.getByRole('button', { name: 'HUD' }));
    const menu = within(screen.getByRole('list', { name: 'Painéis da HUD' }));
    await user.click(menu.getByRole('button', { name: 'Log: completo' }));
    expect(screen.queryByLabelText('Log de eventos')).toBeNull();
    expect(menu.getByRole('button', { name: 'Log: oculto' })).toBeInTheDocument();
    await user.click(menu.getByRole('button', { name: 'Log: oculto' }));
    expect(screen.getByLabelText('Log de eventos')).toBeInTheDocument();
    await user.unhover(screen.getByRole('button', { name: 'HUD' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Painéis da HUD' })).toBeNull());
  });

  it('atalhos trocam os painéis (só na tela cheia, e não ao digitar)', async () => {
    const user = userEvent.setup();
    await abrir();
    tecla('j');
    expect(screen.getByLabelText('Jogadores')).toBeInTheDocument(); // fora da tela cheia: nada
    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    tecla('j');
    expect(screen.queryByLabelText('Jogadores')).toBeNull();
    tecla('I');
    expect(screen.queryByLabelText('Placar')).toBeNull();
    tecla('l');
    expect(screen.queryByLabelText('Log de eventos')).toBeNull();
    tecla('j');
    expect(screen.getByLabelText('Jogadores')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /Ver como/ });
    act(() => void fireEvent.keyDown(select, { key: 'j' })); // no select: não é atalho
    expect(screen.getByLabelText('Jogadores')).toBeInTheDocument();
  });

  it('contornos das zonas: G liga e desliga, também fora da tela cheia; o manifest diz o início', async () => {
    const user = userEvent.setup();
    const game = await loadGame({
      manifest: {
        ...manifest,
        table: { guides: false },
        setup: [
          ...manifest.setup,
          {
            pieces: [
              {
                id: 'mao',
                kind: 'zona',
                faces: { default: 'Mão' },
                size: { w: 200, h: 100 },
                transform: { x: 300, y: 300 },
                zone: { layout: 'fan' },
              },
            ],
          },
        ],
        kinds: [...manifest.kinds, { kind: 'zona' }],
      },
    });
    render(
      <AppProviders>
        <DataBoundary>
          <GameView game={game} players={2} />
        </DataBoundary>
      </AppProviders>,
    );
    await screen.findByLabelText('Placar');
    const rotulo = () =>
      Konva.stages[Konva.stages.length - 1]!.findOne<Konva.Group>('#mao')!
        .find<Konva.Text>('Text')
        .map((t) => t.text());
    expect(rotulo()).toEqual([]); // começa desligado (table.guides: false)
    tecla('g');
    expect(rotulo()).toEqual(['Mão']);
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.click(screen.getByRole('tab', { name: 'Exibição' }));
    const exibicao = within(screen.getByRole('list', { name: 'Exibição' }));
    expect(exibicao.queryByRole('button', { name: /Jogadores/ })).toBeNull(); // painel: só na tela cheia
    await user.click(exibicao.getByRole('button', { name: 'Contornos das zonas: completo' }));
    expect(rotulo()).toEqual([]);
  });

  it('preview oculto: o Alt não mostra a peça', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    const stage = Konva.stages[Konva.stages.length - 1]!;
    act(() => void stage.findOne('#c1')!.fire('mouseenter'));
    tecla('Alt');
    expect(screen.getByRole('img', { name: 'Pré-visualização' })).toHaveTextContent('Rosa');
    act(() => void fireEvent.keyUp(window, { key: 'Alt' }));
    tecla('v');
    tecla('Alt');
    expect(screen.queryByRole('img', { name: 'Pré-visualização' })).toBeNull();
  });

  it('configurações: info do jogo carregado e atalhos; Esc fecha', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Configurações' }));
    const info = within(dialog.getByLabelText('Info do jogo carregado'));
    expect(info.getByText('Tela cheia')).toBeInTheDocument();
    expect(info.getByText('1.2')).toBeInTheDocument();
    expect(info.getByText('2 (de 1 a 3)')).toBeInTheDocument();
    expect(info.getByText('Stage').nextSibling).toHaveTextContent('A');
    await user.click(dialog.getByRole('tab', { name: 'Atalhos' }));
    expect(dialog.getByText('Alt (segurar)')).toBeInTheDocument();
    tecla('Escape');
    expect(screen.queryByRole('dialog', { name: 'Configurações' })).toBeNull();
  });

  it('tela cheia do navegador: Esc (sair pelo navegador) volta ao layout normal', async () => {
    const user = userEvent.setup();
    let atual: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => atual, configurable: true });
    const pedir = vi.fn(function (this: HTMLElement) {
      atual = document.querySelector('.bq-game'); // o elemento que pediu a tela cheia
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      value: pedir,
      configurable: true,
    });
    try {
      await abrir();
      await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
      expect(pedir).toHaveBeenCalledTimes(1);
      expect(barra()).not.toBeNull();
      act(() => {
        atual = null; // o navegador saiu (Esc)
        document.dispatchEvent(new Event('fullscreenchange'));
      });
      expect(barra()).toBeNull();
    } finally {
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
      delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    }
  });
});
