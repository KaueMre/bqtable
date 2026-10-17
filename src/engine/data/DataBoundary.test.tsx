import { QueryClient, QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataBoundary } from './DataBoundary';

function renderWith(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DataBoundary', () => {
  it('mostra carregando e depois o conteúdo', async () => {
    let resolve!: (v: string) => void;
    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ['x'],
        queryFn: () => new Promise<string>((r) => (resolve = r)),
      });
      return <p>{data}</p>;
    }
    renderWith(
      <DataBoundary loading={<p>esperando</p>}>
        <Content />
      </DataBoundary>,
    );
    expect(screen.getByText('esperando')).toBeInTheDocument();
    resolve('pronto');
    expect(await screen.findByText('pronto')).toBeInTheDocument();
  });

  it('mostra o erro e tenta de novo', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    function Content() {
      const { data } = useSuspenseQuery({
        queryKey: ['y'],
        queryFn: async () => {
          attempt++;
          if (attempt === 1) throw new Error('falhou na primeira');
          return 'deu certo';
        },
      });
      return <p>{data}</p>;
    }
    renderWith(
      <DataBoundary>
        <Content />
      </DataBoundary>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('falhou na primeira');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('deu certo')).toBeInTheDocument();
  });
});
