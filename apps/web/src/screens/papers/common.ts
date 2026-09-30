import type { MediaTypeView, Settings, StockView } from 'print-accounting-contracts';
import { sizeName } from '../../lib/sizes.ts';

/** "oldest", "average" or "max": the costing method as it reads in a sentence ("at the oldest price"). */
export const methodName = (settings: Settings): string => settings.costing_method;
/** A printer media type's name, or its id when the printer gave none. */
export const mediaName = (media: Pick<MediaTypeView, 'name' | 'source_media_id'>): string => media.name ?? media.source_media_id;

/** A purchase form prefilled from a link (a job's "Add a purchase"): the size label (e.g. "A4") and the print's date. */
export interface PurchasePrefill { size?: string; date?: string }
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
export const prefillSearch = (search: Record<string, unknown>): PurchasePrefill => ({
  size: text(search.size), date: typeof search.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(search.date) ? search.date : undefined,
});
/** The paper's sheet stock at a size label, non-deckle first; 'new' (set up that size) if it has none. */
export const stockAtSize = (stock: StockView[], size: string): number | 'new' =>
  [...stock].filter(s => s.format === 'sheet' && sizeName(s.width_um, s.height_um) === size).sort((a, b) => Number(a.deckle) - Number(b.deckle))[0]?.id ?? 'new';
