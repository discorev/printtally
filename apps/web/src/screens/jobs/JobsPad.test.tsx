import { expect, test } from 'bun:test';
import { waitFor, within } from '@testing-library/react';
import type { AllocationPreview, JobResponse, LedgerJob, PaperView } from 'print-accounting-contracts';
import { fakeApi, reply, type Routes } from '../../../test/api.ts';
import { archivedPrinter, jobsResponse, jobsScreenReads, mediaType, paper as basePaper, paperPurchase, papers, settings, stock, totals, totalsResponse } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const job = (overrides: Omit<Partial<LedgerJob>, 'paper'> & { paper?: Partial<LedgerJob['paper']> } = {}): LedgerJob => ({
  job_id: 1, printer_id: 1, source_record_id: 71,
  first_seen_at: '2026-09-12T11:15:00Z', last_seen_at: '2026-09-12T11:15:00Z',
  job_name: 'Edition one', job_owner: null, started_at_raw: '20260912111000', completed_at_raw: '20260912111500',
  completion_state: 'completed', job_type: null, width_um: 210_000, height_um: 297_000, used_area_mm2: null,
  impressions: 1, color_pages: 1, monochrome_pages: 0, duplex: null,
  source_media_id: 'etching', configured_paper_name: 'Printer Etching', paper_name_at_import: 'Printer Etching',
  display_paper_name: 'Printer Etching', hidden: 0, custom_paper_name: null, stock_override_id: null, paper_override_id: null,
  notes: null, record_id_collision: 0, date: '2026-09-12',
  ink: [{ channel: 'C', volume_nl: 500_000, cost_micros: 500_000, from: [] }],
  paper_micros: 2_000_000, ink_micros: 500_000, total_micros: 2_500_000,
  ...overrides,
  paper: { paper_id: 1, paper_name: 'Photo Rag', stock_id: 10, stock_name: 'A4', format: 'sheet', deckle: false,
    allocation: 'default', quantity: 1, cost_micros: 2_000_000, unknown_reason: null,
    from: [{ purchase_id: 100, purchased_on: '2026-01-10', quantity: 1, cost_micros: 2_000_000 }], ...overrides.paper },
});
const ragPurchase = paperPurchase({ id: 100, purchased_on: '2026-01-10', packs: 1, sheets_per_pack: 25, price_micros: 50_000_000, quantity: 25, remaining: 20 });
const photoRag = (overrides: Partial<PaperView> = {}): PaperView => basePaper({
  name: 'Photo Rag', media_types: [{ source_media_id: 'etching', name: 'Printer Etching' }],
  stock: [stock({ remaining: 20 })], purchases: [ragPurchase], totals: totals({ jobs: 1 }), ...overrides,
});
const preview = (overrides: Partial<AllocationPreview> = {}): AllocationPreview => ({
  paper: { ...job().paper, allocation: 'stock' }, remaining: 20, short: false, sized_stock_id: 10, ...overrides,
});
const media = (overrides: Parameters<typeof mediaType>[0] = {}) => mediaType({
  source_media_id: 'etching', name: 'Printer Etching', jobs: 1,
  papers: [{ id: 1, name: 'Photo Rag' }], first_job_on: '2026-09-12', last_job_on: '2026-09-12',
  last_seen_at: '2026-09-12T11:15:00Z', totals: totals({ jobs: 1 }), ...overrides,
});
const jobResponse = (item: LedgerJob): JobResponse => ({ job: item, settings: settings() });
const routes = (items: LedgerJob[], additional: Routes = {}, overall = totalsResponse()): Routes => jobsScreenReads(items, {
  'GET /totals': overall,
  'GET /papers': papers([photoRag()]),
  'GET /media-types': { media_types: [media()] },
  'GET /jobs/1': jobResponse(items.find(item => item.job_id === 1) ?? job()),
  ...additional,
});

test('an empty ledger explains how prints appear instead of showing a false total', async () => {
  const api = fakeApi(routes([]));
  const { screen } = await renderApp('/jobs', api);
  expect(await screen.findByText('No prints yet. Collect from the printer and they appear here.')).toBeTruthy();
  expect(within(screen.getByRole('listbox', { name: 'Prints' })).queryAllByRole('option').length).toBe(0);
});

