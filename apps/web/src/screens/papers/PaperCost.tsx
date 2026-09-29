import type { CostTotals } from 'print-accounting-contracts';
import { Money } from '../../components/index.ts';
import { count } from '../../lib/format.ts';

// A paper's cost in prints, as Jobs shows an unknown one: never £0.00 when no print has a paper cost.
type Totals = Pick<CostTotals, 'jobs' | 'paper_micros' | 'unknown_paper_jobs'>;

/** The amount, or an amber "—" when every print's paper cost is unknown. */
export const PaperCost = ({ totals }: { totals: Totals }) => totals.jobs > 0 && totals.unknown_paper_jobs === totals.jobs
  ? <span className="text-amber">—</span> : <Money micros={totals.paper_micros} />;
/** "3 without a paper cost", or null when every print has one. */
export const unknownPaper = (totals: Totals): string | null => totals.unknown_paper_jobs ? `${count(totals.unknown_paper_jobs)} without a paper cost` : null;
