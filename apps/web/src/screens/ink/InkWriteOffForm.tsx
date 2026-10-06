import { useState } from 'react';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useWriteOffPreview } from '../../api/queries.ts';
import { Button, DateInput, DocketSection, Field, FieldPair, FieldStack, RowActions, StatusLine, Sub, TextInput } from '../../components/index.ts';
import { ml, today } from '../../lib/format.ts';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';
import type { InkChannelView } from './channels.ts';

/** Writing off a cartridge changed early: all the ledger thinks is left in the one in the printer on the chosen
 *  day (the ledger's write-off preview). */
export function InkWriteOffForm({ channel, onSaved, onCancel }: { channel: InkChannelView; onSaved: () => void; onCancel: () => void }) {
  const { selected } = useSelectedInkPrinter();
  const printer_id = selected?.id;
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const fitted = channel.fitted ? channel.product : undefined;
  const preview = useWriteOffPreview(fitted && { ink_product_id: fitted.id, printer_id }, date).data, left = preview?.written_off ?? 0;
  const save = useEdit(() => api.writeOff.create({ ink_product_id: fitted!.id, printer_id, written_off_on: date, all_remaining: true, reason: reason.trim() || null }));
  return (
    <DocketSection label="Write off">
      <FieldStack>
        <Sub className="[&_b]:font-medium [&_b]:text-ink">Writes off the <b>~{preview ? ml(left, 1) : '…'}</b> the ledger thinks is left in the {channel.code} cartridge
          in use — for a cartridge changed early. Cleaning isn't logged, so this is an estimate.</Sub>
        <FieldPair>
          <Field label="Date">{id => <DateInput id={id} value={date} onChange={e => setDate(e.target.value)} />}</Field>
          <Field label="Reason" optional>{id => <TextInput id={id} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} />}</Field>
        </FieldPair>
        <div>
          <RowActions className="mt-0">
            <Button variant="primary" edit disabled={!fitted || left <= 0 || !/^\d{4}-\d\d-\d\d$/.test(date) || save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: onSaved })}>{save.isPending ? 'Saving…' : 'Save write-off'}</Button>
            <Button variant="text" onClick={onCancel}>Cancel</Button>
          </RowActions>
          {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
        </div>
      </FieldStack>
    </DocketSection>
  );
}
