import type { ZoneSpec } from './zones';

/** Só valores JSON, para o estado continuar serializável. */
export type AttrValue = number | string | boolean | null | AttrValue[] | { [k: string]: AttrValue };

export type PieceId = string;

export interface Transform {
  // Centro da peça. Na mesa (sem pai): coordenadas da mesa. Numa zona 'free': relativo ao canto
  // superior esquerdo da zona. Nas outras zonas o layout decide a posição e x, y são ignorados.
  x: number;
  y: number;
  rotation: number; // graus, sempre em [0, 360), em torno do centro
  scale: number;
  z: number; // ordem de empilhamento: maior fica por cima
}

export interface Size {
  w: number;
  h: number;
}

export interface Piece {
  id: PieceId;
  kind: string; // 'mindset-card', 'catalog-trace', 'client', 'token'...
  transform: Transform;
  status: string; // 'faceDown', 'covered', 'inHand'... (define a imagem)
  faces: Record<string, string>; // status → imagem (fallback: faces.default)
  size: Size;
  attributes: Record<string, AttrValue>;
  tags: string[];
  parentId: PieceId | null; // zona onde está, se houver
  slot?: string; // encaixe dentro da zona ('grid': "col,linha"; 'slots': id do encaixe)
  owner?: string;
  zone?: ZoneSpec; // se existir, a peça é uma Mesa (zona) e aceita outras peças
}

export interface PieceInit {
  id: PieceId;
  kind: string;
  transform?: Partial<Transform>;
  status?: string;
  faces?: Record<string, string>;
  size?: Size;
  attributes?: Record<string, AttrValue>;
  tags?: string[];
  parentId?: PieceId | null;
  slot?: string;
  owner?: string;
  zone?: ZoneSpec;
}

export const DEFAULT_STATUS = 'default';
export const DEFAULT_FACE = 'default';
export const DEFAULT_SIZE: Size = { w: 100, h: 100 };
const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, rotation: 0, scale: 1, z: 0 };

export function createPiece(init: PieceInit): Piece {
  const transform = { ...DEFAULT_TRANSFORM, ...init.transform };
  const piece: Piece = {
    id: init.id,
    kind: init.kind,
    transform: { ...transform, rotation: normalizeRotation(transform.rotation) },
    status: init.status ?? DEFAULT_STATUS,
    faces: { ...init.faces },
    size: { ...(init.size ?? DEFAULT_SIZE) },
    attributes: { ...init.attributes },
    tags: [...(init.tags ?? [])],
    parentId: init.parentId ?? null,
  };
  if (init.slot !== undefined) piece.slot = init.slot;
  if (init.owner !== undefined) piece.owner = init.owner;
  if (init.zone !== undefined) piece.zone = init.zone;
  return piece;
}

export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function move(piece: Piece, to: { x: number; y: number; z?: number }): Piece {
  const z = to.z ?? piece.transform.z;
  return { ...piece, transform: { ...piece.transform, x: to.x, y: to.y, z } };
}

/** Rotação absoluta (ex.: Transformer do Konva). */
export function rotate(piece: Piece, degrees: number): Piece {
  return { ...piece, transform: { ...piece.transform, rotation: normalizeRotation(degrees) } };
}

/** Rotação relativa (ex.: botão "girar 90°"). */
export function rotateBy(piece: Piece, delta: number): Piece {
  return rotate(piece, piece.transform.rotation + delta);
}

/** Aplica o status sem validar; a validação fica no registro de kinds. */
export function setStatus(piece: Piece, status: string): Piece {
  return { ...piece, status };
}

/** Aplica o atributo sem validar; a validação fica no registro de kinds. */
export function setAttr(piece: Piece, key: string, value: AttrValue): Piece {
  return { ...piece, attributes: { ...piece.attributes, [key]: value } };
}

export function getFace(piece: Piece): string | undefined {
  return piece.faces[piece.status] ?? piece.faces[DEFAULT_FACE];
}
