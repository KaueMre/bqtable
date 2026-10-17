import type { Draft } from 'immer';
import { castDraft } from 'immer';
import {
  move,
  rotate,
  setAttr,
  setStatus,
  type AttrValue,
  type Piece,
  type PieceId,
} from './piece';
import type { GameEnd, GameState, PendingChoice, PlayerState } from './state';
import type { Placement } from './zones';

/** Fato que aconteceu. Precisa ser JSON. `revealsInfo` impede desfazer daqui para trás. */
export interface GameEvent {
  type: string;
  revealsInfo?: boolean;
  [key: string]: unknown;
}

type Position = { x: number; y: number; z: number };

export type BuiltinEvent =
  | { type: 'pieceCreated'; piece: Piece }
  | { type: 'pieceRemoved'; id: PieceId }
  | { type: 'pieceMoved'; id: PieceId; from: Position; to: Position }
  | { type: 'pieceRotated'; id: PieceId; from: number; to: number }
  | { type: 'statusChanged'; id: PieceId; from: string; to: string; revealsInfo?: true }
  | { type: 'piecePlaced'; id: PieceId; from: Placement; to: Placement }
  | { type: 'pieceLeftZone'; id: PieceId; zone: PieceId }
  | { type: 'pieceEnteredZone'; id: PieceId; zone: PieceId; slot: string | null }
  | { type: 'zoneShuffled'; zone: PieceId; order: PieceId[] }
  | { type: 'attrChanged'; id: PieceId; key: string; from: AttrValue; to: AttrValue }
  | { type: 'globalChanged'; key: string; from: AttrValue; to: AttrValue }
  | { type: 'playerAttrChanged'; player: string; key: string; from: AttrValue; to: AttrValue }
  | { type: 'choiceRequested'; choice: PendingChoice }
  | { type: 'choiceMade'; choiceId: string; value: AttrValue }
  | { type: 'rngAdvanced'; to: number; revealsInfo: true }
  | { type: 'activePlayerChanged'; from: string | null; to: string }
  | { type: 'playerAdded'; player: PlayerState }
  | { type: 'piecesDropped'; ids: PieceId[]; zone: PieceId | null } // fim de um dropMany
  | { type: 'message'; text: string; to?: string } // comando `log`: texto para o log
  | { type: 'gameEnded'; result: GameEnd['result']; message?: string; score?: number };

export type EventOf<T extends BuiltinEvent['type']> = Extract<BuiltinEvent, { type: T }>;

export function isEvent<T extends BuiltinEvent['type']>(
  ev: GameEvent,
  type: T,
): ev is GameEvent & EventOf<T> {
  return ev.type === type;
}

/** Reducer. Eventos de tipo desconhecido (marcadores do jogo) não mudam o estado. */
export function applyEvent(d: Draft<GameState>, ev: GameEvent): void {
  const piece = (id: PieceId) => {
    const p = d.pieces[id];
    if (!p) throw new Error(`evento ${ev.type}: peça "${id}" não existe`);
    return p;
  };
  const e = ev as BuiltinEvent;
  switch (e.type) {
    case 'pieceCreated':
      d.pieces[e.piece.id] = castDraft(e.piece);
      break;
    case 'pieceRemoved':
      piece(e.id);
      delete d.pieces[e.id];
      break;
    case 'pieceMoved':
      d.pieces[e.id] = move(piece(e.id), e.to);
      break;
    case 'pieceRotated':
      d.pieces[e.id] = rotate(piece(e.id), e.to);
      break;
    case 'statusChanged':
      d.pieces[e.id] = setStatus(piece(e.id), e.to);
      break;
    case 'attrChanged':
      d.pieces[e.id] = setAttr(piece(e.id), e.key, e.to);
      break;
    case 'piecePlaced': {
      const p = piece(e.id);
      p.parentId = e.to.parentId;
      if (e.to.slot === null) delete p.slot;
      else p.slot = e.to.slot;
      d.pieces[e.id] = move(p, e.to);
      break;
    }
    case 'zoneShuffled':
      e.order.forEach((id, i) => {
        piece(id).transform.z = i;
      });
      break;
    case 'pieceLeftZone':
    case 'pieceEnteredZone':
      break; // marcadores para regras e log
    case 'globalChanged':
      d.globals[e.key] = e.to;
      break;
    case 'playerAttrChanged': {
      const p = d.players[e.player];
      if (!p) throw new Error(`evento ${ev.type}: jogador "${e.player}" não existe`);
      p.attributes[e.key] = e.to;
      break;
    }
    case 'choiceRequested':
      d.pending = castDraft(e.choice);
      break;
    case 'choiceMade':
      d.pending = null;
      break;
    case 'rngAdvanced':
      d.rng = e.to;
      break;
    case 'activePlayerChanged':
      d.activePlayer = e.to;
      break;
    case 'playerAdded':
      d.players[e.player.id] = castDraft(e.player);
      d.playerOrder.push(e.player.id);
      d.activePlayer ??= e.player.id;
      break;
    case 'gameEnded': {
      const end: GameEnd = { result: e.result };
      if (e.message !== undefined) end.message = e.message;
      if (e.score !== undefined) end.score = e.score;
      d.ended = end;
      break;
    }
  }
}
