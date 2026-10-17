import { z } from 'zod';

/**
 * Formato de um jogo empacotado (docs/engine/FormatoBqgame.md). Um jogo é um `manifest.json`, sozinho
 * ou dentro de um `.bqgame` (zip) com dados e imagens. Textos em peças, dados e modelos aceitam
 * `{campo}` (ver interpolate.ts).
 */

const num = z.number();
const Size = z.object({ w: num.positive(), h: num.positive() });

const SlotDef = z.object({ id: z.string(), x: num, y: num, rotation: num.optional() });

const SlotPattern = z.discriminatedUnion('pattern', [
  z.object({
    pattern: z.literal('pyramid'),
    base: z.int().min(1),
    rows: z.int().min(1),
    slot: Size,
    overlap: num.min(0).max(1).optional(),
    margin: num.min(0).optional(),
  }),
  z.object({
    pattern: z.literal('row'),
    count: z.int().min(1),
    slot: Size,
    gap: num.min(0).optional(),
    margin: num.min(0).optional(),
  }),
]);
export type SlotPatternManifest = z.infer<typeof SlotPattern>;

export const ZoneManifest = z.object({
  layout: z.enum(['free', 'grid', 'slots', 'stack', 'fan', 'row']),
  accepts: z
    .object({ kinds: z.array(z.string()).optional(), tags: z.array(z.string()).optional() })
    .optional(),
  statusOnEnter: z.string().optional(),
  statusOnLeave: z.string().optional(),
  capacity: z.int().min(0).optional(),
  grid: z.object({ cols: z.int().min(1), rows: z.int().min(1), cell: Size }).optional(),
  /** Lista de encaixes ou um padrão que os gera. */
  slots: z.union([z.array(SlotDef), SlotPattern]).optional(),
  slotSize: Size.optional(),
  stack: z.object({ dx: num, dy: num }).optional(),
  fan: z.object({ spacing: num, arc: num.optional() }).optional(),
  /** Fila: coladas a partir de uma ponta, com `gap` entre elas. */
  row: z
    .object({ gap: num.min(0).optional(), align: z.enum(['start', 'center', 'end']).optional() })
    .optional(),
  /** Grade e encaixes: a peça vai sempre para o primeiro encaixe livre. */
  autoFill: z.boolean().optional(),
  /** Rotação que a peça ganha ao entrar. */
  rotationOnEnter: num.optional(),
  /** `false`: sem contorno, casas nem rótulo (casas sobre a arte); o destaque do arrasto continua. */
  outline: z.boolean().optional(),
  /** Mão do jogador: para o dono, as peças aparecem numa faixa embaixo da tela. */
  hand: z.boolean().optional(),
  /** Para quem não é o dono: `hidden` não vê nada; `faceDown` vê as peças viradas. */
  privacy: z.enum(['hidden', 'faceDown']).optional(),
  backStatus: z.string().optional(),
  /** Outros jogadores também podem soltar peças aqui. */
  openToOthers: z.boolean().optional(),
});

/** Peça como no motor (PieceInit), em JSON. Validada depois de preencher os `{campos}`. */
export const PieceManifest = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  transform: z
    .object({
      x: num.optional(),
      y: num.optional(),
      rotation: num.optional(),
      scale: num.positive().optional(),
      z: num.optional(),
    })
    .optional(),
  status: z.string().optional(),
  /** status → imagem: "template:nome/id", caminho no pacote, caminho na base de assets, ou URL. */
  faces: z.record(z.string(), z.string()).optional(),
  size: Size.optional(),
  attributes: z.record(z.string(), z.json()).optional(),
  tags: z.array(z.string()).optional(),
  parentId: z.string().nullable().optional(),
  slot: z.string().optional(),
  owner: z.string().optional(),
  zone: ZoneManifest.optional(),
});
export type PieceManifest = z.infer<typeof PieceManifest>;

/** Peça antes de preencher os `{campos}`: valores podem ser texto com marcadores. */
const PieceTemplate = z.record(z.string(), z.unknown());

