# Plano: jogos em repositórios próprios, site no ar e multiplayer P2P

Criado em 16/10/2026. Cada tarefa (1.0, 1.1, …) é autocontida e pode ir para um agente separado.

## Como usar

- Mensagem para o agente: _"Leia `docs/PlanoPublicacao.md`: seções Regras para agentes, Fatos verificados e a tarefa X.Y. Execute só essa tarefa."_
- O agente lê só os arquivos em **Ler** (e o que precisar abrir para editar). Nada de PDFs nem pastas de imagens.
- Ao terminar: marca `[x]` na tarefa e escreve de 1 a 3 linhas em **Resultado** (o que mudou, decisões, pendências). É o contexto da tarefa seguinte.
- **Agente** sugere o modelo: Sonnet para tarefas mecânicas, Opus para as de desenho.

## Regras para agentes

- Sem commit, push ou repositório remoto sem pedir ao usuário.
- Arte da editora (Eternal Decks) nunca entra em git nem em `public/`.
- Código e docs em português, no estilo do repo.
- Aceite = os comandos da tarefa passando. Se algo falhar, reportar a saída.

## Decisões (confirmar antes de despachar)

| #   | Decisão                                       | Padrão do plano                                                                                         | Consequência                                                                                                                                      |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Repo do Eternal Decks: público ou privado     | **Privado** (regras e textos da editora)                                                                | Privado: o site não abre por link (o raw do GitHub exige token). Joga-se escolhendo o arquivo, ou o host manda o pacote pelo P2P (Parte 3).        |
| D2  | Arte bruta (`imgs/`, `imgs2/`, PDFs, ~410 MB) | Fora do git, numa pasta local indicada por variável de ambiente                                         | Git LFS tem cota gratuita pequena para esse volume.                                                                                               |
| D3  | Como o repo do jogo recebe o motor            | Dependência git do bqtable com tag (`github:KaueMre/bqtable#sdk-v0.1.0`), importando de `bqtable/sdk` | Publicar no npm fica para quando houver autores de fora.                                                                                          |
| D4  | Hospedagem                                    | Cloudflare ligado ao GitHub: um Worker só com os arquivos do build (`wrangler.jsonc`). O painel não oferece mais Pages | Precisa de conta Cloudflare (passo manual do usuário).                                                                                            |
| D5  | Sinalização do WebRTC na versão base          | PeerJS com o servidor público deles, atrás de uma interface `Transport`                                 | Trocar por Trystero ou por um Worker próprio (3.6) sem mexer no resto.                                                                            |

## Fatos verificados (16/10/2026): não precisa reverificar

- `KaueMre/bqtable` é público.
- **Clone limpo não compila.** O `.gitignore` tem `games`, que pega qualquer pasta com esse nome: `src/games/tatto/` não está no git, mas `src/pages/sandbox/{DadosDemo,TabuleiroDemo,ZonasDemo}.tsx` importam `@/games/tatto/*`.
- Regras do Eternal Decks importam do motor só tipos. Os testes usam valores: `childrenOf` (`@/engine/core`), `loadGame` (`@/engine/package/game`, roda em Node) e `loadGameFolder` (`@/engine/testing`, que importa `scripts/pack-game.mjs`).
- O repo principal ainda aponta para jogos em: `tsconfig.test.json` (`include: games`), `vite.config.ts` (testes `games/**`), `package.json` (script `eternal-decks`), `scripts/eternal-decks-*.mjs` (há uma alteração não commitada em `eternal-decks-imagens.mjs`).
- CORS medido com `curl` (`Access-Control-Allow-Origin`):

  | De onde vem o pacote          | ACAO    | Observação                                                                                        |
  | ----------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
  | `raw.githubusercontent.com`   | `*`     | Só repo público; cache de 5 min.                                                                  |
  | `cdn.jsdelivr.net/gh/…`       | `*`     | Limite de ~20 MB por arquivo.                                                                     |
  | GitHub Pages (`*.github.io`)  | `*`     | Arquivo até 100 MB.                                                                               |
  | GitHub Releases (download)    | ausente | Redireciona para `release-assets.githubusercontent.com` sem CORS: **não serve**.                  |
  | itch.io (`html.itch.zone/html/<id>/`) | ausente | O iframe do itch não tem `sandbox`; a amostra veio com COEP `require-corp`.               |

