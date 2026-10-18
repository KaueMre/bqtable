import { act, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManager, type Command, type Manager, type Motion, type Piece } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({ kind: 'peao', defaults: { size: { w: 40, h: 40 } } });
  m.registerKind({ kind: 'carta', defaults: { size: { w: 60, h: 90 } } });
  m.registerKind({ kind: 'zona' });
  const create = (piece: object) => {
    const r = m.dispatch({ type: 'createPiece', piece });
    if (!r.ok) throw new Error(r.error);
  };
  create({ id: 'A', kind: 'peao', transform: { x: 50, y: 50 } });
  create({ id: 'B', kind: 'peao', transform: { x: 50, y: 150, z: 1 } });
  // deck: mesa x 350..450, y 30..170
  create({
    id: 'deck',
    kind: 'zona',
    size: { w: 100, h: 140 },
    transform: { x: 400, y: 100, z: 2 },
    zone: { layout: 'stack' },
  });
  // pista: 4 × 2 casas de 50, mesa x 300..500, y 250..350 (casa "c,l" no centro 325 + 50c, 275 + 50l)
  create({
    id: 'pista',
    kind: 'zona',
    size: { w: 200, h: 100 },
    transform: { x: 400, y: 300, z: 3 },
    zone: { layout: 'grid', grid: { cols: 4, rows: 2, cell: { w: 50, h: 50 } } },
  });
  // fila de cartas: c1, c2, c3 coladas a partir da esquerda
  create({
    id: 'fila',
    kind: 'zona',
    size: { w: 300, h: 100 },
    transform: { x: 200, y: 450, z: 4 },
    zone: { layout: 'row', row: { gap: 0 } },
  });
  for (const id of ['c1', 'c2', 'c3']) create({ id, kind: 'carta', parentId: 'fila' });
  // mão: mesa x 600..800, y 400..500 (sem jogador na tela, fica na mesa como as outras zonas)
  create({
    id: 'mao',
    kind: 'zona',
    size: { w: 200, h: 100 },
    transform: { x: 700, y: 450, z: 5 },
    zone: { layout: 'row', hand: true },
  });
  create({ id: 'h1', kind: 'carta', parentId: 'mao' });
  m.clearHistory();
  return m;
}

type MotionOf = (p: Piece) => Motion | undefined;

function renderTable(m: Manager, motion?: MotionOf) {
  const stageRef = createRef<Konva.Stage>();
  const ui = (manager: Manager) => (
    <ManagerProvider manager={manager}>
      <Table stageRef={stageRef} motion={motion} />
    </ManagerProvider>
  );
  const view = render(ui(m));
  const stage = stageRef.current!;
  const node = (id: string) => stage.findOne<Konva.Group>(`#${id}`)!;
  const layer = () => stage.findOne<Konva.Layer>('.motion')!;
  const ghosts = () => layer().find<Konva.Group>('.motion-ghost');
  const glows = () => layer().find('.motion-glow');
  /** Ponto da mesa → px da tela (pela câmera). */
  const toScreen = (p: { x: number; y: number }) =>
    stage.findOne('.world')!.getAbsoluteTransform().point(p);
  const screenOf = (id: string) => node(id).getAbsolutePosition();
  const run = (cmd: Command) =>
    act(() => {
      const r = m.dispatch(cmd);
      if (!r.ok) throw new Error(r.error);
    });
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  return {
    stage,
    node,
    layer,
    ghosts,
    glows,
    toScreen,
    screenOf,
    run,
    advance,
    restart: (other: Manager) => view.rerender(ui(other)),
  };
}

const only =
  (kind: string, motion: Motion): MotionOf =>
  (p) =>
    p.kind === kind ? motion : undefined;

