import type { Command } from './commands';
import type { PieceInit } from './piece';

/**
 * Conjunto reutilizável de peças: um tabuleiro e o que vem dentro dele (zonas, marcadores...).
 * Devolve os pais antes dos filhos; os ids dos filhos derivam do id da instância, para poder
 * criar várias (um tabuleiro por jogador). Mover ou girar a peça raiz leva tudo junto.
 */
export type Prefab<Options> = (options: Options) => PieceInit[];

/** Comando que cria todas as peças numa jogada só: se uma falha, nenhuma é criada. */
export function spawn(pieces: PieceInit[]): Command {
  return { type: 'batch', commands: pieces.map((piece) => ({ type: 'createPiece', piece })) };
}