- O jogo roda em `frame.html` num iframe `sandbox="allow-scripts"` (origem opaca). O build gera `<script type="module" crossorigin>`, então o servidor precisa mandar ACAO em `/assets/*`. O `pnpm preview` passa porque herda `server.cors: true`. Em produção, sem o header, quebra.
- O site usa `createBrowserRouter` e caminhos absolutos: `FRAME_URL = '/frame.html'` (`src/frame/protocol.ts`), `/exemplos/...` (`src/pages/play/exemplos.ts`).
- Pacote por URL: quem faz o `fetch` é o site, não o iframe (`src/engine/package/read.ts:46`). Caminhos relativos resolvem por `assets.base`, senão pelo endereço do pacote (`read.ts:93-111`).
- O motor já serve para um host autoritativo. `Manager.dispatch(cmd)` é atômico e valida o dono por `cmd.actor`. `viewFor(state, viewer, kinds)` (`src/engine/core/visibility.ts:46`) dá a visão de um jogador. `GameState` é JSON puro, mas inclui `rng` e `log`, e os eventos do log podem revelar peças escondidas. O manager nasce em `GameView` (`game.createMatch`, `src/engine/package/GameView.tsx:87`) e a tela despacha com `actor = viewer` (`src/engine/react/hooks.ts:16`).

## Ordem e paralelismo

```
1.0 ──┬─> 1.1 ──> 1.2
      ├─> 2.1 ──┬─> 2.2   (2.2 usa o SDK.md da 1.1)
      │         └─> 2.3   (opcional)
      └─> 3.1 ──> 3.2 ──> 3.3 ──> 3.4 (precisa da 2.1) ──> complementos
```

Depois da 1.0, as linhas 1.x, 2.x e 3.x andam em paralelo.

---

## Parte 1: jogos em repositórios próprios

### [x] 1.0 Site compila sem nenhum jogo

**Agente:** Sonnet · **Depende de:** nada

**Ler:** `.gitignore`, `tsconfig.test.json`, `vite.config.ts` (bloco `test`), `eslint.config.js` (regras `@/games/*`), `src/pages/sandbox/SandboxPage.tsx` e as três demos citadas nos fatos.

**Objetivo:** o repo principal não depende de nenhuma pasta de jogo. Os jogos continuam fora do git.

1. No `.gitignore`, trocar `games` por `/games/`, `/src/games/` e `/docs/games/` (mesmo efeito, com a intenção clara). Conferir no `git status` que nada novo aparece.
2. Nas três demos do sandbox, trocar os dados do Tatto por dados neutros (JSON pequeno em `src/pages/sandbox/` + faces de `faces.ts`). Se isso exigir reescrever a demo, remover a demo, o teste dela e a entrada no `SandboxPage`, e anotar no Resultado.
3. Tirar `games` do `tsconfig.test.json` e `games/**` do `vite.config.ts`. Não mexer em `scripts/eternal-decks-*` nem no script `eternal-decks`: eles saem na 1.2.

**Aceite:** num clone limpo numa pasta temporária, `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm lint`.

**Resultado:** `.gitignore` com `/games/`, `/src/games/`, `/docs/games/`. As três demos ficaram: Tabuleiro e Zonas usam `zonaPiramide` (`src/pages/sandbox/piramide.ts`, no lugar do `createTableau` do Tatto), e a DadosDemo lê `src/pages/sandbox/cartas.json` (naipes e mestres, schema zod na própria demo, faces de `faces.ts`). Novo `pnpm-workspace.yaml` com `allowBuilds: { esbuild: true }`: sem ele o pnpm 12 recusa o `install` num clone limpo (`ERR_PNPM_IGNORED_BUILDS`). Aceite passou numa cópia dos arquivos visíveis ao git (51 arquivos de teste, 333 testes).

### [x] 1.1 SDK do motor para repositórios de jogo

**Agente:** Opus · **Depende de:** 1.0 · **Decisão:** D3

**Ler:** `package.json`, `scripts/pack-game.mjs`, `scripts/pack-game.d.mts`, `src/engine/testing/index.ts`, `src/engine/package/game.ts` (exports), `src/engine/core/index.ts`, seção 16 de `docs/engine/FormatoBqgame.md`.

**Objetivo:** um repo de jogo instala o bqtable por git e importa de um contrato estável, sem os caminhos internos `@/engine/...`.

- Entradas públicas: `bqtable/sdk` (os tipos de quem escreve regras, como `GameApi`, `Command`, `Manager`, `GameState`, `Piece`, e os valores `childrenOf` e `loadGame`, vindo de `package/game`, não do `package/index` com React), `bqtable/testing` (`loadGameFolder`) e o binário `bqgame-pack` (o `pack-game.mjs`).
- `exports` e `bin` no `package.json`, mais o build da SDK (JS + `.d.ts`) num diretório próprio, gerado no `prepare` para funcionar como dependência git.
- `examples/piramide` passa a importar de `bqtable/sdk` (prova dentro do repo; alias no tsconfig/vitest se preciso). Atualizar a seção 16 do FormatoBqgame.
- `docs/engine/SDK.md` curto: como montar um repo de jogo (`package.json`, `tsconfig`, config do vitest, scripts).

