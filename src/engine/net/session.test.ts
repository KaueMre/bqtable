import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { childrenOf, type GameState, type Manager } from '@/engine/core';
import { loadGame } from '@/engine/package/game';
import { packGame } from '../../../scripts/pack-game.mjs';
import { CHUNK_SIZE, netMessage, parseMessage, sha256 } from './protocol';
import { applyFrom, redactFor, statesFor } from './redact';
import { createRemoteManager, type RemoteManager } from './remote';
import {
  createGuestSession,
  createHostSession,
  type GuestInfo,
  type GuestSession,
  type HostSession,
} from './session';
import { createBroadcastTransports, createMemoryNetwork, type TransportFactory } from './transport';

/** Folga para esperar a rede (a máquina pode estar ocupada com outras coisas). */
const FOLGA = { timeout: 5000 };

const pasta = fileURLToPath(new URL('../../../examples/piramide', import.meta.url));
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = zipSync(await packGame(pasta));
});

/** O host: a partida da pirâmide, ligada a uma sessão. */
async function abrirMesa(rede: TransportFactory, sala = 'sala1') {
  const game = await loadGame({ bytes });
  const manager = game.createManager({ players: 2, seed: 5 });
  const seats = manager.getState().playerOrder;
  const convidados: GuestInfo[][] = [];
  const session: HostSession = await createHostSession({
    transport: rede.host(sala),
    seats,
    hostSeat: 'p1',
    pacote: { nome: 'piramide.bqgame', bytes },
    onCommand(seat, cmd) {
      const r = applyFrom(manager, seat, cmd);
      if (!r.ok) session.reject(seat, r.error);
    },
    onGuests: (g) => convidados.push(g),
  });
  manager.subscribe(() => session.publish(statesFor(manager, seats)));
  session.publish(statesFor(manager, seats));
  return { manager, session, convidados };
}

/** Um convidado: recebe o pacote, abre o jogo e joga por um RemoteManager. */
function entrar(rede: TransportFactory, sala = 'sala1') {
  const out = {
    remote: null as RemoteManager | null,
    recebido: null as Uint8Array | null,
    estados: [] as GameState[],
    recusas: [] as string[],
    fim: null as string | null,
    progresso: [] as number[],
    session: null as unknown as GuestSession,
  };
  out.session = createGuestSession({
    transport: rede.join(sala),
    host: sala,
    onProgress: (n) => out.progresso.push(n),
    onPackage(b) {
      out.recebido = b;
      out.remote = createRemoteManager((cmd) => out.session.send(cmd));
    },
    onState(s) {
      out.estados.push(s);
      out.remote!.setState(s);
    },
    onRejected: (r) => out.recusas.push(r),
    onClose: (r) => (out.fim = r),
  });
  return out;
}

const pronto = (c: ReturnType<typeof entrar>) =>
  vi.waitFor(() => expect(c.estados.length).toBeGreaterThan(0), FOLGA);

describe('protocolo', () => {
  it('confere versão e forma', () => {
    expect(parseMessage(netMessage({ type: 'hello' }))).toEqual({
      ok: true,
      value: { v: 1, type: 'hello' },
    });
    expect(parseMessage({ v: 2, type: 'hello' })).toMatchObject({ ok: false });
    expect(parseMessage({ v: 1, type: 'cmd', cmd: { x: 1 } })).toMatchObject({ ok: false });
    expect(
      parseMessage({ v: 1, type: 'pkg-chunk', i: 0, n: 1, bytes: new Uint8Array(CHUNK_SIZE + 1) }),
    ).toMatchObject({ ok: false });
    expect(parseMessage({ v: 1, type: 'state', seq: 1, state: { pieces: {} } })).toMatchObject({
      ok: false,
    });
  });
});

