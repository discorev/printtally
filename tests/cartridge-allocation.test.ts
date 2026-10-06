import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, type LedgerInput } from 'print-accounting-core';

const ml = 1_000_000, GBP = 1_000_000;
const job = (id: number, printer_id: number, source_record_id: number, volume_nl = ml, at = `2026-02-${String(id).padStart(2, '0')}T12:00:00`) =>
  ({ id, printer_id, source_record_id, date: at.slice(0, 10), at, source_media_id: null, width_um: null, height_um: null,
    impressions: 0, stock_id: null, paper_id: null, ink: [{ channel: 'C', volume_nl }] });
const base = (): LedgerInput => ({ method: 'oldest', jobs: [], papers: [], stock: [], paperPurchases: [],
  cartridges: [{ id: 1, name: 'PFI-4100 C', channel: 'C', capacity_nl: 2 * ml }],
  inkPurchases: [{ id: 1, ink_product_id: 1, purchased_on: '2026-01-01', cartridges: 3, price_micros: 30 * GBP }], writeOffs: [] });
const line = (input: LedgerInput, id: number) => computeLedger(input).jobs.get(id)!.ink[0];

test('two printers claim distinct purchased units; single-printer capacity spills across units mid-job', () => {
  const input = base(); input.jobs = [job(1, 1, 1), job(2, 2, 1)];
  const result = computeLedger(input);
  assert.deepEqual([result.jobs.get(1)!.ink[0].from[0].index, result.jobs.get(2)!.ink[0].from[0].index], [1, 2]);
  assert.deepEqual(result.units.map(unit => [unit.state, unit.printer_id]), [['fitted', 1], ['fitted', 2], ['shelf', null]]);
  input.jobs = [job(1, 1, 1, 3 * ml)];
  assert.deepEqual(line(input, 1).from.map(use => [use.index, use.quantity, use.cost_micros]),
    [[1, 2 * ml, 10 * GBP], [2, ml, 5 * GBP]]);
});

test('first reading only covers later records, never infers a swap from its absolute count', () => {
  const input = base();
  input.cartridges.push({ id: 2, name: 'PFI-3300 C', channel: 'C', capacity_nl: 2 * ml });
  input.inkPurchases.push({ id: 2, ink_product_id: 2, purchased_on: '2026-01-01', cartridges: 2, price_micros: 40 * GBP });
  input.jobs = [job(1, 1, 1, ml), job(2, 2, 1, 0), job(3, 2, 2, ml)];
  input.inkEvents = [{ printer_id: 2, channel: 'C', after_record: 1, series: 'PFI-3300', swaps: 0 }];
  const result = computeLedger(input);
  assert.deepEqual([result.jobs.get(1)!.ink[0].from[0].ink_product_id, result.jobs.get(3)!.ink[0].from[0].ink_product_id], [1, 2]);
  assert.equal(result.swapWaste.length, 0);
  assert.equal(result.jobs.get(3)!.ink[0].cost_micros, 10 * GBP);
});

test('a baseline reading with no jobs fits the oldest available unit of the reported series without waste', () => {
  const input = base();
  input.cartridges.push({ id: 2, name: 'PFI-3300 C', channel: 'C', capacity_nl: 2 * ml });
  input.inkPurchases = [
    { id: 4, ink_product_id: 1, purchased_on: '2026-01-08', cartridges: 1, price_micros: 10 * GBP },
    { id: 2, ink_product_id: 2, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP },
    { id: 3, ink_product_id: 1, purchased_on: '2026-01-03', cartridges: 1, price_micros: 10 * GBP },
    { id: 5, ink_product_id: 1, purchased_on: '2026-02-04', cartridges: 1, price_micros: 10 * GBP },
  ];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 7, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 0 }];
  const result = computeLedger(input);
  assert.deepEqual(result.units.filter(unit => unit.state === 'fitted').map(unit => [unit.purchase_id, unit.printer_id, unit.starts_after_record]), [[3, 1, 7]]);
  assert.equal(result.units.filter(unit => unit.state === 'shelf').length, 3);
  assert.equal(result.units.every(unit => unit.waste_nl === 0), true);
  assert.equal(result.swapWaste.length, 0);
});

