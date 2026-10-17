import { describe, expect, it } from 'vitest';
import {
  builtinCommands,
  checkCombo,
  comboOf,
  normalizeCombo,
  resolveBindings,
  type KeyCommand,
} from './keys';

const tecla = (
  code: string,
  key: string,
  mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {},
) =>
  comboOf({
    code,
    key,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    metaKey: !!mods.meta,
  });

describe('combinações de teclas', () => {
  it('pela tecla física, com os modificadores em ordem fixa', () => {
    expect(tecla('KeyT', '†', { alt: true, shift: true })).toBe('Alt+Shift+T'); // Mac: Alt+T digita †
    expect(tecla('Digit1', '!', { shift: true })).toBe('Shift+1');
    expect(tecla('KeyK', 'k', { meta: true, ctrl: true })).toBe('Ctrl+Cmd+K');
    expect(tecla('F5', 'F5')).toBe('F5');
    expect(tecla('ArrowUp', 'ArrowUp', { alt: true })).toBe('Alt+Up');
    expect(tecla('AltLeft', 'Alt', { alt: true })).toBeNull(); // só o modificador
    expect(tecla('', 'j')).toBe('J'); // sem code (eventos sintéticos): pela letra
  });

  it('texto escrito à mão vira a forma normal', () => {
    expect(normalizeCombo('shift+alt+t')).toBe('Alt+Shift+T');
    expect(normalizeCombo('Option + E')).toBe('Alt+E');
    expect(normalizeCombo('cmd+k')).toBe('Cmd+K');
    expect(normalizeCombo('g')).toBe('G');
    expect(normalizeCombo('a+b')).toBeNull();
    expect(normalizeCombo('ctrl+shift')).toBeNull();
  });

  it('reservadas: as do navegador e as que já têm função', () => {
    expect(checkCombo('Cmd+W')).toMatch(/reservada/);
    expect(checkCombo('Escape')).toMatch(/reservada/);
    expect(checkCombo('Alt+Shift+T')).toBe(true);
  });
});

describe('atalhos de cada comando', () => {
  const comandos: KeyCommand[] = [
    { id: 'hud:guides', label: 'Contornos', group: 'HUD', defaultKey: 'G' },
    { id: 'undo', label: 'Desfazer', group: 'Mesa' },
    { id: 'game:terminar', label: 'Terminar', group: 'Jogo', defaultKey: 'E' },
    { id: 'game:outra', label: 'Outra', group: 'Jogo', defaultKey: 'G' }, // padrão repetido
  ];

  it('padrões; repetido fica com o primeiro', () => {
    const b = resolveBindings(comandos, {});
    expect(Object.fromEntries(b)).toEqual({
      'hud:guides': 'G',
      undo: null,
      'game:terminar': 'E',
      'game:outra': null,
    });
  });

  it('o do jogador vale mais que o padrão; null tira o atalho', () => {
    const b = resolveBindings(comandos, { undo: 'G', 'game:terminar': null });
    expect(b.get('undo')).toBe('G');
    expect(b.get('hud:guides')).toBeNull(); // o G agora é do Desfazer
    expect(b.get('game:terminar')).toBeNull();
  });

  it('os da mesa: os atalhos de hoje continuam os padrões', () => {
    const b = resolveBindings(builtinCommands(), {});
    expect(b.get('hud:guides')).toBe('G');
    expect(b.get('hud:players')).toBe('J');
    expect(b.get('camera:save:3')).toBe('Alt+Shift+3');
    expect(b.get('camera:load:3')).toBe('Alt+3');
    expect(b.get('undo')).toBeNull(); // novos, sem atalho de fábrica
  });
});
