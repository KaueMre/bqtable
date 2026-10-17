import { describe, expect, it } from 'vitest';
import { childrenOf, createManager, spawn, type Manager } from '@/engine/core';
import { applyFrom, commandFrom, redactFor, UNKNOWN_PIECE } from './redact';

/** Ana e Bia: mão virada para o outro, reserva escondida, e um deck virado para todos. */
function setup(): Manager {
  const m = createManager({ seed: 1, players: [{ id: 'ana' }, { id: 'bia' }] });
  m.registerKind({ kind: 'zona' });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    hiddenStatuses: ['faceDown'],
    defaults: { faces: { faceDown: 'verso.png' } },
  });
  const carta = (id: string, parentId: string, status = 'faceUp') => ({
    id,
    kind: 'carta',
    status,
    parentId,
    faces: { faceUp: `${id}.png` },
    attributes: { def: id },
    tags: ['t'],
  });
  const tabuleiro = (p: string) => [
    { id: p, kind: 'zona', owner: p, zone: { layout: 'free' as const } },
    {
      id: `${p}-mao`,
      kind: 'zona',
      parentId: p,
      zone: { layout: 'fan' as const, privacy: 'faceDown' as const },
    },
    {
      id: `${p}-reserva`,
      kind: 'zona',
      parentId: p,
      zone: { layout: 'stack' as const, privacy: 'hidden' as const },
    },
  ];
  const r = m.dispatch(
    spawn([
      ...tabuleiro('ana'),
      ...tabuleiro('bia'),
      { id: 'deck', kind: 'zona', zone: { layout: 'stack' } },
      carta('dragao', 'ana-mao'),
      carta('fada', 'bia-mao'),
      carta('ouro', 'bia-reserva'),
      ...['a', 'b', 'c', 'd'].map((id) => carta(id, 'deck', 'faceDown')),
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  m.clearHistory();
  return m;
}

const texto = (v: unknown) => JSON.stringify(v);

describe('redactFor: peças', () => {
  it('a mão do outro vem virada e com apelido; a reserva dele some', () => {
    const m = setup();
    const s = redactFor(m.getState(), 'ana', m.kinds);
    expect(s.pieces.dragao!.attributes).toEqual({ def: 'dragao' }); // a própria mão
    expect(s.pieces.fada).toBeUndefined();
    expect(s.pieces.ouro).toBeUndefined();
    const [daBia] = childrenOf(s.pieces, 'bia-mao');
    expect(daBia).toEqual(
      expect.objectContaining({
        id: 'bia-mao~0',
        status: 'faceDown',
        faces: { faceDown: 'verso.png' },
        attributes: {},
        tags: [],
      }),
    );
    expect(childrenOf(s.pieces, 'bia-reserva')).toEqual([]);
    expect(texto(s)).not.toMatch(/fada|ouro/);
  });

  it('o deck virado para todos: só posições, sem os ids reais, nem para o dono', () => {
    const m = setup();
    for (const viewer of ['ana', 'bia', null]) {
      const s = redactFor(m.getState(), viewer, m.kinds);
      expect(childrenOf(s.pieces, 'deck').map((p) => p.id)).toEqual([
        'deck~0',
        'deck~1',
        'deck~2',
        'deck~3',
      ]);
      expect(Object.keys(s.pieces)).not.toContain('a');
    }
  });

  it('depois de embaralhar, o apelido não segue a carta', () => {
    const m = setup();
    const antes = redactFor(m.getState(), 'ana', m.kinds);
    expect(m.dispatch({ type: 'shuffle', zone: 'deck' }).ok).toBe(true);
    const depois = redactFor(m.getState(), 'ana', m.kinds);
    // mesmos apelidos, na mesma ordem: nada diz qual carta foi para onde
    expect(childrenOf(depois.pieces, 'deck').map((p) => p.id)).toEqual(
      childrenOf(antes.pieces, 'deck').map((p) => p.id),
    );
    expect(texto(depois)).not.toMatch(/"[abcd]"/);
  });

  it('rng zerado; mesmo estado e jogador → mesmo objeto', () => {
    const m = setup();
    const s = redactFor(m.getState(), 'ana', m.kinds);
    expect(s.rng).toBe(0);
    expect(redactFor(m.getState(), 'ana', m.kinds)).toBe(s);
    expect(redactFor(m.getState(), 'bia', m.kinds)).not.toBe(s);
  });
});

describe('redactFor: log e escolhas', () => {
  it('sem mensagens para o outro, sem rng e sem eventos com peças que ele não vê', () => {
    const m = setup();
    m.dispatch({ type: 'log', message: 'só para a Bia', to: 'bia' });
    m.dispatch({ type: 'log', message: 'para todos' });
    m.dispatch({ type: 'dropInto', id: 'fada', zone: 'bia-reserva', actor: 'bia' });
    m.dispatch({ type: 'shuffle', zone: 'deck' });
    const log = redactFor(m.getState(), 'ana', m.kinds).log.map((e) => e.event);
    const tipos = log.map((e) => e.type);
    expect(tipos).not.toContain('rngAdvanced');
    expect(tipos).not.toContain('zoneShuffled');
    expect(log.filter((e) => e.type === 'message').map((e) => e.text)).toEqual(['para todos']);
    expect(texto(log)).not.toMatch(/fada|ouro|"[abcd]"/);
    // a Bia vê o que é dela
    const daBia = redactFor(m.getState(), 'bia', m.kinds).log.map((e) => e.event);
    expect(daBia.filter((e) => e.type === 'message')).toHaveLength(2);
    expect(texto(daBia)).toMatch(/fada/);
  });

  it('escolha de outro jogador vem sem opções; a própria, com apelidos', () => {
    const m = setup();
    m.registerRule({ id: 'escolher', resolve: () => [] });
    const r = m.dispatch({
      type: 'ask',
      rule: 'escolher',
      prompt: 'Uma carta do deck',
      player: 'bia',
      options: childrenOf(m.getState().pieces, 'deck').map((p) => p.id),
      context: { segredo: 'ouro' },
    });
    expect(r.ok).toBe(true);
    const ana = redactFor(m.getState(), 'ana', m.kinds).pending!;
    expect(ana).toMatchObject({ prompt: 'Uma carta do deck', player: 'bia', resume: [] });
    expect(ana.options).toBeUndefined();
    expect(ana.context).toBeUndefined();
    const bia = redactFor(m.getState(), 'bia', m.kinds).pending!;
    expect(bia.options).toEqual(['deck~0', 'deck~1', 'deck~2', 'deck~3']);
    expect(bia.context).toBeUndefined();
    expect(texto(redactFor(m.getState(), 'ana', m.kinds).log)).not.toMatch(/ouro|"[abcd]"/);
  });
});

describe('commandFrom', () => {
  it('apelido volta a ser o id real, e o actor é sempre o assento', () => {
    const m = setup();
    const s = m.getState();
    const topo = childrenOf(s.pieces, 'deck').at(-1)!.id;
    const cmd = commandFrom(s, 'ana', m.kinds, {
      type: 'dropInto',
      id: 'deck~3',
      zone: 'ana-mao',
      actor: 'bia',
    });
    expect(cmd).toEqual({
      ok: true,
      value: { type: 'dropInto', id: topo, zone: 'ana-mao', actor: 'ana' },
    });
    expect(m.dispatch(cmd.ok ? cmd.value : { type: 'x' }).ok).toBe(true);
    expect(redactFor(m.getState(), 'ana', m.kinds).pieces[topo]).toBeUndefined(); // virada na mão
  });

  it('dentro de um batch, o actor forjado também é trocado', () => {
    const m = setup();
    const cmd = commandFrom(m.getState(), 'ana', m.kinds, {
      type: 'batch',
      commands: [{ type: 'dropInto', id: 'dragao', zone: null, actor: 'bia' }],
    });
    expect(cmd).toEqual({
      ok: true,
      value: {
        type: 'batch',
        actor: 'ana',
        commands: [{ type: 'dropInto', id: 'dragao', zone: null, actor: 'ana' }],
      },
    });
  });

  it('id real de uma peça que ele não vê (adivinhado pelos dados) é recusado', () => {
    const m = setup();
    const s = m.getState();
    // "b" está no baralho virado: pegar a carta pelo nome seria trapaça
    expect(commandFrom(s, 'ana', m.kinds, { type: 'dropInto', id: 'b', zone: 'ana-mao' })).toEqual({
      ok: false,
      error: UNKNOWN_PIECE,
    });
    expect(commandFrom(s, 'ana', m.kinds, { type: 'x', ids: ['fada'] })).toMatchObject({
      ok: false,
    });
    expect(applyFrom(m, 'ana', { type: 'dropInto', id: 'b', zone: 'ana-mao' })).toEqual({
      ok: false,
      error: UNKNOWN_PIECE,
    });
    expect(m.getState()).toBe(s);
  });

  it('a recusa volta com o apelido, não com o id real', () => {
    const m = setup();
    const r = applyFrom(m, 'bia', { type: 'dropInto', id: 'ana-mao~0', zone: 'bia-mao' });
    expect(r).toEqual({ ok: false, error: '"ana-mao~0" é de Jogador 1' });
  });

  it('cada assento tem os próprios apelidos', () => {
    const m = setup();
    const s = m.getState();
    const id = (seat: string) => {
      const c = commandFrom(s, seat, m.kinds, { type: 'x', id: 'ana-mao~0' });
      return c.ok && c.value.id;
    };
    expect(id('bia')).toBe('dragao');
    expect(id('ana')).toBe('ana-mao~0');
  });
});
