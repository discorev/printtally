import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AccountingDatabase, KnownPrinters } from 'print-accounting-database';
import { probe, validateOptions } from 'print-accounting-ivec';
import { secureWrite } from 'print-accounting-ivec/files';
import { csvExport } from 'print-accounting-core';
import type { CollectOptions, Annotation } from 'print-accounting-contracts';
import { AccountingService } from './service.ts';
import { PrinterEnrolment } from './printer-enrolment.ts';
import { createApi } from './http.ts';
import { defaultDataDirectory, loadPrinterConfig, printerConnection } from './config.ts';
import { KeychainStore, CredentialError, printerAccount, printerPassword, apiToken, saveVerified } from './credentials.ts';

const help = `Print Tally — print history and cost accounting for Canon imagePROGRAF printers

bun run cli <command> [options]
Commands: probe, collect, init, summary, import <snapshot>, annotate <job-id>, serve, password

--data-dir PATH       Private state directory (default ~/Library/Application Support/printtally
                      on macOS, ~/.printtally on Linux, %APPDATA%\\printtally on Windows)
--database PATH       SQLite archive (default <data-dir>/accounting.sqlite3)
--host IPV4           Printer address; otherwise read private printer.json
--mac ADDRESS         Printer interface MAC; required off macOS or across routers
--certificate-file PATH  Trusted printer root CA certificate PEM (HTTPS only)
--output PATH         Collection JSON (default <data-dir>/jobs.json)
--csv PATH            Optional collection CSV
--limit N             Collect latest N IDs
--batch-size N        1–20 (default 20)
--media-language EN   Preferred media name language
--paper-name TEXT / --clear-paper-name, --hide / --show, --notes TEXT
--port N              Loopback API port (default 4318)

Passwords and API tokens use the OS credential store (Keychain on macOS).
serve binds 127.0.0.1 only. All API routes require the bearer token.
No UI, automatic polling or cost calculation is implemented yet.
`;
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    'data-dir': { type: 'string' }, database: { type: 'string' }, host: { type: 'string' },
    mac: { type: 'string' }, 'certificate-file': { type: 'string' }, output: { type: 'string' }, csv: { type: 'string' },
    limit: { type: 'string' }, 'batch-size': { type: 'string', default: '20' }, 'media-language': { type: 'string', default: 'EN' },
    'paper-name': { type: 'string' }, 'clear-paper-name': { type: 'boolean' }, hide: { type: 'boolean' }, show: { type: 'boolean' }, notes: { type: 'string' },
    port: { type: 'string', default: '4318' }, help: { type: 'boolean', short: 'h' },
  }});
  if (values.help || !positionals.length) { console.log(help); return; }
  const command = positionals[0];
  if (!['probe', 'collect', 'init', 'summary', 'import', 'annotate', 'serve', 'password'].includes(command)) throw new Error('Unknown command');
  const data = resolve(values['data-dir'] ?? defaultDataDirectory());
  const networkCommand = ['probe', 'collect', 'serve', 'password'].includes(command);
  const config = networkCommand ? loadPrinterConfig(data) : {};
  const hasConnection = networkCommand && (command !== 'serve' || values.host !== undefined || config.host !== undefined);
  const connection = hasConnection ? printerConnection(config, values.host, values.mac, values['certificate-file'] === undefined ? undefined : resolve(values['certificate-file'])) : undefined;
  const options: CollectOptions = {
    host: connection?.host ?? '', mac: connection?.mac,
    trustedCertificatePem: connection?.certificateFile && ['probe', 'collect', 'serve'].includes(command) ? readFileSync(connection.certificateFile, 'utf8') : undefined,
    cacheDirectory: data, batchSize: Number(values['batch-size']), limit: values.limit === undefined ? undefined : Number(values.limit), mediaLanguage: values['media-language'].toUpperCase(),
  };
  const store = new KeychainStore();
  const getPassword = () => printerPassword(store, printerAccount(options));
  if (command === 'password') { await setPassword(store, printerAccount(options)); return; }
  if (command === 'probe') { console.log(JSON.stringify(await probe(options.host, options.trustedCertificatePem), null, 2)); return; }
  if (command === 'collect' || command === 'serve') validateOptions(options);
  const db = new AccountingDatabase(resolve(values.database ?? join(data, 'accounting.sqlite3')));
  let serving = false;
  try {
    if (command === 'init' || command === 'summary') console.log(JSON.stringify(db.summary(), null, 2));
    else if (command === 'import') {
      if (positionals.length !== 2) throw new Error('Expected snapshot path');
      console.log(JSON.stringify(db.importSnapshot(JSON.parse(readFileSync(positionals[1], 'utf8'))), null, 2));
    } else if (command === 'annotate') {
      const id = Number(positionals[1]);
      if (!Number.isSafeInteger(id) || id < 1 || positionals.length !== 2 || (values.hide && values.show) || (values['paper-name'] !== undefined && values['clear-paper-name'])) throw new Error('Invalid annotation options');
      const changes: Annotation = {};
      if (values['paper-name'] !== undefined || values['clear-paper-name']) changes.custom_paper_name = values['clear-paper-name'] ? null : values['paper-name'];
      if (values.hide || values.show) changes.hidden = values.hide ? 1 : 0;
      if (values.notes !== undefined) changes.notes = values.notes;
      db.annotateJob(id, changes);
      console.log('Job annotation saved.');
    } else if (command === 'collect') {
      const { snapshot, result } = await new AccountingService(db, getPassword).collect(options, console.log);
      secureWrite(resolve(values.output ?? join(data, 'jobs.json')), JSON.stringify(snapshot, null, 2) + '\n');
      if (values.csv) secureWrite(resolve(values.csv), csvExport(snapshot.records, snapshot.schema));
      console.log(JSON.stringify(result));
    } else if (command === 'serve') {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
      const service = new AccountingService(db, getPassword);
      const server = createApi(service, await apiToken(store, data), connection ? options : undefined, new PrinterEnrolment(new KnownPrinters(db), store, data));
      await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
      serving = true;
      const address = server.address();
      console.log(`API listening at http://127.0.0.1:${typeof address === 'object' ? address?.port : port}; API credential stored in the OS credential store`);
      let stopping = false;
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        server.close(() => { db.close(); process.off('SIGINT', stop); process.off('SIGTERM', stop); });
        server.closeIdleConnections();
      };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    }
  } finally { if (!serving) db.close(); }
}
async function setPassword(store: KeychainStore, account: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run password helper in an interactive terminal');
  process.stdout.write('Printer admin password (hidden): ');
  const password = await new Promise<string>((done, reject) => {
    let input = '';
    const previousRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
    const finish = (error?: Error): void => {
      process.stdin.off('data', onData); process.stdin.setRawMode(previousRaw); process.stdin.pause(); process.stdout.write('\n');
      if (error) reject(error); else done(input);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\u0003' || char === '\u0004') { finish(new Error('Password entry cancelled')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') input = [...input].slice(0, -1).join('');
        else if (char >= ' ') input += char;
        if (input.length > 4096) { finish(new Error('Password too long')); return; }
      }
    };
    process.stdin.on('data', onData);
  });
  if (!password) throw new Error('Empty password; nothing saved');
  await saveVerified(store, account, password);
  console.log('Password saved in the OS credential store and verified.');
}
if (import.meta.main) main().catch((error: unknown) => {
  // Low-level errors can contain printer data; never echo response bodies or credentials.
  console.error(error instanceof CredentialError ? error.message : 'Operation failed. Check arguments, connectivity, permissions and schema compatibility.');
  process.exitCode = 1;
});
