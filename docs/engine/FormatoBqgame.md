# Formato de jogo `bqgame/1`

Como empacotar um jogo para o bqtable: um arquivo que qualquer pessoa abre na página **Jogar** (enviando o arquivo ou colando uma URL) e o jogo começa.

O manifest descreve **componentes e setup**: mesa, zonas, cartas, fichas, dados, faces e o que acontece ao arrastar e dar duplo clique. As **regras automáticas** (o que pode ou não ser jogado, custos, pontuação, comandos do jogo) vão num **`regras.js`** dentro do pacote (seção 12). Sem `regras.js`, os jogadores aplicam as regras.

---

## 1. Dois jeitos de entregar um jogo

| Jeito | Quando usar |
|---|---|
| **`manifest.json` sozinho** | Jogo sem imagens próprias (faces desenhadas por modelos), ou com imagens em URLs. |
| **`.bqgame`** (um zip) | Jogo com arquivos de dados e imagens dentro. O `manifest.json` fica na raiz do zip, ou numa pasta única dentro dele. |

Exemplos prontos: `public/exemplos/baralho.json`, e as pastas `examples/mesa-zonas/` (dados e imagens) e `examples/piramide/` (regras em TypeScript, com testes), que viram `.bqgame` em `public/exemplos/` com `pnpm exemplos`.

Para gerar o `.bqgame` de uma pasta, use qualquer programa de zip, ou:

```
node scripts/pack-game.mjs <pasta-do-jogo> <saida.bqgame>
```

Link direto para um jogo: `/jogar?url=<endereço do .bqgame ou .json>`. No campo de URL e no `?url=`, um link de página do GitHub também serve: `github.com/<dono>/<repo>/blob/<ref>/<caminho>` (ou `/raw/`) vira o arquivo em `raw.githubusercontent.com`, e `/tree/<ref>/<pasta>` abre o `manifest.json` da pasta. Atalho: `/jogar?gh=<dono>/<repo>@<ref>/<caminho>`. Sem `@<ref>`, vale `main`, e a ref não pode ter `/`. Caminho terminado em `/` abre o `manifest.json` da pasta.

### Pasta por URL (sem zip)

Um `manifest.json` aberto por URL acha `data/`, `images/` e o `regras.js` pelo caminho relativo ao endereço dele (seção 2, item 3). Por isso a pasta do jogo num repositório público do GitHub abre sem empacotar: `/jogar?url=https://github.com/<dono>/<repo>/tree/main/<pasta>`. Testado em 17/10/2026, no Chrome e no Firefox, com `examples/mesa-zonas` pelo raw (dados e imagens) e com a pirâmide desempacotada (`regras.js` relativo).

- **As regras precisam estar compiladas.** O navegador não roda TypeScript: um manifest com `"rules": "regras/index.ts"` dá um erro que pede a versão compilada. Ou o repositório guarda o `.js` gerado e aponta `rules` para ele, ou publica o `.bqgame` (seção 16).
- Cada arquivo é um pedido separado. Com muitas imagens, o `.bqgame` abre mais rápido.

### Onde hospedar um jogo

O site baixa o pacote de outro endereço, e o iframe do jogo baixa dali os dados, as imagens e o `regras.js`. O servidor precisa mandar o cabeçalho `Access-Control-Allow-Origin` (CORS). Sem ele, a página mostra um erro que diz isso. Medido em 16/10/2026:

| Onde | Abre por link? | Observação |
|---|---|---|
| `raw.githubusercontent.com` (o arquivo no repositório) | Sim | Só repositório público. Cache de 5 minutos: uma mudança demora a aparecer. |
| GitHub Pages (`<dono>.github.io/<repo>/`) | Sim | Arquivo de até 100 MB. Bom para o `.bqgame` gerado por um workflow (modelo em `SDK.md`, "Publicar no GitHub Pages"). |
| jsDelivr (`cdn.jsdelivr.net/gh/<dono>/<repo>@<ref>/<caminho>`) | Sim | Até ~20 MB por arquivo. |
| GitHub Releases (download) | Não | O download redireciona para um endereço sem CORS. A página explica e não tenta baixar. |
| Repositório privado | Não | O raw exige token. Mande o arquivo (**Escolher arquivo**). |
| itch.io | Não | O CDN do itch não manda CORS. |
| Servidor próprio | Se mandar o cabeçalho | `Access-Control-Allow-Origin: *` no pacote e nos arquivos que ele usa. |

## 2. Imagens: dentro do pacote ou por URL

Toda imagem é indicada por um caminho, procurado nesta ordem:

1. **Arquivo dentro do pacote**: `"images/verso.png"`.
2. **Relativo à base de assets**, se o manifest tiver `"assets": { "base": "https://cdn.exemplo.com/meu-jogo/" }`: o mesmo `"images/verso.png"` vira `https://cdn.exemplo.com/meu-jogo/images/verso.png`.
3. **Relativo ao endereço do pacote**, se ele foi aberto por URL.
4. **URL absoluta** (`https://...`) é usada direto.

Assim dá para manter o pacote pequeno (imagens num servidor, só o manifest no arquivo), ou levar tudo junto, ou misturar. Formatos: PNG, JPG, WebP, GIF e SVG. Imagem que não carrega vira um retângulo com texto, e o jogo continua.

## 3. Estrutura do manifest

```jsonc
{
  "format": "bqgame/1",
  "id": "meu-jogo",                 // minúsculas, números e hífen
  "name": "Meu Jogo",
  "version": "1.0.0",               // opcional
  "author": "Fulana",               // opcional
  "description": "…",               // opcional
  "players": { "min": 1, "max": 4, "names": [ … ], "colors": [ … ], "seats": { … } }, // opcional (padrão 1 a 1)
  "options": [ … ],                 // opções escolhidas antes da partida (seção 9)
  "table": { "background": "#2d6a4f", "motion": { … } }, // motion: movimento padrão (seção 4)
  "assets": { "base": "https://…/" },
  "kinds": [ … ],                   // tipos de peça (obrigatório)
  "data": { … },                    // conjuntos de dados
  "lookups": { … },                 // tabelas para {campo|tabela}
  "templates": { … },               // modelos que desenham faces
  "prefabs": { … },                 // conjuntos reutilizáveis de peças
  "setup": [ … ],                   // como a mesa começa (obrigatório)
  "hud": [ … ],                     // contadores no painel
  "playerHud": [ … ],               // recursos de cada jogador no painel (seção 13)
  "rules": "regras.js"              // regras automáticas (opcional; no pacote ou URL)
}
```

Erros no arquivo aparecem na tela com o caminho do problema, por exemplo `kinds[0].statuses` ou `setup[3]: campo desconhecido: {nmoe}`.

## 4. Tipos de peça (`kinds`)

```json
{
  "kind": "carta",
  "statuses": ["faceDown", "faceUp"],
  "transitions": { "faceDown": ["faceUp"], "faceUp": ["faceDown"] },
  "reveals": [["faceDown", "faceUp"]],
  "attributes": { "type": "object", "properties": { "def": { "type": "string" } } },
  "defaults": { "size": { "w": 90, "h": 126 }, "faces": { "faceDown": "images/verso.png" } },
  "activate": { "cycleStatus": ["faceDown", "faceUp"] },
  "draggable": true,
  "data": "cartas"
}
```

