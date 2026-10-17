/**
 * Preenche `{campo}` em textos (e, em profundidade, em objetos e listas):
 *
 * - `{nome}` / `{custo.Traço}`: valor do campo (caminho com pontos);
 * - `{elemento|cores}`: passa o valor pela tabela `cores` (manifest.lookups);
 * - `{nivel|repeat:●}`: repete o texto `nivel` vezes;
 * - `{extra|default:—}`: usa o padrão se o campo estiver vazio (`default:0` é número).
 *
 * Um marcador sozinho no texto mantém o tipo do valor (`"{copias}"` vira número).
 */

export type Scope = Record<string, unknown>;

export interface InterpolateOptions {
  lookups?: Record<string, Record<string, string>>;
  /** Campo inexistente: erro (setup) ou texto vazio (modelos de carta, campos opcionais). */
  strict?: boolean;
}

const MARK = /\{([^{}|]+)(?:\|([^{}]+))?\}/g;
const ONLY = /^\{([^{}|]+)(?:\|([^{}]+))?\}$/;

export class InterpolationError extends Error {
  name = 'InterpolationError';
}

function read(scope: Scope, path: string): { found: boolean; value: unknown } {
  let value: unknown = scope;
  for (const key of path.trim().split('.')) {
    if (value === null || typeof value !== 'object' || !(key in value)) {
      return { found: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}

function resolve(path: string, filter: string | undefined, scope: Scope, o: InterpolateOptions) {
  const { found, value } = read(scope, path);
  if (!filter) {
    if (!found && o.strict) throw new InterpolationError(`campo desconhecido: {${path}}`);
    return value;
  }
  const sep = filter.indexOf(':');
  const name = (sep < 0 ? filter : filter.slice(0, sep)).trim();
  const arg = sep < 0 ? undefined : filter.slice(sep + 1);
  const empty = value === undefined || value === null || value === '';
  switch (name) {
    case 'default':
      return empty ? literal(arg ?? '') : value;
    case 'repeat':
      return (arg ?? '').repeat(Math.max(0, Math.floor(Number(value) || 0)));
    case 'upper':
      return empty ? '' : String(value).toUpperCase();
    default: {
      const table = o.lookups?.[name];
      if (!table) throw new InterpolationError(`tabela desconhecida: |${name}`);
      if (empty) return '';
      return table[String(value)] ?? arg ?? '';
    }
  }
}

/** Padrão escrito no texto: número e true/false mantêm o tipo (`{rotacao|default:0}` → 0). */
function literal(arg: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(arg.trim())) return Number(arg);
  if (arg === 'true' || arg === 'false') return arg === 'true';
  return arg;
}

const text = (v: unknown) =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function interpolate<T>(value: T, scope: Scope, o: InterpolateOptions = {}): T {
  if (typeof value === 'string') {
    const only = ONLY.exec(value);
    if (only) return resolve(only[1]!, only[2], scope, o) as T;
    return value.replace(MARK, (_, path: string, filter?: string) =>
      text(resolve(path, filter, scope, o)),
    ) as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, scope, o)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, scope, o)]),
    ) as T;
  }
  return value;
}

/** Texto preenchido é "verdadeiro"? (vazio, "0", "false" e "null" não são.) */
export function truthy(v: unknown): boolean {
  const s = text(v).trim();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'null';
}
