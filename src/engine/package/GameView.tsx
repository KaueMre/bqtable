import { useSuspenseQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  childrenOf,
  contentsHidden,
  ownerOf,
  type AttrValue,
  type GameEnd,
  type GameState,
  type Piece,
  type LogEntry,
  type PieceId,
  type View,
} from '@/engine/core';
import { preloadImages } from '@/engine/data';
import {
  ManagerProvider,
  useCheck,
  useManager,
  useDispatch,
  useGame,
  useGameShallow,
  useUndo,
  useView,
  useViewer,
  useViewPiece,
  ViewerProvider,
} from '@/engine/react';
import type { GestureHandler, InfoState, MenuItem } from '@/engine/render';
import { Table, type TableApi } from '@/engine/render/konva';
import { EventLog } from '@/engine/ui/EventLog';
import { FullscreenBar, SettingsDialog } from './FullscreenHud';
import type { LoadedGame } from './game';
import { HUD_PANELS, useFullscreen, useHudModes, type HudPanel } from './hud';
import {
  builtinCommands,
  normalizeCombo,
  resolveBindings,
  useKeybindings,
  type Combo,
  type KeyCommand,
  type KeyPrefs,
} from './keys';
import { PieceInfo } from './PieceInfo';
import type { ActionContext, GameAction } from './rules';
import { interpolate } from './interpolate';
import type { HudItem, PlayerHudItem } from './manifest';
import './game-view.css';

interface GameViewProps {
  game: LoadedGame;
  players: number;
  /** Opções da partida (`manifest.options`); o que faltar usa o padrão. */
  options?: Record<string, string>;
  seed?: number;
  /** Atalhos que o jogador já tinha configurado (guardados pelo site). */
  keyPrefs?: KeyPrefs;
  /** O jogador mudou um atalho: guarde (o iframe não tem onde guardar). */
  onKeyPrefs?: (prefs: KeyPrefs) => void;
  /** Os atalhos em uso agora (o site os repassa ao jogo quando o foco está fora dele). */
  onKeymap?: (combos: Combo[]) => void;
}

/** 'turn' = a tela segue o jogador da vez (hot seat); ou o id de um jogador fixo. */
type ViewerMode = 'turn' | string;

/** Joga qualquer pacote: mesa + painel (jogadores, contadores, desfazer, peça selecionada, log). */
export function GameView({
  game,
  players,
  options,
  seed,
  keyPrefs,
  onKeyPrefs,
  onKeymap,
}: GameViewProps) {
  const [round, setRound] = useState(0);
  const optionsKey = JSON.stringify(options ?? {}); // nova partida só se os valores mudarem
  const { manager, gestures, actions } = useMemo(
    () =>
      game.createMatch({
        players,
        options: JSON.parse(optionsKey) as Record<string, string>,
        seed: seed === undefined ? undefined : seed + round,
      }),
    [game, players, optionsKey, seed, round],
  );
  // espera as imagens da mesa inicial, para não aparecerem uma a uma
  useSuspenseQuery({
    queryKey: ['bqgame', 'imagens', game.manifest.id, players, optionsKey, round, seed],
    queryFn: async () => {
      const faces = Object.values(manager.getState().pieces).flatMap((p) => Object.values(p.faces));
      await preloadImages(faces);
      return true;
    },
    staleTime: Infinity,
  });
  const [mode, setMode] = useState<ViewerMode>('turn');

  return (
    <ManagerProvider manager={manager}>
      <ViewerScope mode={mode}>
        <GameLayout
          game={game}
          players={players}
          options={options}
          gestures={gestures}
          actions={actions}
          mode={mode}
          onMode={setMode}
          onRestart={() => setRound((r) => r + 1)}
          keyPrefs={keyPrefs}
          onKeyPrefs={onKeyPrefs}
          onKeymap={onKeymap}
        />
      </ViewerScope>
    </ManagerProvider>
  );
}

/**
 * Quem olha a tela: o jogador da vez (padrão), ou quem precisa responder uma escolha pendente,
 * ou um jogador fixo escolhido em "Ver como".
 */
