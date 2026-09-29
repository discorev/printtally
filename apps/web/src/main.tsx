import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen.ts';
import { queryClient } from './api/queries.ts';
import { connection } from './connection/index.ts';
import { desktop } from './desktop.ts';
import './styles.css';

const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: false });
declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

// Inside Electron the window has no title bar: the top bar makes room for the traffic lights and drags the window.
if (desktop) document.documentElement.dataset.desktop = '';
void connection.check();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
