# Plano de execução: Tatto Game jogável em React

Status: plano inicial (06/10/2026). Base para executar no PC, fase por fase. Usa Mindset.md e TattoGame.md como referência de regras.

**Legenda de status**

- **[DECIDIDO]** definido pelo autor.
- **[SUGERIDO]** proposta deste plano. Padrão até ser contestado.
- **[EM ABERTO]** precisa de decisão antes ou durante a fase indicada.

---

## 1. Objetivo

Construir uma página React (com React Query) que rode o Tatto Game, mas organizada como um **motor genérico de jogos de tabuleiro** com o Tatto Game como primeiro jogo. A meta de longo prazo é algo na linha do Board Game Arena: vários jogos sobre o mesmo motor.

Princípio [DECIDIDO]: começar pelas estruturas básicas, garantir que funcionam (testes + página de sandbox) e só então partir para a próxima.

## 2. Como usar este documento no PC

Prompt sugerido para o Claude Code:

> Leia PlanoReact.md, Mindset.md e TattoGame.md. Execute apenas a fase N do plano. Mantenha o que está DECIDIDO; antes de mudar algo SUGERIDO, me pergunte. Ao final da fase, rode os testes e confira os critérios de "pronto quando".

---

## 3. Decisões de arquitetura

### 3.1 Três camadas isoladas [SUGERIDO]

```
┌─────────────────────────────────────────────┐
│ games/tatto   regras, cartas, fluxo do turno│  ← só este muda por jogo
├─────────────────────────────────────────────┤
│ engine/react  hooks, store, ligação com UI  │
│ engine/render Peça, Mesa, arrastar, girar   │  ← trocável (Konva, Pixi, DOM)
├─────────────────────────────────────────────┤
│ engine/core   TypeScript puro, sem React    │  ← modelo, eventos, Gestor
└─────────────────────────────────────────────┘
```

- **core** não importa React nem lib de desenho. Roda em teste, em servidor e no simulador.
- **render** só desenha o estado e transforma gestos (arrastar, soltar, girar) em **comandos** para o Gestor. Nunca muda o estado sozinho.
- **games/tatto** registra tipos de peça, regras e reações no Gestor.

Ganho: dá para trocar a lib de desenho, rodar o jogo sem tela (IA, testes, simulação) e, depois, rodar o mesmo core num servidor para multiplayer.

### 3.2 Papel do React Query [SUGERIDO]

React Query cuida de **estado do servidor**, não do estado da partida (que muda a cada clique e é síncrono). Uso previsto:

- Carregar definições do jogo (cartas_mindset.json, catálogo, clientes, cenários).
- Pré-carregar imagens (assets) com `useSuspenseQuery`.
- Depois: salvar e carregar partidas, lobby, sincronizar jogadas com o servidor (mutations).

Estado da partida: **Zustand** [DECIDIDO, fase 3]. O Gestor continua sendo a fonte da verdade; um store Zustand por Gestor (em `engine/react`) guarda a referência do estado imutável a cada aviso, sem cópia. DevTools do Redux só para inspecionar: "pular" para estado antigo por lá não volta o Gestor.

### 3.3 Toda mudança passa por comando [SUGERIDO]

```
gesto na tela → comando → Gestor valida (regras) → eventos → reducer aplica → reações → novos eventos
```

- **Comando:** intenção (`move`, `rotate`, `setStatus`, `setAttr`, `dropInto`).
- **Evento:** fato que aconteceu (`pieceMoved`, `pieceEnteredZone`, `attrChanged`).
- O estado é a soma dos eventos. Isso dá **desfazer, replay, log da partida, IA e multiplayer** quase de graça (o servidor só precisa validar comandos e repassar eventos).
- Estado serializável (JSON puro, sem classes) e reducers puros. Usar **Immer** para escrever reducers sem dor.

### 3.4 Desfazer, sorteio e escolhas pendentes

- **[DECIDIDO]** Não se desfaz nada depois que uma informação é revelada (comprar carta, embaralhar, virar carta oculta). O evento carrega uma flag (`revealsInfo`) e o `undo` não passa desse ponto.
- **[SUGERIDO]** Sorteio determinístico: a semente do gerador fica no estado. Embaralhar é um comando como qualquer outro, então replay e servidor reproduzem o mesmo resultado.
- **[SUGERIDO]** Escolhas pendentes: uma regra ou reação pode pausar o fluxo pedindo uma decisão ao jogador (qual carta, qual encaixe, quantas vezes). O Gestor guarda a escolha pendente no estado e só aceita o comando que a responde. Necessário para Epifania "baixa 1", Sobrecarga, Preparar+ e Aplicar+, Interagir.

---

## 4. Modelo das estruturas básicas (core)

### 4.1 Peça (o "container") [SUGERIDO]

Objeto na tela, representado por imagem, com transformações, status e atributos dinâmicos.

```ts
type PieceId = string;
type AttrValue = number | string | boolean | null | AttrValue[] | { [k: string]: AttrValue };

interface Transform { x: number; y: number; rotation: number; scale: number; z: number; }

interface Piece {
  id: PieceId;
  kind: string;                         // 'mindset-card', 'catalog-trace', 'client', 'token'...
  transform: Transform;
  status: string;                       // 'faceDown', 'covered', 'inHand'... (define a imagem)
  faces: Record<string, string>;        // status → imagem (fallback: faces.default)
  size: { w: number; h: number };
  attributes: Record<string, AttrValue>;// lista dinâmica (reputação, custo, foco...)
  tags: string[];                       // filtros rápidos ('traco', 'nivel-2')
  parentId: PieceId | null;             // zona onde está, se houver
  owner?: string;                       // jogador dono
  zone?: ZoneSpec;                      // se existir, a peça é uma Mesa (ver 4.3)
}
```

