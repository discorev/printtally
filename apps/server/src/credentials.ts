import { realpathSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { secrets } from 'bun';
import { canonicalMac } from 'print-accounting-ivec/protocol';
import type { CollectOptions } from 'print-accounting-contracts';

const SERVICE = 'print-accounting';
export class CredentialError extends Error {}
export interface SecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
}
// Native OS APIs, never the `security -w <password>` CLI (which exposes argv).
type SecretsApi = Pick<typeof secrets, 'get' | 'set'>;
export class KeychainStore implements SecretStore {
  private api: SecretsApi;
  constructor(api: SecretsApi = secrets) { this.api = api; }
  async get(account: string): Promise<string | undefined> {
    try {
      // Bun.secrets returns null for an absent entry; normalize at the native boundary.
      return (await this.api.get({ service: SERVICE, name: account })) ?? undefined;
    } catch { throw new CredentialError('OS credential store could not be read; unlock it and retry.'); }
  }
  async set(account: string, secret: string): Promise<void> {
    try { await this.api.set({ service: SERVICE, name: account, value: secret }); }
    catch { throw new CredentialError('OS credential store could not save the credential.'); }
  }
}
function equalSecret(a: string, b: string): boolean {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export function printerAccount(options: Pick<CollectOptions, 'host' | 'mac'>): string {
  return 'printer:' + (options.mac ? 'mac:' + canonicalMac(options.mac) : 'host:' + options.host);
}
export async function saveVerified(store: SecretStore, account: string, secret: string): Promise<void> {
  if (!secret || [...secret].length > 4096) throw new CredentialError('Credential is empty or too large.');
  await store.set(account, secret);
  const readback = await store.get(account);
  if (readback === undefined || !equalSecret(readback, secret)) throw new CredentialError('Credential verification failed.');
}
export async function printerPassword(store: SecretStore, account: string): Promise<string> {
  const password = await store.get(account);
  if (!password) throw new CredentialError('No printer password is stored. Run the password command first.');
  return password;
}
export async function apiToken(store: SecretStore, dataDirectory: string): Promise<string> {
  const account = apiAccount(dataDirectory);
  let token = await store.get(account);
  if (token === undefined) {
    token = randomBytes(32).toString('hex');
    await saveVerified(store, account, token);
  }
  if (token.length < 32) throw new CredentialError('Stored API credential is invalid.');
  return token;
}
export function apiAccount(dataDirectory: string): string {
  return 'api:' + createHash('sha256').update(realpathSync(resolve(dataDirectory))).digest('hex');
}
