import { useEffect, useRef } from 'react';
import { HUD_PANELS } from './hud';

/**
 * Atalhos de teclado configuráveis (como no VS Code). Uma combinação é um texto normalizado:
 * os modificadores em ordem fixa e a tecla, por exemplo "Alt+Shift+T", "Ctrl+1", "G".
 *
 * A tecla vem da posição física (`KeyboardEvent.code`): no Mac, Alt+T digita "†", mas o atalho
 * continua sendo Alt+T.
 */
export type Combo = string;

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const;

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** Nome da tecla (sem modificadores), ou `null` se for só um modificador. */
export function keyName(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (NAMED[code]) return NAMED[code]!;
  if (
    /^(Shift|Control|Alt|Meta|OS|CapsLock|Fn)/.test(code) ||
    /^(Shift|Control|Alt|Meta)$/.test(key)
  ) {
    return null;
  }
  if (key && key.length === 1) return key.toUpperCase();
  return code || null;
}

type KeyEventLike = Pick<
  KeyboardEvent,
  'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

/** A combinação de um evento de teclado, ou `null` (só um modificador apertado). */
export function comboOf(e: KeyEventLike): Combo | null {
  const key = keyName(e.code, e.key);
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Cmd'];
  return [...mods.filter(Boolean), key].join('+');
}

const ALIASES: Record<string, (typeof MODIFIERS)[number]> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
  win: 'Cmd',
};

/** Texto escrito à mão ("shift+alt+t") → combinação normalizada ("Alt+Shift+T"), ou `null`. */
export function normalizeCombo(text: string): Combo | null {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const mods = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const mod = ALIASES[part.toLowerCase()];
    if (mod) mods.add(mod);
    else if (key === null) key = part.length === 1 ? part.toUpperCase() : part;
    else return null; // duas teclas que não são modificadores
  }
  if (!key) return null;
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

/** Combinações que o navegador não deixa usar, ou que já têm função no jogo. */
const RESERVED: Record<Combo, string> = {
  'Ctrl+W': 'fecha a aba do navegador',
  'Ctrl+T': 'abre aba no navegador',
  'Ctrl+N': 'abre janela no navegador',
  'Ctrl+Q': 'fecha o navegador',
  'Ctrl+Tab': 'troca de aba no navegador',
  'Cmd+W': 'fecha a aba do navegador',
  'Cmd+T': 'abre aba no navegador',
  'Cmd+N': 'abre janela no navegador',
  'Cmd+Q': 'fecha o navegador',
  'Cmd+H': 'esconde o navegador',
  'Cmd+M': 'minimiza o navegador',
  Escape: 'fecha menus e sai da tela cheia',
  Enter: 'confirma',
  Tab: 'passa o foco entre os botões',
};

/** `true`, ou o motivo de a combinação não poder ser usada. */
export function checkCombo(combo: Combo): true | string {
  return RESERVED[combo] ? `reservada: ${RESERVED[combo]}` : true;
}

/** Comando que pode ter atalho. */
export interface KeyCommand {
  id: string;
  label: string;
  /** Grupo na lista (Mesa, Câmeras, Jogo…). */
  group: string;
  /** Atalho de fábrica. */
  defaultKey?: Combo | null;
}

/** Os comandos da mesa (os mesmos para todos os jogos), com os atalhos de fábrica de hoje. */
export function builtinCommands(): KeyCommand[] {
  const hud = HUD_PANELS.map((p): KeyCommand => ({
    id: `hud:${p.id}`,
    label: `Mostrar ou esconder: ${p.label}${p.scope === 'fullscreen' ? ' (tela cheia)' : ''}`,
    group: 'HUD',
    defaultKey: p.key.toUpperCase(),
  }));
  const cameras = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n): KeyCommand[] => [
    {
      id: `camera:save:${n}`,
      label: `Guardar a câmera ${n}`,
      group: 'Câmeras',
      defaultKey: `Alt+Shift+${n}`,
    },
    {
      id: `camera:load:${n}`,
      label: `Voltar à câmera ${n}`,
      group: 'Câmeras',
      defaultKey: `Alt+${n}`,
    },
  ]);
  const table: KeyCommand[] = [
    { id: 'undo', label: 'Desfazer', group: 'Mesa' },
    { id: 'pass', label: 'Passar a vez', group: 'Mesa' },
    { id: 'fit', label: 'Centralizar (enquadrar a mesa)', group: 'Mesa' },
    { id: 'fullscreen', label: 'Entrar ou sair da tela cheia', group: 'Mesa' },
    { id: 'settings', label: 'Abrir as configurações', group: 'Mesa' },
  ];
  return [...table, ...hud, ...cameras];
}

/** O que o jogador mudou: comando → combinação (ou `null`, sem atalho). */
export type KeyOverrides = Record<string, Combo | null>;

/** Atalhos do jogador: os da mesa (valem em todos os jogos) e os das ações deste jogo. */
export interface KeyPrefs {
  global: KeyOverrides;
  game: KeyOverrides;
}

/**
 * Atalho de cada comando: o do jogador, ou o de fábrica. Uma combinação vale para um comando só:
 * se repetir (um padrão do jogo igual a um da mesa, por exemplo), fica com o primeiro da lista.
 */
export function resolveBindings(
  commands: readonly KeyCommand[],
  overrides: KeyOverrides,
): Map<string, Combo | null> {
  const out = new Map<string, Combo | null>();
  const taken = new Set<Combo>();
  // primeiro os escolhidos pelo jogador (valem mais que os de fábrica), depois os padrões
  for (const c of commands) {
    if (!(c.id in overrides)) continue;
    const combo = overrides[c.id] ?? null;
    if (combo && taken.has(combo)) {
      out.set(c.id, null);
      continue;
    }
    if (combo) taken.add(combo);
    out.set(c.id, combo);
  }
  for (const c of commands) {
    if (out.has(c.id)) continue;
    const combo = c.defaultKey ?? null;
    const ok = combo && !taken.has(combo) && checkCombo(combo) === true;
    if (ok) taken.add(combo);
    out.set(c.id, ok ? combo : null);
  }
  return out;
}

/** Tecla digitada num campo de texto não é atalho. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

/**
 * Escuta o teclado e roda o comando do atalho apertado. Fora de campos de texto, sem repetição
 * (segurar a tecla roda uma vez).
 */
export function useKeybindings(
  bindings: ReadonlyMap<string, Combo | null>,
  run: (command: string) => void,
  active = true,
) {
  const latest = useRef({ bindings, run });
  useEffect(() => {
    latest.current = { bindings, run };
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e.target)) return;
      const combo = comboOf(e);
      if (!combo) return;
      for (const [command, c] of latest.current.bindings) {
        if (c !== combo) continue;
        e.preventDefault();
        latest.current.run(command);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