export const KindManifest = z.object({
  kind: z.string().min(1),
  statuses: z.array(z.string()).optional(),
  initialStatus: z.string().optional(),
  transitions: z.record(z.string(), z.array(z.string())).optional(),
  /** Mudanças de status que revelam informação ([de, para]; "*" = qualquer): bloqueiam o desfazer. */
  reveals: z.array(z.tuple([z.string(), z.string()])).optional(),
  /** Status em que ninguém vê o que a peça é (o verso): o painel, a mesa e o log não revelam. */
  hiddenStatuses: z.array(z.string()).optional(),
  /** JSON Schema dos atributos. */
  attributes: z.record(z.string(), z.unknown()).optional(),
  defaults: z
    .object({
      size: Size.optional(),
      faces: z.record(z.string(), z.string()).optional(),
      tags: z.array(z.string()).optional(),
      attributes: z.record(z.string(), z.json()).optional(),
    })
    .optional(),
  /** O jogador pode arrastar peças deste tipo (padrão: sim; peças com a tag "locked" nunca). */
  draggable: z.boolean().optional(),
  /** Duplo clique: passa para o próximo status da lista (ex.: virar carta). */
  activate: z.object({ cycleStatus: z.array(z.string()).min(2) }).optional(),
  /** Conjunto de dados que `attributes.def` referencia (mostra os dados no painel). */
  data: z.string().optional(),
  /**
   * Descrição (HTML limitado) mostrada no preview e na dica ao lado da peça. Aceita `{campos}` do
   * item de dados e dos atributos da peça (cada carta, a sua) e palavras-chave (`[[id]]`).
   */
  description: z.string().optional(),
  /** Selos nos cantos: `text` com `{campos}` dos atributos da peça; vazio = sem selo. */
  badges: z
    .array(
      z.object({
        text: z.string(),
        corner: z.enum(['tl', 'tr', 'bl', 'br']).optional(),
        color: z.string().optional(),
        background: z.string().optional(),
      }),
    )
    .optional(),
  /** Áreas da peça (coordenadas da peça): o duplo clique numa delas leva `area` no gesto. */
  hotspots: z
    .array(
      z.object({
        id: z.string().min(1),
        x: num,
        y: num,
        w: num.positive(),
        h: num.positive(),
        label: z.string().optional(),
      }),
    )
    .optional(),
});
export type KindManifest = z.infer<typeof KindManifest>;

const Cond = { if: z.string().optional() }; // desenha só se o texto preenchido não for vazio
const Box = { x: num, y: num, w: num, h: num };
const Paint = {
  fill: z.string().optional(),
  stroke: z.string().optional(),
  lineWidth: num.optional(),
  dash: z.array(num).optional(),
};

export const TemplateElement = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rect'), ...Box, radius: num.optional(), ...Paint, ...Cond }),
  z.object({ type: z.literal('circle'), x: num, y: num, r: num, ...Paint, ...Cond }),
  // polígono: pontos em lista [x1, y1, x2, y2, …] (ex.: a metade de uma carta cortada na diagonal)
  z.object({
    type: z.literal('polygon'),
    points: z
      .array(num)
      .min(6)
      .refine((p) => p.length % 2 === 0, 'pontos em pares x, y'),
    ...Paint,
    ...Cond,
  }),
  z.object({
    type: z.literal('text'),
    x: num,
    y: num,
    text: z.string(),
    font: z.string().optional(),
    color: z.string().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    maxWidth: num.optional(),
    lineHeight: num.optional(),
    maxLines: z.int().min(1).optional(),
    /** Graus, em volta do ponto x, y (180 = de ponta-cabeça). */
    rotation: num.optional(),
    ...Cond,
  }),
  z.object({ type: z.literal('image'), ...Box, src: z.string(), ...Cond }),
]);
export type TemplateElement = z.infer<typeof TemplateElement>;

