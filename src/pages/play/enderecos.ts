/**
 * Endereços de jogo colados pelo jogador. Links de página do GitHub (`/blob/`, `/raw/`, `/tree/`)
 * viram o arquivo cru em raw.githubusercontent.com, que manda CORS. Links que o site não consegue
 * baixar (Releases) viram um motivo legível, sem tentar buscar.
 */

/** O endereço a baixar, ou por que não dá para baixar dele. */
export type Endereco = { url: string } | { erro: string };

const RAW = 'https://raw.githubusercontent.com';

const RELEASE =
  'Link de Release do GitHub: o GitHub não manda o cabeçalho de CORS nesses downloads, então o ' +
  'site não consegue baixar o arquivo. Publique o jogo no GitHub Pages ou use o link do arquivo ' +
  'no repositório (blob ou raw).';

/** Hosts para onde os downloads de Release redirecionam (também sem CORS). */
const HOSTS_RELEASE = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'];

/** Troca links de página do GitHub pelo arquivo cru; outros endereços passam como vieram. */
export function normalizarUrl(entrada: string): Endereco {
  const texto = entrada.trim();
  let url: URL;
  try {
    // "github.com/..." colado sem o https://
    url = new URL(/^(www\.)?github\.com\//i.test(texto) ? `https://${texto}` : texto);
  } catch {
    return { url: texto }; // relativo ao site (os exemplos: "/exemplos/...")
  }
  const host = url.hostname.toLowerCase();
  if (HOSTS_RELEASE.includes(host)) return { erro: RELEASE };
  if (host !== 'github.com' && host !== 'www.github.com') return { url: texto };

  const [dono, repo, tipo, ...resto] = url.pathname.split('/').filter(Boolean);
  if (tipo === 'releases') return { erro: RELEASE };
  // resto = ref + caminho; a ref pode ser "refs/heads/main" (o botão Raw do GitHub), o raw aceita
  if (dono && repo && (tipo === 'blob' || tipo === 'raw') && resto.length >= 2) {
    return { url: `${RAW}/${dono}/${repo}/${resto.join('/')}` };
  }
  // pasta do jogo (a forma sem zip): o manifest.json dela
  if (dono && repo && tipo === 'tree' && resto.length >= 1) {
    return { url: `${RAW}/${dono}/${repo}/${resto.join('/')}/manifest.json` };
  }
  return {
    erro:
      `${texto} é uma página do GitHub, não um arquivo. Abra o .bqgame (ou o manifest.json) no ` +
      'GitHub e copie o endereço dessa página.',
  };
}

const GH = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/@]+))?\/(.+)$/;

/**
 * O atalho `?gh=<dono>/<repo>@<ref>/<caminho>` → o arquivo cru no GitHub. Sem `@<ref>`, vale
 * `main`; a ref não pode ter `/`. Caminho terminado em `/` é uma pasta: abre o `manifest.json` dela.
 */
export function urlDoGh(gh: string): Endereco {
  const m = GH.exec(gh.trim());
  if (!m) {
    return {
      erro:
        `?gh=${gh}: use dono/repositório@ref/caminho do arquivo, por exemplo ` +
        'KaueMre/bqtable@main/public/exemplos/piramide.bqgame (sem @ref, vale main).',
    };
  }
  const [, dono, repo, ref = 'main', caminho] = m;
  const arquivo = caminho!.endsWith('/') ? `${caminho}manifest.json` : caminho;
  return { url: `${RAW}/${dono}/${repo}/${ref}/${arquivo}` };
}
