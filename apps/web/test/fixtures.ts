import type { ArchivedPrinter, CostTotals, HealthResponse, JobsResponse, KnownPrinterListing, LedgerJob, MediaTypeView, PaperPurchaseView, PaperView, PapersResponse, PrinterStatus, Settings, StockView, TotalsResponse, WriteOffPreview } from 'print-accounting-contracts';
import type { Routes } from './api.ts';

export const settings = (overrides: Partial<Settings> = {}): Settings => ({
  costing_method: 'oldest', currency: 'GBP', ...overrides,
});
export const health = (overrides: Partial<HealthResponse> = {}): HealthResponse => ({
  service: 'printtally', apiVersion: 1, version: '0.1.0', hostName: 'test-machine', collecting: false,
  state: 'ready', printers: [], missedJobs: [], lastCollection: null, nextCollectionAt: null, ...overrides,
});
export const totals = (overrides: Partial<CostTotals> = {}): CostTotals => ({
  jobs: 0, unknown_jobs: 0, paper_micros: 0, ink_micros: 0, total_micros: 0, waste_micros: 0,
  unknown_paper_jobs: 0, unknown_ink_jobs: 0, ink_nl: 0, ...overrides,
});
export const stock = (overrides: Partial<StockView> = {}): StockView => ({
  id: 10, paper_id: 1, name: 'A4', format: 'sheet', width_um: 210_000, height_um: 297_000,
  deckle: false, product_code: null, notes: null, bought: 100, used: 25, wasted: 0, remaining: 75,
  used_micros: 0, waste_micros: 0, ...overrides,
});
export const paper = (overrides: Partial<PaperView> = {}): PaperView => ({
  id: 1, name: 'Test paper', notes: null, media_types: [], stock: [stock()], purchases: [], write_offs: [],
  totals: totals(), ...overrides,
});
export const papers = (items: PaperView[] = [paper()], overrides: Partial<PapersResponse> = {}): PapersResponse => ({
  papers: items, settings: settings(), ...overrides,
});
export const writeOffPreview = (overrides: Partial<WriteOffPreview> = {}): WriteOffPreview => ({
  written_off: 75, remaining: 75, cost_micros: 150_000, ...overrides,
});

/** Shared API shapes and reads used by routed component tests. */
export const fingerprint = Array(32).fill('AB').join(':');
export const jobsResponse = (items: LedgerJob[] = [], overrides: Partial<JobsResponse> = {}): JobsResponse => ({
  jobs: items, total: items.length, limit: 1000, offset: 0, settings: settings(), ...overrides,
});
export const totalsResponse = (overall: CostTotals = totals(), days: TotalsResponse['days'] = []): TotalsResponse => ({
  settings: settings(), overall, days, papers: [],
});
export const mediaType = (overrides: Partial<MediaTypeView> = {}): MediaTypeView => ({
  source_media_id: 'media-1', name: 'Hahnemuehle Photo Rag', present_on_printer: true, jobs: 0,
  papers: [], last_seen_at: '2026-09-30T10:00:00Z', first_job_on: null, last_job_on: null, totals: totals(), ...overrides,
});
export const paperPurchase = (overrides: Partial<PaperPurchaseView> = {}): PaperPurchaseView => ({
  id: 31, paper_stock_id: 10, purchased_on: '2026-09-28', packs: 2, sheets_per_pack: 25,
  length_um: null, price_micros: 37_990_000, quantity: 50, remaining: 25, ...overrides,
});
export const printerStatus = (overrides: Partial<PrinterStatus> = {}): PrinterStatus => ({
  id: 'printer-1', name: 'Studio printer', host: '192.168.1.42', state: 'ready', lastCollection: null, ...overrides,
});
export const knownPrinter = (overrides: Partial<KnownPrinterListing> = {}): KnownPrinterListing => ({
  id: 'printer-1', host: '192.168.1.42', name: 'Studio printer', mac: '00:1E:8F:12:34:56',
  fingerprintSha256: fingerprint, validFrom: '2025-01-01T00:00:00Z', validTo: '2035-01-01T00:00:00Z',
  confirmedAt: '2026-10-03T12:00:00Z', lastVerifiedAt: '2026-10-03T12:00:00Z', hasPassword: false, ...overrides,
});
export const archivedPrinter = (overrides: Partial<ArchivedPrinter> = {}): ArchivedPrinter => ({
  id: 1, name: 'Studio printer', host: '192.168.1.42', known_printer_id: 'printer-1', jobs: 1, model: null, firmware: null, inks: [], ...overrides,
});
export const jobsScreenReads = (items: LedgerJob[] = [], additional: Routes = {}): Routes => ({
  'GET /jobs?includeHidden=false&limit=1000': jobsResponse(items),
  'GET /printers': { printers: [archivedPrinter()] },
  'GET /totals': totalsResponse(),
  'GET /papers': papers(),
  'GET /media-types': { media_types: [] },
  'GET /settings': settings(),
  ...additional,
});
export const ledgerSpanReads = (): Routes => ({
  'GET /jobs?includeHidden=true&limit=1': jobsResponse([], { limit: 1 }),
  'GET /jobs?limit=1': jobsResponse([], { limit: 1 }),
});
