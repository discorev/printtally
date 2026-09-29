import {
  annotationSchema, cartridgePatchSchema, cartridgeSchema, confirmPrinterSchema, enrolmentRequestSchema, inkPurchasePatchSchema,
  inkPurchaseSchema, paperPatchSchema, paperPurchasePatchSchema, paperPurchaseSchema, paperSchema, printerPasswordSchema,
  settingsSchema, stockPatchSchema, stockSchema, writeOffPatchSchema, writeOffSchema,
  type Annotation, type CartridgeInput, type DiscoveredPrinter, type EnrolmentRequest, type HealthResponse, type ImportResult, type ImportsResponse,
  type InkPurchaseInput, type InkResponse, type JobResponse, type JobsResponse, type KnownPrinter, type LedgerJob,
  type MediaTypesResponse, type PaperInput, type PaperPurchaseInput, type PapersResponse, type PrinterTrustPreview, type Settings,
  type StockInput, type TotalsResponse, type WriteOffInput,
} from 'print-accounting-contracts';
import type { ZodType } from 'zod';
import { request } from './client.ts';

// Every endpoint the UI uses, typed by packages/contracts. Edits validate their body with the contract's
// schema before sending. Creates return the new id; read models are refetched rather than patched locally.
type Created = { id: number };
type Patch<T> = Partial<T>;
export interface JobsQuery { q?: string; includeHidden?: boolean; limit?: number; offset?: number }
const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? '?' + text : '';
};
const collection = <Input>(path: string, create: ZodType, patch: ZodType) => ({
  create: (input: Input) => request<Created>('POST', `/${path}`, { body: input, schema: create }),
  update: (id: number, input: Patch<Input>) => request<{ updated: true }>('PATCH', `/${path}/${id}`, { body: input, schema: patch }),
  remove: (id: number) => request<{ deleted: true }>('DELETE', `/${path}/${id}`),
});

export const api = {
  health: (): Promise<HealthResponse> => request('GET', '/health', { timeoutMs: 5_000, quiet: true }),

  jobs: (params: JobsQuery = {}): Promise<JobsResponse> => request('GET', '/jobs' + query({ ...params, q: params.q?.trim() || undefined })),
  job: (id: number): Promise<JobResponse> => request('GET', `/jobs/${id}`),
  /** Notes, hide/show, and correcting a job's paper or stock; returns the job as now costed. */
  annotateJob: (id: number, annotation: Annotation): Promise<LedgerJob> => request('PATCH', `/jobs/${id}/annotation`, { body: annotation, schema: annotationSchema }),
  totals: (): Promise<TotalsResponse> => request('GET', '/totals'),

  papers: (): Promise<PapersResponse> => request('GET', '/papers'),
  paper: collection<PaperInput>('papers', paperSchema, paperPatchSchema),
  stock: collection<StockInput>('paper-stocks', stockSchema, stockPatchSchema),
  paperPurchase: collection<PaperPurchaseInput>('paper-purchases', paperPurchaseSchema, paperPurchasePatchSchema),
  mediaTypes: (): Promise<MediaTypesResponse> => request('GET', '/media-types'),

  ink: (): Promise<InkResponse> => request('GET', '/ink'),
  cartridge: collection<CartridgeInput>('ink-cartridges', cartridgeSchema, cartridgePatchSchema),
  inkPurchase: collection<InkPurchaseInput>('ink-purchases', inkPurchaseSchema, inkPurchasePatchSchema),
  writeOff: collection<WriteOffInput>('write-offs', writeOffSchema, writeOffPatchSchema),

  settings: (): Promise<Settings> => request('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> => request('PATCH', '/settings', { body: patch, schema: settingsSchema }),

  // Printer setup: find it, preview its root certificate, confirm the fingerprint, store the password.
  discoverPrinters: (): Promise<{ printers: DiscoveredPrinter[] }> => request('POST', '/printer-discovery', { body: {}, timeoutMs: 30_000 }),
  previewPrinter: (input: EnrolmentRequest): Promise<PrinterTrustPreview> => request('POST', '/printer-enrolments', { body: input, schema: enrolmentRequestSchema, timeoutMs: 30_000 }),
  confirmPrinter: (previewId: string, fingerprintSha256: string): Promise<KnownPrinter> =>
    request('POST', `/printer-enrolments/${previewId}/confirm`, { body: { fingerprintSha256, confirmed: true }, schema: confirmPrinterSchema, timeoutMs: 30_000 }),
  cancelPreview: (previewId: string): Promise<{ cancelled: true }> => request('DELETE', `/printer-enrolments/${previewId}`),
  knownPrinters: (): Promise<{ printers: KnownPrinter[] }> => request('GET', '/known-printers'),
  savePrinterPassword: (printerId: string, password: string): Promise<{ saved: true }> =>
    request('PUT', `/known-printers/${printerId}/password`, { body: { password }, schema: printerPasswordSchema }),
  /** The import history, newest first (the printer's log range each collection read). */
  imports: (limit = 20): Promise<ImportsResponse> => request('GET', '/imports' + query({ limit })),
  /** One request that returns when the collection has finished. */
  collect: (printerId: string): Promise<ImportResult> => request('POST', `/known-printers/${printerId}/collect`, { body: {}, timeoutMs: 180_000 }),
};
