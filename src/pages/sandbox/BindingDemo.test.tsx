import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BindingDemo } from './BindingDemo';

describe('BindingDemo', () => {
  it('lista as fichas e atualiza ao despachar pelos botões', async () => {
    const user = userEvent.setup();
    render(<BindingDemo />);
    const row = (id: string) => screen.getByRole('cell', { name: id }).closest('tr')!;

    await user.click(within(row('F2')).getByRole('button', { name: '+1' }));
    await user.click(within(row('F2')).getByRole('button', { name: '+1' }));
    expect(within(row('F2')).getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(screen.getByText('Total: 2')).toBeInTheDocument();

    await user.click(within(row('F1')).getByRole('button', { name: 'Girar' }));
    expect(within(row('F1')).getByRole('cell', { name: '90°' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar ficha' }));
    expect(row('F4')).toBeInTheDocument();

    await user.click(within(row('F1')).getByRole('button', { name: '−1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Recusado: valor:');

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(screen.queryByRole('cell', { name: 'F4' })).not.toBeInTheDocument();
  });
});
