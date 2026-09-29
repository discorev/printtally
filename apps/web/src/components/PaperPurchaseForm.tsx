import { useEffect, useState } from 'react';
import type { MediaTypeView, PaperView } from 'print-accounting-contracts';
import { api } from '../api/endpoints.ts';
import { describeError } from '../api/client.ts';
import { useEdit } from '../api/queries.ts';
import { parseMoney, today } from '../lib/format.ts';
import { ROLL_WIDTHS_IN, SIZE_GROUPS } from '../lib/sizes.ts';
import { Button } from './Button.tsx';
import { DateInput, Field, FieldPair, FieldStack, MoneyInput, NumberInput, Select, TextInput, Toggle } from './Field.tsx';
import { DocketSection, RowActions, StatusLine } from './Docket.tsx';
import { PaperSelect, type PaperChoice } from './PaperPicker.tsx';

export interface PaperPurchaseSaved { paperId: number; stockId: number; purchaseId: number; date: string }
export interface PaperPurchaseInitial {
  paperId?: number | 'new'; stockId?: number | 'new'; date?: string;
  size?: string; name?: string; media?: string; // For a new paper: its size, name and printer media (source_media_id).
}
const SIZES = SIZE_GROUPS.flatMap(([, list]) => list);

/**
 * Adding stock: a pack of sheets or a roll you bought, for an existing paper and size, or setting up a new
 * size or a whole new paper with it (vPurchaseForm). Used from the Papers docket, "Add stock", and a job's
 * "New paper…" (with `embedded`: no paper choice and no section of its own). Creates what's new, then the
 * purchase; `onSaved` gets the ids only once the server confirmed every step.
 */
