/**
 * Como uma peça se move na tela: só desenho, nenhuma regra depende disso. Vai no kind (manifest),
 * no padrão da mesa (`table.motion`) e na zona (`zone.motion`, para quem entra nela).
 */

/** Durante o arrasto: a peça segue o ponteiro (`follow`, padrão) ou fica e uma flecha mira (`arrow`). */
export type DragMotion = 'follow' | 'arrow';

/**
 * Chegada ao lugar novo: `instant` (padrão, some e aparece), `drop` (aparece acima e cai),
 * `move` (vai do lugar de antes ao novo) ou `showcase` (cresce em evidência na tela, depois vai).
 */
export type PlaceType = 'instant' | 'drop' | 'move' | 'showcase';

export interface PlaceMotionSpec {
  type: PlaceType;
  /** Milissegundos: a queda (`drop`), cada trecho (`move`), cada ida (`showcase`). */
  duration?: number;
  /** `move` e a volta do `showcase`: reto (`line`, padrão) ou numa curva, subindo e descendo (`arc`). */
  path?: 'line' | 'arc';
  /** `showcase`: onde a peça aparece grande (padrão `center`). */
  at?: 'center' | 'left' | 'right';
  /** `showcase`: quanto tempo fica parada em evidência, em ms. */
  hold?: number;
}

export type PlaceMotion = PlaceType | PlaceMotionSpec;

/** Depois de chegar: nada (`none`, padrão), tremer (`shake`) ou brilhar em volta (`glow`). */
export type AfterType = 'none' | 'shake' | 'glow';

export interface AfterMotionSpec {
  type: AfterType;
  /** Milissegundos, ou `next`: até a próxima jogada. Qualquer jogada nova para o efeito. */
  duration?: number | 'next';
  /** `glow`: a cor da luz. */
  color?: string;
}

export type AfterMotion = AfterType | AfterMotionSpec;

/** A chegada e o efeito depois. */
export interface ArrivalMotion {
  place?: PlaceMotion;
  after?: AfterMotion;
}

export interface Motion extends ArrivalMotion {
  drag?: DragMotion;
  /**
   * Quando a peça saiu de uma mão (zona `hand`), como a carta que o jogador joga: vence a chegada
   * e o efeito de qualquer origem (ex.: em evidência, e o que as regras movem, em arco).
   */
  fromHand?: ArrivalMotion;
}

/** Na zona: como as peças chegam nela (vence o do kind). O arrasto é da peça. */
export type ZoneMotion = Omit<Motion, 'drag'>;
