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
  const product = ledger.createCartridge({ name: 'PFI-3300 C', channel: 'C', capacity_nl: ml });
  const spare = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-02-03', cartridges: 1, price_micros: 10 * GBP });
  const cartridges = ledger.ink(1).cartridges;
  assert.equal(cartridges[0].open_remaining_nl, null);
  view = cartridges.find(item => item.id === product)!;
  assert.equal(view.open_remaining_nl, ml);
  assert.equal(view.open_purchase_id, spare);
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
  const view = response.json<{ cartridges: { open_purchase_id: number | null; open_remaining_nl: number | null;
    units: { purchase_id: number; index: number; state: string }[] }[] }>().cartridges[0];
  assert.deepEqual([view.open_purchase_id, view.open_remaining_nl], [first, 2 * ml]);
  assert.equal(view.units.find(unit => unit.purchase_id === first && unit.index === 2)!.state, 'shelf');
  ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: replacement, after_record: 1, replaced: 'used' });
  const after = ledger.ink(1).cartridges[0];
  assert.equal(after.write_offs.find(item => item.id === off)!.written_off, 1.5 * ml);
  assert.equal(after.wasted, 1.5 * ml);
  assert.equal(after.units.find(unit => unit.purchase_id === first && unit.index === 2)!.state, 'shelf');
  assert.equal(ledger.ink(1).fitted.C.purchase_id, replacement);
});
