import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountingDatabase } from 'print-accounting-database';
import { AccountingService, CollectionBusyError } from '../apps/server/src/service.ts';
import { apiFixture } from './api-fixtures.ts';
import type { AllocationPreview, InkResponse, InkSetPurchaseResult, JobsResponse, LedgerJob, MediaTypesResponse, PapersResponse, TotalsResponse } from 'print-accounting-contracts';
import { batch, MEDIA, sample } from './fixtures.ts';
const options = { host: '127.0.0.1', cacheDirectory: '/unused' };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-api-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return db;
}
test('collection failure records safe category, releases lock and does not persist raw errors', async t => {
  const db = fixture(t);
  const service = new AccountingService(db, async () => { throw new Error('synthetic-secret-that-must-not-persist'); });
  await assert.rejects(service.collect(options, async () => 'synthetic password'));
  assert.equal(service.busy, false);
  const rows = db.all('SELECT * FROM import_runs');
  assert.equal(rows[0].error_code, 'collection_failed'); assert.equal(rows[0].status, 'failed');
  assert.ok(!JSON.stringify(rows).includes('synthetic-secret'));
});
test('simultaneous collections share one service lock', async t => {
  const db = fixture(t);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const service = new AccountingService(db, async () => { await barrier; return sample(); });
  const password = async () => 'synthetic password';
  const first = service.collect(options, password);
  await assert.rejects(service.collect(options, password), CollectionBusyError);
  release(); assert.equal((await first).result.new_jobs, 1);
  assert.equal(db.summary().import_runs, 1);
});
test('API validates annotations, keeps hidden jobs accessible and returns safe collection failures', async t => {
  const f = await apiFixture(t, { collector: async () => { throw new Error('secret printer data'); }, inspectRoot: async () => { throw new Error('offline'); } });
  f.db.importSnapshot(sample());
  const request = (path: string, method = 'GET', body?: unknown) => f.request('/api/v1' + path, { method, body });
  assert.equal((await request('/jobs?limit=1001')).status, 400);
  assert.equal((await request('/jobs/999')).status, 404);
  const patch = (body: unknown) => request('/jobs/1/annotation', 'PATCH', body);
  assert.equal((await patch({ media_config_id: 99 })).status, 400);
  assert.equal((await patch({ physical_sheet_count: 1 })).status, 400);
  assert.equal((await patch({ custom_paper_name: 'Sample sheet', hidden: 1 })).status, 200);
  assert.equal((await request('/jobs')).json<{ jobs: unknown[] }>().jobs.length, 0);
  assert.equal((await request('/jobs?includeHidden=true')).json<{ jobs: unknown[] }>().jobs.length, 1);
  const detail = (await request('/jobs/1')).json<{ job: { display_paper_name: string; ink: unknown[] } }>();
  assert.equal(detail.job.display_paper_name, 'Sample sheet'); assert.equal(detail.job.ink.length, 2);
  assert.equal((await request('/collect', 'POST', {})).status, 404);
  const printer = await f.addPrinter('10.23.45.67', 'synthetic password');
  const collection = await request(`/known-printers/${printer.id}/collect`, 'POST', {});
  assert.equal(collection.status, 502); assert.deepEqual(collection.json(), { error: 'printer_unreachable' });
  assert.ok(!collection.text.includes('secret printer data'));
  assert.equal(f.db.get('SELECT status FROM import_runs ORDER BY id DESC')!.status, 'failed');
});
test('GET /jobs filters before pagination and counts only the selected archived printer', async t => {
  const f = await apiFixture(t);
  const older = sample();
  older.printer = { host: '192.0.2.11', mac: '020000000002' };
  older.media_catalogue!.printer_mac = older.printer.mac;
  f.db.importSnapshot(older); // Printer B's only job has id 1; A's later jobs occupy the first page.
  f.db.importSnapshot(batch([{ day: '2026-09-02' }, { day: '2026-09-03' }]));
  const jobs = async (query: string) => f.request('/api/v1/jobs?' + query);
  const firstPage = (await jobs('limit=1')).json<JobsResponse>();
  assert.deepEqual([firstPage.total, firstPage.jobs[0].printer_id], [3, 2]);
  const selected = (await jobs('printer=1&limit=1')).json<JobsResponse>();
  assert.deepEqual([selected.total, selected.jobs.length, selected.jobs[0].job_id, selected.jobs[0].printer_id], [1, 1, 1, 1]);
  assert.deepEqual((await jobs('printer=2&limit=1')).json<JobsResponse>().jobs.map(job => job.job_id), [3]);
  const missing = (await jobs('printer=999&limit=1')).json<JobsResponse>();
  assert.deepEqual([missing.jobs, missing.total], [[], 0]);
  for (const value of ['', '0', '-1', '1.5', '1e2', 'nope', '9007199254740992', '1&printer=2']) {
    const response = await jobs('printer=' + value);
    assert.deepEqual([response.status, response.json()], [400, { error: 'invalid_request' }], value);
  }
});

