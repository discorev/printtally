import { useState } from 'react';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useWriteOffPreview } from '../../api/queries.ts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, NumberInput, RowActions, StatusLine, Sub, TextInput } from '../../components/index.ts';
import { ml, today } from '../../lib/format.ts';
import { productName, type InkChannelView } from './channels.ts';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';

/** A printer that reports swaps already accounts for a changed cartridge's remainder as waste.
 * Earlier dates and printers without readings can still write off an entire fitted cartridge. */
export function InkWriteOffForm({ channel, onSaved, onCancel }: { channel: InkChannelView; onSaved: () => void; onCancel: () => void }) {
  const { selected } = useSelectedInkPrinter();
  const printer_id = selected?.id;
  const [date, setDate] = useState(today());
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const reading = selected?.inks.find(ink => ink.channel === channel.code);
  const reportsSwaps = !!reading && (reading.first_observed_at ?? reading.observed_at).slice(0, 10) <= date;
  const product = reportsSwaps && reading.series
    ? channel.cartridges.find(item => productName(item) === reading.series) ?? channel.product : channel.product;
  const preview = useWriteOffPreview(!reportsSwaps && channel.fitted && product ? { ink_product_id: product.id, printer_id } : undefined, date).data;
  const left = preview?.written_off ?? 0;
  const units = Math.round(Number(quantity) * 1e6);
  const ready = !!product && /^\d{4}-\d\d-\d\d$/.test(date) && (reportsSwaps
    ? Number.isSafeInteger(units) && units > 0 : channel.fitted && left > 0);
  const save = useEdit(() => api.writeOff.create({
    ink_product_id: product!.id, written_off_on: date, reason: reason.trim() || null,
    ...reportsSwaps ? { quantity: units } : { printer_id, all_remaining: true },
  }));
  return (
    <DocketSection label="Write off">
      <FieldStack>
        {reportsSwaps ? <Sub>Cartridge changes are already counted as waste from this printer's readings. Write off a measured quantity instead.</Sub>
          : <Sub className="[&_b]:font-medium [&_b]:text-ink">Writes off the <b>~{preview ? ml(left, 1) : '…'}</b> the ledger thinks is left in the {channel.code} cartridge
            in use — for a cartridge changed early. Cleaning isn't logged, so this is an estimate.</Sub>}
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label="Reason" optional>{id => <TextInput id={id} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />}</Field>
        </FieldPair>
        {reportsSwaps && <Field label="Quantity (ml)" className="max-w-40">{id =>
          <NumberInput id={id} min={0.001} step="any" value={quantity} onChange={e => setQuantity(e.target.value)} />}</Field>}
        <div>
          <RowActions className="mt-0">
            <Button variant="primary" edit disabled={!ready || save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>{save.isPending ? 'Saving…' : 'Save write-off'}</Button>
            <Button variant="text" onClick={onCancel}>Cancel</Button>
          </RowActions>
          {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
        </div>
      </FieldStack>
    </DocketSection>
  );
}
