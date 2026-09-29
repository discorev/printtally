import { hostname, networkInterfaces } from 'node:os';
import type { IncomingMessage } from 'node:http';

// Same machine: no sign-in. Other devices (only with `serve --host`): a paired session cookie.
// Every request must name this server in Host (and Origin, when sent), which stops other web
// pages in a browser, and DNS rebinding, from reaching the API.
export const SESSION_COOKIE = 'printtally_session';
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // Browsers cap cookie lifetime at 400 days; sessions last until revoked.
export interface Network { addresses: () => string[]; names: () => string[] }
// Non-internal IPv4 addresses: the LAN, and Tailscale's 100.x address when it's running.
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap(list => list ?? []).filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address);
}
export function hostNames(name = hostname()): string[] {
  const short = name.toLowerCase().replace(/\.local\.?$/, '');
  return short ? [short, short + '.local'] : [];
}
export const systemNetwork: Network = { addresses: lanAddresses, names: hostNames };
export function isLoopback(address: string | undefined): boolean {
  return address === '::1' || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address ?? '');
}
export function allowedHosts(port: number, remote: boolean, network: Network = systemNetwork): Set<string> {
  const names = ['127.0.0.1', 'localhost', ...remote ? [...network.addresses(), ...network.names()] : []];
  return new Set(names.flatMap(name => port === 80 ? [name, name + ':80'] : [name + ':' + port]));
}
// The Host this request may use, or undefined when Host or Origin names another site.
export function checkedHost(request: IncomingMessage, allowed: Set<string>): string | undefined {
  const host = request.headers.host?.toLowerCase();
  if (!host || !allowed.has(host)) return undefined;
  const origin = request.headers.origin;
  return origin === undefined || origin.toLowerCase() === 'http://' + host ? host : undefined;
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
