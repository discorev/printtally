import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Socket } from 'node:net';
import { createServer } from 'node:tls';
import { Ivec } from 'print-accounting-ivec/protocol';
import { tlsFixtures } from './tls-fixtures.ts';
const fixtures = await tlsFixtures();
const { cert, key } = fixtures.leaves.server;
const root = fixtures.root;

test('CHMP keeps POST/GET on one socket, parses fragmented chunks, and reconnects on endpoint change', async t => {
  let connections = 0;
  const requests: { connection: number; method: string; endpoint: string }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer({ cert, key }, socket => {
    const connection = ++connections; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let input: Buffer = Buffer.alloc(0);
    socket.on('data', data => {
      input = Buffer.concat([input, data]);
      for (;;) {
        const boundary = input.indexOf('\r\n\r\n'); if (boundary < 0) return;
        const header = input.subarray(0, boundary).toString();
        const size = Number(/Content-Length: (\d+)/i.exec(header)?.[1] ?? 0);
        if (input.length < boundary + 4 + size) return;
        const [method, endpoint] = header.split(' ');
        input = input.subarray(boundary + 4 + size); requests.push({ connection, method, endpoint });
        if (method === 'POST') socket.write('HTTP/1.1 200 OK\r\n\r\n');
        else {
          socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nab');
          setImmediate(() => socket.write('c\r\n2;test=yes\r\nde\r\n0\r\nX-Test: end\r\n\r\n'));
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const client = new Ivec('127.0.0.1', { timeoutMs: 3000, port: address.port, trustedCertificatePem: root });
  t.after(async () => { client.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  assert.equal((await client.request('GetCapability')).toString(), 'abcde');
  assert.equal((await client.request('GetStatus')).toString(), 'abcde');
  assert.equal((await client.request('StartResource')).toString(), 'abcde');
  assert.deepEqual(requests.map(row => [row.connection, row.method]), [[1, 'POST'], [1, 'GET'], [1, 'POST'], [1, 'GET'], [2, 'POST'], [2, 'GET']]);
  assert.ok(requests[0].endpoint.endsWith('port1')); assert.ok(requests[4].endpoint.endsWith('port2'));
});
test('unframed GET response is rejected instead of waiting for EOF', async t => {
  const sockets = new Set<Socket>();
  const server = createServer({ cert, key }, socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('data', () => socket.write('HTTP/1.1 200 OK\r\n\r\n')); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const client = new Ivec('127.0.0.1', { timeoutMs: 3000, port: address.port, trustedCertificatePem: root });
  t.after(async () => { client.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await assert.rejects(client.request('GetCapability'), /Unframed/);
});