- **Posição lógica primeiro** [SUGERIDO]: o que importa para as regras é a zona (`parentId`) e o encaixe dentro dela. Em zonas com layout (`grid`, `slots`, `stack`, `fan`) a posição na tela é calculada pelo layout; `transform.x/y/rotation` só são guardados para peças em zona `free`. Evita sincronizar coordenadas de tela no multiplayer.
- **Status** controla a imagem e o comportamento. Transições permitidas podem ser declaradas por `kind` (mini máquina de estados), validadas pelo Gestor.
- **Atributos** são livres, mas cada `kind` pode declarar um schema (Zod) para validar e ter tipos no jogo.
- Peças não falam direto entre si: emitem eventos e o Gestor (ou regras registradas) reage. Assim "peça interage com peça" continua rastreável.

### 4.2 Gestor [SUGERIDO]

Dono do estado global e dos eventos.

```ts
interface GameState {
  pieces: Record<PieceId, Piece>;
  globals: Record<string, AttrValue>;   // reputação da loja, dia, hora, turno...
  players: Record<string, PlayerState>;
  log: GameEvent[];
}

interface Rule {                         // registrada pelo jogo
  id: string;
  validate?(cmd: Command, s: GameState): true | string;   // string = motivo da recusa
  react?(ev: GameEvent, s: GameState): Command[];          // reação a eventos
}

interface Manager {
  getState(): GameState;
  dispatch(cmd: Command): Result;        // valida, aplica, roda reações
  subscribe(fn: (s: GameState, evs: GameEvent[]) => void): () => void;
  on(evType: string, fn: Listener): () => void;
  undo(): void;
  registerRule(r: Rule): void;
  registerKind(k: KindDef): void;
}
```

- Reações em cascata com limite de profundidade (evita loop infinito).
- Fase do jogo (setup, turno, manutenção) é um `global` + regras; não precisa de lib de fluxo no começo. Se crescer, avaliar **XState**.

### 4.3 Mesa (zona) [SUGERIDO]

Uma Peça com `zone`, que aceita outras peças.

```ts
interface ZoneSpec {
  layout: 'free' | 'grid' | 'slots' | 'stack' | 'fan';
  accepts?: { kinds?: string[]; tags?: string[] };     // filtro simples
  acceptRule?: string;                                  // id de Rule para casos complexos
  statusOnEnter?: string;                               // status que a peça ganha ao entrar
  statusOnLeave?: string;
  slots?: SlotDef[];                                    // para layout 'slots'
  grid?: { cols: number; rows: number; cell: number };
  capacity?: number;
}
```

(Versão implementada na fase 5, com pequenas diferenças: ver notas da fase 5 e `src/engine/core/zones.ts`.)

Layouts cobrem tudo que o Tatto Game precisa e são reaproveitáveis:

| Layout | Uso no Tatto Game | Uso genérico |
|---|---|---|
| free | área livre da mesa | mesa de qualquer jogo |
| grid | trilhas (foco, espera, reputação) | tabuleiros quadriculados |
| slots | **Tableau do Mindset** (pirâmide invertida) | encaixes nomeados |
| stack | decks, descarte, **sleeve da tatuagem** (camadas transparentes) | pilhas |
| fan | mão (consciência coletiva) | mão de cartas |

- O Tableau do Mindset é `slots` com posições geradas pelas coordenadas `(r, p)` do apêndice do Mindset.md (apoios, cobertura, cone). Aquele código entra quase direto em `games/tatto`.
- "Status diferente ao receber": `statusOnEnter` para o caso simples; regra de reação para o caso dependente (ex.: carta coberta perde a ação lateral).
- Zona dentro de zona é permitida (sleeve dentro da área do jogador).

---

## 5. Lib de desenho e manipulação

### 5.1 Candidatas

| Opção | Pontos fortes | Pontos fracos | Encaixe |
|---|---|---|---|
| **react-konva** (Konva) | Componentes React declarativos; arrastar nativo; `Transformer` para girar e redimensionar; grupos aninhados (zona com peças dentro); detecção de clique por forma; leve e sem dependências; suporte a React 19. | Canvas 2D: centenas de sprites animados pesam mais que WebGL; texto e acessibilidade fracos. | **Recomendado para começar.** |
| **@pixi/react** (PixiJS v8) | WebGL/WebGPU, muito rápido, ótimo para animação e efeitos; v8 refeito para React 19. | Sem arrastar e girar prontos (implementar ou usar plugin); mais código de interação. | Plano B se performance ou animação virarem gargalo. |
| **DOM + CSS transform** com **dnd-kit** e/ou **react-moveable** | Acessível, texto nítido, devtools do navegador, fácil de estilizar; react-moveable dá girar e redimensionar. | Muitas peças e camadas transparentes sobrepostas ficam pesadas; zoom e pan da mesa dão mais trabalho. | Bom para mão de cartas, menus e painéis ao redor da mesa. |
| **Fabric.js** | Editor de objetos completo (seleção, girar, agrupar). | Pensado para editor de desenho, não para jogo; integração com React é manual. | Não recomendado. |
| **boardgame.io** (motor, não desenho) | Turnos, fases, multiplayer, IA, log. | Em modo manutenção, sem desenvolvimento ativo. | Não usar como base; serve de referência de ideias. |
| **Do zero** | Controle total. | Hit test, arrastar, girar com pivô, zoom, pan e camadas levam semanas. | Só para o **core** (modelo, eventos, Gestor). |

