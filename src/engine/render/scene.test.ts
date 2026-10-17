import { describe, expect, it } from 'vitest';
import { createPiece, type Piece, type PieceInit, type ZoneSpec } from '@/engine/core';
import { candidateTargets, findDropTarget } from './drop';
import { layoutChildren } from './layouts';
import { buildScene, toLocal } from './scene';

type Init = Omit<PieceInit, 'kind'>;

function pieces(...inits: Init[]): Record<string, Piece> {
  return Object.fromEntries(inits.map((i) => [i.id, createPiece({ ...i, kind: 'k' })]));
}

const zone = (id: string, spec: ZoneSpec, extra: Partial<Init> = {}): Init => ({
  id,
  zone: spec,
  size: { w: 200, h: 100 },
  ...extra,
});

const card = (id: string, extra: Partial<Init> = {}): Init => ({
  id,
  size: { w: 40, h: 60 },
  ...extra,
});

describe('layoutChildren', () => {
  it('grid: centro da casa', () => {
    const ps = pieces(
      zone('g', { layout: 'grid', grid: { cols: 4, rows: 2, cell: { w: 50, h: 50 } } }),
      card('a', { parentId: 'g', slot: '2,1' }),
    );
    expect(layoutChildren(ps.g!, [ps.a!]).get('a')).toEqual({ x: 125, y: 75, rotation: 0 });
  });

  it('slots: posição e rotação do encaixe somadas à da peça', () => {
    const ps = pieces(
      zone('s', { layout: 'slots', slots: [{ id: 'x', x: 30, y: 40, rotation: 90 }] }),
      card('a', { parentId: 's', slot: 'x', transform: { rotation: 10 } }),
    );
    expect(layoutChildren(ps.s!, [ps.a!]).get('a')).toEqual({ x: 30, y: 40, rotation: 100 });
  });

  it('stack: empilha com deslocamento', () => {
    const ps = pieces(
      zone('d', { layout: 'stack', stack: { dx: 1, dy: -2 } }),
      card('a', { parentId: 'd' }),
      card('b', { parentId: 'd', transform: { z: 1 } }),
    );
    const l = layoutChildren(ps.d!, [ps.a!, ps.b!]);
    expect(l.get('a')).toMatchObject({ x: 100, y: 50 });
    expect(l.get('b')).toMatchObject({ x: 101, y: 48 });
  });

  it('fan: centralizado, aperta para caber e abre em arco', () => {
    const ps = pieces(
      zone('h', { layout: 'fan', fan: { spacing: 100, arc: 20 } }),
      card('a', { parentId: 'h' }),
      card('b', { parentId: 'h' }),
      card('c', { parentId: 'h' }),
    );
    const l = layoutChildren(ps.h!, [ps.a!, ps.b!, ps.c!]);
    // largura 200, carta 40: passo máximo (200-40)/2 = 80 < 100
    expect([l.get('a')!.x, l.get('b')!.x, l.get('c')!.x]).toEqual([20, 100, 180]);
    expect([l.get('a')!.rotation, l.get('b')!.rotation, l.get('c')!.rotation]).toEqual([
      -10, 0, 10,
    ]);
  });

  it('row: coladas a partir da ponta, com gap; apertam se não couberem', () => {
    const fila = (row: ZoneSpec['row'], n: number) => {
      const cs = Array.from({ length: n }, (_, i) => card(`c${i}`, { parentId: 'f' }));
      const ps = pieces(zone('f', { layout: 'row', row }), ...cs);
      const l = layoutChildren(
        ps.f!,
        cs.map((c) => ps[c.id]!),
      );
      return cs.map((c) => l.get(c.id)!.x);
    };
    // largura 200, peça 40
    expect(fila({ gap: 10 }, 2)).toEqual([30, 80]); // à esquerda
    expect(fila({ gap: 10, align: 'end' }, 2)).toEqual([120, 170]);
    expect(fila({ gap: 10, align: 'center' }, 2)).toEqual([75, 125]);
    // 6 peças não cabem em 180: passo (180 - 240) / 5 = -12 (sobrepõem)
    expect(fila({ gap: 10 }, 6)).toEqual([30, 58, 86, 114, 142, 170]);
  });
});

describe('buildScene', () => {
  it('zona antes do conteúdo; posições absolutas com rotação e escala do pai', () => {
    const ps = pieces(
      zone('z', { layout: 'free' }, { transform: { x: 300, y: 200, rotation: 90, scale: 2 } }),
      card('a', { parentId: 'z', transform: { x: 150, y: 50 } }), // 50 à direita do centro da zona
      card('solta', { transform: { x: 10, y: 10, z: -1 } }),
    );
    const scene = buildScene(ps);
    expect(scene.map((n) => n.id)).toEqual(['solta', 'z', 'a']);
    const a = scene.find((n) => n.id === 'a')!;
    // 50 × escala 2 = 100 para a direita; girado 90° vira 100 para baixo
    expect(a.x).toBeCloseTo(300);
    expect(a.y).toBeCloseTo(300);
    expect(a).toMatchObject({ rotation: 90, scale: 2, depth: 1, parentId: 'z' });
  });

  it('filtro esconde a peça e o que estiver dentro dela', () => {
    const ps = pieces(zone('z', { layout: 'stack' }), card('a', { parentId: 'z' }), card('b'));
    expect(buildScene(ps, (p) => p.id !== 'z').map((n) => n.id)).toEqual(['b']);
  });

  it('toLocal é o inverso da composição', () => {
    const ps = pieces(
      zone('z', { layout: 'free' }, { transform: { x: 300, y: 200, rotation: 30, scale: 1.5 } }),
      card('a', { parentId: 'z', transform: { x: 37, y: 81 } }),
    );
    const scene = buildScene(ps);
    const z = scene.find((n) => n.id === 'z')!;
    const a = scene.find((n) => n.id === 'a')!;
    const local = toLocal(z, ps.z!.size, a);
    expect(local.x).toBeCloseTo(37);
    expect(local.y).toBeCloseTo(81);
  });
});