function ViewerScope({ mode, children }: { mode: ViewerMode; children: ReactNode }) {
  const active = useGame((s) => s.game.activePlayer);
  const chooser = useGame((s) => s.game.pending?.player);
  const viewer = mode === 'turn' ? (chooser ?? active) : mode;
  return <ViewerProvider viewer={viewer}>{children}</ViewerProvider>;
}

/** Valores escolhidos numa escolha de várias, presos à escolha a que pertencem. */
interface Picks {
  choiceId: string;
  values: AttrValue[];
}

const sameValue = (a: AttrValue, b: AttrValue) => JSON.stringify(a) === JSON.stringify(b);

/** Controles de zoom na tela cheia: embaixo, à esquerda (em cima à direita fica a barra; embaixo à direita, o log). */
const FULLSCREEN_CONTROLS: CSSProperties = { top: 'auto', right: 'auto', bottom: 8, left: 8 };

function GameLayout({
  game,
  players,
  options,
  gestures,
  actions,
  mode,
  onMode,
  onRestart,
  keyPrefs: initialKeys,
  onKeyPrefs,
  onKeymap,
}: {
  game: LoadedGame;
  players: number;
  options?: Record<string, string>;
  gestures: GestureHandler;
  actions: readonly GameAction[];
  mode: ViewerMode;
  onMode: (mode: ViewerMode) => void;
  onRestart: () => void;
  keyPrefs?: KeyPrefs;
  onKeyPrefs?: (prefs: KeyPrefs) => void;
  onKeymap?: (combos: Combo[]) => void;
}) {
  const [selection, setSelection] = useState<PieceId[]>([]);
  const selected = selection.at(-1) ?? null;
  const [picks, setPicks] = useState<Picks | null>(null);
  const pending = useGame((s) => s.game.pending);
  const viewer = useViewer();
  const dispatch = useDispatch();
  const background = game.manifest.table?.background ?? '#2d6a4f';
  const showPlayers = game.players.max > 1 || game.playerHud.length > 0;
  const passButton = game.manifest.players?.passButton ?? true;
  // tela cheia: a mesa ocupa tudo e os painéis flutuam por cima (cada um pode ser escondido)
  const root = useRef<HTMLDivElement>(null);
  const { full, enter, exit } = useFullscreen(root);
  const { modes, cycle } = useHudModes({
    guides: game.manifest.table?.guides === false ? 'hidden' : 'full',
  });
  // camadas da mesa valem sempre; painéis, só na tela cheia (fora dela, o painel lateral é fixo)
  const shown = (panel: HudPanel) =>
    modes[panel] !== 'hidden' ||
    (!full && HUD_PANELS.find((p) => p.id === panel)!.scope === 'fullscreen');
  const [settings, setSettings] = useState(false);
  // a mão (faixa embaixo): tamanho próprio, e na tela cheia, longe do zoom e do log
  const [handZoom, setHandZoom] = useState(1);
  const logShown = shown('log');
  const handInset = useMemo(
    () => (full ? { left: 120, right: logShown ? 376 : 0 } : undefined),
    [full, logShown],
  );

  // menu do botão direito: as ações do jogo marcadas com `menu`, com a peça como seleção
  const manager = useManager();
  const check = useCheck();
  const tableApi = useRef<TableApi>(null);
  const { undo } = useUndo();

  // Atalhos: os da mesa e um por ação do jogo, com os padrões trocados pelo jogador.
  const [keyPrefs, setKeyPrefs] = useState<KeyPrefs>(() => initialKeys ?? { global: {}, game: {} });
  const commands = useMemo(
    () => [
      ...builtinCommands(),
      ...actions.map((a): KeyCommand => ({
        id: `game:${a.id}`,
        label: a.label,
        group: 'Ações do jogo',
        defaultKey: a.key ? normalizeCombo(a.key) : null,
      })),
    ],
    [actions],
  );
  const bindings = useMemo(
    () => resolveBindings(commands, { ...keyPrefs.global, ...keyPrefs.game }),
    [commands, keyPrefs],
  );
  const saveKeys = (next: KeyPrefs) => {
    setKeyPrefs(next);
    onKeyPrefs?.(next);
  };
  const setBinding = (id: string, combo: Combo | null | undefined) => {
    const scope = id.startsWith('game:') ? 'game' : 'global';
    const changed = { ...keyPrefs[scope] };
    if (combo === undefined) delete changed[id];
    else changed[id] = combo;
    saveKeys({ ...keyPrefs, [scope]: changed });
  };
  useEffect(() => {
    onKeymap?.([...bindings.values()].filter((c): c is Combo => !!c));
  }, [bindings, onKeymap]);
  // aviso de um atalho que não rodou (ação desabilitada), por alguns segundos
  const [keyNote, setKeyNoteState] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const setKeyNote = (note: string | null) => {
    setKeyNoteState(note);
    clearTimeout(noteTimer.current);
    if (note) noteTimer.current = setTimeout(() => setKeyNoteState(null), 4000);
  };
  const keyOf = (command: string) => bindings.get(command) ?? null;

  /** Uma ação do jogo pelo atalho: o mesmo que clicar no botão (escondida, nada; desabilitada, o motivo). */
  const runAction = (actionId: string) => {
    const a = actions.find((x) => x.id === actionId);
    const state = manager.getState();
    if (!a || state.pending || state.ended) return;
    const ctx: ActionContext = { player: viewer, selection };
    if (!safely(`ação "${a.id}" (visible)`, () => a.visible?.(state, ctx) ?? true, false)) return;
    const cmd = safely(`ação "${a.id}" (command)`, () => a.command(state, ctx), null);
    const enabled = a.enabled
      ? safely(`ação "${a.id}" (enabled)`, () => a.enabled!(state, ctx), 'erro na ação')
      : true;
    if (enabled !== true || !cmd) {
      setKeyNote(`${a.label}: ${enabled === true ? 'indisponível' : enabled}`);
      return;
    }
    setKeyNote(null);
    dispatch(cmd);
  };

  const runCommand = (id: string) => {
    if (id.startsWith('hud:')) {
      const def = HUD_PANELS.find((p) => p.id === id.slice(4));
      if (def && (def.scope === 'table' || full)) cycle(def.id);
      return;
    }
    const camera = /^camera:(save|load):(\d)$/.exec(id);
    if (camera) {
      const n = Number(camera[2]);
      if (camera[1] === 'save') tableApi.current?.saveCamera(n);
      else tableApi.current?.loadCamera(n);
      return;
    }
    if (id.startsWith('game:')) {
      runAction(id.slice(5));
      return;
    }
    if (id === 'undo') undo();
    else if (id === 'pass' && passButton !== false) dispatch({ type: 'nextPlayer' });
    else if (id === 'fit') tableApi.current?.fit();
    else if (id === 'fullscreen') (full ? exit : enter)();
    else if (id === 'settings') setSettings((s) => !s);
  };
  // com as configurações abertas, o teclado é delas (inclusive o editor de atalhos)
  useKeybindings(bindings, runCommand, !settings);
  const pieceMenu = (_piece: Piece, ids: PieceId[]): MenuItem[] => {
    const state = manager.getState();
    if (state.pending || state.ended) return [];
    const ctx: ActionContext = { player: viewer, selection: ids };
    return actions
      .filter((a) => a.menu)
      .flatMap((a) => {
        if (!safely(`ação "${a.id}" (visible)`, () => a.visible?.(state, ctx) ?? true, false)) {
          return [];
        }
        const cmd = safely(`ação "${a.id}" (command)`, () => a.command(state, ctx), null);
        let enabled: true | string = a.enabled
          ? safely(`ação "${a.id}" (enabled)`, () => a.enabled!(state, ctx), 'erro na ação')
          : true;
        if (enabled === true) enabled = cmd ? check(cmd) : 'indisponível';
        return [
          {
            label: a.label,
            disabled: enabled === true ? undefined : enabled,
            onSelect: () => cmd && dispatch(cmd),
          },
        ];
      });
  };
  // nome de uma zona nos menus: o nome dos dados, o texto da face, ou o id
  const nameOf = (piece: Piece) => {
    const nome = game.dataOf(piece)?.nome;
    return typeof nome === 'string' ? nome : '';
  };

  /**
   * Descrição e palavras-chave da peça (no preview e na dica ao lado dela), conforme o modo:
   * completo, sempre; compacto, com Ctrl; oculto, só com o mouse sobre o preview fixo (e as
   * palavras-chave ao passar sobre cada uma).
   */
  const infoFor = (where: 'preview' | 'tip') => (piece: Piece, s: InfoState) => {
    if (s.turned) return null; // virada para quem olha: não revela o que ela é
    const html = game.describe(piece);
    if (!html) return null;
    const mode = modes.rules;
    const show: 'all' | 'hover' | null =
      mode === 'full'
        ? 'all'
        : mode === 'compact'
          ? s.ctrl
            ? 'all'
            : null
          : where === 'preview' && s.pinned && s.over
            ? 'hover'
            : null;
    if (!show) return null;
    return (
      <PieceInfo
        html={html}
        keywords={game.keywords}
        resolveAsset={game.resolveAsset}
        mode={show}
      />
    );
  };

  const canAnswer =
    !!pending && (pending.player === undefined || viewer === null || pending.player === viewer);
  const picked = useMemo(
    () => (picks && pending && picks.choiceId === pending.id ? picks.values : []),
    [picks, pending],
  );
  const toggle = (value: AttrValue) => {
    if (!pending) return;
    const has = picked.some((v) => sameValue(v, value));
    const values = has ? picked.filter((v) => !sameValue(v, value)) : [...picked, value];
    setPicks({ choiceId: pending.id, values });
  };
  const answer = (value: AttrValue) =>
    pending && dispatch({ type: 'choose', choiceId: pending.id, value });

  const pickable = useMemo(
    () => (pending?.pick && canAnswer ? new Set((pending.options ?? []).map(String)) : undefined),
    [pending, canAnswer],
  );
  const pickedSet = useMemo(() => new Set(picked.map(String)), [picked]);
  const onPick =
    pending?.pick === 'piece'
      ? (id: PieceId) => (pending.multiple ? toggle(id) : answer(id))
      : undefined;
  // com uma escolha pendente, a mesa só serve para responder: arrasta só as peças de um `pick: 'drop'`
  const dropChoice = pending?.pick === 'drop' && canAnswer ? pending.id : null;
  const canDrag = useCallback(
    (piece: Piece) =>
      pending ? dropChoice !== null && !!pickable?.has(piece.id) : game.canDrag(piece),
    [pending, dropChoice, pickable, game],
  );
  // e o arrasto vira a resposta, em vez de uma jogada nova
  const tableGestures = useMemo<GestureHandler>(() => {
    if (dropChoice === null) return gestures;
    return (g) => {
      if (g.type !== 'drag' || !pickable?.has(g.id)) return null;
      const value: Record<string, AttrValue> = { id: g.id, zone: g.target.zone };
      for (const key of ['slot', 'index', 'x', 'y'] as const) {
        const v = g.target[key];
        if (v !== undefined) value[key] = v;
      }
      return { type: 'choose', choiceId: dropChoice, value };
    };
  }, [dropChoice, pickable, gestures]);

  const choice = pending && (
    <ChoicePanel
      canAnswer={canAnswer}
      picked={picked}
      onToggle={toggle}
      onAnswer={(v) => void answer(v)}
    />
  );

  return (
    <div ref={root} className={full ? 'bq-game bq-game--full' : 'bq-game'}>
      <div className="bq-game-table" style={{ background }}>
        <Table
          onGesture={tableGestures}
          canDrag={canDrag}
          onSelectionChange={setSelection}
          pickable={pickable}
          picked={pickedSet}
          onPick={onPick}
          decorate={game.decorate}
          previewFace={game.previewFace}
          preview={shown('preview')}
          previewInfo={infoFor('preview')}
          hoverInfo={modes.tips === 'hidden' ? undefined : infoFor('tip')}
          contextMenu={pieceMenu}
          nameOf={nameOf}
          handZoom={handZoom}
          handInset={handInset}
          apiRef={tableApi}
          guides={shown('guides')}
          previewTop={full ? 56 : undefined}
          controlsStyle={full ? FULLSCREEN_CONTROLS : undefined}
        />
        {full && (
          <div className="bq-fs">
            <div className="bq-fs-left">
              {showPlayers && shown('players') && (
                <Players items={game.playerHud} mode={mode} onMode={onMode} passButton={false} />
              )}
              {shown('info') && <Hud items={game.hud} />}
              {shown('details') && selected && <Selected id={selected} game={game} />}
            </div>
            <div className="bq-fs-right">
              <FullscreenBar
                onRestart={onRestart}
                passButton={passButton}
                modes={modes}
                onCycle={cycle}
                onSettings={() => setSettings(true)}
                onExit={exit}
                keyOf={keyOf}
              />
              <Actions actions={actions} selection={selection} keyOf={keyOf} />
              <Status note={keyNote} />
            </div>
            {choice && <div className="bq-fs-choice">{choice}</div>}
            {shown('log') && (
              <div className="bq-fs-log">
                <Log />
              </div>
            )}
          </div>
        )}
        <EndOverlay onRestart={onRestart} />
      </div>
      {!full && (
        <aside className="bq-game-panel">
          <header>
            <strong>{game.manifest.name}</strong>
            {game.manifest.author && <span> · {game.manifest.author}</span>}
          </header>
          {showPlayers && (
            <Players items={game.playerHud} mode={mode} onMode={onMode} passButton={passButton} />
          )}
          {choice}
          <Actions actions={actions} selection={selection} keyOf={keyOf} />
          <Toolbar
            onRestart={onRestart}
            onFullscreen={enter}
            onSettings={() => setSettings(true)}
            note={keyNote}
          />
          <Hud items={game.hud} />
          <Selected id={selected} game={game} />
          <Log />
        </aside>
      )}
      {settings && (
        <SettingsDialog
          game={game}
          players={players}
          options={options}
          modes={modes}
          onCycle={cycle}
          fullscreen={full}
          handZoom={handZoom}
          onHandZoom={setHandZoom}
          commands={commands}
          bindings={bindings}
          onBinding={setBinding}
          onResetKeys={() => saveKeys({ global: {}, game: {} })}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

/** Escolha pendente: o pedido, e botões (ou caixas, se forem várias) — ou clique na mesa. */
function ChoicePanel({
  canAnswer,
  picked,
  onToggle,
  onAnswer,
}: {
  canAnswer: boolean;
  picked: AttrValue[];
  onToggle: (value: AttrValue) => void;
  onAnswer: (value: AttrValue) => void;
}) {
  const pending = useGame((s) => s.game.pending)!;
  const players = useGame((s) => s.game.players);
  const [text, setText] = useState('');
  const who =
    pending.player === undefined ? undefined : (players[pending.player]?.name ?? pending.player);
  const options = pending.options ?? [];
  const label = (o: AttrValue, i: number) =>
    pending.labels?.[i] ?? (typeof o === 'object' && o !== null ? JSON.stringify(o) : String(o));
  const multiple = pending.multiple;
  const inRange = !!multiple && picked.length >= multiple.min && picked.length <= multiple.max;

  return (
    <section className="bq-choice" aria-label="Escolha pendente">
      <strong>{pending.prompt}</strong>
      {who && (
        <span className="bq-game-hint">{canAnswer ? `${who} escolhe` : `Aguardando ${who}…`}</span>
      )}
      {canAnswer && pending.pick === 'drop' && (
        <span className="bq-game-hint">Arraste uma das peças destacadas.</span>
      )}
      {canAnswer && pending.pick === 'piece' && (
        <span className="bq-game-hint">
          {multiple
            ? `Clique nas peças destacadas na mesa (${multiple.min} a ${multiple.max}) e confirme.`
            : 'Clique numa das peças destacadas na mesa.'}
        </span>
      )}
      {canAnswer && !pending.pick && !multiple && options.length > 0 && (
        <div className="bq-game-buttons">
          {options.map((o, i) => (
            <button key={JSON.stringify(o)} onClick={() => onAnswer(o)}>
              {label(o, i)}
            </button>
          ))}
        </div>
      )}
      {canAnswer && !pending.pick && multiple && (
        <div className="bq-choice-list">
          {options.map((o, i) => (
            <label key={JSON.stringify(o)}>
              <input
                type="checkbox"
                checked={picked.some((v) => sameValue(v, o))}
                onChange={() => onToggle(o)}
              />{' '}
              {label(o, i)}
            </label>
          ))}
        </div>
      )}
      {canAnswer && multiple && (
        <button onClick={() => onAnswer(picked)} disabled={!inRange}>
          Confirmar ({picked.length})
        </button>
      )}
      {canAnswer && !pending.pick && !multiple && options.length === 0 && (
        <form
          className="bq-game-buttons"
          onSubmit={(e) => {
            e.preventDefault();
            onAnswer(text);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Resposta" />
          <button>Responder</button>
        </form>
      )}
      {canAnswer && !!pending.buttons?.length && (
        <div className="bq-game-buttons">
          {pending.buttons.map((b) => (
            <button key={JSON.stringify(b.value)} onClick={() => onAnswer(b.value)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      <span className="bq-game-hint">Desfazer cancela a jogada que pediu a escolha.</span>
    </section>
  );
}

/** Roda uma função do regras.js sem deixar um erro dela derrubar a tela. */
function safely<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    console.error(`${what} falhou:`, e);
    return fallback;
  }
}

/**
 * Ações do jogo (`game.action`): só as visíveis agora; desabilitadas com o motivo como dica.
 * Somem enquanto há uma escolha pendente (quem responde é o painel da escolha).
 */
function Actions({
  actions,
  selection,
  keyOf,
}: {
  actions: readonly GameAction[];
  selection: PieceId[];
  /** Atalho de um comando (a ação do jogo é `game:<id>`), para a dica do botão. */
  keyOf: (command: string) => Combo | null;
}) {
  const state = useGame((s) => s.game);
  const { pieces } = useView();
  const player = useViewer();
  const check = useCheck();
  const dispatch = useDispatch();
  if (actions.length === 0 || state.pending || state.ended) return null;
  const ctx: ActionContext = { player, selection: selection.filter((id) => pieces[id]) };
  const shown = actions.flatMap((a) => {
    if (!safely(`ação "${a.id}" (visible)`, () => a.visible?.(state, ctx) ?? true, false)) {
      return [];
    }
    const cmd = safely(`ação "${a.id}" (command)`, () => a.command(state, ctx), null);
    let enabled: true | string = a.enabled
      ? safely(`ação "${a.id}" (enabled)`, () => a.enabled!(state, ctx), 'erro na ação')
      : true;
    if (enabled === true) enabled = cmd ? check(cmd) : 'indisponível';
    return [{ a, cmd, enabled }];
  });
  if (shown.length === 0) return null;
  return (
    <section className="bq-actions" aria-label="Ações">
      {shown.map(({ a, cmd, enabled }) => (
        <button
          key={a.id}
          disabled={enabled !== true}
          title={
            enabled === true
              ? keyOf(`game:${a.id}`)
                ? `Atalho: ${keyOf(`game:${a.id}`)}`
                : ''
              : enabled
          }
          onClick={() => cmd && dispatch(cmd)}
        >
          {a.label}
        </button>
      ))}
    </section>
  );
}

const RESULT = { win: 'Vitória!', lose: 'Derrota', draw: 'Empate' } as const;

/** Fim de partida por cima da mesa: resultado, mensagem, pontos, jogar de novo. */
function EndOverlay({ onRestart }: { onRestart: () => void }) {
  const ended = useGame((s) => s.game.ended);
  const [dismissed, setDismissed] = useState<GameEnd | null>(null);
  if (!ended || dismissed === ended) return null;
  return (
    <div className={`bq-end bq-end--${ended.result}`} role="dialog" aria-label="Fim de partida">
      <h2>{RESULT[ended.result]}</h2>
      {ended.message && <p>{ended.message}</p>}
      {ended.score !== undefined && <p className="bq-end-score">{ended.score} pontos</p>}
      <div className="bq-game-buttons">
        <button onClick={onRestart}>Jogar de novo</button>
        <button onClick={() => setDismissed(ended)}>Ver a mesa</button>
      </div>
    </div>
  );
}

/** Valor de um recurso do jogador (`{player}` vira o id dele). */
/**
 * Quantas peças há na zona, para quem olha: "?" se o conteúdo está escondido dele (atrás de um
 * escudo de outro jogador), a menos que o item seja `public`.
 */
function countFor(
  item: { count: string; public?: boolean },
  zone: string,
  game: GameState,
  viewer: string | null,
) {
  if (!item.public && contentsHidden(game.pieces, zone, viewer)) return '?';
  return String(childrenOf(game.pieces, zone).length);
}

/** Texto com `{campos}`: campo que falta fica vazio. */
const filled = (text: string, scope: Record<string, unknown>) => {
  const v = interpolate(text, scope);
  return v === undefined || v === null ? '' : String(v);
};

/** Um item de lista no painel: texto, ou o `label`/`name`/`id` do objeto. */
const listLabel = (v: AttrValue): string =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? String(v.label ?? v.name ?? v.id ?? JSON.stringify(v))
    : String(v);

function hudValue(item: HudItem, game: GameState, viewer: string | null) {
  if ('count' in item) return countFor(item, item.count, game, viewer);
  if ('global' in item) return String(game.globals[item.global] ?? '—');
  if ('text' in item) return filled(item.text, game.globals);
  const list = game.globals[item.list];
  return Array.isArray(list) && list.length > 0 ? list.map(listLabel).join('\n') : '—';
}

function playerValue(item: PlayerHudItem, player: string, game: GameState, viewer: string | null) {
  const key = (s: string) => String(interpolate(s, { player }));
  if ('count' in item) return countFor(item, key(item.count), game, viewer);
  if ('global' in item) return String(game.globals[key(item.global)] ?? '—');
  const p = game.players[player];
  if ('attr' in item) return String(p?.attributes[item.attr] ?? '—');
  return filled(item.text, { ...game.globals, ...p?.attributes, player, playerName: p?.name });
}

/** Jogadores: o da vez em destaque, os recursos de cada um, passar a vez e "ver como". */
function Players({
  items,
  mode,
  onMode,
  passButton,
}: {
  items: PlayerHudItem[];
  mode: ViewerMode;
  onMode: (mode: ViewerMode) => void;
  /** `false`: o jogo passa a vez pelas regras; texto: rótulo do botão. */
  passButton: boolean | string;
}) {
  const dispatch = useDispatch();
  const viewer = useViewer();
  const rows = useGameShallow((s) =>
    s.game.playerOrder.map((id) => {
      const p = s.game.players[id]!;
      const values = items.map((item) => playerValue(item, id, s.game, viewer)).join('\u0000');
      return `${id}\u0001${p.name}\u0001${p.color}\u0001${values}`;
    }),
  ).map((row) => {
    const [id, name, color, values] = row.split('\u0001') as [string, string, string, string];
    return { id, name, color, values: items.length ? values.split('\u0000') : [] };
  });
  const active = useGame((s) => s.game.activePlayer);
  const canPass = viewer !== null && viewer === active;

  return (
    <section className="bq-players" aria-label="Jogadores">
      <ul>
        {rows.map((p) => (
          <li key={p.id} className={p.id === active ? 'bq-player bq-player--active' : 'bq-player'}>
            <span className="bq-player-color" style={{ background: p.color }} />
            <strong>{p.name}</strong>
            {p.id === active && <span className="bq-player-turn">da vez</span>}
            {p.id === viewer && <span className="bq-player-you">na tela</span>}
            {items.length > 0 && (
              <dl className="bq-player-resources" aria-label={`Recursos de ${p.name}`}>
                {items.map((item, i) => (
                  <div key={i}>
                    <dt>{item.label ?? ''}</dt>
                    <dd>{p.values[i]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
      <div className="bq-game-buttons">
        {passButton !== false && (
          <button onClick={() => dispatch({ type: 'nextPlayer' })} disabled={!canPass}>
            {passButton === true ? 'Passar a vez' : passButton}
          </button>
        )}
        <label>
          Ver como{' '}
          <select value={mode} onChange={(e) => onMode(e.target.value)}>
            <option value="turn">o jogador da vez</option>
            {rows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function Toolbar({
  onRestart,
  onFullscreen,
  onSettings,
  note,
}: {
  onRestart: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
  note: string | null;
}) {
  const { undo, canUndo } = useUndo();
  return (
    <>
      <div className="bq-game-buttons">
        <button
          onClick={() => undo()}
          disabled={canUndo !== true}
          title={canUndo === true ? '' : canUndo}
        >
          Desfazer
        </button>
        <button onClick={onRestart}>Reiniciar</button>
        <button onClick={onFullscreen}>Tela cheia</button>
        <button onClick={onSettings} aria-label="Configurações" title="Configurações">
          ⚙
        </button>
      </div>
      <Status note={note} />
    </>
  );
}

/** Motivo da última jogada recusada (ou de um atalho que não rodou). */
function Status({ note }: { note: string | null }) {
  const lastError = useGame((s) => s.lastError);
  return (
    <p className="bq-game-message" role="status">
      {note ?? (lastError && `Recusado: ${lastError}`)}
    </p>
  );
}

function Hud({ items }: { items: HudItem[] }) {
  const viewer = useViewer();
  const values = useGame((s) =>
    items.map((item) => hudValue(item, s.game, viewer)).join('\u0000'),
  ).split('\u0000');
  if (items.length === 0) return null;
  return (
    <dl className="bq-game-hud" aria-label="Placar">
      {items.map((item, i) => (
        <div key={i}>
          <dt>{item.label ?? ''}</dt>
          <dd>{values[i]}</dd>
        </div>
      ))}
    </dl>
  );
}

const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

/** Detalhes da peça como o jogador da tela a vê: peça virada de outro não mostra os dados. */
function Selected({ id, game }: { id: PieceId | null; game: LoadedGame }) {
  const piece = useViewPiece(id ?? '');
  const view = useView();
  const ownerName = useGame((s) => {
    const owner = piece ? ownerOf(s.game.pieces, piece.id) : undefined;
    return owner === undefined ? undefined : (s.game.players[owner]?.name ?? owner);
  });
  if (!piece) return <p className="bq-game-hint">Clique numa peça para ver os detalhes.</p>;
  const turned = view.faceDown.has(piece.id);
  const item = turned ? undefined : game.dataOf(piece);
  const rows: [string, unknown][] = turned
    ? [
        ['peça', 'virada'],
        ['tipo', piece.kind],
      ]
    : [
        ['peça', piece.id],
        ['tipo', piece.kind],
        ['status', piece.status],
        ...Object.entries(piece.attributes),
        ...(item ? Object.entries(item).filter(([k]) => k !== 'id') : []),
      ];
  if (ownerName) rows.push(['dono', ownerName]);
  return (
    <dl className="bq-game-details" aria-label="Peça selecionada">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Ids de peça citados num evento (para esconder o que o jogador da tela não pode ver). */
/** Peças citadas no evento (inclusive a ordem de um embaralhar e o grupo de um dropMany). */
function pieceIdsOf(entry: LogEntry): string[] {
  const e = entry.event as {
    id?: unknown;
    piece?: { id?: unknown };
    order?: unknown;
    ids?: unknown;
  };
  const lists = [e.order, e.ids].flatMap((l) => (Array.isArray(l) ? (l as unknown[]) : []));
  return [e.id, e.piece?.id, ...lists].filter((x): x is string => typeof x === 'string');
}

/** Log: as mensagens do jogo de cada jogada (ou os eventos do motor); "Log completo" mostra tudo. */
function Log() {
  const log = useGame((s) => s.game.log);
  const view: View = useView();
  const viewer = useViewer();
  const players = useGame((s) => s.game.players);
  const [full, setFull] = useState(false);
  const isHidden = useCallback(
    (entry: LogEntry) =>
      (entry.event.type === 'message' &&
        entry.event.to !== undefined &&
        entry.event.to !== viewer) ||
      pieceIdsOf(entry).some((id) => view.faceDown.has(id) || view.hidden.has(id)),
    [view, viewer],
  );
  const actorName = useCallback((id: string) => players[id]?.name ?? id, [players]);
  return (
    <section className="bq-log">
      <label className="bq-game-hint">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Log
        completo
      </label>
      <EventLog
        log={log}
        limit={full ? 40 : 60}
        isHidden={isHidden}
        actorName={actorName}
        messages={!full}
      />
    </section>
  );
}
