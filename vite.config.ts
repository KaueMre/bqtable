/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Política de segurança da página do jogo (frame.html), que roda o regras.js de quem fez o pacote.
 * Junto com o iframe sandbox (origem opaca), o código do jogo não alcança o site. Só no build: no
 * dev o Vite injeta scripts inline. Imagens e dados podem vir de qualquer URL (`assets.base`).
 */
const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'", // 'unsafe-eval': o regras.js vira função dentro do iframe
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  "connect-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function frameCsp(): Plugin {
  return {
    name: 'bqtable-frame-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      if (!ctx.filename.endsWith('frame.html')) return html;
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), frameCsp()],
  resolve: {
    alias: { '@': root('./src') },
  },
  build: {
    rolldownOptions: {
      // o site e a página isolada onde o jogo roda
      input: { main: root('./index.html'), frame: root('./frame.html') },
    },
  },
  server: {
    // o iframe do jogo tem origem opaca ("null"): sem CORS ele não carrega os módulos do dev server.
    // Em produção, /assets vai com Access-Control-Allow-Origin (public/_headers, do Cloudflare Pages).
    cors: true,
  },
  test: {
    // os exemplos importam do motor como um repositório de jogo (docs/engine/SDK.md), mas aqui
    // direto do fonte, sem precisar do build da SDK
    alias: {
      'bqtable/sdk': root('./src/sdk/index.ts'),
      'bqtable/testing': root('./src/sdk/testing.ts'),
    },
    // *.test.ts roda em Node puro (core, regras, e as regras dos exemplos em examples/);
    // *.test.tsx roda com DOM (componentes).
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup-dom.ts'],
        },
      },
    ],
  },
});
