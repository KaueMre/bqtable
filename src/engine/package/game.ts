import { freeze } from 'immer';
import { z } from 'zod';
import {
  childrenOf,
  createManager,
  expandSlotPattern,
  freeSlots,
  nextRandom,
  shuffle,
  spawn,
  type Command,
  type GameState,
  type KindDef,
  type Manager,
  type Piece,
  type PieceInit,
  type ZoneSpec,
} from '@/engine/core';
import {
  DataFormatError,
  fetchJson,
  fetchOk,
  loadImage,
  parseOrThrow,
  preloadImages,
  registerImageGenerator,
  registerUrlResolver,
} from '@/engine/data';
import { defaultGestures, type GestureHandler, type PieceDecoration } from '@/engine/render';
import { drawTemplate } from './cardTemplate';
import {
  compileRules,
  helpers,
  type GameAction,
  type GameApi,
  type GestureHook,
  type SetupContext as RulesSetupContext,
} from './rules';
import { interpolate, type Scope } from './interpolate';
import {
  choiceValue,
  DataSet,
  PieceManifest,
  type DataItem,
  type GameManifest,
  type HudItem,
  type KindManifest,
  type MatchOption,
  type PlayerHudItem,
  type SetupStep,
  type When,
} from './manifest';
import { createAssetResolver, normalizePath, readPackage, type PackageSource } from './read';
import { expandKeywordLinks, keywordRefs, type Keyword } from './richText';

/** Erro no conteúdo do jogo (setup, dados, modelos): o autor precisa corrigir o pacote. */
export class GameDefinitionError extends DataFormatError {
  name = 'GameDefinitionError';
}

export interface Match {
  manager: Manager;
  /** Gestos → comandos, com os ajustes do regras.js. */
  gestures: GestureHandler;
  /** Botões de ação declarados pelo regras.js (`game.action`). */
  actions: readonly GameAction[];
}

export interface MatchSettings {
  players: number;
  seed?: number;
  /** Opções da partida (`manifest.options`): id → valor. O que faltar usa o padrão. */
  options?: Record<string, string>;
}

export interface LoadedGame {
  manifest: GameManifest;
  data: Record<string, DataItem[]>;
  players: { min: number; max: number };
  /** Opções escolhidas antes de começar (Stage, dificuldade...). */
  options: MatchOption[];
  hud: HudItem[];
  playerHud: PlayerHudItem[];
  /** Nova partida: kinds, setup do manifest, depois as regras (e o setup delas). */
  createMatch(settings: MatchSettings): Match;
  /** Atalho: só o Gestor da nova partida. */
  createManager(settings: MatchSettings): Manager;
  canDrag(piece: Piece): boolean;
  /**
   * A face para o preview ampliado: modelos de carta redesenhados com `scale` pixels por unidade
   * (texto nítido); imagens comuns ficam como estão.
   */
  previewFace(face: string, scale: number): string;
  /** Palavras-chave do jogo (com os atalhos `[[id]]` já expandidos no texto). */
  keywords: Record<string, Keyword>;
  /**
   * Descrição da peça (a do kind, com os `{campos}` do item de dados e dos atributos dela), com os
   * atalhos de palavra-chave expandidos. `undefined` se o kind não tem descrição.
   */
  describe(piece: Piece): string | undefined;
  /** Selos e áreas clicáveis do kind (`badges`, `hotspots`). Mesma peça → mesmo objeto. */
  decorate(piece: Piece): PieceDecoration | undefined;
  /** Item de dados ligado à peça (kind com `data` e `attributes.def`). */
  dataOf(piece: Piece): DataItem | undefined;
  /** Endereço real de uma imagem do pacote (para pré-carregar). */
  resolveAsset(ref: string): string;
  /** Libera os arquivos do pacote da memória. */
  dispose(): void;
}

