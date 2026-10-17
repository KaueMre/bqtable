import { strFromU8, unzipSync } from 'fflate';
import { DataFormatError, fetchOk, parseOrThrow } from '@/engine/data';
import { GameManifest } from './manifest';

/**
 * De onde vem o jogo: arquivo enviado, URL, bytes já lidos (o iframe do jogo recebe assim; `url`
 * é o endereço original, base para caminhos relativos) ou o manifest já em memória.
 */
export type PackageSource =
  | Blob
  | { url: string }
  | { bytes: ArrayBuffer | Uint8Array; url?: string }
  | { manifest: unknown };

export interface RawPackage {
  manifest: GameManifest;
  /** Arquivos dentro do pacote (caminho normalizado, sem a pasta raiz do zip). */
  files: Map<string, Uint8Array>;
  /** Endereço do pacote, se veio de URL: base para caminhos relativos fora do pacote. */
  url?: string;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Normaliza "./a//b.png" → "a/b.png". */
export const normalizePath = (path: string) =>
  path
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.')
    .join('/');

/** Lê um `.bqgame` (zip com manifest.json) ou um `manifest.json` sozinho, e valida. */
export async function readPackage(source: PackageSource): Promise<RawPackage> {
  if ('manifest' in source) {
    return { manifest: parseOrThrow(GameManifest, source.manifest, 'manifest'), files: new Map() };
  }
  let bytes: Uint8Array;
  let url: string | undefined;
  if (source instanceof Blob) {
    bytes = new Uint8Array(await source.arrayBuffer());
  } else if ('bytes' in source) {
    bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes);
    url = source.url;
  } else {
    url = new URL(source.url, window.location.href).href;
    bytes = new Uint8Array(await (await fetchOk(url, source.url)).arrayBuffer());
  }

  if (!isZip(bytes)) {
    return { manifest: parseManifest(strFromU8(bytes), 'manifest'), files: new Map(), url };
  }

  const entries = unzipSync(bytes);
  // aceita o manifest na raiz ou dentro de uma pasta única (zip de uma pasta)
  const manifestPath = Object.keys(entries)
    .map(normalizePath)
    .filter((p) => p.endsWith('manifest.json'))
    .sort((a, b) => a.length - b.length)[0];
  if (!manifestPath) throw new DataFormatError('o pacote não tem manifest.json');
  const root = manifestPath.slice(0, -'manifest.json'.length);
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    const path = normalizePath(name);
    if (path.startsWith(root) && !name.endsWith('/')) files.set(path.slice(root.length), data);
  }
  const manifest = parseManifest(strFromU8(files.get('manifest.json')!), 'manifest.json');
  return { manifest, files, url };
}

function parseManifest(text: string, source: string): GameManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new DataFormatError(`${source} não é JSON válido: ${(e as Error).message}`);
  }
  return parseOrThrow(GameManifest, json, source);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json',
};

/**
 * Traduz um caminho de imagem ou dados para um endereço: arquivo dentro do pacote (blob URL),
 * senão relativo a `assets.base`, senão relativo ao endereço do pacote; URL absoluta passa direto.
 */
export function createAssetResolver(pkg: RawPackage) {
  const blobs = new Map<string, string>();
  const base = pkg.manifest.assets?.base ?? pkg.url;
  const resolve = (ref: string): string => {
    if (/^(https?:|data:|blob:)/.test(ref)) return ref;
    const path = normalizePath(ref);
    const file = pkg.files.get(path);
    if (file) {
      let blob = blobs.get(path);
      if (!blob) {
        const type = MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';
        blob = URL.createObjectURL(new Blob([file as BlobPart], { type }));
        blobs.set(path, blob);
      }
      return blob;
    }
    return base ? new URL(path, base).href : ref;
  };
  const dispose = () => {
    for (const blob of blobs.values()) URL.revokeObjectURL(blob);
    blobs.clear();
  };
  return { resolve, dispose };
}
