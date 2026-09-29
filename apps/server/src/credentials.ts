import { timingSafeEqual } from 'node:crypto';
import { secrets } from 'bun';

const SERVICE = 'print-accounting';
export class CredentialError extends Error {}
export class MissingCredentialError extends CredentialError {}
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
// Development only (PRINTTALLY_MEMORY_SECRETS=1): passwords are forgotten when the server stops.
export class MemoryStore implements SecretStore {
  private values = new Map<string, string>();
  async get(account: string): Promise<string | undefined> { return this.values.get(account); }
  async set(account: string, secret: string): Promise<void> { this.values.set(account, secret); }
}
function equalSecret(a: string, b: string): boolean {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export async function saveVerified(store: SecretStore, account: string, secret: string): Promise<void> {
  if (!secret || [...secret].length > 4096) throw new CredentialError('Credential is empty or too large.');
  await store.set(account, secret);
  const readback = await store.get(account);
  if (readback === undefined || !equalSecret(readback, secret)) throw new CredentialError('Credential verification failed.');
}
export async function printerPassword(store: SecretStore, account: string): Promise<string> {
  const password = await store.get(account);
  if (!password) throw new MissingCredentialError('No printer password is stored.');
  return password;
}