- `statuses`, `transitions`: status possíveis e mudanças permitidas (sem `transitions`, qualquer mudança vale).
- `reveals`: mudanças de status que **revelam informação** (`[de, para]`; `"*"` = qualquer). Depois delas não dá para desfazer (ninguém vira a carta do topo, olha e volta). Vale para `setStatus` e para o status que a zona aplica ao receber a peça (`statusOnEnter`). Virar de volta para baixo não revela nada.
- `attributes`: **JSON Schema** dos atributos das peças desse tipo.
- `defaults`: tamanho, faces, tags e atributos padrão.
- `activate.cycleStatus`: o duplo clique passa para o próximo status da lista (virar carta).
- `draggable: false`: o jogador não arrasta peças desse tipo (zonas fixas). Uma peça com a tag `"locked"` também fica presa.
- `data`: conjunto de dados que o atributo `def` da peça referencia; o painel mostra os dados da peça selecionada.
- `hiddenStatuses`: status em que **ninguém** vê o que a peça é, nem o dono (o verso de uma carta no deck). A mesa mostra só a face desse status; o painel da peça mostra "virada"; o log esconde as jogadas com ela, inclusive a ordem de um embaralhar. Em zonas com dono e `privacy`, isso já vale para os outros jogadores (seção 13); `hiddenStatuses` vale para todos, em qualquer zona.
- `badges`: selos nos cantos, com `{campos}` dos atributos da peça: `[{ "text": "{valor}", "corner": "tr", "color": "#fff", "background": "#cf222e" }]` (`corner`: `tl`, `tr` (padrão), `bl`, `br`). Texto vazio = sem selo; peça virada não mostra selo.
- `hotspots`: áreas da peça, em coordenadas da peça (canto superior esquerdo = 0, 0): `[{ "id": "esquerda", "x": 0, "y": 0, "w": 30, "h": 90, "label": "Foco +1" }]`. O duplo clique numa delas manda o gesto `activate` com `area: "esquerda"` (`game.gesture` decide o comando). Com a peça selecionada, as áreas aparecem com contorno e rótulo.
- `motion`: como as peças desse tipo se movem na tela (abaixo).

### Movimento na tela (`motion`)

```json
{
  "kind": "mascote",
  "motion": {
    "drag": "arrow",
    "place": { "type": "move", "path": "arc", "duration": 300 },
    "after": "glow"
  }
}
```

Três momentos, cada um opcional. Sem `motion`, nada muda: a peça segue o ponteiro, some de um lugar e aparece no outro. É só desenho: nenhuma regra depende disso, e cada tela anima o que vê.

| Campo | Valor | O que acontece |
|---|---|---|
| `drag` (arrastar) | `follow` (padrão) | A peça vai junto com o ponteiro. |
| | `arrow` | A peça fica no lugar e uma flecha curva sai dela até o ponteiro, como a de mirar do Slay the Spire: azul sobre um lugar que aceita a peça, vermelha onde ela seria recusada, branca sobre a mesa livre. Os destaques das zonas continuam. |
| `place` (chegar) | `instant` (padrão) | Aparece direto no lugar novo. |
| | `drop` | Aparece um pouco acima do lugar e cai nele, com sombra: dá a ideia de 3D e mostra a todos onde a peça chegou. |
| | `move` | Vai do lugar de antes até o novo, por cima das outras peças. `"path": "arc"` faz uma curva, subindo e descendo, com sombra; `"line"` (padrão) vai reto. |
| | `showcase` | Cresce em evidência na tela (`"at"`: `center` (padrão), `left` ou `right`), fica parada `hold` ms (padrão 700) e vai ao lugar. |
| `after` (depois) | `none` (padrão) | Nada. |
| | `shake` | A peça treme (padrão 0,6 s). |
| | `glow` | Uma luz em volta da peça, pulsando de leve (padrão: até a próxima jogada). |

Com ajustes, `place` e `after` viram objetos: `{ "type": "move", "duration": 350, "path": "arc" }` (`duration` em ms: a queda do `drop`, cada trecho do `move`, cada ida do `showcase`) e `{ "type": "glow", "duration": 1500, "color": "#ffd866" }` (`duration` em ms, ou `"next"`: até a próxima jogada).

Onde configurar, do mais geral ao mais específico (o mais específico vence):

- `table.motion`: o padrão de todos os kinds.
- `kinds[].motion`: o do tipo, campo a campo por cima do da mesa.
- `zone.motion` (`place`, `after` e `fromHand`): como as peças **chegam nesta zona**. Ex.: a carta vai da mão para a zona de jogadas em evidência, mas chega à mão só deslizando.

```json
{ "kind": "carta", "motion": { "drag": "arrow", "place": "move" } }
{ "id": "jogadas", "kind": "zona", "zone": { "layout": "row", "motion": { "place": "showcase", "after": "glow" } } }
```

**Pela origem (`fromHand`):** `place` e `after` dentro de `fromHand` valem quando a peça **saiu de uma mão** (zona com `"hand": true`) nesta jogada: a carta que o jogador joga, arrastando ou por uma ação. Assim, a carta jogada e a que as regras movem podem chegar à mesma zona de jeitos diferentes.

```json
{ "kind": "carta",
  "motion": {
    "drag": "arrow",
    "place": { "type": "move", "path": "arc" }, "after": "glow",
    "fromHand": { "place": "showcase", "after": "shake" }
  } }
```

- O `fromHand` vence o `place` e o `after` de qualquer origem, inclusive os da zona: a carta jogada da mão vai em evidência até para um descarte com `"motion": { "place": "move" }`. Entre dois `fromHand`, o da zona vence o do kind, campo a campo. O da mesa (`table.motion.fromHand`) e o do kind também se juntam campo a campo.
- A origem é a zona onde a peça estava no começo da jogada, a mesma para todas as telas (na rede também, e mesmo para quem via a carta virada na mão de outro jogador).

Quando anima:

- Em toda mudança de lugar: regras, ações, o menu **Mover**, outro jogador na rede e o próprio arrasto. Peça arrastada sai de onde o jogador a soltou; com `arrow`, sai do lugar de antes.
- **Casa por casa:** quando as regras levam a peça por vários lugares numa jogada só (vários `dropInto` num `batch` ou em reações), o `move` passa por cada um, em ordem (a mascote que anda 3 casas e desvia não corta na diagonal). Até 2,4 s no total; com muitos passos, cada trecho fica mais curto.
- Quem só se ajeita (a fila que fecha o buraco, a mão que abre espaço, a pilha embaralhada) desliza rápido no lugar, sem efeito depois, se o kind tem `place`.
- Peça nova (`createPiece`): `drop` e `showcase` mostram a chegada; `move` não tem de onde sair e ela aparece direto.
- Várias em evidência na mesma jogada ficam lado a lado (até 6; mais que isso vão direto ao lugar). Uma jogada seguinte espera a evidência desta liberar.
- Qualquer jogada nova, ou pegar uma peça, para os efeitos de depois.
- **Desfazer:** a peça volta deslizando, sem evidência nem efeito.
- Mais de 40 peças mudando de lugar de uma vez: as que passarem disso vão direto.
- Com "reduzir movimento" ligado no sistema (`prefers-reduced-motion`), nada voa nem treme; a luz fica, sem pulsar.

## 5. Peças e zonas

Uma peça (em `setup` e `prefabs`):

```json
{
  "id": "monte",
  "kind": "zona",
  "faces": { "default": "Monte" },
  "size": { "w": 120, "h": 160 },
  "transform": { "x": 110, "y": 130, "rotation": 0, "scale": 1 },
  "parentId": null,
  "zone": { "layout": "stack", "accepts": { "kinds": ["carta"] }, "statusOnEnter": "faceDown" }
}
```

- `x, y` é o **centro** da peça: na mesa, em coordenadas da mesa; dentro de uma zona livre, a partir do canto superior esquerdo da zona.
- `faces`: status → imagem. Pode ser um caminho de imagem, `template:modelo/id`, ou um texto qualquer (vira o rótulo do placeholder; nas zonas, é o nome mostrado acima delas).
- `parentId` + `slot`: a peça começa dentro de uma zona (`slot` na grade é `"coluna,linha"`; nos encaixes, o id do encaixe).
- Peça com `zone` é uma Mesa: aceita outras peças. Mover ou girar a zona leva tudo junto.

