import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  // Camadas isoladas (PlanoReact.md 3.1): o core é TypeScript puro.
  {
    files: ['src/engine/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'react-router',
                '@tanstack/*',
                'konva',
                'react-konva',
                'pixi.js',
                '@pixi/*',
                '@/engine/data',
                '@/engine/data/*',
                '@/engine/react/*',
                '@/engine/render/*',
                '@/games/*',
                '@/pages/*',
              ],
              message: 'engine/core não importa React, dados, render, jogos nem páginas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/engine/react/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'konva',
                'react-konva',
                'pixi.js',
                '@pixi/*',
                '@/engine/render/*',
                '@/games/*',
                '@/pages/*',
              ],
              message: 'engine/react não importa render, jogos nem páginas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/engine/data/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['konva', 'react-konva', '@/engine/render/*', '@/games/*', '@/pages/*'],
              message: 'engine/data não importa render, jogos nem páginas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/engine/package/**/*.{ts,tsx}', 'src/engine/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/games/*', '@/pages/*'],
              message: 'o motor não importa jogos nem páginas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/engine/render/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['zustand', 'zustand/*', '@/games/*', '@/pages/*'],
              message:
                'engine/render usa o estado só pelos hooks de engine/react; não importa jogos nem páginas.',
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
