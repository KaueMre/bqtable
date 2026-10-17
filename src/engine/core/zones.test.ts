import { describe, expect, it } from 'vitest';
import { isCommand } from './commands';
import { createManager, type Manager } from './manager';
import { childrenOf, gridSlot, isAncestor, type ZoneSpec } from './zones';

const zones: Record<string, ZoneSpec> = {
  area: { layout: 'free' },
  grade: { layout: 'grid', grid: { cols: 3, rows: 2, cell: { w: 50, h: 50 } } },
  tableau: {
    layout: 'slots',
    slots: [
      { id: 'a', x: 40, y: 40 },
      { id: 'b', x: 120, y: 40 },
    ],
    accepts: { kinds: ['carta'] },
  },
  deck: { layout: 'stack', accepts: { tags: ['mindset'] }, statusOnEnter: 'faceDown' },
  mao: { layout: 'fan', capacity: 3, statusOnEnter: 'faceUp' },
};

function setup(): Manager {
  const m = createManager({ seed: 9 });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp', 'covered'],
    transitions: { faceDown: ['faceUp'], faceUp: ['faceDown', 'covered'], covered: ['faceUp'] },
  });
  m.registerKind({ kind: 'zona' });
  m.registerKind({ kind: 'token' });
  for (const [id, zone] of Object.entries(zones)) {
    const r = m.dispatch({
      type: 'createPiece',
      piece: { id, kind: 'zona', zone, size: { w: 200, h: 120 } },
    });
    if (!r.ok) throw new Error(r.error);
  }
  for (const id of ['c1', 'c2', 'c3', 'c4']) {
    m.dispatch({
      type: 'createPiece',
      piece: { id, kind: 'carta', status: 'faceUp', tags: ['mindset'] },
    });
  }
  m.dispatch({ type: 'createPiece', piece: { id: 't1', kind: 'token' } });
  m.clearHistory();
  return m;
}

const drop = (m: Manager, id: string, target: object) =>
  m.dispatch({ type: 'dropInto', id, ...target });
const ids = (m: Manager, zone: string | null) =>
  childrenOf(m.getState().pieces, zone).map((p) => p.id);
const piece = (m: Manager, id: string) => m.getState().pieces[id]!;

