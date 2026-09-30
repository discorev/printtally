import { eq, inArray, sql } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  allocationPreviewQuerySchema, cartridgePatchSchema, cartridgeSchema, inkPurchasePatchSchema, inkPurchaseSchema, inkPurchaseSetupSchema, inkSetPurchaseSchema, jobDetailsSchema, paperPatchSchema,
  paperPurchasePatchSchema, paperPurchaseSchema, paperPurchaseSetupSchema, paperSchema, settingsSchema, stockPatchSchema, stockSchema,
  writeOffPatchSchema, writeOffSchema,
  type AllocationPreview, type CartridgeView, type CostTotals, type InkPurchaseSetupResult, type InkResponse, type InkSetPurchaseResult, type JobDetails, type JobsResponse, type LedgerJob,
  type MediaTypesResponse, type PaperPurchaseSetupResult, type PapersResponse, type Settings, type StockFormat, type TotalsResponse,
  type WriteOffPreview, type WriteOffView,
} from 'print-accounting-contracts';
import { computeLedger, splitByWeight, type LedgerInput, type LedgerResult } from 'print-accounting-core';
import type { AccountingDatabase } from './index.ts';
import { ink_products, ink_purchases, paper_media_types, paper_purchases, paper_stocks, papers, settings, stock_write_offs } from './schema.ts';

