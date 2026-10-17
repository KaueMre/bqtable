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

/** `fetch` que lança `HttpError` quando a resposta não é 2xx. */
export async function fetchOk(url: string, label = url): Promise<Response> {
  const res = await fetch(url);
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
