import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountingDatabase, KnownPrinters, Ledger } from 'print-accounting-database';
import { batch } from './fixtures.ts';
import { apiFixture } from './api-fixtures.ts';

const GBP = 1_000_000, ml = 1_000_000;
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-cartridges-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return { db, ledger: new Ledger(db) };
}
function stock(ledger: Ledger, series = 'PFI-4100', count = 3) {
  const product = ledger.createCartridge({ name: `${series} C`, channel: 'C', capacity_nl: ml });
  const purchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-01', cartridges: count, price_micros: count * 10 * GBP });
  return { product, purchase };
}
const snapshot = (days: string[], at: string, count: number, mac = '020000000001') => {
  const input = batch(days.map(day => ({ day, ink: 500 })));
  input.collected_at = at; input.printer.mac = mac; input.media_catalogue = undefined;
  input.inks = [{ channel: 'C', series: 'PFI-4100', level: 60, replacement_count: count }];
  return input;
};

test('reading swap follows requested_last by record ID, even when job local clock goes backwards', t => {
  const { db, ledger } = fixture(t);
  db.importSnapshot(snapshot(['2026-02-10'], '2026-02-01T12:00:00Z', 8));
  const { purchase } = stock(ledger);
  assert.equal(ledger.job(1)!.job.ink[0].from[0].index, 1, 'first reading is only a baseline');
  db.importSnapshot(snapshot(['2026-02-10', '2026-02-01'], '2026-02-02T12:00:00Z', 9));
  assert.equal(ledger.job(2)!.job.ink[0].from[0].index, 2);
  assert.equal(ledger.job(1)!.job.ink[0].from[0].index, 1);
  assert.equal(ledger.ink().cartridges[0].units.find(unit => unit.purchase_id === purchase && unit.index === 1)!.waste_nl, 500_000);
  assert.equal(ledger.totals().overall.waste_micros, 5 * GBP);
});

test('a later observation with no device details does not prevent a newer identification from older history', t => {
  const { db } = fixture(t);
  const newest = snapshot(['2026-02-01'], '2026-09-10T12:00:00Z', 1);
  db.importSnapshot(newest);
  const prior = snapshot(['2026-02-01'], '2026-09-08T12:00:00Z', 1);
  prior.device_model = 'PRO-1100 series'; prior.firmware = '2.050';
  db.importSnapshot(prior);
  assert.equal(db.get('SELECT identified_at FROM printers')!.identified_at, '2026-09-08T12:00:00.000000+00:00');
  const revised = snapshot(['2026-02-01'], '2026-09-09T12:00:00Z', 1);
  revised.device_model = 'PRO-2600 series'; revised.firmware = '3.000';
  db.importSnapshot(revised);
  assert.deepEqual(db.get('SELECT model,firmware,identified_at FROM printers'), {
    model: 'PRO-2600 series', firmware: '3.000', identified_at: '2026-09-09T12:00:00.000000+00:00',
  });
  db.importSnapshot(prior);
  assert.equal(db.get('SELECT model FROM printers')!.model, 'PRO-2600 series');
});

