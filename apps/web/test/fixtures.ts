import type { CostTotals, HealthResponse, PaperView, PapersResponse, Settings, StockView, WriteOffPreview } from 'print-accounting-contracts';

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
