import { expect, test } from 'bun:test';
import type { AllocationPreview, InkLine, LedgerJob, PaperView } from 'print-accounting-contracts';
import { jobKnownMicros, unknownCostReason } from '../../lib/jobs.ts';
import { matchesFilter, validateJobsSearch } from './search.ts';
import { paperState, stockChoices, stockWarning } from './paper.ts';

const job = (patch: Omit<Partial<LedgerJob>, 'paper'> & { paper?: Partial<LedgerJob['paper']> } = {}): LedgerJob => ({
  job_id: 1, date: '2026-09-12', width_um: 210000, height_um: 297000, source_media_id: 'etching', hidden: 0, ...patch,
  paper: { paper_id: 1, allocation: 'default', stock_id: 1, ...patch.paper },
} as LedgerJob);
const stock = (id: number, format: 'sheet' | 'roll', width_um: number, height_um: number | null, deckle = false) =>
  ({ id, paper_id: 1, name: String(id), format, width_um, height_um, deckle }) as PaperView['stock'][number];
const paper = (id: number, media: string[], items: PaperView['stock'] = [], bought: [number, string][] = []): PaperView => ({
  id, name: `Paper ${id}`, media_types: media.map(source_media_id => ({ source_media_id, name: null })), stock: items,
  purchases: bought.map(([paper_stock_id, purchased_on], index) => ({ id: index + 1, paper_stock_id, purchased_on })),
} as PaperView);

const ink = (cost_micros: number | null): InkLine => ({ channel: 'C', volume_nl: 100, cost_micros, from: [] });

test('a row’s known cost sums paper and known ink, and its tag blames the paper first', () => {
  const both = job({ paper_micros: 1_000_000, ink_micros: 46_875, ink: [ink(46_875)] });
  expect(jobKnownMicros(both)).toBe(1_046_875); expect(unknownCostReason(both)).toBeNull();

  const noPaper = job({ paper_micros: null, ink_micros: 46_875, ink: [ink(46_875)], paper: { unknown_reason: 'no_paper' } });
  expect(jobKnownMicros(noPaper)).toBe(46_875); expect(unknownCostReason(noPaper)).toBe('no paper set up');

  const noInk = job({ paper_micros: 1_000_000, ink_micros: 0, ink: [ink(null)] });
  expect(jobKnownMicros(noInk)).toBe(1_000_000); expect(unknownCostReason(noInk)).toBe('no ink cost');

  const neither = job({ paper_micros: null, ink_micros: 0, ink: [ink(null)], paper: { unknown_reason: 'no_matching_stock' } });
  expect(jobKnownMicros(neither)).toBe(0); expect(unknownCostReason(neither)).toBe('no stock for this size');
});

test('the jobs filter lives in the URL and ignores junk', () => {
  expect(validateJobsSearch({ q: 'gallery', paper: 3, hidden: true })).toEqual({ q: 'gallery', paper: 3, media: undefined, hidden: true });
  expect(validateJobsSearch({ q: '', paper: 'abc', media: 42, hidden: 'no' })).toEqual({ q: undefined, paper: undefined, media: '42', hidden: undefined });
  expect([matchesFilter(job(), { paper: 1 }), matchesFilter(job(), { paper: 2 }), matchesFilter(job(), { media: 'etching' }), matchesFilter(job(), {})])
    .toEqual([true, false, true, true]);
});

test('a paper reads as corrected when chosen, and assumed when several papers print as the media', () => {
  const own = paper(1, ['etching']), other = paper(2, ['etching']), unrelated = paper(3, ['luster']);
  expect(paperState(job(), [own])).toBeNull();
  expect(paperState(job(), [own, other])).toBe('assumed');
  expect(paperState(job({ paper: { allocation: 'paper' } }), [own])).toBe('corrected');
  expect(paperState(job({ paper: { allocation: 'stock', paper_id: 1 } }), [own])).toBeNull();
  expect(paperState(job({ paper: { allocation: 'stock', paper_id: 3 } }), [own, unrelated])).toBe('corrected');
});

test('stock choices are sheets of the size either way round or a roll of its width, bought by the day', () => {
  const items = [stock(1, 'sheet', 210000, 297000), stock(2, 'sheet', 297000, 210000, true), stock(3, 'roll', 210000, null),
    stock(4, 'sheet', 297000, 420000), stock(5, 'sheet', 210000, 297000)];
  const p = paper(1, ['etching'], items, [[1, '2026-01-10'], [2, '2026-02-01'], [3, '2026-09-12'], [4, '2026-01-01'], [5, '2026-10-01']]);
  expect(stockChoices(job(), p).map(item => item.id)).toEqual([1, 2, 3]);
  expect(stockChoices(job(), undefined)).toEqual([]);
});

test('a correction warns when the stock won’t cover the print, and says why', () => {
  const preview = (paper: Partial<AllocationPreview['paper']>, remaining: number | null = null, short = false): AllocationPreview => ({
    paper: { paper_id: 1, paper_name: 'Photo Rag', stock_id: null, stock_name: null, format: null, deckle: false, allocation: 'paper',
      quantity: 1, cost_micros: null, unknown_reason: null, from: [], ...paper }, remaining, short, sized_stock_id: null });
  expect(stockWarning(job(), preview({ unknown_reason: 'no_matching_stock' }))?.text).toBe('Photo Rag has no A4 sheets or matching roll, so the print’s paper cost would be unknown.');
  expect(stockWarning(job(), preview({ unknown_reason: 'no_stock_by_date' }))?.text).toBe('Photo Rag has no A4 bought by 12 Sep 2026, so the print’s paper cost would be unknown.');
  const a4 = { stock_id: 1, stock_name: 'A4', format: 'sheet' as const, cost_micros: 1 };
  expect(stockWarning(job(), preview({ ...a4, quantity: 2 }, 1, true))?.text).toBe('Only 1 A4 sheet of Photo Rag left by 12 Sep 2026, so this print (2 sheets) takes it below zero.');
  expect(stockWarning(job(), preview(a4, 0, true))?.text).toBe('No A4 sheets of Photo Rag left by 12 Sep 2026, so this print (1 sheet) takes it below zero.');
  expect(stockWarning(job(), preview(a4, 20))).toBeNull();
  expect(stockWarning(job(), preview({ unknown_reason: 'unknown_usage', quantity: null }))).toBeNull();
});
