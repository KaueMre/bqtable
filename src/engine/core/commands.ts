import type { BuiltinEvent, GameEvent } from './events';
import type { KindRegistry } from './kinds';
import {
  normalizeRotation,
  type AttrValue,
  type Piece,
  type PieceId,
  type PieceInit,
} from './piece';
import { err, ok, type Result } from './result';
import { shuffle } from './rng';
import { gameEndOf, PLAYER_COLORS, type GameEnd, type GameState, type PlayerState } from './state';
import {
  childrenOf,
  dropError,
  placementOf,
  planPlacement,
  samePlacement,
  touchError,
  validateZoneSpec,
  zoneSlots,
  type DropTarget,
  type ZoneSpec,
} from './zones';

/**
 * Intenção do jogador ou de uma regra. Precisa ser JSON. `actor` é o jogador que agiu: com ele, o
 * Gestor só deixa mexer no que é do jogador (ver `permissionError`). Sem `actor` (regras,
 * setup), o jogo age sem restrição.
 */
export interface Command {
  type: string;
  actor?: string;
  [key: string]: unknown;
}

/** `value` substitui; `delta` soma ao número atual (ausente conta como 0). */
type ValueOrDelta = { value: AttrValue; delta?: never } | { delta: number; value?: never };

export type BuiltinCommand =
  | { type: 'createPiece'; piece: PieceInit }
  | { type: 'removePiece'; id: PieceId }
  | { type: 'move'; id: PieceId; x: number; y: number; z?: number } // z ausente: mantém
  | { type: 'rotate'; id: PieceId; rotation: number }
  | { type: 'setStatus'; id: PieceId; status: string }
  | ({ type: 'dropInto'; id: PieceId } & DropTarget) // entra numa zona (ou volta à mesa)
  | {
      // várias peças numa zona (ou na mesa) de uma vez: uma jogada, um desfazer
      type: 'dropMany';
      ids: PieceId[]; // em ordem: a primeira fica embaixo (pilha) ou no encaixe `slot`
      zone: PieceId | null;
      slot?: string; // 'grid' e 'slots': encaixe da primeira; as outras, nos próximos livres
      index?: number; // 'stack', 'fan' e 'row': onde o grupo entra (padrão: no fim)
      at?: Record<PieceId, { x: number; y: number }>; // mesa e 'free': posição de cada uma
    }
  | { type: 'shuffle'; zone: PieceId } // embaralha a ordem (z) das peças da zona
  | { type: 'setActivePlayer'; player: string }
  | { type: 'addPlayer'; id: string; name?: string; color?: string } // ex.: os Golems de um jogo solo
  | { type: 'nextPlayer' } // passa a vez para o próximo da ordem
  | ({ type: 'setAttr'; id: PieceId; key: string } & ValueOrDelta)
  | ({ type: 'setGlobal'; key: string } & ValueOrDelta)
  | ({ type: 'setPlayerAttr'; player: string; key: string } & ValueOrDelta)
  | {
      type: 'ask';
      rule: string; // regra com `resolve` que trata a resposta
      prompt: string;
      player?: string;
      options?: AttrValue[];
      labels?: string[]; // texto de cada opção
      pick?: 'piece' | 'drop'; // opções são ids de peças: clicar nelas, ou arrastar uma delas
      multiple?: { min: number; max: number }; // escolher várias
      buttons?: { value: AttrValue; label: string }[]; // respostas extras ("Pular", "Terminar")
      context?: AttrValue;
    }
  | ({ type: 'endGame' } & GameEnd) // `result` (solo, cooperativo) ou `winners` (competitivo)
  | { type: 'log'; message: string; to?: string } // mensagem no log (`to`: só esse jogador vê)
  | { type: 'choose'; choiceId: string; value: AttrValue }
  | { type: 'batch'; commands: Command[] }; // vários comandos numa jogada só: tudo ou nada

export type CommandOf<T extends BuiltinCommand['type']> = Extract<BuiltinCommand, { type: T }> & {
  actor?: string;
};

export function isCommand<T extends BuiltinCommand['type']>(
  cmd: Command,
  type: T,
): cmd is Command & CommandOf<T> {
  return cmd.type === type;
}

export interface ExecuteContext {
  state: GameState;
  kinds: KindRegistry;
  /** Número em [0, 1) do gerador do estado. Usar marca a jogada como `revealsInfo`. */
  random(): number;
}