describe('dropInto', () => {
  it('free: guarda a posição relativa à zona e sobe para o topo', () => {
    const m = setup();
    expect(drop(m, 'c1', { zone: 'area', x: 30, y: 20 }).ok).toBe(true);
    expect(drop(m, 'c2', { zone: 'area' }).ok).toBe(true);
    expect(piece(m, 'c1')).toMatchObject({ parentId: 'area', transform: { x: 30, y: 20 } });
    expect(piece(m, 'c2').transform).toMatchObject({ x: 100, y: 60 }); // centro da zona
    expect(ids(m, 'area')).toEqual(['c1', 'c2']);
  });

  it('grid: casa válida e livre', () => {
    const m = setup();
    expect(drop(m, 't1', { zone: 'grade', slot: gridSlot(2, 1) }).ok).toBe(true);
    expect(piece(m, 't1').slot).toBe('2,1');
    expect(drop(m, 'c1', { zone: 'grade', slot: '2,1' })).toEqual({
      ok: false,
      error: 'encaixe "2,1" de "grade" está ocupado',
    });
    expect(drop(m, 'c1', { zone: 'grade', slot: '3,0' }).ok).toBe(false);
    expect(drop(m, 'c1', { zone: 'grade' }).ok).toBe(false);
  });

  it('slots: encaixe nomeado, ocupação e accepts por kind', () => {
    const m = setup();
    expect(drop(m, 'c1', { zone: 'tableau', slot: 'a' }).ok).toBe(true);
    expect(drop(m, 'c2', { zone: 'tableau', slot: 'a' }).ok).toBe(false);
    expect(drop(m, 'c2', { zone: 'tableau', slot: 'z' }).ok).toBe(false);
    expect(drop(m, 't1', { zone: 'tableau', slot: 'b' })).toEqual({
      ok: false,
      error: 'zona "tableau" não aceita peças do tipo "token"',
    });
  });

  it('stack: entra no topo por padrão, ou na posição pedida; accepts por tag', () => {
    const m = setup();
    drop(m, 'c1', { zone: 'deck' });
    drop(m, 'c2', { zone: 'deck' });
    drop(m, 'c3', { zone: 'deck', index: 0 }); // embaixo de tudo
    drop(m, 'c4', { zone: 'deck', index: 2 }); // entre c1 e c2
    expect(ids(m, 'deck')).toEqual(['c3', 'c1', 'c4', 'c2']);
    expect(drop(m, 't1', { zone: 'deck' }).ok).toBe(false);
  });

  it('statusOnEnter muda o status ao entrar, validado pelo kind', () => {
    const m = setup();
    const r = drop(m, 'c1', { zone: 'deck' });
    expect(r.ok && r.value.map((e) => e.type)).toEqual([
      'piecePlaced',
      'pieceEnteredZone',
      'statusChanged',
    ]);
    expect(piece(m, 'c1').status).toBe('faceDown');

    // covered → faceDown não é transição permitida: a entrada é recusada
    m.dispatch({ type: 'setStatus', id: 'c2', status: 'covered' });
    expect(drop(m, 'c2', { zone: 'deck' })).toEqual({
      ok: false,
      error: '"carta" não pode passar de "covered" para "faceDown"',
    });
  });

  it('trocar de zona emite saída e entrada; voltar à mesa usa coordenadas da mesa', () => {
    const m = setup();
    drop(m, 'c1', { zone: 'deck' });
    const r = drop(m, 'c1', { zone: 'mao' });
    expect(r.ok && r.value.map((e) => e.type)).toEqual([
      'pieceLeftZone',
      'piecePlaced',
      'pieceEnteredZone',
      'statusChanged',
    ]);
    expect(piece(m, 'c1').status).toBe('faceUp');
    drop(m, 'c1', { zone: null, x: 500, y: 400 });
    expect(piece(m, 'c1')).toMatchObject({ parentId: null, transform: { x: 500, y: 400 } });
    expect(piece(m, 'c1').slot).toBeUndefined();
  });

  it('capacidade', () => {
    const m = setup();
    for (const id of ['c1', 'c2', 'c3']) expect(drop(m, id, { zone: 'mao' }).ok).toBe(true);
    expect(drop(m, 'c4', { zone: 'mao' })).toEqual({ ok: false, error: 'zona "mao" está cheia' });
    expect(drop(m, 'c1', { zone: 'mao', index: 0 }).ok).toBe(true); // reordenar não conta como entrar
    expect(ids(m, 'mao')).toEqual(['c1', 'c2', 'c3']);
  });

  it('zona dentro de zona, sem ciclos', () => {
    const m = setup();
    expect(drop(m, 'deck', { zone: 'area', x: 50, y: 50 }).ok).toBe(true);
    drop(m, 'c1', { zone: 'deck' });
    expect(isAncestor(m.getState().pieces, 'area', 'c1')).toBe(true);
    expect(drop(m, 'area', { zone: 'deck' }).ok).toBe(false);
    expect(drop(m, 'area', { zone: 'area' }).ok).toBe(false);
  });

  it('soltar no mesmo lugar não gera jogada', () => {
    const m = setup();
    drop(m, 't1', { zone: 'grade', slot: '0,0' });
    const before = m.getState();
    expect(drop(m, 't1', { zone: 'grade', slot: '0,0' })).toEqual({ ok: true, value: [] });
    expect(m.getState()).toBe(before);
  });

  it('desfazer volta a peça para a zona anterior', () => {
    const m = setup();
    drop(m, 'c1', { zone: 'deck' });
    drop(m, 'c1', { zone: 'mao' });
    m.undo();
    expect(piece(m, 'c1')).toMatchObject({ parentId: 'deck', status: 'faceDown' });
  });

  it('regra pode recusar a entrada (casos complexos)', () => {
    const m = setup();
    m.registerRule({
      id: 'so-par',
      validate: (cmd) =>
        isCommand(cmd, 'dropInto') && cmd.zone === 'grade' && cmd.slot?.startsWith('1,')
          ? 'coluna 1 bloqueada'
          : true,
    });
    expect(drop(m, 't1', { zone: 'grade', slot: '1,0' })).toEqual({
      ok: false,
      error: 'coluna 1 bloqueada',
    });
  });
});