test('fitting routes validate references, channel and available units, then support edits and deletion', async t => {
  const { db, request } = await apiFixture(t);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-01T12:00:00Z', 1));
  const ledger = new Ledger(db), { purchase } = stock(ledger, 'PFI-4100', 2);
  const other = ledger.createCartridge({ name: 'PFI-4100 PM', channel: 'PM', capacity_nl: ml });
  const wrong = ledger.createInkPurchase({ ink_product_id: other, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP });
  const put = async (method: string, path: string, body?: unknown) => {
    const reply = await request('/api/v1' + path, { method, body });
    return { status: reply.status, body: reply.json<{ error?: string; id?: number }>() };
  };
  const fitting = { printer_id: 1, channel: 'C', ink_purchase_id: purchase, after_record: 1, replaced: 'shelf' };
  assert.deepEqual(await put('POST', '/ink-fittings', { ...fitting, printer_id: 999 }), { status: 400, body: { error: 'printer_not_found' } });
  assert.deepEqual(await put('POST', '/ink-fittings', { ...fitting, ink_purchase_id: 999 }), { status: 400, body: { error: 'purchase_not_found' } });
  assert.deepEqual(await put('POST', '/ink-fittings', { ...fitting, ink_purchase_id: wrong }), { status: 400, body: { error: 'channel_mismatch' } });
  assert.deepEqual(await put('POST', '/ink-fittings', { ...fitting, unit_index: 3 }),
    { status: 400, body: { error: 'fitting_conflict' } }, 'the index must exist in the purchase');
  assert.equal(db.all('SELECT id FROM ink_fittings').length, 0, 'invalid creations roll back');
  const made = await put('POST', '/ink-fittings', fitting);
  assert.equal(made.status, 201);
  assert.deepEqual(await put('POST', '/ink-fittings', fitting), { status: 400, body: { error: 'fitting_conflict' } }, 'the only spare was reserved');
  const id = made.body.id!;
  assert.equal((await put('PATCH', `/ink-fittings/${id}`, { replaced: 'used' })).status, 200);
  assert.equal(db.get('SELECT replaced FROM ink_fittings WHERE id=?', id)!.replaced, 'used');
  assert.equal((await put('DELETE', `/ink-fittings/${id}`)).status, 200);
  assert.equal(db.all('SELECT id FROM ink_fittings').length, 0);
  assert.deepEqual(await put('GET', '/ink?printer=not-an-id'), { status: 400, body: { error: 'invalid_printer' } });
  assert.deepEqual(await put('GET', '/ink?printer=999'), { status: 404, body: { error: 'printer_not_found' } });
});

test('selected Ink response exposes each printer’s own fitted product and unit, without cross-printer sharing', t => {
  const { db, ledger } = fixture(t);
  const first = snapshot(['2026-02-01'], '2026-02-01T12:00:00Z', 0);
  first.inks = undefined;
  const second = structuredClone(first); second.printer.mac = '020000000002'; second.printer.host = '192.0.2.11';
  db.importSnapshot(first); db.importSnapshot(second);
  const { product, purchase } = stock(ledger, 'PFI-4100', 2);
  const one = ledger.ink(1), two = ledger.ink(2);
  assert.deepEqual([one.fitted.C, two.fitted.C].map(unit => [unit.product_id, unit.purchase_id, unit.index, unit.remaining_nl]),
    [[product, purchase, 1, 500_000], [product, purchase, 2, 500_000]]);
  assert.equal(one.cartridges[0].spares, 0);
  assert.equal(one.cartridges[0].open_remaining_nl, 500_000);
  assert.deepEqual(one.cartridges[0].units.map(unit => unit.printer_id), [1, 2]);
  assert.deepEqual(ledger.job(1)!.job.ink[0].from.map(unit => [unit.printer_id, unit.index]), [[1, 1]]);
  assert.deepEqual(ledger.job(2)!.job.ink[0].from.map(unit => [unit.printer_id, unit.index]), [[2, 2]]);
});

test('an imported snapshot cannot erase a user fitting, and fitted write-offs target its printer', t => {
  const { db, ledger } = fixture(t);
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02'], '2026-02-04T12:00:00Z', 2));
  const { product, purchase } = stock(ledger);
  const secondPurchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  const id = ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: secondPurchase, after_record: 1, replaced: 'shelf' });
  assert.equal(ledger.job(2)!.job.ink[0].from[0].purchase_id, secondPurchase);
  const off = ledger.createWriteOff({ printer_id: 1, ink_product_id: product, written_off_on: '2026-02-03', all_remaining: true });
  assert.equal(ledger.ink(1).cartridges[0].write_offs.find(item => item.id === off)!.written_off, 500_000);
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02'], '2026-02-05T12:00:00Z', 2));
  assert.equal(db.get('SELECT id FROM ink_fittings')!.id, id);
  assert.equal(db.get('SELECT id FROM stock_write_offs')!.id, off);
  assert.equal(ledger.job(1)!.job.ink[0].from[0].purchase_id, purchase);
  assert.equal(ledger.job(2)!.job.ink[0].from[0].purchase_id, secondPurchase);
  assert.throws(() => ledger.updateWriteOff(off, { printer_id: 1, quantity: 3 }), /all_remaining/);
});

