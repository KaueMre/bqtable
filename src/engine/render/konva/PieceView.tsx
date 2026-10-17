import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { memo, useCallback } from 'react';
import { Group, Image as KonvaImage, Rect, Text } from 'react-konva';
import { getFace, gridSlot, type Piece, type PieceId } from '@/engine/core';
import { useViewFaceDown, useViewPiece } from '@/engine/react';
import { DEFAULT_SLOT_SIZE } from '../layouts';
import type { Badge, PieceDecoration } from '../types';
import { isImageUrl, useImage, type ImageSource } from '@/engine/data';

/** Gestos que a mesa trata; cada peça só repassa. Objeto estável (não quebra o memo). */
export interface PieceHandlers {
  /** O nó da peça apareceu (`node`) ou saiu (`null`, só se ainda for o mesmo nó dela). */
  register(id: PieceId, node: Konva.Group | null, previous?: Konva.Group): void;
  /** `additive` (Shift, Ctrl ou Cmd): soma ou tira da seleção, em vez de trocar. */
  select(id: PieceId | null, additive?: boolean): void;
  /** Soma estas peças à seleção (retângulo de seleção). */
  selectMany(ids: PieceId[]): void;
  activate(id: PieceId, area?: string): void;
  /** O ponteiro entrou (`true`) ou saiu da peça: para o preview com Alt. */
  hover(id: PieceId, over: boolean): void;
  /** Botão direito na peça. */
  contextMenu(id: PieceId): void;
  dragStart(id: PieceId, node: Konva.Group): void;
  dragMove(id: PieceId, node: Konva.Group): void;
  dragEnd(id: PieceId, node: Konva.Group): void;
  transformStart(id: PieceId, node: Konva.Group): void;
  transform(id: PieceId, node: Konva.Group): void;
  transformEnd(id: PieceId, node: Konva.Group): void;
}

/** Destaque de uma zona durante o arrasto. */
export interface ZoneMark {
  valid: boolean; // aceita a peça em algum lugar
  validSlots: ReadonlySet<string>;
  hover: boolean; // o ponteiro está sobre ela
  hoverValid: boolean; // soltar aqui agora seria aceito
  hoverSlot?: string;
}

interface PieceViewProps {
  id: PieceId;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  draggable: boolean;
  mark?: ZoneMark;
  /** Cor do jogador dono (contorno). */
  ownerColor?: string;
  /** De outro jogador: arrastar não move a peça nem a mesa (não vira pan). */
  locked?: boolean;
  /** Numa escolha na mesa: pode ser escolhida (`option`) ou já foi marcada (`picked`). */
  pick?: 'option' | 'picked';
  /** Faz parte de uma seleção de várias peças (contorno azul). */
  selected?: boolean;
  /** Selos e áreas clicáveis (do jogo). */
  decoration?: PieceDecoration;
  /** Mostra o contorno das áreas clicáveis (a peça está selecionada). */
  showHotspots?: boolean;
  /** Contornos, casas e rótulos das zonas (fora do arrasto). Padrão: sim. */
  guides?: boolean;
  handlers: PieceHandlers;
}

const node = (e: KonvaEventObject<unknown>) => e.currentTarget as Konva.Group;
const additive = (e: KonvaEventObject<unknown>) => {
  const ev = e.evt as Partial<MouseEvent> | undefined;
  return !!(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey);
};

