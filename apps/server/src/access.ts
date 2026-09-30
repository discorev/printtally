import { hostname, networkInterfaces } from 'node:os';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';

// Same machine: no sign-in. Other devices (only with `serve --host`): a paired session cookie.
// Every request must name this server in Host (and Origin, when sent), which stops other web
// pages in a browser, and DNS rebinding, from reaching the API.
export const SESSION_COOKIE = 'printtally_session';
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // Browsers cap cookie lifetime at 400 days; sessions last until revoked.
// `lookup` resolves a name to its IPv4 addresses (the server listens on 0.0.0.0, so only those reach it).
export interface Network { addresses: () => string[]; names: () => string[]; lookup: (name: string) => Promise<string[]> }
// Non-internal IPv4 addresses: the LAN, and Tailscale's 100.x address when it's running.
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(list => list ?? []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address);
}
export function hostNames(name = hostname()): string[] {
  const short = name.toLowerCase().replace(/\.local\.?$/, '');
  return short ? [short, short + '.local'] : [];
}
// The system resolver, so MagicDNS, /etc/hosts and mDNS names resolve as they do for this machine.
const lookupIPv4 = async (name: string): Promise<string[]> => (await lookup(name, { all: true, family: 4 })).map(item => item.address);
export const systemNetwork: Network = { addresses: lanAddresses, names: hostNames, lookup: lookupIPv4 };
export function isLoopback(address: string | undefined): boolean {
  return address === '::1' || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address ?? '');
}
export const loopbackHosts = (port: number): string[] => ['127.0.0.1', 'localhost'].flatMap(name => port === 80 ? [name, name + ':80'] : [name + ':' + port]);
// A DNS name, not an IP literal: the last label must start with a letter (as TLDs and short hostnames do).
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export interface HostCheckOptions { timeoutMs?: number; cacheMs?: number; clock?: () => number }
export type HostCheck = (request: Pick<IncomingMessage, 'headers'>, port: number, local: boolean) => Promise<string | undefined>;
// Returns the Host a request may use, or undefined when Host or Origin names another site.
// Loopback connections: only 127.0.0.1:<port> or localhost:<port>, so DNS rebinding can't reach the
// no-sign-in path. With remote access on, connections from the network (which still need a session)
// may also use this machine's LAN addresses and hostname, or any DNS name (MagicDNS, custom DNS)
// whose IPv4 addresses are all this machine's. Lookups are cached, time out, and fail closed.
export function hostChecker(remote: boolean, network: Network, { timeoutMs = 2000, cacheMs = 60_000, clock = Date.now }: HostCheckOptions = {}): HostCheck {
  const cache = new Map<string, { expires: number; addresses: Promise<string[]> }>();
  let pending = 0;
  const resolve = (name: string): Promise<string[]> => {
    const hit = cache.get(name);
    if (hit && hit.expires > clock()) return hit.addresses;
    if (pending >= 8) return Promise.resolve([]); // Too many lookups in flight: refuse, uncached.
    pending++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs); });
    const found = Promise.resolve().then(() => network.lookup(name)).finally(() => pending--);
    const addresses = Promise.race([found, timeout]).catch((): string[] => []).finally(() => clearTimeout(timer));
    cache.delete(name);
    cache.set(name, { expires: clock() + cacheMs, addresses });
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
    return addresses;
  };
  return async (request, port, local) => {
    const host = request.headers.host?.toLowerCase(), origin = request.headers.origin;
    if (!host || (origin !== undefined && origin.toLowerCase() !== 'http://' + host)) return undefined;
    if (loopbackHosts(port).includes(host)) return host;
    if (local || !remote) return undefined;
    const [, raw, portText] = /^([^:]+)(?::(\d+))?$/.exec(host) ?? [];
    if (!raw || (portText === undefined ? port !== 80 : portText !== String(port))) return undefined;
    const name = raw.replace(/\.$/, ''), own = network.addresses();
    if (own.includes(name) || network.names().includes(name)) return host;
    if (!DNS_NAME.test(name)) return undefined;
    const addresses = await resolve(name);
    return addresses.length && addresses.every(address => own.includes(address)) ? host : undefined;
  };
}
export function sessionToken(request: IncomingMessage): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE && /^[A-Za-z0-9_-]{43}$/.test(value ?? '')) return value;
  }
  return undefined;
}
// No Secure flag: remote access is plain HTTP on a trusted network (see README).
export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`;
export const pairingLink = (base: string, code: string): string => base + '/pair#code=' + code;
