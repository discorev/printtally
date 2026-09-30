import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPort, launch, startServer, UserError } from '../apps/server/src/server.ts';
import { MemoryStore } from '../apps/server/src/credentials.ts';
import { main } from '../apps/server/src/cli.ts';

const dataDirectory = () => mkdtempSync(join(tmpdir(), 'printtally-launch-'));
async function freePort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}
async function listening(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return address.port;
}

test('a second client reuses the server already running on this machine', async t => {
  const dir = dataDirectory(), secrets = new MemoryStore();
  t.after(() => rmSync(dir, { recursive: true }));
  const port = await freePort();
  const opened: string[] = [];
  const first = await launch({ dataDirectory: dir, port, secrets }, url => opened.push(url));
  t.after(() => first.running?.close());
  assert.equal(first.reused, false); assert.ok(first.running);
  assert.equal(await checkPort(port), 'printtally');
  const second = await launch({ dataDirectory: dir, port, secrets }, url => opened.push(url));
  assert.deepEqual([second.reused, second.running], [true, undefined]);
  assert.deepEqual(opened, [`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`]);
  await assert.rejects(main(['serve', '--port', String(port), '--data-dir', dir]), /already running on port/);
});

test('a port held by another program is a clear error, never a different port', async t => {
  const dir = dataDirectory();
  t.after(() => rmSync(dir, { recursive: true }));
  const web = createHttpServer((_request, response) => { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('<h1>Not found</h1>'); });
  const raw = createTcpServer(socket => socket.end('SSH-2.0-synthetic\r\n'));
  const ports = [await listening(web), await listening(raw)];
  t.after(async () => { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); await new Promise(resolve => raw.close(resolve)); });
  for (const port of ports) {
    assert.equal(await checkPort(port), 'other');
    const opened: string[] = [];
    await assert.rejects(launch({ dataDirectory: dir, port, secrets: new MemoryStore() }, url => opened.push(url)),
      (error: unknown) => error instanceof UserError && error.message.includes(`Port ${port} is already in use`));
    assert.deepEqual(opened, []);
    await assert.rejects(startServer({ dataDirectory: dir, port, secrets: new MemoryStore() }), UserError);
  }
  assert.equal(await checkPort(await freePort()), 'free');
});

test('the CLI accepts only its commands', async () => {
  for (const args of [['probe'], ['init'], ['import', 'x.json'], ['annotate', '1'], ['password'], ['serve', '--mac', '02:00:00:00:00:01'], ['serve', '--certificate-file', 'x.pem'], ['pair', '--host'], ['sessions', 'drop', 'x'], ['serve', '--port', '0']]) {
    await assert.rejects(main(args), Error, args.join(' '));
  }
});
