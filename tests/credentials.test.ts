import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KeychainStore, saveVerified, printerPassword, printerAccount, apiToken, type SecretStore } from '../apps/server/src/credentials.ts';
class MemoryStore implements SecretStore {
  values = new Map<string, string>();
  async get(account: string) { return this.values.get(account); }
  async set(account: string, secret: string) { this.values.set(account, secret); }
}
const account = 'synthetic-test-account';
function fixture(t: import('node:test').TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-credential-'));
  t.after(() => rmSync(dir, { recursive: true }));
  return { dir };
}
test('missing password fails without a plaintext fallback; saved password is verified', async () => {
  const store = new MemoryStore(); await assert.rejects(printerPassword(store, account));
  await saveVerified(store, account, 'synthetic credential'); assert.equal(await printerPassword(store, account), 'synthetic credential');
});
test('printer credentials use stable MAC when configured, with explicit host fallback', () => {
  assert.equal(printerAccount({ host: '192.0.2.10', mac: '02:00:00:00:00:01' }), printerAccount({ host: '192.0.2.20', mac: '020000000001' }));
  assert.notEqual(printerAccount({ host: '192.0.2.10' }), printerAccount({ host: '192.0.2.20' }));
});
test('API token is persisted only in the secret store, not a plaintext file', async t => {
  const { dir } = fixture(t), store = new MemoryStore();
  const token = await apiToken(store, dir); assert.equal(token.length, 64);
  assert.equal(await apiToken(store, dir), token); assert.equal(existsSync(join(dir, 'api-token')), false);
});

test('native missing-entry null is normalized and native errors never escape', async () => {
  const empty = new KeychainStore({ get: async () => null, set: async () => {} });
  assert.equal(await empty.get(account), undefined);
  const failed = new KeychainStore({ get: async () => { throw new Error('native-secret-details'); }, set: async () => {} });
  await assert.rejects(failed.get(account), error => error instanceof Error && !error.message.includes('native-secret-details'));
});
