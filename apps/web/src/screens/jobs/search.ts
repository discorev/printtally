import type { LedgerJob } from 'print-accounting-contracts';

// The Jobs list's search, paper filter and "Show hidden" live in the URL (/jobs?paper=3, /jobs?media=<id>),
// so Papers can link to a paper's prints and a docket keeps the list as it was.
export interface JobsSearch { q?: string; paper?: number; media?: string; hidden?: boolean }

export function validateJobsSearch(search: Record<string, unknown>): JobsSearch {
  const paper = Number(search.paper), text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return {
    q: text(search.q) || undefined,
    paper: Number.isSafeInteger(paper) && paper > 0 ? paper : undefined,
    media: text(search.media) || undefined,
    hidden: search.hidden === true || search.hidden === 'true' || search.hidden === 1 || undefined,
  };
}

/** The paper filter: a paper's prints, or the prints the printer reported as a media type. */
export const matchesFilter = (job: LedgerJob, search: JobsSearch): boolean =>
  (search.paper === undefined || job.paper.paper_id === search.paper) && (search.media === undefined || job.source_media_id === search.media);

/** Newest first, by the printer's start time. */
export const byNewest = (a: LedgerJob, b: LedgerJob): number =>
  (b.date + (b.started_at_raw ?? '')).localeCompare(a.date + (a.started_at_raw ?? '')) || b.job_id - a.job_id;