Layouts de zona:

| `layout` | Como as peças ficam | Campos |
|---|---|---|
| `free` | onde forem soltas | — |
| `grid` | em casas `"col,linha"` | `grid: { cols, rows, cell: { w, h } }` |
| `slots` | em encaixes nomeados | `slots: [ { id, x, y, rotation? } ]` ou um padrão (abaixo); `slotSize` |
| `stack` | pilha (a última por cima) | `stack: { dx, dy }` (deslocamento por peça) |
| `fan` | leque, como uma mão | `fan: { spacing, arc }` |
| `row` | fila: em ordem, coladas a partir de uma ponta; se uma sai, as outras se reorganizam | `row: { gap, align }` (`align`: `start` (padrão), `center` ou `end`) |

Comuns a todos: `accepts: { kinds?, tags? }`, `capacity`, `statusOnEnter`, `statusOnLeave`, `rotationOnEnter` (rotação que a peça ganha ao entrar: uma carta girada volta reta para o deck), `motion` (como as peças chegam nela na tela, seção 4), e os de jogadores: `privacy`, `backStatus`, `openToOthers` (seção 13). Em `grid` e `slots`, `"autoFill": true` põe a peça sempre no primeiro encaixe livre, não importa onde ela caiu. `"outline": false` tira o contorno, as casas e o rótulo da zona (casas desenhadas sobre a arte de um tabuleiro); durante um arrasto, o destaque de onde soltar continua aparecendo.

O rótulo de uma zona é o texto da face dela (`"faces": { "default": "Mão" }`). Zona com imagem não tem rótulo.

Na `row`, uma fila que não cabe na zona aperta as peças (elas se sobrepõem por igual). A largura usada é a da peça sem rotação.

### Como a zona recebe as peças

Cada zona tem uma regra de entrada opcional, feita com os campos acima: `statusOnEnter` (vira as cartas), o layout (`stack` empilha, `row` alinha à esquerda), `autoFill` e `rotationOnEnter`. **Sem regra, a peça (ou o grupo) entra como estava**: com a mesma rotação e, num grupo, a mesma distância entre as peças.

```json
{ "id": "deck", "kind": "zona",
  "zone": { "layout": "stack", "statusOnEnter": "faceDown", "rotationOnEnter": 0 } }
{ "id": "{player}-energia", "kind": "zona", "parentId": "{player}",
  "zone": { "layout": "row", "accepts": { "kinds": ["ficha"] }, "row": { "gap": 4 } } }
```

### Na mesa: selecionar e arrastar várias peças

- **Tela cheia:** o botão "Tela cheia" põe o jogo na tela inteira (o iframe tem permissão `allow="fullscreen"`; se o navegador recusar, o jogo ocupa ao menos todo o iframe). A mesa ocupa tudo e os painéis flutuam: barra de botões em cima à direita (desfazer, reiniciar, passar a vez, **HUD**, configurações, sair), jogadores, info do jogo e detalhe da peça à esquerda, log embaixo à direita, escolha pendente no alto, no centro. Com o mouse em cima do botão **HUD**, a lista dos painéis abre; clicar num painel troca o modo dele (oculto ou completo; um modo compacto é opcional e nenhum painel tem ainda). Atalhos de fábrica: **J** jogadores, **I** info do jogo, **D** detalhe da peça, **L** log (estes quatro só na tela cheia), **V** preview (oculto = o Alt não mostra nada) e **G** contornos das zonas (estes dois em qualquer modo). Esc (do navegador) sai.
- **Configurações** (⚙): popup com a info do jogo carregado (nome, versão, autor, jogadores, opções, peças, regras), a aba **Exibição** (os mesmos itens do menu HUD) e a aba **Atalhos**.
- **Atalhos configuráveis** (aba Atalhos, como o keybinding do VS Code): a lista tem os comandos da mesa (desfazer, passar a vez, centralizar, tela cheia, configurações), os itens da HUD, as câmeras e as **ações do jogo** (`game.action`, seção 15), com busca por nome ou tecla. Clicar no atalho abre um popup que espera a combinação (pode ter modificadores: **Alt+Shift+T**); **Enter** confirma e **Esc** cancela. Se a combinação já é de outro comando, ou é reservada (Ctrl/Cmd+W, T, N, Q, Esc, Enter, Tab), o popup avisa e o Enter não confirma. ↺ volta ao padrão, ✕ deixa o comando sem atalho, **Restaurar todos** volta tudo. A tecla vale pela posição no teclado (no Mac, Alt+T continua sendo Alt+T, não "†"); segurar a tecla roda uma vez só, e nada roda digitando num campo de texto. Ação desabilitada pelo atalho mostra o motivo por alguns segundos. Ficam fixos (fora da lista): o Alt do preview, o Ctrl do modo compacto, Esc e os gestos do mouse.
- **Onde os atalhos ficam guardados:** no armazenamento do navegador, pela página do site (o iframe isolado do jogo não tem armazenamento): os da mesa valem para todos os jogos; os das ações, só para o jogo deles (pelo `id` do manifest). O site guarda até 50 jogos (os mais recentes). Com o foco fora do jogo (na página do site), o site repassa ao jogo só as combinações que têm atalho, além do Alt e do Ctrl; digitando num campo do site, nada vai para o jogo.
- **Ver uma peça ampliada:** segure **Alt** (Option no Mac) com o ponteiro sobre ela, ou segure o Alt e passe sobre as peças; soltar o Alt esconde. **Dois toques no Alt** sobre uma peça fixam o preview (ele fica mesmo soltando o Alt); dois toques de novo, em qualquer lugar, escondem. O preview aparece no lado da mesa oposto ao ponteiro, mostra a peça como o jogador a vê (virada, só o verso) e redesenha os modelos de carta com mais resolução, para o texto ficar nítido. Funciona mesmo sem clicar no jogo antes: a página do site repassa o Alt para o jogo.
- **Câmera:** a mesa abre enquadrando tudo o que está nela (sem passar de 100%); se o tamanho mudar antes de o jogador mexer na câmera (tela cheia, janela), enquadra de novo. **Centralizar** enquadra de novo. **Shift+Alt+1…9** guarda a câmera atual (posição e zoom) e **Alt+1…9** volta a ela, como no Tabletop Simulator. As câmeras valem até recarregar a página (o Reiniciar não as apaga).
- **Contornos das zonas:** a tecla **G** (ou o item no menu HUD, ou a aba Exibição das configurações) liga e desliga os contornos, as casas e os rótulos de todas as zonas; o arrasto continua destacando onde soltar. `"table": { "guides": false }` no manifest faz a mesa começar sem eles.
- **Botão direito numa peça:** menu com Preview (fixa), Selecionar (ou Somar/Tirar da seleção), **Mover ▸** (os destinos que aceitam a peça agora, com o mesmo teste do destaque do arrasto; grade e encaixes recebem no primeiro lugar livre; "Mesa" tira a peça da zona onde ela está), Usar (a ação do duplo clique e as áreas da peça), Girar 90° e as ações do jogo marcadas com `menu: true`. Com várias peças selecionadas, Mover leva o grupo, mantendo o arranjo.
- **Mão do jogador:** uma zona com `"hand": true` (com dono) é a mão. Para o dono, as peças dela aparecem numa **faixa embaixo da tela**, fora da câmera (não mexem com o zoom nem ao mover a mesa), em leque leve, como no Slay the Spire: a carta sob o mouse sobe e cresce, e a dica dela abre em cima. Arrastar uma carta da faixa para a mesa joga a carta (com as mesmas regras e destaques); soltar uma peça na faixa a põe na mão, na posição do ponteiro; arrastar dentro da faixa reordena. A zona continua na mesa como lugar marcado (soltar nela também funciona). Para os outros jogadores, a mão fica na mesa, como sempre (virada, com `privacy`). O **tamanho da mão** se ajusta na aba Exibição das configurações (50% a 200%).
- **Mover a mesa:** arrastar no vazio com o botão esquerdo, ou com o **botão do meio em qualquer lugar**, inclusive em cima de uma peça (o botão do meio nunca mexe em peças). A roda dá zoom.
- **Clique** seleciona uma peça (e mostra a alça de girar). **Shift, Ctrl ou Cmd + clique** soma ou tira peças da seleção. Clique no vazio limpa.
- **Shift + arrastar** no vazio (ou em cima de uma zona fixa, como um tabuleiro) desenha um retângulo: entram as peças que o jogador pode mexer e que ficarem inteiras dentro dele.
- **Arrastar uma peça selecionada leva o grupo todo** (só as que o jogador pode mexer). Ao soltar, é uma jogada só (comando `dropMany`), e um desfazer volta tudo:
  - pilha, leque e fila: as peças entram juntas, na ordem em que estavam desenhadas (a de baixo primeiro);
  - grade e encaixes: a peça segurada vai para o encaixe sob o ponteiro, e as outras para os próximos livres (sem lugar para todas, nada se move);
  - mesa e área livre: cada peça cai onde estava no grupo.

