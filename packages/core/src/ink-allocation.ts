import type { InkLine } from 'print-accounting-contracts';
import type { LedgerInput } from './ledger.ts';

export interface InkUnit {
  purchase_id: number; index: number; product_id: number;
  state: 'shelf' | 'fitted' | 'used'; printer_id: number | null;
  starts_after_record: number | null; ended_after_record: number | null;
  printed_nl: number; waste_nl: number; remaining_nl: number; fitting_id: number | null;
}
interface Unit extends InkUnit { date: string; capacity: number; price: bigint; cartridges: number; channel: string; series: string; poolSeries: string | null }
type InkJob = LedgerInput['jobs'][number];
const scale = (a: bigint, b: bigint, c: bigint) => Number((2n * a * b + c) / (2n * c));
const key = (printer: number, channel: string) => `${printer}:${channel}`;
const seriesOf = (name: string, channel: string) => name.replace(new RegExp(`\\s+${channel}$`), '') || name;
const order = (a: Unit, b: Unit) => a.date.localeCompare(b.date) || a.purchase_id - b.purchase_id || a.index - b.index;

/** Cartridge identities and allocations are derived afresh on every read; no engine operation writes stock. */
export function allocateInk(input: LedgerInput) {
  const products = new Map(input.cartridges.map(product => [product.id, { ...product, series: seriesOf(product.name, product.channel) }]));
  const units: Unit[] = input.inkPurchases.flatMap(purchase => {
    const product = products.get(purchase.ink_product_id)!;
    return Array.from({ length: purchase.cartridges }, (_, i): Unit => ({
      purchase_id: purchase.id, index: i + 1, product_id: product.id, channel: product.channel,
      date: purchase.purchased_on, capacity: product.capacity_nl, price: BigInt(purchase.price_micros), cartridges: purchase.cartridges,
      series: product.series, poolSeries: null, state: 'shelf', printer_id: null,
      starts_after_record: null, ended_after_record: null, printed_nl: 0, waste_nl: 0,
      remaining_nl: product.capacity_nl, fitting_id: null,
    }));
  }).sort(order);
  const fitted = new Map<string, Unit>(), readings = new Map<string, string | null>();
  const inkWaste = new Map<number, { product_id: number; quantity: number; cost_micros: number }>();
  const jobLines = new Map<number, InkLine[]>(), offCosts = new Map<number, { written_off: number; cost_micros: number | null; remaining: number }>();
  const invalidFittings: number[] = [];
  const swapWaste: { date: string; cost_micros: number; product_id: number; quantity: number }[] = [];
  const fits = input.inkFittings ?? [], observations = input.inkEvents ?? [];
  const positions = [...observations.map(event => ({ ...event, kind: 'reading' as const, id: 0 })), ...fits.map(event => ({ ...event, kind: 'fitting' as const, series: null, swaps: 0 }))]
    .sort((a, b) => a.after_record - b.after_record || (a.kind === b.kind ? a.id - b.id : a.kind === 'reading' ? -1 : 1));
  const pending = new Map<string, typeof positions>();
  for (const position of positions) {
    const k = key(position.printer_id, position.channel);
    pending.set(k, [...pending.get(k) ?? [], position]);
  }
  const price = (unit: Unit, quantity: number, day: string): number => {
    const pool = units.filter(u => u.channel === unit.channel && (unit.poolSeries === null || u.series === unit.poolSeries) && u.date <= day);
    if (input.method === 'oldest' || !pool.length) return scale(unit.price, BigInt(quantity), BigInt(unit.capacity) * BigInt(unit.cartridges));
    // One purchase contributes once to the weighted average, not once per unit.
    const purchases = [...new Map(pool.map(u => [u.purchase_id, u])).values()];
    if (input.method === 'average') return scale(purchases.reduce((sum, u) => sum + u.price, 0n), BigInt(quantity),
      purchases.reduce((sum, u) => sum + BigInt(u.capacity) * BigInt(u.cartridges), 0n));
    const dearest = purchases.reduce((a, b) => b.price * (BigInt(a.capacity) * BigInt(a.cartridges)) > a.price * (BigInt(b.capacity) * BigInt(b.cartridges)) ? b : a);
    return scale(dearest.price, BigInt(quantity), BigInt(dearest.capacity) * BigInt(dearest.cartridges));
  };
  const poolFor = (channel: string, series: string | null, day: string) => units.filter(u => u.channel === channel && (series === null || u.series === series) && u.date <= day);
  const claim = (printer: number, channel: string, day: string, after: number, purchaseId?: number, fittingId?: number): Unit | undefined => {
    const expected = readings.get(key(printer, channel)) ?? null;
    const pool = purchaseId === undefined ? poolFor(channel, expected, day) : units.filter(u => u.purchase_id === purchaseId);
    // Part-used cartridges returned to the shelf keep their actual remaining amount.
    const available = pool.find(u => u.state === 'shelf' && u.remaining_nl > 0 && u.date <= day);
    // When no stock is left, the legacy one-printer ledger overdraws its newest purchase.
    // Never claim a unit concurrently fitted in a different printer.
    const fallback = purchaseId !== undefined ? pool.find(u => u.state !== 'fitted') ?? pool[0]
      : !readings.has(key(printer, channel)) ? [...pool].reverse().find(u => u.state !== 'fitted') : undefined;
    if (!available && fittingId !== undefined) invalidFittings.push(fittingId);
    const unit = available ?? fallback;
    if (!unit) return undefined;
    if (unit.printer_id !== null) fitted.delete(key(unit.printer_id, channel));
    unit.state = 'fitted'; unit.printer_id = printer; unit.starts_after_record = after;
    unit.ended_after_record = null; unit.fitting_id = fittingId ?? null;
    unit.poolSeries = purchaseId !== undefined && expected !== null && expected !== unit.series ? unit.series : expected;
    fitted.set(key(printer, channel), unit);
    return unit;
  };
  const retire = (unit: Unit, day: string, after: number, destination: 'shelf' | 'used'): void => {
    if (destination === 'used' && unit.remaining_nl > 0) {
      const remaining = unit.remaining_nl;
      unit.waste_nl += remaining; unit.remaining_nl = 0;
      swapWaste.push({ date: day, cost_micros: price(unit, remaining, day), product_id: unit.product_id, quantity: remaining });
    }
    unit.state = destination === 'shelf' && unit.remaining_nl > 0 ? 'shelf' : 'used';
    unit.ended_after_record = after;
    if (unit.printer_id !== null) fitted.delete(key(unit.printer_id, unit.channel));
    unit.printer_id = null;
  };
  const position = (job: InkJob, channel: string) => {
    const k = key(job.printer_id, channel), queue = pending.get(k) ?? [];
    while (queue.length && queue[0].after_record < job.source_record_id) {
      const event = queue.shift()!, current = fitted.get(k);
      if (event.kind === 'reading') {
        readings.set(k, event.series);
        // A correction at this record boundary chooses both what replaces the unit and
        // whether the old unit returns to the shelf; do not perform an automatic swap too.
        const overridden = queue.some(next => next.kind === 'fitting' && next.after_record === event.after_record);
        if (event.swaps > 0 && !overridden) {
          if (current) retire(current, job.date, event.after_record, 'used');
          // Each additional replacement is another unit, even if there was no print in between.
          for (let step = 1; step < event.swaps; step++) {
            const intermediate = claim(job.printer_id, channel, job.date, event.after_record);
            if (intermediate) retire(intermediate, job.date, event.after_record, 'used');
          }
        }
      } else {
        if (current) retire(current, job.date, event.after_record, event.replaced);
        claim(job.printer_id, channel, job.date, event.after_record, event.ink_purchase_id, event.id);
      }
    }
  };
  // Events are consumed only as that printer's source records advance, independent of UTC readings.
  const jobsByPrinter = new Map<number, InkJob[]>();
  for (const job of input.jobs) jobsByPrinter.set(job.printer_id, [...jobsByPrinter.get(job.printer_id) ?? [], job]);
  for (const list of jobsByPrinter.values()) list.sort((a, b) => a.source_record_id - b.source_record_id || a.id - b.id);
  const heads = [...jobsByPrinter.values()];
  const offs = [...input.writeOffs].sort((a, b) => a.written_off_on.localeCompare(b.written_off_on) || a.id - b.id);
  while (heads.some(list => list.length) || offs.length) {
    const next = heads.filter(list => list.length).sort((a, b) => a[0].at.localeCompare(b[0].at) || a[0].id - b[0].id)[0];
    const off = offs[0];
    if (off && (!next || off.written_off_on + 'T24' <= next[0].at)) {
      offs.shift();
      if (off.ink_product_id == null) continue;
      const product = products.get(off.ink_product_id)!;
      const own = poolFor(product.channel, null, off.written_off_on).filter(u => u.product_id === product.id);
      const remaining = own.reduce((sum, u) => sum + u.remaining_nl, 0);
      if (off.all_remaining) {
        // Legacy without printer: the first fitted unit in this channel (even another product),
        // else the oldest part-used unit of the target product. An explicit printer targets its fit.
        const unit = off.printer_id == null ? units.find(u => u.channel === product.channel && u.state === 'fitted')
          ?? own.find(u => u.state === 'shelf' && u.remaining_nl < u.capacity) : fitted.get(key(off.printer_id, product.channel));
        const quantity = Math.max(0, unit?.remaining_nl ?? 0);
        const cost = unit ? price(unit, quantity, off.written_off_on) : 0;
        const printer = unit?.printer_id;
        if (unit) {
          unit.waste_nl += quantity; unit.remaining_nl -= quantity;
          if (unit.printer_id !== null) fitted.delete(key(unit.printer_id, unit.channel));
          unit.printer_id = null; unit.state = 'used'; unit.ended_after_record = null;
        }
        // The capacity-only legacy view moves directly to the next open cartridge after a write-off.
        if (printer != null && !readings.has(key(printer, product.channel))) {
          const last = input.jobs.filter(job => job.printer_id === printer && job.date <= off.written_off_on).reduce((n, job) => Math.max(n, job.source_record_id), -1);
          const shelf = poolFor(product.channel, null, off.written_off_on).some(u => u.state === 'shelf' && u.remaining_nl > 0);
          if (shelf) claim(printer, product.channel, off.written_off_on, last);
        }
        if (unit) inkWaste.set(off.id, { product_id: unit.product_id, quantity, cost_micros: cost });
        offCosts.set(off.id, { written_off: quantity, cost_micros: cost, remaining });
      } else {
        let need = off.quantity!, cost = 0;
        const available = own.filter(u => u.state === 'shelf' && u.remaining_nl > 0);
        const draws = available.length ? available : [...own].reverse().filter(u => u.state !== 'fitted').slice(0, 1);
        for (const unit of draws) {
          if (need <= 0) break;
          const amount = unit === draws.at(-1) ? need : Math.min(need, unit.remaining_nl);
          unit.remaining_nl -= amount; unit.waste_nl += amount;
          if (unit.remaining_nl <= 0) unit.state = 'used';
          const unitCost = price(unit, amount, off.written_off_on);
          const previous = inkWaste.get(off.id);
          inkWaste.set(off.id, { product_id: unit.product_id, quantity: (previous?.quantity ?? 0) + amount, cost_micros: (previous?.cost_micros ?? 0) + unitCost });
          cost += unitCost; need -= amount;
        }
        offCosts.set(off.id, { written_off: off.quantity!, cost_micros: need > 0 ? null : cost, remaining });
      }
      continue;
    }
    const job = next.shift()!;
    jobLines.set(job.id, job.ink.map(({ channel, volume_nl }): InkLine => {
      position(job, channel);
      if (volume_nl === 0) return { channel, volume_nl, cost_micros: 0, from: [] };
      if (volume_nl === null) return { channel, volume_nl, cost_micros: null, from: [] };
      const k = key(job.printer_id, channel), covered = readings.has(k);
      let need = volume_nl, cost = 0;
      const from: InkLine['from'] = [];
      while (need > 0) {
        let unit = fitted.get(k);
        if (!unit) unit = claim(job.printer_id, channel, job.date, job.source_record_id - 1);
        if (!unit) return { channel, volume_nl, cost_micros: null, from };
        // In capacity mode a full unit gives way to the next available unit mid-job.
        const nextUnit = !covered && unit.remaining_nl <= 0 ? poolFor(channel, readings.get(k) ?? null, job.date)
          .find(u => u.state === 'shelf' && u.remaining_nl > 0) : undefined;
        if (nextUnit) {
          retire(unit, job.date, job.source_record_id - 1, 'shelf');
          unit = claim(job.printer_id, channel, job.date, job.source_record_id - 1)!;
        }
        const spare = !covered ? poolFor(channel, readings.get(k) ?? null, job.date).some(u => u.state === 'shelf' && u.remaining_nl > 0) : false;
        const amount = spare ? Math.min(need, Math.max(0, unit.remaining_nl)) : need;
        if (!amount) continue;
        const part = price(unit, amount, job.date);
        unit.remaining_nl -= amount; unit.printed_nl += amount; cost += part; need -= amount;
        from.push({ purchase_id: unit.purchase_id, index: unit.index, printer_id: job.printer_id,
          purchased_on: unit.date, quantity: amount, cost_micros: part, ink_product_id: unit.product_id });
      }
      return { channel, volume_nl, cost_micros: cost, from };
    }));
  }
  return { jobLines, offCosts, inkWaste, swapWaste, invalidFittings, units: units.map(({ date: _date, capacity: _capacity, price: _price, cartridges: _count, channel: _channel, series: _series, poolSeries: _pool, ...unit }) => unit) };
}
