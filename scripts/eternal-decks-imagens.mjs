// Copia para games/eternal-decks/images/ as imagens que o pacote usa, a partir dos recortes
// (docs/games/eternal_decks/imgs/recortes, gerados pelo recortar.py). A arte é da editora: a pasta
// images/ fica fora do git.
// Uso: node scripts/eternal-decks-imagens.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const JOGO = 'games/eternal-decks';
const RECORTES = 'docs/games/eternal_decks/imgs/recortes';

// todo texto "images/…" no manifest e nos dados é uma imagem do pacote
const textos = [
  readFileSync(join(JOGO, 'manifest.json'), 'utf8'),
  ...readdirSync(join(JOGO, 'data')).map((f) => readFileSync(join(JOGO, 'data', f), 'utf8')),
];
const usadas = new Set();
for (const t of textos) {
  for (const m of t.matchAll(/"images\/([^"{}]+)"/g)) usadas.add(m[1]);
  // modelos com {cor}: images/tokens/disco-{cor}.png
  for (const m of t.matchAll(/"images\/([^"]*\{[^"]+)"/g)) {
    const re = new RegExp('^' + m[1].replace(/[.]/g, '\\.').replace(/\{[^}]+\}/g, '[^/]+') + '$');
    const pasta = dirname(m[1]);
    for (const f of readdirSync(join(RECORTES, pasta))) {
      if (re.test(`${pasta}/${f}`)) usadas.add(`${pasta}/${f}`);
    }
  }
}

let faltam = 0;
for (const rel of [...usadas].sort()) {
  const origem = join(RECORTES, rel);
  if (!existsSync(origem)) {
    console.error(`falta: ${origem}`);
    faltam++;
    continue;
  }
  const destino = join(JOGO, 'images', rel);
  mkdirSync(dirname(destino), { recursive: true });
  copyFileSync(origem, destino);
}
console.log(
  `${usadas.size - faltam} imagens copiadas para ${JOGO}/images${faltam ? `, ${faltam} faltando` : ''}`,
);
if (faltam) process.exit(1);
