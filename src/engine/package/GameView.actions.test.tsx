import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Konva from 'konva';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/AppProviders';
import { DataBoundary } from '@/engine/data';
import { loadGame } from './game';
import { GameView } from './GameView';

/**
 * Regras: "Refletir" age sobre a carta selecionada (só fora da mão); "Baixar" pede para arrastar
 * uma carta da mão para a área (ou pular); "Terminar" passa a vez pelas regras.
 */
const regras = `
const { childrenOf, isCommand } = game.helpers;
game.command({
  type: 'refletir',
  execute: (cmd, { state }) => {
    const p = state.pieces[cmd.carta];
    if (!p) return 'selecione uma carta';
    if (p.parentId === cmd.actor + '-mao') return 'só cartas fora da mão';
    return [{ type: 'globalChanged', key: 'refletiu', from: null, to: cmd.carta }];
  },
});
game.command({
  type: 'baixar',
  expand: (cmd, { state }) => [{
    type: 'ask', rule: 'baixar', prompt: 'Baixe uma carta', player: cmd.actor, pick: 'drop',
    options: childrenOf(state.pieces, cmd.actor + '-mao').map((p) => p.id),
    buttons: [{ value: 'pular', label: 'Pular' }],
  }],
});
game.rule({
  id: 'baixar',
  resolve: (choice, v) => v === 'pular'
    ? [{ type: 'setGlobal', key: 'pulou', value: true }]
    : [{ type: 'dropInto', id: v.id, zone: v.zone, slot: v.slot }],
  validate: (cmd) => isCommand(cmd, 'dropInto') && cmd.zone === null ? 'na mesa não' : true,
});
game.command({ type: 'terminar', expand: () => [{ type: 'nextPlayer' }] });
game.action({
  id: 'refletir', label: 'Refletir', menu: true,
  command: (state, ctx) => ({ type: 'refletir', carta: ctx.selection[0] ?? '' }),
});
game.action({
  id: 'baixar', label: 'Baixar',
  visible: (state, ctx) => ctx.player === state.activePlayer,
  enabled: (state) => (state.globals.pulou ? 'já pulou' : true),
  command: () => ({ type: 'baixar' }),
});
game.action({ id: 'terminar', label: 'Terminar', command: () => ({ type: 'terminar' }) });
`;

const manifest = {
  format: 'bqgame/1',
  id: 'acoes',
  name: 'Ações',
  players: { min: 2, max: 2, names: ['Ana', 'Bia'], passButton: false },
  kinds: [{ kind: 'zona' }, { kind: 'carta' }],
  rules: 'data:text/javascript,' + encodeURIComponent(regras),
  setup: [
    {
      pieces: [
        // area: mesa x 300..500, y 30..170; casas 0,0 (300..400) e 1,0 (400..500)
        {
          id: 'area',
          kind: 'zona',
          size: { w: 200, h: 140 },
          transform: { x: 400, y: 100 },
          zone: { layout: 'grid', grid: { cols: 2, rows: 1, cell: { w: 100, h: 140 } } },
        },
        { id: 'solta', kind: 'carta', transform: { x: 700, y: 100 } },
      ],
    },
    {
      forEachPlayer: true,
      pieces: [
        {
          id: '{player}-mao',
          kind: 'zona',
          owner: '{player}',
          size: { w: 200, h: 100 },
          transform: { x: '{playerIndex|default:0}', y: 400 },
          zone: { layout: 'fan' },
        },
        { id: '{player}-c1', kind: 'carta', parentId: '{player}-mao' },
      ],
    },
  ],
  hud: [
    { label: 'Refletiu', global: 'refletiu' },
    { label: 'Pulou', global: 'pulou' },
  ],
};

const stage = () => Konva.stages[Konva.stages.length - 1]!;
const node = (id: string) => stage().findOne<Konva.Group>(`#${id}`)!;
const placar = (label: string) =>
  within(screen.getByLabelText('Placar')).getByText(label).nextSibling;
const acao = (name: string) =>
  within(screen.getByLabelText('Ações')).queryByRole('button', { name });

async function abrir(m: object = manifest) {
  const game = await loadGame({ manifest: m });
  render(
    <AppProviders>
      <DataBoundary>
        <GameView game={game} players={2} />
      </DataBoundary>
    </AppProviders>,
  );
  await screen.findByLabelText('Placar');
}