/** Lê, valida e prepara um jogo: dados carregados, imagens pré-carregadas, pronto para jogar. */
export async function loadGame(source: PackageSource): Promise<LoadedGame> {
  const pkg = await readPackage(source);
  const { manifest } = pkg;
  const assets = createAssetResolver(pkg);
  // dados congelados: o regras.js lê, mas não muda (uma partida não afeta a outra)
  const data = freeze(await loadData(manifest, pkg.files, assets.resolve), true);
  const rules =
    manifest.rules === undefined
      ? null
      : await Promise.all(
          [manifest.rules].flat().map((ref) => loadRules(ref, pkg.files, assets.resolve)),
        );
  const lookups = manifest.lookups;
  const kinds = new Map(manifest.kinds.map((k) => [k.kind, k]));
  const toKind = (k: KindManifest) => kindDef(k);
  for (const k of manifest.kinds) toKind(k); // valida os JSON Schemas já no carregamento
  checkWhen(manifest);

  // Imagens: "asset:caminho" → arquivo do pacote ou URL; "template:modelo/id" → desenhada.
  registerUrlResolver('asset', assets.resolve);
  const templateImages = await preloadTemplateImages(manifest, data, assets.resolve);
  // "modelo/id", ou "modelo/id@4" para desenhar com outra resolução (o preview pede mais)
  registerImageGenerator('template', (ref) => {
    const at = ref.lastIndexOf('@');
    const path = at > 0 ? ref.slice(0, at) : ref;
    const scale = at > 0 ? Number(ref.slice(at + 1)) : undefined;
    const [name = '', id] = path.split('/');
    const template = manifest.templates?.[name];
    if (!template) return null;
    const item =
      template.data && id !== undefined
        ? data[template.data]?.find((i) => String(i.id) === id)
        : undefined;
    if (template.data && !item) return null;
    return drawTemplate(
      template,
      { ...item, item },
      {
        lookups,
        image: (src) => templateImages.get(src),
        ...(scale && scale > 0 && { scale: Math.min(scale, 8) }),
      },
    );
  });

  const players = manifest.players ?? { min: 1, max: 1 };
  const decorations = new WeakMap<Piece, PieceDecoration | null>();
  const keywords = loadKeywords(manifest);

  /** Arrastar → dropInto; duplo clique → próximo status do `activate.cycleStatus` do kind. */
  const baseGestures: GestureHandler = (gesture, piece, state) => {
    if (gesture.type !== 'activate') return defaultGestures(gesture, piece, state);
    const cycle = kinds.get(piece.kind)?.activate?.cycleStatus;
    if (!cycle) return null;
    const next = cycle[(cycle.indexOf(piece.status) + 1) % cycle.length]!;
    return { type: 'setStatus', id: piece.id, status: next };
  };

  const game: LoadedGame = {
    manifest,
    data,
    players,
    options: manifest.options ?? [],
    hud: manifest.hud ?? [],
    playerHud: manifest.playerHud ?? [],
    resolveAsset: assets.resolve,
    dispose: assets.dispose,

    createMatch({ players: count, seed: given, options: chosen }) {
      const options = resolveOptions(manifest.options ?? [], chosen);
      const seed = given ?? Math.floor(Math.random() * 2 ** 32);
      // nomes e cores: uma lista só, ou uma lista por número de jogadores (como os lugares)
      const names = forCount(manifest.players?.names, count);
      const colors = forCount(manifest.players?.colors, count);
      const m = createManager({
        seed,
        players: Array.from({ length: count }, (_, i) => ({
          id: `p${i + 1}`,
          name: names?.[i] ?? `Jogador ${i + 1}`,
          ...(colors?.[i] && { color: colors[i] }),
        })),
      });
      for (const k of manifest.kinds) m.registerKind(toKind(k));
      runSetup(m, manifest, data, { players: count, options, random: setupRandom(seed) });
      const hooks: GestureHook[] = [];
      const actions: GameAction[] = [];
      if (rules)
        applyRules(rules, m, { hooks, actions }, { manifest, data, players: count, options });
      m.clearHistory();
      return { manager: m, gestures: withHooks(hooks, baseGestures), actions };
    },

    createManager: (options) => game.createMatch(options).manager,

    canDrag: (piece) =>
      kinds.get(piece.kind)?.draggable !== false && !piece.tags.includes('locked'),

    keywords,

    describe(piece) {
      const template = kinds.get(piece.kind)?.description;
      if (template === undefined) return undefined;
      const item = game.dataOf(piece);
      const scope = { ...item, item, ...piece.attributes, id: piece.id, status: piece.status };
      const filled = interpolate(template, scope, { lookups });
      const text = filled === undefined || filled === null ? '' : String(filled);
      return text.trim() ? expandKeywordLinks(text, keywords) : undefined;
    },

    previewFace: (face, scale) =>
      face.startsWith('template:') ? `${face}@${Math.min(8, Math.max(1, Math.ceil(scale)))}` : face,

    decorate(piece) {
      if (decorations.has(piece)) return decorations.get(piece) ?? undefined;
      const k = kinds.get(piece.kind);
      let out: PieceDecoration | null = null;
      if (k?.badges || k?.hotspots) {
        // a peça como o jogador a vê: virada, sem atributos, sem selo
        const scope = { ...piece.attributes, status: piece.status };
        const badges = (k.badges ?? [])
          .map((b) => ({ ...b, text: String(interpolate(b.text, scope) ?? '') }))
          .filter((b) => b.text !== '');
        out = { badges, ...(k.hotspots && { hotspots: k.hotspots }) };
      }
      decorations.set(piece, out);
      return out ?? undefined;
    },

    dataOf(piece) {
      const set = kinds.get(piece.kind)?.data;
      const def = piece.attributes.def;
      return set === undefined || def === undefined
        ? undefined
        : data[set]?.find((i) => String(i.id) === String(def));
    },
  };
  return game;
}

