import { useState } from 'react';
import { createManager, type Manager, type PieceId } from '@/engine/core';
import {
  ManagerProvider,
  useDispatch,
  useGame,
  usePiece,
  usePieceIds,
  useUndo,
} from '@/engine/react';
import { defaultGestures, type GestureHandler } from '@/engine/render';
import { Table } from '@/engine/render/konva';
import { EventLog } from '@/engine/ui/EventLog';
import { CARD, cardFace } from './faces';

const CARDS = [
  { label: 'Rabisco', hue: 10 },
  { label: 'Lápis 6B', hue: 220 },
  { label: 'Aquarela', hue: 140 },
  { label: 'Decalque', hue: 30 },
  { label: 'Esfumado', hue: 260 },
  { label: 'Respingo', hue: 330 },
];

function createMesaManager(): Manager {
  const m = createManager({ seed: 4 });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: {
      size: CARD,
      faces: { faceDown: cardFace({ label: '', hue: 200, variant: 'back' }) },
    },
  });
  CARDS.forEach(({ label, hue }, i) => {
    m.dispatch({
      type: 'createPiece',
      piece: {
        id: label,
        kind: 'carta',
        status: i % 2 ? 'faceDown' : 'faceUp',
        faces: { faceUp: cardFace({ label, hue }) },
        transform: { x: 110 + (i % 3) * 150, y: 120 + Math.floor(i / 3) * 200, z: i },
      },
    });
  });
  m.clearHistory();
  return m;
}

const flip = (status: string) => (status === 'faceDown' ? 'faceUp' : 'faceDown');

/** Duplo clique vira a carta; o resto segue o padrão (arrastar = move, girar = rotate). */
const gestures: GestureHandler = (gesture, piece, state) =>
  gesture.type === 'activate'
    ? { type: 'setStatus', id: piece.id, status: flip(piece.status) }
    : defaultGestures(gesture, piece, state);

function SelectedPanel({ id }: { id: PieceId | null }) {
  const piece = usePiece(id ?? '');
  const dispatch = useDispatch();
  if (!piece) return <p className="demo-hint">Clique numa carta para selecionar.</p>;
  return (
    <div className="demo-buttons">
      <strong>{piece.id}</strong>
      <button
        onClick={() =>
          dispatch({ type: 'rotate', id: piece.id, rotation: piece.transform.rotation + 90 })
        }
      >
        Girar 90°
      </button>
      <button
        onClick={() => dispatch({ type: 'setStatus', id: piece.id, status: flip(piece.status) })}
      >
        Virar
      </button>
    </div>
  );
}

function StateRow({ id, selected }: { id: PieceId; selected: boolean }) {
  const piece = usePiece(id);
  if (!piece) return null;
  const { x, y, rotation, z } = piece.transform;
  return (
    <tr className={selected ? 'demo-row-selected' : undefined}>
      <td>{id}</td>
      <td>{Math.round(x)}</td>
      <td>{Math.round(y)}</td>
      <td>{rotation}°</td>
      <td>{z}</td>
      <td>{piece.status}</td>
    </tr>
  );
}

function StatePanel({ selected }: { selected: PieceId | null }) {
  const ids = usePieceIds();
  return (
    <table className="demo-table-list" aria-label="Estado das peças">
      <thead>
        <tr>
          <th>Peça</th>
          <th>x</th>
          <th>y</th>
          <th>Rot.</th>
          <th>z</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => (
          <StateRow key={id} id={id} selected={id === selected} />
        ))}
      </tbody>
    </table>
  );
}

function Toolbar() {
  const { undo, canUndo } = useUndo();
  const lastError = useGame((s) => s.lastError);
  return (
    <div className="demo-buttons">
      <button onClick={() => undo()} disabled={canUndo !== true}>
        Desfazer
      </button>
      {lastError && <span className="demo-message">Recusado: {lastError}</span>}
    </div>
  );
}

/** Fase 4: mesa Konva com arrastar, girar, virar, zoom e pan; painel mostra o estado. */
export function MesaDemo() {
  const [manager] = useState(createMesaManager);
  const [selected, setSelected] = useState<PieceId | null>(null);
  return (
    <ManagerProvider manager={manager}>
      <p className="demo-hint">
        Arraste as cartas · clique para selecionar e gire pela alça · duplo clique vira · roda do
        mouse dá zoom · arraste o vazio para mover a mesa.
      </p>
      <div className="demo">
        <div className="demo-stage">
          <Table onGesture={gestures} onSelect={setSelected} />
        </div>
        <div className="demo-panel">
          <SelectedPanel id={selected} />
          <Toolbar />
          <StatePanel selected={selected} />
          <Log />
        </div>
      </div>
    </ManagerProvider>
  );
}

function Log() {
  return <EventLog log={useGame((s) => s.game.log)} limit={12} />;
}
