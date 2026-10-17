import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataBoundary, retryNetworkOnly } from '@/engine/data';
import { createRemoteManager, type RemoteManager } from '@/engine/net';
import {
  choiceLabel,
  choiceValue,
  comboOf,
  GameView,
  loadGame,
  type Combo,
  type GuestNet,
  type HostNet,
  type KeyPrefs,
  type LoadedGame,
  type Match,
} from '@/engine/package';
import {
  isFrameMessage,
  isTableShortcut,
  type FrameKeymap,
  type FrameLoad,
  type FrameNet,
  type FrameNetOut,
  type FramePrefs,
  type FrameResult,
  type NetIn,
  type NetOut,
} from './protocol';

/**
 * A rede vista de dentro do iframe (uma por pacote carregado). O que chega antes de alguém ouvir
 * espera; o último estado é repetido para quem começa a ouvir depois.
 */
export interface NetPort {
  listen(fn: (msg: NetIn) => void): () => void;
  post(msg: NetOut): void;
}

function createNetPort(post: (msg: NetOut) => void): NetPort & { deliver(msg: NetIn): void } {
  const listeners = new Set<(msg: NetIn) => void>();
  const waiting: NetIn[] = [];
  let lastState: NetIn | null = null;
  return {
    post,
    listen(fn) {
      listeners.add(fn);
      if (lastState) fn(lastState);
      for (const msg of waiting.splice(0)) fn(msg);
      return () => void listeners.delete(fn);
    },
    deliver(msg) {
      if (msg.kind === 'state') lastState = msg;
      if (listeners.size === 0) {
        if (msg.kind !== 'state') waiting.push(msg);
        return;
      }
      for (const fn of [...listeners]) fn(msg);
    },
  };
}

/**
 * Roda dentro do iframe isolado: espera o pacote do site, carrega e mostra o jogo.
 * `parent` é a janela do site (injetável nos testes).
 */
