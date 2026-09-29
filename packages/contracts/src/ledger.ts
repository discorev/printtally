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
export const stockSchema = z.discriminatedUnion('format', [
  z.object({ ...stockFields, paper_id: id, format: z.literal('sheet'), height_um: count, deckle: z.boolean().optional() }).partial({ product_code: true, notes: true }).strict(),
  z.object({ ...stockFields, paper_id: id, format: z.literal('roll') }).partial({ product_code: true, notes: true }).strict(),
]);
export const stockPatchSchema = someFields({ ...stockFields, height_um: count, deckle: z.boolean() });

// Sheets are bought as packs x sheets per pack; a roll by its length.
const purchaseFields = { paper_stock_id: id, purchased_on: day, packs: count.nullable(), sheets_per_pack: count.nullable(), length_um: count.nullable(), price_micros: micros };
export const paperPurchaseSchema = z.object(purchaseFields).partial({ packs: true, sheets_per_pack: true, length_um: true }).strict();
export const paperPurchasePatchSchema = someFields(purchaseFields);

const cartridgeFields = { name, channel: z.string().regex(/^[A-Za-z0-9_]{1,16}$/), capacity_nl: count, product_code: z.string().trim().min(1).max(100).nullable() };
export const cartridgeSchema = z.object(cartridgeFields).partial({ product_code: true }).strict();
export const cartridgePatchSchema = someFields(cartridgeFields);

const inkPurchaseFields = { ink_product_id: id, purchased_on: day, cartridges: count, price_micros: micros };
export const inkPurchaseSchema = z.object(inkPurchaseFields).strict();
export const inkPurchasePatchSchema = someFields(inkPurchaseFields);

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
export interface CostTotals { jobs: number; unknown_jobs: number; paper_micros: number; ink_micros: number; total_micros: number; waste_micros: number }
export interface JobsResponse { jobs: LedgerJob[]; total: number; limit: number; offset: number; settings: Settings }
export interface JobResponse { job: LedgerJob; settings: Settings }
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
  purchases: InkPurchaseView[]; write_offs: WriteOffView[];
}
export interface InkResponse { cartridges: CartridgeView[]; channels: string[]; settings: Settings }
export interface MediaTypeView { source_media_id: string; name: string | null; present_on_printer: boolean; jobs: number; papers: { id: number; name: string }[] }
export interface MediaTypesResponse { media_types: MediaTypeView[] }