describe('sessões com MemoryTransport (pirâmide)', () => {
  it('entrar: assento livre, pacote inteiro e conferido, depois o estado do assento', async () => {
    const rede = createMemoryNetwork();
    const { manager, convidados } = await abrirMesa(rede);
    const c = entrar(rede);
    await pronto(c);
    expect(c.session.seat()).toBe('p2'); // o p1 é o host
    expect(c.recebido).toEqual(bytes);
    expect(c.estados[0]).toEqual(redactFor(manager.getState(), 'p2', manager.kinds));
    expect(convidados.at(-1)).toEqual([{ peer: expect.any(String), seat: 'p2' }]);
    // o convidado abre o jogo com os bytes que chegaram
    expect((await loadGame({ bytes: c.recebido! })).manifest.id).toBe('piramide');
  });

  it('pacote grande vai em pedaços de até 16 KiB', async () => {
    const rede = createMemoryNetwork();
    const grande = crypto.getRandomValues(new Uint8Array(CHUNK_SIZE * 3 + 100));
    const host = await createHostSession({
      transport: rede.host('s'),
      seats: ['p1', 'p2'],
      pacote: { nome: 'x', bytes: grande },
      onCommand() {},
    });
    const tamanhos: number[] = [];
    const guest = rede.join('s');
    guest.onMessage((_, m) => {
      const r = parseMessage(m);
      if (r.ok && r.value.type === 'pkg-chunk') tamanhos.push(r.value.bytes.byteLength);
    });
    const c = { recebido: null as Uint8Array | null };
    createGuestSession({
      transport: guest,
      host: 's',
      onPackage: (b) => (c.recebido = b),
      onState() {},
      onRejected() {},
    });
    await vi.waitFor(() => expect(c.recebido).not.toBeNull(), FOLGA);
    expect(tamanhos).toEqual([CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE, 100]);
    expect(c.recebido).toEqual(grande);
    expect(host.pacote.hash).toBe(await sha256(grande));
  });

  it('jogar: o comando do convidado vale no host e o estado volta para ele', async () => {
    const rede = createMemoryNetwork();
    const { manager } = await abrirMesa(rede);
    const c = entrar(rede);
    await pronto(c);
    c.remote!.dispatch({ type: 'comprar', mao: 'p2-mao' });
    await vi.waitFor(
      () => expect(childrenOf(manager.getState().pieces, 'p2-mao')).toHaveLength(4),
      FOLGA,
    );
    await vi.waitFor(
      () =>
        expect(c.remote!.getState()).toEqual(redactFor(manager.getState(), 'p2', manager.kinds)),
      FOLGA,
    );
    // jogada do host também chega
    manager.dispatch({ type: 'comprar', mao: 'p1-mao', actor: 'p1' });
    await vi.waitFor(
      () => expect(childrenOf(c.remote!.getState().pieces, 'p1-mao')).toHaveLength(4),
      FOLGA,
    );
    expect(c.recusas).toEqual([]);
  });

  it('comando para o assento de outro é recusado; só quem mandou recebe a recusa', async () => {
    const rede = createMemoryNetwork();
    const { manager } = await abrirMesa(rede);
    const c = entrar(rede);
    await pronto(c);
    const antes = manager.getState();
    c.session.send({ type: 'comprar', mao: 'p1-mao' });
    await vi.waitFor(() => expect(c.recusas).toEqual(['compre só para a sua mão']), FOLGA);
    expect(manager.getState()).toBe(antes);
  });

  it('actor forjado é sobrescrito pelo assento', async () => {
    const rede = createMemoryNetwork();
    const { manager } = await abrirMesa(rede);
    const c = entrar(rede);
    await pronto(c);
    // em nome do p1 (o host), para a mão do p1: o host trata como p2 e recusa
    c.session.send({ type: 'comprar', mao: 'p1-mao', actor: 'p1' });
    await vi.waitFor(() => expect(c.recusas).toEqual(['compre só para a sua mão']), FOLGA);
    // em nome do p1, para a própria mão: vale, como p2
    c.session.send({ type: 'comprar', mao: 'p2-mao', actor: 'p1' });
    await vi.waitFor(
      () => expect(childrenOf(manager.getState().pieces, 'p2-mao')).toHaveLength(4),
      FOLGA,
    );
  });

  it('mesa cheia: quem sobra recebe bye; quem sai libera o assento', async () => {
    const rede = createMemoryNetwork();
    const { convidados } = await abrirMesa(rede);
    const a = entrar(rede);
    await pronto(a);
    const b = entrar(rede);
    await vi.waitFor(() => expect(b.fim).toBe('a mesa está cheia'), FOLGA);
    a.session.close();
    await vi.waitFor(() => expect(convidados.at(-1)).toEqual([]), FOLGA);
    const c = entrar(rede);
    await pronto(c);
    expect(c.session.seat()).toBe('p2');
  });

  it('o host fecha a mesa: o convidado fica sabendo', async () => {
    const rede = createMemoryNetwork();
    const { session } = await abrirMesa(rede);
    const c = entrar(rede);
    await pronto(c);
    session.close();
    await vi.waitFor(() => expect(c.fim).toBe('o host fechou a mesa'), FOLGA);
  });

  it('pacote que não confere com o hash é recusado', async () => {
    const rede = createMemoryNetwork();
    const host = rede.host('s');
    host.onPeer((peer, ev) => {
      if (ev !== 'open') return;
      host.send(
        peer,
        netMessage({
          type: 'welcome',
          seat: 'p2',
          pacote: { nome: 'x', tamanho: 3, hash: '0'.repeat(64) },
        }),
      );
      host.send(peer, netMessage({ type: 'pkg-chunk', i: 0, n: 1, bytes: new Uint8Array(3) }));
    });
    const c = { fim: null as string | null, pacote: false };
    createGuestSession({
      transport: rede.join('s'),
      host: 's',
      onPackage: () => (c.pacote = true),
      onState() {},
      onRejected() {},
      onClose: (r) => (c.fim = r),
    });
    await vi.waitFor(() => expect(c.fim).toBe('o pacote chegou diferente do enviado'), FOLGA);
    expect(c.pacote).toBe(false);
  });
});

describe('BroadcastChannelTransport', () => {
  it('host e convidado no mesmo processo: entrar e jogar', async () => {
    const rede = createBroadcastTransports(`teste-${Math.random()}`);
    const { manager, session } = await abrirMesa(rede, 'bc');
    const c = entrar(rede, 'bc');
    try {
      await pronto(c);
      c.remote!.dispatch({ type: 'comprar', mao: 'p2-mao' });
      await vi.waitFor(
        () => expect(childrenOf((manager as Manager).getState().pieces, 'p2-mao')).toHaveLength(4),
        FOLGA,
      );
    } finally {
      c.session.close();
      session.close();
    }
  });
});
