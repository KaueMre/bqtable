import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { getFace, type Piece } from '@/engine/core';
import { isImageUrl, useImage, type ImageSource } from '@/engine/data';

/**
 * A peça ampliada, num canto da mesa, para ler os textos (Alt sobre a peça). Mostra a peça como o
 * jogador da tela a vê: virada, só o verso. Ao lado, embaixo, o `info` (descrição e palavras-chave).
 * Só o preview fixo recebe o mouse (para passar sobre as palavras-chave); o do Alt não.
 */
export function PiecePreview({
  piece,
  side,
  bounds,
  turned,
  pinned,
  previewFace,
  top = 8,
  info,
  onHoverChange,
}: {
  piece: Piece;
  /** Lado da mesa onde aparece (o oposto ao ponteiro, para não cobrir a peça). */
  side: 'left' | 'right';
  bounds: { width: number; height: number };
  /** Virada para quem olha: o rótulo de reserva não pode ser o id (ele pode revelar a carta). */
  turned: boolean;
  /** Fixado (dois toques no Alt). */
  pinned: boolean;
  previewFace?: (face: string, scale: number) => string;
  /** Distância do topo da mesa (abaixo de uma barra de botões, por exemplo). */
  top?: number;
  /** Ao lado do preview, alinhado embaixo (do lado de dentro da mesa). */
  info?: ReactNode;
  /** O mouse entrou ou saiu do preview fixo. */
  onHoverChange?: (over: boolean) => void;
}) {
  const maxH = Math.min((bounds.height - top) * 0.85, 560);
  const maxW = Math.max(120, Math.min(bounds.width * 0.45, bounds.width - 16 - INFO_ROOM));
  const k = Math.min(maxH / piece.size.h, maxW / piece.size.w);
  const w = Math.round(piece.size.w * k);
  const h = Math.round(piece.size.h * k);
  const face = getFace(piece);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const sharp = isImageUrl(face) ? (previewFace?.(face, k * dpr) ?? face) : undefined;
  // a versão nítida pode demorar: enquanto isso, a imagem que a mesa já tem
  const hiRes = useImage(sharp);
  const base = useImage(isImageUrl(face) ? face : undefined);
  const image = hiRes ?? base;
  const label = isImageUrl(face) ? '' : (face ?? (turned ? '' : piece.id));
  // sair do preview avisa um instante depois: cruzar a borda ou o vão até a descrição não fecha nada
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);

  const picture = (
    <div
      role="img"
      aria-label={pinned ? 'Pré-visualização fixa' : 'Pré-visualização'}
      style={{ ...boxStyle, ...(pinned && { outline: '2px solid #0969da' }) }}
    >
      {image ? (
        <Picture image={image} w={w} h={h} />
      ) : (
        <div style={{ ...placeholderStyle, width: w, height: h, fontSize: Math.max(14, h / 9) }}>
          {label}
        </div>
      )}
    </div>
  );
  return (
    <div
      style={{
        ...rowStyle,
        top,
        [side]: 8,
        flexDirection: side === 'left' ? 'row' : 'row-reverse',
        pointerEvents: pinned ? 'auto' : 'none',
      }}
      onMouseEnter={
        pinned
          ? () => {
              clearTimeout(leaving.current);
              onHoverChange?.(true);
            }
          : undefined
      }
      onMouseLeave={
        pinned
          ? () => {
              leaving.current = setTimeout(() => onHoverChange?.(false), 200);
            }
          : undefined
      }
    >
      {picture}
      {info && <div style={infoStyle}>{info}</div>}
    </div>
  );
}

/** Espaço reservado ao lado do preview para a descrição. */
const INFO_ROOM = 300;

/** Imagem comum vira <img> (SVG continua nítido); desenho (canvas) é copiado na resolução da tela. */
function Picture({ image, w, h }: { image: ImageSource; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const isCanvas = typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement;
  useEffect(() => {
    const c = ref.current;
    if (!c || !isCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, c.width, c.height);
  }, [image, isCanvas, w, h]);
  if (isCanvas) return <canvas ref={ref} style={{ width: w, height: h, display: 'block' }} />;
  return (
    <img
      src={(image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src}
      alt=""
      width={w}
      height={h}
      style={{ display: 'block' }}
    />
  );
}

const rowStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 2,
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
};

const boxStyle: CSSProperties = {
  padding: 6,
  borderRadius: 10,
  background: 'rgb(255 255 255 / 0.95)',
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
};

const infoStyle: CSSProperties = {
  width: INFO_ROOM - 20,
  maxHeight: '100%',
  overflow: 'auto',
};

const placeholderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  boxSizing: 'border-box',
  borderRadius: 8,
  background: '#f6f8fa',
  border: '2px solid #d0d7de',
  color: '#1f2328',
  textAlign: 'center',
  overflowWrap: 'anywhere',
};
