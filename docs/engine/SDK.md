# SDK: um jogo no seu próprio repositório

Um jogo pode morar num repositório git separado do bqtable. Ele instala o bqtable como dependência git e importa do motor só por três portas, que não mudam sem uma versão nova da SDK:

| Importa de | O que tem |
|---|---|
| `bqtable/sdk` | Os tipos das regras (`GameApi`, `Command`, `GameState`, `Piece`, `Manager`, …), as funções puras de `game.helpers` (`childrenOf`, `ownerOf`, `gridSlot`, …) para usar nos testes, e `loadGame`. Não tem React. |
| `bqtable/testing` | `loadGameFolder(pasta, { exclude })`: empacota a pasta como o `bqgame-pack` e abre o jogo sem tela, no Node. |
| `bqgame-pack` (comando) | `bqgame-pack <pasta> <saida.bqgame>`: gera o pacote, compilando as regras TypeScript (FormatoBqgame.md, seção 16). |

Os caminhos internos (`@/engine/...`) só valem dentro do repositório do bqtable.

O que mudou em cada versão, o que um jogo precisa mudar e o que pode aproveitar está em [VersoesSDK.md](VersoesSDK.md). A partir da 0.2.0, a SDK traz a documentação da mesma versão em `node_modules/bqtable/docs/engine/` (este arquivo, o `FormatoBqgame.md` e o `VersoesSDK.md`).

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

- A tag (`#sdk-v0.1.0`) fixa a versão da SDK. Para atualizar, leia em [VersoesSDK.md](VersoesSDK.md) as versões entre a sua e a nova, troque a tag e rode `pnpm install`.
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

## Publicar no GitHub Pages

A cada push na `main`, um workflow do GitHub Actions testa, empacota e publica o `.bqgame` no GitHub Pages do repositório. O GitHub Pages manda o cabeçalho de CORS, então o jogo abre por link (`<id>` é o `id` do `manifest.json`):

```
https://bqtable.kauefar.workers.dev/jogar?url=https://<dono>.github.io/<repo>/<id>.bqgame
```

1. No repositório: **Settings → Pages → Source: GitHub Actions**.
2. Crie `.github/workflows/publicar.yml`:

```yaml
# Testa, empacota e publica o .bqgame no GitHub Pages deste repositório, a cada push na main.
# Antes da primeira vez: Settings → Pages → Source: GitHub Actions.
name: Publicar o jogo

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# uma publicação por vez (a que já começou termina)
concurrency:
  group: pages
  cancel-in-progress: false

env:
  BQTABLE: https://bqtable.kauefar.workers.dev

jobs:
  empacotar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - uses: pnpm/action-setup@v6
        with:
          version: 12
          cache: true
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm typecheck
      - name: Empacotar
        run: |
          id=$(node -p "require('./jogo/manifest.json').id")
          mkdir -p _site
          pnpm exec bqgame-pack jogo "_site/$id.bqgame"
          dono=$(echo "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
          pacote="https://$dono.github.io/${GITHUB_REPOSITORY#*/}/$id.bqgame"
          echo "Jogar: $BQTABLE/jogar?url=$pacote" >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-pages-artifact@v5
        with:
          path: _site

  publicar:
    needs: empacotar
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

3. Faça commit do `pnpm-lock.yaml` e dê push na `main`. O link para jogar aparece no resumo da execução, na aba **Actions**.

- O site do GitHub Pages é sempre público, mesmo quando o repositório é privado (e Pages em repositório privado exige plano pago do GitHub). Jogo que não pode ficar público, como o Eternal Decks, não usa este workflow e abre por **Escolher arquivo**.
- O CI usa o mesmo `pnpm-workspace.yaml`: sem a linha do bqtable no `allowBuilds`, o install falha lá também.
- O workflow chama o `bqgame-pack` direto, com o nome `<id>.bqgame` dentro de `_site/`, e não o `pnpm empacotar`. O GitHub Pages aceita arquivos de até 100 MB.

## Para quem mexe no bqtable

- As entradas ficam em `src/sdk/` (`index.ts` e `testing.ts`). O lint impede que elas importem React ou a tela.
- `pnpm build:sdk` (que também roda no `prepare`) gera `dist-sdk/` com o JS (esbuild) e os `.d.ts` (tsc, com os caminhos `@/` reescritos). O `package.json` publica só `dist-sdk/`, `docs/engine/` e o `pack-game.mjs` (campo `files`).
- Dentro do repositório, `examples/` importa de `bqtable/sdk` por alias (`vite.config.ts` e `tsconfig.test.json`), direto do fonte.
- Mudou algo que um jogo vê (manifest, comandos, API das regras, exportações da SDK, `bqgame-pack`)? Anote na hora em [VersoesSDK.md](VersoesSDK.md), na seção da versão em preparo. Para lançar, crie a tag nova (`sdk-v0.2.0`), feche a seção dela (VersoesSDK.md, "Como manter este arquivo") e avise os jogos.
- O `package.json` também publica `docs/engine/`: o jogo lê a documentação da versão que instalou.
