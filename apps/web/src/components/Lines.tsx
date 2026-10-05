import { useState, type ReactNode } from 'react';
import type { InkPurchaseView, LedgerJob, PaperPurchaseView, StockView, WriteOffView } from 'print-accounting-contracts';
import { cx } from '../lib/cx.ts';
import { dateShort, metres, ml, money, plural, stockAmount, stockQuantity } from '../lib/format.ts';
import { jobPaperName, jobSize, jobSwatch } from '../lib/jobs.ts';
import { useCurrency, useEdit } from '../api/queries.ts';
import { ApiError, describeError } from '../api/client.ts';
import { Button } from './Button.tsx';
import { PaperSwatch, type PaperSwatchProps } from './Swatches.tsx';

/** An amount in the ledger's currency; null (unknown) shows as "—". */
export function Money({ micros, className }: { micros: number | null; className?: string }) {
  const currency = useCurrency();
  return <span className={className}>{money(micros, currency)}</span>;
}

/** Swatch plus "A4 · Fotospeed Platinum Etching 310". With swatch 'big' the text is the docket's slab title
 *  and `detail` goes beneath it (the docket's paper section); 'sm' is a single inline line. */
export function PaperLine({ size, name, swatch = 'sm', detail, className, ...swatchProps }: Omit<PaperSwatchProps, 'size'> & {
  size?: string; name: ReactNode; swatch?: 'sm' | 'big' | false; detail?: ReactNode;
}) {
  const text = <>{size && <>{size} · </>}{name}</>;
  if (swatch === 'big') return (
    <div className={cx('flex items-start gap-3', className)}>
      <PaperSwatch size="big" {...swatchProps} />
      <div className="min-w-0 flex-1"><div className="font-slab text-[15px] leading-5 font-medium">{text}</div>{detail}</div>
    </div>
  );
  return <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>{swatch && <PaperSwatch {...swatchProps} />}<span className="truncate">{text}</span>{detail}</span>;
}
/** PaperLine for a costed job: its size, the paper it was allocated to (or the printer's name), and its swatch. */
export const JobPaperLine = ({ job, swatch, detail, className }: { job: LedgerJob; swatch?: 'sm' | 'big' | false; detail?: ReactNode; className?: string }) =>
  <PaperLine size={jobSize(job)} name={jobPaperName(job)} swatch={swatch} detail={detail} className={className} {...jobSwatch(job)} />;

const low = (stock: Pick<StockView, 'format' | 'remaining'>) => stock.format === 'roll' ? stock.remaining < 1_000_000 : stock.remaining < 5;
/** "A4 · 31 sheets left" or '17" roll · 10.5 m left'; the figure turns amber when stock is low (under 5 sheets or 1 m). */
export function StockLine({ stock, className }: { stock: Pick<StockView, 'name' | 'format' | 'remaining'>; className?: string }) {
  return (
    <span className={cx('whitespace-nowrap', className)}>{stock.name} · <b className={cx('font-medium', low(stock) ? 'text-amber' : 'text-ink')}>
      {stockAmount(stock.remaining, stock.format, 1)}</b> {stock.format === 'roll' ? 'left' : 'sheets left'}</span>
  );
}

/** A two-column ruled line: name (with a muted note after it) and a sub line on the
 *  left, a figure (with a small caption under it) or an action on the right. "In stock", "In the printer", "Prints as". */
export function ItemLine({ name, note, sub, value, caption, className }: { name: ReactNode; note?: ReactNode; sub?: ReactNode; value?: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-rule py-2 first:border-t-0', className)}>
      <span className="min-w-0"><span className="font-medium">{name}</span>{note && <small className="ml-1.5 text-[12px] font-normal whitespace-nowrap text-muted">{note}</small>}
        {sub && <div className="text-[13px] leading-[18px] text-muted">{sub}</div>}</span>
      <span className="text-right whitespace-nowrap">{value}{caption && <small className="block text-[12px] text-muted">{caption}</small>}</span>
    </div>
  );
}

/** A costing line: what, a sub line, and the amount. `total` draws the double rule. */
export function SummaryLine({ what, sub, amount, total, muted, className }: { what: ReactNode; sub?: ReactNode; amount: ReactNode; total?: boolean; muted?: boolean; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[1fr_84px] items-baseline gap-x-3 gap-y-0.5 py-1.5 [&+&]:border-t [&+&]:border-rule',
      total && 'total-rule mt-1 pt-2', className)}>
      <span className={cx('min-w-0', total && 'font-slab text-[15px] font-semibold')}>{what}{sub && <div className="mt-px text-[13px] leading-[18px] font-sans font-normal text-muted">{sub}</div>}</span>
      <span className={cx('text-right whitespace-nowrap', muted ? 'font-normal' : 'font-medium', total && 'text-[17px]')}>{amount}</span>
    </div>
  );
}