test('reading-covered cartridge rejects printer all-remaining on create, update and preview; quantity remains available', async t => {
  const { db, request } = await apiFixture(t);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-03T12:00:00Z', 1));
  const ledger = new Ledger(db), { product } = stock(ledger);
  const post = (path: string, method: string, body?: unknown) => request('/api/v1' + path, { method, body });
  const target = { ink_product_id: product, printer_id: 1, written_off_on: '2026-02-03', all_remaining: true };
  const rejected = await post('/write-offs', 'POST', target);
  assert.equal(rejected.status, 400); assert.deepEqual(rejected.json(), { error: 'printer_reports_swaps' });
  const withoutPrinter = await post('/write-offs', 'POST', { ink_product_id: product, written_off_on: '2026-02-03', all_remaining: true });
  assert.equal(withoutPrinter.status, 400); assert.deepEqual(withoutPrinter.json(), { error: 'printer_required' });
  const legacyPreview = await post(`/write-offs/preview?ink_product_id=${product}&written_off_on=2026-02-03`, 'GET');
  assert.equal(legacyPreview.status, 400); assert.deepEqual(legacyPreview.json(), { error: 'printer_required' });
  const preview = await post(`/write-offs/preview?ink_product_id=${product}&printer_id=1&written_off_on=2026-02-03`, 'GET');
  assert.equal(preview.status, 400); assert.deepEqual(preview.json(), { error: 'printer_reports_swaps' });
  const earlier = ledger.createWriteOff({ ...target, written_off_on: '2026-02-02' });
  const updated = await post(`/write-offs/${earlier}`, 'PATCH', { written_off_on: '2026-02-03' });
  assert.equal(updated.status, 400); assert.deepEqual(updated.json(), { error: 'printer_reports_swaps' });
  assert.equal(db.get('SELECT written_off_on FROM stock_write_offs WHERE id=?', earlier)!.written_off_on, '2026-02-02');
  const legacy = ledger.createWriteOff({ ink_product_id: product, written_off_on: '2026-02-02', all_remaining: true });
  assert.equal((await post(`/write-offs/${legacy}`, 'PATCH', { reason: 'Historical note' })).status, 200);
  const moved = await post(`/write-offs/${legacy}`, 'PATCH', { written_off_on: '2026-02-03' });
  assert.equal(moved.status, 400); assert.deepEqual(moved.json(), { error: 'printer_required' });
  assert.ok(ledger.createWriteOff({ ink_product_id: product, written_off_on: '2026-02-03', quantity: 100_000 }));
});

test('changing an all-remaining write-off printer to null rechecks reading coverage', async t => {
  const { db, request } = await apiFixture(t);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-03T12:00:00Z', 1));
  const other = snapshot(['2026-02-01'], '2026-02-03T12:00:00Z', 0, '020000000002');
  other.inks = undefined;
  db.importSnapshot(other);
  const ledger = new Ledger(db), { product } = stock(ledger);
  const off = ledger.createWriteOff({ ink_product_id: product, printer_id: 2, written_off_on: '2026-02-03', all_remaining: true });
  const response = await request(`/api/v1/write-offs/${off}`, { method: 'PATCH', body: { printer_id: null } });
  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'printer_required' });
  assert.equal(db.get('SELECT printer_id FROM stock_write_offs WHERE id=?', off)!.printer_id, 2);
});

