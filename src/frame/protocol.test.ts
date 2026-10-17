import { describe, expect, it } from 'vitest';
import { cleanPrefs, isFrameKeymap, isFramePrefs, mergePrefs, type FramePrefs } from './protocol';

const prefs = (gameId: string, gameKeys: FramePrefs['gameKeys'] = {}): FramePrefs => ({
  type: 'bq:prefs',
  gameId,
  keys: {},
  gameKeys,
});

describe('preferências guardadas pelo site', () => {
  it('confere o que o iframe pede para guardar', () => {
    expect(isFramePrefs(prefs('eternal-decks', { 'game:alpha': 'Alt+Shift+A' }))).toBe(true);
    expect(isFramePrefs(prefs('__proto__'))).toBe(false);
    expect(isFramePrefs(prefs('ok', { 'game:x': 'Alt+<script>' }))).toBe(false);
    expect(isFramePrefs(prefs('ok', { __proto__x: 'X' }))).toBe(false);
    const muitas = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`c${i}`, 'X']));
    expect(isFramePrefs(prefs('ok', muitas))).toBe(false);
    expect(isFrameKeymap({ type: 'bq:keymap', combos: ['G', 'Alt+1'] })).toBe(true);
    expect(isFrameKeymap({ type: 'bq:keymap', combos: [1] as unknown as string[] })).toBe(false);
  });

  it('o jogo mais recente vai para o fim; passando de 50, saem os mais antigos', () => {
    let atual = {};
    for (let i = 0; i < 52; i++) atual = mergePrefs(atual, prefs(`jogo-${i}`, { 'game:a': 'A' }))!;
    atual = mergePrefs(atual, prefs('jogo-2', { 'game:a': 'B' }))!;
    const ids = Object.keys(cleanPrefs(atual).games!);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe('jogo-3');
    expect(ids.at(-1)).toBe('jogo-2');
    // sem atalhos trocados, o jogo sai da lista
    expect(mergePrefs(atual, prefs('jogo-2'))!.games).not.toHaveProperty('jogo-2');
  });

  it('o que veio do armazenamento: só o que for válido', () => {
    expect(cleanPrefs(null)).toEqual({});
    expect(cleanPrefs('x')).toEqual({});
    expect(
      cleanPrefs({
        keys: { 'hud:log': 'Alt+L', 'hud:info': null },
        games: { tatto: { keys: { 'game:fim': 'E' } }, ruim: { keys: 3 }, 'x y': { keys: {} } },
      }),
    ).toEqual({
      keys: { 'hud:log': 'Alt+L', 'hud:info': null },
      games: { tatto: { keys: { 'game:fim': 'E' } } },
    });
  });
});
