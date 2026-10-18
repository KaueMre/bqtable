# Versões da SDK

O que mudou em cada versão da SDK, para quem mantém um jogo em outro repositório ([SDK.md](SDK.md)). Ao trocar a tag no `package.json` do jogo, leia as seções das versões entre a sua e a nova. Cada uma separa o que **precisa mudar**, o que **precisa conferir**, o que é **novo para aproveitar** (com o jeito de usar e o contorno do seu jogo que fica sobrando) e o que **mudou sem você fazer nada**.

**Dois relógios.** A tag da SDK (`"bqtable": "github:KaueMre/bqtable#sdk-v0.2.0"`) traz os tipos, o `loadGameFolder` dos testes (que valida o manifest com o esquema daquela versão) e o `bqgame-pack`. Quem roda o pacote é o motor publicado no site, que acompanha a `main` do bqtable. Um recurso só funciona para quem joga quando está **no site**, e só é validado nos testes do jogo quando está **na tag**. O índice mostra as duas datas.

Campo novo no manifest pode entrar no pacote antes da tag: o esquema descarta em silêncio as chaves que não conhece, então os testes na versão antiga passam (sem validar o campo), e o `.bqgame` leva o `manifest.json` como está. O campo funciona assim que o motor novo estiver no site.

A partir da 0.2.0, este arquivo vem junto com a SDK, na mesma versão da tag: `node_modules/bqtable/docs/engine/VersoesSDK.md`, ao lado do `FormatoBqgame.md` e do `SDK.md`.

## Índice

