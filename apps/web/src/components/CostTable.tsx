import type { ReactNode } from 'react';
import type { LedgerJob } from 'print-accounting-contracts';
import { cx } from '../lib/cx.ts';
import { currencySymbol, metres, ml, money, plural } from '../lib/format.ts';
import { byChannelOrder, inkChannel } from '../lib/inks.ts';
import { jobCancelled, jobPaperName, jobSize, jobSwatch, unknownLine } from '../lib/jobs.ts';
import { sizeCode } from '../lib/sizes.ts';
import { useCurrency } from '../api/queries.ts';
import { InkSwatch, PaperSwatch } from './Swatches.tsx';
import { SummaryLine } from './Lines.tsx';

const head = 'border-b border-rule pb-[3px] font-slab text-[10.5px] leading-[14px] font-semibold tracking-[.08em] text-muted uppercase';
const rule = <span className="col-span-full border-t border-rule" />;

/** The costing sheet for one print, as the API costed it: the paper line, each ink channel, the ink subtotal
 *  and "This print". While the paper cost is unknown the total reads "Ink so far", with a note and `action`
 *  (e.g. an "Add a purchase" button) beneath. Nothing is recalculated here. */
export function CostTable({ job, action }: { job: LedgerJob; action?: ReactNode }) {
  const currency = useCurrency(), unknown = job.paper_micros === null;
  const paperOnly = !unknown && job.ink.some(line => line.cost_micros === null);
  const { paper } = job, cancelled = jobCancelled(job) || paper.quantity === 0;
  const unit = paper.quantity === null ? plural(Number(job.impressions ?? 0), 'sheet')
    : paper.format === 'roll' ? metres(paper.quantity, 2) : plural(paper.quantity, 'sheet');
  const name = unknown ? unknownLine(job) : cancelled ? `${jobPaperName(job)} — no sheet used${jobCancelled(job) ? ', cancelled' : ''}`
    : `${jobPaperName(job)}${paper.deckle ? ' · deckle' : ''}`;
  const inkNl = job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
  return (
    <>
      <div aria-label="Costing sheet" className="mt-1.5 grid grid-cols-[14px_44px_1fr_68px_64px] items-center gap-x-2 gap-y-1.5 text-[13px]">
        <span className={head} /><span className={cx(head, 'col-span-2')}>Item</span><span className={cx(head, 'text-right')}>Unit</span>
        <span className={cx(head, 'text-right')}>{currencySymbol(currency)}</span>

        <PaperSwatch size="tiny" {...jobSwatch(job)} none={unknown} />
        <span className="font-medium">{sizeCode(jobSize(job))}</span>
        <span className={cx('leading-[17px]', unknown ? 'text-amber' : 'text-muted')}>{name}</span>
        <span className="text-right">{unit}</span>
        <span className={cx('text-right', unknown ? 'text-muted' : 'font-medium')}>{unknown ? 'unknown' : money(job.paper_micros, currency)}</span>
        {rule}

        {byChannelOrder(job.ink, line => line.channel).map(line => (
          <InkRow key={line.channel} channel={line.channel} volumeNl={line.volume_nl} amount={money(line.cost_micros, currency)} />
        ))}
        {rule}
        <span /><span className="col-span-2 font-medium">Ink subtotal</span><span className="text-right">{ml(inkNl)}</span>
        <span className="text-right font-medium">{money(job.ink_micros, currency)}</span>
      </div>
      <SummaryLine total what={unknown ? 'Ink so far' : paperOnly ? 'Paper only' : 'This print'}
        amount={money(unknown ? job.ink_micros : paperOnly ? job.paper_micros : job.total_micros, currency)} />
      {unknown && <div className="mt-3 text-[13px] leading-[18px] text-amber">Paper not included — its cost is unknown.</div>}
      {paperOnly && <div className="mt-3 text-[13px] leading-[18px] text-amber">Ink not included — its cost is unknown.</div>}
      {unknown && action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
    </>
  );
}

const InkRow = ({ channel, volumeNl, amount }: { channel: string; volumeNl: number | null; amount: string }) => (
  <>
    <InkSwatch channel={channel} volumeNl={volumeNl} />
    <span className="font-medium">{channel}</span>
    <span className="truncate text-muted">{inkChannel(channel).name}</span>
    <span className="text-right">{ml(volumeNl)}</span>
    <span className="text-right">{amount}</span>
  </>
);