/** What the form is setting up so far, for a docket head that follows it ("New paper", "Prints as …"). */
export interface PaperPurchaseDraft { paper: PaperChoice; name: string; media: string }
export function PaperPurchaseForm({ papers, mediaTypes = [], initial = {}, embedded, submitLabel = 'Add stock', onSaved, onCancel, onDraft }: {
  papers: PaperView[]; mediaTypes?: MediaTypeView[]; initial?: PaperPurchaseInitial; embedded?: boolean; submitLabel?: string;
  onSaved: (saved: PaperPurchaseSaved) => void; onCancel: () => void; onDraft?: (draft: PaperPurchaseDraft) => void;
}) {
  const firstStock = (paperId: PaperChoice): number | 'new' => papers.find(p => p.id === paperId)?.stock[0]?.id ?? 'new';
  const [paper, setPaper] = useState<PaperChoice>(initial.paperId ?? null);
  const [stock, setStock] = useState<number | 'new'>(initial.stockId ?? firstStock(initial.paperId ?? null));
  const [name, setName] = useState(initial.name ?? '');
  const [media, setMedia] = useState(initial.media ?? '');
  const [kind, setKind] = useState<'sheet' | 'roll'>('sheet');
  const [size, setSize] = useState(initial.size && SIZES.some(s => s.name === initial.size) ? initial.size : 'A4');
  const [deckle, setDeckle] = useState(false);
  const [width, setWidth] = useState(ROLL_WIDTHS_IN[0]);
  const [date, setDate] = useState(initial.date ?? today());
  const [packs, setPacks] = useState('1');
  const [perPack, setPerPack] = useState('25');
  const [length, setLength] = useState('12');
  const [price, setPrice] = useState('');
  useEffect(() => onDraft?.({ paper, name, media }), [onDraft, paper, name, media]);

  const isNew = paper === 'new', chosen = typeof paper === 'number' ? papers.find(p => p.id === paper) : undefined;
  const newItem = isNew || stock === 'new';
  const roll = newItem ? kind === 'roll' : chosen?.stock.find(s => s.id === stock)?.format === 'roll';
  const priceMicros = parseMoney(price), whole = (text: string) => /^\d+$/.test(text) && Number(text) > 0;
  const lengthUm = Math.round(Number(length) * 1e6);
  const ready = (isNew ? name.trim() !== '' : !!chosen) && priceMicros !== null && /^\d{4}-\d\d-\d\d$/.test(date)
    && (roll ? lengthUm > 0 : whole(packs) && whole(perPack));

  const save = useEdit(async (): Promise<PaperPurchaseSaved> => {
    const paperId = isNew ? (await api.paper.create({ name: name.trim(), media_types: media ? [media] : [] })).id : chosen!.id;
    const sheet = SIZES.find(s => s.name === size)!;
    const stockId = !newItem ? stock as number : (await api.stock.create(kind === 'roll'
      ? { paper_id: paperId, format: 'roll', name: `${width}" roll`, width_um: width * 25_400 }
      : { paper_id: paperId, format: 'sheet', name: size + (deckle ? ' deckle' : ''), width_um: Math.round(sheet.widthMm * 1000), height_um: Math.round(sheet.heightMm * 1000), deckle })).id;
    const { id } = await api.paperPurchase.create(roll
      ? { paper_stock_id: stockId, purchased_on: date, length_um: lengthUm, price_micros: priceMicros! }
      : { paper_stock_id: stockId, purchased_on: date, packs: Number(packs), sheets_per_pack: Number(perPack), price_micros: priceMicros! });
    return { paperId, stockId, purchaseId: id, date };
  });

  const fields = (
    <FieldStack>
      {!embedded && (
        <Field label="Paper">{id => (
          <PaperSelect id={id} papers={papers} value={paper} placeholder="Choose a paper" allowNew
            onChange={value => { setPaper(value); setStock(firstStock(value)); }} />
        )}</Field>
      )}
      {isNew && <>
        <Field label="Paper name">{id => <TextInput id={id} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hahnemühle Museum Etching" />}</Field>
        <Field label="Prints as" hint="Media types as the printer reports them. Several papers can share one, for instance a test pack printed with a stock profile.">{id => (
          <Select id={id} value={media} onChange={e => setMedia(e.target.value)}>
            <option value="">Not linked to printer media yet</option>
            {mediaTypes.map(m => <option key={m.source_media_id} value={m.source_media_id}>
              {m.name ?? m.source_media_id}{m.papers.length ? ` · also ${m.papers.map(p => p.name).join(', ')}` : ''}</option>)}
          </Select>
        )}</Field>
      </>}
      {paper !== null && !isNew && (
        <Field label="Size or roll">{id => (
          <Select id={id} value={String(stock)} onChange={e => setStock(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
            {chosen?.stock.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="new">New size or roll…</option>
          </Select>
        )}</Field>
      )}
      {paper !== null && newItem && (
        <FieldPair>
          <Field label="Kind">{id => (
            <Select id={id} value={kind} onChange={e => setKind(e.target.value as 'sheet' | 'roll')}><option value="sheet">Sheets</option><option value="roll">Roll</option></Select>
          )}</Field>
          {kind === 'sheet'
            ? <Field label="Size">{id => <>
                <Select id={id} value={size} onChange={e => setSize(e.target.value)}>
                  {SIZE_GROUPS.map(([group, list]) => <optgroup key={group} label={group}>
                    {list.map(s => <option key={s.name} value={s.name}>{s.name} · {s.widthMm} × {s.heightMm} mm</option>)}</optgroup>)}
                </Select>
                <Toggle label="Deckle edge" checked={deckle} onChange={e => setDeckle(e.target.checked)} className="mt-1" />
              </>}</Field>
            : <Field label="Width">{id => (
                <Select id={id} value={width} onChange={e => setWidth(Number(e.target.value))}>{ROLL_WIDTHS_IN.map(w => <option key={w} value={w}>{w}"</option>)}</Select>
              )}</Field>}
        </FieldPair>
      )}
      {paper !== null && <>
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          {roll
            ? <Field label="Length (m)">{id => <NumberInput id={id} min={1} step="any" value={length} onChange={e => setLength(e.target.value)} />}</Field>
            : <Field label="Quantity" htmlFor="purchase-packs">
                <div className="flex items-center gap-1.5">
                  <NumberInput id="purchase-packs" aria-label="Packs" min={1} value={packs} onChange={e => setPacks(e.target.value)} className="min-w-0 max-w-16 flex-1" />
                  <span className="text-muted">×</span>
                  <NumberInput aria-label="Sheets per pack" min={1} value={perPack} onChange={e => setPerPack(e.target.value)} className="min-w-0 max-w-[72px] flex-1" />
                  <span className="text-muted">sheets</span>
                </div>
              </Field>}
        </FieldPair>
        <Field label="Price paid" className="max-w-[180px]">{id => <MoneyInput id={id} value={price} onChange={e => setPrice(e.target.value)} />}</Field>
      </>}
      <div>
        <RowActions className="mt-0">
          <Button variant="primary" edit disabled={!ready || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>
            {save.isPending ? 'Saving…' : submitLabel}</Button>
          <Button variant="text" onClick={onCancel}>Cancel</Button>
        </RowActions>
        {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
      </div>
    </FieldStack>
  );
  return embedded ? fields : <DocketSection label="Add stock">{fields}</DocketSection>;
}
