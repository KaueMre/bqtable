import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameFolder } from '@/engine/testing';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function jogo(data: object, files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'bqgame-'));
  dirs.push(dir);
  const all = {
    'manifest.json': {
      format: 'bqgame/1',
      id: 'd',
      name: 'D',
      kinds: [{ kind: 'k' }],
      setup: [],
      data,
    },
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(content));
  }
  return loadGameFolder(dir);
}

const cartas = {
  mindset: [{ id: 'm1', cor: 'vermelho', custo: 1 }],
  bases: [
    { id: 'b1', cor: 'azul', custo: 0 },
    { id: 'b2', cor: 'roxo', custo: '2' },
  ],
};

const schema = {
  type: 'object',
  required: ['cor', 'custo'],
  properties: {
    cor: { enum: ['vermelho', 'azul', 'verde', 'amarelo'] },
    custo: { type: 'integer', minimum: 0 },
  },
};

describe('conjuntos de dados: lista dentro do arquivo (path) e schema', () => {
  it('path pega uma das listas de um JSON com várias', async () => {
    const game = await jogo(
      {
        mindset: { file: 'data/cartas.json', path: 'mindset' },
        bases: { file: 'data/cartas.json', path: 'bases' },
      },
      { 'data/cartas.json': cartas },
    );
    expect(game.data.mindset!.map((c) => c.id)).toEqual(['m1']);
    expect(game.data.bases!.map((c) => c.id)).toEqual(['b1', 'b2']);
  });

  it('path que não existe é acusado', async () => {
    await expect(
      jogo({ x: { file: 'data/cartas.json', path: 'nada' } }, { 'data/cartas.json': cartas }),
    ).rejects.toThrow('dados "x" (data/cartas.json → nada): "nada" não existe no arquivo');
  });

  it('schema: o erro aponta o item e o campo', async () => {
    const erro = jogo(
      { bases: { file: 'data/cartas.json', path: 'bases', schema } },
      { 'data/cartas.json': cartas },
    );
    await expect(erro).rejects.toThrow(/não bate com o schema/);
    await expect(erro).rejects.toThrow(/bases\[1\]\.cor: /);
    await expect(erro).rejects.toThrow(/bases\[1\]\.custo: /);
    const ok = await jogo(
      { mindset: { file: 'data/cartas.json', path: 'mindset', schema } },
      { 'data/cartas.json': cartas },
    );
    expect(ok.data.mindset).toHaveLength(1);
  });

  it('schema inválido é acusado', async () => {
    await expect(
      jogo(
        {
          m: { file: 'data/cartas.json', path: 'mindset', schema: { type: 'tipo-que-nao-existe' } },
        },
        { 'data/cartas.json': cartas },
      ),
    ).rejects.toThrow('schema não é um JSON Schema válido');
  });
});
