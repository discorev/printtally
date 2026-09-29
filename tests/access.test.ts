import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HealthResponse, PairingCodeResponse, SessionsResponse } from 'print-accounting-contracts';
import { Sessions, PAIRING_TTL_MS } from '../apps/server/src/sessions.ts';
import { allowedHosts, hostNames, isLoopback } from '../apps/server/src/access.ts';
import { startServer } from '../apps/server/src/server.ts';
import { MemoryStore } from '../apps/server/src/credentials.ts';
import { apiFixture, network } from './api-fixtures.ts';

test('same-machine requests need no sign-in; Host and Origin must name this server', async t => {
  const f = await apiFixture(t), local = `127.0.0.1:${f.port}`;
  const health = await f.request('/api/v1/health');
  assert.equal(health.status, 200);
  assert.deepEqual([health.json<HealthResponse>().service, health.json<HealthResponse>().state], ['printtally', 'needs_printer']);
  assert.equal((await f.request('/api/v1/jobs', { host: `localhost:${f.port}` })).status, 200);
  assert.equal((await f.request('/api/v1/jobs', { headers: { Origin: 'http://' + local } })).status, 200);
  for (const host of ['unrelated.example', `unrelated.example:${f.port}`, `127.0.0.1:${f.port + 1}`, `192.0.2.50:${f.port}`, `studio-mac.local:${f.port}`]) {
    assert.equal((await f.request('/api/v1/health', { host })).status, 403, host);
    assert.equal((await f.request('/', { host })).status, 403, host);
  }
  for (const origin of ['https://unrelated.example', 'null', `http://localhost:${f.port}`, `https://${local}`]) {
    assert.equal((await f.request('/api/v1/papers', { method: 'POST', headers: { Origin: origin }, body: { name: 'Cross-site' } })).status, 403, origin);
  }
  assert.equal(f.db.get('SELECT count(*) AS n FROM papers')!.n, 0);
  // Remote access is off, so there is nothing to pair with.
  assert.equal((await f.request('/api/v1/pairing-codes', { method: 'POST', body: {} })).status, 409);
});

test('remote access is off by default: loopback only, and LAN names are rejected', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-serve-'));
  t.after(() => rmSync(dir, { recursive: true }));
  for (const remote of [false, true]) {
    const running = await startServer({ dataDirectory: dir, port: 0, secrets: new MemoryStore(), remote, network });
    const address = running.server.address();
    await running.close();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, remote ? '0.0.0.0' : '127.0.0.1');
  }
  assert.deepEqual([...allowedHosts(4318, false, network)], ['127.0.0.1:4318', 'localhost:4318']);
  assert.ok(allowedHosts(4318, true, network).has('studio-mac.local:4318'));
  assert.deepEqual(hostNames('Studio-Mac.local'), ['studio-mac', 'studio-mac.local']);
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.0.2.50') && !isLoopback('::ffff:192.0.2.50') && !isLoopback(undefined));
});

