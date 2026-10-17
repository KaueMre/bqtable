// Gera a SDK do motor em dist-sdk/ (docs/engine/SDK.md): é o que um repositório de jogo importa
// como `bqtable/sdk` e `bqtable/testing`. Roda no `prepare`, então também quando o bqtable é
// instalado como dependência git.
//
// - JS: esbuild, um módulo por entrada (com os pedaços em comum separados). As dependências do
//   bqtable ficam de fora (o pnpm instala junto), e o pack-game.mjs é importado de scripts/.
// - Tipos: tsc gera os .d.ts e aqui os caminhos `@/...` viram relativos, com extensão (.js), para
//   funcionar com `moduleResolution` "bundler" e "nodenext".
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-sdk');
const TYPES = join(OUT, 'types');
const SRC = join(ROOT, 'src');
const ENTRIES = { index: 'src/sdk/index.ts', testing: 'src/sdk/testing.ts' };

rmSync(OUT, { recursive: true, force: true });

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
await build({
  absWorkingDir: ROOT,
  entryPoints: ENTRIES,
  outdir: OUT,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  tsconfig: 'tsconfig.app.json', // o alias @/
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: 'warning',
  plugins: [
    {
      name: 'pack-game-externo',
      setup(b) {
        // um único pack-game.mjs no pacote (o mesmo do binário bqgame-pack)
        b.onResolve({ filter: /\/pack-game\.mjs$/ }, () => ({
          path: '../scripts/pack-game.mjs',
          external: true,
        }));
      },
    },
  ],
});

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tsconfig.sdk.json')], { stdio: 'inherit' });

/** Arquivo de origem → onde está o .d.ts dele (sem extensão), ou `null` se não foi gerado. */
function emitted(sourceNoExt) {
  const rel = relative(SRC, sourceNoExt);
  if (rel.startsWith('..')) return null;
  const out = join(TYPES, rel);
  if (existsSync(`${out}.d.ts`)) return `${out}.js`;
  if (existsSync(join(out, 'index.d.ts'))) return join(out, 'index.js');
  return null;
}

/** Especificador de um .d.ts, que o tsc deixa como estava no fonte, visto de dist-sdk/types/. */
function rewrite(spec, sourceDir, outDir) {
  let target;
  if (spec.startsWith('@/')) target = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) target = resolve(sourceDir, spec);
  else return spec; // pacote: fica como está
  const out = emitted(target) ?? (existsSync(target) ? target : null);
  if (!out) throw new Error(`build-sdk: não achei ${spec} (de ${relative(ROOT, sourceDir)})`);
  const rel = relative(outDir, out).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!name.endsWith('.d.ts')) continue;
    const sourceDir = join(SRC, relative(TYPES, dir));
    const code = readFileSync(path, 'utf8').replace(
      /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g,
      (_, prefix, quote, spec) => `${prefix}${quote}${rewrite(spec, sourceDir, dir)}${quote}`,
    );
    writeFileSync(path, code);
  }
})(TYPES);

console.log(`dist-sdk: ${Object.keys(ENTRIES).join(', ')} (JS e tipos)`);
