import {
  createBroadcastTransports,
  createGuestSession,
  createHostSession,
  type GuestInfo,
  type GuestSession,
  type HostSession,
  type MatchInfo,
  type PackageInfo,
  type Transport,
  type TransportFactory,
} from '@/engine/net';
import type { NetIn, NetOut } from '@/frame/protocol';

/**
 * Partida em rede, do lado do site (docs/PlanoPublicacao.md, parte 3). A rede fica aqui, fora do
 * iframe; o jogo conversa com ela por `bq:net-in`/`bq:net-out`, através de um `FrameLink`.
 */

/**
 * Como os jogadores se conectam. `p2p`: WebRTC pelo PeerJS (padrão). `abas`: duas abas do mesmo
 * navegador, pelo BroadcastChannel (para desenvolver sem rede: `?rede=abas`).
 */
export type Rede = 'p2p' | 'abas';

export const REDE_PADRAO: Rede = 'p2p';

export function lerRede(valor: string | null): Rede {
  return valor === 'abas' || valor === 'p2p' ? valor : REDE_PADRAO;
}

/** O PeerJS só é baixado quando alguém hospeda ou entra numa sala. */
export async function transportes(rede: Rede): Promise<TransportFactory> {
  switch (rede) {
    case 'abas':
      return createBroadcastTransports();
    case 'p2p':
      return (await import('@/engine/net/peerjs')).createPeerJsTransports();
  }
}

/** O assento de quem hospeda. */
export const ASSENTO_DO_HOST = 'p1';

/** Endereço que o host manda para os convidados. */
export function linkDaSala(sala: string, rede: Rede, origem = window.location.origin): string {
  const url = new URL('/jogar', origem);
  url.searchParams.set('sala', sala);
  if (rede !== REDE_PADRAO) url.searchParams.set('rede', rede);
  return url.href;
}

/**
 * Ponte entre a rede e o iframe do jogo. O `GameFrame` liga a entrega (`connect`) quando manda o
 * pacote; o que chegar antes espera (do estado, só o último). O que o iframe manda (`out`) vai
 * para quem cuida da rede (`handle`); antes disso, espera também.
 */
export interface FrameLink {
  /** iframe → rede. */
  out(msg: NetOut): void;
  /** rede → iframe: o `GameFrame` entrega no iframe. Devolve o desligar. */
  connect(deliver: (msg: NetIn) => void): () => void;
  /** Mensagem da rede para o iframe. */
  push(msg: NetIn): void;
  /** Quem cuida da rede recebe o que o iframe manda. Devolve o desligar. */
  handle(fn: (msg: NetOut) => void): () => void;
}

export function createFrameLink(): FrameLink {
  let deliver: ((msg: NetIn) => void) | null = null;
  let handler: ((msg: NetOut) => void) | null = null;
  const toFrame: NetIn[] = [];
  const toNet: NetOut[] = [];
  let lastState: NetIn | null = null;
  return {
    out(msg) {
      if (handler) handler(msg);
      else toNet.push(msg);
    },
    connect(fn) {
      deliver = fn;
      if (lastState) fn(lastState);
      for (const msg of toFrame.splice(0)) fn(msg);
      return () => {
        if (deliver === fn) deliver = null;
      };
    },
    push(msg) {
      if (msg.kind === 'state') lastState = msg;
      if (deliver) deliver(msg);
      else if (msg.kind !== 'state') toFrame.push(msg);
    },
    handle(fn) {
      handler = fn;
      for (const msg of toNet.splice(0)) fn(msg);
      return () => {
        if (handler === fn) handler = null;
      };
    },
  };
}

/** Convidado na lista do host, com o nome do jogador daquele assento. */
export interface Conectado extends GuestInfo {
  nome: string;
}

/**
 * Abre a sala: a rede só começa quando o jogo publica o primeiro estado (os assentos vêm dele).
 * Os comandos dos convidados vão para o iframe; o estado de cada assento, para a rede.
 */
