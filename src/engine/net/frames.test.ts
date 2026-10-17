import { describe, expect, it } from 'vitest';
import { createDecoder, encodeMessage, FRAME_SIZE } from './frames';
import { CHUNK_SIZE, netMessage, parseMessage, type NetMessage } from './protocol';

function roundTrip(msg: NetMessage) {
  const frames = encodeMessage(msg);
  const decoder = createDecoder();
  const out = frames.map((f) => decoder.push(f));
  expect(out.slice(0, -1).every((m) => m === undefined)).toBe(true);
  return { frames, msg: parseMessage(out.at(-1)) };
}

describe('quadros do DataChannel', () => {
  it('mensagem pequena: um quadro de JSON', () => {
    const { frames, msg } = roundTrip(netMessage({ type: 'rejected', reason: 'não pode' }));
    expect(frames).toHaveLength(1);
    expect(msg).toEqual({ ok: true, value: { v: 1, type: 'rejected', reason: 'não pode' } });
  });

  it('pedaço do pacote: binário, num quadro só', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(CHUNK_SIZE));
    const { frames, msg } = roundTrip(netMessage({ type: 'pkg-chunk', i: 7, n: 9, bytes }));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.byteLength).toBeLessThanOrEqual(FRAME_SIZE);
    expect(msg).toEqual({ ok: true, value: { v: 1, type: 'pkg-chunk', i: 7, n: 9, bytes } });
  });

  it('estado grande: vários quadros, nenhum maior que o limite', () => {
    const state = {
      pieces: {},
      globals: { texto: 'á'.repeat(100_000) },
      players: {},
      playerOrder: [],
      activePlayer: null,
      log: [],
      pending: null,
      ended: null,
      rng: 0,
      seq: 3,
    };
    const { frames, msg } = roundTrip(netMessage({ type: 'state', seq: 1, state } as never));
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.every((f) => f.byteLength <= FRAME_SIZE)).toBe(true);
    expect(msg.ok && msg.value.type === 'state' && msg.value.state.globals.texto).toHaveLength(
      100_000,
    );
  });

  it('mensagens seguidas no mesmo decodificador', () => {
    const decoder = createDecoder();
    const a = encodeMessage(netMessage({ type: 'ping', t: 1 }));
    const b = encodeMessage(netMessage({ type: 'pong', t: 2 }));
    expect([...a, ...b].map((f) => decoder.push(f))).toEqual([
      { v: 1, type: 'ping', t: 1 },
      { v: 1, type: 'pong', t: 2 },
    ]);
  });

  it('quadro sem sentido é erro', () => {
    expect(() => createDecoder().push(new Uint8Array([9, 1]))).toThrow('quadro de tipo 9');
    expect(() => createDecoder().push(new Uint8Array([1]))).toThrow('curto');
    const d = createDecoder();
    d.push(new Uint8Array([0, 0, 123]));
    expect(() => d.push(new Uint8Array([1, 1]))).toThrow('misturadas');
  });
});