/** Modelo de carta: desenha a face a partir de um item de dados (`template:nome/idDoItem`). */
export const CardTemplate = z.object({
  size: Size,
  /** Conjunto de dados de onde vêm os itens. */
  data: z.string().optional(),
  /** Resolução do desenho (padrão 2, nítido com zoom). */
  scale: num.positive().optional(),
  elements: z.array(TemplateElement),
});
export type CardTemplate = z.infer<typeof CardTemplate>;

/** Número fixo, ou texto com `{campos}` (ex.: "{players}"). */
const Count = z.union([z.int().min(0), z.string()]);

/** Condição de um passo do setup: todas as partes precisam valer. */
export const When = z.object({
  /** Número de jogadores escolhido: um número, uma lista, ou `{ min, max }`. */
  players: z
    .union([
      z.int().min(1),
      z.array(z.int().min(1)),
      z.object({ min: z.int().min(1).optional(), max: z.int().min(1).optional() }),
    ])
    .optional(),
  /** Opção da partida → valor (ou lista de valores aceitos). */
  options: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});
export type When = z.infer<typeof When>;

const StepCommon = {
  /** O passo só roda se a condição valer. */
  when: When.optional(),
  /** Roda uma vez por jogador, com `{player}`, `{playerName}`, `{playerColor}`, `{playerIndex}` e `{seat.x}`... */
  forEachPlayer: z.literal(true).optional(),
};

export const SetupStep = z.union([
  z.object({ pieces: z.array(PieceTemplate), ...StepCommon }),
  z.object({
    prefab: z.string(),
    with: z.record(z.string(), z.json()).optional(),
    ...StepCommon,
  }),
  z.object({
    /** Uma peça (ou `copies` peças) por item do conjunto de dados. */
    forEach: z.string(),
    /** Campo → valor (ou lista de valores aceitos); aceita `{campos}` (ex.: "{options.stage}"). */
    where: z.record(z.string(), z.json()).optional(),
    /** Sorteia esta quantidade de itens (depois do `where`), em ordem aleatória. */
    pick: Count.optional(),
    copies: Count.optional(),
    piece: PieceTemplate,
    ...StepCommon,
  }),
  z.object({
    command: z.record(z.string(), z.unknown()).and(z.object({ type: z.string() })),
    ...StepCommon,
  }),
  z.object({
    /** Passa as `count` peças do topo de uma zona para outra (ex.: a mão inicial). */
    deal: z.object({
      from: z.string(),
      to: z.string(),
      count: Count,
      status: z.string().optional(),
    }),
    ...StepCommon,
  }),
]);
export type SetupStep = z.infer<typeof SetupStep>;

/** Texto com `{campos}` (globais; no `playerHud`, também os atributos do jogador). */
const TextItem = z.object({ label: z.string().optional(), text: z.string() });

export const HudItem = z.union([
  // peças dentro da zona; se ela esconde o conteúdo de quem olha, aparece "?" (a não ser `public`)
  z.object({ label: z.string(), count: z.string(), public: z.boolean().optional() }),
  z.object({ label: z.string(), global: z.string() }),
  TextItem,
  // um global que é uma lista: um item por linha (texto, ou o `label`/`name`/`id` do objeto)
  z.object({ label: z.string(), list: z.string() }),
]);
export type HudItem = z.infer<typeof HudItem>;

/** Recurso de cada jogador no painel; `{player}` vira o id do jogador (ex.: "{player}-mao"). */
export const PlayerHudItem = z.union([
  z.object({ label: z.string(), count: z.string(), public: z.boolean().optional() }),
  z.object({ label: z.string(), global: z.string() }),
  z.object({ label: z.string(), attr: z.string() }), // atributo do jogador (setPlayerAttr)
  TextItem,
]);
export type PlayerHudItem = z.infer<typeof PlayerHudItem>;

const DataItem = z.record(z.string(), z.json()).and(z.object({ id: z.union([z.string(), num]) }));

/**
 * Conjunto de dados de um arquivo, com opções: `path` pega uma lista dentro do JSON (ex.: "bases"
 * em `{ "mindset": [...], "bases": [...] }`); `schema` (JSON Schema) valida cada item.
 */
const DataSource = z.object({
  file: z.string(),
  path: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
});