const expectAt = (n: Konva.Node, p: { x: number; y: number }) => {
  expect(n.x()).toBeCloseTo(p.x, 3);
  expect(n.y()).toBeCloseTo(p.y, 3);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Table: movimento das peças', () => {
  it('sem motion, a peça vai direto para o lugar novo', () => {
    const t = renderTable(setup());
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
    expect(t.node('A').position()).toEqual({ x: 250, y: 50 });
  });

  it('move: uma cópia voa de onde a peça estava até o lugar novo', () => {
    const t = renderTable(setup(), only('peao', { place: 'move' }));
    const before = t.screenOf('A');
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    expect(t.ghosts()).toHaveLength(1);
    expectAt(t.ghosts()[0]!, before);
    // o nó já está no lugar novo, escondido até a cópia chegar
    expect(t.node('A').position()).toEqual({ x: 250, y: 50 });
    expect(t.node('A').opacity()).toBe(0);
    t.advance(200);
    expect(t.ghosts()[0]!.x()).toBeGreaterThan(before.x);
    t.advance(300);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
  });

  it('só o kind configurado anima', () => {
    const t = renderTable(setup(), only('carta', { place: 'move' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    expect(t.ghosts()).toHaveLength(0);
  });

  it('casa por casa: o voo passa pelas casas do meio', () => {
    const t = renderTable(setup(), only('peao', { place: { type: 'move', duration: 100 } }));
    t.run({ type: 'dropInto', id: 'A', zone: 'pista', slot: '0,0' });
    t.advance(500);
    // anda uma casa, desce, anda outra: em L, não na diagonal de 0,0 até 2,1
    t.run({
      type: 'batch',
      commands: ['1,0', '1,1', '2,1'].map((slot) => ({
        type: 'dropInto' as const,
        id: 'A',
        zone: 'pista',
        slot,
      })),
    });
    // um trecho de 100 ms por casa: no meio do primeiro, ainda na linha de cima
    t.advance(48);
    const ghost = t.ghosts()[0]!;
    const row0 = t.toScreen({ x: 325, y: 275 });
    const cell1 = t.toScreen({ x: 375, y: 275 });
    expect(ghost.y()).toBeCloseTo(row0.y, 3);
    expect(ghost.x()).toBeGreaterThan(row0.x);
    expect(ghost.x()).toBeLessThan(cell1.x);
    t.advance(350);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').position()).toEqual({ x: 425, y: 325 });
  });

  it('drop: aparece acima do destino e cai nele', () => {
    const t = renderTable(setup(), only('peao', { place: 'drop' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    const target = t.screenOf('A');
    const ghost = t.ghosts()[0]!;
    expect(ghost.x()).toBeCloseTo(target.x);
    expect(ghost.y()).toBeLessThan(target.y);
    expect(ghost.opacity()).toBe(0); // surge enquanto cai
    expect(t.layer().find('.motion-shadow')).toHaveLength(1);
    t.advance(600);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.layer().find('.motion-shadow')).toHaveLength(0);
  });

  it('showcase: cresce na evidência, espera e vai ao destino', () => {
    const t = renderTable(
      setup(),
      only('peao', { place: { type: 'showcase', duration: 100, hold: 200 } }),
    );
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    t.advance(150);
    const ghost = t.ghosts()[0]!;
    expect(ghost.x()).toBeCloseTo(400); // meio da tela (800 × 500 no jsdom)
    expect(ghost.scaleX()).toBeGreaterThan(4); // 40 de altura → uns 210 px
    t.advance(400);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
  });

  it('arrastar e soltar: o voo sai de onde o jogador soltou', () => {
    const m = setup();
    const t = renderTable(m, only('peao', { place: 'move' }));
    act(() => {
      t.node('A').fire('dragstart');
      t.node('A').position({ x: 410, y: 90 });
      t.node('A').fire('dragmove');
      t.node('A').fire('dragend');
    });
    expect(m.getState().pieces.A?.parentId).toBe('deck');
    expectAt(t.ghosts()[0]!, t.toScreen({ x: 410, y: 90 }));
    t.advance(500);
    expect(t.node('A').position()).toEqual({ x: 400, y: 100 });
    expect(t.node('A').opacity()).toBe(1);
  });

  it('pegar a peça no meio do voo: ela pousa na hora e vai com o ponteiro', () => {
    const t = renderTable(setup(), only('peao', { place: 'move' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    t.advance(100);
    act(() => t.node('A').fire('dragstart'));
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
  });

  it('fromHand: a carta que sai da mão chega do jeito dela; a que as regras movem, não', () => {
    const t = renderTable(setup(), only('carta', { place: 'move', fromHand: { place: 'drop' } }));
    const daFila = t.screenOf('c3');
    t.run({
      type: 'batch',
      commands: [
        { type: 'dropInto', id: 'h1', zone: 'deck' },
        { type: 'dropInto', id: 'c3', zone: 'deck' },
      ],
    });
    const [h1, c3] = [t.ghosts()[0]!, t.ghosts()[1]!];
    const deck = t.toScreen({ x: 400, y: 100 });
    // h1 (da mão) cai de cima do deck; c3 (da fila) sai de onde estava
    expect(h1.x()).toBeCloseTo(deck.x);
    expect(h1.y()).toBeLessThan(deck.y);
    expectAt(c3, daFila);
  });

  it('as vizinhas que se ajeitam (fila) deslizam no lugar, sem cópia', () => {
    const t = renderTable(setup(), only('carta', { place: 'move' }));
    const c2 = t.node('c2').x();
    t.run({ type: 'dropInto', id: 'c1', zone: null, x: 600, y: 450 });
    expect(t.ghosts()).toHaveLength(1); // só a c1, que mudou de lugar
    expect(t.node('c2').x()).toBeCloseTo(c2); // começa onde estava
    t.advance(300);
    expect(t.node('c2').x()).toBeCloseTo(c2 - 60);
  });

  it('arrow: a peça fica, a flecha mira, e o voo parte do lugar de antes', () => {
    const m = setup();
    const t = renderTable(m, only('peao', { drag: 'arrow', place: 'move' }));
    const before = t.screenOf('A');
    act(() => t.node('A').fire('dragstart'));
    expect(t.node('A').opacity()).toBe(0);
    expect(t.ghosts()).toHaveLength(1);
    expect(t.layer().find('.motion-arrow')).toHaveLength(1);
    const deck = t.toScreen({ x: 410, y: 90 });
    act(() => {
      t.stage.setPointersPositions({ clientX: deck.x, clientY: deck.y } as MouseEvent);
      t.node('A').position({ x: 410, y: 90 });
      t.node('A').fire('dragmove');
    });
    expectAt(t.ghosts()[0]!, before); // a cópia parada no lugar
    act(() => t.node('A').fire('dragend'));
    expect(m.getState().pieces.A?.parentId).toBe('deck');
    expect(t.layer().find('.motion-arrow')).toHaveLength(0);
    expectAt(t.ghosts()[0]!, before); // o voo sai do lugar de antes
    t.advance(500);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
  });

  it('arrow recusado: a peça aparece de novo no lugar, sem voo', () => {
    const m = setup();
    const t = renderTable(m, only('peao', { drag: 'arrow', place: 'move' }));
    act(() => {
      t.node('A').fire('dragstart');
      t.node('A').position({ x: 700, y: 700 });
      t.node('A').fire('dragmove');
    });
    m.registerRule({ id: 'presa', validate: () => 'não' });
    act(() => t.node('A').fire('dragend'));
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').position()).toEqual({ x: 50, y: 50 });
    expect(t.node('A').opacity()).toBe(1);
  });

  it('glow: acende ao chegar e apaga na próxima jogada', () => {
    const t = renderTable(setup(), only('peao', { after: 'glow' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    t.advance(1000);
    expect(t.glows()).toHaveLength(1);
    expect(t.glows()[0]!.opacity()).toBeGreaterThan(0);
    t.run({ type: 'setGlobal', key: 'x', value: 1 });
    expect(t.glows()).toHaveLength(0);
  });

  it('glow depois do voo; pegar outra peça também apaga', () => {
    const t = renderTable(setup(), only('peao', { place: 'move', after: 'glow' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    expect(t.glows()).toHaveLength(0); // ainda voando
    t.advance(500);
    expect(t.glows()).toHaveLength(1);
    act(() => t.node('B').fire('dragstart'));
    expect(t.glows()).toHaveLength(0);
  });

  it('shake: a peça treme e volta ao lugar', () => {
    const t = renderTable(setup(), only('peao', { after: { type: 'shake', duration: 300 } }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    t.advance(32);
    expect(t.node('A').x()).not.toBe(250);
    t.advance(400);
    expect(t.node('A').position()).toEqual({ x: 250, y: 50 });
    expect(t.node('A').rotation()).toBe(0);
  });

  it('desfazer: volta deslizando, sem efeito depois', () => {
    const m = setup();
    const t = renderTable(m, only('peao', { place: 'drop', after: 'glow' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    t.advance(1000);
    const there = t.screenOf('A');
    act(() => {
      m.undo();
    });
    expect(t.glows()).toHaveLength(0);
    expectAt(t.ghosts()[0]!, there); // sai de onde estava (não cai de cima)
    t.advance(400);
    expect(t.ghosts()).toHaveLength(0);
    expect(t.glows()).toHaveLength(0);
  });

  it('prefers-reduced-motion: vai direto', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    const t = renderTable(setup(), only('peao', { place: 'move', after: 'shake' }));
    t.run({ type: 'move', id: 'A', x: 250, y: 50 });
    expect(t.ghosts()).toHaveLength(0);
    t.advance(50);
    expect(t.node('A').x()).toBe(250);
  });

  it('outra partida (reiniciar): nada voa', () => {
    const m = setup();
    const t = renderTable(m, only('peao', { place: 'move' }));
    const other = setup();
    other.dispatch({ type: 'move', id: 'A', x: 250, y: 50 });
    act(() => t.restart(other));
    expect(t.ghosts()).toHaveLength(0);
    expect(t.node('A').opacity()).toBe(1);
  });
});
