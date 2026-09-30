import { useEffect, useRef, useState } from 'react';
import type { AllocationPreview, AllocationPreviewQuery, Annotation, CostingMethod, LedgerJob, MediaTypeView, PaperView } from 'print-accounting-contracts';
import {
  Button, ButtonLink, DocketSection, Notice, PaperLine, PaperPicker, PaperPurchaseForm, PaperSwatch, RadioList, RadioOption, RowActions, Sub,
} from '../../components/index.ts';
import { useAllocationPreview, useCurrency } from '../../api/queries.ts';
import { dateShort, metres, money, stockQuantity } from '../../lib/format.ts';
import { jobCancelled, jobPaperName, jobSize, jobSwatch } from '../../lib/jobs.ts';
import { rollWidth } from '../../lib/sizes.ts';
import { paperState, papersForMedia, stockChoices, stockWarning, type StockWarning } from './paper.ts';

export type PaperMode = 'view' | 'picker' | 'stock' | 'new';
export type SaveAnnotation = (annotation: Annotation, label: string) => Promise<boolean>;

/** The docket's Paper section (vPaperSection): what the print was allocated to and where it came from, with
 *  "Change stock", "Correct paper" (the picker, and "New paper…" set up with its first stock), "Use the default"
 *  once corrected, and a link to Papers. */
