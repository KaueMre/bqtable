import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { isCommand, type Command } from './commands';
import { isEvent, type GameEvent } from './events';
import { createManager, type Manager, type ManagerOptions } from './manager';
import { randomInt } from './rng';
import type { Rule } from './rules';

/** A.calor muda → B.calor copia e a temperatura global sobe 1. */
const propagar: Rule = {
  id: 'propagar',
  react(ev) {
    if (!isEvent(ev, 'attrChanged') || ev.id !== 'A' || ev.key !== 'calor') return [];
    return [
      { type: 'setAttr', id: 'B', key: 'calor', value: ev.to },
      { type: 'setGlobal', key: 'temperatura', delta: 1 },
    ];
  },
};

/** B com calor >= 5 fica quente. */
const esquentar: Rule = {
  id: 'esquentar',
  react(ev, s) {
    if (!isEvent(ev, 'attrChanged') || ev.id !== 'B') return [];
    const quente = Number(ev.to) >= 5;
    const status = quente ? 'quente' : 'frio';
    return s.pieces.B?.status === status ? [] : [{ type: 'setStatus', id: 'B', status }];
  },
};

function setup(options: ManagerOptions = {}, extraRules: Rule[] = []): Manager {
  const m = createManager({ seed: 42, globals: { temperatura: 0 }, players: ['p1'], ...options });
  m.registerKind({
    kind: 'bloco',
    statuses: ['frio', 'quente'],
    transitions: { frio: ['quente'], quente: ['frio'] },
    attributes: z.object({ calor: z.number().int().min(0).max(10) }),
  });
  for (const id of ['A', 'B']) {
    const r = m.dispatch({
      type: 'createPiece',
      piece: { id, kind: 'bloco', attributes: { calor: 0 } },
    });
    if (!r.ok) throw new Error(r.error);
  }
  for (const rule of [propagar, esquentar, ...extraRules]) m.registerRule(rule);
  return m;
}

const describeLog = (m: Manager, from = 0) =>
  m
    .getState()
    .log.slice(from)
    .map((e) => {
      const ev = e.event as GameEvent & { id?: string; key?: string };
      return `${'  '.repeat(e.depth)}${e.event.type} ${ev.id ?? ev.key ?? ''} ${e.by ?? ''}`.trimEnd();
    });

describe('critério da fase 2', () => {
  it('atributo de A dispara regra que altera B e um global; desfazer volta tudo; log mostra a sequência', () => {
    const m = setup();
    const before = m.getState();

    const r = m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 6 });
    expect(r.ok).toBe(true);

    const s = m.getState();
    expect(s.pieces.A?.attributes.calor).toBe(6);
    expect(s.pieces.B?.attributes.calor).toBe(6);
    expect(s.pieces.B?.status).toBe('quente');
    expect(s.globals.temperatura).toBe(1);
    expect(describeLog(m, before.log.length)).toEqual([
      'attrChanged A',
      '  attrChanged B propagar',
      '    statusChanged B esquentar',
      '  globalChanged temperatura propagar',
    ]);

    expect(m.undo().ok).toBe(true);
    expect(m.getState()).toBe(before);
    expect(m.getState().pieces.B?.status).toBe('frio');
    expect(m.getState().globals.temperatura).toBe(0);
  });
});