test('pending readings on different printers claim stock in observed-day order', () => {
  const input = base(); input.inkPurchases[0].cartridges = 2;
  input.inkEvents = [
    { printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 0 },
    { printer_id: 2, channel: 'C', after_record: 2, observed_on: '2026-02-01', series: 'PFI-4100', swaps: 0 },
  ];
  const result = computeLedger(input);
  assert.deepEqual(result.units.map(unit => unit.printer_id), [2, 1]);
});

test('a reading swap retires the old unit and fits the next one without a job', () => {
  const input = base();
  input.inkEvents = [
    { printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-01', series: 'PFI-4100', swaps: 0 },
    { printer_id: 1, channel: 'C', after_record: 2, observed_on: '2026-02-02', series: 'PFI-4100', swaps: 1 },
  ];
  const result = computeLedger(input);
  assert.deepEqual(result.units.map(unit => [unit.state, unit.printer_id, unit.starts_after_record, unit.ended_after_record]),
    [['used', null, 1, 2], ['fitted', 1, 2, null], ['shelf', null, null, null]]);
  assert.deepEqual(result.swapWaste.map(event => event.quantity), [2 * ml]);
});

test('a reading with no stock of its reported series leaves nothing fitted', () => {
  const input = base();
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-01', series: 'PFI-3300', swaps: 0 }];
  const result = computeLedger(input);
  assert.equal(result.units.every(unit => unit.state === 'shelf' && unit.printer_id === null), true);
  assert.equal(result.swapWaste.length, 0);
});

test('swap after an import record retires the old unit as waste despite out-of-order printer clock', () => {
  const input = base();
  input.jobs = [job(1, 1, 10, ml, '2026-02-04T12:00:00'), job(2, 1, 11, ml, '2026-02-01T12:00:00')];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 10, series: 'PFI-4100', swaps: 0 },
    { printer_id: 1, channel: 'C', after_record: 10, series: 'PFI-4100', swaps: 1 }];
  const result = computeLedger(input);
  assert.deepEqual(result.jobs.get(2)!.ink[0].from.map(use => use.index), [2]);
  assert.deepEqual(result.swapWaste.map(w => [w.quantity, w.cost_micros]), [[ml, 5 * GBP]]);
  assert.deepEqual(result.units.map(u => [u.waste_nl, u.printed_nl, u.state]), [[ml, ml, 'used'], [0, ml, 'fitted'], [0, 0, 'shelf']]);
});

for (const replaced of ['shelf', 'used'] as const) test(`a fitting overrides an automatic claim and returns the old unit ${replaced}`, () => {
  const input = base();
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.jobs = [job(1, 1, 1), job(2, 1, 2)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-4100', swaps: 1 }];
  input.inkFittings = [{ id: 10, printer_id: 1, channel: 'C', after_record: 1, ink_purchase_id: 2, replaced }];
  const result = computeLedger(input), original = result.units.find(unit => unit.purchase_id === 1 && unit.index === 1)!;
  assert.deepEqual(result.jobs.get(2)!.ink[0].from.map(use => use.purchase_id), [2]);
  assert.equal(original.state, replaced === 'used' ? 'used' : 'shelf');
  assert.equal(original.waste_nl, replaced === 'used' ? ml : 0);
  assert.equal(result.swapWaste.length, replaced === 'used' ? 1 : 0, 'no second automatic retirement at the same point');
  assert.equal(result.units.find(unit => unit.purchase_id === 2)!.fitting_id, 10);
});

test('printer-targeted write-off consumes only that fitted unit; shelf quantity does not take another fit', () => {
  const input = base(); input.jobs = [job(1, 1, 1), job(2, 2, 1)];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: 2, written_off_on: '2026-02-03', quantity: null, all_remaining: true }];
  const result = computeLedger(input);
  assert.equal(result.writeOffs.get(1)!.written_off, ml);
  assert.equal(result.units[0].state, 'fitted');
  assert.equal(result.units[1].waste_nl, ml);
});

test('average and max prices are calculated across the pool at the job date, not per occupied unit', () => {
  const input = base(); input.inkPurchases = [{ id: 1, ink_product_id: 1, purchased_on: '2026-01-01', cartridges: 2, price_micros: 20 * GBP },
    { id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 20 * GBP }];
  input.jobs = [job(1, 1, 1)];
  input.method = 'oldest'; assert.equal(line(input, 1).cost_micros, 5 * GBP);
  input.method = 'average'; assert.equal(line(input, 1).cost_micros, Math.round(40 / 6 * GBP));
  input.method = 'max'; assert.equal(line(input, 1).cost_micros, 10 * GBP);
  input.jobs[0].date = '2026-01-01'; input.jobs[0].at = '2026-01-01T12:00:00';
  assert.equal(line(input, 1).cost_micros, 5 * GBP, 'later purchases cannot change an earlier average');
});

