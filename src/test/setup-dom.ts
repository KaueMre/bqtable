import '@testing-library/jest-dom/vitest';
import 'vitest-canvas-mock'; // jsdom não tem canvas; o Konva precisa de um contexto 2D
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom não tem servidor: URLs da raiz ("/docs/games/tatto/dados/cartas_mindset.json") são lidas do projeto.
const projectRoot = join(import.meta.dirname, '../..');
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(window.location.origin)) url = url.slice(window.location.origin.length);
  if (!url.startsWith('/')) return realFetch(input, init);
  const path = decodeURIComponent(url.split('?')[0]!);
  // como o Vite: arquivos do projeto ou de public/
  for (const base of [projectRoot, join(projectRoot, 'public')]) {
    try {
      return new Response(await readFile(join(base, path)), { status: 200 });
    } catch {
      // tenta a próxima base
    }
  }
  return new Response('não encontrado', { status: 404 });
};

// jsdom não carrega imagens (nunca dispara load nem error): aqui elas falham na hora, e a mesa
// mostra o placeholder, como numa imagem que não existe.
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true,
  get(this: HTMLImageElement) {
    return this.getAttribute('src') ?? '';
  },
  set(this: HTMLImageElement, value: string) {
    this.setAttribute('src', value);
    setTimeout(() => this.dispatchEvent(new Event('error')));
  },
});

// jsdom não tem blob URLs; basta um endereço único por blob (as imagens não carregam no jsdom).
let blobCount = 0;
URL.createObjectURL ??= () => `blob:teste/${++blobCount}`;
URL.revokeObjectURL ??= () => {};