test('other devices need a paired session; a pairing code works once, and sessions can be revoked', async t => {
  const f = await apiFixture(t, { remote: true }), lan = `192.0.2.50:${f.port}`;
  const remote = (path: string, init: { method?: string; cookie?: string; origin?: string; body?: unknown; host?: string } = {}) => f.request(path, {
    method: init.method, host: init.host ?? lan, body: init.body,
    headers: { ...init.cookie ? { Cookie: init.cookie } : {}, ...init.origin ? { Origin: init.origin } : {} },
  });
  f.peer.remote = true;
  assert.equal((await remote('/api/v1/health')).status, 401);
  assert.equal((await remote('/api/v1/jobs', { host: `studio-mac.local:${f.port}` })).status, 401);
  assert.equal((await remote('/pair')).status, 200);
  assert.equal((await remote('/api/v1/pairing-codes', { method: 'POST', body: {} })).status, 401);

  f.peer.remote = false;
  const issued = await f.request('/api/v1/pairing-codes', { method: 'POST', body: { label: 'iPad' } });
  assert.equal(issued.status, 201);
  const { code, links, expiresAt } = issued.json<PairingCodeResponse>();
  assert.deepEqual(links, [`http://${lan}/pair#code=${code}`, `http://studio-mac:${f.port}/pair#code=${code}`, `http://studio-mac.local:${f.port}/pair#code=${code}`]);
  assert.equal(Date.parse(expiresAt), f.clock.time + PAIRING_TTL_MS);

  f.peer.remote = true;
  assert.equal((await remote('/api/v1/pairing', { method: 'POST', origin: 'http://unrelated.example', body: { code } })).status, 403);
  const paired = await remote('/api/v1/pairing', { method: 'POST', origin: 'http://' + lan, body: { code } });
  assert.equal(paired.status, 200);
  const cookie = String(paired.headers['set-cookie']);
  assert.match(cookie, /^printtally_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
  const session = cookie.split(';')[0], token = session.split('=')[1];
  assert.equal((await remote('/api/v1/pairing', { method: 'POST', body: { code } })).status, 401, 'a code works once');
  assert.equal((await remote('/api/v1/health', { cookie: session })).status, 200);
  assert.equal((await remote('/api/v1/health', { cookie: 'printtally_session=' + 'x'.repeat(43) })).status, 401);
  assert.equal((await remote('/api/v1/papers', { method: 'POST', cookie: session, origin: 'http://unrelated.example', body: { name: 'Cross-site' } })).status, 403);
  assert.equal((await remote('/api/v1/papers', { method: 'POST', cookie: session, origin: 'http://' + lan, body: { name: 'From the iPad' } })).status, 201);
  assert.equal((await remote('/api/v1/sessions', { cookie: session })).status, 403, 'paired devices cannot manage pairing');

  // Stored hashed, never as the token itself, and still valid after a restart.
  const file = readFileSync(join(f.dir, 'sessions.json'), 'utf8');
  assert.ok(!file.includes(token) && !file.includes(code));
  assert.ok(file.includes(createHash('sha256').update(token).digest('hex')));
  assert.ok(new Sessions(join(f.dir, 'sessions.json')).verify(token));

  f.peer.remote = false;
  const listed = (await f.request('/api/v1/sessions')).json<SessionsResponse>().sessions;
  assert.equal(listed.length, 1); assert.equal(listed[0].label, 'iPad'); assert.ok(!JSON.stringify(listed).includes(token));
  assert.equal((await f.request('/api/v1/sessions/' + listed[0].id, { method: 'DELETE' })).status, 200);
  assert.equal((await f.request('/api/v1/sessions/' + listed[0].id, { method: 'DELETE' })).status, 404);
  f.peer.remote = true;
  assert.equal((await remote('/api/v1/health', { cookie: session })).status, 401, 'revoked');
});

test('pairing codes expire after five minutes and are single-use even when a redemption fails', t => {
  const clock = { time: 1_000_000 }, dir = mkdtempSync(join(tmpdir(), 'printtally-sessions-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const sessions = new Sessions(join(dir, 'sessions.json'), () => clock.time);
  const late = sessions.createPairing();
  clock.time += PAIRING_TTL_MS;
  assert.equal(sessions.redeem(late.code), undefined);
  assert.equal(sessions.redeem('x'.repeat(43)), undefined);
  const early = sessions.createPairing();
  clock.time += PAIRING_TTL_MS - 1;
  const token = sessions.redeem(early.code, 'Synthetic browser');
  assert.ok(token && sessions.verify(token));
  assert.equal(sessions.redeem(early.code), undefined);
  for (let i = 0; i < 20; i++) sessions.createPairing();
  assert.throws(() => sessions.createPairing(), /Too many/);
  // A damaged sessions file fails closed: every device pairs again.
  writeFileSync(join(dir, 'sessions.json'), '{not json');
  assert.equal(new Sessions(join(dir, 'sessions.json')).verify(token), false);
});
