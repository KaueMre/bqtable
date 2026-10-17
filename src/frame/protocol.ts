import type { Command, GameState } from '@/engine/core';

/**
 * Mensagens entre o site e o iframe isolado que roda o jogo. O iframe tem origem opaca
 * (sandbox sem allow-same-origin): não lê cookies nem armazenamento do site, e não alcança o DOM
 * dele. O site só entrega os bytes do pacote; tudo do jogo (motor, mesa e regras.js) roda lá dentro.
 */

/** iframe → site: pronto para receber o pacote. */
export interface FrameReady {
  type: 'bq:ready';
}

/** site → iframe: o pacote a jogar. `url` é o endereço original (base para caminhos relativos). */
export interface FrameLoad {
  type: 'bq:load';
  /** Identifica este envio (o iframe ignora repetições). */
  nonce: string;
  name: string;
  bytes: ArrayBuffer;
  url?: string;
  /** Preferências do jogador guardadas pelo site (o iframe não tem onde guardar). */
  prefs?: SitePrefs;
  /** Partida em rede: a rede fica no site, e o jogo conversa com ela por `bq:net-in`/`bq:net-out`. */
  net?: FrameNet;
}

/**
 * O papel do iframe numa partida em rede. Host: a partida de verdade roda aqui, com a tela fixa no
 * assento dele. Convidado: a tela mostra o estado que o host manda, e os comandos vão para ele.
 */
export interface FrameNet {
  role: 'host' | 'guest';
  seat: string;
  /** Convidado: a partida do host (as ações do jogo dependem das opções). */
  players?: number;
  options?: Record<string, string>;
}

/** site → iframe, numa partida em rede. */
export type NetIn =
  /** host: comando de um convidado (o `actor` ainda não vale; o jogo usa o assento). */
  | { kind: 'cmd'; seat: string; cmd: Command }
  /** convidado: o estado do assento dele. */
  | { kind: 'state'; state: GameState }
  /** convidado: o host recusou um comando dele. */
  | { kind: 'rejected'; reason: string };

/** iframe → site, numa partida em rede. */
export type NetOut =
  /** host: o estado de cada assento (já sem o que o assento não vê) e as opções da partida. */
  | { kind: 'states'; states: Record<string, GameState>; options: Record<string, string> }
  /** host: o jogo recusou o comando de um convidado. */
  | { kind: 'rejected'; seat: string; reason: string }
  /** convidado: comando para o host. */
  | { kind: 'cmd'; cmd: Command };

export interface FrameNetIn {
  type: 'bq:net-in';
  nonce: string;
  msg: NetIn;
}

export interface FrameNetOut {
  type: 'bq:net-out';
  nonce: string;
  msg: NetOut;
}

/** Atalhos trocados pelo jogador: comando → combinação (`null` = sem atalho). */
export type KeyMap = Record<string, string | null>;

/** O que o site guarda: os atalhos da mesa (todos os jogos) e os das ações de cada jogo. */
export interface SitePrefs {
  keys?: KeyMap;
  games?: Record<string, { keys?: KeyMap }>;
}

/** iframe → site: o jogador mudou os atalhos; guarde (os da mesa e os deste jogo). */
export interface FramePrefs {
  type: 'bq:prefs';
  gameId: string;
  keys: KeyMap;
  gameKeys: KeyMap;
}

/** iframe → site: as combinações com atalho agora (o site repassa só estas, além do Alt e Ctrl). */
export interface FrameKeymap {
  type: 'bq:keymap';
  combos: string[];
}

/**
 * site → iframe: um atalho apertado fora do iframe (com o foco do teclado no site): o Alt
 * (preview), o Ctrl (descrição no modo compacto), Alt/Shift+Alt + número (câmeras) e as
 * combinações que o jogo avisou (`FrameKeymap`). O iframe repete a tecla dentro dele, e os atalhos
 * funcionam sem clicar no jogo antes. Outras teclas não são repassadas.
 */
export interface FrameKey {
  type: 'bq:key';
  down: boolean;
  key: string;
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
}

/** As teclas que o site repassa ao jogo (ver `FrameKey`). */
export function isTableShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>,
) {
  if (e.key === 'Alt' || e.key === 'Control') return true;
  return e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code);
}

/** iframe → site: o jogo abriu, ou não. */
export type FrameResult =
  | { type: 'bq:loaded'; nonce: string; name: string }
  | { type: 'bq:error'; nonce: string; message: string };

