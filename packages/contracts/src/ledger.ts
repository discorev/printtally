import { z } from 'zod';
import type { JobDetails } from './index.ts';

// Papers, stock, purchases and write-offs. Money is integer micros of the ledger's single currency;
// quantities are sheets, micrometres of roll or nanolitres of ink. Costs are calculated when read.
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = id;
const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const name = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(10000).nullable();
const day = z.iso.date();
const someFields = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().strict().refine(value => Object.keys(value).length > 0, 'No fields supplied');

export const costingMethods = ['oldest', 'average', 'max'] as const;
export type CostingMethod = typeof costingMethods[number];
export const settingsSchema = someFields({ costing_method: z.enum(costingMethods), currency: z.string().regex(/^[A-Z]{3}$/) });
export interface Settings { costing_method: CostingMethod; currency: string }

const paperFields = { name, notes: note, media_types: z.array(z.string().trim().min(1).max(500)).max(100).refine(list => new Set(list).size === list.length, 'Duplicate media type') };
export const paperSchema = z.object(paperFields).partial({ notes: true, media_types: true }).strict();
export const paperPatchSchema = someFields(paperFields);

const stockFields = { name: z.string().trim().min(1).max(100), width_um: count, product_code: z.string().trim().min(1).max(100).nullable(), notes: note };
const sheetStock = z.object({ ...stockFields, paper_id: id, format: z.literal('sheet'), height_um: count, deckle: z.boolean().optional() }).partial({ product_code: true, notes: true }).strict();
const rollStock = z.object({ ...stockFields, paper_id: id, format: z.literal('roll') }).partial({ product_code: true, notes: true }).strict();
export const stockSchema = z.discriminatedUnion('format', [sheetStock, rollStock]);
export const stockPatchSchema = someFields({ ...stockFields, height_um: count, deckle: z.boolean() });

// Sheets are bought as packs x sheets per pack; a roll by its length.
const purchaseFields = { paper_stock_id: id, purchased_on: day, packs: count.nullable(), sheets_per_pack: count.nullable(), length_um: count.nullable(), price_micros: micros };
export const paperPurchaseSchema = z.object(purchaseFields).partial({ packs: true, sheets_per_pack: true, length_um: true }).strict();
export const paperPurchasePatchSchema = someFields(purchaseFields);
// A purchase with the stock item and paper it's for, created together or not at all: an existing stock item,
// or a new one of an existing paper, or a new one of a new paper.
export const paperPurchaseSetupSchema = z.object({
  paper: paperSchema.optional(), paper_id: id.optional(),
  stock: z.discriminatedUnion('format', [sheetStock.omit({ paper_id: true }), rollStock.omit({ paper_id: true })]).optional(), paper_stock_id: id.optional(),
  purchase: paperPurchaseSchema.omit({ paper_stock_id: true }),
}).strict().refine(v => v.stock ? v.paper_stock_id === undefined && (v.paper === undefined) !== (v.paper_id === undefined)
  : v.paper === undefined && v.paper_id === undefined && v.paper_stock_id !== undefined, 'Give a stock item, or a new one and its paper');

const channel = z.string().regex(/^[A-Za-z0-9_]{1,16}$/);
const cartridgeFields = { name, channel, capacity_nl: count, product_code: z.string().trim().min(1).max(100).nullable() };
export const cartridgeSchema = z.object(cartridgeFields).partial({ product_code: true }).strict();
export const cartridgePatchSchema = someFields(cartridgeFields);

