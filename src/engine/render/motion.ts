import type {
  AfterMotion,
  AfterType,
  GameEvent,
  Motion,
  Piece,
  PieceId,
  PlaceMotion,
  PlaceType,
  Size,
  ZoneMotion,
} from '@/engine/core';
import { buildScene } from './scene';

/**
 * Movimento na tela, sem Konva: o que mudou de lugar entre dois estados, por onde cada peça passa
 * e como fica em cada instante. O desenho (fantasmas, laço de quadros) está em konva/motion.ts.
 */

type Pieces = Record<PieceId, Piece>;
type Point = { x: number; y: number };

/** Centro, rotação (graus) e escala. Na tela, a escala já inclui o zoom da câmera. */
export interface Pose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/** Onde a peça é desenhada: na mesa (coordenadas da mesa) ou na faixa da mão (px da tela). */
export interface Place extends Pose {
  space: 'world' | 'hand';
}

export interface PlaceSpec {
  type: PlaceType;
  duration: number;
  path: 'line' | 'arc';
  at: 'center' | 'left' | 'right';
  hold: number;
}

export interface AfterSpec {
  type: AfterType;
  duration: number | 'next';
  color: string;
}

/** Movimento resolvido, com os padrões preenchidos. */
export interface MotionSpec {
  drag: 'follow' | 'arrow';
  place: PlaceSpec;
  after: AfterSpec;
}

const PLACE_TYPES: readonly PlaceType[] = ['instant', 'drop', 'move', 'showcase'];
const AFTER_TYPES: readonly AfterType[] = ['none', 'shake', 'glow'];
const PLACE_DURATION: Record<PlaceType, number> = {
  instant: 0,
  drop: 380,
  move: 350,
  showcase: 320,
};
/** Tempo parado em evidência (`showcase`). */
export const SHOWCASE_HOLD = 700;
/** Duração de um tremor (`shake`) e de uma luz que não espera a próxima jogada. */
const AFTER_DURATION: Record<AfterType, number | 'next'> = { none: 0, shake: 600, glow: 'next' };
export const GLOW_COLOR = '#ffd866';

export function placeSpec(m?: PlaceMotion): PlaceSpec {
  const o = typeof m === 'string' ? { type: m } : (m ?? { type: 'instant' as const });
  const type = PLACE_TYPES.includes(o.type) ? o.type : 'instant';
  return {
    type,
    duration: o.duration !== undefined && o.duration > 0 ? o.duration : PLACE_DURATION[type],
    path: o.path === 'arc' ? 'arc' : 'line',
    at: o.at === 'left' || o.at === 'right' ? o.at : 'center',
    hold: o.hold !== undefined && o.hold >= 0 ? o.hold : SHOWCASE_HOLD,
  };
}

export function afterSpec(m?: AfterMotion): AfterSpec {
  const o = typeof m === 'string' ? { type: m } : (m ?? { type: 'none' as const });
  const type = AFTER_TYPES.includes(o.type) ? o.type : 'none';
  const d = o.duration;
  return {
    type,
    duration: d === 'next' || (typeof d === 'number' && d > 0) ? d : AFTER_DURATION[type],
    color: o.color || GLOW_COLOR,
  };
}

/**
 * O movimento da peça (`own`: kind e padrão da mesa) com o da zona onde ela está por cima. Se a
 * peça saiu de uma mão (`fromHand`), o `fromHand` vence o resto: o da zona, depois o do kind.
 */
export function resolveMotion(own?: Motion, zone?: ZoneMotion, fromHand = false): MotionSpec {
  const pick = <K extends 'place' | 'after'>(key: K) =>
    (fromHand ? (zone?.fromHand?.[key] ?? own?.fromHand?.[key]) : undefined) ??
    zone?.[key] ??
    own?.[key];
  return {
    drag: own?.drag === 'arrow' ? 'arrow' : 'follow',
    place: placeSpec(pick('place')),
    after: afterSpec(pick('after')),
  };
}

/**
 * A peça saiu de uma mão (zona `hand`) nesta jogada. Vale o primeiro `piecePlaced` dela na
 * jogada; sem ele (desfazer), o pai de antes. Pelo evento, funciona também para quem não via a
 * peça antes: na rede, a carta virada na mão de outro jogador chega com outro id (um apelido).
 */