/** Lugar de um jogador na mesa; campos extras viram `{seat.campo}` no setup. */
const Seat = z.object({ x: num, y: num, rotation: num.optional() }).catchall(z.json());
export type Seat = z.infer<typeof Seat>;

const OptionChoice = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);

/** Opção escolhida antes da partida (Stage, dificuldade...), em `{options.id}` e `game.options`. */
export const MatchOption = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    choices: z.array(OptionChoice).min(1),
    /** Padrão: a primeira escolha. */
    default: z.string().optional(),
  })
  .refine((o) => o.default === undefined || o.choices.some((c) => choiceValue(c) === o.default), {
    message: 'default fora de choices',
    path: ['default'],
  });
export type MatchOption = z.infer<typeof MatchOption>;

export function choiceValue(c: z.infer<typeof OptionChoice>): string {
  return typeof c === 'string' ? c : c.value;
}
export function choiceLabel(c: z.infer<typeof OptionChoice>): string {
  return typeof c === 'string' ? c : c.label;
}

export const GameManifest = z.object({
  format: z.literal('bqgame/1'),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'id em minúsculas, números e hífen'),
  name: z.string().min(1),
  version: z.string().optional(),
  author: z.string().optional(),
  description: z.string().optional(),
  /**
   * Jogadores: ids "p1", "p2"…; nomes e cores opcionais, na ordem. Nomes, cores e lugares aceitam
   * uma lista só, ou uma lista por número de jogadores (`{ "1": [...], "2": [...] }`).
   */
  players: z
    .object({
      min: z.int().min(1),
      max: z.int().min(1),
      names: z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]).optional(),
      colors: z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]).optional(),
      /** Botão de passar a vez: `false` esconde (o jogo passa a vez pelas regras); texto troca o rótulo. */
      passButton: z.union([z.boolean(), z.string()]).optional(),
      /** Lugares na mesa (para `forEachPlayer`): uma lista, ou uma lista por número de jogadores. */
      seats: z.union([z.array(Seat), z.record(z.string(), z.array(Seat))]).optional(),
    })
    .refine((p) => p.min <= p.max, 'min maior que max')
    .optional(),
  /** Opções escolhidas antes de começar (Stage, dificuldade, modo). */
  options: z.array(MatchOption).optional(),
  table: z
    .object({
      background: z.string().optional(),
      /** Contornos e rótulos das zonas começam visíveis? (o jogador liga e desliga; padrão: sim) */
      guides: z.boolean().optional(),
    })
    .optional(),
  /** Base para imagens com caminho relativo que não estão dentro do pacote. */
  assets: z.object({ base: z.url().optional() }).optional(),
  kinds: z.array(KindManifest).min(1),
  /** Conjuntos de dados: lista no próprio manifest, arquivo (no pacote ou URL), ou `{ file, path?, schema? }`. */
  data: z.record(z.string(), z.union([z.string(), z.array(DataItem), DataSource])).optional(),
  /** Tabelas para `{campo|tabela}` (ex.: elemento → cor). */
  lookups: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  templates: z.record(z.string(), CardTemplate).optional(),
  /** Palavras-chave das descrições: id → título e texto (HTML limitado, pode citar outras). */
  keywords: z
    .record(z.string(), z.object({ title: z.string().optional(), text: z.string() }))
    .optional(),
  prefabs: z
    .record(
      z.string(),
      z.object({
        params: z.record(z.string(), z.json()).optional(),
        pieces: z.array(PieceTemplate),
      }),
    )
    .optional(),
  setup: z.array(SetupStep),
  hud: z.array(HudItem).optional(),
  playerHud: z.array(PlayerHudItem).optional(),
  /**
   * Regras automáticas: script do pacote (ou URL) que recebe `game` (docs/engine/FormatoBqgame.md),
   * ou uma lista deles, rodados em ordem com o mesmo `game`.
   */
  rules: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
});
export type GameManifest = z.infer<typeof GameManifest>;

export const DataSet = z.array(DataItem);
export type DataItem = z.infer<typeof DataItem>;
