import { describe, expect, it } from 'vitest';
import { childrenOf, type Manager } from '@/engine/core';
import { loadGame } from './game';

/** Manifest de setups: Stage escolhido antes da partida, famílias sorteadas, mão inicial. */
const manifest = {
  format: 'bqgame/1',
  id: 'setups',
  name: 'Setups',
  players: {
    min: 1,
    max: 3,
    names: ['Ana', 'Bia', 'Caio'],
    seats: {
      '1': [{ x: 0, y: 500 }],
      '2': [
        { x: -300, y: 500 },
        { x: 300, y: 500, rotation: 0, lado: 'direita' },
      ],
      '3': [
        { x: 0, y: 500 },
        { x: 500, y: 0, rotation: 270 },
        { x: -500, y: 0, rotation: 90 },
      ],
    },
  },
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
  kinds: [
    { kind: 'zona' },
    { kind: 'carta', statuses: ['faceDown', 'faceUp'] },
    { kind: 'eterno' },
  ],
  data: {
    eternos: [
      { id: 'phoenix', familia: 'A', ordem: 1 },
      { id: 'mermaid', familia: 'A', ordem: 2 },
      { id: 'king', familia: 'A', ordem: 3 },
      { id: 'dragon', familia: 'A', ordem: 4 },
      { id: 'ghost', familia: 'B', ordem: 1 },
      { id: 'witch', familia: 'B', ordem: 2 },
    ],
    cartas: Array.from({ length: 12 }, (_, i) => ({ id: `n${i + 1}` })),
  },
  prefabs: {
    tabuleiro: {
      pieces: [
        {
          id: '{player}',
          kind: 'zona',
          owner: '{player}',
          transform: { x: '{seat.x}', y: '{seat.y}', rotation: '{seat.rotation|default:0}' },
          zone: { layout: 'free' },
        },
        { id: '{player}-mao', kind: 'zona', parentId: '{player}', zone: { layout: 'fan' } },
        {
          id: '{player}-campo',
          kind: 'zona',
          parentId: '{player}',
          zone: { layout: 'grid', grid: { cols: 2, rows: 1, cell: { w: 10, h: 10 } } },
        },
      ],
    },
  },
  setup: [
    { pieces: [{ id: 'linha', kind: 'zona', zone: { layout: 'stack' } }] },
    { pieces: [{ id: 'baralho', kind: 'zona', zone: { layout: 'stack' } }] },
    // Stage A: 3 dos 4 eternos da família A, sorteados; Stage B: todos os da B, em ordem
    {
      when: { options: { stage: 'A' } },
      forEach: 'eternos',
      where: { familia: '{options.stage}' },
      pick: 3,
      piece: { id: '{id}', kind: 'eterno', parentId: 'linha' },
    },
    {
      when: { options: { stage: 'B' } },
      forEach: 'eternos',
      where: { familia: '{options.stage}' },
      piece: { id: '{id}', kind: 'eterno', parentId: 'linha' },
    },
    {
      when: { options: { nivel: 'dificil' } },
      command: { type: 'setGlobal', key: 'vidas', value: 1 },
    },
    {
      when: { options: { nivel: ['facil'] } },
      command: { type: 'setGlobal', key: 'vidas', value: 3 },
    },
    {
      forEach: 'cartas',
      piece: { id: '{id}', kind: 'carta', status: 'faceDown', parentId: 'baralho' },
    },
    { command: { type: 'shuffle', zone: 'baralho' } },
    // solo: dois Golems extras
    {
      when: { players: 1 },
      command: { type: 'addPlayer', id: 'beta', name: 'Beta' },
    },
    {
      when: { players: { max: 1 } },
      command: { type: 'addPlayer', id: 'gamma', name: 'Gamma' },
    },
    { forEachPlayer: true, prefab: 'tabuleiro' },
    {
      forEachPlayer: true,
      deal: { from: 'baralho', to: '{player}-mao', count: 2, status: 'faceUp' },
    },
    { when: { players: [2, 3] }, deal: { from: 'baralho', to: 'p1-campo', count: 2 } },
    {
      forEachPlayer: true,
      command: {
        type: 'setPlayerAttr',
        player: '{player}',
        key: 'lugar',
        value: '{seat.lado|default:-}',
      },
    },
  ],
};

