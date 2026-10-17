import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DataBoundary, retryNetworkOnly } from '@/engine/data';
import {
  choiceLabel,
  choiceValue,
  comboOf,
  GameView,
  loadGame,
  type Combo,
  type KeyPrefs,
  type LoadedGame,
} from '@/engine/package';
import {
  isFrameMessage,
  isTableShortcut,
  type FrameKeymap,
  type FrameLoad,
  type FramePrefs,
  type FrameResult,
} from './protocol';

/**
 * Roda dentro do iframe isolado: espera o pacote do site, carrega e mostra o jogo.
 * `parent` é a janela do site (injetável nos testes).
 */
export function FrameApp({ parent = window.parent }: { parent?: Window }) {
  const [load, setLoad] = useState<FrameLoad | null>(null);
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
      if (e.data.type !== 'bq:load') return;
      const msg = e.data;
      // ArrayBuffer de outra janela não passa em instanceof: confere pela marca do objeto
      if (Object.prototype.toString.call(msg.bytes) !== '[object ArrayBuffer]') return;
      setLoad((current) => (current?.nonce === msg.nonce ? current : msg));
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
      <FrameGame load={load} onLoaded={onLoaded} onKeymap={onKeymap} parent={parent} />
    </DataBoundary>
  );
}

function FrameGame({
  load,
  onLoaded,
  onKeymap,
  parent,
}: {
  load: FrameLoad;
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
  const [jogadores, setJogadores] = useState(game.players.min);
  const contagens = Array.from(
    { length: game.players.max - game.players.min + 1 },
    (_, i) => game.players.min + i,
  );
  const [opcoes, setOpcoes] = useState<Record<string, string>>(() =>
    Object.fromEntries(game.options.map((o) => [o.id, o.default ?? choiceValue(o.choices[0]!)])),
  );
  return (
    <div className="frame">
      <div className="frame-header">
        <h1>{name}</h1>
        {game.manifest.description && <p>{game.manifest.description}</p>}
        {contagens.length > 1 && (
          <label>
            Jogadores{' '}
            <select value={jogadores} onChange={(e) => setJogadores(Number(e.target.value))}>
              {contagens.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
        {game.options.map((o) => (
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
          <GameView
            game={game}
            players={jogadores}
            options={opcoes}
            keyPrefs={keyPrefs}
            onKeyPrefs={onKeyPrefs}
            onKeymap={onKeymap}
          />
        </DataBoundary>
      </div>
    </div>
  );
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
