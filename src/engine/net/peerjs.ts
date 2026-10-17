import Peer, { type DataConnection, type PeerJSOption } from 'peerjs';
import { createDecoder, encodeMessage } from './frames';
import {
  transportEvents,
  type PeerId,
  type Transport,
  type TransportFactory,
  type TransportStatus,
} from './transport';

/**
 * WebRTC pelo PeerJS (docs/PlanoPublicacao.md, decisão D5). O servidor público do PeerJS só
 * apresenta os jogadores; depois, os dados vão direto entre os navegadores, por um DataChannel
 * confiável e ordenado. Não entra no `index` da rede: o site carrega este arquivo só quando
 * alguém hospeda ou entra numa sala (e o Node dos testes não tem WebRTC).
 */

/** STUN públicos: cada navegador descobre o próprio endereço visto de fora. */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** Prefixo dos ids no servidor do PeerJS (ele é usado por outros sites também). */
const PREFIX = 'bqtable-';

/** Tempo para o convidado conseguir a conexão direta com o host. */
const OPEN_TIMEOUT = 20_000;

/** Controle de fluxo: para de mandar acima disto no buffer do canal, volta abaixo do outro. */
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

/** O caso que um servidor TURN resolve: não há caminho direto entre os dois aparelhos. */
export const BLOCKED =
  'a rede bloqueou a conexão direta entre os aparelhos (firewall ou roteador). Tente outra rede, ' +
  'por exemplo os dados do celular no lugar do Wi-Fi';

const SERVER =
  'não deu para falar com o servidor que apresenta os jogadores (PeerJS). Confira a internet e ' +
  'tente de novo';

function reasonOf(type: string, message: string): string {
  switch (type) {
    case 'peer-unavailable':
      return 'a sala não existe (o host fechou a página, ou o link está errado)';
    case 'unavailable-id':
      return 'já existe uma sala com esse nome; tente hospedar de novo';
    case 'browser-incompatible':
      return 'este navegador não tem WebRTC';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return SERVER;
    case 'webrtc':
    case 'negotiation-failed':
      return BLOCKED;
    default:
      return message;
  }
}

/** `peer`: outro servidor PeerJS (o padrão é o público deles). */
export function createPeerJsTransports(peer: PeerJSOption = {}): TransportFactory {
  return {
    host: (room) => open(room, true, peer),
    join: (room) => open(room, false, peer),
  };
}

interface Link {
  conn: DataConnection;
  queue: Uint8Array<ArrayBuffer>[];
}

function open(room: string, asHost: boolean, options: PeerJSOption): Transport {
  const events = transportEvents();
  const watchers = new Set<(s: TransportStatus) => void>();
  let status: TransportStatus | null = null;
  const links = new Map<PeerId, Link>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const config = { config: { iceServers: ICE_SERVERS }, ...options };
  const peer = asHost ? new Peer(PREFIX + room, config) : new Peer(config);
  // o host aparece para os convidados com o id da sala (sem o prefixo)
  const logical = (id: string) => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

  const setStatus = (s: TransportStatus) => {
    if (closed || status?.state === 'failed') return;
    status = s;
    for (const fn of [...watchers]) fn(s);
  };
  const fail = (reason: string) => {
    clearTimeout(timer);
    setStatus({ state: 'failed', reason });
  };

  function flush(link: Link) {
    const dc = link.conn.dataChannel;
    while (link.queue.length > 0 && dc?.readyState === 'open' && dc.bufferedAmount < HIGH_WATER) {
      dc.send(link.queue.shift()!);
    }
  }

  function attach(conn: DataConnection) {
    const id = logical(conn.peer);
    const link: Link = { conn, queue: [] };
    const decoder = createDecoder();
    conn.on('open', () => {
      const dc = conn.dataChannel;
      dc.bufferedAmountLowThreshold = LOW_WATER;
      dc.addEventListener('bufferedamountlow', () => flush(link));
      links.set(id, link);
      if (!asHost) {
        clearTimeout(timer);
        setStatus({ state: 'ready' });
      }
      events.peer(id, 'open');
    });
    conn.on('data', (data) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : null;
      if (!bytes) return;
      let msg: unknown;
      try {
        msg = decoder.push(bytes);
      } catch {
        return conn.close(); // quadro inválido: a conexão não serve mais
      }
      if (msg !== undefined) events.message(id, msg);
    });
    conn.on('close', () => {
      if (links.get(id) === link) {
        links.delete(id);
        events.peer(id, 'close');
      } else if (!asHost) {
        fail(BLOCKED); // fechou antes de abrir
      }
    });
    conn.on('iceStateChanged', (state) => {
      if (state === 'failed' && !asHost && !links.has(id)) fail(BLOCKED);
    });
    conn.on('error', (e) => {
      if (!asHost && !links.has(id)) fail(reasonOf(e.type, e.message));
    });
  }

  peer.on('error', (e) => {
    // no host, erro com um convidado não derruba a sala; sem a sala aberta, sim
    if (asHost && status?.state === 'ready' && e.type !== 'unavailable-id') return;
    fail(reasonOf(e.type, e.message));
  });
  peer.on('disconnected', () => {
    // caiu a ligação com o servidor: as conexões diretas continuam; volta para aceitar novos
    if (!closed && !peer.destroyed) peer.reconnect();
  });
  if (asHost) {
    peer.on('open', () => setStatus({ state: 'ready' }));
    peer.on('connection', attach);
  } else {
    peer.on('open', () => {
      attach(peer.connect(PREFIX + room, { reliable: true, serialization: 'raw' }));
      timer = setTimeout(() => fail(BLOCKED), OPEN_TIMEOUT);
    });
  }

  const transport: Transport = {
    // o convidado ganha um id do servidor quando conecta
    get id() {
      return asHost ? room : (peer.id ?? '');
    },
    send(to, msg) {
      const link = links.get(to);
      if (!link || closed) return;
      link.queue.push(...encodeMessage(msg));
      flush(link);
    },
    onMessage: events.onMessage,
    onPeer: events.onPeer,
    onStatus(fn) {
      watchers.add(fn);
      if (status) fn(status);
      return () => void watchers.delete(fn);
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      globalThis.removeEventListener?.('pagehide', transport.close);
      // o que já está na fila (o "bye") ainda sai; depois fecha tudo (no máximo 1 s)
      const start = Date.now();
      const drain = () => {
        for (const link of links.values()) flush(link);
        const empty = [...links.values()].every(
          (l) => l.queue.length === 0 && (l.conn.dataChannel?.bufferedAmount ?? 0) === 0,
        );
        if (empty || Date.now() - start > 1000) peer.destroy();
        else setTimeout(drain, 50);
      };
      drain();
    },
  };
  globalThis.addEventListener?.('pagehide', transport.close);
  return transport;
}
