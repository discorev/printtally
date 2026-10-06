import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotSchema } from 'print-accounting-contracts';
import { cartridgeSize, cartridgeTypes } from 'print-accounting-core';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import { Ivec, parseInkModel, parseInkStatus, parseDeviceCapability, readInkStatus } from 'print-accounting-ivec';
import { parseXml } from '../packages/ivec/src/protocol.ts';
import { sample } from './fixtures.ts';

const xml = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test('only the intended unauthenticated read operations are permitted on print and device', async () => {
  const client = new Ivec('127.0.0.1');
  try {
    for (const service of ['print', 'device'] as const) for (const operation of ['SetStatus', 'StartResource', 'EndResource', 'ReceiveData', 'Reboot'])
      await assert.rejects(client.request(operation, [], service), /read-only allowlist/);
    await assert.rejects(client.request('GetCapability', [], 'print'), /read-only allowlist/);
    await assert.rejects(client.request('SetStatus', [], 'joblog'), /read-only allowlist/);
    // These get past the allowlist and fail only because this test has no printer on port 1.
    const disconnected = new Ivec('127.0.0.1', { port: 1, timeoutMs: 100 });
    try {
      for (const [operation, service] of [['GetStatus', 'print'], ['GetStatus', 'device'], ['GetCapability', 'device']] as const)
        await assert.rejects(disconnected.request(operation, [], service), error => {
          assert.doesNotMatch(String(error), /allowlist/); return true;
        });
    } finally { disconnected.close(); }
  } finally { client.close(); }
});

test('sanitized PRO-1100 captures parse SETUP cartridges, levels, counts, model and firmware', async () => {
  const data = {
    'print:GetStatus': xml('print-status.xml'), 'device:GetStatus': xml('device-status.xml'),
    'device:GetCapability': xml('device-capability.xml'),
  };
  const result = await readInkStatus({ request: async (operation, _params, service) => data[`${service}:${operation}` as keyof typeof data] });
  assert.equal(result.inks.length, 12);
  assert.deepEqual(result.inks.find(ink => ink.channel === 'PM'), { channel: 'PM', series: 'PFI-4100', level: 10, replacement_count: 1 });
  assert.deepEqual(result.inks.find(ink => ink.channel === 'MBK'), { channel: 'MBK', series: 'PFI-4100', level: 90, replacement_count: 2 });
  assert.deepEqual({ device_model: result.device_model, firmware: result.firmware }, { device_model: 'PRO-1100 series', firmware: '2.050' });
  assert.deepEqual(parseInkModel('not-a-model'), { series: null, channel: null });
  const malformed = parseXml(Buffer.from(xml('print-status.xml').toString().replace('PFI-4100<PM>SETUP', 'malformed').replace('<ivec:level>10</ivec:level>', '<ivec:level>110</ivec:level>')));
  const readings = parseInkStatus(malformed, parseXml(xml('device-status.xml')));
  assert.deepEqual(readings.find(item => item.channel === 'PM'), { channel: 'PM', series: null, level: null, replacement_count: 1 });
  assert.deepEqual(parseDeviceCapability(parseXml(xml('device-capability.xml'))), { device_model: 'PRO-1100 series', firmware: '2.050' });
});

test('known models have only their documented cartridge types and channel counterparts', () => {
  assert.deepEqual(cartridgeTypes('PRO-1100 series', 'PM'), [{ series: 'PFI-4100', sizeMl: 80 }]);
  assert.deepEqual(cartridgeTypes('PRO-2600 series', 'C').map(item => item.sizeMl), [160, 330, 700]);
  assert.deepEqual(cartridgeTypes('PRO-2600 series', 'MBK').map(item => item.series), ['PFI-2100', 'PFI-2300', 'PFI-2700']);
  assert.deepEqual(cartridgeTypes('PRO-4600 series', 'MBK'), []);
  assert.equal(cartridgeSize('PFI-2300'), 330);
  assert.equal(cartridgeSize('PFI-9999'), null);
});

