import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DadosDemo } from './DadosDemo';

// carrega os dados: sob a suíte inteira, pode passar do 1 s padrão
const decks = () => screen.findByLabelText('Cartas nos decks', {}, { timeout: 4000 });

describe('DadosDemo', () => {
  it('monta a mesa a partir do JSON, conforme o número de jogadores', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <DadosDemo />
      </AppProviders>,
    );
    expect(screen.getByText('Carregando cartas…')).toBeInTheDocument();
    expect(await decks()).toHaveTextContent('Ouros: 6 · Copas: 6 · Espadas: 6');

    await user.selectOptions(screen.getByLabelText('Jogadores'), '4');
    expect(await decks()).toHaveTextContent('Ouros: 12 · Copas: 12 · Espadas: 12');

    // clicar num mestre mostra a definição dele
    const stage = Konva.stages[Konva.stages.length - 1]!;
    act(() => {
      stage.findOne('#ME')!.fire('click');
    });
    expect(screen.getByLabelText('Definição da carta')).toHaveTextContent('Mestre de Espadas');
  });

  it('JSON com erro mostra onde está o problema', async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <DadosDemo />
      </AppProviders>,
    );
    await decks();
    await user.selectOptions(screen.getByLabelText('Fonte'), 'quebrada');
    expect(screen.getByText('Carregando cartas…')).toBeInTheDocument();
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('cartas[2].naipe');
    expect(alert).toHaveTextContent('cartas[5].valor');
  });
});