async function loadRules(
  ref: string,
  files: Map<string, Uint8Array>,
  resolve: (ref: string) => string,
) {
  // repositório aberto como pasta (o manifest aponta para o fonte .ts): o navegador não compila
  if (/\.[cm]?tsx?$/.test(ref)) {
    throw new GameDefinitionError(
      `${ref}: regras em TypeScript precisam ser compiladas. Gere o .bqgame com o bqgame-pack ` +
        '(scripts/pack-game.mjs: compila e aponta o manifest para o .js), ou publique o .js ' +
        'compilado e aponte "rules" para ele.',
    );
  }
  const file = files.get(normalizePath(ref));
  let code: string;
  if (file) code = new TextDecoder().decode(file);
  else {
    code = await (await fetchOk(resolve(ref), ref)).text();
  }
  try {
    return { run: compileRules(code, ref), source: ref };
  } catch (e) {
    throw new GameDefinitionError((e as Error).message);
  }
}

/** Roda o regras.js para esta partida: registra regras, comandos, gestos e o setup extra. */
function applyRules(
  rules: { run: (game: GameApi) => void; source: string }[],
  m: Manager,
  out: { hooks: GestureHook[]; actions: GameAction[] },
  ctx: {
    manifest: GameManifest;
    data: Record<string, DataItem[]>;
    players: number;
    options: Record<string, string>;
  },
) {
  const setups: { fn: (c: RulesSetupContext) => void; source: string }[] = [];
  let source = rules[0]?.source ?? '';
  const api: GameApi = {
    players: ctx.players,
    options: ctx.options,
    playerList: m
      .getState()
      .playerOrder.map((id) => m.getState().players[id]!)
      .map(({ id, name, color }) => ({ id, name, color })),
    data: ctx.data,
    lookups: ctx.manifest.lookups ?? {},
    helpers,
    rule: (rule) => m.registerRule(rule),
    command: (def) => m.registerCommand(def),
    gesture: (hook) => void out.hooks.push(hook),
    action(def) {
      if (!def || typeof def.id !== 'string' || typeof def.label !== 'string') {
        throw new Error('game.action precisa de id e label');
      }
      if (typeof def.command !== 'function') throw new Error(`ação "${def.id}" sem command`);
      if (out.actions.some((a) => a.id === def.id)) throw new Error(`ação "${def.id}" repetida`);
      out.actions.push(def);
    },
    setup: (fn) => void setups.push({ fn, source }),
    shared: {},
    prefab: (name, params) =>
      prefabPieces(ctx.manifest, name, { players: ctx.players, options: ctx.options, ...params }),
  };
  const fail = (source: string, e: unknown) =>
    new GameDefinitionError(`${source}: ${e instanceof Error ? e.message : String(e)}`);
  // os arquivos rodam em ordem, com o mesmo `game` (e o mesmo `game.shared`)
  for (const file of rules) {
    source = file.source;
    try {
      file.run(api);
    } catch (e) {
      throw fail(file.source, e);
    }
  }
  const setupCtx = {
    state: () => m.getState(),
    dispatch(cmd: Command) {
      const r = m.dispatch(cmd);
      if (!r.ok) throw new GameDefinitionError(r.error);
    },
  };
  for (const { fn, source } of setups) {
    try {
      fn(setupCtx);
    } catch (e) {
      throw fail(source, e);
    }
  }
}

