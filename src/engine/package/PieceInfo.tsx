import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { collectKeywords, parseRich, type Keyword, type RichNode } from './richText';

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const VOID = new Set(['br', 'hr', 'img']);

function toReact(
  nodes: RichNode[],
  keywords: Record<string, Keyword>,
  onKeyword?: (id: string) => void,
): ReactNode[] {
  return nodes.map((n, i) => {
    if (typeof n === 'string') return n;
    if ('kw' in n) {
      const known = !!keywords[n.kw];
      return (
        <span
          key={i}
          className={known ? 'bq-kw' : 'bq-kw bq-kw--unknown'}
          data-kw={n.kw}
          onMouseEnter={known ? () => onKeyword?.(n.kw) : undefined}
        >
          {toReact(n.children, keywords, onKeyword)}
        </span>
      );
    }
    const style = Object.fromEntries(
      Object.entries(n.style).map(([k, v]) => [camel(k), v]),
    ) as CSSProperties;
    const props = { key: i, ...n.attrs, ...(Object.keys(style).length && { style }) };
    return VOID.has(n.tag)
      ? createElement(n.tag, props)
      : createElement(n.tag, props, ...toReact(n.children, keywords, onKeyword));
  });
}

/** Texto rico (HTML limitado + palavras-chave), já filtrado. */
export function RichText({
  html,
  keywords,
  resolveAsset,
  onKeyword,
}: {
  html: string;
  keywords: Record<string, Keyword>;
  resolveAsset?: (src: string) => string;
  /** O mouse passou sobre uma palavra-chave do texto. */
  onKeyword?: (id: string) => void;
}) {
  const nodes = useMemo(() => parseRich(html, resolveAsset), [html, resolveAsset]);
  return <>{toReact(nodes, keywords, onKeyword)}</>;
}

/**
 * Descrição de uma peça e as palavras-chave dela, como no Slay the Spire: caixas das palavras-chave
 * em cima, a descrição embaixo. `all`: todas as palavras-chave (as citadas e as citadas dentro
 * delas). `hover`: só as que o mouse aponta no texto (e, dentro delas, a próxima, em cadeia).
 */
export function PieceInfo({
  html,
  keywords,
  resolveAsset,
  mode,
}: {
  html?: string;
  keywords: Record<string, Keyword>;
  resolveAsset?: (src: string) => string;
  mode: 'all' | 'hover';
}) {
  const [chain, setChain] = useState<string[]>([]);
  const shown = mode === 'all' ? collectKeywords(html ?? '', keywords) : chain;
  // sair do bloco limpa a cadeia um instante depois (cruzar o vão entre as caixas não limpa)
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  return (
    <div
      className="bq-info"
      onMouseEnter={() => clearTimeout(leaving.current)}
      onMouseLeave={() => {
        leaving.current = setTimeout(() => setChain([]), 200);
      }}
    >
      {shown.map((id, i) => (
        <div key={id} className="bq-kw-box" role="note" aria-label={keywords[id]!.title}>
          <strong>{keywords[id]!.title}</strong>
          <div>
            <RichText
              html={keywords[id]!.text}
              keywords={keywords}
              resolveAsset={resolveAsset}
              onKeyword={(k) => {
                clearTimeout(leaving.current);
                if (mode === 'hover') setChain([...chain.slice(0, i + 1), k]);
              }}
            />
          </div>
        </div>
      ))}
      {html && (
        <div className="bq-desc" role="note" aria-label="Descrição">
          <RichText
            html={html}
            keywords={keywords}
            resolveAsset={resolveAsset}
            onKeyword={(k) => {
              clearTimeout(leaving.current);
              if (mode === 'hover') setChain([k]);
            }}
          />
        </div>
      )}
    </div>
  );
}
