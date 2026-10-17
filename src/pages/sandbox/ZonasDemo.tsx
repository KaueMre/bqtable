import { useState } from 'react';
import { createManager, type Manager, type Piece } from '@/engine/core';
import { ManagerProvider, useDispatch, useGame, useUndo } from '@/engine/react';
import { defaultGestures, type GestureHandler } from '@/engine/render';
import { Table } from '@/engine/render/konva';
import { EventLog } from '@/engine/ui/EventLog';
import { cardFace } from './faces';
import { zonaPiramide } from './piramide';

const CARD = { w: 80, h: 112 };

const MINDSET = [
  { label: 'Rabisco', hue: 10 },
  { label: 'Lápis 6B', hue: 220 },
  { label: 'Aquarela', hue: 140 },
  { label: 'Decalque', hue: 30 },
  { label: 'Esfumado', hue: 260 },
  { label: 'Respingo', hue: 330 },
  { label: 'Pontilhismo', hue: 190 },
];

function createZonasManager(): Manager {
  const m = createManager({ seed: Date.now() });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: {
      size: CARD,
      faces: { faceDown: cardFace({ label: '', hue: 200, variant: 'back' }) },
    },
  });
  m.registerKind({ kind: 'ficha', defaults: { size: { w: 36, h: 36 } } });
  m.registerKind({ kind: 'zona' });

  const create = (piece: object) => {
    const r = m.dispatch({ type: 'createPiece', piece });
    if (!r.ok) throw new Error(r.error);
  };
  const zone = (
    id: string,
    label: string,
    zone: object,
    x: number,
    y: number,
    w: number,
    h: number,
    extra = {},
  ) =>
    create({
      id,
      kind: 'zona',
      faces: { default: label },
      size: { w, h },
      transform: { x, y },
      zone,
      ...extra,
    });

  zone(
    'trilha',
    'Trilha (só fichas)',
    {
      layout: 'grid',
      accepts: { kinds: ['ficha'] },
      grid: { cols: 6, rows: 1, cell: { w: 48, h: 48 } },
    },
    194,
    44,
    288,
    48,
  );
  zone(
    'baralho',
    'Baralho',
    { layout: 'stack', accepts: { kinds: ['carta'] }, statusOnEnter: 'faceDown' },
    90,
    210,
    110,
    150,
  );
  create(
    zonaPiramide({
      id: 'tableau',
      kind: 'zona',
      x: 410,
      y: 230,
      rows: 2,
      card: CARD,
      accepts: { tags: ['mindset'] },
      statusOnEnter: 'faceUp',
    }),
  );
  zone(
    'mao',
    'Mão',
    {
      layout: 'fan',
      accepts: { kinds: ['carta'] },
      statusOnEnter: 'faceUp',
      fan: { spacing: 60, arc: 16 },
      capacity: 6,
    },
    410,
    470,
    440,
    150,
  );
  zone('area', 'Área livre', { layout: 'free' }, 800, 300, 230, 300);
  create({
    id: 'sleeve',
    kind: 'zona',
    faces: { default: 'Sleeve' },
    size: { w: 100, h: 140 },
    parentId: 'area',
    transform: { x: 115, y: 170 },
    zone: { layout: 'stack', accepts: { tags: ['camada'] }, stack: { dx: 0, dy: 0 } },
  });

  MINDSET.forEach(({ label, hue }) =>
    create({
      id: label,
      kind: 'carta',
      tags: ['mindset'],
      status: 'faceDown',
      parentId: 'baralho',
      faces: { faceUp: cardFace({ label, hue }) },
    }),
  );
  [
    { id: 'Traço', hue: 0 },
    { id: 'Sombra', hue: 240 },
    { id: 'Cor', hue: 120 },
  ].forEach(({ id, hue }, i) =>
    create({
      id,
      kind: 'carta',
      tags: ['camada'],
      status: 'faceUp',
      faces: { faceUp: cardFace({ label: id, hue, variant: 'transparent' }) },
      transform: { x: 640 + i * 30, y: 560 + i * 8 },
    }),
  );
  ['F1', 'F2', 'F3'].forEach((id, i) =>
    create({ id, kind: 'ficha', parentId: 'trilha', slot: `${i},0` }),
  );
  m.clearHistory();
  return m;
}

const flip = (p: Piece) => (p.status === 'faceDown' ? 'faceUp' : 'faceDown');

/** Duplo clique vira cartas; o resto segue o padrão. */
const gestures: GestureHandler = (gesture, piece, state) =>
  gesture.type === 'activate'
    ? piece.kind === 'carta'
      ? { type: 'setStatus', id: piece.id, status: flip(piece) }
      : null
    : defaultGestures(gesture, piece, state);

/** Zonas fixas na mesa, menos a área livre e a sleeve (para mostrar zona dentro de zona). */
const canDrag = (p: Piece) => !p.zone || p.id === 'area' || p.id === 'sleeve';

function Toolbar() {
  const dispatch = useDispatch();
  const { undo, canUndo } = useUndo();
  const lastError = useGame((s) => s.lastError);
  return (
    <>
      <div className="demo-buttons">
        <button onClick={() => dispatch({ type: 'shuffle', zone: 'baralho' })}>
          Embaralhar baralho
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
  return <EventLog log={useGame((s) => s.game.log)} limit={14} />;
}

/** Fase 5: zonas com layouts grid, stack, fan, slots e free (com zona dentro de zona). */
export function ZonasDemo() {
  const [manager] = useState(createZonasManager);
  return (
    <ManagerProvider manager={manager}>
      <p className="demo-hint">
        Arraste cartas do baralho para a mão ou para o Tableau (encaixam no slot mais perto) ·
        fichas só entram na trilha · as camadas transparentes entram na sleeve · arraste a área
        livre para ver a sleeve ir junto · durante o arrasto, verde = aceita, azul = solta aqui,
        vermelho = recusa.
      </p>
      <div className="demo">
        <div className="demo-stage demo-stage--wide">
          <Table onGesture={gestures} canDrag={canDrag} />
        </div>
        <div className="demo-panel">
          <Toolbar />
          <Log />
        </div>
      </div>
    </ManagerProvider>
  );
}
