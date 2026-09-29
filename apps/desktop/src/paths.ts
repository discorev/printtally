import { homedir } from 'node:os';
import { join } from 'node:path';

// Same fixed default as `printtally serve` (plan decision 13): a stable address for
// paired devices, and the second client on a machine finds the first there.
export const DEFAULT_PORT = 4318;

// Mirrors apps/server's defaultDataDirectory for macOS, the only packaged target so far
// (AGENTS.md scope). One data folder per machine keeps bunx and the desktop app on one ledger.
export function defaultDataDirectory(): string {
  return join(homedir(), 'Library', 'Application Support', 'printtally');
}
