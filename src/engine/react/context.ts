import { createContext } from 'react';
import type { Manager } from '@/engine/core';
import type { GameStore } from './store';

export interface GameContextValue {
  manager: Manager;
  store: GameStore;
}

export const GameContext = createContext<GameContextValue | null>(null);

/** Jogador que está olhando a tela e age por ela; `null` = espectador (ou jogo sem jogadores). */
export const ViewerContext = createContext<string | null>(null);
