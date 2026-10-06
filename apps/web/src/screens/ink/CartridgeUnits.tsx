import { useRef, useState } from 'react';
import type { ArchivedPrinter, CartridgeView } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { Button, LedgerList, PurchaseLine } from '../../components/index.ts';
import { dateShort, ml, mlValue } from '../../lib/format.ts';
import { productName, type InkChannelView } from './channels.ts';
import { CartridgeFittingForm, type CartridgeUnit } from './CartridgeFittingForm.tsx';

function UnitLine({ unit, cartridge, printers, selectedPrinterId, fittedPurchaseId, fittedIndex }: {
  unit: CartridgeUnit; cartridge: CartridgeView; printers: ArchivedPrinter[]; selectedPrinterId?: number; fittedPurchaseId?: number; fittedIndex?: number;
}) {
  const [editing, setEditing] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => {
      const button = row.current?.querySelector<HTMLButtonElement>('button');
      (button ?? row.current)?.focus();
    });
  };
  const printer = printers.find(item => item.id === unit.printer_id)?.name ?? 'the printer';
  const place = unit.state === 'shelf' ? <>On the shelf{unit.remaining_nl > 0 && unit.remaining_nl < cartridge.capacity_nl && <> · ~{ml(unit.remaining_nl, 1)} left</>}</>
    : unit.state === 'fitted' ? <>In {printer} {unit.started_on ? `since ${dateShort(unit.started_on)}` : 'from the next print'}{unit.printed_nl > 0 && <> · {ml(unit.printed_nl, 1)} printed</>}</>
    : <>Used up{unit.printer_id && ` in ${printer}`}{unit.started_on && <> · {unit.ended_on ? <>{dateShort(unit.started_on)} – {dateShort(unit.ended_on)}</> : `since ${dateShort(unit.started_on)}`}</>}{unit.printed_nl > 0 && <> · {ml(unit.printed_nl, 1)} printed</>}{unit.waste_nl > 0 && <>{unit.printed_nl > 0 ? ', ' : ' · '}{ml(unit.waste_nl, 1)} waste</>}</>;
  return <div ref={row} tabIndex={-1} className="border-t border-rule py-1.5 first:border-t-0">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 text-[12.5px] leading-[19px]">
      <span className="min-w-0"><span className="text-ink">{place}</span>{unit.fitting_id && <> <span className="ml-1 text-[11px] text-muted">set by you</span></>}</span>
      <Button variant="text" size="sm" edit className="-mr-2 justify-self-end" onClick={() => editing ? close() : setEditing(true)}>{unit.state === 'shelf' ? 'Fit in printer' : 'Change'}</Button>
    </div>
    {editing && <CartridgeFittingForm key={`${unit.purchase_id}:${unit.index}`} cartridge={cartridge} unit={unit} printers={printers}
      selectedPrinterId={selectedPrinterId} fittedPurchaseId={fittedPurchaseId} fittedIndex={fittedIndex} onClose={close} />}
  </div>;
}

/** Products and their purchases; a purchase's individual cartridges each have a place and an action. */
export function CartridgeUnits({ channel, printers, selectedPrinterId }: { channel: InkChannelView; printers: ArchivedPrinter[]; selectedPrinterId?: number }) {
  const grouped = channel.cartridges.map(cartridge => ({ cartridge,
    purchases: channel.purchases.filter(({ purchase }) => purchase.ink_product_id === cartridge.id) }));
  return <LedgerList empty="No purchases yet.">{grouped.flatMap(({ cartridge, purchases }) => purchases.map(({ purchase }) =>
    <div key={purchase.id}>
      {channel.cartridges.length > 1 && purchases[0].purchase.id === purchase.id && <h3 className="mt-3 mb-1 font-slab text-[12px] font-semibold text-muted">{productName(cartridge)} · {mlValue(cartridge.capacity_nl, 0)} ml</h3>}
      <PurchaseLine ink={purchase} capacityNl={cartridge.capacity_nl} onRemove={() => api.inkPurchase.remove(purchase.id)} />
      <div className="mb-2 ml-3 border-l border-rule-2 pl-3">
        {cartridge.units.filter(unit => unit.purchase_id === purchase.id).map(unit => <UnitLine key={unit.index} unit={unit} cartridge={cartridge}
          printers={printers} selectedPrinterId={selectedPrinterId} fittedPurchaseId={channel.fittedPurchaseId} fittedIndex={channel.fittedIndex} />)}
      </div>
    </div>))}</LedgerList>;
}
