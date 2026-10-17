import { expandSlotPattern, type PieceInit, type Size, type ZoneSpec } from '@/engine/core';

export interface PiramideOptions {
  id: string;
  kind: string;
  parentId?: string | null;
  /** Centro: na mesa, ou relativo ao canto do pai se ele for uma zona livre. */
  x: number;
  y: number;
  rows: number;
  /** Cartas na primeira fileira. */
  base?: number;
  card: Size;
  accepts?: ZoneSpec['accepts'];
  statusOnEnter?: string;
  label?: string;
}

/**
 * Zona de encaixes em pirâmide invertida (padrão 'pyramid'): a fileira r tem `base + r` cartas,
 * deslocada meia carta. Encaixes "r,p": r = fileira, p = posição a partir da esquerda.
 */
export function zonaPiramide({
  id,
  kind,
  parentId = null,
  x,
  y,
  rows,
  base = 3,
  card,
  accepts,
  statusOnEnter,
  label = 'Tableau',
}: PiramideOptions): PieceInit {
  const { slots, size } = expandSlotPattern({
    pattern: 'pyramid',
    base,
    rows,
    slot: card,
    margin: 12,
  });
  const zone: ZoneSpec = { layout: 'slots', slots, slotSize: card };
  if (accepts) zone.accepts = accepts;
  if (statusOnEnter) zone.statusOnEnter = statusOnEnter;
  return { id, kind, parentId, size, transform: { x, y }, faces: { default: label }, zone };
}
