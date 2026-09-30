#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { renderUnicodeCompact } from 'uqr';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import type { ImportResult, KnownPrinter, PairingCodeResponse, SessionsResponse } from 'print-accounting-contracts';
import { AccountingService } from './service.ts';
import { PrinterEnrolment } from './printer-enrolment.ts';
import { Collections, CollectionError } from './collections.ts';
import { DEFAULT_PORT, defaultDataDirectory, parsePort } from './config.ts';
import { KeychainStore, MemoryStore, CredentialError, type SecretStore } from './credentials.ts';
import { checkPort, launch, startServer, UserError, portInUse, type RunningServer } from './server.ts';
import { lanAddresses, hostNames } from './access.ts';

const help = `Print Tally: print history and cost accounting for Canon imagePROGRAF printers

  printtally                     Open Print Tally in your browser, starting it if it isn't running
  printtally serve [--host]      Run without opening a browser. --host lets other devices on your
                                 network pair with this computer (off by default)
  printtally pair [--label NAME] Make a single-use link and QR code that pairs another device
  printtally sessions            List paired devices
  printtally sessions revoke ID  Unpair a device
  printtally collect             Collect new jobs from your printers now

  --port N         Port on this computer (default ${DEFAULT_PORT})
  --data-dir PATH  Where the ledger is kept (default ~/Library/Application Support/printtally
                   on macOS, ~/.printtally on Linux, %APPDATA%\\printtally on Windows)

Print Tally collects on start and every 15 minutes while it's running. Printer passwords are kept
in the OS credential store (Keychain on macOS).
`;
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'data-dir': { type: 'string' }, port: { type: 'string', default: String(DEFAULT_PORT) }, host: { type: 'boolean' },
    label: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  }});
  if (values.help) { console.log(help); return; }
  const [command = 'open', ...rest] = positionals;
  if (!['open', 'serve', 'pair', 'sessions', 'collect'].includes(command)) throw new UserError('Unknown command. Run printtally --help.');
  if (values.host && command !== 'serve') throw new UserError('--host only applies to printtally serve.');
  if (values.label !== undefined && command !== 'pair') throw new UserError('--label only applies to printtally pair.');
  if (rest.length && !(command === 'sessions' && rest[0] === 'revoke' && rest.length === 2)) throw new UserError('Unexpected arguments. Run printtally --help.');
  const port = parsePort(values.port), dataDirectory = resolve(values['data-dir'] ?? defaultDataDirectory());
  const base = `http://127.0.0.1:${port}/api/v1`;
  if (command === 'pair') return pair(base, port, values.label);
  if (command === 'sessions') return rest.length ? revoke(base, port, rest[1]) : listSessions(base, port);
  const secrets = secretStore();
  if (command === 'collect') return collect(base, port, dataDirectory, secrets);
  if (command === 'open') {
    const result = await launch({ dataDirectory, port, secrets }, openBrowser);
    if (result.reused) { console.log(`Print Tally is already running. Opened ${result.url}`); return; }
    console.log(`Print Tally is running at ${result.url}. Keep this window open; press Ctrl+C to stop it.`);
    return stopOnSignal(result.running!);
  }
  const state = await checkPort(port);
  if (state === 'printtally') throw new UserError(`Print Tally is already running on port ${port}.`);
  if (state === 'other') throw portInUse(port);
  const running = await startServer({ dataDirectory, port, secrets, remote: values.host });
  console.log(`Print Tally is running at http://127.0.0.1:${port} (data in ${dataDirectory}).`);
  if (values.host) {
    console.log('\nRemote access is on. Other devices on your network can reach Print Tally at:');
    for (const name of [...lanAddresses(), ...hostNames()]) console.log(`  http://${name}:${port}`);
    console.log('Each device needs a pairing link first: run `printtally pair` in another terminal.');
    console.log('Warning: Print Tally is now reachable from your network, and traffic to other devices is not encrypted.');
    console.log('Only use remote access on a network you trust, such as your home network or Tailscale.');
  }
  return stopOnSignal(running);
}
function secretStore(): SecretStore {
  if (process.env.PRINTTALLY_MEMORY_SECRETS !== '1') return new KeychainStore();
  console.warn('PRINTTALLY_MEMORY_SECRETS=1: printer passwords are kept in memory only (development use).');
  return new MemoryStore();
}
function stopOnSignal(running: RunningServer): void {
  const stop = (): void => {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    void running.close();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
function openBrowser(url: string): void {
  const [command, ...args] = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try { spawn(command, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref(); } catch { /* The URL is printed as well. */ }
}
// pair and sessions talk to the running server; only this machine may use these routes.
async function local<T>(base: string, port: number, path: string, init: RequestInit = {}, timeoutMs = 5000): Promise<{ status: number; body: T }> {
  let response: Response;
  try { response = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch { throw new UserError(`Print Tally isn't running on port ${port}. Start it with printtally serve --host.`); }
  return { status: response.status, body: await response.json() as T };
}
async function pair(base: string, port: number, label?: string): Promise<void> {
  const { status, body } = await local<PairingCodeResponse & { error?: string }>(base, port, '/pairing-codes', { method: 'POST', body: JSON.stringify(label ? { label } : {}) });
  if (status === 409) throw new UserError('Remote access is off. Restart the host with printtally serve --host, then run printtally pair again.');
  if (status !== 201) throw new UserError('Could not make a pairing link.');
  if (!body.links.length) throw new UserError("This computer has no network address other devices can reach. Check it's connected to your network.");
  const [link, ...others] = body.links;
  const expires = new Date(body.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  console.log(`Open this link on the device you want to pair. It works once, until ${expires}.\n\n  ${link}\n`);
  console.log(renderUnicodeCompact(link, { border: 2 }));
  console.log(`\nOn a Mac with the Print Tally app, open ${link.replace(/^http:/, 'printtally:')}`);
  if (others.length) console.log('\nThe same link through this computer\'s other addresses:\n' + others.map(item => '  ' + item).join('\n'));
}
async function listSessions(base: string, port: number): Promise<void> {
  const { body } = await local<SessionsResponse>(base, port, '/sessions');
  if (!body.sessions.length) { console.log('No devices are paired.'); return; }
  for (const session of body.sessions) console.log(`${session.id}  ${session.label}  paired ${session.createdAt.slice(0, 10)}, last seen ${session.lastSeenAt.slice(0, 16).replace('T', ' ')}  ${session.userAgent ?? ''}`.trimEnd());
  console.log('\nUnpair a device with printtally sessions revoke <id>.');
}
async function revoke(base: string, port: number, id: string): Promise<void> {
  if (!/^[a-f0-9]{8}$/.test(id)) throw new UserError('Unknown session id. Run printtally sessions to list them.');
  const { status } = await local(base, port, '/sessions/' + id, { method: 'DELETE' });
  if (status !== 200) throw new UserError('Unknown session id. Run printtally sessions to list them.');
  console.log('Revoked. That device must pair again to use Print Tally.');
}
// Collect through the running server when there is one, so its collections stay serialised.
async function collect(base: string, port: number, dataDirectory: string, secrets: SecretStore): Promise<void> {
  const outcomes: [string, ImportResult | string][] = [];
  if (await checkPort(port) === 'printtally') {
    const { body } = await local<{ printers: KnownPrinter[] }>(base, port, '/known-printers');
    for (const printer of body.printers) {
      const reply = await local<ImportResult & { error?: string }>(base, port, `/known-printers/${printer.id}/collect`, { method: 'POST', body: '{}' }, 10 * 60 * 1000);
      outcomes.push([printer.name, reply.status === 200 ? reply.body : reply.body.error ?? 'collection_failed']);
    }
  } else {
    const db = new AccountingDatabase(join(dataDirectory, 'accounting.sqlite3'));
    try {
      const enrolment = new PrinterEnrolment(new KnownPrinters(db), secrets, dataDirectory), collections = new Collections(new AccountingService(db), enrolment);
      for (const printer of enrolment.list()) {
        try { outcomes.push([printer.name, await collections.collect(printer.id)]); }
        catch (error) { if (!(error instanceof CollectionError)) throw error; outcomes.push([printer.name, error.state === 'failed' ? 'collection_failed' : 'printer_' + error.state]); }
      }
    } finally { db.close(); }
  }
  if (!outcomes.length) throw new UserError('No printers are set up yet. Run printtally and follow the setup screen.');
  for (const [name, outcome] of outcomes) console.log(typeof outcome === 'string' ? `${name}: ${failure[outcome] ?? 'collection failed'}` : `${name}: ${outcome.new_jobs} new job${outcome.new_jobs === 1 ? '' : 's'} (${outcome.received} read)`);
  if (outcomes.some(([, outcome]) => typeof outcome === 'string')) process.exitCode = 1;
}
const failure: Record<string, string> = {
  printer_needs_password: 'no password is saved; enter it in Print Tally',
  printer_needs_confirming: "the printer's certificate has changed; confirm it again in Print Tally before its password is used",
  printer_unreachable: "can't reach the printer; check it's switched on and on the network",
};
if (import.meta.main) main().catch((error: unknown) => {
  // Low-level errors can contain printer data; never echo response bodies or credentials.
  console.error(error instanceof UserError || error instanceof CredentialError ? error.message : 'Operation failed. Check arguments, connectivity, permissions and schema compatibility.');
  process.exitCode = 1;
});
