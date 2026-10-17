import type { NetMessage } from './protocol';

export type PeerId = string;
export type PeerEvent = 'open' | 'close';

/** A ligação com a rede: `ready` = sala aberta (host) ou ligado ao host (convidado). */
export type TransportStatus = { state: 'ready' } | { state: 'failed'; reason: string };

/**
 * Como os sites dos jogadores conversam. O host abre a sala (o id dele é o id da sala) e aceita
 * conexões; o convidado conecta no host. Mensagens chegam na ordem em que saíram, sem perda.
 * O que chega é `unknown`: quem usa confere com `parseMessage`.
 */
export interface Transport {
  /** Este lado da conexão. */
  readonly id: PeerId;
  send(peer: PeerId, msg: NetMessage): void;
  onMessage(fn: (peer: PeerId, data: unknown) => void): () => void;
  /** Conexão aberta ou fechada com outro lado. */
  onPeer(fn: (peer: PeerId, event: PeerEvent) => void): () => void;
  /**
   * Avisa quando a ligação fica pronta ou falha (com o motivo para a tela). Sem ele, o transporte
   * fica pronto na hora (memória, abas).
   */
  onStatus?(fn: (status: TransportStatus) => void): () => void;
  /** Fecha tudo (os outros lados recebem `close`). */
  close(): void;
}

/** Abre uma sala (host) ou entra numa (convidado). */
export interface TransportFactory {
  host(room: string): Transport;
  join(room: string): Transport;
}

/** Id curto e difícil de adivinhar, para salas e convidados. */
export function randomId(length = 10): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; // sem l, o, 0, 1: dá para ditar
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => abc[b % abc.length]).join('');
}

/** O básico de um transporte: ouvintes e avisos. */
export function transportEvents() {
  const messages = new Set<(peer: PeerId, data: unknown) => void>();
  const peers = new Set<(peer: PeerId, event: PeerEvent) => void>();
  return {
    onMessage(fn: (peer: PeerId, data: unknown) => void) {
      messages.add(fn);
      return () => void messages.delete(fn);
    },
    onPeer(fn: (peer: PeerId, event: PeerEvent) => void) {
      peers.add(fn);
      return () => void peers.delete(fn);
    },
    message(peer: PeerId, data: unknown) {
      for (const fn of [...messages]) fn(peer, data);
    },
    peer(peer: PeerId, event: PeerEvent) {
      for (const fn of [...peers]) fn(peer, event);
    },
  };
}

/**
 * Rede em memória, para testes: as mensagens são copiadas (`structuredClone`, como numa rede) e
 * entregues numa microtarefa, na ordem.
 */
export function createMemoryNetwork(): TransportFactory {
  const hosts = new Map<string, MemoryEnd>();

  interface MemoryEnd {
    transport: Transport;
    links: Map<PeerId, MemoryEnd>;
    events: ReturnType<typeof transportEvents>;
    closed: boolean;
  }

  const later = (fn: () => void) => queueMicrotask(fn);

  function end(id: PeerId): MemoryEnd {
    const events = transportEvents();
    const self: MemoryEnd = {
      links: new Map(),
      events,
      closed: false,
      transport: {
        id,
        send(peer, msg) {
          const other = self.links.get(peer);
          if (!other || self.closed) return;
          const copy = structuredClone(msg);
          later(() => {
            if (!other.closed && other.links.get(id) === self) other.events.message(id, copy);
          });
        },
        onMessage: events.onMessage,
        onPeer: events.onPeer,
        close() {
          if (self.closed) return;
          self.closed = true;
          if (hosts.get(id) === self) hosts.delete(id);
          // o que já saiu ainda chega; depois, os dois lados ficam sabendo
          later(() => {
            for (const [peer, other] of self.links) {
              other.links.delete(id);
              other.events.peer(id, 'close');
              events.peer(peer, 'close');
            }
            self.links.clear();
          });
        },
      },
    };
    return self;
  }

  return {
    host(room) {
      if (hosts.has(room)) throw new Error(`sala "${room}" já existe`);
      const h = end(room);
      hosts.set(room, h);
      return h.transport;
    },
    join(room) {
      const g = end(randomId());
      later(() => {
        const h = hosts.get(room);
        if (!h || g.closed) return g.events.peer(room, 'close');
        h.links.set(g.transport.id, g);
        g.links.set(room, h);
        h.events.peer(g.transport.id, 'open');
        g.events.peer(room, 'open');
      });
      return g.transport;
    },
  };
}

type Envelope =
  | { kind: 'open' | 'accept' | 'close'; from: PeerId; to: PeerId }
  | { kind: 'msg'; from: PeerId; to: PeerId; msg: NetMessage };

/**
 * Duas abas do mesmo navegador, pelo `BroadcastChannel` (para desenvolver sem WebRTC). O convidado
 * repete o pedido de entrada até o host aceitar. Ao fechar a aba (`pagehide`), avisa os outros.
 */
export function createBroadcastTransports(prefix = 'bqtable-sala'): TransportFactory {
  function open(room: string, id: PeerId, asHost: boolean): Transport {
    const channel = new BroadcastChannel(`${prefix}:${room}`);
    const events = transportEvents();
    const links = new Set<PeerId>();
    let closed = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    const post = (e: Envelope) => channel.postMessage(e);

    channel.onmessage = ({ data }: MessageEvent<Envelope>) => {
      if (closed || !data || data.to !== id) return;
      const { from } = data;
      if (data.kind === 'open' && asHost && !links.has(from)) {
        links.add(from);
        post({ kind: 'accept', from: id, to: from });
        events.peer(from, 'open');
      } else if (data.kind === 'accept' && !asHost && from === room && !links.has(from)) {
        clearInterval(retry);
        links.add(from);
        events.peer(from, 'open');
      } else if (data.kind === 'close' && links.delete(from)) {
        events.peer(from, 'close');
      } else if (data.kind === 'msg' && links.has(from)) {
        events.message(from, data.msg);
      }
    };

    const transport: Transport = {
      id,
      send(peer, msg) {
        if (!closed && links.has(peer)) post({ kind: 'msg', from: id, to: peer, msg });
      },
      onMessage: events.onMessage,
      onPeer: events.onPeer,
      close() {
        if (closed) return;
        closed = true;
        clearInterval(retry);
        for (const peer of links) post({ kind: 'close', from: id, to: peer });
        links.clear();
        channel.close();
        globalThis.removeEventListener?.('pagehide', transport.close);
      },
    };
    globalThis.addEventListener?.('pagehide', transport.close);
    if (!asHost) {
      const knock = () => post({ kind: 'open', from: id, to: room });
      knock();
      retry = setInterval(knock, 500);
    }
    return transport;
  }

  return {
    host: (room) => open(room, room, true),
    join: (room) => open(room, randomId(), false),
  };
}
