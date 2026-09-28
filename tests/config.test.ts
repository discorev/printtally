import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultDataDirectory, loadPrinterConfig, printerConnection } from '../apps/server/src/config.ts';
test('default data directory follows each platform convention', () => {
  assert.equal(defaultDataDirectory('darwin', '/Users/test'), '/Users/test/Library/Application Support/printtally');
  assert.equal(defaultDataDirectory('linux', '/home/test'), '/home/test/.printtally');
  assert.equal(defaultDataDirectory('win32', 'C:\\Users\\test', 'C:\\Users\\test\\AppData\\Roaming'), 'C:\\Users\\test\\AppData\\Roaming\\printtally');
  assert.equal(defaultDataDirectory('win32', 'C:\\Users\\test', undefined), 'C:\\Users\\test\\AppData\\Roaming\\printtally');
});
test('no device default, private config loads, explicit host does not reuse another printer MAC', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printer-config-'));
  t.after(() => rmSync(dir, { recursive: true }));
  assert.deepEqual(loadPrinterConfig(dir), {});
  assert.throws(() => printerConnection({}));
  const config = { host: '192.0.2.10', mac: '020000000001' };
  writeFileSync(join(dir, 'printer.json'), JSON.stringify(config));
  assert.deepEqual(printerConnection(loadPrinterConfig(dir)), config);
  assert.deepEqual(printerConnection(config, '192.0.2.20'), { host: '192.0.2.20', mac: undefined });
  assert.deepEqual(printerConnection(config, '192.0.2.10'), config);
  assert.deepEqual(printerConnection({}, '192.0.2.20', '020000000002'), { host: '192.0.2.20', mac: '020000000002' });
  writeFileSync(join(dir, 'printer.json'), '{"host":"not-an-ip"}');
  assert.throws(() => loadPrinterConfig(dir));
});

test('certificate trust is resolved privately and is not inherited for another host', t => {
  const dir = mkdtempSync(join(tmpdir(), 'printer-trust-config-'));
  t.after(() => rmSync(dir, { recursive: true }));
  writeFileSync(join(dir, 'printer.json'), JSON.stringify({ host: '192.0.2.10', certificateFile: 'printer.pem' }));
  const config = loadPrinterConfig(dir);
  assert.equal(config.certificateFile, join(dir, 'printer.pem'));
  assert.equal(printerConnection(config).certificateFile, join(dir, 'printer.pem'));
  assert.equal(printerConnection(config, '192.0.2.20').certificateFile, undefined);
  assert.equal(printerConnection(config, '192.0.2.20', undefined, '/explicit.pem').certificateFile, '/explicit.pem');
});
