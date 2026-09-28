import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountingDatabase } from 'print-accounting-database';
import { AccountingService, CollectionBusyError } from '../apps/server/src/service.ts';
import { createApi } from '../apps/server/src/http.ts';
import { sample } from './fixtures.ts';
const options = { host: '127.0.0.1', cacheDirectory: '/unused' };
const token = 'synthetic-test-token-with-at-least-32-characters';
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-api-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return db;
}
test('collection failure records safe category, releases lock and does not persist raw errors', async t => {
  const db = fixture(t);
  const service = new AccountingService(db, async () => 'synthetic password', async () => { throw new Error('synthetic-secret-that-must-not-persist'); });
  await assert.rejects(service.collect(options));
  assert.equal(service.busy, false);
  const rows = db.all('SELECT * FROM import_runs');
  assert.equal(rows[0].error_code, 'collection_failed'); assert.equal(rows[0].status, 'failed');
  assert.ok(!JSON.stringify(rows).includes('synthetic-secret'));
});
test('simultaneous collections share one service lock', async t => {
  const db = fixture(t);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const service = new AccountingService(db, async () => 'synthetic password', async () => { await barrier; return sample(); });
  const first = service.collect(options);
  await assert.rejects(service.collect(options), CollectionBusyError);
  release(); assert.equal((await first).result.new_jobs, 1);
  assert.equal(db.summary().import_runs, 1);
});
test('API authenticates, validates annotations, keeps hidden jobs accessible and returns safe failures', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-http-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  db.importSnapshot(sample());
  const service = new AccountingService(db, async () => 'synthetic password', async () => { throw new Error('secret printer data'); });
  const server = createApi(service, token, options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = 'http://127.0.0.1:' + address.port;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true }); });
  const request = (path: string, init: RequestInit = {}) => fetch(url + '/api/v1' + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...init.headers } });
  assert.equal((await fetch(url + '/api/v1/health')).status, 401);
  assert.equal((await request('/health', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(url + '/api/v1/health', { headers: { Host: 'unrelated.example', Authorization: 'Bearer ' + token } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(rebindingStatus, 403);
  assert.deepEqual(await (await request('/health')).json(), { apiVersion: 1, collecting: false });
  assert.equal((await request('/jobs?limit=1001')).status, 400);
  assert.equal((await request('/jobs/999')).status, 404);
  const patch = (body: unknown) => request('/jobs/1/annotation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await patch({ media_config_id: 99 })).status, 400);
  assert.equal((await patch({ paper_cost_override_micros: 1000000 })).status, 400);
  assert.equal((await patch({ custom_paper_name: 'Sample sheet', hidden: 1 })).status, 200);
  assert.equal(((await (await request('/jobs')).json()) as { jobs: unknown[] }).jobs.length, 0);
  assert.equal(((await (await request('/jobs?includeHidden=true')).json()) as { jobs: unknown[] }).jobs.length, 1);
  const detail = await (await request('/jobs/1')).json() as { job: { display_paper_name: string }; ink: unknown[] };
  assert.equal(detail.job.display_paper_name, 'Sample sheet'); assert.equal(detail.ink.length, 2);
  const collection = await request('/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(collection.status, 502); assert.deepEqual(await collection.json(), { error: 'collection_failed' });
  assert.equal(db.get('SELECT status FROM import_runs ORDER BY id DESC')!.status, 'failed');
});
