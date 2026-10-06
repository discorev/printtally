import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { Annotation, JobsResponse, LedgerJob } from 'print-accounting-contracts';
import {
  Button, ButtonLink, Chip, CostTable, Docket, DocketHead, DocketSection, KV, LinkButton, LoadingHead, Mono, NoteText, PAPER_TONE, StatusLine, Sub, Textarea, type DocketClose,
} from '../../components/index.ts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useJob, useMediaTypes, usePapers, usePrinters, useSettings } from '../../api/queries.ts';
import { useCanEdit } from '../../connection/index.ts';
import { clock, dateLong, duration, ml, mm, plural, printerTime, printerTimeFull } from '../../lib/format.ts';
import { jobCancelled, jobPaperName, jobSize, jobSizeLabel } from '../../lib/jobs.ts';
import { paperState } from './paper.ts';
import { PaperSection, type PaperMode, type SaveAnnotation } from './PaperSection.tsx';

const CLOSE: DocketClose = { to: { to: '/jobs', search: true }, label: 'Jobs' };

/** State that belongs to one job's docket: it resets when the docket moves to another job. */
function usePerJob<T>(jobId: number, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<[number, T]>([jobId, initial]);
  return [state[0] === jobId ? state[1] : initial, value => setState([jobId, value])];
}

/** The job docket (vDocket): when and what, the costing sheet, the paper and where it came from, the note,
 *  what the printer reported, and hide/show. */
export function JobDocket({ jobId }: { jobId: number }) {
  const client = useQueryClient(), query = useJob(jobId);
  // While the job loads, show it as the list has it, so moving through the list doesn't blank the docket.
  const job = query.data?.job ?? client.getQueriesData<JobsResponse>({ queryKey: ['jobs'] })
    .flatMap(([, data]) => data?.jobs ?? []).find(item => item.job_id === jobId);
  if (!job) return (
    <Docket label="Print docket" close={CLOSE}>
      {query.isError ? <DocketHead when="Jobs" title="This print isn’t available" subtitle={describeError(query.error)} /> : <LoadingHead when="Jobs" what="this print" />}
    </Docket>
  );
  return <JobDocketBody job={job} />;
}

function JobDocketBody({ job }: { job: LedgerJob }) {
  const papers = usePapers().data?.papers ?? [], mediaTypes = useMediaTypes().data?.media_types ?? [];
  const method = useSettings().data?.costing_method ?? 'oldest', canEdit = useCanEdit();
  // Which printer it came from, when there's more than one.
  const printers = usePrinters().data?.printers ?? [], printer = printers.length > 1 ? printers.find(item => item.id === job.printer_id) : undefined;
  const [mode, setMode] = usePerJob<PaperMode>(job.job_id, 'view');
  const [status, setStatus] = usePerJob<{ text: string; error?: boolean } | null>(job.job_id, null);
  const annotate = useEdit(({ id, annotation }: { id: number; annotation: Annotation }) => api.annotateJob(id, annotation));
  const save: SaveAnnotation = (annotation, label) => annotate.mutateAsync({ id: job.job_id, annotation }).then(
    () => { const at = clock(new Date().toISOString()); setStatus({ text: label ? `${label} · saved ${at}` : `Saved ${at}` }); return true; },
    (error: unknown) => { setStatus({ text: describeError(error), error: true }); return false; });
  const hidden = job.hidden === 1, cancelled = jobCancelled(job);
  const toggleHidden = () => void save({ hidden: hidden ? 0 : 1 }, hidden ? 'Shown' : 'Hidden');

  // Escape closes an open picker or form before the docket; h hides, p corrects the paper, Enter goes to the note.
  // A list row keeps focus after it's clicked, so it doesn't count as a control here (Enter would reopen it).
  const keys = useRef({ mode, setMode, toggleHidden, canEdit });
  keys.current = { mode, setMode, toggleHidden, canEdit };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { mode, setMode, toggleHidden, canEdit } = keys.current, target = event.target as HTMLElement;
      if (event.key === 'Escape' && mode !== 'view') { event.preventDefault(); setMode('view'); return; }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName) && target.getAttribute('role') !== 'option') return;
      if (event.key === 'Enter') { event.preventDefault(); document.getElementById('job-note')?.focus(); }
      else if ((event.key === 'h' || event.key === 'H') && canEdit) { event.preventDefault(); toggleHidden(); }
      else if ((event.key === 'p' || event.key === 'P') && canEdit) { event.preventDefault(); setMode('picker'); }
    };
    addEventListener('keydown', onKey, true); // Capture, so it runs before the docket's own Escape.
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  const volume = job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
  const start = printerTime(job.started_at_raw), end = printerTime(job.completed_at_raw), took = duration(job.started_at_raw, job.completed_at_raw);
  const corrected = paperState(job, papers) === 'corrected';
  const addPurchase = job.paper.unknown_reason === 'no_paper' || job.paper.unknown_reason === 'no_matching_stock' || job.paper.unknown_reason === 'no_stock_by_date';
  const w = Number(job.width_um ?? 0), h = Number(job.height_um ?? 0);
  return (
    <Docket label="Print docket" close={CLOSE} tone={PAPER_TONE}>
      <DocketHead when={<>{dateLong(job.date)}{start && <> · {start}{end && ` – ${end}`}</>}</>}
        title={`${jobSizeLabel(job)} · ${jobPaperName(job)}`}
        subtitle={[printer && `On ${printer.name}`, ...cancelled ? [`Cancelled after ${ml(volume)} of ink`] : [`${ml(volume)} of ink`, took]].filter(Boolean).join(' · ')}>
        {job.notes && <NoteText className="mt-2">{job.notes}</NoteText>}
        {(cancelled || hidden || corrected) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cancelled && <Chip tone="red">Cancelled</Chip>}{hidden && <Chip>Hidden</Chip>}{corrected && <Chip tone="green">Paper corrected</Chip>}
          </div>
        )}
      </DocketHead>
      <DocketSection label="Cost" lockable>
        <CostTable job={job} action={addPurchase && <AddPurchase job={job} />} />
      </DocketSection>
      <PaperSection job={job} papers={papers} mediaTypes={mediaTypes} method={method} mode={mode} setMode={setMode} save={save} />
      <Note key={job.job_id} job={job} save={save} status={status} />
      <DocketSection label="Printer reported">
        <KV rows={[
          !!printer && ['Printer', <>{printer.name} · <Mono>{printer.host}</Mono></>],
          ['Job name', <Mono>{job.job_name ?? '—'}</Mono>],
          ['Media', job.configured_paper_name ?? job.paper_name_at_import ?? job.source_media_id ?? '—'],
          job.impressions !== null && ['Sheets used', <>{String(job.impressions)} <span className="text-muted">(impressions completed)</span></>],
          ['Size', w && h ? `${jobSize(job)} · ${mm(Math.min(w, h))} × ${mm(Math.max(w, h))} mm · ${(w * h / 1e12).toFixed(3)} m²` : jobSize(job)],
          !!job.started_at_raw && ['Started', printerTimeFull(job.started_at_raw)],
          !!job.completed_at_raw && ['Finished', <>{printerTimeFull(job.completed_at_raw)}{took && ` (${took})`}</>],
        ]} />
      </DocketSection>
      <DocketSection className="flex items-center justify-between gap-3">
        <Sub>{hidden ? 'Hidden prints are kept but left out of totals.' : 'Hiding keeps the print but leaves it out of totals.'}</Sub>
        <Button edit onClick={toggleHidden} disabled={annotate.isPending}>{hidden ? 'Show job' : 'Hide job'}</Button>
      </DocketSection>
    </Docket>
  );
}

