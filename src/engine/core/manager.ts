import { castDraft, freeze, produce } from 'immer';
import {
  builtinCommands,
  expandDropMany,
  permissionError,
  QUEUE_COMMANDS,
  type Command,
  type CommandDef,
  type CommandOf,
} from './commands';
import { applyEvent, type GameEvent } from './events';
import { createKindRegistry, type KindDef, type KindRegistry } from './kinds';
import type { AttrValue } from './piece';
import { err, ok, type Result } from './result';
import { nextRandom } from './rng';
import type { Rule } from './rules';
import {
  createState,
  type GameState,
  type LogEntry,
  type DropAnswer,
  type PendingChoice,
  type PlayerInit,
  type QueuedCommand,
} from './state';

export type StateListener = (state: GameState, events: GameEvent[]) => void;
export type EventListener = (event: GameEvent, state: GameState) => void;

export interface ManagerOptions {
  seed?: number;
  globals?: Record<string, AttrValue>;
  players?: PlayerInit[];
  /** Níveis de reação em cascata antes de recusar a jogada. */
  maxDepth?: number;
  /** Comandos processados numa jogada antes de recusá-la. */
  maxCommands?: number;
  /** Passos guardados para desfazer. */
  maxUndo?: number;
}

export interface Manager {
  readonly kinds: KindRegistry;
  getState(): GameState;
  /** Processa o comando e todas as reações. Atômico: se algo falha, nada muda. */
  dispatch(cmd: Command): Result<GameEvent[]>;
  /** Simula o comando (com reações) sem aplicar: `true` ou o motivo da recusa. */
  check(cmd: Command): true | string;
  /** Avisa após cada jogada, `undo` e `clearHistory` (estes com lista de eventos vazia). */
  subscribe(fn: StateListener): () => void;
  on(type: string, fn: EventListener): () => void;
  /** Volta uma jogada inteira (comando + reações). */
  undo(): Result<void>;
  /** `true` ou o motivo de não poder desfazer. */
  canUndo(): true | string;
  /** Esquece o histórico: o que veio antes (ex.: setup da partida) não pode ser desfeito. */
  clearHistory(): void;
  registerRule(rule: Rule): void;
  registerKind(def: KindDef): void;
  registerCommand(def: CommandDef): void;
}

interface Step {
  events: GameEvent[];
  next?: QueuedCommand[]; // logo depois deste comando
  resume?: QueuedCommand[]; // no fim da fila
}

const NOTHING_TO_UNDO = 'nada para desfazer';

