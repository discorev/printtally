import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HealthResponse, KnownPrinter, PrintersResponse } from 'print-accounting-contracts';
import { apiFixture } from './api-fixtures.ts';
import { sample } from './fixtures.ts';

// A second archived printer: the sample job, from another MAC and address.
function office() {
  const snapshot = sample();
  snapshot.printer = { host: '192.0.2.11', mac: '020000000002' };
  snapshot.media_catalogue!.printer_mac = '020000000002';
  return snapshot;
}

test('GET /printers lists each archived printer, named by the known printer with its MAC', async t => {
  const f = await apiFixture(t);
  const printers = async () => (await f.request('/api/v1/printers')).json<PrintersResponse>().printers;
  assert.deepEqual(await printers(), []);
  f.db.importSnapshot(sample()); f.db.importSnapshot(office());
  assert.deepEqual(await printers(), [
    { id: 1, name: '02:00:00:00:00:01', host: '192.0.2.10', known_printer_id: null, jobs: 1, model: null, firmware: null, inks: [] },
    { id: 2, name: '02:00:00:00:00:02', host: '192.0.2.11', known_printer_id: null, jobs: 1, model: null, firmware: null, inks: [] },
  ]);

  const added = await f.addPrinter('10.23.45.67'), stored = f.known.get(added.id)!;
  f.known.save({ ...stored, name: 'Studio', mac: '020000000001' }, stored);
  f.db.run("UPDATE printers SET display_name='Office' WHERE id=2");
  assert.deepEqual(await printers(), [
    { id: 2, name: 'Office', host: '192.0.2.11', known_printer_id: null, jobs: 1, model: null, firmware: null, inks: [] },
    { id: 1, name: 'Studio', host: '10.23.45.67', known_printer_id: added.id, jobs: 1, model: null, firmware: null, inks: [] },
  ]);
  // Equal names are ordered by archived id, not by enrolment.
  f.db.run("UPDATE printers SET display_name='Studio' WHERE id=2");
  assert.deepEqual((await printers()).map(printer => printer.id), [1, 2]);
});

test('the newest confirmed printer names an archived MAC when it has been re-enrolled', async t => {
  const f = await apiFixture(t);
  f.db.importSnapshot(sample());
  const old = await f.addPrinter('10.23.45.67');
  const current = await f.addPrinter('10.23.45.68');
  const before = f.known.get(old.id)!, after = f.known.get(current.id)!;
  f.known.save({ ...before, name: 'Zebra old', mac: '020000000001', confirmedAt: '2026-01-01T00:00:00.000Z' }, before);
  f.known.save({ ...after, name: 'Alpha current', mac: '020000000001', confirmedAt: '2026-02-01T00:00:00.000Z' }, after);
  assert.deepEqual((await f.request('/api/v1/printers')).json<PrintersResponse>().printers, [
    { id: 1, name: 'Alpha current', host: '10.23.45.68', known_printer_id: current.id, jobs: 1, model: null, firmware: null, inks: [] },
  ]);
});

test('PATCH /known-printers/:id renames a printer everywhere it is named, and refuses anything else', async t => {
  const f = await apiFixture(t);
  f.db.importSnapshot(sample());
  const added = await f.addPrinter('10.23.45.67'), stored = f.known.get(added.id)!;
  f.known.save({ ...stored, mac: '020000000001' }, stored);
  const rename = (body: unknown, id = added.id) => f.request(`/api/v1/known-printers/${id}`, { method: 'PATCH', body });

  const renamed = await rename({ name: '  Studio PRO-1100 ' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.json<KnownPrinter>(), { ...f.enrolment.list()[0], name: 'Studio PRO-1100' });
  assert.ok(!renamed.text.includes('BEGIN CERTIFICATE'));
  assert.equal((await f.request('/api/v1/health')).json<HealthResponse>().printers[0].name, 'Studio PRO-1100');
  assert.equal((await f.request('/api/v1/printers')).json<PrintersResponse>().printers[0].name, 'Studio PRO-1100');

  for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 'Studio', host: '10.23.45.68' }, {}, ['Studio']]) {
    const reply = await rename(body);
    assert.deepEqual([reply.status, reply.json()], [400, { error: 'invalid_printer_name' }], JSON.stringify(body));
  }
  assert.equal((await rename({ name: 'x'.repeat(120) })).status, 200);
  const missing = await rename({ name: 'Office' }, '00000000-0000-4000-8000-000000000000');
  assert.deepEqual([missing.status, missing.json()], [404, { error: 'known_printer_not_found' }]);
});

test('GET /printers reports the latest ink level per channel and device identification', async t => {
  const f = await apiFixture(t), first = sample();
  first.device_model = 'PRO-2600 series'; first.firmware = '2.050';
  first.inks = [{ channel: 'C', series: 'PFI-3300', level: 50, replacement_count: 1 }];
  f.db.importSnapshot(first);
  const again = structuredClone(first); again.collected_at = '2026-09-02T12:00:00Z';
  again.inks![0].level = 40;
  f.db.importSnapshot(again);
  const [printer] = (await f.request('/api/v1/printers')).json<PrintersResponse>().printers;
  assert.equal(printer.model, 'PRO-2600 series');
  assert.equal(printer.firmware, '2.050');
  assert.deepEqual(printer.inks.map(({ channel, series, level, replacement_count }) => ({ channel, series, level, replacement_count })),
    [{ channel: 'C', series: 'PFI-3300', level: 40, replacement_count: 1 }]);
  assert.ok(printer.inks[0].observed_at.startsWith('2026-09-02'));
});