Padrões de encaixe (geram os `slots` e o tamanho da zona):

```json
{ "pattern": "pyramid", "base": 3, "rows": 4, "slot": { "w": 80, "h": 112 } }
{ "pattern": "row", "count": 5, "slot": { "w": 80, "h": 112 }, "gap": 8 }
```

A pirâmide é invertida: a fileira `r` tem `base + r` encaixes (`"r,p"`), cada um entre os dois de cima, cobrindo metade deles (`overlap`, padrão 0,5).

## 6. Dados, tabelas e `{campos}`

```json
"data": {
  "cartas": "data/cartas.json",
  "naipes": [ { "id": "copas", "nome": "Copas" } ]
},
"lookups": { "cor": { "copas": "#cf222e", "espadas": "#1f2328" } }
```

Um conjunto é uma lista de objetos, cada um com `id`. Pode estar no próprio manifest, num arquivo do pacote ou numa URL (mesma ordem das imagens).

Com um objeto, o conjunto pode vir de **uma das listas de um JSON** e ser **validado**:

```json
"data": {
  "mindset": { "file": "data/cartas_mindset.json", "path": "mindset" },
  "bases": {
    "file": "data/cartas_mindset.json",
    "path": "bases",
    "schema": { "type": "object", "required": ["cor"], "properties": { "cor": { "enum": ["vermelho", "azul"] } } }
  }
}
```

- `path`: caminho até a lista dentro do arquivo (com pontos: `"dados.bases"`).
- `schema`: JSON Schema de **cada item**. O erro aparece ao abrir o jogo, apontando o item e o campo (`bases[37].cor: …`).

Textos aceitam marcadores, preenchidos com o item de dados (ou os parâmetros do prefab):

| Marcador | Resultado |
|---|---|
| `{nome}`, `{custo.Traço}` | o campo (caminho com pontos) |
| `{naipe\|cor}` | o valor passado pela tabela `cor` |
| `{nivel\|repeat:●}` | `●` repetido `nivel` vezes |
| `{extra\|default:—}` | `—` se o campo estiver vazio (`default:0` é o número 0) |
| `{nome\|upper}` | em maiúsculas |

Um marcador sozinho mantém o tipo: `"x": "{x}"` vira número. Disponíveis também: `{n}` (número da cópia), `{index}` (posição do item), `{players}` (número de jogadores escolhido), `{options.id}` (opção da partida) e, nos passos com `forEachPlayer`, os campos do jogador (seção 9).

## 7. Modelos de carta (`templates`)

Desenham faces a partir dos dados, sem precisar de arte. Uma face `template:carta/C1` desenha o modelo `carta` com o item `C1`.

```json
"templates": {
  "carta": {
    "size": { "w": 120, "h": 168 },
    "data": "cartas",
    "elements": [
      { "type": "rect", "x": 1, "y": 1, "w": 118, "h": 166, "radius": 8, "fill": "#fff", "stroke": "{elemento|cor}" },
      { "type": "image", "src": "images/{elemento}.svg", "x": 40, "y": 24, "w": 40, "h": 40 },
      { "type": "circle", "x": 104, "y": 16, "r": 10, "fill": "{elemento|cor}" },
      { "type": "text", "x": 60, "y": 94, "text": "{nome}", "font": "600 13px system-ui", "align": "center", "maxWidth": 108 },
      { "type": "text", "x": 60, "y": 140, "text": "{extra}", "maxWidth": 100, "maxLines": 2, "if": "{extra}" }
    ]
  },
  "verso": { "size": { "w": 120, "h": 168 }, "elements": [ … ] }
}
```

Elementos: `rect`, `circle`, `polygon` (`points: [x1, y1, x2, y2, …]`, com `fill`/`stroke`, por exemplo a metade de uma carta cortada na diagonal), `text` (quebra linhas com `maxWidth`, até `maxLines`; `rotation` em graus gira o texto em volta do ponto `x, y`, e 180 deixa de ponta-cabeça) e `image`. `if` desenha o elemento só quando o texto preenchido não for vazio. Modelo sem `data` é usado como `template:verso`.

## 8. Prefabs

Conjuntos de peças reutilizáveis, com parâmetros. Ex.: um tabuleiro por jogador.

```json
"prefabs": {
  "jogador": {
    "params": { "id": "j", "nome": "Jogador", "x": 300, "y": 300 },
    "pieces": [
      { "id": "{id}", "kind": "tabuleiro", "faces": { "default": "Tabuleiro de {nome}" },
        "transform": { "x": "{x}", "y": "{y}" }, "zone": { "layout": "free" } },
      { "id": "{id}-mao", "kind": "zona", "parentId": "{id}", "zone": { "layout": "fan" } }
    ]
  }
}
```

Os ids dos filhos derivam do id da instância, para poder criar várias.

## 9. Setup

Lista de passos, executados em ordem. Cada passo de peças é uma jogada só (se uma peça falha, nenhuma do passo é criada).

```json
"setup": [
  { "pieces": [ { "id": "monte", "kind": "zona", "zone": { "layout": "stack" } } ] },
  { "forEach": "cartas", "copies": "{copias}", "where": { "elemento": "fogo" },
    "piece": { "id": "{id}-{n}", "kind": "carta", "parentId": "monte", "attributes": { "def": "{id}" },
               "faces": { "faceUp": "template:carta/{id}" } } },
  { "prefab": "jogador", "with": { "id": "ana", "nome": "Ana", "x": 260 } },
  { "command": { "type": "shuffle", "zone": "monte" } }
]
```

- `pieces`: peças fixas.
- `forEach`: uma peça (ou `copies` peças) por item do conjunto; `where` filtra por igualdade (uma lista aceita qualquer um dos valores; `1` e `"1"` são iguais; aceita `{campos}`, como `"{options.stage}"`).
- `pick` (no `forEach`): sorteia essa quantidade de itens, depois do `where`, em ordem aleatória. O sorteio usa a semente da partida (a mesma semente monta a mesma mesa). Pedir mais itens do que há é erro.
- `prefab`: cria uma instância de um prefab, com parâmetros em `with` (aceita `{campos}`).
- `command`: qualquer comando do motor (`shuffle`, `dropInto`, `setStatus`, `setGlobal`, `addPlayer`…), com `{campos}`.
- `deal`: `{ "from": "baralho", "to": "{player}-mao", "count": 3, "status": "faceUp" }` passa as `count` peças do topo de `from` para `to`, uma a uma (a do topo entra primeiro). Em zonas `grid` ou `slots`, cada peça vai para o próximo lugar livre. `status` vira as peças (opcional; o `statusOnEnter` da zona também vale).

### Opções da partida (`options`)