// The database adapter turns UTC reading intervals + import ranges into record-position events.
// The pure allocator above never sees a printer timestamp.

test('a part-used unit returned to the shelf is the oldest claim for a different printer', () => {
  const input = base();
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.jobs = [job(1, 1, 1), job(2, 1, 2), job(3, 2, 1)];
  input.inkFittings = [{ id: 1, printer_id: 1, channel: 'C', after_record: 1, ink_purchase_id: 2, replaced: 'shelf' }];
  const result = computeLedger(input);
  assert.deepEqual(result.jobs.get(3)!.ink[0].from.map(use => [use.purchase_id, use.index]), [[1, 1]]);
  assert.equal(result.units[0].remaining_nl, 0);
  assert.equal(result.units[0].printed_nl, 2 * ml);
});

test('reading mode overdraws the same unit until the printer swaps it', () => {
  const input = base();
  input.jobs = [job(1, 1, 1, 0), job(2, 1, 2, 3 * ml), job(3, 1, 3)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-4100', swaps: 0 }];
  const result = computeLedger(input);
  assert.deepEqual([result.jobs.get(2)!.ink[0].from[0].index, result.jobs.get(3)!.ink[0].from[0].index], [1, 1]);
  assert.equal(result.units[0].remaining_nl, -2 * ml);
  assert.equal(result.units[1].state, 'shelf');
});

test('average and max exclude purchases of a different reported series', () => {
  const input = base();
  input.cartridges.push({ id: 2, name: 'PFI-3300 C', channel: 'C', capacity_nl: 2 * ml });
  input.inkPurchases.push({ id: 2, ink_product_id: 2, purchased_on: '2026-01-01', cartridges: 1, price_micros: 1000 * GBP });
  input.jobs = [job(1, 1, 1, 0), job(2, 1, 2)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-4100', swaps: 0 }];
  for (const method of ['average', 'max'] as const) {
    input.method = method;
    assert.equal(line(input, 2).cost_micros, 5 * GBP);
  }
});

test('after an observed swap with no spare, the retired unit is never reclaimed', () => {
  const input = base(); input.inkPurchases[0].cartridges = 1;
  input.jobs = [job(1, 1, 1), job(2, 1, 2)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-4100', swaps: 1 }];
  const result = computeLedger(input);
  assert.equal(result.jobs.get(2)!.ink[0].cost_micros, null);
  assert.equal(result.units[0].state, 'used');
  assert.equal(result.units[0].waste_nl, ml);
});

test('quantity write-offs draw fitted and shelf units in product order and overdraw the newest', () => {
  const input = base(); input.inkPurchases[0].cartridges = 2;
  input.jobs = [job(1, 1, 1, ml / 2)];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: null,
    written_off_on: '2026-02-02', quantity: 5 * ml, all_remaining: false }];
  const result = computeLedger(input);
  assert.deepEqual(result.units.map(unit => unit.waste_nl), [1.5 * ml, 3.5 * ml]);
  assert.deepEqual(result.units.map(unit => unit.remaining_nl), [0, -1.5 * ml]);
  assert.equal(result.writeOffs.get(1)!.cost_micros, 37.5 * GBP);
});

test('legacy all-remaining with no jobs writes off one full unopened cartridge', () => {
  const input = base(); input.inkPurchases[0].cartridges = 2;
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: null,
    written_off_on: '2026-02-01', quantity: null, all_remaining: true }];
  const result = computeLedger(input);
  assert.equal(result.writeOffs.get(1)!.written_off, 2 * ml);
  assert.deepEqual(result.units.map(unit => unit.remaining_nl), [0, 2 * ml]);
});

test('a reading swap after the last print is reflected in units and waste', () => {
  const input = base(); input.jobs = [job(1, 1, 1, ml)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 1 }];
  const result = computeLedger(input);
  assert.equal(result.swapWaste.length, 1);
  assert.equal(result.swapWaste[0].quantity, ml);
  assert.deepEqual(result.units.map(unit => unit.state), ['used', 'fitted', 'shelf']);
});