const open = async () => loadGame({ manifest });
const ids = (m: Manager, zone: string) => childrenOf(m.getState().pieces, zone).map((p) => p.id);

describe('setup: opções da partida', () => {
  it('padrões: a primeira escolha, ou `default`', async () => {
    const game = await open();
    expect(game.options.map((o) => o.id)).toEqual(['stage', 'nivel']);
    const m = game.createManager({ players: 2, seed: 1 });
    expect(m.getState().globals.vidas).toBe(1); // nivel: dificil (default)
    expect(ids(m, 'linha')).toHaveLength(3); // stage: A (primeira)
  });

  it('`when` por opção; `where` com {options.x}; o regras.js recebe game.options', async () => {
    const game = await open();
    const m = game.createManager({ players: 2, seed: 1, options: { stage: 'B', nivel: 'facil' } });
    expect(ids(m, 'linha')).toEqual(['ghost', 'witch']);
    expect(m.getState().globals.vidas).toBe(3);
    const regras = `game.setup(({ dispatch }) =>
      dispatch({ type: 'setGlobal', key: 'stage', value: game.options.stage }));`;
    const comRegras = await loadGame({
      manifest: { ...manifest, rules: 'data:text/javascript,' + encodeURIComponent(regras) },
    });
    const s = comRegras.createManager({ players: 1, options: { stage: 'B' } }).getState();
    expect(s.globals.stage).toBe('B');
  });

  it('opção desconhecida ou valor fora das escolhas é recusado', async () => {
    const game = await open();
    expect(() => game.createManager({ players: 1, options: { modo: 'x' } })).toThrow(
      'opção desconhecida: "modo"',
    );
    expect(() => game.createManager({ players: 1, options: { stage: 'Z' } })).toThrow(
      'opção "stage": "Z" não é uma das escolhas',
    );
  });

  it('`when` com opção ou valor inexistente é acusado ao abrir o jogo', async () => {
    const setup = (when: object) => [{ when, command: { type: 'setGlobal', key: 'x', value: 1 } }];
    await expect(
      loadGame({ manifest: { ...manifest, setup: setup({ options: { stg: 'A' } }) } }),
    ).rejects.toThrow('setup[0].when: opção desconhecida "stg"');
    await expect(
      loadGame({ manifest: { ...manifest, setup: setup({ options: { stage: ['A', 'C'] } }) } }),
    ).rejects.toThrow('setup[0].when: "C" não é uma escolha da opção "stage"');
  });
});

describe('setup: sorteio de cartas abertas (`pick`)', () => {
  it('sorteia N dos itens filtrados, com a semente da partida', async () => {
    const game = await open();
    const linhas = [1, 2, 3, 4, 5, 6].map((seed) =>
      ids(game.createManager({ players: 1, seed }), 'linha'),
    );
    for (const linha of linhas) {
      expect(linha).toHaveLength(3);
      expect(linha.every((id) => ['phoenix', 'mermaid', 'king', 'dragon'].includes(id))).toBe(true);
    }
    expect(new Set(linhas.map((l) => l.join())).size).toBeGreaterThan(1); // varia com a semente
    expect(ids(game.createManager({ players: 1, seed: 4 }), 'linha')).toEqual(linhas[3]); // e repete
  });

  it('pedir mais do que há é erro do pacote', async () => {
    const game = await loadGame({
      manifest: {
        ...manifest,
        setup: [
          { pieces: [{ id: 'linha', kind: 'zona', zone: { layout: 'stack' } }] },
          {
            forEach: 'eternos',
            where: { familia: 'B' },
            pick: 3,
            piece: { id: '{id}', kind: 'eterno' },
          },
        ],
      },
    });
    expect(() => game.createManager({ players: 1 })).toThrow(
      'setup[1]: pick: 3 itens pedidos, mas só há 2',
    );
  });
});