| Versão | Tag | No site | Destaques | Precisa mudar? |
|---|---|---|---|---|
| [0.2.0](#sdk-v020-em-preparo) | ainda não | 17/10/2026 | Movimento na tela, fim de partida competitivo, partida em rede | Só regras em TypeScript que leem `state.ended.result` |
| [0.1.0](#sdk-v010) | 17/10/2026 | 17/10/2026 | Primeira versão | — |

## sdk-v0.2.0 (em preparo)

Ainda sem tag; no site desde 17/10/2026 (commit `b41d491`). Antes da tag:

- **`motion` já pode ir no manifest:** os testes na 0.1.0 ignoram o campo, e o site o usa. O `fromHand` dentro dele chega ao site no próximo push da `main` (antes disso, o site ignora só ele).
- **`endGame` com `winners` ainda não:** na 0.1.0, os tipos exigem `result`, e o motor dos testes recusa o comando sem ele.
- Para testar tudo antes da tag, use `"bqtable": "link:../bqtable"` e rode `pnpm build:sdk` no bqtable ([SDK.md](SDK.md)).

### Precisa mudar

- **`GameEnd.result` ficou opcional** (`state.ended.result` e o evento `gameEnded`): um fim competitivo pode vir só com `winners`. Regras em TypeScript que usam `result` como se ele sempre existisse deixam de compilar. Trate o `undefined`, ou leia `winners`. Comparações como `state.ended?.result === 'win'` continuam valendo.

### Precisa conferir

Para o jogo funcionar bem em **partida em rede** ([FormatoBqgame.md](FormatoBqgame.md), seção 13, "Partida em rede"):

- **Baralho virado precisa de `hiddenStatuses`** no kind (seção 4). Sem ele, a carta virada aparece como verso na tela, mas o id e os atributos dela vão para todos os jogadores, e a ordem do baralho deixa de ser segredo.
- **Gestos (`game.gesture`) e ações não devem depender do id de uma peça virada.** O convidado recebe a peça virada com um apelido pela posição (`baralho~12`), que muda quando a ordem muda.
- **Comandos sem dono passam para qualquer jogador**: `setGlobal`, `endGame` e os comandos do jogo. Se só o jogador da vez pode, a regra confere `cmd.actor` (como o `comprar` da pirâmide).

### Novo para aproveitar

#### Movimento na tela (`motion`)

As peças podem se mover na tela em vez de sumir de um lugar e aparecer no outro. São três momentos: o arrasto (seguir o ponteiro ou mirar com uma flecha), a chegada (`instant`, `drop`, `move` reto ou em arco, `showcase` em evidência) e o efeito depois (`shake`, `glow`). Vale para toda mudança de lugar: regras, ações, rede e arrasto. Sem `motion`, nada muda. Detalhes no [FormatoBqgame.md](FormatoBqgame.md), seção 4, "Movimento na tela".

Como aproveitar:

- **Peças de tabuleiro movidas pelas regras:** `"motion": { "place": { "type": "move", "path": "arc" }, "after": "glow" }` no kind. Nas regras, mande um `dropInto` por casa na mesma jogada: a peça passa por cada casa, em ordem, em vez de cortar na diagonal.
- **Cartas jogadas da mão, como no Slay the Spire:** `"drag": "arrow"` no kind da carta e `"motion": { "place": "showcase", "after": "glow" }` na zona onde a carta é jogada. A carta cresce em evidência ao ir para essa zona; no resto (comprar, descartar), segue o `place` do kind, por exemplo `"move"`.
- **Fichas e peças criadas pelas regras:** `"place": "drop"` faz a peça cair no lugar, e todos percebem onde ela apareceu.
- **Padrão do jogo todo:** `table.motion`. O `motion` de cada kind vence campo a campo, e o da zona vence o do kind.
- **A carta jogada e a que as regras movem, diferentes (`fromHand`):** `"fromHand": { "place": "showcase", "after": "shake" }` no kind vale só para a peça que saiu de uma mão; o resto segue o `place` e o `after` de sempre (ex.: arco com luz). O `fromHand` vence até a zona, então zonas que só forçavam o arco porque recebem muitas cartas das regras (descarte, deck) podem continuar como estão.
  - **Contorno que fica sobrando:** pôr `motion` em cada zona que recebe cartas das regras para tirar a evidência do kind. Com `fromHand`, a evidência fica no `fromHand` do kind, e o `place` do kind volta a ser o das regras.

Tipos novos em `bqtable/sdk`: `Motion`, `ZoneMotion`, `ArrivalMotion`, `PlaceMotion`, `AfterMotion`. Pedidos atendidos: Hot Streak M2, Eternal Decks M19.

#### Fim de partida competitivo (`winners`, `ranking`)

O `endGame` aceita `winners` (um ou mais jogadores; mais de um é empate) e `ranking` (o placar final: `player`, `score`, `label`, `text`). O título depende de quem olha ("Você venceu!", "Vitória de Bia", "Empate: Ana e Bia"), e o placar vira uma tabela com texto rico. Detalhes no [FormatoBqgame.md](FormatoBqgame.md), seção 14, "Fim de partida".

- **Contorno que fica sobrando:** `endGame` com `result: "draw"` e o placar escrito na `message`.
- O comando recusa um jogador que não existe ou que aparece duas vezes em `winners` ou em `ranking`.

Tipo novo em `bqtable/sdk`: `RankEntry`. Pedido atendido: Hot Streak M1.

#### Partida em rede

Com um jogo aberto, **Hospedar** cria uma sala e mostra um link. Quem abre o link joga do próprio aparelho, sem precisar do arquivo do jogo, e a partida roda no navegador de quem hospedou (desfazer e reiniciar são só dele). O pacote não precisa de nada novo, além do que está em "Precisa conferir".

### Mudou sem você fazer nada

- O `loadGameFolder` passa a validar `motion` (no kind, em `table` e na zona) e o `endGame` passa a validar `winners` e `ranking`. Na 0.1.0, um `motion` com erro de digitação passava calado nos testes; agora o teste acusa.
- A SDK traz a documentação da mesma versão em `node_modules/bqtable/docs/engine/`.

### Pedidos dos jogos

| Jogo | Pedido | Situação |
|---|---|---|
| Hot Streak | M1. Fim de partida com vencedores e placar | Nesta versão |
| Hot Streak | M2. Animar as peças que as regras movem | Nesta versão |
| Hot Streak | M8. `redactFor` em `bqtable/testing` | Sugerido para esta versão; ainda não entrou |
| Hot Streak | M3 a M7, M9 | Ainda não |
| Eternal Decks | M19. Movimento pela origem da peça (`fromHand`) | Nesta versão (no site no próximo push) |

## sdk-v0.1.0

17/10/2026. Primeira versão: as três portas (`bqtable/sdk`, `bqtable/testing` e o comando `bqgame-pack`) e o formato `bqgame/1` como estava no [FormatoBqgame.md](FormatoBqgame.md) desse dia. Esta versão não traz a documentação dentro do pacote: leia o arquivo na tag, no GitHub.

## Como manter este arquivo

Para quem mexe no bqtable:

- **Anote na hora.** Na mesma mudança que altera algo que um jogo vê, escreva em "sdk-vX (em preparo)". Contam: o formato do manifest (`src/engine/package/manifest.ts`), comandos e eventos (`src/engine/core/`), a API das regras (`src/engine/package/rules.ts`), o que `src/sdk/` exporta, o `bqgame-pack` e o comportamento da tela que um jogo usa.
- **Escreva para quem mantém o jogo:** o que fazer no jogo, não como o motor foi feito. Aponte a seção do FormatoBqgame, o contorno que fica sobrando e o pedido do jogo atendido (M1 do Hot Streak).
- **Separe:** precisa mudar (quebra um tipo, um teste ou o jogo), precisa conferir, novo para aproveitar, mudou sem você fazer nada.
- **Ao criar a tag:** troque "(em preparo)" pela data, preencha a coluna "Tag" do índice, e abra uma seção nova "(em preparo)" no topo só quando houver a primeira mudança. Quando a `main` for publicada no site, preencha "No site".
