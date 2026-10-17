import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react';
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva';
import {
  childrenOf,
  getFace,
  isAncestor,
  ownerOf,
  zoneSlots,
  type DropTarget,
  type Piece,
  type PieceId,
} from '@/engine/core';
import { isImageUrl } from '@/engine/data';
import { useCheck, useDispatch, useGame, useManager, useView, useViewer } from '@/engine/react';
import { candidateTargets, findDropTarget } from '../drop';
import { defaultGestures, type Gesture } from '../gestures';
import { handIndexAt, inHandBand, layoutHand } from '../hand';
import { buildScene, toLocal } from '../scene';
import type { MenuItem, TableProps } from '../types';
import { useElementSize } from '../useElementSize';
import { zoomAt, type View } from '../view';
import { ContextMenu } from './ContextMenu';
import { PiecePreview } from './PiecePreview';
import { PieceView, type PieceHandlers, type ZoneMark } from './PieceView';

export interface KonvaTableProps extends TableProps {
  /** Acesso ao Stage do Konva (ex.: teste de carga). */
  stageRef?: Ref<Konva.Stage>;
  /** Comandos da mesa para atalhos e botões de fora (câmeras, enquadrar). */
  apiRef?: Ref<TableApi>;
}

/** O que a mesa faz a pedido de fora (ex.: os atalhos de teclado do jogo). */
export interface TableApi {
  /** Enquadra tudo (o "Centralizar"). */
  fit(): void;
  /** Guarda a câmera atual (posição e zoom) na posição `n`. */
  saveCamera(n: number): void;
  /** Volta à câmera guardada na posição `n` (avisa se estiver vazia). */
  loadCamera(n: number): void;
}

interface DragState {
  id: PieceId;
  /** Tudo o que está se movendo (a peça, o grupo e o que estiver dentro deles). */
  moving: ReadonlySet<PieceId>;
  /** Arrasto de várias peças selecionadas: a zona inteira vale, sem encaixe. */
  group: boolean;
  /** Zonas que aceitam a peça → encaixes válidos (vazio em zonas sem encaixe). */
  valid: Map<PieceId, Set<string>>;
  hover: { zone: PieceId; slot?: string } | null;
}

interface DragSession {
  /** Peças do comando: a segurada, ou as selecionadas que o jogador pode mexer. */
  members: PieceId[];
  group: PieceId[]; // os membros e o que estiver dentro deles, em ordem de desenho
  origin: { x: number; y: number };
  starts: Map<PieceId, { x: number; y: number }>;
  indexes: [Konva.Group, number][];
  hoverKey: string;
}

/** Giro de uma zona: o conteúdo gira junto, rígido, em volta do centro dela. */
interface RotateSession {
  group: PieceId[];
  center: { x: number; y: number };
  rotation: number;
  starts: Map<PieceId, { x: number; y: number; rotation: number }>;
}

/** Retângulo de seleção (Shift + arrastar no vazio), em coordenadas da mesa. */
interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Preview de uma peça: qual e de que lado da mesa. */
interface Peek {
  id: PieceId;
  side: 'left' | 'right';
}

/** Dois toques no Alt dentro deste tempo fixam (ou soltam) o preview. */
const DOUBLE_TAP_MS = 400;
/** Tempo com o mouse parado sobre a peça até a dica aparecer. */
const TIP_DELAY_MS = 500;
/** Largura da dica ao lado da peça. */
const TIP_WIDTH = 280;

/** Dica aberta ao lado de uma peça (o retângulo é o da peça na tela, na câmera em que abriu). */
interface Tip {
  id: PieceId;
  rect: { x: number; y: number; width: number; height: number };
  view: View;
}

const HOME: View = { x: 0, y: 0, scale: 1 };
/** Margem ao enquadrar a mesa (px da tela). */
const FIT_MARGIN = 32;
const ZOOM_STEP = 1.1;
const NO_SLOTS: ReadonlySet<string> = new Set();

/**
 * Mesa em Konva. Desenha a cena achatada (zonas antes do conteúdo), transforma gestos em
 * comandos e, durante o arrasto, destaca as zonas e encaixes que aceitam a peça.
 *
 * Seleção: clique seleciona uma peça; Shift/Ctrl/Cmd + clique soma ou tira; Shift + arrastar no
 * vazio faz um retângulo. Arrastar uma peça selecionada leva o grupo todo (comando `dropMany`).
 *
 * Preview: Alt (Option no Mac) com o ponteiro sobre uma peça mostra a peça ampliada; soltar o Alt
 * esconde. Dois toques no Alt sobre uma peça fixam o preview; dois toques de novo o escondem.
 *
 * Câmera: a mesa abre enquadrando tudo (e reenquadra se o tamanho mudar antes de o jogador mexer
 * na câmera). "Centralizar" enquadra de novo. Shift+Alt+1…9 guarda a câmera; Alt+1…9 volta a ela.
 */