**Aceite:** `pnpm build && pnpm test`. Numa pasta temporária fora do repo, um projeto mínimo com `"bqtable": "link:<repo>"` compila regras com os tipos da SDK, roda `loadGameFolder` num teste e empacota com `bqgame-pack`. Depois que o usuário criar a tag, repetir com `github:KaueMre/bqtable#sdk-v0.1.0`, o que confirma que o `prepare` roda.

**Fora do escopo:** publicar no npm. Criar a tag fica com o usuário.

**Resultado:** entradas em `src/sdk/` (lint barra React e a tela), `scripts/build-sdk.mjs` no `prepare` gera `dist-sdk/` (esbuild + `.d.ts` do tsc com `@/` reescrito), `files` publica só isso e o `pack-game.mjs` (agora com shebang e funcionando por link). O esbuild foi para `dependencies`, a versão foi para `0.1.0`, e o `loadGameFolder` ganhou `{ exclude }`. A pirâmide importa de `bqtable/sdk` por alias. Docs em `docs/engine/SDK.md`. O pacote fica numa subpasta `jogo/`, e o script se chama `empacotar` porque `pnpm pack` é comando nativo do pnpm. Aceite ok com `link:` e com `git+file://` de uma cópia commitada numa pasta temporária (o `prepare` roda). O pnpm 12 exige no `allowBuilds` do jogo a linha `bqtable@<url>#<commit>` que ele mesmo mostra. Tag `sdk-v0.1.0` criada em 17/10 (commit `2136708`). Teste com `github:` ok no eternal-decks: o `prepare` gerou o `dist-sdk/`, e os testes, o typecheck e o empacotamento passaram.

### [x] 1.2 Repositório do Eternal Decks

**Agente:** Sonnet · **Depende de:** 1.1 · **Decisões:** D1, D2

**Ler:** `games/eternal-decks/LEIAME.md`, `docs/engine/SDK.md`, `scripts/eternal-decks-imagens.mjs`, `scripts/eternal-decks-descricoes.mjs`, `package.json` (script `eternal-decks`).

**Objetivo:** `~/dev/eternal-decks` com git próprio, ligado ao bqtable só pela SDK.

1. Criar a pasta e rodar `git init` local (o remoto fica com o usuário). Levar o pacote (`manifest.json`, `data/`, `regras/`), os `.md` de `docs/games/eternal_decks/` para `docs/` e os dois scripts para `scripts/`, incluindo a alteração não commitada.
2. `.gitignore` do repo novo: `images/`, `*.bqgame`, arte bruta e PDFs. O script de imagens lê os recortes de `ETERNAL_DECKS_ARTE`. Padrão: o caminho atual em `bqtable/docs/games/eternal_decks/imgs/recortes`, até o usuário mover a arte.
3. Trocar os imports `@/engine/...` por `bqtable/sdk` e `bqtable/testing`. `package.json` com `bqtable` por git (tag) e os scripts `test`, `typecheck`, `imagens`, `pack` e `descricoes`.
4. `MotorPendente.md` e `NovidadesDoMotor.md` vão junto. Atualizar o LEIAME com os comandos e caminhos novos.
5. No bqtable, remover `scripts/eternal-decks-*.mjs` e o script `eternal-decks`. **Não apagar** `games/eternal-decks` nem `docs/games/eternal_decks` locais: o usuário apaga depois de conferir.

**Aceite:** no repo novo, `pnpm install && pnpm test && pnpm typecheck && pnpm imagens && pnpm pack` gera o `.bqgame`. Ele abre no `pnpm dev` do bqtable por **Escolher arquivo**, e o Stage A solo é jogável. No bqtable, o aceite da 1.0 continua passando.

