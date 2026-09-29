import { expect, test } from 'bun:test';
import type { HealthResponse } from 'print-accounting-contracts';
import { ApiError, onRequestOutcome, request, setEditGate } from '../api/client.ts';
import { ConnectionMonitor } from './monitor.ts';
import { backoffMs, canEdit } from './state.ts';

const health: HealthResponse = {
  service: 'printtally', apiVersion: 1, hostName: 'studio-mac', collecting: false, state: 'ready',
  printers: [], missedJobs: [], lastCollection: null, nextCollectionAt: null,
};
// A monitor on a fake clock whose health check answers from `server`.
function fixture() {
  let now = 1_000_000;
  const timers: { at: number; run: () => void }[] = [];
  const server = { up: true, status: 200 };
  const fetchHealth = async (): Promise<HealthResponse> => {
    if (server.status === 401) throw new ApiError('unauthorized', 'unauthorized', 401);
    if (!server.up) throw new ApiError('unreachable', "Can't reach Print Tally.");
    return health;
  };
  const monitor = new ConnectionMonitor({
    fetchHealth, pollMs: 10_000, now: () => now,
    setTimer: (run, ms) => { const timer = { at: now + ms, run }; timers.push(timer); return timer; },
    clearTimer: timer => { const i = timers.indexOf(timer as (typeof timers)[number]); if (i >= 0) timers.splice(i, 1); },
  });
  // Runs the next timer, as if that much time had passed.
  const advance = async () => {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    if (!timer) throw new Error('nothing scheduled');
    now = timer.at; timer.run(); await monitor.check();
  };
  const nextDelay = () => Math.min(...timers.map(timer => timer.at)) - now;
  return { monitor, server, advance, nextDelay, timers };
}
const answering = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('backoff doubles from a second and caps at thirty', () => {
  expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('a lost server blocks edits before sending, retries with backoff, and recovers on its own', async () => {
  const { monitor, server, advance, nextDelay } = fixture();
  const seen: string[] = [];
  monitor.subscribe(state => seen.push(state.status));
  onRequestOutcome(outcome => monitor.report(outcome));
  setEditGate(monitor.canEdit);

  await monitor.check();
  expect([monitor.getState().status, monitor.canEdit(), nextDelay()]).toEqual(['connected', true, 10_000]);

  // A read fails because the server went away: the client is lost and loaded data is read-only.
  server.up = false;
  await expect(request('GET', '/jobs', { fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'unreachable' });
  expect([monitor.getState().status, canEdit(monitor.getState()), nextDelay()]).toEqual(['lost', false, 1000]);
  expect(monitor.getState().health?.hostName).toBe('studio-mac');

  // An edit while lost is refused and never sent or queued.
  let sent = 0;
  const counting = (async () => { sent++; return new Response('{}'); }) as unknown as typeof fetch;
  const refused = await request('PATCH', '/jobs/1/annotation', { body: { notes: 'x' }, fetchFn: counting }).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(ApiError);
  expect([(refused as ApiError).kind, (refused as ApiError).message, sent]).toEqual(['paused', 'Not saved. Editing is paused until the server is back.', 0]);

  await advance();
  expect([monitor.getState().status, monitor.getState().failures, nextDelay()]).toEqual(['lost', 2, 2000]);
  await advance();
  expect(nextDelay()).toBe(4000);

  server.up = true;
  await advance();
  expect([monitor.getState().status, monitor.canEdit(), monitor.getState().failures, nextDelay()]).toEqual(['connected', true, 0, 10_000]);
  expect(seen).toEqual(['connected', 'lost', 'lost', 'lost', 'connected']);

  // Edits go through again.
  await expect(request('PATCH', '/jobs/1/annotation', { body: { notes: 'x' }, fetchFn: counting })).resolves.toEqual({});
  expect(sent).toBe(1);
  monitor.stop();
});

test('an edit in flight when the server goes away fails clearly and marks it lost', async () => {
  const { monitor } = fixture();
  onRequestOutcome(outcome => monitor.report(outcome));
  setEditGate(monitor.canEdit);
  await monitor.check();
  const dropped = (async () => { throw new TypeError('socket hang up'); }) as unknown as typeof fetch;
  await expect(request('POST', '/paper-purchases', { body: {}, fetchFn: dropped })).rejects.toMatchObject({ kind: 'unreachable', message: "Not saved. Can't reach Print Tally; try again when it's back." });
  expect(monitor.getState().status).toBe('lost');
  monitor.stop();
});

test('a non-JSON answer (a dev proxy with nothing behind it) counts as unreachable; a JSON error does not', async () => {
  const { monitor } = fixture();
  onRequestOutcome(outcome => monitor.report(outcome));
  setEditGate(() => true);
  await monitor.check();
  await expect(request('GET', '/papers', { fetchFn: answering({ error: 'not_found' }, 404) })).rejects.toMatchObject({ kind: 'rejected', code: 'not_found', status: 404 });
  expect(monitor.getState().status).toBe('connected');
  const proxy = (async () => new Response('Bad gateway', { status: 502 })) as unknown as typeof fetch;
  await expect(request('GET', '/papers', { fetchFn: proxy })).rejects.toMatchObject({ kind: 'unreachable' });
  expect(monitor.getState().status).toBe('lost');
  monitor.stop();
});

test('a revoked session (401) stops retrying and asks to connect again', async () => {
  const { monitor, server, timers } = fixture();
  onRequestOutcome(outcome => monitor.report(outcome));
  await monitor.check();
  server.status = 401;
  await expect(request('GET', '/jobs', { fetchFn: answering({ error: 'unauthorized' }, 401) })).rejects.toMatchObject({ kind: 'unauthorized' });
  expect([monitor.getState().status, monitor.canEdit()]).toEqual(['unauthorized', false]);
  await monitor.check();
  expect([monitor.getState().status, timers.length]).toEqual(['unauthorized', 0]);
});

test('edits are validated with the contract schema before sending', async () => {
  const { annotationSchema } = await import('print-accounting-contracts');
  setEditGate(() => true);
  let sent = 0;
  const counting = (async () => { sent++; return new Response('{}'); }) as unknown as typeof fetch;
  await expect(request('PATCH', '/jobs/1/annotation', { body: {}, schema: annotationSchema, fetchFn: counting })).rejects.toMatchObject({ kind: 'invalid' });
  expect(sent).toBe(0);
});