/** Transforma um comando em eventos, sem aplicar. Devolve string com o motivo da recusa. */
/**
 * Comando do jogo. Use `execute` para gerar eventos direto, ou `expand` para desdobrar em outros
 * comandos (validados e aplicados na mesma jogada, tudo ou nada). String = motivo da recusa.
 */
export interface CommandDef {
  type: string;
  execute?(cmd: Command, ctx: ExecuteContext): GameEvent[] | string;
  expand?(cmd: Command, ctx: ExecuteContext): Command[] | string;
}

/** Tratados pelo Gestor, porque mexem na fila da jogada. */
export const QUEUE_COMMANDS = ['ask', 'choose', 'batch', 'dropMany'] as const;

type HandledType = Exclude<BuiltinCommand['type'], (typeof QUEUE_COMMANDS)[number]>;

function builtin<T extends HandledType>(
  type: T,
  execute: (cmd: CommandOf<T>, ctx: ExecuteContext) => BuiltinEvent[] | string,
): CommandDef {
  return { type, execute: (cmd, ctx) => execute(cmd as CommandOf<T>, ctx) };
}

const notFound = (id: string) => `peça "${id}" não existe`;

/**
 * `dropMany` → um `dropInto` por peça, já com o lugar de cada uma, na ordem em que podem ser
 * aplicados (cada um é validado pelas regras como se fosse feito à mão). Sem regra da zona, o
 * grupo mantém o arranjo: na mesa e em 'free', cada peça vai para a sua posição em `at`.
 */
export function expandDropMany(state: GameState, cmd: CommandOf<'dropMany'>): Command[] | string {
  const { ids, zone } = cmd;
  if (!Array.isArray(ids) || ids.length === 0) return 'dropMany sem peças';
  if (new Set(ids).size !== ids.length) return 'dropMany com peça repetida';
  const missing = ids.find((id) => !state.pieces[id]);
  if (missing !== undefined) return notFound(missing);
  const spec = zone === null ? undefined : state.pieces[zone]?.zone;
  if (zone !== null && !spec) {
    return state.pieces[zone] ? `"${zone}" não é uma zona` : `zona "${zone}" não existe`;
  }
  const drop = (id: PieceId, target: Omit<DropTarget, 'zone'>): Command => ({
    type: 'dropInto',
    id,
    zone,
    ...target,
    ...(cmd.actor !== undefined && { actor: cmd.actor }),
  });

  switch (spec?.layout) {
    case 'grid':
    case 'slots':
      return slottedDrops(state, cmd, spec, drop);
    case 'stack':
    case 'fan':
    case 'row': {
      // ordem final: as que já estão lá (sem o grupo), com o grupo inteiro na posição `index`
      const group = new Set(ids);
      const working = childrenOf(state.pieces, zone).map((p) => p.id);
      const others = working.filter((id) => !group.has(id));
      const at = Math.min(Math.max(cmd.index ?? others.length, 0), others.length);
      let before: PieceId | undefined = others[at - 1];
      return ids.map((id) => {
        const i = working.indexOf(id);
        if (i >= 0) working.splice(i, 1);
        const index = before === undefined ? 0 : working.indexOf(before) + 1;
        working.splice(index, 0, id);
        before = id;
        return drop(id, { index });
      });
    }
    default:
      return ids.map((id) => drop(id, cmd.at?.[id] ?? {}));
  }
}

