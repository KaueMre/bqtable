import { devtools } from 'zustand/middleware';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Command, GameEvent, GameState, Manager, Result } from '@/engine/core';

export interface GameStoreState {
  game: GameState;
  /** Eventos da última mudança (vazio após desfazer). */
  lastEvents: GameEvent[];
  /** Motivo da última recusa de `dispatch` ou `undo`; some na próxima mudança. */
  lastError: string | null;
  canUndo: true | string;
  dispatch(cmd: Command): Result<GameEvent[]>;
  undo(): Result<void>;
}

export type GameStore = StoreApi<GameStoreState>;

const stores = new WeakMap<Manager, GameStore>();

/**
 * Um store Zustand por Gestor. O Gestor continua sendo a fonte da verdade: o store só guarda
 * a referência do estado imutável a cada aviso, sem copiar nada.
 *
 * Com o Redux DevTools aberto, dá para inspecionar o estado, mas "pular" para um estado antigo
 * por lá não volta o Gestor. Para voltar jogadas, use `undo`.
 */
export function getGameStore(manager: Manager): GameStore {
  let store = stores.get(manager);
  if (!store) {
    store = createGameStore(manager);
    stores.set(manager, store);
  }
  return store;
}

function createGameStore(manager: Manager): GameStore {
  const store = createStore<GameStoreState>()(
    devtools(
      (set) => {
        const refuse = <T>(r: Result<T>) => {
          if (!r.ok) set({ lastError: r.error }, false, 'refused');
          return r;
        };
        return {
          game: manager.getState(),
          lastEvents: [],
          lastError: null,
          canUndo: manager.canUndo(),
          dispatch: (cmd) => refuse(manager.dispatch(cmd)),
          undo: () => refuse(manager.undo()),
        };
      },
      { name: 'bqtable', enabled: import.meta.env.DEV },
    ),
  );
  // Sem unsubscribe: store e Gestor vivem e morrem juntos.
  manager.subscribe((game, events) => {
    store.setState(
      { game, lastEvents: events, lastError: null, canUndo: manager.canUndo() },
      false,
      events[0]?.type ?? 'undo/clearHistory',
    );
  });
  return store;
}
