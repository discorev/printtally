import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import type { Socket } from 'node:net';
import { X509Certificate } from 'node:crypto';
import { collectSnapshot } from 'print-accounting-ivec';
import type { ImportsResponse, KnownPrinterListing, Snapshot } from 'print-accounting-contracts';
import { Collections, CollectionError } from '../apps/server/src/collections.ts';
import { AccountingService } from '../apps/server/src/service.ts';
import { CredentialError } from '../apps/server/src/credentials.ts';
import { apiFixture } from './api-fixtures.ts';
import { batch, sample } from './fixtures.ts';
import { tlsFixtures } from './tls-fixtures.ts';
const fixtures = await tlsFixtures();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean, message: string): Promise<void> {
  for (const deadline = Date.now() + 5000; !condition(); await delay(5)) if (Date.now() > deadline) assert.fail(message);
}
// Records first..last, as a printer whose log holds only those would report them.
function range(first: number, last: number): Snapshot {
  const snapshot = batch(Array.from({ length: last - first + 1 }, (_, index) => ({ day: '2026-09-01', time: String(100000 + index) })));
  snapshot.records.forEach((record, index) => { record.raw.job_record_number = first + index; });
  snapshot.requested_range = [first, last];
  snapshot.printer.host = '10.23.45.67'; // The fixture's known printer, which has no MAC.
  return snapshot;
}

test('collects every printer on start and on the interval, one collection at a time', async t => {
  let active = 0, most = 0, calls = 0;
  const f = await apiFixture(t, { intervalMs: 40, collector: async () => { calls++; active++; most = Math.max(most, active); await delay(5); active--; return sample(); } });
  const first = await f.addPrinter('10.23.45.67', 'synthetic password'), second = await f.addPrinter('10.23.45.68', 'synthetic password');
  f.collections.start();
  await until(() => calls === 2, 'collects each printer as soon as it starts');
  // A request for a printer already queued or collecting shares that collection.
  assert.equal(f.collections.collect(first.id), f.collections.collect(first.id));
  const manual = f.collections.collect(second.id);
  await until(() => calls >= 6, 'interval collections run');
  await f.collections.stop();
  await manual;
  const settled = calls;
  assert.equal(most, 1, 'never two at once');
  assert.ok(f.collections.health().nextCollectionAt === null);
  await delay(60);
  assert.equal(calls, settled, 'stop() ends the schedule');
});

test('health reports each state, and a gap in the printer log as missed jobs', async t => {
  const snapshots = [range(1, 3), range(4, 5), range(10, 12), range(20, 21), range(13, 21)];
  let release: (() => void) | undefined;
  const f = await apiFixture(t, { collector: async () => { if (release) await new Promise<void>(resolve => { release = resolve; }); return snapshots.shift()!; } });
  const health = () => f.collections.health();
  assert.equal(health().state, 'needs_printer');
  assert.ok(health().hostName.length > 0 && !health().hostName.endsWith('.local'), 'names the server machine');
  const printer = await f.addPrinter();
  // A known printer that needs its password is shown on every screen, not set up again.
  assert.deepEqual([health().state, health().printers[0].state], ['ready', 'needs_password']);
  const hasPassword = async () => (await f.request('/api/v1/known-printers')).json<{ printers: KnownPrinterListing[] }>().printers[0].hasPassword;
  assert.equal(await hasPassword(), false);
  await f.enrolment.setPassword(printer.id, { password: 'synthetic password' }); f.collections.passwordSaved(printer.id);
  assert.deepEqual([health().state, health().printers[0].state, health().lastCollection], ['ready', 'unknown', null]);
  assert.equal(await hasPassword(), true);
  const read = f.secrets.get.bind(f.secrets);
  f.secrets.get = async () => { throw new CredentialError('locked'); };
  assert.equal(await hasPassword(), null, "a store that can't be read doesn't claim either way");
  f.secrets.get = read;
  await f.collections.collect(printer.id);
  await f.collections.collect(printer.id);
  assert.deepEqual(health().missedJobs, [], 'contiguous ranges');
  release = () => undefined;
  const pending = f.collections.collect(printer.id);
  await delay(5);
  assert.deepEqual([health().state, health().collecting], ['collecting', true]);
  release();
  await pending;
  release = undefined;
  const status = health();
  assert.deepEqual([status.state, status.printers[0].state, status.lastCollection?.result, status.lastCollection?.newJobs], ['ready', 'ready', 'succeeded', 3]);
  assert.deepEqual(status.missedJobs.map(({ fromRecord, toRecord }) => [fromRecord, toRecord]), [[6, 9]]);
  // Derived from the import history, so the warning survives a restart.
  assert.deepEqual(new Collections(new AccountingService(f.db), f.enrolment).health().missedJobs, status.missedJobs);
  const response = (await f.request('/api/v1/health')).json<{ missedJobs: unknown[] }>();
  assert.equal(response.missedJobs.length, 1);
  // Named as health.printers names it; a gap a later collection filled is not reported.
  assert.deepEqual([status.missedJobs[0].printerId, status.missedJobs[0].printerName], [printer.id, printer.name]);
  await f.collections.collect(printer.id);
  assert.deepEqual(health().missedJobs.map(({ fromRecord, toRecord }) => [fromRecord, toRecord]), [[6, 9], [13, 19]]);
  await f.collections.collect(printer.id);
  assert.deepEqual(health().missedJobs.map(({ fromRecord, toRecord }) => [fromRecord, toRecord]), [[6, 9]]);
});

