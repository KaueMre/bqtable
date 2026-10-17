import { zipSync } from 'fflate';
import { loadGame, type LoadedGame } from '@/engine/package/game';
import { packGame } from '../../../scripts/pack-game.mjs';

export interface LoadGameFolderOptions {
  /** Arquivos que ficam de fora (caminho dentro do pacote), ex.: as imagens, para abrir mais rápido. */
  exclude?: (path: string) => boolean;
}

/**
 * Carrega a pasta de um jogo como o `pnpm exemplos` empacotaria (regras TypeScript compiladas),
 * para testar as regras sem tela, no Node:
 *
 *   const game = await loadGameFolder('examples/piramide');
 *   const m = game.createManager({ players: 2, seed: 1, options: { stage: 'A' } });
 *   expect(m.dispatch({ type: 'dropInto', id: 'c1', zone: 'p1-tableau', slot: '1,0', actor: 'p1' }).ok).toBe(false);
 *
 * Sem as imagens: `loadGameFolder(pasta, { exclude: (path) => path.startsWith('images/') })`.
 */
export async function loadGameFolder(
  dir: string,
  { exclude }: LoadGameFolderOptions = {},
): Promise<LoadedGame> {
  const files = await packGame(dir);
  if (exclude) for (const path of Object.keys(files)) if (exclude(path)) delete files[path];
  return loadGame({ bytes: zipSync(files) });
}
