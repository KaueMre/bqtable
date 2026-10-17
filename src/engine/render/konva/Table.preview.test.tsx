import { act, render, screen } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createManager, type Manager } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({ kind: 'carta', defaults: { size: { w: 60, h: 90 } } });
  m.registerKind({ kind: 'zona' });
  for (const piece of [
    { id: 'A', kind: 'carta', faces: { default: 'Rosa: Foco +1' }, transform: { x: 50, y: 50 } },
    { id: 'B', kind: 'carta', faces: { default: 'Caveira' }, transform: { x: 150, y: 50 } },
    { id: 'mesa', kind: 'zona', size: { w: 200, h: 100 }, zone: { layout: 'free' } },
  ]) {
    const r = m.dispatch({ type: 'createPiece', piece });
    if (!r.ok) throw new Error(r.error);
  }
  m.clearHistory();
  return m;
}

function renderTable(m = setup()) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={m}>
      <Table stageRef={stageRef} />
    </ManagerProvider>,
  );
  const node = (id: string) => stageRef.current!.findOne<Konva.Group>(`#${id}`)!;
  const enter = (id: string) => act(() => void node(id).fire('mouseenter'));
  const leave = (id: string) => act(() => void node(id).fire('mouseleave'));
  const alt = (type: 'keydown' | 'keyup') =>
    act(() => void window.dispatchEvent(new KeyboardEvent(type, { key: 'Alt' })));
  const preview = () => screen.queryByRole('img', { name: /Pré-visualização/ });
  return { stage: stageRef.current!, enter, leave, alt, preview };
}

describe('Table: preview com Alt', () => {
  it('Alt com o ponteiro sobre a peça mostra a peça ampliada; soltar esconde', () => {
    const { enter, alt, preview } = renderTable();
    enter('A');
    expect(preview()).toBeNull(); // só passar o mouse não mostra
    alt('keydown');
    expect(preview()).toHaveTextContent('Rosa: Foco +1');
    alt('keyup');
    expect(preview()).toBeNull();
  });

  it('segurar o Alt e passar sobre as peças: acompanha o ponteiro; fora delas some', () => {
    const { enter, leave, alt, preview } = renderTable();
    alt('keydown');
    expect(preview()).toBeNull();
    enter('A');
    expect(preview()).toHaveTextContent('Rosa');
    leave('A');
    enter('B');
    expect(preview()).toHaveTextContent('Caveira');
    leave('B');
    expect(preview()).toBeNull();
  });

  it('o Alt também vem do movimento do mouse (jogo sem o foco do teclado)', () => {
    const { stage, enter, preview } = renderTable();
    enter('A');
    act(() => void stage.fire('mousemove', { evt: { altKey: true } }));
    expect(preview()).toHaveTextContent('Rosa');
    act(() => void stage.fire('mousemove', { evt: { altKey: false } }));
    expect(preview()).toBeNull();
  });

  it('dois toques no Alt fixam; com outro Alt, mostra a outra peça; dois toques soltam', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      const { enter, leave, alt, preview } = renderTable();
      enter('A');
      alt('keydown');
      alt('keyup');
      vi.advanceTimersByTime(150);
      alt('keydown');
      alt('keyup');
      expect(preview()).toHaveAccessibleName('Pré-visualização fixa');
      expect(preview()).toHaveTextContent('Rosa');
      leave('A');
      expect(preview()).toHaveTextContent('Rosa'); // fixo: fica mesmo saindo da peça
      vi.advanceTimersByTime(1000);
      enter('B');
      alt('keydown'); // segurar o Alt sobre outra peça mostra ela por cima do fixo
      expect(preview()).toHaveTextContent('Caveira');
      alt('keyup');
      expect(preview()).toHaveTextContent('Rosa');
      leave('B');
      vi.advanceTimersByTime(1000);
      alt('keydown');
      alt('keyup');
      vi.advanceTimersByTime(150);
      alt('keydown'); // dois toques em qualquer lugar: some
      alt('keyup');
      expect(preview()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('zona sem imagem não tem preview; perder o foco solta o Alt', () => {
    const { enter, leave, alt, preview } = renderTable();
    alt('keydown');
    enter('mesa');
    expect(preview()).toBeNull();
    leave('mesa');
    enter('A');
    expect(preview()).not.toBeNull();
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(preview()).toBeNull();
  });
});
