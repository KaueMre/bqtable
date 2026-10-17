import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createKindRegistry, type KindAttributes, type KindDef } from './kinds';
import { createPiece, setStatus, type Piece } from './piece';

const cardKind = {
  kind: 'mindset-card',
  statuses: ['faceDown', 'faceUp', 'covered'],
  transitions: {
    faceDown: ['faceUp'],
    faceUp: ['faceDown', 'covered'],
    covered: ['faceUp'],
  },
  attributes: z.object({
    elemento: z.enum(['Traço', 'Sombra', 'Cor']),
    reputacao: z.number().int().min(1).max(3),
  }),
  defaults: {
    size: { w: 63, h: 88 },
    faces: { faceDown: 'verso.png' },
    tags: ['mindset'],
  },
} satisfies KindDef;

function setup() {
  const kinds = createKindRegistry();
  kinds.register(cardKind);
  kinds.register({ kind: 'token' });
  return kinds;
}

function newCard(kinds = setup()): Piece {
  const r = kinds.create({
    id: 'T01',
    kind: 'mindset-card',
    faces: { faceUp: 'T01.png' },
    tags: ['nivel-1'],
    attributes: { elemento: 'Traço', reputacao: 1 },
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('register', () => {
  it('recusa kind repetido', () => {
    const kinds = setup();
    expect(() => kinds.register({ kind: 'token' })).toThrow('já registrado');
  });

  it('recusa definição com status desconhecido', () => {
    const kinds = createKindRegistry();
    expect(() => kinds.register({ kind: 'x', statuses: ['a'], transitions: { a: ['b'] } })).toThrow(
      '"b" fora de statuses',
    );
    expect(() => kinds.register({ kind: 'y', statuses: ['a'], initialStatus: 'z' })).toThrow(
      '"z" fora de statuses',
    );
  });
});

describe('create', () => {
  it('aplica os padrões do kind e soma com os da peça', () => {
    const p = newCard();
    expect(p.status).toBe('faceDown');
    expect(p.size).toEqual({ w: 63, h: 88 });
    expect(p.faces).toEqual({ faceDown: 'verso.png', faceUp: 'T01.png' });
    expect(p.tags).toEqual(['mindset', 'nivel-1']);
  });

  it('não altera os padrões do kind', () => {
    newCard();
    expect(cardKind.defaults.faces).toEqual({ faceDown: 'verso.png' });
  });

  it('recusa kind não registrado', () => {
    const r = setup().create({ id: 'x', kind: 'dado' });
    expect(r).toEqual({ ok: false, error: 'tipo "dado" não registrado' });
  });

  it('recusa status fora da lista', () => {
    const r = setup().create({
      id: 'x',
      kind: 'mindset-card',
      status: 'inHand',
      attributes: { elemento: 'Cor', reputacao: 1 },
    });
    expect(r.ok).toBe(false);
  });

  it('recusa atributos inválidos', () => {
    const r = setup().create({
      id: 'x',
      kind: 'mindset-card',
      attributes: { elemento: 'Fogo', reputacao: 1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^elemento:/);
  });

  it('kind sem schema aceita qualquer atributo', () => {
    const r = setup().create({ id: 'x', kind: 'token', attributes: { qualquer: [1, 'a'] } });
    expect(r.ok).toBe(true);
  });
});

describe('validateStatus', () => {
  it('aceita transição declarada', () => {
    expect(setup().validateStatus(newCard(), 'faceUp')).toBe(true);
  });

  it('recusa transição não declarada', () => {
    expect(setup().validateStatus(newCard(), 'covered')).toBe(
      '"mindset-card" não pode passar de "faceDown" para "covered"',
    );
  });

  it('segue a máquina de estados passo a passo', () => {
    const kinds = setup();
    const up = setStatus(newCard(kinds), 'faceUp');
    expect(kinds.validateStatus(up, 'covered')).toBe(true);
  });

  it('recusa status que não existe', () => {
    expect(setup().validateStatus(newCard(), 'sumiu')).toMatch(/não existe/);
  });

  it('manter o mesmo status é sempre válido', () => {
    expect(setup().validateStatus(newCard(), 'faceDown')).toBe(true);
  });

  it('sem transições declaradas, qualquer status vale', () => {
    const kinds = setup();
    const token = createPiece({ id: 't', kind: 'token' });
    expect(kinds.validateStatus(token, 'qualquer')).toBe(true);
  });

  it('recusa peça de kind não registrado', () => {
    const p = createPiece({ id: 'x', kind: 'dado' });
    expect(setup().validateStatus(p, 'a')).toBe('tipo "dado" não registrado');
  });
});

describe('validateAttr', () => {
  it('aceita valor válido', () => {
    expect(setup().validateAttr(newCard(), 'reputacao', 3)).toBe(true);
  });

  it('recusa valor fora do schema', () => {
    const kinds = setup();
    expect(kinds.validateAttr(newCard(kinds), 'reputacao', 4)).toMatch(/^reputacao:/);
    expect(kinds.validateAttr(newCard(kinds), 'reputacao', '2')).toMatch(/^reputacao:/);
    expect(kinds.validateAttr(newCard(kinds), 'elemento', null)).toMatch(/^elemento:/);
  });

  it('kind sem schema aceita qualquer valor', () => {
    const token = createPiece({ id: 't', kind: 'token' });
    expect(setup().validateAttr(token, 'x', { a: [true] })).toBe(true);
  });
});

describe('KindAttributes', () => {
  it('extrai o tipo dos atributos do schema', () => {
    expectTypeOf<KindAttributes<typeof cardKind>>().toEqualTypeOf<{
      elemento: 'Traço' | 'Sombra' | 'Cor';
      reputacao: number;
    }>();
  });
});