**Resultado:** `~/dev/eternal-decks` com `git init` (sem commit). O pacote está em `jogo/`, os `.md` em `docs/`, e `scripts/imagens.mjs` (lê `ETERNAL_DECKS_ARTE`) e `scripts/descricoes.mjs`. Os testes usam `loadGameFolder(pasta, { exclude })`. O script de empacotar é `pnpm empacotar` (`pnpm pack` é comando do pnpm). Aceite ok: 161 testes, typecheck, 438 imagens, e o `.bqgame` (446 arquivos) igual ao antigo menos o LEIAME e um `"use strict"` no `regras.js`. No Chrome (headless, `pnpm dev` + **Escolher arquivo**), o Stage A abriu, uma carta foi para o topo e a vez passou para Beta. No bqtable saíram os scripts e o `eternal-decks`, e o `.gitignore` ficou só com `/games/`, `/src/games/` e `/docs/games/`. O aceite da 1.0 passou de novo. Em 17/10, o repo foi para `gartergar/eternal-decks` (privado) e passou a usar `github:KaueMre/bqtable#sdk-v0.1.0`, com a linha `bqtable@…` no `allowBuilds`. Os 161 testes, o typecheck e o `.bqgame` passaram, com o mesmo conteúdo de antes. **Pendente:** o usuário apaga `games/eternal-decks` e `docs/games/eternal_decks` (a arte segue lá até ser movida).

---

## Parte 2: site no ar

### [x] 2.1 Deploy no Cloudflare (era Pages, virou Worker com arquivos estáticos)

**Agente:** Sonnet · **Depende de:** 1.0 · **Decisão:** D4

**Ler:** `vite.config.ts`, `src/frame/protocol.ts` (`FRAME_URL`, `FRAME_SANDBOX`), `index.html`, `frame.html`.

1. Criar `public/_headers` (o frame tem origem opaca e carrega módulos com CORS):
   ```
   /assets/*
     Access-Control-Allow-Origin: *
   ```
2. Não criar `404.html` na raiz do `dist`. Sem ele, o Pages trata o projeto como SPA e serve o `index.html` em rotas desconhecidas, o que cobre `/jogar?url=…` aberto direto.
3. `.node-version` com `22` (Vite 8).
4. Verificar localmente com `npx wrangler pages dev dist`, que emula o `_headers` e a regra de SPA sem precisar de conta. Testar `/`, `/jogar` aberto direto, os três exemplos e `/jogar?url=https://raw.githubusercontent.com/KaueMre/bqtable/main/public/exemplos/piramide.bqgame`, no Chrome e no Firefox, com o console sem erro de CORS ou CSP. Ponto de atenção: a CSP do frame usa `'self'` dentro de uma origem opaca. Se algum navegador bloquear, gerar a CSP com a origem explícita no build.
5. Deixar no Resultado o passo a passo do usuário: criar o projeto no Pages, conectar `KaueMre/bqtable`, build `pnpm build`, saída `dist`, previews por branch ligados. Depois do primeiro deploy, repetir o passo 4 na URL `*.pages.dev`.

Plano grátis do Pages: 25 MiB por arquivo e 20 mil arquivos. Alternativa sem conta: GitHub Pages, que exige `base: '/bqtable/'`, `basename` no router, `FRAME_URL` e exemplos via `import.meta.env.BASE_URL`, e cópia de `index.html` para `404.html`. Só seguir esse caminho se o usuário pedir.

**Aceite:** o passo 4 passando no `wrangler pages dev` e depois na URL publicada.

**Resultado:** `public/_headers`, `.node-version` (22) e `.wrangler` no `.gitignore`. Em 17/10, o painel do Cloudflare não oferecia mais criar um projeto Pages, só um Worker. Por isso entrou o `wrangler.jsonc`: um Worker sem código, com `assets.directory: ./dist` e `not_found_handling: single-page-application`, que faz o papel da regra de SPA do Pages. O passo 4 passou no `wrangler dev` (modo Workers, wrangler 4.151), no Chrome e no Firefox (Playwright), sem erro de CORS nem de CSP. O `wrangler deploy --dry-run` aceitou a configuração. No modo Workers não há `Access-Control-Allow-Origin` por padrão, então o `_headers` é necessário (o `pages dev` mandava em tudo). O `'self'` da CSP do frame funciona nos dois navegadores. `/frame.html` redireciona para `/frame` (307) e o iframe acompanha. **Falta (usuário):** commit e push do `wrangler.jsonc`, e depois:

1. dash.cloudflare.com → Workers e Pages → Criar → importar o repositório `KaueMre/bqtable`.
2. Nome do Worker: `bqtable`, igual ao `name` do `wrangler.jsonc`. Build command `pnpm build`, deploy command `npx wrangler deploy` (padrão), path `/`, preview builds ligados.
3. Variável de build `PNPM_VERSION` = `12.10.1`, a versão local. A imagem de build pode trazer um pnpm antigo que não lê o lockfile v9 nem o `pnpm-workspace.yaml`. O Node vem do `.node-version`. O `prepare` da 1.1 também roda nesse `pnpm install`.
4. Depois do primeiro deploy, repetir o passo 4 em `https://bqtable.<subdomínio>.workers.dev` e marcar `[x]`.

