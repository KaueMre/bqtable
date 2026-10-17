import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { routes } from '@/app/routes';

function renderAt(path: string, queryClient?: QueryClient) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

describe('App', () => {
  it('abre a rota /sandbox', () => {
    renderAt('/sandbox');
    expect(screen.getByRole('heading', { name: 'Sandbox' })).toBeInTheDocument();
  });

  it('navega da página inicial para o sandbox', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'bqtable' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Sandbox' }));
    expect(screen.getByRole('heading', { name: 'Sandbox' })).toBeInTheDocument();
  });

  it('expõe o QueryClient para a árvore', () => {
    const client = new QueryClient();
    let seen: QueryClient | undefined;
    function Probe() {
      seen = useQueryClient();
      return null;
    }
    render(
      <AppProviders queryClient={client}>
        <Probe />
      </AppProviders>,
    );
    expect(seen).toBe(client);
  });
});