Escolhidas antes de começar, ao lado de "Jogadores":

```json
"options": [
  { "id": "stage", "label": "Stage", "choices": ["A", "B", "C"] },
  { "id": "nivel", "label": "Dificuldade", "default": "standard",
    "choices": [ { "value": "beginner", "label": "Iniciante" }, { "value": "standard", "label": "Normal" } ] }
]
```

Sem `default`, vale a primeira escolha. O valor aparece no setup como `{options.stage}` e no `regras.js` como `game.options.stage`.

### Passos condicionais (`when`)

Qualquer passo pode ter `when`; ele só roda se todas as partes valerem:

```json
{ "when": { "options": { "stage": ["A", "B"] }, "players": { "min": 2 } },
  "forEach": "eternos", "where": { "familia": "{options.stage}" }, "pick": 3,
  "piece": { "id": "{id}", "kind": "eterno", "parentId": "linha" } }
```

- `players`: o número de jogadores escolhido: um número (`1`), uma lista (`[2, 4]`) ou `{ "min", "max" }`.
- `options`: opção → valor, ou lista de valores aceitos. Opção ou valor que não existe é acusado ao abrir o jogo.

### Um passo por jogador (`forEachPlayer`)

`"forEachPlayer": true` repete o passo para cada jogador, na ordem de jogo, com `{player}` (id), `{playerName}`, `{playerColor}`, `{playerIndex}` (0, 1…) e `{seat.x}`, `{seat.y}`, `{seat.rotation}` (o lugar dele na mesa):

```json
"players": {
  "min": 1, "max": 4,
  "seats": {
    "1": [ { "x": 0, "y": 500 } ],
    "2": [ { "x": -300, "y": 500 }, { "x": 300, "y": 500 } ],
    "3": [ { "x": 0, "y": 500 }, { "x": 600, "y": 0, "rotation": 270 }, { "x": -600, "y": 0, "rotation": 90 } ]
  }
},
"setup": [
  { "forEachPlayer": true, "prefab": "tabuleiro",
    "with": { "x": "{seat.x}", "y": "{seat.y}", "rotation": "{seat.rotation|default:0}" } },
  { "forEachPlayer": true, "deal": { "from": "{player}-deck", "to": "{player}-mao", "count": 3 } }
]
```

`seats` é uma lista por número de jogadores, ou uma lista só (os primeiros lugares). Campos extras de um lugar viram `{seat.campo}`. Os parâmetros do prefab recebem os campos do jogador direto (`{player}` dentro do prefab funciona sem passar em `with`).

### Jogadores extras (`addPlayer`)

Para jogadores que não são pessoas (os Golems de um modo solo, por exemplo), o setup cria jogadores com o comando `addPlayer`:

```json
{ "when": { "players": 1 }, "command": { "type": "addPlayer", "id": "golem-beta", "name": "Beta" } }
```

Eles entram no fim da ordem de jogo, com vez, recursos e painel como os outros. Os passos `forEachPlayer` depois disso incluem os extras, e o lugar (`seats`) segue quantos jogadores há naquele momento. Só o jogo cria jogadores (a tela não pode).

## 10. Painel (`hud`)

```json
"hud": [
  { "label": "Monte", "count": "monte" },
  { "label": "Pontos", "global": "pontos" },
  { "label": "Hora", "text": "Dia {dia}, {hora}h · {fase}" },
  { "label": "Eventos ativos", "list": "eventos" }
]
```

`count` mostra quantas peças há na zona; `global` mostra um valor global; `text` preenche `{campos}` com os globais (campo que falta fica vazio; `label` é opcional); `list` mostra um global que é lista, um item por linha (texto, ou o `label`, `name` ou `id` de cada objeto).

## 11. Segurança

O jogo inteiro (motor, mesa e `regras.js`) roda numa página própria, `frame.html`, dentro de um **iframe isolado** (`sandbox="allow-scripts"`, sem `allow-same-origin`). A página do site só busca o arquivo e entrega os bytes ao iframe por mensagem. Lá dentro o código do jogo tem origem `null`: não lê cookies nem `localStorage`, não alcança o DOM nem o endereço do site, não envia formulários nem abre janelas. No build, a página do jogo ainda tem uma política de segurança (CSP) que só deixa rodar os scripts do próprio bqtable (o `regras.js` vira uma função lá dentro).

Limites conhecidos:

- Um `regras.js` com laço infinito trava o iframe (o resto do site continua, porque o Chrome roda o iframe em outro processo). Uma trava de tempo fica para depois.
- O iframe pode buscar imagens e dados em qualquer URL (é assim que `assets.base` funciona). Não há segredo do site lá dentro para vazar, só o estado da partida.
- Em produção, a página do jogo precisa carregar os scripts com o cabeçalho `Access-Control-Allow-Origin` (o iframe tem origem `null`), ou ficar num domínio próprio. No Cloudflare (um Worker com os arquivos do build, configurado no `wrangler.jsonc`), o `public/_headers` manda esse cabeçalho em `/assets/*`.

## 12. Regras automáticas (`regras.js`)

O arquivo é o **corpo de uma função** que recebe `game`. Ele roda a cada partida nova, depois do setup do manifest:

1. tipos de peça e setup do manifest;
2. o `regras.js` registra regras, comandos e gestos;
3. o setup das regras (`game.setup`);
4. a partida começa (nada antes disso pode ser desfeito).

```js
const { childrenOf, isCommand, isEvent } = game.helpers;
const cartas = Object.fromEntries(game.data.cartas.map((c) => [c.id, c]));

game.rule({
  id: 'custo',
  // Recusa jogadas: devolva true ou o motivo (aparece para o jogador).
  validate(cmd, state) {
    if (!isCommand(cmd, 'dropInto') || cmd.zone !== 'tableau') return true;
    const custo = cartas[state.pieces[cmd.id].attributes.def].custo;
    const energia = childrenOf(state.pieces, 'energia').length;
    return energia >= custo || `energia insuficiente: precisa de ${custo}, tem ${energia}`;
  },
  // Reage a eventos: devolva comandos (rodam na mesma jogada).
  react(ev, state) {
    if (!isEvent(ev, 'pieceEnteredZone') || ev.zone !== 'tableau') return [];
    return [{ type: 'setGlobal', key: 'pontos', delta: 1 }];
  },
});
```

### O objeto `game`

| Campo | O que faz |
|---|---|
| `game.players` | Número de jogadores escolhido para esta partida. |
| `game.options` | Opções da partida (`manifest.options`): `{ stage: "A", … }`. |
| `game.playerList` | Os jogadores, na ordem de jogo: `{ id, name, color }` (ids `"p1"`, `"p2"`…, e os criados com `addPlayer` no setup do manifest). |
| `game.data`, `game.lookups` | Os conjuntos de dados e as tabelas do manifest (só leitura). |
| `game.helpers` | `childrenOf(pieces, zona)` (peças da zona, em ordem), `ownerOf(pieces, id)` (dono efetivo), `isAncestor`, `isEvent(ev, tipo)`, `isCommand(cmd, tipo)`, `gridSlot(col, lin)`, `parseGridSlot`, `shuffle(lista, random)`, `randomInt(random, n)`. |
| `game.rule({ id, validate?, react?, resolve? })` | Regra. `validate(cmd, state)` roda para **todo** comando (do jogador e das reações) e devolve `true` ou o motivo da recusa. `react(ev, state)` roda depois de cada evento e devolve comandos. `resolve` responde escolhas pedidas com `ask`. |
| `game.command({ type, execute? , expand? })` | Comando novo do jogo. `expand(cmd, { state, random })` devolve outros comandos (tudo ou nada, na mesma jogada). `execute` devolve eventos direto. Devolver um texto recusa o comando. |
| `game.action({ id, label, visible?, enabled?, command, menu?, key? })` | Botão de ação no painel, no menu do botão direito e com atalho (seção 15). |
| `game.shared` | Objeto livre, o mesmo para todos os arquivos de regras (seção 16). |
| `game.gesture((gesto, peça, state) => …)` | Muda o que um gesto faz (`gesto.type`: `drag`, `dragGroup` (várias selecionadas), `rotate`, `activate` = duplo clique, com `area` se caiu num `hotspot`). Devolva um comando, `null` (ignorar) ou `undefined` (comportamento padrão). |
| `game.setup(({ state, dispatch }) => …)` | Setup que depende das regras ou do número de jogadores. `dispatch(cmd)` aplica um comando (se for recusado, o jogo não abre e a mensagem mostra o motivo). |
| `game.prefab(nome, parâmetros)` | Peças de um prefab do manifest, para criar no setup (`{ type: 'batch', commands: peças.map((piece) => ({ type: 'createPiece', piece })) }`). |