test('a swap observed before a later legacy write-off retires the fitted ink first', () => {
  const input = base(); input.jobs = [job(1, 1, 1)];
  input.inkEvents = [
    { printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-01', series: 'PFI-4100', swaps: 0 },
    { printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 1 },
  ];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: null,
    written_off_on: '2026-02-04', quantity: null, all_remaining: true }];
  const result = computeLedger(input);
  assert.deepEqual(result.swapWaste.map(event => [event.date, event.quantity]), [['2026-02-03', ml]]);
  assert.equal(result.writeOffs.get(1)!.written_off, 2 * ml, 'legacy write-off selects the shelf spare, not the newly fitted unit');
  assert.deepEqual(result.units.map(unit => [unit.waste_nl, unit.state]), [[ml, 'used'], [0, 'fitted'], [2 * ml, 'used']]);
});

test('a fitting after the last print is applied before a later printer write-off', () => {
  const input = base(); input.jobs = [job(1, 1, 1)];
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-02-02', cartridges: 1, price_micros: 20 * GBP });
  input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', after_record: 1, created_on: '2026-02-03',
    ink_purchase_id: 2, replaced: 'used' }];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: 1,
    written_off_on: '2026-02-04', quantity: null, all_remaining: true }];
  const result = computeLedger(input);
  assert.deepEqual(result.swapWaste.map(event => [event.date, event.quantity]), [['2026-02-03', ml]]);
  assert.equal(result.writeOffs.get(1)!.cost_micros, 20 * GBP, 'the newly fitted purchase is written off');
  assert.equal(result.units.find(unit => unit.purchase_id === 2)!.waste_nl, 2 * ml);
});

test('a dated write-off does not advance a reading or fitting past the next job in printer record order', () => {
  for (const kind of ['reading', 'fitting'] as const) {
    const input = base();
    input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 20 * GBP });
    input.jobs = [job(1, 1, 1, ml, '2026-02-10T12:00:00'), job(2, 1, 2, ml, '2026-02-11T12:00:00')];
    input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: null,
      written_off_on: '2026-02-04', quantity: ml / 4, all_remaining: false }];
    if (kind === 'reading') input.inkEvents = [
      { printer_id: 1, channel: 'C', after_record: 0, observed_on: '2026-02-01', series: 'PFI-4100', swaps: 0 },
      { printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 1 },
    ];
    else input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', after_record: 1, created_on: '2026-02-03',
      ink_purchase_id: 2, replaced: 'used' }];
    const result = computeLedger(input);
    assert.deepEqual(result.jobs.get(1)!.ink[0].from.map(use => [use.purchase_id, use.index]), [[1, 1]],
      `${kind} must follow record 1, despite its earlier date`);
    assert.deepEqual(result.jobs.get(2)!.ink[0].from.map(use => [use.purchase_id, use.index]),
      [kind === 'reading' ? [1, 2] : [2, 1]], `${kind} must precede record 2`);
  }
});

test('a reading crossed by a later print prices waste and claims stock on its own observed day', () => {
  const input = base(); input.jobs = [job(1, 1, 1), job(2, 1, 2, ml, '2026-02-10T12:00:00')];
  input.inkPurchases = [{ id: 1, ink_product_id: 1, purchased_on: '2026-01-01', cartridges: 1, price_micros: 10 * GBP },
    { id: 2, ink_product_id: 1, purchased_on: '2026-02-02', cartridges: 1, price_micros: 20 * GBP },
    { id: 3, ink_product_id: 1, purchased_on: '2026-02-08', cartridges: 1, price_micros: 100 * GBP }];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 1 }];
  input.method = 'average';
  const result = computeLedger(input);
  assert.deepEqual(result.swapWaste.map(event => [event.date, event.quantity, event.cost_micros]),
    [['2026-02-03', ml, 7.5 * GBP]], 'future expensive stock must not change the waste price');
  assert.equal(result.jobs.get(2)!.ink[0].from[0].purchase_id, 2, 'the observed replacement claims stock bought by its observation, not the print');
});

test('a legacy write-off skips another printer’s reading-mode fit but keeps the oldest capacity-mode target', () => {
  const input = base(); input.jobs = [job(1, 1, 1), job(2, 2, 1)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, observed_on: '2026-02-02', series: 'PFI-4100', swaps: 0 }];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: null,
    written_off_on: '2026-02-03', quantity: null, all_remaining: true }];
  const result = computeLedger(input);
  assert.equal(result.writeOffs.get(1)!.written_off, ml);
  assert.deepEqual(result.units.map(unit => [unit.printer_id, unit.waste_nl]), [[1, 0], [null, ml], [null, 0]]);
});

