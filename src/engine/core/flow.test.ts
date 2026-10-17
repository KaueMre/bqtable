import { describe, expect, it } from 'vitest';
import { isEvent } from './events';
import { createManager, type Manager } from './manager';
import { spawn } from './prefab';

function setup(): Manager {
  const m = createManager({ seed: 1, players: ['p1', 'p2'] });
  m.registerKind({ kind: 'zona' });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    reveals: [['faceDown', 'faceUp']], // virar uma carta do deck revela o que ela é
  });
  m.registerKind({ kind: 'ficha' });
  const r = m.dispatch(
    spawn([
      { id: 'deck', kind: 'zona', zone: { layout: 'stack' } },
      { id: 'mao', kind: 'zona', zone: { layout: 'fan', statusOnEnter: 'faceUp' } },
      { id: 'c1', kind: 'carta', status: 'faceDown', parentId: 'deck' },
      { id: 'c2', kind: 'carta', status: 'faceDown', parentId: 'deck' },
      { id: 'c3', kind: 'carta', status: 'faceDown', parentId: 'deck' },
      { id: 'f1', kind: 'ficha' },
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

describe('fim de partida (endGame)', () => {
  it('guarda o resultado e recusa novas jogadas; desfazer ainda funciona', () => {
    const m = setup();
    m.dispatch({ type: 'move', id: 'f1', x: 1, y: 1 });
    const r = m.dispatch({ type: 'endGame', result: 'win', message: '4 Stars', score: 12 });
    expect(r.ok).toBe(true);
    expect(m.getState().ended).toEqual({ result: 'win', message: '4 Stars', score: 12 });
    expect(m.dispatch({ type: 'move', id: 'f1', x: 2, y: 2 })).toEqual({
      ok: false,
      error: 'a partida acabou',
    });
    expect(m.check({ type: 'move', id: 'f1', x: 2, y: 2 })).toBe('a partida acabou');
    m.undo();
    expect(m.getState().ended).toBeNull();
    expect(m.dispatch({ type: 'move', id: 'f1', x: 2, y: 2 }).ok).toBe(true);
  });

  it('uma reação pode encerrar; o resto da jogada não roda', () => {
    const m = setup();
    m.registerRule({
      id: 'vitoria',
      react: (ev) =>
        isEvent(ev, 'pieceMoved') && ev.id === 'f1'
          ? [
              { type: 'endGame', result: 'win' },
              { type: 'setGlobal', key: 'depois', value: 1 },
            ]
          : [],
    });
    expect(m.dispatch({ type: 'move', id: 'f1', x: 9, y: 9 }).ok).toBe(true);
    expect(m.getState().ended?.result).toBe('win');
    expect(m.getState().globals.depois).toBeUndefined();
    expect(m.dispatch({ type: 'endGame', result: 'lose' }).ok).toBe(false);
  });
});

describe('escolhas (ask)', () => {
  const pedir = (m: Manager, ask: object) => {
    m.registerRule({
      id: 'pergunta',
      resolve: (_c, value) => [{ type: 'setGlobal', key: 'resposta', value }],
    });
    return m.dispatch({ type: 'ask', rule: 'pergunta', prompt: 'Qual?', ...ask });
  };

  it('rótulos por opção', () => {
    const m = setup();
    expect(pedir(m, { options: ['a', 'b'], labels: ['Alfa', 'Beta'] }).ok).toBe(true);
    expect(m.getState().pending).toMatchObject({ options: ['a', 'b'], labels: ['Alfa', 'Beta'] });
    const outra = setup();
    expect(pedir(outra, { options: ['a', 'b'], labels: ['Alfa'] })).toEqual({
      ok: false,
      error: 'ask: labels precisa ter um texto por opção',
    });
  });

  it('escolher na mesa: as opções são peças', () => {
    const m = setup();
    expect(pedir(m, { pick: 'piece', options: ['c1', 'c2'] }).ok).toBe(true);
    const id = m.getState().pending!.id;
    expect(m.dispatch({ type: 'choose', choiceId: id, value: 'c3' }).ok).toBe(false);
    expect(m.dispatch({ type: 'choose', choiceId: id, value: 'c2' }).ok).toBe(true);
    expect(m.getState().globals.resposta).toBe('c2');
    expect(pedir(setup(), { pick: 'piece', options: ['nao-existe'] }).ok).toBe(false);
  });

  it('várias opções: lista, sem repetir, dentro do mínimo e máximo', () => {
    const m = setup();
    pedir(m, { pick: 'piece', options: ['c1', 'c2', 'c3'], multiple: { min: 1, max: 2 } });
    const id = m.getState().pending!.id;
    const responder = (value: unknown) => m.dispatch({ type: 'choose', choiceId: id, value });
    expect(responder('c1')).toEqual({ ok: false, error: '"Qual?": responda com uma lista' });
    expect(responder([])).toEqual({ ok: false, error: '"Qual?": escolha de 1 a 2' });
    expect(responder(['c1', 'c1'])).toEqual({ ok: false, error: '"Qual?": opção repetida' });
    expect(responder(['c1', 'f1']).ok).toBe(false);
    expect(responder(['c3', 'c1']).ok).toBe(true);
    expect(m.getState().globals.resposta).toEqual(['c3', 'c1']);
  });
});

describe('escolhas com botões e por arrasto', () => {
  it('buttons: respostas extras, aceitas mesmo com pick e multiple', () => {
    const m = setup();
    m.registerRule({
      id: 'r',
      resolve: (_c, value) => [{ type: 'setGlobal', key: 'resposta', value }],
    });
    m.dispatch({
      type: 'ask',
      rule: 'r',
      prompt: 'Quais?',
      pick: 'piece',
      options: ['c1', 'c2'],
      multiple: { min: 1, max: 2 },
      buttons: [{ value: 'pular', label: 'Pular' }],
    });
    const id = m.getState().pending!.id;
    expect(m.getState().pending!.buttons).toEqual([{ value: 'pular', label: 'Pular' }]);
    expect(m.dispatch({ type: 'choose', choiceId: id, value: 'outra' }).ok).toBe(false);
    expect(m.dispatch({ type: 'choose', choiceId: id, value: 'pular' }).ok).toBe(true);
    expect(m.getState().globals.resposta).toBe('pular');
    const r = m.dispatch({
      type: 'ask',
      rule: 'r',
      prompt: 'x',
      buttons: [{ label: 'sem valor' }],
    });
    expect(r).toEqual({ ok: false, error: 'ask: buttons é uma lista de { value, label }' });
  });

  it('pick drop: a resposta é a peça e o destino; a regra transforma em jogada', () => {
    const m = setup();
    m.registerRule({
      id: 'baixar',
      resolve: (_c, v) =>
        v === 'pular' ? [] : [{ type: 'dropInto', ...(v as { id: string; zone: string | null }) }],
    });
    const ask = {
      type: 'ask',
      rule: 'baixar',
      prompt: 'Baixe uma carta',
      pick: 'drop',
      options: ['c3', 'c2'],
      buttons: [{ value: 'pular', label: 'Pular' }],
    };
    expect(m.dispatch(ask).ok).toBe(true);
    const id = m.getState().pending!.id;
    const choose = (value: unknown) => m.dispatch({ type: 'choose', choiceId: id, value });
    expect(choose('c3')).toEqual({ ok: false, error: '"Baixe uma carta": arraste uma das peças' });
    expect(choose({ id: 'c1', zone: 'mao' }).ok).toBe(false); // c1 não é opção
    expect(choose({ id: 'c3', zone: 'f1' }).ok).toBe(false); // a regra recusa: f1 não é zona
    expect(m.getState().pending?.id).toBe(id); // continua esperando
    expect(choose({ id: 'c3', zone: 'mao' }).ok).toBe(true);
    expect(m.getState().pieces.c3).toMatchObject({ parentId: 'mao', status: 'faceUp' });
    expect(m.getState().pending).toBeNull();
    expect(m.dispatch({ ...ask, multiple: { min: 1, max: 1 } })).toEqual({
      ok: false,
      error: 'ask: pick "drop" responde uma peça por vez',
    });
  });
});

describe('log do jogo', () => {
  it('log vira o evento message; cada entrada sabe a jogada', () => {
    const m = setup();
    m.registerRule({
      id: 'narra',
      react: (ev) =>
        isEvent(ev, 'pieceMoved') ? [{ type: 'log', message: `moveu ${ev.id}` }] : [],
    });
    m.dispatch({ type: 'move', id: 'f1', x: 1, y: 1, actor: 'p1' });
    m.dispatch({ type: 'log', message: 'só para o p2', to: 'p2' });
    const log = m.getState().log;
    const [moveu, msg, privada] = log.slice(-3);
    expect(msg!.event).toEqual({ type: 'message', text: 'moveu f1' });
    expect(msg!.play).toBe(moveu!.play); // mesma jogada
    expect(privada!.play).not.toBe(moveu!.play);
    expect(privada!.event).toEqual({ type: 'message', text: 'só para o p2', to: 'p2' });
    expect(m.dispatch({ type: 'log', message: '' }).ok).toBe(false);
    expect(m.dispatch({ type: 'log', message: 'x', to: 'p9' }).ok).toBe(false);
  });
});

describe('status que revela (reveals)', () => {
  it('comprar (a carta vira ao entrar na mão) bloqueia o desfazer', () => {
    const m = setup();
    m.dispatch({ type: 'move', id: 'f1', x: 1, y: 1 });
    expect(m.canUndo()).toBe(true);
    const r = m.dispatch({ type: 'dropInto', id: 'c3', zone: 'mao' });
    expect(r.ok && r.value.find((e) => e.type === 'statusChanged')?.revealsInfo).toBe(true);
    expect(m.canUndo()).toBe('informação revelada: não dá para desfazer');
  });

  it('virar de volta para baixo não revela nada', () => {
    const m = setup();
    m.dispatch({ type: 'dropInto', id: 'c3', zone: 'mao' });
    m.dispatch({ type: 'setStatus', id: 'c3', status: 'faceDown' });
    expect(m.canUndo()).toBe(true);
  });
});
