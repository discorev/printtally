import type { HealthResponse } from 'print-accounting-contracts';

// The UI never talks to the printer, SQL or credentials directly (see ARCHITECTURE.md);
// every result comes from this API, proxied at /api in dev (vite.config.ts) and served
// by the same origin in production.
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  health: (): Promise<HealthResponse> => get('/health'),
};
