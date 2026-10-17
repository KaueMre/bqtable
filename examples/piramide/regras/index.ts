// Pirâmide de energia: regras automáticas (exemplo do formato bqgame/1, em TypeScript).
// O `pnpm exemplos` junta esta pasta num regras.js (esbuild); o jogo roda o arquivo como o corpo de
// uma função que recebe `game` (docs/engine/FormatoBqgame.md, seções 12 e 16).
import type { Command } from '@/engine/core';
import type { GameApi } from '@/engine/package';
import { apoios, ehTableau, tabuleiroDe, type Carta } from './tableau';

declare const game: GameApi;

const { childrenOf, isCommand, isEvent, ownerOf } = game.helpers;
const cartas = new Map(
  (game.data.cartas ?? []).map((c) => [String(c.id), c as unknown as Carta] as const),
);
const dadosDe = (def: unknown) => cartas.get(String(def));

// Comprar: a carta do topo do baralho vai para a mão indicada (um comando feito de outro).
// O desdobramento roda sem restrição de dono; por isso a regra confere quem pediu.
game.command({
  type: 'comprar',
  expand(cmd, { state }) {
    const mao = String(cmd.mao);
    if (cmd.actor && ownerOf(state.pieces, mao) !== cmd.actor) return 'compre só para a sua mão';
    const topo = childrenOf(state.pieces, 'baralho').at(-1);
    if (!topo) return 'o baralho acabou';
    return [{ type: 'dropInto', id: topo.id, zone: mao }];
  },
});

// Duplo clique na mão compra uma carta.
game.gesture((gesto, peca) =>
  gesto.type === 'activate' && peca.id.endsWith('-mao')
    ? { type: 'comprar', mao: peca.id }
    : undefined,
);

game.rule({
  id: 'tableau',
  // Só entra no Tableau: da própria mão, com os apoios no lugar e energia suficiente.
  validate(cmd, state) {
    if (!isCommand(cmd, 'dropInto')) return true;
    const peca = state.pieces[cmd.id];
    if (!peca || peca.kind !== 'carta') return true;
    if (ehTableau(peca.parentId)) return 'cartas no Tableau ficam onde foram jogadas';
    if (!ehTableau(cmd.zone)) return true;
    const tabuleiro = tabuleiroDe(cmd.zone);
    if (peca.parentId !== `${tabuleiro}-mao`) return 'jogue a carta a partir da sua mão';
    const ocupados = new Set(childrenOf(state.pieces, cmd.zone).map((c) => c.slot));
    const faltam = apoios(cmd.slot ?? '').filter((s) => !ocupados.has(s));
    if (faltam.length) return `faltam cartas de apoio em ${faltam.join(' e ')}`;
    const custo = dadosDe(peca.attributes.def)?.custo ?? 0;
    const energia = childrenOf(state.pieces, `${tabuleiro}-energia`).length;
    if (energia < custo) return `energia insuficiente: precisa de ${custo}, tem ${energia}`;
    return true;
  },
  // Ao entrar: paga a energia (as fichas voltam ao banco) e marca os pontos.
  react(ev, state) {
    if (!isEvent(ev, 'pieceEnteredZone') || !ehTableau(ev.zone)) return [];
    const carta = dadosDe(state.pieces[ev.id]?.attributes.def);
    if (!carta) return [];
    const tabuleiro = tabuleiroDe(ev.zone);
    const energia = childrenOf(state.pieces, `${tabuleiro}-energia`);
    const pagamento = carta.custo ? energia.slice(-carta.custo) : [];
    return [
      ...pagamento.map((f): Command => ({ type: 'dropInto', id: f.id, zone: 'banco' })),
      { type: 'setGlobal', key: `pontos-${tabuleiro}`, delta: carta.pontos },
    ];
  },
});

// O setup (um tabuleiro por jogador, 3 de energia e 3 cartas na mão) está no manifest:
// forEachPlayer com os lugares de players.seats, e deal do banco e do baralho.
