import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PieceDemo } from './PieceDemo';

describe('PieceDemo', () => {
  it('vira a carta e recusa transição inválida', async () => {
    const user = userEvent.setup();
    render(<PieceDemo />);
    expect(screen.getByText('verso')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cobrir' }));
    expect(screen.getByRole('status')).toHaveTextContent('Recusado');
    expect(screen.getByText('verso')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Virar' }));
    expect(screen.getByText('Rabisco no guardanapo')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('recusa atributo fora do schema', async () => {
    const user = userEvent.setup();
    render(<PieceDemo />);
    await user.click(screen.getByRole('button', { name: 'Reputação −1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Recusado: reputacao:');
  });
});
