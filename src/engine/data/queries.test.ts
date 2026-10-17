import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DataFormatError,
  fetchJson,
  fetchOk,
  HttpError,
  jsonQuery,
  NetworkError,
  retryNetworkOnly,
} from './queries';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe('queries', () => {
  it('fetchJson falha com o status HTTP', async () => {
    stubFetch(404, {});
    await expect(fetchJson('/x.json')).rejects.toThrow('/x.json: HTTP 404');
  });

  it('fetch sem resposta (CORS, sem rede) vira NetworkError legível, que se repete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const erro = await fetchOk('https://x.com/j.bqgame', 'j.bqgame').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(NetworkError);
    expect((erro as Error).message).toMatch(/^j\.bqgame: .*Access-Control-Allow-Origin/);
    expect(retryNetworkOnly(0, erro as Error)).toBe(true);
  });

  it('jsonQuery valida com o schema', async () => {
    const schema = z.object({ n: z.number() });
    const q = jsonQuery(['k'], '/x.json', schema);
    stubFetch(200, { n: 3 });
    await expect(q.queryFn!({} as never)).resolves.toEqual({ n: 3 });
    stubFetch(200, { n: 'três' });
    await expect(q.queryFn!({} as never)).rejects.toBeInstanceOf(DataFormatError);
  });

  it('só tenta de novo falha de rede', () => {
    expect(retryNetworkOnly(0, new Error('rede'))).toBe(true);
    expect(retryNetworkOnly(2, new Error('rede'))).toBe(false);
    expect(retryNetworkOnly(0, new DataFormatError('formato'))).toBe(false);
  });
});

describe('HttpError', () => {
  it('4xx não se repete; 5xx e falha de rede sim', () => {
    expect(retryNetworkOnly(0, new HttpError('/a', 404))).toBe(false);
    expect(retryNetworkOnly(0, new HttpError('/a', 503))).toBe(true);
    expect(retryNetworkOnly(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});
