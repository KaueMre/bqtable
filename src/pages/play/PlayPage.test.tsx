import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { routes } from '@/app/routes';
import type { FrameLoad } from '@/frame/protocol';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

/** O iframe avisa que está pronto; devolve o que a página mandou para ele. */
async function handshake() {
  const iframe = (await screen.findByTitle(/^Jogo: /)) as HTMLIFrameElement;
  const frame = iframe.contentWindow!;
  const post = vi.spyOn(frame, 'postMessage');
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'bq:ready' }, source: frame }),
    );
  });
  expect(post).toHaveBeenCalledTimes(1);
  const [message, target] = post.mock.calls[0]!;
  return { iframe, frame, post, message: message as FrameLoad, target };
}

describe('PlayPage', () => {
  it('o jogo roda num iframe isolado, que recebe os bytes do pacote', async () => {
    const user = userEvent.setup();
    const router = renderAt('/jogar');
    expect(screen.getByText(/Escolha um arquivo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Baralho comum/ }));
    expect(router.state.location.search).toBe('?url=%2Fexemplos%2Fbaralho.json');

    const { iframe, message, target } = await handshake();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts'); // sem allow-same-origin
    expect(iframe.getAttribute('src')).toBe('/frame.html');
    expect(target).toBe('*');
    expect(message).toMatchObject({ type: 'bq:load', name: '/exemplos/baralho.json' });
    expect(message.url).toMatch(/\/exemplos\/baralho\.json$/);
    expect(JSON.parse(new TextDecoder().decode(message.bytes)).name).toBe('Baralho comum');
  });

  it('mensagens de outras janelas são ignoradas', async () => {
    renderAt('/jogar?url=/exemplos/piramide.bqgame');
    const iframe = (await screen.findByTitle(/^Jogo: /)) as HTMLIFrameElement;
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'bq:ready' }, source: window }),
      );
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('arquivo enviado pelo usuário vai para o iframe', async () => {
    const user = userEvent.setup();
    renderAt('/jogar');
    const file = new File(['{"format":"bqgame/1"}'], 'meu.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText(/Arquivo/), file);
    const { message } = await handshake();
    expect(message.name).toBe('meu.json');
    expect(message.url).toBeUndefined();
    expect(new TextDecoder().decode(message.bytes)).toBe('{"format":"bqgame/1"}');
  });

  it('guarda os atalhos que o jogo manda e devolve ao abrir de novo; repassa as combinações dele', async () => {
    localStorage.clear();
    renderAt('/jogar?url=/exemplos/piramide.bqgame');
    const { frame, post, message } = await handshake();
    expect(message.prefs).toEqual({});
    const doJogo = (data: object) =>
      act(() => void window.dispatchEvent(new MessageEvent('message', { data, source: frame })));

    doJogo({
      type: 'bq:prefs',
      gameId: 'piramide',
      keys: { 'hud:guides': 'Alt+Shift+T' },
      gameKeys: { 'game:terminar': 'X' },
    });
    doJogo({ type: 'bq:prefs', gameId: '__proto__', keys: {}, gameKeys: {} }); // inválido
    doJogo({ type: 'bq:prefs', gameId: 'outro', keys: { a: 'não é tecla' }, gameKeys: {} });
    const guardado = {
      keys: { 'hud:guides': 'Alt+Shift+T' },
      games: { piramide: { keys: { 'game:terminar': 'X' } } },
    };
    expect(JSON.parse(localStorage.getItem('bqtable:prefs')!)).toEqual(guardado);

    // com o foco no site: as combinações do jogo vão para ele, menos digitando na URL
    doJogo({ type: 'bq:keymap', combos: ['Alt+Shift+T', 'X'] });
    post.mockClear();
    fireEvent.keyDown(document.body, { key: 'x', code: 'KeyX' });
    fireEvent.keyDown(document.body, { key: 'y', code: 'KeyY' }); // sem atalho
    fireEvent.keyDown(screen.getByLabelText('URL do jogo'), { key: 'x', code: 'KeyX' });
    expect(post.mock.calls.map(([m]) => m)).toEqual([
      expect.objectContaining({ type: 'bq:key', down: true, code: 'KeyX', ctrlKey: false }),
    ]);

    // o iframe recarregou: o pacote vai de novo, com os atalhos guardados
    post.mockClear();
    doJogo({ type: 'bq:ready' });
    expect(post.mock.calls[0]![0]).toMatchObject({ type: 'bq:load', prefs: guardado });
  });

  it.each([
    '/jogar?url=https://github.com/KaueMre/bqtable/blob/main/public/exemplos/baralho.json',
    '/jogar?gh=KaueMre/bqtable/public/exemplos/baralho.json',
  ])('link do GitHub baixa o arquivo cru: %s', async (path) => {
    const raw =
      'https://raw.githubusercontent.com/KaueMre/bqtable/main/public/exemplos/baralho.json';
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{"format":"bqgame/1"}'));
    try {
      renderAt(path);
      const { message } = await handshake();
      expect(fetch).toHaveBeenCalledWith(raw);
      expect(message).toMatchObject({ name: raw, url: raw }); // base dos caminhos relativos
    } finally {
      fetch.mockRestore();
    }
  });

  it('link de Release explica o motivo sem tentar baixar', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      renderAt('/jogar?url=https://github.com/o/r/releases/download/v1/jogo.bqgame');
      expect(await screen.findByRole('alert')).toHaveTextContent(/não manda o cabeçalho de CORS/);
      expect(screen.queryByTitle(/^Jogo: /)).not.toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('URL que não existe mostra o erro na página', async () => {
    renderAt('/jogar?url=/exemplos/nao-existe.bqgame');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '/exemplos/nao-existe.bqgame: HTTP 404',
    );
  });
});
