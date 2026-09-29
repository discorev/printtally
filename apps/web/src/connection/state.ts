import type { HealthResponse } from 'print-accounting-contracts';

// The client side of the plan's state diagram (decision 6): connected, or the server is lost (banner,
// loaded data read-only, edits blocked, retry with backoff), or this device's session was revoked (401).
export type ConnectionStatus = 'connecting' | 'connected' | 'lost' | 'unauthorized';
export interface ConnectionState {
  status: ConnectionStatus;
  health: HealthResponse | null; // The last health the server gave; kept while it's lost.
  failures: number; // Consecutive failed checks since it was last reachable.
  retryAt: number | null; // When the next check runs while lost (ms since epoch).
}
export type ConnectionEvent = { type: 'ok'; health: HealthResponse } | { type: 'unreachable' } | { type: 'unauthorized' };

export const initialConnection: ConnectionState = { status: 'connecting', health: null, failures: 0, retryAt: null };
const MAX_BACKOFF_MS = 30_000;
/** 1 s, 2 s, 4 s … capped at 30 s. */
export const backoffMs = (failures: number): number => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failures - 1));

export function reduce(state: ConnectionState, event: ConnectionEvent, now: number): ConnectionState {
  switch (event.type) {
    case 'ok': return { status: 'connected', health: event.health, failures: 0, retryAt: null };
    case 'unauthorized': return { ...state, status: 'unauthorized', retryAt: null };
    case 'unreachable': {
      if (state.status === 'unauthorized') return state;
      const failures = state.failures + 1;
      return { ...state, status: 'lost', failures, retryAt: now + backoffMs(failures) };
    }
  }
}
/** Edits are allowed only while the server is confirmed reachable; nothing is ever queued. */
export const canEdit = (state: ConnectionState): boolean => state.status === 'connected';
/** The server's name: from its last health answer, else the one it gave last time this address was used, else the address. */
export const serverName = (health: HealthResponse | null, remembered: string | null, address: string): string => health?.hostName ?? remembered ?? address;