describe('findDropTarget', () => {
  const ps = pieces(
    zone('area', { layout: 'free' }, { size: { w: 600, h: 400 }, transform: { x: 300, y: 200 } }),
    zone(
      'grade',
      { layout: 'grid', grid: { cols: 4, rows: 2, cell: { w: 50, h: 50 } } },
      { parentId: 'area', transform: { x: 100, y: 50, z: 1 }, size: { w: 200, h: 100 } },
    ),
    zone(
      'tab',
      {
        layout: 'slots',
        slots: [
          { id: 'a', x: 50, y: 50 },
          { id: 'b', x: 150, y: 50 },
        ],
        slotSize: { w: 40, h: 60 },
      },
      { transform: { x: 900, y: 100 } },
    ),
    zone('mao', { layout: 'fan', fan: { spacing: 50 } }, { transform: { x: 900, y: 400 } }),
    card('h1', { parentId: 'mao' }),
    card('h2', { parentId: 'mao', transform: { z: 1 } }),
    card('x'),
  );
  const scene = buildScene(ps);
  const at = (p: { x: number; y: number }) => findDropTarget(ps, scene, 'x', p, p);

  it('fora de zona: mesa, no centro da peça', () => {
    expect(findDropTarget(ps, scene, 'x', { x: 2000, y: 0 }, { x: 1990, y: 5 })).toEqual({
      zone: null,
      x: 1990,
      y: 5,
    });
  });

  it('zona dentro de zona: vale a mais interna', () => {
    // grade ocupa x 0..200, y 0..100 da mesa; casa (3,1) = x 150..200, y 50..100
    expect(at({ x: 175, y: 75 })).toEqual({ zone: 'grade', slot: '3,1' });
  });

  it('free: posição relativa à zona', () => {
    expect(at({ x: 400, y: 300 })).toEqual({ zone: 'area', x: 400, y: 300 });
  });

  it('slots: encaixe magnético perto, nada longe', () => {
    // tab: x 800..1000, y 50..150; encaixe b no centro (950, 100)
    expect(at({ x: 965, y: 110 })).toEqual({ zone: 'tab', slot: 'b' });
    expect(at({ x: 900, y: 140 })).toEqual({ zone: 'tab' }); // longe dos dois encaixes
  });

  it('fan: índice pela posição horizontal', () => {
    // mao: x 800..1000; h1 e h2 em x 875 e 925
    expect(at({ x: 810, y: 400 })).toEqual({ zone: 'mao', index: 0 });
    expect(at({ x: 900, y: 400 })).toEqual({ zone: 'mao', index: 1 });
    expect(at({ x: 990, y: 400 })).toEqual({ zone: 'mao', index: 2 });
  });

  it('grupo: as outras peças arrastadas não contam no índice nem servem de alvo', () => {
    // arrastando x junto com h1: h1 sai do cálculo do leque (sobra h2, sozinho no centro)
    expect(findDropTarget(ps, scene, 'x', { x: 890, y: 400 }, { x: 890, y: 400 }, ['h1'])).toEqual({
      zone: 'mao',
      index: 0,
    });
    expect(
      findDropTarget(ps, scene, 'x', { x: 175, y: 75 }, { x: 175, y: 75 }, ['grade']),
    ).toMatchObject({ zone: 'area' }); // a grade vai junto: não é alvo
  });

  it('autoFill: a zona inteira é o alvo (o Gestor escolhe o encaixe)', () => {
    const g = pieces(
      zone('b', {
        layout: 'grid',
        autoFill: true,
        grid: { cols: 2, rows: 1, cell: { w: 50, h: 50 } },
      }),
      card('y'),
    );
    expect(findDropTarget(g, buildScene(g), 'y', { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({
      zone: 'b',
    });
    expect(candidateTargets(g, 'b', 'y')).toEqual([{ zone: 'b' }]);
  });

  it('candidateTargets lista os encaixes livres', () => {
    const withA = { ...ps, x: { ...ps.x!, parentId: 'tab', slot: 'a' } };
    expect(candidateTargets(withA, 'tab', 'h1')).toEqual([{ zone: 'tab', slot: 'b' }]);
    expect(candidateTargets(ps, 'mao', 'x')).toEqual([{ zone: 'mao' }]);
    expect(candidateTargets(ps, 'grade', 'x')).toHaveLength(8);
  });
});
