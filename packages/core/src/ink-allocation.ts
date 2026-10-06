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

/** Cartridge identities and allocations are derived afresh on every read; no engine operation writes stock.
 * Capacity-mode costs match the original single-printer ledger except when printer record order conflicts with
 * a clock going backwards, and per-unit rounding can differ by up to 1 micro per line. */
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
  const applyEvent = (event: typeof positions[number], day: string): void => {
    const k = key(event.printer_id, event.channel), current = fitted.get(k);
    if (event.kind === 'reading') {
      readings.set(k, event.series);
      // A guessed unit from a different series was never the one the printer reported.
      // Preserve its remaining ink for another printer rather than counting it as waste.
      const mismatch = current && event.series !== null && current.series !== event.series;
      if (mismatch) retire(current, day, event.after_record, 'shelf');
      else if (current) current.poolSeries = event.series;
      // A fitting anywhere in the observed interval accounts for one replacement step.
      const overridden = fits.filter(fit => fit.printer_id === event.printer_id && fit.channel === event.channel
        && fit.after_record >= event.after_record && fit.after_record <= (event.upper_record ?? event.after_record)).length;
      const automatic = Math.max(0, event.swaps - overridden - (mismatch ? 1 : 0));
      if (automatic > 0) {
        if (current && !mismatch) retire(current, day, event.after_record, 'used');
        // Each extra observed replacement is a separate cartridge even without a print.
        for (let step = 1; step < automatic; step++) {
          const intermediate = claim(event.printer_id, event.channel, day, event.after_record);
          if (intermediate) retire(intermediate, day, event.after_record, 'used');
        }
      }
    } else {
      if (current) retire(current, day, event.after_record, event.replaced);
      claim(event.printer_id, event.channel, day, event.after_record, event.ink_purchase_id, event.id);
    }
  };
  const position = (job: InkJob, channel: string) => {
    const queue = pending.get(key(job.printer_id, channel)) ?? [];
    while (queue.length && queue[0].after_record < job.source_record_id) applyEvent(queue.shift()!, job.date);
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
        // Without a printer, the old ledger chooses the channel's oldest cartridge with ink,
        // even if it belongs to another product or is an unopened shelf cartridge.
        const unit = off.printer_id == null
          ? poolFor(product.channel, null, off.written_off_on).find(u => u.remaining_nl > 0)
          : fitted.get(key(off.printer_id, product.channel));
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
        let need = off.quantity!;
        const uses: { unit: Unit; quantity: number }[] = [];
        // Like the original lot take(), draw from every bought unit with stock left,
        // including the fitted one, and overdraw the newest unit when stock runs out.
        const draws = own.filter(u => u.remaining_nl > 0);
        if (own.length && need > draws.reduce((sum, u) => sum + u.remaining_nl, 0) && !draws.includes(own.at(-1)!)) draws.push(own.at(-1)!);
        for (const unit of draws) {
          if (need <= 0) break;
          const amount = unit === own.at(-1) ? need : Math.min(need, unit.remaining_nl);
          unit.remaining_nl -= amount; unit.waste_nl += amount;
          if (unit.remaining_nl <= 0 && unit.state === 'shelf') unit.state = 'used';
          uses.push({ unit, quantity: amount });
          need -= amount;
        }
        // Round once per purchase, as the old lot-based engine did, not once per unit.
        const grouped = new Map<string, { unit: Unit; quantity: number }>();
        for (const use of uses) {
          const k = `${use.unit.purchase_id}:${use.unit.poolSeries}`;
          const group = grouped.get(k);
          grouped.set(k, { unit: use.unit, quantity: (group?.quantity ?? 0) + use.quantity });
        }
        const cost = [...grouped.values()].reduce((sum, use) => sum + price(use.unit, use.quantity, off.written_off_on), 0);
        if (uses.length) inkWaste.set(off.id, { product_id: product.id, quantity: off.quantity!, cost_micros: cost });
        offCosts.set(off.id, { written_off: off.quantity!, cost_micros: own.length ? cost : null, remaining });
      }
      continue;
    }
    const job = next.shift()!;
    jobLines.set(job.id, job.ink.map(({ channel, volume_nl }): InkLine => {
      position(job, channel);
      if (volume_nl === 0) return { channel, volume_nl, cost_micros: 0, from: [] };
      if (volume_nl === null) return { channel, volume_nl, cost_micros: null, from: [] };
      const k = key(job.printer_id, channel), covered = readings.has(k);
      let need = volume_nl;
      const from: InkLine['from'] = [];
      while (need > 0) {
        let unit = fitted.get(k);
        if (!unit) unit = claim(job.printer_id, channel, job.date, job.source_record_id - 1);
        if (!unit) return { channel, volume_nl, cost_micros: null, from };
        // In capacity mode a full unit gives way to the next available unit mid-job.
        const pool = poolFor(channel, readings.get(k) ?? null, job.date), current = unit;
        const nextUnit = !covered && unit.remaining_nl <= 0 ? pool.find(u => u.state === 'shelf' && u.remaining_nl > 0)
          ?? [...pool].reverse().find(u => u.state !== 'fitted' && order(u, current) > 0) : undefined;
        if (nextUnit) {
          retire(unit, job.date, job.source_record_id - 1, 'shelf');
          unit = claim(job.printer_id, channel, job.date, job.source_record_id - 1)!;
        }
        const split = !covered && pool.some(u => (u.state === 'shelf' && u.remaining_nl > 0)
          || (u.state !== 'fitted' && order(u, unit) > 0));
        const amount = split ? Math.min(need, Math.max(0, unit.remaining_nl)) : need;
        if (!amount) continue;
        const part = price(unit, amount, job.date);
        unit.remaining_nl -= amount; unit.printed_nl += amount; need -= amount;
        from.push({ purchase_id: unit.purchase_id, index: unit.index, printer_id: job.printer_id,
          purchased_on: unit.date, quantity: amount, cost_micros: part, ink_product_id: unit.product_id });
      }
      // A legacy lot rounded a purchase once even when the print crossed cartridge boundaries.
      const grouped = new Map<string, { unit: Unit; indices: number[]; quantity: number }>();
      for (const [index, use] of from.entries()) {
        const unit = units.find(u => u.purchase_id === use.purchase_id && u.index === use.index)!;
        const groupKey = `${use.purchase_id}:${unit.poolSeries}`;
        const group = grouped.get(groupKey);
        grouped.set(groupKey, { unit, indices: [...group?.indices ?? [], index], quantity: (group?.quantity ?? 0) + use.quantity });
      }
      for (const group of grouped.values()) {
        const rounded = price(group.unit, group.quantity, job.date);
        const actual = group.indices.reduce((sum, index) => sum + from[index].cost_micros, 0);
        from[group.indices.at(-1)!].cost_micros += rounded - actual;
      }
      return { channel, volume_nl, cost_micros: from.reduce((sum, use) => sum + use.cost_micros, 0), from };
    }));
  }
  // A reading or a fitting after the last print still changes current stock and waste.
  for (const queue of pending.values()) for (const event of queue) {
    const day = event.kind === 'reading' ? event.observed_on : event.created_on;
    const lastJob = input.jobs.filter(job => job.printer_id === event.printer_id).sort((a, b) => b.source_record_id - a.source_record_id)[0];
    applyEvent(event, day ?? lastJob?.date ?? input.inkPurchases.at(-1)?.purchased_on ?? '9999-12-31');
  }
  return { jobLines, offCosts, inkWaste, swapWaste, invalidFittings, units: units.map(({ date: _date, capacity: _capacity, price: _price, cartridges: _count, channel: _channel, series: _series, poolSeries: _pool, ...unit }) => unit) };
}