/** Desenha uma peça (ou zona) na posição absoluta da cena. Re-renderiza só quando ela muda. */
export const PieceView = memo(function PieceView({
  id,
  x,
  y,
  rotation,
  scale,
  draggable,
  mark,
  ownerColor,
  locked,
  pick,
  selected,
  decoration,
  showHotspots,
  guides = true,
  handlers,
}: PieceViewProps) {
  const piece = useViewPiece(id); // como o jogador da tela vê (virada, se for o caso)
  const face = piece ? getFace(piece) : undefined;
  const image = useImage(isImageUrl(face) ? face : undefined);
  // a mesma peça pode trocar de camada (da mão para a mesa) num redesenho: quem sai só apaga o
  // registro se ele ainda for o seu
  const ref = useCallback(
    (n: Konva.Group | null) => {
      if (!n) return;
      handlers.register(id, n);
      return () => handlers.register(id, null, n);
    },
    [id, handlers],
  );
  // virada para quem olha: o rótulo de reserva não pode ser o id (ele pode revelar a carta)
  const turned = useViewFaceDown(id);
  if (!piece) return null;
  const { w, h } = piece.size;
  const fallback = turned ? '' : id;
  const label = isImageUrl(face) ? fallback : (face ?? fallback);
  const select = (e: KonvaEventObject<unknown>) => {
    e.cancelBubble = true;
    handlers.select(id, additive(e));
  };
  // o "apertar" não chega à mesa: sem isso, arrastar a peça de outro jogador arrastaria a mesa
  const hold = (e: KonvaEventObject<unknown>) => {
    if (locked) e.cancelBubble = true;
  };
  // duplo clique: com áreas clicáveis, leva a área sob o ponteiro
  const activate = (e: KonvaEventObject<unknown>) => {
    const spots = decoration?.hotspots;
    const p = spots?.length ? node(e).getRelativePointerPosition() : null;
    const area = p
      ? spots!.find((s) => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h)?.id
      : undefined;
    handlers.activate(id, area);
  };

  return (
    <Group
      ref={ref}
      id={id}
      name={piece.zone ? 'piece zone' : 'piece'}
      x={x}
      y={y}
      rotation={rotation}
      scaleX={scale}
      scaleY={scale}
      offsetX={w / 2}
      offsetY={h / 2}
      draggable={draggable}
      dragDistance={3}
      onDragStart={(e) => handlers.dragStart(id, node(e))}
      onDragMove={(e) => handlers.dragMove(id, node(e))}
      onDragEnd={(e) => handlers.dragEnd(id, node(e))}
      onTransformStart={(e) => handlers.transformStart(id, node(e))}
      onTransform={(e) => handlers.transform(id, node(e))}
      onTransformEnd={(e) => handlers.transformEnd(id, node(e))}
      onMouseDown={hold}
      onTouchStart={hold}
      onContextMenu={(e) => {
        e.evt?.preventDefault?.();
        e.cancelBubble = true;
        handlers.contextMenu(id);
      }}
      onMouseEnter={() => handlers.hover(id, true)}
      onMouseLeave={() => handlers.hover(id, false)}
      onClick={select}
      onTap={select}
      onDblClick={activate}
      onDblTap={activate}
    >
      {piece.zone ? (
        <ZoneBody
          piece={piece}
          image={image}
          // zona com imagem não tem rótulo (o id não é nome); com texto, o texto é o nome dela
          label={isImageUrl(face) ? '' : label}
          mark={mark}
          ownerColor={ownerColor}
          guide={guides && piece.zone.outline !== false}
        />
      ) : image ? (
        <KonvaImage image={image} width={w} height={h} perfectDrawEnabled={false} />
      ) : (
        <Placeholder w={w} h={h} label={label} />
      )}
      {ownerColor && !piece.zone && (
        <Rect
          width={w}
          height={h}
          cornerRadius={Math.min(w, h) * 0.06}
          stroke={ownerColor}
          strokeWidth={3}
          listening={false}
        />
      )}
      {showHotspots &&
        decoration?.hotspots?.map((s) => (
          <Group key={s.id} x={s.x} y={s.y} listening={false}>
            <Rect width={s.w} height={s.h} stroke={COLORS.hotspot} strokeWidth={2} dash={[5, 4]} />
            {s.label && (
              <Text
                x={3}
                y={3}
                text={s.label}
                fontSize={Math.max(9, Math.min(w, h) / 12)}
                fill={COLORS.hotspot}
              />
            )}
          </Group>
        ))}
      {decoration?.badges?.map((b, i) => (
        <BadgeView key={i} badge={b} w={w} h={h} />
      ))}
      {selected && (
        <Rect
          x={-3}
          y={-3}
          width={w + 6}
          height={h + 6}
          cornerRadius={Math.min(w, h) * 0.07}
          stroke={COLORS.selected}
          strokeWidth={3}
          listening={false}
        />
      )}
      {pick && (
        <Rect
          x={-4}
          y={-4}
          width={w + 8}
          height={h + 8}
          cornerRadius={Math.min(w, h) * 0.08}
          stroke={pick === 'picked' ? COLORS.picked : COLORS.pickable}
          strokeWidth={pick === 'picked' ? 5 : 4}
          dash={pick === 'picked' ? undefined : [10, 6]}
          listening={false}
        />
      )}
    </Group>
  );
});

const COLORS = {
  idle: 'rgb(255 255 255 / 0.5)',
  valid: '#2da44e',
  hover: '#0969da',
  invalid: '#cf222e',
  slot: 'rgb(255 255 255 / 0.35)',
  validFill: 'rgb(45 164 78 / 0.25)',
  pickable: '#d4a72c',
  selected: '#0969da',
  hotspot: '#8250df',
  picked: '#2da44e',
  hoverFill: 'rgb(9 105 218 / 0.35)',
};

