/** Câmera da mesa (zoom e pan). Estado de tela, não de jogo: não passa pelo Gestor. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Zoom mantendo fixo o ponto da mesa que está sob o cursor (`pointer`, em pixels da tela). */
export function zoomAt(view: View, pointer: { x: number; y: number }, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const tableX = (pointer.x - view.x) / view.scale;
  const tableY = (pointer.y - view.y) / view.scale;
  return { scale, x: pointer.x - tableX * scale, y: pointer.y - tableY * scale };
}