test('a candidate fitting cannot invalidate an existing later fitting', async t => {
  const { db, request } = await apiFixture(t);
  const noReading = snapshot(['2026-02-01', '2026-02-02', '2026-02-03'], '2026-02-04T12:00:00Z', 0);
  noReading.inks = undefined; db.importSnapshot(noReading);
  const ledger = new Ledger(db), { product } = stock(ledger, 'PFI-4100', 1);
  const purchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP });
  const future = ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: purchase, after_record: 2, replaced: 'used' });
  const earlier = { printer_id: 1, channel: 'C', ink_purchase_id: purchase, after_record: 1, replaced: 'used' };
  const created = await request('/api/v1/ink-fittings', { method: 'POST', body: earlier });
  assert.equal(created.status, 400); assert.deepEqual(created.json(), { error: 'fitting_conflict' });
  assert.deepEqual(db.all('SELECT id FROM ink_fittings').map(row => row.id), [future]);
  const alternate = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP });
  const id = ledger.createInkFitting({ ...earlier, ink_purchase_id: alternate });
  const updated = await request(`/api/v1/ink-fittings/${id}`, { method: 'PATCH', body: { ink_purchase_id: purchase } });
  assert.equal(updated.status, 400); assert.deepEqual(updated.json(), { error: 'fitting_conflict' });
  assert.equal(db.get('SELECT ink_purchase_id FROM ink_fittings WHERE id=?', id)!.ink_purchase_id, alternate);
});

test('swap bound uses the largest succeeded requested_last before the reading, not the latest run', t => {
  const { db, ledger } = fixture(t);
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02', '2026-02-03'], '2026-02-04T12:00:00Z', 1));
  stock(ledger);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-05T12:00:00Z', 1));
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04'], '2026-02-06T12:00:00Z', 2));
  assert.equal(ledger.job(3)!.job.ink[0].from[0].index, 2, 'record 3 still belongs to pre-swap cartridge');
  assert.equal(ledger.job(4)!.job.ink[0].from[0].index, 3, 'swap occurs after record 3');
  assert.equal(new KnownPrinters(db).archived()[0].inks.find(ink => ink.channel === 'C')?.first_observed_at?.slice(0, 10), '2026-02-04');
});

test('exhausted capacity mode shows the next shelf unit or None', t => {
  const { db, ledger } = fixture(t);
  const noReading = snapshot(['2026-02-01', '2026-02-02'], '2026-02-03T12:00:00Z', 0);
  noReading.inks = undefined; db.importSnapshot(noReading);
  stock(ledger, 'PFI-4100', 1);
  let view = ledger.ink(1).cartridges[0];
  assert.equal(view.open_remaining_nl, null);
  assert.equal(view.open_purchase_id, null);
  assert.equal(view.open_unit_index, null);
  const product = ledger.createCartridge({ name: 'PFI-3300 C', channel: 'C', capacity_nl: ml });
  const spare = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-02-03', cartridges: 1, price_micros: 10 * GBP });
  const cartridges = ledger.ink(1).cartridges;
  assert.equal(cartridges[0].open_remaining_nl, null);
  view = cartridges.find(item => item.id === product)!;
  assert.equal(view.open_remaining_nl, ml);
  assert.equal(view.open_purchase_id, spare);
  assert.equal(view.open_unit_index, 1);
  assert.equal(view.spares, 0, 'the displayed open unit is not also a spare');
});

test('exhausted reading mode shows zero instead of negative ml', t => {
  const { db, ledger } = fixture(t);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-02T12:00:00Z', 1));
  stock(ledger, 'PFI-4100', 1);
  const next = snapshot(['2026-02-01', '2026-02-02'], '2026-02-03T12:00:00Z', 1);
  next.records[1].raw.job_used_ink_C = 2500;
  db.importSnapshot(next);
  const view = ledger.ink(1);
  assert.ok(view.cartridges[0].units[0].remaining_nl < 0);
  assert.equal(view.cartridges[0].open_remaining_nl, 0);
  assert.equal(view.fitted.C.remaining_nl, 0);
});