describe('dispatch', () => {
  it('devolve os eventos gerados', () => {
    const r = setup().dispatch({ type: 'move', id: 'A', x: 5, y: 7 });
    expect(r).toEqual({
      ok: true,
      value: [
        { type: 'pieceMoved', id: 'A', from: { x: 0, y: 0, z: 0 }, to: { x: 5, y: 7, z: 0 } },
      ],
    });
  });

  it('recusa comando desconhecido e peça inexistente sem mudar o estado', () => {
    const m = setup();
    const before = m.getState();
    expect(m.dispatch({ type: 'voar' })).toEqual({
      ok: false,
      error: 'comando desconhecido: "voar"',
    });
    expect(m.dispatch({ type: 'move', id: 'Z', x: 0, y: 0 })).toEqual({
      ok: false,
      error: 'peça "Z" não existe',
    });
    expect(m.getState()).toBe(before);
  });

  it('valida status e atributos pelo kind', () => {
    const m = setup();
    expect(m.dispatch({ type: 'setStatus', id: 'A', status: 'derretido' }).ok).toBe(false);
    expect(m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 11 }).ok).toBe(false);
    expect(m.dispatch({ type: 'createPiece', piece: { id: 'A', kind: 'bloco' } })).toEqual({
      ok: false,
      error: 'peça "A" já existe',
    });
  });

  it('delta soma ao valor atual', () => {
    const m = setup();
    m.dispatch({ type: 'setGlobal', key: 'temperatura', delta: 5 });
    m.dispatch({ type: 'setGlobal', key: 'temperatura', delta: -2 });
    m.dispatch({ type: 'setPlayerAttr', player: 'p1', key: 'foco', delta: 3 });
    expect(m.getState().globals.temperatura).toBe(3);
    expect(m.getState().players.p1?.attributes.foco).toBe(3);
    m.dispatch({ type: 'setGlobal', key: 'nome', value: 'loja' });
    expect(m.dispatch({ type: 'setGlobal', key: 'nome', delta: 1 }).ok).toBe(false);
  });

  it('não registra jogada sem eventos', () => {
    const m = setup();
    const before = m.getState();
    expect(m.dispatch({ type: 'setStatus', id: 'A', status: 'frio' })).toEqual({
      ok: true,
      value: [],
    });
    expect(m.getState()).toBe(before);
  });

  it('estado é imutável e serializável', () => {
    const m = setup();
    m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 6 });
    const s = m.getState();
    expect(Object.isFrozen(s.pieces.A)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('regras', () => {
  it('validate recusa o comando com o motivo', () => {
    const travado: Rule = {
      id: 'travado',
      validate: (cmd) => (isCommand(cmd, 'move') && cmd.id === 'B' ? 'B está travado' : true),
    };
    const m = setup({}, [travado]);
    expect(m.dispatch({ type: 'move', id: 'B', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'B está travado',
    });
    expect(m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 }).ok).toBe(true);
  });

  it('reação inválida desfaz a jogada inteira e diz qual regra falhou', () => {
    const exagerar: Rule = {
      id: 'exagerar',
      react: (ev) =>
        isEvent(ev, 'attrChanged') && ev.id === 'A'
          ? [{ type: 'setAttr', id: 'B', key: 'calor', value: 99 }]
          : [],
    };
    const m = setup({}, [exagerar]);
    const before = m.getState();
    const r = m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\(reação "exagerar": setAttr\)$/);
    expect(m.getState()).toBe(before);
  });

  it('cascata infinita é cortada pelo limite', () => {
    const eco: Rule = {
      id: 'eco',
      react: (ev) =>
        isEvent(ev, 'attrChanged') && ev.id === 'A'
          ? [{ type: 'setAttr', id: 'A', key: 'calor', value: (Number(ev.to) + 1) % 10 }]
          : [],
    };
    const m = setup({ maxDepth: 8 }, [eco]);
    const before = m.getState();
    const r = m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cascata de reações passou de 8 níveis/);
    expect(m.getState()).toBe(before);
  });

  it('limite de comandos por jogada', () => {
    const leque: Rule = {
      id: 'leque',
      react: (ev) =>
        isEvent(ev, 'globalChanged')
          ? [
              { type: 'setGlobal', key: 'x', delta: 1 },
              { type: 'setGlobal', key: 'y', delta: 1 },
            ]
          : [],
    };
    const m = setup({ maxCommands: 50, maxDepth: 1000 }, [leque]);
    const r = m.dispatch({ type: 'setGlobal', key: 'temperatura', value: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mais de 50 comandos/);
  });

  it('regra que lança exceção recusa a jogada, sem quebrar o Gestor', () => {
    const m = setup();
    let misbehave = true;
    m.registerRule({
      id: 'errada',
      react: () => {
        if (misbehave) m.dispatch({ type: 'setGlobal', key: 'x', value: 1 }); // proibido
        return [];
      },
    });
    m.registerRule({
      id: 'quebrada',
      validate: (cmd) => {
        if (isCommand(cmd, 'rotate')) throw new Error('bug na regra');
        return true;
      },
    });
    const before = m.getState();
    const r = m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/regra "errada" falhou: dispatch durante uma jogada/);
    expect(m.dispatch({ type: 'rotate', id: 'A', rotation: 90 })).toEqual({
      ok: false,
      error: 'regra "quebrada" falhou: bug na regra',
    });
    expect(m.getState()).toBe(before);
    misbehave = false;
    expect(m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 }).ok).toBe(true);
  });

  it('comando composto (expand): vira outros comandos, tudo ou nada', () => {
    const m = setup();
    m.registerCommand({
      type: 'aquecerTudo',
      expand: (cmd) => [
        { type: 'setAttr', id: 'A', key: 'calor', value: Number(cmd.calor) },
        { type: 'setGlobal', key: 'temperatura', delta: 5 },
      ],
    });
    const start = m.getState().log.length;
    expect(m.dispatch({ type: 'aquecerTudo', calor: 6 }).ok).toBe(true);
    expect(m.getState().globals.temperatura).toBe(6); // 1 da regra propagar + 5
    expect(describeLog(m, start)[0]).toBe('  attrChanged A'); // nível 1: veio do comando composto
    const before = m.getState();
    expect(m.dispatch({ type: 'aquecerTudo', calor: 99 }).ok).toBe(false); // calor > 10
    expect(m.getState()).toBe(before);
    m.undo();
    expect(m.getState().globals.temperatura).toBe(0); // um desfazer volta a jogada inteira
  });

  it('comando do jogo que lança exceção vira recusa; registro exige execute ou expand', () => {
    const m = setup();
    m.registerCommand({
      type: 'bug',
      execute: () => {
        throw new Error('ops');
      },
    });
    expect(m.dispatch({ type: 'bug' })).toEqual({ ok: false, error: 'comando "bug" falhou: ops' });
    expect(() => m.registerCommand({ type: 'nada' })).toThrow('defina execute ou expand');
  });

  it('recusa registros repetidos', () => {
    const m = setup();
    expect(() => m.registerRule(propagar)).toThrow('já registrada');
    expect(() => m.registerCommand({ type: 'move', execute: () => [] })).toThrow('já existe');
    expect(() => m.registerCommand({ type: 'ask', execute: () => [] })).toThrow('já existe');
  });
});

