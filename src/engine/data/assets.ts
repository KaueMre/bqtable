import { useSyncExternalStore } from 'react';

/** O que o renderer consegue desenhar. */
export type ImageSource = HTMLImageElement | HTMLCanvasElement;

type Status = 'loading' | 'loaded' | 'failed';

interface Entry {
  image?: ImageSource;
  status: Status;
  ready: Promise<void>; // resolve quando carrega ou falha (nunca rejeita)
  subscribe(fn: () => void): () => void;
  getStatus(): Status;
}

type Generator = (path: string) => ImageSource | null;
type Resolver = (path: string) => string;

/** Uma entrada por URL, compartilhada por todas as peças que usam a imagem. */
const cache = new Map<string, Entry>();
const schemes = new Map<string, { generate?: Generator; resolve?: Resolver }>();

/** Registrar de novo um esquema esquece as imagens que ele já tinha produzido (outro jogo). */
function setScheme(scheme: string, handler: { generate?: Generator; resolve?: Resolver }) {
  schemes.set(scheme, handler);
  for (const url of cache.keys()) if (url.startsWith(`${scheme}:`)) cache.delete(url);
}

/**
 * Imagens desenhadas por código, pedidas por URL "esquema:caminho" (ex.: "tatto:mindset/T01").
 * Servem de arte provisória: o estado guarda só a URL, e trocar pela arte real é trocar a URL.
 */
export function registerImageGenerator(scheme: string, generate: Generator): void {
  setScheme(scheme, { generate });
}

/**
 * Imagens de verdade pedidas por um nome estável ("asset:images/verso.png"), traduzido na hora
 * de carregar para o endereço real (arquivo dentro do pacote ou URL). O estado guarda o nome.
 */
export function registerUrlResolver(scheme: string, resolve: Resolver): void {
  setScheme(scheme, { resolve });
}

const schemeOf = (url: string) => {
  const scheme = /^([a-z][a-z0-9-]*):/i.exec(url)?.[1];
  return scheme === undefined ? undefined : schemes.get(scheme);
};
const generatorFor = (url: string) => schemeOf(url)?.generate;

function settled(status: Status, image?: ImageSource): Entry {
  return {
    image,
    status,
    ready: Promise.resolve(),
    subscribe: () => () => {},
    getStatus: () => status,
  };
}

export function loadImage(url: string): Entry {
  const cached = cache.get(url);
  if (cached) return cached;

  const generate = generatorFor(url);
  if (generate) {
    const image = generate(url.slice(url.indexOf(':') + 1)) ?? undefined;
    const entry = settled(image ? 'loaded' : 'failed', image);
    cache.set(url, entry);
    return entry;
  }

  // fora do navegador (testes de regras no Node) não há imagens: vira placeholder
  if (typeof window === 'undefined' || !window.Image) {
    const entry = settled('failed');
    cache.set(url, entry);
    return entry;
  }

  const resolve = schemeOf(url)?.resolve;
  const src = resolve ? resolve(url.slice(url.indexOf(':') + 1)) : url;

  const listeners = new Set<() => void>();
  const image = new window.Image();
  let done!: () => void;
  const entry: Entry = {
    image,
    status: 'loading',
    ready: new Promise((r) => (done = r)),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getStatus: () => entry.status,
  };
  const settle = (status: Status) => {
    entry.status = status;
    done();
    for (const fn of listeners) fn();
  };
  image.onload = () => settle('loaded');
  image.onerror = () => settle('failed');
  image.src = src;
  cache.set(url, entry);
  return entry;
}

/**
 * Carrega as imagens antes de mostrar a mesa. Imagem que falha vira placeholder, não erro; a que
 * demora mais que `timeoutMs` (rede lenta, URL pendurada) não segura o jogo: aparece quando chegar.
 */
export async function preloadImages(
  urls: Iterable<string>,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)));
  const all = Promise.all([...new Set(urls)].filter(isImageUrl).map((url) => loadImage(url).ready));
  await Promise.race([all, timeout]);
  clearTimeout(timer);
}

/** A face é imagem se parece URL (ou usa um esquema gerado); senão vira texto do placeholder. */
export function isImageUrl(face: string | undefined): face is string {
  if (!face) return false;
  return (
    schemeOf(face) !== undefined ||
    /^(data:image\/|blob:|https?:|\/|\.\.?\/)/.test(face) ||
    /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(face)
  );
}

const noSubscribe = () => () => {};
const noStatus = () => undefined;

/** Imagem pronta, ou `undefined` enquanto carrega, se falhou ou se não há URL. */
export function useImage(url: string | undefined): ImageSource | undefined {
  const entry = url ? loadImage(url) : undefined;
  const status = useSyncExternalStore(
    entry?.subscribe ?? noSubscribe,
    entry?.getStatus ?? noStatus,
  );
  return status === 'loaded' ? entry?.image : undefined;
}