O `state` é só leitura: toda mudança é um comando. Comandos que vêm da tela trazem `cmd.actor` (o jogador que agiu); os que as regras devolvem não trazem, e por isso não sofrem as restrições de dono (seção 13). Prefira `delta` a `value` em reações (`{ type: 'setGlobal', key: 'pontos', delta: 1 }`), porque elas podem rodar depois de outras mudanças.

### Comandos do motor

`setActivePlayer { player }`, `nextPlayer {}` (passa a vez), `addPlayer { id, name?, color? }` (só regras e setup), `createPiece { piece }`, `removePiece { id }`, `move { id, x, y, z? }`, `rotate { id, rotation }`, `setStatus { id, status }`, `setAttr { id, key, value | delta }`, `setGlobal { key, value | delta }`, `setPlayerAttr { player, key, value | delta }`, `log { message, to? }` (texto no log; `to`: só esse jogador vê), `dropInto { id, zone, slot?, x?, y?, index? }` (`zone: null` = mesa), `dropMany { ids, zone, slot?, index?, at? }` (várias peças de uma vez; `at`: posição de cada uma na mesa ou em área livre), `shuffle { zone }`, `batch { commands }` (tudo ou nada), `ask { rule, prompt, … }` e `choose { choiceId, value }` (seção 14), `endGame { result, message?, score? }` (seção 14).

### Eventos

`pieceCreated`, `pieceRemoved`, `pieceMoved`, `pieceRotated`, `statusChanged { id, from, to }`, `attrChanged { id, key, from, to }`, `globalChanged`, `playerAttrChanged`, `pieceLeftZone { id, zone }`, `piecePlaced { id, from, to }`, `pieceEnteredZone { id, zone, slot }`, `zoneShuffled { zone, order }`, `activePlayerChanged { from, to }`, `playerAdded { player }`, `message { text, to? }` (comando `log`), `piecesDropped { ids, zone }` (fim de um `dropMany`, depois de todas as peças), `choiceRequested`, `choiceMade`, `gameEnded { result?, winners?, ranking?, message?, score? }`, `rngAdvanced` (sorteio: bloqueia o desfazer). Um `statusChanged` com `revealsInfo: true` (ver `reveals`, seção 4) também bloqueia.

### Log legível

O log mostra, para cada jogada, as **mensagens do jogo**, em vez dos eventos do motor: as do comando `log` e as de qualquer evento do jogo com o campo `message`. Jogadas sem mensagem mostram os eventos do motor. "Log completo" mostra tudo.

```js
game.command({
  type: 'preparar',
  expand: (cmd, { state }) => [
    { type: 'dropInto', id: cmd.carta, zone: cmd.sleeve },
    { type: 'setPlayerAttr', player: cmd.actor, key: 'traco', delta: -2 },
    { type: 'log', message: `Preparou ${nomeDe(cmd.carta, state)} na sleeve ${cmd.sleeve} (−2 Traço)` },
  ],
});
```

Uma mensagem com `to` (id de jogador) só aparece para ele ("Você comprou a Rosa").

### Regras e grupos de peças

Um `dropMany` vira um `dropInto` por peça, e cada um passa pelo `validate` das regras, como se o jogador tivesse arrastado as peças uma a uma: o grupo não fura nenhuma regra. Antes disso, o `validate` recebe o próprio `dropMany`, para regras que olham o conjunto (por exemplo, "de 1 a 3 cartas da mão, que formem a receita"). Depois de todas as peças, sai o evento `piecesDropped`, bom para reagir uma vez só ao grupo:

```js
game.rule({
  id: 'receita',
  validate: (cmd, state) =>
    isCommand(cmd, 'dropMany') && cmd.zone === 'forja' && !formaReceita(cmd.ids, state)
      ? 'essas cartas não formam uma receita'
      : true,
  react: (ev) => (isEvent(ev, 'piecesDropped') && ev.zone === 'forja' ? gerarJewel(ev.ids) : []),
});
```

### Erros

- Erro de sintaxe no `regras.js` aparece ao abrir o jogo, com o nome do arquivo.
- Uma regra ou comando que lança exceção **recusa a jogada** com `regra "x" falhou: <motivo>`; o jogo continua.
- Sorteio (`random` em `execute`/`expand`, ou o comando `shuffle`) impede desfazer daquele ponto para trás.

O exemplo completo está em `examples/piramide/regras/` (em TypeScript, seção 16): apoios no Tableau, custo em energia, pontos, um comando `comprar` e o duplo clique na mão.

## 13. Jogadores, donos e áreas privadas

### Jogadores e vez

Cada partida tem os jogadores `p1`, `p2`… (quantos forem escolhidos, entre `players.min` e `players.max`), com os nomes e cores de `players.names` e `players.colors` (ou "Jogador 1", "Jogador 2" e cores padrão). Como `seats`, nomes e cores aceitam uma lista só ou uma lista por número de jogadores: `"names": { "1": ["Alpha"], "2": ["Vermelho", "Azul"] }`. O primeiro começa com a vez. O painel mostra os jogadores, quem está na vez e um botão **Passar a vez** (comando `nextPlayer`; só o jogador da vez passa).

No mesmo aparelho (hot seat), a tela segue o jogador da vez: ao passar, o que era privado do anterior some ou vira, e o do próximo aparece. "Ver como" fixa a tela num jogador (útil para testar).

### Dono

Uma peça tem dono pelo campo `owner` (`"p1"`), ou herda o da zona mais próxima acima dela: uma carta no tabuleiro do jogador 1 é dele enquanto estiver lá, sem precisar mudar a carta. Em prefabs, use o id do jogador como parâmetro (`"owner": "{id}"`).

Nas jogadas feitas pela tela:

- só o dono mexe numa peça com dono (arrastar, girar, virar); peças sem dono, qualquer um;
- ninguém solta peças numa área de outro dono, a menos que a zona tenha `"openToOthers": true`;
- cada jogador só muda os próprios recursos (`setPlayerAttr`).

As regras (`regras.js`) e o setup não têm essas restrições: são o próprio jogo agindo (passar a mão para o lado, por exemplo).

### Áreas privadas (`privacy`)

Numa zona com dono, `privacy` define o que **os outros** jogadores veem (o dono vê tudo):

| `privacy` | Os outros veem | Exemplo |
|---|---|---|
| `"hidden"` | nada do que está dentro (a zona aparece vazia) | itens atrás de um escudo, reserva secreta |
| `"faceDown"` | as peças viradas: só o verso, sem atributos nem dados | a mão de cartas de um jogador |

O verso é a face do status `backStatus` (padrão `"faceDown"`). O log e o painel também não revelam o que está escondido de quem olha.

```json
{ "id": "{id}-mao", "kind": "zona", "parentId": "{id}",
  "zone": { "layout": "fan", "privacy": "faceDown", "hand": true } }
```

Com `"hand": true`, a mão do jogador que olha a tela vira a faixa embaixo dela (seção 5).

