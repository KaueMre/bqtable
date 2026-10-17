// Empacota a pasta de um jogo num .bqgame (zip com manifest.json na raiz).
// Uso: node scripts/pack-game.mjs <pasta> <saida.bqgame>
//
// Regras em TypeScript: se `rules` no manifest aponta para um .ts, o arquivo (e o que ele
// importa) vira um .js só, com esbuild, e o manifest do pacote passa a apontar para o .js. Os
// fontes .ts e os testes (*.test.*) não entram no pacote.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const SKIP = /(^\.|^node_modules$|\.test\.[cm]?[jt]sx?$|^tsconfig\.json$)/;

/** Arquivos do pacote (caminho → bytes), com as regras TypeScript já compiladas. */
export async function packGame(dir) {
  const files = {};
  (function walk(current) {
    for (const name of readdirSync(current)) {
      if (SKIP.test(name)) continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path).split('\\').join('/')] = new Uint8Array(readFileSync(path));
    }
  })(dir);
  if (!files['manifest.json']) throw new Error(`${dir} não tem manifest.json`);

  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  const list = manifest.rules === undefined ? [] : [manifest.rules].flat();
  if (list.some((ref) => ref.endsWith('.ts'))) {
    const compiled = [];
    for (const ref of list) {
      if (!ref.endsWith('.ts')) {
        compiled.push(ref);
        continue;
      }
      const out = ref.replace(/\.ts$/, '.js');
      files[out] = await compile(join(dir, ref));
      compiled.push(out);
    }
    manifest.rules = Array.isArray(manifest.rules) ? compiled : compiled[0];
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
    for (const path of Object.keys(files)) if (path.endsWith('.ts')) delete files[path];
  }
  return files;
}

/**
 * Um .ts de regras (e os módulos que ele importa) → o corpo de função que o jogo roda. O `game`
 * usado nos arquivos é o parâmetro dessa função; `import type` some na compilação.
 */
async function compile(entry) {
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      charset: 'utf8',
      legalComments: 'none',
      write: false,
      logLevel: 'silent',
    });
    return result.outputFiles[0].contents;
  } catch (e) {
    const errors = (e.errors ?? []).map(
      (x) => `${x.location ? `${x.location.file}:${x.location.line}: ` : ''}${x.text}`,
    );
    throw new Error(errors.length ? errors.join('\n') : String(e));
  }
}

/** O .bqgame (zip) da pasta. */
export async function packGameZip(dir) {
  return zipSync(await packGame(dir), { level: 9 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('uso: node scripts/pack-game.mjs <pasta> <saida.bqgame>');
    process.exit(1);
  }
  try {
    const files = await packGame(dir);
    mkdirSync(dirname(out), { recursive: true });
    const zip = zipSync(files, { level: 9 });
    writeFileSync(out, zip);
    console.log(`${out}: ${Object.keys(files).length} arquivos, ${zip.length} bytes`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