test('monthly and overall totals omit hidden prints but show known cost and unknown-cost reasons', async () => {
  const known = job();
  const unknown = job({ job_id: 2, paper_micros: null, total_micros: null,
    paper: { paper_id: null, paper_name: null, stock_id: null, stock_name: null, format: null,
      cost_micros: null, unknown_reason: 'no_paper', from: [] },
    ink: [{ channel: 'C', volume_nl: 1_000_000, cost_micros: null, from: [] }], ink_micros: 0 });
  const hidden = job({ job_id: 3, hidden: 1, notes: 'Hidden proof', total_micros: 30_000_000 });
  const api = fakeApi(routes([known, unknown, hidden], {
    'GET /jobs?includeHidden=true&limit=1000': jobsResponse([known, unknown, hidden]),
  }, totalsResponse(totals({ jobs: 2, unknown_jobs: 1, unknown_paper_jobs: 1, unknown_ink_jobs: 1, total_micros: 2_500_000 }),
    [{ ...totals({ jobs: 2 }), date: '2026-09-12' }])));
  const { screen } = await renderApp('/jobs?hidden=true', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(3));
  expect(list.textContent).toContain('2 prints · 1.50 ml · £2.50');
  expect(list.textContent).toContain('1 without a paper cost · 1 without an ink cost');
  expect(list.textContent).toContain('no paper set up');
  expect(list.textContent).toContain('hidden');
  expect(screen.getByRole('heading', { name: 'Jobs' }).parentElement?.textContent).toContain('2 prints');
  expect(screen.getByRole('heading', { name: 'Jobs' }).parentElement?.textContent).toContain('£2.50');
  expect(api.requests.some(request => request.path === '/jobs?includeHidden=true&limit=1000')).toBe(true);
});

test('URL paper and media filters select prints without changing the server query', async () => {
  const first = job(), second = job({ job_id: 2, source_media_id: 'luster',
    paper: { paper_id: 2, paper_name: 'Lustre' } });
  const api = fakeApi(routes([first, second], {
    'GET /papers': papers([photoRag(), photoRag({ id: 2, name: 'Lustre', media_types: [] })]),
    'GET /media-types': { media_types: [media(), media({ source_media_id: 'luster', name: 'Printer Lustre', papers: [] })] },
  }));
  const { screen, router, user } = await renderApp('/jobs?paper=2', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  expect(await within(list).findByRole('option', { name: /Lustre/ })).toBeTruthy();
  expect(within(list).queryByRole('option', { name: /Photo Rag/ })).toBeNull();
  expect((screen.getByRole('combobox', { name: 'Paper' }) as HTMLSelectElement).value).toBe('2');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Paper' }), '');
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(2));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Paper' }), 'media:luster');
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(1));
  expect(within(list).getByRole('option', { name: /Lustre/ })).toBeTruthy();
  expect(router.state.location.search.paper).toBeUndefined();
  expect(router.state.location.search.media).toBe('luster');
  expect(api.requests.filter(request => request.path === '/jobs?includeHidden=false&limit=1000').length).toBe(1);
});

test('typing a search stores it in the URL, queries the server, and explains no matches', async () => {
  const api = fakeApi(routes([job()], { 'GET /jobs?q=absent&includeHidden=false&limit=1000': jobsResponse([], { total: 1 }) }));
  const { screen, user, router } = await renderApp('/jobs', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  expect(await within(list).findByRole('option', { name: /Photo Rag/ })).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: 'Search notes, papers and job names' }), 'absent');
  await waitFor(() => expect(router.state.location.search.q).toBe('absent'));
  expect(await screen.findByText('No prints match. Clear the search or choose another paper or printer.')).toBeTruthy();
  expect(api.requests.some(request => request.path === '/jobs?q=absent&includeHidden=false&limit=1000')).toBe(true);
});