test('API manages papers, stock, purchases, ink and write-offs and returns costed, searchable jobs', async t => {
  const f = await apiFixture(t), db = f.db;
  db.importSnapshot(batch([{ day: '2026-02-01' }, { day: '2026-02-02', imp: 2 }]));
  const call = async (method: string, path: string, body?: unknown) => {
    const reply = await f.request('/api/v1' + path, { method, body });
    return { status: reply.status, body: reply.json<Record<string, never>>() };
  };
  const created = async (path: string, body: unknown) => { const reply = await call('POST', path, body); assert.equal(reply.status, 201, JSON.stringify(reply.body)); return reply.body.id as number; };
  const paper = await created('/papers', { name: 'Museum Etching', media_types: [MEDIA] });
  const a4 = await created('/paper-stocks', { paper_id: paper, name: 'A4', format: 'sheet', width_um: 210000, height_um: 297000 });
  await created('/paper-purchases', { paper_stock_id: a4, purchased_on: '2026-01-01', packs: 2, sheets_per_pack: 25, price_micros: 50_000_000 });
  const cyan = await created('/ink-cartridges', { name: 'PFI-1000 C', channel: 'C', capacity_nl: 80_000_000 });
  await created('/ink-purchases', { ink_product_id: cyan, purchased_on: '2026-01-01', cartridges: 1, price_micros: 40_000_000 });
  const off = await created('/write-offs', { paper_stock_id: a4, written_off_on: '2026-02-03', quantity: 3, reason: 'Creased' });
  assert.equal((await call('POST', '/paper-purchases', { paper_stock_id: a4, purchased_on: '2026-01-01', length_um: 5, price_micros: 1 })).status, 400);
  assert.equal((await call('POST', '/papers', { name: 'Museum Etching' })).status, 409);
  assert.equal((await call('POST', '/papers', { name: 'Extra', unexpected: true })).status, 400);
  assert.equal((await call('DELETE', '/paper-stocks/' + a4)).status, 409);
  assert.equal((await call('PATCH', '/papers/999', { name: 'Missing' })).status, 404);
  assert.equal((await call('POST', '/unknown-things', {})).status, 404);
  assert.deepEqual((await call('PATCH', '/write-offs/' + off, { quantity: 4 })).body, { updated: true });
  const detail = (await call('GET', '/jobs/2')).body.job as unknown as LedgerJob;
  assert.deepEqual([detail.paper.stock_id, detail.paper.cost_micros, detail.total_micros], [a4, 2_000_000, 2_000_000 + 62_500]);
  assert.equal((await call('PATCH', '/jobs/2/annotation', { notes: 'Edition 1/10' })).status, 200);
  const search = (await call('GET', '/jobs?q=EDITION')).body as unknown as JobsResponse;
  assert.deepEqual([search.total, search.jobs[0].job_id, search.settings.currency], [1, 2, 'GBP']);
  assert.deepEqual((await call('PATCH', '/settings', { costing_method: 'max' })).body, { costing_method: 'max', currency: 'GBP' });
  assert.equal((await call('PATCH', '/settings', { currency: 'gbp' })).status, 400);
  const totals = (await call('GET', '/totals')).body as unknown as TotalsResponse;
  assert.deepEqual([totals.overall.jobs, totals.overall.paper_micros, totals.overall.waste_micros], [2, 3_000_000, 4_000_000]);
  const papers = (await call('GET', '/papers')).body as unknown as PapersResponse;
  assert.equal(papers.papers[0].stock[0].remaining, 50 - 3 - 4);
  assert.equal(((await call('GET', '/ink')).body as unknown as InkResponse).cartridges[0].remaining, 80_000_000 - 2 * 125_000);
  assert.equal(((await call('GET', '/media-types')).body as unknown as MediaTypesResponse).media_types[0].papers[0].id, paper);
  assert.deepEqual((await call('DELETE', '/write-offs/' + off)).body, { deleted: true });
});
test('a purchase is set up with its new stock, paper or cartridge in one go or not at all; previews and ink totals come from the ledger', async t => {
  const f = await apiFixture(t), db = f.db;
  db.importSnapshot(batch([{ day: '2026-02-01' }, { day: '2026-02-02', imp: 2 }]));
  const call = async (method: string, path: string, body?: unknown) => {
    const reply = await f.request('/api/v1' + path, { method, body });
    return { status: reply.status, body: reply.json<Record<string, unknown>>() };
  };
  const purchase = { purchased_on: '2026-01-01', packs: 1, sheets_per_pack: 25, price_micros: 25_000_000 };
  const a4 = { name: 'A4', format: 'sheet', width_um: 210000, height_um: 297000 };
  // A roll bought in packs fails at the last step: neither the paper nor its stock is left behind, so a retry just works.
  const failed = await call('POST', '/paper-purchases/setup', { paper: { name: 'Museum Etching', media_types: [MEDIA] }, stock: { name: '17" roll', format: 'roll', width_um: 431800 }, purchase });
  assert.deepEqual([failed.status, failed.body.error], [400, 'purchase_does_not_match_stock']);
  assert.deepEqual([db.all('SELECT * FROM papers').length, db.all('SELECT * FROM paper_stocks').length], [0, 0]);
  const made = await call('POST', '/paper-purchases/setup', { paper: { name: 'Museum Etching', media_types: [MEDIA] }, stock: a4, purchase });
  assert.equal(made.status, 201);
  const { paper_id, paper_stock_id } = made.body as { paper_id: number; paper_stock_id: number };
  const again = await call('POST', '/paper-purchases/setup', { paper_stock_id, purchase: { ...purchase, purchased_on: '2026-03-01' } });
  assert.deepEqual([again.status, again.body.paper_id, again.body.paper_stock_id], [201, paper_id, paper_stock_id]);
  assert.equal((await call('POST', '/paper-purchases/setup', { paper_id, paper_stock_id, purchase })).status, 400, 'a stock item or a new one, not both');
  assert.equal((await call('POST', '/paper-purchases/setup', { paper_id: 999, stock: a4, purchase })).status, 400);
  assert.equal(db.all('SELECT * FROM paper_stocks').length, 1);

  // "Everything left" as of a day: the open pack then, and all that was left of the item then.
  const preview = (query: string) => call('GET', '/write-offs/preview?' + query);
  assert.deepEqual((await preview(`paper_stock_id=${paper_stock_id}&written_off_on=2026-02-15`)).body, { written_off: 22, cost_micros: 22_000_000, remaining: 22 });
  assert.deepEqual((await preview(`paper_stock_id=${paper_stock_id}&written_off_on=2026-03-01`)).body, { written_off: 22, cost_micros: 22_000_000, remaining: 47 });
  assert.equal((await preview(`paper_stock_id=999&written_off_on=2026-03-01`)).status, 404);
  assert.equal((await preview(`paper_stock_id=${paper_stock_id}&written_off_on=soon`)).status, 400);

  // A new cartridge fails with its purchase (no price), then succeeds; totals leave hidden prints out.
  assert.equal((await call('POST', '/ink-purchases/setup', { cartridge: { name: 'PFI-1000 C', channel: 'C', capacity_nl: 80_000_000 }, purchase: { purchased_on: '2026-01-01', cartridges: 1 } })).status, 400);
  assert.equal(db.all('SELECT * FROM ink_products').length, 0);
  const ink = await call('POST', '/ink-purchases/setup', { cartridge: { name: 'PFI-1000 C', channel: 'C', capacity_nl: 80_000_000 }, purchase: { purchased_on: '2026-01-01', cartridges: 1, price_micros: 40_000_000 } });
  assert.equal(ink.status, 201);
  assert.equal((await call('GET', `/write-offs/preview?ink_product_id=${ink.body.ink_product_id}&written_off_on=2026-02-03`)).body.written_off, 80_000_000 - 2 * 125_000);
  await call('PATCH', '/jobs/1/annotation', { hidden: 1 });
  const totals = ((await call('GET', '/ink')).body as unknown as InkResponse).totals, overall = ((await call('GET', '/totals')).body as unknown as TotalsResponse).overall;
  assert.deepEqual([totals.jobs, totals.ink_micros, totals.waste_micros], [1, overall.ink_micros, 0]);
  const papers = ((await call('GET', '/papers')).body as unknown as PapersResponse).papers;
  assert.deepEqual([papers[0].totals.jobs, papers[0].totals.unknown_paper_jobs], [1, 0]);
});
test('API adds a whole ink set in one request: the price split by capacity, missing products created, or nothing on failure', async t => {
  const f = await apiFixture(t);
  const call = async (body: unknown) => { const reply = await f.request('/api/v1/ink-purchases/set', { method: 'POST', body }); return { status: reply.status, body: reply.json() }; };
  const cyan = (await f.request('/api/v1/ink-cartridges', { method: 'POST', body: { name: 'PFI-3100 C', channel: 'C', capacity_nl: 160_000_000 } })).json<{ id: number }>().id;
  const body = { ink_product_ids: [cyan], new_cartridges: { series: 'PFI-4100', capacity_nl: 80_000_000, channels: ['PM', 'R'] }, purchased_on: '2026-03-01', sets: 1, price_micros: 100_000_000 };
  assert.deepEqual((await call({ ...body, ink_product_ids: [cyan, 999] })), { status: 400, body: { error: 'unknown_reference' } });
  assert.equal((await call({ ...body, sets: 0 })).status, 400);
  assert.equal(f.db.all('SELECT * FROM ink_purchases').length + f.db.all('SELECT * FROM ink_products').length, 1, 'nothing was written');
  const saved = await call(body);
  assert.equal(saved.status, 201);
  assert.deepEqual((saved.body as unknown as InkSetPurchaseResult).purchases.map(p => [p.channel, p.price_micros]), [['C', 50_000_000], ['PM', 25_000_000], ['R', 25_000_000]]);
  const ink = (await f.request('/api/v1/ink')).json<InkResponse>();
  assert.deepEqual(ink.cartridges.map(c => [c.name, c.purchases.map(p => p.price_micros)]), [['PFI-3100 C', [50_000_000]], ['PFI-4100 PM', [25_000_000]], ['PFI-4100 R', [25_000_000]]]);
});
test('an allocation preview costs a job as corrected to a paper or stock item without saving it, and says when stock runs short', async t => {
  const f = await apiFixture(t);
  f.db.importSnapshot(batch([{ day: '2026-02-01' }, { day: '2026-02-02', imp: 2 }]));
  const call = async (method: string, path: string, body?: unknown) => {
    const reply = await f.request('/api/v1' + path, { method, body });
    return { status: reply.status, body: reply.json<Record<string, number>>() };
  };
  const created = async (path: string, body: unknown) => { const reply = await call('POST', path, body); assert.equal(reply.status, 201, JSON.stringify(reply.body)); return reply.body.id; };
  const preview = async (query: string) => (await f.request('/api/v1/jobs/2/allocation-preview?' + query)).json<AllocationPreview>();
  const paper = await created('/papers', { name: 'Photo Rag' });
  await created('/paper-stocks', { paper_id: paper, name: 'A3', format: 'sheet', width_um: 297000, height_um: 420000 });
  const none = await preview(`paper_id=${paper}`);
  assert.deepEqual([none.paper.unknown_reason, none.paper.stock_id, none.sized_stock_id, none.short], ['no_matching_stock', null, null, false]);

  const a4 = await created('/paper-stocks', { paper_id: paper, name: 'A4', format: 'sheet', width_um: 210000, height_um: 297000 });
  const buy = (purchased_on: string, sheets: number) => created('/paper-purchases', { paper_stock_id: a4, purchased_on, packs: 1, sheets_per_pack: sheets, price_micros: sheets * 1_000_000 });
  await buy('2026-03-01', 25);
  const late = await preview(`paper_id=${paper}`);
  assert.deepEqual([late.paper.unknown_reason, late.paper.cost_micros, late.sized_stock_id, late.short], ['no_stock_by_date', null, a4, false]);

  await buy('2026-01-01', 1); // One sheet by then, and the print used two.
  const short = await preview(`paper_id=${paper}`);
  assert.deepEqual([short.paper.stock_id, short.paper.cost_micros, short.remaining, short.short, short.sized_stock_id], [a4, 2_000_000, 1, true, a4]);

  await buy('2026-01-15', 25);
  const fine = await preview(`paper_stock_id=${a4}`);
  assert.deepEqual([fine.paper.allocation, fine.paper.unknown_reason, fine.remaining, fine.short], ['stock', null, 26, false]);

  const job = (await call('GET', '/jobs/2')).body.job as unknown as LedgerJob; // Nothing was saved.
  assert.deepEqual([job.paper.allocation, job.paper_override_id, job.stock_override_id], ['default', null, null]);
  for (const query of ['', `paper_id=${paper}&paper_stock_id=${a4}`, 'paper_id=abc', 'paper_id=0', `paper_id=${paper}&extra=1`])
    assert.equal((await f.request('/api/v1/jobs/2/allocation-preview?' + query)).status, 400, query);
  assert.equal((await f.request('/api/v1/jobs/2/allocation-preview?paper_id=999')).status, 404);
  assert.deepEqual((await f.request(`/api/v1/jobs/999/allocation-preview?paper_id=${paper}`)).json(), { error: 'job_not_found' });
});