Publicado em 17/10 em **https://bqtable.kauefar.workers.dev** (commit `2737f00`). O passo 4 passou lá, no Chrome e no Firefox, sem erro de CORS nem de CSP. Rotas desconhecidas devolvem o `index.html`, e `/assets/*` vai com `Access-Control-Allow-Origin: *`.

### [x] 2.2 Abrir jogos de qualquer repositório git

**Agente:** Sonnet · **Depende de:** 2.1 (e o `SDK.md` da 1.1 para o item 4)

**Ler:** `src/pages/play/PlayPage.tsx` (`porUrl` e `?url=`), `src/engine/package/read.ts` (linhas 40 a 111), seções 1 e 2 de `docs/engine/FormatoBqgame.md`.

**Objetivo:** colar qualquer endereço de um jogo no GitHub e jogar.

1. Normalizar a URL no site (função pura com testes): `github.com/<o>/<r>/blob/<ref>/<caminho>` e `/raw/` viram `raw.githubusercontent.com/<o>/<r>/<ref>/<caminho>`. Atalho `?gh=<o>/<r>@<ref>/<caminho>`, com ref padrão `main`. Link de Release vira mensagem clara: o GitHub não manda CORS nesses downloads; use Pages ou raw.
2. Erro legível quando faltar CORS (o `fetch` falha com `TypeError`): o servidor do pacote precisa mandar `Access-Control-Allow-Origin`.
3. Testar a forma "pasta" (sem zip): um `manifest.json` por URL com `data/`, `images/` e `regras.js` relativos, servido pelo raw. Registrar no FormatoBqgame se funciona ou o que falta. As regras precisam estar compiladas: um repo só com `.ts` não roda.
4. Modelo de workflow do GitHub Actions no `SDK.md` que testa, empacota e publica o `.bqgame` no GitHub Pages do repo do jogo. Link resultante: `/jogar?url=https://<dono>.github.io/<repo>/<id>.bqgame`.
5. Na seção 1 do FormatoBqgame, tabela "onde hospedar um jogo" com os fatos de CORS deste plano.

**Aceite:** testes da normalização. Na URL publicada, a pirâmide abre por um link `github.com/.../blob/...` e por `?gh=`.

**Resultado:** `src/pages/play/enderecos.ts` (`normalizarUrl` e `urlDoGh`, com testes) cobre `blob` e `raw` (que viram raw), `tree` (abre o `manifest.json` da pasta) e Release (mensagem, sem baixar), e a PlayPage aceita `?gh=`. Já o `fetchOk` lança `NetworkError` com a explicação do CORS, no site e no iframe. A forma pasta funciona pelo raw, e `rules` em `.ts` agora dá um erro que pede a versão compilada (`loadRules`). A seção 1 do FormatoBqgame ganhou os links do GitHub, "Pasta por URL" e "Onde hospedar um jogo". Aceite ok na URL publicada (Chrome e Firefox): a pirâmide abre por `github.com/.../blob/...` e por `?gh=`, com e sem `@ref`, e a mesa com zonas abre por `/tree/`. O item 4 ficou na seção "Publicar no GitHub Pages" do `SDK.md`. O workflow testa, empacota com o nome `<id>.bqgame` e publica com as actions oficiais do Pages, e o link para jogar aparece no resumo da execução. Ele foi validado contra o schema de workflows, e os passos `run:` foram simulados num clone limpo de um repo de jogo montado conforme o `SDK.md` (pirâmide em `jogo/`, bqtable pela tag). Ainda não rodou no GitHub de verdade, porque não há repo de jogo público para isso. O Eternal Decks é privado e não usa o workflow.

### [ ] 2.3 itch.io (opcional)

**Veredito:** dá para usar como vitrine, com um build próprio. Não serve como site principal.

- O jogo fica em `https://html.itch.zone/html/<id>/index.html` (um subcaminho). Precisa de `base: './'`, router por hash ou em memória, e `FRAME_URL` e exemplos relativos.
- O CDN do itch não manda ACAO, então os `<script type="module" crossorigin>` do frame não carregam na origem opaca. A saída é um build do frame com script clássico (IIFE, sem `type="module"`, sem `crossorigin`, sem modulepreload), que carrega em modo no-cors. Outra opção é deixar o JS inline no `frame.html`, com hash na CSP.
- O `?url=` não chega ao jogo, porque a URL do iframe é fixa do itch. O campo de URL e o arquivo funcionam, mas links por jogo e links de sala do P2P não.
- Não marcar a opção SharedArrayBuffer do itch: ela liga COEP `require-corp` e bloqueia imagens de outros domínios.
- Recomendação: uma página no itch que leva ao site do Pages. O build próprio só se o usuário quiser o jogo rodando dentro do itch.

