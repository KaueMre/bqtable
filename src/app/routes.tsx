import type { RouteObject } from 'react-router';
import { Layout } from '@/app/Layout';
import { HomePage } from '@/pages/home/HomePage';
import { PlayPage } from '@/pages/play/PlayPage';
import { LoadTestPage } from '@/pages/sandbox/LoadTestPage';
import { SandboxPage } from '@/pages/sandbox/SandboxPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'jogar', element: <PlayPage /> },
      {
        path: 'sandbox',
        children: [
          { index: true, element: <SandboxPage /> },
          { path: 'carga', element: <LoadTestPage /> },
        ],
      },
    ],
  },
];
