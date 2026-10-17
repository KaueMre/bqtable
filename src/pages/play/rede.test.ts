import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { childrenOf, type GameState } from '@/engine/core';
import { applyFrom, statesFor } from '@/engine/net';
import { loadGame } from '@/engine/package/game';
import type { NetIn } from '@/frame/protocol';
import {
  abrirMesa,
  createFrameLink,
  entrarNaMesa,
  linkDaSala,
  type Conectado,
  type Entrada,
} from './rede';

/** Folga para esperar a rede (a máquina pode estar ocupada com outras coisas). */
const FOLGA = { timeout: 5000 };

describe('createFrameLink', () => {
  it('guarda o que chega antes do iframe (do estado, só o último) e o que sai antes da rede', () => {
    const link = createFrameLink();
    const estado = (seq: number) => ({ kind: 'state', state: { seq } as GameState }) as NetIn;
    link.push(estado(1));
    link.push({ kind: 'rejected', reason: 'x' });
    link.push(estado(2));
    const entregues: NetIn[] = [];
    const desligar = link.connect((m) => entregues.push(m));
    expect(entregues).toEqual([estado(2), { kind: 'rejected', reason: 'x' }]);
    desligar();
    link.out({ kind: 'cmd', cmd: { type: 'a' } });
    const saidas: unknown[] = [];
    link.handle((m) => saidas.push(m));
    expect(saidas).toEqual([{ kind: 'cmd', cmd: { type: 'a' } }]);
  });

  it('o link da sala', () => {
    expect(linkDaSala('abc', 'p2p', 'https://x.dev')).toBe('https://x.dev/jogar?sala=abc');
    expect(linkDaSala('abc', 'abas', 'https://x.dev')).toBe(
      'https://x.dev/jogar?sala=abc&rede=abas',
    );
  });
});

describe('abrirMesa e entrarNaMesa (duas abas, sem iframe)', () => {
  it('o convidado recebe o pacote e o estado, e o comando dele vale no host', async () => {
    const arquivo = await readFile(
      join(import.meta.dirname, '../../../public/exemplos/piramide.bqgame'),
    );
    const bytes = new Uint8Array(arquivo);
    const sala = `teste${Math.random().toString(36).slice(2)}`;

    // host: a partida que estaria no iframe, ligada ao link
    const manager = (await loadGame({ bytes })).createManager({ players: 2, seed: 2 });
    const hostLink = createFrameLink();
    hostLink.connect((m) => {
      if (m.kind === 'cmd') applyFrom(manager, m.seat, m.cmd);
    });
    const conectados: Conectado[][] = [];
    const mesa = abrirMesa({
      sala,
      rede: 'abas',
      link: hostLink,
      pacote: { nome: 'piramide.bqgame', bytes },
      onGuests: (g) => conectados.push(g),
      onReady: () => {},
      onError: (e) => {
        throw new Error(e);
      },
    });
    const publicar = () =>
      hostLink.out({ kind: 'states', states: statesFor(manager, ['p1', 'p2']), options: {} });
    manager.subscribe(publicar);
    publicar();

    // convidado
    const guestLink = createFrameLink();
    const estados: GameState[] = [];
    guestLink.connect((m) => {
      if (m.kind === 'state') estados.push(m.state);
    });
    let entrada: Entrada = {};
    const conexao = entrarNaMesa({
      sala,
      rede: 'abas',
      link: guestLink,
      onChange: (e) => (entrada = e),
    });
    try {
      await vi.waitFor(() => expect(entrada.bytes).toBeDefined(), FOLGA);
      expect(entrada).toMatchObject({
        conectado: true,
        seat: 'p2',
        pacote: { nome: 'piramide.bqgame', tamanho: bytes.byteLength },
        partida: { jogadores: 2, opcoes: {} },
        progresso: 100,
      });
      expect(new Uint8Array(entrada.bytes!)).toEqual(bytes);
      await vi.waitFor(() => expect(estados.length).toBeGreaterThan(0), FOLGA);
      expect(conectados.at(-1)).toEqual([
        expect.objectContaining({ seat: 'p2', nome: 'Jogador 2' }),
      ]);

      guestLink.out({ kind: 'cmd', cmd: { type: 'comprar', mao: 'p2-mao' } });
      await vi.waitFor(
        () => expect(childrenOf(estados.at(-1)!.pieces, 'p2-mao')).toHaveLength(4),
        FOLGA,
      );
      expect(childrenOf(manager.getState().pieces, 'p2-mao')).toHaveLength(4);
    } finally {
      conexao.close();
      mesa.close();
    }
  });
});
