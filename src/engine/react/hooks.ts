import { useCallback, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  viewFor,
  type Command,
  type GameState,
  type Manager,
  type Piece,
  type PieceId,
  type View,
} from '@/engine/core';
import { GameContext, ViewerContext } from './context';
import type { GameStoreState } from './store';

/** O comando sai da tela em nome de quem está olhando (se ele não disser outro `actor`). */
const asViewer = (cmd: Command, viewer: string | null): Command =>
  viewer !== null && cmd.actor === undefined ? { ...cmd, actor: viewer } : cmd;

function useGameContext() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('hooks do jogo precisam estar dentro de <ManagerProvider>');
  return ctx;
}

/** Acesso direto ao Gestor (ex.: `on` para sons e animações). */
export function useManager(): Manager {
  return useGameContext().manager;
}

/**
 * Seletor sobre o store; re-renderiza só quando o resultado muda (Object.is).
 * Seletor que monta objeto ou array novo deve vir embrulhado em `useShallow`.
 */
export function useGame<T>(selector: (s: GameStoreState) => T): T {
  return useStore(useGameContext().store, selector);
}

/** Como `useGame`, mas compara o resultado raso: o seletor pode montar objeto ou array novo. */
export function useGameShallow<T>(selector: (s: GameStoreState) => T): T {
  return useGame(useShallow(selector));
}

/** Re-renderiza só quando esta peça muda. */
export function usePiece(id: PieceId): Piece | undefined {
  return useGame((s) => s.game.pieces[id]);
}

/** Ids das peças, com filtro opcional. Re-renderiza só quando a lista de ids muda. */
export function usePieceIds(filter?: (p: Piece) => boolean): PieceId[] {
  return useGame(
    useShallow((s) =>
      Object.values(s.game.pieces)
        .filter((p) => !filter || filter(p))
        .map((p) => p.id),
    ),
  );
}

/** Seletor sobre os globals; o resultado é comparado raso, então pode devolver objeto ou array. */
export function useGlobals<T>(selector: (globals: GameState['globals']) => T): T {
  return useGame(useShallow((s) => selector(s.game.globals)));
}

/** Despacha em nome do jogador da tela (`actor`), para valerem as permissões de dono. */
export function useDispatch(): GameStoreState['dispatch'] {
  const dispatch = useGame((s) => s.dispatch);
  const viewer = useViewer();
  return useCallback((cmd: Command) => dispatch(asViewer(cmd, viewer)), [dispatch, viewer]);
}

/** Simula o comando em nome do jogador da tela, sem aplicar: `true` ou o motivo. */
export function useCheck(): (cmd: Command) => true | string {
  const manager = useManager();
  const viewer = useViewer();
  return useCallback((cmd: Command) => manager.check(asViewer(cmd, viewer)), [manager, viewer]);
}

/** Jogador que está olhando a tela (`null` = espectador). */
export function useViewer(): string | null {
  return useContext(ViewerContext);
}

/** O estado como o jogador da tela vê (áreas privadas de outros escondidas ou viradas). */
export function useView(): View {
  const viewer = useViewer();
  const { kinds } = useManager();
  return useGame((s) => viewFor(s.game, viewer, kinds));
}

/** A peça como o jogador da tela vê (`undefined` se estiver escondida dele). */
export function useViewPiece(id: PieceId): Piece | undefined {
  const viewer = useViewer();
  const { kinds } = useManager();
  return useGame((s) => viewFor(s.game, viewer, kinds).pieces[id]);
}

/** A peça aparece virada para quem olha (área privada de outro, ou status `hiddenStatuses`)? */
export function useViewFaceDown(id: PieceId): boolean {
  const viewer = useViewer();
  const { kinds } = useManager();
  return useGame((s) => viewFor(s.game, viewer, kinds).faceDown.has(id));
}

export function useUndo(): { undo: GameStoreState['undo']; canUndo: true | string } {
  const undo = useGame((s) => s.undo);
  const canUndo = useGame((s) => s.canUndo);
  return { undo, canUndo };
}