export class LedgerError extends Error {
  readonly status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, code: string) { super(code); this.status = status; }
}
type Cause = { code?: unknown; cause?: Cause };
// Constraint failures become client errors; anything else is left to the caller.
function constraint(error: unknown, deleting: boolean): never {
  for (let cause = error as Cause | undefined; cause; cause = cause.cause) {
    if (cause.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw new LedgerError(deleting ? 409 : 400, deleting ? 'in_use' : 'unknown_reference');
    if (cause.code === 'SQLITE_CONSTRAINT_UNIQUE' || cause.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new LedgerError(409, 'already_exists');
    if (typeof cause.code === 'string' && cause.code.startsWith('SQLITE_CONSTRAINT')) throw new LedgerError(400, 'invalid_request');
  }
  throw error;
}
const flag = (value: boolean | undefined) => value === undefined ? undefined : Number(value);
const blank = (): CostTotals => ({ jobs: 0, unknown_jobs: 0, unknown_paper_jobs: 0, unknown_ink_jobs: 0, paper_micros: 0, ink_micros: 0, total_micros: 0, waste_micros: 0, ink_nl: 0 });
const addJob = (totals: CostTotals, job: LedgerJob) => {
  totals.jobs++; if (job.total_micros === null) totals.unknown_jobs++; if (job.paper_micros === null) totals.unknown_paper_jobs++;
  if (job.ink.some(line => line.cost_micros === null)) totals.unknown_ink_jobs++;
  totals.paper_micros += job.paper_micros ?? 0; totals.ink_micros += job.ink_micros; totals.total_micros = totals.paper_micros + totals.ink_micros;
  totals.ink_nl += job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
};
// Printer times are local YYYYMMDDHHMMSS text; observations are ISO UTC.
const moment = (job: JobDetails): string => {
  for (const raw of [job.started_at_raw, job.completed_at_raw]) {
    const m = raw && /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(raw);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  }
  return job.first_seen_at.slice(0, 19);
};
const number = (value: number | string | null) => value === null ? null : Number(value);

// Papers, stock, purchases and write-offs, and every cost read from them. Costs are never stored.
export class Ledger {
  private db: AccountingDatabase;
  constructor(db: AccountingDatabase) { this.db = db; }

  settings(): Settings {
    const row = this.db.orm.select().from(settings).get()!;
    return { costing_method: row.costing_method, currency: row.currency };
  }
  updateSettings(input: unknown): Settings {
    this.db.orm.update(settings).set(settingsSchema.parse(input)).run();
    return this.settings();
  }

  private write<T>(action: () => T, deleting = false): T {
    try { return this.db.transaction(action); } catch (error) { if (error instanceof LedgerError) throw error; constraint(error, deleting); }
  }
  private insert(table: SQLiteTable & { id: SQLiteColumn }, values: Record<string, unknown>): number {
    return (this.db.orm.insert(table).values(values).returning({ id: table.id }).get() as { id: number }).id;
  }
  private update(table: SQLiteTable & { id: SQLiteColumn }, id: number, values: Record<string, unknown>): void {
    if (!this.db.orm.select({ id: table.id }).from(table).where(eq(table.id, id)).get()) throw new LedgerError(404, 'not_found');
    if (Object.values(values).some(value => value !== undefined)) this.db.orm.update(table).set(values).where(eq(table.id, id)).run();
  }
  private remove(table: SQLiteTable & { id: SQLiteColumn }, id: number): void {
    this.write(() => { if (!this.db.orm.delete(table).where(eq(table.id, id)).returning({ id: table.id }).get()) throw new LedgerError(404, 'not_found'); }, true);
  }
  private setMedia(paperId: number, mediaTypes: string[] | undefined): void {
    if (mediaTypes === undefined) return;
    this.db.orm.delete(paper_media_types).where(eq(paper_media_types.paper_id, paperId)).run();
    for (const source_media_id of mediaTypes) this.db.orm.insert(paper_media_types).values({ paper_id: paperId, source_media_id }).run();
  }
  // A sheet item is bought in packs, a roll by length.
  private checkPurchase(stockId: number, purchase: { packs?: number | null; sheets_per_pack?: number | null; length_um?: number | null }): void {
    const format = this.db.orm.select({ format: paper_stocks.format }).from(paper_stocks).where(eq(paper_stocks.id, stockId)).get()?.format;
    if (!format) throw new LedgerError(400, 'unknown_reference');
    const sheets = purchase.packs != null && purchase.sheets_per_pack != null && purchase.length_um == null;
    const roll = purchase.packs == null && purchase.sheets_per_pack == null && purchase.length_um != null;
    if (format === 'sheet' ? !sheets : !roll) throw new LedgerError(400, 'purchase_does_not_match_stock');
  }

  createPaper(input: unknown): number {
    const { media_types, ...paper } = paperSchema.parse(input);
    return this.write(() => { const id = this.insert(papers, paper); this.setMedia(id, media_types); return id; });
  }
  updatePaper(id: number, input: unknown): void {
    const { media_types, ...paper } = paperPatchSchema.parse(input);
    this.write(() => { this.update(papers, id, paper); this.setMedia(id, media_types); });
  }
  deletePaper(id: number): void { this.remove(papers, id); }

  createStock(input: unknown): number {
    const item = stockSchema.parse(input);
    return this.write(() => this.insert(paper_stocks, { ...item, deckle: flag('deckle' in item ? item.deckle : undefined) }));
  }
  updateStock(id: number, input: unknown): void {
    const { deckle, ...item } = stockPatchSchema.parse(input);
    this.write(() => this.update(paper_stocks, id, { ...item, deckle: flag(deckle) }));
  }
  deleteStock(id: number): void { this.remove(paper_stocks, id); }

  createPaperPurchase(input: unknown): number {
    const purchase = paperPurchaseSchema.parse(input);
    return this.write(() => { this.checkPurchase(purchase.paper_stock_id, purchase); return this.insert(paper_purchases, purchase); });
  }
  updatePaperPurchase(id: number, input: unknown): void {
    const changes = paperPurchasePatchSchema.parse(input);
    this.write(() => {
      const current = this.db.orm.select().from(paper_purchases).where(eq(paper_purchases.id, id)).get();
      if (!current) throw new LedgerError(404, 'not_found');
      const merged = { ...current, ...changes };
      this.checkPurchase(merged.paper_stock_id, merged);
      this.update(paper_purchases, id, changes);
    });
  }
  deletePaperPurchase(id: number): void { this.remove(paper_purchases, id); }
  /** A purchase with its new stock item (and new paper), in one transaction, so a failure leaves nothing behind. */
  setupPaperPurchase(input: unknown): PaperPurchaseSetupResult {
    const { paper, paper_id, stock, paper_stock_id, purchase } = paperPurchaseSetupSchema.parse(input);
    return this.write(() => {
      let paperId = paper_id;
      if (paper) { const { media_types, ...row } = paper; paperId = this.insert(papers, row); this.setMedia(paperId, media_types); }
      const stockId = stock ? this.insert(paper_stocks, { ...stock, paper_id: paperId, deckle: flag('deckle' in stock ? stock.deckle : undefined) }) : paper_stock_id!;
      this.checkPurchase(stockId, purchase);
      const id = this.insert(paper_purchases, { ...purchase, paper_stock_id: stockId });
      paperId ??= this.db.orm.select({ paper_id: paper_stocks.paper_id }).from(paper_stocks).where(eq(paper_stocks.id, stockId)).get()!.paper_id;
      return { paper_id: paperId, paper_stock_id: stockId, id };
    });
  }

  createCartridge(input: unknown): number { const cartridge = cartridgeSchema.parse(input); return this.write(() => this.insert(ink_products, cartridge)); }
  updateCartridge(id: number, input: unknown): void { const changes = cartridgePatchSchema.parse(input); this.write(() => this.update(ink_products, id, changes)); }
  deleteCartridge(id: number): void { this.remove(ink_products, id); }

  createInkPurchase(input: unknown): number { const purchase = inkPurchaseSchema.parse(input); return this.write(() => this.insert(ink_purchases, purchase)); }
  updateInkPurchase(id: number, input: unknown): void { const changes = inkPurchasePatchSchema.parse(input); this.write(() => this.update(ink_purchases, id, changes)); }
  deleteInkPurchase(id: number): void { this.remove(ink_purchases, id); }
  /** A purchase with its new cartridge product, in one transaction. */
  setupInkPurchase(input: unknown): InkPurchaseSetupResult {
    const { cartridge, ink_product_id, purchase } = inkPurchaseSetupSchema.parse(input);
    return this.write(() => {
      const productId = cartridge ? this.insert(ink_products, cartridge) : ink_product_id!;
      return { ink_product_id: productId, id: this.insert(ink_purchases, { ...purchase, ink_product_id: productId }) };
    });
  }
  /** A whole set: `sets` of each cartridge, with any new products, in one transaction. The price is split by
   *  capacity so every ml costs the same, in exact micros that add up to what was paid. One cartridge per channel. */
  purchaseInkSet(input: unknown): InkSetPurchaseResult {
    const { ink_product_ids, new_cartridges, purchased_on, sets, price_micros } = inkSetPurchaseSchema.parse(input);
    return this.write(() => {
      const created = (new_cartridges?.channels ?? []).map(channel => this.insert(ink_products, { name: `${new_cartridges!.series} ${channel}`, channel, capacity_nl: new_cartridges!.capacity_nl }));
      const ids = [...ink_product_ids, ...created];
      const found = new Map(this.db.orm.select().from(ink_products).where(inArray(ink_products.id, ids)).all().map(row => [row.id, row]));
      if (found.size !== ids.length) throw new LedgerError(400, 'unknown_reference');
      const products = ids.map(id => found.get(id)!);
      if (new Set(products.map(p => p.channel)).size !== products.length) throw new LedgerError(400, 'duplicate_channel');
      const prices = splitByWeight(price_micros, products.map(p => p.capacity_nl));
      return { purchases: products.map((p, index) => ({ ink_product_id: p.id, channel: p.channel, price_micros: prices[index],
        id: this.insert(ink_purchases, { ink_product_id: p.id, purchased_on, cartridges: sets, price_micros: prices[index] }) })) };
    });
  }

  createWriteOff(input: unknown): number {
    const { all_remaining, ...writeOff } = writeOffSchema.parse(input);
    return this.write(() => this.insert(stock_write_offs, { ...writeOff, all_remaining: flag(all_remaining) }));
  }
  updateWriteOff(id: number, input: unknown): void {
    const { all_remaining, ...changes } = writeOffPatchSchema.parse(input);
    // Switching between a quantity and all that's left clears the other.
    const values = { ...changes, all_remaining: flag(all_remaining) };
    if (all_remaining) values.quantity = null;
    else if (changes.quantity != null) values.all_remaining = 0;
    this.write(() => this.update(stock_write_offs, id, values));
  }
  deleteWriteOff(id: number): void { this.remove(stock_write_offs, id); }
  /** What writing off all that's left of a stock item or cartridge on `day` would take, as if saved now. */
  writeOffPreview(target: { paper_stock_id?: number; ink_product_id?: number }, day: string): WriteOffPreview {
    const writeOff = writeOffSchema.parse({ ...target, written_off_on: day, all_remaining: true });
    const [table, id] = writeOff.paper_stock_id != null ? [paper_stocks, writeOff.paper_stock_id] : [ink_products, writeOff.ink_product_id!];
    if (!this.db.orm.select({ id: table.id }).from(table).where(eq(table.id, id)).get()) throw new LedgerError(404, 'not_found');
    const { input } = this.load(), preview = Number.MAX_SAFE_INTEGER; // After every saved write-off that day, as a new one would be.
    const result = computeLedger({ ...input, writeOffs: [...input.writeOffs, { paper_stock_id: null, ink_product_id: null, quantity: null, ...writeOff, id: preview, all_remaining: true }] });
    return result.writeOffs.get(preview)!;
  }

  /** How job `jobId`'s paper would be costed corrected to `query`'s paper or stock item, as if saved now. */
  allocationPreview(jobId: number, query: unknown): AllocationPreview {
    const { paper_id = null, paper_stock_id = null } = allocationPreviewQuerySchema.parse(query);
    const [table, id] = paper_stock_id !== null ? [paper_stocks, paper_stock_id] : [papers, paper_id!];
    if (!this.db.orm.select({ id: table.id }).from(table).where(eq(table.id, id)).get()) throw new LedgerError(404, 'not_found');
    const { input } = this.load();
    if (!input.jobs.some(job => job.id === jobId)) throw new LedgerError(404, 'job_not_found');
    const jobs = input.jobs.map(job => job.id === jobId ? { ...job, paper_id, stock_id: paper_stock_id } : job);
    const { paper, left, sized } = computeLedger({ ...input, jobs }).jobs.get(jobId)!;
    return { paper, remaining: left, short: left !== null && paper.quantity !== null && left < paper.quantity, sized_stock_id: paper.stock_id ?? sized[0] ?? null };
  }

  private load() {
    const orm = this.db.orm;
    const stock = orm.select().from(paper_stocks).orderBy(paper_stocks.paper_id, paper_stocks.id).all()
      .map(item => ({ ...item, format: item.format as StockFormat, deckle: item.deckle === 1 }));
    const purchases = orm.select().from(paper_purchases).orderBy(paper_purchases.purchased_on, paper_purchases.id).all();
    const cartridges = orm.select().from(ink_products).orderBy(ink_products.channel, ink_products.id).all();
    const inkPurchases = orm.select().from(ink_purchases).orderBy(ink_purchases.purchased_on, ink_purchases.id).all();
    const writeOffs = orm.select().from(stock_write_offs).orderBy(stock_write_offs.written_off_on, stock_write_offs.id).all()
      .map(row => ({ ...row, all_remaining: row.all_remaining === 1 }));
    const media = orm.select().from(paper_media_types).all();
    const paperRows = orm.select().from(papers).orderBy(papers.name, papers.id).all()
      .map(paper => ({ ...paper, media_types: media.filter(m => m.paper_id === paper.id).map(m => m.source_media_id) }));
    const details = this.db.all('SELECT * FROM job_details ORDER BY job_id DESC').map(row => jobDetailsSchema.parse(row));
    const ink = new Map<number, { channel: string; volume_nl: number | null }[]>();
    for (const row of this.db.all('SELECT j.id AS job_id, u.channel, u.volume_nl FROM job_ink_usage u JOIN print_jobs j ON j.current_observation_id=u.observation_id ORDER BY u.channel')) {
      const line = { channel: String(row.channel), volume_nl: number(row.volume_nl) }, id = Number(row.job_id);
      ink.set(id, [...ink.get(id) ?? [], line]);
    }
    const settings = this.settings();
    const input: LedgerInput = {
      method: settings.costing_method, papers: paperRows, stock, cartridges, writeOffs,
      paperPurchases: purchases.map(p => p.length_um === null
        ? { ...p, quantity: p.packs! * p.sheets_per_pack!, unit: p.sheets_per_pack! } : { ...p, quantity: p.length_um, unit: p.length_um }),
      inkPurchases,
      jobs: details.map(job => {
        const at = moment(job);
        return { id: job.job_id, date: at.slice(0, 10), at, source_media_id: job.source_media_id, width_um: number(job.width_um), height_um: number(job.height_um),
          impressions: number(job.impressions), stock_id: job.stock_override_id, paper_id: job.paper_override_id,
          ink: ink.get(job.job_id) ?? [] };
      }),
    };
    const result = computeLedger(input);
    const jobs = details.map((row, index): LedgerJob => {
      const { paper, ink } = result.jobs.get(row.job_id)!;
      const known = ink.filter(line => line.cost_micros !== null), inkMicros = known.reduce((sum, line) => sum + line.cost_micros!, 0);
      return { ...row, display_paper_name: row.custom_paper_name ?? paper.paper_name ?? row.display_paper_name, date: input.jobs[index].date, paper, ink,
        paper_micros: paper.cost_micros, ink_micros: inkMicros,
        total_micros: paper.cost_micros === null || known.length < ink.length ? null : paper.cost_micros + inkMicros };
    });
    return { settings, input, result, jobs, paperRows, stock, purchases, cartridges, inkPurchases, writeOffs };
  }

  allJobs(): LedgerJob[] { return this.load().jobs; }
  jobs(options: { q?: string; includeHidden?: boolean; limit?: number; offset?: number } = {}): JobsResponse {
    const { jobs, settings } = this.load(), limit = options.limit ?? 100, offset = options.offset ?? 0;
    const q = options.q?.trim().toLowerCase();
    const matches = jobs.filter(job => (options.includeHidden || !job.hidden) && (!q || [job.job_name, job.display_paper_name, job.configured_paper_name,
      job.paper_name_at_import, job.paper.paper_name, job.paper.stock_name, job.notes].some(text => text?.toLowerCase().includes(q))));
    return { jobs: matches.slice(offset, offset + limit), total: matches.length, limit, offset, settings };
  }
  job(id: number): { job: LedgerJob; settings: Settings } | undefined {
    const { jobs, settings } = this.load(), job = jobs.find(row => row.job_id === id);
    return job && { job, settings };
  }

  // Hidden jobs use stock like any other but are left out of totals. Write-offs are waste, never a print's cost.
  totals(): TotalsResponse {
    const { jobs, settings, result, writeOffs, stock, paperRows } = this.load();
    const overall = blank(), days = new Map<string, CostTotals>(), byPaper = new Map<number | null, CostTotals>();
    const bucket = <K>(map: Map<K, CostTotals>, key: K) => map.get(key) ?? map.set(key, blank()).get(key)!;
    for (const job of jobs) if (!job.hidden) for (const totals of [overall, bucket(days, job.date), bucket(byPaper, job.paper.paper_id)]) addJob(totals, job);
    for (const writeOff of writeOffs) {
      const cost = result.writeOffs.get(writeOff.id)!.cost_micros ?? 0;
      const paperId = stock.find(item => item.id === writeOff.paper_stock_id)?.paper_id;
      for (const totals of [overall, bucket(days, writeOff.written_off_on), ...paperId === undefined ? [] : [bucket(byPaper, paperId)]]) totals.waste_micros += cost;
    }
    const names = new Map(paperRows.map(paper => [paper.id, paper.name]));
    return { settings, overall,
      days: [...days].map(([date, totals]) => ({ date, ...totals })).sort((a, b) => b.date.localeCompare(a.date)),
      papers: [...byPaper].map(([paper_id, totals]) => ({ paper_id, name: paper_id === null ? null : names.get(paper_id)!, ...totals }))
        .sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿')) };
  }

  private writeOffViews(writeOffs: ReturnType<Ledger['load']>['writeOffs'], result: LedgerResult): WriteOffView[] {
    return writeOffs.map(row => { const { remaining, ...cost } = result.writeOffs.get(row.id)!; return { ...row, ...cost }; });
  }
  papers(): PapersResponse {
    const { settings, result, jobs, paperRows, stock, purchases, writeOffs } = this.load();
    const names = this.mediaNames(), views = this.writeOffViews(writeOffs, result);
    return { settings, papers: paperRows.map(paper => {
      const items = stock.filter(item => item.paper_id === paper.id), ids = new Set(items.map(item => item.id));
      const bought = purchases.filter(p => ids.has(p.paper_stock_id)).map(p => ({ ...p, ...result.lots.get('paper:' + p.id)! }));
      const wasted = views.filter(w => w.paper_stock_id !== null && ids.has(w.paper_stock_id));
      const totals = blank();
      for (const job of jobs) if (!job.hidden && job.paper.paper_id === paper.id) addJob(totals, job);
      totals.waste_micros = wasted.reduce((sum, w) => sum + (w.cost_micros ?? 0), 0);
      return { id: paper.id, name: paper.name, notes: paper.notes, totals,
        media_types: paper.media_types.map(source_media_id => ({ source_media_id, name: names.get(source_media_id) ?? null })),
        purchases: bought,
        write_offs: wasted,
        stock: items.map(item => {
          const lines = jobs.filter(job => job.paper.stock_id === item.id).flatMap(job => job.paper.from);
          const out = wasted.filter(w => w.paper_stock_id === item.id && w.cost_micros !== null);
          const own = bought.filter(p => p.paper_stock_id === item.id);
          return { ...item, bought: own.reduce((sum, p) => sum + p.quantity, 0), remaining: own.reduce((sum, p) => sum + p.remaining, 0),
            used: lines.reduce((sum, use) => sum + use.quantity, 0), used_micros: lines.reduce((sum, use) => sum + use.cost_micros, 0),
            wasted: out.reduce((sum, w) => sum + w.written_off, 0), waste_micros: out.reduce((sum, w) => sum + w.cost_micros!, 0) };
        }) };
    }) };
  }
  ink(): InkResponse {
    const { settings, result, jobs, cartridges, inkPurchases, writeOffs } = this.load();
    const views = this.writeOffViews(writeOffs, result), totals = blank();
    // Visible prints' ink as Jobs and Totals count it (unknown_jobs: those with an ink cost unknown), and ink written off.
    for (const job of jobs) if (!job.hidden) {
      totals.jobs++; totals.ink_micros += job.ink_micros; totals.ink_nl += job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
      if (job.ink.some(line => line.cost_micros === null)) totals.unknown_jobs++;
    }
    totals.total_micros = totals.ink_micros;
    totals.waste_micros = views.reduce((sum, w) => sum + (w.ink_product_id !== null ? w.cost_micros ?? 0 : 0), 0);
    const channels = this.db.all('SELECT DISTINCT channel FROM job_ink_usage ORDER BY channel').map(row => String(row.channel));
    // Ink is used oldest first across a channel, so the cartridge in use is the channel's oldest purchase with ink left.
    const channelOf = new Map(cartridges.map(c => [c.id, c.channel])), inUse = new Map<string, number>();
    for (const p of inkPurchases) if (result.lots.get('ink:' + p.id)!.remaining > 0 && !inUse.has(channelOf.get(p.ink_product_id)!)) inUse.set(channelOf.get(p.ink_product_id)!, p.id);
    return { settings, channels, totals, cartridges: cartridges.map((cartridge): CartridgeView => {
      const bought = inkPurchases.filter(p => p.ink_product_id === cartridge.id).map(p => ({ ...p, remaining_nl: result.lots.get('ink:' + p.id)!.remaining }));
      const printed = jobs.filter(job => job.ink.some(line => line.from.some(use => use.ink_product_id === cartridge.id)));
      const lines = printed.flatMap(job => job.ink.flatMap(line => line.from)).filter(use => use.ink_product_id === cartridge.id);
      const wasted = views.filter(w => w.ink_product_id === cartridge.id), out = wasted.filter(w => w.cost_micros !== null);
      const open = bought.find(p => p.id === inUse.get(cartridge.channel));
      const openRemaining = open ? open.remaining_nl % cartridge.capacity_nl || cartridge.capacity_nl : null;
      const remaining = bought.reduce((sum, p) => sum + p.remaining_nl, 0);
      return { ...cartridge, purchases: bought, write_offs: wasted,
        open_purchase_id: open?.id ?? null, open_remaining_nl: openRemaining,
        spares: Math.max(0, Math.round((remaining - (openRemaining ?? 0)) / cartridge.capacity_nl)), jobs: printed.length,
        bought: bought.reduce((sum, p) => sum + p.cartridges * cartridge.capacity_nl, 0), remaining,
        used: lines.reduce((sum, use) => sum + use.quantity, 0), used_micros: lines.reduce((sum, use) => sum + use.cost_micros, 0),
        wasted: out.reduce((sum, w) => sum + w.written_off, 0), waste_micros: out.reduce((sum, w) => sum + w.cost_micros!, 0) };
    }) };
  }

  private mediaNames(): Map<string, string | null> {
    const rows = this.db.all(`SELECT m.source_media_id, COALESCE(r.english_name, r.short_name) AS name FROM media_configs m
      LEFT JOIN media_revisions r ON r.id=m.current_revision_id ORDER BY m.id`);
    const names = new Map<string, string | null>();
    for (const row of rows) if (!names.get(String(row.source_media_id))) names.set(String(row.source_media_id), row.name === null ? null : String(row.name));
    return names;
  }
  // Every media type the printer reports or a paper names, with the papers printed as it and its visible jobs' totals.
  mediaTypes(): MediaTypesResponse {
    const names = this.mediaNames(), { jobs } = this.load();
    const configs = this.db.all('SELECT source_media_id, max(present_on_printer) AS present, max(last_seen_at) AS seen FROM media_configs GROUP BY source_media_id');
    const present = new Set(configs.filter(row => Number(row.present) === 1).map(row => String(row.source_media_id)));
    const seen = new Map(configs.map(row => [String(row.source_media_id), String(row.seen)]));
    const links = this.db.orm.select({ source_media_id: paper_media_types.source_media_id, id: papers.id, name: papers.name }).from(paper_media_types)
      .innerJoin(papers, eq(papers.id, paper_media_types.paper_id)).orderBy(papers.name, sql`${papers.id}`).all();
    const ids = [...new Set([...names.keys(), ...links.map(link => link.source_media_id)])];
    return { media_types: ids.map(id => {
      const own = jobs.filter(job => !job.hidden && job.source_media_id === id), days = own.map(job => job.date).sort(), totals = blank();
      for (const job of own) addJob(totals, job);
      return { source_media_id: id, name: names.get(id) ?? null, present_on_printer: present.has(id), jobs: own.length,
        papers: links.filter(link => link.source_media_id === id).map(({ id: paperId, name }) => ({ id: paperId, name })),
        last_seen_at: seen.get(id) ?? null, first_job_on: days[0] ?? null, last_job_on: days.at(-1) ?? null, totals };
    }).sort((a, b) => (a.name ?? a.source_media_id).localeCompare(b.name ?? b.source_media_id)) };
  }
}