/** Grade e encaixes: a primeira no `slot` (ou no primeiro livre), as outras nos próximos livres. */
function slottedDrops(
  state: GameState,
  cmd: CommandOf<'dropMany'>,
  spec: ZoneSpec,
  drop: (id: PieceId, target: Omit<DropTarget, 'zone'>) => Command,
): Command[] | string {
  const zone = cmd.zone!;
  const all = zoneSlots(spec);
  const group = new Set(cmd.ids);
  const occupant = new Map<string, PieceId>();
  for (const p of childrenOf(state.pieces, zone)) if (p.slot) occupant.set(p.slot, p.id);
  const start = cmd.slot === undefined || spec.autoFill ? 0 : all.indexOf(cmd.slot);
  if (start < 0) return `encaixe "${cmd.slot}" não existe em "${zone}"`;

  // cada peça no próximo encaixe livre (as do grupo vão sair dos delas)
  const target = new Map<PieceId, string>();
  const used = new Set<string>();
  let cursor = start;
  for (const id of cmd.ids) {
    let found: string | undefined;
    for (let k = 0; k < all.length && found === undefined; k++) {
      const slot = all[(cursor + k) % all.length]!;
      const by = occupant.get(slot);
      if (!used.has(slot) && (by === undefined || group.has(by))) {
        found = slot;
        cursor = (cursor + k + 1) % all.length;
      }
    }
    if (found === undefined) return `zona "${zone}" não tem lugar para ${cmd.ids.length} peças`;
    target.set(id, found);
    used.add(found);
  }

  // aplica primeiro quem vai para um encaixe já livre (o grupo pode andar dentro da zona)
  const out: Command[] = [];
  const pending = [...cmd.ids];
  while (pending.length > 0) {
    const k = pending.findIndex((id) => {
      const by = occupant.get(target.get(id)!);
      return by === undefined || by === id;
    });
    if (k < 0) return 'as peças trocariam de lugar entre si: mova uma de cada vez';
    const id = pending.splice(k, 1)[0]!;
    const piece = state.pieces[id]!;
    if (piece.parentId === zone && piece.slot && occupant.get(piece.slot) === id) {
      occupant.delete(piece.slot);
    }
    occupant.set(target.get(id)!, id);
    out.push(drop(id, { slot: target.get(id)! }));
  }
  return out;
}

/** Mudança de status; se o kind diz que ela revela algo (ex.: virar a carta comprada), bloqueia o desfazer. */
function statusChanged(kinds: KindRegistry, p: Piece, to: string): BuiltinEvent {
  const reveals = kinds
    .get(p.kind)
    ?.reveals?.some(([a, b]) => (a === '*' || a === p.status) && (b === '*' || b === to));
  return reveals
    ? { type: 'statusChanged', id: p.id, from: p.status, to, revealsInfo: true }
    : { type: 'statusChanged', id: p.id, from: p.status, to };
}

/**
 * Jogada de um jogador (`cmd.actor`): só mexe em peças dele (ou sem dono), só solta na área
 * dele, só muda os próprios recursos e só passa a vez na própria vez. `undefined` = permitido.
 */
export function permissionError(state: GameState, cmd: Command): string | undefined {
  const { actor } = cmd;
  if (typeof actor !== 'string') return undefined;
  const { pieces, players } = state;
  const name = (id: string) => players[id]?.name ?? id;
  const touch = (id: unknown) =>
    typeof id === 'string' && pieces[id] ? touchError(pieces, id, actor, players) : undefined;
  switch (cmd.type) {
    case 'move':
    case 'rotate':
    case 'setStatus':
    case 'setAttr':
    case 'removePiece':
      return touch(cmd.id);
    case 'dropInto':
      return (
        touch(cmd.id) ?? dropError(pieces, (cmd.zone as string | null) ?? null, actor, players)
      );
    case 'dropMany':
      return (
        (Array.isArray(cmd.ids) ? cmd.ids : []).map(touch).find((e) => e !== undefined) ??
        dropError(pieces, (cmd.zone as string | null) ?? null, actor, players)
      );
    case 'shuffle':
      return touch(cmd.zone);
    case 'createPiece':
      return dropError(
        pieces,
        (cmd.piece as PieceInit | undefined)?.parentId ?? null,
        actor,
        players,
      );
    case 'setPlayerAttr':
      return cmd.player === actor
        ? undefined
        : `só ${name(String(cmd.player))} muda os próprios recursos`;
    case 'addPlayer':
      return 'só o jogo adiciona jogadores';
    case 'nextPlayer':
      return state.activePlayer === null || state.activePlayer === actor
        ? undefined
        : `não é a vez de ${name(actor)}`;
    default:
      return undefined;
  }
}

/** Em zonas com layout (não 'free') a posição vem do layout: x, y não valem. */
function layoutOf(state: GameState, parentId: PieceId | null) {
  return parentId === null ? 'free' : (state.pieces[parentId]?.zone?.layout ?? 'free');
}

function nextValue(
  current: AttrValue | undefined,
  cmd: { value?: AttrValue; delta?: number },
  key: string,
): Result<AttrValue> {
  if (cmd.delta === undefined) {
    return cmd.value === undefined ? err(`"${key}": falta value ou delta`) : ok(cmd.value);
  }
  const base = current ?? 0;
  if (typeof base !== 'number') return err(`"${key}" não é número`);
  return ok(base + cmd.delta);
}

