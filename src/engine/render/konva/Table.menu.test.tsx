import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { childrenOf, createManager, type Manager } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: { size: { w: 60, h: 90 } },
  });
  m.registerKind({ kind: 'zona' });
  const r = m.dispatch({
    type: 'batch',
    commands: [
      { id: 'A', kind: 'carta', status: 'faceUp', transform: { x: 50, y: 50 } },
      { id: 'B', kind: 'carta', status: 'faceUp', transform: { x: 150, y: 80, z: 1 } },
      {
        id: 'deck',
        kind: 'zona',
        faces: { default: 'Deck' },
        size: { w: 100, h: 140 },
        transform: { x: 400, y: 100, z: 2 },
        zone: { layout: 'stack', statusOnEnter: 'faceDown' },
      },
      {
        id: 'area',
        kind: 'zona',
        faces: { default: 'Área livre' },
        size: { w: 200, h: 140 },
        transform: { x: 400, y: 400, z: 3 },
        zone: { layout: 'free' },
      },
      {
        id: 'fichas',
        kind: 'zona',
        faces: { default: 'Fichas' },
        size: { w: 100, h: 100 },
        transform: { x: 700, y: 100, z: 4 },
        zone: { layout: 'stack', accepts: { kinds: ['ficha'] } },
      },
    ].map((piece) => ({ type: 'createPiece', piece })),
  });
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

function renderTable(m: Manager) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={m}>
      <Table stageRef={stageRef} />
    </ManagerProvider>,
  );
  const node = (id: string) => stageRef.current!.findOne<Konva.Group>(`#${id}`)!;
  const rightClick = (id: string) =>
    act(() => void node(id).fire('contextmenu', { evt: { preventDefault() {} } }));
  const menu = () => screen.queryByRole('menu', { name: 'Ações da peça' });
  return { node, rightClick, menu };
}

describe('Table: menu do botão direito', () => {
  it('mostra as funções da peça; Mover lista só os destinos que aceitam', async () => {
    const user = userEvent.setup();
    const m = setup();
    const { rightClick, menu } = renderTable(m);
    rightClick('A');
    const itens = within(menu()!)
      .getAllByRole('menuitem')
      .map((b) => b.textContent);
    expect(itens).toEqual(['Preview', 'Selecionar', 'Mover▸', 'Girar 90°']);
    await user.click(within(menu()!).getByRole('menuitem', { name: /Mover/ }));
    // o segundo nível fica fora da lista (que rola e cortaria o que sai dela)
    expect(menu()!.contains(screen.getByRole('menu', { name: 'Mover' }))).toBe(false);
    const destinos = within(screen.getByRole('menu', { name: 'Mover' }));
    expect(destinos.getAllByRole('menuitem').map((b) => b.textContent)).toEqual([
      'Deck',
      'Área livre',
    ]);
    await user.click(destinos.getByRole('menuitem', { name: 'Deck' }));
    expect(m.getState().pieces.A).toMatchObject({ parentId: 'deck', status: 'faceDown' });
    expect(menu()).toBeNull(); // escolher fecha o menu
  });

  it('com várias selecionadas, move o grupo mantendo o arranjo', async () => {
    const user = userEvent.setup();
    const m = setup();
    const { node, rightClick, menu } = renderTable(m);
    act(() => void node('A').fire('click'));
    act(() => void node('B').fire('click', { evt: { shiftKey: true } }));
    rightClick('A');
    await user.click(within(menu()!).getByRole('menuitem', { name: /Mover 2 peças/ }));
    await user.click(
      within(screen.getByRole('menu', { name: 'Mover 2 peças' })).getByRole('menuitem', {
        name: 'Área livre',
      }),
    );
    const { pieces } = m.getState();
    expect(childrenOf(pieces, 'area').map((p) => p.id)).toEqual(['A', 'B']);
    // A no centro da área (100, 70); B na mesma distância de antes (+100, +30)
    expect(pieces.A!.transform).toMatchObject({ x: 100, y: 70 });
    expect(pieces.B!.transform).toMatchObject({ x: 200, y: 100 });
  });

  it('girar, preview fixo e Esc', async () => {
    const user = userEvent.setup();
    const m = setup();
    const { rightClick, menu } = renderTable(m);
    rightClick('A');
    await user.click(within(menu()!).getByRole('menuitem', { name: 'Girar 90°' }));
    expect(m.getState().pieces.A!.transform.rotation).toBe(90);
    rightClick('B');
    await user.click(within(menu()!).getByRole('menuitem', { name: 'Preview' }));
    expect(screen.getByRole('img', { name: 'Pré-visualização fixa' })).toBeInTheDocument();
    rightClick('B');
    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
  });
});
