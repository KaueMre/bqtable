import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { createManager, type Command, type Manager } from '@/engine/core';
import { useDispatch, useGame, useGlobals, usePiece, usePieceIds, useUndo } from './hooks';
import { ManagerProvider } from './ManagerProvider';

function setup(): Manager {
  const m = createManager({ seed: 1, globals: { a: 0, b: 0 } });
  m.registerKind({ kind: 'ficha' });
  for (const id of ['A', 'B']) {
    m.dispatch({ type: 'createPiece', piece: { id, kind: 'ficha', attributes: { valor: 0 } } });
  }
  m.clearHistory();
  return m;
}

const send = (m: Manager, cmd: Command) => act(() => void m.dispatch(cmd));

describe('usePiece', () => {
  it('re-renderiza só a peça que mudou', () => {
    const m = setup();
    const renders: Record<string, number> = { A: 0, B: 0 };
    function Row({ id }: { id: string }) {
      const piece = usePiece(id);
      renders[id]! += 1;
      return <li>{`${id}=${String(piece?.attributes.valor)}`}</li>;
    }
    render(
      <ManagerProvider manager={m}>
        <Row id="A" />
        <Row id="B" />
      </ManagerProvider>,
    );
    expect(renders).toEqual({ A: 1, B: 1 });

    send(m, { type: 'setAttr', id: 'B', key: 'valor', value: 7 });
    expect(screen.getByText('B=7')).toBeInTheDocument();
    expect(renders).toEqual({ A: 1, B: 2 });

    send(m, { type: 'setGlobal', key: 'a', value: 1 });
    expect(renders).toEqual({ A: 1, B: 2 });
  });
});

describe('usePieceIds', () => {
  it('muda quando entra ou sai peça, não quando um atributo muda', () => {
    const m = setup();
    let renders = 0;
    function List() {
      const ids = usePieceIds();
      renders += 1;
      return <p>{ids.join(',')}</p>;
    }
    render(
      <ManagerProvider manager={m}>
        <List />
      </ManagerProvider>,
    );
    expect(screen.getByText('A,B')).toBeInTheDocument();

    send(m, { type: 'setAttr', id: 'A', key: 'valor', value: 3 });
    expect(renders).toBe(1);

    send(m, { type: 'createPiece', piece: { id: 'C', kind: 'ficha' } });
    expect(screen.getByText('A,B,C')).toBeInTheDocument();
    send(m, { type: 'removePiece', id: 'A' });
    expect(screen.getByText('B,C')).toBeInTheDocument();
    expect(renders).toBe(3);
  });

  it('aceita filtro', () => {
    const m = setup();
    send(m, { type: 'setAttr', id: 'B', key: 'valor', value: 5 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ManagerProvider manager={m}>{children}</ManagerProvider>
    );
    const { result } = renderHook(() => usePieceIds((p) => p.attributes.valor === 5), { wrapper });
    expect(result.current).toEqual(['B']);
  });
});

describe('useGlobals', () => {
  it('seletor que monta objeto não entra em loop nem re-renderiza à toa', () => {
    const m = setup();
    let renders = 0;
    function Panel() {
      const { a } = useGlobals((g) => ({ a: g.a }));
      renders += 1;
      return <p>{`a=${String(a)}`}</p>;
    }
    render(
      <ManagerProvider manager={m}>
        <Panel />
      </ManagerProvider>,
    );
    send(m, { type: 'setGlobal', key: 'b', value: 9 });
    expect(renders).toBe(1);
    send(m, { type: 'setGlobal', key: 'a', value: 4 });
    expect(screen.getByText('a=4')).toBeInTheDocument();
    expect(renders).toBe(2);
  });
});

describe('useDispatch e useUndo', () => {
  it('despacham pelo Gestor e acompanham o desfazer', () => {
    const m = setup();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ManagerProvider manager={m}>{children}</ManagerProvider>
    );
    const { result } = renderHook(
      () => ({ dispatch: useDispatch(), ...useUndo(), a: useGame((s) => s.game.globals.a) }),
      { wrapper },
    );
    const dispatch = result.current.dispatch;
    expect(result.current.canUndo).toBe('nada para desfazer');

    act(() => {
      expect(dispatch({ type: 'setGlobal', key: 'a', delta: 2 }).ok).toBe(true);
    });
    expect(result.current.a).toBe(2);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.dispatch).toBe(dispatch);

    act(() => void result.current.undo());
    expect(result.current.a).toBe(0);
    expect(result.current.canUndo).toBe('nada para desfazer');

    act(() => void m.dispatch({ type: 'setGlobal', key: 'a', value: 1 }));
    act(() => m.clearHistory());
    expect(result.current.canUndo).toBe('nada para desfazer');
  });
});

describe('lastError', () => {
  it('guarda o motivo da recusa e limpa na próxima mudança', () => {
    const m = setup();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ManagerProvider manager={m}>{children}</ManagerProvider>
    );
    const { result } = renderHook(
      () => ({ dispatch: useDispatch(), ...useUndo(), error: useGame((s) => s.lastError) }),
      { wrapper },
    );
    expect(result.current.error).toBeNull();

    act(() => void result.current.dispatch({ type: 'move', id: 'Z', x: 0, y: 0 }));
    expect(result.current.error).toBe('peça "Z" não existe');

    act(() => void result.current.dispatch({ type: 'move', id: 'A', x: 1, y: 0 }));
    expect(result.current.error).toBeNull();

    act(() => void result.current.undo());
    act(() => void result.current.undo());
    expect(result.current.error).toBe('nada para desfazer');
  });
});

describe('ManagerProvider', () => {
  it('troca de Gestor troca o estado mostrado', () => {
    const m1 = setup();
    const m2 = setup();
    m2.dispatch({ type: 'setAttr', id: 'A', key: 'valor', value: 9 });
    function Value() {
      return <p>{`A=${String(usePiece('A')?.attributes.valor)}`}</p>;
    }
    const { rerender } = render(
      <ManagerProvider manager={m1}>
        <Value />
      </ManagerProvider>,
    );
    expect(screen.getByText('A=0')).toBeInTheDocument();
    rerender(
      <ManagerProvider manager={m2}>
        <Value />
      </ManagerProvider>,
    );
    expect(screen.getByText('A=9')).toBeInTheDocument();
  });

  it('hooks fora do Provider dão erro claro', () => {
    expect(() => renderHook(() => usePiece('A'))).toThrow('dentro de <ManagerProvider>');
  });
});
