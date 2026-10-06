import type { InkLine } from 'print-accounting-contracts';
import type { LedgerInput } from './ledger.ts';

export interface InkUnit {
  purchase_id: number; index: number; product_id: number;
  state: 'shelf' | 'fitted' | 'used'; printer_id: number | null; last_printer_id: number | null;
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
      series: product.series, poolSeries: null, state: 'shelf', printer_id: null, last_printer_id: null,
      starts_after_record: null, ended_after_record: null, printed_nl: 0, waste_nl: 0,
      remaining_nl: product.capacity_nl, fitting_id: null,
    }));
  }).sort(order);
  // Keep claim order in each pool. A purchase contributes once to pricing, even when it has many units.
  type Pool = { units: Unit[]; purchases: Unit[]; stats: { paid: bigint; capacity: bigint; dearest: Unit }[];
    days: Map<string, number>; purchaseDays: Map<string, number> };
  const makePool = (): Pool => ({ units: [], purchases: [], stats: [], days: new Map(), purchaseDays: new Map() });
  const byChannel = new Map<string, Pool>(), bySeries = new Map<string, Map<string, Pool>>();
  const byPurchase = new Map<number, Unit[]>(), byProduct = new Map<number, Unit[]>();
  const capacities = new Map<number, bigint>();
  const getOrCreate = <K, V>(map: Map<K, V>, id: K, make: () => V): V => {
    let value = map.get(id);
    if (value === undefined) { value = make(); map.set(id, value); }
    return value;
  };
  for (const unit of units) {
    const channel = getOrCreate(byChannel, unit.channel, makePool);
    const series = getOrCreate(getOrCreate(bySeries, unit.channel, () => new Map<string, Pool>()), unit.series, makePool);
    for (const pool of [channel, series]) {
      pool.units.push(unit);
      if (pool.purchases.at(-1)?.purchase_id !== unit.purchase_id) pool.purchases.push(unit);
    }
    getOrCreate(byPurchase, unit.purchase_id, () => []).push(unit);
    getOrCreate(byProduct, unit.product_id, () => []).push(unit);
    capacities.set(unit.purchase_id, BigInt(unit.capacity) * BigInt(unit.cartridges));
  }
  for (const pool of [...byChannel.values(), ...[...bySeries.values()].flatMap(series => [...series.values()])]) {
    let paid = 0n, capacity = 0n, dearest: Unit | undefined;
    for (const unit of pool.purchases) {
      const size = capacities.get(unit.purchase_id)!;
      paid += unit.price; capacity += size;
      if (!dearest || unit.price * capacities.get(dearest.purchase_id)! > dearest.price * size) dearest = unit;
      pool.stats.push({ paid, capacity, dearest });
    }
  }
  const poolForIndex = (channel: string, series: string | null) => series === null ? byChannel.get(channel) : bySeries.get(channel)?.get(series);
  const bound = (items: Unit[], day: string, cache: Map<string, number>): number => {
    const cached = cache.get(day);
    if (cached !== undefined) return cached;
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid].date <= day) lo = mid + 1; else hi = mid; }
    cache.set(day, lo);
    return lo;
  };
  const fitted = new Map<string, Unit>(), readings = new Map<string, string | null>();
  const inkWaste = new Map<number, { product_id: number; quantity: number; cost_micros: number }>();
  const jobLines = new Map<number, InkLine[]>(), offCosts = new Map<number, { written_off: number; cost_micros: number | null; remaining: number }>();
  const invalidFittings: number[] = [];
  const swapWaste: { date: string; cost_micros: number; product_id: number; quantity: number }[] = [];
  const fits = input.inkFittings ?? [], observations = input.inkEvents ?? [];
  const overriddenFittings = new Set<number>();
  const positions = [...observations.map(event => ({ ...event, kind: 'reading' as const, id: 0 })), ...fits.map(event => ({ ...event, kind: 'fitting' as const, series: null, swaps: 0 }))]
    .sort((a, b) => a.after_record - b.after_record || (a.kind === b.kind ? a.id - b.id : a.kind === 'reading' ? -1 : 1));
  const pending = new Map<string, typeof positions>();
  for (const position of positions) getOrCreate(pending, key(position.printer_id, position.channel), () => []).push(position);
  const price = (unit: Unit, quantity: number, day: string): number => {
    const pool = poolForIndex(unit.channel, unit.poolSeries);
    const count = pool ? bound(pool.purchases, day, pool.purchaseDays) : 0;
    if (input.method === 'oldest' || !count) return scale(unit.price, BigInt(quantity), capacities.get(unit.purchase_id)!);
    const stats = pool!.stats[count - 1];
    if (input.method === 'average') return scale(stats.paid, BigInt(quantity), stats.capacity);
    return scale(stats.dearest.price, BigInt(quantity), capacities.get(stats.dearest.purchase_id)!);
  };
  const poolFor = (channel: string, series: string | null, day: string) => {
    const pool = poolForIndex(channel, series);
    return pool ? pool.units.slice(0, bound(pool.units, day, pool.days)) : [];
  };
  const claim = (printer: number, channel: string, day: string, after: number, purchaseId?: number, fittingId?: number): Unit | undefined => {
    const expected = readings.get(key(printer, channel)) ?? null;
    const pool = purchaseId === undefined ? poolFor(channel, expected, day) : byPurchase.get(purchaseId) ?? [];
    // Part-used cartridges returned to the shelf keep their actual remaining amount.
    const available = pool.find(u => u.state === 'shelf' && u.remaining_nl > 0 && u.date <= day);
    // When no stock is left, the legacy one-printer ledger overdraws its newest purchase.
    // Never claim a unit concurrently fitted in a different printer.
    const fallback = purchaseId !== undefined ? pool.find(u => u.state !== 'fitted') ?? pool[0]
      : !readings.has(key(printer, channel)) ? pool.findLast(u => u.state !== 'fitted') : undefined;
    if (!available && fittingId !== undefined) invalidFittings.push(fittingId);
    const unit = available ?? fallback;
    if (!unit) return undefined;
    if (unit.printer_id !== null) fitted.delete(key(unit.printer_id, channel));
    unit.state = 'fitted'; unit.printer_id = printer; unit.last_printer_id = printer; unit.starts_after_record = after;
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
      // A fitting accounts for one replacement step in its earliest available swap window.
      const overrides = fits.filter(fit => !overriddenFittings.has(fit.id) && fit.printer_id === event.printer_id && fit.channel === event.channel
        && fit.after_record >= event.after_record && fit.after_record <= (event.upper_record ?? event.after_record)).slice(0, event.swaps);
      for (const fit of overrides) overriddenFittings.add(fit.id);
      const automatic = Math.max(0, event.swaps - overrides.length);
      if (automatic > 0) {
        if (current && !mismatch) retire(current, day, event.after_record, 'used');
        // Each extra observed replacement is a separate cartridge even without a print.
        for (let step = 1; step < automatic; step++) {
          const intermediate = claim(event.printer_id, event.channel, day, event.after_record);
          if (intermediate) retire(intermediate, day, event.after_record, 'used');
        }
      }
      // The reading itself proves a cartridge is installed, even before another job prints.
      if (event.series !== null && !fitted.has(k)) claim(event.printer_id, event.channel, day, event.after_record);
    } else {
      if (current) retire(current, day, event.after_record, event.replaced);
      claim(event.printer_id, event.channel, day, event.after_record, event.ink_purchase_id, event.id);
    }
  };
  // Prints advance by source record, while a pending observation/fitting also takes effect
  // before a later-dated write-off even if no subsequent print advances that record.
  const jobsByPrinter = new Map<number, InkJob[]>();
  for (const job of input.jobs) getOrCreate(jobsByPrinter, job.printer_id, () => []).push(job);
  for (const list of jobsByPrinter.values()) list.sort((a, b) => a.source_record_id - b.source_record_id || a.id - b.id);
  const eventDay = (event: typeof positions[number], fallback?: string) =>
    (event.kind === 'reading' ? event.observed_on : event.created_on)
      ?? fallback ?? jobsByPrinter.get(event.printer_id)?.at(-1)?.date ?? input.inkPurchases.at(-1)?.purchased_on ?? '9999-12-31';
  const readingSince = new Map<string, string>();
  for (const event of positions) if (event.kind === 'reading') {
    const k = key(event.printer_id, event.channel), day = eventDay(event);
    if (!readingSince.has(k) || day < readingSince.get(k)!) readingSince.set(k, day);
  }
  const position = (job: InkJob, channel: string) => {
    const queue = pending.get(key(job.printer_id, channel)) ?? [];
    while (queue.length && queue[0].after_record < job.source_record_id) {
      const event = queue.shift()!;
      applyEvent(event, eventDay(event, job.date));
    }
  };
  const applyPending = (day?: string) => {
    // Pick the earliest due head across printers, without reversing a printer's record order.
    while (true) {
      let next: typeof positions[number] | undefined, selected: typeof positions | undefined;
      for (const queue of pending.values()) {
        const event = queue[0];
        const nextRecord = event && jobsByPrinter.get(event.printer_id)?.[0]?.source_record_id;
        if (event && (day === undefined || eventDay(event) <= day)
          && (nextRecord === undefined || event.after_record < nextRecord)
          && (!next || eventDay(event) < eventDay(next))) {
          next = event; selected = queue;
        }
      }
      if (!next || !selected) break;
      selected.shift();
      applyEvent(next, eventDay(next));
    }
  };
  const heads = [...jobsByPrinter.values()];
  const offs = [...input.writeOffs].sort((a, b) => a.written_off_on.localeCompare(b.written_off_on) || a.id - b.id);
  while (heads.some(list => list.length) || offs.length) {
    const next = heads.filter(list => list.length).sort((a, b) => a[0].at.localeCompare(b[0].at) || a[0].id - b[0].id)[0];
    const off = offs[0];
    if (off && (!next || off.written_off_on + 'T24' <= next[0].at)) {
      offs.shift();
      if (off.ink_product_id == null) continue;
      applyPending(off.written_off_on);
      const product = products.get(off.ink_product_id)!;
      const own = (byProduct.get(product.id) ?? []).filter(u => u.date <= off.written_off_on);
      const remaining = own.reduce((sum, u) => sum + u.remaining_nl, 0);
      if (off.all_remaining) {
        // Without a printer, the old ledger chooses the channel's oldest cartridge with ink,
        // even if it belongs to another product or is an unopened shelf cartridge.
        const unit = off.printer_id == null
          ? poolFor(product.channel, null, off.written_off_on).find(u => u.remaining_nl > 0
            && (u.printer_id === null || (readingSince.get(key(u.printer_id, product.channel)) ?? '9999-12-31') > off.written_off_on))
          : fitted.get(key(off.printer_id, product.channel));
        const quantity = Math.max(0, unit?.remaining_nl ?? 0);
        const cost = unit ? price(unit, quantity, off.written_off_on) : 0;
        if (unit) {
          unit.waste_nl += quantity; unit.remaining_nl -= quantity;
          if (unit.printer_id !== null) fitted.delete(key(unit.printer_id, unit.channel));
          unit.printer_id = null; unit.state = 'used'; unit.ended_after_record = null;
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
          ?? pool.findLast(u => u.state !== 'fitted' && order(u, current) > 0) : undefined;
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
        const unit = byPurchase.get(use.purchase_id)![use.index - 1];
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
  // A reading or fitting after the last print still changes current stock and waste.
  applyPending();
  return { jobLines, offCosts, inkWaste, swapWaste, invalidFittings, units: units.map(({ date: _date, capacity: _capacity, price: _price, cartridges: _count, channel: _channel, series: _series, poolSeries: _pool, ...unit }) => unit) };
}
