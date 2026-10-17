import { describe, expect, it } from 'vitest';
import { childrenOf, viewFor, type Manager } from '@/engine/core';
import { loadImage } from '@/engine/data';
import { loadGame } from './game';

const base = {
  format: 'bqgame/1',
  id: 'teste',
  name: 'Teste',
  kinds: [{ kind: 'k' }],
};

describe('exemplo: baralho comum (.json)', () => {
  it('monta 52 cartas embaralhadas no monte, viradas para baixo', async () => {
    const game = await loadGame({ url: '/exemplos/baralho.json' });
    const m = game.createManager({ players: 1, seed: 7 });
    const monte = childrenOf(m.getState().pieces, 'monte');
    expect(monte).toHaveLength(52);
    expect(monte.every((p) => p.status === 'faceDown')).toBe(true);
    const ordem = monte.map((p) => p.id);
    expect(ordem).not.toEqual([...ordem].sort()); // embaralhou
    expect(game.createManager({ players: 1, seed: 7 }).getState()).toEqual(m.getState());
  });

  it('duplo clique vira; zonas não arrastam; peça mostra os dados dela', async () => {
    const game = await loadGame({ url: '/exemplos/baralho.json' });
    const { manager: m, gestures } = game.createMatch({ players: 1, seed: 1 });
    const carta = childrenOf(m.getState().pieces, 'monte')[0]!;
    const cmd = gestures({ type: 'activate', id: carta.id }, carta, m.getState());
    expect(cmd).toEqual({ type: 'setStatus', id: carta.id, status: 'faceUp' });
    expect(game.canDrag(carta)).toBe(true);
    expect(game.canDrag(m.getState().pieces.monte!)).toBe(false);
    expect(game.dataOf(carta)).toMatchObject({ id: carta.attributes.def });
  });

  it('preview: o modelo é redesenhado com mais resolução; imagens ficam como estão', async () => {
    const game = await loadGame({ url: '/exemplos/baralho.json' });
    expect(game.previewFace('template:carta/copas-Q', 3.2)).toBe('template:carta/copas-Q@4');
    expect(game.previewFace('template:carta/copas-Q', 40)).toBe('template:carta/copas-Q@8');
    expect(game.previewFace('asset:images/verso.png', 4)).toBe('asset:images/verso.png');
    const normal = loadImage('template:carta/copas-Q').image as HTMLCanvasElement;
    const nitida = loadImage('template:carta/copas-Q@4').image as HTMLCanvasElement;
    expect(nitida.width).toBe(normal.width * 2); // padrão 2 → 4
  });

  it('faces desenhadas pelos modelos', async () => {
    await loadGame({ url: '/exemplos/baralho.json' });
    expect(loadImage('template:carta/copas-Q').getStatus()).toBe('loaded');
    expect(loadImage('template:verso').getStatus()).toBe('loaded');
    expect(loadImage('template:carta/nao-existe').getStatus()).toBe('failed');
  });
});

describe('exemplo: mesa com zonas (.bqgame)', () => {
  it('dados do pacote, cópias, prefabs e pirâmide gerada', async () => {
    const game = await loadGame({ url: '/exemplos/mesa-zonas.bqgame' });
    expect(game.data.cartas).toHaveLength(8);
    expect(game.players).toEqual({ min: 1, max: 2 });
    const { pieces } = game.createManager({ players: 2 }).getState();
    expect(childrenOf(pieces, 'baralho')).toHaveLength(3 + 2 + 1 + 3 + 2 + 1 + 3 + 2);
    for (const j of ['ana', 'bia']) {
      expect(childrenOf(pieces, j).map((p) => p.id)).toEqual([
        `${j}-tableau`,
        `${j}-energia`,
        `${j}-mao`,
      ]);
      expect(pieces[`${j}-tableau`]!.zone!.slots).toHaveLength(3 + 4);
      expect(childrenOf(pieces, `${j}-energia`)).toHaveLength(2);
    }
    expect(pieces.ana!.transform).toMatchObject({ x: 260, y: 400, scale: 0.8 });
    // tamanho da zona calculado pelo padrão: 4 cartas de largura + margens
    expect(pieces['ana-tableau']!.size).toEqual({ w: 4 * 80 + 24, h: 112 + 56 + 24 });
  });

  it('imagens do pacote ficam com nome estável no estado', async () => {
    const game = await loadGame({ url: '/exemplos/mesa-zonas.bqgame' });
    const carta = Object.values(game.createManager({ players: 1 }).getState().pieces).find(
      (p) => p.kind === 'carta',
    )!;
    expect(carta.faces.faceDown).toBe('asset:images/verso.svg');
    expect(game.resolveAsset('images/verso.svg')).toMatch(/^blob:/);
  });
});