/** A list of PurchaseLines or WriteOffLines, ruled between; `empty` shows when there are none. */
export function LedgerList({ children, empty }: { children: ReactNode[]; empty: ReactNode }) {
  return <div className="mt-1.5">{children.length ? children : <div className="text-[13px] leading-[18px] text-muted">{empty}</div>}</div>;
}
/** `onRemove` (a mistyped entry): "Remove" under the amount, then a confirm step; it is deleted only once confirmed. */
interface Removable { noun: string; onRemove?: () => Promise<unknown> }
function LedgerLine({ what, sub, amount, waste, noun, onRemove }: { what: ReactNode; sub?: ReactNode; amount: ReactNode; waste?: boolean } & Partial<Removable>) {
  const [confirming, setConfirming] = useState(false);
  const remove = useEdit(() => onRemove!());
  const error = remove.error instanceof ApiError && remove.error.code === 'in_use'
    ? `Not removed. Something still uses this ${noun}.` : remove.error && describeError(remove.error);
  return (
    <div className="grid grid-cols-[1fr_80px] items-baseline gap-x-3 gap-y-0.5 border-t border-rule py-1.5 text-[13px] first:border-t-0">
      <span>{what}{sub && <div className="text-[12.5px] leading-[18px] text-muted">{sub}</div>}</span>
      <span className={cx('text-right font-medium', waste && 'text-red')}>{amount}
        {onRemove && !confirming && <Button variant="text" size="sm" edit className="-mr-2 block! ml-auto font-normal text-muted" onClick={() => setConfirming(true)}>Remove</Button>}</span>
      {confirming && (
        <div role="group" aria-label={`Remove this ${noun}`} className="col-span-2 mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-muted">Remove this {noun}? Costs are worked out again without it.</span>
          <Button variant="danger" size="sm" edit disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Removing…' : 'Remove'}</Button>
          <Button variant="text" size="sm" onClick={() => { setConfirming(false); remove.reset(); }}>Keep</Button>
          {error && <span className="basis-full text-amber" aria-live="polite">{error}</span>}
        </div>
      )}
    </div>
  );
}

// Per-unit prices of a single purchase are shown as bought (price ÷ quantity); they're not a print's cost.
/** A purchase: "2 Jun 2026 · A4 · 1 × 25 sheets", "£1.52 per sheet", "£37.99". Paper (with its stock item) or ink (with the cartridge's capacity).
 *  `onRemove` offers "Remove" with a confirm step, for a mistyped entry (remove it and add it again). */
export function PurchaseLine(props: ({ paper: PaperPurchaseView; stock: Pick<StockView, 'name' | 'format'> } | { ink: InkPurchaseView; capacityNl: number }) & { onRemove?: () => Promise<unknown> }) {
  const currency = useCurrency(), { onRemove } = props;
  if ('ink' in props) {
    const { ink, capacityNl } = props, volume = ink.cartridges * capacityNl;
    return <LedgerLine what={<>{dateShort(ink.purchased_on)} · {plural(ink.cartridges, 'cartridge')} × {ml(capacityNl, 0)}</>} noun="purchase" onRemove={onRemove}
      sub={volume ? `${money(Math.round(ink.price_micros / (volume / 1e6)), currency)} per ml` : undefined} amount={money(ink.price_micros, currency)} />;
  }
  const { paper, stock } = props, roll = stock.format === 'roll';
  const quantity = roll ? metres(paper.quantity, paper.quantity % 1_000_000 ? 1 : 0) : `${paper.packs ?? 1} × ${plural(paper.sheets_per_pack ?? paper.quantity, 'sheet')}`;
  const per = paper.quantity ? Math.round(paper.price_micros / (roll ? paper.quantity / 1e6 : paper.quantity)) : null;
  return <LedgerLine what={<>{dateShort(paper.purchased_on)} · {stock.name} · {quantity}</>} noun="purchase" onRemove={onRemove}
    sub={per !== null ? `${money(per, currency)} ${roll ? 'per metre' : 'per sheet'}` : undefined} amount={money(paper.price_micros, currency)} />;
}

/** A write-off, its reason beneath and its cost in red (waste): "30 Apr 2026 · 4 sheets A4", "everything left of A4",
 *  or for ink "cartridge changed early, 12.3 ml left in it". */
export function WriteOffLine(props: { writeOff: WriteOffView; onRemove?: () => Promise<unknown> } & ({ stock: Pick<StockView, 'name' | 'format'> } | { ink: true })) {
  const currency = useCurrency(), { writeOff } = props;
  const what = 'ink' in props ? `cartridge changed early, ${ml(writeOff.written_off, 1)} left in it`
    : writeOff.all_remaining ? `everything left of ${props.stock.name}` : `${stockQuantity(writeOff.written_off, props.stock.format)} ${props.stock.name}`;
  return <LedgerLine what={<>{dateShort(writeOff.written_off_on)} · {what}</>} sub={writeOff.reason ?? undefined} amount={money(writeOff.cost_micros, currency)} waste
    noun="write-off" onRemove={props.onRemove} />;
}

/** An ink level gauge (Ink list): `value` 0–1 of a cartridge; amber when `low`. */
export function LevelBar({ value, low, tick, className }: { value: number; low?: boolean; tick?: number; className?: string }) {
  return (
    <span aria-hidden className={cx('relative block h-1.5 overflow-hidden rounded-[2px] border border-rule-2 bg-paper-2', className)}>
      <i className={cx('absolute inset-y-0 left-0 rounded-[1px]', low ? 'bg-amber' : 'bg-green')} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      {tick !== undefined && <i data-printer-level={tick} className="absolute inset-y-0 w-[2px] bg-ink" style={{ left: `calc(${Math.max(0, Math.min(100, tick))}% - 1px)` }} />}
    </span>
  );
}
