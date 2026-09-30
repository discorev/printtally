import { useState } from 'react';
import type { PaperView } from 'print-accounting-contracts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, NumberInput, PaperSelect, RowActions, Select, StatusLine, TextInput, Toggle } from '../../components/index.ts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useWriteOffPreview } from '../../api/queries.ts';
import { stockAmount, today } from '../../lib/format.ts';

// Writing off paper that's gone without being printed (vWriteoffForm): some sheets or metres, or what's left
// of the open pack or roll. It shows as waste in totals, never inside a print's cost. What "everything left"
// takes on the chosen date comes from the ledger (the write-off preview), never worked out here.

export function WriteOffForm({ papers, paperId, onSaved, onCancel }: {
  papers: PaperView[]; paperId: number; onSaved: (paperId: number) => void; onCancel: () => void;
}) {
  const [paper, setPaper] = useState(paperId);
  const chosen = papers.find(p => p.id === paper);
  const [stockId, setStockId] = useState(chosen?.stock[0]?.id);
  const [date, setDate] = useState(today());
  const [how, setHow] = useState<'some' | 'all'>('some');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const stock = chosen?.stock.find(s => s.id === stockId), roll = stock?.format === 'roll';
  const amount = Number(quantity), units = roll ? Math.round(amount * 1e6) : amount;
  const preview = useWriteOffPreview(stock && { paper_stock_id: stock.id }, date).data, left = preview?.written_off ?? 0;
  const ready = !!stock && /^\d{4}-\d\d-\d\d$/.test(date) && (how === 'all' ? left > 0 : Number.isFinite(units) && units > 0 && (roll || Number.isInteger(amount)));

  const save = useEdit(() => api.writeOff.create({
    paper_stock_id: stock!.id, written_off_on: date, reason: reason.trim() || null,
    ...how === 'all' ? { all_remaining: true } : { quantity: units },
  }));
  return (
    <DocketSection label="Write off">
      <FieldStack>
        <Field label="Paper">{id => (
          <PaperSelect id={id} papers={papers} value={paper} onChange={value => {
            if (typeof value !== 'number') return;
            setPaper(value); setStockId(papers.find(p => p.id === value)?.stock[0]?.id);
          }} />
        )}</Field>
        <Field label="Size or roll">{id => (
          <Select id={id} value={stockId ?? ''} onChange={e => setStockId(Number(e.target.value))} disabled={!chosen?.stock.length}>
            {!chosen?.stock.length && <option value="">Nothing bought yet</option>}
            {chosen?.stock.map(s => <option key={s.id} value={s.id}>{s.name} · {stockAmount(s.remaining, s.format)}{s.format === 'roll' ? '' : ' sheets'} left</option>)}
          </Select>
        )}</Field>
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label="How much" htmlFor="writeoff-some">
            <Toggle type="radio" id="writeoff-some" name="writeoff-how" checked={how === 'some'} onChange={() => setHow('some')} label={roll ? 'Some of the roll' : 'Some sheets'} />
            <Toggle type="radio" name="writeoff-how" className="whitespace-normal" checked={how === 'all'} onChange={() => setHow('all')}
              label={stock && preview && left === preview.remaining ? `Everything left (${stockAmount(left, stock.format)})`
                : `The rest of the open ${roll ? 'roll' : 'pack'}${stock && preview ? ` (${stockAmount(left, stock.format)})` : ''}`} />
          </Field>
        </FieldPair>
        {how === 'some' && (
          <Field label={roll ? 'Metres' : 'Sheets'} className="max-w-40">{id => (
            <NumberInput id={id} min={roll ? 0.1 : 1} step={roll ? 'any' : 1} value={quantity} onChange={e => setQuantity(e.target.value)} />
          )}</Field>
        )}
        <Field label="Reason" optional>{id => <TextInput id={id} value={reason} onChange={e => setReason(e.target.value)} placeholder="Damp, creased, lost…" />}</Field>
        <div>
          <RowActions className="mt-0">
            <Button variant="primary" edit disabled={!ready || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => onSaved(paper) })}>
              {save.isPending ? 'Saving…' : 'Save write-off'}</Button>
            <Button variant="text" onClick={onCancel}>Cancel</Button>
          </RowActions>
          {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
        </div>
      </FieldStack>
    </DocketSection>
  );
}
