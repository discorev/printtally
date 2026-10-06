import { useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Settings } from 'print-accounting-contracts';
import {
  Button, Docket, DocketHead, DocketSection, ItemLine, LedgerList, Money, RowActions, SavedNotice, Sub, SummaryLine, WriteOffLine,
} from '../../components/index.ts';
import { useCurrency } from '../../api/queries.ts';
import { api } from '../../api/endpoints.ts';
import { dateShort, ml, mlValue, money, plural, today } from '../../lib/format.ts';
import { fittedPurchase, productName, spareCount, type InkChannelView } from './channels.ts';
import { CartridgeUnits } from './CartridgeUnits.tsx';
import { InkPurchaseForm, useShowAdded } from './InkPurchaseForm.tsx';
import { InkWriteOffForm } from './InkWriteOffForm.tsx';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';

// A cartridge's docket (vInkDocket): what's in the printer, what prints used, purchases and write-offs.
// `form` (from the URL) swaps the sections for the Add stock or Write off form, or its confirmation.
export type CartridgeForm = 'purchase' | 'writeoff' | 'added' | 'written-off';

export function CartridgeDocket({ channel, channels, settings, form }: {
  channel: InkChannelView; channels: InkChannelView[]; settings: Settings | undefined; form?: CartridgeForm;
}) {
  const navigate = useNavigate(), currency = useCurrency(), showAdded = useShowAdded();
  const { selected, printers } = useSelectedInkPrinter();
  const { printer } = useSearch({ from: '/_app/ink' }), close = { to: { to: '/ink', search: { printer } }, label: 'Ink' } as const;
  const show = (next?: CartridgeForm) => void navigate({ to: '/ink/$channel', params: { channel: channel.code }, search: { printer, form: next } });
  // Escape leaves a form before it closes the docket (the Docket's own handler checks defaultPrevented).
  useEffect(() => {
    if (!form) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName)) return;
      event.preventDefault();
      show();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  const product = channel.cartridges.find(item => item.id === channel.fittedProductId) ?? channel.product;
  const bought = fittedPurchase(channel), fitted = channel.fittedProductId !== undefined;
  const left = fitted ? Math.max(0, channel.fittedRemainingNl ?? 0) : 0;
  const reportsSwaps = selected?.inks.some(ink => ink.channel === channel.code && (ink.first_observed_at ?? ink.observed_at).slice(0, 10) <= today());
  const count = spareCount(channel, selected), spares = count ? `${plural(count, 'spare cartridge')} on the shelf.` : 'No spare on the shelf.';
  const reading = selected?.inks.find(ink => ink.channel === channel.code);
  return (
    <Docket label="Cartridge" close={close}>
      <DocketHead when="Cartridge" title={<>{channel.code} · {channel.name}</>}
        subtitle={product ? `${productName(product)} · ${mlValue(product.capacity_nl, 0)} ml` : 'No cartridge set up yet'} />
      {form === 'purchase' ? <InkPurchaseForm channels={channels} initial={channel.code} onSaved={showAdded} onCancel={() => show()} />
        : form === 'writeoff' ? <InkWriteOffForm channel={channel} onSaved={() => show('written-off')} onCancel={() => show()} />
        : form === 'added' ? <SavedNotice label="Stock" onDone={() => show()}>Added.</SavedNotice>
        : form === 'written-off' ? <SavedNotice label="Write-off" onDone={() => show()}>Saved. It shows as waste in totals.</SavedNotice>
        : <>
          <DocketSection label={printers.length > 1 ? `In ${selected?.name ?? 'the printer'}` : 'In the printer'} lockable>
            {fitted
              ? <ItemLine name={bought ? `Bought ${dateShort(bought.purchased_on)}` : 'Fitted'}
                  sub={bought && <>{money(Math.round(bought.price_micros / bought.cartridges), currency)} · {money(Math.round(bought.price_micros / (bought.cartridges * product!.capacity_nl / 1e6)), currency)} per ml</>}
                  value={<b className="font-medium">~{ml(left, 1)}</b>} caption="about left" />
              : <Sub>None fitted.</Sub>}
            {reading?.level != null && <Sub>Printer level {reading.level}%</Sub>}
            <Sub className="mt-1.5">A rough guide: the printer's job log doesn't count ink used for cleaning, so the real level is lower. {spares}</Sub>
            <RowActions>
              <Button variant="primary" size="sm" edit onClick={() => show('purchase')}>Add stock</Button>
              <Button size="sm" edit disabled={!product || (reportsSwaps ? product.remaining <= 0 : !fitted || left <= 0)} onClick={() => show('writeoff')}>Write off</Button>
            </RowActions>
          </DocketSection>
          <DocketSection label="Used by prints">
            <SummaryLine what={`${ml(channel.used)} across ${plural(channel.jobs, 'print')}`} sub={`at the ${settings?.costing_method ?? 'oldest'} price`}
              amount={<Money micros={channel.usedMicros} />} />
          </DocketSection>
          <DocketSection label="Cartridges">
            <CartridgeUnits channel={channel} printers={printers} selectedPrinterId={selected?.id} />
          </DocketSection>
          <DocketSection label="Written off">
            <LedgerList empty="Nothing written off.">{channel.writeOffs.map(writeOff =>
              <WriteOffLine key={writeOff.id} writeOff={writeOff} ink onRemove={() => api.writeOff.remove(writeOff.id)} />)}</LedgerList>
          </DocketSection>
        </>}
    </Docket>
  );
}
