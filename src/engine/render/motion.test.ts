import { describe, expect, it } from 'vitest';
import { createManager, type Piece } from '@/engine/core';
import {
  arrowPath,
  diffPlaces,
  DROP_LIFT,
  flightFrame,
  glowAt,
  insidePiece,
  isStill,
  leftHand,
  placeSpec,
  planFlight,
  relocated,
  resolveMotion,
  shakeAt,
  showcaseSpots,
  waypoints,
  type Place,
  type Pose,
} from './motion';

const pose = (x: number, y: number, scale = 1): Pose => ({ x, y, rotation: 0, scale });
const size = { w: 60, h: 90 };

describe('resolveMotion', () => {
  it('sem nada: segue o ponteiro, aparece no lugar, sem efeito (nada a animar)', () => {
    const m = resolveMotion();
    expect(m.drag).toBe('follow');
    expect(m.place.type).toBe('instant');
    expect(m.after.type).toBe('none');
    expect(isStill(m)).toBe(true);
  });

  it('texto ou objeto, com os padrões preenchidos', () => {
    const m = resolveMotion({
      drag: 'arrow',
      place: { type: 'move', path: 'arc', duration: 500 },
      after: 'glow',
    });
    expect(m.drag).toBe('arrow');
    expect(m.place).toMatchObject({ type: 'move', path: 'arc', duration: 500 });
    expect(m.after).toMatchObject({ type: 'glow', duration: 'next' });
    expect(placeSpec('showcase')).toMatchObject({ at: 'center', hold: 700, path: 'line' });
    expect(resolveMotion({ after: 'shake' }).after.duration).toBe(600);
  });

  it('a zona troca a chegada e o efeito, não o arrasto', () => {
    const m = resolveMotion(
      { drag: 'arrow', place: 'move', after: 'glow' },
      { place: 'showcase', after: 'none' },
    );
    expect(m).toMatchObject({
      drag: 'arrow',
      place: { type: 'showcase' },
      after: { type: 'none' },
    });
    // sem `after` na zona, vale o do kind
    expect(resolveMotion({ after: 'glow' }, { place: 'drop' }).after.type).toBe('glow');
  });

  it('saindo da mão, o fromHand vence a zona e o kind (o da zona vence o do kind)', () => {
    const kind = {
      place: { type: 'move' as const, path: 'arc' as const },
      after: 'glow' as const,
      fromHand: { place: 'showcase' as const, after: 'shake' as const },
    };
    const descarte = { place: 'move' as const, after: 'glow' as const };
    // a carta jogada da mão vai em evidência, mesmo para a zona que força o arco
    expect(resolveMotion(kind, descarte, true)).toMatchObject({
      place: { type: 'showcase' },
      after: { type: 'shake' },
    });
    // o que as regras movem segue a zona
    expect(resolveMotion(kind, descarte, false)).toMatchObject({
      place: { type: 'move' },
      after: { type: 'glow' },
    });
    // fromHand da zona vence o do kind, campo a campo
    expect(resolveMotion(kind, { fromHand: { place: 'drop' } }, true)).toMatchObject({
      place: { type: 'drop' },
      after: { type: 'shake' },
    });
  });

  it('tipo desconhecido (zona criada pelas regras) não anima', () => {
    expect(resolveMotion({ place: 'voar' as never, after: 'girar' as never })).toMatchObject({
      place: { type: 'instant' },
      after: { type: 'none' },
    });
  });
});