test('a missing password asks for one; an unreachable printer says so', async t => {
  let reachable = false;
  const f = await apiFixture(t, {
    collector: async (_options, getPassword) => { if (!reachable) throw new Error('offline'); await getPassword(); return sample(); },
    inspectRoot: async () => { throw new Error('offline'); },
  });
  const printer = await f.addPrinter();
  const call = () => f.request(`/api/v1/known-printers/${printer.id}/collect`, { method: 'POST', body: {} });
  assert.deepEqual([(await call()).status, f.collections.health().printers[0].state], [502, 'unreachable']);
  reachable = true;
  const missing = await call();
  assert.deepEqual([missing.status, missing.json().error, f.collections.health().state], [409, 'printer_needs_password', 'ready']);
});

test('a collection distinguishes a macOS Local Network block from a printer that is simply unreachable', async t => {
  const originalPlatform = process.platform;
  t.after(() => Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }));
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const f = await apiFixture(t, {
    collector: async () => { throw new Error('offline'); },
    inspectRoot: async () => { throw Object.assign(new Error('connect'), { code: 'EHOSTUNREACH' }); },
  });
  const printer = await f.addPrinter();
  const call = () => f.request(`/api/v1/known-printers/${printer.id}/collect`, { method: 'POST', body: {} });
  assert.deepEqual([(await call()).status, f.collections.health().printers[0].state], [502, 'local_network_blocked']);
  const reply = await call();
  assert.deepEqual([reply.status, reply.json().error], [502, 'printer_local_network_blocked']);
  // Off darwin the identical host-unreachable error stays the generic, pre-existing state.
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  await call();
  assert.equal(f.collections.health().printers[0].state, 'unreachable');
});

test('a stored password is never sent to a printer whose certificate is not the confirmed one', async t => {
  // The printer now presents a chain from a root the user never confirmed.
  let applicationBytes = 0, handshakes = 0;
  const sockets = new Set<Socket>();
  const printer = createServer({ cert: fixtures.leaves.server.cert, key: fixtures.leaves.server.key }, socket => { handshakes++; socket.on('data', data => { applicationBytes += data.length; }); });
  printer.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  printer.on('tlsClientError', () => undefined);
  await new Promise<void>(resolve => printer.listen(0, '127.0.0.1', resolve));
  const address = printer.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => printer.close(() => resolve())); });
  let passwordReads = 0;
  const f = await apiFixture(t, {
    // The real collection path, pointed at the test port.
    collector: (options, getPassword, progress) => collectSnapshot({ ...options, port: address.port }, getPassword, progress),
    inspectRoot: async () => fixtures.root,
  });
  const now = new Date().toISOString(), other = new X509Certificate(fixtures.otherRoot);
  const id = '00000000-0000-4000-8000-000000000001';
  f.known.save({ id, host: '127.0.0.1', name: 'Studio printer', mac: '020000000001', fingerprintSha256: other.fingerprint256, rootCertificatePem: fixtures.otherRoot,
    validFrom: other.validFromDate.toISOString(), validTo: other.validToDate.toISOString(), confirmedAt: now, lastVerifiedAt: now }, undefined);
  await f.enrolment.setPassword(id, { password: 'synthetic admin password' });
  const read = f.secrets.get.bind(f.secrets);
  f.secrets.get = async account => { passwordReads++; return read(account); };
  await assert.rejects(f.collections.collect(id), (error: unknown) => error instanceof CollectionError && error.state === 'needs_confirming');
  const reply = await f.request(`/api/v1/known-printers/${id}/collect`, { method: 'POST', body: {} });
  assert.deepEqual([reply.status, reply.json().error], [409, 'printer_needs_confirming']);
  assert.equal(f.collections.health().state, 'printer_needs_confirming');
  assert.equal(passwordReads, 0, 'the password is never read');
  assert.equal(applicationBytes, 0, 'nothing is sent after the TLS handshake');
  assert.ok(handshakes <= 2);
  assert.ok(!(await f.request('/api/v1/known-printers')).text.includes('synthetic admin password'));
});

test('the import history names the printer log range each collection read', async t => {
  const snapshots = [range(1, 3), range(4, 5)];
  const f = await apiFixture(t, { collector: async () => snapshots.shift()! });
  const printer = await f.addPrinter('10.23.45.67', 'synthetic password');
  await f.collections.collect(printer.id);
  await f.collections.collect(printer.id);
  const { imports } = (await f.request('/api/v1/imports')).json<ImportsResponse>();
  assert.deepEqual(imports.map(run => [run.status, run.requested_first, run.requested_last, run.new_jobs]), [['succeeded', 4, 5, 2], ['succeeded', 1, 3, 3]]);
});
