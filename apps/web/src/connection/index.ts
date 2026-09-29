import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HealthResponse, MissedJobs } from 'print-accounting-contracts';
import { api } from '../api/endpoints.ts';
import { onRequestOutcome, setEditGate } from '../api/client.ts';
import { queryClient } from '../api/queries.ts';
import { ConnectionMonitor } from './monitor.ts';
import type { ConnectionState } from './state.ts';

export { canEdit, backoffMs, type ConnectionState, type ConnectionStatus } from './state.ts';

// The app's one connection monitor, fed by every API request.
export const connection = new ConnectionMonitor({ fetchHealth: api.health });
onRequestOutcome(outcome => connection.report(outcome));
setEditGate(connection.canEdit);
connection.subscribe((state, previous) => {
  // Back from lost: refetch everything, so what's shown is current again.
  if (previous.status === 'lost' && state.status === 'connected') void queryClient.invalidateQueries();
  // A collection brought new jobs (on start, every 15 minutes, or from another device): show them.
  const last = state.health?.lastCollection, before = previous.health?.lastCollection;
  if (last && before && last.at !== before.at && last.newJobs) void queryClient.invalidateQueries();
});

export const useConnection = (): ConnectionState => useSyncExternalStore(connection.subscribe, connection.getState);
/** False while the server is lost (or not yet reached): disable edit controls and show the paused notice. */
export const useCanEdit = (): boolean => useConnection().status === 'connected';
/** The server's last reported health (kept while it's lost); null before the first answer. */
export const useHealth = (): HealthResponse | null => useConnection().health;
/** Gaps in the printer's log that were never collected (the Jobs screen's missed-jobs strip). */
export const useMissedJobs = (): MissedJobs[] => useHealth()?.missedJobs ?? [];
/** The computer Print Tally runs on, e.g. "studio-mac": the server's own name, else the address in use. */
export const useServerName = (): string => useHealth()?.hostName ?? location.hostname;

/** Seconds until the next retry while the server is lost, ticking each second; null otherwise. */
export function useRetryCountdown(): number | null {
  const { status, retryAt } = useConnection();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (status !== 'lost') return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [status]);
  return status === 'lost' && retryAt !== null ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : null;
}
