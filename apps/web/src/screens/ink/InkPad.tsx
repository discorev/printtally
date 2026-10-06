import type { ArchivedPrinter, CostTotals, Settings } from 'print-accounting-contracts';
import { cartridgeSize, cartridgeTypes } from 'print-accounting-core/printer-models';
import { ButtonLink, Empty, InkSwatch, LevelBar, ListRow, Loading, Money, Pad, PadBody, PadHead, Select } from '../../components/index.ts';
import { useCanEdit } from '../../connection/index.ts';
import { count, ml, mlValue, plural } from '../../lib/format.ts';
import { productName, type InkChannelView } from './channels.ts';
import { useSelectedInkPrinter } from './useSelectedInkPrinter.ts';

// The cartridges (vInk): one row per channel with its level, spares and the cost of its ink in prints. The head's
// figures are the ledger's ink totals (visible prints, as Jobs counts them), not sums of the rows.
export function InkPad({ channels, settings, totals, selected, error }: {
  channels: InkChannelView[] | undefined; settings: Settings | undefined; totals: CostTotals | undefined; selected?: string; error?: unknown;
}) {
  const canEdit = useCanEdit(), { printers, selected: printer, select } = useSelectedInkPrinter();
  return (
    <Pad label="Ink">
      <PadHead title="Ink"
        after={printers.length > 1 && <Select aria-label="Printer" value={printer?.id ?? ''} onChange={event => select(Number(event.target.value))} className="w-auto! max-w-[260px]">
          {printers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>}
        meta={channels && totals && <><b>{plural(channels.length, 'cartridge')}</b> · <b><Money micros={totals.ink_micros} /></b> of ink in prints at the {settings?.costing_method ?? 'oldest'} price
          {totals.unknown_jobs > 0 && <> · <span className="text-amber">{count(totals.unknown_jobs)} without an ink cost</span></>}
          {' · '}levels are estimates, cleaning isn't logged{totals.waste_micros > 0 && <> · <span className="text-red"><Money micros={totals.waste_micros} /> written off</span></>}</>}
        actions={<ButtonLink to="/ink/new" search={prev => ({ ...prev, form: undefined })} variant="primary" size="sm" disabled={!canEdit}>Add stock</ButtonLink>} />
      <PadBody role="listbox" aria-label="Cartridges">
        {channels?.map(channel => <InkRow key={channel.code} channel={channel} printer={printer} selected={channel.code === selected} />)}
        {!channels && <Loading what="ink" error={error} />}
        {channels?.length === 0 && <Empty>No ink yet. Collect jobs from the printer, or add the cartridges you have bought.</Empty>}
      </PadBody>
    </Pad>
  );
}

const LOW = 0.15; // Under 15% left: the gauge turns amber.
function InkRow({ channel, printer, selected }: { channel: InkChannelView; printer?: ArchivedPrinter; selected: boolean }) {
  const { code, name } = channel;
  const reading = printer?.inks.find(ink => ink.channel === code);
  const matchingProduct = reading?.series ? channel.cartridges.find(item => productName(item) === reading.series) : undefined;
  // The server's fitted product is specific to the selected printer; the reading is only a level/type hint.
  const product = channel.fitted ? channel.product : reading?.series ? matchingProduct : channel.product;
  const left = product?.open_remaining_nl ?? 0, fitted = product?.open_remaining_nl != null;
  const compatible = cartridgeTypes(printer?.model, code).map(type => type.series);
  const spares = reading ? channel.cartridges.filter(item => compatible.length
    ? compatible.includes(productName(item)) : productName(item) === reading.series).reduce((total, item) => total + item.spares, 0) : channel.spares;
  const shownSeries = fitted && product ? productName(product) : reading?.series;
  const size = fitted && product ? product.capacity_nl / 1e6 : reading?.series ? cartridgeSize(reading.series)
    ?? ((matchingProduct?.capacity_nl ?? 0) / 1e6) : null;
  return (
    <ListRow to={selected ? '/ink' : '/ink/$channel'} params={selected ? undefined : { channel: code }} search={prev => ({ ...prev, form: undefined })} selected={selected}
      className="grid-cols-[22px_44px_minmax(120px,1fr)_220px_120px_120px] gap-x-3 py-[9px] @max-[840px]:grid-cols-[22px_44px_minmax(100px,1fr)_200px_110px] phone:grid-cols-[22px_44px_1fr_104px]!">
      <InkSwatch channel={code} size="lg" />
      <span className="font-slab text-[14px] leading-5 font-semibold">{code}</span>
      <span className="min-w-0 truncate text-muted">{name}{shownSeries && <small className="block text-[12px] text-muted">{shownSeries}{size ? ` · ${size} ml` : ''}</small>}</span>
      <span className="flex flex-col gap-1 text-[13px]">
        {reading?.series && !matchingProduct && !fitted
          ? <><span className="text-muted">{reading.series} not set up</span>{reading.level != null && <LevelBar value={0} tick={reading.level} />}</>
          : product
            ? <><span>{fitted ? <><b className="font-medium">~{ml(left, 1)}</b><span className="phone:hidden"> of {mlValue(product.capacity_nl, 0)}</span></> : <b className="font-medium">None</b>}
                <span className="phone:hidden"> in the printer</span></span>
                <LevelBar value={left / product.capacity_nl} low={left / product.capacity_nl < LOW} tick={reading?.level ?? undefined} /></>
            : <><span className="text-muted">No cartridge set up</span>{reading?.level != null && <LevelBar value={0} tick={reading.level} />}</>}
        <small className="text-[12px] text-muted">{reading?.level != null && <span className={reading.level <= 10 ? 'text-amber' : undefined}>Printer level {reading.level}% · </span>}{spares ? plural(spares, 'spare') : 'no spare'}</small>
      </span>
      <span className="text-right text-[13px] whitespace-nowrap text-muted @max-[840px]:hidden phone:hidden">
        <b className="block font-medium text-ink">{ml(channel.used)}</b>used by prints</span>
      <span className="text-right font-medium whitespace-nowrap phone:hidden">
        <Money micros={channel.usedMicros} /><small className="block text-[11.5px] leading-[13px] font-normal text-muted">in prints</small>
        {channel.wasteMicros > 0 && <small className="block text-[11.5px] leading-[13px] font-normal text-red"><Money micros={channel.wasteMicros} /> waste</small>}
      </span>
    </ListRow>
  );
}
