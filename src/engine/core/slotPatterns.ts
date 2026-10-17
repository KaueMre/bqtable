import type { Size } from './piece';
import type { SlotDef } from './zones';

/** Encaixes gerados por padrão, para não listar um por um (o manifest de um jogo usa isto). */
export type SlotPattern =
  | {
      /**
       * Pirâmide invertida: a fileira r tem `base + r` encaixes "r,p", deslocada meia peça, e
       * cobre `overlap` da altura da fileira de cima (Mindset.md 4.1: base 3, cobre metade).
       */
      pattern: 'pyramid';
      base: number;
      rows: number;
      slot: Size;
      overlap?: number;
      margin?: number;
    }
  | {
      /** Fileira de `count` encaixes "0", "1"... */
      pattern: 'row';
      count: number;
      slot: Size;
      gap?: number;
      margin?: number;
    };

/** Encaixes e o tamanho da zona que cabe todos eles. */
export function expandSlotPattern(p: SlotPattern): { slots: SlotDef[]; size: Size } {
  const margin = p.margin ?? 12;
  const { w, h } = p.slot;
  if (p.pattern === 'row') {
    const gap = p.gap ?? 8;
    const slots = Array.from({ length: p.count }, (_, i) => ({
      id: String(i),
      x: margin + w / 2 + i * (w + gap),
      y: margin + h / 2,
    }));
    return {
      slots,
      size: { w: 2 * margin + p.count * w + (p.count - 1) * gap, h: 2 * margin + h },
    };
  }
  const step = h * (1 - (p.overlap ?? 0.5));
  const width = (p.base + p.rows - 1) * w + 2 * margin;
  const slots: SlotDef[] = [];
  for (let r = 0; r < p.rows; r++) {
    const count = p.base + r;
    for (let i = 0; i < count; i++) {
      slots.push({
        id: `${r},${i}`,
        x: width / 2 + (i - (count - 1) / 2) * w,
        y: margin + h / 2 + r * step,
      });
    }
  }
  return { slots, size: { w: width, h: h + (p.rows - 1) * step + 2 * margin } };
}
