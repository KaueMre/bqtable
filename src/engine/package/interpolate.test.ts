import { describe, expect, it } from 'vitest';
import { interpolate, InterpolationError, truthy } from './interpolate';

const scope = {
  id: 'C1',
  nome: 'Faísca',
  custo: 2,
  elemento: 'fogo',
  extra: null,
  req: { Traço: 3 },
};
const lookups = { cor: { fogo: '#e5533d' } };

describe('interpolate', () => {
  it('preenche campos e caminhos com ponto', () => {
    expect(interpolate('{nome} custa {custo}', scope)).toBe('Faísca custa 2');
    expect(interpolate('{req.Traço}', scope)).toBe(3);
  });

  it('marcador sozinho mantém o tipo', () => {
    expect(interpolate('{custo}', scope)).toBe(2);
    expect(interpolate({ x: '{custo}', tags: ['{elemento}'] }, scope)).toEqual({
      x: 2,
      tags: ['fogo'],
    });
  });

  it('filtros: tabela, repeat, default, upper', () => {
    expect(interpolate('{elemento|cor}', scope, { lookups })).toBe('#e5533d');
    expect(interpolate('{custo|repeat:●}', scope)).toBe('●●');
    expect(interpolate('{extra|default:—}', scope)).toBe('—');
    expect(interpolate('{extra|default:0}', scope)).toBe(0); // sozinho: mantém o tipo
    expect(interpolate('x{extra|default:0}', scope)).toBe('x0');
    expect(interpolate('{elemento|upper}', scope)).toBe('FOGO');
  });

  it('modo estrito acusa campo inexistente; o normal deixa vazio', () => {
    expect(() => interpolate('{nmoe}', scope, { strict: true })).toThrow(
      new InterpolationError('campo desconhecido: {nmoe}'),
    );
    expect(interpolate('[{nmoe}]', scope)).toBe('[]');
    expect(() => interpolate('{elemento|cores}', scope, { lookups })).toThrow(
      'tabela desconhecida',
    );
  });

  it('truthy', () => {
    expect([truthy(''), truthy('0'), truthy('null'), truthy('x'), truthy(1)]).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});
