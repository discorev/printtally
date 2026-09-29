import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORT } from './paths.ts';

// The paired remote host remembered between launches (plan decisions 3 and 6); none means this Mac.
export interface Remote { host: string; port: number }

export function loadRemote(userDataDirectory: string): Remote | undefined {
  const path = join(userDataDirectory, 'connection.json');
  if (!existsSync(path)) return undefined;
  try {
    const { remote } = JSON.parse(readFileSync(path, 'utf8')) as { remote?: Partial<Remote> };
    return typeof remote?.host === 'string' && Number.isInteger(remote.port) ? { host: remote.host, port: remote.port! } : undefined;
  } catch { return undefined; }
}

export function saveRemote(userDataDirectory: string, remote: Remote | undefined): void {
  writeFileSync(join(userDataDirectory, 'connection.json'), JSON.stringify({ remote }));
}

// A pairing link from `printtally pair` (printtally:// or http://host:port/pair#code=…), a host's
// address, or host:port. pairUrl is where the window redeems the code for its session cookie.
export function parseTarget(text: string): { remote: Remote; pairUrl: string | undefined } | undefined {
  const trimmed = text.trim();
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : 'http://' + trimmed); } catch { return undefined; }
  if ((url.protocol !== 'printtally:' && url.protocol !== 'http:') || !url.hostname) return undefined;
  const remote = { host: url.hostname, port: url.port ? Number(url.port) : DEFAULT_PORT };
  const code = new URLSearchParams(url.hash.slice(1)).get('code');
  const paired = url.pathname === '/pair' && code !== null && /^[A-Za-z\d_-]{43}$/.test(code);
  return { remote, pairUrl: paired ? `http://${remote.host}:${remote.port}/pair#code=${code}` : undefined };
}
