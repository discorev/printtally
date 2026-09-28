import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:tls';
import { createServer as createPlainServer, type Socket } from 'node:net';
import { Ivec, authenticated } from 'print-accounting-ivec/protocol';
import { tlsFixtures } from './tls-fixtures.ts';
const fixtures = await tlsFixtures();
const root = fixtures.root;
async function tlsServer(t: TestContext, identity: keyof typeof fixtures.leaves = 'server') {
  let applicationBytes = 0;
  const sockets = new Set<Socket>();
  const leaf = fixtures.leaves[identity];
  const server = createServer({ cert: leaf.cert, key: leaf.key }, socket => {
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', data => {
      applicationBytes += data.length;
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const boundary = buffer.indexOf('\r\n\r\n'); if (boundary < 0) return;
        const header = buffer.subarray(0, boundary).toString();
        const size = Number(/Content-Length: (\d+)/i.exec(header)?.[1] ?? 0);
        if (buffer.length < boundary + 4 + size) return;
        buffer = buffer.subarray(boundary + 4 + size);
        socket.write(header.startsWith('POST ') ? 'HTTP/1.1 200 OK\r\n\r\n' : 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK');
      }
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { port: address.port, bytes: () => applicationBytes };
}
for (const [label, identity, trust] of [
  ['untrusted root', 'server', undefined],
  ['unrelated root', 'server', fixtures.otherRoot],
  ['wrong destination address', 'wrong-host', root],
  ['expired server certificate', 'expired', root],
] as const) {
  test(label + ' fails before any IVEC or authentication bytes', async t => {
    const server = await tlsServer(t, identity);
    const client = new Ivec('127.0.0.1', { port: server.port, timeoutMs: 3000, trustedCertificatePem: trust });
    t.after(() => client.close());
    await assert.rejects(authenticated(client, 'GetStatus', 'synthetic password'), /Verified TLS/);
    assert.equal(server.bytes(), 0);
  });
}
test('root trust accepts both original and renewed server certificates with different keys', async t => {
  assert.notEqual(fixtures.leaves.server.cert, fixtures.leaves.changed.cert);
  assert.notEqual(fixtures.leaves.server.key, fixtures.leaves.changed.key);
  for (const identity of ['server', 'changed'] as const) {
    const server = await tlsServer(t, identity);
    const client = new Ivec('127.0.0.1', { port: server.port, timeoutMs: 3000, trustedCertificatePem: root });
    try {
      assert.equal((await client.request('GetCapability')).toString(), 'OK');
      assert.ok(server.bytes() > 0);
    } finally { client.close(); }
  }
});
test('plaintext endpoint cannot trigger HTTP fallback', async t => {
  const chunks: Buffer[] = [], sockets = new Set<Socket>();
  let connections = 0;
  const server = createPlainServer(socket => {
    connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('data', data => { chunks.push(data); socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const client = new Ivec('127.0.0.1', { port: address.port, timeoutMs: 3000, trustedCertificatePem: root });
  t.after(async () => { client.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await assert.rejects(client.request('GetCapability'), /Verified TLS/);
  assert.equal(connections, 1);
  assert.equal(Buffer.concat(chunks)[0], 0x16); // TLS handshake, never HTTP/XML.
  assert.equal(Buffer.concat(chunks).includes(Buffer.from('POST /canon')), false);
});
test('malformed, multiple and non-CA certificates are rejected before networking', () => {
  for (const pem of ['not a certificate', root + root, fixtures.leaves.server.cert]) {
    assert.throws(() => new Ivec('127.0.0.1', { trustedCertificatePem: pem }), /root certificate|root CA certificate/);
  }
});
