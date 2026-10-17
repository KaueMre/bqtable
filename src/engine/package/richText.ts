/**
 * Texto rico das descrições e palavras-chave: HTML limitado (negrito, itálico, listas, cor,
 * imagens do pacote) e atalhos de palavra-chave:
 *
 * - `[[block]]` → a palavra-chave "block", com o título dela;
 * - `[[block|bloqueia]]` → a palavra-chave "block", com outro texto;
 * - `<kw ref="block">bloqueia</kw>` → o mesmo, em HTML.
 *
 * O resto do HTML é filtrado: só as tags e os estilos da lista passam (sem scripts, eventos nem
 * links). Roda dentro do iframe isolado do jogo; o filtro deixa o resultado previsível.
 */

export interface Keyword {
  title: string;
  /** Texto rico (pode citar outras palavras-chave). */
  text: string;
}

/** Nó do texto já filtrado. */
export type RichNode =
  | string
  | { kw: string; children: RichNode[] }
  | {
      tag: string;
      attrs: Record<string, string>;
      style: Record<string, string>;
      children: RichNode[];
    };

const SHORTCUT = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
const KW_TAG = /<kw\s+ref\s*=\s*["']([^"']+)["']/gi;

const TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'br',
  'p',
  'div',
  'span',
  'small',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'img',
]);
/** Somem com o conteúdo. */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript']);
const STYLES = [
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'text-decoration',
  'text-align',
];

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Palavras-chave citadas no texto, na ordem, sem repetir. */
export function keywordRefs(html: string): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    const k = id.trim();
    if (k && !ids.includes(k)) ids.push(k);
  };
  for (const m of html.matchAll(SHORTCUT)) add(m[1]!);
  for (const m of html.matchAll(KW_TAG)) add(m[1]!);
  return ids;
}

/** `[[id]]` e `[[id|texto]]` → `<kw ref="id">texto</kw>` (o texto padrão é o título). */
export function expandKeywordLinks(html: string, keywords: Record<string, Keyword>): string {
  return html.replace(SHORTCUT, (_, id: string, text?: string) => {
    const k = id.trim();
    const label = text ?? keywords[k]?.title ?? k;
    return `<kw ref="${escape(k)}">${escape(label)}</kw>`;
  });
}

/**
 * Palavras-chave para mostrar junto do texto: as citadas nele e as citadas dentro delas (em
 * ordem de aparição, sem repetir, até `limit`). Ids desconhecidos ficam de fora.
 */
export function collectKeywords(
  html: string,
  keywords: Record<string, Keyword>,
  limit = 8,
): string[] {
  const out: string[] = [];
  const queue = keywordRefs(html);
  while (queue.length > 0 && out.length < limit) {
    const id = queue.shift()!;
    if (out.includes(id) || !keywords[id]) continue;
    out.push(id);
    queue.push(...keywordRefs(keywords[id].text));
  }
  return out;
}

/**
 * HTML (com os atalhos já expandidos) → nós filtrados. Imagens com caminho relativo passam por
 * `resolveAsset` (arquivos do pacote).
 */
export function parseRich(html: string, resolveAsset?: (src: string) => string): RichNode[] {
  if (typeof DOMParser === 'undefined') return [html.replace(/<[^>]*>/g, '')];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return walk(doc.body.childNodes, resolveAsset);
}

function walk(list: NodeListOf<ChildNode>, resolveAsset?: (src: string) => string): RichNode[] {
  const out: RichNode[] = [];
  for (const node of list) {
    if (node.nodeType === 3) {
      out.push(node.textContent ?? '');
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const children = walk(el.childNodes, resolveAsset);
    if (tag === 'kw') {
      const ref = el.getAttribute('ref')?.trim();
      out.push(ref ? { kw: ref, children } : { tag: 'span', attrs: {}, style: {}, children });
      continue;
    }
    if (!TAGS.has(tag)) {
      out.push(...children); // tag desconhecida: fica só o conteúdo
      continue;
    }
    const attrs: Record<string, string> = {};
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      if (!src || /^javascript:/i.test(src)) continue;
      attrs.src = /^(https?:|data:image\/|blob:)/i.test(src) ? src : (resolveAsset?.(src) ?? src);
      attrs.alt = el.getAttribute('alt') ?? '';
      for (const a of ['width', 'height']) {
        const v = el.getAttribute(a);
        if (v && /^\d+(\.\d+)?$/.test(v)) attrs[a] = v;
      }
    }
    const style: Record<string, string> = {};
    const css = (el as HTMLElement).style;
    if (css) {
      for (const prop of STYLES) {
        const v = css.getPropertyValue(prop);
        if (v && !/url\(|expression/i.test(v)) style[prop] = v;
      }
    }
    out.push({ tag, attrs, style, children });
  }
  return out;
}
