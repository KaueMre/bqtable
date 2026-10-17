import { useState } from 'react';
import {
  createManager,
  gridSlot,
  spawn,
  type Manager,
  type Piece,
  type PieceInit,
  type Prefab,
} from '@/engine/core';
import { ManagerProvider, useDispatch, useGame, useUndo } from '@/engine/react';
import { defaultGestures, type GestureHandler } from '@/engine/render';
import { Table } from '@/engine/render/konva';
import { EventLog } from '@/engine/ui/EventLog';
import { cardFace } from './faces';
import { zonaPiramide } from './piramide';

const CARD = { w: 64, h: 90 };
const FOCO = ['Traço', 'Sombra', 'Cor'];

/**
 * Exemplo de tabuleiro de jogador como componente: uma zona livre com Tableau, Foco (com as
 * fichas), Descarte e Mão dentro. Cada chamada cria uma instância com ids próprios.
 */
const playerBoard: Prefab<{ id: string; name: string; x: number; y: number }> = ({
  id,
  name,
  x,
  y,
}) => {
  const part = (suffix: string, init: Omit<PieceInit, 'id' | 'kind' | 'parentId'>): PieceInit => ({
    id: `${id}-${suffix}`,
    kind: 'parte',
    parentId: id,
    ...init,
  });
  return [
    {
      id,
      kind: 'tabuleiro',
      faces: { default: `Tabuleiro de ${name}` },
      size: { w: 600, h: 440 },
      transform: { x, y, scale: 0.7 },
      zone: { layout: 'free', accepts: { kinds: ['carta', 'parte'] } },
    },
    zonaPiramide({
      id: `${id}-tableau`,
      kind: 'parte',
      parentId: id,
      x: 190,
      y: 140,
      rows: 3,
      card: CARD,
      accepts: { kinds: ['carta'] },
      statusOnEnter: 'faceUp',
    }),
    part('foco', {
      faces: { default: 'Foco' },
      size: { w: 220, h: 66 },
      transform: { x: 480, y: 70 },
      zone: {
        layout: 'grid',
        accepts: { kinds: ['ficha'] },
        grid: { cols: 10, rows: 3, cell: { w: 22, h: 22 } },
      },
    }),
    ...FOCO.map((label, row) => ({
      id: `${id}-foco-${row}`,
      kind: 'ficha',
      faces: { default: label[0]! },
      parentId: `${id}-foco`,
      slot: gridSlot(0, row),
    })),
    part('descarte', {
      faces: { default: 'Descarte' },
      size: { w: 76, h: 104 },
      transform: { x: 520, y: 200 },
      zone: { layout: 'stack', accepts: { kinds: ['carta'] }, statusOnEnter: 'faceUp' },
    }),
    part('mao', {
      faces: { default: 'Mão' },
      size: { w: 560, h: 120 },
      transform: { x: 300, y: 370 },
      zone: {
        layout: 'fan',
        accepts: { kinds: ['carta'] },
        statusOnEnter: 'faceUp',
        fan: { spacing: 50, arc: 12 },
      },
    }),
  ];
};

const HUES = [10, 220, 140, 30, 260, 330, 190, 90, 300, 50, 170, 0];

function createTabuleiroManager(): Manager {
  const m = createManager({ seed: Date.now() });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    defaults: {
      size: CARD,
      faces: { faceDown: cardFace({ label: '', hue: 200, variant: 'back' }) },
    },
  });
  m.registerKind({ kind: 'ficha', defaults: { size: { w: 18, h: 18 } } });
  for (const kind of ['tabuleiro', 'parte', 'zona']) m.registerKind({ kind });
  const run = (cmd: Parameters<Manager['dispatch']>[0]) => {
    const r = m.dispatch(cmd);
    if (!r.ok) throw new Error(r.error);
  };
  run(spawn(playerBoard({ id: 'ana', name: 'Ana', x: 240, y: 380 })));
  run(spawn(playerBoard({ id: 'bia', name: 'Bia', x: 710, y: 380 })));
  run(
    spawn([
      {
        id: 'baralho',
        kind: 'zona',
        faces: { default: 'Baralho' },
        size: { w: 80, h: 110 },
        transform: { x: 475, y: 90 },
        zone: { layout: 'stack', accepts: { kinds: ['carta'] }, statusOnEnter: 'faceDown' },
      },
      ...HUES.map((hue, i) => ({
        id: `carta-${i + 1}`,
        kind: 'carta',
        status: 'faceDown',
        parentId: 'baralho',
        faces: { faceUp: cardFace({ label: `Carta ${i + 1}`, hue }) },
      })),
    ]),
  );
  m.clearHistory();
  return m;
}

const flip = (p: Piece) => (p.status === 'faceDown' ? 'faceUp' : 'faceDown');

const gestures: GestureHandler = (gesture, piece, state) =>
  gesture.type === 'activate'
    ? piece.kind === 'carta'
      ? { type: 'setStatus', id: piece.id, status: flip(piece) }
      : null
    : defaultGestures(gesture, piece, state);

/**
 * O tabuleiro se arrasta inteiro; as partes dentro dele ficam presas a ele. Kinds separados
 * ('tabuleiro' e 'parte') impedem soltar um tabuleiro dentro do outro.
 */
const canDrag = (p: Piece) => !p.zone || p.kind === 'tabuleiro';

const NAMES = ['Caio', 'Duda', 'Edu', 'Fê'];

function Toolbar() {
  const dispatch = useDispatch();
  const { undo, canUndo } = useUndo();
  const boards = useGame(
    (s) => Object.values(s.game.pieces).filter((p) => p.kind === 'tabuleiro').length,
  );
  const lastError = useGame((s) => s.lastError);
  const name = NAMES[(boards - 2) % NAMES.length]!;
  return (
    <>
      <div className="demo-buttons">
        <button
          onClick={() =>
            dispatch(spawn(playerBoard({ id: `jogador-${boards + 1}`, name, x: 475, y: 420 })))
          }
        >
          Adicionar tabuleiro ({name})
        </button>
        <button onClick={() => dispatch({ type: 'shuffle', zone: 'baralho' })}>Embaralhar</button>
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

/** Fase 5 (extra): tabuleiro reutilizável que leva tudo junto ao mover e girar. */
export function TabuleiroDemo() {
  const [manager] = useState(createTabuleiroManager);
  return (
    <ManagerProvider manager={manager}>
      <p className="demo-hint">
        Dois tabuleiros criados pela mesma definição. Arraste um tabuleiro pelo fundo dele: Tableau,
        Foco, Descarte, Mão e o que estiver dentro vão juntos · clique no tabuleiro e gire pela
        alça: o conteúdo gira junto · "Adicionar tabuleiro" cria outro numa jogada só (um Desfazer
        remove tudo).
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
