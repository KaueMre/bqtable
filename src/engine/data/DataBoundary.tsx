import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, Suspense, type CSSProperties, type ReactNode } from 'react';

interface DataBoundaryProps {
  children: ReactNode;
  /** Tela enquanto os dados carregam. */
  loading?: ReactNode;
  /** Tela de erro; `retry` busca de novo o que falhou. */
  error?: (error: Error, retry: () => void) => ReactNode;
}

/**
 * Envolve partes que usam `useSuspenseQuery`: mostra carregamento enquanto busca e erro com
 * "Tentar de novo" se falhar.
 */
export function DataBoundary({ children, loading, error }: DataBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallback={error ?? defaultError}>
          <Suspense fallback={loading ?? <p style={boxStyle}>Carregando…</p>}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

const boxStyle: CSSProperties = {
  padding: 16,
  border: '1px solid #d0d7de',
  borderRadius: 6,
  background: '#fff',
};

function defaultError(error: Error, retry: () => void) {
  return (
    <div role="alert" style={{ ...boxStyle, borderColor: '#cf222e' }}>
      <strong>Não foi possível carregar os dados.</strong>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{error.message}</pre>
      <button onClick={retry}>Tentar de novo</button>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
  fallback: (error: Error, retry: () => void) => ReactNode;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  retry = () => {
    this.props.onReset();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    return error ? this.props.fallback(error, this.retry) : this.props.children;
  }
}
