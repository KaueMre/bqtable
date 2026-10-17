import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MenuItem } from '../types';

const WIDTH = 220;
const ROW = 30;
const MAX_HEIGHT = 360;

/**
 * Menu do botão direito: abre no ponto do clique (sem sair da mesa) e fecha com Esc, com um
 * clique fora ou ao escolher. Itens com `children` abrem um segundo nível ao passar o mouse.
 */
export function ContextMenu({
  x,
  y,
  items,
  bounds,
  onClose,
}: {
  x: number;
  y: number;
  items: readonly MenuItem[];
  bounds: { width: number; height: number };
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose]);
  // dentro da mesa: perto da borda, abre para o outro lado
  const left = x + WIDTH > bounds.width ? Math.max(0, x - WIDTH) : x;
  const top = Math.max(0, Math.min(y, bounds.height - items.length * ROW - 12));
  const flip = left + WIDTH * 2 > bounds.width;
  return (
    <div ref={box} style={{ ...rootStyle, left, top }}>
      <Menu
        items={items}
        onClose={onClose}
        flip={flip}
        label="Ações da peça"
        top={top}
        height={bounds.height}
      />
    </div>
  );
}

/**
 * Uma lista do menu. O segundo nível fica ao lado da lista, fora dela: a lista rola (menus
 * compridos), e o que sai de uma área com rolagem é cortado.
 */
function Menu({
  items,
  onClose,
  flip,
  label,
  top,
  height,
  maxHeight = MAX_HEIGHT,
}: {
  items: readonly MenuItem[];
  onClose: () => void;
  /** Segundo nível abre à esquerda (sem espaço à direita). */
  flip: boolean;
  label: string;
  /** Onde esta lista começa e a altura da mesa (px): o segundo nível cabe nela. */
  top: number;
  height: number;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState<{ index: number; y: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const openAt = (index: number, li: HTMLElement) =>
    setOpen({ index, y: li.offsetTop - (list.current?.scrollTop ?? 0) });
  const sub = open ? items[open.index]?.children : undefined;
  // o segundo nível: alinhado ao item; se não couber embaixo, sobe (sem passar do topo da mesa)
  let subTop = 0;
  let subMax = MAX_HEIGHT;
  if (open && sub) {
    const want = Math.min(sub.length * ROW + 8, MAX_HEIGHT);
    const at = top + open.y - 4; // na mesa
    const shifted = Math.max(8, Math.min(at, height - 8 - want));
    subTop = shifted - top;
    subMax = Math.max(ROW * 3, height - 8 - shifted);
  }
  return (
    <div style={{ position: 'relative' }}>
      <ul ref={list} role="menu" aria-label={label} style={{ ...listStyle, maxHeight }}>
        {items.map((item, i) =>
          item.separator ? (
            <li key={i} role="separator" style={separatorStyle} />
          ) : (
            <li
              key={i}
              onMouseEnter={(e) => (item.children ? openAt(i, e.currentTarget) : setOpen(null))}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup={item.children ? 'menu' : undefined}
                aria-expanded={item.children ? open?.index === i : undefined}
                disabled={!!item.disabled}
                title={typeof item.disabled === 'string' ? item.disabled : undefined}
                style={buttonStyle}
                onClick={(e) => {
                  if (item.children) {
                    // o hover já abre; o clique (ou toque) garante
                    openAt(i, e.currentTarget.parentElement as HTMLElement);
                    return;
                  }
                  item.onSelect?.();
                  onClose();
                }}
              >
                <span>{item.label}</span>
                {item.children && <span aria-hidden>▸</span>}
              </button>
            </li>
          ),
        )}
      </ul>
      {open && sub && (
        <div style={{ position: 'absolute', top: subTop, [flip ? 'right' : 'left']: '100%' }}>
          <Menu
            items={sub}
            onClose={onClose}
            flip={flip}
            label={items[open.index]!.label}
            top={top + subTop}
            height={height}
            maxHeight={subMax}
          />
        </div>
      )}
    </div>
  );
}

const rootStyle: CSSProperties = { position: 'absolute', zIndex: 4 };

const listStyle: CSSProperties = {
  width: WIDTH,
  margin: 0,
  padding: 4,
  overflowY: 'auto',
  listStyle: 'none',
  borderRadius: 8,
  background: '#fff',
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
  font: '13px system-ui, sans-serif',
};

const buttonStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
  minHeight: ROW,
  padding: '6px 8px',
  lineHeight: 1.3,
  gap: 8,
  border: 0,
  borderRadius: 6,
  background: 'none',
  color: '#1f2328',
  font: 'inherit',
  textAlign: 'left',
  alignItems: 'center',
  cursor: 'pointer',
};

const separatorStyle: CSSProperties = { height: 1, margin: '4px 0', background: '#d0d7de' };
