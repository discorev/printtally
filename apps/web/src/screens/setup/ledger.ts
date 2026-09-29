import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/endpoints.ts';
import { keys, useJobs } from '../../api/queries.ts';

/** How much the ledger keeps: every job (hidden too), how many are hidden, and the first and last job's days.
 *  Counted by the API (the jobs list's totals); nothing is added up here. */
export function useLedgerSpan() {
  const all = useJobs({ includeHidden: true, limit: 1 }).data, shown = useJobs({ limit: 1 }).data;
  const total = all?.total ?? 0, params = { includeHidden: true, limit: 1, offset: Math.max(0, total - 1) };
  const oldest = useQuery({ queryKey: keys.jobs(params), queryFn: () => api.jobs(params), enabled: total > 0 }).data;
  if (!all || !shown) return undefined;
  return { total, hidden: total - shown.total, last: all.jobs[0]?.date ?? null, first: total ? oldest?.jobs[0]?.date ?? null : null };
}