describe('GameView: ações do jogo e escolhas por arrasto', () => {
  it('botões de ação: a seleção vai no contexto; desabilitado mostra o motivo', async () => {
    const user = userEvent.setup();
    await abrir();
    expect(acao('Refletir')).toBeDisabled();
    expect(acao('Refletir')).toHaveAttribute('title', 'selecione uma carta'); // motivo do check
    act(() => {
      node('p1-c1').fire('click');
    });
    expect(acao('Refletir')).toHaveAttribute('title', 'só cartas fora da mão');
    act(() => {
      node('solta').fire('click');
    });
    expect(acao('Refletir')).toBeEnabled();
    await user.click(acao('Refletir')!);
    expect(placar('Refletiu')).toHaveTextContent('solta');
  });

  it('sem botão de passar a vez: o jogo passa pela ação; visible esconde', async () => {
    const user = userEvent.setup();
    await abrir();
    expect(screen.queryByRole('button', { name: 'Passar a vez' })).not.toBeInTheDocument();
    expect(acao('Baixar')).toBeInTheDocument();
    await user.click(acao('Terminar')!);
    // a tela segue a vez: agora é a Bia, e o Baixar dela aparece
    expect(
      within(screen.getByLabelText('Jogadores')).getByText('na tela').parentElement,
    ).toHaveTextContent('Bia');
    await user.selectOptions(screen.getByRole('combobox', { name: /Ver como/ }), 'p1');
    expect(acao('Baixar')).toBeNull(); // a Ana olhando, fora da vez dela
  });

  it('pick drop: arrastar a peça responde; a regra recusa e a escolha continua', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(acao('Baixar')!);
    const painel = within(screen.getByLabelText('Escolha pendente'));
    expect(painel.getByText('Arraste uma das peças destacadas.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ações')).not.toBeInTheDocument(); // some durante a escolha
    expect(node('p1-c1').draggable()).toBe(true);
    expect(node('solta').draggable()).toBe(false);
    const arrastar = (to: { x: number; y: number }) =>
      act(() => {
        node('p1-c1').fire('dragstart');
        node('p1-c1').position(to);
        node('p1-c1').fire('dragmove');
        node('p1-c1').fire('dragend');
      });
    arrastar({ x: 900, y: 600 }); // mesa: a regra recusa
    expect(screen.getByRole('status')).toHaveTextContent('na mesa não');
    expect(screen.getByLabelText('Escolha pendente')).toBeInTheDocument();
    arrastar({ x: 450, y: 100 }); // casa 1,0 da área
    expect(screen.queryByLabelText('Escolha pendente')).not.toBeInTheDocument();
    expect(node('p1-c1').position()).toEqual({ x: 450, y: 100 }); // centro da casa 1,0
  });

  it('botão da escolha (Pular) responde sem a mesa', async () => {
    const user = userEvent.setup();
    await abrir();
    await user.click(acao('Baixar')!);
    await user.click(screen.getByRole('button', { name: 'Pular' }));
    expect(placar('Pulou')).toHaveTextContent('true');
    expect(acao('Baixar')).toBeDisabled();
    expect(acao('Baixar')).toHaveAttribute('title', 'já pulou'); // enabled do jogo
  });

  it('ação com menu: true aparece no botão direito da peça, com ela como seleção', async () => {
    const user = userEvent.setup();
    await abrir();
    act(() => void node('p1-c1').fire('contextmenu', { evt: { preventDefault() {} } }));
    const menu = within(screen.getByRole('menu', { name: 'Ações da peça' }));
    expect(menu.getByRole('menuitem', { name: 'Refletir' })).toBeDisabled(); // na mão: a regra recusa
    expect(menu.queryByRole('menuitem', { name: 'Baixar' })).toBeNull(); // sem menu: true
    await user.keyboard('{Escape}');
    act(() => void node('solta').fire('contextmenu', { evt: { preventDefault() {} } }));
    await user.click(
      within(screen.getByRole('menu', { name: 'Ações da peça' })).getByRole('menuitem', {
        name: 'Refletir',
      }),
    );
    expect(placar('Refletiu')).toHaveTextContent('solta');
  });

  it('passButton com texto troca o rótulo', async () => {
    await abrir({ ...manifest, players: { ...manifest.players, passButton: 'Terminar a vez' } });
    expect(screen.getByRole('button', { name: 'Terminar a vez' })).toBeInTheDocument();
  });
});
