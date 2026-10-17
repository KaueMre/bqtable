import { act, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { childrenOf, createManager, type Manager, type Piece } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: { size: { w: 60, h: 90 }, faces: { faceDown: 'verso', faceUp: 'frente' } },
  });
  m.registerKind({ kind: 'zona' });
  const r = m.dispatch({
    type: 'batch',
    commands: [
      { id: 'A', kind: 'carta', transform: { x: 50, y: 50, rotation: 90 } },
      { id: 'B', kind: 'carta', transform: { x: 150, y: 80, z: 1 } },
      { id: 'C', kind: 'carta', transform: { x: 250, y: 50, z: 2 } },
      // deck: mesa x 350..450, y 30..170
      {
        id: 'deck',
        kind: 'zona',
        size: { w: 100, h: 140 },
        transform: { x: 400, y: 100, z: 3 },
        zone: { layout: 'stack', statusOnEnter: 'faceDown', rotationOnEnter: 0 },
      },
      // area: mesa x 300..500, y 330..470
      {
        id: 'area',
        kind: 'zona',
        size: { w: 200, h: 140 },
        transform: { x: 400, y: 400, z: 4 },
        zone: { layout: 'free' },
      },
      {
        id: 'fichas',
        kind: 'zona',
        size: { w: 100, h: 100 },
        transform: { x: 700, y: 100, z: 5 },
        zone: { layout: 'stack', accepts: { kinds: ['ficha'] } },
      },
    ].map((piece) => ({ type: 'createPiece', piece })),
  });
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

function renderTable(m: Manager, canDrag?: (p: Piece) => boolean) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={m}>
      <Table stageRef={stageRef} canDrag={canDrag} />
    </ManagerProvider>,
  );
  const stage = stageRef.current!;
  const node = (id: string) => stage.findOne<Konva.Group>(`#${id}`)!;
  const click = (id: string, shiftKey = false) =>
    act(() => {
      node(id).fire('click', { evt: { shiftKey } });
    });
  const outlined = (id: string) =>
    node(id)
      .find<Konva.Rect>('Rect')
      .some((r) => r.stroke() === '#0969da');
  const transformed = () =>
    stage
      .findOne<Konva.Transformer>('Transformer')!
      .nodes()
      .map((n) => n.id());
  const dragTo = (id: string, to: { x: number; y: number }) =>
    act(() => {
      node(id).fire('dragstart');
      node(id).position(to);
      node(id).fire('dragmove');
      node(id).fire('dragend');
    });
  return { stage, node, click, outlined, transformed, dragTo };
}

const ids = (m: Manager, zone: string) => childrenOf(m.getState().pieces, zone).map((p) => p.id);