test('missing device identification does not prevent importing jobs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-no-device-')), db = new AccountingDatabase(join(dir, 'ink.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const input = sample(); input.device_model = null; input.firmware = null;
  assert.equal(db.importSnapshot(input).new_jobs, 1);
  assert.equal(db.all('SELECT id FROM print_jobs').length, 1);
  assert.deepEqual(db.all('SELECT model,firmware FROM printers'), [{ model: null, firmware: null }]);
});

test('older snapshots fill missing model and firmware without replacing newer values', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-device-backfill-')), db = new AccountingDatabase(join(dir, 'ink.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const snapshot = (mac: string, at: string, model: string | null, firmware: string | null) => {
    const input = sample(); input.printer.mac = mac; input.media_catalogue = undefined;
    input.collected_at = at; input.device_model = model; input.firmware = firmware;
    return input;
  };
  const newer = '2026-09-03T00:00:00Z', older = '2026-09-02T00:00:00Z';
  db.importSnapshot(snapshot('020000000001', newer, null, '3.000'));
  db.importSnapshot(snapshot('020000000001', older, 'PRO-2600 series', '2.050'));
  assert.deepEqual(db.all('SELECT model,firmware FROM printers WHERE mac=?', '020000000001'),
    [{ model: 'PRO-2600 series', firmware: '3.000' }]);
  db.importSnapshot(snapshot('020000000002', newer, 'PRO-2600 series', null));
  db.importSnapshot(snapshot('020000000002', older, 'PRO-1100 series', '2.050'));
  assert.deepEqual(db.all('SELECT model,firmware FROM printers WHERE mac=?', '020000000002'),
    [{ model: 'PRO-2600 series', firmware: '2.050' }]);
  db.importSnapshot(snapshot('020000000002', '2026-09-01T00:00:00Z', 'PRO-1100 series', '1.000'));
  db.importSnapshot(snapshot('020000000001', '2026-09-01T00:00:00Z', null, null));
  assert.deepEqual(db.all('SELECT mac,model,firmware FROM printers ORDER BY mac'), [
    { mac: '020000000001', model: 'PRO-2600 series', firmware: '3.000' },
    { mac: '020000000002', model: 'PRO-2600 series', firmware: '2.050' },
  ]);
});

test('a snapshot rejects duplicate ink channels', () => {
  const input = sample();
  input.inks = [{ channel: 'C', series: 'PFI-4100', level: 90, replacement_count: 1 },
    { channel: 'C', series: 'PFI-4100', level: 80, replacement_count: 2 }];
  const result = snapshotSchema.safeParse(input);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /Duplicate channel/);
});

test('readings extend unchanged observations, while level or count changes create historical rows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-ink-')), db = new AccountingDatabase(join(dir, 'ink.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const base = sample(); base.device_model = 'PRO-1100 series'; base.firmware = '2.050';
  base.inks = [{ channel: 'PM', series: 'PFI-4100', level: 10, replacement_count: 0 }];
  db.importSnapshot(base);
  const second = structuredClone(base); second.collected_at = '2026-09-29T00:00:00Z';
  db.importSnapshot(second);
  assert.deepEqual(db.all('SELECT series,level,replacement_count FROM printer_ink_readings'), [{ series: 'PFI-4100', level: 10, replacement_count: 0 }]);
  let entries = db.all('SELECT first_seen_at,last_seen_at FROM printer_ink_readings');
  assert.notEqual(entries[0].first_seen_at, entries[0].last_seen_at);
  const third = structuredClone(second); third.collected_at = '2026-09-30T00:00:00Z'; third.inks![0].replacement_count = 1;
  db.importSnapshot(third);
  entries = db.all('SELECT first_seen_at,last_seen_at,replacement_count FROM printer_ink_readings ORDER BY id');
  assert.deepEqual(entries.map(item => item.replacement_count), [0, 1]);
  assert.notEqual(entries[0].last_seen_at, entries[1].first_seen_at);
  assert.deepEqual(new KnownPrinters(db).archived()[0].inks, [{ channel: 'PM', series: 'PFI-4100', level: 10, replacement_count: 1, observed_at: entries[1].last_seen_at, first_observed_at: entries[0].first_seen_at }]);
  assert.deepEqual([new KnownPrinters(db).archived()[0].model, new KnownPrinters(db).archived()[0].firmware], ['PRO-1100 series', '2.050']);
  // Failed imports roll back ink facts together with jobs.
  const invalid = structuredClone(third); invalid.collected_at = '2026-10-01T00:00:00Z'; invalid.inks![0].level = 20;
  invalid.records.push(structuredClone(invalid.records[0]));
  assert.throws(() => db.importSnapshot(invalid));
  assert.equal(db.all('SELECT id FROM printer_ink_readings').length, 2);
});

