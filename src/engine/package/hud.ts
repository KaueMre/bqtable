import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Itens da HUD que o jogador pode esconder: os painéis da tela cheia e as camadas da mesa. */
export type HudPanel =
  'players' | 'info' | 'details' | 'log' | 'preview' | 'rules' | 'tips' | 'guides';

/** Modo de um painel. `compact` é opcional: só os painéis que têm uma versão resumida. */
export type HudMode = 'hidden' | 'compact' | 'full';

export interface HudPanelDef {
  id: HudPanel;
  label: string;
  /** Atalho de fábrica que troca o modo (configurável; os painéis só valem na tela cheia). */
  key: string;
  /** Modos possíveis, na ordem em que o clique (ou a tecla) passa por eles. */
  modes: readonly HudMode[];
  /**
   * 'fullscreen': painel que só existe na tela cheia (fora dela, o painel lateral mostra tudo).
   * 'table': camada da mesa, vale nos dois modos (e a tecla também).
   */
  scope: 'fullscreen' | 'table';
}

export const HUD_PANELS: readonly HudPanelDef[] = [
  { id: 'players', label: 'Jogadores', key: 'j', modes: ['full', 'hidden'], scope: 'fullscreen' },
  { id: 'info', label: 'Info do jogo', key: 'i', modes: ['full', 'hidden'], scope: 'fullscreen' },
  {
    id: 'details',
    label: 'Detalhe da peça',
    key: 'd',
    modes: ['full', 'hidden'],
    scope: 'fullscreen',
  },
  { id: 'log', label: 'Log', key: 'l', modes: ['full', 'hidden'], scope: 'fullscreen' },
  { id: 'preview', label: 'Preview (Alt)', key: 'v', modes: ['full', 'hidden'], scope: 'table' },
  {
    // completo: sempre; compacto: com Ctrl; oculto: só com o preview fixo e o mouse sobre ele
    id: 'rules',
    label: 'Descrição e palavras-chave',
    key: 'k',
    modes: ['full', 'compact', 'hidden'],
    scope: 'table',
  },
  {
    id: 'tips',
    label: 'Dica ao lado da peça',
    key: 't',
    modes: ['full', 'hidden'],
    scope: 'table',
  },
  {
    id: 'guides',
    label: 'Contornos das zonas',
    key: 'g',
    modes: ['full', 'hidden'],
    scope: 'table',
  },
];

export const HUD_MODE_LABEL: Record<HudMode, string> = {
  hidden: 'oculto',
  compact: 'compacto',
  full: 'completo',
};

export type HudModes = Record<HudPanel, HudMode>;

const INITIAL: HudModes = {
  players: 'full',
  info: 'full',
  details: 'full',
  log: 'full',
  preview: 'full',
  rules: 'full',
  tips: 'full',
  guides: 'full',
};

/**
 * Modos dos itens da HUD. `cycle` passa o item para o próximo modo (os atalhos de teclado chamam
 * o mesmo, pela lista de atalhos: `keys.ts`).
 */
export function useHudModes(initial: Partial<HudModes> = {}) {
  const [modes, setModes] = useState<HudModes>(() => ({ ...INITIAL, ...initial }));
  const cycle = useCallback((id: HudPanel) => {
    const def = HUD_PANELS.find((p) => p.id === id)!;
    setModes((m) => {
      const i = def.modes.indexOf(m[id]);
      return { ...m, [id]: def.modes[(i + 1) % def.modes.length]! };
    });
  }, []);
  return { modes, cycle };
}

/**
 * Tela cheia do elemento: pede ao navegador (Fullscreen API). Se o navegador recusar (ou não
 * houver a API), o elemento ocupa ao menos toda a janela, pelo CSS do modo. Esc (do navegador)
 * também sai.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [full, setFull] = useState(false);
  const real = useRef(false);
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement && document.fullscreenElement === ref.current;
      if (on) {
        real.current = true;
        setFull(true);
      } else if (real.current) {
        real.current = false; // saiu pelo navegador (Esc)
        setFull(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);
  const enter = useCallback(() => {
    setFull(true);
    const el = ref.current;
    if (el && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen().catch(() => {
        /* sem permissão: fica a tela cheia dentro da janela */
      });
    }
  }, [ref]);
  const exit = useCallback(() => {
    setFull(false);
    real.current = false;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        /* já saiu */
      });
    }
  }, []);
  return { full, enter, exit };
}
