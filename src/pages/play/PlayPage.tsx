import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { DataBoundary, fetchOk, retryNetworkOnly } from '@/engine/data';
import { comboOf } from '@/engine/package/keys';
import {
  cleanPrefs,
  FRAME_SANDBOX,
  FRAME_URL,
  isFrameKeymap,
  isFrameMessage,
  isFramePrefs,
  isTableShortcut,
  mergePrefs,
  type FrameKey,
  type FrameLoad,
  type SitePrefs,
} from '@/frame/protocol';
import { EXEMPLOS } from './exemplos';
import './play.css';

interface Fonte {
  chave: string;
  nome: string;
  ler(): Promise<{ bytes: ArrayBuffer; url?: string }>;
}

const porUrl = (url: string): Fonte => ({
  chave: `url:${url}`,
  nome: url,
  async ler() {
    const absoluta = new URL(url, window.location.href).href;
    const res = await fetchOk(absoluta, url);
    return { bytes: await res.arrayBuffer(), url: absoluta };
  },
});

const porArquivo = (file: File): Fonte => ({
  chave: `arquivo:${file.name}:${file.size}:${file.lastModified}`,
  nome: file.name,
  ler: async () => ({ bytes: await file.arrayBuffer() }),
});

/**
 * Escolher um jogo (arquivo, URL ou exemplo) e jogá-lo num iframe isolado. `?url=` abre direto
 * (link compartilhável). A página só busca os bytes; o jogo e o regras.js rodam no iframe.
 */
export function PlayPage() {
  const [params, setParams] = useSearchParams();
  const urlParam = params.get('url');
  const [arquivo, setArquivo] = useState<Fonte | null>(null);
  const fonte = arquivo ?? (urlParam ? porUrl(urlParam) : null);

  const abrirUrl = (url: string) => {
    setArquivo(null);
    setParams({ url });
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = new FormData(e.currentTarget).get('url');
    if (typeof url === 'string' && url.trim()) abrirUrl(url.trim());
  };

  return (
    <div className="play">
      <section className="play-source" aria-label="Escolher jogo">
        <label className="play-file">
          Arquivo (.bqgame ou .json){' '}
          <input
            type="file"
            accept=".bqgame,.zip,.json,application/zip,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setParams({});
              setArquivo(porArquivo(file));
            }}
          />
        </label>
        <form onSubmit={onSubmit} className="play-url">
          <input
            name="url"
            placeholder="https://…/meu-jogo.bqgame"
            defaultValue={urlParam ?? ''}
            aria-label="URL do jogo"
          />
          <button>Abrir</button>
        </form>
        <div className="play-examples">
          Exemplos:{' '}
          {EXEMPLOS.map((ex) => (
            <button key={ex.url} onClick={() => abrirUrl(ex.url)}>
              {ex.nome}
            </button>
          ))}
        </div>
      </section>
      {fonte ? (
        <DataBoundary
          key={fonte.chave}
          loading={<p className="play-loading">Baixando {fonte.nome}…</p>}
        >
          <Pacote fonte={fonte} />
        </DataBoundary>
      ) : (
        <p className="play-empty">Escolha um arquivo, cole uma URL ou abra um exemplo.</p>
      )}
    </div>
  );
}

function Pacote({ fonte }: { fonte: Fonte }) {
  const { data } = useSuspenseQuery({
    queryKey: ['bqgame', 'bytes', fonte.chave],
    queryFn: fonte.ler,
    staleTime: Infinity,
    gcTime: 0,
    retry: retryNetworkOnly,
  });
  return <GameFrame name={fonte.nome} bytes={data.bytes} url={data.url} />;
}

/** Onde o site guarda as preferências do jogador (o iframe isolado não tem armazenamento). */
const PREFS_KEY = 'bqtable:prefs';

function readPrefs(): SitePrefs {
  try {
    return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

function writePrefs(prefs: SitePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // sem armazenamento (janela anônima, bloqueado): os atalhos valem só nesta visita
  }
}

/** Tecla digitada num campo do site (a URL do jogo) não vai para o jogo. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * O iframe isolado: entrega o pacote (e os atalhos guardados) quando ele avisa que está pronto,
 * e de novo se recarregar. Guarda os atalhos que o jogador troca lá dentro.
 */
function GameFrame({ name, bytes, url }: { name: string; bytes: ArrayBuffer; url?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // combinações com atalho no jogo (o iframe avisa): repassadas com o foco aqui fora
  const keymap = useRef(new Set<string>());
  useEffect(() => {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onMessage = (e: MessageEvent) => {
      const frame = ref.current?.contentWindow;
      if (!frame || e.source !== frame || !isFrameMessage(e.data)) return;
      const msg = e.data;
      if (msg.type === 'bq:ready') {
        const load: FrameLoad = {
          type: 'bq:load',
          nonce,
          name,
          bytes: bytes.slice(0),
          url,
          prefs: readPrefs(),
        };
        frame.postMessage(load, '*'); // origem opaca: só dá para endereçar com '*'
      } else if (isFramePrefs(msg)) {
        const next = mergePrefs(readPrefs(), msg);
        if (next) writePrefs(next);
      } else if (isFrameKeymap(msg)) {
        keymap.current = new Set(msg.combos);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [name, bytes, url]);

  // atalhos da mesa (Alt: preview; Alt+número: câmeras; os configurados no jogo) também valem
  // com o foco aqui fora
  useEffect(() => {
    const send = (msg: Omit<FrameKey, 'type'>) =>
      ref.current?.contentWindow?.postMessage({ type: 'bq:key', ...msg } satisfies FrameKey, '*');
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const mapped = !!combo && keymap.current.has(combo) && !typing(e.target);
      if (!isTableShortcut(e) && !mapped) return;
      if (e.key !== 'Control') e.preventDefault(); // o Ctrl continua valendo nos atalhos do site
      const { key, code, altKey, shiftKey, ctrlKey, metaKey, repeat } = e;
      send({ down: e.type === 'keydown', key, code, altKey, shiftKey, ctrlKey, metaKey, repeat });
    };
    const onBlur = () =>
      send({ down: false, key: 'Alt', code: 'AltLeft', altKey: false, shiftKey: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return (
    <iframe
      ref={ref}
      className="play-frame"
      src={FRAME_URL}
      sandbox={FRAME_SANDBOX}
      // o jogo pode pedir tela cheia (botão "Tela cheia"); o resto continua isolado pelo sandbox
      allow="fullscreen"
      allowFullScreen
      title={`Jogo: ${name}`}
    />
  );
}
