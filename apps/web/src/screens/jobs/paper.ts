import type { AllocationPreview, LedgerJob, PaperView, StockView } from 'print-accounting-contracts';
import { dateShort, metres, stockQuantity } from '../../lib/format.ts';
import { jobSize } from '../../lib/jobs.ts';

// How a job's paper reads beside the printer's report. Presentation only: the allocation comes from the API.

/** The papers set up as printing as the job's media type. */
export const papersForMedia = (job: LedgerJob, papers: PaperView[]): PaperView[] =>
  job.source_media_id ? papers.filter(paper => paper.media_types.some(m => m.source_media_id === job.source_media_id)) : [];

/** 'corrected': you chose the paper (or stock of a paper that doesn't print as this media). 'assumed': several
 *  papers print as this media and the ledger picked one. */
export function paperState(job: LedgerJob, papers: PaperView[]): 'corrected' | 'assumed' | null {
  const own = papersForMedia(job, papers);
  if (job.paper.allocation === 'paper' || (job.paper.allocation === 'stock' && !own.some(paper => paper.id === job.paper.paper_id))) return 'corrected';
  return job.paper.allocation === 'default' && own.length > 1 ? 'assumed' : null;
}

const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= 1000;
/** Stock items of the job's paper that could have printed it: sheets of its size (either way round) or a roll
 *  of its width, bought by the job's day. The choices for "Change stock". */
export function stockChoices(job: LedgerJob, paper: PaperView | undefined): StockView[] {
  const w = job.width_um === null ? null : Number(job.width_um), h = job.height_um === null ? null : Number(job.height_um);
  return (paper?.stock ?? []).filter(item => (item.format === 'roll' ? near(item.width_um, w) || near(item.width_um, h)
    : (near(item.width_um, w) && near(item.height_um, h)) || (near(item.width_um, h) && near(item.height_um, w)))
    && paper!.purchases.some(p => p.paper_stock_id === item.id && p.purchased_on <= job.date));
}

export interface StockWarning { title: string; text: string }
/** Why the stock won't cover the print: none at its size, none bought by its day, or too little left then. */
export function stockWarning(job: LedgerJob, { paper, remaining, short }: AllocationPreview): StockWarning | null {
  const size = jobSize(job), day = dateShort(job.date), name = paper.paper_name ?? 'This paper', unknown = 'so the print’s paper cost would be unknown.';
  if (paper.unknown_reason === 'no_matching_stock') return { title: `No ${size} stock`, text: `${name} has no ${size} sheets or matching roll, ${unknown}` };
  if (paper.unknown_reason === 'no_stock_by_date') return { title: `No ${size} bought by then`, text: `${name} has no ${size} bought by ${day}, ${unknown}` };
  if (!short || remaining === null || paper.quantity === null) return null;
  const roll = paper.format === 'roll', stock = paper.stock_name ?? size, used = stockQuantity(paper.quantity, roll ? 'roll' : 'sheet');
  const left = remaining <= 0 ? (roll ? `Nothing left on the ${stock} of ${name}` : `No ${stock} sheets of ${name} left`)
    : roll ? `Only ${metres(remaining)} left on the ${stock} of ${name}` : `Only ${remaining} ${stock} ${remaining === 1 ? 'sheet' : 'sheets'} of ${name} left`;
  return { title: 'Not enough stock', text: `${left} by ${day}, so this print (${used}) takes it below zero.` };
}
