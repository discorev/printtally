import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountingDatabase, Ledger, LedgerError } from 'print-accounting-database';
import { splitByWeight } from 'print-accounting-core';
import { batch, MEDIA, OTHER, type JobSpec } from './fixtures.ts';
const GBP = 1_000_000;
function fixture(t: TestContext, specs: JobSpec[]) {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-ledger-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  db.importSnapshot(batch(specs));
  const ledger = new Ledger(db);
  // Ink is bought long before any print so paper is the only unknown unless a test says otherwise.
  const cyan = ledger.createCartridge({ name: 'PFI-1000 C', channel: 'C', capacity_nl: 80_000_000 });
  ledger.createInkPurchase({ ink_product_id: cyan, purchased_on: '2025-01-01', cartridges: 2, price_micros: 60 * GBP });
  const paper = ledger.createPaper({ name: 'Museum Etching', media_types: [MEDIA] });
  const sheet = (name: string, w: number, h: number, deckle = false) => ledger.createStock({ paper_id: paper, name, format: 'sheet', width_um: w * 1000, height_um: h * 1000, deckle });
  const buy = (stock: number, day: string, sheets: number, price: number) => ledger.createPaperPurchase({ paper_stock_id: stock, purchased_on: day, packs: 1, sheets_per_pack: sheets, price_micros: price * GBP });
  const job = (id: number) => ledger.job(id)!.job;
  return { db, ledger, paper, cyan, sheet, buy, job };
}

test('default allocation matches media type and size, prefers non-deckle and only uses stock bought by the job date', t => {
  const { ledger, sheet, buy, job } = fixture(t, [
    { day: '2026-02-01' }, { day: '2026-04-01' }, { day: '2026-04-01', w: 297, h: 210 }, { day: '2026-04-01', w: 329, h: 483 },
    { day: '2025-12-01' }, { day: '2026-04-01', media: OTHER }, { day: '2026-04-01', w: 100, h: 150 },
  ]);
  const deckle = sheet('A4', 210, 297, true), plain = sheet('A4', 210, 297), large = sheet('A3+', 329, 483, true);
  buy(deckle, '2026-01-01', 25, 50); buy(plain, '2026-03-01', 25, 25); buy(large, '2026-01-01', 25, 100);
  assert.equal(job(1).paper.stock_id, deckle, 'only the deckle A4 had been bought by then');
  assert.equal(job(2).paper.stock_id, plain, 'non-deckle is preferred once bought');
  assert.equal(job(3).paper.stock_id, plain, 'either orientation matches');
  assert.equal(job(4).paper.stock_id, large, 'deckle when that is all there is');
  assert.deepEqual([5, 6, 7].map(id => [job(id).paper.unknown_reason, job(id).paper.cost_micros, job(id).total_micros]),
    [['no_stock_by_date', null, null], ['no_paper', null, null], ['no_matching_stock', null, null]]);
  assert.equal(job(6).display_paper_name, 'Configured stock');
  assert.equal(job(2).display_paper_name, 'Museum Etching'); assert.equal(job(2).paper.allocation, 'default');
});

test('a job is corrected by choosing a stock item or a paper, and the importer never writes allocations', t => {
  const { db, ledger, sheet, buy, job } = fixture(t, [{ day: '2026-04-01' }]);
  const plain = sheet('A4', 210, 297), deckle = sheet('A4', 210, 297, true);
  buy(plain, '2026-01-01', 25, 25); buy(deckle, '2026-01-01', 10, 30);
  const other = ledger.createPaper({ name: 'Photo Rag' }), rag = ledger.createStock({ paper_id: other, name: 'A4', format: 'sheet', width_um: 210000, height_um: 297000 });
  buy(rag, '2026-01-01', 20, 40);
  assert.equal(job(1).paper.stock_id, plain); assert.equal(db.all('SELECT * FROM job_annotations').length, 0, 'reading never writes an allocation');
  db.annotateJob(1, { paper_stock_id: deckle });
  assert.deepEqual([job(1).paper.stock_id, job(1).paper.allocation, job(1).paper.cost_micros], [deckle, 'stock', 3 * GBP]);
  db.annotateJob(1, { paper_id: other });
  assert.deepEqual([job(1).paper.stock_id, job(1).paper.allocation, job(1).stock_override_id, job(1).display_paper_name], [rag, 'paper', null, 'Photo Rag']);
  db.importSnapshot(batch([{ day: '2026-04-01' }]));
  assert.equal(job(1).paper.paper_id, other, 'reimports keep the correction');
});

