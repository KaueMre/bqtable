import type { ZoneMotion } from './motion';
import type { Piece, PieceId, Size } from './piece';
import { err, ok, type Result } from './result';

export interface SlotDef {
  id: string;
  x: number; // centro do encaixe, relativo ao canto superior esquerdo da zona
  y: number;
  rotation?: number;
}

/** Especificação de uma Mesa (zona). Dado puro: vai junto no estado. */
export interface ZoneSpec {
  layout: 'free' | 'grid' | 'slots' | 'stack' | 'fan' | 'row';
  /** Filtro simples. Casos complexos: uma Rule com `validate` para o comando `dropInto`. */
  accepts?: { kinds?: string[]; tags?: string[] };
  /** Status que a peça ganha ao entrar (vence o `statusOnLeave` da zona de onde veio). */
  statusOnEnter?: string;
  statusOnLeave?: string;
  capacity?: number;
  /** Layout 'grid': casas "col,linha" a partir de 0,0 no canto superior esquerdo. */
  grid?: { cols: number; rows: number; cell: Size };
  /** Layout 'slots': encaixes nomeados. */
  slots?: SlotDef[];
  /** Tamanho do contorno de cada encaixe (só desenho). */
  slotSize?: Size;
  /** Layout 'stack': deslocamento por peça, para a pilha mostrar volume. */
  stack?: { dx: number; dy: number };
  /** Layout 'fan': distância entre cartas e abertura total do leque, em graus. */
  fan?: { spacing: number; arc?: number };
  /**
   * Layout 'row' (fila): as peças ficam em ordem, coladas a partir de uma ponta, com `gap` entre
   * elas. Quando uma sai, as outras se reorganizam (ex.: a fila de energia, sempre à esquerda).
   */
  row?: { gap?: number; align?: 'start' | 'center' | 'end' };
  /** 'grid' e 'slots': a peça solta sem encaixe vai para o primeiro livre (onde caiu não importa). */
  autoFill?: boolean;
  /** Rotação própria que a peça ganha ao entrar (ex.: a carta girada volta reta para o deck). */
  rotationOnEnter?: number;
  /** `false`: a zona não desenha contorno, casas nem rótulo (ex.: casas sobre a arte do tabuleiro). */
  outline?: boolean;
  /**
   * A mão do jogador (dono da zona): para ele, as peças dela aparecem numa faixa embaixo da tela,
   * fora da câmera, e a zona fica na mesa só como lugar marcado.
   */
  hand?: boolean;
  /**
   * Quem não é o dono da zona: `hidden` não vê nada lá dentro (atrás de um escudo); `faceDown`
   * vê as peças viradas (como a mão de um jogador). O dono vê tudo. Ver `viewFor`.
   */
  privacy?: 'hidden' | 'faceDown';
  /** Status mostrado aos outros em `privacy: 'faceDown'` (padrão "faceDown"). */
  backStatus?: string;
  /** Outros jogadores também podem soltar peças aqui (padrão: só o dono). */
  openToOthers?: boolean;
  /** Como as peças chegam aqui na tela (vence o `motion` do kind delas). Só desenho. */
  motion?: ZoneMotion;
}

/** Para onde uma peça vai. `zone: null` é a mesa (raiz). */
export interface DropTarget {
  zone: PieceId | null;
  slot?: string; // 'grid' e 'slots'
  x?: number; // mesa e 'free'
  y?: number;
  index?: number; // 'stack', 'fan' e 'row': quantas peças ficam abaixo / à esquerda (padrão: no fim)
}

/** Onde a peça está: pai, encaixe e posição. */
export interface Placement {
  parentId: PieceId | null;
  slot: string | null;
  x: number;
  y: number;
  z: number;
}

type Pieces = Record<PieceId, Piece>;

/** Filhos de uma zona (ou da mesa, com `null`), em ordem de z; empate mantém a ordem de criação. */
export function childrenOf(pieces: Pieces, parentId: PieceId | null): Piece[] {
  return Object.values(pieces)
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.parentId === parentId)
    .sort((a, b) => a.p.transform.z - b.p.transform.z || a.i - b.i)
    .map(({ p }) => p);
}

