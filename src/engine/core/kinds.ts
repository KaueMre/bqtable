import type { z, ZodType } from 'zod';
import {
  createPiece,
  DEFAULT_STATUS,
  type AttrValue,
  type Piece,
  type PieceInit,
  type Size,
} from './piece';
import { err, ok, type Result } from './result';

export interface KindDef {
  kind: string;
  /** Status possíveis. Sem a lista, qualquer status é aceito. */
  statuses?: readonly string[];
  /** Status ao criar a peça. Padrão: o primeiro de `statuses`, ou 'default'. */
  initialStatus?: string;
  /** Transições permitidas (de → para). Sem o mapa, vale qualquer troca entre status válidos. */
  transitions?: Readonly<Record<string, readonly string[]>>;
  /**
   * Mudanças de status que revelam informação ([de, para]; `*` = qualquer): ex. a carta comprada
   * que vira de face. Elas bloqueiam o desfazer, para ninguém "espiar" o deck e voltar.
   */
  reveals?: readonly (readonly [string, string])[];
  /**
   * Status em que a peça não mostra o que é **para ninguém** (o verso: a carta virada no deck).
   * A visão de cada jogador (`viewFor`) mostra só o verso, sem atributos, como numa área privada.
   */
  hiddenStatuses?: readonly string[];
  /** Schema dos atributos. Só valida: o valor guardado é o informado, sem transformação. */
  attributes?: ZodType<Record<string, AttrValue>>;
  /** Padrões das peças deste tipo. `faces`, `tags` e `attributes` se somam aos da peça. */
  defaults?: {
    size?: Size;
    faces?: Record<string, string>;
    tags?: readonly string[];
    attributes?: Record<string, AttrValue>;
  };
}

/** Tipo dos atributos de um kind, para o código do jogo: `KindAttributes<typeof cardKind>`. */
export type KindAttributes<D extends KindDef> = D extends { attributes: infer S extends ZodType }
  ? z.output<S>
  : Record<string, AttrValue>;

export interface KindRegistry {
  /** Lança erro se o kind já existe ou se a definição é incoerente (erro de programação). */
  register(def: KindDef): void;
  get(kind: string): KindDef | undefined;
  /** Cria a peça com os padrões do kind, validando status e atributos. */
  create(init: PieceInit): Result<Piece>;
  /** `true` ou o motivo da recusa. */
  validateStatus(piece: Piece, to: string): true | string;
  /** `true` ou o motivo da recusa. */
  validateAttr(piece: Piece, key: string, value: AttrValue): true | string;
}

export function createKindRegistry(): KindRegistry {
  const defs = new Map<string, KindDef>();

  const notRegistered = (kind: string) => `tipo "${kind}" não registrado`;

  return {
    register(def) {
      if (defs.has(def.kind)) throw new Error(`tipo "${def.kind}" já registrado`);
      checkDef(def);
      defs.set(def.kind, def);
    },

    get: (kind) => defs.get(kind),

    create(init) {
      const def = defs.get(init.kind);
      if (!def) return err(notRegistered(init.kind));
      const d = def.defaults ?? {};
      const piece = createPiece({
        ...init,
        status: init.status ?? initialStatus(def),
        size: init.size ?? d.size,
        faces: { ...d.faces, ...init.faces },
        tags: [...new Set([...(d.tags ?? []), ...(init.tags ?? [])])],
        attributes: { ...d.attributes, ...init.attributes },
      });
      if (def.statuses && !def.statuses.includes(piece.status)) {
        return err(`status "${piece.status}" não existe em "${def.kind}"`);
      }
      const attrs = validateAttributes(def, piece.attributes);
      return attrs === true ? ok(piece) : err(attrs);
    },

    validateStatus(piece, to) {
      const def = defs.get(piece.kind);
      if (!def) return notRegistered(piece.kind);
      if (to === piece.status) return true;
      if (def.statuses && !def.statuses.includes(to)) {
        return `status "${to}" não existe em "${def.kind}"`;
      }
      if (def.transitions && !(def.transitions[piece.status] ?? []).includes(to)) {
        return `"${def.kind}" não pode passar de "${piece.status}" para "${to}"`;
      }
      return true;
    },

    validateAttr(piece, key, value) {
      const def = defs.get(piece.kind);
      if (!def) return notRegistered(piece.kind);
      return validateAttributes(def, { ...piece.attributes, [key]: value });
    },
  };
}

function initialStatus(def: KindDef): string {
  return def.initialStatus ?? def.statuses?.[0] ?? DEFAULT_STATUS;
}

function validateAttributes(def: KindDef, attrs: Record<string, AttrValue>): true | string {
  if (!def.attributes) return true;
  const parsed = def.attributes.safeParse(attrs);
  if (parsed.success) return true;
  return parsed.error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ` : '') + i.message)
    .join('; ');
}

function checkDef(def: KindDef) {
  const { statuses, transitions } = def;
  if (!statuses) return;
  const known = (s: string, where: string) => {
    if (!statuses.includes(s)) throw new Error(`"${def.kind}": ${where} "${s}" fora de statuses`);
  };
  if (def.initialStatus !== undefined) known(def.initialStatus, 'initialStatus');
  for (const [from, tos] of Object.entries(transitions ?? {})) {
    known(from, 'transição de');
    for (const to of tos) known(to, 'transição para');
  }
}
