import type { TestContext } from 'node:test';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import { AccountingService } from '../apps/server/src/service.ts';
import { PrinterEnrolment } from '../apps/server/src/printer-enrolment.ts';
import { Collections, type CollectionOptions } from '../apps/server/src/collections.ts';
import { Sessions } from '../apps/server/src/sessions.ts';
import { createApi } from '../apps/server/src/http.ts';
import { MemoryStore } from '../apps/server/src/credentials.ts';
import type { Network } from '../apps/server/src/access.ts';
import { tlsFixtures } from './tls-fixtures.ts';

// A LAN address and hostname from TEST-NET; nothing is ever sent there.
export const network: Network = { addresses: () => ['192.0.2.50'], names: () => ['studio-mac', 'studio-mac.local'] };
export interface Reply { status: number; headers: IncomingHttpHeaders; text: string; json: <T = Record<string, unknown>>() => T }
export interface FixtureOptions extends CollectionOptions {
  remote?: boolean; ui?: string; collector?: ConstructorParameters<typeof AccountingService>[1];
}
// An API on a random loopback port. `peer.remote` makes the server treat the next requests as
// coming from another device; Host, Origin and Cookie are sent exactly as given.
export async function apiFixture(t: TestContext, options: FixtureOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-api-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  const clock = { time: Date.now() }, peer = { remote: false }, secrets = new MemoryStore(), known = new KnownPrinters(db);
  const service = new AccountingService(db, options.collector);
  const fixtures = await tlsFixtures();
  // Each synthetic printer address has its own root, so they enrol as separate printers.
  const rootFor = (host: string): string => host.endsWith('.68') ? fixtures.otherRoot : fixtures.root;
  const enrolment = new PrinterEnrolment(known, secrets, dir, {
    clock: () => clock.time, inspect: async (host: string) => ({ rootCertificatePem: rootFor(host), mac: null }), verify: async () => undefined,
    discover: async () => [],
  });
  const collections = new Collections(service, enrolment, { intervalMs: 3_600_000, clock: () => clock.time, inspectRoot: async host => rootFor(host), ...options });
  const sessions = new Sessions(join(dir, 'sessions.json'), () => clock.time);
  const server = createApi(service, { enrolment, collections, sessions, remote: options.remote, uiDirectory: options.ui, network, isLocal: () => !peer.remote });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('No address');
  const port = address.port;
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await collections.stop(); db.close(); rmSync(dir, { recursive: true });
  });
  const request = (path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Reply> => new Promise((resolve, reject) => {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const headers = { Host: init.host ?? `127.0.0.1:${port}`, ...body === undefined ? {} : { 'Content-Type': 'application/json' }, ...init.headers };
    const req = httpRequest({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: <T>() => JSON.parse(text) as T }); });
    });
    req.on('error', reject); req.end(body);
  });
  // Confirm a printer through the real enrolment flow (synthetic RFC1918 address, fake inspection).
  const addPrinter = async (host = '10.23.45.67', password?: string) => {
    const preview = await enrolment.preview({ host });
    const printer = await enrolment.confirm(preview.id, { confirmed: true, fingerprintSha256: preview.fingerprintSha256 });
    collections.confirmed(printer);
    if (password) { await enrolment.setPassword(printer.id, { password }); collections.passwordSaved(printer.id); }
    return printer;
  };
  return { dir, db, port, clock, peer, secrets, known, service, enrolment, collections, sessions, server, request, addPrinter };
}