export function PaperSection({ job, papers, mediaTypes, method, mode, setMode, save }: {
  job: LedgerJob; papers: PaperView[]; mediaTypes: MediaTypeView[]; method: CostingMethod;
  mode: PaperMode; setMode: (mode: PaperMode) => void; save: SaveAnnotation;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const paper = papers.find(p => p.id === job.paper.paper_id), own = papersForMedia(job, papers), state = paperState(job, papers);
  const cancelled = jobCancelled(job), unknown = job.paper_micros === null, size = jobSize(job);
  const choices = stockChoices(job, paper);
  useEffect(() => { // Put focus where the keyboard wants it when a picker or the form opens.
    const find = (selector: string) => ref.current?.querySelector<HTMLElement>(selector);
    (mode === 'new' ? find('input[type=text]') : find('[role=radio][aria-checked=true]') ?? find('[role=radio]'))?.focus();
  }, [mode]);

  if (mode === 'new') return (
    <DocketSection label="Paper" lockable>
      <div ref={ref}>
        <Sub className="mb-1">A new paper for this print, set up with its first stock. The printer's name stays on the docket.</Sub>
        <PaperPurchaseForm embedded papers={papers} mediaTypes={mediaTypes} submitLabel="Assign to print"
          initial={{ paperId: 'new', stockId: 'new', date: job.date, size, media: job.source_media_id ?? undefined }}
          onSaved={async ({ paperId }) => {
            // The paper is set up; if assigning it fails, the form keeps it and "Assign to print" tries this step again.
            if (!await save({ paper_id: paperId }, 'Paper assigned')) throw new Error('The paper is set up, but not assigned to this print yet. Try again.');
            setMode('view');
          }}
          onCancel={() => setMode('view')} />
      </div>
    </DocketSection>
  );

  const title = cancelled ? `${jobPaperName(job)} · no sheet used`
    : unknown && !job.paper.stock_id ? (paper ? `${paper.name} · nothing in stock at ${size}` : jobPaperName(job))
    : `${job.paper.stock_name} · ${job.paper.paper_name}`;
  const reported = job.configured_paper_name ?? job.paper_name_at_import ?? job.source_media_id;
  const detail = <>
    {state === 'corrected' && <Sub>Printer reported: <span className="text-muted line-through">{reported}</span></Sub>}
    {state === 'assumed' && <Sub>{own.length} papers print as “{reported}”. Assumed this one; correct it if it was another.</Sub>}
    {cancelled ? <Sub>Cancelled before printing, so nothing came off stock.</Sub>
      : unknown ? <Sub tone="amber">{job.paper.unknown_reason === 'no_paper'
          ? 'No paper prints as this media, so the print has no paper cost. Add the media to a paper under Papers, or correct this print\'s paper.'
          : job.paper.unknown_reason === 'unknown_usage' ? 'The printer didn\'t report how much paper the print used.'
          : `No ${size} sheets or matching roll of ${paper?.name ?? jobPaperName(job)} had been bought by ${dateShort(job.date)}.`} The cost is never guessed.</Sub>
      : mode === 'stock' ? null : <Source job={job} paper={paper} method={method} />}
    {mode === 'stock' && <StockChoice job={job} paper={paper!} papers={papers} choices={choices} save={save} onDone={() => setMode('view')} />}
    {mode === 'view' && (
      <RowActions>
        {choices.length > 1 && !cancelled && job.paper.stock_id && <Button size="sm" edit onClick={() => setMode('stock')}>Change stock</Button>}
        <Button size="sm" edit onClick={() => setMode('picker')}>Correct paper</Button>
        {job.paper.allocation !== 'default' && (
          <Button size="sm" variant="text" edit title="Clear the correction: the print follows the printer's media again"
            onClick={() => void save({ paper_id: null, paper_stock_id: null }, 'Using the default')}>Use the default</Button>
        )}
        {paper ? <ButtonLink variant="text" size="sm" to="/papers/$paperId" params={{ paperId: String(paper.id) }}>Open in Papers</ButtonLink>
          : <ButtonLink variant="text" size="sm" to="/papers">Open Papers</ButtonLink>}
      </RowActions>
    )}
  </>;
  return (
    <DocketSection label="Paper" lockable>
      <div ref={ref}>
        <PaperLine swatch="big" name={title} detail={detail} {...jobSwatch(job)} none={!paper} />
        {mode === 'picker' && <Picker job={job} papers={papers} own={own} save={save} onNew={() => setMode('new')} onDone={() => setMode('view')} />}
      </div>
    </DocketSection>
  );
}

/** "From the pack bought 10 Jan 2026 (£34.99 for 25) · 6 of 25 left in it.", worded for the costing method. */
function Source({ job, paper, method }: { job: LedgerJob; paper: PaperView | undefined; method: CostingMethod }) {
  const currency = useCurrency();
  const purchase = paper?.purchases.find(p => p.id === job.paper.from[0]?.purchase_id);
  if (!purchase) return null;
  const roll = job.paper.format === 'roll', bought = dateShort(purchase.purchased_on), price = money(purchase.price_micros, currency);
  const from = roll ? `the roll bought ${bought} (${price} for ${metres(purchase.quantity, purchase.quantity % 1e6 ? 1 : 0)})` : `the pack bought ${bought} (${price} for ${purchase.quantity})`;
  const left = roll ? `${metres(purchase.remaining)} left on it` : `${purchase.remaining} of ${purchase.quantity} left in it`;
  return (
    <Sub className="mt-1">{method === 'oldest' ? `From ${from} · ${left}.`
      : `Taken from ${from} · ${left}. ${method === 'average' ? 'Costed at the average price of everything bought' : 'Costed at the most paid for it'} by ${dateShort(job.date)}.`}</Sub>
  );
}

/** Correcting the paper: the picker of every paper, then "New paper…". Choosing the only paper that prints as
 *  the job's media clears the correction instead, so the print follows the printer again. */
function Picker({ job, papers, own, save, onNew, onDone }: {
  job: LedgerJob; papers: PaperView[]; own: PaperView[]; save: SaveAnnotation; onNew: () => void; onDone: () => void;
}) {
  const [pick, setPick] = useState<number | null>(job.paper.paper_id);
  const [saving, setSaving] = useState(false);
  const check = useStockCheck(job, pick && pick !== job.paper.paper_id ? { paper_id: pick } : undefined);
  const submit = async () => {
    setSaving(true);
    const annotation: Annotation = own.length === 1 && own[0].id === pick ? { paper_id: null, paper_stock_id: null } : { paper_id: pick };
    if (await save(annotation, 'Paper corrected')) onDone(); else setSaving(false);
  };
  return (
    <div className="mt-3">
      <PaperPicker papers={papers} value={pick} onChange={setPick} onNew={onNew} />
      {check.preview && <StockCheck key={pick} job={job} papers={papers} preview={check.preview} warning={check.warning} adding={check.adding} setAdding={check.setAdding} />}
      {!check.adding && <RowActions>
        <Button variant="primary" size="sm" edit disabled={!pick || pick === job.paper.paper_id || saving || check.checking} onClick={() => void submit()}>
          {check.warning ? 'Save anyway' : 'Save'}</Button>
        <Button variant="text" size="sm" onClick={onDone}>Cancel</Button>
        <Sub>The printer's name stays on the docket.</Sub>
      </RowActions>}
    </div>
  );
}

/** Choosing the stock item a print came from: sheets of its size, or a roll of its width. */
function StockChoice({ job, paper, papers, choices, save, onDone }: {
  job: LedgerJob; paper: PaperView; papers: PaperView[]; choices: PaperView['stock']; save: SaveAnnotation; onDone: () => void;
}) {
  const [pick, setPick] = useState(job.paper.stock_id);
  const [saving, setSaving] = useState(false);
  const check = useStockCheck(job, pick && pick !== job.paper.stock_id ? { paper_stock_id: pick } : undefined);
  const roll = choices.find(item => item.format === 'roll'), size = jobSize(job);
  const submit = async () => {
    setSaving(true);
    if (await save({ paper_stock_id: pick }, 'Stock changed')) onDone(); else setSaving(false);
  };
  return (
    <div className="mt-2.5">
      <Sub className="mb-1.5">Stock that could have printed {size} by {dateShort(job.date)}{roll && `: ${size} sheets or a ${rollWidth(roll.width_um)} roll`}.</Sub>
      <RadioList label="Stock">
        {choices.map(item => {
          const last = paper.purchases.filter(p => p.paper_stock_id === item.id && p.purchased_on <= job.date).at(-1);
          return (
            <RadioOption key={item.id} checked={item.id === pick} onSelect={() => setPick(item.id)}
              swatch={<PaperSwatch shape={item.format === 'roll' ? 'roll' : 'sheet'} deckle={item.deckle} />}
              detail={`${stockQuantity(item.remaining, item.format)} left${last ? ` · last bought ${dateShort(last.purchased_on)}` : ''}`}>
              {item.name}
            </RadioOption>
          );
        })}
      </RadioList>
      {check.preview && <StockCheck key={pick} job={job} papers={papers} preview={check.preview} warning={check.warning} adding={check.adding} setAdding={check.setAdding} />}
      {!check.adding && <RowActions>
        <Button variant="primary" size="sm" edit disabled={pick === job.paper.stock_id || saving || check.checking} onClick={() => void submit()}>
          {check.warning ? 'Save anyway' : 'Save'}</Button>
        <Button variant="text" size="sm" onClick={onDone}>Cancel</Button>
      </RowActions>}
    </div>
  );
}

/** What the ledger says a correction would take, fetched when one is picked and before it's saved. */
/** While stock is being added, the correction's own Save and Cancel step aside for the purchase form's. */
function useStockCheck(job: LedgerJob, target: AllocationPreviewQuery | undefined) {
  const query = useAllocationPreview(job.job_id, target), preview = target ? query.data : undefined;
  const key = JSON.stringify(target ?? null), [addingFor, setAddingFor] = useState<string | null>(null);
  return { preview, warning: preview ? stockWarning(job, preview) : null, checking: !!target && query.isFetching,
    adding: addingFor === key, setAdding: (on: boolean) => setAddingFor(on ? key : null) };
}

/** The warning under a correction that the stock won't cover, with "Add stock": the shared purchase form, filled in
 *  with the paper, the item at the print's size (or a new one of that size) and the print's day. The purchase is
 *  its own save; the preview then refetches, so the warning clears once there's enough. The correction still
 *  waits for Save (or "Save anyway", leaving the cost unknown or the stock below zero to fix later). */
function StockCheck({ job, papers, preview, warning, adding, setAdding }: {
  job: LedgerJob; papers: PaperView[]; preview: AllocationPreview; warning: StockWarning | null; adding: boolean; setAdding: (on: boolean) => void;
}) {
  const [added, setAdded] = useState(false);
  if (!warning) return added ? <Sub tone="green" className="mt-2.5">Stock added. Save to correct the print.</Sub> : null;
  return (
    <div className="mt-2.5">
      <Notice title={warning.title}>
        {warning.text}
        {!adding && (
          <RowActions className="mt-2">
            <Button size="sm" edit onClick={() => setAdding(true)}>Add stock</Button>
            <Sub>or save anyway and fix it later</Sub>
          </RowActions>
        )}
      </Notice>
      {adding && (
        <div className="mt-3">
          <PaperPurchaseForm embedded papers={papers}
            initial={{ paperId: preview.paper.paper_id ?? undefined, stockId: preview.sized_stock_id ?? 'new', date: job.date, size: jobSize(job) }}
            onSaved={() => { setAdding(false); setAdded(true); }} onCancel={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}