### 5.2 Recomendação [SUGERIDO]

- **Core do zero** (é pequeno, é o coração reaproveitável e nenhuma lib entrega o modelo Peça/Mesa/Gestor do jeito descrito).
- **Renderer com react-konva**, atrás de uma interface (`PieceView`, `ZoneView`, `onGesture`) para permitir trocar por Pixi sem tocar no core.
- **UI de apoio em DOM** (painéis, botões de ação, barras de foco, log), por cima do canvas.

[EM ABERTO] Confirmar na fase 4 com um teste de carga: ~150 peças com imagens transparentes sobrepostas, arrastando e girando, a 60 fps no desktop (repetir no celular quando ele entrar).

Resultado (10/10/2026, Chrome headless com GPU Apple M5): 60 fps com mínimo de 60 girando **todas** as peças a cada quadro, com 150, 300 e 600 peças transparentes sobrepostas. Konva atende o desktop com folga. Falta repetir no celular.

---

## 6. Stack [SUGERIDO]

- **[DECIDIDO]** pnpm, React Router, desktop primeiro (celular depois).
- Vite + React 19 + TypeScript (strict). TypeScript fixo em 6.0.x enquanto o typescript-eslint não aceitar o 7.
- Testes: `*.test.ts` rodam em Node puro (core e regras), `*.test.tsx` rodam com jsdom. O ESLint barra imports de React, render, jogos e páginas dentro de `engine/core`.
- @tanstack/react-query.
- Zustand (vanilla) ou store próprio + `useSyncExternalStore`.
- Immer (reducers), Zod (schema de atributos e de JSON de cartas).
- react-konva + konva.
- Vitest (core) e Testing Library; Playwright depois para fluxo de tela.
- Estrutura em pastas no início; virar monorepo (pnpm workspaces) quando surgir o segundo jogo.

```
src/
  engine/
    core/      piece.ts zone.ts manager.ts events.ts commands.ts rules.ts
    react/     ManagerProvider.tsx usePiece.ts useGlobals.ts useDispatch.ts
    render/    konva/ PieceView.tsx ZoneView.tsx Table.tsx layouts/
    data/      queries.ts assets.ts
  games/
    tatto/     kinds.ts rules/ mindset/ catalog/ clients/ turn.ts setup.ts
  pages/
    sandbox/   (testes visuais de cada fase)
    tatto/
```

---

## 7. Fases

Cada fase termina com testes passando e algo visível no sandbox.

### Fase 0. Projeto

- Criar projeto, lint, Prettier, Vitest, alias de pastas, QueryClientProvider, rota `/sandbox`.
- **Pronto quando:** `npm test` e `npm run dev` rodam; página em branco com o provider.
- **[FEITO 10/10/2026]** com pnpm.

### Fase 1. Peça (core)

- Tipos `Piece`, `Transform`, `AttrValue`; funções puras `createPiece`, `move`, `rotate`, `setStatus`, `setAttr`, `getFace`.
- Registro de `kind` com schema Zod e transições de status permitidas.
- **Pronto quando:** testes cobrem transformações, troca de imagem por status, validação de atributo e transição inválida recusada.
- **[FEITO 10/10/2026]** Funções da Peça aplicam sem validar; quem valida é o registro de kinds (`validateStatus`, `validateAttr`, devolvendo `true | string` como `Rule.validate`). O schema Zod só valida, não transforma o valor guardado. Extra: `rotateBy` (relativo) ao lado de `rotate` (absoluto).

### Fase 2. Gestor e eventos (core)

- `dispatch`, comandos → eventos → reducer (Immer), `subscribe`, `on`, regras com `validate` e `react`, `undo`, log.
- Limite de cascata de reações.
- Bloqueio do `undo` após evento com `revealsInfo`, sorteio com semente no estado e escolhas pendentes (seção 3.4).
- **Pronto quando:** teste com duas peças em que mudar um atributo de A dispara regra que altera B e um `global`; desfazer volta tudo; log mostra a sequência.
- **[FEITO 10/10/2026]** Diferenças em relação ao esboço da seção 4.2:
  - `dispatch` é atômico: se qualquer reação falha, nada muda, e o erro diz qual regra falhou. Reações rodam em profundidade (a reação de um evento roda antes do próximo comando da fila). Limites: `maxDepth` 32 níveis e `maxCommands` 1000 por jogada.
  - `setAttr`, `setGlobal` e `setPlayerAttr` aceitam `value` (substitui) ou `delta` (soma). Reações devem preferir `delta`, porque podem rodar depois de outras mudanças (por exemplo, após uma escolha pendente).
  - Novo `registerCommand`: comandos do jogo que geram eventos (ex.: sorteio). Hoje só devolvem eventos; se a fase 7 precisar de comandos compostos de outros comandos, ampliar.
  - Log guarda `{ seq, depth, by, event }` (nível na cascata e regra que gerou), não só o evento.
  - Qualquer uso de `random()` gera o evento `rngAdvanced` com `revealsInfo`, então sorteio também bloqueia o desfazer (evita "rolar de novo" desfazendo).
  - `undo` volta uma jogada inteira; `canUndo()` devolve `true` ou o motivo. Histórico limitado a 100 passos. `clearHistory()` marca o fim do setup (o que veio antes não pode ser desfeito).
  - Escolha pendente: `ask` (comando de uma reação) pausa a jogada e guarda o resto da fila no estado; `choose` responde, roda o `resolve` da regra e retoma a fila.