test('sheets use reported impressions and rolls use reported length; cancelled prints use no paper', t => {
  const { ledger, paper, sheet, buy, job } = fixture(t, [{ day: '2026-03-01', imp: 2 }, { day: '2026-03-02', w: 431.8, h: 914.4 }, { day: '2026-03-03', imp: 0 }, { day: '2026-03-03', w: 914.4, h: 431.8 }]);
  buy(sheet('A4', 210, 297), '2026-01-01', 25, 25);
  const roll = ledger.createStock({ paper_id: paper, name: '17"', format: 'roll', width_um: 431800 });
  ledger.createPaperPurchase({ paper_stock_id: roll, purchased_on: '2026-01-01', length_um: 15_000_000, price_micros: 150 * GBP });
  assert.deepEqual([job(1).paper.quantity, job(1).paper.cost_micros], [2, 2 * GBP]);
  assert.deepEqual([job(2).paper.stock_id, job(2).paper.format, job(2).paper.quantity, job(2).paper.cost_micros], [roll, 'roll', 914400, 9_144_000]);
  assert.deepEqual([job(3).paper.quantity, job(3).paper.cost_micros, job(3).paper.unknown_reason], [0, 0, null]);
  assert.equal(job(4).paper.quantity, 914400, 'the roll width matches either side');
  assert.equal(job(1).ink.find(line => line.channel === 'C')!.cost_micros, 46875); // 0.125 ml of 160 ml for £60.
  assert.equal(job(1).total_micros, 2 * GBP + 46875);
  const [stock] = ledger.papers().papers[0].stock.filter(item => item.format === 'roll');
  assert.deepEqual([stock.bought, stock.used, stock.remaining], [15_000_000, 1_828_800, 13_171_200]);
});

test('oldest, average and max cost the same usage from the chosen method only', t => {
  const { ledger, sheet, buy, job } = fixture(t, [{ day: '2026-01-15' }, { day: '2026-03-01', imp: 26 }]);
  const a4 = sheet('A4', 210, 297);
  buy(a4, '2026-01-01', 25, 25); buy(a4, '2026-02-01', 25, 50);
  // Job 1 takes the first sheet; job 2 takes 24 more from the first pack and 2 from the second.
  assert.deepEqual([job(1).paper.cost_micros, job(2).paper.cost_micros], [GBP, 28 * GBP]);
  assert.deepEqual(job(2).paper.from.map(use => [use.quantity, use.cost_micros]), [[24, 24 * GBP], [2, 4 * GBP]]);
  ledger.updateSettings({ costing_method: 'average' });
  assert.deepEqual([job(1).paper.cost_micros, job(2).paper.cost_micros], [GBP, 39 * GBP], 'the average of what was bought by each print');
  ledger.updateSettings({ costing_method: 'max' });
  assert.deepEqual([job(1).paper.cost_micros, job(2).paper.cost_micros], [GBP, 52 * GBP]);
  assert.equal(ledger.jobs().settings.costing_method, 'max');
  assert.throws(() => ledger.updateSettings({ costing_method: 'newest' }));
});

test('a used-up sheet falls back only to a deckle sheet of the same paper and size', t => {
  const { ledger, sheet, buy, job } = fixture(t, [{ day: '2026-02-01' }, { day: '2026-02-02' }, { day: '2026-02-03' }, { day: '2026-02-04', w: 329, h: 483 }, { day: '2026-02-05', w: 329, h: 483 }]);
  const plain = sheet('A4', 210, 297), deckle = sheet('A4', 210, 297, true), large = sheet('A3+', 329, 483);
  buy(plain, '2026-01-01', 1, 1); buy(deckle, '2026-01-01', 1, 2); buy(large, '2026-01-01', 1, 3);
  const other = ledger.createPaper({ name: 'Photo Rag', media_types: [MEDIA] });
  buy(ledger.createStock({ paper_id: other, name: 'A3+', format: 'sheet', width_um: 329000, height_um: 483000 }), '2026-01-01', 25, 50);
  assert.deepEqual([1, 2, 3].map(id => job(id).paper.stock_id), [plain, deckle, plain], 'deckle once plain is gone; plain goes below zero when both are');
  assert.deepEqual([4, 5].map(id => job(id).paper.stock_id), [large, large], 'never another paper: the preferred item goes below zero');
  assert.deepEqual(ledger.papers().papers.find(p => p.name === 'Museum Etching')!.stock.map(item => item.remaining), [-1, 0, -1]);
});

