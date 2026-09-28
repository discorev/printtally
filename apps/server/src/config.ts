import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { homedir } from 'node:os';
import { isIPv4 } from 'node:net';

export function defaultDataDirectory(platform: NodeJS.Platform = process.platform, home = homedir(), appData = process.env.APPDATA): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'printtally');
  if (platform === 'win32') return win32.join(appData ?? win32.join(home, 'AppData', 'Roaming'), 'printtally');
  return join(home, '.printtally');
}

export interface PrinterConfig { host?: string; mac?: string; certificateFile?: string }
export function loadPrinterConfig(dataDirectory: string): PrinterConfig {
  const path = join(dataDirectory, 'printer.json');
  if (!existsSync(path)) return {};
  const input: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid local printer configuration');
  const config = input as Record<string, unknown>;
  if (Object.keys(config).some(key => !['host', 'mac', 'certificateFile'].includes(key))) throw new Error('Unknown printer configuration field');
  if (config.host !== undefined && (typeof config.host !== 'string' || !isIPv4(config.host))) throw new Error('Invalid configured printer address');
  if (config.mac !== undefined && (typeof config.mac !== 'string' || !/^(?:[0-9a-f]{12}|(?:[0-9a-f]{1,2}:){5}[0-9a-f]{1,2})$/i.test(config.mac))) throw new Error('Invalid configured printer MAC');
  if (config.certificateFile !== undefined) {
    if (typeof config.certificateFile !== 'string' || !config.certificateFile.trim()) throw new Error('Invalid printer certificate path');
    config.certificateFile = resolve(dataDirectory, config.certificateFile);
  }
  return config as PrinterConfig;
}
export function printerConnection(config: PrinterConfig, host?: string, mac?: string, certificateFile?: string): { host: string; mac?: string; certificateFile?: string } {
  // An explicit different host must not silently inherit another printer's MAC.
  const selectedHost = host ?? config.host;
  if (!selectedHost) throw new Error('Set --host or configure the printer in the private data directory');
  const useConfiguredIdentity = host === undefined || host === config.host;
  const certificate = certificateFile ?? (useConfiguredIdentity ? config.certificateFile : undefined);
  return { host: selectedHost, mac: mac ?? (useConfiguredIdentity ? config.mac : undefined), ...(certificate ? { certificateFile: certificate } : {}) };
}