describe('erros no pacote', () => {
  const load = (manifest: object) => loadGame({ manifest: { ...base, ...manifest } });

  it('setup aponta o passo e o problema', async () => {
    const game = await load({
      setup: [{ pieces: [{ id: 'a', kind: 'k' }] }, { pieces: [{ id: '{nmoe}', kind: 'k' }] }],
    });
    expect(() => game.createManager({ players: 1 })).toThrow(
      'setup[1]: campo desconhecido: {nmoe}',
    );
  });

  it('peça inválida, prefab e dados desconhecidos', async () => {
    const tryLoad = async (setup: object[]) =>
      (await load({ setup })).createManager.bind(null, { players: 1 });
    expect(await tryLoad([{ pieces: [{ id: 'a' }] }])).toThrow(/setup\[0\]: peça "a".*kind/s);
    expect(await tryLoad([{ prefab: 'x' }])).toThrow('setup[0]: prefab desconhecido: "x"');
    expect(await tryLoad([{ forEach: 'y', piece: {} }])).toThrow(
      'setup[0]: conjunto de dados desconhecido: "y"',
    );
    expect(await tryLoad([{ command: { type: 'shuffle', zone: 'z' } }])).toThrow(
      'setup[0]: "z" não é uma zona',
    );
  });

  it('JSON Schema de atributos inválido é acusado ao carregar', async () => {
    await expect(
      load({ kinds: [{ kind: 'k', attributes: { type: 'tipo-que-nao-existe' } }], setup: [] }),
    ).rejects.toThrow('kind "k": attributes não é um JSON Schema válido');
  });

  it('atributos validados pelo JSON Schema', async () => {
    const game = await load({
      kinds: [
        {
          kind: 'k',
          attributes: { type: 'object', properties: { n: { type: 'integer', maximum: 3 } } },
        },
      ],
      setup: [{ pieces: [{ id: 'a', kind: 'k', attributes: { n: 2 } }] }],
    });
    const m = game.createManager({ players: 1 });
    expect(m.dispatch({ type: 'setAttr', id: 'a', key: 'n', value: 5 }).ok).toBe(false);
    expect(m.dispatch({ type: 'setAttr', id: 'a', key: 'n', value: 3 }).ok).toBe(true);
  });
});

