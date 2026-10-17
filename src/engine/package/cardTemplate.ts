import type { ImageSource } from '@/engine/data';
import { interpolate, truthy, type Scope } from './interpolate';
import type { CardTemplate, TemplateElement } from './manifest';

export interface DrawOptions {
  lookups?: Record<string, Record<string, string>>;
  /** Imagem já carregada para um `src` (preenchido); `undefined` pula o elemento. */
  image(src: string): ImageSource | undefined;
  /** Resolução do desenho (vence a do modelo): o preview pede mais, para o texto ficar nítido. */
  scale?: number;
}

/** Desenha a face de uma carta a partir do modelo e dos dados do item. */
export function drawTemplate(
  template: CardTemplate,
  scope: Scope,
  options: DrawOptions,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const scale = options.scale ?? template.scale ?? 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(template.size.w * scale);
  canvas.height = Math.ceil(template.size.h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  const fill = (s: string) => interpolate(s, scope, { lookups: options.lookups });
  for (const el of template.elements) {
    if (el.if !== undefined && !truthy(fill(el.if))) continue;
    ctx.save();
    drawElement(ctx, el, fill, options);
    ctx.restore();
  }
  return canvas;
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  el: TemplateElement,
  fill: (s: string) => unknown,
  options: DrawOptions,
) {
  const paint = (p: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[] }) => {
    if (p.fill) {
      ctx.fillStyle = String(fill(p.fill));
      ctx.fill();
    }
    if (p.stroke) {
      ctx.strokeStyle = String(fill(p.stroke));
      ctx.lineWidth = p.lineWidth ?? 1;
      ctx.setLineDash(p.dash ?? []);
      ctx.stroke();
    }
  };
  switch (el.type) {
    case 'rect':
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.w, el.h, el.radius ?? 0);
      paint(el);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2);
      paint(el);
      break;
    case 'polygon':
      ctx.beginPath();
      ctx.moveTo(el.points[0]!, el.points[1]!);
      for (let i = 2; i < el.points.length; i += 2) ctx.lineTo(el.points[i]!, el.points[i + 1]!);
      ctx.closePath();
      paint(el);
      break;
    case 'image': {
      const image = options.image(String(fill(el.src)));
      if (image) ctx.drawImage(image, el.x, el.y, el.w, el.h);
      break;
    }
    case 'text': {
      const font = el.font ?? '10px system-ui, sans-serif';
      ctx.font = font;
      ctx.fillStyle = el.color ? String(fill(el.color)) : '#1f2328';
      ctx.textAlign = el.align ?? 'left';
      ctx.textBaseline = 'alphabetic';
      const content = String(fill(el.text) ?? '');
      const lines = el.maxWidth ? wrap(ctx, content, el.maxWidth) : [content];
      // o tamanho vem do "NNpx" da fonte: "700 15px" começa pelo peso, e o navegador ainda
      // normaliza ctx.font ("bold 15px")
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
      const lineHeight = el.lineHeight ?? px * 1.2;
      // girado: o texto é desenhado em volta do próprio ponto x, y
      ctx.translate(el.x, el.y);
      if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
      lines.slice(0, el.maxLines ?? lines.length).forEach((line, i) => {
        if (el.maxWidth === undefined) ctx.fillText(line, 0, i * lineHeight);
        else ctx.fillText(line, 0, i * lineHeight, el.maxWidth);
      });
      break;
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}