describe('outros comandos com zonas', () => {
  it('move é recusado dentro de zona com layout', () => {
    const m = setup();
    drop(m, 'c1', { zone: 'deck' });
    expect(m.dispatch({ type: 'move', id: 'c1', x: 1, y: 1 })).toEqual({
      ok: false,
      error: `"c1" está numa zona 'stack': use dropInto`,
    });
    drop(m, 'c2', { zone: 'area' });
    expect(m.dispatch({ type: 'move', id: 'c2', x: 1, y: 1 }).ok).toBe(true);
  });

  it('createPiece dentro de zona valida o encaixe e ordena no topo', () => {
    const m = setup();
    const create = (id: string, extra: object) =>
      m.dispatch({
        type: 'createPiece',
        piece: { id, kind: 'carta', tags: ['mindset'], ...extra },
      });
    expect(create('n1', { parentId: 'deck' }).ok).toBe(true);
    expect(create('n2', { parentId: 'deck' }).ok).toBe(true);
    expect(ids(m, 'deck')).toEqual(['n1', 'n2']);
    expect(create('n3', { parentId: 'tableau', slot: 'nao-existe' }).ok).toBe(false);
    expect(create('n4', { parentId: 'c1' })).toEqual({ ok: false, error: '"c1" não é uma zona' });
  });

  it('createPiece recusa zona mal definida', () => {
    const m = setup();
    const r = m.dispatch({
      type: 'createPiece',
      piece: { id: 'z', kind: 'zona', zone: { layout: 'slots' } },
    });
    expect(r).toEqual({ ok: false, error: `zona "z": layout 'slots' precisa de slots` });
  });

  it('removePiece recusa zona com peças', () => {
    const m = setup();
    drop(m, 'c1', { zone: 'deck' });
    expect(m.dispatch({ type: 'removePiece', id: 'deck' }).ok).toBe(false);
    expect(m.dispatch({ type: 'removePiece', id: 'area' }).ok).toBe(true);
  });

  it('shuffle embaralha com a semente e bloqueia o desfazer', () => {
    const run = (seed: number) => {
      const m = createManager({ seed });
      m.registerKind({ kind: 'k' });
      m.dispatch({ type: 'createPiece', piece: { id: 'd', kind: 'k', zone: { layout: 'stack' } } });
      for (let i = 0; i < 8; i++) {
        m.dispatch({ type: 'createPiece', piece: { id: `c${i}`, kind: 'k', parentId: 'd' } });
      }
      const r = m.dispatch({ type: 'shuffle', zone: 'd' });
      expect(r.ok).toBe(true);
      expect(m.canUndo()).toBe('informação revelada: não dá para desfazer');
      return ids(m, 'd');
    };
    const a = run(1);
    expect(a).toEqual(run(1));
    expect(a).not.toEqual(run(2));
    expect([...a].sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });
});

describe('check', () => {
  it('simula sem aplicar', () => {
    const m = setup();
    const before = m.getState();
    expect(m.check({ type: 'dropInto', id: 'c1', zone: 'deck' })).toBe(true);
    expect(m.check({ type: 'dropInto', id: 't1', zone: 'deck' })).toMatch(/só aceita/);
    expect(m.getState()).toBe(before);
    expect(m.canUndo()).toBe('nada para desfazer');
  });
});
