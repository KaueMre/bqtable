import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { childrenOf } from 'bqtable/sdk';
import { loadGameFolder } from 'bqtable/testing';
import { apoios } from './tableau';

const pasta = fileURLToPath(new URL('..', import.meta.url));

describe('apoios (função pura, importada direto)', () => {
  it('a primeira fileira não precisa; as pontas precisam de um; o meio, de dois', () => {
    expect(apoios('0,1')).toEqual([]);
    expect(apoios('1,0')).toEqual(['0,0']);
    expect(apoios('1,1')).toEqual(['0,0', '0,1']);
    expect(apoios('1,3')).toEqual(['0,2']);
    expect(apoios('2,2')).toEqual(['1,1', '1,2']);
  });
});

describe('pirâmide: partida sem tela (pasta do jogo, regras em TypeScript)', () => {
  it('carta sem apoio é recusada; com apoio paga a energia e marca os pontos', async () => {
    const game = await loadGameFolder(pasta);
    const m = game.createManager({ players: 1, seed: 7 });
    const mao = () => childrenOf(m.getState().pieces, 'p1-mao');
    const energia = () => childrenOf(m.getState().pieces, 'p1-energia').length;
    const custo = (id: string) =>
      Number(
        game.data.cartas!.find((c) => c.id === m.getState().pieces[id]!.attributes.def)!.custo,
      );
    expect(mao()).toHaveLength(3);
    expect(energia()).toBe(3);

    const [carta] = mao().filter((c) => custo(c.id) <= 3);
    const jogar = (slot: string) =>
      m.dispatch({ type: 'dropInto', id: carta!.id, zone: 'p1-tableau', slot, actor: 'p1' });
    expect(jogar('1,0')).toEqual({ ok: false, error: 'faltam cartas de apoio em 0,0' });
    expect(jogar('0,0').ok).toBe(true);
    expect(energia()).toBe(3 - custo(carta!.id));
    expect(m.getState().globals['pontos-p1']).toBeGreaterThan(0);
  });

  it('comprar: só para a própria mão', async () => {
    const m = (await loadGameFolder(pasta)).createManager({ players: 2, seed: 1 });
    expect(m.dispatch({ type: 'comprar', mao: 'p2-mao', actor: 'p1' })).toEqual({
      ok: false,
      error: 'compre só para a sua mão',
    });
    expect(m.dispatch({ type: 'comprar', mao: 'p1-mao', actor: 'p1' }).ok).toBe(true);
    expect(childrenOf(m.getState().pieces, 'p1-mao')).toHaveLength(4);
  });
});