export function leftHand(
  id: PieceId,
  events: readonly GameEvent[],
  before: Pieces,
  after: Pieces,
): boolean {
  const placed = events.find((ev) => ev.type === 'piecePlaced' && ev.id === id);
  const from = placed
    ? (placed.from as { parentId?: PieceId | null } | undefined)?.parentId
    : before[id]?.parentId;
  if (from === undefined || from === null) return false;
  return !!(before[from] ?? after[from])?.zone?.hand;
}

/** Nada a animar: a peça se comporta como sempre. */
export const isStill = (m: MotionSpec) =>
  m.drag === 'follow' && m.place.type === 'instant' && m.after.type === 'none';

/** Uma peça que estava à vista antes e continua, em outro lugar. */
export interface Move {
  id: PieceId;
  from: Place;
  to: Place;
  /**
   * A peça mudou de lugar no estado (zona, encaixe ou posição). Sem isso, só se ajeitou: uma
   * vizinha saiu da fila, a pilha embaralhou, a zona dela andou, girou.
   */
  placed: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const samePlace = (a: Place, b: Place) =>
  a.space === b.space &&
  near(a.x, b.x) &&
  near(a.y, b.y) &&
  near(a.rotation, b.rotation) &&
  Math.abs(a.scale - b.scale) < 0.001;

/** A peça trocou de zona, de encaixe ou de posição (a ordem numa pilha não conta). */
export function relocated(before: Piece, after: Piece): boolean {
  return (
    before.parentId !== after.parentId ||
    (before.slot ?? null) !== (after.slot ?? null) ||
    before.transform.x !== after.transform.x ||
    before.transform.y !== after.transform.y
  );
}

/** O que mudou na tela entre dois desenhos: quem andou e quem apareceu. */
export function diffPlaces(
  prev: ReadonlyMap<PieceId, Place>,
  next: ReadonlyMap<PieceId, Place>,
  prevPieces: Pieces,
  nextPieces: Pieces,
): { moves: Move[]; appeared: PieceId[] } {
  const moves: Move[] = [];
  const appeared: PieceId[] = [];
  for (const [id, to] of next) {
    const from = prev.get(id);
    const before = prevPieces[id];
    const after = nextPieces[id];
    if (!from || !before) {
      appeared.push(id);
      continue;
    }
    if (samePlace(from, to)) continue;
    moves.push({ id, from, to, placed: !!after && relocated(before, after) });
  }
  return { moves, appeared };
}

/**
 * Lugares de passagem de uma peça numa jogada (na mesa): quando as regras a levam casa por casa,
 * cada `piecePlaced` (ou `pieceMoved`) antes do último. O lugar é calculado com as outras peças
 * já no fim da jogada.
 */
export function waypoints(
  events: readonly GameEvent[],
  id: PieceId,
  pieces: Pieces,
  filter?: (p: Piece) => boolean,
): Pose[] {
  const piece = pieces[id];
  if (!piece) return [];
  const steps: Pick<Piece, 'parentId' | 'slot' | 'transform'>[] = [];
  for (const ev of events) {
    if (ev.id !== id) continue;
    if (ev.type === 'piecePlaced') {
      const to = ev.to as { parentId: PieceId | null; slot: string | null; x: number; y: number };
      const slot = to.slot ?? undefined;
      steps.push({
        parentId: to.parentId,
        slot,
        transform: { ...piece.transform, x: to.x, y: to.y },
      });
    } else if (ev.type === 'pieceMoved') {
      const to = ev.to as { x: number; y: number };
      const last = steps.at(-1) ?? piece;
      steps.push({ ...last, transform: { ...last.transform, x: to.x, y: to.y } });
    }
  }
  const out: Pose[] = [];
  for (const step of steps.slice(0, -1)) {
    if (step.parentId !== null && !pieces[step.parentId]) continue;
    const at = { ...piece, ...step } as Piece;
    if (step.slot === undefined) delete (at as { slot?: string }).slot;
    const node = buildScene({ ...pieces, [id]: at }, filter).find((n) => n.id === id);
    if (node) out.push({ x: node.x, y: node.y, rotation: node.rotation, scale: node.scale });
  }
  return out;
}

// ---- curvas de tempo ----

export type Ease = (p: number) => number;
export const ease = {
  linear: (p: number) => p,
  in: (p: number) => p * p,
  out: (p: number) => 1 - (1 - p) ** 3,
  inOut: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
} satisfies Record<string, Ease>;

/**
 * Ponta de um trecho: uma pose fixa na tela, ou o destino (que pode andar durante o voo: a câmera,
 * a mão que se reorganiza). `lift`: acima do destino, em alturas da peça; `scale`: multiplica.
 */
export type Anchor = { at: Pose } | { target: true; lift?: number; scale?: number };

export interface Leg {
  from: Anchor;
  to: Anchor;
  start: number;
  duration: number;
  ease: Ease;
  /** Altura da curva no meio do trecho (px da tela): sobe e desce. */
  arc?: number;
  /** Cresce no meio do trecho (0,1 = 10%), para parecer que levantou. */
  bump?: number;
  /** Achata no meio do trecho (o "pouso" de uma queda). */
  squash?: number;
  /** Queda: a sombra fica no destino e cresce até a peça chegar. */
  fall?: boolean;
  fadeIn?: boolean;
  /** Invisível (esperando a vez de aparecer). */
  hidden?: boolean;
}

/** O voo de uma peça: trechos em sequência, em ms desde o começo. */
export interface Flight {
  legs: Leg[];
  end: number;
  /** Tamanho da peça (unidades dela), para a altura da queda e a sombra. */
  size: Size;
}

export interface FlightFrame {
  pose: Pose;
  opacity: number;
  /** A sombra: no chão embaixo da peça, do tamanho dela lá embaixo. */
  ground: Pose;
  /** O quanto a peça está no alto (0 = no chão, 1 = no ponto mais alto). */
  height: number;
  done: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) =>
  a + (((((b - a) % 360) + 540) % 360) - 180) * t;

/** Pose no meio do caminho (`t` de 0 a 1); a rotação gira pelo lado mais curto. */
export function lerpPose<P extends Pose>(a: P, b: P, t: number): P {
  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    rotation: lerpAngle(a.rotation, b.rotation, t),
    scale: lerp(a.scale, b.scale, t),
  };
}
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Altura da curva de um trecho: proporcional à distância, com limites. */
export const arcHeight = (a: Point, b: Point) => Math.min(140, Math.max(16, distance(a, b) * 0.3));
/** Altura da queda (`drop`), em alturas da peça. */
export const DROP_LIFT = 0.7;
/** Tempo máximo de um `move` com lugares de passagem. */
const MAX_PATH = 2400;