**Tarefa, se pedida.** **Agente:** Sonnet · **Depende de:** 2.1. Criar `pnpm build:itch` com os ajustes acima, gerar o zip e testar como rascunho restrito no itch.

**Resultado:**

---

## Parte 3: multiplayer P2P (um jogador é o host)

**Arquitetura, valendo para todas as tarefas:**

- Host autoritativo. O manager de verdade só existe no iframe do host. Os convidados usam um `RemoteManager` (mesma interface `Manager`) alimentado pelo host.
- A rede fica na página do site, fora do iframe. Site e iframe conversam por `postMessage` (tipos novos em `src/frame/protocol.ts`). Sites conversam entre si por um `Transport`.
- O host decide o assento de cada conexão e sobrescreve o `actor` de todo comando recebido. Nunca confia no `actor` que veio do convidado.
- O host manda a cada jogador só o estado dele (`redactFor`). Nunca manda o estado inteiro.

```
convidado: tela → RemoteManager.dispatch → iframe→site (bq:net-out) → Transport
host:      Transport → site (marca o assento) → iframe (bq:net-in) → manager.dispatch({ ...cmd, actor: assento })
           manager.subscribe → redactFor(state, assento) para cada convidado → bq:net-out → Transport
convidado: Transport → site → iframe (bq:net-in) → RemoteManager.setState
```

### [x] 3.1 Estado por jogador e RemoteManager (motor, sem rede)

**Agente:** Opus · **Depende de:** 1.0

**Ler:** `src/engine/core/{state,visibility,manager,events}.ts`, `src/engine/react/hooks.ts`, `src/engine/react/ManagerProvider.tsx`.

Tudo em `src/engine/net/`, com testes em Node:

- `redactFor(state, viewer, kinds): GameState`: peças conforme `viewFor` (as escondidas somem, as viradas ficam sem face, atributos e tags); `log` sem entradas `to` de outros jogadores e sem eventos que revelem peças escondidas para quem vê; `rng` zerado; `pending` de outro jogador sem `options`.
- `createRemoteManager(send)` implementa `Manager`. `getState` devolve o último estado recebido; `setState` avisa quem fez `subscribe`; `dispatch` envia ao host e devolve `ok([])`; `check` devolve `true` (quem recusa é o host, e a recusa chega por mensagem); `undo` e `register*` são recusados com mensagem. Definir o callback que mostra na tela a recusa do host.
- Teste de ponta a ponta sem rede: o manager do host e dois `RemoteManager` ligados por função, jogando a pirâmide (`loadGameFolder('examples/piramide')`). Os estados convergem, e o p1 não vê a mão do p2 nem no estado nem no log, nem depois de comprar ou embaralhar.

**Aceite:** `pnpm test && pnpm typecheck`.

**Resultado:** `src/engine/net/` com `redactFor`, `commandFrom` e `createRemoteManager` (17 testes, com a pirâmide de ponta a ponta). O plano não previa um vazamento: o id de uma carta diz qual ela é (`rascunho-2`). Por isso, cada peça virada para quem vê ganha um apelido pela posição (`baralho~12`, `p2-mao~0`), que muda quando a ordem muda, e o host traduz de volta com `commandFrom`, que também força o `actor` do assento, inclusive dentro de `batch`. O log perde as entradas que citam peças que ele não vê, e o `pending` sai sem `resume` e sem `context`. A recusa do host chega por `remote.reject(motivo)` e vira o `lastError` do store (a mesma barra de "Recusado:"). A pirâmide ganhou `hiddenStatuses: ["faceDown"]` na carta (sem isso, o baralho era público no estado) e o `public/exemplos/piramide.bqgame` foi refeito. **Limites:** o histórico de uma carta já revelada continua no log, e os comandos sem regra de dono (`setGlobal`, `endGame`, comandos do jogo) passam para qualquer assento, como na mesa local.

### [x] 3.2 Protocolo e sessões, com transporte em memória e entre abas

**Agente:** Opus · **Depende de:** 3.1

**Ler:** `src/engine/net/*` (da 3.1), `src/frame/protocol.ts`.

