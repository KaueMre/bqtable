import type { Command, GameState } from '@/engine/core';
import {
  CHUNK_SIZE,
  MAX_PACKAGE_SIZE,
  netMessage,
  parseMessage,
  sha256,
  type MatchInfo,
  type NetMessageBody,
  type PackageInfo,
} from './protocol';
import type { PeerId, Transport } from './transport';

/** Um convidado na mesa: a conexão e o assento que o host deu a ele. */
export interface GuestInfo {
  peer: PeerId;
  seat: string;
}

export interface HostSessionOptions {
  transport: Transport;
  /**
   * Assentos da partida (os jogadores, na ordem). Cada convidado ganha o primeiro livre. Sem eles,
   * valem os do primeiro `publish`; depois, os de cada `publish`.
   */
  seats?: readonly string[];
  /** O assento do próprio host (nunca vai para um convidado). */
  hostSeat?: string | null;
  /** O pacote do jogo, que vai para quem entra. */
  pacote: { nome: string; bytes: Uint8Array; url?: string };
  /**
   * Comando de um convidado, com o `actor` já trocado pelo assento. Quem aplica traduz os
   * apelidos (`commandFrom`) e chama `reject` se o Gestor recusar. Os comandos vêm um por vez, na
   * ordem de chegada; se devolver uma promessa, o próximo espera.
   */
  onCommand(seat: string, cmd: Command): void | Promise<void>;
  /** A lista de convidados mudou. */
  onGuests?(guests: GuestInfo[]): void;
}

export interface HostSession {
  readonly pacote: PackageInfo;
  guests(): GuestInfo[];
  /**
   * O estado de cada assento (`redactFor`), a cada mudança: vai para quem está nele. As chaves são
   * os assentos da partida (quem estava num assento que sumiu sai da mesa). `partida` vai para
   * quem entrar depois.
   */
  publish(states: Readonly<Record<string, GameState>>, partida?: MatchInfo): void;
  /** O Gestor recusou um comando de quem está em `seat`. */
  reject(seat: string, reason: string): void;
  /** Encerra a mesa: avisa os convidados e fecha o transporte. */
  close(): void;
}

const MESA_CHEIA = 'a mesa está cheia';

/**
 * A mesa do lado do host: dá os assentos, manda o pacote em pedaços (`CHUNK_SIZE`) e, a cada
 * mudança, o estado completo de cada assento (snapshot; deltas ficam para depois).
 */
export async function createHostSession(options: HostSessionOptions): Promise<HostSession> {
  const { transport, hostSeat = null, onCommand, onGuests } = options;
  let seats: readonly string[] = options.seats ?? [];
  let partida: MatchInfo | undefined;
  const { bytes } = options.pacote;
  if (bytes.byteLength > MAX_PACKAGE_SIZE) {
    throw new Error(`pacote grande demais para a rede (${bytes.byteLength} bytes)`);
  }
  const pacote: PackageInfo = {
    nome: options.pacote.nome,
    tamanho: bytes.byteLength,
    hash: await sha256(bytes),
    ...(options.pacote.url !== undefined && { url: options.pacote.url }),
  };
  const guests = new Map<PeerId, string>();
  const latest = new Map<string, GameState>();
  let seq = 0;
  const queue: [string, Command][] = [];
  let draining = false;
  let closed = false;

  const send = (peer: PeerId, body: NetMessageBody) => transport.send(peer, netMessage(body));
  const list = () => [...guests].map(([peer, seat]) => ({ peer, seat }));
  const changed = () => onGuests?.(list());

  function join(peer: PeerId) {
    if (guests.has(peer)) return;
    const taken = new Set(guests.values());
    const seat = seats.find((s) => s !== hostSeat && !taken.has(s));
    if (seat === undefined) return send(peer, { type: 'bye', reason: MESA_CHEIA });
    guests.set(peer, seat);
    send(peer, { type: 'welcome', seat, pacote, ...(partida && { partida }) });
    const n = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
    for (let i = 0; i < n; i++) {
      send(peer, {
        type: 'pkg-chunk',
        i,
        n,
        bytes: bytes.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      });
    }
    const state = latest.get(seat);
    if (state) send(peer, { type: 'state', seq, state });
    changed();
  }

  function leave(peer: PeerId) {
    if (guests.delete(peer)) changed();
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0 && !closed) {
      const [seat, cmd] = queue.shift()!;
      try {
        await onCommand(seat, cmd);
      } catch (e) {
        session.reject(seat, e instanceof Error ? e.message : String(e));
      }
    }
    draining = false;
  }

  const offPeer = transport.onPeer((peer, event) => {
    if (event === 'close') leave(peer);
  });
  const offMessage = transport.onMessage((peer, data) => {
    const r = parseMessage(data);
    if (!r.ok || closed) return; // mensagem inválida: ignora
    const msg = r.value;
    switch (msg.type) {
      case 'hello':
        return join(peer);
      case 'cmd': {
        const seat = guests.get(peer);
        if (seat === undefined) return;
        queue.push([seat, { ...msg.cmd, actor: seat }]);
        return void drain();
      }
      case 'ping':
        return send(peer, { type: 'pong', t: msg.t });
      case 'bye':
        return leave(peer);
    }
  });

  const session: HostSession = {
    pacote,
    guests: list,
    publish(states, info) {
      seq += 1;
      if (info) partida = info;
      seats = Object.keys(states);
      for (const [peer, seat] of guests) {
        if (seats.includes(seat)) continue;
        send(peer, { type: 'bye', reason: 'a partida mudou e o seu assento não existe mais' });
        guests.delete(peer);
        changed();
      }
      latest.clear();
      for (const [seat, state] of Object.entries(states)) latest.set(seat, state);
      for (const [peer, seat] of guests) {
        const state = states[seat];
        if (state) send(peer, { type: 'state', seq, state });
      }
    },
    reject(seat, reason) {
      for (const [peer, s] of guests) if (s === seat) send(peer, { type: 'rejected', reason });
    },
    close() {
      if (closed) return;
      closed = true;
      for (const peer of guests.keys()) send(peer, { type: 'bye', reason: 'o host fechou a mesa' });
      guests.clear();
      offPeer();
      offMessage();
      transport.close();
    },
  };
  return session;
}

