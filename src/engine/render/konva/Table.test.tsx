import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createManager, isCommand, type Manager } from '@/engine/core';
import { ManagerProvider, ViewerProvider } from '@/engine/react';
import type { GestureHandler } from '../gestures';
import { Table, type TableApi } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: { size: { w: 60, h: 90 }, faces: { faceDown: 'verso', faceUp: 'frente' } },
  });
  m.registerKind({ kind: 'zona' });
  const create = (piece: object) => {
    const r = m.dispatch({ type: 'createPiece', piece });
    if (!r.ok) throw new Error(r.error);
  };
  create({ id: 'A', kind: 'carta', transform: { x: 50, y: 50 } });
  create({ id: 'B', kind: 'carta', transform: { x: 150, y: 50, z: 1 } });
  // deck: mesa x 350..450, y 30..170
  create({
    id: 'deck',
    kind: 'zona',
    size: { w: 100, h: 140 },
    transform: { x: 400, y: 100, z: 2 },
    zone: { layout: 'stack', accepts: { kinds: ['carta'] }, statusOnEnter: 'faceUp' },
  });
  // tab: mesa x 300..500, y 330..470; encaixe s1 em (350, 400), s2 em (450, 400)
  create({
    id: 'tab',
    kind: 'zona',
    size: { w: 200, h: 140 },
    transform: { x: 400, y: 400, z: 3 },
    zone: {
      layout: 'slots',
      slots: [
        { id: 's1', x: 50, y: 70 },
        { id: 's2', x: 150, y: 70 },
      ],
    },
  });
  create({
    id: 'fichas',
    kind: 'zona',
    size: { w: 100, h: 100 },
    transform: { x: 700, y: 100, z: 4 },
    zone: { layout: 'stack', accepts: { kinds: ['ficha'] } },
  });
  m.registerRule({
    id: 'B-presa',
    validate: (cmd) => (isCommand(cmd, 'dropInto') && cmd.id === 'B' ? 'B está presa' : true),
  });
  m.clearHistory();
  return m;
}

function renderTable(m: Manager, onGesture?: GestureHandler) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={m}>
      <Table stageRef={stageRef} onGesture={onGesture} />
    </ManagerProvider>,
  );
  const stage = stageRef.current!;
  const node = (id: string) => stage.findOne<Konva.Group>(`#${id}`)!;
  const order = () => stage.find('.piece').map((n) => n.id());
  /** Simula o arrasto: o alvo é o centro da peça (sem ponteiro no jsdom). */
  const dragTo = (id: string, to: { x: number; y: number }) =>
    act(() => {
      node(id).fire('dragstart');
      node(id).position(to);
      node(id).fire('dragmove');
      node(id).fire('dragend');
    });
  return { stage, node, order, dragTo };
}

const outline = (zone: Konva.Group) =>
  zone
    .find<Konva.Rect>('Rect')
    .find((r) => r.strokeWidth() >= 3)
    ?.stroke();