### Partida em rede

Com um jogo aberto, **Hospedar** cria uma sala e mostra o link (`/jogar?sala=…`). Quem abre o link entra no próximo assento livre e recebe o pacote do host, sem precisar do arquivo. A partida roda só no navegador do host. Cada convidado recebe o estado do jeito que o assento dele vê (`redactFor`, em `src/engine/net`), e a tela de cada um fica fixa no próprio assento. Desfazer e reiniciar são só do host.

O que muda para quem escreve o jogo:

- **O que não pode ser visto não sai do aparelho do host.** As peças escondidas não chegam ao convidado. As viradas chegam sem face, atributos nem tags, e com um apelido no lugar do id (`baralho~12`, a 13ª da pilha): o id costuma dizer qual é a carta (`rascunho-2`). Por isso, um gesto (`game.gesture`) ou uma ação não deve depender do id de uma peça virada. O apelido muda quando a ordem muda (um embaralhar não deixa seguir a carta).
- **Baralho virado precisa de `hiddenStatuses`** (seção 4). Sem ele, a carta virada no deck aparece como verso na tela, mas o id e os atributos dela vão para todos, e a ordem do baralho deixa de ser segredo.
- O host recusa o comando de um convidado que cite o id real de uma peça que ele não vê (os ids dá para adivinhar pelos dados do jogo).
- Os comandos sem dono (`setGlobal`, `endGame`, os comandos do jogo) passam para qualquer jogador, como na mesa local. Se o jogo precisa de restrição, a regra confere `cmd.actor`, como no `comprar` da pirâmide.
- O host recebe a partida inteira e poderia trapacear olhando o próprio navegador.

### Recursos no painel (`playerHud`)

```json
"playerHud": [
  { "label": "Energia", "count": "{player}-energia" },
  { "label": "Pontos", "global": "pontos-{player}" },
  { "label": "Foco", "attr": "foco" }
]
```

`{player}` vira o id de cada jogador. `count` conta as peças da zona; `global` mostra um valor global; `attr` mostra um atributo do jogador (`setPlayerAttr`); `text` preenche `{campos}` com os globais e os atributos do jogador (`{ "label": "Traço", "text": "{foco.traco}/15" }`).

A contagem de uma zona `hidden` aparece como **"?"** para quem não é o dono (quantas peças há atrás do escudo também é segredo). Se no seu jogo esse número é público, use `"public": true` no item (vale também para o `hud`). Numa zona `faceDown` a contagem aparece sempre: as cartas viradas estão à vista.

Arrastar uma peça de outro jogador não faz nada (nem move a peça, nem a mesa). Clicar nela ainda mostra os detalhes que o jogador pode ver.

## 14. Escolhas e fim de partida

### Pedir uma escolha (`ask`)

Uma regra ou comando do jogo pede uma decisão ao jogador com `ask`; a jogada para até ele responder, e a resposta vai para o `resolve` da regra indicada (que devolve os comandos seguintes).

```js
game.command({
  type: 'descartar',
  expand: (cmd, { state }) => [{
    type: 'ask', rule: 'descarte', prompt: 'Descarte 2 cartas',
    player: cmd.actor,                      // quem responde (padrão: qualquer um)
    pick: 'piece',                          // as opções são peças: escolhe clicando na mesa
    options: game.helpers.childrenOf(state.pieces, cmd.actor + '-mao').map((p) => p.id),
    multiple: { min: 2, max: 2 },           // responde com uma lista
  }],
});
game.rule({
  id: 'descarte',
  resolve: (choice, ids) => ids.map((id) => ({ type: 'dropInto', id, zone: 'descarte' })),
});
```

| Campo | O que faz |
|---|---|
| `options` | Valores possíveis. Sem a lista, o painel pede um texto livre. |
| `labels` | Um texto por opção, para os botões (`["Atacar", "Defender"]`). Sem eles, aparece o valor. |
| `pick: "piece"` | As opções são ids de peças: elas ficam com contorno tracejado na mesa e o clique responde. |
| `pick: "drop"` | As opções são as peças que o jogador pode **arrastar** como resposta (ficam destacadas; as outras não se movem). O arrasto vira a resposta `{ id, zone, slot?, index?, x?, y? }`, e o `resolve` devolve a jogada (normalmente o `dropInto`). Se a regra recusar, a peça volta e a escolha continua aberta. A mesa destaca os destinos que a regra aceitaria. |
| `buttons` | Respostas extras, mostradas como botões: `[{ "value": "pular", "label": "Pular" }]`. Valem com qualquer tipo de escolha (inclusive `pick` e `multiple`); o valor chega ao `resolve` como está. |
| `multiple: { min, max }` | Responde com uma lista (sem repetir). Na mesa, o clique marca e desmarca (contorno cheio); o botão **Confirmar** envia. Com botões, aparecem caixas de marcar. |
| `player` | Quem responde. A tela passa para esse jogador enquanto a escolha estiver aberta (no hot seat). |
| `context` | Qualquer valor que a regra queira receber de volta em `choice.context`. |

Enquanto há uma escolha aberta, nenhuma outra jogada é aceita (só o arrasto das peças de um `pick: "drop"`). **Desfazer** cancela a jogada que pediu a escolha.

Baixar uma carta no meio de uma jogada (por exemplo, uma epifania que dispara ao cobrir uma zona):

```js
game.rule({
  id: 'epifania',
  react: (ev, state) => cobriuZona(ev, state)
    ? [{ type: 'ask', rule: 'epifania', prompt: 'Epifania: baixe 1 carta', player: dono(ev, state),
         pick: 'drop', options: maoDe(dono(ev, state), state),
         buttons: [{ value: 'pular', label: 'Pular' }] }]
    : [],
  resolve: (choice, v) => (v === 'pular' ? [] : [{ type: 'dropInto', id: v.id, zone: v.zone, slot: v.slot }]),
});
```

### Fim de partida (`endGame`)

```js
game.rule({
  id: 'vitoria',
  react: (ev, state) => state.globals.estrelas >= 4
    ? [{ type: 'endGame', result: 'win', message: '4 estrelas!', score: state.globals.pontos }]
    : [],
});
```

`result` é `"win"`, `"lose"` ou `"draw"`. Ao encerrar, o resto da jogada não roda e nenhum comando novo é aceito (a mensagem é "a partida acabou"). A tela mostra o resultado por cima da mesa, com **Jogar de novo** e **Ver a mesa**; desfazer (se nada foi revelado) volta para o jogo.

Num jogo competitivo, diga quem venceu, e o placar se quiser:

```js
{ type: 'endGame',
  winners: ['p2'],                  // um ou mais (mais de um = empate)
  ranking: [                        // na ordem em que aparece
    { player: 'p2', score: 34, label: '$34', text: 'Compra um <b>chapéu</b> e…' },
    { player: 'p1', score: 21, label: '$21' },
  ],
  message: 'Fim das 3 corridas' }
```

- Com `winners`, o `result` fica opcional, e o título depende de quem olha: **"Você venceu!"** para quem venceu, **"Vitória de Bia"** para os outros, **"Empate: Ana e Bia"** com mais de um vencedor. Quando a tela não é de um jogador só (mesmo aparelho, seguindo a vez), aparece o nome de quem venceu.
- `ranking` vira uma tabela: a cor e o nome do jogador, o `label` (ou o `score`) e o `text`, em texto rico (as regras de HTML e de palavras-chave da seção 17). Quem está em `winners` aparece em negrito.
- O comando recusa um jogador que não existe ou que aparece duas vezes em `winners` ou em `ranking`, e um fim sem `result` nem `winners`.
- O fim é público: na rede, todos recebem o mesmo placar.

## 15. Ações do jogo (`game.action`)

Botões no painel para as ações que não são arrastar uma peça ("Refletir", "Reset", "Terminar"):

