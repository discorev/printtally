import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { LedgerJob } from 'print-accounting-contracts';
import { Empty, ListHeader, Money, Pad, PadBody, PadHead, PaperSelect, SearchInput, TextLink, Toggle, type PaperChoice } from '../../components/index.ts';
import { useJobs, useMediaTypes, usePapers, useSettings, useTotals } from '../../api/queries.ts';
import { count, ml, monthLong, monthShort, plural } from '../../lib/format.ts';
import { byNewest, matchesFilter, type JobsSearch } from './search.ts';
import { JobRow } from './JobRow.tsx';
import { paperState } from './paper.ts';

const LIMIT = 1000; // The API's largest page: the whole ledger for now.
const METHOD = { oldest: 'oldest price', average: 'average price', max: 'max price' } as const;

/** Waits until typing pauses before searching the server. */
function useSettled<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return settled;
}

// A month's prints, and its totals: sums of the API's per-job figures over the group's shown (not hidden) prints.
interface Group { month: string; jobs: LedgerJob[]; prints: number; nl: number; micros: number; unknown: number }
function groupByMonth(jobs: LedgerJob[]): Group[] {
  const groups: Group[] = [];
  for (const job of jobs) {
    let group = groups.at(-1);
    if (group?.month !== job.date.slice(0, 7)) groups.push(group = { month: job.date.slice(0, 7), jobs: [], prints: 0, nl: 0, micros: 0, unknown: 0 });
    group.jobs.push(job);
    if (job.hidden) continue;
    group.prints++;
    group.nl += job.ink.reduce((sum, line) => sum + (line.volume_nl ?? 0), 0);
    group.micros += job.total_micros ?? job.ink_micros;
    if (job.total_micros === null) group.unknown++;
  }
  return groups;
}

/** The Jobs pad (vJobs): the header's totals, search and filters, and the prints by month. */
export function JobsPad() {
  const search = useSearch({ from: '/_app/jobs' }), navigate = useNavigate({ from: '/jobs' });
  const selected = Number(useParams({ strict: false }).jobId ?? NaN);
  const q = useSettled(search.q ?? '');
  const jobs = useJobs({ q: q || undefined, includeHidden: !!search.hidden, limit: LIMIT });
  const totals = useTotals().data, papers = usePapers().data?.papers ?? [], mediaTypes = useMediaTypes().data?.media_types ?? [];
  const method = useSettings().data?.costing_method ?? totals?.settings.costing_method ?? 'oldest';

  const visible = useMemo(() => (jobs.data?.jobs ?? []).filter(job => matchesFilter(job, search)).sort(byNewest), [jobs.data, search]);
  const groups = useMemo(() => groupByMonth(visible), [visible]);

  const setSearch = (patch: Partial<JobsSearch>) => void navigate({ search: prev => ({ ...prev, ...patch }), replace: true });
  // Media with no paper set up can be filtered on too; so can a media Papers linked to that isn't in that list.
  const unpapered = mediaTypes.filter(m => !m.papers.length && m.jobs > 0)
    .map(m => ({ value: 'media:' + m.source_media_id, label: `${m.name ?? m.source_media_id} (no paper set up)` }));
  if (search.media && !unpapered.some(m => m.value === 'media:' + search.media)) {
    const media = mediaTypes.find(m => m.source_media_id === search.media);
    unpapered.push({ value: 'media:' + search.media, label: media?.name ?? search.media });
  }
  const filter: PaperChoice = search.paper ?? (search.media ? 'media:' + search.media : null);
  const onFilter = (value: PaperChoice) => setSearch(typeof value === 'number' ? { paper: value, media: undefined }
    : typeof value === 'string' ? { paper: undefined, media: value.slice('media:'.length) } : { paper: undefined, media: undefined });

  // j/k or the arrows move through the list; the docket handles its own keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;
      const step = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : 0;
      if (!step || !visible.length) return;
      event.preventDefault();
      const index = visible.findIndex(job => job.job_id === selected);
      const next = visible[index === -1 ? (step > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, index + step))];
      void navigate({ to: '/jobs/$jobId', params: { jobId: String(next.job_id) }, search: true, replace: true });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [visible, selected, navigate]);
  const loaded = jobs.data;
  useEffect(() => { document.getElementById(`job-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected, !!loaded]);

  const days = totals?.days.filter(day => day.jobs > 0) ?? [];
  const range = days.length ? `${monthShort(days.at(-1)!.date)} – ${monthShort(days[0].date)}` : null;
  const overall = totals?.overall;
  const meta = overall && (
    <>
      <b>{plural(overall.jobs, 'print')}</b>{range && <> · {range}</>} · <b><Money micros={overall.total_micros} /></b> at the{' '}
      <TextLink to="/settings">{METHOD[method]}</TextLink>
      {overall.unknown_jobs > 0 && <> · <span className="text-amber">{count(overall.unknown_jobs)} without a paper cost</span></>}
    </>
  );

  const filtered = !!(search.q || search.paper || search.media);
  return (
    <Pad label="Jobs">
      <PadHead title="Jobs" meta={meta ?? ''}>
        <SearchInput placeholder="Search notes, papers and job names" aria-label="Search notes, papers and job names" value={search.q ?? ''}
          onChange={event => setSearch({ q: event.target.value || undefined })} className="max-w-[360px] phone:max-w-none phone:basis-full" />
        <PaperSelect aria-label="Paper" papers={papers} value={filter} onChange={onFilter} placeholder="All papers" extra={unpapered} className="w-auto! max-w-[260px]" />
        <Toggle label="Show hidden" checked={!!search.hidden} onChange={event => setSearch({ hidden: event.target.checked || undefined })} />
      </PadHead>
      <PadBody role="listbox" aria-label="Prints" tabIndex={0}>
        {!loaded ? <Empty>{jobs.isError ? "Can't load prints until the server is back." : 'Loading prints…'}</Empty>
          : !groups.length ? <Empty>{filtered || loaded.total ? 'No prints match. Clear the search or choose another paper.' : 'No prints yet. Collect from the printer and they appear here.'}</Empty>
          : groups.map(group => (
            <div key={group.month} role="presentation">
              <ListHeader label={monthLong(group.month + '-01')} meta={<>
                {plural(group.prints, 'print')} · {ml(group.nl)} · <b><Money micros={group.micros} /></b>
                {group.unknown > 0 && <span className="text-amber"> ({group.unknown} without a paper cost)</span>}
              </>} />
              {group.jobs.map(job => (
                <JobRow key={job.job_id} job={job} selected={job.job_id === selected} paper={paperState(job, papers)} />
              ))}
            </div>
          ))}
        {loaded && loaded.total > loaded.jobs.length && <Empty>Showing the latest {count(loaded.jobs.length)} of {count(loaded.total)} prints.</Empty>}
      </PadBody>
    </Pad>
  );
}