describe('Table: seleção de várias peças', () => {
  it('Shift + clique soma e tira; clique simples volta a uma (com o girar)', () => {
    const { click, outlined, transformed } = renderTable(setup());
    click('A');
    expect(transformed()).toEqual(['A']);
    expect(outlined('A')).toBe(false); // uma só: o Transformer já mostra
    click('B', true);
    expect(outlined('A') && outlined('B')).toBe(true);
    expect(transformed()).toEqual([]); // girar só com uma
    click('A', true); // tira
    expect(outlined('A')).toBe(false);
    expect(transformed()).toEqual(['B']);
    click('C');
    expect(transformed()).toEqual(['C']);
  });

  it('arrastar uma selecionada leva o grupo: um dropMany, um desfazer', () => {
    const m = setup();
    const { click, dragTo } = renderTable(m);
    click('A');
    click('B', true);
    dragTo('B', { x: 410, y: 90 }); // no deck
    expect(ids(m, 'deck')).toEqual(['A', 'B']); // na ordem de desenho
    expect(m.getState().pieces.A).toMatchObject({ status: 'faceDown', transform: { rotation: 0 } });
    expect(m.getState().log.filter((e) => e.event.type === 'piecesDropped')).toHaveLength(1);
    m.undo();
    expect(m.getState().pieces.A).toMatchObject({ parentId: null, transform: { rotation: 90 } });
    expect(m.getState().pieces.B!.parentId).toBeNull();
  });

  it('na mesa, o grupo mantém a distância e a rotação entre as peças', () => {
    const m = setup();
    const { node, click } = renderTable(m);
    click('A');
    click('B', true);
    act(() => {
      node('A').fire('dragstart');
      node('A').position({ x: 150, y: 250 });
      node('A').fire('dragmove');
    });
    expect(node('B').position()).toEqual({ x: 250, y: 280 }); // acompanha durante o arrasto
    act(() => {
      node('A').fire('dragend');
    });
    const { pieces } = m.getState();
    expect(pieces.A!.transform).toMatchObject({ x: 150, y: 250, rotation: 90 });
    expect(pieces.B!.transform).toMatchObject({ x: 250, y: 280 });
  });

  it('numa área livre, cada peça cai onde estava no grupo (coordenadas da zona)', () => {
    const m = setup();
    const { click, dragTo } = renderTable(m);
    click('A');
    click('B', true);
    dragTo('A', { x: 340, y: 370 }); // B vai junto para (440, 400)
    const { pieces } = m.getState();
    expect(pieces.A).toMatchObject({ parentId: 'area', transform: { x: 40, y: 40 } });
    expect(pieces.B).toMatchObject({ parentId: 'area', transform: { x: 140, y: 70 } });
  });

  it('zona que não aceita o grupo inteiro: tudo volta', async () => {
    const m = setup();
    const { node, click, dragTo } = renderTable(m);
    click('A');
    click('B', true);
    dragTo('A', { x: 700, y: 100 }); // fichas só aceita fichas
    expect(m.getState().pieces.A!.parentId).toBeNull();
    await vi.waitFor(() => expect(node('B').position()).toEqual({ x: 150, y: 80 }));
  });

  it('só vão juntas as que o jogador pode arrastar', () => {
    const m = setup();
    const { click, dragTo } = renderTable(m, (p) => p.id !== 'C');
    click('A');
    click('C', true);
    dragTo('A', { x: 410, y: 90 });
    expect(ids(m, 'deck')).toEqual(['A']);
    expect(m.getState().pieces.C!.parentId).toBeNull();
  });

  it('Shift + arrastar no vazio: retângulo seleciona as peças inteiras dentro dele', () => {
    const m = setup();
    const { stage, outlined, transformed } = renderTable(m);
    const pointer = vi.spyOn(stage, 'getPointerPosition');
    // pontos em coordenadas da mesa → tela (a câmera, o grupo "mundo", abre enquadrando a mesa)
    const world = stage.findOne<Konva.Group>('.world')!;
    const camera = world.position();
    const tela = (x: number, y: number) => ({
      x: x * world.scaleX() + world.x(),
      y: y * world.scaleY() + world.y(),
    });
    const fire = (type: string, x: number, y: number) =>
      act(() => {
        pointer.mockReturnValue(tela(x, y));
        stage.fire(type, { evt: { shiftKey: true } });
      });
    fire('mousedown', 0, 0);
    expect(world.position()).toEqual(camera); // não arrasta a mesa
    fire('mousemove', 200, 140);
    fire('mouseup', 200, 140);
    fire('click', 200, 140); // o clique do fim do retângulo não limpa a seleção
    expect(world.position()).toEqual(camera);
    expect(outlined('A') && outlined('B')).toBe(true); // C e as zonas não couberam inteiras
    expect(outlined('C')).toBe(false);
    expect(transformed()).toEqual([]);
    act(() => {
      stage.fire('click'); // clique no vazio limpa
    });
    expect(outlined('A')).toBe(false);
  });

  it('o retângulo também começa numa zona fixa; o clique do fim não a seleciona', () => {
    const m = setup();
    const { stage, node, outlined } = renderTable(m, (p) => !p.zone);
    const pointer = vi.spyOn(stage, 'getPointerPosition');
    // pontos em coordenadas da mesa → tela (a câmera, o grupo "mundo", abre enquadrando a mesa)
    const world = stage.findOne<Konva.Group>('.world')!;
    const camera = world.position();
    const tela = (x: number, y: number) => ({
      x: x * world.scaleX() + world.x(),
      y: y * world.scaleY() + world.y(),
    });
    const onArea = (type: string, x: number, y: number) =>
      act(() => {
        pointer.mockReturnValue(tela(x, y));
        node('area')
          .findOne('Rect')!
          .fire(type, { evt: { shiftKey: true } }, true);
      });
    onArea('mousedown', 0, 0); // começa em cima da área (fixa)
    act(() => {
      pointer.mockReturnValue(tela(200, 140));
      stage.fire('mousemove', { evt: { shiftKey: true } });
    });
    onArea('mouseup', 200, 140);
    onArea('click', 200, 140);
    expect(outlined('A') && outlined('B')).toBe(true);
    expect(outlined('area')).toBe(false);
    expect(world.position()).toEqual(camera); // a mesa não andou
    // numa peça que arrasta, Shift + arrastar move a peça (não abre retângulo)
    act(() => {
      pointer.mockReturnValue(tela(250, 50));
      node('C')
        .findOne('Rect')!
        .fire('mousedown', { evt: { shiftKey: true } }, true);
      stage.fire('mousemove', { evt: { shiftKey: true } });
    });
    expect(stage.find<Konva.Rect>('Rect').some((r) => r.fill() === 'rgb(9 105 218 / 0.12)')).toBe(
      false,
    );
  });
});