describe('diffPlaces', () => {
  const piece = (id: string, over: Partial<Piece> = {}): Piece =>
    ({
      id,
      kind: 'k',
      status: 'default',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scale: 1, z: 0 },
      size,
      faces: {},
      tags: [],
      attributes: {},
      ...over,
    }) as Piece;
  const at = (x: number, y: number, space: Place['space'] = 'world'): Place => ({
    space,
    ...pose(x, y),
  });

  it('separa quem mudou de lugar no estado de quem só se ajeitou, e quem apareceu', () => {
    const prev = new Map([
      ['a', at(0, 0)],
      ['b', at(10, 0)],
      ['c', at(20, 0)],
    ]);
    const next = new Map([
      ['a', at(100, 0)],
      ['b', at(0, 0)],
      ['c', at(20, 0)],
      ['d', at(5, 5)],
    ]);
    const before = { a: piece('a'), b: piece('b', { parentId: 'z' }), c: piece('c') };
    const after = {
      a: piece('a', { parentId: 'z' }),
      b: piece('b', { parentId: 'z' }),
      c: piece('c'),
      d: piece('d'),
    };
    const { moves, appeared } = diffPlaces(prev, next, before, after);
    expect(moves.map((m) => [m.id, m.placed])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(appeared).toEqual(['d']);
  });

  it('só a ordem na pilha (z) não é mudar de lugar', () => {
    const a = piece('a', { parentId: 'z' });
    const b = { ...a, transform: { ...a.transform, z: 5 } };
    expect(relocated(a, b)).toBe(false);
    expect(relocated(a, { ...a, slot: '1,0' })).toBe(true);
  });
});

describe('leftHand', () => {
  const zone = (id: string, hand: boolean) =>
    ({ id, kind: 'z', parentId: null, zone: { layout: 'row', hand } }) as unknown as Piece;
  const card = (parentId: string) => ({ id: 'c', kind: 'k', parentId }) as unknown as Piece;
  const zones = { mao: zone('mao', true), mesa: zone('mesa', false) };

  it('pelo pai de antes, sem eventos (desfazer)', () => {
    expect(leftHand('c', [], { ...zones, c: card('mao') }, zones)).toBe(true);
    expect(leftHand('c', [], { ...zones, c: card('mesa') }, zones)).toBe(false);
  });

  it('pelo primeiro piecePlaced da jogada, mesmo sem a peça antes (apelido na rede)', () => {
    const events = [
      { type: 'piecePlaced', id: 'c', from: { parentId: 'mao' }, to: { parentId: 'mesa' } },
      { type: 'piecePlaced', id: 'c', from: { parentId: 'mesa' }, to: { parentId: 'mesa' } },
    ];
    expect(leftHand('c', events, zones, { ...zones, c: card('mesa') })).toBe(true);
    // a carta veio da mesa, mesmo que antes estivesse na mão (o evento vence)
    const daMesa = [{ type: 'piecePlaced', id: 'c', from: { parentId: 'mesa' } }];
    expect(leftHand('c', daMesa, { ...zones, c: card('mao') }, zones)).toBe(false);
  });
});

describe('waypoints', () => {
  it('a peça levada casa por casa passa pelas casas do meio', () => {
    const m = createManager({ seed: 1 });
    m.registerKind({ kind: 'k', defaults: { size: { w: 40, h: 40 } } });
    m.dispatch({
      type: 'createPiece',
      piece: {
        id: 'pista',
        kind: 'k',
        size: { w: 200, h: 50 },
        transform: { x: 100, y: 25 },
        zone: { layout: 'grid', grid: { cols: 4, rows: 1, cell: { w: 50, h: 50 } } },
      },
    });
    m.dispatch({
      type: 'createPiece',
      piece: { id: 'p', kind: 'k', parentId: 'pista', slot: '0,0' },
    });
    const r = m.dispatch({
      type: 'batch',
      commands: ['1,0', '2,0', '3,0'].map((slot) => ({
        type: 'dropInto' as const,
        id: 'p',
        zone: 'pista',
        slot,
      })),
    });
    if (!r.ok) throw new Error(r.error);
    const stops = waypoints(r.value, 'p', m.getState().pieces);
    // casas 1 e 2 (a 3 é o destino), no centro de cada uma, na mesa
    expect(stops.map((s) => [s.x, s.y])).toEqual([
      [75, 25],
      [125, 25],
    ]);
  });

  it('um passo só: nenhum lugar de passagem', () => {
    expect(waypoints([{ type: 'piecePlaced', id: 'p', to: {} }], 'p', {})).toEqual([]);
  });
});

