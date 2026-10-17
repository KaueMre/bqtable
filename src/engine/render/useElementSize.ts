import { useLayoutEffect, useRef, useState } from 'react';

/** Tamanho de um elemento, acompanhando redimensionamentos. */
export function useElementSize<T extends HTMLElement>(fallback = { width: 800, height: 500 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
