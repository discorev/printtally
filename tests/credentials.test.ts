import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeychainStore, MissingCredentialError, saveVerified, printerPassword, type SecretStore } from '../apps/server/src/credentials.ts';
class MemoryStore implements SecretStore {
  values = new Map<string, string>();
  async get(account: string) { return this.values.get(account); }
  async set(account: string, secret: string) { this.values.set(account, secret); }
}
const account = 'synthetic-test-account';
test('missing password fails without a plaintext fallback; saved password is verified', async () => {
  const store = new MemoryStore(); await assert.rejects(printerPassword(store, account), MissingCredentialError);
  await saveVerified(store, account, 'synthetic credential'); assert.equal(await printerPassword(store, account), 'synthetic credential');
});
test('native missing-entry null is normalized and native errors never escape', async () => {
  const empty = new KeychainStore({ get: async () => null, set: async () => {} });
  assert.equal(await empty.get(account), undefined);
  const failed = new KeychainStore({ get: async () => { throw new Error('native-secret-details'); }, set: async () => {} });
  await assert.rejects(failed.get(account), error => error instanceof Error && !error.message.includes('native-secret-details'));
});
