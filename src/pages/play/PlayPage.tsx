import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DataBoundary, fetchOk, retryNetworkOnly } from '@/engine/data';
import { randomId } from '@/engine/net';
import { comboOf } from '@/engine/package/keys';
import {
  cleanPrefs,
  FRAME_SANDBOX,
  FRAME_URL,
  isFrameKeymap,
  isFrameMessage,
  isFrameNetOut,
  isFramePrefs,
  isTableShortcut,
  mergePrefs,
  type FrameKey,
  type FrameLoad,
  type FrameNet,
  type FrameNetIn,
  type SitePrefs,
} from '@/frame/protocol';
import { normalizarUrl, urlDoGh } from './enderecos';
import { EXEMPLOS } from './exemplos';
import {
  abrirMesa,
  ASSENTO_DO_HOST,
  createFrameLink,
  entrarNaMesa,
  lerRede,
  linkDaSala,
  type Conectado,
  type Entrada,
  type FrameLink,
  type Rede,
} from './rede';
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
 * (link compartilhável; link de página do GitHub vira o arquivo cru) e `?gh=dono/repo@ref/caminho`
 * é o atalho para um arquivo no GitHub. A página só busca os bytes; o jogo e o regras.js rodam no
 * iframe. Com um jogo aberto, **Hospedar** cria uma sala; `?sala=<id>` entra nela como convidado.
 */
export function PlayPage() {
  const [params] = useSearchParams();
  const sala = params.get('sala');
  const rede = lerRede(params.get('rede'));
  return sala ? <Convidado key={sala} sala={sala} rede={rede} /> : <Escolher rede={rede} />;
}

function Escolher({ rede }: { rede: Rede }) {
  const [params, setParams] = useSearchParams();
  const urlParam = params.get('url');
  const ghParam = params.get('gh');
  const [arquivo, setArquivo] = useState<Fonte | null>(null);
  const endereco = urlParam ? normalizarUrl(urlParam) : ghParam ? urlDoGh(ghParam) : null;
  const erro = !arquivo && endereco && 'erro' in endereco ? endereco.erro : null;
  const fonte = arquivo ?? (endereco && 'url' in endereco ? porUrl(endereco.url) : null);

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
          <Pacote fonte={fonte} rede={rede} />
        </DataBoundary>
      ) : erro ? (
        <p role="alert" className="play-error">
          {erro}
        </p>
      ) : (
        <p className="play-empty">Escolha um arquivo, cole uma URL ou abra um exemplo.</p>
      )}
    </div>
  );
}

function Pacote({ fonte, rede }: { fonte: Fonte; rede: Rede }) {
  const { data } = useSuspenseQuery({
    queryKey: ['bqgame', 'bytes', fonte.chave],
    queryFn: fonte.ler,
    staleTime: Infinity,
    gcTime: 0,
    retry: retryNetworkOnly,
  });
  return <Mesa name={fonte.nome} bytes={data.bytes} url={data.url} rede={rede} />;
}

const NET_HOST: FrameNet = { role: 'host', seat: ASSENTO_DO_HOST };

/** O jogo aberto aqui: sozinho, ou hospedando uma sala (os convidados entram pelo link). */
function Mesa({
  name,
  bytes,
  url,
  rede,
}: {
  name: string;
  bytes: ArrayBuffer;
  url?: string;
  rede: Rede;
}) {
  const [sala, setSala] = useState<string | null>(null);
  const [conectados, setConectados] = useState<Conectado[]>([]);
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const link = useMemo(() => (sala ? createFrameLink() : null), [sala]);
  useEffect(() => {
    if (!sala || !link) return;
    const mesa = abrirMesa({
      sala,
      rede,
      link,
      pacote: { nome: name, bytes: new Uint8Array(bytes), url },
      onGuests: setConectados,
      onReady: () => setAberta(true),
      onError: setErro,
    });
    return () => mesa.close();
  }, [sala, link, rede, name, bytes, url]);
  const parar = () => {
    setSala(null);
    setConectados([]);
    setAberta(false);
    setErro(null);
  };
  const endereco = sala && linkDaSala(sala, rede);

  return (
    <>
      <section className="play-host" aria-label="Partida em rede">
        {!sala ? (
          <button onClick={() => setSala(randomId())}>Hospedar</button>
        ) : (
          <>
            {erro ? (
              <span role="alert">Não foi possível abrir a sala: {erro}.</span>
            ) : !aberta ? (
              <span role="status">Abrindo a sala…</span>
            ) : (
              <>
                <span>
                  Sala aberta. Mande o link:{' '}
                  <a href={endereco!} target="_blank" rel="noreferrer">
                    {endereco}
                  </a>
                </span>
                <button onClick={() => void navigator.clipboard?.writeText(endereco!)}>
                  Copiar
                </button>
                <span aria-label="Conectados">
                  {conectados.length === 0
                    ? 'Ninguém entrou ainda.'
                    : `Na mesa: ${conectados.map((c) => c.nome).join(', ')}`}
                </span>
              </>
            )}
            <button onClick={parar}>Encerrar</button>
          </>
        )}
      </section>
      <GameFrame
        // hospedar recomeça o jogo no iframe, agora com a tela fixa no assento do host
        key={sala ?? 'local'}
        name={name}
        bytes={bytes}
        url={url}
        net={sala ? NET_HOST : undefined}
        link={link ?? undefined}
      />
    </>
  );
}