export function abrirMesa(options: {
  sala: string;
  rede: Rede;
  link: FrameLink;
  pacote: { nome: string; bytes: Uint8Array; url?: string };
  onGuests(guests: Conectado[]): void;
  /** A sala está aberta: o link já funciona. */
  onReady(): void;
  onError(message: string): void;
}): { close(): void } {
  const { sala, rede, link, pacote, onGuests, onReady, onError } = options;
  let starting = false;
  let transport: Transport | null = null;
  let session: HostSession | null = null;
  let last: Extract<NetOut, { kind: 'states' }> | null = null;
  let closed = false;
  const nomes = (guests: GuestInfo[]) =>
    guests.map((g) => ({ ...g, nome: last?.states[g.seat]?.players[g.seat]?.name ?? g.seat }));
  const publish = (s: HostSession, msg: Extract<NetOut, { kind: 'states' }>) => {
    const partida: MatchInfo = { jogadores: Object.keys(msg.states).length, opcoes: msg.options };
    s.publish(msg.states, partida);
  };

  const off = link.handle((msg) => {
    if (closed) return;
    if (msg.kind === 'rejected') return session?.reject(msg.seat, msg.reason);
    if (msg.kind !== 'states') return;
    last = msg;
    if (session) return publish(session, msg);
    if (starting) return; // a sessão está sendo criada
    starting = true;
    void start().catch((e: unknown) => {
      transport?.close();
      onError(e instanceof Error ? e.message : String(e));
    });
  });

  async function start() {
    const factory = await transportes(rede);
    if (closed) return;
    const t = (transport = factory.host(sala));
    if (t.onStatus) {
      t.onStatus((s) => (s.state === 'ready' ? onReady() : onError(s.reason)));
    } else {
      onReady();
    }
    const s = await createHostSession({
      transport: t,
      hostSeat: ASSENTO_DO_HOST,
      pacote,
      onCommand: (seat, cmd) => link.push({ kind: 'cmd', seat, cmd }),
      onGuests: (guests) => onGuests(nomes(guests)),
    });
    if (closed) return s.close();
    session = s;
    if (last) publish(s, last);
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      off();
      if (session) session.close();
      else transport?.close();
    },
  };
}

/** O que o convidado sabe da mesa até agora. */
export interface Entrada {
  /** A conexão com o host abriu. */
  conectado?: boolean;
  seat?: string;
  pacote?: PackageInfo;
  partida?: MatchInfo;
  /** Porcentagem do pacote recebida. */
  progresso?: number;
  bytes?: ArrayBuffer;
  /** A conexão acabou (ou nem abriu), e por quê. Fica o primeiro motivo, o mais útil. */
  fim?: string;
}

/** Entra na sala: recebe o pacote do host e liga os estados e comandos ao iframe. */
export function entrarNaMesa(options: {
  sala: string;
  rede: Rede;
  link: FrameLink;
  onChange(entrada: Entrada): void;
}): { close(): void } {
  const { sala, rede, link, onChange } = options;
  let entrada: Entrada = {};
  let closed = false;
  let session: GuestSession | null = null;
  const set = (patch: Entrada) => {
    if (patch.fim !== undefined && entrada.fim !== undefined) return;
    entrada = { ...entrada, ...patch };
    if (!closed) onChange(entrada); // quem fechou não quer mais saber
  };
  const off = link.handle((msg) => {
    if (msg.kind === 'cmd') session?.send(msg.cmd);
  });

  void transportes(rede).then(
    (factory) => {
      if (closed) return;
      const transport = factory.join(sala);
      transport.onStatus?.((s) => {
        if (s.state === 'failed') set({ fim: s.reason });
      });
      session = createGuestSession({
        transport,
        host: sala,
        onConnect: () => set({ conectado: true }),
        onWelcome: (seat, pacote, partida) => set({ seat, pacote, partida, progresso: 0 }),
        onProgress(received, total) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== entrada.progresso) set({ progresso: pct });
        },
        onPackage: (bytes) =>
          set({
            bytes: bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          }),
        onState: (state) => link.push({ kind: 'state', state }),
        onRejected: (reason) => link.push({ kind: 'rejected', reason }),
        onClose: (motivo) => set({ fim: motivo }),
      });
    },
    (e: unknown) => set({ fim: e instanceof Error ? e.message : String(e) }),
  );

  return {
    close() {
      closed = true;
      off();
      session?.close();
    },
  };
}
