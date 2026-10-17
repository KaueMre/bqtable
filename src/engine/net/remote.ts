import {
  createKindRegistry,
  createState,
  err,
  ok,
  type Command,
  type EventListener,
  type GameEvent,
  type GameState,
  type KindRegistry,
  type Manager,
  type StateListener,
} from '@/engine/core';

export type RejectListener = (reason: string) => void;

/**
 * O Gestor de um convidado: a mesma interface do `Manager`, mas sem regras. A partida de verdade
 * roda no host; aqui chega o estado do jogador (`setState`) e saem os comandos (`send`).
 */
export interface RemoteManager extends Manager {
  /** Estado novo vindo do host (já com `redactFor`). Avisa quem fez `subscribe` e `on`. */
  setState(state: GameState): void;
  /** O host recusou um comando deste convidado. Avisa quem fez `onReject`. */
  reject(reason: string): void;
  /** Recusas do host. A tela mostra como as recusas locais (`lastError` do store). */
  onReject(fn: RejectListener): () => void;
}

export interface RemoteManagerOptions {
  /** Os kinds do jogo (o convidado tem o pacote): a visão usa `hiddenStatuses`, a mesa o resto. */
  kinds?: KindRegistry;
  /** Estado até chegar o primeiro do host. */
  state?: GameState;
}

/** Recusa das operações que só o host faz. */
export const HOST_ONLY = 'só o host pode fazer isso';

/**
 * `dispatch` só envia: devolve `ok([])` e a resposta chega depois, como estado novo ou recusa.
 * `check` diz sempre `true` (quem recusa é o host). Desfazer e registrar são do host.
 */
export function createRemoteManager(
  send: (cmd: Command) => void,
  options: RemoteManagerOptions = {},
): RemoteManager {
  const kinds = options.kinds ?? createKindRegistry();
  const subscribers = new Set<StateListener>();
  const listeners = new Map<string, Set<EventListener>>();
  const rejectListeners = new Set<RejectListener>();
  let state = options.state ?? createState({ seed: 0 });

  const refuse = (): never => {
    throw new Error(HOST_ONLY);
  };

  return {
    kinds,
    getState: () => state,

    dispatch(cmd) {
      send(cmd);
      return ok([]);
    },

    check: () => true,

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    on(type, fn) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set.add(fn));
      return () => set.delete(fn);
    },

    undo: () => err(HOST_ONLY),
    canUndo: () => HOST_ONLY,
    clearHistory: refuse,
    registerRule: refuse,
    registerKind: refuse,
    registerCommand: refuse,

    setState(next) {
      // os eventos novos são os do log que ele ainda não viu (desfazer no host: nenhum)
      const events: GameEvent[] = next.log.filter((e) => e.seq > state.seq).map((e) => e.event);
      state = next;
      for (const fn of [...subscribers]) fn(state, events);
      for (const ev of events) {
        for (const fn of [...(listeners.get(ev.type) ?? [])]) fn(ev, state);
      }
    },

    reject(reason) {
      for (const fn of [...rejectListeners]) fn(reason);
    },

    onReject(fn) {
      rejectListeners.add(fn);
      return () => rejectListeners.delete(fn);
    },
  };
}

export function isRemoteManager(m: Manager): m is RemoteManager {
  return 'onReject' in m;
}
