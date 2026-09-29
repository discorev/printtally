import type { LedgerJob, PaperView, StockView } from 'print-accounting-contracts';

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