test('writing off all that is left in a cartridge takes the one in use, whichever product it is', t => {
  const { ledger, cyan, job } = fixture(t, [{ day: '2026-02-01' }]);
  const large = ledger.createCartridge({ name: 'PFI-1000 C 160', channel: 'C', capacity_nl: 160_000_000 });
  ledger.createInkPurchase({ ink_product_id: large, purchased_on: '2026-01-01', cartridges: 1, price_micros: 100 * GBP });
  assert.equal(job(1).ink[0].from[0].ink_product_id, cyan, 'the older cartridge is in use');
  const inUse = () => ledger.ink().cartridges.map(c => c.open_remaining_nl);
  assert.deepEqual(inUse(), [80_000_000 - 125_000, null]);
  ledger.createWriteOff({ ink_product_id: large, written_off_on: '2026-02-20', all_remaining: true });
  const [small, big] = ledger.ink().cartridges;
  assert.deepEqual([big.write_offs[0].written_off, small.remaining, big.remaining], [80_000_000 - 125_000, 80_000_000, 160_000_000]);
  assert.deepEqual(inUse(), [80_000_000, null]);
});

test('write-offs use up stock and cartridges and count as waste, never in a print cost', t => {
  const { ledger, cyan, sheet, buy, job } = fixture(t, [{ day: '2026-02-01' }, { day: '2026-03-01' }]);
  const a4 = sheet('A4', 210, 297);
  buy(a4, '2026-01-01', 5, 5); buy(a4, '2026-01-02', 10, 20);
  const lost = ledger.createWriteOff({ paper_stock_id: a4, written_off_on: '2026-02-01', all_remaining: true, reason: 'Damp' });
  const damaged = ledger.createWriteOff({ paper_stock_id: a4, written_off_on: '2026-02-15', quantity: 2 });
  const early = ledger.createWriteOff({ ink_product_id: cyan, written_off_on: '2026-02-20', all_remaining: true, reason: 'Changed early' });
  assert.deepEqual([job(1).paper.cost_micros, job(2).paper.cost_micros], [GBP, 2 * GBP], 'the print that day came first; the lost pack moved the next print on');
  const [paper] = ledger.papers().papers, [a4View] = paper.stock;
  const byId = new Map(paper.write_offs.map(w => [w.id, w]));
  assert.deepEqual([byId.get(lost)!.written_off, byId.get(lost)!.cost_micros, byId.get(damaged)!.cost_micros], [4, 4 * GBP, 4 * GBP]);
  assert.deepEqual([a4View.bought, a4View.used, a4View.wasted, a4View.remaining, a4View.waste_micros], [15, 2, 6, 7, 8 * GBP]);
  assert.equal(paper.totals.waste_micros, 8 * GBP); assert.equal(paper.totals.paper_micros, 3 * GBP);
  const [cartridge] = ledger.ink().cartridges, [inkOff] = cartridge.write_offs;
  assert.deepEqual([inkOff.id, inkOff.written_off, inkOff.cost_micros], [early, 79_875_000, 29_953_125]);
  assert.deepEqual([cartridge.remaining, cartridge.open_remaining_nl, cartridge.used], [80_000_000 - 125_000, 80_000_000 - 125_000, 250_000]);
  const totals = ledger.totals();
  assert.equal(totals.overall.waste_micros, 8 * GBP + 29_953_125);
  assert.equal(totals.overall.total_micros, 3 * GBP + 2 * 46875, 'waste is never inside a print cost');
  assert.equal(totals.days.find(day => day.date === '2026-02-20')!.waste_micros, 29_953_125);
});

test('unknown paper cost stays null with a reason and is never guessed', t => {
  const { ledger, job } = fixture(t, [{ day: '2026-02-01' }]);
  assert.deepEqual([job(1).paper.cost_micros, job(1).paper.unknown_reason, job(1).paper_micros, job(1).total_micros], [null, 'no_matching_stock', null, null]);
  assert.equal(job(1).ink_micros, 46875);
  const { overall } = ledger.totals();
  assert.deepEqual([overall.jobs, overall.unknown_jobs, overall.unknown_paper_jobs, overall.paper_micros, overall.ink_micros], [1, 1, 1, 0, 46875]);
  assert.equal(ledger.papers().papers[0].totals.unknown_paper_jobs, 1, 'a paper counts its prints with no paper cost');
  assert.equal(overall.ink_nl, 125_000, 'ink volume counts even when the paper cost is unknown');
});

