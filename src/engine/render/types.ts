import type { CSSProperties, ReactNode } from 'react';
import type { Motion, Piece, PieceId } from '@/engine/core';
import type { GestureHandler } from './gestures';

/** Selo num canto da peça (ex.: o valor atual de um cliente). */
export interface Badge {
  text: string;
  corner?: 'tl' | 'tr' | 'bl' | 'br';
  color?: string;
  background?: string;
}

/** Área nomeada da peça (coordenadas da peça, sem escala): o duplo clique nela leva o `area`. */
export interface Hotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

/** Item do menu do botão direito. */
export interface MenuItem {
  label: string;
  onSelect?: () => void;
  /** Desabilitado; um texto é o motivo (vira dica). */
  disabled?: boolean | string;
  /** Segundo nível (ex.: os destinos de "Mover"). */
  children?: MenuItem[];
  /** Só uma linha separando grupos. */
  separator?: boolean;
}

/** O que a mesa sabe quando pede o conteúdo do preview ou da dica. */
export interface InfoState {
  /** A peça está virada para quem olha (não revele o que ela é). */
  turned: boolean;
  /** O preview está fixo (dois toques no Alt). */
  pinned: boolean;
  /** Ctrl segurado. */
  ctrl: boolean;
  /** O mouse está sobre o preview fixo. */
  over: boolean;
}

/** Enfeites de uma peça, decididos pelo jogo. Mesma peça → mesmo objeto (não redesenha à toa). */
export interface PieceDecoration {
  badges?: readonly Badge[];
  hotspots?: readonly Hotspot[];
}

/** Contrato de qualquer renderer de mesa (Konva hoje; Pixi se precisar). */
export interface TableProps {
  /** Converte gestos em comandos. Padrão: `defaultGestures`. */
  onGesture?: GestureHandler;
  /** Quais peças desenhar. Padrão: todas. Peça fora do filtro esconde o que estiver dentro dela. */
  filter?: (piece: Piece) => boolean;
  /** Quais peças o jogador pode arrastar. Padrão: todas. */
  canDrag?: (piece: Piece) => boolean;
  /** Avisa quando a seleção muda: a última peça selecionada (clique no vazio limpa). */
  onSelect?: (id: PieceId | null) => void;
  /** Avisa quando a seleção muda: todas as peças selecionadas, na ordem. */
  onSelectionChange?: (ids: PieceId[]) => void;
  /**
   * Peças que respondem uma escolha: ficam destacadas. Com `onPick`, o clique nelas responde
   * (`pick: 'piece'`); sem, só o destaque (ex.: as peças que podem ser arrastadas como resposta).
   */
  pickable?: ReadonlySet<PieceId>;
  /** Peças já marcadas numa escolha de várias. */
  picked?: ReadonlySet<PieceId>;
  onPick?: (id: PieceId) => void;
  /**
   * Face a usar no preview ampliado (Alt sobre a peça), dada a resolução pedida em pixels por
   * unidade da peça. Padrão: a mesma face. Ex.: redesenhar um modelo de carta com mais resolução.
   */
  previewFace?: (face: string, scale: number) => string;
  /** Preview com Alt ligado (padrão: sim). */
  preview?: boolean;
  /**
   * Conteúdo ao lado do preview (descrição, palavras-chave), ou `null` para nada. Recebe a peça
   * como o jogador a vê.
   */
  previewInfo?: (piece: Piece, state: InfoState) => ReactNode;
  /**
   * Dica que aparece ao lado da peça depois de o mouse parar sobre ela (`null` = sem dica). Fica
   * aberta enquanto o mouse estiver sobre ela.
   */
  hoverInfo?: (piece: Piece, state: InfoState) => ReactNode;
  /**
   * Contornos, casas e rótulos das zonas (padrão: sim). Desligado, só o destaque de um arrasto
   * aparece. Uma zona com `outline: false` nunca desenha a guia.
   */
  guides?: boolean;
  /** Distância do preview até o topo da mesa (ex.: abaixo de uma barra de botões). */
  previewTop?: number;
  /** Ajusta a posição dos controles de zoom (padrão: canto superior direito). */
  controlsStyle?: CSSProperties;
  /**
   * Itens do jogo no menu do botão direito de uma peça (depois dos da mesa). `ids`: a peça, ou o
   * grupo selecionado se ela faz parte dele.
   */
  contextMenu?: (piece: Piece, ids: PieceId[]) => MenuItem[];
  /** Tamanho das cartas na faixa da mão (1 = 100%). */
  handZoom?: number;
  /** Espaço livre nas laterais da faixa da mão (painéis por cima da mesa), em px. */
  handInset?: { left?: number; right?: number };
  /** Nome de uma zona nos menus (padrão: o texto da face, ou o id). */
  nameOf?: (piece: Piece) => string;
  /** Selos e áreas clicáveis de cada peça (a peça como o jogador da tela a vê). */
  decorate?: (piece: Piece) => PieceDecoration | undefined;
  /**
   * Como a peça se move na tela: arrasto (segue o ponteiro ou mira com uma flecha), chegada ao
   * lugar novo e efeito depois. A zona onde ela chega pode trocar a chegada e o efeito
   * (`zone.motion`). Padrão: nada animado.
   */
  motion?: (piece: Piece) => Motion | undefined;
  className?: string;
}
