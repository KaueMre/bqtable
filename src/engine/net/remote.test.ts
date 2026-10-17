import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { childrenOf, type Command, type GameEvent, type GameState } from '@/engine/core';
import type { LoadedGame } from '@/engine/package/game';
import { loadGameFolder } from '@/engine/testing';
import { applyFrom, redactFor } from './redact';
import { createRemoteManager, HOST_ONLY, type RemoteManager } from './remote';

const pasta = fileURLToPath(new URL('../../../examples/piramide', import.meta.url));

let game: LoadedGame;
beforeAll(async () => {
  game = await loadGameFolder(pasta);
});

/** Host com a partida de verdade e um convidado por assento, ligados por função (sem rede). */
function mesa() {
  const host = game.createManager({ players: 2, seed: 3 });
  const kinds = game.createManager({ players: 2, seed: 0 }).kinds; // o convidado tem o pacote
  const recusas: Record<string, string[]> = { p1: [], p2: [] };
  const guests: Record<string, RemoteManager> = {};
  const publicar = () => {
    for (const [seat, g] of Object.entries(guests)) {
      g.setState(redactFor(host.getState(), seat, host.kinds));
    }
  };
  for (const seat of ['p1', 'p2']) {
    const g = createRemoteManager(
      (cmd) => {
        const r = applyFrom(host, seat, cmd);
        if (!r.ok) g.reject(r.error);
      },
      { kinds },
    );
    g.onReject((motivo) => recusas[seat]!.push(motivo));
    guests[seat] = g;
  }
  host.subscribe(publicar);
  publicar();
  return { host, p1: guests.p1!, p2: guests.p2!, recusas };
}

/** Ids reais das cartas que `seat` não pode ver (mão do outro, reservas, deck virado). */
function segredos(host: GameState, outro: string): string[] {
  const { pieces } = host;
  return [
    ...childrenOf(pieces, `${outro}-mao`),
    ...childrenOf(pieces, `${outro}-reserva`),
    ...childrenOf(pieces, 'baralho'),
  ].map((p) => p.id);
}

/** Nenhum id escondido aparece no estado do convidado (peças, log, escolha pendente). */
function expectSemSegredos(visto: GameState, ids: string[]) {
  const json = JSON.stringify(visto);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(json).not.toContain(`"${id}"`);
}