describe('subscribe e on', () => {
  it('avisam depois de cada jogada e de cada desfazer', () => {
    const m = setup();
    const sub = vi.fn();
    const onGlobal = vi.fn();
    const off = m.subscribe(sub);
    m.on('globalChanged', onGlobal);

    m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 1 });
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0]?.[0]).toBe(m.getState());
    expect(sub.mock.calls[0]?.[1]).toHaveLength(3);
    expect(onGlobal).toHaveBeenCalledWith(
      { type: 'globalChanged', key: 'temperatura', from: 0, to: 1 },
      m.getState(),
    );

    m.undo();
    expect(sub).toHaveBeenLastCalledWith(m.getState(), []);

    off();
    m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 });
    expect(sub).toHaveBeenCalledTimes(2);
  });

  it('jogada recusada não avisa ninguém', () => {
    const m = setup();
    const sub = vi.fn();
    m.subscribe(sub);
    m.dispatch({ type: 'voar' });
    expect(sub).not.toHaveBeenCalled();
  });
});

describe('undo', () => {
  it('volta uma jogada por vez até acabar', () => {
    const m = setup();
    const s0 = m.getState();
    m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 });
    const s1 = m.getState();
    m.dispatch({ type: 'move', id: 'A', x: 2, y: 2 });
    m.undo();
    expect(m.getState()).toBe(s1);
    m.undo();
    expect(m.getState()).toBe(s0);
    m.undo(); // createPiece B
    m.undo(); // createPiece A
    expect(m.undo()).toEqual({ ok: false, error: 'nada para desfazer' });
    expect(m.canUndo()).toBe('nada para desfazer');
  });

  it('respeita o limite de passos', () => {
    const m = setup({ maxUndo: 2 });
    for (let x = 1; x <= 3; x++) m.dispatch({ type: 'move', id: 'A', x, y: 0 });
    expect(m.undo().ok).toBe(true);
    expect(m.undo().ok).toBe(true);
    expect(m.undo()).toEqual({ ok: false, error: 'limite de 2 passos para desfazer' });
    expect(m.getState().pieces.A?.transform.x).toBe(1);
  });

  it('clearHistory impede desfazer o setup', () => {
    const m = setup();
    m.clearHistory();
    const afterSetup = m.getState();
    expect(m.canUndo()).toBe('nada para desfazer');
    m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 });
    m.undo();
    expect(m.getState()).toBe(afterSetup);
    expect(m.undo()).toEqual({ ok: false, error: 'nada para desfazer' });
    expect(m.getState().pieces.A).toBeDefined();
  });
});

/** Comando do jogo que usa sorteio: calor aleatório em A. */
function withDraw(m: Manager): Manager {
  m.registerCommand({
    type: 'sortear',
    execute(_cmd, { state, kinds, random }) {
      const a = state.pieces.A!;
      const to = randomInt(random, 11);
      const v = kinds.validateAttr(a, 'calor', to);
      if (v !== true) return v;
      return [{ type: 'attrChanged', id: 'A', key: 'calor', from: a.attributes.calor ?? null, to }];
    },
  });
  return m;
}

