import { act, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { createManager, type Manager } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from './Table';

function setup(): Manager {
  const m = createManager({ seed: 1 });
  m.registerKind({ kind: 'zona' });
  m.registerKind({ kind: 'carta', defaults: { size: { w: 60, h: 90 } } });
  for (const piece of [
    // com nome em texto: o rótulo é o nome
    {
      id: 'mao',
      kind: 'zona',
      faces: { default: 'Mão' },
      size: { w: 200, h: 100 },
      transform: { x: 100, y: 50 },
      zone: { layout: 'fan' },
    },
    // com imagem (a arte do tabuleiro): sem rótulo
    {
      id: 'tabuleiro',
      kind: 'zona',
      faces: { default: 'data:image/png;base64,AAAA' },
      size: { w: 200, h: 100 },
      transform: { x: 100, y: 300 },
      zone: { layout: 'free' },
    },
    // casas sobre a arte: nunca desenham a guia
    {
      id: 'casas',
      kind: 'zona',
      size: { w: 200, h: 100 },
      transform: { x: 400, y: 300 },
      zone: { layout: 'slots', outline: false, slots: [{ id: 's1', x: 50, y: 50 }] },
    },
    { id: 'c1', kind: 'carta', transform: { x: 600, y: 600 } },
  ]) {
    const r = m.dispatch({ type: 'createPiece', piece });
    if (!r.ok) throw new Error(r.error);
  }
  m.clearHistory();
  return m;
}

function renderTable(guides?: boolean) {
  const stageRef = createRef<Konva.Stage>();
  render(
    <ManagerProvider manager={setup()}>
      <Table stageRef={stageRef} guides={guides} />
    </ManagerProvider>,
  );
  const node = (id: string) => stageRef.current!.findOne<Konva.Group>(`#${id}`)!;
  const textos = (id: string) =>
    node(id)
      .find<Konva.Text>('Text')
      .map((t) => t.text());
  /** Contornos tracejados (zona e casas). */
  const tracejados = (id: string) =>
    node(id)
      .find<Konva.Rect>('Rect')
      .filter((r) => (r.dash()?.length ?? 0) > 0).length;
  return { node, textos, tracejados };
}

describe('Table: contornos e rótulos das zonas', () => {
  it('zona com imagem não mostra o id; com nome em texto, mostra o nome', () => {
    const { textos } = renderTable();
    expect(textos('mao')).toEqual(['Mão']);
    expect(textos('tabuleiro')).toEqual([]);
  });

  it('outline: false nunca desenha a guia (casas sobre a arte)', () => {
    const { tracejados } = renderTable();
    expect(tracejados('mao')).toBe(1);
    expect(tracejados('casas')).toBe(0);
  });

  it('guias desligadas: sem contornos nem rótulos; o arrasto ainda destaca onde soltar', () => {
    const { node, textos, tracejados } = renderTable(false);
    expect(tracejados('mao')).toBe(0);
    expect(textos('mao')).toEqual([]);
    act(() => void node('c1').fire('dragstart'));
    // a mão aceita a carta: contorno verde cheio durante o arrasto
    expect(
      node('mao')
        .find<Konva.Rect>('Rect')
        .some((r) => r.stroke() === '#2da44e'),
    ).toBe(true);
    // o encaixe livre das casas também aparece, preenchido
    expect(
      node('casas')
        .find<Konva.Rect>('Rect')
        .some((r) => r.fill() === 'rgb(45 164 78 / 0.25)'),
    ).toBe(true);
    act(() => void node('c1').fire('dragend'));
    expect(tracejados('mao')).toBe(0);
  });
});
