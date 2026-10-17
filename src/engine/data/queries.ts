import { queryOptions } from '@tanstack/react-query';
import { z, type ZodType } from 'zod';

/** Resposta HTTP com erro. 4xx não adianta repetir; 5xx pode ser passageiro. */
export class HttpError extends Error {
  name = 'HttpError';
  readonly status: number;
  constructor(url: string, status: number) {
    super(`${url}: HTTP ${status}`);
    this.status = status;
  }
}

/**
 * O `fetch` falhou sem resposta: sem rede, endereço que não existe, ou servidor sem CORS (o
 * navegador só diz "Failed to fetch" e não conta qual). Pode ser passageiro: tenta de novo.
 */
export class NetworkError extends Error {
  name = 'NetworkError';
  constructor(url: string) {
    super(
      `${url}: não deu para baixar. Se o endereço abre no navegador, o servidor não deixa outros ` +
        'sites lerem o arquivo: ele precisa mandar o cabeçalho Access-Control-Allow-Origin ' +
        '(o GitHub Pages e o raw.githubusercontent.com mandam).',
    );
  }
}

/** `fetch` que lança `HttpError` quando a resposta não é 2xx e `NetworkError` sem resposta. */
export async function fetchOk(url: string, label = url): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    if (e instanceof TypeError) throw new NetworkError(label);
    throw e;
  }
  if (!res.ok) throw new HttpError(label, res.status);
  return res;
}

export async function fetchJson(url: string): Promise<unknown> {
  return (await fetchOk(url)).json();
}

/** Dados no formato errado. Não adianta buscar de novo: o arquivo precisa ser corrigido. */
export class DataFormatError extends Error {
  name = 'DataFormatError';
}

/** Valida com o schema; o erro diz o arquivo e o caminho de cada problema (ex.: mindset[3].centro). */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown, source: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DataFormatError(
      `${source} não bate com o formato esperado:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}

/** Tenta de novo só falha de rede ou de servidor (até 2 vezes); formato e 4xx aparecem na hora. */
export const retryNetworkOnly = (failures: number, error: Error) =>
  failures < 2 &&
  !(error instanceof DataFormatError) &&
  !(error instanceof HttpError && error.status < 500);

/**
 * Query de um JSON validado por schema. Definições de jogo não mudam durante a partida:
 * busca uma vez e guarda.
 */
export function jsonQuery<T>(key: readonly unknown[], url: string, schema: ZodType<T>) {
  return queryOptions({
    queryKey: key,
    queryFn: async () => parseOrThrow(schema, await fetchJson(url), url),
    staleTime: Infinity,
    retry: retryNetworkOnly,
  });
}