test('a selected print shows ledger costing and printer data, then returns to the same filtered list', async () => {
  const current = job({ notes: 'Edition 1 / 5' });
  const api = fakeApi(routes([current], { 'GET /jobs/1': jobResponse(current) }));
  const { screen, user, router } = await renderApp('/jobs/1?paper=1', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  await within(list).findByRole('option', { name: /Photo Rag/ });
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  expect(await within(docket).findByRole('heading', { name: /A4 · Photo Rag/ })).toBeTruthy();
  expect(within(docket).getByLabelText('Costing sheet').textContent).toContain('£2.00');
  expect(docket.textContent).toContain('This print£2.50');
  expect(docket.textContent).toContain('Edition 1 / 5');
  expect(docket.textContent).toContain('11:10 – 11:15');
  expect(docket.textContent).toContain('5 min 0 s');
  expect(docket.textContent).toContain('Printer Etching');
  expect(docket.textContent).toContain('From the pack bought 10 Jan 2026');
  expect(docket.textContent).not.toContain('Studio printer');
  await user.click(within(docket).getByRole('link', { name: 'Close (Esc)' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
  expect(router.state.location.search.paper).toBe(1);
});

test('a missing print reports the server error instead of displaying an invented docket', async () => {
  const api = fakeApi(routes([], { 'GET /jobs/42': reply(404, { error: 'job_not_found' }) }));
  const { screen } = await renderApp('/jobs/42', api);
  expect(await screen.findByText('No prints yet. Collect from the printer and they appear here.')).toBeTruthy();
  expect(await screen.findByRole('heading', { name: /This print isn’t available/ })).toBeTruthy();
  expect(screen.getByText('That print no longer exists.')).toBeTruthy();
});

test('a rejected note save keeps the draft and blocks closing until a retry succeeds', async () => {
  let current = job(), reject = true;
  const api = fakeApi(routes([current], {
    'GET /jobs/1': () => jobResponse(current),
    'PATCH /jobs/1/annotation': () => reject ? reply(422, { error: 'invalid_request' })
      : jobResponse(current = job({ notes: 'Gallery proof' })),
  }));
  const { screen, user, router } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  const note = await within(docket).findByRole('textbox', { name: 'Note' });
  await user.type(note, '  Gallery proof  ');
  await user.click(within(docket).getByRole('heading', { name: /Photo Rag/ }));
  expect(await within(docket).findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect((note as HTMLTextAreaElement).value).toBe('  Gallery proof  ');
  expect(docket.textContent).not.toMatch(/Saved \d/);
  await user.click(within(docket).getByRole('link', { name: 'Close (Esc)' }));
  await waitFor(() => expect(api.sent('PATCH /jobs/1/annotation')).toEqual(Array(2).fill({ notes: 'Gallery proof' })));
  expect(router.state.location.pathname).toBe('/jobs/1');

  reject = false;
  await user.click(note);
  await user.tab();
  expect(await within(docket).findByText(/^Saved \d/)).toBeTruthy();
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual(Array(3).fill({ notes: 'Gallery proof' }));
  await user.click(within(docket).getByRole('link', { name: 'Close (Esc)' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
});

test('hiding and showing a print updates the durable log and totals without deleting it', async () => {
  let current = job();
  const api = fakeApi(routes([current], {
    'GET /jobs?includeHidden=false&limit=1000': () => jobsResponse(current.hidden ? [] : [current], { total: 1 }),
    'GET /jobs/1': () => jobResponse(current),
    'GET /totals': () => totalsResponse(totals({ jobs: current.hidden ? 0 : 1, total_micros: current.hidden ? 0 : 2_500_000 })),
    'PATCH /jobs/1/annotation': async (request: Request) => {
      const hidden = await request.json() as { hidden: 0 | 1 };
      current = job({ hidden: hidden.hidden });
      return jobResponse(current);
    },
  }));
  const { screen, user } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  const hide = await within(docket).findByRole('button', { name: 'Hide job' });
  await user.click(hide);
  expect(await within(docket).findByRole('button', { name: 'Show job' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Jobs' }).parentElement?.textContent).toContain('0 prints'));
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ hidden: 1 }]);
  await user.click(within(docket).getByRole('button', { name: 'Show job' }));
  expect(await within(docket).findByRole('button', { name: 'Hide job' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Jobs' }).parentElement?.textContent).toContain('1 print'));
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ hidden: 1 }, { hidden: 0 }]);
});

test('paper correction waits for ledger preview, warns about missing stock, and reports rejected saves', async () => {
  let current = job(), attempts = 0;
  let resolvePreview!: (value: AllocationPreview) => void;
  const pendingPreview = new Promise<AllocationPreview>(resolve => { resolvePreview = resolve; });
  const corrected = job({ paper_micros: null, total_micros: null,
    paper: { paper_id: 2, paper_name: 'Lustre', stock_id: null, stock_name: null, format: null,
      allocation: 'paper', cost_micros: null, unknown_reason: 'no_matching_stock', from: [] } });
  const api = fakeApi(routes([current], {
    'GET /papers': papers([photoRag(), photoRag({ id: 2, name: 'Lustre', media_types: [], stock: [], purchases: [] })]),
    'GET /jobs/1': () => jobResponse(current),
    'GET /jobs/1/allocation-preview?paper_id=2': () => pendingPreview,
    'PATCH /jobs/1/annotation': () => ++attempts === 1 ? reply(422, { error: 'invalid_request' })
      : jobResponse(current = corrected),
  }));
  const { screen, user } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  await user.click(await within(docket).findByRole('button', { name: 'Correct paper' }));
  const picker = within(docket).getByRole('radiogroup', { name: 'Paper' });
  const save = within(docket).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.click(within(picker).getByRole('radio', { name: /Lustre/ }));
  await waitFor(() => expect(api.requests.some(request => request.path === '/jobs/1/allocation-preview?paper_id=2')).toBe(true));
  expect(save.disabled).toBe(true);
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([]);

  resolvePreview(preview({ paper: { ...corrected.paper }, remaining: null, sized_stock_id: null }));
  expect(await within(docket).findByText('No A4 stock')).toBeTruthy();
  const saveAnyway = within(docket).getByRole('button', { name: 'Save anyway' }) as HTMLButtonElement;
  await waitFor(() => expect(saveAnyway.disabled).toBe(false));
  await user.click(saveAnyway);
  expect(await within(docket).findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(within(docket).getByRole('radiogroup', { name: 'Paper' })).toBeTruthy();
  expect(docket.textContent).not.toContain('Paper corrected');
  await user.click(saveAnyway);
  expect(await within(docket).findByText('Paper corrected')).toBeTruthy();
  expect(within(docket).queryByRole('radiogroup', { name: 'Paper' })).toBeNull();
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ paper_id: 2 }, { paper_id: 2 }]);
});

test('changing stock previews a shortage before saving the selected stock item', async () => {
  let current = job();
  const otherStock = stock({ id: 11, name: 'Deckle A4', remaining: 1, deckle: true });
  const changed = job({ paper_micros: 3_000_000, total_micros: 3_500_000,
    paper: { stock_id: 11, stock_name: 'Deckle A4', allocation: 'stock', cost_micros: 3_000_000, deckle: true } });
  const api = fakeApi(routes([current], {
    'GET /papers': papers([photoRag({ stock: [stock(), otherStock],
      purchases: [ragPurchase, paperPurchase({ id: 101, paper_stock_id: 11, purchased_on: '2026-01-10', remaining: 1 })] })]),
    'GET /jobs/1': () => jobResponse(current),
    'GET /jobs/1/allocation-preview?paper_stock_id=11': preview({
      paper: { ...changed.paper, quantity: 2 }, remaining: 1, short: true, sized_stock_id: 11,
    }),
    'PATCH /jobs/1/annotation': () => jobResponse(current = changed),
  }));
  const { screen, user } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  await user.click(await within(docket).findByRole('button', { name: 'Change stock' }));
  const choices = within(docket).getByRole('radiogroup', { name: 'Stock' });
  const save = within(docket).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.click(within(choices).getByRole('radio', { name: /Deckle A4/ }));
  expect(await within(docket).findByText('Not enough stock')).toBeTruthy();
  expect(docket.textContent).toContain('Only 1 Deckle A4 sheet of Photo Rag left');
  await user.click(within(docket).getByRole('button', { name: 'Save anyway' }));
  expect(await within(docket).findByText(/^Stock changed · saved/)).toBeTruthy();
  expect(docket.textContent).toContain('Deckle A4 · Photo Rag');
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ paper_stock_id: 11 }]);
});

test('clearing a paper correction restores printer-media allocation rather than assigning a different paper', async () => {
  let current = job({ paper: { allocation: 'paper', paper_id: 2, paper_name: 'Lustre', stock_id: null, stock_name: null } });
  const api = fakeApi(routes([current], {
    'GET /jobs/1': () => jobResponse(current),
    'GET /papers': papers([photoRag(), photoRag({ id: 2, name: 'Lustre', media_types: [] })]),
    'PATCH /jobs/1/annotation': () => jobResponse(current = job()),
  }));
  const { screen, user } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  await user.click(await within(docket).findByRole('button', { name: 'Use the default' }));
  expect(await within(docket).findByText(/^Using the default · saved/)).toBeTruthy();
  await waitFor(() => expect(within(docket).getByRole('heading', { name: /Photo Rag/ })).toBeTruthy());
  expect(within(docket).queryByText('Paper corrected')).toBeNull();
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ paper_id: null, paper_stock_id: null }]);
});

