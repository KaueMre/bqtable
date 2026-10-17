import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ManagerDemo } from './ManagerDemo';

describe('ManagerDemo', () => {
  it('desfazer até o fim não apaga o setup', async () => {
    const user = userEvent.setup();
    render(<ManagerDemo />);
    const undo = () => screen.getByRole('button', { name: 'Desfazer' });
    expect(undo()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Energia +1' }));
    expect(undo()).toBeEnabled();
    await user.click(undo());
    expect(undo()).toBeDisabled();
    expect(screen.getByText('nada para desfazer')).toBeInTheDocument();
    expect(screen.getByText(/Lâmpada \(apagada\)/)).toBeInTheDocument();
  });

  it('cascata, escolha pendente e desfazer', async () => {
    const user = userEvent.setup();
    render(<ManagerDemo />);
    const plus = () => screen.getByRole('button', { name: 'Energia +1' });

    await user.click(plus());
    await user.click(plus());
    await user.click(plus());
    expect(screen.getByText(/Lâmpada \(acesa\)/)).toBeInTheDocument();

    const choice = screen.getByRole('group', { name: 'Escolha pendente' });
    expect(screen.queryByRole('button', { name: 'Energia +1' })).not.toBeInTheDocument();
    await user.click(within(choice).getByRole('button', { name: '+5 pontos' }));
    expect(screen.getByText('Pontos').querySelector('strong')).toHaveTextContent('8');

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(screen.getByRole('group', { name: 'Escolha pendente' })).toBeInTheDocument();
  });

  it('sorteio bloqueia o desfazer', async () => {
    const user = userEvent.setup();
    render(<ManagerDemo />);
    await user.click(screen.getByRole('button', { name: 'Sortear energia' }));
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
    expect(screen.getByText('informação revelada: não dá para desfazer')).toBeInTheDocument();
  });
});
