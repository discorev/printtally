import { homedir } from 'node:os';
import { join } from 'node:path';

// Same fixed default as `printtally serve`: a stable address for
// paired devices, and the second client on a machine finds the first there.
export const DEFAULT_PORT = 4318;
// A local (non-release) packaged build's port, so it never borrows or opens the release server.
export const LOCAL_PORT = 4319;

// Mirrors apps/server's defaultDataDirectory for macOS, the only packaged target so far
// (AGENTS.md scope). One data folder per machine keeps bunx and the desktop app on one ledger.
export function defaultDataDirectory(home = homedir()): string {
  return join(home, 'Library', 'Application Support', 'printtally');
}

// A local build's ledger, apart from the real one (docs/build.md).
export function localDataDirectory(home = homedir()): string {
  return join(home, 'Library', 'Application Support', 'printtally-dev');
}
