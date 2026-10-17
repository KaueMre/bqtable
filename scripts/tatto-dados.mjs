// Gera os dados do pacote do Tatto Game (games/tatto/data) a partir dos arquivos de design
// (docs/games/tatto/dados), que vêm do chat de design e do simulador e não são editados à mão.
// Cada conjunto vira uma lista de itens com `id` (formato bqgame/1), com os textos já prontos
// para os modelos de carta. O catálogo (TattoGame.md 10.2) é gerado aqui.
// Uso: node scripts/tatto-dados.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGEM = 'docs/games/tatto/dados';
const DESTINO = 'games/tatto/data';

const ler = (nome) => JSON.parse(readFileSync(join(ORIGEM, nome), 'utf8'));
const { mindset, bases } = ler('cartas_mindset.json');
const contratos = ler('contratos.json');

const EL = { Traço: 'traco', Sombra: 'sombra', Cor: 'cor' };
const ELEMENTOS = ['Traço', 'Sombra', 'Cor'];
const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------------------------
// Zonas das cartas de Mindset: código → tipo, título e texto (os do protótipo, prototipo/*.html)

const ALCANCE = { fileira: 'desta fileira', abaixo: 'do cone abaixo' };

function zona([codigo, valor], elemento, lado) {
  const foco = `de foco de ${elemento}`;
  const z = (tipo, titulo, texto) => ({ codigo, valor: valor ?? null, tipo, titulo, texto });
  switch (codigo) {
    case 'VAZIO':
      return z('vazio', '', '');
    case 'FOCO_R':
      return z('rapida', 'Ganhar foco', `Ganhe ${valor} ${foco}.`);
    case 'COMP_R':
      return z(
        'rapida',
        `Comprar ${valor}`,
        `Compre ${valor} carta de Mindset, de qualquer elemento.`,
      );
    case 'COMP_A':
      return z(
        'padrao',
        `Comprar ${valor}`,
        `Compre ${valor} cartas de Mindset, escolhendo o elemento de cada.`,
      );
    case 'JOG_R':
      return z('rapida', `Jogar ${valor}`, `Baixe ${valor} carta da mão.`);
    case 'JOG_A':
      return z('padrao', `Jogar ${valor}`, `Baixe até ${valor} cartas da mão.`);
    case 'PREP_R':
      return z('rapida', 'Preparar', 'Prepare 1 carta do catálogo, pagando o foco.');
    case 'PREP_A':
      return valor
        ? z('padrao', 'Preparar+', `Ganhe 1 ${foco} e prepare quantas cartas quiser.`)
        : z('padrao', 'Preparar', 'Prepare quantas cartas quiser, pagando o foco.');
    case 'APL_R':
      return z('rapida', 'Aplicar', 'Aplique 1 tatuagem pronta.');
    case 'APL_A':
      return valor
        ? z(
            'padrao',
            'Aplicar+',
            'Aplique quantas tatuagens quiser. A loja ganha +1 de reputação por tatuagem.',
          )
        : z('padrao', 'Aplicar', 'Aplique quantas tatuagens quiser.');
    case 'PRAT_R':
      return z('rapida', 'Praticar', `Repita os geradores de ${elemento} ${ALCANCE[valor]}.`);
    case 'PRAT_A':
      return z(
        'padrao',
        'Praticar',
        `Repita os geradores ${ALCANCE[valor]}, de todos os elementos.`,
      );
    case 'EPI_FOCO':
      return z('epifania', 'Ganhar foco', `Ao ser coberta: ganhe ${valor} ${foco}.`);
    case 'EPI_COMP':
      return z(
        'epifania',
        `Comprar ${valor}`,
        `Ao ser coberta: compre ${valor} cartas de Mindset.`,
      );
    case 'EPI_JOG':
      return z('epifania', `Baixar ${valor}`, `Ao ser coberta: baixe ${valor} carta da mão.`);
    default:
      throw new Error(`código de ação desconhecido: ${codigo} (${lado})`);
  }
}

/** Campos de desenho de uma zona: o título em caixa alta e "vazio" só nas vazias. */
function zonaDesenho(z) {
  return { ...z, vazio: z.tipo === 'vazio' ? 'vazio' : '', cheia: z.tipo === 'vazio' ? '' : 'sim' };
}

const zonas = (c) => ({
  esquerda: zonaDesenho(zona(c.esquerda, c.elemento, `${c.id}.esquerda`)),
  centro: zonaDesenho(zona(c.centro, c.elemento, `${c.id}.centro`)),
  direita: zonaDesenho(zona(c.direita, c.elemento, `${c.id}.direita`)),
});