- Interface `Transport` mínima: `send(peer, msg)`, `onMessage`, `onPeer(open/close)`. Implementações: `MemoryTransport` (testes) e `BroadcastChannelTransport` (duas abas do mesmo navegador, para desenvolver sem WebRTC).
- Mensagens versionadas (`v: 1`) e validadas com zod: `hello`, `welcome { seat, pacote: { nome, tamanho, hash } }`, `pkg-chunk { i, n, bytes }` (no máximo 16 KiB), `state { seq, state }`, `cmd { cmd }`, `rejected { reason }`, `ping`/`pong`, `bye`.
- `HostSession`: assentos conforme `players` do manifest, fila de comandos, envio do pacote em pedaços e snapshot completo a cada mudança (deltas ficam para os complementos). `GuestSession`: junta os pedaços, confere o hash, entrega os bytes e os estados.

**Aceite:** testes com `MemoryTransport` cobrindo entrar, receber o pacote, jogar, comando do assento errado recusado e `actor` forjado sobrescrito.

**Resultado:** `src/engine/net/protocol.ts` (mensagens `v: 1` com zod, `parseMessage`, `sha256`), `transport.ts` (`Transport`, `createMemoryNetwork` e `createBroadcastTransports`, ambos com `host(sala)` e `join(sala)`; o id do host é o id da sala) e `session.ts` (`createHostSession` e `createGuestSession`). O host aplica com `applyFrom(manager, assento, cmd)` e publica com `statesFor(manager, assentos)`. O `bye` também avisa "mesa cheia" e "o host fechou a mesa", e o convidado fecha se o hash não conferir. 10 testes novos, com a pirâmide e um pacote de 3 pedaços, mais um teste do `BroadcastChannel` no Node. **Para a 3.4:** o controle de fluxo fica no transporte; a sessão manda todos os pedaços de uma vez.

### [x] 3.3 Integração no site e no iframe (duas abas)

**Agente:** Opus · **Depende de:** 3.2

**Ler:** `src/frame/protocol.ts`, `src/frame/FrameApp.tsx`, `src/pages/play/PlayPage.tsx`, `src/engine/package/GameView.tsx` (linhas 80 a 140, `ViewerScope`).

- `FrameLoad` ganha `net?: { role: 'host' | 'guest'; seat: string }`. No host, `GameView` usa o manager normal, com o viewer fixo no próprio assento, e publica os estados por assento. No convidado, usa o `RemoteManager`, sem "Ver como" e sem reiniciar.
- Mensagens novas entre site e iframe: `bq:net-in` e `bq:net-out`.
- PlayPage: botão **Hospedar** (com um jogo carregado) cria a sala e mostra o link `/jogar?sala=<id>`. Quem abre o link entra como convidado e recebe o pacote do host, sem precisar do arquivo. Mostrar a lista de conectados.
- Desfazer e reiniciar: só o host.

**Aceite:** testes de componente (`FrameApp` com `role`) e teste manual com duas abas jogando a pirâmide pelo `BroadcastChannelTransport`.

**Resultado:** o `FrameLoad.net` (`role`, `seat`, mais `players` e `options` do host para o convidado) e as mensagens `bq:net-in`/`bq:net-out` (o site confere com `isFrameNetOut`). No iframe, o `GameView` ganhou `net`: o host publica `statesFor` dos assentos `p1…pN` e aplica com `applyFrom`; o convidado (`GuestGame`) espera o primeiro estado e joga com o `RemoteManager`, com gestos e ações de uma partida local com as mesmas opções. A tela fica no assento, sem "Ver como"; desfazer e reiniciar só aparecem no host. No site, `src/pages/play/rede.ts` tem o `FrameLink` (ponte que guarda o que chega antes), `abrirMesa` (a rede só abre quando chega o primeiro estado, e o `welcome` leva jogadores e opções) e `entrarNaMesa`. A `PlayPage` ganhou **Hospedar** (o iframe recomeça com 2 jogadores e a tela no p1), o link, **Copiar**, **Encerrar**, a lista de quem entrou e `/jogar?sala=` com o progresso do pacote. Testes: `FrameApp.net.test.tsx` e `rede.test.ts`, 411 no total. Teste com duas abas (Playwright, `pnpm dev`) no Chrome e no Firefox: entrar, receber o pacote, passar a vez nos dois sentidos, comprar com duplo clique, arrastar a carta do topo do baralho pelo apelido (`baralho~12`), recusa ao comprar para a mão do host, terceiro convidado com "mesa cheia" e "o host fechou a mesa" ao encerrar. Nenhum erro no console além do `favicon.ico`, que já faltava.