test('partial readings carry last known values forward without breaking the replacement history', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-partial-ink-')), db = new AccountingDatabase(join(dir, 'ink.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const first = sample(); first.collected_at = '2026-09-01T00:00:00Z';
  first.inks = [{ channel: 'C', series: 'PFI-4100', level: 90, replacement_count: 1 }];
  db.importSnapshot(first);
  const partial = structuredClone(first); partial.collected_at = '2026-09-02T00:00:00Z';
  partial.inks![0] = { channel: 'C', series: null, level: null, replacement_count: null };
  db.importSnapshot(partial);
  let rows = db.all('SELECT series,level,replacement_count,first_seen_at,last_seen_at FROM printer_ink_readings ORDER BY first_seen_at');
  assert.deepEqual(rows, [{ series: 'PFI-4100', level: 90, replacement_count: 1,
    first_seen_at: '2026-09-01T00:00:00.000000+00:00', last_seen_at: '2026-09-02T00:00:00.000000+00:00' }]);
  const last = structuredClone(first); last.collected_at = '2026-09-03T00:00:00Z'; last.inks![0].replacement_count = 2;
  db.importSnapshot(last);
  rows = db.all('SELECT replacement_count FROM printer_ink_readings ORDER BY first_seen_at');
  assert.deepEqual(rows.map(row => row.replacement_count), [1, 2]);
  const changedLevel = structuredClone(last); changedLevel.collected_at = '2026-09-04T00:00:00Z';
  changedLevel.inks![0] = { channel: 'C', series: null, level: 70, replacement_count: null };
  db.importSnapshot(changedLevel);
  assert.deepEqual(db.all('SELECT series,level,replacement_count FROM printer_ink_readings ORDER BY first_seen_at'), [
    { series: 'PFI-4100', level: 90, replacement_count: 1 }, { series: 'PFI-4100', level: 90, replacement_count: 2 },
    { series: 'PFI-4100', level: 70, replacement_count: 2 },
  ]);
});

test('independent status failures keep other available fields and identify the unavailable service', async () => {
  const print = xml('print-status.xml'), capability = xml('device-capability.xml');
  const result = await readInkStatus({ request: async (operation, _params, service) => {
    if (service === 'device' && operation === 'GetStatus') throw new Error('Offline');
    return service === 'print' ? print : capability;
  } });
  assert.equal(result.inks.length, 12);
  assert.equal(result.inks[0].replacement_count, null);
  assert.equal(result.device_model, 'PRO-1100 series');
  assert.deepEqual(result.failures, ['Printer device GetStatus unavailable.']);
});

test('out-of-order snapshots preserve the prior and later observations without inventing a swap', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-ink-order-')), db = new AccountingDatabase(join(dir, 'ink.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const snapshot = (at: string, count: number) => {
    const input = sample(); input.collected_at = at;
    input.inks = [{ channel: 'C', series: 'PFI-4100', level: 90, replacement_count: count }];
    return input;
  };
  db.importSnapshot(snapshot('2026-09-01T00:00:00Z', 1));
  db.importSnapshot(snapshot('2026-09-03T00:00:00Z', 1));
  db.importSnapshot(snapshot('2026-09-02T00:00:00Z', 2));
  const rows = db.all('SELECT replacement_count,first_seen_at,last_seen_at FROM printer_ink_readings ORDER BY first_seen_at');
  assert.deepEqual(rows.map(row => row.replacement_count), [1, 2, 1]);
  assert.ok(String(rows[0].last_seen_at) < String(rows[1].first_seen_at));
  assert.ok(String(rows[1].last_seen_at) < String(rows[2].first_seen_at));
  assert.equal(new KnownPrinters(db).archived()[0].inks[0].replacement_count, 1);
});