export function Table({
  onGesture = defaultGestures,
  filter,
  canDrag,
  onSelect,
  onSelectionChange,
  pickable,
  picked,
  onPick,
  decorate,
  previewFace,
  previewInfo,
  hoverInfo,
  contextMenu,
  nameOf,
  handZoom = 1,
  handInset,
  apiRef,
  preview = true,
  guides = true,
  previewTop,
  controlsStyle,
  className,
  stageRef,
}: KonvaTableProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const manager = useManager();
  const dispatch = useDispatch();
  // a mesa mostra o que o jogador da tela pode ver (áreas privadas de outros escondidas ou viradas)
  const { pieces, faceDown } = useView();
  const viewer = useViewer();
  const check = useCheck();
  const players = useGame((s) => s.game.players);
  // a mão do jogador da tela: as peças dela ficam na faixa embaixo, fora da câmera
  const handId = useMemo(
    () =>
      viewer === null
        ? null
        : (Object.values(pieces).find((p) => p.zone?.hand && ownerOf(pieces, p.id) === viewer)
            ?.id ?? null),
    [pieces, viewer],
  );
  const sceneFilter = useCallback(
    (p: Piece) => (!filter || filter(p)) && (handId === null || p.parentId !== handId),
    [filter, handId],
  );
  const scene = useMemo(() => buildScene(pieces, sceneFilter), [pieces, sceneFilter]);
  const handCards = useMemo(
    () => (handId === null ? [] : childrenOf(pieces, handId)),
    [pieces, handId],
  );
  const [handHover, setHandHover] = useState<PieceId | null>(null);
  const hand = useMemo(
    () => layoutHand(handCards, size, handZoom, handHover, handInset),
    [handCards, size, handZoom, handHover, handInset],
  );
  const handIds = useMemo(() => new Set(handCards.map((c) => c.id)), [handCards]);
  const [view, setView] = useState<View>(HOME);
  const stageNode = useRef<Konva.Stage | null>(null);
  // a câmera: o grupo "mundo" (a mesa) se move e dá zoom; o palco fica parado (é a tela)
  const worldNode = useRef<Konva.Group | null>(null);
  useImperativeHandle(stageRef, () => stageNode.current!, []);
  // o jogador mexeu na câmera depois do último enquadramento (aí um redimensionamento não a muda)
  const moved = useRef(false);
  const cameras = useRef(new Map<number, View>());
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const stopPan = useRef<(() => void) | null>(null);
  // preview com Alt: o que está sob o ponteiro e o estado do Alt ficam em refs (mudam a cada
  // movimento); a tela só redesenha quando o preview muda
  const [peek, setPeek] = useState<Peek | null>(null);
  const [pinned, setPinned] = useState<Peek | null>(null);
  const hovered = useRef<PieceId | null>(null);
  const altHeld = useRef(false);
  const lastAltTap = useRef(-Infinity);
  const pointerSide = useRef<'left' | 'right'>('right');
  // Ctrl (no modo compacto, mostra descrição e palavras-chave) e o mouse sobre o preview fixo
  const [ctrl, setCtrl] = useState(false);
  const ctrlHeld = useRef(false);
  const setCtrlHeld = useCallback((down: boolean) => {
    if (ctrlHeld.current === down) return;
    ctrlHeld.current = down;
    setCtrl(down);
  }, []);
  const [overPreview, setOverPreview] = useState(false);
  // menu do botão direito: no ponto do clique, em coordenadas da mesa na tela
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // dica ao lado da peça: aparece com o mouse parado sobre ela; fica aberta com o mouse em cima
  const [tip, setTip] = useState<Tip | null>(null);
  const tipShow = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipHide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(tipShow.current);
      clearTimeout(tipHide.current);
    },
    [],
  );
  /** Preview temporário: Alt segurado e uma peça sob o ponteiro. */
  const refreshPeek = useCallback(() => {
    const id = altHeld.current ? hovered.current : null;
    setPeek((p) => (id === null ? null : p?.id === id ? p : { id, side: pointerSide.current }));
  }, []);
  useEffect(() => () => stopPan.current?.(), []);
  const [selection, setSelection] = useState<PieceId[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const suppressClick = useRef(false);
  const nodes = useRef(new Map<PieceId, Konva.Group>());
  const transformer = useRef<Konva.Transformer>(null);
  const session = useRef<DragSession | null>(null);
  const rotating = useRef<RotateSession | null>(null);

  /** O jogador da tela só arrasta o que é dele ou sem dono (o Gestor recusaria o resto). */
  const canTouch = (id: PieceId) => {
    if (viewer === null) return true;
    const owner = ownerOf(pieces, id);
    return owner === undefined || owner === viewer;
  };
  const movable = (id: PieceId) =>
    !!pieces[id] && (canDrag ? canDrag(pieces[id]) : true) && canTouch(id);

  const viewNow = useRef(view);
  useEffect(() => {
    viewNow.current = view;
  });
  /** Depois de o mouse parar sobre a peça, abre a dica; ao sair, fecha (a não ser que vá para ela). */
  const scheduleTip = useCallback(() => {
    clearTimeout(tipShow.current);
    const id = hovered.current;
    if (id === null) {
      clearTimeout(tipHide.current);
      tipHide.current = setTimeout(() => setTip(null), 200);
      return;
    }
    clearTimeout(tipHide.current);
    setTip((t) => (t && t.id !== id ? null : t));
    tipShow.current = setTimeout(() => {
      if (hovered.current !== id || altHeld.current || session.current) return;
      const n = nodes.current.get(id);
      if (!n) return;
      const r = n.getClientRect();
      setTip({
        id,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        view: viewNow.current,
      });
    }, TIP_DELAY_MS);
  }, []);

  // Valores atuais para os handlers, que são criados uma vez só (peças memorizadas).
  const current = {
    onGesture,
    onSelect,
    onSelectionChange,
    onPick,
    pickable,
    filter: sceneFilter,
    scene,
    check,
    handId,
    handIds,
    hand,
    handCardIds: handCards.map((c) => c.id),
    /** A mão como ficaria com estas peças (para levar os nós de volta depois de uma jogada). */
    handFor: (all: Record<PieceId, Piece>) =>
      layoutHand(
        handId === null ? [] : childrenOf(all, handId),
        size,
        handZoom,
        handHover,
        handInset,
      ),
    selection,
    movable,
    contextMenu,
    nameOf,
    decorate,
  };
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
  });

  const handlers = useMemo<PieceHandlers>(() => {
    const commandFor = (gesture: Gesture) => {
      const s = manager.getState();
      const piece = s.pieces[gesture.id];
      return piece ? latest.current.onGesture(gesture, piece, s) : null;
    };

    const dropTarget = (id: PieceId, n: Konva.Group, group: PieceId[] = []): DropTarget => {
      const pointer = n.getStage()?.getPointerPosition();
      const center = worldOf(n);
      // em cima da faixa da mão: entra na mão, na posição do ponteiro
      const { handId, hand, handCardIds } = latest.current;
      if (pointer && handId !== null && inHandBand(hand, pointer)) {
        const others = handCardIds.filter((c) => c !== id && !group.includes(c));
        return { zone: handId, index: handIndexAt(hand, others, pointer.x) };
      }
      const v = viewNow.current;
      const point = pointer
        ? { x: (pointer.x - v.x) / v.scale, y: (pointer.y - v.y) / v.scale }
        : center;
      return findDropTarget(
        manager.getState().pieces,
        latest.current.scene,
        id,
        point,
        center,
        group.filter((g) => g !== id),
      );
    };

    /** Zonas (e encaixes) onde soltar a peça seria aceito, perguntando ao Gestor sem aplicar. */
    const validTargets = (id: PieceId, group: PieceId[], members: PieceId[]) => {
      const s = manager.getState();
      const valid = new Map<PieceId, Set<string>>();
      for (const n of latest.current.scene) {
        if (!s.pieces[n.id]?.zone || group.includes(n.id)) continue;
        if (members.length > 1) {
          // grupo: basta a zona aceitar todas (onde exatamente, decide-se ao soltar)
          const target: DropTarget = { zone: n.id };
          const cmd = commandFor({ type: 'dragGroup', id, ids: members, target, at: {} });
          if (cmd && latest.current.check(cmd) === true) valid.set(n.id, new Set());
          continue;
        }
        const slots = new Set<string>();
        let any = false;
        for (const target of candidateTargets(s.pieces, n.id, id)) {
          const cmd = commandFor({ type: 'drag', id, target });
          if (cmd && latest.current.check(cmd) === true) {
            any = true;
            if (target.slot !== undefined) slots.add(target.slot);
          }
        }
        if (any) valid.set(n.id, slots);
      }
      return valid;
    };

    const changeSelection = (next: PieceId[]) => {
      latest.current.selection = next; // dois cliques antes de redesenhar
      setSelection(next);
      latest.current.onSelect?.(next.at(-1) ?? null);
      latest.current.onSelectionChange?.(next);
    };

    /** Centro do nó em coordenadas da mesa (vale para a mão, que fica fora da câmera). */
    const worldOf = (n: Konva.Group) => {
      if (n.getParent() === worldNode.current) return n.position(); // já está na mesa (exato)
      const abs = n.getAbsolutePosition();
      const v = viewNow.current;
      return { x: (abs.x - v.x) / v.scale, y: (abs.y - v.y) / v.scale };
    };

    /** As peças e o que estiver dentro delas, em ordem de desenho (as da mão, no fim). */
    const groupOf = (ids: PieceId[]) => {
      const { pieces } = manager.getState();
      const inScene = latest.current.scene
        .filter((sn) => ids.some((id) => sn.id === id || isAncestor(pieces, id, sn.id)))
        .map((sn) => sn.id);
      return [...inScene, ...ids.filter((id) => latest.current.handIds.has(id))];
    };

    /**
     * Quem vai junto ao arrastar `id`: as peças selecionadas que o jogador pode mexer (se `id` é
     * uma delas), sem as que já estão dentro de outra do grupo. Em ordem de desenho.
     */
    const membersFor = (id: PieceId) => {
      const { selection, movable, scene, handIds, handCardIds } = latest.current;
      if (selection.length < 2 || !selection.includes(id)) return [id];
      const { pieces } = manager.getState();
      // o grupo fica num lugar só: ou na mão, ou na mesa
      const fromHand = handIds.has(id);
      const picked = selection.filter(
        (s) => (s === id || movable(s)) && handIds.has(s) === fromHand,
      );
      if (fromHand) return handCardIds.filter((c) => picked.includes(c));
      const top = picked.filter((s) => !picked.some((o) => o !== s && isAncestor(pieces, o, s)));
      return scene.filter((sn) => top.includes(sn.id)).map((sn) => sn.id);
    };

    /** Onde cada peça do grupo caiu (mesa: coordenadas da mesa; zona 'free': da zona). */
    const positions = (members: PieceId[], target: DropTarget) => {
      const zoneNode =
        target.zone === null ? undefined : latest.current.scene.find((x) => x.id === target.zone);
      const zone = target.zone === null ? undefined : manager.getState().pieces[target.zone];
      const at: Record<PieceId, { x: number; y: number }> = {};
      for (const m of members) {
        const n = nodes.current.get(m);
        if (!n) continue;
        const p = worldOf(n);
        at[m] = zoneNode && zone ? toLocal(zoneNode, zone.size, p) : p;
      }
      return at;
    };

    /** Leva os nós para onde o estado diz: na hora se mudou, animado se o gesto foi recusado. */
    const settle = (ids: PieceId[], animate: boolean) => {
      const { pieces } = manager.getState();
      const placed = new Map(buildScene(pieces, latest.current.filter).map((n) => [n.id, n]));
      const inHand = latest.current.handFor(pieces).slots;
      for (const id of ids) {
        const n = nodes.current.get(id);
        if (!n) continue;
        // a peça mudou de lugar (mão ↔ mesa): o nó vai ser trocado pelo React; este some
        const nodeInHand = n.getLayer()?.name() === 'hand';
        if (inHand.has(id) !== nodeInHand) continue;
        const p = inHand.get(id) ?? placed.get(id);
        if (!p) continue;
        const attrs = { x: p.x, y: p.y, rotation: p.rotation };
        if (animate) n.to({ ...attrs, duration: 0.15 });
        else n.setAttrs(attrs);
      }
    };

    return {
      register(id, n, previous) {
        if (n) nodes.current.set(id, n);
        else if (!previous || nodes.current.get(id) === previous) nodes.current.delete(id);
      },

      select(id, additive = false) {
        if (suppressClick.current) {
          suppressClick.current = false; // fim do retângulo de seleção, não um clique
          return;
        }
        // escolha pendente na mesa: o clique numa peça destacada responde, em vez de selecionar
        const { pickable, onPick } = latest.current;
        if (id !== null && onPick && pickable?.has(id)) {
          onPick(id);
          return;
        }
        const sel = latest.current.selection;
        changeSelection(
          id === null
            ? []
            : !additive
              ? [id]
              : sel.includes(id)
                ? sel.filter((s) => s !== id)
                : [...sel, id],
        );
      },

      selectMany(ids) {
        const sel = latest.current.selection;
        changeSelection([...sel, ...ids.filter((id) => !sel.includes(id))]);
      },

      hover(id, over) {
        if (over) hovered.current = id;
        else if (hovered.current === id) hovered.current = null;
        if (latest.current.handIds.has(id)) {
          setHandHover((h) => (over ? id : h === id ? null : h));
        }
        refreshPeek();
        scheduleTip();
      },

      contextMenu(id) {
        const st = stageNode.current;
        const at = st?.getPointerPosition() ?? { x: 0, y: 0 };
        const s = manager.getState();
        const piece = s.pieces[id];
        if (!piece) return;
        clearTimeout(tipShow.current);
        setTip(null);
        const { selection, movable, check, scene } = latest.current;
        const run = (cmd: ReturnType<typeof commandFor>) => cmd && dispatch(cmd);
        const ok = (cmd: ReturnType<typeof commandFor>) => !!cmd && check(cmd) === true;
        const nameOf = (z: Piece) => {
          const custom = latest.current.nameOf?.(z);
          if (custom) return custom;
          const face = getFace(z);
          return face && !isImageUrl(face) ? face : z.id;
        };
        const items: MenuItem[] = [
          {
            label: 'Preview',
            onSelect: () => {
              setOverPreview(false);
              setPinned({ id, side: pointerSide.current });
            },
          },
        ];
        if (selection.includes(id)) {
          items.push({
            label: 'Tirar da seleção',
            onSelect: () => changeSelection(selection.filter((x) => x !== id)),
          });
        } else {
          items.push({ label: 'Selecionar', onSelect: () => changeSelection([id]) });
          if (selection.length > 0) {
            items.push({
              label: 'Somar à seleção',
              onSelect: () => changeSelection([...selection, id]),
            });
          }
        }

        // Mover: os destinos que aceitam a peça (ou o grupo) agora, como no destaque do arrasto
        if (movable(id)) {
          const members = membersFor(id);
          const group = groupOf(members);
          const multi = members.length > 1;
          const where = new Map(scene.map((n) => [n.id, n]));
          const moveTo = (target: DropTarget): ReturnType<typeof commandFor> => {
            if (!multi) return commandFor({ type: 'drag', id, target });
            // o grupo mantém o arranjo: a peça clicada vai para o centro da zona (ou fica onde está)
            const zoneNode = target.zone === null ? undefined : where.get(target.zone);
            const zone = target.zone === null ? undefined : s.pieces[target.zone];
            const self = where.get(id)!;
            const at: Record<PieceId, { x: number; y: number }> = {};
            for (const m of members) {
              const n = where.get(m);
              if (!n) continue;
              if (!zoneNode || !zone) {
                at[m] = { x: n.x, y: n.y };
                continue;
              }
              const abs = { x: zoneNode.x + (n.x - self.x), y: zoneNode.y + (n.y - self.y) };
              at[m] = toLocal(zoneNode, zone.size, abs);
            }
            const layout = zone?.zone?.layout;
            const ids =
              layout === 'grid' || layout === 'slots'
                ? [id, ...members.filter((m) => m !== id)]
                : members;
            return commandFor({ type: 'dragGroup', id, ids, target, at });
          };
          const targets: MenuItem[] = [];
          const self = where.get(id);
          if (piece.parentId !== null && self) {
            const cmd = moveTo({ zone: null, x: self.x, y: self.y });
            if (ok(cmd))
              targets.push({ label: 'Mesa (solta, onde está)', onSelect: () => run(cmd) });
          }
          for (const [zoneId, slots] of validTargets(id, group, members)) {
            const zone = s.pieces[zoneId];
            if (!zone || (zoneId === piece.parentId && !multi)) continue;
            // grade e encaixes: o primeiro lugar livre que aceita, na ordem da zona
            const slot = slots.size ? zoneSlots(zone.zone!).find((x) => slots.has(x)) : undefined;
            const cmd = moveTo(slot === undefined ? { zone: zoneId } : { zone: zoneId, slot });
            if (ok(cmd)) targets.push({ label: nameOf(zone), onSelect: () => run(cmd) });
          }
          items.push({
            label: multi ? `Mover ${members.length} peças` : 'Mover',
            children: targets,
            disabled: targets.length ? undefined : 'nenhum destino aceita agora',
          });
        }

        // a ação do duplo clique, as áreas da peça e girar
        const use = commandFor({ type: 'activate', id });
        if (ok(use)) items.push({ label: 'Usar (duplo clique)', onSelect: () => run(use) });
        for (const spot of latest.current.decorate?.(piece)?.hotspots ?? []) {
          const cmd = commandFor({ type: 'activate', id, area: spot.id });
          if (ok(cmd))
            items.push({ label: `Usar: ${spot.label ?? spot.id}`, onSelect: () => run(cmd) });
        }
        const turn = commandFor({ type: 'rotate', id, rotation: piece.transform.rotation + 90 });
        if (movable(id) && ok(turn)) items.push({ label: 'Girar 90°', onSelect: () => run(turn) });

        // do jogo
        const members = selection.length > 1 && selection.includes(id) ? selection : [id];
        const extra = latest.current.contextMenu?.(piece, [...members]) ?? [];
        if (extra.length) items.push({ label: '', separator: true }, ...extra);
        setMenu({ x: at.x, y: at.y, items });
      },

      activate(id, area) {
        const cmd = commandFor(
          area === undefined ? { type: 'activate', id } : { type: 'activate', id, area },
        );
        if (cmd) dispatch(cmd);
      },

      dragStart(id, n) {
        clearTimeout(tipShow.current);
        setTip(null);
        const members = membersFor(id);
        const group = groupOf(members);
        const groupNodes = group.flatMap((g) => nodes.current.get(g) ?? []);
        session.current = {
          members,
          group,
          origin: n.position(),
          starts: new Map(groupNodes.map((g) => [g.id(), g.position()])),
          indexes: groupNodes.map((g) => [g, g.zIndex()]),
          hoverKey: '',
        };
        for (const g of groupNodes) g.moveToTop();
        setDrag({
          id,
          moving: new Set(group),
          group: members.length > 1,
          valid: validTargets(id, group, members),
          hover: null,
        });
      },

      dragMove(id, n) {
        const sess = session.current;
        if (!sess) return;
        const dx = n.x() - sess.origin.x;
        const dy = n.y() - sess.origin.y;
        for (const [gid, start] of sess.starts) {
          if (gid !== id) nodes.current.get(gid)?.position({ x: start.x + dx, y: start.y + dy });
        }
        const target = dropTarget(id, n, sess.members);
        const key = `${target.zone}|${target.slot ?? ''}`;
        if (key === sess.hoverKey) return;
        sess.hoverKey = key;
        const hover = target.zone === null ? null : { zone: target.zone, slot: target.slot };
        setDrag((d) => d && { ...d, hover });
      },

      dragEnd(id, n) {
        const sess = session.current;
        session.current = null;
        setDrag(null);
        const members = sess?.members ?? [id];
        const target = dropTarget(id, n, members);
        // devolve a ordem original antes de o React reordenar pelo novo estado
        for (const [g, i] of [...(sess?.indexes ?? [])].sort((a, b) => a[1] - b[1])) g.zIndex(i);
        const before = manager.getState();
        let cmd;
        if (members.length > 1) {
          // em grade e encaixes, a peça segurada vai para onde o ponteiro está
          const layout =
            target.zone === null ? undefined : before.pieces[target.zone]?.zone?.layout;
          const ids =
            layout === 'grid' || layout === 'slots'
              ? [id, ...members.filter((m) => m !== id)]
              : members;
          cmd = commandFor({ type: 'dragGroup', id, ids, target, at: positions(members, target) });
        } else {
          cmd = commandFor({ type: 'drag', id, target });
        }
        if (cmd) dispatch(cmd);
        settle(sess?.group ?? [id], manager.getState() === before);
      },

      transformStart(id, n) {
        const group = groupOf([id]);
        rotating.current = {
          group,
          center: n.position(),
          rotation: n.rotation(),
          starts: new Map(
            group.flatMap((g) => {
              const gn = g === id ? undefined : nodes.current.get(g);
              return gn ? [[g, { ...gn.position(), rotation: gn.rotation() }] as const] : [];
            }),
          ),
        };
      },

      transform(_id, n) {
        const rot = rotating.current;
        if (!rot) return;
        const rad = ((n.rotation() - rot.rotation) * Math.PI) / 180;
        const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
        const { x: cx, y: cy } = n.position();
        for (const [gid, st] of rot.starts) {
          const dx = st.x - rot.center.x;
          const dy = st.y - rot.center.y;
          nodes.current.get(gid)?.setAttrs({
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos,
            rotation: st.rotation + (n.rotation() - rot.rotation),
          });
        }
      },

      transformEnd(id, n) {
        const group = rotating.current?.group ?? [id];
        rotating.current = null;
        const s = manager.getState();
        const piece = s.pieces[id];
        const sn = latest.current.scene.find((x) => x.id === id);
        if (!piece || !sn) return;
        // a rotação do nó inclui a dos pais e a do layout; o comando leva só a da peça
        const rotation = piece.transform.rotation + (n.rotation() - sn.rotation);
        const cmd = commandFor({ type: 'rotate', id, rotation });
        if (cmd) dispatch(cmd);
        settle(group, manager.getState() === s);
      },
    };
  }, [manager, dispatch, refreshPeek, scheduleTip]);

  const marks = useMemo(() => {
    if (!drag) return null;
    const out = new Map<PieceId, ZoneMark>();
    for (const n of scene) {
      if (!pieces[n.id]?.zone || drag.moving.has(n.id)) continue;
      const slots = drag.valid.get(n.id);
      const hover = drag.hover?.zone === n.id;
      const hoverSlot = hover ? drag.hover?.slot : undefined;
      const usesSlots =
        pieces[n.id]!.zone!.layout === 'grid' || pieces[n.id]!.zone!.layout === 'slots';
      out.set(n.id, {
        valid: !!slots,
        validSlots: slots ?? NO_SLOTS,
        hover,
        hoverValid:
          hover &&
          !!slots &&
          (drag.group ||
            !usesSlots ||
            (hoverSlot !== undefined && slots.has(hoverSlot)) ||
            !!pieces[n.id]!.zone!.autoFill),
        hoverSlot,
      });
    }
    return out;
  }, [drag, scene, pieces]);

  // seleção do que ainda está à vista (peça que entrou numa área escondida sai dela)
  const shown = useMemo(() => selection.filter((id) => pieces[id]), [selection, pieces]);
  const multi = useMemo(() => (shown.length > 1 ? new Set(shown) : null), [shown]);
  // girar (Transformer) só com uma peça selecionada
  const selectedNode = shown.length === 1 && !handIds.has(shown[0]!) ? shown[0]! : null;
  useEffect(() => {
    const tr = transformer.current;
    if (!tr) return;
    const n = selectedNode ? nodes.current.get(selectedNode) : undefined;
    tr.nodes(n ? [n] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedNode, scene]);

  /**
   * Botão do meio: sempre move a mesa, mesmo em cima de uma peça. O aperto é parado antes de
   * chegar ao Konva (fase de captura), então nenhuma peça é arrastada, selecionada ou girada.
   */
  const onMiddleDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault(); // sem a rolagem automática do navegador
    e.stopPropagation();
    beginPan(e.clientX, e.clientY, e.currentTarget, 1);
  };

  /**
   * Move a mesa acompanhando o mouse até soltar o botão (`button`: 0 esquerdo, 1 do meio). O
   * soltar do botão do meio não chega ao Konva; o do esquerdo chega, mas não vira clique.
   */
  const beginPan = (clientX: number, clientY: number, box: HTMLElement, button: number) => {
    stopPan.current?.();
    const start = { x: clientX, y: clientY, vx: view.x, vy: view.y };
    let dragged = false;
    const move = (ev: MouseEvent) => {
      if (!dragged && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
      if (!dragged) {
        dragged = true;
        moved.current = true;
        box.style.cursor = 'grabbing';
      }
      setView((v) => ({
        ...v,
        x: start.vx + ev.clientX - start.x,
        y: start.vy + ev.clientY - start.y,
      }));
    };
    const up = (ev: MouseEvent) => {
      if (ev.button !== button) return;
      if (button === 1) ev.stopPropagation(); // o Konva também não vê o soltar
      if (dragged) suppressClick.current = true; // arrastou: não é um clique no vazio
      stop();
    };
    const stop = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      box.style.cursor = '';
      stopPan.current = null;
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
    stopPan.current = stop;
  };

  // Alt: segurar mostra o preview; dois toques fixam ou soltam. Também vale o Alt repassado pela
  // página do site (o iframe do jogo pode estar sem o foco do teclado).
  useEffect(() => {
    const setAlt = (down: boolean) => {
      altHeld.current = down;
      refreshPeek();
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true);
      if (e.key !== 'Alt') return;
      e.preventDefault(); // no Windows, o Alt sozinho iria para o menu do navegador
      if (e.repeat) return;
      setAlt(true);
      clearTimeout(tipShow.current);
      setTip(null); // o preview grande toma o lugar da dica
      const now = performance.now();
      if (now - lastAltTap.current > DOUBLE_TAP_MS) {
        lastAltTap.current = now;
        return;
      }
      lastAltTap.current = -Infinity; // o próximo toque começa outro par
      const id = hovered.current;
      setOverPreview(false);
      setPinned((p) => (p ? null : id === null ? null : { id, side: pointerSide.current }));
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false);
      if (e.key !== 'Alt') return;
      e.preventDefault();
      setAlt(false);
    };
    const onBlur = () => {
      setAlt(false);
      setCtrlHeld(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [refreshPeek, setCtrlHeld]);

  /** Enquadra tudo o que está na mesa (sem passar de 100%). */
  const fit = useCallback(() => {
    const world = worldNode.current;
    if (!world || size.width <= 0 || size.height <= 0) return;
    const box = world.getClientRect({ relativeTo: world, skipShadow: true });
    moved.current = false;
    if (!(box.width > 0 && box.height > 0)) {
      setView(HOME);
      return;
    }
    const scale = Math.min(
      1,
      (size.width - 2 * FIT_MARGIN) / box.width,
      (size.height - 2 * FIT_MARGIN) / box.height,
    );
    setView({
      scale,
      x: size.width / 2 - (box.x + box.width / 2) * scale,
      y: size.height / 2 - (box.y + box.height / 2) * scale,
    });
  }, [size.width, size.height]);

  // abre enquadrando; se o tamanho mudar (tela cheia, janela) antes de o jogador mexer, de novo
  useEffect(() => {
    if (!moved.current) fit();
  }, [fit]);

  const note = (text: string) => {
    setCameraNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setCameraNote(null), 1500);
  };
  const noteRef = useRef(note);
  useEffect(() => {
    noteRef.current = note;
  });

  // câmeras guardadas, como no Tabletop Simulator (a tecla de cada uma é configurável: quem chama
  // é a lista de atalhos, por `apiRef`)
  useImperativeHandle(
    apiRef,
    () => ({
      fit: () => fit(),
      saveCamera(n) {
        cameras.current.set(n, viewNow.current);
        noteRef.current(`Câmera ${n} salva`);
      },
      loadCamera(n) {
        const saved = cameras.current.get(n);
        if (!saved) {
          noteRef.current(`Câmera ${n} vazia`);
          return;
        }
        moved.current = true;
        setView(saved);
        noteRef.current(`Câmera ${n}`);
      },
    }),
    [fit],
  );

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    moved.current = true;
    setView((v) => zoomAt(v, pointer, e.evt.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP));
  };
  const onStageClick = (e: KonvaEventObject<unknown>) => {
    if (e.target === e.currentTarget) handlers.select(null);
  };

  /** Ponteiro em coordenadas da mesa (pela câmera). */
  const pointerOf = (stage: Konva.Stage) => {
    const p = stage.getPointerPosition();
    return p && { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
  };
  const onStageMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    suppressClick.current = false;
    if ((e.evt?.button ?? 0) !== 0) return;
    const stage = e.currentTarget as Konva.Stage;
    // no vazio, ou numa peça que não se arrasta (um tabuleiro, uma zona fixa)
    if (e.target !== stage) {
      const piece = e.target.findAncestor('.piece', true) as Konva.Group | undefined;
      if (!piece || piece.draggable()) return;
    }
    if (!e.evt?.shiftKey) {
      // arrastar move a mesa
      const box = stage.container().parentElement;
      if (box && e.evt) beginPan(e.evt.clientX, e.evt.clientY, box, 0);
      return;
    }
    // Shift + arrastar: retângulo de seleção
    const p = pointerOf(stage);
    if (!p) return;
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onStageMouseMove = (e: KonvaEventObject<MouseEvent>) => {
    // o preview fica do lado oposto ao ponteiro; o Alt também vem no próprio movimento
    const at = e.currentTarget.getStage()?.getPointerPosition();
    if (at) pointerSide.current = at.x < size.width / 2 ? 'right' : 'left';
    const alt = !!e.evt?.altKey;
    if (alt !== altHeld.current) {
      altHeld.current = alt;
      refreshPeek();
    }
    setCtrlHeld(!!e.evt?.ctrlKey);
    if (!marquee) return;
    const p = pointerOf(e.currentTarget as Konva.Stage);
    if (p) setMarquee((m) => m && { ...m, x1: p.x, y1: p.y });
  };
  const onStageMouseUp = () => {
    if (!marquee) return;
    setMarquee(null);
    const x = Math.min(marquee.x0, marquee.x1);
    const y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0);
    const h = Math.abs(marquee.y1 - marquee.y0);
    if (w < 3 && h < 3) return;
    suppressClick.current = true;
    // entram as peças que o jogador pode mexer e que ficaram inteiras dentro do retângulo
    const inside = scene
      .filter((n) => movable(n.id))
      .filter((n) => {
        const r = nodes.current.get(n.id)?.getClientRect({ relativeTo: worldNode.current! });
        return !!r && r.x >= x && r.y >= y && r.x + r.width <= x + w && r.y + r.height <= y + h;
      })
      .map((n) => n.id);
    handlers.selectMany(inside);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={containerStyle}
      onMouseDownCapture={onMiddleDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageNode}
        width={size.width}
        height={size.height}
        onWheel={onWheel}
        onClick={onStageClick}
        onTap={onStageClick}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onMouseUp={onStageMouseUp}
      >
        <Layer>
          <Group
            ref={worldNode}
            name="world"
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
          >
            {scene.map((n) => (
              <PieceView
                key={n.id}
                id={n.id}
                x={n.x}
                y={n.y}
                rotation={n.rotation}
                scale={n.scale}
                draggable={(canDrag ? canDrag(pieces[n.id]!) : true) && canTouch(n.id)}
                locked={!canTouch(n.id)}
                pick={pickable?.has(n.id) ? (picked?.has(n.id) ? 'picked' : 'option') : undefined}
                selected={multi?.has(n.id)}
                decoration={decorate?.(pieces[n.id]!)}
                showHotspots={selectedNode === n.id}
                guides={guides}
                ownerColor={pieces[n.id]!.owner ? players[pieces[n.id]!.owner!]?.color : undefined}
                mark={marks?.get(n.id)}
                handlers={handlers}
              />
            ))}
          </Group>
        </Layer>
        <Layer name="hand">
          {drag &&
            handId !== null &&
            (() => {
              const valid = drag.valid.has(handId);
              const over = drag.hover?.zone === handId;
              if (!valid && !over) return null;
              return (
                <Rect
                  {...hand.band}
                  fill={
                    over
                      ? valid
                        ? 'rgb(9 105 218 / 0.22)'
                        : 'rgb(207 34 46 / 0.18)'
                      : 'rgb(45 164 78 / 0.14)'
                  }
                  listening={false}
                />
              );
            })()}
          {hand.order.map((id) => {
            const slot = hand.slots.get(id)!;
            return (
              <PieceView
                key={id}
                id={id}
                x={slot.x}
                y={slot.y}
                rotation={slot.rotation}
                scale={slot.scale}
                draggable={(canDrag ? canDrag(pieces[id]!) : true) && canTouch(id)}
                locked={!canTouch(id)}
                pick={pickable?.has(id) ? (picked?.has(id) ? 'picked' : 'option') : undefined}
                selected={multi?.has(id) ?? shown.includes(id)}
                decoration={decorate?.(pieces[id]!)}
                guides={guides}
                handlers={handlers}
              />
            );
          })}
        </Layer>
        <Layer>
          <Transformer
            ref={transformer}
            resizeEnabled={false}
            flipEnabled={false}
            rotationSnaps={[0, 90, 180, 270]}
            rotationSnapTolerance={8}
          />
          {marquee && (
            <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
              <Rect
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
                fill="rgb(9 105 218 / 0.12)"
                stroke="#0969da"
                strokeWidth={1 / view.scale}
                listening={false}
              />
            </Group>
          )}
        </Layer>
      </Stage>
      {(() => {
        // o preview do Alt vence o fixado enquanto o Alt está segurado
        const shown = preview ? (peek ?? pinned) : null;
        const piece = shown ? pieces[shown.id] : undefined;
        if (!shown || !piece || (piece.zone && !isImageUrl(getFace(piece)))) return null;
        const isPinned = !peek;
        const info = previewInfo?.(piece, {
          turned: faceDown.has(piece.id),
          pinned: isPinned,
          ctrl,
          over: isPinned && overPreview,
        });
        return (
          <PiecePreview
            piece={piece}
            side={shown.side}
            bounds={size}
            turned={faceDown.has(piece.id)}
            pinned={isPinned}
            previewFace={previewFace}
            top={previewTop}
            info={info}
            onHoverChange={setOverPreview}
          />
        );
      })()}
      {(() => {
        // dica ao lado da peça: só parada (sem arrasto, sem o preview do Alt, na mesma câmera)
        if (!tip || !hoverInfo || peek || drag || tip.view !== view) return null;
        const piece = pieces[tip.id];
        if (!piece) return null;
        const content = hoverInfo(piece, {
          turned: faceDown.has(piece.id),
          pinned: false,
          ctrl,
          over: false,
        });
        if (!content) return null;
        const { rect } = tip;
        const right = rect.x + rect.width + 8 + TIP_WIDTH <= size.width;
        let place: CSSProperties;
        if (handIds.has(tip.id)) {
          // na mão: em cima da carta (ao lado, cobriria as vizinhas)
          place = {
            left: Math.max(
              8,
              Math.min(rect.x + rect.width / 2 - TIP_WIDTH / 2, size.width - TIP_WIDTH - 8),
            ),
            bottom: size.height - rect.y + 8,
            maxHeight: Math.max(120, rect.y - 16),
          };
        } else {
          // na metade de baixo, cresce para cima (alinhada à base da peça), para caber na mesa
          const below = rect.y + rect.height / 2 > size.height / 2;
          const room = below ? rect.y + rect.height - 8 : size.height - Math.max(8, rect.y) - 8;
          place = {
            ...(below
              ? { bottom: Math.max(8, size.height - (rect.y + rect.height)) }
              : { top: Math.max(8, rect.y) }),
            maxHeight: Math.max(120, room),
            ...(right ? { left: rect.x + rect.width + 8 } : { right: size.width - rect.x + 8 }),
          };
        }
        return (
          <div
            role="tooltip"
            style={{ ...tipStyle, ...place }}
            onMouseEnter={() => clearTimeout(tipHide.current)}
            onMouseLeave={() => {
              tipHide.current = setTimeout(() => setTip(null), 200);
            }}
          >
            {content}
          </div>
        );
      })()}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          bounds={size}
          onClose={() => setMenu(null)}
        />
      )}
      <div style={{ ...hudStyle, ...controlsStyle }}>
        <span>{Math.round(view.scale * 100)}%</span>
        <button onClick={fit} title="Enquadrar tudo o que está na mesa">
          Centralizar
        </button>
        {cameraNote && <span role="status">{cameraNote}</span>}
      </div>
    </div>
  );
}

const tipStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 3,
  width: TIP_WIDTH,
  overflow: 'auto',
};

/** Quem usa a mesa define a altura (pela className ou pelo pai). */
const containerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
};

const hudStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '4px 8px',
  borderRadius: 6,
  background: 'rgb(255 255 255 / 0.85)',
  font: '12px system-ui, sans-serif',
};
