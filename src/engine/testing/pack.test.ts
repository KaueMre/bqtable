import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGame } from '@/engine/package/game';
import { packGame } from '../../../scripts/pack-game.mjs';
import { loadGameFolder } from './index';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Pasta de jogo temporária com estes arquivos. */
function pasta(files: Record<string, string | object>) {
  const dir = mkdtempSync(join(tmpdir(), 'bqgame-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const manifest = (rules: string | string[]) => ({
  format: 'bqgame/1',
  id: 'teste',
  name: 'Teste',
  kinds: [{ kind: 'k' }],
  setup: [],
  rules,
});

describe('regras em vários arquivos e em TypeScript', () => {
  it('TypeScript com imports vira um .js só; fontes e testes ficam fora do pacote', async () => {
    const dir = pasta({
      'manifest.json': manifest('regras/index.ts'),
      'regras/index.ts': `
        import { dobro } from './util';
        declare const game: { setup(fn: (c: { dispatch(cmd: object): void }) => void): void };
        game.setup(({ dispatch }) => dispatch({ type: 'setGlobal', key: 'x', value: dobro(21) }));`,
      'regras/util.ts': 'export const dobro = (n: number): number => n * 2;',
      'regras/util.test.ts': 'nada',
      'tsconfig.json': '{}',
    });
    const files = await packGame(dir);
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'regras/index.js']);
    expect(JSON.parse(new TextDecoder().decode(files['manifest.json'])).rules).toBe(
      'regras/index.js',
    );
    const m = (await loadGameFolder(dir)).createManager({ players: 1 });
    expect(m.getState().globals.x).toBe(42);
  });

  it('erro de compilação aponta o arquivo e a linha', async () => {
    const dir = pasta({
      'manifest.json': manifest('r.ts'),
      'r.ts': 'const a = ;\n',
    });
    await expect(packGame(dir)).rejects.toThrow(/r\.ts:1: /);
  });

  it('lista de arquivos: rodam em ordem, com o mesmo game.shared', async () => {
    const js = (code: string) => 'data:text/javascript,' + encodeURIComponent(code);
    const game = await loadGame({
      manifest: manifest([
        js('game.shared.dobro = (n) => n * 2;'),
        js(`game.setup(({ dispatch }) =>
              dispatch({ type: 'setGlobal', key: 'x', value: game.shared.dobro(5) }));`),
      ]),
    });
    expect(game.createManager({ players: 1 }).getState().globals.x).toBe(10);
  });

  it('erro num dos arquivos aponta qual', async () => {
    const js = (code: string) => 'data:text/javascript,' + encodeURIComponent(code);
    const game = await loadGame({
      manifest: manifest([js('// ok'), js('game.shared.nada.x();')]),
    });
    expect(() => game.createManager({ players: 1 })).toThrow(/^data:text\/javascript,.*nada/);
  });
});
