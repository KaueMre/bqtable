import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DataFormatError } from '@/engine/data';
import { createAssetResolver, normalizePath, readPackage } from './read';

const manifest = {
  format: 'bqgame/1',
  id: 'teste',
  name: 'Teste',
  kinds: [{ kind: 'k' }],
  setup: [],
};

const zip = (files: Record<string, string>) =>
  new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))]);

describe('readPackage', () => {
  it('lê um manifest.json sozinho', async () => {
    const pkg = await readPackage(new Blob([JSON.stringify(manifest)]));
    expect(pkg.manifest.name).toBe('Teste');
    expect(pkg.files.size).toBe(0);
  });

  it('lê um zip, com o manifest na raiz ou dentro de uma pasta', async () => {
    const flat = await readPackage(
      zip({ 'manifest.json': JSON.stringify(manifest), 'images/a.svg': '<svg/>' }),
    );
    expect([...flat.files.keys()].sort()).toEqual(['images/a.svg', 'manifest.json']);
    const nested = await readPackage(
      zip({ 'meu-jogo/manifest.json': JSON.stringify(manifest), 'meu-jogo/data/d.json': '[]' }),
    );
    expect([...nested.files.keys()].sort()).toEqual(['data/d.json', 'manifest.json']);
  });

  it('erros dizem o que está errado', async () => {
    await expect(readPackage(zip({ 'leia.txt': 'oi' }))).rejects.toThrow(
      'o pacote não tem manifest.json',
    );
    await expect(readPackage(new Blob(['{ quebrado']))).rejects.toThrow('não é JSON válido');
    const semKinds = { ...manifest, kinds: [] };
    await expect(readPackage(new Blob([JSON.stringify(semKinds)]))).rejects.toThrow(/kinds/);
    await expect(readPackage(new Blob([JSON.stringify(semKinds)]))).rejects.toBeInstanceOf(
      DataFormatError,
    );
  });
});

describe('createAssetResolver', () => {
  it('arquivo do pacote → blob; senão base de assets; URL absoluta passa direto', async () => {
    const pkg = await readPackage(
      zip({
        'manifest.json': JSON.stringify({
          ...manifest,
          assets: { base: 'https://cdn.exemplo.com/jogo/' },
        }),
        'images/verso.png': 'png',
      }),
    );
    const { resolve, dispose } = createAssetResolver(pkg);
    expect(resolve('./images/verso.png')).toMatch(/^blob:/);
    expect(resolve('images/verso.png')).toBe(resolve('./images/verso.png')); // um blob por arquivo
    expect(resolve('images/frente.png')).toBe('https://cdn.exemplo.com/jogo/images/frente.png');
    expect(resolve('https://outro.com/x.png')).toBe('https://outro.com/x.png');
    dispose();
  });

  it('sem base, usa o endereço do pacote', () => {
    const { resolve } = createAssetResolver({
      manifest: manifest as never,
      files: new Map(),
      url: 'https://site.com/jogos/meu.bqgame',
    });
    expect(resolve('images/a.png')).toBe('https://site.com/jogos/images/a.png');
  });

  it('normalizePath', () => {
    expect(normalizePath('./a//b\\c.png')).toBe('a/b/c.png');
  });
});