```js
game.action({
  id: 'refletir',
  label: 'Refletir',
  // aparece só na fase certa, para quem está na vez (padrão: sempre)
  visible: (state, ctx) => state.globals.fase === 'acao' && ctx.player === state.activePlayer,
  // opcional: true ou o motivo (vira a dica do botão desabilitado)
  enabled: (state, ctx) => (ctx.selection.length === 1 ? true : 'selecione uma carta do Tableau'),
  command: (state, ctx) => ({ type: 'refletir', carta: ctx.selection[0] }),
});
```

- `ctx.player`: o jogador que olha a tela. `ctx.selection`: as peças selecionadas na mesa, na ordem em que foram selecionadas.
- O comando sai com o jogador da tela como `actor`, como os gestos.
- Sem `enabled`, o motor testa o comando sem aplicar: se as regras recusariam, o botão fica desabilitado com o motivo como dica. Assim a validação fica num lugar só (o comando e as regras).
- As ações somem enquanto há uma escolha pendente e depois do fim da partida.
- `menu: true`: a ação aparece também no menu do botão direito de uma peça, com ela (ou o grupo selecionado) como `ctx.selection`. Bom para ações sobre uma carta ("Refletir", "Agir").
- `key: "E"` (ou `"Alt+Shift+A"`, `"ctrl+1"`): atalho de fábrica da ação. Toda ação aparece na aba **Atalhos** das configurações, com ou sem `key`, e o jogador pode trocar, tirar ou dar um atalho a ela (seção 5, "Na mesa", Atalhos configuráveis). O atalho roda a ação como o botão: precisa estar visível e habilitada; desabilitada, mostra o motivo. Se o padrão do jogo repetir um da mesa (por exemplo `G`), vale o da mesa e a ação fica sem atalho até o jogador escolher um.

### Vez controlada pelo jogo

Com `"players": { …, "passButton": false }` o botão **Passar a vez** some, e o jogo passa a vez pelas regras (`nextPlayer`, `setActivePlayer`), por exemplo numa ação "Terminar". Um texto troca o rótulo do botão (`"passButton": "Terminar ação"`).

## 16. Regras grandes: vários arquivos, TypeScript e testes

### Vários arquivos

`"rules"` aceita uma lista. Os arquivos rodam em ordem, com o mesmo `game`; para trocar funções entre eles, use `game.shared` (um objeto livre, o mesmo para todos os arquivos da partida):

```json
"rules": ["regras/util.js", "regras/campo.js", "regras/turno.js"]
```

```js
// regras/util.js
game.shared.vizinhos = (slot) => …;
// regras/campo.js
const { vizinhos } = game.shared;
```

Um erro aponta o arquivo em que aconteceu.

### TypeScript

Na pasta do jogo, `rules` pode apontar para um `.ts`. O `bqgame-pack <pasta> <saida.bqgame>` (no repositório do bqtable, `pnpm exemplos` ou `node scripts/pack-game.mjs`) junta esse arquivo e os módulos que ele importa num `.js` só (esbuild), e o manifest do pacote passa a apontar para o `.js`. Os fontes `.ts`, os testes (`*.test.*`) e o `tsconfig.json` não entram no pacote.

```ts
// regras/index.ts
import type { GameApi } from 'bqtable/sdk';
import { apoios } from './tableau'; // funções puras, testáveis sem o jogo

declare const game: GameApi; // o parâmetro que o jogo passa

game.rule({ id: 'tableau', validate: (cmd, state) => … });
```

- Importe do motor só **tipos** (`import type`): eles somem na compilação. Funções do motor vêm por `game.helpers`.
- Os módulos podem se importar à vontade; o que não depende de `game` fica fácil de testar.

### Testes sem tela

Os testes `*.test.ts` rodam no Vitest (Node): no repositório do jogo e, aqui, os de `examples/`, junto com os do motor. Há dois jeitos de testar:

```ts
import { loadGameFolder } from 'bqtable/testing';
import { apoios } from './tableau';

it('apoios', () => expect(apoios('1,1')).toEqual(['0,0', '0,1'])); // função pura

it('partida', async () => {
  const game = await loadGameFolder('examples/piramide'); // empacota a pasta, como o bqgame-pack
  const m = game.createManager({ players: 2, seed: 7, options: { stage: 'A' } });
  expect(m.dispatch({ type: 'dropInto', id: 'c1', zone: 'p1-tableau', slot: '1,0', actor: 'p1' }))
    .toEqual({ ok: false, error: 'faltam cartas de apoio em 0,0' });
});
```

Fora do navegador não há imagens: elas viram placeholder, e o resto do jogo funciona igual (`loadGameFolder(pasta, { exclude: (p) => p.startsWith('images/') })` nem as lê). O exemplo completo está em `examples/piramide/regras/`.

### Repositório próprio

Um jogo pode ficar num repositório git separado, com o bqtable como dependência: `bqtable/sdk` (tipos e funções puras), `bqtable/testing` (`loadGameFolder`) e o comando `bqgame-pack`. Como montar o `package.json`, o `tsconfig` e os testes: [SDK.md](SDK.md).

## 17. Descrições e palavras-chave

Cada tipo de peça pode ter uma **descrição**, mostrada ao lado do preview (Alt) e numa dica ao lado da peça quando o mouse para sobre ela. As **palavras-chave** aparecem em caixas em cima da descrição, como no Slay the Spire.

```json
"keywords": {
  "estrela": { "title": "Estrela", "text": "Ganha uma [[joia]] ao reviver." },
  "joia": { "title": "Joia", "text": "Recurso <b>raro</b>." }
},
"kinds": [{
  "kind": "eterno",
  "data": "eternos",
  "description": "<b>{nome}</b><br>Curse: {curse}<br>Ability: [[{habilidade}]]"
}]
```

- **Uma descrição por kind, uma por peça:** os `{campos}` vêm do item de dados da peça (`attributes.def`) e dos atributos dela. Os Eternals do Eternal Decks são todos do kind `eterno`, e cada um mostra a sua curse. Um texto sem `{campos}` é a descrição geral do tipo; um campo `descricao` nos dados (`"description": "{descricao}"`) dá um texto livre a cada item.
- **Texto rico:** HTML limitado (`b`, `strong`, `i`, `em`, `u`, `s`, `br`, `p`, `div`, `span`, `small`, `sub`, `sup`, `ul`, `ol`, `li`, `hr`, `h1`–`h4`, `img`), com estilos de cor, fundo, peso, itálico, tamanho, sublinhado e alinhamento. Scripts, eventos (`onclick`…), links e o resto somem. Imagens com caminho relativo vêm do pacote.
- **Palavras-chave:** `[[id]]` mostra o título; `[[id|texto]]` mostra outro texto; `<kw ref="id">texto</kw>` é o mesmo em HTML. O texto de uma palavra-chave também é HTML e pode citar outras (elas aparecem juntas, em ordem, sem repetir, até 8). Uma palavra-chave citada que não existe é acusada ao abrir o jogo.
- **Peça virada** para quem olha (área privada de outro, ou `hiddenStatuses`): sem descrição nem palavras-chave.

Na HUD, **Descrição e palavras-chave** (tecla **K**) tem três modos:

| Modo | No preview e na dica |
|---|---|
| completo | a descrição e as palavras-chave sempre |
| compacto | só a imagem; segurando **Ctrl**, a descrição e as palavras-chave |
| oculto | só no preview fixo (dois toques no Alt), com o mouse sobre ele; as palavras-chave abrem ao passar o mouse sobre cada uma, e as citadas dentro delas também, em cadeia |

**Dica ao lado da peça** (tecla **T**): com o mouse parado meio segundo sobre uma peça, a descrição aparece ao lado dela (e fica aberta com o mouse em cima da dica). Some ao arrastar, ao mexer na câmera e ao segurar o Alt (o preview grande toma o lugar).

