import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { MediaTypeView, PaperView } from 'print-accounting-contracts';
import {
  Button, ButtonLink, Docket, DocketHead, DocketSection, ItemLine, LedgerList, Money, PaperPurchaseForm, PurchaseLine, RowActions,
  SavedNotice, Select, StatusLine, Sub, SummaryLine, WriteOffLine,
} from '../../components/index.ts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useMediaTypes, usePapers } from '../../api/queries.ts';
import { useCanEdit } from '../../connection/index.ts';
import { dateShort, ml, plural } from '../../lib/format.ts';
import { mediaName, methodName, stockAmount, stockAtSize, type PurchasePrefill } from './common.ts';
import { WriteOffForm } from './WriteOffForm.tsx';

// A paper's docket (vPaperDocket): the media it prints as, its stock, prints, purchases and write-offs.
// "Add stock" and "Write off" swap the sections for their form (?form=…), and ?saved=… shows the confirmation.
export type PaperForm = 'purchase' | 'writeoff';
export interface PaperSearch extends PurchasePrefill { form?: PaperForm; saved?: string }
const CLOSE = { to: { to: '/papers' }, label: 'Papers' } as const;

export function PaperDocket({ paperId, form, saved, ...prefill }: { paperId: number } & PaperSearch) {
  const { data } = usePapers(), media = useMediaTypes().data?.media_types ?? [];
  const paper = data?.papers.find(p => p.id === paperId);
  if (!data) return <Docket label="Paper" close={CLOSE}><DocketHead when="Paper" title="Loading…" /></Docket>;
  if (!paper) return (
    <Docket label="Paper" close={CLOSE}><DocketHead when="Paper" title="Paper not found" /><DocketSection><Sub>It may have been deleted on another device.</Sub></DocketSection></Docket>
  );
  return (
    <Docket label="Paper" close={CLOSE}>
      <DocketHead when="Paper" title={paper.name} />
      {form ? <PaperFormSection paper={paper} papers={data.papers} media={media} form={form} saved={saved} prefill={prefill} /> : <>
        <PrintsAs paper={paper} media={media} />
        <InStock paper={paper} />
        <DocketSection label="Prints">
          <SummaryLine what={<>{plural(paper.totals.jobs, 'print')} · {ml(paper.totals.ink_nl)} of ink</>}
            sub={`paper at the ${methodName(data.settings)} price`} amount={<Money micros={paper.totals.paper_micros} />} />
          <RowActions><ButtonLink to="/jobs" search={{ paper: paper.id }} variant="text" size="sm">Show in Jobs</ButtonLink></RowActions>
        </DocketSection>
        <Ledger paper={paper} />
      </>}
    </Docket>
  );
}

