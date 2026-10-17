import type { Command } from './commands';
import type { GameEvent } from './events';
import type { AttrValue, Piece, PieceId } from './piece';

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  attributes: Record<string, AttrValue>; // recursos do jogador (foco, energia...)
}

/** Cores padrão, na ordem dos jogadores. */
export const PLAYER_COLORS = ['#e5533d', '#2f81f7', '#2da44e', '#bf8700', '#8250df', '#1b7c83'];

/** Comando na fila de uma jogada: nível na cascata e regra que o gerou. */
export interface QueuedCommand {
  cmd: Command;
  depth: number;
  by?: string;
  /** Só publica estes eventos (fim de um comando composto, ex.: `piecesDropped`). */
  emit?: GameEvent[];
}

export interface ChoiceButton {
  value: AttrValue;
  label: string;
}

/** Resposta de uma escolha `pick: 'drop'`: a peça arrastada e para onde. */
export interface DropAnswer {
  id: string;
  zone: string | null;
  slot?: string;
  index?: number;
  x?: number;
  y?: number;
}

export interface PendingChoice {
  id: string;
  rule: string; // regra que resolve a escolha
  prompt: string;
  player?: string;
  options?: AttrValue[]; // se houver, a resposta precisa ser uma delas
  labels?: string[]; // texto de cada opção (mesma ordem de `options`)
  /**
   * As opções são ids de peças. 'piece': responde clicando numa delas na mesa. 'drop': responde
   * arrastando uma delas para algum lugar (a resposta é `{ id, zone, slot?, index?, x?, y? }`).
   */
  pick?: 'piece' | 'drop';
  multiple?: { min: number; max: number }; // resposta = lista de opções (sem repetir)
  /** Respostas extras, sempre aceitas, mostradas como botões (ex.: "Pular", "Terminar"). */
  buttons?: ChoiceButton[];
  context?: AttrValue; // dados para a regra resolver
  resume: QueuedCommand[]; // comandos da jogada que esperam a escolha
}

export interface LogEntry {
  seq: number;
  /** Jogada a que o evento pertence (o `seq` do primeiro evento dela). */
  play: number;
  depth: number; // 0 = comando do jogador; 1+ = reação
  by?: string; // regra que gerou o comando
  actor?: string; // jogador que fez a jogada
  event: GameEvent;
}

/** Fim da partida (comando `endGame`). */
export interface GameEnd {
  result: 'win' | 'lose' | 'draw';
  message?: string;
  score?: number;
}

export interface GameState {
  pieces: Record<PieceId, Piece>;
  globals: Record<string, AttrValue>; // reputação da loja, dia, hora, turno...
  players: Record<string, PlayerState>;
  /** Ordem de jogo (sentido horário). */
  playerOrder: string[];
  /** Jogador da vez (o primeiro da ordem, no começo). */
  activePlayer: string | null;
  log: LogEntry[];
  pending: PendingChoice | null;
  /** A partida acabou: o Gestor recusa novas jogadas (desfazer ainda funciona). */
  ended: GameEnd | null;
  rng: number; // estado do gerador de números aleatórios
  seq: number; // quantidade de eventos aplicados
}

export type PlayerInit = string | { id: string; name?: string; color?: string };

export interface StateInit {
  seed: number;
  globals?: Record<string, AttrValue>;
  players?: PlayerInit[];
}

export function createState({ seed, globals = {}, players = [] }: StateInit): GameState {
  const list: PlayerState[] = players.map((p, i) => {
    const init = typeof p === 'string' ? { id: p } : p;
    return {
      id: init.id,
      name: init.name ?? `Jogador ${i + 1}`,
      color: init.color ?? PLAYER_COLORS[i % PLAYER_COLORS.length]!,
      attributes: {},
    };
  });
  return {
    pieces: {},
    globals: { ...globals },
    players: Object.fromEntries(list.map((p) => [p.id, p])),
    playerOrder: list.map((p) => p.id),
    activePlayer: list[0]?.id ?? null,
    log: [],
    pending: null,
    ended: null,
    rng: seed >>> 0,
    seq: 0,
  };
}
