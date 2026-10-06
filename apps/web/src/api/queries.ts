import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type JobsQuery } from './endpoints.ts';
import type { AllocationPreviewQuery } from 'print-accounting-contracts';
import { ApiError } from './client.ts';

// One client for the app. Data refetches when the window regains focus; failed reads aren't retried here,
// because the connection monitor retries the server and refetches everything once it's back. What's
// already loaded stays on screen while it's lost (a failed refetch keeps its data), and is kept for an hour
// after a screen closes, so going back to it during an outage still shows it.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, staleTime: 5_000, gcTime: 60 * 60_000, networkMode: 'always', retry: (count, error) => !(error instanceof ApiError) && count < 1 },
    mutations: { networkMode: 'always', retry: false },
  },
});

export const keys = {
  jobs: (params: JobsQuery) => ['jobs', params] as const,
  job: (id: number) => ['job', id] as const,
  allocationPreview: (id: number, target: object) => ['allocation-preview', id, target] as const,
  totals: ['totals'] as const, papers: ['papers'] as const, mediaTypes: ['media-types'] as const,
  ink: (printer?: number) => ['ink', printer] as const, writeOffPreview: (target: object, day: string) => ['write-off-preview', target, day] as const, settings: ['settings'] as const, knownPrinters: ['known-printers'] as const, printers: ['printers'] as const, imports: ['imports'] as const,
};

/** The jobs list; keeps the previous page on screen while a new search loads. */
export const useJobs = (params: JobsQuery = {}) => useQuery({ queryKey: keys.jobs(params), queryFn: () => api.jobs(params), placeholderData: keepPreviousData });
export const useJob = (id: number) => useQuery({ queryKey: keys.job(id), queryFn: () => api.job(id) });
export const useTotals = () => useQuery({ queryKey: keys.totals, queryFn: api.totals });
export const usePapers = () => useQuery({ queryKey: keys.papers, queryFn: api.papers });
export const useMediaTypes = () => useQuery({ queryKey: keys.mediaTypes, queryFn: api.mediaTypes });
export const useInk = (printer?: number, enabled = true) => useQuery({ queryKey: keys.ink(printer), queryFn: () => api.ink(printer), enabled });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useKnownPrinters = () => useQuery({ queryKey: keys.knownPrinters, queryFn: api.knownPrinters });
export const usePrinters = () => useQuery({ queryKey: keys.printers, queryFn: api.printers });
export const useImports = () => useQuery({ queryKey: keys.imports, queryFn: () => api.imports() });
/** What writing off all that's left would take on `day` (a ledger day), from the ledger; idle until both are known. */
export const useWriteOffPreview = (target: { paper_stock_id: number } | { ink_product_id: number; printer_id?: number } | undefined, day: string) => useQuery({
  queryKey: keys.writeOffPreview(target ?? {}, day), queryFn: () => api.writeOffPreview(target!, day),
  enabled: !!target && /^\d{4}-\d\d-\d\d$/.test(day),
});
/** How job `id`'s paper would be costed with a correction, from the ledger; idle until there's one to try. */
export const useAllocationPreview = (id: number, target: AllocationPreviewQuery | undefined) => useQuery({
  queryKey: keys.allocationPreview(id, target ?? {}), queryFn: () => api.allocationPreview(id, target!), enabled: !!target,
});
/** The ledger's currency code (settings), GBP until settings load. */
export const useCurrency = (): string => useSettings().data?.currency ?? 'GBP';

/**
 * An edit. It's refused before sending while the server is lost (ApiError 'paused'), fails with a clear
 * error if the server goes away mid-request, and is never queued. On success every read model is refetched,
 * because one edit can change costs on every screen. Show "saved" only from onSuccess / isSuccess.
 */
export function useEdit<Variables, Result>(mutationFn: (variables: Variables) => Promise<Result>) {
  const client = useQueryClient();
  return useMutation({ mutationFn, onSuccess: () => client.invalidateQueries() });
}