/** `ancestorId` contém `id`, direta ou indiretamente? */
export function isAncestor(pieces: Pieces, ancestorId: PieceId, id: PieceId): boolean {
  for (let p = pieces[id]?.parentId; p != null; p = pieces[p]?.parentId) {
    if (p === ancestorId) return true;
  }
  return false;
}

/**
 * Dono efetivo: o `owner` da peça ou, se ela não tiver, o da zona mais próxima acima dela.
 * Uma carta no tabuleiro de um jogador é dele enquanto estiver lá, sem mudar a carta.
 */
export function ownerOf(pieces: Pieces, id: PieceId | null): string | undefined {
  for (
    let p = id === null ? undefined : pieces[id];
    p;
    p = p.parentId ? pieces[p.parentId] : undefined
  ) {
    if (p.owner !== undefined) return p.owner;
  }
  return undefined;
}

const playerName = (players: Record<string, { name: string }> | undefined, id: string) =>
  players?.[id]?.name ?? id;

/** O jogador pode mexer na peça? `undefined` = sim; senão, o motivo. */
export function touchError(
  pieces: Pieces,
  id: PieceId,
  actor: string,
  players?: Record<string, { name: string }>,
): string | undefined {
  const owner = ownerOf(pieces, id);
  return owner === undefined || owner === actor
    ? undefined
    : `"${id}" é de ${playerName(players, owner)}`;
}

/** O jogador pode soltar peças nesta zona? (mesa sempre pode) */
export function dropError(
  pieces: Pieces,
  zone: PieceId | null,
  actor: string,
  players?: Record<string, { name: string }>,
): string | undefined {
  if (zone === null || pieces[zone]?.zone?.openToOthers) return undefined;
  const owner = ownerOf(pieces, zone);
  return owner === undefined || owner === actor
    ? undefined
    : `área de ${playerName(players, owner)}`;
}

export function acceptsPiece(spec: ZoneSpec, piece: Piece): true | string {
  const { kinds, tags } = spec.accepts ?? {};
  if (kinds && !kinds.includes(piece.kind)) return `não aceita peças do tipo "${piece.kind}"`;
  if (tags && !tags.some((t) => piece.tags.includes(t))) {
    return `só aceita peças com a tag ${tags.map((t) => `"${t}"`).join(' ou ')}`;
  }
  return true;
}

export const gridSlot = (col: number, row: number) => `${col},${row}`;

export function parseGridSlot(slot: string): { col: number; row: number } | null {
  const m = /^(\d+),(\d+)$/.exec(slot);
  return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
}

/** Todos os encaixes da zona, em ordem ('grid': linha a linha; 'slots': na ordem declarada). */
export function zoneSlots(spec: ZoneSpec): string[] {
  if (spec.layout === 'grid' && spec.grid) {
    const out: string[] = [];
    for (let row = 0; row < spec.grid.rows; row++) {
      for (let col = 0; col < spec.grid.cols; col++) out.push(gridSlot(col, row));
    }
    return out;
  }
  return spec.layout === 'slots' && spec.slots ? spec.slots.map((s) => s.id) : [];
}

/** Encaixes livres da zona, em ordem (`except`: a peça que vai sair dele não conta). */
export function freeSlots(pieces: Pieces, zoneId: PieceId, except?: PieceId): string[] {
  const spec = pieces[zoneId]?.zone;
  if (!spec) return [];
  const taken = new Set(
    childrenOf(pieces, zoneId)
      .filter((p) => p.id !== except && p.slot !== undefined)
      .map((p) => p.slot),
  );
  return zoneSlots(spec).filter((slot) => !taken.has(slot));
}

export function validateZoneSpec(spec: ZoneSpec): true | string {
  if (spec.capacity !== undefined && spec.capacity < 0) return 'capacity negativa';
  if (spec.layout === 'grid' && !(spec.grid && spec.grid.cols > 0 && spec.grid.rows > 0)) {
    return "layout 'grid' precisa de grid.cols e grid.rows";
  }
  if (spec.row?.align !== undefined && !['start', 'center', 'end'].includes(spec.row.align)) {
    return `row.align inválido: "${spec.row.align}"`;
  }
  if (spec.layout === 'slots') {
    if (!spec.slots?.length) return "layout 'slots' precisa de slots";
    if (new Set(spec.slots.map((s) => s.id)).size !== spec.slots.length) {
      return 'ids de slot repetidos';
    }
  }
  return true;
}