describe('Table (Konva)', () => {
  it('desenha as peças no lugar do estado, por ordem de z', () => {
    const { node, order } = renderTable(setup());
    expect(node('A').position()).toEqual({ x: 50, y: 50 });
    expect(node('A').offset()).toEqual({ x: 30, y: 45 }); // x, y é o centro
    expect(order()).toEqual(['A', 'B', 'deck', 'tab', 'fichas']);
  });

  it('arrastar na mesa vira dropInto e a peça solta fica por cima', () => {
    const m = setup();
    const { order, dragTo } = renderTable(m);
    dragTo('A', { x: 200, y: 120 });
    expect(m.getState().pieces.A?.transform).toMatchObject({ x: 200, y: 120, z: 5 });
    expect(order()).toEqual(['B', 'deck', 'tab', 'fichas', 'A']);
  });

  it('arrasto recusado devolve a peça para onde estava', async () => {
    const m = setup();
    const { node, dragTo } = renderTable(m);
    dragTo('B', { x: 300, y: 300 });
    expect(m.getState().pieces.B?.transform).toMatchObject({ x: 150, y: 50 });
    await vi.waitFor(() => expect(node('B').position()).toEqual({ x: 150, y: 50 }));
  });

  it('soltar numa pilha: entra, muda o status e vai para o desenho da zona', () => {
    const m = setup();
    const { node, order, dragTo } = renderTable(m);
    dragTo('A', { x: 410, y: 90 });
    expect(m.getState().pieces.A).toMatchObject({ parentId: 'deck', status: 'faceUp' });
    expect(node('A').position()).toEqual({ x: 400, y: 100 }); // centro da pilha
    expect(order().indexOf('A')).toBe(order().indexOf('deck') + 1);
  });

  it('encaixe magnético: perto do slot encaixa nele', () => {
    const m = setup();
    const { node, dragTo } = renderTable(m);
    dragTo('A', { x: 462, y: 388 });
    expect(m.getState().pieces.A).toMatchObject({ parentId: 'tab', slot: 's2' });
    expect(node('A').position()).toEqual({ x: 450, y: 400 });
  });

  it('zona que não aceita a peça devolve a peça', async () => {
    const m = setup();
    const { node, dragTo } = renderTable(m);
    dragTo('A', { x: 700, y: 100 });
    expect(m.getState().pieces.A?.parentId).toBeNull();
    await vi.waitFor(() => expect(node('A').position()).toEqual({ x: 50, y: 50 }));
  });

  it('durante o arrasto, destaca as zonas que aceitam a peça', () => {
    const { node } = renderTable(setup());
    act(() => {
      node('A').fire('dragstart');
    });
    expect(outline(node('deck'))).toBe('#2da44e');
    expect(outline(node('tab'))).toBe('#2da44e');
    expect(outline(node('fichas'))).toBeUndefined();
    act(() => {
      node('A').position({ x: 700, y: 100 });
      node('A').fire('dragmove');
    });
    expect(outline(node('fichas'))).toBe('#cf222e'); // em cima, mas recusa
    act(() => {
      node('A').fire('dragend');
    });
    expect(outline(node('deck'))).toBeUndefined();
  });

  it('arrastar uma zona leva o conteúdo junto', () => {
    const m = setup();
    const { node, dragTo } = renderTable(m);
    dragTo('A', { x: 400, y: 100 }); // A entra no deck
    act(() => {
      node('deck').fire('dragstart');
      node('deck').position({ x: 500, y: 150 });
      node('deck').fire('dragmove');
    });
    expect(node('A').position()).toEqual({ x: 500, y: 150 }); // acompanhou durante o arrasto
    act(() => {
      node('deck').fire('dragend');
    });
    expect(m.getState().pieces.deck?.transform).toMatchObject({ x: 500, y: 150 });
    expect(node('A').position()).toEqual({ x: 500, y: 150 });
  });

  it('botão do meio sempre move a mesa, mesmo em cima de uma peça', () => {
    const m = setup();
    const { stage, node } = renderTable(m);
    const naMesa = vi.fn();
    stage.on('mousedown mouseup', naMesa);
    const canvas = stage.content.querySelector('canvas')!;
    const world = stage.findOne<Konva.Group>('.world')!; // a câmera
    const inicio = world.position(); // abre enquadrando a mesa
    act(() => {
      fireEvent.mouseDown(canvas, { button: 1, clientX: 50, clientY: 50 }); // em cima de A
    });
    act(() => {
      fireEvent.mouseMove(window, { clientX: 90, clientY: 70 });
    });
    expect(world.position()).toEqual({ x: inicio.x + 40, y: inicio.y + 20 });
    act(() => {
      fireEvent.mouseUp(window, { button: 1, clientX: 90, clientY: 70 });
      fireEvent.mouseMove(window, { clientX: 200, clientY: 200 }); // já soltou: não move mais
    });
    expect(world.position()).toEqual({ x: inicio.x + 40, y: inicio.y + 20 });
    expect(naMesa).not.toHaveBeenCalled(); // o Konva nem viu o aperto
    expect(m.getState().pieces.A?.transform).toMatchObject({ x: 50, y: 50 });
    expect(node('A').position()).toEqual({ x: 50, y: 50 });
  });

  it('girar pelo Transformer vira rotate (normalizado)', () => {
    const m = setup();
    const { node } = renderTable(m);
    act(() => {
      node('A').rotation(-90);
      node('A').fire('transformend');
    });
    expect(m.getState().pieces.A?.transform.rotation).toBe(270);
    expect(node('A').rotation()).toBe(270);
  });

  it('girar uma zona gira o conteúdo junto, durante e depois', () => {
    const m = setup();
    const { node, dragTo } = renderTable(m);
    dragTo('A', { x: 350, y: 400 }); // A no encaixe s1, 50 à esquerda do centro de tab
    const closeTo = (p: { x: number; y: number }, x: number, y: number) => {
      expect(p.x).toBeCloseTo(x);
      expect(p.y).toBeCloseTo(y);
    };
    act(() => {
      node('tab').fire('transformstart');
      node('tab').rotation(90);
      node('tab').fire('transform');
    });
    // durante: 50 à esquerda, girado 90°, vira 50 acima
    closeTo(node('A').position(), 400, 350);
    expect(node('A').rotation()).toBe(90);
    act(() => {
      node('tab').fire('transformend');
    });
    expect(m.getState().pieces.tab?.transform.rotation).toBe(90);
    expect(m.getState().pieces.A?.transform.rotation).toBe(0); // a carta não girou sozinha
    closeTo(node('A').position(), 400, 350);
    expect(node('A').rotation()).toBe(90);
  });

  it('duplo clique usa o mapeamento do jogo (virar)', () => {
    const m = setup();
    const flip: GestureHandler = (g, piece) =>
      g.type === 'activate'
        ? {
            type: 'setStatus',
            id: piece.id,
            status: piece.status === 'faceDown' ? 'faceUp' : 'faceDown',
          }
        : null;
    const { node } = renderTable(m, flip);
    const text = () => node('A').findOne<Konva.Text>('Text')!.text();
    expect(text()).toBe('verso');
    act(() => {
      node('A').fire('dblclick');
    });
    expect(m.getState().pieces.A?.status).toBe('faceUp');
    expect(text()).toBe('frente');
  });

  it('peça criada ou removida aparece e some', () => {
    const m = setup();
    const { order } = renderTable(m);
    act(() => {
      m.dispatch({ type: 'createPiece', piece: { id: 'C', kind: 'carta', parentId: 'deck' } });
      m.dispatch({ type: 'removePiece', id: 'A' });
    });
    expect(order()).toEqual(['B', 'deck', 'C', 'tab', 'fichas']);
  });

  it('abre enquadrando tudo; Centralizar enquadra de novo depois de mover a mesa', async () => {
    const user = userEvent.setup();
    const { stage } = renderTable(setup());
    const world = stage.findOne<Konva.Group>('.world')!; // a câmera
    // conteúdo: x 20..750, y 5..470, numa mesa de 800 × 500 (com margem de 32)
    const box = world.getClientRect({ relativeTo: world });
    const meio = (box.x + box.width / 2) * world.scaleX() + world.x();
    expect(meio).toBeCloseTo(400, 0); // centralizado
    expect(world.scaleX()).toBeLessThan(1);
    expect(screen.getByText(`${Math.round(world.scaleX() * 100)}%`)).toBeInTheDocument();
    const enquadrada = { ...world.position(), s: world.scaleX() };
    act(() => {
      fireEvent.mouseDown(stage.content.querySelector('canvas')!, {
        button: 1,
        clientX: 0,
        clientY: 0,
      });
      fireEvent.mouseMove(window, { clientX: 300, clientY: 100 });
      fireEvent.mouseUp(window, { button: 1, clientX: 300, clientY: 100 });
    });
    expect(world.x()).toBe(enquadrada.x + 300);
    await user.click(screen.getByRole('button', { name: 'Centralizar' }));
    expect({ ...world.position(), s: world.scaleX() }).toEqual(enquadrada);
  });

  it('arrastar no vazio move a mesa; o clique do fim não limpa a seleção', () => {
    const { stage, node } = renderTable(setup());
    const world = stage.findOne<Konva.Group>('.world')!;
    const inicio = world.position();
    act(() => void node('A').fire('click'));
    act(() => {
      stage.fire('mousedown', { evt: { button: 0, clientX: 10, clientY: 10 } });
      fireEvent.mouseMove(window, { clientX: 60, clientY: 30 });
      fireEvent.mouseUp(window, { button: 0, clientX: 60, clientY: 30 });
      stage.fire('click');
    });
    expect(world.position()).toEqual({ x: inicio.x + 50, y: inicio.y + 20 });
    expect(stage.findOne<Konva.Transformer>('Transformer')!.nodes()).toHaveLength(1); // A segue selecionada
    act(() => void stage.fire('click')); // um clique no vazio, sem arrastar, limpa
    expect(stage.findOne<Konva.Transformer>('Transformer')!.nodes()).toHaveLength(0);
  });

  it('câmeras: guardar e voltar (pela API da mesa; a tecla é dos atalhos do jogo)', () => {
    const stageRef = createRef<Konva.Stage>();
    const api = createRef<TableApi>();
    render(
      <ManagerProvider manager={setup()}>
        <Table stageRef={stageRef} apiRef={api} />
      </ManagerProvider>,
    );
    const stage = stageRef.current!;
    const world = stage.findOne<Konva.Group>('.world')!; // a câmera
    const enquadrada = world.position();
    act(() => api.current!.saveCamera(2));
    expect(screen.getByText('Câmera 2 salva')).toBeInTheDocument();
    act(() => {
      fireEvent.mouseDown(stage.content.querySelector('canvas')!, {
        button: 1,
        clientX: 0,
        clientY: 0,
      });
      fireEvent.mouseMove(window, { clientX: -200, clientY: 50 });
      fireEvent.mouseUp(window, { button: 1 });
    });
    expect(world.position()).not.toEqual(enquadrada);
    act(() => api.current!.loadCamera(2));
    expect(world.position()).toEqual(enquadrada);
    expect(screen.getByText('Câmera 2')).toBeInTheDocument();
    act(() => api.current!.loadCamera(5));
    expect(screen.getByText('Câmera 5 vazia')).toBeInTheDocument();
  });
});

