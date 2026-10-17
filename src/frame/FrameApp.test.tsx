import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { FrameApp } from './FrameApp';

const exemplo = async (nome: string) => {
  const file = await readFile(join(import.meta.dirname, '../../public/exemplos', nome));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

/** Renderiza o app do iframe com a própria janela fazendo o papel do site. */
function renderFrame() {
  const post = vi.spyOn(window, 'postMessage');
  render(
    <AppProviders>
      <FrameApp parent={window} />
    </AppProviders>,
  );
  const send = (data: object) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, source: window }));
    });
  const sent = () => post.mock.calls.map(([m]) => m as { type: string });
  return { send, sent };
}

describe('FrameApp (dentro do iframe)', () => {
  it('avisa que está pronto, recebe o pacote e abre o jogo com as regras', async () => {
    const { send, sent } = renderFrame();
    expect(screen.getByText('Aguardando o jogo…')).toBeInTheDocument();
    expect(sent()).toContainEqual({ type: 'bq:ready' });

    send({
      type: 'bq:load',
      nonce: 'n1',
      name: 'piramide',
      bytes: await exemplo('piramide.bqgame'),
    });
    expect(await screen.findByRole('heading', { name: 'Pirâmide de energia' })).toBeInTheDocument();
    const placar = within(await screen.findByLabelText('Placar', {}, { timeout: 4000 }));
    expect(placar.getByText('Banco de energia').nextSibling).toHaveTextContent('27'); // 30 - 3
    const recursos = within(screen.getByLabelText('Recursos de Jogador 1'));
    expect(recursos.getByText('Energia').nextSibling).toHaveTextContent('3');
    expect(recursos.getByText('Pontos').nextSibling).toHaveTextContent('0');
    expect(sent()).toContainEqual({ type: 'bq:loaded', nonce: 'n1', name: 'Pirâmide de energia' });
  });

  it('opções da partida ao lado de Jogadores; trocar recomeça a partida', async () => {
    const user = userEvent.setup();
    const { send } = renderFrame();
    const manifest = {
      format: 'bqgame/1',
      id: 'opcoes',
      name: 'Opções',
      options: [
        { id: 'stage', label: 'Stage', choices: ['A', 'B'] },
        {
          id: 'nivel',
          label: 'Dificuldade',
          choices: [
            { value: 'facil', label: 'Fácil' },
            { value: 'dificil', label: 'Difícil' },
          ],
          default: 'dificil',
        },
      ],
      kinds: [{ kind: 'k' }],
      setup: [
        { command: { type: 'setGlobal', key: 'stage', value: '{options.stage}' } },
        { command: { type: 'setGlobal', key: 'nivel', value: '{options.nivel}' } },
      ],
      hud: [
        { label: 'Stage atual', global: 'stage' },
        { label: 'Nível', global: 'nivel' },
      ],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest)).buffer;
    send({ type: 'bq:load', nonce: 'n3', name: 'opcoes.json', bytes });
    const placar = within(await screen.findByLabelText('Placar'));
    expect(placar.getByText('Stage atual').nextSibling).toHaveTextContent('A');
    expect(placar.getByText('Nível').nextSibling).toHaveTextContent('dificil');
    expect(screen.getByRole('combobox', { name: 'Dificuldade' })).toHaveDisplayValue('Difícil');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'B');
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Placar')).getByText('Stage atual').nextSibling,
      ).toHaveTextContent('B'),
    );
  });

  it('pacote inválido mostra o erro e avisa o site', async () => {
    const { send, sent } = renderFrame();
    const ruim = new TextEncoder().encode(JSON.stringify({ format: 'bqgame/1', id: 'x' })).buffer;
    send({ type: 'bq:load', nonce: 'n2', name: 'ruim.json', bytes: ruim });
    expect(await screen.findByRole('alert')).toHaveTextContent('manifest não bate com o formato');
    expect(sent().find((m) => m.type === 'bq:error')).toMatchObject({ nonce: 'n2' });
  });

  it('Alt apertado no site chega à mesa do jogo (preview sem o foco do teclado)', () => {
    const { send } = renderFrame();
    const teclas: string[] = [];
    const ouvir = (e: KeyboardEvent) => teclas.push(`${e.type}:${e.key}`);
    window.addEventListener('keydown', ouvir);
    window.addEventListener('keyup', ouvir);
    const alt = { key: 'Alt', code: 'AltLeft', shiftKey: false };
    send({ type: 'bq:key', down: true, altKey: true, ...alt });
    send({ type: 'bq:key', down: true, key: '™', code: 'Digit2', altKey: true, shiftKey: true });
    send({ type: 'bq:key', down: true, key: 'a', code: 'KeyA', altKey: false, shiftKey: false }); // não é atalho
    send({ type: 'bq:key', down: false, altKey: false, ...alt });
    window.removeEventListener('keydown', ouvir);
    window.removeEventListener('keyup', ouvir);
    expect(teclas).toEqual(['keydown:Alt', 'keydown:™', 'keyup:Alt']);
  });

  it('atalhos guardados pelo site valem no jogo; trocar um avisa o site para guardar', async () => {
    const user = userEvent.setup();
    const { send, sent } = renderFrame();
    send({
      type: 'bq:load',
      nonce: 'n4',
      name: 'piramide',
      bytes: await exemplo('piramide.bqgame'),
      prefs: { keys: { 'hud:guides': 'Alt+Shift+T', 'hud:tips': null } },
    });
    await screen.findByLabelText('Placar', {}, { timeout: 4000 });
    // o site fica sabendo das combinações com atalho (para repassar com o foco fora do iframe)
    const keymap = sent().findLast((m) => m.type === 'bq:keymap') as unknown as {
      combos: string[];
    };
    expect(keymap.combos).toContain('Alt+Shift+T');
    expect(keymap.combos).not.toContain('G');
    expect(keymap.combos).not.toContain('T');

    // tecla repassada pelo site: só as do mapa (e as da mesa)
    const teclas: string[] = [];
    const ouvir = (e: KeyboardEvent) => teclas.push(`${e.type}:${e.code}`);
    window.addEventListener('keydown', ouvir);
    const tecla = { down: true, key: 'T', code: 'KeyT', altKey: true, shiftKey: true };
    send({ type: 'bq:key', ...tecla });
    send({ type: 'bq:key', ...tecla, code: 'KeyG', key: 'g', altKey: false, shiftKey: false });
    window.removeEventListener('keydown', ouvir);
    expect(teclas).toEqual(['keydown:KeyT']);

    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.click(screen.getByRole('tab', { name: 'Atalhos' }));
    await user.click(screen.getByRole('button', { name: /^Atalho de Mostrar ou esconder: Log/ }));
    await user.keyboard('{Alt>}{Shift>}L{/Shift}{/Alt}');
    await user.keyboard('{Enter}');
    expect(sent().findLast((m) => m.type === 'bq:prefs')).toEqual({
      type: 'bq:prefs',
      gameId: 'piramide',
      keys: { 'hud:guides': 'Alt+Shift+T', 'hud:tips': null, 'hud:log': 'Alt+Shift+L' },
      gameKeys: {},
    });
  });

  it('ignora mensagens que não vêm do site ou que não são do protocolo', async () => {
    const { sent } = renderFrame();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'bq:load', nonce: 'x', bytes: new ArrayBuffer(1) },
        }),
      );
      window.dispatchEvent(new MessageEvent('message', { data: 'oi', source: window }));
    });
    expect(screen.getByText('Aguardando o jogo…')).toBeInTheDocument();
    expect(sent().filter((m) => m.type !== 'bq:ready')).toEqual([]);
  });
});
