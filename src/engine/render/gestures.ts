import type { Command, DropTarget, GameState, Piece, PieceId } from '@/engine/core';

/**
 * Gesto na mesa. O renderer nunca muda o estado: todo gesto vira comando para o Gestor, e a
 * tela se ajusta ao que o Gestor aceitar.
 */
export type Gesture =
  | { type: 'drag'; id: PieceId; target: DropTarget } // soltou a peça (alvo já resolvido)
  | {
      // soltou um grupo selecionado; `id` é a peça que o jogador segurou
      type: 'dragGroup';
      id: PieceId;
      ids: PieceId[]; // em ordem de desenho (em grade/encaixes, a segurada primeiro)
      target: DropTarget;
      at: Record<PieceId, { x: number; y: number }>; // mesa e 'free': onde cada uma caiu
    }
  | { type: 'rotate'; id: PieceId; rotation: number } // nova rotação própria da peça
  | { type: 'activate'; id: PieceId; area?: string }; // duplo clique (`area`: hotspot sob o ponteiro)

/** Converte um gesto em comando. `null` ignora o gesto (a peça volta para onde estava). */
export type GestureHandler = (gesture: Gesture, piece: Piece, state: GameState) => Command | null;

/** Padrão: arrastar → dropInto (mesa ou zona), grupo → dropMany, girar → rotate, ativar → nada. */
export const defaultGestures: GestureHandler = (gesture, piece) => {
  switch (gesture.type) {
    case 'drag':
      return { type: 'dropInto', id: piece.id, ...gesture.target };
    case 'dragGroup': {
      const { zone, slot, index } = gesture.target;
      return {
        type: 'dropMany',
        ids: gesture.ids,
        zone,
        ...(slot !== undefined && { slot }),
        ...(index !== undefined && { index }),
        at: gesture.at,
      };
    }
    case 'rotate':
      return { type: 'rotate', id: piece.id, rotation: gesture.rotation };
    case 'activate':
      return null;
  }
};
