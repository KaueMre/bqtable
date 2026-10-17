import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

const regras = `
game.command({
  type: 'agir',
  expand: (cmd) => [
    { type: 'setGlobal', key: 'ultima', value: cmd.area },
    { type: 'log', message: 'Agir: ' + cmd.area },
  ],
});
game.command({ type: 'segredo', expand: () => [{ type: 'log', message: 'segredo da Ana', to: 'p1' }] });
game.gesture((g, p) => {
  if (g.type !== 'activate') return undefined;
  if (p.id === 'c1' && g.area) return { type: 'agir', area: g.area };
  if (p.id === 'f1') return { type: 'segredo' };
  return undefined;
});
`;

const manifest = {
  format: 'bqgame/1',
  id: 'painel',
  name: 'Painel',
  players: { min: 2, max: 2, names: ['Ana', 'Bia'] },
  kinds: [
    {
      kind: 'cliente',
      defaults: { size: { w: 60, h: 90 } },
      badges: [{ text: '{valor}', corner: 'tr' }],
      hotspots: [
        { id: 'esquerda', x: 0, y: 0, w: 30, h: 90, label: 'Foco +1' },
        { id: 'direita', x: 30, y: 0, w: 30, h: 90 },
      ],
    },
    { kind: 'ficha' },
  ],
  rules: 'data:text/javascript,' + encodeURIComponent(regras),
  setup: [
    {
      pieces: [
        { id: 'c1', kind: 'cliente', attributes: { valor: 5 }, transform: { x: 100, y: 100 } },
        { id: 'c2', kind: 'cliente', transform: { x: 200, y: 100 } },
        { id: 'f1', kind: 'ficha', transform: { x: 300, y: 100 } },
      ],
    },
    { command: { type: 'setGlobal', key: 'dia', value: 1 } },
    { command: { type: 'setGlobal', key: 'hora', value: 10 } },
    {
      command: {
        type: 'setGlobal',
        key: 'eventos',
        value: ['Faltou tinta', { label: 'Cliente famoso' }],
      },
    },
    { command: { type: 'setPlayerAttr', player: 'p1', key: 'foco', value: 7 } },
  ],
  hud: [
    { label: 'Hora', text: 'Dia {dia}, {hora}h' },
    { label: 'Eventos', list: 'eventos' },
    { label: 'Última', global: 'ultima' },
  ],
  playerHud: [{ label: 'Foco', text: '{foco|default:0}/15' }],
};

const stage = () => Konva.stages[Konva.stages.length - 1]!;
const node = (id: string) => stage().findOne<Konva.Group>(`#${id}`)!;
const placar = (label: string) =>
  within(screen.getByLabelText('Placar')).getByText(label).nextSibling;
const log = () => screen.getByLabelText('Log de eventos');

async function abrir() {
  const game = await loadGame({ manifest });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Placar');
}

describe('GameView: painel, log, selos e áreas da carta', () => {
  it('painel com texto, lista e recurso em texto por jogador', async () => {
    await abrir();
    expect(placar('Hora')).toHaveTextContent('Dia 1, 10h');
    expect(placar('Eventos')).toHaveTextContent('Faltou tinta Cliente famoso');
    const ana = within(screen.getByLabelText('Recursos de Ana'));
    const bia = within(screen.getByLabelText('Recursos de Bia'));
    expect(ana.getByText('Foco').nextSibling).toHaveTextContent('7/15');
    expect(bia.getByText('Foco').nextSibling).toHaveTextContent('0/15');
  });

  it('selo com o atributo da peça; sem o atributo, sem selo', async () => {
    await abrir();
    const textos = (id: string) =>
      node(id)
        .find<Konva.Text>('Text')
        .map((t) => t.text());
    expect(textos('c1')).toContain('5');
    expect(textos('c2')).not.toContain('');
    expect(node('c2').find('Rect').length).toBeLessThan(node('c1').find('Rect').length);
  });

  it('área da carta: selecionada mostra as áreas; o duplo clique leva a área; o log mostra a mensagem', async () => {
    const user = userEvent.setup();
    await abrir();
    const contornos = () =>
      node('c1')
        .find<Konva.Rect>('Rect')
        .filter((r) => r.stroke() === '#8250df').length;
    expect(contornos()).toBe(0);
    act(() => {
      node('c1').fire('click');
    });
    expect(contornos()).toBe(2);
    // c1: centro (100, 100), 60 × 90 → canto em (70, 55); ponto local (10, 20) = mesa (80, 75)
    // a câmera (grupo "mundo") abre enquadrando a mesa: ponto da mesa → tela
    const world = stage().findOne<Konva.Group>('.world')!;
    vi.spyOn(stage(), 'getPointerPosition').mockReturnValue({
      x: 80 * world.scaleX() + world.x(),
      y: 75 * world.scaleY() + world.y(),
    });
    act(() => {
      node('c1').fire('dblclick');
    });
    expect(placar('Última')).toHaveTextContent('esquerda');
    expect(within(log()).getByText(/Agir: esquerda/)).toBeInTheDocument();
    expect(within(log()).queryByText(/ultima:/)).not.toBeInTheDocument(); // evento do motor da jogada
    await user.click(screen.getByRole('checkbox', { name: /Log completo/ }));
    expect(within(log()).getByText(/ultima:/)).toBeInTheDocument();
  });

  it('mensagem com `to`: só o jogador indicado vê', async () => {
    const user = userEvent.setup();
    await abrir();
    act(() => {
      node('f1').fire('dblclick');
    });
    expect(within(log()).getByText(/segredo da Ana/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /Ver como/ }), 'p2');
    expect(within(log()).queryByText(/segredo da Ana/)).not.toBeInTheDocument();
  });
});

describe('GameView: carta virada para todos (hiddenStatuses)', () => {
  it('o painel da peça e o log não revelam o deck', async () => {
    const user = userEvent.setup();
    const game = await loadGame({
      manifest: {
        format: 'bqgame/1',
        id: 'deck',
        name: 'Deck',
        kinds: [
          { kind: 'zona' },
          {
            kind: 'carta',
            statuses: ['faceDown', 'faceUp'],
            hiddenStatuses: ['faceDown'],
            defaults: { faces: { faceDown: 'Verso', faceUp: '{def}' } },
          },
        ],
        setup: [
          { pieces: [{ id: 'deck', kind: 'zona', zone: { layout: 'stack' } }] },
          {
            pieces: ['rosa', 'caveira', 'ancora'].map((def) => ({
              id: def,
              kind: 'carta',
              status: 'faceDown',
              parentId: 'deck',
              attributes: { def },
            })),
          },
          { command: { type: 'shuffle', zone: 'deck' } },
        ],
      },
    });
    render(
      <AppProviders>
        <DataBoundary>
          <GameView game={game} players={1} />
        </DataBoundary>
      </AppProviders>,
    );
    await screen.findByLabelText('Log de eventos');
    await user.click(screen.getByRole('checkbox', { name: /Log completo/ }));
    const texto = log().textContent ?? '';
    expect(texto).toContain('zoneShuffled');
    for (const def of ['rosa', 'caveira', 'ancora']) expect(texto).not.toContain(def);
    act(() => {
      node('rosa').fire('click');
    });
    const detalhes = within(screen.getByLabelText('Peça selecionada'));
    expect(detalhes.getByText('virada')).toBeInTheDocument();
    expect(detalhes.queryByText('rosa')).not.toBeInTheDocument();
  });
});
