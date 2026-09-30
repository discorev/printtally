import type { LedgerJob } from 'print-accounting-contracts';
import { Chip, InkWedge, ListRow, Money, PaperSwatch } from '../../components/index.ts';
import { cx } from '../../lib/cx.ts';
import { dateDay, ml, printerTime } from '../../lib/format.ts';
import { jobCancelled, jobKnownMicros, jobOnRoll, jobPaperName, jobSize, jobSwatch, unknownCostReason } from '../../lib/jobs.ts';
import { sizeCode } from '../../lib/sizes.ts';

// One print on the Jobs list (vRow): when, the paper swatch and name, size, the ink wedge, ml and cost,
// with its note beneath. Columns drop as the pad narrows; on a phone it's two lines.
const GRID = 'grid-cols-[116px_30px_minmax(160px,1fr)_96px_130px_64px_72px] gap-x-2.5 min-h-10 '
  + '@max-[840px]:grid-cols-[116px_30px_minmax(160px,1fr)_96px_64px_72px] @max-[640px]:grid-cols-[116px_30px_minmax(140px,1fr)_80px_72px] '
  + 'phone:grid-cols-[1fr_auto]! phone:gap-y-0.5 phone:py-2';
const tag = 'ml-1.5 text-[12px]';

/** `paper`: whether the paper was corrected, or assumed among several that print as this media (paperState). */
export function JobRow({ job, selected, paper }: { job: LedgerJob; selected: boolean; paper: 'corrected' | 'assumed' | null }) {
  const cancelled = jobCancelled(job), unknown = job.total_micros === null, hidden = job.hidden === 1;
  const volume = job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
  return (
    <ListRow id={`job-${job.job_id}`} selected={selected} search={true} to={selected ? '/jobs' : '/jobs/$jobId'} params={{ jobId: String(job.job_id) }}
      className={cx(GRID, job.notes && 'grid-rows-[auto_auto] py-1.5', hidden && 'opacity-55')}>
      <span className="flex gap-2 whitespace-nowrap phone:col-start-1 phone:row-start-1">
        <span className="min-w-11 text-muted">{dateDay(job.date)}</span><span>{printerTime(job.started_at_raw ?? job.completed_at_raw)}</span>
      </span>
      <PaperSwatch {...jobSwatch(job)} className="phone:hidden" />
      <span className={cx('min-w-0 truncate phone:col-start-1 phone:row-start-2', cancelled && 'text-muted')}>
        {jobPaperName(job)}
        {paper && <span className={cx(tag, 'text-muted')}>{paper}</span>}
        {unknown && !cancelled && <span className={cx(tag, 'text-amber')}>{unknownCostReason(job)}</span>}
        {cancelled && <> <Chip tone="red">Cancelled</Chip></>}
        {hidden && <Chip size="sm" className="ml-2">hidden</Chip>}
      </span>
      <span className={cx('flex items-center gap-1.5 whitespace-nowrap phone:col-start-2 phone:row-start-2 phone:justify-end', cancelled && 'text-muted')}>
        {sizeCode(jobSize(job))}
        {job.paper.deckle && <small className="text-[12px] text-muted">deckle</small>}
        {jobOnRoll(job) && <small className="text-[12px] text-muted">roll</small>}
      </span>
      <InkWedge ink={job.ink} className="@max-[840px]:hidden phone:hidden" />
      <span className="text-right whitespace-nowrap text-muted @max-[640px]:hidden phone:hidden">{ml(volume)}</span>
      <span className="text-right font-medium whitespace-nowrap phone:col-start-2 phone:row-start-1">
        {unknown ? <Money micros={jobKnownMicros(job)} className="text-amber" />
          : <><Money micros={job.total_micros} />{cancelled && <small className="block text-[11.5px] leading-[13px] font-normal text-muted">ink only</small>}</>}
      </span>
      {job.notes && (
        <span className="col-[2/-1] -mt-0.5 truncate font-slab text-[13.5px] leading-[18px] text-muted italic phone:col-[1/-1]! phone:row-start-3">{job.notes}</span>
      )}
    </ListRow>
  );
}
