import Konva from 'konva';
import type { PieceId, Size } from '@/engine/core';
import {
  ARROW_HEAD,
  arrowPath,
  ease,
  flightFrame,
  glowAt,
  insidePiece,
  lerpPose,
  planFlight,
  shakeAt,
  showcaseSpots,
  type AfterSpec,
  type ArrowShape,
  type Flight,
  type FlightInput,
  type MotionSpec,
  type Move,
  type Place,
  type PlaceSpec,
  type Pose,
} from '../motion';
import type { View } from '../view';

/** O que o diretor precisa da mesa. Tudo lido na hora (a mesa muda entre um quadro e outro). */
export interface MotionHost {
  /** Camada de cima, sem eventos: fantasmas, sombras, luzes e a flecha. */
  layer(): Konva.Layer | null;
  node(id: PieceId): Konva.Group | undefined;
  /** Onde o React desenha a peça agora, no referencial do pai do nó (mesa ou faixa da mão). */
  place(id: PieceId): Place | undefined;
  size(id: PieceId): Size | undefined;
  view(): View;
  screen(): { width: number; height: number };
}

/** O que mudou numa jogada, para animar. */
export interface MotionBatch {
  moves: readonly Move[];
  appeared: readonly PieceId[];
  specs: ReadonlyMap<PieceId, MotionSpec>;
  /** De onde a peça sai (px da tela), no lugar do desenho de antes: onde o jogador a soltou. */
  origins: ReadonlyMap<PieceId, Pose>;
  /** O jogador levou estas peças com o mouse até o lugar: não deslizam de novo. */
  handled: ReadonlySet<PieceId>;
  /** Lugares de passagem, na mesa. */
  stops: ReadonlyMap<PieceId, readonly Pose[]>;
  /** Desfazer: volta deslizando, sem evidência nem efeito depois. */
  undo: boolean;
  /** Outra pessoa passou a olhar a tela: só anima quem mudou de lugar no estado. */
  viewerChanged: boolean;
}

/** Cor da flecha: sem alvo, alvo que aceita, alvo que recusa. */
export type AimState = 'idle' | 'valid' | 'invalid';

export interface MotionDirector {
  play(batch: MotionBatch): void;
  /** O nó da peça apareceu: se ela está voando, ele fica escondido até ela chegar. */
  attach(id: PieceId, node: Konva.Group): void;
  /** Pose da peça na tela agora (um voo em andamento conta). */
  poseOf(id: PieceId): Pose | undefined;
  /** Para os efeitos depois de chegar (outra jogada aconteceu, ou o jogador pegou uma peça). */
  stopAfter(): void;
  /** Estas peças chegam na hora (o jogador pegou uma delas no meio do voo). */
  land(ids: readonly PieceId[]): void;
  /** Começo da mira (`drag: "arrow"`): as peças ficam paradas e uma flecha sai de `held`. */
  aimStart(held: PieceId, ids: readonly PieceId[]): void;
  /** O ponteiro andou (px da tela). */
  aimMove(pointer: { x: number; y: number }, state: AimState): void;
  /** Fim da mira: as peças voltam a aparecer; devolve onde estavam (px da tela). */
  aimEnd(): Map<PieceId, Pose>;
  /** Para tudo e deixa as peças onde o estado diz (outra partida, a mesa saiu). */
  reset(): void;
}

const ARROW_COLORS: Record<AimState, string> = {
  idle: '#f6f8fa',
  valid: '#0969da',
  invalid: '#cf222e',
};
/** Numa jogada: além disso, as peças vão direto (um embaralhar não vira chuva de cartas). */
const MAX_FLIGHTS = 40;
const MAX_SLIDES = 60;
/** Mais que isso em evidência de uma vez: vão direto para o destino. */
const MAX_SHOWCASE = 6;
/** Deslize de quem só se ajeitou (vizinha saiu, a mão se reorganizou). */
const SLIDE_MS = 200;
/** Folga da luz em volta da peça (px). */
const GLOW_PAD = 5;

