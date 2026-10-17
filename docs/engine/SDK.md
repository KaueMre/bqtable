# SDK: um jogo no seu próprio repositório

Um jogo pode morar num repositório git separado do bqtable. Ele instala o bqtable como dependência git e importa do motor só por três portas, que não mudam sem uma versão nova da SDK:

| Importa de | O que tem |
|---|---|
| `bqtable/sdk` | Os tipos das regras (`GameApi`, `Command`, `GameState`, `Piece`, `Manager`, …), as funções puras de `game.helpers` (`childrenOf`, `ownerOf`, `gridSlot`, …) para usar nos testes, e `loadGame`. Não tem React. |
| `bqtable/testing` | `loadGameFolder(pasta, { exclude })`: empacota a pasta como o `bqgame-pack` e abre o jogo sem tela, no Node. |
| `bqgame-pack` (comando) | `bqgame-pack <pasta> <saida.bqgame>`: gera o pacote, compilando as regras TypeScript (FormatoBqgame.md, seção 16). |

Os caminhos internos (`@/engine/...`) só valem dentro do repositório do bqtable.

## Estrutura

```
meu-jogo/
  package.json
  pnpm-workspace.yaml
  tsconfig.json
  jogo/                  ← o pacote: é isto que o bqgame-pack junta
    manifest.json
    data/
    images/
    regras/
      index.ts
      regras.test.ts
  docs/, scripts/        ← o que não vai para o pacote fica fora de jogo/
```

Deixe o pacote numa pasta própria (`jogo/`). O `bqgame-pack` junta tudo o que está na pasta (menos `node_modules`, arquivos ocultos, `*.test.*`, `tsconfig.json` e os `.ts` já compilados). Se ele rodasse na raiz, levaria `package.json`, `docs/` e `scripts/` junto.

## package.json

```json
{
  "name": "meu-jogo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc",
    "empacotar": "bqgame-pack jogo meu-jogo.bqgame"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "bqtable": "github:KaueMre/bqtable#sdk-v0.1.0",
    "typescript": "~6.0.3",
    "vitest": "^5.0.3"
  }
}
```

- A tag (`#sdk-v0.1.0`) fixa a versão da SDK. Para atualizar, troque a tag e rode `pnpm install`.
- O script não se chama `pack` porque `pnpm pack` é um comando do próprio pnpm (gera um tarball do repositório) e passa na frente do script. Use `pnpm empacotar`.
- Para testar uma mudança no motor antes da tag, use `"bqtable": "link:../bqtable"`. Nesse caso, rode antes `pnpm build:sdk` no bqtable.

## pnpm-workspace.yaml

Ao instalar, o bqtable gera a SDK (`prepare`), e o esbuild baixa o binário dele. O pnpm só roda esses scripts com permissão:

```yaml
allowBuilds:
  esbuild: true
  'bqtable@<endereço com o commit>': true # copie a linha que o pnpm mostrar
```

Para dependências git, o pnpm pede o endereço com o commit exato da tag. No primeiro `pnpm install`, ele falha com `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` e mostra a linha pronta. Copie para cá e rode de novo. Repita ao trocar de tag.

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["jogo"]
}
```

`skipLibCheck` é obrigatório: alguns tipos internos do motor citam React, que o repositório do jogo não instala. `moduleResolution` pode ser `"bundler"` ou `"nodenext"`.

## Regras e testes

```ts
// jogo/regras/index.ts
import type { Command, GameApi } from 'bqtable/sdk';

declare const game: GameApi; // o parâmetro que o jogo passa

const { childrenOf } = game.helpers;
game.rule({ id: 'exemplo', validate: (cmd: Command, state) => … });
```

```ts
// jogo/regras/regras.test.ts
import { fileURLToPath } from 'node:url';
import { childrenOf } from 'bqtable/sdk';
import { loadGameFolder } from 'bqtable/testing';
import { expect, it } from 'vitest';

const pasta = fileURLToPath(new URL('..', import.meta.url));

it('setup', async () => {
  const game = await loadGameFolder(pasta, { exclude: (p) => p.startsWith('images/') });
  const m = game.createManager({ players: 2, seed: 1 });
  expect(childrenOf(m.getState().pieces, 'p1-mao')).toHaveLength(3);
});
```

- Nas regras, importe só tipos (`import type`). Funções do motor vêm de `game.helpers`. Um import de valor de `bqtable/sdk` levaria o motor inteiro para dentro do `regras.js`.
- O Vitest não precisa de configuração: o padrão (Node, `**/*.test.ts`) serve.
- `exclude` deixa arquivos de fora do pacote do teste. Sem as imagens, o jogo abre mais rápido, e no Node elas viram placeholder de qualquer jeito.

Comandos: `pnpm test`, `pnpm typecheck`, `pnpm empacotar`. O `.bqgame` gerado abre na página **Jogar** do bqtable (**Escolher arquivo**).

## Para quem mexe no bqtable

- As entradas ficam em `src/sdk/` (`index.ts` e `testing.ts`). O lint impede que elas importem React ou a tela.
- `pnpm build:sdk` (que também roda no `prepare`) gera `dist-sdk/` com o JS (esbuild) e os `.d.ts` (tsc, com os caminhos `@/` reescritos). O `package.json` publica só `dist-sdk/` e o `pack-game.mjs` (campo `files`).
- Dentro do repositório, `examples/` importa de `bqtable/sdk` por alias (`vite.config.ts` e `tsconfig.test.json`), direto do fonte.
- Mudou algo exportado pela SDK? Crie uma tag nova (`sdk-v0.2.0`) e avise os jogos.
