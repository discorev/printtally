import { afterEach } from 'bun:test';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render as renderUi, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { routeTree } from '../src/routeTree.gen.ts';
import { createQueryClient } from '../src/api/queries.ts';
import { connection } from '../src/connection/index.ts';
import type { FakeApi } from './api.ts';

const clients: QueryClient[] = [];
const providers = (ui: ReactElement) => {
  const client = createQueryClient();
  clients.push(client);
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
};

/** Render a leaf with the same connection monitor and fresh query provider as the routed app. */
export async function render(ui: ReactElement, api: FakeApi) {
  globalThis.fetch = api.fetch;
  await connection.check();
  return { ...renderUi(providers(ui)), screen, user: userEvent.setup() };
}

/** Render the real route tree, shell and connection gate from a memory URL. */
export async function renderApp(url: string, api: FakeApi) {
  globalThis.fetch = api.fetch;
  await connection.check();
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [url] }), defaultPreload: 'intent', scrollRestoration: false });
  return { ...renderUi(providers(<RouterProvider router={router} />)), screen, user: userEvent.setup(), router };
}

afterEach(() => {
  cleanup();
  connection.stop();
  connection.reset();
  for (const client of clients) client.clear();
  clients.length = 0;
  localStorage.clear();
});