interface FlightRun {
  id: PieceId;
  flight: Flight;
  t0: number;
  ghost: Konva.Group;
  shadow: Konva.Rect | null;
  after: AfterSpec | null;
  last: Pose;
}

interface SlideRun {
  id: PieceId;
  from: Place;
  t0: number;
  last: Place;
}

interface AfterRun {
  id: PieceId;
  spec: AfterSpec;
  t0: number;
  glow: Konva.Rect | null;
  /** Tremor: o último deslocamento posto no nó (parado entre tremores, não redesenha). */
  shaken?: string;
}

interface AimRun {
  held: PieceId;
  ghosts: Map<PieceId, { ghost: Konva.Group; pose: Pose }>;
  ring: Konva.Rect | null;
  arrow: Konva.Shape;
  shape: ArrowShape | null;
  color: string;
}

/** Pose do nó na tela (o centro: as peças têm o offset no meio). */
function poseOfNode(n: Konva.Node): Pose {
  const p = n.getAbsolutePosition();
  return { x: p.x, y: p.y, rotation: n.getAbsoluteRotation(), scale: n.getAbsoluteScale().x };
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cópia da peça para voar por cima de tudo (o nó de verdade fica escondido no lugar). */
function ghostOf(node: Konva.Group): Konva.Group {
  return node.clone({
    id: '',
    name: 'motion-ghost',
    listening: false,
    draggable: false,
    opacity: 1,
    visible: true,
  }) as Konva.Group;
}

/** Contorno com luz em volta de uma peça (posto em `placeGlow`). */
function glowRect(color: string): Konva.Rect {
  return new Konva.Rect({
    name: 'motion-glow',
    listening: false,
    stroke: color,
    strokeWidth: 3,
    shadowColor: color,
    shadowBlur: 18,
    shadowOpacity: 1,
    opacity: 0,
  });
}

function placeGlow(rect: Konva.Rect, pose: Pose, size: Size, opacity: number) {
  const w = size.w * pose.scale + GLOW_PAD * 2;
  const h = size.h * pose.scale + GLOW_PAD * 2;
  rect.setAttrs({
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    width: w,
    height: h,
    offsetX: w / 2,
    offsetY: h / 2,
    cornerRadius: Math.min(size.w, size.h) * pose.scale * 0.07 + GLOW_PAD,
    opacity,
  });
}

/**
 * Anima as peças da mesa, sem passar pelo React: o React desenha cada peça no lugar novo, e o
 * diretor, logo depois (antes do quadro), esconde o nó e faz uma cópia dele voar por cima de tudo,
 * do lugar de antes até o nó. Quem só se ajeitou (vizinha que saiu da fila) desliza no próprio nó.
 * O tremor mexe no nó; a luz e a flecha são desenhos na camada de cima.
 */
export function createMotionDirector(host: MotionHost): MotionDirector {
  const flights = new Map<PieceId, FlightRun>();
  const slides = new Map<PieceId, SlideRun>();
  const afters = new Map<PieceId, AfterRun>();
  let aim: AimRun | null = null;
  let frame = 0;
  /** Quando a evidência fica livre para a próxima leva (ms, `performance.now`). */
  let spotlightFree = 0;

  const now = () => performance.now();
  const hiddenNow = (id: PieceId) => flights.has(id) || !!aim?.ghosts.has(id);
  const hide = (node: Konva.Node) => {
    node.opacity(0);
    node.getLayer()?.batchDraw();
  };
  const show = (node: Konva.Node) => {
    node.opacity(1);
    node.getLayer()?.batchDraw();
  };
  const toScreen = (p: Pose, space: Place['space'] = 'world'): Pose => {
    if (space === 'hand') return { x: p.x, y: p.y, rotation: p.rotation, scale: p.scale };
    const v = host.view();
    return {
      x: p.x * v.scale + v.x,
      y: p.y * v.scale + v.y,
      rotation: p.rotation,
      scale: p.scale * v.scale,
    };
  };

  const schedule = () => {
    if (frame || (!flights.size && !slides.size && !afters.size)) return;
    frame = requestAnimationFrame(tick);
  };

  function tick() {
    frame = 0;
    const t = now();
    const dirty = new Set<Konva.Layer>();
    for (const run of [...flights.values()]) stepFlight(run, t);
    for (const run of [...slides.values()]) stepSlide(run, t, dirty);
    for (const run of [...afters.values()]) stepAfter(run, t, dirty);
    const top = host.layer();
    if (top) dirty.add(top);
    for (const layer of dirty) layer.draw();
    schedule();
  }

  // ---- voos (move, drop, showcase) ----

  function startFlight(
    id: PieceId,
    spec: PlaceSpec,
    input: Omit<FlightInput, 'to' | 'size'>,
    after: AfterSpec | null,
  ) {
    const node = host.node(id);
    const size = host.size(id);
    const layer = host.layer();
    const flight =
      node && size && layer ? planFlight(spec, { ...input, to: poseOfNode(node), size }) : null;
    if (!node || !layer || !flight) {
      startAfter(id, after);
      return;
    }
    cancelFlight(id);
    cancelSlide(id);
    stopAfterOf(id);
    const shadow = flight.legs.some((l) => l.fall || l.arc)
      ? new Konva.Rect({
          name: 'motion-shadow',
          listening: false,
          fill: '#000',
          shadowColor: '#000',
          shadowBlur: 14,
          shadowOpacity: 0.8,
        })
      : null;
    const ghost = ghostOf(node);
    if (shadow) layer.add(shadow);
    layer.add(ghost);
    aim?.arrow.moveToTop();
    hide(node);
    const run: FlightRun = {
      id,
      flight,
      t0: now(),
      ghost,
      shadow,
      after,
      last: input.from ?? poseOfNode(node),
    };
    flights.set(id, run);
    stepFlight(run, run.t0); // já no primeiro quadro, no lugar de saída
    layer.batchDraw();
  }

  function stepFlight(run: FlightRun, t: number) {
    const node = host.node(run.id);
    if (!node) {
      endFlight(run, false); // a peça saiu da mesa (ou ficou escondida de quem olha)
      return;
    }
    const target = poseOfNode(node);
    const f = flightFrame(run.flight, t - run.t0, target);
    const { pose } = f;
    run.ghost.setAttrs({
      x: pose.x,
      y: pose.y,
      rotation: pose.rotation,
      scaleX: pose.scale,
      scaleY: pose.scale,
      opacity: f.opacity,
    });
    run.last = pose;
    if (run.shadow) {
      const { w, h } = run.flight.size;
      const k = f.ground.scale * (1 - 0.15 * f.height);
      run.shadow.setAttrs({
        visible: f.height > 0.01 && f.opacity > 0,
        x: f.ground.x,
        y: f.ground.y + 4,
        rotation: f.ground.rotation,
        width: w * k,
        height: h * k,
        offsetX: (w * k) / 2,
        offsetY: (h * k) / 2,
        cornerRadius: Math.min(w, h) * k * 0.08,
        opacity: 0.3 * (1 - 0.6 * f.height) * f.opacity,
      });
    }
    if (f.done) endFlight(run, true);
  }

  function endFlight(run: FlightRun, arrived: boolean) {
    flights.delete(run.id);
    run.ghost.destroy();
    run.shadow?.destroy();
    const node = host.node(run.id);
    if (node && !hiddenNow(run.id)) show(node);
    if (arrived) startAfter(run.id, run.after);
  }

  /** Para o voo de uma peça; devolve onde ela estava na tela. */
  function cancelFlight(id: PieceId): Pose | undefined {
    const run = flights.get(id);
    if (!run) return undefined;
    endFlight(run, false);
    return run.last;
  }

  // ---- deslize no lugar (quem só se ajeitou) ----

  function startSlide(id: PieceId, from: Place) {
    const node = host.node(id);
    const to = host.place(id);
    if (!node || !to || to.space !== from.space) return;
    const run: SlideRun = { id, from, t0: now(), last: from };
    slides.set(id, run);
    const dirty = new Set<Konva.Layer>();
    stepSlide(run, run.t0, dirty);
    for (const layer of dirty) layer.batchDraw();
  }

  function stepSlide(run: SlideRun, t: number, dirty: Set<Konva.Layer>) {
    const node = host.node(run.id);
    const to = host.place(run.id);
    if (!node || !to || to.space !== run.from.space) {
      slides.delete(run.id);
      return;
    }
    const p = Math.min(1, (t - run.t0) / SLIDE_MS);
    const pose = p >= 1 ? to : lerpPose(run.from, to, ease.out(p));
    node.setAttrs({
      x: pose.x,
      y: pose.y,
      rotation: pose.rotation,
      scaleX: pose.scale,
      scaleY: pose.scale,
    });
    run.last = pose;
    const layer = node.getLayer();
    if (layer) dirty.add(layer);
    if (p >= 1) slides.delete(run.id);
  }

  /** Para o deslize e põe o nó onde o estado diz. */
  function cancelSlide(id: PieceId) {
    const run = slides.get(id);
    if (!run) return;
    slides.delete(id);
    const node = host.node(id);
    const to = host.place(id);
    if (node && to)
      node.setAttrs({
        x: to.x,
        y: to.y,
        rotation: to.rotation,
        scaleX: to.scale,
        scaleY: to.scale,
      });
  }

  // ---- depois de chegar (shake, glow) ----

  function startAfter(id: PieceId, spec: AfterSpec | null) {
    if (!spec || spec.type === 'none') return;
    stopAfterOf(id);
    if (spec.type === 'shake' && reducedMotion()) return;
    const layer = host.layer();
    let glow: Konva.Rect | null = null;
    if (spec.type === 'glow') {
      if (!layer) return;
      glow = glowRect(spec.color);
      layer.add(glow);
      aim?.arrow.moveToTop();
    }
    const run: AfterRun = { id, spec, t0: now(), glow };
    afters.set(id, run);
    const dirty = new Set<Konva.Layer>();
    stepAfter(run, run.t0, dirty);
    for (const l of dirty) l.batchDraw();
    layer?.batchDraw();
    schedule();
  }

  function stepAfter(run: AfterRun, t: number, dirty: Set<Konva.Layer>) {
    const node = host.node(run.id);
    const elapsed = t - run.t0;
    if (!node) {
      stopAfterOf(run.id);
      return;
    }
    if (run.spec.type === 'shake') {
      const base = host.place(run.id);
      const off = base && shakeAt(elapsed, run.spec.duration);
      if (!base || !off) {
        stopAfterOf(run.id);
        return;
      }
      const k = node.getParent()?.getAbsoluteScale().x || 1; // px da tela → unidades do pai
      const attrs = { x: base.x + off.dx / k, y: base.y, rotation: base.rotation + off.rotation };
      const key = `${attrs.x},${attrs.y},${attrs.rotation}`;
      if (key === run.shaken) return;
      run.shaken = key;
      node.setAttrs(attrs);
      const layer = node.getLayer();
      if (layer) dirty.add(layer);
      return;
    }
    const level = glowAt(elapsed, run.spec.duration, reducedMotion());
    const size = host.size(run.id);
    if (level === null || !size || !run.glow) {
      stopAfterOf(run.id);
      return;
    }
    placeGlow(run.glow, poseOfNode(node), size, node.isVisible() ? level : 0);
  }

  function stopAfterOf(id: PieceId) {
    const run = afters.get(id);
    if (!run) return;
    afters.delete(id);
    run.glow?.destroy();
    host.layer()?.batchDraw();
    if (run.spec.type === 'shake') {
      const node = host.node(id);
      const base = host.place(id);
      if (node && base) {
        node.setAttrs({ x: base.x, y: base.y, rotation: base.rotation });
        node.getLayer()?.batchDraw();
      }
    }
  }

  // ---- a mira (drag: "arrow") ----

  function drawArrow(ctx: Konva.Context) {
    const s = aim?.shape;
    if (!aim || !s) return;
    const pts = s.points;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    };
    ctx.setAttr('lineCap', 'round');
    ctx.setAttr('lineJoin', 'round');
    ctx.setLineDash([12, 9]);
    path();
    ctx.setAttr('lineWidth', 10);
    ctx.setAttr('strokeStyle', 'rgba(0, 0, 0, 0.35)');
    ctx.stroke();
    path();
    ctx.setAttr('lineWidth', 6);
    ctx.setAttr('strokeStyle', aim.color);
    ctx.stroke();
    ctx.setLineDash([]);
    const { x, y, angle } = s.head;
    const w = ARROW_HEAD * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-ARROW_HEAD, -w);
    ctx.lineTo(-ARROW_HEAD * 0.65, 0);
    ctx.lineTo(-ARROW_HEAD, w);
    ctx.closePath();
    ctx.setAttr('fillStyle', aim.color);
    ctx.fill();
    ctx.setAttr('lineWidth', 2);
    ctx.setAttr('strokeStyle', 'rgba(0, 0, 0, 0.45)');
    ctx.stroke();
    ctx.restore();
  }

  function aimEnd(): Map<PieceId, Pose> {
    const out = new Map<PieceId, Pose>();
    const run = aim;
    if (!run) return out;
    aim = null;
    for (const [id, { ghost, pose }] of run.ghosts) {
      out.set(id, pose);
      ghost.destroy();
      const node = host.node(id);
      if (node && !hiddenNow(id)) show(node);
    }
    run.ring?.destroy();
    run.arrow.destroy();
    host.layer()?.batchDraw();
    return out;
  }

  return {
    play(batch) {
      const reduced = reducedMotion();
      let room = MAX_FLIGHTS;
      const slideOk = batch.moves.filter((m) => !m.placed).length <= MAX_SLIDES;
      const showcases: {
        id: PieceId;
        place: PlaceSpec;
        from: Pose | null;
        after: AfterSpec | null;
      }[] = [];
      const fly = (id: PieceId, place: PlaceSpec, from: Pose | null, after: AfterSpec | null) => {
        if (place.type === 'instant' || reduced || room <= 0) {
          cancelSlide(id);
          startAfter(id, after);
          return;
        }
        room--;
        if (place.type === 'showcase') {
          showcases.push({ id, place, from, after });
          return;
        }
        const stops = (batch.stops.get(id) ?? []).map((p) => toScreen(p));
        startFlight(id, place, { from, stops, released: batch.handled.has(id) }, after);
      };

      for (const m of batch.moves) {
        const spec = batch.specs.get(m.id);
        if (!spec) continue;
        if (!m.placed) {
          // só se ajeitou: desliza no lugar (se o jogador não a pôs ali com o mouse)
          if (batch.viewerChanged || batch.handled.has(m.id) || m.from.space !== m.to.space)
            continue;
          if (spec.place.type === 'instant' || reduced || !slideOk) continue;
          startSlide(m.id, slides.get(m.id)?.last ?? m.from);
          continue;
        }
        const from =
          cancelFlight(m.id) ?? batch.origins.get(m.id) ?? toScreen(m.from, m.from.space);
        if (batch.undo) {
          const back = spec.place.type === 'instant' ? spec.place : undoPlace(spec.place);
          fly(m.id, back, from, null);
        } else fly(m.id, spec.place, from, spec.after);
      }

      if (!batch.viewerChanged && !batch.undo) {
        for (const id of batch.appeared) {
          const spec = batch.specs.get(id);
          if (!spec) continue;
          // sem lugar de antes: só a queda e a evidência têm o que mostrar
          const t = spec.place.type;
          if (t === 'drop' || t === 'showcase') fly(id, spec.place, null, spec.after);
          else startAfter(id, spec.after);
        }
      }

      if (showcases.length > MAX_SHOWCASE) {
        for (const s of showcases) {
          startFlight(s.id, { ...s.place, type: 'move' }, { from: s.from }, s.after);
        }
      } else if (showcases.length) {
        // uma leva por vez na evidência: a próxima chega quando esta começa a sair
        const first = showcases[0]!.place;
        const sizes = showcases.map((s) => host.size(s.id) ?? { w: 60, h: 84 });
        const spots = showcaseSpots(sizes, host.screen(), first.at);
        const t = now();
        const delay = Math.max(0, spotlightFree - t);
        spotlightFree = t + delay + first.duration + first.hold;
        showcases.forEach((s, i) => {
          startFlight(s.id, s.place, { from: s.from, spot: spots[i], delay }, s.after);
        });
      }
      schedule();
    },

    attach(id, node) {
      if (hiddenNow(id)) node.opacity(0);
    },

    poseOf(id) {
      const flying = flights.get(id)?.last;
      if (flying) return flying;
      const node = host.node(id);
      return node && poseOfNode(node);
    },

    stopAfter() {
      for (const id of [...afters.keys()]) stopAfterOf(id);
    },

    land(ids) {
      for (const id of ids) {
        cancelFlight(id);
        cancelSlide(id);
      }
    },

    aimStart(held, ids) {
      aimEnd();
      const layer = host.layer();
      if (!layer) return;
      const ghosts = new Map<PieceId, { ghost: Konva.Group; pose: Pose }>();
      for (const id of ids) {
        const node = host.node(id);
        if (!node) continue;
        cancelFlight(id);
        const pose = poseOfNode(node);
        const ghost = ghostOf(node);
        ghost.setAttrs({
          x: pose.x,
          y: pose.y,
          rotation: pose.rotation,
          scaleX: pose.scale,
          scaleY: pose.scale,
        });
        layer.add(ghost);
        ghosts.set(id, { ghost, pose });
        hide(node);
      }
      // a peça que mira ganha uma luz fraca em volta
      const start = ghosts.get(held);
      const size = host.size(held);
      let ring: Konva.Rect | null = null;
      if (start && size) {
        ring = glowRect(ARROW_COLORS.idle);
        placeGlow(ring, start.pose, size, 0.55);
        layer.add(ring);
      }
      const arrow = new Konva.Shape({
        name: 'motion-arrow',
        listening: false,
        sceneFunc: (ctx) => drawArrow(ctx),
      });
      layer.add(arrow);
      aim = { held, ghosts, ring, arrow, shape: null, color: ARROW_COLORS.idle };
      layer.batchDraw();
    },

    aimMove(pointer, state) {
      const start = aim?.ghosts.get(aim.held);
      if (!aim || !start) return;
      const size = host.size(aim.held) ?? { w: 40, h: 40 };
      aim.shape = arrowPath(start.pose, pointer, insidePiece(start.pose, size, 4));
      aim.color = ARROW_COLORS[state];
      aim.ring?.stroke(aim.color).shadowColor(aim.color);
      aim.arrow.moveToTop();
      host.layer()?.batchDraw();
    },

    aimEnd,

    reset() {
      aimEnd();
      for (const run of [...flights.values()]) endFlight(run, false);
      for (const id of [...slides.keys()]) cancelSlide(id);
      for (const id of [...afters.keys()]) stopAfterOf(id);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      spotlightFree = 0;
    },
  };
}

/** No desfazer, a peça volta deslizando, rápido e reto. */
function undoPlace(place: PlaceSpec): PlaceSpec {
  return { ...place, type: 'move', path: 'line', duration: 250 };
}