const inkPurchaseFields = { ink_product_id: id, purchased_on: day, cartridges: count, price_micros: micros };
export const inkPurchaseSchema = z.object(inkPurchaseFields).strict();
export const inkPurchasePatchSchema = someFields(inkPurchaseFields);
// A purchase with its cartridge product, created together or not at all.
export const inkPurchaseSetupSchema = z.object({
  cartridge: cartridgeSchema.optional(), ink_product_id: id.optional(), purchase: inkPurchaseSchema.omit({ ink_product_id: true }),
}).strict().refine(v => (v.cartridge === undefined) !== (v.ink_product_id === undefined), 'Give a cartridge or a new one');
// A whole set bought together: one purchase of `sets` cartridges for each product, created together or not at all.
// The server splits the price across them by capacity, so every ml costs the same. Channels with no product yet
// get one, named "<series> <channel>" (e.g. "PFI-4100 PM").
const unique = (list: unknown[]) => new Set(list).size === list.length;
export const inkSetPurchaseSchema = z.object({
  ink_product_ids: z.array(id).max(32).refine(unique, 'Duplicate cartridge'),
  new_cartridges: z.object({ series: z.string().trim().min(1).max(100), capacity_nl: count, channels: z.array(channel).min(1).max(32).refine(unique, 'Duplicate channel'),
    names: z.record(channel, name).optional() }).strict().optional(),
  purchased_on: day, sets: count, price_micros: micros,
}).strict().refine(v => v.ink_product_ids.length + (v.new_cartridges?.channels.length ?? 0) > 0, 'Give the cartridges in the set');

// A write-off names a stock item or a cartridge, and a quantity or all that's left of the open pack, roll or cartridge.
const writeOffFields = { paper_stock_id: id.nullable(), ink_product_id: id.nullable(), written_off_on: day, quantity: count.nullable(), all_remaining: z.boolean(), reason: z.string().trim().min(1).max(1000).nullable() };
export const writeOffSchema = z.object(writeOffFields).partial({ paper_stock_id: true, ink_product_id: true, quantity: true, all_remaining: true, reason: true }).strict()
  .refine(value => (value.paper_stock_id == null) !== (value.ink_product_id == null), 'Write off a stock item or a cartridge')
  .refine(value => (value.quantity == null) === !!value.all_remaining, 'Give a quantity or all_remaining');
export const writeOffPatchSchema = someFields({ written_off_on: day, quantity: count.nullable(), all_remaining: z.boolean(), reason: writeOffFields.reason });

export type PaperInput = z.infer<typeof paperSchema>;
export type StockInput = z.infer<typeof stockSchema>;
export type PaperPurchaseInput = z.infer<typeof paperPurchaseSchema>;
export type CartridgeInput = z.infer<typeof cartridgeSchema>;
export type InkPurchaseInput = z.infer<typeof inkPurchaseSchema>;
export type WriteOffInput = z.infer<typeof writeOffSchema>;
export type PaperPurchaseSetup = z.infer<typeof paperPurchaseSetupSchema>;
export type InkPurchaseSetup = z.infer<typeof inkPurchaseSetupSchema>;
export type InkSetPurchase = z.infer<typeof inkSetPurchaseSchema>;
export interface PaperPurchaseSetupResult { paper_id: number; paper_stock_id: number; id: number }
export interface InkPurchaseSetupResult { ink_product_id: number; id: number }
/** The set's purchases (id), one per cartridge product, each with its share of the price. */
export interface InkSetPurchaseResult { purchases: { id: number; ink_product_id: number; channel: string; price_micros: number }[] }
/** What writing off all that's left would take on a day, as the ledger counts it: the rest of the open pack, roll
 *  or cartridge (written_off), its cost, and all that's left of the stock item or cartridge then (remaining). */
export interface WriteOffPreview { written_off: number; cost_micros: number | null; remaining: number }
// A job's paper correction to try out, from a query string: a paper or one of its stock items.
const queryId = z.string().regex(/^\d{1,15}$/).transform(Number).pipe(id);
export const allocationPreviewQuerySchema = z.object({ paper_id: queryId, paper_stock_id: queryId }).partial().strict()
  .refine(value => (value.paper_id === undefined) !== (value.paper_stock_id === undefined), 'Give a paper or a stock item');
export type AllocationPreviewQuery = z.infer<typeof allocationPreviewQuerySchema>;

