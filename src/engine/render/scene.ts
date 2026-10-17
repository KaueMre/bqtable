import type { Piece, PieceId, Size } from '@/engine/core';
import { layoutChildren, type Local } from './layouts';

/** Peça pronta para desenhar: transformação absoluta, em coordenadas da mesa. */
export interface SceneNode {
  id: PieceId;
  x: number; // centro
  y: number;
  rotation: number; // graus (soma das rotações dos pais)
  scale: number;
  depth: number; // 0 = na mesa
  parentId: PieceId | null;
}

type Pieces = Record<PieceId, Piece>;

/**
 * Achata a árvore de zonas numa lista em ordem de desenho: cada zona antes dos seus filhos,
 * irmãos por z. Peças fora do filtro somem junto com o que estiver dentro delas.
 */
export function buildScene(pieces: Pieces, filter?: (p: Piece) => boolean): SceneNode[] {
  const byParent = new Map<PieceId | null, Piece[]>();
  Object.values(pieces).forEach((p) => {
    const list = byParent.get(p.parentId) ?? [];
    list.push(p);
    byParent.set(p.parentId, list);
  });
  for (const list of byParent.values()) {
    list.sort((a, b) => a.transform.z - b.transform.z); // sort é estável: empate mantém a criação
  }

  const out: SceneNode[] = [];
  const visit = (piece: Piece, parent: { node: SceneNode; size: Size } | null, local: Local) => {
    if (filter && !filter(piece)) return;
    const node = compose(piece, parent, local);
    out.push(node);
    const children = byParent.get(piece.id);
    if (!children?.length || !piece.zone) return;
    const layout = layoutChildren(piece, children);
    const center = { x: piece.size.w / 2, y: piece.size.h / 2, rotation: 0 };
    for (const child of children) {
      visit(child, { node, size: piece.size }, layout.get(child.id) ?? center);
    }
  };
  for (const root of byParent.get(null) ?? []) {
    const { x, y, rotation } = root.transform;
    visit(root, null, { x, y, rotation });
  }
  return out;
}

function compose(
  piece: Piece,
  parent: { node: SceneNode; size: Size } | null,
  local: Local,
): SceneNode {
  const base = { id: piece.id, parentId: piece.parentId };
  if (!parent) {
    return { ...base, ...local, scale: piece.transform.scale, depth: 0 };
  }
  const { node: p, size } = parent;
  const ox = (local.x - size.w / 2) * p.scale;
  const oy = (local.y - size.h / 2) * p.scale;
  const rad = (p.rotation * Math.PI) / 180;
  return {
    ...base,
    x: p.x + ox * Math.cos(rad) - oy * Math.sin(rad),
    y: p.y + ox * Math.sin(rad) + oy * Math.cos(rad),
    rotation: p.rotation + local.rotation,
    scale: p.scale * piece.transform.scale,
    depth: p.depth + 1,
  };
}

/** Ponto da mesa → referencial da peça (canto superior esquerdo = 0,0). */
export function toLocal(node: SceneNode, size: Size, point: { x: number; y: number }) {
  const rad = (-node.rotation * Math.PI) / 180;
  const dx = point.x - node.x;
  const dy = point.y - node.y;
  return {
    x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / node.scale + size.w / 2,
    y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / node.scale + size.h / 2,
  };
}