export function FrameApp({ parent = window.parent }: { parent?: Window }) {
  // o pacote atual e, numa partida em rede, a rede dele (criada junto com o bq:load, para não
  // perder o que chegar logo depois)
  const [load, setLoad] = useState<(FrameLoad & { port: NetPort | null }) | null>(null);
  const port = useRef<{ nonce: string; port: ReturnType<typeof createNetPort> } | null>(null);
  const reply = useCallback((msg: FrameResult) => parent.postMessage(msg, '*'), [parent]);
  const nonce = load?.nonce ?? '';
  const onLoaded = useCallback(
    (name: string) => reply({ type: 'bq:loaded', nonce, name }),
    [reply, nonce],
  );
  const onError = useCallback(
    (message: string) => reply({ type: 'bq:error', nonce, message }),
    [reply, nonce],
  );
  // combinações com atalho no jogo aberto: o site repassa estas teclas quando o foco está nele
  const keymap = useRef(new Set<Combo>());
  const onKeymap = useCallback(
    (combos: Combo[]) => {
      keymap.current = new Set(combos);
      parent.postMessage({ type: 'bq:keymap', combos } satisfies FrameKeymap, '*');
    },
    [parent],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== parent || !isFrameMessage(e.data)) return;
      if (e.data.type === 'bq:key') {
        // atalho apertado no site: repete aqui dentro, para a mesa (preview, câmeras, atalhos)
        const { down, repeat, ...k } = e.data;
        const pressed = { ...k, ctrlKey: !!k.ctrlKey, metaKey: !!k.metaKey };
        const combo = comboOf(pressed);
        if (!isTableShortcut(pressed) && !(combo && keymap.current.has(combo))) return;
        window.dispatchEvent(
          new KeyboardEvent(down ? 'keydown' : 'keyup', {
            key: pressed.key,
            code: pressed.code,
            altKey: pressed.altKey,
            shiftKey: pressed.shiftKey,
            ctrlKey: pressed.ctrlKey,
            metaKey: pressed.metaKey,
            repeat: !!repeat,
          }),
        );
        return;
      }
      if (e.data.type === 'bq:net-in') {
        if (port.current?.nonce === e.data.nonce) port.current.port.deliver(e.data.msg);
        return;
      }
      if (e.data.type !== 'bq:load') return;
      const msg = e.data;
      // ArrayBuffer de outra janela não passa em instanceof: confere pela marca do objeto
      if (Object.prototype.toString.call(msg.bytes) !== '[object ArrayBuffer]') return;
      if (msg.net && port.current?.nonce !== msg.nonce) {
        const { nonce } = msg;
        port.current = {
          nonce,
          port: createNetPort((out) =>
            parent.postMessage({ type: 'bq:net-out', nonce, msg: out } satisfies FrameNetOut, '*'),
          ),
        };
      }
      const net = msg.net ? port.current!.port : null;
      setLoad((current) => (current?.nonce === msg.nonce ? current : { ...msg, port: net }));
    };
    window.addEventListener('message', onMessage);
    parent.postMessage({ type: 'bq:ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [parent]);

  if (!load) return <p className="frame-wait">Aguardando o jogo…</p>;
  return (
    <DataBoundary
      key={load.nonce}
      loading={<p className="frame-wait">Carregando {load.name}…</p>}
      error={(error, retry) => <FrameError error={error} retry={retry} report={onError} />}
    >
      <FrameGame
        load={load}
        net={load.port}
        onLoaded={onLoaded}
        onKeymap={onKeymap}
        parent={parent}
      />
    </DataBoundary>
  );
}

function FrameGame({
  load,
  net,
  onLoaded,
  onKeymap,
  parent,
}: {
  load: FrameLoad;
  net: NetPort | null;
  onLoaded: (name: string) => void;
  onKeymap: (combos: Combo[]) => void;
  parent: Window;
}) {
  const { data: game } = useSuspenseQuery({
    queryKey: ['bqgame', 'pacote', load.nonce],
    queryFn: () => loadGame({ bytes: load.bytes, url: load.url }),
    staleTime: Infinity,
    gcTime: 0,
    retry: retryNetworkOnly,
  });
  useDisposePrevious(game);
  const name = game.manifest.name;
  useEffect(() => onLoaded(name), [name, onLoaded]);
  // atalhos do jogador: vêm do site no bq:load; mudou, o site guarda (aqui não há armazenamento)
  const gameId = game.manifest.id;
  const [keyPrefs, setKeyPrefs] = useState<KeyPrefs>(() => ({
    global: load.prefs?.keys ?? {},
    game: load.prefs?.games?.[gameId]?.keys ?? {},
  }));
  const onKeyPrefs = useCallback(
    (prefs: KeyPrefs) => {
      setKeyPrefs(prefs);
      const msg: FramePrefs = {
        type: 'bq:prefs',
        gameId,
        keys: prefs.global,
        gameKeys: prefs.game,
      };
      parent.postMessage(msg, '*');
    },
    [parent, gameId],
  );
  const role = load.net?.role;
  // hospedando: começa com dois jogadores, se o jogo deixar
  const [jogadores, setJogadores] = useState(() =>
    role === 'host' ? Math.min(game.players.max, Math.max(2, game.players.min)) : game.players.min,
  );
  const contagens = Array.from(
    { length: game.players.max - game.players.min + 1 },
    (_, i) => game.players.min + i,
  );
  const [opcoes, setOpcoes] = useState<Record<string, string>>(() =>
    Object.fromEntries(game.options.map((o) => [o.id, o.default ?? choiceValue(o.choices[0]!)])),
  );
  const view = { game, keyPrefs, onKeyPrefs, onKeymap };
  return (
    <div className="frame">
      <div className="frame-header">
        <h1>{name}</h1>
        {game.manifest.description && <p>{game.manifest.description}</p>}
        {role === 'guest' && load.net && (
          <p className="frame-seat">Você joga como {load.net.seat}. O host escolhe a partida.</p>
        )}
        {role !== 'guest' && contagens.length > 1 && (
          <label>
            Jogadores{' '}
            <select value={jogadores} onChange={(e) => setJogadores(Number(e.target.value))}>
              {contagens.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        {role !== 'guest' &&
          game.options.map((o) => (
            <label key={o.id}>
              {o.label}{' '}
              <select
                value={opcoes[o.id]}
                onChange={(e) => setOpcoes((atual) => ({ ...atual, [o.id]: e.target.value }))}
              >
                {o.choices.map((c) => (
                  <option key={choiceValue(c)} value={choiceValue(c)}>
                    {choiceLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>
      <div className="frame-game">
        <DataBoundary loading={<p className="frame-wait">Preparando a mesa…</p>}>
          {load.net && net && role === 'guest' ? (
            <GuestGame {...view} net={load.net} port={net} />
          ) : (
            <HostOrLocalGame
              {...view}
              players={jogadores}
              options={opcoes}
              seat={role === 'host' ? load.net?.seat : undefined}
              port={role === 'host' ? net : null}
            />
          )}
        </DataBoundary>
      </div>
    </div>
  );
}

interface ViewProps {
  game: LoadedGame;
  keyPrefs: KeyPrefs;
  onKeyPrefs: (prefs: KeyPrefs) => void;
  onKeymap: (combos: Combo[]) => void;
}

/** A partida aqui mesmo: sozinho (hot seat) ou hospedando (a rede recebe o estado de cada assento). */
function HostOrLocalGame({
  players,
  options,
  seat,
  port,
  ...view
}: ViewProps & {
  players: number;
  options: Record<string, string>;
  /** Hospedando: o assento do host e a rede. */
  seat?: string;
  port: NetPort | null;
}) {
  const host = useMemo<HostNet | undefined>(
    () =>
      seat !== undefined && port
        ? {
            role: 'host',
            seat,
            publish: (states) => port.post({ kind: 'states', states, options }),
            listen: (fn) =>
              port.listen((msg) => {
                if (msg.kind === 'cmd') fn(msg.seat, msg.cmd);
              }),
            reject: (s, reason) => port.post({ kind: 'rejected', seat: s, reason }),
          }
        : undefined,
    [seat, port, options],
  );
  return <GameView {...view} players={players} options={options} net={host} />;
}

/**
 * Convidado: espera o primeiro estado do host e joga com um Gestor remoto. As regras rodam aqui
 * também, numa partida local que só serve para os gestos e as ações do jogo.
 */
function GuestGame({ net, port, ...view }: ViewProps & { net: FrameNet; port: NetPort }) {
  const [guest, setGuest] = useState<{ net: GuestNet; players: number } | null>(null);
  const { game } = view;
  useEffect(() => {
    let remote: RemoteManager | null = null;
    return port.listen((msg) => {
      if (msg.kind === 'rejected') return remote?.reject(msg.reason);
      if (msg.kind !== 'state') return;
      if (remote) return remote.setState(msg.state);
      const players = net.players ?? msg.state.playerOrder.length;
      const local = game.createMatch({ players, options: net.options, seed: 0 });
      remote = createRemoteManager((cmd) => port.post({ kind: 'cmd', cmd }), {
        kinds: local.manager.kinds,
        state: msg.state,
      });
      const match: Match = { ...local, manager: remote };
      setGuest({ net: { role: 'guest', seat: net.seat, match }, players });
    });
  }, [game, net, port]);
  if (!guest) return <p className="frame-wait">Esperando a mesa do host…</p>;
  return <GameView {...view} players={guest.players} net={guest.net} />;
}

function FrameError({
  error,
  retry,
  report,
}: {
  error: Error;
  retry: () => void;
  report: (message: string) => void;
}) {
  useEffect(() => report(error.message), [error, report]);
  return (
    <div role="alert" className="frame-error">
      <strong>Não foi possível abrir o jogo.</strong>
      <pre>{error.message}</pre>
      <button onClick={retry}>Tentar de novo</button>
    </div>
  );
}

/** Libera os arquivos do jogo anterior quando outro é carregado. */
function useDisposePrevious(game: LoadedGame) {
  const previous = useRef<LoadedGame | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== game) previous.current.dispose();
    previous.current = game;
  }, [game]);
}