### [ ] 3.4 WebRTC (versão base)

**Agente:** Sonnet · **Depende de:** 3.3 e 2.1 · **Decisão:** D5

**Ler:** `src/engine/net/` (interface `Transport` e as duas implementações).

- `PeerJsTransport`: o id do host no PeerJS é o id da sala; os convidados conectam por um DataChannel confiável e ordenado.
- STUN públicos: `stun:stun.l.google.com:19302` e `stun:stun.cloudflare.com:3478`.
- Controle de fluxo no envio do pacote (`bufferedAmountLowThreshold`).
- Estado da conexão na tela: conectando, conectado, falhou. Na falha, explicar que a rede bloqueou a conexão direta (o caso que o TURN da 3.5 resolve).

**Aceite:** na URL publicada, dois aparelhos em redes diferentes (por exemplo Wi-Fi e 4G) jogam a pirâmide. Anotar no Resultado quais combinações de rede conectaram.

**Resultado:** `src/engine/net/peerjs.ts` (`createPeerJsTransports`). O host fica no servidor público do PeerJS com o id `bqtable-<sala>`, e o convidado conecta com `reliable: true` (sem isso, o PeerJS abre o canal fora de ordem) e `serialization: 'raw'`. As mensagens vão em quadros binários de até 32 KiB (`frames.ts`): o pedaço de 16 KiB cabe num quadro, e o estado grande vai em vários. O controle de fluxo é uma fila por conexão: para acima de 1 MiB no `bufferedAmount` e volta no `bufferedamountlow` (256 KiB). Usa os STUN do Google e da Cloudflare. `Transport.onStatus` diz quando a sala abriu ou por que falhou: ICE falhou, 20 s sem abrir ou canal fechado antes de abrir viram "a rede bloqueou a conexão direta…, tente os dados do celular"; há também "a sala não existe" e "servidor do PeerJS fora do ar". O PeerJS é carregado só ao hospedar ou entrar (91 kB, 25 kB com gzip); o padrão é `p2p`, e `?rede=abas` continua para desenvolver. Na tela, o host vê "Abrindo a sala…" e depois o link; o convidado vê "Conectando ao host…", "Conectado. Recebendo o jogo… N%" e, se der errado, "Não foi possível conectar: …" ou "A conexão acabou: …". **Segurança, achado aqui:** dá para adivinhar os ids reais pelos dados (`prototipo-1`), e o convidado podia tirar do baralho a carta que quisesse. Agora o host recusa ("peça desconhecida") o comando que cita uma peça que o assento não vê, e as recusas voltam com apelidos no lugar dos ids. A seção 13 do FormatoBqgame ganhou "Partida em rede". Testes locais (Playwright, PeerJS e WebRTC de verdade, as duas abas na mesma máquina): no Chrome, o roteiro da 3.3 passou inteiro no `pnpm dev` e no build servido pelo `wrangler dev`, com o console limpo, e um pacote de 31 MB chegou em 12 s. O Firefox do Playwright não junta candidatos ICE nem com duas `RTCPeerConnection` na mesma página (limite do ambiente). Nele, a falha aparece na tela com a mensagem certa. **Falta (usuário):** commit e push (o Worker publica sozinho). Depois, o aceite na URL publicada: dois aparelhos em redes diferentes (Wi-Fi e 4G), de preferência com Firefox ou Safari num deles, anotando aqui as combinações que conectaram.

### Complementos (cada um vira tarefa quando chegar a vez)

- [ ] **3.5 TURN.** Credenciais temporárias (Cloudflare Realtime TURN, ou Metered/Open Relay no plano grátis), geradas por um endpoint mínimo (Pages Function ou Worker) para não expor a chave. Diagnóstico de rede na tela.
- [ ] **3.6 Sinalização própria.** Um Cloudflare Worker com Durable Object (plano grátis) no lugar do servidor público do PeerJS, atrás do mesmo `Transport`.
- [ ] **3.7 Reconexão e queda do host.** O convidado volta para o mesmo assento (token por assento). O host guarda snapshots, e outro jogador pode assumir a partida a partir do último (migração de host).
- [ ] **3.8 Eficiência.** Deltas por `seq` no lugar de snapshots; compressão com `fflate`.
- [ ] **3.9 Mesa.** Lobby com escolha de assento e cor, espectadores (visão pública), chat, indicador de latência, desfazer por pedido aceito pelo host.
- [ ] **3.10 Limites documentados.** O host vê tudo e poderia trapacear. No celular, a aba em segundo plano derruba a conexão.
