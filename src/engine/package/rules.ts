import {
  childrenOf,
  gridSlot,
  isAncestor,
  ownerOf,
  isCommand,
  isEvent,
  parseGridSlot,
  randomInt,
  shuffle,
  type Command,
  type CommandDef,
  type GameState,
  type Piece,
  type PieceId,
  type PieceInit,
  type Rule,
} from '@/engine/core';
import type { Gesture } from '@/engine/render';
import type { DataItem } from './manifest';

/** Funções do motor disponíveis para as regras (sem imports: o script não tem módulos). */
export const helpers = {
  childrenOf,
  isAncestor,
  ownerOf,
  isEvent,
  isCommand,
  gridSlot,
  parseGridSlot,
  shuffle,
  randomInt,
};

/** Muda o que um gesto faz. Devolva um comando, `null` (ignorar) ou `undefined` (padrão). */
export type GestureHook = (
  gesture: Gesture,
  piece: Piece,
  state: GameState,
) => Command | null | undefined;

/** O que uma ação do jogo sabe de quem está na tela. */
export interface ActionContext {
  /** Jogador que olha a tela (`null` = espectador). */
  player: string | null;
  /** Peças selecionadas na mesa, na ordem em que foram selecionadas. */
  selection: readonly PieceId[];
}

/**
 * Ação do jogo, mostrada como botão no painel (ex.: "Refletir", "Terminar"). O comando sai com o
 * jogador da tela como `actor`. Sem `enabled`, o botão fica desabilitado quando o Gestor
 * recusaria o comando, com o motivo como dica.
 */
export interface GameAction {
  id: string;
  label: string;
  /** Aparece agora? (padrão: sempre). Use para mostrar só as ações da fase. */
  visible?(state: GameState, ctx: ActionContext): boolean;
  /** `true` ou o motivo de estar desabilitada. */
  enabled?(state: GameState, ctx: ActionContext): true | string;
  /** O comando do botão; `null` = indisponível. */
  command(state: GameState, ctx: ActionContext): Command | null;
  /**
   * Aparece também no menu do botão direito de uma peça, com ela (ou o grupo selecionado) como
   * `ctx.selection` (padrão: não).
   */
  menu?: boolean;
  /** Atalho de fábrica ("E", "Alt+Shift+T"); o jogador pode trocar nas configurações. */
  key?: string;
}

export interface SetupContext {
  state(): GameState;
  /** Aplica um comando no setup; se for recusado, o jogo não abre (erro do pacote). */
  dispatch(cmd: Command): void;
}

/** O objeto `game` que o regras.js recebe. */
export interface GameApi {
  /** Número de jogadores escolhido para esta partida. */
  readonly players: number;
  /** Opções escolhidas antes de começar (`manifest.options`): id → valor. */
  readonly options: Readonly<Record<string, string>>;
  /** Os jogadores, na ordem de jogo (ids "p1", "p2"…, e os criados com `addPlayer`). */
  readonly playerList: readonly { id: string; name: string; color: string }[];
  /** Conjuntos de dados do manifest (somente leitura). */
  readonly data: Readonly<Record<string, readonly DataItem[]>>;
  readonly lookups: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly helpers: typeof helpers;
  rule(rule: Rule): void;
  command(def: CommandDef): void;
  gesture(hook: GestureHook): void;
  /** Botão de ação no painel (ex.: "Refletir" sobre a carta selecionada). */
  action(def: GameAction): void;
  /**
   * Objeto livre, o mesmo para todos os arquivos de regras da partida (`rules` em lista): um
   * arquivo põe funções aqui (`game.shared.canPlace = …`) e os seguintes usam.
   */
  readonly shared: Record<string, unknown>;
  /** Roda depois do setup do manifest (ex.: um tabuleiro por jogador). */
  setup(fn: (ctx: SetupContext) => void): void;
  /** Peças de um prefab do manifest, com parâmetros (para criar no setup). */
  prefab(name: string, params?: Record<string, unknown>): PieceInit[];
}

/**
 * Compila o regras.js: o arquivo é o corpo de uma função que recebe `game`. Roda dentro do
 * iframe isolado do jogo; aqui só vira função. Erro de sintaxe aparece com o nome do arquivo.
 */
export function compileRules(code: string, source: string): (game: GameApi) => void {
  let fn: (game: GameApi) => void;
  try {
    fn = new Function('game', `"use strict";\n${code}\n//# sourceURL=${source}`) as typeof fn;
  } catch (e) {
    throw new SyntaxError(`${source}: ${(e as Error).message}`, { cause: e });
  }
  return fn;
}