/** "2 Traço · 1 Sombra" e um campo por elemento (vazio se zero), para os ícones. */
function conhecimento(k) {
  const out = {};
  for (const e of ELEMENTOS) out[EL[e]] = k[e] ? String(k[e]) : '';
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mindset e bases

const saidaMindset = mindset.map((c) => ({
  id: c.id,
  nome: c.nome,
  elemento: c.elemento,
  el: EL[c.elemento],
  nivel: c.nivel,
  reputacao: c.reputacao,
  requisito: c.requisito, // { Traço: 1 }
  fornece: c.fornece,
  req: c.requisito[c.elemento] ?? 0, // conhecimento exigido do próprio elemento (= nível)
  forn: conhecimento(c.fornece),
  fornProprio: c.fornece[c.elemento] ?? 0,
  copias_base: c.copias.base,
  copias_3: c.copias['3+'],
  copias_4: c.copias['4'],
  ...zonas(c),
}));

const NIVEL_BASE = { 2: 'Aprendiz', 4: 'Profissional', 6: 'Mestre' };
// casa no kit de bases do jogador (grade 3 × 3): coluna = grau, linha = elemento
const casaDaBase = (b) => `${b.reputacao / 2 - 1},${ELEMENTOS.indexOf(b.elemento)}`;
const saidaBases = bases.map((b) => ({
  id: b.id,
  nome: b.nome,
  elemento: b.elemento,
  el: EL[b.elemento],
  reputacao: b.reputacao,
  grau: NIVEL_BASE[b.reputacao],
  casa: casaDaBase(b),
  pontos: '●'.repeat(b.reputacao / 2) + '○'.repeat(3 - b.reputacao / 2),
  compra: b.compra,
  pre_baixadas: b.pre_baixadas,
  resumo: `Compra ${b.compra}` + (b.pre_baixadas ? ` · Pré-baixa ${b.pre_baixadas}` : ''),
  extra: b.extra ?? '',
  fornece: b.fornece,
  forn: conhecimento(b.fornece),
  ...zonas(b),
}));

// ---------------------------------------------------------------------------------------------
// Catálogo (TattoGame.md 10.2 e 10.3): traço 3 cópias, sombra 3 níveis × 2 cópias por traço,
// cor 3 primárias × 10. Custo: traço = dificuldade, sombra = nível, cor = 1.
// Posição de cada pilha no tabuleiro do catálogo: uma coluna por traço (sombras abaixo dele).

const CARTA = { w: 120, h: 168 };
const PASSO = { x: CARTA.w + 14, y: CARTA.h + 22 };
const MARGEM = { x: 16 + CARTA.w / 2, y: 30 + CARTA.h / 2 };
const DIFICULDADE = { 1: 'fácil', 2: 'médio', 3: 'difícil' };

const tracos = contratos.tracos.map((t) => ({
  id: slug(t.nome),
  indice: t.id, // é o número que os pedidos dos clientes usam
  nome: t.nome,
  dificuldade: t.dificuldade,
  dificuldadeNome: DIFICULDADE[t.dificuldade],
  custo: t.dificuldade,
  copias: 3,
  x: MARGEM.x + t.id * PASSO.x,
  y: MARGEM.y,
}));

const sombras = tracos.flatMap((t) =>
  [1, 2, 3].map((nivel) => ({
    id: `${t.id}-s${nivel}`,
    traco: t.id,
    tracoIndice: t.indice,
    tracoNome: t.nome,
    nivel,
    custo: nivel,
    copias: 2,
    x: t.x,
    y: MARGEM.y + nivel * PASSO.y,
  })),
);

const HEX = { Vermelho: '#D24B3D', Amarelo: '#E3B437', Azul: '#3070B8' };
const TINTA = {
  Vermelho: 'rgba(210,75,61,0.42)',
  Amarelo: 'rgba(227,180,55,0.45)',
  Azul: 'rgba(48,112,184,0.42)',
};
const primarias = contratos.cores.filter((c) => c.cartas.length === 1);
const cores = primarias.map((c, i) => ({
  id: slug(c.nome),
  indice: c.id,
  nome: c.nome,
  hex: HEX[c.nome],
  tinta: TINTA[c.nome],
  custo: 1,
  copias: 10,
  x: MARGEM.x + tracos.length * PASSO.x + 10,
  y: MARGEM.y + i * PASSO.y,
}));

const catalogo = {
  w: MARGEM.x + tracos.length * PASSO.x + 10 + CARTA.w / 2 + 16,
  h: MARGEM.y + 3 * PASSO.y + CARTA.h / 2 + 16,
};

// ---------------------------------------------------------------------------------------------
// Clientes, eventos e consequências

const nomeTraco = (i) => contratos.tracos.find((t) => t.id === i).nome;
const nomeCor = (i) => contratos.cores.find((c) => c.id === i).nome;

function pedidoTexto(categoria, pedido) {
  if (!pedido) return categoria === 'sombra' ? 'Sem sombra' : 'Sem cor';
  const [tipo, alvo] = pedido;
  if (tipo === 'q') return 'Qualquer';
  const nome =
    categoria === 'traco'
      ? nomeTraco(alvo)
      : categoria === 'sombra'
        ? `nível ${alvo}`
        : nomeCor(alvo);
  if (tipo === 'e') return categoria === 'sombra' ? `Sombra ${nome}` : nome;
  return `Qualquer, menos ${nome}`;
}

const BONUS = {
  foco_quem: (b) =>
    `Quem aplicou ganha ${b.n} de foco de ${ELEMENTOS[['traco', 'sombra', 'cor'].indexOf(b.elemento)]}.`,
  foco_todos: (b) =>
    `Cada jogador ganha ${b.n} de foco de ${ELEMENTOS[['traco', 'sombra', 'cor'].indexOf(b.elemento)]}.`,
  acao_quem: () => 'Quem aplicou faz mais uma ação padrão.',
  rapida_todos: () => 'Cada jogador faz mais uma ação rápida.',
};

const consequenciaNome = Object.fromEntries(contratos.consequencias.map((c) => [c.id, c.nome]));

const clientes = contratos.clientes.map((c) => ({
  id: c.id,
  nome: c.nome,
  nivel: c.nivel,
  estrelas: '★'.repeat(c.nivel) + '☆'.repeat(3 - c.nivel),
  paciencia: c.paciencia,
  valor: c.valor,
  custo_min: c.custo_min,
  pedido: c.pedido,
  tracoTxt: pedidoTexto('traco', c.pedido.traco),
  sombraTxt: pedidoTexto('sombra', c.pedido.sombra),
  corTxt: pedidoTexto('cor', c.pedido.cor),
  semSombra: c.pedido.sombra ? '' : 'sim',
  semCor: c.pedido.cor ? '' : 'sim',
  recompensa: c.recompensa,
  reputacao: c.recompensa.reputacao,
  bonusTxt: c.recompensa.bonus ? BONUS[c.recompensa.bonus.tipo](c.recompensa.bonus) : '',
  falha: c.falha,
  falhaTxt:
    `Perde ${c.falha.reputacao}` +
    (c.falha.evento === '+1'
      ? ' · +1 evento amanhã'
      : c.falha.evento
        ? ` · ${consequenciaNome[c.falha.evento]}`
        : ''),
}));

const ROMANO = { 1: 'I', 2: 'II', 3: 'III' };
// encaixes para os personagens, na parte de baixo da carta (coordenadas da carta 120 × 168)
const vagas = (n) =>
  Array.from({ length: n ?? 0 }, (_, i) => ({
    id: String(i),
    x: 60 + (i - ((n ?? 0) - 1) / 2) * 40,
    y: 138,
  }));
const eventos = contratos.eventos_dia.map((e) => ({
  ...e,
  numeral: ROMANO[e.nivel],
  vagas: vagas(e.personagens),
  temVagas: !!e.personagens,
  personagensTxt: e.personagens ? `${e.personagens} personagem${e.personagens > 1 ? 's' : ''}` : '',
}));
const consequencias = contratos.consequencias.map((e) => ({
  ...e,
  vagas: vagas(e.personagens),
  temVagas: !!e.personagens,
  personagensTxt: e.personagens ? `${e.personagens} personagem${e.personagens > 1 ? 's' : ''}` : '',
}));

// ---------------------------------------------------------------------------------------------

const saida = {
  'mindset.json': saidaMindset,
  'bases.json': saidaBases,
  'tracos.json': tracos,
  'sombras.json': sombras,
  'cores.json': cores,
  'clientes.json': clientes,
  'eventos.json': eventos,
  'consequencias.json': consequencias,
};

mkdirSync(DESTINO, { recursive: true });
for (const [nome, itens] of Object.entries(saida)) {
  writeFileSync(join(DESTINO, nome), JSON.stringify(itens, null, 2) + '\n');
  console.log(`${DESTINO}/${nome}: ${itens.length} itens`);
}
console.log(`catálogo: ${catalogo.w} × ${catalogo.h} (tamanho da zona no manifest)`);
