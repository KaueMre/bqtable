import { parseGridSlot, type Piece, type PieceId, type Size } from '@/engine/core';

/** Posição de um filho no referencial da zona: canto superior esquerdo = 0,0, sem a rotação dela. */
export interface Local {
  x: number;
  y: number;
  rotation: number;
}

export const DEFAULT_SLOT_SIZE: Size = { w: 60, h: 84 };
const DEFAULT_STACK = { dx: 0.5, dy: -0.5 };
const DEFAULT_FAN = { spacing: 40, arc: 0 };
const DEFAULT_ROW = { gap: 8, align: 'start' } as const;

/** Posições dos filhos de uma zona. `children` em ordem de z. */
export function layoutChildren(zone: Piece, children: Piece[]): Map<PieceId, Local> {
  const out = new Map<PieceId, Local>();
  const spec = zone.zone;
  if (!spec) return out;
  const { w, h } = zone.size;
  const own = (p: Piece) => p.transform.rotation;

  switch (spec.layout) {
    case 'free':
      for (const c of children)
        out.set(c.id, { x: c.transform.x, y: c.transform.y, rotation: own(c) });
      break;
    case 'grid': {
      const { cell } = spec.grid!;
      for (const c of children) {
        const pos = c.slot === undefined ? null : parseGridSlot(c.slot);
        if (!pos) continue;
        out.set(c.id, {
          x: (pos.col + 0.5) * cell.w,
          y: (pos.row + 0.5) * cell.h,
          rotation: own(c),
        });
      }
      break;
    }
    case 'slots': {
      const slots = new Map(spec.slots!.map((s) => [s.id, s]));
      for (const c of children) {
        const s = c.slot === undefined ? undefined : slots.get(c.slot);
        if (s) out.set(c.id, { x: s.x, y: s.y, rotation: (s.rotation ?? 0) + own(c) });
      }
      break;
    }
    case 'stack': {
      const { dx, dy } = spec.stack ?? DEFAULT_STACK;
      children.forEach((c, i) => {
        out.set(c.id, { x: w / 2 + dx * i, y: h / 2 + dy * i, rotation: own(c) });
      });
      break;
    }
    case 'fan': {
      const { spacing, arc = 0 } = { ...DEFAULT_FAN, ...spec.fan };
      const n = children.length;
      const widest = Math.max(0, ...children.map((c) => c.size.w * c.transform.scale));
      // aperta o leque para caber na largura da zona
      const step = n > 1 ? Math.max(0, Math.min(spacing, (w - widest) / (n - 1))) : 0;
      children.forEach((c, i) => {
        const t = n > 1 ? i / (n - 1) - 0.5 : 0; // -0.5 … 0.5
        out.set(c.id, {
          x: w / 2 + (i - (n - 1) / 2) * step,
          y: h / 2,
          rotation: arc * t + own(c),
        });
      });
      break;
    }
    case 'row': {
      const { gap, align } = { ...DEFAULT_ROW, ...spec.row };
      const widths = children.map((c) => c.size.w * c.transform.scale);
      const sum = widths.reduce((a, b) => a + b, 0);
      const n = children.length;
      const room = w - 2 * gap;
      // não cabe: as peças se sobrepõem por igual, como no leque
      const step = n > 1 && sum + gap * (n - 1) > room ? (room - sum) / (n - 1) : gap;
      const total = sum + step * Math.max(0, n - 1);
      let x = align === 'start' ? gap : align === 'end' ? w - gap - total : (w - total) / 2;
      children.forEach((c, i) => {
        out.set(c.id, { x: x + widths[i]! / 2, y: h / 2, rotation: own(c) });
        x += widths[i]! + step;
      });
      break;
    }
  }
  return out;
}
