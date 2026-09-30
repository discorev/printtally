import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import type { MediaTypeView, PaperView } from 'print-accounting-contracts';
import { ButtonLink, Dot, Empty, ListRow, Loading, Money, Pad, PadBody, PadHead, PaperLine, PaperSwatch, Seg, StockLine, Sub } from '../../components/index.ts';
import { useCanEdit } from '../../connection/index.ts';
import { useMediaTypes, usePapers } from '../../api/queries.ts';
import { count, plural } from '../../lib/format.ts';
import { mediaName, methodName } from './common.ts';
import { PaperCost, unknownPaper } from './PaperCost.tsx';

// Papers: the Stock tab lists each paper with its stock, prints and paper cost; the Media tab lists the
// printer's media types and which paper prints as each (vPapers).
type Tab = 'stock' | 'media';
const TABS = [{ value: 'stock' as const, label: 'Stock' }, { value: 'media' as const, label: 'Media' }];

export function PapersPad() {
  const tab: Tab = useLocation({ select: location => location.pathname.startsWith('/papers/media') ? 'media' : 'stock' });
  const navigate = useNavigate();
  const seg = <Seg items={TABS} value={tab} label="Papers view" onChange={value => void navigate({ to: value === 'media' ? '/papers/media' : '/papers' })} />;
  return <Pad label="Papers">{tab === 'media' ? <MediaList seg={seg} /> : <StockList seg={seg} />}</Pad>;
}

function StockList({ seg }: { seg: React.ReactNode }) {
  const { data, error } = usePapers(), canEdit = useCanEdit();
  const { paperId } = useParams({ strict: false });
  const papers = data?.papers ?? [];
  const paper = papers.reduce((sum, p) => sum + p.totals.paper_micros, 0), waste = papers.reduce((sum, p) => sum + p.totals.waste_micros, 0);
  const unknown = papers.reduce((sum, p) => sum + p.totals.unknown_paper_jobs, 0);
  return <>
    <PadHead title="Papers" after={seg}
      meta={data && <><b>{plural(papers.length, 'paper')}</b><Dot /><b><Money micros={paper} /></b> of paper in prints at the {methodName(data.settings)} price
        {unknown > 0 && <><Dot /><span className="text-amber">{count(unknown)} without a paper cost</span></>}
        {waste > 0 && <><Dot /><span className="text-red"><Money micros={waste} /> written off</span></>}</>}
      actions={<ButtonLink to="/papers/new" variant="primary" size="sm" disabled={!canEdit}>Add stock</ButtonLink>} />
    <PadBody role="listbox" aria-label="Papers">
      {!data ? <Loading what="papers" error={error} /> : !papers.length ? <Empty>No papers yet. Add stock to set up your first paper.</Empty>
        : papers.map(p => <PaperRow key={p.id} paper={p} selected={paperId === String(p.id)} />)}
    </PadBody>
  </>;
}

function PaperRow({ paper, selected }: { paper: PaperView; selected: boolean }) {
  const { stock, totals } = paper;
  return (
    <ListRow selected={selected} to={selected ? '/papers' : '/papers/$paperId'} params={selected ? undefined : { paperId: String(paper.id) }}
      className="grid-cols-[minmax(216px,1fr)_250px_90px_150px] gap-x-3 py-2.5 @max-[840px]:grid-cols-[minmax(196px,1fr)_220px_80px_130px]
        @max-[640px]:grid-cols-[minmax(196px,1fr)_80px_110px] phone:grid-cols-[1fr_auto]! phone:gap-x-2.5 phone:gap-y-0.5">
      {/* The same paper line as a job's docket shows (its Paper section). */}
      <PaperLine swatch="big" name={paper.name} className="items-center phone:col-span-2" detail={
        <div className="mt-px truncate text-[12.5px] text-muted">
          {plural(paper.purchases.length, 'purchase')}<Dot />
          {stock.length ? plural(stock.length, stock.every(s => s.format === 'roll') ? 'roll' : 'size') : 'no stock items'}
          {!paper.media_types.length && <><Dot /><span className="text-amber">no printer media linked</span></>}
        </div>} />
      <span className="flex flex-col gap-0.5 text-[13px] whitespace-nowrap text-muted @max-[640px]:hidden phone:hidden">
        {stock.length ? stock.map(s => <StockLine key={s.id} stock={s} />) : <span className="text-amber">No stock yet</span>}
      </span>
      <span className="text-right whitespace-nowrap text-muted phone:pl-14 phone:text-left">{plural(totals.jobs, 'print')}</span>
      <span className="text-right font-medium whitespace-nowrap">
        <PaperCost totals={totals} />
        <small className="block text-[11.5px] leading-[13px] font-normal text-muted">paper in prints</small>
        {unknownPaper(totals) && <small className="block text-[11.5px] leading-[13px] font-normal text-amber">{unknownPaper(totals)}</small>}
        {totals.waste_micros > 0 && <small className="block text-[11.5px] leading-[13px] font-normal text-red"><Money micros={totals.waste_micros} /> waste</small>}
      </span>
    </ListRow>
  );
}

function MediaList({ seg }: { seg: React.ReactNode }) {
  const { data, error } = useMediaTypes();
  const { media } = useParams({ strict: false });
  const list = data?.media_types ?? [], unlinked = list.filter(m => !m.papers.length && m.jobs > 0).length;
  return <>
    <PadHead title="Papers" after={seg}
      meta={data && <><b>{plural(list.length, 'media type')}</b> on the printer{unlinked > 0 && <><Dot /><span className="text-amber">{unlinked} with prints but no paper</span></>}</>}>
      <Sub>Media types are configured on the printer and read at each collection. Which paper prints as which media is set on the paper.</Sub>
    </PadHead>
    <PadBody role="listbox" aria-label="Printer media">
      {!data ? <Loading what="media types" error={error} /> : !list.length ? <Empty>No media types yet. They're read from the printer at each collection.</Empty>
        : list.map(m => <MediaRow key={m.source_media_id} media={m} selected={media === m.source_media_id} />)}
    </PadBody>
  </>;
}

function MediaRow({ media, selected }: { media: MediaTypeView; selected: boolean }) {
  const papers = media.papers;
  return (
    <ListRow selected={selected} to={selected ? '/papers/media' : '/papers/media/$media'} params={selected ? undefined : { media: media.source_media_id }}
      className="min-h-11 grid-cols-[36px_minmax(160px,1fr)_100px_280px] gap-x-3 py-2 @max-[840px]:grid-cols-[36px_minmax(140px,1fr)_90px_220px]
        phone:grid-cols-[36px_1fr_auto]!">
      <PaperSwatch none={!papers.length} />
      <span className="min-w-0 font-medium">{mediaName(media)}</span>
      <span className="text-right whitespace-nowrap text-muted">{media.jobs ? plural(media.jobs, 'print') : 'no prints'}</span>
      <span className="text-[13px] phone:col-[2/-1] phone:text-[12.5px]">
        {papers.length ? <>{papers.map(p => p.name).join(', ')}<small className="block text-[12px] text-muted">{papers.length > 1 ? 'papers print as this' : 'paper prints as this'}</small></>
          : media.jobs ? <><span className="text-amber">No paper</span><small className="block text-[12px] text-muted">prints have no paper cost</small></>
          : <><span className="text-muted">No paper</span><small className="block text-[12px] text-muted">no prints yet</small></>}
      </span>
    </ListRow>
  );
}
