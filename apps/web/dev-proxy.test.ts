import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { apiProxy } from './dev-proxy.ts';
import { apiFixture } from '../../tests/api-fixtures.ts';

test('the dev proxy lets its own pages edit through the API, and still refuses other origins', async t => {
  const f = await apiFixture(t), root = mkdtempSync(join(tmpdir(), 'printtally-vite-'));
  const vite = await createServer({ root, configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, proxy: { '/api': apiProxy(`http://127.0.0.1:${f.port}`) } } });
  await vite.listen();
  t.after(async () => { await vite.close(); rmSync(root, { recursive: true }); });
  const address = vite.httpServer!.address(), base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
  const post = (origin: string) => fetch(base + '/api/v1/papers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Museum Etching', media_types: [] }) });
  assert.equal((await post(base)).status, 201);
  assert.equal((await post('http://evil.example')).status, 403);
});
