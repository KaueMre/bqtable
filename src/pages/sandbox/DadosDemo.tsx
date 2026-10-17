import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import {
  childrenOf,
  createManager,
  gridSlot,
  spawn,
  type Manager,
  type Piece,
  type PieceInit,
} from '@/engine/core';
import { DataBoundary, fetchJson, jsonQuery, parseOrThrow } from '@/engine/data';
import { ManagerProvider, useGame, usePiece } from '@/engine/react';
import { defaultGestures, type GestureHandler } from '@/engine/render';
import { Table } from '@/engine/render/konva';
import cartasUrl from './cartas.json?url';
import { cardFace } from './faces';

const NAIPES = ['Ouros', 'Copas', 'Espadas'] as const;
const Naipe = z.enum(NAIPES);
type Naipe = z.infer<typeof Naipe>;

const Carta = z.object({
  id: z.string().regex(/^[OCE]\d$/, 'id no formato O1, C1, E1'),
  nome: z.string().min(1),
  naipe: Naipe,
  valor: z.number().int().min(1).max(3),
  /** Cópias com até 2 jogadores, mais `extraPorJogador` para cada jogador além do segundo. */
  copias: z.number().int().min(0),
  extraPorJogador: z.number().int().min(0),
});
type Carta = z.infer<typeof Carta>;

const Mestre = z.object({
  id: z.string().regex(/^M[OCE]$/, 'id no formato MO, MC, ME'),
  nome: z.string().min(1),
  naipe: Naipe,
  pontos: z.number().int().min(0),
});

/** Definições das cartas (cartas.json): na mesa, as peças guardam só o id (`attributes.def`). */
const Definicoes = z.object({ cartas: z.array(Carta), mestres: z.array(Mestre) });
type Definicoes = z.infer<typeof Definicoes>;

const CARTA = { w: 90, h: 126 };
const COR: Record<Naipe, number> = { Ouros: 40, Copas: 0, Espadas: 220 };

const copiasPara = (c: Carta, jogadores: number) =>
  c.copias + c.extraPorJogador * Math.max(0, jogadores - 2);