test('unknown ink cost counts separately from unknown paper cost, even once the paper is known', t => {
  const { ledger, sheet, buy, job } = fixture(t, [{ day: '2026-02-01' }, { day: '2026-02-02' }]);
  buy(sheet('A4', 210, 297), '2026-01-01', 25, 25);
  const [cartridge] = ledger.ink().cartridges;
  ledger.deleteInkPurchase(cartridge.purchases[0].id);
  assert.deepEqual([job(1).paper_micros, job(1).ink_micros, job(1).total_micros], [GBP, 0, null], 'paper is known but ink is not, so the total stays unknown');
  const { overall } = ledger.totals();
  assert.deepEqual([overall.jobs, overall.unknown_jobs, overall.unknown_paper_jobs, overall.unknown_ink_jobs], [2, 2, 0, 2]);
});

test('totals per day and per paper leave hidden jobs out; remaining stock per item and cartridge', t => {
  const { db, ledger, paper, sheet, buy } = fixture(t, [{ day: '2026-02-01' }, { day: '2026-02-01', time: '110000' }, { day: '2026-02-02', imp: 3 }, { day: '2026-02-02', media: OTHER }]);
  buy(sheet('A4', 210, 297), '2026-01-01', 25, 25);
  db.annotateJob(2, { hidden: 1 });
  const totals = ledger.totals();
  assert.deepEqual(totals.days.map(day => [day.date, day.jobs, day.paper_micros]), [['2026-02-02', 2, 3 * GBP], ['2026-02-01', 1, GBP]]);
  assert.deepEqual(totals.papers.map(row => [row.paper_id, row.jobs, row.unknown_jobs, row.paper_micros]), [[paper, 2, 0, 4 * GBP], [null, 1, 1, 0]]);
  assert.equal(ledger.papers().papers[0].stock[0].remaining, 25 - 5, 'hidden prints still use stock');
  const [cyan] = ledger.ink().cartridges;
  assert.equal(cyan.remaining, 160_000_000 - 4 * 125_000);
  assert.deepEqual([cyan.open_purchase_id, cyan.open_remaining_nl, cyan.spares, cyan.jobs], [cyan.purchases[0].id, 80_000_000 - 4 * 125_000, 1, 4],
    'the second cartridge of the pack is a spare; hidden prints still used ink');
  assert.deepEqual(ledger.ink().channels, ['C', 'CO']);
});

test('search covers job names, papers and notes', t => {
  const { db, ledger, sheet, buy } = fixture(t, [{ day: '2026-02-01', name: 'TC9.18 RGB iSis(A4).tif' }, { day: '2026-02-02' }, { day: '2026-02-03', media: OTHER }]);
  buy(sheet('A4', 210, 297), '2026-01-01', 25, 25);
  db.annotateJob(2, { notes: 'Edition 1/10 for the gallery' });
  const ids = (q: string) => ledger.jobs({ q }).jobs.map(job => job.job_id);
  assert.deepEqual(ids('edition'), [2]); assert.deepEqual(ids('isis'), [1]);
  assert.deepEqual(ids('museum'), [2, 1]); assert.deepEqual(ids('configured stock'), [3, 2, 1]);
  db.annotateJob(2, { hidden: 1 });
  assert.deepEqual(ids('edition'), []); assert.equal(ledger.jobs({ q: 'edition', includeHidden: true }).total, 1);
});

