import { afterEach } from 'bun:test';
import { health } from './fixtures.ts';

/** Return a JSON response with a non-200 status (e.g. reply(409, { error: 'in_use' })). */
export const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Result = unknown | Response;
type Handler = Result | ((request: Request) => Result | Promise<Result>);
export type Routes = Record<string, Handler>;
export interface FakeApi { requests: Request[]; fetch: typeof fetch }
const nativeFetch = globalThis.fetch;
const active: { unhandled: string[] }[] = [];

/** Stubs /api/v1 requests by "METHOD /path". Missing routes fail the test at teardown. */
export function fakeApi(routes: Routes): FakeApi {
  const requests: Request[] = [], unhandled: string[] = [];
  const fetchStub: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href), init);
    requests.push(request);
    const path = new URL(request.url).pathname + new URL(request.url).search;
    const key = `${request.method} ${path.replace(/^\/api\/v1(?=\/)/, '')}`;
    const handler = Object.hasOwn(routes, key) ? routes[key] : key === 'GET /health' ? health() : undefined;
    if (!path.startsWith('/api/v1/') || handler === undefined) {
      unhandled.push(`${request.method} ${path}`);
      throw new Error(`Unhandled API request: ${request.method} ${path}`);
    }
    const value = typeof handler === 'function' ? await handler(request) : handler;
    return value instanceof Response ? value : reply(200, value);
  }, { preconnect: nativeFetch.preconnect });
  active.push({ unhandled });
  globalThis.fetch = fetchStub;
  return { requests, fetch: fetchStub };
}

afterEach(() => {
  globalThis.fetch = nativeFetch;
  const missing = active.flatMap(api => api.unhandled);
  active.length = 0;
  if (missing.length) throw new Error(`Unhandled API request(s): ${missing.join(', ')}`);
});
