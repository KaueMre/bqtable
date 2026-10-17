import type { KindRegistry } from './kinds';
import type { Piece, PieceId } from './piece';
import type { GameState } from './state';
import { ownerOf } from './zones';

/** O estado do ponto de vista de um jogador. */
export interface View {
  /** Peças como ele as vê: escondidas não aparecem; viradas mostram só o verso. */
  pieces: Record<PieceId, Piece>;
  /** Peças que ele vê viradas (sem face, atributos nem tags). */
  faceDown: ReadonlySet<PieceId>;
  /** Peças que ele não vê. */
  hidden: ReadonlySet<PieceId>;
}

type Mode = { mode: 'hidden' } | { mode: 'faceDown'; back: string } | null;

type Cache = Map<KindRegistry | null, Map<string | null, View>>;
const views = new WeakMap<GameState, Cache>();
const backs = new WeakMap<Piece, Map<string, Piece>>();

/** A peça virada: só o verso, sem o que a identifica. Mesma peça → mesmo objeto (memo). */
function asBack(piece: Piece, back: string): Piece {
  let byBack = backs.get(piece);
  const cached = byBack?.get(back);
  if (cached) return cached;
  const face = piece.faces[back] ?? piece.faces.default;
  const out: Piece = {
    ...piece,
    status: back,
    faces: face === undefined ? {} : { [back]: face },
    attributes: {},
    tags: [],
  };
  if (!byBack) backs.set(piece, (byBack = new Map()));
  byBack.set(back, out);
  return out;
}

/**
 * O que `viewer` pode ver (`null` = espectador). Zonas com `privacy` mostram o conteúdo só ao
 * dono efetivo; para os outros, `hidden` some com tudo e `faceDown` mostra as peças viradas.
 * Com `kinds`, peças num status de `hiddenStatuses` do kind aparecem viradas para todos.
 * É a mesma função que um servidor usaria para não mandar informação escondida a um jogador.
 */
export function viewFor(state: GameState, viewer: string | null, kinds?: KindRegistry): View {
  let byKinds = views.get(state);
  let byViewer = byKinds?.get(kinds ?? null);
  const cached = byViewer?.get(viewer);
  if (cached) return cached;
  const secret = (p: Piece) => !!kinds?.get(p.kind)?.hiddenStatuses?.includes(p.status);

  const { pieces } = state;
  const modes = new Map<PieceId, Mode>();
  /** Como o viewer vê o que está DENTRO da zona `id` (herda das zonas de fora). */
  const inside = (id: PieceId): Mode => {
    if (modes.has(id)) return modes.get(id)!;
    const zone = pieces[id];
    const outer = zone?.parentId ? inside(zone.parentId) : null;
    let mode: Mode = outer;
    const privacy = zone?.zone?.privacy;
    if (outer?.mode !== 'hidden' && privacy && ownerOf(pieces, id) !== viewer) {
      if (privacy === 'hidden') mode = { mode: 'hidden' };
      else mode ??= { mode: 'faceDown', back: zone.zone!.backStatus ?? 'faceDown' };
    }
    modes.set(id, mode);
    return mode;
  };

  const out: Record<PieceId, Piece> = {};
  const faceDown = new Set<PieceId>();
  const hidden = new Set<PieceId>();
  for (const piece of Object.values(pieces)) {
    const mode = piece.parentId ? inside(piece.parentId) : null;
    if (mode?.mode === 'hidden') hidden.add(piece.id);
    else if (mode?.mode === 'faceDown') {
      faceDown.add(piece.id);
      out[piece.id] = asBack(piece, mode.back);
    } else if (secret(piece)) {
      faceDown.add(piece.id); // virada para todos: o verso é o próprio status
      out[piece.id] = asBack(piece, piece.status);
    } else out[piece.id] = piece;
  }
  // sem nada escondido, o mesmo objeto de peças (a tela não redesenha à toa)
  const view: View = {
    pieces: hidden.size === 0 && faceDown.size === 0 ? pieces : out,
    faceDown,
    hidden,
  };
  if (!byKinds) views.set(state, (byKinds = new Map()));
  if (!byViewer) byKinds.set(kinds ?? null, (byViewer = new Map()));
  byViewer.set(viewer, view);
  return view;
}

/**
 * O conteúdo da zona está escondido de `viewer`? (ela ou uma zona de fora com `privacy: 'hidden'`
 * de outro dono). Serve para o painel não mostrar quantas peças há atrás do escudo.
 */
export function contentsHidden(
  pieces: GameState['pieces'],
  zoneId: PieceId,
  viewer: string | null,
): boolean {
  for (let z = pieces[zoneId]; z; z = z.parentId ? pieces[z.parentId] : undefined) {
    if (z.zone?.privacy === 'hidden' && ownerOf(pieces, z.id) !== viewer) return true;
  }
  return false;
}
