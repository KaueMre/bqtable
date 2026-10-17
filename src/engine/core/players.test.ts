import { describe, expect, it } from 'vitest';
import { createManager, type Manager } from './manager';
import { spawn } from './prefab';
import { contentsHidden, viewFor } from './visibility';
import { childrenOf, ownerOf } from './zones';

/** Mesa com dois tabuleiros (Ana e Bia), cada um com mão virada e reserva escondida. */
function setup(): Manager {
  const m = createManager({
    seed: 1,
    players: [{ id: 'ana', name: 'Ana' }, { id: 'bia', name: 'Bia' }, 'caio'],
  });
  m.registerKind({ kind: 'zona' });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: { faces: { faceDown: 'verso.png', faceUp: 'frente.png' } },
  });
  m.registerKind({ kind: 'meeple' });
  const tabuleiro = (id: string) => [
    { id, kind: 'zona', owner: id, zone: { layout: 'free' as const } },
    {
      id: `${id}-mao`,
      kind: 'zona',
      parentId: id,
      zone: { layout: 'fan' as const, privacy: 'faceDown' as const },
    },
    {
      id: `${id}-reserva`,
      kind: 'zona',
      parentId: id,
      zone: { layout: 'stack' as const, privacy: 'hidden' as const },
    },
    {
      id: `${id}-c1`,
      kind: 'carta',
      status: 'faceUp',
      parentId: `${id}-mao`,
      attributes: { def: 'T07' },
      tags: ['mindset'],
    },
    { id: `${id}-segredo`, kind: 'carta', parentId: `${id}-reserva` },
  ];
  const r = m.dispatch(
    spawn([
      ...tabuleiro('ana'),
      ...tabuleiro('bia'),
      { id: 'mapa', kind: 'zona', zone: { layout: 'free' } },
      { id: 'meeple-ana', kind: 'meeple', owner: 'ana', parentId: 'mapa' },
      { id: 'troca', kind: 'zona', owner: 'bia', zone: { layout: 'stack', openToOthers: true } },
      { id: 'solta', kind: 'carta' },
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

describe('jogadores e vez', () => {
  it('nomes, cores, ordem; o primeiro começa', () => {
    const s = setup().getState();
    expect(s.playerOrder).toEqual(['ana', 'bia', 'caio']);
    expect(s.activePlayer).toBe('ana');
    expect(s.players.caio).toMatchObject({ name: 'Jogador 3', attributes: {} });
    expect(s.players.ana!.color).not.toBe(s.players.bia!.color);
  });

  it('passar a vez segue a ordem e volta ao primeiro; só quem está na vez passa', () => {
    const m = setup();
    expect(m.dispatch({ type: 'nextPlayer', actor: 'bia' })).toEqual({
      ok: false,
      error: 'não é a vez de Bia',
    });
    for (const esperado of ['bia', 'caio', 'ana']) {
      const atual = m.getState().activePlayer!;
      expect(m.dispatch({ type: 'nextPlayer', actor: atual }).ok).toBe(true);
      expect(m.getState().activePlayer).toBe(esperado);
    }
    m.dispatch({ type: 'setActivePlayer', player: 'caio' });
    expect(m.getState().activePlayer).toBe('caio');
    expect(m.dispatch({ type: 'setActivePlayer', player: 'zé' }).ok).toBe(false);
  });

  it('o log guarda quem fez a jogada', () => {
    const m = setup();
    m.dispatch({ type: 'move', id: 'solta', x: 5, y: 5, actor: 'ana' });
    expect(m.getState().log.at(-1)).toMatchObject({ actor: 'ana', event: { type: 'pieceMoved' } });
  });
});

describe('dono', () => {
  it('o dono efetivo vem da zona mais próxima', () => {
    const { pieces } = setup().getState();
    expect(ownerOf(pieces, 'ana-c1')).toBe('ana'); // carta sem dono, na mão da Ana
    expect(ownerOf(pieces, 'meeple-ana')).toBe('ana'); // dono próprio, no mapa público
    expect(ownerOf(pieces, 'solta')).toBeUndefined();
  });

  it('jogador não mexe no que é de outro, nem solta na área dele', () => {
    const m = setup();
    expect(
      m.dispatch({ type: 'dropInto', id: 'ana-c1', zone: null, x: 0, y: 0, actor: 'bia' }),
    ).toEqual({
      ok: false,
      error: '"ana-c1" é de Ana',
    });
    expect(m.dispatch({ type: 'move', id: 'meeple-ana', x: 1, y: 1, actor: 'bia' }).ok).toBe(false);
    expect(m.dispatch({ type: 'dropInto', id: 'solta', zone: 'ana-mao', actor: 'bia' })).toEqual({
      ok: false,
      error: 'área de Ana',
    });
    expect(m.dispatch({ type: 'shuffle', zone: 'ana-reserva', actor: 'bia' }).ok).toBe(false);
    expect(
      m.dispatch({ type: 'setPlayerAttr', player: 'ana', key: 'foco', value: 9, actor: 'bia' }).ok,
    ).toBe(false);
  });

  it('o dono mexe; peça sem dono qualquer um; zona aberta aceita de outros', () => {
    const m = setup();
    expect(m.dispatch({ type: 'move', id: 'meeple-ana', x: 1, y: 1, actor: 'ana' }).ok).toBe(true);
    expect(m.dispatch({ type: 'dropInto', id: 'solta', zone: 'ana-mao', actor: 'ana' }).ok).toBe(
      true,
    );
    expect(m.dispatch({ type: 'dropInto', id: 'ana-c1', zone: 'troca', actor: 'ana' }).ok).toBe(
      true,
    );
    // agora a carta está na zona da Bia: só a Bia mexe nela
    expect(m.dispatch({ type: 'dropInto', id: 'ana-c1', zone: 'ana-mao', actor: 'ana' }).ok).toBe(
      false,
    );
  });

  it('regras e setup (sem actor) mexem em tudo; lote leva o actor', () => {
    const m = setup();
    expect(m.dispatch({ type: 'dropInto', id: 'ana-c1', zone: 'bia-mao' }).ok).toBe(true);
    const r = m.dispatch({
      type: 'batch',
      actor: 'ana',
      commands: [
        { type: 'move', id: 'solta', x: 1, y: 1 },
        { type: 'move', id: 'meeple-ana', x: 2, y: 2 },
      ],
    });
    expect(r.ok).toBe(true);
    const outro = m.dispatch({
      type: 'batch',
      actor: 'bia',
      commands: [{ type: 'move', id: 'meeple-ana', x: 3, y: 3 }],
    });
    expect(outro).toEqual({ ok: false, error: '"meeple-ana" é de Ana' });
  });
});

describe('viewFor', () => {
  it('o dono vê tudo', () => {
    const s = setup().getState();
    const v = viewFor(s, 'ana');
    expect(v.pieces['ana-c1']).toBe(s.pieces['ana-c1']);
    expect(v.pieces['ana-segredo']).toBe(s.pieces['ana-segredo']);
  });

  it('mão (faceDown): os outros veem o verso, sem dados', () => {
    const s = setup().getState();
    const v = viewFor(s, 'bia');
    expect(v.faceDown.has('ana-c1')).toBe(true);
    expect(v.pieces['ana-c1']).toMatchObject({
      status: 'faceDown',
      faces: { faceDown: 'verso.png' },
      attributes: {},
      tags: [],
      parentId: 'ana-mao',
    });
  });

  it('reserva (hidden): os outros não veem nada', () => {
    const s = setup().getState();
    const v = viewFor(s, 'bia');
    expect(v.hidden.has('ana-segredo')).toBe(true);
    expect(v.pieces['ana-segredo']).toBeUndefined();
    expect(childrenOf(v.pieces, 'ana-reserva')).toEqual([]);
    expect(v.pieces['ana-reserva']).toBeDefined(); // a zona aparece; o conteúdo não
  });

  it('espectador não vê nenhuma área privada; nada privado = mesmo objeto de peças', () => {
    const s = setup().getState();
    const v = viewFor(s, null);
    expect(v.faceDown.has('ana-c1') && v.faceDown.has('bia-c1')).toBe(true);
    expect(v.hidden.has('ana-segredo') && v.hidden.has('bia-segredo')).toBe(true);
    const publico = createManager({ seed: 1 });
    expect(viewFor(publico.getState(), null).pieces).toBe(publico.getState().pieces);
  });

  it('mesmo estado e mesmo jogador → mesma visão (para a tela)', () => {
    const s = setup().getState();
    expect(viewFor(s, 'bia')).toBe(viewFor(s, 'bia'));
    expect(viewFor(s, 'bia').pieces['ana-c1']).toBe(viewFor(s, 'caio').pieces['ana-c1']);
  });

  it('hiddenStatuses: carta virada fora de área privada fica virada para todos', () => {
    const m = createManager({ seed: 1, players: ['ana'] });
    m.registerKind({ kind: 'zona' });
    m.registerKind({
      kind: 'carta',
      statuses: ['faceDown', 'faceUp'],
      hiddenStatuses: ['faceDown'],
      defaults: { faces: { faceDown: 'verso.png', faceUp: 'frente.png' } },
    });
    m.dispatch(
      spawn([
        { id: 'deck', kind: 'zona', owner: 'ana', zone: { layout: 'stack' } },
        { id: 'c1', kind: 'carta', parentId: 'deck', attributes: { def: 'T07' } },
        { id: 'c2', kind: 'carta', status: 'faceUp', attributes: { def: 'T08' } },
      ]),
    );
    const view = viewFor(m.getState(), 'ana', m.kinds); // nem o dono do deck vê
    expect(view.faceDown.has('c1')).toBe(true);
    expect(view.pieces.c1).toMatchObject({
      status: 'faceDown',
      attributes: {},
      faces: { faceDown: 'verso.png' },
    });
    expect(view.pieces.c2!.attributes).toEqual({ def: 'T08' });
    expect(viewFor(m.getState(), 'ana').faceDown.has('c1')).toBe(false); // sem kinds: só privacy
    m.dispatch({ type: 'setStatus', id: 'c1', status: 'faceUp' });
    expect(viewFor(m.getState(), 'ana', m.kinds).pieces.c1!.attributes).toEqual({ def: 'T07' });
  });

  it('contentsHidden: o painel sabe o que não pode contar', () => {
    const { pieces } = setup().getState();
    expect(contentsHidden(pieces, 'ana-reserva', 'bia')).toBe(true);
    expect(contentsHidden(pieces, 'ana-reserva', 'ana')).toBe(false);
    expect(contentsHidden(pieces, 'ana-mao', 'bia')).toBe(false); // virada: dá para contar
    expect(contentsHidden(pieces, 'mapa', null)).toBe(false);
  });
});
