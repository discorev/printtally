import type { LedgerJob, UnknownReason } from 'print-accounting-contracts';
import { isSquare, sizeName } from './sizes.ts';

// How a costed job reads on screen. Presentation only: allocation and cost come from the API.

/** The printer's size name for the job, e.g. "A4". */
export const jobSize = (job: LedgerJob): string => sizeName(job.width_um, job.height_um);
/** The paper the ledger allocated the job to, else the name the printer reported (or the user typed). */
export const jobPaperName = (job: LedgerJob): string => job.paper.paper_name ?? job.display_paper_name ?? 'Unknown paper';
export const jobOnRoll = (job: LedgerJob): boolean => job.paper.format === 'roll';
export const jobCancelled = (job: LedgerJob): boolean => job.completion_state === 'cancelled';
/** No paper is set up for the job's media (hatched swatch). */
export const jobHasNoPaper = (job: LedgerJob): boolean => job.paper.paper_id === null;
/** Swatch props for the job's paper. */
export const jobSwatch = (job: LedgerJob) => ({
  shape: jobOnRoll(job) ? 'roll' as const : isSquare(job.width_um, job.height_um) ? 'square' as const : 'sheet' as const,
  deckle: job.paper.deckle, none: jobHasNoPaper(job),
});
/** "A4", "A3+ deckle", "17×36 in · roll": the docket title's size. */
export const jobSizeLabel = (job: LedgerJob): string => jobSize(job) + (job.paper.deckle ? ' deckle' : '') + (jobOnRoll(job) ? ' · roll' : '');

const SHORT: Record<UnknownReason, string> = {
  no_paper: 'no paper set up', no_matching_stock: 'no stock for this size', no_stock_by_date: 'none bought by then', unknown_usage: 'usage unknown',
};
/** Why a job's paper cost is unknown, in a few words for a list row; null when it's known. */
export const unknownShort = (job: LedgerJob): string | null => job.paper.unknown_reason && SHORT[job.paper.unknown_reason];
/** The known part of a job's cost while its total is unknown: paper plus known ink, never guessed further. */
export const jobKnownMicros = (job: LedgerJob): number => (job.paper_micros ?? 0) + job.ink_micros;
/** Why a job's total is unknown, for the list row's amber tag: the paper's reason takes priority over ink's. */
export const unknownCostReason = (job: LedgerJob): string | null =>
  unknownShort(job) ?? (job.ink.some(line => line.cost_micros === null) ? 'no ink cost' : null);
/** The same, as the cost table's paper line says it: "Heavyweight Fine Art Paper — no paper set up". */
export function unknownLine(job: LedgerJob): string | null {
  const reason = job.paper.unknown_reason, name = jobPaperName(job);
  if (!reason) return null;
  return {
    no_paper: `${name} — no paper set up`, no_matching_stock: `${name} — nothing in stock at this size`,
    no_stock_by_date: `${name} — none bought by then`, unknown_usage: `${name} — usage not reported`,
  }[reason];
}
