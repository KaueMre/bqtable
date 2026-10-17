import { useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { createManager, isEvent, type Manager } from '@/engine/core';
import {
  ManagerProvider,
  useDispatch,
  useGame,
  useGlobals,
  usePiece,
  usePieceIds,
  useUndo,
} from '@/engine/react';
import { EventLog } from '@/engine/ui/EventLog';

function createBindingManager(): Manager {
  const m = createManager({ seed: 3, globals: { total: 0 } });
  m.registerKind({
    kind: 'ficha',
    attributes: z.object({ valor: z.number().int().min(0).max(9) }),
  });
  // total = soma dos valores; delta porque a reação pode rodar depois de outras mudanças
  m.registerRule({
    id: 'somar',
    react: (ev) =>
      isEvent(ev, 'attrChanged') && ev.key === 'valor'
        ? [{ type: 'setGlobal', key: 'total', delta: Number(ev.to) - Number(ev.from) }]
        : [],
  });
  for (const id of ['F1', 'F2', 'F3']) {
    m.dispatch({ type: 'createPiece', piece: { id, kind: 'ficha', attributes: { valor: 0 } } });
  }
  m.clearHistory();
  return m;
}

/** Pisca o elemento a cada renderização, para ver quem re-renderiza. */
function useRenderFlash<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.animate?.([{ background: '#fff8c5' }, { background: 'transparent' }], 600);
  });
  return ref;
}

function PieceRow({ id }: { id: string }) {
  const piece = usePiece(id);
  const dispatch = useDispatch();
  const ref = useRenderFlash<HTMLTableRowElement>();
  if (!piece) return null;
  const valor = Number(piece.attributes.valor);
  return (
    <tr ref={ref}>
      <td>{piece.id}</td>
      <td>{valor}</td>
      <td>{piece.transform.rotation}°</td>
      <td className="demo-buttons">
        <button onClick={() => dispatch({ type: 'setAttr', id, key: 'valor', delta: 1 })}>
          +1
        </button>
        <button onClick={() => dispatch({ type: 'setAttr', id, key: 'valor', delta: -1 })}>
          −1
        </button>
        <button
          onClick={() => dispatch({ type: 'rotate', id, rotation: piece.transform.rotation + 90 })}
        >
          Girar
        </button>
      </td>
    </tr>
  );
}

function PieceTable() {
  const ids = usePieceIds();
  const ref = useRenderFlash<HTMLTableElement>();
  return (
    <table className="demo-table-list" ref={ref}>
      <thead>
        <tr>
          <th>Ficha</th>
          <th>Valor</th>
          <th>Rotação</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => (
          <PieceRow key={id} id={id} />
        ))}
      </tbody>
    </table>
  );
}

function Toolbar() {
  const dispatch = useDispatch();
  const { undo, canUndo } = useUndo();
  const total = useGlobals((g) => g.total);
  const count = useGame((s) => Object.keys(s.game.pieces).length);
  const lastError = useGame((s) => s.lastError);
  return (
    <>
      <div className="demo-buttons">
        <strong>Total: {String(total)}</strong>
        <button
          onClick={() =>
            dispatch({
              type: 'createPiece',
              piece: { id: `F${count + 1}`, kind: 'ficha', attributes: { valor: 0 } },
            })
          }
        >
          Adicionar ficha
        </button>
        <button onClick={() => undo()} disabled={canUndo !== true}>
          Desfazer
        </button>
      </div>
      <p className="demo-message" role="status">
        {lastError && `Recusado: ${lastError}`}
      </p>
    </>
  );
}

function Log() {
  return <EventLog log={useGame((s) => s.game.log)} />;
}

/** Fase 3: hooks com seletores; cada linha pisca quando re-renderiza. */
export function BindingDemo() {
  const [manager] = useState(createBindingManager);
  return (
    <ManagerProvider manager={manager}>
      <div className="demo">
        <div className="demo-panel">
          <Toolbar />
          <PieceTable />
        </div>
        <div className="demo-panel">
          <Log />
        </div>
      </div>
    </ManagerProvider>
  );
}
