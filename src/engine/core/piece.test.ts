import { describe, expect, it } from 'vitest';
import {
  createPiece,
  getFace,
  move,
  normalizeRotation,
  rotate,
  rotateBy,
  setAttr,
  setStatus,
} from './piece';

const card = () =>
  createPiece({
    id: 'c1',
    kind: 'card',
    status: 'faceDown',
    faces: { faceDown: 'verso.png', faceUp: 'frente.png' },
    attributes: { reputacao: 1 },
  });

describe('createPiece', () => {
  it('preenche os padrões', () => {
    const p = createPiece({ id: 'p', kind: 'token' });
    expect(p).toEqual({
      id: 'p',
      kind: 'token',
      transform: { x: 0, y: 0, rotation: 0, scale: 1, z: 0 },
      status: 'default',
      faces: {},
      size: { w: 100, h: 100 },
      attributes: {},
      tags: [],
      parentId: null,
    });
  });

  it('copia as coleções recebidas', () => {
    const tags = ['a'];
    const faces = { default: 'x.png' };
    const p = createPiece({ id: 'p', kind: 'token', tags, faces });
    tags.push('b');
    faces.default = 'y.png';
    expect(p.tags).toEqual(['a']);
    expect(p.faces.default).toBe('x.png');
  });

  it('normaliza a rotação inicial', () => {
    expect(
      createPiece({ id: 'p', kind: 't', transform: { rotation: -90 } }).transform.rotation,
    ).toBe(270);
  });

  it('é serializável em JSON sem perda', () => {
    const p = setAttr(card(), 'lista', [1, 'dois', { tres: true }, null]);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('transformações', () => {
  it('move só altera x e y, sem mexer na peça original', () => {
    const a = card();
    const b = move(a, { x: 10, y: 20 });
    expect(b.transform).toEqual({ x: 10, y: 20, rotation: 0, scale: 1, z: 0 });
    expect(a.transform.x).toBe(0);
  });

  it('move com z muda também a ordem de empilhamento', () => {
    expect(move(card(), { x: 1, y: 2, z: 5 }).transform.z).toBe(5);
  });

  it('rotate é absoluto e normalizado em [0, 360)', () => {
    expect(rotate(card(), 450).transform.rotation).toBe(90);
    expect(rotate(card(), -90).transform.rotation).toBe(270);
    expect(rotate(card(), -360).transform.rotation).toBe(0);
    expect(rotate(card(), 360).transform.rotation).toBe(0);
  });

  it('rotateBy acumula', () => {
    const p = rotateBy(rotateBy(rotateBy(card(), 90), 180), 180);
    expect(p.transform.rotation).toBe(90);
  });

  it('normalizeRotation não devolve -0', () => {
    expect(Object.is(normalizeRotation(-360), 0)).toBe(true);
  });
});

describe('status e imagem', () => {
  it('a imagem acompanha o status', () => {
    const p = card();
    expect(getFace(p)).toBe('verso.png');
    expect(getFace(setStatus(p, 'faceUp'))).toBe('frente.png');
  });

  it('usa faces.default quando o status não tem imagem própria', () => {
    const p = createPiece({
      id: 'p',
      kind: 't',
      status: 'covered',
      faces: { default: 'base.png' },
    });
    expect(getFace(p)).toBe('base.png');
  });

  it('devolve undefined sem imagem nenhuma', () => {
    expect(getFace(createPiece({ id: 'p', kind: 't' }))).toBeUndefined();
  });
});

describe('atributos', () => {
  it('setAttr cria e substitui sem mexer na peça original', () => {
    const a = card();
    const b = setAttr(setAttr(a, 'reputacao', 2), 'foco', 3);
    expect(b.attributes).toEqual({ reputacao: 2, foco: 3 });
    expect(a.attributes).toEqual({ reputacao: 1 });
  });
});