### Fase 3. Ligação com React

- Provider do Gestor; hooks `usePiece(id)`, `useGlobals(selector)`, `useDispatch()` com seletores para não re-renderizar a mesa inteira.
- Decidir Zustand vs store próprio.
- **Pronto quando:** sandbox em DOM simples lista peças e atributos e atualiza ao despachar comandos de botões.
- **[FEITO 10/10/2026]** Zustand. `ManagerProvider` + hooks `useGame(selector)`, `usePiece(id)`, `usePieceIds(filter?)`, `useGlobals(selector)` (comparação rasa), `useDispatch()`, `useUndo()`, `useManager()`. O store também guarda `lastError` (motivo da última recusa) e `canUndo`. Testes confirmam que mudar uma peça não re-renderiza as outras. `clearHistory` agora avisa os inscritos (o `canUndo` muda). ESLint impede `engine/react` de importar render, jogos e páginas.

### Fase 4. Renderer da Peça (react-konva)

- `Table` (Stage com zoom e pan), `PieceView` (imagem pelo status, transform), arrastar → comando `move`, girar via Transformer ou botão → comando `rotate`, virar carta → `setStatus`.
- Teste de carga do item 5.2.
- **Pronto quando:** no sandbox, arrastar, girar e virar peças funciona no PC (celular depois), e o estado no painel bate com a tela.
- **[FEITO 10/10/2026]**
  - `engine/render` (sem Konva): `Gesture` (`drag`, `rotate`, `activate`), `GestureHandler` (gesto → comando, o jogo decide o `activate`), `defaultGestures`, `drawOrder` (por z), `zoomAt`, `useImage` (cache por URL), `TableProps` (contrato para qualquer renderer).
  - `engine/render/konva`: `Table` (zoom na roda, pan arrastando o vazio, Transformer só para girar, com encaixe a cada 90°) e `PieceView` (imagem pelo status ou placeholder com texto). Gesto recusado pelo Gestor devolve a peça animada para o lugar do estado.
  - Core: `x, y` da peça é o **centro**; `move` ganhou `z` opcional (soltar uma peça a leva para o topo, e o estado guarda isso).
  - Verificado com eventos de mouse reais no Chrome (via DevTools Protocol): arrastar, girar pela alça, duplo clique para virar, pan e zoom; painel de estado igual à tela; sem erros no console.
  - Sandbox: `/sandbox` (mesa) e `/sandbox/carga` (teste de carga com FPS).

### Fase 5. Mesa (zonas)

- `ZoneSpec`, layouts `free`, `grid`, `stack`, `fan`, `slots`; soltar peça em zona → comando `dropInto` validado por `accepts`/`acceptRule`; `statusOnEnter/Leave`; encaixe magnético; destaque das zonas válidas durante o arrasto; zona dentro de zona.
- **Pronto quando:** sandbox com uma grade, uma pilha, uma mão e uma zona de slots; soltar em zona inválida devolve a peça; status muda ao entrar.
- **[FEITO 10/10/2026]** Diferenças em relação ao esboço da seção 4.3:
  - `acceptRule` saiu: casos complexos usam uma Rule com `validate` para o comando `dropInto` (um mecanismo só). `accepts` continua para o filtro simples.
  - `grid.cell` é `{ w, h }` (casas retangulares). Novos campos de desenho: `slotSize`, `stack: { dx, dy }`, `fan: { spacing, arc }`.
  - Peça ganhou `slot` (grade: `"col,linha"`; slots: id). A ordem dentro de pilha e mão é o próprio `z` (embaralhar = reatribuir z).
  - Coordenadas: na mesa, coordenadas da mesa; em zona `free`, relativas ao canto superior esquerdo da zona; nas outras, o layout decide.
  - Comandos `dropInto { id, zone, slot?, x?, y?, index? }` (zone `null` = mesa) e `shuffle { zone }`. Eventos `pieceLeftZone`, `piecePlaced`, `pieceEnteredZone` e `statusChanged` (o `statusOnEnter` da zona nova vence o `statusOnLeave` da antiga, e passa pelas transições do kind). `move` dentro de zona com layout é recusado. Zona com peças não pode ser removida.
  - `manager.check(cmd)` simula sem aplicar; a mesa usa para destacar zonas e encaixes válidos (verde), a zona sob o ponteiro (azul se aceita, vermelho se recusa).
  - Render: a árvore vira uma lista achatada com posições absolutas (`buildScene`, TypeScript puro, testável e reaproveitável no Pixi). Arrastar sempre gera `dropInto`; encaixe magnético nos slots (até 0,75 × o tamanho do encaixe); arrastar uma zona leva o conteúdo junto. `canDrag` define o que o jogador pode arrastar.
  - Verificado com mouse real no Chrome e capturas de tela.