export type FrameMessage =
  | FrameReady
  | FrameLoad
  | FrameKey
  | FramePrefs
  | FrameKeymap
  | FrameResult
  | FrameNetIn
  | FrameNetOut;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Confere a forma do que o iframe mandou para a rede (o regras.js roda lá e pode mandar qualquer
 * coisa ao site). O conteúdo é conferido de novo por quem recebe do outro lado (`parseMessage`).
 */
export function isFrameNetOut(m: FrameMessage): m is FrameNetOut {
  const out = m as Partial<FrameNetOut>;
  if (out.type !== 'bq:net-out' || typeof out.nonce !== 'string' || !isObject(out.msg))
    return false;
  const msg = out.msg as Partial<Record<string, unknown>>;
  switch (msg.kind) {
    case 'states':
      return (
        isObject(msg.states) && Object.values(msg.states).every(isObject) && isObject(msg.options)
      );
    case 'rejected':
      return typeof msg.seat === 'string' && typeof msg.reason === 'string';
    case 'cmd':
      return isObject(msg.cmd) && typeof msg.cmd.type === 'string';
    default:
      return false;
  }
}

const COMBO = /^[A-Za-z0-9+\-=[\]`;',./\\]{1,40}$/;
const isKeyMap = (v: unknown): v is KeyMap =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length <= 300 &&
  Object.entries(v).every(
    ([k, c]) =>
      k.length <= 80 &&
      !k.startsWith('__') &&
      (c === null || (typeof c === 'string' && COMBO.test(c))),
  );
const GAME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Confere o que o iframe pediu para guardar (um pacote não pode encher o armazenamento do site). */
export function isFramePrefs(m: FrameMessage): m is FramePrefs {
  const p = m as Partial<FramePrefs>;
  return (
    p.type === 'bq:prefs' &&
    typeof p.gameId === 'string' &&
    GAME_ID.test(p.gameId) &&
    isKeyMap(p.keys) &&
    isKeyMap(p.gameKeys)
  );
}

export function isFrameKeymap(m: FrameMessage): m is FrameKeymap {
  const k = m as Partial<FrameKeymap>;
  return (
    k.type === 'bq:keymap' &&
    Array.isArray(k.combos) &&
    k.combos.length <= 300 &&
    k.combos.every((c) => typeof c === 'string' && COMBO.test(c))
  );
}

/** Quantos jogos o site guarda (os mais recentes) e o tamanho máximo do que guarda. */
const MAX_GAMES = 50;
const MAX_BYTES = 256 * 1024;

/** O que veio do armazenamento do site, sem o que não for válido (versão antiga, editado à mão). */
export function cleanPrefs(value: unknown): SitePrefs {
  if (typeof value !== 'object' || value === null) return {};
  const { keys, games } = value as SitePrefs;
  const out: SitePrefs = {};
  if (isKeyMap(keys)) out.keys = keys;
  if (typeof games === 'object' && games !== null) {
    const kept = Object.entries(games).filter(
      ([id, g]) => GAME_ID.test(id) && typeof g === 'object' && g !== null && isKeyMap(g.keys),
    );
    if (kept.length) out.games = Object.fromEntries(kept);
  }
  return out;
}

/**
 * Junta o que o iframe mandou guardar (`FramePrefs`) ao que o site já tem. O jogo mais recente vai
 * para o fim; passando do limite, saem os mais antigos. `null` se ficar grande demais.
 */
export function mergePrefs(current: SitePrefs, msg: FramePrefs): SitePrefs | null {
  const games = { ...current.games };
  delete games[msg.gameId];
  if (Object.keys(msg.gameKeys).length) games[msg.gameId] = { keys: msg.gameKeys };
  const ids = Object.keys(games);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_GAMES))) delete games[id];
  const next: SitePrefs = { ...current, keys: msg.keys, games };
  return JSON.stringify(next).length <= MAX_BYTES ? next : null;
}

export const FRAME_URL = '/frame.html';
/**
 * Permissões do iframe: só scripts. Sem allow-same-origin (origem opaca), formulários ou pop-ups.
 * Fora do sandbox, o iframe também tem `allow="fullscreen"` (o botão de tela cheia do jogo).
 */
export const FRAME_SANDBOX = 'allow-scripts';

export function isFrameMessage(data: unknown): data is FrameMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('bq:')
  );
}
