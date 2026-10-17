/**
 * `bqtable/sdk`: o contrato para quem escreve um jogo em outro repositório (docs/engine/SDK.md).
 *
 * - Os tipos do motor que as regras usam (`GameApi`, `Command`, `GameState`, `Piece`, …). Nas
 *   regras, importe só tipos (`import type`): eles somem no empacotamento.
 * - As mesmas funções puras que as regras recebem em `game.helpers`, para os testes.
 * - `loadGame`, que abre um pacote e cria partidas sem tela (roda no Node).
 *
 * Nada de React: a tela fica no site.
 */
export type * from '@/engine/core';
export {
  childrenOf,
  gridSlot,
  isAncestor,
  isCommand,
  isEvent,
  ownerOf,
  parseGridSlot,
  randomInt,
  shuffle,
} from '@/engine/core';
export type { DataItem, GameManifest } from '@/engine/package/manifest';
export type { ActionContext, GameAction, GameApi, GestureHook } from '@/engine/package/rules';
export {
  GameDefinitionError,
  loadGame,
  type LoadedGame,
  type Match,
  type MatchSettings,
} from '@/engine/package/game';
export type { PackageSource } from '@/engine/package/read';