export interface GuestSessionOptions {
  transport: Transport;
  /** O host (o id da sala). */
  host: PeerId;
  /** A conexão com o host abriu (o pedido de entrada vai a seguir). */
  onConnect?(): void;
  /** O host deu um assento; o pacote vem a seguir. */
  onWelcome?(seat: string, pacote: PackageInfo, partida: MatchInfo | undefined): void;
  /** Pedaços do pacote recebidos. */
  onProgress?(received: number, total: number): void;
  /** O pacote chegou inteiro e confere com o hash. */
  onPackage(bytes: Uint8Array, pacote: PackageInfo): void;
  /** Estado novo do assento (só depois do pacote; estados velhos são ignorados). */
  onState(state: GameState): void;
  /** O host recusou um comando deste convidado. */
  onRejected(reason: string): void;
  /** A conexão acabou (o host saiu, a mesa está cheia, o pacote não conferiu…). */
  onClose?(reason: string): void;
}

export interface GuestSession {
  /** O assento dado pelo host (`null` até o `welcome`). */
  seat(): string | null;
  /** Manda um comando ao host (o `actor` é o host quem põe). */
  send(cmd: Command): void;
  close(): void;
}

/**
 * A mesa do lado do convidado: pede para entrar, junta os pedaços do pacote, confere o hash e
 * entrega os bytes; depois, os estados e as recusas.
 */
export function createGuestSession(options: GuestSessionOptions): GuestSession {
  const { transport, host } = options;
  let seat: string | null = null;
  let info: PackageInfo | null = null;
  let chunks: (Uint8Array | undefined)[] = [];
  let received = 0;
  let ready = false;
  let lastSeq = -1;
  let waiting: GameState | null = null; // estado que chegou antes do pacote ficar pronto
  let closed = false;

  const send = (body: NetMessageBody) => transport.send(host, netMessage(body));

  function finish(reason: string) {
    if (closed) return;
    closed = true;
    offPeer();
    offMessage();
    transport.close();
    options.onClose?.(reason);
  }

  async function assemble(pacote: PackageInfo) {
    const bytes = new Uint8Array(pacote.tamanho);
    let at = 0;
    for (const c of chunks) {
      if (at + c!.byteLength > bytes.byteLength)
        return finish('o pacote chegou maior que o anunciado');
      bytes.set(c!, at);
      at += c!.byteLength;
    }
    chunks = [];
    if (at !== pacote.tamanho) return finish('o pacote chegou incompleto');
    if ((await sha256(bytes)) !== pacote.hash)
      return finish('o pacote chegou diferente do enviado');
    if (closed || info !== pacote) return;
    ready = true;
    options.onPackage(bytes, pacote);
    if (waiting) {
      options.onState(waiting);
      waiting = null;
    }
  }

  const offPeer = transport.onPeer((peer, event) => {
    if (peer !== host) return;
    if (event === 'close') return finish('a conexão com o host caiu');
    options.onConnect?.();
    send({ type: 'hello' });
  });

  const offMessage = transport.onMessage((peer, data) => {
    if (peer !== host || closed) return;
    const r = parseMessage(data);
    if (!r.ok) return finish(`mensagem inválida do host: ${r.error}`);
    const msg = r.value;
    switch (msg.type) {
      case 'welcome': {
        seat = msg.seat;
        info = msg.pacote;
        chunks = new Array(Math.max(1, Math.ceil(info.tamanho / CHUNK_SIZE)));
        received = 0;
        ready = false;
        options.onWelcome?.(seat, info, msg.partida);
        return;
      }
      case 'pkg-chunk': {
        if (!info || ready) return;
        if (msg.n !== chunks.length || msg.i >= msg.n) return finish('pedaço do pacote inválido');
        if (chunks[msg.i] === undefined) received += 1;
        chunks[msg.i] = msg.bytes;
        options.onProgress?.(received, msg.n);
        if (received === msg.n) void assemble(info);
        return;
      }
      case 'state':
        if (msg.seq <= lastSeq) return;
        lastSeq = msg.seq;
        if (ready) options.onState(msg.state);
        else waiting = msg.state;
        return;
      case 'rejected':
        return options.onRejected(msg.reason);
      case 'ping':
        return send({ type: 'pong', t: msg.t });
      case 'bye':
        return finish(msg.reason ?? 'o host fechou a mesa');
    }
  });

  return {
    seat: () => seat,
    send(cmd) {
      if (!closed && seat !== null) send({ type: 'cmd', cmd });
    },
    close() {
      if (closed) return;
      send({ type: 'bye' });
      finish('você saiu da mesa');
    },
  };
}
