import type { Command } from './commands';
import type { GameEvent } from './events';
import type { AttrValue } from './piece';
import type { GameState, PendingChoice } from './state';

/** Regra registrada pelo jogo. O estado recebido é imutável; mudanças só por comandos. */
export interface Rule {
  id: string;
  /** Roda para todo comando, inclusive os gerados por reações. String = motivo da recusa. */
  validate?(cmd: Command, state: GameState): true | string;
  /** Roda depois de cada evento aplicado. Os comandos entram na frente da fila. */
  react?(ev: GameEvent, state: GameState): Command[];
  /** Resposta a uma escolha que esta regra pediu com o comando `ask`. */
  resolve?(choice: PendingChoice, value: AttrValue, state: GameState): Command[] | string;
}