test('a fitting at the upper bound of a reading swap interval does not retire ink twice', t => {
  const { db, ledger } = fixture(t);
  db.importSnapshot(snapshot(['2026-02-01'], '2026-02-02T12:00:00Z', 1));
  const { purchase, product } = stock(ledger, 'PFI-4100', 1);
  const replacement = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP });
  const second = snapshot(['2026-02-01', '2026-02-02'], '2026-02-03T12:00:00Z', 2);
  second.records[1].raw.job_used_ink_C = 0;
  db.importSnapshot(second);
  ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: replacement, after_record: 2, replaced: 'shelf' });
  const view = ledger.ink(1);
  assert.equal(view.totals.waste_micros, 0);
  assert.equal(view.cartridges[0].units.find(unit => unit.purchase_id === purchase)!.state, 'shelf');
  assert.equal(view.fitted.C.purchase_id, replacement);
});

test('a fitting after the last print can claim a cartridge purchased after that print', t => {
  const { db, ledger } = fixture(t);
  const noReading = snapshot(['2026-02-01'], '2026-02-02T12:00:00Z', 0);
  noReading.inks = undefined; db.importSnapshot(noReading);
  const product = ledger.createCartridge({ name: 'PFI-4100 C', channel: 'C', capacity_nl: ml });
  const purchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-02-05', cartridges: 1, price_micros: 10 * GBP });
  const id = ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: purchase, after_record: 1, replaced: 'shelf' });
  assert.equal(ledger.ink(1).fitted.C.purchase_id, purchase);
  ledger.updateInkFitting(id, { replaced: 'used' });
  assert.equal(ledger.ink(1).fitted.C.purchase_id, purchase);
});

test('capacity-mode /ink previews the next shelf unit after a write-off without fitting it', async t => {
  const { db, request } = await apiFixture(t);
  const noReading = snapshot(['2026-02-01'], '2026-02-02T12:00:00Z', 0);
  noReading.inks = undefined; db.importSnapshot(noReading);
  const ledger = new Ledger(db);
  const product = ledger.createCartridge({ name: 'PFI-4100 C', channel: 'C', capacity_nl: 2 * ml });
  const first = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-01', cartridges: 2, price_micros: 20 * GBP });
  const replacement = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  const off = ledger.createWriteOff({ printer_id: 1, ink_product_id: product, written_off_on: '2026-02-02', all_remaining: true });
  const response = await request('/api/v1/ink?printer=1');
  assert.equal(response.status, 200);
  const view = response.json<{ cartridges: { open_purchase_id: number | null; open_unit_index: number | null; open_remaining_nl: number | null;
    units: { purchase_id: number; index: number; state: string }[] }[] }>().cartridges[0];
  assert.deepEqual([view.open_purchase_id, view.open_remaining_nl], [first, 2 * ml]);
  assert.equal(view.open_unit_index, 2, 'preview identifies the precise shelf unit');
  assert.equal(view.units.find(unit => unit.purchase_id === first && unit.index === 2)!.state, 'shelf');
  ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: replacement, after_record: 1, replaced: 'used' });
  const after = ledger.ink(1).cartridges[0];
  assert.equal(after.write_offs.find(item => item.id === off)!.written_off, 1.5 * ml);
  assert.equal(after.wasted, 1.5 * ml);
  assert.equal(after.units.find(unit => unit.purchase_id === first && unit.index === 2)!.state, 'shelf');
  assert.equal(ledger.ink(1).fitted.C.purchase_id, replacement);
});

