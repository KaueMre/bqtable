import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  childrenOf,
  createManager,
  gridSlot,
  spawn,
  type Manager,
  type Piece,
} from '@/engine/core';
import { DataBoundary, fetchJson, parseOrThrow, preloadImages } from '@/engine/data';
import { ManagerProvider, useGame, usePiece } from '@/engine/react';
import { defaultGestures, type GestureHandler } from '@/engine/render';
import { Table } from '@/engine/render/konva';
import { imagensTatto, registrarArteTatto } from '@/games/tatto/art';
import { cartasDeBase, deckDoElemento } from '@/games/tatto/data/deck';
import { definicoesQuery, MINDSET_URL } from '@/games/tatto/data/definitions';
import {
  DefinicoesMindset,
  descreverAcao,
  ELEMENTOS,
  type Acao,
  type Conhecimento,
} from '@/games/tatto/data/schemas';
import { CARTA, registrarKinds } from '@/games/tatto/kinds';

type Fonte = 'normal' | 'lenta' | 'quebrada';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 'normal' é a query de verdade; as outras simulam rede lenta e um JSON com erros. */
function queryDaFonte(fonte: Fonte) {
  if (fonte === 'normal') return definicoesQuery();
  return queryOptions({
    queryKey: ['tatto', 'mindset', 'demo', fonte] as readonly unknown[],
    queryFn: async () => {
      await delay(1500);
      const data = (await fetchJson(MINDSET_URL)) as DefinicoesMindset;
      if (fonte === 'quebrada') {
        (data.mindset[2] as { centro: unknown }).centro = ['VOAR', 1];
        (data.mindset[5] as { nivel: unknown }).nivel = 7;
      }
      return parseOrThrow(DefinicoesMindset, data, 'cartas_mindset.json');
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

const DECK_X = { Traço: 80, Sombra: 200, Cor: 320 } as const;

function montarMesa(defs: DefinicoesMindset, jogadores: number): Manager {
  const m = createManager({ seed: Date.now() });
  registrarKinds(m);
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
      ...ELEMENTOS.flatMap((elemento) => [
        zona(`deck-${elemento}`, `Deck · ${elemento}`, DECK_X[elemento], 110, 110, 150, {
          layout: 'stack',
          accepts: { tags: [elemento] },
          statusOnEnter: 'faceDown',
          stack: { dx: 0.15, dy: -0.25 },
        }),
        ...deckDoElemento({ defs, elemento, jogadores, parentId: `deck-${elemento}` }),
      ]),
      zona('bases', 'Cartas de base', 770, 250, 3 * 100, 3 * 136, {
        layout: 'grid',
        accepts: { kinds: ['base-card'] },
        grid: { cols: 3, rows: 3, cell: { w: 100, h: 136 } },
      }),
      ...cartasDeBase({ defs, parentId: 'bases', slot: (i) => gridSlot(Math.floor(i / 3), i % 3) }),
      zona('mao', 'Mão', 300, 520, 560, 170, {
        layout: 'fan',
        accepts: { kinds: ['mindset-card'] },
        statusOnEnter: 'faceUp',
        fan: { spacing: 70, arc: 14 },
      }),
    ]),
  );
  if (!r.ok) throw new Error(r.error);
  for (const elemento of ELEMENTOS) m.dispatch({ type: 'shuffle', zone: `deck-${elemento}` });
  m.clearHistory();
  return m;
}

const gestures: GestureHandler = (gesture, piece, state) =>
  gesture.type === 'activate'
    ? piece.kind === 'mindset-card'
      ? {
          type: 'setStatus',
          id: piece.id,
          status: piece.status === 'faceDown' ? 'faceUp' : 'faceDown',
        }
      : null
    : defaultGestures(gesture, piece, state);

const canDrag = (p: Piece) => !p.zone;

/** Monta a mesa com as definições carregadas; suspende enquanto busca dados e imagens. */
function MesaComDados({ fonte, jogadores }: { fonte: Fonte; jogadores: number }) {
  const { data: defs } = useSuspenseQuery(queryDaFonte(fonte));
  useSuspenseQuery({
    queryKey: ['tatto', 'arte', fonte],
    queryFn: async () => {
      registrarArteTatto(defs);
      await preloadImages(imagensTatto(defs));
      return true;
    },
    staleTime: Infinity,
  });
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
    ELEMENTOS.map((e) => `${e}: ${childrenOf(s.game.pieces, `deck-${e}`).length}`).join(' · '),
  );
  return <p aria-label="Cartas nos decks">{counts}</p>;
}

const fmtConhecimento = (k: Conhecimento) =>
  ELEMENTOS.filter((e) => k[e])
    .map((e) => `${k[e]} ${e}`)
    .join(', ') || '—';
const TIPO = { rapida: 'rápida', padrao: 'padrão', epifania: 'epifania', vazio: '' };
const fmtAcao = (a: Acao) => {
  const { texto, tipo } = descreverAcao(a);
  return tipo === 'vazio' ? '(vazia)' : `${texto} · ${TIPO[tipo]}`;
};

/** Definição da carta selecionada, lida das definições carregadas (não do estado). */
function Detalhe({ id, defs }: { id: string | null; defs: DefinicoesMindset }) {
  const piece = usePiece(id ?? '');
  const defId = piece?.attributes.def;
  const carta = defs.mindset.find((c) => c.id === defId) ?? defs.bases.find((c) => c.id === defId);
  if (!carta) return <p className="demo-hint">Clique numa carta para ver a definição.</p>;
  return (
    <dl className="demo-def" aria-label="Definição da carta">
      <dt>Carta</dt>
      <dd>
        {carta.nome} ({carta.id}) · {carta.elemento}
      </dd>
      {'nivel' in carta && (
        <>
          <dt>Nível / reputação</dt>
          <dd>
            {carta.nivel} / {carta.reputacao}
          </dd>
          <dt>Exige</dt>
          <dd>{fmtConhecimento(carta.requisito)}</dd>
        </>
      )}
      {'compra' in carta && (
        <>
          <dt>Reputação / compra / pré-baixadas</dt>
          <dd>
            {carta.reputacao} / {carta.compra} / {carta.pre_baixadas}
          </dd>
        </>
      )}
      <dt>Fornece</dt>
      <dd>{fmtConhecimento(carta.fornece)}</dd>
      <dt>Esquerda · centro · direita</dt>
      <dd>
        {fmtAcao(carta.esquerda)} | {fmtAcao(carta.centro)} | {fmtAcao(carta.direita)}
      </dd>
    </dl>
  );
}

/** Fase 6: definições do JSON via React Query, com carregamento, erro e arte gerada. */
export function DadosDemo() {
  const [fonte, setFonte] = useState<Fonte>('normal');
  const [jogadores, setJogadores] = useState(2);
  return (
    <>
      <div className="demo-buttons">
        <label>
          Fonte{' '}
          <select value={fonte} onChange={(e) => setFonte(e.target.value as Fonte)}>
            <option value="normal">cartas_mindset.json</option>
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
        Cartas de {CARTA.w}×{CARTA.h}; arte provisória gerada a partir dos dados.
      </p>
    </>
  );
}
