import type { ReactNode } from 'react';
import { ViewerContext } from './context';

/**
 * Define quem está olhando a tela: as peças aparecem como esse jogador as vê (áreas privadas de
 * outros escondidas ou viradas) e os comandos da tela saem com ele como `actor`.
 */
export function ViewerProvider({
  viewer,
  children,
}: {
  viewer: string | null;
  children: ReactNode;
}) {
  return <ViewerContext value={viewer}>{children}</ViewerContext>;
}