test('recent printer jobs return printer-local record positions, labels, times and highest record', async t => {
  const { db, request } = await apiFixture(t);
  const studio = batch([
    { day: '2026-02-01', time: '091200', w: 329, h: 483 },
    { day: '2026-02-03', time: '101200', w: 329, h: 483 },
    { day: '2026-02-04', time: '112300', w: 329, h: 483 },
  ]);
  db.importSnapshot(studio);
  const wide = batch([{ day: '2026-02-05', time: '131500' }]);
  wide.printer.mac = '020000000002'; wide.printer.host = '192.0.2.11'; wide.media_catalogue!.printer_mac = wide.printer.mac;
  db.importSnapshot(wide);
  const ledger = new Ledger(db);
  const paper = ledger.createPaper({ name: 'Photo Rag', media_types: ['custom-media-type-canon-11111111-1111-1111-1111-111111111111'] });
  ledger.createStock({ paper_id: paper, name: 'A3+', format: 'sheet', width_um: 329_000, height_um: 483_000 });
  const response = await request('/api/v1/printers/1/recent-jobs?limit=2');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json(), { highest_source_record_id: 3, jobs: [
    { job_id: 3, source_record_id: 3, date: '2026-02-04', time: '11:23', label: 'Photo Rag A3+' },
    { job_id: 2, source_record_id: 2, date: '2026-02-03', time: '10:12', label: 'Photo Rag A3+' },
  ] });
  assert.deepEqual((await request('/api/v1/printers/2/recent-jobs')).json<{ highest_source_record_id: number }>().highest_source_record_id, 1);
  const missing = await request('/api/v1/printers/99/recent-jobs');
  assert.deepEqual([missing.status, missing.json()], [404, { error: 'printer_not_found' }]);
  for (const limit of ['0', '101', 'abc', '1&limit=2']) {
    const invalid = await request(`/api/v1/printers/1/recent-jobs?limit=${limit}`);
    assert.deepEqual([invalid.status, invalid.json()], [400, { error: 'invalid_limit' }]);
  }
});

test('unit dates follow its printer records and a future fitting has no start date yet', async t => {
  const { db, request } = await apiFixture(t);
  const first = snapshot(['2026-02-01', '2026-02-02'], '2026-02-02T12:00:00Z', 1);
  for (const record of first.records) record.raw.job_used_ink_C = 100;
  db.importSnapshot(first);
  const { product, purchase } = stock(new Ledger(db), 'PFI-4100', 4);
  const second = snapshot(['2026-02-01', '2026-02-02', '2026-02-03'], '2026-02-04T12:00:00Z', 2);
  for (const record of second.records) record.raw.job_used_ink_C = 100;
  second.records = second.records.slice(0, 2); second.requested_range = [1, 2];
  db.importSnapshot(second);
  const third = snapshot(['2026-02-01', '2026-02-02', '2026-02-03'], '2026-02-05T12:00:00Z', 2);
  for (const record of third.records) record.raw.job_used_ink_C = 100;
  db.importSnapshot(third);
  const ledger = new Ledger(db);
  const newPurchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-02', cartridges: 1, price_micros: 10 * GBP });
  const correction = ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: newPurchase, after_record: 3, replaced: 'shelf' });
  const view = (await request('/api/v1/ink?printer=1')).json<{ cartridges: { id: number; units: { state: string; printer_id: number | null; started_on: string | null;
    ended_on: string | null; printed_nl: number; waste_nl: number; fitting_id: number | null; replaced: string | null }[] }[] }>();
  const units = view.cartridges.find(item => item.id === product)!.units;
  assert.deepEqual([units[0].state, units[0].printer_id, units[0].started_on, units[0].ended_on, units[0].waste_nl > 0],
    ['used', 1, '2026-02-01', '2026-02-02', true]);
  assert.deepEqual([units[1].state, units[1].started_on, units[1].ended_on], ['shelf', '2026-02-03', '2026-02-03']);
  const fitted = units.find(unit => unit.fitting_id === correction)!;
  assert.deepEqual([fitted.state, fitted.started_on, fitted.ended_on, fitted.replaced],
    ['fitted', null, null, 'shelf']);
});

test('a write-off ends the fitted unit at the last processed printer record, not a later print', t => {
  const { db, ledger } = fixture(t);
  const batch = snapshot(['2026-02-01', '2026-02-02', '2026-02-04'], '2026-02-05T12:00:00Z', 0);
  batch.inks = undefined;
  batch.records[1].raw.job_used_ink_C = 100;
  db.importSnapshot(batch);
  const { product, purchase } = stock(ledger, 'PFI-4100', 2);
  ledger.createWriteOff({ printer_id: 1, ink_product_id: product, written_off_on: '2026-02-03', all_remaining: true });
  const units = ledger.ink(1).cartridges[0].units.filter(unit => unit.purchase_id === purchase);
  assert.deepEqual([units[0].state, units[0].starts_after_record, units[0].ended_after_record, units[0].started_on, units[0].ended_on],
    ['used', 0, 2, '2026-02-01', '2026-02-02']);
  assert.ok(units[0].waste_nl > 0, 'the write-off consumed remaining ink');
  assert.equal(units[1].state, 'fitted', 'later print claims the next unit');
});

