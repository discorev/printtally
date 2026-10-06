import { useState } from 'react';
import { cartridgeTypes } from 'print-accounting-core/printer-models';
import type { ArchivedPrinter, CartridgeView } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit, useInk, useQueryRecentPrinterJobs } from '../../api/queries.ts';
import { Button, Field, FieldPair, FieldStack, RowActions, Select, StatusLine, Sub } from '../../components/index.ts';
import { dateShort } from '../../lib/format.ts';
import { productName } from './channels.ts';

export type CartridgeUnit = CartridgeView['units'][number];

/** A known model's supported series, a reported series, or an unknown model with no channel reading. */
export function canFit(printer: ArchivedPrinter, cartridge: CartridgeView): boolean {
  const series = productName(cartridge), reading = printer.inks.find(ink => ink.channel === cartridge.channel);
  const known = cartridgeTypes(printer.model, cartridge.channel);
  return known.some(type => type.series === series) || reading?.series === series || (!known.length && !reading);
}

export function CartridgeFittingForm({ cartridge, unit, printers, selectedPrinterId, fittedProductId, onClose }: {
  cartridge: CartridgeView; unit: CartridgeUnit; printers: ArchivedPrinter[]; selectedPrinterId?: number;
  fittedProductId?: number; onClose: () => void;
}) {
  const eligible = printers.filter(printer => canFit(printer, cartridge));
  const preferred = unit.state === 'shelf' ? selectedPrinterId : unit.printer_id;
  const initialPrinterId = eligible.find(printer => printer.id === preferred)?.id
    ?? eligible.find(printer => printer.id === selectedPrinterId)?.id ?? eligible[0]?.id;
  const [printerId, setPrinterId] = useState(initialPrinterId);
  const [from, setFrom] = useState(unit.state === 'shelf' || unit.starts_after_record === null ? 'next' : String(unit.starts_after_record));
  const [replaced, setReplaced] = useState<'shelf' | 'used'>(unit.replaced ?? 'used');
  const recent = useQueryRecentPrinterJobs(printerId);
  // /ink is per printer. The selected printer's fitted channel is already in the docket's read model.
  const otherInk = useInk(printerId, !!printerId && printerId !== selectedPrinterId);
  const fitted = printerId === selectedPrinterId ? fittedProductId !== undefined : !!otherInk.data?.fitted?.[cartridge.channel];
  const choices = recent.data?.jobs ?? [];
  const starts = choices.map(job => job.source_record_id - 1);
  const existing = unit.starts_after_record !== null && from !== 'next' && !starts.includes(Number(from));
  const input = () => ({ printer_id: printerId!, channel: cartridge.channel, ink_purchase_id: unit.purchase_id,
    after_record: from === 'next' ? recent.data!.highest_source_record_id : Number(from), replaced });
  // A returned shelf unit may still carry its earlier correction: fitting it again creates a new event.
  const correction = unit.state !== 'shelf' ? unit.fitting_id : null;
  const save = useEdit(async () => {
    if (correction) await api.inkFitting.update(correction, input());
    else await api.inkFitting.create(input());
  });
  const remove = useEdit(() => api.inkFitting.remove(correction!));
  const pending = save.isPending || remove.isPending;
  return (
    <div className="mt-2 rounded-[3px] border border-rule-2 bg-paper-2 p-3 text-[13px]" role="group" aria-label={unit.state === 'shelf' ? 'Fit in printer' : 'Change cartridge'}>
      <FieldStack>
        {eligible.length ? <>
          <FieldPair>
            <Field label="Printer">{id => <Select id={id} value={printerId} onChange={event => { setPrinterId(Number(event.target.value)); setFrom('next'); }}>
              {eligible.map(printer => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
            </Select>}</Field>
            <Field label="From">{id => <Select id={id} value={from} onChange={event => setFrom(event.target.value)}>
              <option value="next">The next print</option>
              {existing && <option value={from}>Current start</option>}
              {choices.map(job => <option key={job.job_id} value={job.source_record_id - 1}>
                {dateShort(job.date).replace(/ \d{4}$/, '')}, {job.time} · {job.label}
              </option>)}
            </Select>}</Field>
          </FieldPair>
          {fitted && <Field label="The cartridge it replaces">{id => <Select id={id} value={replaced} onChange={event => setReplaced(event.target.value as 'shelf' | 'used')}>
            <option value="shelf">Back on the shelf</option><option value="used">Used up</option>
          </Select>}</Field>}
        </> : <Sub>No compatible printer.</Sub>}
        <div>
          <RowActions className="mt-0">
            <Button variant="primary" size="sm" edit disabled={!printerId || !recent.data || (printerId !== selectedPrinterId && !otherInk.data) || pending}
              onClick={() => save.mutate(undefined, { onSuccess: onClose })}>{save.isPending ? 'Saving…' : unit.state === 'shelf' ? 'Fit' : 'Save'}</Button>
            <Button variant="text" size="sm" onClick={onClose}>Cancel</Button>
            {correction && <Button variant="text" size="sm" edit disabled={pending} onClick={() => remove.mutate(undefined, { onSuccess: onClose })}>Remove correction</Button>}
          </RowActions>
          {save.isError && <StatusLine error>{describeError(save.error)}</StatusLine>}
          {remove.isError && <StatusLine error>{describeError(remove.error)}</StatusLine>}
          {recent.isError && <StatusLine error>{describeError(recent.error)}</StatusLine>}
          {otherInk.isError && <StatusLine error>{describeError(otherInk.error)}</StatusLine>}
        </div>
      </FieldStack>
    </div>
  );
}