test('stock records validate shape, references and use', t => {
  const { ledger, paper, sheet, cyan } = fixture(t, [{ day: '2026-02-01' }]);
  const a4 = sheet('A4', 210, 297);
  const code = (action: () => unknown) => { try { action(); } catch (error) { return error instanceof LedgerError ? error.message : 'invalid'; } return 'ok'; };
  assert.equal(code(() => ledger.createPaperPurchase({ paper_stock_id: a4, purchased_on: '2026-01-01', length_um: 1000, price_micros: 1 })), 'purchase_does_not_match_stock');
  assert.equal(code(() => ledger.createPaperPurchase({ paper_stock_id: 999, purchased_on: '2026-01-01', packs: 1, sheets_per_pack: 1, price_micros: 1 })), 'unknown_reference');
  assert.equal(code(() => ledger.createPaperPurchase({ paper_stock_id: a4, purchased_on: '2026-02-30', packs: 1, sheets_per_pack: 1, price_micros: 1 })), 'invalid');
  assert.equal(code(() => ledger.createPaper({ name: 'Museum Etching' })), 'already_exists');
  assert.equal(code(() => ledger.createStock({ paper_id: paper, name: 'Roll', format: 'roll', width_um: 1, height_um: 5 } as never)), 'invalid');
  assert.equal(code(() => ledger.updateStock(a4, { height_um: 300000, deckle: true })), 'ok');
  assert.equal(code(() => ledger.createWriteOff({ ink_product_id: cyan, paper_stock_id: a4, written_off_on: '2026-01-01', quantity: 1 })), 'invalid');
  assert.equal(code(() => ledger.createWriteOff({ paper_stock_id: a4, written_off_on: '2026-01-01' })), 'invalid');
  const off = ledger.createWriteOff({ paper_stock_id: a4, written_off_on: '2026-01-01', quantity: 1 });
  assert.equal(code(() => ledger.updateWriteOff(off, { all_remaining: true })), 'ok');
  assert.equal(code(() => ledger.updateWriteOff(off, { quantity: 2 })), 'ok');
  assert.equal(code(() => ledger.deleteStock(a4)), 'in_use'); assert.equal(code(() => ledger.deletePaper(paper)), 'in_use');
  assert.equal(code(() => ledger.deleteWriteOff(off)), 'ok'); assert.equal(code(() => ledger.deleteWriteOff(off)), 'not_found');
  assert.equal(code(() => ledger.updatePaper(paper, { media_types: [OTHER, OTHER] })), 'invalid');
  ledger.updatePaper(paper, { media_types: [OTHER] });
  const media = ledger.mediaTypes().media_types;
  assert.deepEqual(media.map(m => [m.source_media_id, m.name, m.jobs, m.papers.map(p => p.name)]), [[MEDIA, 'Configured stock', 1, []], [OTHER, null, 0, ['Museum Etching']]]);
  assert.deepEqual(media.map(m => [m.first_job_on, m.last_job_on, m.totals.jobs, m.totals.unknown_jobs, m.totals.ink_nl, m.last_seen_at !== null]),
    [['2026-02-01', '2026-02-01', 1, 1, 125_000, true], [null, null, 0, 0, 0, false]], 'a media type carries its jobs\' dates and totals, and when it was last read');
});

test('using more than was bought draws the newest purchase below zero at its own price', t => {
  const { ledger, sheet, buy, job } = fixture(t, [{ day: '2026-02-01', imp: 4 }]);
  const a4 = sheet('A4', 210, 297);
  buy(a4, '2026-01-01', 1, 1); buy(a4, '2026-01-02', 2, 4);
  assert.deepEqual(job(1).paper.from.map(use => [use.quantity, use.cost_micros]), [[1, GBP], [3, 6 * GBP]]);
  assert.equal(ledger.papers().papers[0].stock[0].remaining, -1);
});

test('a set price splits by capacity in exact micros: floor shares, then the remainder by largest fraction', () => {
  assert.deepEqual(splitByWeight(120 * GBP, [80, 80, 80]), [40 * GBP, 40 * GBP, 40 * GBP], 'equal sizes split evenly');
  assert.deepEqual(splitByWeight(120 * GBP, [80, 160]), [40 * GBP, 80 * GBP], 'every ml costs the same');
  assert.deepEqual(splitByWeight(100, [1, 1, 1]), [34, 33, 33], 'ties go to the earlier part');
  assert.deepEqual(splitByWeight(10, [3, 5, 7]), [2, 3, 5], 'the remainder goes to the largest fraction (4.67)');
  assert.deepEqual(splitByWeight(0, [80, 130]), [0, 0]);
  for (const [total, weights] of [[Number.MAX_SAFE_INTEGER, [80_000_000, 80_000_000, 130_000_000]], [999_999_999, Array(12).fill(80_000_000)], [7, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]]] as [number, number[]][]) {
    const parts = splitByWeight(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), total, 'the parts add up to the total exactly');
    assert.ok(parts.every(part => Number.isSafeInteger(part) && part >= 0));
  }
});

