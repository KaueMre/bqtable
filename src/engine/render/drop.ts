import {
  childrenOf,
  gridSlot,
  isAncestor,
  type DropTarget,
  type Piece,
  type PieceId,
} from '@/engine/core';
import { DEFAULT_SLOT_SIZE, layoutChildren, type Local } from './layouts';
import { toLocal, type SceneNode } from './scene';

type Pieces = Record<PieceId, Piece>;
type Point = { x: number; y: number };

/** Encaixe magnético: o encaixe mais perto do ponteiro, se estiver a menos disso × o tamanho dele. */
export const SNAP_FACTOR = 0.75;

/**
 * Para onde vai a peça solta. A zona é a mais alta sob o ponteiro; em zona 'free' (e na mesa)
 * vale o centro da peça, para ela não pular para o ponteiro. `group`: as outras peças arrastadas
 * junto (nem elas nem o que está dentro delas servem de alvo).
 */
export function findDropTarget(
  pieces: Pieces,
  scene: SceneNode[],
  draggedId: PieceId,
  pointer: Point,
  center: Point,
  group: readonly PieceId[] = [],
): DropTarget {
  const moving = [draggedId, ...group];
  for (let i = scene.length - 1; i >= 0; i--) {
    const node = scene[i]!;
    const zone = pieces[node.id];
    if (!zone?.zone) continue;
    if (moving.some((id) => id === node.id || isAncestor(pieces, id, node.id))) continue;
    const local = toLocal(node, zone.size, pointer);
    if (local.x < 0 || local.y < 0 || local.x > zone.size.w || local.y > zone.size.h) continue;
    return resolveInZone(pieces, zone, draggedId, local, toLocal(node, zone.size, center), group);
  }
  return { zone: null, x: center.x, y: center.y };
}

/** Alvo dentro de uma zona, a partir do ponteiro (e do centro da peça, para 'free'). */
export function resolveInZone(
  pieces: Pieces,
  zone: Piece,
  draggedId: PieceId,
  pointer: Point,
  center: Point,
  group: readonly PieceId[] = [],
): DropTarget {
  const spec = zone.zone!;
  const target: DropTarget = { zone: zone.id };
  // autoFill: onde caiu não importa, o Gestor escolhe o primeiro encaixe livre
  if (spec.autoFill && (spec.layout === 'grid' || spec.layout === 'slots')) return target;
  switch (spec.layout) {
    case 'free':
      return { ...target, x: center.x, y: center.y };
    case 'grid': {
      const { cols, rows, cell } = spec.grid!;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(pointer.x / cell.w)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(pointer.y / cell.h)));
      return { ...target, slot: gridSlot(col, row) };
    }
    case 'slots': {
      const size = spec.slotSize ?? pieces[draggedId]?.size ?? DEFAULT_SLOT_SIZE;
      const radius = Math.max(size.w, size.h) * SNAP_FACTOR;
      let best: { id: string; d: number } | null = null;
      for (const s of spec.slots!) {
        const d = Math.hypot(s.x - pointer.x, s.y - pointer.y);
        if (d <= radius && (!best || d < best.d)) best = { id: s.id, d };
      }
      return best ? { ...target, slot: best.id } : target; // sem encaixe: o core recusa
    }
    case 'stack':
      return target;
    case 'fan':
    case 'row': {
      const others = childrenOf(pieces, zone.id).filter(
        (p) => p.id !== draggedId && !group.includes(p.id),
      );
      const layout = layoutChildren(zone, others);
      const index = others.filter((p) => (layout.get(p.id) as Local).x < pointer.x).length;
      return { ...target, index };
    }
  }
}

/** Alvos possíveis numa zona, para testar quais são válidos durante o arrasto. */
export function candidateTargets(
  pieces: Pieces,
  zoneId: PieceId,
  draggedId: PieceId,
): DropTarget[] {
  const spec = pieces[zoneId]?.zone;
  if (!spec) return [];
  if (spec.autoFill) return [{ zone: zoneId }];
  const taken = new Set(
    childrenOf(pieces, zoneId)
      .filter((p) => p.id !== draggedId && p.slot !== undefined)
      .map((p) => p.slot),
  );
  switch (spec.layout) {
    case 'grid': {
      const { cols, rows } = spec.grid!;
      const out: DropTarget[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const slot = gridSlot(col, row);
          if (!taken.has(slot)) out.push({ zone: zoneId, slot });
        }
      }
      return out;
    }
    case 'slots':
      return spec.slots!.filter((s) => !taken.has(s.id)).map((s) => ({ zone: zoneId, slot: s.id }));
    default:
      return [{ zone: zoneId }];
  }
}