describe('exemplo: pirâmide (.bqgame com regras.js)', () => {
  const abrir = async (players = 2) => {
    const game = await loadGame({ url: '/exemplos/piramide.bqgame' });
    return { game, ...game.createMatch({ players, seed: 11 }) };
  };
  const filhos = (m: Manager, zona: string) => childrenOf(m.getState().pieces, zona);

  it('o setup das regras cria um tabuleiro por jogador, com energia e cartas', async () => {
    const { manager: m } = await abrir(2);
    for (const j of ['p1', 'p2']) {
      expect(filhos(m, `${j}-energia`)).toHaveLength(3);
      expect(filhos(m, `${j}-mao`)).toHaveLength(3);
      expect(m.getState().globals[`pontos-${j}`]).toBe(0);
    }
    expect(filhos(m, 'banco')).toHaveLength(30 - 6);
    expect(filhos(m, 'baralho')).toHaveLength(20 - 6);
    expect(m.canUndo()).toBe('nada para desfazer'); // setup não se desfaz
    const solo = await abrir(1);
    expect(solo.manager.getState().pieces.p2).toBeUndefined();
  });

  it('apoios, energia e pontos', async () => {
    const { manager: m } = await abrir(2);
    const [carta] = filhos(m, 'p1-mao');
    const jogar = (slot: string) =>
      m.dispatch({ type: 'dropInto', id: carta!.id, zone: 'p1-tableau', slot });
    expect(jogar('1,1')).toEqual({
      ok: false,
      error: 'faltam cartas de apoio em 0,0 e 0,1',
    });
    expect(jogar('1,0')).toEqual({ ok: false, error: 'faltam cartas de apoio em 0,0' });

    const antes = filhos(m, 'p1-energia').length;
    expect(jogar('0,0').ok).toBe(true);
    const s = m.getState();
    const gasto = antes - childrenOf(s.pieces, 'p1-energia').length;
    expect(childrenOf(s.pieces, 'banco')).toHaveLength(24 + gasto);
    expect(Number(s.globals['pontos-p1'])).toBeGreaterThan(0);
    expect(s.pieces[carta!.id]).toMatchObject({ status: 'faceUp', slot: '0,0' });
    expect(m.dispatch({ type: 'dropInto', id: carta!.id, zone: 'p1-mao' })).toEqual({
      ok: false,
      error: 'cartas no Tableau ficam onde foram jogadas',
    });
  });

  it('carta da mão do outro jogador e energia insuficiente são recusadas', async () => {
    const { manager: m } = await abrir(2);
    const daBia = filhos(m, 'p2-mao')[0]!;
    expect(m.dispatch({ type: 'dropInto', id: daBia.id, zone: 'p1-tableau', slot: '0,0' })).toEqual(
      {
        ok: false,
        error: 'jogue a carta a partir da sua mão',
      },
    );
    // sem energia: devolve as fichas ao banco e tenta jogar uma carta que custa algo
    for (const f of filhos(m, 'p1-energia'))
      m.dispatch({ type: 'dropInto', id: f.id, zone: 'banco' });
    const cara = filhos(m, 'p1-mao').find(
      (c) => !['rascunho', 'ideia'].includes(String(c.attributes.def)),
    );
    if (cara) {
      const r = m.dispatch({ type: 'dropInto', id: cara.id, zone: 'p1-tableau', slot: '0,0' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^energia insuficiente: precisa de \d, tem 0$/);
    }
  });

  it('duplo clique na mão compra (comando composto + gesto das regras)', async () => {
    const { manager: m, gestures } = await abrir(1);
    const mao = m.getState().pieces['p1-mao']!;
    const cmd = gestures({ type: 'activate', id: mao.id }, mao, m.getState());
    expect(cmd).toEqual({ type: 'comprar', mao: 'p1-mao' });
    expect(m.dispatch(cmd!).ok).toBe(true);
    expect(filhos(m, 'p1-mao')).toHaveLength(4);
    // gesto que as regras não tratam segue o padrão do manifest
    const carta = filhos(m, 'baralho')[0]!;
    expect(gestures({ type: 'activate', id: carta.id }, carta, m.getState())).toBeNull();
  });

  it('cada jogador vê a mão do outro virada e não vê a reserva dele', async () => {
    const { manager: m } = await abrir(2);
    const s = m.getState();
    const [carta] = filhos(m, 'p1-mao');
    m.dispatch({ type: 'dropInto', id: carta!.id, zone: 'p1-reserva', actor: 'p1' });
    const daBia = viewFor(m.getState(), 'p2');
    for (const c of childrenOf(m.getState().pieces, 'p1-mao')) {
      expect(daBia.pieces[c.id]).toMatchObject({ status: 'faceDown', attributes: {} });
    }
    expect(daBia.pieces[carta!.id]).toBeUndefined(); // na reserva: escondida
    expect(viewFor(m.getState(), 'p1').pieces[carta!.id]?.attributes.def).toBeDefined();
    expect(s.players.p1).toMatchObject({ name: 'Jogador 1' });
  });

  it('jogador não mexe no tabuleiro do outro nem compra para a mão dele', async () => {
    const { manager: m } = await abrir(2);
    const daAna = filhos(m, 'p1-mao')[0]!;
    expect(
      m.dispatch({ type: 'dropInto', id: daAna.id, zone: null, x: 0, y: 0, actor: 'p2' }),
    ).toEqual({
      ok: false,
      error: `"${daAna.id}" é de Jogador 1`,
    });
    expect(m.dispatch({ type: 'comprar', mao: 'p1-mao', actor: 'p2' })).toEqual({
      ok: false,
      error: 'compre só para a sua mão',
    });
    expect(m.dispatch({ type: 'comprar', mao: 'p2-mao', actor: 'p2' }).ok).toBe(true);
  });
});

describe('regras.js com erro', () => {
  const comRegras = (code: string) => {
    const manifest = {
      ...base,
      rules: 'data:text/javascript,' + encodeURIComponent(code),
      setup: [{ pieces: [{ id: 'a', kind: 'k' }] }],
    };
    return loadGame({ manifest });
  };

  it('erro de sintaxe aparece ao carregar, com o nome do arquivo', async () => {
    await expect(comRegras('game.rule({')).rejects.toThrow(/^data:text\/javascript.*: /);
  });

  it('erro ao rodar as regras aparece ao começar a partida', async () => {
    const game = await comRegras('throw new Error("ops")');
    expect(() => game.createMatch({ players: 1 })).toThrow(/: ops$/);
  });

  it('regra com bug recusa a jogada, sem quebrar', async () => {
    const game = await comRegras(
      'game.rule({ id: "bug", validate() { return undefinedVariable; } })',
    );
    const { manager: m } = game.createMatch({ players: 1 });
    const r = m.dispatch({ type: 'move', id: 'a', x: 1, y: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^regra "bug" falhou: undefinedVariable is not defined/);
  });
});
