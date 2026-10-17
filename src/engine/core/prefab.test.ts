import { describe, expect, it } from 'vitest';
import { createManager } from './manager';
import { spawn, type Prefab } from './prefab';
import { childrenOf } from './zones';

/** Tabuleiro livre com uma pilha e uma grade dentro. */
const board: Prefab<{ id: string; x: number }> = ({ id, x }) => [
  {
    id,
    kind: 'zona',
    size: { w: 300, h: 200 },
    transform: { x, y: 100 },
    zone: { layout: 'free' },
  },
  {
    id: `${id}-deck`,
    kind: 'zona',
    parentId: id,
    transform: { x: 60, y: 100 },
    zone: { layout: 'stack' },
  },
  {
    id: `${id}-trilha`,
    kind: 'zona',
    parentId: id,
    transform: { x: 200, y: 40 },
    zone: { layout: 'grid', grid: { cols: 3, rows: 1, cell: { w: 30, h: 30 } } },
  },
];

function setup() {
  const m = createManager({ seed: 1 });
  m.registerKind({ kind: 'zona' });
  m.clearHistory();
  return m;
}

describe('spawn (batch)', () => {
  it('cria todas as peças numa jogada só; um desfazer tira todas', () => {
    const m = setup();
    expect(m.dispatch(spawn(board({ id: 'ana', x: 200 }))).ok).toBe(true);
    expect(m.dispatch(spawn(board({ id: 'bia', x: 600 }))).ok).toBe(true);
    expect(childrenOf(m.getState().pieces, 'ana').map((p) => p.id)).toEqual([
      'ana-deck',
      'ana-trilha',
    ]);
    m.undo();
    expect(Object.keys(m.getState().pieces)).toEqual(['ana', 'ana-deck', 'ana-trilha']);
  });

  it('tudo ou nada: se uma peça falha, nenhuma é criada', () => {
    const m = setup();
    m.dispatch(spawn(board({ id: 'ana', x: 200 })));
    const before = m.getState();
    const r = m.dispatch(spawn([{ id: 'nova', kind: 'zona' }, ...board({ id: 'ana', x: 0 })]));
    expect(r).toEqual({ ok: false, error: 'peça "ana" já existe' });
    expect(m.getState()).toBe(before);
  });

  it('mover a raiz é um evento só; os filhos guardam posição relativa', () => {
    const m = setup();
    m.dispatch(spawn(board({ id: 'ana', x: 200 })));
    const r = m.dispatch({ type: 'dropInto', id: 'ana', zone: null, x: 500, y: 300 });
    expect(r.ok && r.value.map((e) => e.type)).toEqual(['piecePlaced']);
    expect(m.getState().pieces['ana-deck']?.transform).toMatchObject({ x: 60, y: 100 });
  });

  it('batch aninhado e comando "batch" reservado', () => {
    const m = setup();
    const r = m.dispatch({
      type: 'batch',
      commands: [spawn([{ id: 'a', kind: 'zona' }]), spawn([{ id: 'b', kind: 'zona' }])],
    });
    expect(r.ok).toBe(true);
    expect(Object.keys(m.getState().pieces)).toEqual(['a', 'b']);
    expect(() => m.registerCommand({ type: 'batch', execute: () => [] })).toThrow('já existe');
  });
});
