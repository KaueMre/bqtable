import type { GameEnd } from '@/engine/core';

const RESULT = { win: 'Vitória!', lose: 'Derrota', draw: 'Empate' } as const;

/** O título do fim de partida e o tom dele (a cor): vitória, derrota ou neutro. */
export interface EndTitle {
  text: string;
  tone: 'win' | 'lose' | 'draw';
}

/** "Ana", "Ana e Bia", "Ana, Bia e Caio". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

/**
 * Título do fim de partida para quem olha. Com `winners`, depende do assento da tela (`seat`):
 * "Você venceu!" para quem venceu, "Vitória de Bia" para os outros; sem assento (mesmo aparelho,
 * a tela segue a vez), sempre os nomes. Mais de um vencedor é empate. Sem `winners`, o `result`.
 */
export function endTitle(
  end: GameEnd,
  seat: string | null,
  nameOf: (player: string) => string,
): EndTitle {
  const winners = end.winners ?? [];
  if (winners.length > 1) return { text: `Empate: ${nameList(winners.map(nameOf))}`, tone: 'draw' };
  if (winners.length === 1) {
    const [winner] = winners as [string];
    if (seat === winner) return { text: 'Você venceu!', tone: 'win' };
    return { text: `Vitória de ${nameOf(winner)}`, tone: seat === null ? 'win' : 'lose' };
  }
  const result = end.result ?? 'draw';
  return { text: RESULT[result], tone: result };
}