/** Gestos do regras.js primeiro (em ordem); `undefined` passa para o próximo, e por fim o padrão. */
function withHooks(hooks: GestureHook[], base: GestureHandler): GestureHandler {
  if (hooks.length === 0) return base;
  return (gesture, piece, state) => {
    for (const hook of hooks) {
      try {
        const cmd = hook(gesture, piece, state);
        if (cmd !== undefined) return cmd;
      } catch (e) {
        console.error('gesto do regras.js falhou:', e); // o gesto é ignorado
        return null;
      }
    }
    return base(gesture, piece, state);
  };
}

async function loadData(
  manifest: GameManifest,
  files: Map<string, Uint8Array>,
  resolve: (ref: string) => string,
): Promise<Record<string, DataItem[]>> {
  const out: Record<string, DataItem[]> = {};
  for (const [name, source] of Object.entries(manifest.data ?? {})) {
    if (Array.isArray(source)) {
      out[name] = source;
      continue;
    }
    const spec = typeof source === 'string' ? { file: source } : source;
    const file = files.get(normalizePath(spec.file));
    let json: unknown = file
      ? JSON.parse(new TextDecoder().decode(file))
      : await fetchJson(resolve(spec.file));
    const where = `dados "${name}" (${spec.file}${spec.path ? ` → ${spec.path}` : ''})`;
    // uma lista dentro do arquivo (ex.: "bases" num JSON com várias listas)
    if (spec.path) {
      for (const key of spec.path.split('.')) {
        json =
          json !== null && typeof json === 'object'
            ? (json as Record<string, unknown>)[key]
            : undefined;
      }
      if (json === undefined) {
        throw new GameDefinitionError(`${where}: "${spec.path}" não existe no arquivo`);
      }
    }
    const items = parseOrThrow(DataSet, json, where);
    if ('schema' in spec && spec.schema) checkItems(name, items, spec.schema, where);
    out[name] = items;
  }
  return out;
}

