// Gera o campo `descricao` (HTML com [[palavras-chave]]) dos dados do Eternal Decks: cada Eternal
// (Curse, Ability e o deck), cada Field Card (a regra) e as cartas especiais (Rare, Two-Color,
// Ability, Skull, Game Over, roxas). O manifest mostra com `"description": "{descricao}"`.
// Rode de novo depois de mudar as cartas, os Eternals ou os Field Cards.
// Uso: node scripts/eternal-decks-descricoes.mjs [games/eternal-decks/data]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const D = process.argv[2] ?? 'games/eternal-decks/data';
const ler = (f) => JSON.parse(readFileSync(join(D, f), 'utf8'));
const gravar = (f, v) => writeFileSync(join(D, f), JSON.stringify(v, null, 1) + '\n');
const cartas = ler('cartas.json');
const eternos = ler('eternos.json');
const campos = ler('campos.json');

const COR = {
  vermelho: '#e5533d',
  azul: '#3b82c4',
  verde: '#3fa34d',
  amarelo: '#d4a017',
  roxo: '#9b6bc9',
};
const bola = (c) => `<span style="color:${COR[c]}">●</span>`;
const mini = (c) => {
  if (c.tipo === 'rare') return '<b>R</b>';
  if (c.tipo === 'habilidade') return '<i>Ability</i>';
  if (c.tipo === 'caveira') return `${bola(c.cores[0])}☠`;
  return `${c.cores.map(bola).join('')}${c.numero}`;
};
const ABILITY = {
  estrela: 'estrela',
  revelar: 'revelar',
  coracao: 'coracao',
  joia: 'joia',
  'rare-do-descarte': 'rare-do-descarte',
  troca: 'troca',
  'rio-2': 'rio-2',
  'compra-3': 'compra-3',
};

for (const e of eternos) {
  const linhas = [`<b>${e.nome}</b> (${e.codigo})`];
  if ('ABC'.includes(e.familia)) {
    linhas.push(`[[curse]]: ${e.curse}.`);
    linhas.push(e.habilidade ? `[[${ABILITY[e.habilidade]}]]` : 'Sem Ability Card.');
    const deck = cartas.filter((c) => c.deck === e.id);
    linhas.push(`Deck: ${deck.map(mini).join(' ')}`);
  } else if (e.familia === 'D') {
    linhas.push(`[[curse-d|Curse]]: ${e.curse}.`);
    const deck = cartas.filter((c) => c.deck === e.id);
    linhas.push(`Deck: ${deck.map(mini).join(' ')}`);
  } else if (e.familia === 'E') {
    linhas.push(`[[curse-e|Curse]]: ${e.curse.replace(/^ao reviver: /, '')}.`);
    linhas.push('Deck: 8 cartas do Random Deck.');
  } else if (e.familia === 'golem') {
    linhas.push('Um dos três Golems do modo solo.');
  } else {
    linhas.push('O Eternal do Stage F.');
  }
  e.descricao = linhas.join('<br>');
}

const DIF = (n) => '✦'.repeat(n);
const REGRA_EXTRA = {
  swamp: ' [[roxo|Roxo]] substitui qualquer cor.',

  'lost-forest': ' [[roxo|Roxo]] substitui a cor.',

  labyrinth: ' Com nº par de cartas na volta, as duas do meio têm o mesmo número.',
};
// das regras comuns, o que continua valendo quando o Field Card muda uma delas
const SUFIXO = {
  castle: ' Das [[regras-comuns]], só a do número vale (mesma cor pode ficar ao lado).',
  'lost-forest': ' Das [[regras-comuns]], só a do número vale (mesma cor pode ficar ao lado).',
  fog: ' Das [[regras-comuns]], só a da cor vale (mesmo número pode ficar ao lado).',
};
for (const c of campos) {
  const camp = c.id.startsWith('camp');
  const texto = (c.texto.charAt(0).toUpperCase() + c.texto.slice(1)).replace(
    'roxo substitui',
    '[[roxo]] substitui',
  );
  c.descricao =
    `<b>${c.nome}</b> <small>${DIF(c.dificuldade)}</small><br>` +
    (camp
      ? 'Só as [[regras-comuns]]. A outra CAMP é o [[camp-bonus]] da 4ª volta do topo.'
      : `[[field-card|Field Card]]: ${texto}.${REGRA_EXTRA[c.id] ?? ''}${SUFIXO[c.id] ?? ' Mais as [[regras-comuns]].'}`);
}

