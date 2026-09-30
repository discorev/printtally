import type { CostingMethod, InkLine, LotUse, PaperLine, StockFormat, UnknownReason } from 'print-accounting-contracts';

// The costing engine. Stock is used up oldest purchase first, in the order things happened: prints at
// their start time, write-offs at the end of their day. A purchase counts from its date. The method only
// sets the price: oldest (the purchase the stock came from), average or max of everything bought by then.
// Using more than was bought draws the newest purchase below zero rather than guessing a price.
export interface LedgerInput {
  method: CostingMethod;
  jobs: { id: number; date: string; at: string; source_media_id: string | null; width_um: number | null; height_um: number | null;
    impressions: number | null; stock_id: number | null; paper_id: number | null; ink: { channel: string; volume_nl: number | null }[] }[];
  papers: { id: number; name: string; media_types: string[] }[];
  stock: { id: number; paper_id: number; name: string; format: StockFormat; width_um: number; height_um: number | null; deckle: boolean }[];
  paperPurchases: { id: number; paper_stock_id: number; purchased_on: string; quantity: number; unit: number; price_micros: number }[];
  cartridges: { id: number; channel: string; capacity_nl: number }[];
  inkPurchases: { id: number; ink_product_id: number; purchased_on: string; cartridges: number; price_micros: number }[];
  writeOffs: { id: number; paper_stock_id: number | null; ink_product_id: number | null; written_off_on: string; quantity: number | null; all_remaining: boolean }[];
}
export interface JobCost {
  paper: PaperLine; ink: InkLine[];
  sized: number[]; // Stock items of the candidate papers at the job's size, in allocation order (bought by then or not).
  left: number | null; // What the allocated item had left by the job's time, before it; null without one.
}
export interface LedgerResult {
  jobs: Map<number, JobCost>;
  lots: Map<string, { quantity: number; remaining: number }>; // Keyed paper:<id> or ink:<id>.
  writeOffs: Map<number, { written_off: number; cost_micros: number | null; remaining: number }>; // remaining: all left of the item before it.
}
interface Lot { key: string; id: number; owner: number; date: string; quantity: number; unit: number; price: bigint; left: number }
const TOLERANCE_UM = 1000; // Sizes within 1 mm match, so 17" (431.8 mm) or 329 x 483 mm entered either way still match.
const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= TOLERANCE_UM;
// a x b / c, rounded half up, exactly.
const scale = (a: bigint, b: bigint, c: bigint) => Number((2n * a * b + c) / (2n * c));
const byDate = (a: Lot, b: Lot) => a.date.localeCompare(b.date) || a.id - b.id;