export const builtinCommands: CommandDef[] = [
  builtin('createPiece', ({ piece }, { state, kinds }) => {
    if (state.pieces[piece.id]) return `peça "${piece.id}" já existe`;
    if (piece.zone) {
      const v = validateZoneSpec(piece.zone);
      if (v !== true) return `zona "${piece.id}": ${v}`;
    }
    const r = kinds.create(piece);
    if (!r.ok) return r.error;
    let created = r.value;
    if (created.parentId !== null) {
      const { x, y } = created.transform;
      const target = { zone: created.parentId, slot: created.slot, x, y };
      const plan = planPlacement(state.pieces, created, target);
      if (!plan.ok) return plan.error;
      const z = piece.transform?.z ?? plan.value.z;
      created = { ...created, transform: { ...created.transform, z } };
    }
    return [{ type: 'pieceCreated', piece: created }];
  }),

  builtin('removePiece', ({ id }, { state }) => {
    const p = state.pieces[id];
    if (!p) return notFound(id);
    if (p.zone && childrenOf(state.pieces, id).length > 0) return `zona "${id}" não está vazia`;
    return [{ type: 'pieceRemoved', id }];
  }),

  builtin('move', ({ id, x, y, z }, { state }) => {
    const p = state.pieces[id];
    if (!p) return notFound(id);
    const layout = layoutOf(state, p.parentId);
    if (layout !== 'free') return `"${id}" está numa zona '${layout}': use dropInto`;
    const { transform: t } = p;
    return [
      {
        type: 'pieceMoved',
        id,
        from: { x: t.x, y: t.y, z: t.z },
        to: { x, y, z: z ?? t.z },
      },
    ];
  }),

  builtin('rotate', ({ id, rotation }, { state }) => {
    const p = state.pieces[id];
    if (!p) return notFound(id);
    const to = normalizeRotation(rotation);
    return [{ type: 'pieceRotated', id, from: p.transform.rotation, to }];
  }),

  builtin('setStatus', ({ id, status }, { state, kinds }) => {
    const p = state.pieces[id];
    if (!p) return notFound(id);
    if (p.status === status) return [];
    const v = kinds.validateStatus(p, status);
    return v === true ? [statusChanged(kinds, p, status)] : v;
  }),

  builtin('dropInto', (cmd, { state, kinds }) => {
    const p = state.pieces[cmd.id];
    if (!p) return notFound(cmd.id);
    const plan = planPlacement(state.pieces, p, cmd);
    if (!plan.ok) return plan.error;
    const from = placementOf(p);
    const to = plan.value;
    const changing = to.parentId !== from.parentId;
    const zoneOf = (id: PieceId | null) => (id === null ? undefined : state.pieces[id]?.zone);
    const status = changing
      ? (zoneOf(to.parentId)?.statusOnEnter ?? zoneOf(from.parentId)?.statusOnLeave ?? p.status)
      : p.status;
    if (status !== p.status) {
      const v = kinds.validateStatus(p, status);
      if (v !== true) return v;
    }
    const enterRotation = changing ? zoneOf(to.parentId)?.rotationOnEnter : undefined;
    const rotation =
      enterRotation === undefined ? p.transform.rotation : normalizeRotation(enterRotation);
    const events: BuiltinEvent[] = [];
    if (changing && from.parentId !== null) {
      events.push({ type: 'pieceLeftZone', id: p.id, zone: from.parentId });
    }
    if (!samePlacement(from, to)) events.push({ type: 'piecePlaced', id: p.id, from, to });
    if (rotation !== p.transform.rotation) {
      events.push({ type: 'pieceRotated', id: p.id, from: p.transform.rotation, to: rotation });
    }
    if (changing && to.parentId !== null) {
      events.push({ type: 'pieceEnteredZone', id: p.id, zone: to.parentId, slot: to.slot });
    }
    if (status !== p.status) events.push(statusChanged(kinds, p, status));
    return events;
  }),

  builtin('shuffle', ({ zone }, { state, random }) => {
    if (!state.pieces[zone]?.zone) return `"${zone}" não é uma zona`;
    const order = shuffle(
      childrenOf(state.pieces, zone).map((p) => p.id),
      random,
    );
    return [{ type: 'zoneShuffled', zone, order }];
  }),

  builtin('endGame', (cmd, { state }) => {
    if (state.ended) return 'a partida já acabou';
    const invalid = checkGameEnd(cmd, state);
    if (invalid) return invalid;
    return [{ type: 'gameEnded', ...gameEndOf(cmd) }];
  }),

  builtin('log', ({ message, to }, { state }) => {
    if (typeof message !== 'string' || message === '') return 'log precisa de message';
    if (to !== undefined && !state.players[to]) return `jogador "${to}" não existe`;
    return [
      to === undefined
        ? { type: 'message', text: message }
        : { type: 'message', text: message, to },
    ];
  }),

  builtin('addPlayer', ({ id, name, color }, { state }) => {
    if (!id) return 'addPlayer precisa de id';
    if (state.players[id]) return `jogador "${id}" já existe`;
    const n = state.playerOrder.length;
    const player: PlayerState = {
      id,
      name: name ?? `Jogador ${n + 1}`,
      color: color ?? PLAYER_COLORS[n % PLAYER_COLORS.length]!,
      attributes: {},
    };
    return [{ type: 'playerAdded', player }];
  }),

  builtin('setActivePlayer', ({ player }, { state }) => {
    if (!state.players[player]) return `jogador "${player}" não existe`;
    if (state.activePlayer === player) return [];
    return [{ type: 'activePlayerChanged', from: state.activePlayer, to: player }];
  }),

  builtin('nextPlayer', (_cmd, { state }) => {
    const order = state.playerOrder;
    if (order.length === 0) return 'não há jogadores';
    const i = state.activePlayer === null ? -1 : order.indexOf(state.activePlayer);
    const to = order[(i + 1) % order.length]!;
    if (to === state.activePlayer) return [];
    return [{ type: 'activePlayerChanged', from: state.activePlayer, to }];
  }),

  builtin('setAttr', (cmd, { state, kinds }) => {
    const p = state.pieces[cmd.id];
    if (!p) return notFound(cmd.id);
    const from = p.attributes[cmd.key];
    const to = nextValue(from, cmd, cmd.key);
    if (!to.ok) return to.error;
    const v = kinds.validateAttr(p, cmd.key, to.value);
    if (v !== true) return v;
    return [{ type: 'attrChanged', id: cmd.id, key: cmd.key, from: from ?? null, to: to.value }];
  }),

  builtin('setGlobal', (cmd, { state }) => {
    const from = state.globals[cmd.key];
    const to = nextValue(from, cmd, cmd.key);
    if (!to.ok) return to.error;
    return [{ type: 'globalChanged', key: cmd.key, from: from ?? null, to: to.value }];
  }),

  builtin('setPlayerAttr', (cmd, { state }) => {
    const player = state.players[cmd.player];
    if (!player) return `jogador "${cmd.player}" não existe`;
    const from = player.attributes[cmd.key];
    const to = nextValue(from, cmd, cmd.key);
    if (!to.ok) return to.error;
    return [
      {
        type: 'playerAttrChanged',
        player: cmd.player,
        key: cmd.key,
        from: from ?? null,
        to: to.value,
      },
    ];
  }),
];