test('a moved unit written off in its new printer uses only that printer’s bounded history', t => {
  const { db, ledger } = fixture(t);
  const first = snapshot(['2026-02-01', '2026-02-02'], '2026-02-06T12:00:00Z', 0);
  first.inks = undefined;
  first.records[0].raw.job_used_ink_C = 100;
  db.importSnapshot(first);
  const second = snapshot(['2026-02-03', '2026-02-05'], '2026-02-06T12:00:00Z', 0, '020000000002');
  second.inks = undefined;
  second.records[0].raw.job_used_ink_C = 100;
  db.importSnapshot(second);
  const { product, purchase } = stock(ledger, 'PFI-4100', 2);
  const replacement = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-02', cartridges: 1, price_micros: 10 * GBP });
  ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: replacement, after_record: 1, replaced: 'shelf' });
  ledger.createInkFitting({ printer_id: 2, channel: 'C', ink_purchase_id: purchase, after_record: 0, replaced: 'shelf' });
  ledger.createWriteOff({ printer_id: 2, ink_product_id: product, written_off_on: '2026-02-04', all_remaining: true });
  const units = ledger.ink(2).cartridges[0].units;
  const moved = units.find(unit => unit.index === 1)!;
  assert.ok(moved.waste_nl > 0, 'the write-off consumed ink moved between printers');
  assert.deepEqual([moved.state, moved.printer_id, moved.starts_after_record, moved.ended_after_record, moved.started_on, moved.ended_on],
    ['used', 2, 0, 1, '2026-02-03', '2026-02-03']);
});


test('fitting API pins a unit and rejects create/update conflicts without changing other units', async t => {
  const { db, request } = await apiFixture(t);
  const first = snapshot(['2026-02-01'], '2026-02-01T12:00:00Z', 0);
  first.inks = undefined;
  const second = structuredClone(first); second.printer.mac = '020000000002'; second.printer.host = '192.0.2.11';
  db.importSnapshot(first); db.importSnapshot(second);
  const ledger = new Ledger(db), { purchase } = stock(ledger, 'PFI-4100', 3);
  const body = { printer_id: 1, channel: 'C', ink_purchase_id: purchase, unit_index: 3,
    after_record: 1, replaced: 'shelf' };
  const made = await request('/api/v1/ink-fittings', { method: 'POST', body });
  assert.equal(made.status, 201);
  const id = made.json<{ id: number }>().id;
  assert.deepEqual([db.get('SELECT unit_index FROM ink_fittings WHERE id=?', id)!.unit_index,
    ledger.ink(1).fitted.C.index, ledger.ink(2).fitted.C.index], [3, 3, 2]);
  const create = await request('/api/v1/ink-fittings', { method: 'POST', body: { ...body, printer_id: 2, unit_index: 3 } });
  assert.deepEqual([create.status, create.json()], [400, { error: 'fitting_conflict' }]);
  const update = await request(`/api/v1/ink-fittings/${id}`, { method: 'PATCH', body: { unit_index: 2 } });
  assert.deepEqual([update.status, update.json()], [400, { error: 'fitting_conflict' }]);
  assert.equal(db.get('SELECT unit_index FROM ink_fittings WHERE id=?', id)!.unit_index, 3);
  assert.equal((await request(`/api/v1/ink-fittings/${id}`, { method: 'PATCH', body: { unit_index: null } })).status, 200);
  assert.equal(db.get('SELECT unit_index FROM ink_fittings WHERE id=?', id)!.unit_index, null);
});