/** Convidado: entra na sala, recebe o pacote do host e joga no assento que ele der. */
function Convidado({ sala, rede }: { sala: string; rede: Rede }) {
  const [entrada, setEntrada] = useState<Entrada>({});
  const link = useMemo(() => createFrameLink(), []);
  useEffect(() => {
    const conexao = entrarNaMesa({ sala, rede, link, onChange: setEntrada });
    return () => conexao.close();
  }, [sala, rede, link]);
  const { conectado, seat, pacote, partida, progresso, bytes, fim } = entrada;
  const net = useMemo<FrameNet | undefined>(
    () =>
      seat === undefined
        ? undefined
        : {
            role: 'guest',
            seat,
            ...(partida && { players: partida.jogadores, options: partida.opcoes }),
          },
    [seat, partida],
  );

  return (
    <div className="play">
      <section className="play-host" aria-label="Partida em rede">
        <span>
          Sala <strong>{sala}</strong>
          {pacote && <> · {pacote.nome}</>}
        </span>
        {!fim && (
          <span role="status">
            {!conectado
              ? 'Conectando ao host…'
              : seat === undefined
                ? 'Conectado. Esperando o host…'
                : bytes
                  ? 'Conectado.'
                  : `Conectado. Recebendo o jogo… ${progresso ?? 0}%`}
          </span>
        )}
        {fim && (
          <span role="alert">
            {conectado ? 'A conexão acabou' : 'Não foi possível conectar'}: {fim}.{' '}
            <Link to="/jogar">Escolher outro jogo</Link>
          </span>
        )}
      </section>
      {bytes && pacote && net && (
        <GameFrame name={pacote.nome} bytes={bytes} url={pacote.url} net={net} link={link} />
      )}
    </div>
  );
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
function GameFrame({
  name,
  bytes,
  url,
  net,
  link,
}: {
  name: string;
  bytes: ArrayBuffer;
  url?: string;
  /** Partida em rede: o papel do jogo e a ponte com a rede. */
  net?: FrameNet;
  link?: FrameLink;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // combinações com atalho no jogo (o iframe avisa): repassadas com o foco aqui fora
  const keymap = useRef(new Set<string>());
  useEffect(() => {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let disconnect: (() => void) | undefined;
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
          ...(net && { net }),
        };
        frame.postMessage(load, '*'); // origem opaca: só dá para endereçar com '*'
        // a rede entrega no iframe depois do pacote (a ordem do postMessage é mantida)
        disconnect?.();
        disconnect = link?.connect((m) =>
          frame.postMessage({ type: 'bq:net-in', nonce, msg: m } satisfies FrameNetIn, '*'),
        );
      } else if (isFrameNetOut(msg)) {
        if (msg.nonce === nonce) link?.out(msg.msg);
      } else if (isFramePrefs(msg)) {
        const next = mergePrefs(readPrefs(), msg);
        if (next) writePrefs(next);
      } else if (isFrameKeymap(msg)) {
        keymap.current = new Set(msg.combos);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      disconnect?.();
    };
  }, [name, bytes, url, net, link]);

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