export interface FlightInput {
  /** De onde sai, na tela; `null` = a peça apareceu agora. */
  from: Pose | null;
  /** Onde o destino está agora, na tela (para a altura das curvas). */
  to: Pose;
  size: Size;
  /** Lugares de passagem, na tela (`move`). */
  stops?: readonly Pose[];
  /** Onde a peça fica em evidência (`showcase`). */
  spot?: Pose;
  /** Espera antes de sair (a vez na evidência). */
  delay?: number;
  /** Saiu da mão do jogador (arrasto): a queda começa onde ele soltou. */
  released?: boolean;
}

/** Os trechos do voo de uma peça, ou `null` se não há o que animar. */
export function planFlight(spec: PlaceSpec, input: FlightInput): Flight | null {
  const { from, to, size } = input;
  const legs: Leg[] = [];
  let t = 0;
  const push = (leg: Omit<Leg, 'start'>) => {
    legs.push({ ...leg, start: t });
    t += leg.duration;
  };
  const wait = (at: Pose, hidden: boolean) => {
    const delay = input.delay ?? 0;
    if (delay > 0) {
      push({
        from: { at },
        to: { at },
        duration: delay,
        ease: ease.linear,
        ...(hidden && { hidden }),
      });
    }
  };

  switch (spec.type) {
    case 'instant':
      return null;
    case 'move': {
      if (!from) return null;
      const points: Pose[] = [from, ...(input.stops ?? [])];
      const n = points.length; // trechos: um por ponto, o último até o destino
      const each = n > 1 ? Math.min(spec.duration, MAX_PATH / n) : spec.duration;
      const arc = spec.path === 'arc';
      points.forEach((p, i) => {
        const next = points[i + 1];
        push({
          from: { at: p },
          to: next ? { at: next } : { target: true },
          duration: each,
          ease: n === 1 || arc ? ease.inOut : ease.linear,
          ...(arc && { arc: arcHeight(p, next ?? to), bump: 0.08 }),
        });
      });
      break;
    }
    case 'drop': {
      const start: Anchor =
        input.released && from ? { at: from } : { target: true, lift: DROP_LIFT, scale: 1.25 };
      push({
        from: start,
        to: { target: true },
        duration: spec.duration,
        ease: ease.in,
        fall: true,
        fadeIn: !input.released,
      });
      push({
        from: { target: true },
        to: { target: true },
        duration: 140,
        ease: ease.linear,
        squash: 0.06,
      });
      break;
    }
    case 'showcase': {
      const spot = input.spot;
      if (!spot) return null;
      const small = { ...spot, scale: spot.scale * 0.7 };
      // a vez na evidência: quem já estava na mesa espera no lugar; quem apareceu, invisível
      wait(from ?? small, !from);
      if (from) {
        push({ from: { at: from }, to: { at: spot }, duration: spec.duration, ease: ease.out });
      } else {
        push({
          from: { at: small },
          to: { at: spot },
          duration: spec.duration,
          ease: ease.out,
          fadeIn: true,
        });
      }
      push({
        from: { at: spot },
        to: { at: spot },
        duration: spec.hold,
        ease: ease.linear,
        bump: 0.03,
      });
      push({
        from: { at: spot },
        to: { target: true },
        duration: spec.duration + 60,
        ease: ease.inOut,
        ...(spec.path === 'arc' && { arc: arcHeight(spot, to) }),
      });
      break;
    }
  }
  return legs.length ? { legs, end: t, size } : null;
}

