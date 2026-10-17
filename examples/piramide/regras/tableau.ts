// Funções puras do Tableau: sem `game`, para os testes importarem direto.

/** Cartas na primeira fileira do Tableau. */
export const BASE = 3;

/** Item do conjunto de dados `cartas`. */
export interface Carta {
  id: string;
  nome: string;
  custo: number;
  pontos: number;
}

/** "p1-tableau" → "p1" (o tabuleiro, que tem o id do jogador). */
export const tabuleiroDe = (zona: string) => zona.replace(/-(tableau|mao|energia)$/, '');

export const ehTableau = (zona: unknown): zona is string =>
  typeof zona === 'string' && zona.endsWith('-tableau');

/** Encaixes de cima que sustentam "r,p": um na ponta, dois no meio, nenhum na primeira fileira. */
export function apoios(slot: string): string[] {
  const [r = NaN, p = NaN] = slot.split(',').map(Number);
  if (!(r > 0)) return [];
  const larguraDeCima = BASE + r - 1;
  return [p - 1, p].filter((q) => q >= 0 && q < larguraDeCima).map((q) => `${r - 1},${q}`);
}