- **[FEITO 10/10/2026] Tabuleiro como componente (extra):**
  - `Prefab<Options>` (função que devolve as peças de um conjunto, pais antes dos filhos, ids derivados do id da instância) e `spawn(peças)`, que cria tudo numa jogada só.
  - Comando `batch { commands }`: vários comandos numa jogada, tudo ou nada; um desfazer volta todos.
  - `games/tatto/mindset/tableau.ts`: `createTableau({ id, rows, base, card, ... })` com a geometria do Mindset.md 4.1/4.3 (encaixes `"r,p"`).
  - Girar uma zona pela alça gira o conteúdo junto em tempo real; ao soltar, um único `rotate` da zona.
  - Sandbox "Tabuleiro como componente": dois tabuleiros de jogador da mesma definição (Tableau, Foco com fichas, Descarte, Mão), arrastáveis e giráveis; botão cria mais um.

### Fase 6. Dados com React Query

- Schemas Zod de cartas de Mindset, catálogo e clientes; `useGameDefinitions()`; pré-carga de imagens; placeholders gerados (retângulo com texto) enquanto não há arte.
- **Pronto quando:** sandbox monta peças a partir do JSON carregado, com tela de carregamento e erro.
- **[FEITO 10/10/2026]**
  - `engine/data`: `jsonQuery(key, url, schema)` (React Query + Zod; erro de formato diz arquivo e caminho, ex.: `mindset[2].centro`, e não tenta de novo; falha de rede tenta até 2 vezes), `DataBoundary` (Suspense + tela de erro com "Tentar de novo"), cache e pré-carga de imagens (`preloadImages`, `useImage`), e **imagens geradas** por URL `esquema:caminho` (`registerImageGenerator`).
  - Peças de carta guardam só `attributes.def` (id da definição); os dados das cartas ficam nas definições carregadas, fora do estado. A face é uma URL curta (`tatto:mindset/T01`): hoje desenhada a partir dos dados; com arte real, troca-se a URL.
  - `games/tatto/data`: schemas Zod do `docs/cartas_mindset.json` (cada código de ação com o valor certo), `useDefinicoes()`, `deckDoElemento` (cópias por número de jogadores) e `cartasDeBase`. O JSON é lido direto de `docs/` (mesmo arquivo do simulador; o build o empacota).
  - Testes conferem o JSON contra o TattoGame.md 13: nível = reputação = conhecimento exigido, fornece 1 do próprio elemento, 30/36/48 cartas por elemento, bases 2/4/6.
  - `games/tatto/art.ts`: arte provisória das cartas (requisito, fornece, reputação, nome, central e laterais com R/P/✦). Cores e ícones dos elementos numa constante só (identidade visual em aberto).
  - **Pendente:** schemas de catálogo e clientes. Não há arquivo de dados, e o formato do contrato está sendo definido fora deste plano.
  - (11/10) O JSON foi para `docs/games/tatto/dados/cartas_mindset.json` (versão sem Interagir) e continua passando nos testes. Agora existe também `contratos.json` (clientes, eventos e consequências).

### Fase 6.5. Jogos como pacotes (`bqgame`) [DECIDIDO, 11/10/2026]

Objetivo: cada jogo vira **um arquivo** que qualquer pessoa abre num site (enviando o arquivo ou colando uma URL) e o jogo começa. Formato documentado em `docs/engine/FormatoBqgame.md`.

- **Etapa A [FEITO 11/10/2026]: componentes e setup em JSON.**
  - Pacote = `manifest.json` sozinho, ou `.bqgame` (zip) com dados e imagens. Imagens **dentro do pacote ou por URL** (`assets.base` ou absoluta) [DECIDIDO]; o estado guarda um nome estável (`asset:images/verso.png`).
  - Manifest (`bqgame/1`, validado com Zod; erros apontam o caminho): `kinds` (atributos em JSON Schema, `draggable`, `activate.cycleStatus`), `data` (no manifest, no pacote ou URL), `lookups`, `templates` (modelo de carta: rect, circle, text, image, preenchidos com `{campo|filtro}`), `prefabs` com parâmetros, `setup` (`pieces`, `forEach` com `copies`/`where`, `prefab`, `command`), `hud`.
  - Padrões de encaixe no core (`pyramid`, `row`); o `createTableau` do Tatto passou a usar o mesmo gerador.
  - Página `/jogar` (arquivo, URL, exemplos; `?url=` é link compartilhável). Exemplos em `public/exemplos/` (fontes em `examples/`, `pnpm exemplos` empacota).
  - Pré-carga de imagens com tempo-limite (10 s): imagem pendurada não trava o jogo.
- **Etapa B [FEITO 11/10/2026]: regras no pacote (`regras.js`), isoladas.**
  - O `regras.js` é o corpo de uma função que recebe `game`: `rule`, `command` (com `expand`: comando feito de outros comandos), `gesture`, `setup`, `prefab`, `data`, `helpers`. Roda depois do setup do manifest, a cada partida.
  - Core: `CommandDef.expand`; exceção em regra ou comando **recusa a jogada** com o motivo, em vez de quebrar a página.
  - Isolamento: o jogo inteiro (motor, mesa, regras) roda em `frame.html`, num iframe `sandbox="allow-scripts"` (origem `null`). O site só busca os bytes e entrega por `postMessage` (`bq:ready` → `bq:load` → `bq:loaded`/`bq:error`). Verificado no Chrome: dentro do iframe, `localStorage`, cookies e a página-mãe dão SecurityError. CSP na página do jogo no build.
  - `HttpError`: 4xx não se repete; só falha de rede e 5xx.
  - Exemplo `piramide.bqgame`: apoios no Tableau (Mindset.md 4.3), custo em energia, pontos, comando `comprar`, duplo clique na mão, um tabuleiro por jogador.

