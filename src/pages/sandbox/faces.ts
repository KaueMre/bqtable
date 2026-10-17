/** Imagens de teste geradas em canvas (PNG), até existir arte. Memorizadas por parâmetros. */

export const CARD = { w: 120, h: 168 };

type Variant = 'front' | 'back' | 'transparent';

interface FaceOptions {
  label: string;
  hue: number;
  variant?: Variant;
}

const cache = new Map<string, string>();
const RES = 2; // desenha em 2x para ficar nítido com zoom

export function cardFace({ label, hue, variant = 'front' }: FaceOptions): string {
  const key = `${variant}|${hue}|${label}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = CARD.w * RES;
  canvas.height = CARD.h * RES;
  const ctx = canvas.getContext('2d');
  if (!ctx) return label; // sem canvas: vira placeholder com texto
  ctx.scale(RES, RES);
  draw[variant](ctx, label, hue);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

const draw: Record<Variant, (ctx: CanvasRenderingContext2D, label: string, hue: number) => void> = {
  front(ctx, label, hue) {
    roundRect(ctx, 1, 1, CARD.w - 2, CARD.h - 2, 8);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsl(${hue} 45% 35%)`;
    ctx.stroke();
    ctx.fillStyle = `hsl(${hue} 60% 85%)`;
    ctx.fillRect(8, 8, CARD.w - 16, 28);
    ctx.fillStyle = `hsl(${hue} 50% 25%)`;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, CARD.w / 2, 27, CARD.w - 20);
    ctx.beginPath();
    ctx.arc(CARD.w / 2, 95, 30, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${hue} 55% 60%)`;
    ctx.fill();
  },
  back(ctx, _label, hue) {
    roundRect(ctx, 1, 1, CARD.w - 2, CARD.h - 2, 8);
    ctx.fillStyle = `hsl(${hue} 45% 35%)`;
    ctx.fill();
    ctx.strokeStyle = `hsl(${hue} 50% 55%)`;
    ctx.lineWidth = 3;
    for (let i = -CARD.h; i < CARD.w; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, CARD.h);
      ctx.lineTo(i + CARD.h, 0);
      ctx.stroke();
    }
  },
  /** Camada transparente, como as cartas de sombra e cor que vão na sleeve. */
  transparent(ctx, label, hue) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = `hsl(${hue} 70% 45% / 0.55)`;
    ctx.fillStyle = `hsl(${(hue + 40) % 360} 70% 55% / 0.35)`;
    const seed = [...label].reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(
        30 + ((seed * (i + 3)) % 60),
        40 + ((seed * (i + 7)) % 90),
        18 + i * 8,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
    }
    roundRect(ctx, 2, 2, CARD.w - 4, CARD.h - 4, 8);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsl(${hue} 30% 30% / 0.6)`;
    ctx.stroke();
  },
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