describe('setup: por número de jogadores', () => {
  it('um tabuleiro por jogador, no lugar do número de jogadores', async () => {
    const game = await open();
    const { pieces } = game.createManager({ players: 3, seed: 1 }).getState();
    expect(pieces.p1!.transform).toMatchObject({ x: 0, y: 500, rotation: 0 });
    expect(pieces.p2!.transform).toMatchObject({ x: 500, y: 0, rotation: 270 });
    expect(pieces.p3!.transform).toMatchObject({ x: -500, y: 0, rotation: 90 });
    expect(pieces.p3!.owner).toBe('p3');
  });

  it('campos extras do lugar e dados do jogador no escopo', async () => {
    const m = (await open()).createManager({ players: 2, seed: 1 });
    expect(m.getState().players.p2!.attributes.lugar).toBe('direita');
    expect(m.getState().players.p1!.attributes.lugar).toBe('-');
  });

  it('deal: mão inicial de cada jogador, do topo do baralho, já virada', async () => {
    const game = await open();
    const m = game.createManager({ players: 2, seed: 3 });
    const { pieces } = m.getState();
    expect(ids(m, 'p1-mao')).toHaveLength(2);
    expect(ids(m, 'p2-mao')).toHaveLength(2);
    expect(ids(m, 'baralho')).toHaveLength(12 - 4 - 2);
    expect(childrenOf(pieces, 'p1-mao').every((p) => p.status === 'faceUp')).toBe(true);
    // grade: cada carta no próximo lugar livre
    expect(childrenOf(pieces, 'p1-campo').map((p) => p.slot)).toEqual(['0,0', '1,0']);
    // a mesma semente sem os deals: o topo do baralho foi para a mão do p1, uma a uma
    // (a do topo entra primeiro e fica embaixo)
    const antes = (
      await loadGame({
        manifest: { ...manifest, setup: manifest.setup.slice(0, 8) },
      })
    ).createManager({ players: 2, seed: 3 });
    expect(ids(m, 'p1-mao')).toEqual(ids(antes, 'baralho').slice(-2).reverse());
  });

  it('solo: jogadores extras com addPlayer, cada um com seu tabuleiro', async () => {
    const game = await open();
    const m = game.createManager({ players: 1, seed: 1 });
    const s = m.getState();
    expect(s.playerOrder).toEqual(['p1', 'beta', 'gamma']);
    expect(s.players.beta!.name).toBe('Beta');
    expect(s.pieces.gamma!.owner).toBe('gamma');
    // seats de "3": o lugar segue quantos jogadores há no momento (com os extras)
    expect(s.pieces.gamma!.transform).toMatchObject({ x: -500, y: 0 });
    expect(ids(m, 'gamma-mao')).toHaveLength(2);
  });

  it('falta lugar para o número de jogadores', async () => {
    const game = await loadGame({
      manifest: { ...manifest, players: { ...manifest.players, seats: { '1': [{ x: 0, y: 0 }] } } },
    });
    expect(() => game.createManager({ players: 2 })).toThrow(
      'players.seats não tem lugar para o jogador 1 com 2 jogadores',
    );
  });

  it('nomes e cores por número de jogadores (como os lugares)', async () => {
    const game = await loadGame({
      manifest: {
        ...manifest,
        players: {
          ...manifest.players,
          names: { '1': ['Alpha'], '2': ['Ana', 'Bia'] },
          colors: { '2': ['#cf222e', '#0969da'] },
        },
      },
    });
    const solo = game.createManager({ players: 1, seed: 1 }).getState();
    expect(solo.players.p1!.name).toBe('Alpha');
    const dupla = game.createManager({ players: 2, seed: 1 }).getState();
    expect([dupla.players.p1!.name, dupla.players.p2!.name]).toEqual(['Ana', 'Bia']);
    expect(dupla.players.p2!.color).toBe('#0969da');
    const trio = game.createManager({ players: 3, seed: 1 }).getState();
    expect(trio.players.p3!.name).toBe('Jogador 3'); // sem lista para 3: o padrão
  });

  it('addPlayer não é jogada da tela', async () => {
    const m = (await open()).createManager({ players: 2, seed: 1 });
    expect(m.dispatch({ type: 'addPlayer', id: 'x', actor: 'p1' })).toEqual({
      ok: false,
      error: 'só o jogo adiciona jogadores',
    });
    expect(m.dispatch({ type: 'addPlayer', id: 'p1' }).ok).toBe(false);
  });
});
