import { join, win32 } from 'node:path';
import { homedir } from 'node:os';

// Fixed so paired devices keep a stable address and a second client finds the first; never changed silently.
export const DEFAULT_PORT = 4318;
export const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
export function defaultDataDirectory(platform: NodeJS.Platform = process.platform, home = homedir(), appData = process.env.APPDATA): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'printtally');
  if (platform === 'win32') return win32.join(appData ?? win32.join(home, 'AppData', 'Roaming'), 'printtally');
  return join(home, '.printtally');
}
export function parsePort(text: string): number {
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) throw new Error('Invalid port');
  return port;
}