/** Fundo da zona, contorno de destaque e encaixes (casas da grade ou slots). */
function ZoneBody({
  piece,
  image,
  label,
  mark,
  ownerColor,
  guide,
}: {
  piece: Piece;
  image?: ImageSource;
  label: string;
  mark?: ZoneMark;
  ownerColor?: string;
  /** Desenha contorno, casas e rótulo parados. Sem ele, só o destaque de um arrasto aparece. */
  guide: boolean;
}) {
  const spec = piece.zone!;
  const { w, h } = piece.size;
  const idle = ownerColor ?? COLORS.idle;
  const outline = !mark
    ? idle
    : mark.hover
      ? mark.hoverValid
        ? COLORS.hover
        : COLORS.invalid
      : mark.valid
        ? COLORS.valid
        : idle;
  const slotFill = (slot: string) =>
    mark?.hoverSlot === slot && mark.hoverValid
      ? COLORS.hoverFill
      : mark?.validSlots.has(slot)
        ? COLORS.validFill
        : undefined;

  const cells: { key: string; x: number; y: number; w: number; h: number; rotation: number }[] = [];
  if (spec.layout === 'grid') {
    const { cols, rows, cell } = spec.grid!;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const key = gridSlot(col, row);
        cells.push({ key, x: (col + 0.5) * cell.w, y: (row + 0.5) * cell.h, ...cell, rotation: 0 });
      }
    }
  } else if (spec.layout === 'slots') {
    const size = spec.slotSize ?? DEFAULT_SLOT_SIZE;
    for (const s of spec.slots!) {
      cells.push({ key: s.id, x: s.x, y: s.y, ...size, rotation: s.rotation ?? 0 });
    }
  }

  return (
    <>
      {image ? (
        <KonvaImage image={image} width={w} height={h} />
      ) : (
        // sem guia, a zona continua clicável (área transparente)
        <Rect
          width={w}
          height={h}
          cornerRadius={8}
          fill={guide ? 'rgb(255 255 255 / 0.08)' : 'transparent'}
        />
      )}
      {cells
        .filter((c) => guide || slotFill(c.key) !== undefined)
        .map((c) => (
          <Rect
            key={c.key}
            x={c.x}
            y={c.y}
            width={c.w - 4}
            height={c.h - 4}
            offsetX={(c.w - 4) / 2}
            offsetY={(c.h - 4) / 2}
            rotation={c.rotation}
            cornerRadius={4}
            stroke={COLORS.slot}
            dash={[4, 4]}
            fill={slotFill(c.key)}
            listening={false}
          />
        ))}
      {(guide || mark?.valid || mark?.hover) && (
        <Rect
          width={w}
          height={h}
          cornerRadius={8}
          stroke={outline}
          strokeWidth={mark?.hover ? 4 : mark?.valid || ownerColor ? 3 : 1.5}
          dash={mark?.valid || mark?.hover ? undefined : [8, 6]}
          listening={false}
        />
      )}
      {/* rótulo acima da borda, para o conteúdo não cobrir */}
      {guide && label && (
        <Text
          x={4}
          y={-16}
          text={label}
          fontSize={12}
          fill="rgb(255 255 255 / 0.85)"
          listening={false}
        />
      )}
    </>
  );
}

/** Selo num canto: fundo arredondado com o texto (tamanho aproximado pelo número de letras). */
function BadgeView({ badge, w, h }: { badge: Badge; w: number; h: number }) {
  const size = Math.max(10, Math.min(w, h) * 0.14);
  const height = size * 1.5;
  const width = Math.max(height, size * 0.62 * badge.text.length + size * 0.8);
  const corner = badge.corner ?? 'tr';
  const x = corner.endsWith('l') ? 3 : w - width - 3;
  const y = corner.startsWith('t') ? 3 : h - height - 3;
  return (
    <Group x={x} y={y} listening={false}>
      <Rect
        width={width}
        height={height}
        cornerRadius={height / 2}
        fill={badge.background ?? 'rgb(31 35 40 / 0.85)'}
      />
      <Text
        width={width}
        height={height}
        text={badge.text}
        fontSize={size}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        fill={badge.color ?? '#fff'}
      />
    </Group>
  );
}

/** Retângulo com texto enquanto não há arte (ou a imagem não carregou). */
function Placeholder({ w, h, label }: { w: number; h: number; label: string }) {
  return (
    <>
      <Rect
        width={w}
        height={h}
        cornerRadius={Math.min(w, h) * 0.06}
        fill={`hsl(${hue(label)} 45% 88%)`}
        stroke={`hsl(${hue(label)} 40% 35%)`}
        strokeWidth={2}
        perfectDrawEnabled={false}
      />
      <Text
        width={w}
        height={h}
        padding={6}
        text={label}
        align="center"
        verticalAlign="middle"
        fontSize={Math.max(10, Math.min(w, h) / 7)}
        fill="#1f2328"
      />
    </>
  );
}

function hue(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