### Fase 6.6. Jogadores, dono e áreas privadas [FEITO 11/10/2026]

- **Jogador ativo no Gestor:** `playerOrder`, `activePlayer`, comandos `setActivePlayer` e `nextPlayer` (só o jogador da vez passa). Jogadores com nome e cor.
- **Quem fez a jogada:** comandos da tela carregam `actor` (o jogador que olha a tela, injetado por `useDispatch`/`useCheck`). Comandos de regras e do setup não têm `actor` e agem sem restrição. O log guarda o `actor`.
- **Dono herdado:** `ownerOf` = `owner` da peça ou da zona mais próxima acima. Com `actor`, o Gestor recusa mexer em peça de outro dono e soltar em área de outro dono (zona `openToOthers` libera); `setPlayerAttr` só nos próprios recursos.
- **Áreas privadas:** `privacy: 'hidden'` (os outros não veem o conteúdo) e `privacy: 'faceDown'` (os outros veem o verso, sem atributos nem tags; `backStatus` escolhe o verso). `viewFor(estado, jogador)` no core é a visão de cada um (a mesma que um servidor usaria no multiplayer).
- **Tela:** `ViewerProvider` (quem olha); a mesa desenha a visão dele, só deixa arrastar o que é dele e pinta tabuleiros e peças com a cor do dono. Painel "Jogadores" (da vez, na tela, recursos do `playerHud`, Passar a vez, Ver como); no hot seat a tela segue o jogador da vez. Log e detalhes da peça não revelam o que está escondido.
- Exemplo `piramide.bqgame` atualizado: tabuleiros com dono, mão `faceDown`, reserva `hidden`, painel com Energia, Mão, Reserva e Pontos. Verificado no Chrome dentro do iframe, com as duas visões.
- Contagem de zona `hidden` no painel aparece como "?" para quem não é o dono (`"public": true` libera). Arrastar peça de outro jogador não faz nada (antes virava pan da mesa).
- **Depois (multiplayer, fora do escopo atual: o teste agora é local):** IDs de peça podem revelar a carta (ex.: `obra-prima-1`); a tela já não os mostra para peças viradas, mas um servidor multiplayer precisará trocar ids na visão de cada jogador.

### Fase 6.7. Lacunas do motor levantadas pelo Eternal Decks (`docs/games/eternal_decks/MotorPendente.md`)

- **Bloco 1 [FEITO 11/10/2026]: fim de partida, escolhas na tela, revelar bloqueia desfazer.**
  - `endGame { result: win | lose | draw, message?, score? }`: `state.ended`; o resto da jogada não roda e o Gestor recusa novas jogadas ("a partida acabou"); desfazer volta. Tela de fim por cima da mesa (Jogar de novo / Ver a mesa).
  - `ask` ganhou `labels` (texto dos botões), `pick: 'piece'` (escolher clicando na mesa: contorno tracejado nas opções) e `multiple { min, max }` (lista; marca/desmarca e Confirmar). Painel "Escolha pendente"; a tela segue o jogador que responde; sem arrastar durante a escolha.
  - `reveals` no kind (`[de, para]`, `*`): `statusChanged` com `revealsInfo` bloqueia o desfazer (vale para `setStatus` e `statusOnEnter`).
- **Bloco 2 [FEITO 11/10/2026]: setups.**
  - `options` no manifest (escolhas com rótulo e padrão), mostradas ao lado de "Jogadores"; chegam ao setup como `{options.x}` e ao `regras.js` como `game.options`. Opção ou valor errado em `when` é acusado ao abrir o jogo.
  - `when` em qualquer passo do setup: `players` (número, lista ou min/max) e `options` (valor ou lista).
  - Sorteio de cartas abertas: `pick: N` no `forEach` (com a semente da partida; sequência própria do setup). `where` aceita `{campos}` e listas.
  - Passo `deal { from, to, count, status? }`: do topo, uma a uma; em grade/encaixes, o próximo lugar livre (`freeSlots` no core).
  - `forEachPlayer: true` em qualquer passo, com `{player}`, `{playerName}`, `{playerColor}`, `{playerIndex}` e `{seat.*}`; `players.seats` por número de jogadores. Comandos do setup agora aceitam `{campos}`.
  - `addPlayer { id, name?, color? }` (só regras e setup): jogadores extras, como os Golems do solo.
  - `{x|default:0}` sozinho no texto vira número (antes, texto).
  - Registro de campanha (M11) fica para depois [DECIDIDO].