export function placementOf(piece: Piece): Placement {
  const { x, y, z } = piece.transform;
  return { parentId: piece.parentId, slot: piece.slot ?? null, x, y, z };
}

export function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.parentId === b.parentId && a.slot === b.slot && a.x === b.x && a.y === b.y && a.z === b.z
  );
}

/** z logo acima do mais alto. */
const zAbove = (siblings: Piece[]) =>
  siblings.reduce((max, p) => Math.max(max, p.transform.z + 1), 0);

/** z que coloca a peça na posição `index` de uma lista ordenada por z. */
function zAt(sorted: Piece[], index: number): number {
  const below = sorted[index - 1]?.transform.z;
  const above = sorted[index]?.transform.z;
  if (below !== undefined && above !== undefined) return (below + above) / 2;
  if (below !== undefined) return below + 1;
  if (above !== undefined) return above - 1;
  return 0;
}

/**
 * Valida a entrada da peça no alvo e calcula onde ela fica. Não olha status nem regras do jogo:
 * isso fica com o comando `dropInto` e as Rules.
 */
export function planPlacement(pieces: Pieces, piece: Piece, target: DropTarget): Result<Placement> {
  const { x: px, y: py } = piece.transform;
  const siblingsIn = (zone: PieceId | null) =>
    childrenOf(pieces, zone).filter((p) => p.id !== piece.id);

  if (target.zone === null) {
    const z = zAbove(siblingsIn(null));
    return ok({ parentId: null, slot: null, x: target.x ?? px, y: target.y ?? py, z });
  }

  const zoneId = target.zone;
  const zone = pieces[zoneId];
  if (!zone) return err(`zona "${zoneId}" não existe`);
  const spec = zone.zone;
  if (!spec) return err(`"${zoneId}" não é uma zona`);
  if (zoneId === piece.id || isAncestor(pieces, piece.id, zoneId)) {
    return err(`"${piece.id}" não pode entrar em si mesma`);
  }
  const accepted = acceptsPiece(spec, piece);
  if (accepted !== true) return err(`zona "${zoneId}" ${accepted}`);
  const siblings = siblingsIn(zoneId);
  if (spec.capacity !== undefined && siblings.length >= spec.capacity) {
    return err(`zona "${zoneId}" está cheia`);
  }
  const occupied = (slot: string) => siblings.some((p) => p.slot === slot);
  // autoFill: sem encaixe, vai para o primeiro livre
  const slot =
    target.slot === undefined && spec.autoFill
      ? freeSlots(pieces, zoneId, piece.id)[0]
      : target.slot;
  const inSlot = (slot: string): Result<Placement> =>
    occupied(slot)
      ? err(`encaixe "${slot}" de "${zoneId}" está ocupado`)
      : ok({ parentId: zoneId, slot, x: px, y: py, z: zAbove(siblings) });

  switch (spec.layout) {
    case 'free':
      return ok({
        parentId: zoneId,
        slot: null,
        x: target.x ?? zone.size.w / 2,
        y: target.y ?? zone.size.h / 2,
        z: zAbove(siblings),
      });
    case 'grid': {
      const cell = slot === undefined ? null : parseGridSlot(slot);
      const grid = spec.grid!;
      if (!cell || cell.col >= grid.cols || cell.row >= grid.rows) {
        return err(`casa "${slot ?? ''}" não existe em "${zoneId}"`);
      }
      return inSlot(gridSlot(cell.col, cell.row));
    }
    case 'slots': {
      if (!spec.slots!.some((s) => s.id === slot)) {
        return err(`encaixe "${slot ?? ''}" não existe em "${zoneId}"`);
      }
      return inSlot(slot!);
    }
    case 'stack':
    case 'fan':
    case 'row': {
      const index = Math.min(Math.max(target.index ?? siblings.length, 0), siblings.length);
      return ok({ parentId: zoneId, slot: null, x: px, y: py, z: zAt(siblings, index) });
    }
  }
}
