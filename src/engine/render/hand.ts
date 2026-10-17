import type { Piece, PieceId } from '@/engine/core';

/** Altura de uma carta na faixa da mão, em px da tela, com o tamanho da mão em 100%. */
export const HAND_CARD_HEIGHT = 150;

/** Onde uma carta fica na faixa (centro, em px da tela). */
export interface HandSlot {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export interface HandLayout {
  slots: Map<PieceId, HandSlot>;
  /** Ordem de desenho: a carta sob o mouse por último (por cima). */
  order: PieceId[];
  /** A faixa: soltar uma peça aqui a põe na mão. */
  band: { x: number; y: number; width: number; height: number };
}

/**
 * A mão embaixo da tela, como no Slay the Spire: as cartas em leque leve, centralizadas,
 * apertando para caber; a carta sob o mouse sobe, cresce e fica reta.
 */
export function layoutHand(
  cards: readonly Piece[],
  size: { width: number; height: number },
  zoom: number,
  hovered: PieceId | null,
  inset: { left?: number; right?: number } = {},
): HandLayout {
  const h = HAND_CARD_HEIGHT * zoom;
  const left = 16 + (inset.left ?? 0);
  const right = size.width - 16 - (inset.right ?? 0);
  const widths = cards.map((c) => (c.size.w * h) / c.size.h);
  const widest = Math.max(0, ...widths);
  const n = cards.length;
  const room = Math.max(widest, right - left);
  const step = n > 1 ? Math.min(widest * 0.82, (room - widest) / (n - 1)) : 0;
  const center = (left + right) / 2;
  const bottom = size.height - 10;
  const slots = new Map<PieceId, HandSlot>();
  cards.forEach((c, i) => {
    const k = h / c.size.h;
    const t = n > 1 ? i / (n - 1) - 0.5 : 0; // -0,5 … 0,5
    const x = center + (i - (n - 1) / 2) * step;
    if (c.id === hovered) {
      // cresce para cima, com a base no mesmo lugar (o mouse continua sobre ela)
      slots.set(c.id, { x, y: bottom - (h * 1.2) / 2, rotation: 0, scale: k * 1.2 });
    } else {
      slots.set(c.id, {
        x,
        y: bottom - h / 2 + Math.abs(t) * h * 0.08,
        rotation: t * 10,
        scale: k,
      });
    }
  });
  const order = cards.map((c) => c.id).filter((id) => id !== hovered);
  if (hovered !== null && slots.has(hovered)) order.push(hovered);
  const bandHeight = Math.max(h * 0.6, n ? h + 24 : 0);
  return {
    slots,
    order,
    band: { x: 0, y: size.height - bandHeight, width: size.width, height: bandHeight },
  };
}

/** O ponto (px da tela) está na faixa da mão? */
export function inHandBand(layout: HandLayout, p: { x: number; y: number }): boolean {
  const b = layout.band;
  return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
}

/** Posição na mão para soltar em `x`: quantas das outras cartas ficam à esquerda. */
export function handIndexAt(layout: HandLayout, others: readonly PieceId[], x: number): number {
  return others.filter((id) => (layout.slots.get(id)?.x ?? Infinity) < x).length;
}
