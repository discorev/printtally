import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountingDatabase, Ledger } from 'print-accounting-database';
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
  assert.deepEqual(await put('POST', '/ink-fittings', fitting), { status: 400, body: { error: 'unit_unavailable' } }, 'the only spare was reserved');
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
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02'], '2026-02-03T12:00:00Z', 2));
  const { product, purchase } = stock(ledger);
  const secondPurchase = ledger.createInkPurchase({ ink_product_id: product, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  const id = ledger.createInkFitting({ printer_id: 1, channel: 'C', ink_purchase_id: secondPurchase, after_record: 1, replaced: 'shelf' });
  assert.equal(ledger.job(2)!.job.ink[0].from[0].purchase_id, secondPurchase);
  const off = ledger.createWriteOff({ printer_id: 1, ink_product_id: product, written_off_on: '2026-02-03', all_remaining: true });
  assert.equal(ledger.ink(1).cartridges[0].write_offs.find(item => item.id === off)!.written_off, 500_000);
  db.importSnapshot(snapshot(['2026-02-01', '2026-02-02'], '2026-02-04T12:00:00Z', 2));
  assert.equal(db.get('SELECT id FROM ink_fittings')!.id, id);
  assert.equal(db.get('SELECT id FROM stock_write_offs')!.id, off);
  assert.equal(ledger.job(1)!.job.ink[0].from[0].purchase_id, purchase);
  assert.equal(ledger.job(2)!.job.ink[0].from[0].purchase_id, secondPurchase);
  assert.throws(() => ledger.updateWriteOff(off, { printer_id: 1, quantity: 3 }), /all_remaining/);
});
