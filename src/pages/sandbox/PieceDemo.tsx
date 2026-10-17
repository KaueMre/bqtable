import { useState } from 'react';
import { z } from 'zod';
import {
  createKindRegistry,
  getFace,
  move,
  rotateBy,
  setAttr,
  setStatus,
  type AttrValue,
  type Piece,
} from '@/engine/core';

const kinds = createKindRegistry();
kinds.register({
  kind: 'mindset-card',
  statuses: ['faceDown', 'faceUp', 'covered'],
  transitions: { faceDown: ['faceUp'], faceUp: ['faceDown', 'covered'], covered: ['faceUp'] },
  attributes: z.object({ reputacao: z.number().int().min(1).max(3) }),
  defaults: {
    size: { w: 126, h: 176 },
    faces: { faceDown: 'verso', faceUp: 'Rabisco no guardanapo' },
  },
});

function initialPiece(): Piece {
  const r = kinds.create({
    id: 'T01',
    kind: 'mindset-card',
    attributes: { reputacao: 1 },
    transform: { x: 40, y: 30 },
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Fase 1: peça isolada, só funções puras do core e validação do registro de kinds. */
export function PieceDemo() {
  const [piece, setPiece] = useState(initialPiece);
  const [message, setMessage] = useState('');

  const apply = (next: Piece, msg = '') => {
    setPiece(next);
    setMessage(msg);
  };
  const tryStatus = (to: string) => {
    const v = kinds.validateStatus(piece, to);
    if (v === true) apply(setStatus(piece, to));
    else setMessage(`Recusado: ${v}`);
  };
  const tryAttr = (key: string, value: AttrValue) => {
    const v = kinds.validateAttr(piece, key, value);
    if (v === true) apply(setAttr(piece, key, value));
    else setMessage(`Recusado: ${v}`);
  };
  const { x, y, rotation } = piece.transform;
  const reputacao = Number(piece.attributes.reputacao);

  return (
    <div className="demo">
      <div className="demo-table">
        <div
          className={`demo-piece demo-piece--${piece.status}`}
          style={{
            width: piece.size.w,
            height: piece.size.h,
            transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
          }}
        >
          {getFace(piece)}
        </div>
      </div>
      <div className="demo-panel">
        <div className="demo-buttons">
          <button onClick={() => tryStatus(piece.status === 'faceDown' ? 'faceUp' : 'faceDown')}>
            Virar
          </button>
          <button onClick={() => tryStatus('covered')}>Cobrir</button>
          <button onClick={() => tryStatus('faceUp')}>Descobrir</button>
          <button onClick={() => apply(rotateBy(piece, 90))}>Girar 90°</button>
          <button onClick={() => apply(move(piece, { x: (x + 40) % 280, y }))}>Mover →</button>
          <button onClick={() => tryAttr('reputacao', reputacao + 1)}>Reputação +1</button>
          <button onClick={() => tryAttr('reputacao', reputacao - 1)}>Reputação −1</button>
          <button onClick={() => apply(initialPiece())}>Reiniciar</button>
        </div>
        <p className="demo-message" role="status">
          {message}
        </p>
        <pre className="demo-state">{JSON.stringify(piece, null, 2)}</pre>
      </div>
    </div>
  );
}
