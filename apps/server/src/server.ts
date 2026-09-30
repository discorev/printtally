import type { Server } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import type { HealthResponse } from 'print-accounting-contracts';
import { AccountingService } from './service.ts';
import { PrinterEnrolment } from './printer-enrolment.ts';
import { Collections, type CollectionOptions } from './collections.ts';
import { Sessions } from './sessions.ts';
import { createApi } from './http.ts';
import { systemNetwork, type Network } from './access.ts';
import { uiDirectory } from './static.ts';
import type { SecretStore } from './credentials.ts';

// Messages safe to show the user as they are.
export class UserError extends Error {}
export const portInUse = (port: number): UserError => new UserError(`Port ${port} is already in use by another program. Stop it, or choose another port with --port.`);
export interface ServerOptions extends CollectionOptions {
  dataDirectory: string; port: number; secrets: SecretStore; remote?: boolean;
  collector?: ConstructorParameters<typeof AccountingService>[1]; network?: Network; ui?: string;
}
export interface RunningServer { server: Server; port: number; collections: Collections; close(): Promise<void> }
// One process owns the ledger, its printers and collection. Remote access (0.0.0.0) is opt-in.
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const data = resolve(options.dataDirectory), db = new AccountingDatabase(join(data, 'accounting.sqlite3'));
  try {
    const service = new AccountingService(db, options.collector);
    const enrolment = new PrinterEnrolment(new KnownPrinters(db), options.secrets, data);
    const collections = new Collections(service, enrolment, options);
    const server = createApi(service, { enrolment, collections, sessions: new Sessions(join(data, 'sessions.json')), remote: options.remote,
      network: options.network ?? systemNetwork, uiDirectory: options.ui ?? uiDirectory() });
    await new Promise<void>((done, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => reject(error.code === 'EADDRINUSE' ? portInUse(options.port) : error));
      server.listen(options.port, options.remote ? '0.0.0.0' : '127.0.0.1', done);
    });
    const address = server.address(), port = typeof address === 'object' && address ? address.port : options.port;
    collections.start();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= (async () => {
      const closed = new Promise<void>(done => server.close(() => done()));
      server.closeIdleConnections();
      await collections.stop(); await closed; db.close();
    })();
    return { server, port, collections, close };
  } catch (error) { db.close(); throw error; }
}
export type PortState = 'free' | 'printtally' | 'other';
// Is Print Tally (or anything else) already answering on this machine's port?
export async function checkPort(port: number, timeoutMs = 2000): Promise<PortState> {
  const listening = await new Promise<boolean>(done => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(timeoutMs, () => { socket.destroy(); done(false); });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
  });
  if (!listening) return 'free';
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json() as Partial<HealthResponse>;
    return response.ok && body.service === 'printtally' ? 'printtally' : 'other';
  } catch { return 'other'; }
}
export interface LaunchResult { reused: boolean; url: string; running?: RunningServer }
// `printtally` with no command: use the server already running on this machine, else start one.
export async function launch(options: ServerOptions, open: (url: string) => void): Promise<LaunchResult> {
  const url = `http://127.0.0.1:${options.port}`;
  const reuse = (): LaunchResult => { open(url); return { reused: true, url }; };
  const state = await checkPort(options.port);
  if (state === 'printtally') return reuse();
  if (state === 'other') throw portInUse(options.port);
  try {
    const running = await startServer({ ...options, remote: false });
    open(url);
    return { reused: false, url, running };
  } catch (error) {
    // Another client may have started one in the meantime.
    if (error instanceof UserError && await checkPort(options.port) === 'printtally') return reuse();
    throw error;
  }
}