describe('Table com jogadores (dono e privacidade)', () => {
  function setupPlayers(): Manager {
    const m = createManager({
      seed: 1,
      players: [
        { id: 'ana', name: 'Ana' },
        { id: 'bia', name: 'Bia' },
      ],
    });
    m.registerKind({
      kind: 'carta',
      statuses: ['faceDown', 'faceUp'],
      defaults: { size: { w: 60, h: 90 }, faces: { faceDown: 'verso', faceUp: 'frente' } },
    });
    m.registerKind({ kind: 'zona' });
    const r = m.dispatch({
      type: 'batch',
      commands: [
        {
          id: 'ana',
          kind: 'zona',
          owner: 'ana',
          size: { w: 300, h: 200 },
          transform: { x: 200, y: 150 },
          zone: { layout: 'free' },
        },
        {
          id: 'ana-mao',
          kind: 'zona',
          parentId: 'ana',
          size: { w: 200, h: 100 },
          transform: { x: 150, y: 60 },
          zone: { layout: 'fan', privacy: 'faceDown' },
        },
        {
          id: 'ana-reserva',
          kind: 'zona',
          parentId: 'ana',
          size: { w: 80, h: 80 },
          transform: { x: 250, y: 160 },
          zone: { layout: 'stack', privacy: 'hidden' },
        },
        { id: 'ana-c1', kind: 'carta', status: 'faceUp', parentId: 'ana-mao' },
        { id: 'ana-segredo', kind: 'carta', parentId: 'ana-reserva' },
        { id: 'solta', kind: 'carta', status: 'faceUp', transform: { x: 600, y: 400 } },
      ].map((piece) => ({ type: 'createPiece', piece })),
    });
    if (!r.ok) throw new Error(r.error);
    m.clearHistory();
    return m;
  }

  function renderAs(m: Manager, viewer: string) {
    const stageRef = createRef<Konva.Stage>();
    const ui = (v: string) => (
      <ManagerProvider manager={m}>
        <ViewerProvider viewer={v}>
          <Table stageRef={stageRef} />
        </ViewerProvider>
      </ManagerProvider>
    );
    const { rerender } = render(ui(viewer));
    const node = (id: string) => stageRef.current!.findOne<Konva.Group>(`#${id}`);
    const text = (id: string) => node(id)?.findOne<Konva.Text>('Text')?.text();
    return { node, text, as: (v: string) => rerender(ui(v)) };
  }

  it('outro jogador vê a mão virada e não vê a reserva; o dono vê tudo', () => {
    const m = setupPlayers();
    const { node, text, as } = renderAs(m, 'bia');
    expect(text('ana-c1')).toBe('verso');
    expect(node('ana-segredo')).toBeUndefined();
    expect(node('ana-reserva')).toBeDefined();
    as('ana');
    expect(text('ana-c1')).toBe('frente');
    expect(node('ana-segredo')).toBeDefined();
  });

  it('só o dono arrasta; soltar na área de outro é recusado', () => {
    const m = setupPlayers();
    const { node } = renderAs(m, 'bia');
    expect(node('ana-c1')!.draggable()).toBe(false);
    expect(node('ana')!.draggable()).toBe(false);
    expect(node('solta')!.draggable()).toBe(true);
    act(() => {
      node('solta')!.fire('dragstart');
      node('solta')!.position({ x: 150, y: 110 }); // em cima da mão da Ana
      node('solta')!.fire('dragmove');
      node('solta')!.fire('dragend');
    });
    expect(m.getState().pieces.solta?.parentId).toBeNull();
    expect(m.getState().log.at(-1)?.event.type).not.toBe('piecePlaced');
  });

  it('apertar numa peça de outro jogador não chega à mesa (não vira pan)', () => {
    const m = setupPlayers();
    const { node } = renderAs(m, 'bia');
    const stage = node('ana')!.getStage()!;
    const naMesa = vi.fn();
    stage.on('mousedown', naMesa);
    const press = (id: string) =>
      node(id)!
        .findOne('Rect')!
        .fire('mousedown', { evt: new MouseEvent('mousedown') }, true);
    press('ana-c1'); // da Ana: para na peça
    press('ana');
    expect(naMesa).not.toHaveBeenCalled();
    press('solta'); // sem dono: segue normal
    expect(naMesa).toHaveBeenCalledTimes(1);
  });

  it('a jogada sai com o jogador da tela como actor', () => {
    const m = setupPlayers();
    const { node } = renderAs(m, 'ana');
    act(() => {
      node('solta')!.fire('dragstart');
      node('solta')!.position({ x: 150, y: 110 });
      node('solta')!.fire('dragmove');
      node('solta')!.fire('dragend');
    });
    expect(m.getState().pieces.solta?.parentId).toBe('ana-mao');
    expect(m.getState().log.at(-1)).toMatchObject({ actor: 'ana' });
  });
});
