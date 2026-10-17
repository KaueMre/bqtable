import { PROTOCOL_VERSION, type NetMessage } from './protocol';

/**
 * Mensagens em quadros binários, para canais com limite de tamanho por mensagem (o DataChannel
 * do WebRTC). Cada quadro: 1 byte de tipo (0 = JSON, 1 = pedaço do pacote), 1 byte de fim
 * (1 = último quadro da mensagem) e os dados. O canal é ordenado: os quadros de uma mensagem
 * chegam juntos e em ordem.
 */

/** Maior quadro (um pedaço do pacote cabe inteiro, com os cabeçalhos). */
export const FRAME_SIZE = 32 * 1024;

/** Maior mensagem que o receptor monta (um estado grande, com o log da partida). */
export const MAX_MESSAGE_SIZE = 64 * 1024 * 1024;

const JSON_FRAME = 0;
const CHUNK_FRAME = 1;
const HEADER = 2;

export function encodeMessage(msg: NetMessage): Uint8Array<ArrayBuffer>[] {
  let type: number;
  let body: Uint8Array;
  if (msg.type === 'pkg-chunk') {
    type = CHUNK_FRAME;
    body = new Uint8Array(8 + msg.bytes.byteLength);
    const view = new DataView(body.buffer);
    view.setUint32(0, msg.i);
    view.setUint32(4, msg.n);
    body.set(msg.bytes, 8);
  } else {
    type = JSON_FRAME;
    body = new TextEncoder().encode(JSON.stringify(msg));
  }
  const room = FRAME_SIZE - HEADER;
  const frames: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; ; at += room) {
    const part = body.subarray(at, at + room);
    const last = at + room >= body.byteLength;
    const frame = new Uint8Array(HEADER + part.byteLength);
    frame[0] = type;
    frame[1] = last ? 1 : 0;
    frame.set(part, HEADER);
    frames.push(frame);
    if (last) return frames;
  }
}

/**
 * Junta os quadros que chegam. `push` devolve a mensagem quando ela termina (ainda não conferida:
 * passe por `parseMessage`), ou `undefined`. Lança erro se o quadro não faz sentido.
 */
export function createDecoder(): { push(frame: Uint8Array): unknown } {
  let type: number | null = null;
  let parts: Uint8Array[] = [];
  let size = 0;
  return {
    push(frame) {
      if (frame.byteLength < HEADER) throw new Error('quadro curto demais');
      const [kind, last] = frame as unknown as [number, number];
      if (kind !== JSON_FRAME && kind !== CHUNK_FRAME) throw new Error(`quadro de tipo ${kind}`);
      if (type !== null && kind !== type) throw new Error('quadros de mensagens misturadas');
      type = kind;
      size += frame.byteLength - HEADER;
      if (size > MAX_MESSAGE_SIZE) throw new Error('mensagem grande demais');
      parts.push(frame.subarray(HEADER));
      if (last !== 1) return undefined;
      const body = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        body.set(p, at);
        at += p.byteLength;
      }
      type = null;
      parts = [];
      size = 0;
      if (kind === JSON_FRAME) return JSON.parse(new TextDecoder().decode(body)) as unknown;
      if (body.byteLength < 8) throw new Error('pedaço do pacote sem cabeçalho');
      const view = new DataView(body.buffer);
      return {
        v: PROTOCOL_VERSION,
        type: 'pkg-chunk',
        i: view.getUint32(0),
        n: view.getUint32(4),
        bytes: body.slice(8),
      };
    },
  };
}
