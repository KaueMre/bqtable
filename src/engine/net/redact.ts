import {
  viewFor,
  type AttrValue,
  type Command,
  type GameState,
  type KindRegistry,
  type GameEvent,
  type LogEntry,
  type Manager,
  type PendingChoice,
  type Piece,
  type PieceId,
  type Result,
  err,
  ok,
} from '@/engine/core';

/** O estado de um jogador, mais a tabela para traduzir de volta os comandos dele. */
interface Masked {
  state: GameState;
  /** Apelido → id real, das peças que ele vê viradas. */
  real: ReadonlyMap<string, PieceId>;
  /** Id real → apelido. */
  alias: ReadonlyMap<PieceId, string>;
  /** Ids reais que ele não pode saber (escondidas e viradas). */
  secret: (id: string) => boolean;
}

type Cache = Map<KindRegistry | null, Map<string | null, Masked>>;
const masks = new WeakMap<GameState, Cache>();

/**
 * O estado que o host manda para `viewer` (`null` = espectador): só o que ele pode ver.
 *
 * - Peças conforme `viewFor`: as escondidas somem; as viradas ficam sem face, atributos e tags e
 *   ganham um **apelido** no lugar do id, que diz só onde a peça está (`baralho~12` = 13ª da
 *   pilha). O id real costuma dizer o que a carta é (`rascunho-2`), e o apelido muda quando a
 *   ordem muda, então um embaralhar não deixa seguir a carta. `commandFrom` traduz de volta.
 * - Log sem `message` para outro jogador, sem `rngAdvanced` e sem eventos que citem peças que
 *   ele não vê (inclusive a ordem de um embaralhar). Fica o que a mesa mostra agora; o histórico
 *   de uma carta já revelada continua no log.
 * - `rng` zerado (ele adiantaria os próximos embaralhamentos).
 * - `pending` sem `resume` e sem `context` (só o host resolve); se a escolha é de outro jogador,
 *   também sem `options` e `labels`.
 *
 * Mesmo estado e jogador → mesmo objeto (memo).
 */
export function redactFor(
  state: GameState,
  viewer: string | null,
  kinds?: KindRegistry,
): GameState {
  return maskFor(state, viewer, kinds).state;
}

/** Recusa de um comando que cita o id real de uma peça que o assento não vê. */
export const UNKNOWN_PIECE = 'peça desconhecida';

/**
 * O comando que chegou do assento `seat`, pronto para o Gestor do host: apelidos de peças viradas
 * voltam a ser ids reais, e o `actor` é o assento, inclusive dentro de um `batch` (o `actor` que
 * veio do convidado nunca vale). Recusa o comando que cita o id real de uma peça que ele não vê:
 * os ids dá para adivinhar pelos dados do jogo, e pegar a carta certa do baralho seria trapaça.
 */
export function commandFrom(
  state: GameState,
  seat: string,
  kinds: KindRegistry | undefined,
  cmd: Command,
): Result<Command> {
  const { real, secret } = maskFor(state, seat, kinds);
  if (mentions(cmd, secret)) return err(UNKNOWN_PIECE);
  return ok(withActor(mapStrings(cmd, (s) => real.get(s) ?? s) as Command, seat));
}

/**
 * Aplica no Gestor do host o comando que veio do assento `seat` (ver `commandFrom`). Na recusa, os
 * ids reais das peças viradas para ele voltam a ser apelidos (o motivo vai para o convidado).
 */
export function applyFrom(manager: Manager, seat: string, cmd: Command): Result<GameEvent[]> {
  const state = manager.getState();
  const c = commandFrom(state, seat, manager.kinds, cmd);
  if (!c.ok) return c;
  const r = manager.dispatch(c.value);
  return r.ok ? r : err(maskText(r.error, maskFor(state, seat, manager.kinds).alias));
}

/**
 * Troca no texto cada id real pelo apelido: só o id inteiro (sem letra, número, `_` ou `-` colado
 * dos lados), e o mais comprido primeiro.
 */
