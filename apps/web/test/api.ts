import { health } from './fixtures.ts';
import { afterEachTest } from './cleanup.ts';

/** Return a JSON response with a non-200 status (e.g. reply(409, { error: 'in_use' })). */
export const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Result = unknown | Response;
type Handler = Result | ((request: Request) => Result | Promise<Result>);
export type Routes = Record<string, Handler>;
export interface ApiRequest { method: string; path: string; body: unknown }
export interface FakeApi { requests: ApiRequest[]; sent(key: string): unknown[]; fetch: typeof fetch }
const nativeFetch = globalThis.fetch;
const active: { unhandled: string[] }[] = [];

/** Stubs /api/v1 requests by "METHOD /path". Missing routes fail the test at teardown. */
export function fakeApi(routes: Routes): FakeApi {
  const requests: ApiRequest[] = [], unhandled: string[] = [];
  const fetchStub: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href), init);
    const path = new URL(request.url).pathname + new URL(request.url).search;
    const apiPath = path.replace(/^\/api\/v1(?=\/)/, '');
    requests.push({ method: request.method, path: apiPath, body: request.body === null ? undefined : await request.clone().json() });
    const key = `${request.method} ${apiPath}`;
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
  return { requests, sent: key => requests.filter(request => `${request.method} ${request.path}` === key && request.body !== undefined).map(request => request.body), fetch: fetchStub };
}

afterEachTest(() => {
  globalThis.fetch = nativeFetch;
  const missing = active.flatMap(api => api.unhandled);
  active.length = 0;
  if (missing.length) throw new Error(`Unhandled API request(s): ${missing.join(', ')}`);
});
