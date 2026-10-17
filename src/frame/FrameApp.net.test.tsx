import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { childrenOf, type GameState } from '@/engine/core';
import { redactFor } from '@/engine/net';
import { loadGame } from '@/engine/package/game';
import { FrameApp } from './FrameApp';
import type { FrameNetOut, NetOut } from './protocol';

const piramide = async () => {
  const file = await readFile(join(import.meta.dirname, '../../public/exemplos/piramide.bqgame'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

/** O app do iframe, com a própria janela no papel do site. */
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
  /** O que o jogo mandou para a rede. */
  const net = () =>
    post.mock.calls
      .map(([m]) => m as FrameNetOut)
      .filter((m) => m.type === 'bq:net-out')
      .map((m) => m.msg);
  return { send, net };
}

type States = Extract<NetOut, { kind: 'states' }>;
const ultimoEstado = (net: () => NetOut[]) =>
  net().findLast((m): m is States => m.kind === 'states')!;

describe('FrameApp hospedando', () => {
  it('publica o estado de cada assento, aplica comandos de convidados e avisa recusas', async () => {
    const { send, net } = renderFrame();
    send({
      type: 'bq:load',
      nonce: 'h1',
      name: 'piramide',
      bytes: await piramide(),
      net: { role: 'host', seat: 'p1' },
    });
    await screen.findByLabelText('Placar', {}, { timeout: 4000 });
    // dois jogadores por padrão ao hospedar; cada assento recebe o próprio estado
    const primeiro = ultimoEstado(net);
    expect(Object.keys(primeiro.states)).toEqual(['p1', 'p2']);
    expect(primeiro.options).toEqual({});
    const daMaoDoP1 = (s: GameState) => childrenOf(s.pieces, 'p1-mao');
    expect(daMaoDoP1(primeiro.states.p1!).every((c) => c.attributes.def)).toBe(true);
    expect(daMaoDoP1(primeiro.states.p2!).every((c) => c.id.startsWith('p1-mao~'))).toBe(true);
    // a tela fica no assento do host: sem "Ver como"
    expect(within(screen.getByText('Jogador 1').closest('li')!).getByText('na tela')).toBeVisible();
    expect(screen.queryByLabelText('Ver como')).toBeNull();
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeInTheDocument();

    // comando do convidado p2: vale como p2, mesmo com actor forjado
    send({
      type: 'bq:net-in',
      nonce: 'h1',
      msg: { kind: 'cmd', seat: 'p2', cmd: { type: 'comprar', mao: 'p2-mao', actor: 'p1' } },
    });
    await waitFor(
      () => expect(childrenOf(ultimoEstado(net).states.p2!.pieces, 'p2-mao')).toHaveLength(4),
      { timeout: 4000 },
    );
    // o p2 tentando comprar para a mão do host: recusa só para ele
    send({
      type: 'bq:net-in',
      nonce: 'h1',
      msg: { kind: 'cmd', seat: 'p2', cmd: { type: 'comprar', mao: 'p1-mao' } },
    });
    await waitFor(
      () =>
        expect(net()).toContainEqual({
          kind: 'rejected',
          seat: 'p2',
          reason: 'compre só para a sua mão',
        }),
      { timeout: 4000 },
    );
    // mensagem de outro pacote é ignorada
    const antes = net().length;
    send({
      type: 'bq:net-in',
      nonce: 'outro',
      msg: { kind: 'cmd', seat: 'p2', cmd: { type: 'comprar', mao: 'p2-mao' } },
    });
    expect(net()).toHaveLength(antes);
  });
});

describe('FrameApp como convidado', () => {
  it('espera o estado do host, joga pelo Gestor remoto, sem desfazer nem reiniciar', async () => {
    const user = userEvent.setup();
    const { send, net } = renderFrame();
    const bytes = await piramide();
    // a partida do host, fora da tela
    const host = (await loadGame({ bytes })).createManager({ players: 2, seed: 4 });
    const estado = () => redactFor(host.getState(), 'p2', host.kinds);
    send({
      type: 'bq:load',
      nonce: 'g1',
      name: 'piramide',
      bytes,
      net: { role: 'guest', seat: 'p2', players: 2, options: {} },
    });
    expect(
      await screen.findByText('Esperando a mesa do host…', {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Jogadores' })).toBeNull(); // quem escolhe é o host
    expect(screen.getByText(/Você joga como p2/)).toBeVisible();

    send({ type: 'bq:net-in', nonce: 'g1', msg: { kind: 'state', state: estado() } });
    const recursos = await screen.findByLabelText('Recursos de Jogador 2', {}, { timeout: 4000 });
    expect(within(recursos).getByText('Mão').nextSibling).toHaveTextContent('3');
    expect(within(screen.getByText('Jogador 2').closest('li')!).getByText('na tela')).toBeVisible();
    expect(screen.queryByLabelText('Ver como')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reiniciar' })).toBeNull();

    // não é a vez dele; quando passa a ser, o botão manda o comando ao host
    expect(screen.getByRole('button', { name: 'Passar a vez' })).toBeDisabled();
    host.dispatch({ type: 'nextPlayer', actor: 'p1' });
    send({ type: 'bq:net-in', nonce: 'g1', msg: { kind: 'state', state: estado() } });
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Passar a vez' })).toBeEnabled(),
      { timeout: 4000 },
    );
    await user.click(screen.getByRole('button', { name: 'Passar a vez' }));
    expect(net()).toContainEqual({ kind: 'cmd', cmd: { type: 'nextPlayer', actor: 'p2' } });

    // a recusa do host aparece como uma recusa local
    send({ type: 'bq:net-in', nonce: 'g1', msg: { kind: 'rejected', reason: 'não pode' } });
    expect(await screen.findByText('Recusado: não pode', {}, { timeout: 4000 })).toBeVisible();
  });
});