- **Bloco 3 [FEITO 11/10/2026]: seleção múltipla (M2).** A regra de como a zona recebe é opcional; **sem regra, o grupo mantém o estado atual: rotação, posição entre as peças etc.** [DECIDIDO].
  - Mesa: Shift/Ctrl/Cmd + clique soma ou tira; Shift + arrastar no vazio ou numa zona fixa faz um retângulo; contorno azul nas selecionadas; girar só com uma. Arrastar uma selecionada leva o grupo (só as que o jogador pode mexer); destaque das zonas que aceitam o grupo inteiro.
  - Core: `dropMany { ids, zone, slot?, index?, at? }` vira um `dropInto` por peça (com o `actor`), cada um validado pelas regras; o `validate` também recebe o `dropMany` inteiro; no fim, o evento `piecesDropped`. Uma jogada, um desfazer. Pilha/leque/fila: o grupo entra junto na posição; grade/encaixes: a segurada sob o ponteiro e as outras nos próximos livres (o grupo pode andar dentro da zona); mesa/área livre: cada uma onde caiu.
  - Regras de entrada da zona: layout `row` (fila alinhada `start`/`center`/`end`, com `gap`, que se reorganiza), `autoFill` (grade/encaixes: primeiro livre) e `rotationOnEnter`.
  - Exemplo `piramide.bqgame`: energia em `row`, baralho com `rotationOnEnter: 0`, setup dos jogadores no manifest (`forEachPlayer` + `seats` + `deal`). Verificado no Chrome dentro do iframe: duas fichas devolvidas ao banco de uma vez (a que sobra fica à esquerda) e desfeitas; duas cartas da mão para a mesa mantendo a distância; retângulo começando em cima do baralho; grupo para o baralho, virado.
  - Observação: o painel "peça selecionada" mostra os dados de uma carta virada que não está em área privada (ex.: o topo do baralho). Antes do Tatto, vale esconder os dados quando o status for o verso.

### Fase 6.8. Lacunas levantadas pelo Tatto e o resto da lista (`docs/games/tatto/MotorPendente.md`) [FEITO 11/10/2026]

- **Bloco 4 (P0 do Tatto):**
  - `game.action({ id, label, visible?, enabled?, command })`: botões no painel, com `ctx = { player, selection }`. Sem `enabled`, o botão testa o comando com `check` e mostra o motivo da recusa como dica. Somem durante uma escolha.
  - `ask` com `buttons: [{ value, label }]` (respostas extras: "Pular", "Terminar") e `pick: 'drop'` (responder arrastando: o arrasto vira `choose { id, zone, slot… }`; regra recusou, a peça volta e a escolha continua; a mesa destaca os destinos válidos).
  - `players.passButton: false | "texto"`: a vez passa pelas regras.
- **Bloco 5 (M6):** `rules` em lista (mesmo `game`, `game.shared`); regras em TypeScript empacotadas com esbuild pelo `pnpm exemplos` (`scripts/pack-game.mjs` exporta `packGame`); `loadGameFolder` (`@/engine/testing`) para testar a pasta do jogo no Node; testes em `examples/**/*.test.ts` rodam com os do motor. O exemplo `piramide` virou TypeScript com testes (`examples/piramide/regras/`).
- **Bloco 6:** log com as mensagens do jogo por jogada (comando `log { message, to? }`, eventos com `message`; "Log completo" mostra os eventos do motor); painel com `text` e `list` (e `text` no `playerHud`); `badges` e `hotspots` no kind (duplo clique leva `area`); conjuntos de dados `{ file, path?, schema? }` (lista dentro de um JSON, validação por item com o erro em `cartas[37].cor`).
- **Bug do modelo de carta (levantado pelo Tatto):** fonte que começa pelo peso (`"700 15px …"`) dava altura de linha `NaN` e o texto sumia; agora a altura vem do `NNpx`.
- **Também:** `hiddenStatuses` no kind (carta virada fora de área privada não aparece no painel nem no log, para ninguém); `polygon` e `rotation` no texto dos modelos de carta.
- Fica de fora (de propósito): `pick: 'slot'` (o arrasto cobre os casos), a fase simultânea de verdade (multiplayer), a campanha (M11).

### Fase 6.9. Melhorias de mesa (`docs/melhorias.md`) [FEITO 12/10/2026]

- **Câmeras e mesa:** M15 a M17 do Eternal Decks: contornos das zonas (tecla G, `zone.outline`, `table.guides`), nomes e cores por número de jogadores, enquadrar ao abrir, Centralizar enquadra, câmeras com Shift+Alt+1…9 e Alt+1…9.
- **Descrição e palavras-chave:** `description` no kind (HTML limitado, `{campos}` dos dados: cada carta a sua) e `keywords` (HTML, citam outras com `[[id]]`). No preview e numa dica ao lado da peça (tecla T). Modos (tecla K): completo, compacto (com Ctrl) e oculto (no preview fixo, com hover nas palavras, em cadeia).
- **Menu do botão direito:** Preview, Selecionar, Mover ▸ (destinos válidos; grupo junto), Usar, Girar 90° e as ações do jogo com `menu: true`.
- **Mão do jogador:** `zone.hand`. A câmera passou a ser um grupo "mundo" dentro do palco (o palco é a tela); a mão é uma camada fixa na tela, no mesmo canvas, com arrasto nativo entre a faixa e a mesa. Tamanho da mão nas configurações. Arrastar no vazio move a mesa por um arrasto próprio (o palco não se move mais).

### Fase 6.10. Atalhos configuráveis [FEITO 15/10/2026]

- **Lista de atalhos** na aba Atalhos das configurações, como o keybinding do VS Code: comandos da mesa, HUD, câmeras e as ações do jogo (`game.action`, com `key` de fábrica). Popup espera a combinação; Enter confirma; combinação em uso ou reservada bloqueia o Enter com o aviso. Restaurar um, remover, restaurar todos, busca.
- **Guardados pelo site** (`localStorage` da página, chave `bqtable:prefs`), entregues ao iframe no `bq:load`: os da mesa para todos os jogos, os das ações por jogo. O iframe avisa as combinações em uso (`bq:keymap`) e o site repassa só essas teclas quando o foco está fora do jogo.
- Código: `src/engine/package/keys.ts` (combinações, padrões, resolução de conflitos, `useKeybindings`), `Keybindings.tsx` (lista e popup), `src/frame/protocol.ts` (`bq:prefs`, `bq:keymap`, limites do que o site guarda).