describe('planFlight e flightFrame', () => {
  const to = pose(300, 100);

  it('instant não voa; move precisa de onde sair', () => {
    expect(planFlight(placeSpec('instant'), { from: pose(0, 0), to, size })).toBeNull();
    expect(planFlight(placeSpec('move'), { from: null, to, size })).toBeNull();
  });

  it('move: sai de onde estava e chega ao destino, mesmo que ele ande no caminho', () => {
    const f = planFlight(placeSpec('move'), { from: pose(0, 100), to, size })!;
    expect(flightFrame(f, 0, to).pose).toMatchObject({ x: 0, y: 100 });
    const moved = pose(320, 120); // a câmera andou durante o voo
    const end = flightFrame(f, f.end, moved);
    expect(end.pose).toMatchObject({ x: 320, y: 120 });
    expect(end.done).toBe(true);
  });

  it('arc: no meio do caminho, mais alto que a reta, e com sombra embaixo', () => {
    const line = planFlight(placeSpec('move'), { from: pose(0, 100), to, size })!;
    const arc = planFlight(placeSpec({ type: 'move', path: 'arc' }), {
      from: pose(0, 100),
      to,
      size,
    })!;
    const mid = (f: typeof line) => flightFrame(f, f.end / 2, to);
    expect(mid(arc).pose.y).toBeLessThan(mid(line).pose.y - 50);
    expect(mid(arc).height).toBeCloseTo(1);
    expect(mid(arc).ground.y).toBeCloseTo(mid(line).pose.y);
  });

  it('casa por casa: um trecho por lugar, sem passar do tempo máximo', () => {
    const stops = [pose(100, 100), pose(200, 100)];
    const f = planFlight(placeSpec('move'), { from: pose(0, 100), to, size, stops })!;
    expect(f.legs).toHaveLength(3);
    expect(flightFrame(f, f.legs[1]!.start, to).pose.x).toBeCloseTo(100);
    const many = Array.from({ length: 20 }, (_, i) => pose(i * 10, 100));
    const long = planFlight(placeSpec('move'), { from: pose(0, 100), to, size, stops: many })!;
    expect(long.end).toBeLessThanOrEqual(2400);
  });

  it('drop: aparece acima do destino e cai nele', () => {
    const f = planFlight(placeSpec('drop'), { from: pose(0, 0), to, size })!;
    const start = flightFrame(f, 0, to);
    expect(start.pose.x).toBe(300);
    expect(start.pose.y).toBeCloseTo(100 - DROP_LIFT * size.h);
    expect(start.opacity).toBe(0);
    expect(start.ground).toMatchObject({ x: 300, y: 100 });
    expect(flightFrame(f, f.end, to).pose).toMatchObject({ x: 300, y: 100, scale: 1 });
  });

  it('drop de quem o jogador soltou: cai de onde ele soltou', () => {
    const f = planFlight(placeSpec('drop'), { from: pose(280, 90), to, size, released: true })!;
    expect(flightFrame(f, 0, to)).toMatchObject({ pose: { x: 280, y: 90 }, opacity: 1 });
  });

  it('showcase: vai para a evidência, espera e vai ao destino', () => {
    const spot = pose(500, 300, 3);
    const spec = placeSpec({ type: 'showcase', hold: 500 });
    const f = planFlight(spec, { from: pose(0, 0), to, size, spot })!;
    const held = flightFrame(f, spec.duration + 250, to);
    expect(held.pose.x).toBeCloseTo(500);
    expect(held.pose.scale).toBeGreaterThan(2.9);
    expect(flightFrame(f, f.end, to).pose).toMatchObject({ x: 300, y: 100, scale: 1 });
  });

  it('showcase esperando a vez: quem apareceu agora fica invisível até sair', () => {
    const spot = pose(500, 300, 3);
    const f = planFlight(placeSpec('showcase'), { from: null, to, size, spot, delay: 400 })!;
    expect(flightFrame(f, 100, to).opacity).toBe(0);
    expect(flightFrame(f, 400 + 320, to).pose.x).toBeCloseTo(500);
  });
});