describe('sorteio e informação revelada', () => {
  const draws = (seed: number) => {
    const m = withDraw(setup({ seed }));
    return Array.from({ length: 6 }, () => {
      m.dispatch({ type: 'sortear' });
      return m.getState().pieces.A?.attributes.calor;
    });
  };

  it('mesma semente, mesmos resultados', () => {
    expect(draws(7)).toEqual(draws(7));
    expect(draws(7)).not.toEqual(draws(8));
  });

  it('o estado do gerador avança e fica no log', () => {
    const m = withDraw(setup());
    const rng = m.getState().rng;
    const r = m.dispatch({ type: 'sortear' });
    expect(m.getState().rng).not.toBe(rng);
    if (r.ok) expect(r.value[0]).toMatchObject({ type: 'rngAdvanced', revealsInfo: true });
  });

  it('não dá para desfazer depois de revelar informação', () => {
    const m = withDraw(setup());
    m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 });
    m.dispatch({ type: 'sortear' });
    const reason = 'informação revelada: não dá para desfazer';
    expect(m.canUndo()).toBe(reason);
    expect(m.undo()).toEqual({ ok: false, error: reason });

    const revealed = m.getState();
    m.dispatch({ type: 'move', id: 'B', x: 3, y: 3 });
    expect(m.canUndo()).toBe(true);
    m.undo();
    expect(m.getState()).toBe(revealed);
    expect(m.undo()).toEqual({ ok: false, error: reason });
  });
});

describe('escolhas pendentes', () => {
  /** B fica quente → pergunta ao jogador se quer +10 de temperatura. */
  const premio: Rule = {
    id: 'premio',
    react: (ev) =>
      isEvent(ev, 'statusChanged') && ev.id === 'B' && ev.to === 'quente'
        ? [
            {
              type: 'ask',
              rule: 'premio',
              prompt: 'Prêmio?',
              player: 'p1',
              options: ['sim', 'não'],
            },
          ]
        : [],
    resolve: (_choice, value) =>
      value === 'sim' ? [{ type: 'setGlobal', key: 'temperatura', delta: 10 }] : [],
  };

  const heat = (m: Manager) => m.dispatch({ type: 'setAttr', id: 'A', key: 'calor', value: 6 });

  it('pausa a jogada e guarda o resto da fila', () => {
    const m = setup({}, [premio]);
    expect(heat(m).ok).toBe(true);
    const s = m.getState();
    expect(s.pending).toMatchObject({ rule: 'premio', prompt: 'Prêmio?', player: 'p1' });
    expect(s.pending?.resume.map((q) => q.cmd)).toEqual([
      { type: 'setGlobal', key: 'temperatura', delta: 1 },
    ]);
    expect(s.globals.temperatura).toBe(0);
  });

  it('só aceita a resposta enquanto espera', () => {
    const m = setup({}, [premio]);
    heat(m);
    const id = m.getState().pending!.id;
    expect(m.dispatch({ type: 'move', id: 'A', x: 1, y: 1 })).toEqual({
      ok: false,
      error: 'aguardando escolha: Prêmio?',
    });
    expect(m.dispatch({ type: 'choose', choiceId: 'outra', value: 'sim' }).ok).toBe(false);
    expect(m.dispatch({ type: 'choose', choiceId: id, value: 'talvez' })).toEqual({
      ok: false,
      error: 'opção inválida para "Prêmio?"',
    });
  });

  it('a resposta roda a regra e depois retoma a fila', () => {
    const m = setup({}, [premio]);
    heat(m);
    const choiceId = m.getState().pending!.id;
    const start = m.getState().log.length;
    expect(m.dispatch({ type: 'choose', choiceId, value: 'sim' }).ok).toBe(true);
    expect(m.getState().pending).toBeNull();
    expect(m.getState().globals.temperatura).toBe(11);
    expect(describeLog(m, start)).toEqual([
      'choiceMade',
      '  globalChanged temperatura premio',
      '  globalChanged temperatura propagar',
    ]);
  });

  it('desfazer a resposta volta para a escolha pendente', () => {
    const m = setup({}, [premio]);
    heat(m);
    const waiting = m.getState();
    m.dispatch({ type: 'choose', choiceId: waiting.pending!.id, value: 'não' });
    m.undo();
    expect(m.getState()).toBe(waiting);
  });

  it('ask para regra sem resolve é recusado', () => {
    const m = setup();
    const cmd: Command = { type: 'ask', rule: 'propagar', prompt: '?' };
    expect(m.dispatch(cmd)).toEqual({ ok: false, error: 'regra "propagar" não resolve escolhas' });
  });
});
