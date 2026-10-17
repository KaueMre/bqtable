import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DadosDemo } from './DadosDemo';

// carrega dados e imagens: sob a suíte inteira, pode passar do 1 s padrão
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
    expect(await decks()).toHaveTextContent('Traço: 30 · Sombra: 30 · Cor: 30');

    await user.selectOptions(screen.getByLabelText('Jogadores'), '4');
    expect(await decks()).toHaveTextContent('Traço: 48 · Sombra: 48 · Cor: 48');

    // clicar numa base mostra a definição dela
    const stage = Konva.stages[Konva.stages.length - 1]!;
    act(() => {
      stage.findOne('#BT6')!.fire('click');
    });
    expect(screen.getByLabelText('Definição da carta')).toHaveTextContent('Mestre do Traço');
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
    expect(alert).toHaveTextContent('mindset[2].centro');
    expect(alert).toHaveTextContent('mindset[5].nivel');
  });
});
