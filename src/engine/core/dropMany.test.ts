import { describe, expect, it } from 'vitest';
import { isCommand, type Command } from './commands';
import { isEvent, type GameEvent } from './events';
import { createManager, type Manager } from './manager';
import { spawn } from './prefab';
import { childrenOf } from './zones';

function setup(): Manager {
  const m = createManager({ seed: 1, players: ['p1', 'p2'] });
  m.registerKind({ kind: 'zona' });
  m.registerKind({ kind: 'carta', statuses: ['faceDown', 'faceUp'] });
  m.registerKind({ kind: 'ficha' });
  const r = m.dispatch(
    spawn([
      {
        id: 'deck',
        kind: 'zona',
        zone: { layout: 'stack', statusOnEnter: 'faceDown', rotationOnEnter: 0 },
      },
      { id: 'mao', kind: 'zona', owner: 'p1', zone: { layout: 'fan' } },
      { id: 'fila', kind: 'zona', zone: { layout: 'row', row: { gap: 4 } } },
      {
        id: 'grade',
        kind: 'zona',
        zone: { layout: 'grid', grid: { cols: 3, rows: 1, cell: { w: 10, h: 10 } } },
      },
      {
        id: 'banco',
        kind: 'zona',
        zone: {
          layout: 'grid',
          autoFill: true,
          grid: { cols: 4, rows: 1, cell: { w: 10, h: 10 } },
        },
      },
      { id: 'area', kind: 'zona', zone: { layout: 'free' } },
      { id: 'c1', kind: 'carta', status: 'faceUp', parentId: 'mao', transform: { rotation: 90 } },
      { id: 'c2', kind: 'carta', status: 'faceUp', parentId: 'mao' },
      { id: 'c3', kind: 'carta', status: 'faceUp', parentId: 'mao' },
      { id: 'd1', kind: 'carta', status: 'faceDown', parentId: 'deck' },
      { id: 'f1', kind: 'ficha', parentId: 'fila' },
      { id: 'f2', kind: 'ficha', parentId: 'fila' },
      { id: 'f3', kind: 'ficha', parentId: 'fila' },
      { id: 't1', kind: 'ficha', transform: { x: 100, y: 100, rotation: 45 } },
      { id: 't2', kind: 'ficha', transform: { x: 130, y: 110 } },
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

const ids = (m: Manager, zone: string) => childrenOf(m.getState().pieces, zone).map((p) => p.id);

describe('dropMany', () => {
  it('cartas de volta ao deck: entram em ordem, viradas e retas, numa jogada só', () => {
    const m = setup();
    const r = m.dispatch({ type: 'dropMany', ids: ['c1', 'c3'], zone: 'deck', actor: 'p1' });
    expect(r.ok).toBe(true);
    expect(ids(m, 'deck')).toEqual(['d1', 'c1', 'c3']); // a primeira fica embaixo
    const { pieces } = m.getState();
    expect(pieces.c1).toMatchObject({ status: 'faceDown', transform: { rotation: 0 } });
    expect(ids(m, 'mao')).toEqual(['c2']);
    m.undo(); // um desfazer volta tudo
    expect(ids(m, 'mao')).toEqual(['c1', 'c2', 'c3']);
    expect(m.getState().pieces.c1!.transform.rotation).toBe(90);
  });

  it('em leque e fila: o grupo entra junto na posição `index`', () => {
    const m = setup();
    m.dispatch({ type: 'dropMany', ids: ['c1', 'c2'], zone: 'fila', index: 1 });
    expect(ids(m, 'fila')).toEqual(['f1', 'c1', 'c2', 'f2', 'f3']);
    // dentro da mesma zona: reordena (o índice conta só as que não estão no grupo)
    m.dispatch({ type: 'dropMany', ids: ['f1', 'c1'], zone: 'fila', index: 3 });
    expect(ids(m, 'fila')).toEqual(['c2', 'f2', 'f3', 'f1', 'c1']);
    m.dispatch({ type: 'dropMany', ids: ['f3', 'c2'], zone: 'fila', index: 0 });
    expect(ids(m, 'fila')).toEqual(['f3', 'c2', 'f2', 'f1', 'c1']);
  });

  it('grade: a primeira no encaixe indicado, as outras nos próximos livres', () => {
    const m = setup();
    m.dispatch({ type: 'dropInto', id: 'f1', zone: 'grade', slot: '1,0' });
    m.dispatch({ type: 'dropMany', ids: ['f2', 'f3'], zone: 'grade', slot: '0,0' });
    const slot = (id: string) => m.getState().pieces[id]!.slot;
    expect([slot('f2'), slot('f3')]).toEqual(['0,0', '2,0']);
    // o grupo anda uma casa para a direita dentro da zona (a da frente sai primeiro)
    const g = createManager({ seed: 1 });
    g.registerKind({ kind: 'z' });
    g.registerKind({ kind: 'f' });
    g.dispatch(
      spawn([
        {
          id: 'g',
          kind: 'z',
          zone: { layout: 'grid', grid: { cols: 3, rows: 1, cell: { w: 1, h: 1 } } },
        },
        { id: 'a', kind: 'f', parentId: 'g', slot: '0,0' },
        { id: 'b', kind: 'f', parentId: 'g', slot: '1,0' },
      ]),
    );
    expect(g.dispatch({ type: 'dropMany', ids: ['a', 'b'], zone: 'g', slot: '1,0' }).ok).toBe(true);
    expect([g.getState().pieces.a!.slot, g.getState().pieces.b!.slot]).toEqual(['1,0', '2,0']);
  });

  it('autoFill: sempre os primeiros encaixes livres, onde quer que caia', () => {
    const m = setup();
    m.dispatch({ type: 'dropInto', id: 'f1', zone: 'banco' }); // sem slot
    m.dispatch({ type: 'dropMany', ids: ['f2', 'f3'], zone: 'banco', slot: '3,0' });
    const slots = ['f1', 'f2', 'f3'].map((id) => m.getState().pieces[id]!.slot);
    expect(slots).toEqual(['0,0', '1,0', '2,0']);
  });

  it('sem lugar para todas: recusa tudo', () => {
    const m = setup();
    const r = m.dispatch({ type: 'dropMany', ids: ['f1', 'f2', 'f3', 'c1'], zone: 'grade' });
    expect(r).toEqual({ ok: false, error: 'zona "grade" não tem lugar para 4 peças' });
    expect(ids(m, 'fila')).toEqual(['f1', 'f2', 'f3']);
  });

  it('na mesa e em área livre: cada peça na sua posição, com a rotação de antes', () => {
    const m = setup();
    m.dispatch({
      type: 'dropMany',
      ids: ['t1', 't2'],
      zone: 'area',
      at: { t1: { x: 10, y: 20 }, t2: { x: 40, y: 30 } },
    });
    const { pieces } = m.getState();
    expect(pieces.t1!.transform).toMatchObject({ x: 10, y: 20, rotation: 45 });
    expect(pieces.t2!.transform).toMatchObject({ x: 40, y: 30, rotation: 0 });
    m.dispatch({
      type: 'dropMany',
      ids: ['t1', 't2'],
      zone: null,
      at: { t1: { x: 0, y: 0 }, t2: { x: 30, y: 10 } },
    });
    expect(m.getState().pieces.t2).toMatchObject({ parentId: null, transform: { x: 30, y: 10 } });
  });

  it('regras: validam o grupo e cada peça; piecesDropped vem no fim', () => {
    const m = setup();
    const vistos: string[] = [];
    m.registerRule({
      id: 'deck',
      validate: (cmd: Command) => {
        if (isCommand(cmd, 'dropMany') && cmd.ids.length > 2) return 'no máximo 2';
        if (isCommand(cmd, 'dropInto') && cmd.id === 'c2' && cmd.zone === 'deck') return 'c2 não';
        return true;
      },
      react: (ev: GameEvent) => {
        if (isEvent(ev, 'pieceEnteredZone')) vistos.push(ev.id);
        if (isEvent(ev, 'piecesDropped')) {
          vistos.push(`grupo:${ev.ids.join('+')}`);
          return [{ type: 'shuffle', zone: 'deck' }];
        }
        return [];
      },
    });
    expect(m.dispatch({ type: 'dropMany', ids: ['c1', 'c2', 'c3'], zone: 'deck' })).toEqual({
      ok: false,
      error: 'no máximo 2',
    });
    expect(m.dispatch({ type: 'dropMany', ids: ['c1', 'c2'], zone: 'deck' }).ok).toBe(false);
    expect(ids(m, 'mao')).toEqual(['c1', 'c2', 'c3']);
    vistos.length = 0; // a jogada recusada chegou a rodar a reação de c1
    expect(m.dispatch({ type: 'dropMany', ids: ['c1', 'c3'], zone: 'deck' }).ok).toBe(true);
    expect(vistos).toEqual(['c1', 'c3', 'grupo:c1+c3']);
    expect(m.canUndo()).not.toBe(true); // embaralhou depois
  });

  it('jogador: só peças dele (ou sem dono), só em área que pode receber', () => {
    const m = setup();
    expect(m.dispatch({ type: 'dropMany', ids: ['c1', 't1'], zone: 'area', actor: 'p2' }).ok).toBe(
      false,
    );
    expect(m.dispatch({ type: 'dropMany', ids: ['t1', 't2'], zone: 'mao', actor: 'p2' }).ok).toBe(
      false,
    );
    expect(m.dispatch({ type: 'dropMany', ids: ['t1', 't2'], zone: 'mao', actor: 'p1' }).ok).toBe(
      true,
    );
  });

  it('erros de formato', () => {
    const m = setup();
    expect(m.dispatch({ type: 'dropMany', ids: [], zone: 'deck' })).toEqual({
      ok: false,
      error: 'dropMany sem peças',
    });
    expect(m.dispatch({ type: 'dropMany', ids: ['c1', 'c1'], zone: 'deck' }).ok).toBe(false);
    expect(m.dispatch({ type: 'dropMany', ids: ['x'], zone: 'deck' })).toEqual({
      ok: false,
      error: 'peça "x" não existe',
    });
    expect(m.dispatch({ type: 'dropMany', ids: ['c1'], zone: 't1' })).toEqual({
      ok: false,
      error: '"t1" não é uma zona',
    });
  });
});
