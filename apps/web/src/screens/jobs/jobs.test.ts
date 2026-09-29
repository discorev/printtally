import { expect, test } from 'bun:test';
import type { LedgerJob, PaperView } from 'print-accounting-contracts';
import { matchesFilter, validateJobsSearch } from './search.ts';
import { paperState, stockChoices } from './paper.ts';

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