/** Valida cada item com o JSON Schema do conjunto; o erro aponta o item e o campo (`cartas[37].cor`). */
function checkItems(name: string, items: DataItem[], schema: object, where: string) {
  let item: z.ZodType;
  try {
    item = z.fromJSONSchema(schema as never);
  } catch (e) {
    throw new GameDefinitionError(
      `${where}: schema não é um JSON Schema válido: ${(e as Error).message}`,
    );
  }
  const r = z.array(item).safeParse(items);
  if (r.success) return;
  const path = (p: readonly PropertyKey[]) =>
    p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${String(k)}`)).join('');
  const issues = r.error.issues;
  const lines = issues.slice(0, 10).map((i) => `${name}${path(i.path)}: ${i.message}`);
  if (issues.length > 10) lines.push(`… e mais ${issues.length - 10}`);
  throw new GameDefinitionError(`${where} não bate com o schema:\n${lines.join('\n')}`);
}

/** JSON Schema dos atributos → validador do motor. */
function kindDef(k: KindManifest): KindDef {
  const def: KindDef = { kind: k.kind };
  if (k.statuses) def.statuses = k.statuses;
  if (k.initialStatus) def.initialStatus = k.initialStatus;
  if (k.transitions) def.transitions = k.transitions;
  if (k.reveals) def.reveals = k.reveals;
  if (k.hiddenStatuses) def.hiddenStatuses = k.hiddenStatuses;
  if (k.defaults) {
    def.defaults = {
      ...k.defaults,
      ...(k.defaults.faces && { faces: assetFaces(k.defaults.faces) }),
    };
  }
  if (k.attributes) {
    try {
      def.attributes = z.fromJSONSchema(k.attributes as never) as KindDef['attributes'];
    } catch (e) {
      throw new GameDefinitionError(
        `kind "${k.kind}": attributes não é um JSON Schema válido: ${(e as Error).message}`,
      );
    }
  }
  return def;
}

/** Faces com caminho relativo viram "asset:caminho" (estável; traduzido ao carregar a imagem). */
function assetFaces(faces: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(faces).map(([status, face]) => [
      status,
      /^(template:|asset:|https?:|data:|blob:)/.test(face) || !/\.[a-z0-9]+$/i.test(face)
        ? face // modelo, URL, ou texto de placeholder
        : `asset:${normalizePath(face)}`,
    ]),
  );
}

/** Carrega as imagens usadas dentro dos modelos de carta (o desenho é síncrono). */
async function preloadTemplateImages(
  manifest: GameManifest,
  data: Record<string, DataItem[]>,
  resolve: (ref: string) => string,
) {
  const urls = new Map<string, string>(); // src preenchido → URL real
  for (const t of Object.values(manifest.templates ?? {})) {
    const items: Scope[] = t.data ? (data[t.data] ?? []) : [{}];
    for (const el of t.elements) {
      if (el.type !== 'image') continue;
      for (const item of items) {
        const src = String(interpolate(el.src, { ...item, item }, { lookups: manifest.lookups }));
        if (src) urls.set(src, resolve(src));
      }
    }
  }
  await preloadImages(urls.values());
  const images = new Map<string, HTMLImageElement | HTMLCanvasElement>();
  for (const [src, url] of urls) {
    const image = loadImage(url).image;
    if (image && loadImage(url).getStatus() === 'loaded') images.set(src, image);
  }
  return images;
}

interface SetupContext {
  /** Número de jogadores escolhido. */
  players: number;
  options: Record<string, string>;
  /** Sorteios do setup (`pick`), com a semente da partida. */
  random: () => number;
}

/**
 * Roda o setup: cada passo cria peças (numa jogada só), despacha um comando ou distribui peças.
 * `when` pula o passo; `forEachPlayer` repete o passo para cada jogador, com o lugar dele.
 */
function runSetup(
  m: Manager,
  manifest: GameManifest,
  data: Record<string, DataItem[]>,
  ctx: SetupContext,
) {
  manifest.setup.forEach((step, i) => {
    if (!whenMatches(step.when, ctx)) return;
    const base: Scope = { players: ctx.players, options: ctx.options };
    let scopes = [base];
    if (step.forEachPlayer) {
      try {
        scopes = playerScopes(m.getState(), manifest, base);
      } catch (e) {
        throw new GameDefinitionError(`setup[${i}]: ${(e as Error).message}`);
      }
    }
    for (const scope of scopes) {
      try {
        runStep(m, manifest, data, step, scope, ctx.random);
      } catch (e) {
        const who = step.forEachPlayer ? ` (${String(scope.player)})` : '';
        throw new GameDefinitionError(`setup[${i}]${who}: ${(e as Error).message}`);
      }
    }
  });
}

function runStep(
  m: Manager,
  manifest: GameManifest,
  data: Record<string, DataItem[]>,
  step: SetupStep,
  scope: Scope,
  random: () => number,
) {
  const o = { lookups: manifest.lookups, strict: true };
  if ('pieces' in step) {
    dispatchOrThrow(m, spawn(step.pieces.map((p) => interpolate(p, scope, o)).map(toPiece)));
  } else if ('prefab' in step) {
    const params = interpolate(step.with ?? {}, scope, o);
    dispatchOrThrow(m, spawn(prefabPieces(manifest, step.prefab, { ...scope, ...params })));
  } else if ('forEach' in step) {
    const items = data[step.forEach];
    if (!items) throw new GameDefinitionError(`conjunto de dados desconhecido: "${step.forEach}"`);
    const where = interpolate(step.where ?? {}, scope, o);
    let chosen = items.filter((item) =>
      Object.entries(where).every(([k, v]) => matchesValue(item[k], v)),
    );
    if (step.pick !== undefined) {
      const n = toCount(interpolate(step.pick, scope, o), 'pick');
      if (n > chosen.length) {
        throw new GameDefinitionError(`pick: ${n} itens pedidos, mas só há ${chosen.length}`);
      }
      chosen = shuffle(chosen, random).slice(0, n);
    }
    const pieces: PieceInit[] = [];
    chosen.forEach((item, index) => {
      const itemScope = { ...item, item, index, ...scope };
      const copies = Number(interpolate(step.copies ?? 1, itemScope, o));
      if (!Number.isInteger(copies) || copies < 0) {
        throw new GameDefinitionError(`copies inválido para o item "${item.id}": ${copies}`);
      }
      for (let n = 1; n <= copies; n++) {
        pieces.push(toPiece(interpolate(step.piece, { ...itemScope, n }, o)));
      }
    });
    dispatchOrThrow(m, spawn(pieces));
  } else if ('command' in step) {
    dispatchOrThrow(m, interpolate(step.command, scope, o) as Command);
  } else {
    dispatchOrThrow(m, dealCommand(m.getState(), interpolate(step.deal, scope, o)));
  }
}

/** As `count` peças do topo de `from` (a última é o topo) vão para `to`, uma a uma. */
function dealCommand(
  state: GameState,
  deal: { from: string; to: string; count: number | string; status?: string },
): Command {
  const n = toCount(deal.count, 'deal.count');
  if (!state.pieces[deal.from]?.zone) {
    throw new GameDefinitionError(`deal: "${deal.from}" não é uma zona`);
  }
  const top = childrenOf(state.pieces, deal.from).slice(-n).reverse();
  if (top.length < n) {
    throw new GameDefinitionError(`deal: "${deal.from}" tem ${top.length} peças, pedidas ${n}`);
  }
  // em grade e encaixes, cada peça vai para o próximo lugar livre
  const layout = state.pieces[deal.to]?.zone?.layout;
  const slotted = layout === 'grid' || layout === 'slots';
  const slots = slotted ? freeSlots(state.pieces, deal.to) : [];
  if (slotted && slots.length < n) {
    throw new GameDefinitionError(`deal: "${deal.to}" tem ${slots.length} lugares livres`);
  }
  return {
    type: 'batch',
    commands: top.flatMap((p, i): Command[] => [
      { type: 'dropInto', id: p.id, zone: deal.to, ...(slotted && { slot: slots[i] }) },
      ...(deal.status ? [{ type: 'setStatus', id: p.id, status: deal.status } as Command] : []),
    ]),
  };
}

/**
 * Palavras-chave do manifest, com o título padrão (o id) e os atalhos expandidos. Uma palavra que
 * cita outra que não existe é erro do pacote.
 */
function loadKeywords(manifest: GameManifest): Record<string, Keyword> {
  const raw = manifest.keywords ?? {};
  const out: Record<string, Keyword> = {};
  for (const [id, k] of Object.entries(raw)) {
    for (const ref of keywordRefs(k.text)) {
      if (!raw[ref]) {
        throw new GameDefinitionError(`keywords.${id}: palavra-chave desconhecida "${ref}"`);
      }
    }
    out[id] = { title: k.title ?? id, text: '' };
  }
  for (const [id, k] of Object.entries(raw)) out[id]!.text = expandKeywordLinks(k.text, out);
  // nas descrições, só os ids escritos direto (sem {campos}) dá para conferir ao abrir
  for (const k of manifest.kinds) {
    for (const ref of keywordRefs(k.description ?? '')) {
      if (!ref.includes('{') && !raw[ref]) {
        throw new GameDefinitionError(`kind "${k.kind}": palavra-chave desconhecida "${ref}"`);
      }
    }
  }
  return out;
}

/** Uma lista só, ou a lista do número de jogadores (`{ "2": [...], "3": [...] }`). */
function forCount<T>(value: T[] | Record<string, T[]> | undefined, count: number): T[] | undefined {
  return Array.isArray(value) ? value : value?.[String(count)];
}

/** Escopo de cada jogador (na ordem de jogo, incluindo os criados por `addPlayer`). */
function playerScopes(state: GameState, manifest: GameManifest, base: Scope): Scope[] {
  const ids = state.playerOrder;
  const all = manifest.players?.seats;
  const seats = forCount(all, ids.length);
  return ids.map((id, i) => {
    const p = state.players[id]!;
    const seat = seats?.[i];
    if (all && !seat) {
      throw new GameDefinitionError(
        `players.seats não tem lugar para o jogador ${i + 1} com ${ids.length} jogadores`,
      );
    }
    return {
      ...base,
      player: id,
      playerName: p.name,
      playerColor: p.color,
      playerIndex: i,
      ...(seat && { seat }),
    };
  });
}

function whenMatches(when: When | undefined, ctx: SetupContext): boolean {
  if (!when) return true;
  const p = when.players;
  const n = ctx.players;
  if (typeof p === 'number' && p !== n) return false;
  if (Array.isArray(p) && !p.includes(n)) return false;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return false;
  }
  return Object.entries(when.options ?? {}).every(([id, v]) => {
    const value = ctx.options[id]!;
    return Array.isArray(v) ? v.includes(value) : v === value;
  });
}

/** `where`: lista = qualquer um dos valores; número e texto do mesmo valor são iguais (1 = "1"). */
function matchesValue(value: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted) && !Array.isArray(value)) {
    return wanted.some((w) => matchesValue(value, w));
  }
  if (value === wanted) return true;
  const plain = (v: unknown) => typeof v === 'string' || typeof v === 'number';
  return plain(value) && plain(wanted) && String(value) === String(wanted);
}

function toCount(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new GameDefinitionError(`${what} inválido: ${String(value)}`);
  return n;
}

/** Sorteios do setup: sequência própria, derivada da semente da partida. */
function setupRandom(seed: number): () => number {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
}

/** Valores das opções: os escolhidos, validados, e os padrões para o resto. */
function resolveOptions(
  defs: readonly MatchOption[],
  chosen: Record<string, string> = {},
): Record<string, string> {
  for (const id of Object.keys(chosen)) {
    if (!defs.some((d) => d.id === id))
      throw new GameDefinitionError(`opção desconhecida: "${id}"`);
  }
  return Object.fromEntries(
    defs.map((d) => {
      const values = d.choices.map(choiceValue);
      const value = chosen[d.id] ?? d.default ?? values[0]!;
      if (!values.includes(value)) {
        throw new GameDefinitionError(`opção "${d.id}": "${value}" não é uma das escolhas`);
      }
      return [d.id, value];
    }),
  );
}

/** `when.options` só pode citar opções e valores que existem (erro de digitação aparece ao abrir). */
function checkWhen(manifest: GameManifest) {
  const defs = new Map((manifest.options ?? []).map((d) => [d.id, d.choices.map(choiceValue)]));
  manifest.setup.forEach((step, i) => {
    for (const [id, v] of Object.entries(step.when?.options ?? {})) {
      const values = defs.get(id);
      if (!values) throw new GameDefinitionError(`setup[${i}].when: opção desconhecida "${id}"`);
      for (const value of Array.isArray(v) ? v : [v]) {
        if (!values.includes(value)) {
          throw new GameDefinitionError(
            `setup[${i}].when: "${value}" não é uma escolha da opção "${id}"`,
          );
        }
      }
    }
  });
}

/** Peças de um prefab, com os parâmetros (padrões do prefab + os dados). */
function prefabPieces(manifest: GameManifest, name: string, params: Scope): PieceInit[] {
  const prefab = manifest.prefabs?.[name];
  if (!prefab) throw new GameDefinitionError(`prefab desconhecido: "${name}"`);
  const scope = { ...prefab.params, ...params };
  const o = { lookups: manifest.lookups, strict: true };
  return prefab.pieces.map((p) => interpolate(p, scope, o)).map(toPiece);
}

function dispatchOrThrow(m: Manager, cmd: Command) {
  const r = m.dispatch(cmd);
  if (!r.ok) throw new GameDefinitionError(r.error);
}

/** Peça do manifest (já preenchida) → peça do motor; padrões de encaixe viram encaixes. */
function toPiece(raw: unknown): PieceInit {
  const p = parseOrThrow(
    PieceManifest,
    raw,
    `peça ${JSON.stringify((raw as { id?: unknown })?.id ?? '?')}`,
  );
  const piece = { ...p } as PieceInit;
  if (p.faces) piece.faces = assetFaces(p.faces);
  if (p.zone) {
    const { slots, ...rest } = p.zone;
    const zone: ZoneSpec = { ...rest };
    if (Array.isArray(slots)) zone.slots = slots;
    else if (slots) {
      const expanded = expandSlotPattern(slots);
      zone.slots = expanded.slots;
      zone.slotSize ??= slots.slot;
      piece.size ??= expanded.size;
    }
    piece.zone = zone;
  }
  return piece;
}