export function createManager(options: ManagerOptions = {}): Manager {
  const { maxDepth = 32, maxCommands = 1000, maxUndo = 100 } = options;
  const kinds = createKindRegistry();
  const rules: Rule[] = [];
  const commands = new Map<string, CommandDef>(builtinCommands.map((c) => [c.type, c]));
  const subscribers = new Set<StateListener>();
  const listeners = new Map<string, Set<EventListener>>();

  let state: GameState = freeze(
    createState({
      seed: options.seed ?? Math.floor(Math.random() * 2 ** 32),
      globals: options.globals,
      players: options.players,
    }),
    true,
  );
  let history: GameState[] = [];
  let undoFloor = NOTHING_TO_UNDO; // motivo quando o histórico acaba
  let running = false;

  const findRule = (id: string) => rules.find((r) => r.id === id);

  function ask(s: GameState, cmd: CommandOf<'ask'>, queue: QueuedCommand[]): Step | string {
    if (!findRule(cmd.rule)?.resolve) return `regra "${cmd.rule}" não resolve escolhas`;
    const { options, labels, pick, multiple, buttons } = cmd;
    if (labels && (!options || labels.length !== options.length)) {
      return 'ask: labels precisa ter um texto por opção';
    }
    if (pick !== undefined && pick !== 'piece' && pick !== 'drop') {
      return `ask: pick inválido: "${String(pick)}"`;
    }
    if (pick && !options?.every((o) => typeof o === 'string' && s.pieces[o])) {
      return `ask: com pick "${pick}", as opções são ids de peças que existem`;
    }
    if (multiple && (!options || multiple.min < 0 || multiple.max < multiple.min)) {
      return 'ask: multiple precisa de opções e de min ≤ max';
    }
    if (multiple && pick === 'drop') return 'ask: pick "drop" responde uma peça por vez';
    if (
      buttons !== undefined &&
      (!Array.isArray(buttons) ||
        !buttons.every((b) => b && typeof b.label === 'string' && b.value !== undefined))
    ) {
      return 'ask: buttons é uma lista de { value, label }';
    }
    const choice: PendingChoice = {
      id: `c${s.seq + 1}`,
      rule: cmd.rule,
      prompt: cmd.prompt,
      resume: queue.splice(0), // o resto da jogada espera a resposta
    };
    if (cmd.player !== undefined) choice.player = cmd.player;
    if (options !== undefined) choice.options = options;
    if (labels !== undefined) choice.labels = labels;
    if (pick !== undefined) choice.pick = pick;
    if (multiple !== undefined) choice.multiple = multiple;
    if (buttons !== undefined) choice.buttons = buttons;
    if (cmd.context !== undefined) choice.context = cmd.context;
    return { events: [{ type: 'choiceRequested', choice }] };
  }

  function choose(s: GameState, cmd: CommandOf<'choose'>, depth: number): Step | string {
    const p = s.pending;
    if (!p) return 'nenhuma escolha pendente';
    if (cmd.choiceId !== p.id) return `a escolha pendente é "${p.id}", não "${cmd.choiceId}"`;
    if (p.player !== undefined && cmd.actor !== undefined && cmd.actor !== p.player) {
      return `a escolha é de ${s.players[p.player]?.name ?? p.player}`;
    }
    const isOption = (v: AttrValue) => !p.options || p.options.some((o) => sameJson(o, v));
    const isButton = p.buttons?.some((b) => sameJson(b.value, cmd.value)) ?? false;
    if (isButton) {
      // botão: resposta aceita como está
    } else if (p.pick === 'drop') {
      const v = cmd.value as Partial<DropAnswer> | null;
      if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.id !== 'string') {
        return `"${p.prompt}": arraste uma das peças`;
      }
      if (!isOption(v.id)) return `"${p.prompt}": "${v.id}" não é uma das peças`;
      if (v.zone !== null && typeof v.zone !== 'string') return `"${p.prompt}": destino inválido`;
    } else if (p.multiple) {
      const list = cmd.value;
      if (!Array.isArray(list)) return `"${p.prompt}": responda com uma lista`;
      if (list.length < p.multiple.min || list.length > p.multiple.max) {
        return `"${p.prompt}": escolha de ${p.multiple.min} a ${p.multiple.max}`;
      }
      if (!list.every(isOption)) return `opção inválida para "${p.prompt}"`;
      if (new Set(list.map((v) => JSON.stringify(v))).size !== list.length) {
        return `"${p.prompt}": opção repetida`;
      }
    } else if (!isOption(cmd.value)) {
      return `opção inválida para "${p.prompt}"`;
    }
    const rule = findRule(p.rule);
    if (!rule?.resolve) return `regra "${p.rule}" não resolve escolhas`;
    const out = guard(`regra "${p.rule}"`, () => rule.resolve!(p, cmd.value, s));
    if (out instanceof Failure) return out.message;
    if (typeof out === 'string') return out;
    return {
      events: [{ type: 'choiceMade', choiceId: p.id, value: cmd.value }],
      next: out.map((c) => ({ cmd: c, depth: depth + 1, by: p.rule })),
      resume: p.resume,
    };
  }

  /** Calcula os eventos de um comando, sem aplicar. */
  function compute(s: GameState, item: QueuedCommand, queue: QueuedCommand[]): Step | string {
    const { cmd } = item;
    if (s.pending && cmd.type !== 'choose') return `aguardando escolha: ${s.pending.prompt}`;
    const denied = permissionError(s, cmd);
    if (denied) return denied;
    if (cmd.type === 'ask') return ask(s, cmd as CommandOf<'ask'>, queue);
    if (cmd.type === 'choose') return choose(s, cmd as CommandOf<'choose'>, item.depth);
    if (cmd.type === 'batch') {
      const { commands: list } = cmd as CommandOf<'batch'>;
      if (!Array.isArray(list)) return 'batch sem lista de comandos';
      // os comandos do lote são do mesmo jogador
      const withActor = (c: Command) =>
        c.actor === undefined && cmd.actor !== undefined ? { ...c, actor: cmd.actor } : c;
      return { events: [], next: list.map((c) => ({ ...item, cmd: withActor(c) })) };
    }
    if (cmd.type === 'dropMany') {
      const drop = cmd as CommandOf<'dropMany'>;
      const list = expandDropMany(s, drop);
      if (typeof list === 'string') return list;
      // depois de todas as peças (e das reações a cada uma), o evento do grupo
      const done: GameEvent = { type: 'piecesDropped', ids: [...drop.ids], zone: drop.zone };
      return {
        events: [],
        next: [...list.map((c) => ({ ...item, cmd: c })), { ...item, emit: [done] }],
      };
    }
    const def = commands.get(cmd.type);
    if (!def) return `comando desconhecido: "${cmd.type}"`;
    let rng = s.rng;
    let usedRandom = false;
    const ctx = {
      state: s,
      kinds,
      random() {
        usedRandom = true;
        const [value, next] = nextRandom(rng);
        rng = next;
        return value;
      },
    };
    const rngEvents = (): GameEvent[] =>
      usedRandom ? [{ type: 'rngAdvanced', to: rng, revealsInfo: true }] : [];
    const who = `comando "${cmd.type}"`;
    if (def.expand) {
      const out = guard(who, () => def.expand!(cmd, ctx));
      if (out instanceof Failure) return out.message;
      if (typeof out === 'string') return out;
      const next = out.map((c) => ({ ...item, cmd: c, depth: item.depth + 1 }));
      return { events: rngEvents(), next };
    }
    const out = guard(who, () => def.execute!(cmd, ctx));
    if (out instanceof Failure) return out.message;
    if (typeof out === 'string') return out;
    return { events: [...rngEvents(), ...out] };
  }

  function run(start: GameState, root: Command): Result<{ state: GameState; events: GameEvent[] }> {
    if (start.ended) return err('a partida acabou');
    let s = start;
    const play = start.seq + 1;
    const queue: QueuedCommand[] = [{ cmd: root, depth: 0 }];
    const events: GameEvent[] = [];
    for (let count = 1; queue.length > 0; count++) {
      const item = queue.shift()!;
      const fail = (msg: string) =>
        err(item.by ? `${msg} (reação "${item.by}": ${item.cmd.type})` : msg);
      if (count > maxCommands) return fail(`mais de ${maxCommands} comandos numa jogada`);
      if (item.depth > maxDepth) return fail(`cascata de reações passou de ${maxDepth} níveis`);

      const step = item.emit ? { events: item.emit } : compute(s, item, queue);
      if (typeof step === 'string') return fail(step);
      for (const rule of rules) {
        if (!rule.validate || item.emit) continue;
        const v = guard(`regra "${rule.id}"`, () => rule.validate!(item.cmd, s));
        if (v instanceof Failure) return fail(v.message);
        if (v !== true) return fail(v);
      }

      const reactions: QueuedCommand[] = [];
      for (const ev of step.events) {
        s = produce(s, (d) => {
          applyEvent(d, ev);
          d.seq += 1;
          const entry: LogEntry = { seq: d.seq, play, depth: item.depth, event: ev };
          if (item.by) entry.by = item.by;
          if (typeof item.cmd.actor === 'string') entry.actor = item.cmd.actor;
          d.log.push(castDraft(entry));
        });
        events.push(ev);
        if (ev.type === 'choiceRequested') continue; // a jogada pausa aqui
        for (const rule of rules) {
          if (!rule.react) continue;
          const out = guard(`regra "${rule.id}"`, () => rule.react!(ev, s));
          if (out instanceof Failure) return fail(out.message);
          for (const cmd of out) reactions.push({ cmd, depth: item.depth + 1, by: rule.id });
        }
      }
      if (s.ended) break; // a partida acabou aqui: o resto da jogada não roda
      queue.unshift(...(step.next ?? []), ...reactions);
      queue.push(...(step.resume ?? []));
    }
    return ok({ state: s, events });
  }

  function notify(events: GameEvent[]) {
    for (const fn of [...subscribers]) fn(state, events);
    for (const ev of events) {
      for (const fn of [...(listeners.get(ev.type) ?? [])]) fn(ev, state);
    }
  }

  /** Roda a jogada sobre o estado atual sem publicar nada. */
  function guardedRun(cmd: Command, what: string) {
    assertIdle(what);
    running = true;
    try {
      return run(state, cmd);
    } finally {
      running = false;
    }
  }

  function assertIdle(what: string) {
    if (running) {
      throw new Error(`${what} durante uma jogada: regras devem devolver comandos em react`);
    }
  }

  return {
    kinds,

    getState: () => state,

    dispatch(cmd) {
      const result = guardedRun(cmd, 'dispatch');
      if (!result.ok) return result;
      const { events } = result.value;
      if (events.length === 0) return ok(events);

      if (events.some((e) => e.revealsInfo)) {
        history = [];
        undoFloor = 'informação revelada: não dá para desfazer';
      } else {
        history.push(state);
        if (history.length > maxUndo) {
          history.shift();
          undoFloor = `limite de ${maxUndo} passos para desfazer`;
        }
      }
      state = result.value.state;
      notify(events);
      return ok(events);
    },

    check(cmd) {
      const result = guardedRun(cmd, 'check');
      return result.ok ? true : result.error;
    },

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    on(type, fn) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set.add(fn));
      return () => set.delete(fn);
    },

    undo() {
      assertIdle('undo');
      const prev = history.pop();
      if (!prev) return err(undoFloor);
      state = prev;
      notify([]);
      return ok(undefined);
    },

    canUndo: () => (history.length > 0 ? true : undoFloor),

    clearHistory() {
      assertIdle('clearHistory');
      history = [];
      undoFloor = NOTHING_TO_UNDO;
      notify([]); // canUndo mudou
    },

    registerRule(rule) {
      if (findRule(rule.id)) throw new Error(`regra "${rule.id}" já registrada`);
      rules.push(rule);
    },

    registerKind: (def) => kinds.register(def),

    registerCommand(def) {
      if ((QUEUE_COMMANDS as readonly string[]).includes(def.type) || commands.has(def.type)) {
        throw new Error(`comando "${def.type}" já existe`);
      }
      if (!def.execute === !def.expand) {
        throw new Error(`comando "${def.type}": defina execute ou expand (um dos dois)`);
      }
      commands.set(def.type, def);
    },
  };
}

/** Falha dentro de código do jogo (regra ou comando); vira recusa da jogada. */
class Failure {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** Código do jogo pode lançar exceção: a jogada é recusada com o motivo, sem derrubar a página. */
function guard<T>(who: string, fn: () => T): T | Failure {
  try {
    return fn();
  } catch (e) {
    return new Failure(`${who} falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function sameJson(a: AttrValue, b: AttrValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