type Fonte = 'normal' | 'lenta' | 'quebrada';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 'normal' é a query de verdade; as outras simulam rede lenta e um JSON com erros. */
function queryDaFonte(fonte: Fonte) {
  if (fonte === 'normal') return jsonQuery(['sandbox', 'cartas'], cartasUrl, Definicoes);
  return queryOptions({
    queryKey: ['sandbox', 'cartas', fonte] as readonly unknown[],
    queryFn: async () => {
      await delay(1500);
      const data = (await fetchJson(cartasUrl)) as Definicoes;
      if (fonte === 'quebrada') {
        (data.cartas[2] as { naipe: unknown }).naipe = 'Paus';
        (data.cartas[5] as { valor: unknown }).valor = 7;
      }
      return parseOrThrow(Definicoes, data, 'cartas.json');
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

const DECK_X = { Ouros: 80, Copas: 200, Espadas: 320 } as const;

/** Peças do baralho de um naipe, viradas para baixo, com as cópias para o número de jogadores. */
const baralhoDoNaipe = (defs: Definicoes, naipe: Naipe, jogadores: number): PieceInit[] =>
  defs.cartas
    .filter((c) => c.naipe === naipe)
    .flatMap((c) =>
      Array.from({ length: copiasPara(c, jogadores) }, (_, i) => ({
        id: `${c.id}-${i + 1}`,
        kind: 'carta',
        status: 'faceDown',
        parentId: `deck-${naipe}`,
        faces: {
          faceUp: cardFace({ label: c.nome, hue: COR[naipe] }),
          faceDown: cardFace({ label: '', hue: COR[naipe], variant: 'back' }),
        },
        tags: [naipe],
        attributes: { def: c.id },
      })),
    );

function montarMesa(defs: Definicoes, jogadores: number): Manager {
  const m = createManager({ seed: Date.now() });
  const comDefinicao = z.object({ def: z.string() });
  m.registerKind({
    kind: 'carta',
    statuses: ['faceDown', 'faceUp'],
    attributes: comDefinicao,
    defaults: { size: CARTA },
  });
  m.registerKind({
    kind: 'mestre',
    statuses: ['faceUp'],
    attributes: comDefinicao,
    defaults: { size: CARTA },
  });
  m.registerKind({ kind: 'zona' });
  const zona = (
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    zone: Piece['zone'],
  ) => ({
    id,
    kind: 'zona',
    faces: { default: label },
    size: { w, h },
    transform: { x, y },
    zone,
  });
  const r = m.dispatch(
    spawn([
      ...NAIPES.flatMap((naipe) => [
        zona(`deck-${naipe}`, `Deck · ${naipe}`, DECK_X[naipe], 110, 110, 150, {
          layout: 'stack',
          accepts: { tags: [naipe] },
          statusOnEnter: 'faceDown',
          stack: { dx: 0.15, dy: -0.25 },
        }),
        ...baralhoDoNaipe(defs, naipe, jogadores),
      ]),
      zona('mestres', 'Mestres', 770, 110, 3 * 100, 136, {
        layout: 'grid',
        accepts: { kinds: ['mestre'] },
        grid: { cols: 3, rows: 1, cell: { w: 100, h: 136 } },
      }),
      ...defs.mestres.map((c, i) => ({
        id: c.id,
        kind: 'mestre',
        status: 'faceUp',
        parentId: 'mestres',
        slot: gridSlot(i, 0),
        faces: { faceUp: cardFace({ label: c.nome, hue: COR[c.naipe] }) },
        attributes: { def: c.id },
      })),
      zona('mao', 'Mão', 300, 520, 560, 170, {
        layout: 'fan',
        accepts: { kinds: ['carta'] },
        statusOnEnter: 'faceUp',
        fan: { spacing: 70, arc: 14 },
      }),
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  for (const naipe of NAIPES) m.dispatch({ type: 'shuffle', zone: `deck-${naipe}` });
  m.clearHistory();
  return m;
}

const gestures: GestureHandler = (gesture, piece, state) =>
  gesture.type === 'activate'
    ? piece.kind === 'carta'
      ? {
          type: 'setStatus',
          id: piece.id,
          status: piece.status === 'faceDown' ? 'faceUp' : 'faceDown',
        }
      : null
    : defaultGestures(gesture, piece, state);

const canDrag = (p: Piece) => !p.zone;

/** Monta a mesa com as definições carregadas; suspende enquanto busca os dados. */
function MesaComDados({ fonte, jogadores }: { fonte: Fonte; jogadores: number }) {
  const { data: defs } = useSuspenseQuery(queryDaFonte(fonte));
  const manager = useMemo(() => montarMesa(defs, jogadores), [defs, jogadores]);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ManagerProvider manager={manager}>
      <div className="demo">
        <div className="demo-stage demo-stage--wide">
          <Table onGesture={gestures} canDrag={canDrag} onSelect={setSelected} />
        </div>
        <div className="demo-panel">
          <Contagem />
          <Detalhe id={selected} defs={defs} />
        </div>
      </div>
    </ManagerProvider>
  );
}

function Contagem() {
  const counts = useGame((s) =>
    NAIPES.map((n) => `${n}: ${childrenOf(s.game.pieces, `deck-${n}`).length}`).join(' · '),
  );
  return <p aria-label="Cartas nos decks">{counts}</p>;
}

/** Definição da carta selecionada, lida das definições carregadas (não do estado). */
function Detalhe({ id, defs }: { id: string | null; defs: Definicoes }) {
  const piece = usePiece(id ?? '');
  const defId = piece?.attributes.def;
  const carta = defs.cartas.find((c) => c.id === defId) ?? defs.mestres.find((c) => c.id === defId);
  if (!carta) return <p className="demo-hint">Clique numa carta para ver a definição.</p>;
  return (
    <dl className="demo-def" aria-label="Definição da carta">
      <dt>Carta</dt>
      <dd>
        {carta.nome} ({carta.id}) · {carta.naipe}
      </dd>
      {'valor' in carta && (
        <>
          <dt>Valor</dt>
          <dd>{carta.valor}</dd>
          <dt>Cópias</dt>
          <dd>
            {carta.copias} + {carta.extraPorJogador} por jogador além do segundo
          </dd>
        </>
      )}
      {'pontos' in carta && (
        <>
          <dt>Pontos</dt>
          <dd>{carta.pontos}</dd>
        </>
      )}
    </dl>
  );
}

/** Fase 6: definições do JSON via React Query, com carregamento, erro e faces geradas. */
export function DadosDemo() {
  const [fonte, setFonte] = useState<Fonte>('normal');
  const [jogadores, setJogadores] = useState(2);
  return (
    <>
      <div className="demo-buttons">
        <label>
          Fonte{' '}
          <select value={fonte} onChange={(e) => setFonte(e.target.value as Fonte)}>
            <option value="normal">cartas.json</option>
            <option value="lenta">lenta (1,5 s)</option>
            <option value="quebrada">com erros</option>
          </select>
        </label>
        <label>
          Jogadores{' '}
          <select value={jogadores} onChange={(e) => setJogadores(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <span className="demo-hint">
          Arraste cartas do topo de um deck para a mão (viram para cima) · duplo clique vira ·
          clique mostra a definição.
        </span>
      </div>
      <DataBoundary key={fonte} loading={<p className="demo-loading">Carregando cartas…</p>}>
        <MesaComDados fonte={fonte} jogadores={jogadores} />
      </DataBoundary>
      <p className="demo-hint">
        Cartas de {CARTA.w}×{CARTA.h}; faces geradas em canvas a partir dos dados.
      </p>
    </>
  );
}