// Read models. A null cost is unknown and is never guessed.
export type UnknownReason = 'no_paper' | 'no_matching_stock' | 'no_stock_by_date' | 'unknown_usage';
export type StockFormat = 'sheet' | 'roll';
export interface LotUse { purchase_id: number; purchased_on: string; quantity: number; cost_micros: number }
export interface PaperLine {
  paper_id: number | null; paper_name: string | null;
  stock_id: number | null; stock_name: string | null; format: StockFormat | null; deckle: boolean;
  allocation: 'default' | 'stock' | 'paper';
  quantity: number | null; // Sheets, or micrometres of roll.
  cost_micros: number | null; unknown_reason: UnknownReason | null; from: LotUse[];
}
export interface InkLine { channel: string; volume_nl: number | null; cost_micros: number | null; from: (LotUse & { ink_product_id: number })[] }
export interface LedgerJob extends JobDetails {
  date: string; paper: PaperLine; ink: InkLine[];
  paper_micros: number | null; ink_micros: number; total_micros: number | null; // total is null while any part is unknown.
}
export interface CostTotals {
  jobs: number; unknown_jobs: number; paper_micros: number; ink_micros: number; total_micros: number; waste_micros: number;
  unknown_paper_jobs: number; // Jobs whose paper cost is unknown (unknown_jobs also counts unknown ink).
  unknown_ink_jobs: number; // Jobs with any ink channel's cost unknown (unknown_jobs also counts unknown paper).
  ink_nl: number; // Ink the jobs used, whether or not its cost is known.
}
export interface JobsResponse { jobs: LedgerJob[]; total: number; limit: number; offset: number; settings: Settings }
export interface JobResponse { job: LedgerJob; settings: Settings }
/** How a job's paper would be costed with a correction, as if saved now (nothing is saved). */
export interface AllocationPreview {
  paper: PaperLine; // The stock item it would use (or none), and its cost or why that's unknown.
  remaining: number | null; // What that item had left by the print's time, before it; null without an item.
  short: boolean; // Less was left than the print used, so it takes the item below zero.
  sized_stock_id: number | null; // The item to buy more of: the one it would use, else the paper's first at the print's size; null if none.
}
export interface TotalsResponse {
  settings: Settings; overall: CostTotals;
  days: (CostTotals & { date: string })[]; papers: (CostTotals & { paper_id: number | null; name: string | null })[];
}
export interface Usage { bought: number; used: number; wasted: number; remaining: number; used_micros: number; waste_micros: number }
export interface WriteOffView {
  id: number; paper_stock_id: number | null; ink_product_id: number | null; written_off_on: string;
  quantity: number | null; all_remaining: boolean; reason: string | null;
  written_off: number; cost_micros: number | null;
}
export interface PaperPurchaseView {
  id: number; paper_stock_id: number; purchased_on: string; packs: number | null; sheets_per_pack: number | null;
  length_um: number | null; price_micros: number; quantity: number; remaining: number;
}
export interface StockView extends Usage {
  id: number; paper_id: number; name: string; format: StockFormat; width_um: number; height_um: number | null;
  deckle: boolean; product_code: string | null; notes: string | null;
}
export interface PaperView {
  id: number; name: string; notes: string | null; media_types: { source_media_id: string; name: string | null }[];
  stock: StockView[]; purchases: PaperPurchaseView[]; write_offs: WriteOffView[]; totals: CostTotals;
}
export interface PapersResponse { papers: PaperView[]; settings: Settings }
export interface InkPurchaseView { id: number; ink_product_id: number; purchased_on: string; cartridges: number; price_micros: number; remaining_nl: number }
export interface CartridgeView extends Usage {
  id: number; name: string; channel: string; capacity_nl: number; product_code: string | null;
  open_remaining_nl: number | null; // What the ledger thinks is left in the cartridge in use.
  open_purchase_id: number | null; // The purchase that cartridge came from.
  spares: number; // Whole cartridges left on the shelf, besides the one in use.
  jobs: number; // Prints that drew ink from this cartridge (hidden ones too: they use ink like any other).
  purchases: InkPurchaseView[]; write_offs: WriteOffView[];
}
/** totals: visible prints' ink as Jobs and Totals count it (unknown_jobs: prints with an ink cost unknown) and ink written off; paper figures are 0. */
export interface InkResponse { cartridges: CartridgeView[]; channels: string[]; settings: Settings; totals: CostTotals }
export interface MediaTypeView {
  source_media_id: string; name: string | null; present_on_printer: boolean; jobs: number; papers: { id: number; name: string }[];
  last_seen_at: string | null; // When a collection last read it from the printer (ISO UTC); null if only a paper names it.
  first_job_on: string | null; last_job_on: string | null; totals: CostTotals; // Its visible jobs, as costed.
}
export interface MediaTypesResponse { media_types: MediaTypeView[] }
