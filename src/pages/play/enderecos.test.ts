import { describe, expect, it } from 'vitest';
import { normalizarUrl, urlDoGh } from './enderecos';

const RAW_PIRAMIDE =
  'https://raw.githubusercontent.com/KaueMre/bqtable/main/public/exemplos/piramide.bqgame';

describe('normalizarUrl', () => {
  it('link de página do GitHub (blob) vira o arquivo cru', () => {
    expect(
      normalizarUrl('https://github.com/KaueMre/bqtable/blob/main/public/exemplos/piramide.bqgame'),
    ).toEqual({ url: RAW_PIRAMIDE });
  });

  it('/raw/ também, inclusive com refs/heads (o botão Raw do GitHub)', () => {
    expect(
      normalizarUrl('https://github.com/KaueMre/bqtable/raw/main/public/exemplos/piramide.bqgame'),
    ).toEqual({ url: RAW_PIRAMIDE });
    expect(normalizarUrl('https://github.com/o/r/raw/refs/heads/main/jogo.bqgame')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/refs/heads/main/jogo.bqgame',
    });
  });

  it('aceita sem https://, com www., espaços em volta, ?raw=true e #linha', () => {
    expect(normalizarUrl('  github.com/o/r/blob/v1.2/a/b c.bqgame?raw=true#L3 ')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/v1.2/a/b%20c.bqgame',
    });
    expect(normalizarUrl('https://www.github.com/o/r/blob/dev/m.json')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/dev/m.json',
    });
  });

  it('pasta (/tree/) abre o manifest.json dela', () => {
    expect(normalizarUrl('https://github.com/o/r/tree/main/jogos/meu')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/main/jogos/meu/manifest.json',
    });
  });

  it('link de Release explica que o GitHub não manda CORS', () => {
    for (const url of [
      'https://github.com/o/r/releases/download/v1/jogo.bqgame',
      'https://github.com/o/r/releases/latest/download/jogo.bqgame',
      'https://release-assets.githubusercontent.com/github-production-release-asset/1/2?x=y',
      'https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/2',
    ]) {
      const r = normalizarUrl(url);
      expect(r).toEqual({ erro: expect.stringMatching(/Release.*CORS.*GitHub Pages/) });
    }
  });

  it('outra página do GitHub (o repositório, um commit) pede o link do arquivo', () => {
    expect(normalizarUrl('https://github.com/o/r')).toEqual({
      erro: expect.stringContaining('não um arquivo'),
    });
    expect(normalizarUrl('https://github.com/o/r/blob/main')).toEqual({
      erro: expect.stringContaining('não um arquivo'),
    });
  });

  it('o resto passa como veio', () => {
    for (const url of [
      '/exemplos/piramide.bqgame',
      RAW_PIRAMIDE,
      'https://kauemre.github.io/meu-jogo/meu-jogo.bqgame',
      'https://cdn.jsdelivr.net/gh/o/r@main/jogo.bqgame',
      'https://gist.github.com/o/abc',
    ]) {
      expect(normalizarUrl(url)).toEqual({ url });
    }
  });
});

describe('urlDoGh', () => {
  it('dono/repo@ref/caminho', () => {
    expect(urlDoGh('KaueMre/bqtable@main/public/exemplos/piramide.bqgame')).toEqual({
      url: RAW_PIRAMIDE,
    });
    expect(urlDoGh('o/r@v1.0.0/jogo.bqgame')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/v1.0.0/jogo.bqgame',
    });
  });

  it('sem @ref vale main', () => {
    expect(urlDoGh('KaueMre/bqtable/public/exemplos/piramide.bqgame')).toEqual({
      url: RAW_PIRAMIDE,
    });
  });

  it('caminho terminado em / é a pasta do jogo', () => {
    expect(urlDoGh('o/r@dev/jogos/meu/')).toEqual({
      url: 'https://raw.githubusercontent.com/o/r/dev/jogos/meu/manifest.json',
    });
  });

  it('formato errado vira mensagem com um exemplo', () => {
    for (const gh of ['', 'o/r', 'o', 'o/r@/x', 'o r/x/y']) {
      expect(urlDoGh(gh)).toEqual({ erro: expect.stringContaining('dono/repositório@ref') });
    }
  });
});