/** A pose do voo no instante `t` (ms desde o começo), com o destino onde ele está agora. */
export function flightFrame(f: Flight, t: number, target: Pose): FlightFrame {
  let leg = f.legs[0]!;
  for (const l of f.legs) if (l.start <= t) leg = l;
  const p = Math.min(1, Math.max(0, (t - leg.start) / leg.duration || 0));
  const e = leg.ease(p);
  const resolve = (a: Anchor): Pose =>
    'at' in a
      ? a.at
      : {
          ...target,
          y: target.y - (a.lift ?? 0) * f.size.h * target.scale,
          scale: target.scale * (a.scale ?? 1),
        };
  const a = resolve(leg.from);
  const b = resolve(leg.to);
  const wave = Math.sin(Math.PI * p);
  const base = lerpPose(a, b, e);
  const scale = base.scale * (1 + ((leg.bump ?? 0) - (leg.squash ?? 0)) * wave);
  return {
    pose: { ...base, y: base.y - (leg.arc ?? 0) * wave, scale },
    opacity: leg.hidden ? 0 : leg.fadeIn ? Math.min(1, p / 0.3) : 1,
    ground: leg.fall ? { ...b, rotation: base.rotation } : base,
    height: leg.fall ? 1 - e : leg.arc ? wave : 0,
    done: t >= f.end,
  };
}

/**
 * Onde as peças ficam em evidência (`showcase`), lado a lado: grandes, perto do meio da tela (ou
 * de um lado), sem passar da largura.
 */
export function showcaseSpots(
  sizes: readonly Size[],
  screen: { width: number; height: number },
  at: PlaceSpec['at'],
): Pose[] {
  const tall = Math.min(380, Math.max(140, screen.height * 0.42));
  const gap = 16;
  const scales = sizes.map((s) => tall / s.h);
  const widths = sizes.map((s, i) => s.w * scales[i]!);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, sizes.length - 1);
  const fit = Math.min(1, (screen.width * 0.9) / Math.max(1, total));
  const cx = screen.width * (at === 'left' ? 0.3 : at === 'right' ? 0.7 : 0.5);
  const cy = screen.height * 0.42;
  let x = cx - (total * fit) / 2;
  return sizes.map((_, i) => {
    const w = widths[i]! * fit;
    const pose = { x: x + w / 2, y: cy, rotation: 0, scale: scales[i]! * fit };
    x += w + gap * fit;
    return pose;
  });
}