test('a fitting after the last print executes and claims its specified purchase', () => {
  const input = base(); input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.jobs = [job(1, 1, 1)];
  input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', after_record: 1, ink_purchase_id: 2, replaced: 'shelf' }];
  const result = computeLedger(input);
  assert.equal(result.units.find(unit => unit.purchase_id === 2)!.state, 'fitted');
  assert.equal(result.units.find(unit => unit.purchase_id === 1 && unit.index === 1)!.state, 'shelf');
  assert.equal(result.swapWaste.length, 0);
});

test('a fitting within a reading swap window replaces the automatic swap step', () => {
  const input = base(); input.jobs = [job(1, 1, 1), job(2, 1, 2, 0)];
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, upper_record: 2, observed_on: '2026-02-03', series: 'PFI-4100', swaps: 1 }];
  input.inkFittings = [{ id: 9, printer_id: 1, channel: 'C', after_record: 2, ink_purchase_id: 2, replaced: 'shelf' }];
  const result = computeLedger(input);
  assert.equal(result.swapWaste.length, 0);
  assert.equal(result.units[0].state, 'shelf');
  assert.equal(result.units.find(unit => unit.purchase_id === 2)!.state, 'fitted');
});

test('first reading of another series returns guessed unit to shelf and prices only reported series', () => {
  const input = base(); input.cartridges.push({ id: 2, name: 'PFI-3300 C', channel: 'C', capacity_nl: 2 * ml });
  input.inkPurchases.push({ id: 2, ink_product_id: 2, purchased_on: '2026-01-01', cartridges: 1, price_micros: 100 * GBP });
  input.jobs = [job(1, 1, 1, ml), job(2, 1, 2, ml)];
  input.inkEvents = [{ printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-3300', swaps: 0 }];
  input.method = 'average';
  const result = computeLedger(input);
  assert.equal(result.units[0].state, 'shelf');
  assert.equal(result.units[0].remaining_nl, ml);
  assert.equal(result.units[0].waste_nl, 0);
  assert.equal(result.jobs.get(2)!.ink[0].from[0].ink_product_id, 2);
  assert.equal(result.jobs.get(2)!.ink[0].cost_micros, 50 * GBP);
});

test('one fitting on adjacent swap-window bounds overrides only the earlier window', () => {
  const input = base();
  input.jobs = [job(1, 1, 1), job(2, 1, 2, 0), job(3, 1, 3, 0)];
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.inkEvents = [
    { printer_id: 1, channel: 'C', after_record: 1, upper_record: 2, series: 'PFI-4100', swaps: 1 },
    { printer_id: 1, channel: 'C', after_record: 2, upper_record: 3, series: 'PFI-4100', swaps: 1 },
  ];
  input.inkFittings = [{ id: 9, printer_id: 1, channel: 'C', after_record: 2, ink_purchase_id: 2, replaced: 'shelf' }];
  const result = computeLedger(input);
  assert.deepEqual(result.swapWaste.map(event => event.quantity), [ml]);
  assert.equal(result.units.find(unit => unit.purchase_id === 2)!.fitting_id, 9);
  assert.equal(result.units[0].waste_nl, ml);
});

test('a series mismatch preserves the intermediate replacement when two swaps were reported', () => {
  const input = base();
  input.cartridges.push({ id: 2, name: 'PFI-3300 C', channel: 'C', capacity_nl: 2 * ml });
  input.inkPurchases.push({ id: 2, ink_product_id: 2, purchased_on: '2026-01-01', cartridges: 3, price_micros: 30 * GBP });
  input.jobs = [job(1, 1, 1), job(2, 1, 2)];
  input.inkEvents = [
    { printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-4100', swaps: 0 },
    { printer_id: 1, channel: 'C', after_record: 1, series: 'PFI-3300', swaps: 2 },
  ];
  const result = computeLedger(input);
  assert.equal(result.units[0].state, 'shelf');
  assert.equal(result.units[0].remaining_nl, ml);
  assert.deepEqual(result.swapWaste.map(event => [event.product_id, event.quantity]), [[2, 2 * ml]]);
  assert.equal(result.units.find(unit => unit.purchase_id === 2 && unit.index === 1)!.state, 'used');
  assert.deepEqual(result.jobs.get(2)!.ink[0].from.map(use => [use.purchase_id, use.index]), [[2, 2]]);
});

test('5,000 prints and 200 purchases allocate in well under a second', () => {
  const input = base(); input.method = 'max';
  input.inkPurchases = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, ink_product_id: 1,
    purchased_on: '2026-01-01', cartridges: 1, price_micros: (10 + i % 5) * GBP }));
  input.inkPurchases[0].purchased_on = '2026-01-02';
  input.jobs = Array.from({ length: 5_000 }, (_, i) => job(i + 1, 1, i + 1, 50_000, '2026-02-01T12:00:00'));
  const started = performance.now(), result = computeLedger(input), elapsed = performance.now() - started;
  assert.equal(result.jobs.size, 5_000);
  assert.ok(result.jobs.get(5_000)!.ink[0].cost_micros !== null);
  assert.ok(elapsed < 900, `5,000 jobs and 200 purchases took ${elapsed.toFixed(1)} ms`);
});