test('a whole ink set is a purchase per cartridge at its share of the price, with missing products created alongside', t => {
  const { ledger, cyan, db } = fixture(t, []);
  const big = ledger.createCartridge({ name: 'PFI-1100 PBK', channel: 'PBK', capacity_nl: 160_000_000 });
  const set = ledger.purchaseInkSet({ ink_product_ids: [cyan, big], new_cartridges: { series: 'PFI-1100', capacity_nl: 80_000_000, channels: ['PM', 'Y'] },
    purchased_on: '2026-03-01', sets: 2, price_micros: 100 * GBP + 1 });
  assert.deepEqual(set.purchases.map(p => [p.channel, p.price_micros]), [['C', 20 * GBP], ['PBK', 40 * GBP + 1], ['PM', 20 * GBP], ['Y', 20 * GBP]],
    'by capacity (80 + 160 + 80 + 80 ml), the odd micro to the largest fraction');
  assert.equal(set.purchases.reduce((sum, p) => sum + p.price_micros, 0), 100 * GBP + 1);
  const cartridges = ledger.ink().cartridges;
  assert.deepEqual(cartridges.filter(c => ['PM', 'Y'].includes(c.channel)).map(c => [c.name, c.capacity_nl]), [['PFI-1100 PM', 80_000_000], ['PFI-1100 Y', 80_000_000]]);
  for (const p of set.purchases) {
    const cartridge = cartridges.find(c => c.id === p.ink_product_id)!, bought = cartridge.purchases.find(b => b.id === p.id)!;
    assert.deepEqual([bought.purchased_on, bought.cartridges, bought.price_micros], ['2026-03-01', 2, p.price_micros], 'several sets: each purchase is that many cartridges');
  }
  assert.equal(db.all('SELECT * FROM ink_purchases').length, 1 + 4);
});

test('a whole ink set is all or nothing, and validated', t => {
  const { ledger, cyan, db } = fixture(t, []);
  const counts = () => [db.all('SELECT * FROM ink_products').length, db.all('SELECT * FROM ink_purchases').length];
  const before = counts(), buy = (input: Record<string, unknown>) => ledger.purchaseInkSet({ purchased_on: '2026-03-01', sets: 1, price_micros: 60 * GBP, ink_product_ids: [cyan], ...input });
  const code = (action: () => unknown) => { try { action(); } catch (error) { return error instanceof LedgerError ? error.message : 'invalid'; } return 'ok'; };
  const newOnes = { series: 'PFI-1100', capacity_nl: 80_000_000, channels: ['PM', 'R'] };
  assert.equal(code(() => buy({ ink_product_ids: [cyan, 999], new_cartridges: newOnes })), 'unknown_reference', 'fails after the new products are inserted');
  assert.equal(code(() => buy({ new_cartridges: { ...newOnes, channels: ['PM', 'C'] } })), 'duplicate_channel', 'one cartridge per channel');
  // A failure part-way through (the third purchase) leaves neither the new products nor the purchases before it.
  db.run("CREATE TRIGGER forced_failure BEFORE INSERT ON ink_purchases WHEN (SELECT count(*) FROM ink_purchases) >= 3 BEGIN SELECT RAISE(ABORT, 'forced'); END");
  assert.notEqual(code(() => buy({ new_cartridges: newOnes })), 'ok');
  db.run('DROP TRIGGER forced_failure');
  assert.deepEqual(counts(), before, 'nothing was written');
  for (const input of [{ ink_product_ids: [] }, { ink_product_ids: [cyan, cyan] }, { sets: 0 }, { price_micros: -1 }, { price_micros: 1.5 }, { purchased_on: 'soon' },
    { new_cartridges: { ...newOnes, channels: [] } }, { new_cartridges: { ...newOnes, channels: ['PM', 'PM'] } }, { new_cartridges: { ...newOnes, channels: ['P M'] } },
    { new_cartridges: { ...newOnes, series: ' ' } }, { new_cartridges: { ...newOnes, capacity_nl: 0 } }, { extra: 1 }])
    assert.equal(code(() => buy(input)), 'invalid', JSON.stringify(input));
  assert.equal(code(() => ledger.purchaseInkSet({ purchased_on: '2026-03-01', sets: 1, ink_product_ids: [cyan] })), 'invalid', 'a price is required');
  assert.deepEqual(counts(), before);
  assert.equal(code(() => buy({ new_cartridges: newOnes })), 'ok');
  assert.deepEqual(counts(), [before[0] + 2, before[1] + 3]);
});
