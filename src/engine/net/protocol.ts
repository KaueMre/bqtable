import { z } from 'zod';
import { err, ok, type Command, type GameState, type Result } from '@/engine/core';

/**
 * Mensagens entre os sites dos jogadores (host ↔ convidado), por um `Transport`. Tudo que chega da
 * rede passa por `parseMessage` antes de ser usado.
 *
 * Entrada: o convidado manda `hello`; o host responde `welcome` (assento e dados do pacote), manda
 * o pacote em `pkg-chunk` e depois o `state` do assento. Na partida: `cmd` do convidado, `state` a
 * cada mudança e `rejected` quando o host recusa um comando dele.
 */
export const PROTOCOL_VERSION = 1;

/** Tamanho máximo de um pedaço do pacote (cabe numa mensagem de DataChannel em qualquer navegador). */
export const CHUNK_SIZE = 16 * 1024;

/** Maior pacote que o host manda pela rede. */
export const MAX_PACKAGE_SIZE = 256 * 1024 * 1024;

/** O pacote que o host manda: o convidado confere o tamanho e o SHA-256 (hex). */
export interface PackageInfo {
  nome: string;
  tamanho: number;
  hash: string;
  /** Endereço original, se o host abriu por URL (base dos caminhos relativos). */
  url?: string;
}

/** A partida do host: o convidado monta as ações do jogo com as mesmas opções. */
export interface MatchInfo {
  jogadores: number;
  opcoes: Record<string, string>;
}

export type NetMessage =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'welcome'; seat: string; pacote: PackageInfo; partida?: MatchInfo }
  | { v: 1; type: 'pkg-chunk'; i: number; n: number; bytes: Uint8Array }
  | { v: 1; type: 'state'; seq: number; state: GameState }
  | { v: 1; type: 'cmd'; cmd: Command }
  | { v: 1; type: 'rejected'; reason: string }
  | { v: 1; type: 'ping'; t: number }
  | { v: 1; type: 'pong'; t: number }
  | { v: 1; type: 'bye'; reason?: string };

/** Mensagem sem o campo de versão (quem envia não repete o `v`). */
export type NetMessageBody = NetMessage extends infer M
  ? M extends NetMessage
    ? Omit<M, 'v'>
    : never
  : never;

const v = z.literal(PROTOCOL_VERSION);
const id = z.string().min(1).max(200);

// O estado vem do host, que é quem manda na partida: confere só a forma de fora.
const state = z.looseObject({
  pieces: z.record(z.string(), z.looseObject({ id: z.string() })),
  globals: z.record(z.string(), z.unknown()),
  players: z.record(z.string(), z.looseObject({ id: z.string(), name: z.string() })),
  playerOrder: z.array(z.string()),
  activePlayer: z.string().nullable(),
  log: z.array(z.looseObject({ seq: z.number(), event: z.looseObject({ type: z.string() }) })),
  pending: z.looseObject({ id: z.string(), prompt: z.string() }).nullable(),
  ended: z
    .looseObject({
      result: z.string().optional(),
      winners: z.array(z.string()).optional(),
      ranking: z.array(z.looseObject({ player: z.string() })).optional(),
    })
    .nullable(),
  rng: z.number(),
  seq: z.number(),
});

// O comando vem do convidado: o Gestor do host valida o resto (e o `actor` é trocado).
const command = z.looseObject({ type: z.string().min(1).max(100) });

const message = z.discriminatedUnion('type', [
  z.object({ v, type: z.literal('hello') }),
  z.object({
    v,
    type: z.literal('welcome'),
    seat: id,
    pacote: z.object({
      nome: z.string().max(200),
      tamanho: z.number().int().min(0).max(MAX_PACKAGE_SIZE),
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      url: z.string().max(4000).optional(),
    }),
    partida: z
      .object({
        jogadores: z.number().int().min(1).max(64),
        opcoes: z
          .record(z.string().max(100), z.string().max(200))
          .refine((o) => Object.keys(o).length <= 100, 'opções demais'),
      })
      .optional(),
  }),
  z.object({
    v,
    type: z.literal('pkg-chunk'),
    i: z.number().int().min(0),
    n: z.number().int().min(1),
    bytes: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength <= CHUNK_SIZE, 'pedaço grande demais'),
  }),
  z.object({ v, type: z.literal('state'), seq: z.number().int().min(0), state }),
  z.object({ v, type: z.literal('cmd'), cmd: command }),
  z.object({ v, type: z.literal('rejected'), reason: z.string().max(2000) }),
  z.object({ v, type: z.literal('ping'), t: z.number() }),
  z.object({ v, type: z.literal('pong'), t: z.number() }),
  z.object({ v, type: z.literal('bye'), reason: z.string().max(500).optional() }),
]);

/** A mensagem que chegou da rede, conferida; ou o motivo de não valer. */
export function parseMessage(data: unknown): Result<NetMessage> {
  const version = (data as { v?: unknown } | null)?.v;
  if (version !== PROTOCOL_VERSION) {
    return err(`protocolo ${String(version)}, esperado ${PROTOCOL_VERSION}: atualize a página`);
  }
  const r = message.safeParse(data);
  return r.success ? ok(r.data as NetMessage) : err(r.error.issues[0]?.message ?? 'inválida');
}

/** Monta a mensagem com a versão do protocolo. */
export const netMessage = (body: NetMessageBody): NetMessage => ({ v: 1, ...body }) as NetMessage;

/** SHA-256 em hex (o convidado confere o pacote que chegou). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
