import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HealthResponse, PairingCodeResponse, SessionsResponse } from 'print-accounting-contracts';
import { Sessions, PAIRING_TTL_MS } from '../apps/server/src/sessions.ts';
import { hostChecker, hostNames, isLoopback, loopbackHosts, type Network } from '../apps/server/src/access.ts';
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
  assert.deepEqual(hostNames('Studio-Mac.local'), ['studio-mac', 'studio-mac.local']);
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.0.2.50') && !isLoopback('::ffff:192.0.2.50') && !isLoopback(undefined));
});

// A Tailscale-style machine: a LAN address, a 100.x address, and names resolved by a fake resolver.
function tailnet(records: Record<string, string[] | 'fail' | 'hang'> = {}) {
  const calls: string[] = [];
  const net: Network = {
    addresses: () => ['192.0.2.50', '100.101.102.103'], names: () => ['studio-mac', 'studio-mac.local'],
    lookup: name => {
      calls.push(name);
      const record = records[name];
      if (record === 'hang') return new Promise(() => {});
      return record === undefined || record === 'fail' ? Promise.reject(new Error('ENOTFOUND')) : Promise.resolve(record);
    },
  };
  return { net, calls };
}
const headers = (host: string, origin?: string) => ({ headers: { host, ...origin === undefined ? {} : { origin } } });

test('loopback connections accept only 127.0.0.1 and localhost; the network also gets this machine\'s names', async () => {
  const { net, calls } = tailnet({ 'studio-mac.tail1234.ts.net': ['100.101.102.103'] });
  assert.deepEqual(loopbackHosts(4318), ['127.0.0.1:4318', 'localhost:4318']);
  const off = hostChecker(false, net), on = hostChecker(true, net);
  for (const check of [off, on]) {
    assert.equal(await check(headers('127.0.0.1:4318'), 4318, true), '127.0.0.1:4318');
    assert.equal(await check(headers('LOCALHOST:4318', 'http://localhost:4318'), 4318, true), 'localhost:4318');
    // The no-sign-in path never widens, even with remote access on.
    for (const host of ['192.0.2.50:4318', 'studio-mac.local:4318', 'studio-mac.tail1234.ts.net:4318', 'localhost.:4318', '127.0.0.1:4319']) {
      assert.equal(await check(headers(host), 4318, true), undefined, host);
    }
  }
  assert.equal(await off(headers('192.0.2.50:4318'), 4318, false), undefined, 'remote access off');
  assert.equal(await on(headers('192.0.2.50:4318'), 4318, false), '192.0.2.50:4318');
  assert.equal(await on(headers('studio-mac.local.:4318'), 4318, false), 'studio-mac.local.:4318');
  // IP literals must be this machine's own; they, and non-DNS names, are never looked up.
  for (const host of ['198.51.100.7:4318', '3232235781:4318', '[::1]:4318', 'under_score:4318', 'a..b:4318', '.:4318']) {
    assert.equal(await on(headers(host), 4318, false), undefined, host);
  }
  assert.deepEqual(calls, []);
});

test('from the network, a DNS name (MagicDNS or custom) is accepted only when it resolves to this machine', async () => {
  const clock = { time: 0 };
  const { net, calls } = tailnet({
    'studio-mac.tail1234.ts.net': ['100.101.102.103'], 'printer-mac.home.arpa': ['192.0.2.50', '100.101.102.103'],
    'elsewhere.tail1234.ts.net': ['100.64.0.9'], 'mixed.example': ['100.101.102.103', '203.0.113.9'], 'empty.example': [],
    'v6.example': ['fd7a:115c:a1e0::1'], 'slow.example': 'hang',
  });
  const check = hostChecker(true, net, { timeoutMs: 20, clock: () => clock.time });
  const magic = 'studio-mac.tail1234.ts.net:4318';
  assert.equal(await check(headers(magic, 'http://' + magic), 4318, false), magic);
  assert.equal(await check(headers('STUDIO-MAC.Tail1234.ts.net.:4318', 'http://studio-mac.tail1234.ts.net.:4318'), 4318, false), 'studio-mac.tail1234.ts.net.:4318');
  assert.equal(await check(headers('printer-mac.home.arpa:4318'), 4318, false), 'printer-mac.home.arpa:4318');
  for (const [host, origin] of [[magic, 'http://unrelated.example'], [magic, 'https://' + magic], ['studio-mac.tail1234.ts.net:4319', undefined], ['studio-mac.tail1234.ts.net', undefined], ['studio-mac.tail1234.ts.net:04318', undefined]]) {
    assert.equal(await check(headers(host!, origin), 4318, false), undefined, `${host} ${origin}`);
  }
  assert.equal(await check(headers('studio-mac.tail1234.ts.net'), 80, false), 'studio-mac.tail1234.ts.net');
  for (const name of ['elsewhere.tail1234.ts.net', 'mixed.example', 'empty.example', 'v6.example', 'unknown.example', 'slow.example']) {
    assert.equal(await check(headers(name + ':4318'), 4318, false), undefined, name);
  }
  // Answers, including failures, are cached for a minute.
  const counted = (name: string): number => calls.filter(item => item === name).length;
  await check(headers('unknown.example:4318'), 4318, false); await check(headers(magic), 4318, false);
  assert.deepEqual([counted('studio-mac.tail1234.ts.net'), counted('unknown.example'), counted('slow.example')], [1, 1, 1]);
  clock.time += 60_000;
  await check(headers('unknown.example:4318'), 4318, false); await check(headers(magic), 4318, false);
  assert.deepEqual([counted('studio-mac.tail1234.ts.net'), counted('unknown.example')], [2, 2]);
});

test('a MagicDNS name reaches the API from another device only with a session, and never from loopback', async t => {
  const { net } = tailnet({ 'studio-mac.tail1234.ts.net': ['100.101.102.103'], 'elsewhere.tail1234.ts.net': ['100.64.0.9'] });
  const f = await apiFixture(t, { remote: true, network: net }), magic = `studio-mac.tail1234.ts.net:${f.port}`;
  const token = f.sessions.redeem(f.sessions.createPairing('Phone').code)!;
  f.peer.remote = true;
  assert.equal((await f.request('/api/v1/health', { host: magic })).status, 401);
  assert.equal((await f.request('/api/v1/health', { host: magic, headers: { Cookie: 'printtally_session=' + token } })).status, 200);
  assert.equal((await f.request('/api/v1/papers', { method: 'POST', host: magic, headers: { Cookie: 'printtally_session=' + token, Origin: 'http://unrelated.example' }, body: { name: 'Cross-site' } })).status, 403);
  assert.equal((await f.request('/api/v1/health', { host: `elsewhere.tail1234.ts.net:${f.port}`, headers: { Cookie: 'printtally_session=' + token } })).status, 403);
  f.peer.remote = false;
  assert.equal((await f.request('/api/v1/health', { host: magic })).status, 403);
  assert.equal((await f.request('/', { host: magic })).status, 403);
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
