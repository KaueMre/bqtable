/**
 * Gerador determinístico (mulberry32). O estado é um inteiro de 32 bits guardado no GameState,
 * então a mesma semente com os mesmos comandos dá sempre o mesmo resultado.
 */
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Inteiro em [0, n). */
export function randomInt(random: () => number, n: number): number {
  return Math.floor(random() * n);
}

/** Fisher–Yates; devolve uma cópia embaralhada. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
