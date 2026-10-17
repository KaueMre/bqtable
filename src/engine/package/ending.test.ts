import { describe, expect, it } from 'vitest';
import { endTitle, nameList } from './ending';

const names: Record<string, string> = { p1: 'Ana', p2: 'Bia', p3: 'Caio' };
const nameOf = (id: string) => names[id] ?? id;

describe('endTitle', () => {
  it('um vencedor: "Você venceu!" para ele, o nome para os outros', () => {
    const end = { winners: ['p2'] };
    expect(endTitle(end, 'p2', nameOf)).toEqual({ text: 'Você venceu!', tone: 'win' });
    expect(endTitle(end, 'p1', nameOf)).toEqual({ text: 'Vitória de Bia', tone: 'lose' });
  });

  it('tela sem assento (mesmo aparelho): sempre o nome', () => {
    expect(endTitle({ winners: ['p2'] }, null, nameOf)).toEqual({
      text: 'Vitória de Bia',
      tone: 'win',
    });
  });

  it('mais de um vencedor é empate, com os nomes', () => {
    expect(endTitle({ winners: ['p1', 'p2', 'p3'] }, 'p1', nameOf)).toEqual({
      text: 'Empate: Ana, Bia e Caio',
      tone: 'draw',
    });
  });

  it('sem winners, o result (solo e cooperativo)', () => {
    expect(endTitle({ result: 'win' }, null, nameOf)).toEqual({ text: 'Vitória!', tone: 'win' });
    expect(endTitle({ result: 'lose' }, 'p1', nameOf)).toEqual({ text: 'Derrota', tone: 'lose' });
    expect(endTitle({ result: 'draw' }, null, nameOf).text).toBe('Empate');
  });
});

describe('nameList', () => {
  it('junta com vírgula e "e"', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Ana'])).toBe('Ana');
    expect(nameList(['Ana', 'Bia'])).toBe('Ana e Bia');
    expect(nameList(['Ana', 'Bia', 'Caio'])).toBe('Ana, Bia e Caio');
  });
});