### Fase 7. Tatto Game, por partes

**[DECIDIDO, 11/10/2026]** O Tatto Game será construído **como um pacote** (`manifest.json` + `cartas_mindset.json` + `contratos.json` + modelos de carta + `regras.js`), sem código do jogo dentro do app. O que existe hoje em `src/games/tatto` (schemas, arte provisória, `createTableau`) serve de referência e de teste do formato.

O pacote fica em `games/tatto/`. Detalhes e decisões de implementação estão no `LEIAME.md` dele. O que o jogo pede ao motor está em `docs/games/tatto/MotorPendente.md`.

Subfases [revistas em 11/10/2026 depois da atualização das regras: saiu o Interagir; entraram eventos, trilha de reputação e moral]. Cada uma é testável em `/jogar?url=/games/tatto/manifest.json`.

0. **Pacote sem regras [FEITO 11/10/2026]:** manifest, dados gerados de `docs/games/tatto/dados` (`scripts/tatto-dados.mjs`), modelos de carta a partir do protótipo, tabuleiro por jogador, decks, catálogo, clientes, eventos e painel; solo sem os eventos de 2 personagens. Teste em `src/games/tatto/pacote.test.tsx` (contagens com 1 a 4 jogadores). Verificado no Chrome: arrastar bases e cartas para o Tableau, cobertura das laterais igual ao protótipo.
1. **Setup e Tableau:** escolha das bases (máximo 10 de reputação, ordem livre), compras, pré-baixadas fixas, bônus do Mestre; Pensar (apoios e conhecimento pelo cone), epifanias ao cobrir, Refletir, Sobrecarga (esquecer é obrigatório).
2. **Mão e consciência coletiva:** decks e descarte por elemento, Comprar, Jogar, limite de 8, passar a mão, reset.
3. **Foco e rápidas:** três barras com teto 15, rápidas em ordem e opcionais, Praticar, moral.
4. **Catálogo e sleeves:** Preparar e Preparar+, misturas de cor, remover carta, flash.
5. **Clientes e trilha:** baralho do dia, chegada pela trilha, espera, Aplicar e Aplicar+, bônus, desistência, marcadores.
6. **Eventos e consequências:** 18 eventos do dia, 6 consequências, personagens.
7. **Hora, dias e placar:** fases da hora, manutenção, derrota, placar.
8. **Hot seat:** a fase simultânea (rápidas ou reset), um jogador de cada vez.

- **Pronto quando:** uma partida completa de 2 jogadores roda do setup ao placar.

### Fase 8. Depois (fora do escopo inicial)

- Salvar e carregar partida (React Query + backend).
- IA reaproveitando a lógica do simulador.
- Multiplayer online: servidor roda o mesmo core, valida comandos e transmite eventos.
- Segundo jogo sobre o motor; separar em pacotes.

---

## 8. Pontos em aberto

1. ~~Zustand ou store próprio~~ → Zustand [DECIDIDO, fase 3].
2. react-konva confirmado após teste de carga, ou troca para Pixi (fase 4). → Desktop confirmado (60 fps com 600 peças); repetir no celular.
3. Hot seat com ações simultâneas: telas separadas por jogador ou tudo aberto (fase 7.7).
4. Arte: placeholders gerados até existir arte; formato e tamanho das imagens das cartas transparentes.
5. ~~Código do simulador~~ → está em `docs/games/tatto/simulador/` (Python), com os dados em `docs/games/tatto/dados/`.
6. ~~Mobile ou desktop primeiro~~ → desktop primeiro [DECIDIDO].
7. Dúvidas de regra do Tatto Game (resolução simultânea de Preparar/Aplicar rápidas, formato do contrato, opções de Interagir, versão fraca da rápida, epifania no setup e após Refletir, encaixe por cor) estão sendo resolvidas fora deste plano; travam só a fase 7. (11/10: TattoGame.md atualizado em `docs/games/tatto/docs/`; Interagir saiu das cartas.)
8. Publicação do site: a página do jogo (`frame.html`) precisa servir os scripts com `Access-Control-Allow-Origin` (iframe de origem `null`), ou ficar num domínio próprio.
9. Trava de tempo para `regras.js` com laço infinito (hoje trava o iframe; no Chrome o resto do site continua).
10. ~~Quem fez a jogada~~ → `actor` (fase 6.6). ~~Escolhas que apontam para a mesa~~ → `ask` com `pick: 'piece'` (fase 6.7). Falta: escolher um encaixe vazio (hoje só peças).

## 9. Riscos

- Gestor virar um "deus" com todas as regras: manter regras em arquivos por sistema (foco, Mindset, clientes) registradas no Gestor.
- Reações em cascata difíceis de depurar: log de eventos visível no sandbox desde a fase 2.
- Estado com objetos não serializáveis (imagens, nós Konva) vazar para o core: core guarda só IDs e URLs.
- Performance de muitas imagens transparentes sobrepostas: cache de grupos no Konva ou troca para Pixi.
