import { useState } from 'react';
import type { ImportRun, PrinterStatus } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { useEdit, useImports } from '../../api/queries.ts';
import { connection, useHealth } from '../../connection/index.ts';
import { Button, ButtonLink, DocketSection, KV, Loading, Mono, Notice, Pad, PadBody, PadHead, RowActions, Sub, Sweep } from '../../components/index.ts';
import { clock, count, dateMedium, dateTime, monthShort, plural } from '../../lib/format.ts';
import { problem } from './problem.ts';
import { useLedgerSpan } from './ledger.ts';

// Collect: when the printer's log was last read, collecting now, jobs the printer dropped before they were
// collected, and the range the printer still holds. The server collects on start and every 15 minutes too.
interface Collected { newJobs: number; problems: string[] }

export function Collect() {
  const health = useHealth(), span = useLedgerSpan();
  const runs = useImports().data?.imports ?? [];
  const [collected, setCollected] = useState<Collected>();
  const collect = useEdit(async (): Promise<Collected> => {
    const result: Collected = { newJobs: 0, problems: [] };
    for (const printer of health?.printers ?? []) {
      try { result.newJobs += (await api.collect(printer.id)).new_jobs; }
      catch (error) { result.problems.push(problem(error)); }
    }
    return result;
  });
  const run = async () => {
    setCollected(undefined);
    const result = await collect.mutateAsync(undefined).catch(error => ({ newJobs: 0, problems: [problem(error)] }));
    setCollected(result);
    void connection.check(); // The last collection and any missed jobs, now.
  };

  const log = runs.find(item => item.status === 'succeeded' && item.requested_last !== null);
  const upTo = log && Math.max(...runs.filter(item => item.status === 'succeeded' && item.printer_id === log.printer_id).map(item => item.requested_last ?? 0));
  // A printer's own state says more than the request's error, so it's shown instead.
  const trouble = !!health?.printers.some(printer => printer.state !== 'ready' && printer.state !== 'unknown');
  const last = health?.lastCollection ?? null, collecting = collect.isPending || !!health?.collecting;
  const kept = span && span.total > 0 && `${plural(span.total, 'job')} kept${span.first ? ` since ${monthShort(span.first)}` : ''}`;
  const since = collected && !collected.problems.length
    ? `${collected.newJobs ? plural(collected.newJobs, 'new job') : 'No new jobs'}${log?.requested_last ? ` · the log ${collected.newJobs ? 'now' : 'still'} ends at job ${count(log.requested_last)}` : ''}`
    : [last?.newJobs ? plural(last.newJobs, 'new job') : span?.last ? `No new jobs since ${dateMedium(span.last)}` : 'No jobs yet', kept].filter(Boolean).join(' · ');

  const head = <PadHead title="Collect" meta="Print Tally reads the printer's job log and keeps every job; the printer keeps only its most recent." />;
  // Everything here comes from the server's health; before its first answer there's nothing to show.
  if (!health) return <Pad label="Collect" className="max-w-[720px]">{head}<PadBody><Loading what="the last collection" /></PadBody></Pad>;
  return (
    <Pad label="Collect" className="max-w-[720px]">
      {head}
      <PadBody>
        <DocketSection label="Last collection" className="border-t-0">
          <div className="flex flex-col gap-1.5">
            <div className="font-slab text-[22px] leading-7 font-semibold">{collected ? 'Just now' : last ? dateTime(last.at) : 'Not yet'}</div>
            {collected?.problems.length ? !trouble && collected.problems.map(text => <Sub key={text} tone="amber">{text}</Sub>)
              : last?.result === 'failed' && !collected ? !trouble && <Sub tone="amber">That collection didn't finish.</Sub> : <Sub>{since}</Sub>}
            {health?.printers.map(printer => <PrinterProblem key={printer.id} printer={printer} />)}
            <Sub>Collects automatically every 15 minutes while Print Tally is running.{health?.nextCollectionAt && !collecting && ` Next at ${clock(health.nextCollectionAt)}.`}</Sub>
          </div>
          <RowActions className="mt-3.5">
            <Button variant="primary" edit disabled={collecting || !health?.printers.length} onClick={() => void run()}>{collecting ? 'Collecting…' : 'Collect now'}</Button>
            {collecting && <Sub>Reading the printer's log…</Sub>}
          </RowActions>
          {collecting && <Sweep />}
        </DocketSection>
        {health?.printers.map(printer => <PrinterAttention key={printer.id} printer={printer} />)}
        {health?.missedJobs.map(gap => (
          <DocketSection key={`${gap.printerId}:${gap.fromRecord}`}>
            <Notice title="Some jobs may have been missed">
              Print Tally last collected job {count(gap.fromRecord - 1)} but the printer's log now starts at job {count(gap.toRecord + 1)}, so {gap.toRecord === gap.fromRecord ? 'the job' : `up to ${count(gap.toRecord - gap.fromRecord + 1)} jobs`} printed in between can't be recovered.
              <Sub className="mt-1">The printer keeps only its most recent jobs. Keep Print Tally running to avoid gaps.</Sub>
              <Mono className="mt-1.5 block text-amber">Collected up to {count(gap.fromRecord - 1)} · printer's log now {rangeText(log)}</Mono>
            </Notice>
          </DocketSection>
        ))}
        <DocketSection label="Printer's log">
          <KV rows={[
            ['On the printer', log ? <>Jobs {rangeText(log)} ({plural(log.requested_last! - log.requested_first! + 1, 'job')})</> : 'Not read yet'],
            ['Collected', upTo ? <>Up to job {count(upTo)}{kept && ` · ${kept}`}</> : kept || 'Nothing yet'],
          ]} />
        </DocketSection>
      </PadBody>
    </Pad>
  );
}

const rangeText = (log: ImportRun | undefined): string => log?.requested_first != null && log.requested_last != null ? `${count(log.requested_first)} – ${count(log.requested_last)}` : 'not read yet';

/** Why the last collection from this printer didn't work, when it's something to wait out or check. */
function PrinterProblem({ printer }: { printer: PrinterStatus }) {
  if (printer.state === 'unreachable') return <Sub tone="amber">Can't reach {printer.name} at <Mono>{printer.host}</Mono>. Check it's switched on and on the network.</Sub>;
  if (printer.state === 'failed') return <Sub tone="amber">Couldn't read {printer.name}'s log. Print Tally tries again at the next collection.</Sub>;
  return null;
}

/** A printer that needs you before it can be collected: its certificate changed, or it has no password. */
function PrinterAttention({ printer }: { printer: PrinterStatus }) {
  if (printer.state === 'needs_confirming') return (
    <DocketSection>
      <Notice title="The printer's certificate changed">
        {printer.name} at <Mono>{printer.host}</Mono> no longer presents the certificate you confirmed, so Print Tally won't send it the password or collect from it.
        Check the new fingerprint against the one on the printer.
        <RowActions><ButtonLink size="sm" to="/setup" search={{ host: printer.host }}>Check the fingerprint</ButtonLink></RowActions>
      </Notice>
    </DocketSection>
  );
  if (printer.state === 'needs_password') return (
    <DocketSection>
      <Notice title="The printer needs its password">
        Print Tally has no password for {printer.name}, so it can't collect from it.
        <RowActions><ButtonLink size="sm" to="/settings">Enter the password</ButtonLink></RowActions>
      </Notice>
    </DocketSection>
  );
  return null;
}