const habilidadeDe = Object.fromEntries(eternos.map((e) => [e.id, e]));
for (const c of cartas) {
  const gk = c.deck === 'gk-1' || c.deck === 'gk-2';
  if (c.id === 'key-bonus-rare') {
    c.descricao = '<b>Key Bonus Rare</b><br>[[key-bonus-rare]]';
  } else if (c.id === 'key-bonus-hearts') {
    c.descricao = '<b>Key Bonus: Hearts</b><br>Ability: recupera todos os [[heart|Hearts]] gastos.';
  } else if (c.tipo === 'rare') {
    c.descricao =
      c.deck === 'river-rare' ? '<b>River Rare</b><br>[[river-rare]]' : '<b>Rare</b><br>[[rare]]';
  } else if (c.tipo === 'caveira-branca') {
    c.descricao = '<b>White Skull</b><br>[[white-skull]]';
  } else if (gk && c.tipo === 'habilidade') {
    c.descricao = `<b>${c.nome}</b><br>[[${c.habilidade}]] · [[gk]]`;
  } else if (gk) {
    c.descricao = `<b>Skull ${c.cores[0]} (GK)</b><br>[[skull]] · [[gk]]`;
  } else if (c.tipo === 'habilidade') {
    const e = habilidadeDe[c.habilidade];
    c.descricao = `<b>Ability Card</b><br>[[${ABILITY[e.habilidade]}]] · [[ability|como usar]]`;
  } else if (c.tipo === 'caveira') {
    c.descricao = `<b>Skull ${c.cores[0]}</b><br>[[skull]]`;
  } else if (c.tipo === 'gameover') {
    c.descricao = '<b>Game Over</b><br>[[game-over]]';
  } else if (c.deck === 'estrela-roxa') {
    c.descricao = `<b>Purple Star ${c.numero}</b><br>Carta [[roxo|roxa]]. No Pro, as roxas 1, 5 e 9 ficam na River Bonus Area no lugar das [[river-rare|River Rares]].`;
  } else if (c.cores.length === 2) {
    c.descricao = `<b>${c.cores.join('/')} ${c.numero}</b><br>[[two-color]]`;
  } else if (c.cores[0] === 'roxo') {
    c.descricao = `<b>roxo ${c.numero}</b><br>[[roxo]]`;
  } else {
    c.descricao = '';
  }
}
// Puzzles (Stage C): o padrão desenhado com quadradinhos de cor
const puzzles = ler('puzzles.json');
for (const p of puzzles) {
  const linhas = p.padrao.map((l) =>
    l.map((c) => (c ? bola(c).replace('●', '■') : '<span style="opacity:.25">□</span>')).join(''),
  );
  p.descricao = `<b>Puzzle nível ${p.nivel}</b><br>${linhas.join('<br>')}<br>[[puzzle]]`;
}
// Tasks (Stage E)
const TEXTO_TAREFA = {
  inicial: (t) =>
    `Na 3ª ou 4ª Star, ter na mão uma carta ${t.cor} de 1 a 5 (Two-Color vale; Rare não).`,
  numero: (t) => `Jogar um ${t.numero} de qualquer cor no Field antes da 3ª Star (Rare não vale).`,
  estrela: () => 'Ganhar uma Star (não vale pela Ability de um A Eternal).',
  joia: () =>
    'Gerar a Jewel de 3 da mesma cor, 3 de cores diferentes ou 3 do mesmo número (a Witch vale).',
  coluna: () =>
    'Jogar a carta que completa uma coluna da mesma cor nas 3 linhas (Rare e Minotaur substituem).',
  'rare-rare': () =>
    'Jogar uma Rare logo à direita de outra Rare na mesma linha (Minotaur e CAMP não valem).',
  'rare-mao': () => 'Ter uma Rare na mão quando a 2ª ou a 4ª Star for ganha.',
  'joia-7-9': () =>
    'Dar uma Jewel ao 7º, 8º ou 9º Eternal da Revival Area (o Golem revivido lá também vale).',
};
const tarefas = ler('tarefas.json');
for (const t of tarefas) t.descricao = `<b>${t.nome}</b><br>${TEXTO_TAREFA[t.tipo](t)}<br>[[task]]`;

gravar('eternos.json', eternos);
gravar('campos.json', campos);
gravar('cartas.json', cartas);
gravar('puzzles.json', puzzles);
gravar('tarefas.json', tarefas);
console.log(
  `descrições: ${eternos.length} Eternals, ${campos.length} Field Cards, ${cartas.filter((c) => c.descricao).length} cartas`,
);