export function computeLedger(input: LedgerInput): LedgerResult {
  const paperLots = new Map<number, Lot[]>(), inkLots = new Map<string, Lot[]>();
  const push = <K>(map: Map<K, Lot[]>, key: K, lot: Lot) => map.set(key, [...map.get(key) ?? [], lot]);
  for (const p of input.paperPurchases) push(paperLots, p.paper_stock_id, { key: 'paper:' + p.id, id: p.id, owner: p.paper_stock_id, date: p.purchased_on, quantity: p.quantity, unit: p.unit, price: BigInt(p.price_micros), left: p.quantity });
  const cartridges = new Map(input.cartridges.map(c => [c.id, c]));
  for (const p of input.inkPurchases) {
    const cartridge = cartridges.get(p.ink_product_id)!, quantity = p.cartridges * cartridge.capacity_nl;
    push(inkLots, cartridge.channel, { key: 'ink:' + p.id, id: p.id, owner: cartridge.id, date: p.purchased_on, quantity, unit: cartridge.capacity_nl, price: BigInt(p.price_micros), left: quantity });
  }
  for (const lots of [...paperLots.values(), ...inkLots.values()]) lots.sort(byDate);

  // Takes quantity from the lots bought by date, oldest first; null when nothing had been bought.
  const take = (lots: Lot[], date: string, quantity: number, from = lots.filter(lot => lot.date <= date)): { cost: number; uses: (LotUse & { owner: number })[] } | null => {
    const bought = lots.filter(lot => lot.date <= date);
    if (!from.length) return null;
    const uses: { lot: Lot; quantity: number }[] = [];
    let need = quantity;
    for (const lot of from) if (need > 0 && lot.left > 0) { const n = Math.min(lot.left, need); uses.push({ lot, quantity: n }); need -= n; }
    if (need > 0) { const last = from.at(-1)!, use = uses.find(u => u.lot === last); if (use) use.quantity += need; else uses.push({ lot: last, quantity: need }); }
    const paid = bought.reduce((sum, lot) => sum + lot.price, 0n), total = BigInt(bought.reduce((sum, lot) => sum + lot.quantity, 0));
    const dearest = bought.reduce((a, b) => b.price * BigInt(a.quantity) > a.price * BigInt(b.quantity) ? b : a);
    const price = (lot: Lot, n: number) => input.method === 'oldest' ? scale(lot.price, BigInt(n), BigInt(lot.quantity))
      : input.method === 'average' ? scale(paid, BigInt(n), total) : scale(dearest.price, BigInt(n), BigInt(dearest.quantity));
    const result = uses.map(({ lot, quantity: n }) => { lot.left -= n; return { purchase_id: lot.id, purchased_on: lot.date, quantity: n, cost_micros: price(lot, n), owner: lot.owner }; });
    return { cost: result.reduce((sum, use) => sum + use.cost_micros, 0), uses: result };
  };

  const stock = new Map(input.stock.map(item => [item.id, item])), papers = new Map(input.papers.map(paper => [paper.id, paper]));
  const rank = (item: LedgerInput['stock'][number]) => item.format === 'roll' ? 2 : item.deckle ? 1 : 0;
  const fits = (item: LedgerInput['stock'][number], w: number | null, h: number | null) => item.format === 'roll'
    ? near(item.width_um, w) || near(item.width_um, h)
    : (near(item.width_um, w) && near(item.height_um, h)) || (near(item.width_um, h) && near(item.height_um, w));
  const events = [
    ...input.jobs.map(job => ({ at: job.at, job, writeOff: undefined })),
    ...input.writeOffs.map(writeOff => ({ at: writeOff.written_off_on + 'T24', job: undefined, writeOff })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.job?.id ?? 0) - (b.job?.id ?? 0) || (a.writeOff?.id ?? 0) - (b.writeOff?.id ?? 0));

  const result: LedgerResult = { jobs: new Map(), lots: new Map(), writeOffs: new Map() };
  for (const { job, writeOff } of events) {
    if (job) {
      // Allocation: a chosen stock item, else stock of the chosen paper or of the papers printed as this media type,
      // at the job's size and bought by its date. Sheets before deckle sheets before rolls.
      const chosen = job.stock_id === null ? undefined : stock.get(job.stock_id);
      const candidatePapers = chosen ? [papers.get(chosen.paper_id)!] : job.paper_id !== null ? [papers.get(job.paper_id)!]
        : input.papers.filter(paper => job.source_media_id !== null && paper.media_types.includes(job.source_media_id));
      const sized = (chosen ? [chosen] : input.stock.filter(item => candidatePapers.some(paper => paper.id === item.paper_id) && fits(item, job.width_um, job.height_um)))
        .sort((a, b) => rank(a) - rank(b) || a.paper_id - b.paper_id || a.id - b.id);
      const stocked = sized.filter(item => paperLots.get(item.id)?.some(lot => lot.date <= job.date));
      // The first, unless it's a used-up sheet and the same paper has a deckle sheet of this size with stock left by then.
      // Otherwise the first goes below zero; the user can correct the job.
      const left = (id: number) => paperLots.get(id)!.some(lot => lot.date <= job.date && lot.left > 0);
      const first = stocked[0] ?? null;
      const deckle = first && !chosen && rank(first) === 0 && !left(first.id)
        ? stocked.find(candidate => candidate.paper_id === first.paper_id && rank(candidate) === 1 && left(candidate.id)) : undefined;
      const item = deckle ?? first, paper = item ? papers.get(item.paper_id)! : candidatePapers[0] ?? null;
      const length = item?.format === 'roll' ? (near(item.width_um, job.width_um) || !near(item.width_um, job.height_um) ? job.height_um : job.width_um) : null;
      const quantity = job.impressions === null ? null : item?.format === 'roll' ? (length === null ? null : length * job.impressions) : job.impressions;
      let reason: UnknownReason | null = !candidatePapers.length ? 'no_paper' : !sized.length ? 'no_matching_stock' : !item ? 'no_stock_by_date' : quantity === null ? 'unknown_usage' : null;
      const remaining = item ? paperLots.get(item.id)!.filter(lot => lot.date <= job.date).reduce((sum, lot) => sum + lot.left, 0) : null;
      let cost: number | null = null, from: LotUse[] = [];
      if (job.impressions === 0) { cost = 0; reason = null; }
      else if (item && quantity !== null) {
        const used = take(paperLots.get(item.id)!, job.date, quantity)!;
        cost = used.cost; from = used.uses.map(({ owner, ...use }) => use);
      }
      const ink = job.ink.map(({ channel, volume_nl }): InkLine => {
        if (volume_nl === 0) return { channel, volume_nl, cost_micros: 0, from: [] };
        const used = volume_nl === null ? null : take(inkLots.get(channel) ?? [], job.date, volume_nl);
        return { channel, volume_nl, cost_micros: used?.cost ?? null, from: used?.uses.map(({ owner, ...use }) => ({ ...use, ink_product_id: owner })) ?? [] };
      });
      result.jobs.set(job.id, { ink, sized: sized.map(item => item.id), left: remaining, paper: {
        paper_id: paper?.id ?? null, paper_name: paper?.name ?? null, stock_id: item?.id ?? null, stock_name: item?.name ?? null,
        format: item?.format ?? null, deckle: item?.deckle ?? false, allocation: chosen ? 'stock' : job.paper_id !== null ? 'paper' : 'default',
        quantity, cost_micros: cost, unknown_reason: reason, from,
      } });
    } else if (writeOff) {
      const cartridge = writeOff.ink_product_id === null ? undefined : cartridges.get(writeOff.ink_product_id)!;
      const pool = cartridge ? inkLots.get(cartridge.channel) ?? [] : paperLots.get(writeOff.paper_stock_id!) ?? [];
      const own = pool.filter(lot => lot.date <= writeOff.written_off_on && (!cartridge || lot.owner === cartridge.id));
      // All that's left of the open pack, roll or cartridge: the oldest purchase with stock left, modulo its pack size.
      // Ink is used oldest first across the channel, so the cartridge in use may be another product's.
      const open = pool.find(lot => lot.date <= writeOff.written_off_on && lot.left > 0);
      const quantity = writeOff.all_remaining ? (open ? open.left % open.unit || open.unit : 0) : writeOff.quantity!;
      const remaining = own.reduce((sum, lot) => sum + lot.left, 0);
      const used = quantity ? take(pool, writeOff.written_off_on, quantity, writeOff.all_remaining && open ? [open] : own) : null;
      result.writeOffs.set(writeOff.id, { written_off: quantity, cost_micros: quantity === 0 ? 0 : used?.cost ?? null, remaining });
    }
  }
  for (const lot of [...paperLots.values(), ...inkLots.values()].flat()) result.lots.set(lot.key, { quantity: lot.quantity, remaining: lot.left });
  return result;
}

/** `total` split in proportion to `weights`, in whole units and exactly: each part's floor share, then the units
 *  left over one at a time by largest fractional part (earlier parts first on a tie), so the parts add up to `total`. */
export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n), whole = BigInt(total);
  if (sum <= 0n || weights.some(w => w < 0)) throw new Error('Weights must be non-negative with a positive sum');
  const shares = weights.map(w => whole * BigInt(w)), parts = shares.map(share => share / sum);
  const order = shares.map((share, index) => ({ index, fraction: share % sum })).sort((a, b) => a.fraction === b.fraction ? a.index - b.index : a.fraction > b.fraction ? -1 : 1);
  let left = whole - parts.reduce((a, b) => a + b, 0n);
  for (const { index } of order) { if (left === 0n) break; parts[index]++; left--; }
  return parts.map(Number);
}