test('a capacity write-off leaves the next shelf unit unfitted until another job claims it', () => {
  const input = base();
  input.inkPurchases[0].cartridges = 2;
  input.inkPurchases.push({ id: 2, ink_product_id: 1, purchased_on: '2026-01-02', cartridges: 1, price_micros: 12 * GBP });
  input.jobs = [job(1, 1, 1, ml / 2)];
  input.writeOffs = [{ id: 1, paper_stock_id: null, ink_product_id: 1, printer_id: 1,
    written_off_on: '2026-02-02', quantity: null, all_remaining: true }];
  input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', after_record: 1, ink_purchase_id: 2,
    created_on: '2026-02-03', replaced: 'used' }];
  const result = computeLedger(input);
  assert.equal(result.writeOffs.get(1)!.written_off, 1.5 * ml);
  assert.equal(result.units.reduce((total, unit) => total + unit.waste_nl, 0), 1.5 * ml);
  assert.deepEqual(result.units.map(unit => [unit.purchase_id, unit.index, unit.state]),
    [[1, 1, 'used'], [1, 2, 'shelf'], [2, 1, 'fitted']]);
  assert.equal(result.swapWaste.length, 0);
});

test('an indexed fitting claims only that unit, and rejects a unit already fitted elsewhere', () => {
  const input = base();
  input.jobs = [job(1, 1, 1, ml / 2), job(2, 2, 1, ml / 2)];
  input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', ink_purchase_id: 1,
    unit_index: 3, after_record: 1, replaced: 'shelf', created_on: '2026-02-03' }];
  const chosen = computeLedger(input);
  assert.deepEqual(chosen.invalidFittings, []);
  assert.equal(chosen.units.find(unit => unit.index === 3)!.fitting_id, 7);
  assert.equal(chosen.units.find(unit => unit.index === 2)!.printer_id, 2);
  input.inkFittings[0].unit_index = 2;
  const conflict = computeLedger(input);
  assert.deepEqual(conflict.invalidFittings, [7]);
  assert.equal(conflict.units.find(unit => unit.index === 2)!.printer_id, 2);
  input.inkFittings[0].unit_index = null;
  assert.deepEqual(computeLedger(input).invalidFittings, [], 'legacy purchase-only fittings remain valid');
});

test('a part-used returned shelf cartridge records the write-off date and shelf source', () => {
  const input = base(); input.jobs = [job(1, 1, 1, ml / 2)];
  input.inkFittings = [{ id: 7, printer_id: 1, channel: 'C', ink_purchase_id: 1,
    unit_index: 2, after_record: 1, replaced: 'shelf', created_on: '2026-02-03' }];
  input.writeOffs = [{ id: 8, paper_stock_id: null, ink_product_id: 1, printer_id: null,
    written_off_on: '2026-02-04', quantity: null, all_remaining: true }];
  const used = computeLedger(input).units[0];
  assert.deepEqual([used.state, used.last_printer_id, used.ended_by, used.written_off_on, used.written_off_from_shelf],
    ['used', 1, 'write_off', '2026-02-04', true]);
  input.writeOffs[0] = { ...input.writeOffs[0], quantity: 1.5 * ml, all_remaining: false };
  assert.equal(computeLedger(input).units[0].written_off_from_shelf, true, 'quantity write-offs mark shelf units too');
});