describe('host e dois convidados, sem rede (pirâmide)', () => {
  it('começam com o estado de cada um; o p1 não vê a mão do p2', () => {
    const { host, p1, p2 } = mesa();
    expect(p1.getState()).toEqual(redactFor(host.getState(), 'p1', host.kinds));
    expect(p2.getState()).toEqual(redactFor(host.getState(), 'p2', host.kinds));
    expect(childrenOf(p1.getState().pieces, 'p1-mao').every((c) => c.attributes.def)).toBe(true);
    const daOutra = childrenOf(p1.getState().pieces, 'p2-mao');
    expect(daOutra).toHaveLength(3); // dá para contar
    expect(daOutra.every((c) => c.status === 'faceDown' && !c.attributes.def)).toBe(true);
    expectSemSegredos(p1.getState(), segredos(host.getState(), 'p2'));
    expectSemSegredos(p2.getState(), segredos(host.getState(), 'p1'));
  });

  it('comprar e embaralhar: os estados convergem e nada escondido vaza', () => {
    const { host, p1, p2 } = mesa();
    const eventos: GameEvent[][] = [];
    p2.subscribe((_, evs) => eventos.push(evs));

    p2.dispatch({ type: 'comprar', mao: 'p2-mao' });
    p1.dispatch({ type: 'shuffle', zone: 'baralho' });
    p1.dispatch({ type: 'comprar', mao: 'p1-mao' });

    const s = host.getState();
    expect(childrenOf(s.pieces, 'p2-mao')).toHaveLength(4);
    expect(childrenOf(s.pieces, 'p1-mao')).toHaveLength(4);
    expect(p1.getState()).toEqual(redactFor(s, 'p1', host.kinds));
    expect(p2.getState()).toEqual(redactFor(s, 'p2', host.kinds));
    // o que é público é igual para os dois
    const publico = (g: GameState) => ({
      seq: g.seq,
      globals: g.globals,
      activePlayer: g.activePlayer,
      baralho: childrenOf(g.pieces, 'baralho').length,
    });
    expect(publico(p1.getState())).toEqual(publico(p2.getState()));
    expectSemSegredos(p1.getState(), segredos(s, 'p2'));
    expectSemSegredos(p2.getState(), segredos(s, 'p1'));
    // o p2 viu a própria compra nos eventos, mas não a do p1
    const comprada = childrenOf(s.pieces, 'p2-mao').at(-1)!.id;
    expect(JSON.stringify(eventos[0])).toContain(`"${comprada}"`);
    expect(eventos.flat().some((e) => e.type === 'zoneShuffled')).toBe(false);
  });

  it('a carta jogada no Tableau aparece para os dois', () => {
    const { host, p1, p2 } = mesa();
    const custo = (def: unknown) => Number(game.data.cartas!.find((c) => c.id === def)!.custo);
    const carta = childrenOf(p1.getState().pieces, 'p1-mao').find(
      (c) => custo(c.attributes.def) <= 3,
    )!;
    p1.dispatch({ type: 'dropInto', id: carta.id, zone: 'p1-tableau', slot: '0,0' });
    expect(host.getState().pieces[carta.id]!.parentId).toBe('p1-tableau');
    expect(p2.getState().pieces[carta.id]!.attributes).toEqual(carta.attributes);
    expect(p2.getState().globals['pontos-p1']).toBeGreaterThan(0);
  });

  it('o convidado pega a carta do topo pelo apelido', () => {
    const { host, p1 } = mesa();
    const topo = childrenOf(p1.getState().pieces, 'baralho').at(-1)!;
    expect(topo.id).toMatch(/^baralho~/);
    const real = childrenOf(host.getState().pieces, 'baralho').at(-1)!.id;
    p1.dispatch({ type: 'dropInto', id: topo.id, zone: 'p1-mao' });
    expect(host.getState().pieces[real]!.parentId).toBe('p1-mao');
    expect(p1.getState().pieces[real]!.status).toBe('faceUp'); // na própria mão, ele vê
  });
});

describe('recusas', () => {
  it('comando recusado pelo host chega como recusa, e o estado não muda', () => {
    const { host, p1, recusas } = mesa();
    const antes = host.getState();
    expect(p1.dispatch({ type: 'comprar', mao: 'p2-mao' })).toEqual({ ok: true, value: [] });
    expect(recusas.p1).toEqual(['compre só para a sua mão']);
    expect(host.getState()).toBe(antes);
  });

  it('actor forjado é trocado pelo assento', () => {
    const { host, p1, recusas } = mesa();
    const forjado: Command = { type: 'comprar', mao: 'p2-mao', actor: 'p2' };
    p1.dispatch(forjado);
    expect(recusas.p1).toEqual(['compre só para a sua mão']);
    expect(childrenOf(host.getState().pieces, 'p2-mao')).toHaveLength(3);
  });

  it('desfazer e registrar são do host', () => {
    const { p1 } = mesa();
    expect(p1.check({ type: 'qualquer' })).toBe(true);
    expect(p1.undo()).toEqual({ ok: false, error: HOST_ONLY });
    expect(p1.canUndo()).toBe(HOST_ONLY);
    expect(() => p1.registerRule({ id: 'x' })).toThrow(HOST_ONLY);
    expect(() => p1.registerKind({ kind: 'x' })).toThrow(HOST_ONLY);
    expect(() => p1.clearHistory()).toThrow(HOST_ONLY);
  });

  it('desfazer no host: o convidado recebe o estado anterior, sem eventos', () => {
    const { host, p1 } = mesa();
    const antes = p1.getState();
    p1.dispatch({ type: 'comprar', mao: 'p1-mao' });
    const avisos: GameEvent[][] = [];
    p1.subscribe((_, evs) => avisos.push(evs));
    expect(host.undo().ok).toBe(true);
    expect(p1.getState()).toEqual(antes);
    expect(avisos).toEqual([[]]);
  });
});
