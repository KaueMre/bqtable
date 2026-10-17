import { useMemo, type ReactNode } from 'react';
import type { Manager } from '@/engine/core';
import { GameContext } from './context';
import { getGameStore } from './store';

export function ManagerProvider({ manager, children }: { manager: Manager; children: ReactNode }) {
  const value = useMemo(() => ({ manager, store: getGameStore(manager) }), [manager]);
  return <GameContext value={value}>{children}</GameContext>;
}