function maskText(text: string, alias: ReadonlyMap<PieceId, string>): string {
  const ids = [...alias.keys()].filter((id) => text.includes(id));
  if (ids.length === 0) return text;
  ids.sort((a, b) => b.length - a.length);
  const escaped = ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const any = new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${escaped.join('|')})(?![\\p{L}\\p{N}_-])`, 'gu');
  return text.replace(any, (id) => alias.get(id)!);
}

/** O estado de cada assento, para o host publicar. */
export function statesFor(manager: Manager, seats: readonly string[]): Record<string, GameState> {
  const state = manager.getState();
  return Object.fromEntries(seats.map((seat) => [seat, redactFor(state, seat, manager.kinds)]));
}

function withActor(cmd: Command, actor: string): Command {
  const out: Command = { ...cmd, actor };
  if (cmd.type === 'batch' && Array.isArray(cmd.commands)) {
    out.commands = (cmd.commands as Command[]).map((c) => withActor(c, actor));
  }
  return out;
}

function maskFor(state: GameState, viewer: string | null, kinds?: KindRegistry): Masked {
  let byKinds = masks.get(state);
  let byViewer = byKinds?.get(kinds ?? null);
  const cached = byViewer?.get(viewer);
  if (cached) return cached;

  const view = viewFor(state, viewer, kinds);
  const alias = aliases(state, view.faceDown);
  const real = new Map([...alias].map(([id, a]) => [a, id]));
  const secret = (s: string) => view.hidden.has(s) || view.faceDown.has(s);
  const rename = (id: PieceId | null) => (id === null ? null : (alias.get(id) ?? id));

  // As visíveis na ordem original; as viradas depois, na ordem da mesa (a ordem de criação diria
  // qual carta é qual).
  const pieces: Record<PieceId, Piece> = {};
  for (const p of Object.values(state.pieces)) {
    if (secret(p.id)) continue;
    const seen = view.pieces[p.id]!;
    const parent = p.parentId !== null && alias.has(p.parentId);
    pieces[p.id] = parent ? { ...seen, parentId: rename(p.parentId) } : seen;
  }
  for (const [id, a] of alias) {
    pieces[a] = { ...view.pieces[id]!, id: a, parentId: rename(state.pieces[id]!.parentId) };
  }

  const log: LogEntry[] = [];
  for (const entry of state.log) {
    const ev = entry.event;
    if (ev.type === 'rngAdvanced') continue;
    if (ev.type === 'message' && ev.to !== undefined && ev.to !== viewer) continue;
    const event =
      ev.type === 'choiceRequested'
        ? { ...ev, choice: redactChoice(ev.choice as PendingChoice, viewer, alias) }
        : ev;
    if (mentions(event, secret)) continue;
    log.push(event === ev ? entry : { ...entry, event });
  }

  const masked: Masked = {
    state: {
      ...state,
      pieces,
      log,
      pending: state.pending && redactChoice(state.pending, viewer, alias),
      rng: 0,
    },
    real,
    alias,
    secret,
  };
  if (!byKinds) masks.set(state, (byKinds = new Map()));
  if (!byViewer) byKinds.set(kinds ?? null, (byViewer = new Map()));
  byViewer.set(viewer, masked);
  return masked;
}

/**
 * Apelido de cada peça virada: o lugar dela (pai + posição na ordem da mesa). Peça virada dentro
 * de outra virada usa o apelido do pai. Não colide com ids reais.
 */
function aliases(state: GameState, faceDown: ReadonlySet<PieceId>): Map<PieceId, string> {
  const { pieces } = state;
  // posição de cada peça entre os filhos do pai, como em `childrenOf` (z, depois criação)
  const groups = new Map<PieceId | null, { p: Piece; i: number }[]>();
  Object.values(pieces).forEach((p, i) => {
    const list = groups.get(p.parentId) ?? [];
    groups.set(p.parentId, list);
    list.push({ p, i });
  });
  const index = new Map<PieceId, number>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.p.transform.z - b.p.transform.z || a.i - b.i);
    list.forEach(({ p }, i) => index.set(p.id, i));
  }

  const out = new Map<PieceId, string>();
  const used = new Set<string>();
  const aliasOf = (id: PieceId): string => {
    const known = out.get(id);
    if (known !== undefined) return known;
    const { parentId } = pieces[id]!;
    const where = parentId === null ? '' : faceDown.has(parentId) ? aliasOf(parentId) : parentId;
    let a = `${where}~${index.get(id)}`;
    while (pieces[a] || used.has(a)) a += '~';
    used.add(a);
    out.set(id, a);
    return a;
  };
  // em ordem de pai e posição, para a ordem das peças no estado não dizer nada
  for (const list of groups.values()) {
    for (const { p } of list) if (faceDown.has(p.id)) aliasOf(p.id);
  }
  return out;
}

function redactChoice(
  choice: PendingChoice,
  viewer: string | null,
  alias: ReadonlyMap<PieceId, string>,
): PendingChoice {
  const out: PendingChoice = { ...choice, resume: [] };
  delete out.context;
  if (choice.player !== undefined && choice.player !== viewer) {
    delete out.options;
    delete out.labels;
  } else if (choice.options) {
    out.options = choice.options.map((o) => mapStrings(o, (s) => alias.get(s) ?? s) as AttrValue);
  }
  return out;
}

/** Algum texto dentro do valor (em qualquer nível, chaves inclusive) passa no teste? */
function mentions(value: unknown, test: (s: string) => boolean): boolean {
  if (typeof value === 'string') return test(value);
  if (Array.isArray(value)) return value.some((v) => mentions(v, test));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => test(k) || mentions(v, test));
  }
  return false;
}

/** Cópia do valor JSON com cada texto (e chave, como os ids de `dropMany.at`) trocado por `fn`. */
function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapStrings(v, fn)]));
  }
  return value;
}