function PrintsAs({ paper, media }: { paper: PaperView; media: MediaTypeView[] }) {
  const canEdit = useCanEdit(), ids = paper.media_types.map(m => m.source_media_id);
  const save = useEdit((media_types: string[]) => api.paper.update(paper.id, { media_types }));
  const jobs = (id: string) => media.find(m => m.source_media_id === id)?.jobs ?? 0;
  return (
    <DocketSection label="Prints as" lockable>
      <Sub className="mb-1.5">The printer media types this paper is printed with.</Sub>
      {paper.media_types.map(m => (
        <ItemLine key={m.source_media_id} name={mediaName(m)} note={plural(jobs(m.source_media_id), 'print')}
          value={<Button variant="text" size="sm" edit disabled={save.isPending} onClick={() => save.mutate(ids.filter(id => id !== m.source_media_id))}>Remove</Button>} />
      ))}
      {!ids.length && <Sub tone="amber">No media yet — prints can't be matched to this paper.</Sub>}
      <RowActions>
        <Select aria-label="Add printer media" value="" disabled={!canEdit || save.isPending} className="w-auto! max-w-full"
          onChange={e => e.target.value && save.mutate([...ids, e.target.value])}>
          <option value="">Add a media type…</option>
          {media.filter(m => !ids.includes(m.source_media_id)).map(m => (
            <option key={m.source_media_id} value={m.source_media_id}>{mediaName(m)}{m.papers.length ? ` · also ${m.papers.map(p => p.name).join(', ')}` : ''}</option>
          ))}
        </Select>
      </RowActions>
      {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
    </DocketSection>
  );
}

function InStock({ paper }: { paper: PaperView }) {
  const navigate = useNavigate(), open = (form: PaperForm) => void navigate({ to: '/papers/$paperId', params: { paperId: String(paper.id) }, search: { form } });
  return (
    <DocketSection label="In stock">
      {paper.stock.map(s => (
        <ItemLine key={s.id} name={s.name} note={s.deckle && !/deckle/i.test(s.name) ? 'deckle edge' : undefined}
          sub={<>bought {stockAmount(s, s.bought)} · used by prints {stockAmount(s, s.used)}{s.wasted > 0 && <> · written off {stockAmount(s, s.wasted)}</>}</>}
          value={<b className="font-semibold">{stockAmount(s, s.remaining)}</b>} caption="left" />
      ))}
      {!paper.stock.length && <Sub>Nothing bought yet.</Sub>}
      <RowActions>
        <Button variant="primary" size="sm" edit onClick={() => open('purchase')}>Add stock</Button>
        <Button size="sm" edit disabled={!paper.stock.length} onClick={() => open('writeoff')}>Write off</Button>
      </RowActions>
    </DocketSection>
  );
}

function Ledger({ paper }: { paper: PaperView }) {
  const stock = (id: number) => paper.stock.find(s => s.id === id)!;
  const purchases = [...paper.purchases].sort((a, b) => b.purchased_on.localeCompare(a.purchased_on) || b.id - a.id);
  return <>
    <DocketSection label="Purchases">
      <LedgerList empty="None yet.">{purchases.map(p => <PurchaseLine key={p.id} paper={p} stock={stock(p.paper_stock_id)} />)}</LedgerList>
    </DocketSection>
    <DocketSection label="Written off">
      <LedgerList empty="Nothing written off.">{paper.write_offs.map(w => <WriteOffLine key={w.id} writeOff={w} stock={stock(w.paper_stock_id!)} />)}</LedgerList>
      {paper.totals.waste_micros > 0 && <Sub className="mt-1.5">Waste shows in totals, never inside a print's cost.</Sub>}
    </DocketSection>
  </>;
}

/** The Add stock or Write off form in place of the docket's sections; Escape (outside a field) goes back to them. */
function PaperFormSection({ paper, papers, media, form, saved, prefill }: {
  paper: PaperView; papers: PaperView[]; media: MediaTypeView[]; form: PaperForm; saved?: string; prefill: PurchasePrefill;
}) {
  const navigate = useNavigate();
  const back = () => void navigate({ to: '/papers/$paperId', params: { paperId: String(paper.id) } });
  const done = (paperId: number, value: string) => void navigate({ to: '/papers/$paperId', params: { paperId: String(paperId) }, search: { form, saved: value } });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)) return;
      event.preventDefault();
      back();
    };
    addEventListener('keydown', onKey, true); // Capture, so it runs before the docket's own Escape (close).
    return () => removeEventListener('keydown', onKey, true);
  });
  if (saved) return form === 'purchase'
    ? <SavedNotice label="Stock" onDone={back}>Added. Prints from {/^\d{4}-\d\d-\d\d$/.test(saved) ? dateShort(saved) : 'its date'} on are costed from it.</SavedNotice>
    : <SavedNotice label="Write-off" onDone={back}>Saved. It shows as waste in totals, never inside a print's cost.</SavedNotice>;
  return form === 'purchase'
    ? <PaperPurchaseForm papers={papers} mediaTypes={media} initial={{ paperId: paper.id, stockId: prefill.size ? stockAtSize(paper.stock, prefill.size) : undefined, size: prefill.size, date: prefill.date }} onCancel={back} onSaved={s => done(s.paperId, s.date)} />
    : <WriteOffForm papers={papers} paperId={paper.id} onCancel={back} onSaved={paperId => done(paperId, 'yes')} />;
}
