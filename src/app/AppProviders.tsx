import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

interface AppProvidersProps {
  children: ReactNode;
  /** Permite injetar um cliente próprio (testes). */
  queryClient?: QueryClient;
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  // Definições de jogo e imagens não mudam durante a partida: sem refetch automático.
  const [client] = useState(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