describe('showcaseSpots', () => {
  it('lado a lado, no meio da tela, cabendo na largura', () => {
    const screen = { width: 800, height: 600 };
    const spots = showcaseSpots([size, size], screen, 'center');
    expect((spots[0]!.x + spots[1]!.x) / 2).toBeCloseTo(400);
    expect(spots[0]!.scale * size.h).toBeCloseTo(600 * 0.42);
    const many = showcaseSpots(
      Array.from({ length: 6 }, () => size),
      screen,
      'left',
    );
    const last = many.at(-1)!;
    expect(last.x + (size.w * last.scale) / 2).toBeLessThanOrEqual(800);
  });
});

describe('efeitos depois de chegar', () => {
  it('shake: treme e para no fim (ou repete até a próxima jogada)', () => {
    expect(Math.abs(shakeAt(30, 600)!.dx)).toBeGreaterThan(0);
    expect(shakeAt(600, 600)).toBeNull();
    expect(shakeAt(1000, 'next')).toEqual({ dx: 0, rotation: 0 });
    expect(Math.abs(shakeAt(1800 + 30, 'next')!.dx)).toBeGreaterThan(0);
  });

  it('glow: acende, pulsa e apaga no fim', () => {
    expect(glowAt(0, 'next')).toBe(0);
    expect(glowAt(700, 'next')).toBeGreaterThan(0.5);
    expect(glowAt(5000, 1000)).toBeNull();
    expect(glowAt(700, 'next', true)).toBeCloseTo(0.6);
  });
});

describe('arrowPath', () => {
  it('sai da borda da peça, curva para cima e aponta para o ponteiro', () => {
    const from = { x: 100, y: 300 };
    const to = { x: 500, y: 300 };
    const a = arrowPath(from, to, insidePiece(pose(100, 300), { w: 80, h: 80 }))!;
    const [x0, y0] = a.points;
    expect(Math.hypot(x0! - from.x, y0! - from.y)).toBeGreaterThanOrEqual(40);
    const ys = a.points.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeLessThan(260); // a curva sobe
    expect(a.head).toMatchObject({ x: 500, y: 300 });
    expect(Math.cos(a.head.angle)).toBeGreaterThan(0); // aponta para a direita (e para baixo)
  });

  it('carta alta mirando para cima: sai da borda de cima, não do meio dela', () => {
    const card = pose(400, 500, 2); // 60 × 90 → 120 × 180 na tela
    const a = arrowPath({ x: 400, y: 500 }, { x: 420, y: 100 }, insidePiece(card, size))!;
    expect(a.points[1]).toBeLessThanOrEqual(410); // a borda de cima fica em y 410
    expect(a.points[1]).toBeGreaterThan(395);
  });

  it('ponteiro ainda em cima da peça: sem flecha', () => {
    const inside = insidePiece(pose(0, 0), { w: 80, h: 80 });
    expect(arrowPath({ x: 0, y: 0 }, { x: 30, y: 0 }, inside)).toBeNull();
    expect(arrowPath({ x: 0, y: 0 }, { x: 50, y: 0 }, inside)).toBeNull(); // colado na borda
  });

  it('insidePiece considera a rotação', () => {
    const tall = insidePiece({ x: 0, y: 0, rotation: 90, scale: 1 }, { w: 20, h: 100 });
    expect(tall({ x: 40, y: 0 })).toBe(true); // deitada: comprida na horizontal
    expect(tall({ x: 0, y: 40 })).toBe(false);
  });
});