// ---- efeitos depois de chegar ----

const SHAKE_BURST = 520;
const SHAKE_EVERY = 1800;

/** Deslocamento do tremor no instante `t` (px da tela e graus); `null` depois do fim. */
export function shakeAt(
  t: number,
  duration: number | 'next',
): { dx: number; rotation: number } | null {
  if (duration !== 'next' && t >= duration) return null;
  // até a próxima jogada: um tremor curto a cada SHAKE_EVERY; com duração, tremores seguidos
  const local = duration === 'next' ? t % SHAKE_EVERY : t % SHAKE_BURST;
  if (local >= SHAKE_BURST) return { dx: 0, rotation: 0 };
  const decay = 1 - local / SHAKE_BURST;
  const s = local / 1000;
  return {
    dx: Math.sin(s * 2 * Math.PI * 14) * 3 * decay,
    rotation: Math.sin(s * 2 * Math.PI * 10 + 1) * 2.5 * decay,
  };
}

/** Força da luz em volta da peça no instante `t` (0 a 1); `null` depois do fim. */
export function glowAt(t: number, duration: number | 'next', reduced = false): number | null {
  if (duration !== 'next' && t >= duration) return null;
  const fadeIn = Math.min(1, t / 200);
  const fadeOut = duration === 'next' ? 1 : Math.min(1, (duration - t) / 300);
  const pulse = reduced ? 0.6 : 0.45 + 0.35 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1400));
  return pulse * fadeIn * fadeOut;
}

// ---- a flecha do arrasto (`drag: "arrow"`) ----

export interface ArrowShape {
  /** A curva, em pontos [x1, y1, x2, y2, …] (px da tela), até a base da ponta. */
  points: number[];
  /** A ponta: no ponteiro, apontando na direção da curva. */
  head: { x: number; y: number; angle: number };
}

/** Comprimento da ponta da flecha (px). */
export const ARROW_HEAD = 18;

/** Teste de ponto sobre a peça na tela (o retângulo dela, girado), com `margin` px de folga. */
export function insidePiece(pose: Pose, size: Size, margin = 0): (p: Point) => boolean {
  const rad = (-pose.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  const hw = (size.w * pose.scale) / 2 + margin;
  const hh = (size.h * pose.scale) / 2 + margin;
  return (p) => {
    const dx = p.x - pose.x;
    const dy = p.y - pose.y;
    return Math.abs(dx * cos - dy * sin) <= hw && Math.abs(dx * sin + dy * cos) <= hh;
  };
}

/**
 * Flecha curva da peça até o ponteiro, como a de mirar do Slay the Spire. Ela sai da borda da peça
 * (`inside`: o ponto está sobre a peça) e se curva para cima. `null` com o ponteiro ainda em cima
 * da peça ou colado nela.
 */
export function arrowPath(
  from: Point,
  to: Point,
  inside: (p: Point) => boolean,
): ArrowShape | null {
  const d = distance(from, to);
  if (inside(to) || d < ARROW_HEAD) return null;
  // ponto de controle: no meio, afastado para o lado de cima da reta
  let nx = -(to.y - from.y) / d;
  let ny = (to.x - from.x) / d;
  if (ny > 0) [nx, ny] = [-nx, -ny];
  const bend = d * 0.25;
  const c = { x: (from.x + to.x) / 2 + nx * bend, y: (from.y + to.y) / 2 + ny * bend };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * c.x + t * t * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * c.y + t * t * to.y,
  });
  // começa onde a curva sai da peça
  let t0 = 0;
  while (t0 < 1 && inside(at(t0))) t0 += 0.01;
  if (distance(at(t0), to) < ARROW_HEAD) return null;
  const tangent = { x: 2 * (to.x - c.x), y: 2 * (to.y - c.y) };
  const angle = Math.atan2(tangent.y, tangent.x);
  const base = {
    x: to.x - Math.cos(angle) * ARROW_HEAD * 0.7,
    y: to.y - Math.sin(angle) * ARROW_HEAD * 0.7,
  };
  const points: number[] = [];
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const p = at(t0 + ((1 - t0) * i) / steps);
    points.push(p.x, p.y);
  }
  points.push(base.x, base.y);
  return { points, head: { x: to.x, y: to.y, angle } };
}
