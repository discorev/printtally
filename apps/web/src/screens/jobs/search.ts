import type { LedgerJob } from 'print-accounting-contracts';

// The Jobs list's search, paper and printer filters and "Show hidden" live in the URL (/jobs?paper=3,
// /jobs?media=<id>, /jobs?printer=2), so Papers can link to a paper's prints and a docket keeps the list as it was.
// printer is the archived printer's id (a job's printer_id).
export interface JobsSearch { q?: string; paper?: number; media?: string; printer?: number; hidden?: boolean }

const id = (value: unknown): number | undefined => { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : undefined; };
export function validateJobsSearch(search: Record<string, unknown>): JobsSearch {
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return {
    q: text(search.q) || undefined,
    paper: id(search.paper),
    media: text(search.media) || undefined,
    printer: id(search.printer),
    hidden: search.hidden === true || search.hidden === 'true' || search.hidden === 1 || undefined,
  };
}

/** The paper filter (a paper's prints, or the prints the printer reported as a media type) and the printer filter. */
export const matchesFilter = (job: LedgerJob, search: JobsSearch): boolean =>
  (search.paper === undefined || job.paper.paper_id === search.paper) && (search.media === undefined || job.source_media_id === search.media)
  && (search.printer === undefined || job.printer_id === search.printer);

/** Newest first, by the printer's start time. */
export const byNewest = (a: LedgerJob, b: LedgerJob): number =>
  (b.date + (b.started_at_raw ?? '')).localeCompare(a.date + (a.started_at_raw ?? '')) || b.job_id - a.job_id;