/** The note: saved when you leave the box, if it changed. Leaving the docket (another row, ×, Escape) waits for
 *  that save and stays put if it fails, so an unsaved note is never lost silently; "Discard changes" lets it go. */
function Note({ job, save, status }: { job: LedgerJob; save: SaveAnnotation; status: { text: string; error?: boolean } | null }) {
  const [text, setText] = useState(job.notes ?? ''), canEdit = useCanEdit();
  const draft = useRef(text), saved = useRef(job.notes ?? null), inflight = useRef<Promise<boolean> | null>(null);
  draft.current = text;
  const dirty = () => (draft.current.trim() || null) !== saved.current;
  const persist = async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    if (!dirty()) return true;
    const notes = draft.current.trim() || null;
    inflight.current = save({ notes }, '').then(ok => { if (ok) saved.current = notes; inflight.current = null; return ok; });
    return inflight.current;
  };
  useBlocker({ enableBeforeUnload: dirty, shouldBlockFn: async () => {
    if (await persist()) return false;
    const box = document.getElementById('job-note'); // Show the note and why it wasn't saved.
    box?.scrollIntoView({ block: 'center' }); box?.focus();
    return true;
  } });
  return (
    <DocketSection label="Note" lockable>
      <Textarea id="job-note" aria-label="Note" value={text} disabled={!canEdit} onChange={event => setText(event.target.value)} onBlur={() => void persist()}
        placeholder="An edition number, a client, what to change next time — notes are searchable" />
      <StatusLine error={status?.error}>{status?.text}
        {status?.error && dirty() && <> <LinkButton onClick={() => setText(draft.current = saved.current ?? '')}>Discard changes</LinkButton></>}</StatusLine>
    </DocketSection>
  );
}

/** "Add a purchase" for a print whose paper cost is unknown: the Papers purchase form, filled in for this print
 *  (its paper, size and day; or a new paper printed as its media). Rolls leave the size out. */
function AddPurchase({ job }: { job: LedgerJob }) {
  const prefill = { size: job.paper.format === 'roll' ? undefined : jobSize(job), date: job.date };
  return job.paper.paper_id !== null
    ? <ButtonLink size="sm" to="/papers/$paperId" params={{ paperId: String(job.paper.paper_id) }} search={{ form: 'purchase', ...prefill }}>Add a purchase</ButtonLink>
    : <ButtonLink size="sm" to="/papers/new" search={{ media: job.source_media_id ?? undefined, ...prefill }}>Add a purchase</ButtonLink>;
}
