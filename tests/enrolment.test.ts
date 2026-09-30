import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import { PrinterEnrolment, EnrolmentError } from '../apps/server/src/printer-enrolment.ts';
import { discoveredPrinters, isPrinterAddress } from '../apps/server/src/printer-discovery.ts';
import { downloadPrinterRoot } from '../apps/server/src/printer-certificate.ts';
import { AccountingService } from '../apps/server/src/service.ts';
import { createApi } from '../apps/server/src/http.ts';
import { Collections } from '../apps/server/src/collections.ts';
import { Sessions } from '../apps/server/src/sessions.ts';
import type { HealthResponse } from 'print-accounting-contracts';
import { sample } from './fixtures.ts';
import { tlsFixtures } from './tls-fixtures.ts';
const fixtures = await tlsFixtures();
const root = fixtures.root, otherRoot = fixtures.otherRoot;
// Synthetic RFC1918 addresses exercise the local-network API address policy.
const host = '10.23.45.67', secondHost = '10.23.45.68';
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printer-enrolment-')), db = new AccountingDatabase(join(dir, 'test.sqlite3'));
  const known = new KnownPrinters(db), secrets = new Map<string, string>();
  const state = { time: Date.now(), root, failVerify: false, inspections: 0, verifications: 0, secretReads: 0 };
  const store = { get: async (account: string) => { state.secretReads++; return secrets.get(account); }, set: async (account: string, password: string) => { secrets.set(account, password); } };
  const dependencies = {
    clock: () => state.time,
    inspect: async () => { state.inspections++; return { rootCertificatePem: state.root, mac: '020000000001' }; },
    verify: async (_host: string, candidate: string) => { state.verifications++; if (state.failVerify || candidate !== state.root) throw new Error('untrusted network detail'); },
    discover: async () => [{ host, name: 'Test printer', model: 'Synthetic', services: ['ipps'] }],
  };
  const enrolment = new PrinterEnrolment(known, store, dir, dependencies);
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return { db, known, enrolment, state, store, secrets, dir, dependencies };
}
const confirmed = (fingerprintSha256: string) => ({ confirmed: true, fingerprintSha256 });
const errorCode = (code: string) => (error: unknown) => error instanceof EnrolmentError && error.message === code;
test('preview does not persist or access credentials; explicit confirmation persists only the displayed root', async t => {
  const f = setup(t);
  assert.equal((await f.enrolment.discover()).length, 1);
  const preview = await f.enrolment.preview({ host, name: 'Studio printer' });
  assert.equal(preview.change, 'new'); assert.equal(f.known.list().length, 0); assert.equal(f.state.secretReads, 0);
  assert.equal(preview.fingerprintSha256, new X509Certificate(root).fingerprint256);
  await assert.rejects(f.enrolment.confirm(preview.id, { ...confirmed(preview.fingerprintSha256), confirmed: false }), errorCode('confirmation_required'));
  await assert.rejects(f.enrolment.confirm(preview.id, confirmed(new X509Certificate(otherRoot).fingerprint256)), errorCode('fingerprint_mismatch'));
  assert.equal(f.known.list().length, 0);
  const printer = await f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256));
  assert.equal(f.known.list().length, 1); assert.equal(f.state.verifications, 1); assert.equal(f.state.secretReads, 0);
  assert.equal(printer.name, 'Studio printer'); assert.ok(!JSON.stringify(printer).includes('BEGIN CERTIFICATE'));
  assert.equal(f.enrolment.collection(printer.id).options.trustedCertificatePem, root);
  await assert.rejects(f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256)), errorCode('preview_expired'));
  const reopened = new AccountingDatabase(join(f.dir, 'test.sqlite3'));
  try { assert.equal(new KnownPrinters(reopened).get(printer.id)?.fingerprintSha256, preview.fingerprintSha256); }
  finally { reopened.close(); }
});
test('expired/cancelled previews and a changed root at confirmation never gain trust', async t => {
  const f = setup(t);
  let preview = await f.enrolment.preview({ host });
  f.state.time += 600001;
  await assert.rejects(f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256)), errorCode('preview_expired'));
  preview = await f.enrolment.preview({ host }); f.enrolment.cancel(preview.id);
  await assert.rejects(f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256)), errorCode('preview_expired'));
  preview = await f.enrolment.preview({ host }); f.state.root = otherRoot;
  await assert.rejects(f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256)), errorCode('printer_verification_failed'));
  assert.equal(f.known.list().length, 0); assert.equal(f.state.secretReads, 0);
});
test('stale concurrent previews cannot overwrite another confirmation', async t => {
  const f = setup(t), first = await f.enrolment.preview({ host, name: 'First' }), second = await f.enrolment.preview({ host, name: 'Stale' });
  await f.enrolment.confirm(first.id, confirmed(first.fingerprintSha256));
  await assert.rejects(f.enrolment.confirm(second.id, confirmed(second.fingerprintSha256)), errorCode('preview_stale'));
  assert.equal(f.known.list()[0].name, 'First');
});
test('address changes preserve identity; root replacement is explicit and does not reuse credentials', async t => {
  const f = setup(t);
  let preview = await f.enrolment.preview({ host });
  const initial = await f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256));
  await f.enrolment.setPassword(initial.id, { password: 'synthetic-admin-password' });
  preview = await f.enrolment.preview({ host: secondHost }); assert.equal(preview.change, 'address_changed');
  const moved = await f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256));
  assert.equal(moved.id, initial.id); assert.equal(await f.enrolment.collection(moved.id).getPassword(), 'synthetic-admin-password');
  f.state.root = otherRoot;
  preview = await f.enrolment.preview({ host: secondHost });
  assert.equal(preview.change, 'root_changed'); assert.equal(preview.previousFingerprintSha256, initial.fingerprintSha256);
  assert.equal(f.known.get(initial.id)?.fingerprintSha256, initial.fingerprintSha256);
  await f.enrolment.confirm(preview.id, confirmed(preview.fingerprintSha256));
  await assert.rejects(f.enrolment.collection(initial.id).getPassword(), /No printer password/);
  assert.ok(!JSON.stringify(f.db.all('SELECT * FROM known_printers')).includes('synthetic-admin-password'));
});
test('onboarding validates address/input before networking and bounds pending previews', async t => {
  const f = setup(t);
  for (const invalid of ['127.0.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', 'https://10.23.45.67', 'printer.local', '192.0.2.10']) {
    await assert.rejects(f.enrolment.preview({ host: invalid }), errorCode('invalid_printer_address'));
  }
  await assert.rejects(f.enrolment.preview({ host, certificateFile: '/untrusted/path' }), errorCode('invalid_printer_address'));
  assert.equal(f.state.inspections, 0);
  for (let i = 0; i < 32; i++) await f.enrolment.preview({ host });
  await assert.rejects(f.enrolment.preview({ host }), errorCode('too_many_previews'));
});
test('Bonjour results deduplicate printer services and never mark advertisements trusted', () => {
  const result = discoveredPrinters([
    { type: 'ipp', name: 'Test printer', addresses: [host, '::1'], txt: { ty: 'Test model' } },
    { type: 'ipps', name: 'Test printer', addresses: [host] },
    { type: 'http', name: 'Unrelated', addresses: [secondHost] },
    { type: 'printer', name: 'Bad destination', addresses: ['127.0.0.1', '169.254.169.254'] },
  ]);
  assert.deepEqual(result, [{ host, name: 'Test printer', model: 'Test model', services: ['ipp', 'ipps'] }]);
  assert.ok(isPrinterAddress('192.168.50.5')); assert.ok(isPrinterAddress('172.16.1.5')); assert.equal(isPrinterAddress('172.32.1.5'), false);
});
test('bootstrap uses only fixed certificate GET, rejects redirects and oversized bodies, never sends credentials', async t => {
  let mode = 'ok'; const observed: { url?: string; method?: string; authorization?: string; cookie?: string }[] = [];
  const sockets = new Set<Duplex>();
  const server = createServer({ cert: fixtures.leaves.server.cert, key: fixtures.leaves.server.key }, (request, response) => {
    observed.push({ url: request.url, method: request.method, authorization: request.headers.authorization, cookie: request.headers.cookie });
    if (mode === 'redirect') { response.writeHead(302, { Location: '/another-endpoint' }); response.end(); }
    else if (mode === 'huge') response.end(Buffer.alloc(65537));
    else response.end(new X509Certificate(root).raw);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  assert.equal(await downloadPrinterRoot('127.0.0.1', address.port), root);
  mode = 'redirect'; await assert.rejects(downloadPrinterRoot('127.0.0.1', address.port));
  mode = 'huge'; await assert.rejects(downloadPrinterRoot('127.0.0.1', address.port));
  assert.equal(observed.length, 3);
  for (const request of observed) assert.deepEqual(request, { url: '/cert_root.der', method: 'GET', authorization: undefined, cookie: undefined });
});
test('API supports setup without a configured printer and collects only confirmed IDs', async t => {
  const f = setup(t); let collected = 0;
  const service = new AccountingService(f.db, async (options, getPassword) => {
    assert.equal(options.trustedCertificatePem, root); assert.equal(await getPassword(), 'synthetic password'); collected++; return sample();
  });
  const collections = new Collections(service, f.enrolment);
  const server = createApi(service, { enrolment: f.enrolment, collections, sessions: new Sessions() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + address.port + '/api/v1';
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const health = async () => (await (await request('/health')).json() as HealthResponse).state;
  assert.equal(await health(), 'needs_printer');
  assert.equal((await request('/collect', 'POST', {})).status, 404);
  assert.equal((await request('/printer-discovery', 'POST', {})).status, 200);
  const preview = await (await request('/printer-enrolments', 'POST', { host })).json() as { id: string; fingerprintSha256: string };
  assert.equal((await request('/known-printers/' + preview.id + '/password', 'PUT', { password: 'no trust yet' })).status, 404);
  assert.equal((await request('/known-printers/' + preview.id + '/collect', 'POST', {})).status, 404);
  const printer = await (await request('/printer-enrolments/' + preview.id + '/confirm', 'POST', confirmed(preview.fingerprintSha256))).json() as { id: string };
  assert.equal(await health(), 'ready', 'a known printer without its password is not set up again');
  assert.equal((await request('/known-printers/' + printer.id + '/password', 'PUT', { password: 'synthetic password' })).status, 200);
  assert.equal(await health(), 'ready');
  assert.equal((await request('/known-printers/' + printer.id + '/collect', 'POST', { host: secondHost })).status, 400);
  assert.equal((await request('/known-printers/' + printer.id + '/collect', 'POST', {})).status, 200);
  assert.equal(collected, 1);
  const list = await (await request('/known-printers')).text();
  assert.ok(!list.includes('synthetic password')); assert.ok(!list.includes('BEGIN CERTIFICATE'));
});

test('native Bonjour parsing preserves names with spaces, handles removals and restricts resolution to local hosts', async () => {
  const { parseBonjourBrowse, parseBonjourHost } = await import('../apps/server/src/bonjour-macos.ts');
  const output = [
    '12:00:01.000 Add 2 4 local. _ipp._tcp. Test printer with spaces',
    '12:00:01.001 Add 2 4 local. _ipps._tcp. Secure test printer',
    '12:00:02.000 Rmv 0 4 local. _ipp._tcp. Test printer with spaces',
    '12:00:03.000 Add 2 4 example.com. _ipp._tcp. Other domain',
  ].join('\n');
  assert.deepEqual(parseBonjourBrowse(output), [{ name: 'Secure test printer', type: '_ipps._tcp', domain: 'local.' }]);
  assert.equal(parseBonjourHost('Test printer can be reached at printer-test.local.:631 (interface 4)'), 'printer-test.local.');
  assert.equal(parseBonjourHost('Test printer can be reached at external.example:631'), undefined);
});