test('Show hidden fetches hidden prints and turning it off restores the visible list', async () => {
  const visible = job(), hidden = job({ job_id: 2, hidden: 1, job_name: 'Hidden proof' });
  const api = fakeApi(routes([visible], {
    'GET /jobs?includeHidden=true&limit=1000': jobsResponse([visible, hidden]),
  }));
  const { screen, user, router } = await renderApp('/jobs', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  await within(list).findByRole('option');
  await user.click(screen.getByRole('checkbox', { name: 'Show hidden' }));
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
  expect(router.state.location.search.hidden).toBe(true);
  expect(api.requests.filter(r => r.path === '/jobs?includeHidden=true&limit=1000')).toHaveLength(1);
  await user.click(screen.getByRole('checkbox', { name: 'Show hidden' }));
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
  expect(router.state.location.search.hidden).toBeUndefined();
});

test('an uncosted print opens a new stock purchase prefilled with its media, size and date', async () => {
  const unknown = job({ paper_micros: null, total_micros: null,
    paper: { paper_id: null, paper_name: null, stock_id: null, stock_name: null, format: null,
      cost_micros: null, unknown_reason: 'no_paper', from: [] },
  });
  const api = fakeApi(routes([unknown], { 'GET /papers': papers([]) }));
  const { screen, user, router } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  await user.click(await screen.findByRole('link', { name: 'Add a purchase' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/papers/new'));
  expect(router.state.location.search).toMatchObject({ media: 'etching', size: 'A4', date: '2026-09-12' });
  expect((await screen.findByRole('combobox', { name: 'Size' }) as HTMLSelectElement).value).toBe('A4');
  expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-09-12');
});

test('Discard changes abandons an unsaved note instead of retrying it on close', async () => {
  const current = job();
  const api = fakeApi(routes([current], {
    'PATCH /jobs/1/annotation': reply(422, { error: 'invalid_request' }),
  }));
  const { screen, user, router } = await renderApp('/jobs/1', api);
  await within(await screen.findByRole('listbox', { name: 'Prints' })).findByRole('option');
  const docket = await screen.findByRole('complementary', { name: 'Print docket' });
  const note = await within(docket).findByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
  await user.type(note, 'Draft note');
  await user.tab();
  await within(docket).findByText('Not saved. Check the form and try again.');
  await user.click(within(docket).getByRole('button', { name: 'Discard changes' }));
  expect(note.value).toBe('');
  expect(within(docket).queryByRole('button', { name: 'Discard changes' })).toBeNull();
  await user.click(within(docket).getByRole('link', { name: 'Close (Esc)' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ notes: 'Draft note' }]);
});

test('j/k navigate the list and h hides the selected print without hijacking a note field', async () => {
  const first = job(), second = job({ job_id: 2, job_name: 'Edition two', date: '2026-09-11' });
  let selected = first;
  const api = fakeApi(routes([first, second], {
    'GET /jobs/1': () => jobResponse(selected),
    'GET /jobs/2': jobResponse(second),
    'PATCH /jobs/1/annotation': () => jobResponse(selected = job({ hidden: 1 })),
  }));
  const { screen, user, router } = await renderApp('/jobs', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
  list.focus();
  await user.keyboard('j');
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/1'));
  await user.keyboard('j');
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/2'));
  await user.keyboard('k');
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/1'));
  await user.keyboard('h');
  await waitFor(() => expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ hidden: 1 }]));
  expect(await screen.findByRole('button', { name: 'Show job' })).toBeTruthy();
  const note = screen.getByRole('textbox', { name: 'Note' });
  await user.click(note);
  await user.keyboard('h');
  expect((note as HTMLTextAreaElement).value).toBe('h');
  expect(api.sent('PATCH /jobs/1/annotation')).toEqual([{ hidden: 1 }]);
});

const studio = job(), office = job({ job_id: 2, printer_id: 2, notes: 'Office proof' });
const twoPrinters = {
  'GET /printers': { printers: [archivedPrinter(), archivedPrinter({ id: 2, name: 'Office PRO-1100 (dev seed)', host: '192.168.1.43', known_printer_id: 'printer-2' })] },
  'GET /jobs?printer=2&includeHidden=false&limit=1000': jobsResponse([office]),
};

test('with one printer there is no printer filter and rows are not tagged', async () => {
  const api = fakeApi(routes([studio, office]));
  const { screen } = await renderApp('/jobs', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(2));
  await waitFor(() => expect(api.requests.some(request => request.path === '/printers')).toBe(true));
  expect(screen.queryByRole('combobox', { name: 'Printer' })).toBeNull();
  expect(list.textContent).not.toContain('Studio printer');
});

test('with several printers, rows name their printer until one is chosen, which filters the list and goes in the URL', async () => {
  const api = fakeApi(routes([studio, office], twoPrinters));
  const { screen, user, router } = await renderApp('/jobs', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  const printer = await screen.findByRole('combobox', { name: 'Printer' }) as HTMLSelectElement;
  expect([...printer.options].map(option => option.text)).toEqual(['All printers', 'Studio printer', 'Office PRO-1100 (dev seed)']);
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(2));
  const [newest, older] = within(list).getAllByRole('option');
  const tag = within(newest).getByText('Office PRO-1100 (dev seed)');
  expect(tag.tagName).toBe('SPAN');
  expect(tag.className).toContain('border-rule');
  expect(tag.className).toContain('rounded-[2px]');
  expect(tag.className).toContain('text-[12px]');
  expect(tag.className).toContain('text-muted');
  expect(tag.className).not.toContain('uppercase');
  expect(older.textContent).toContain('Studio printer');

  await user.selectOptions(printer, '2');
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(1));
  expect(router.state.location.search.printer).toBe(2);
  expect(list.textContent).toContain('Office proof');
  expect(list.textContent).not.toContain('Office PRO-1100');
  expect(api.requests.some(request => request.path === '/jobs?printer=2&includeHidden=false&limit=1000')).toBe(true);

  await user.selectOptions(printer, '');
  await waitFor(() => expect(within(list).getAllByRole('option').length).toBe(2));
  expect(router.state.location.search.printer).toBeUndefined();
});

test('a stale printer filter stays visible and filtered while printers load, then can be cleared', async () => {
  let resolvePrinters!: (value: { printers: ReturnType<typeof archivedPrinter>[] }) => void;
  const pendingPrinters = new Promise<{ printers: ReturnType<typeof archivedPrinter>[] }>(resolve => { resolvePrinters = resolve; });
  const api = fakeApi(routes([studio], {
    'GET /printers': () => pendingPrinters,
    'GET /jobs?printer=999&includeHidden=false&limit=1000': jobsResponse([]),
  }));
  const { screen, user, router } = await renderApp('/jobs?printer=999', api);
  const list = await screen.findByRole('listbox', { name: 'Prints' });
  const printer = screen.getByRole('combobox', { name: 'Printer' });
  expect(await screen.findByText('No prints match. Clear the search or choose another paper or printer.')).toBeTruthy();
  expect(within(list).queryAllByRole('option')).toEqual([]);
  expect(api.requests.some(request => request.path === '/jobs?printer=999&includeHidden=false&limit=1000')).toBe(true);
  expect((printer as HTMLSelectElement).value).toBe('999');
  resolvePrinters({ printers: [archivedPrinter()] });
  expect(await within(printer).findByRole('option', { name: 'Printer not found', selected: true })).toBeTruthy();
  await user.selectOptions(printer, '');
  await waitFor(() => expect(router.state.location.search.printer).toBeUndefined());
  expect(await within(list).findByRole('option', { name: /Photo Rag/ })).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Printer' })).toBeNull());
});

test('with several printers, the docket says which printer a print came from', async () => {
  const api = fakeApi(routes([studio, office], { ...twoPrinters, 'GET /jobs/2': jobResponse(office) }));
  const { screen } = await renderApp('/jobs/2?printer=2', api);
  // The docket is replaced once the print loads, so find it by its heading.
  const heading = await screen.findByRole('heading', { name: /On Office PRO-1100 \(dev seed\) · 0.50 ml of ink/ });
  const docket = heading.closest('aside')!;
  expect(docket.textContent).toContain('PrinterOffice PRO-1100 (dev seed) · 192.168.1.43');
});
