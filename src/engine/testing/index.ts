import { zipSync } from 'fflate';
import { loadGame, type LoadedGame } from '@/engine/package/game';
import { packGame } from '../../../scripts/pack-game.mjs';

/**
 * Carrega a pasta de um jogo como o `pnpm exemplos` empacotaria (regras TypeScript compiladas),
 * para testar as regras sem tela, no Node:
 *
 *   const game = await loadGameFolder('examples/piramide');
 *   const m = game.createManager({ players: 2, seed: 1, options: { stage: 'A' } });
 *   expect(m.dispatch({ type: 'dropInto', id: 'c1', zone: 'p1-tableau', slot: '1,0', actor: 'p1' }).ok).toBe(false);
 */
export async function loadGameFolder(dir: string): Promise<LoadedGame> {
  return loadGame({ bytes: zipSync(await packGame(dir)) });
}