/** O motivo da recusa de um `endGame`, ou `null` se estiver certo. */
function checkGameEnd(end: GameEnd, state: GameState): string | null {
  const { result, winners, ranking } = end;
  if (result === undefined && winners === undefined) return 'endGame precisa de result ou winners';
  if (result !== undefined && !['win', 'lose', 'draw'].includes(result)) {
    return `resultado inválido: "${result}"`;
  }
  const players = (list: unknown[], field: string) => {
    const seen = new Set<unknown>();
    for (const p of list) {
      if (typeof p !== 'string' || !state.players[p])
        return `${field}: jogador "${String(p)}" não existe`;
      if (seen.has(p)) return `${field}: "${p}" aparece duas vezes`;
      seen.add(p);
    }
    return null;
  };
  if (winners !== undefined) {
    if (!Array.isArray(winners) || winners.length === 0)
      return 'winners precisa de um jogador ou mais';
    const bad = players(winners, 'winners');
    if (bad) return bad;
  }
  if (ranking !== undefined) {
    if (!Array.isArray(ranking)) return 'ranking precisa ser uma lista';
    for (const r of ranking) {
      if (typeof r !== 'object' || r === null) return 'ranking: cada item precisa de player';
      if (r.score !== undefined && !Number.isFinite(r.score))
        return `ranking: score inválido de "${r.player}"`;
      for (const key of ['label', 'text'] as const) {
        if (r[key] !== undefined && typeof r[key] !== 'string')
          return `ranking: ${key} de "${r.player}" precisa ser texto`;
      }
    }
    const bad = players(
      ranking.map((r) => r.player),
      'ranking',
    );
    if (bad) return bad;
  }
  return null;
}
