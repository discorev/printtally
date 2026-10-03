import { expect, test } from 'bun:test';
import { waitFor, within } from '@testing-library/react';
import type { MediaTypeView, PaperPurchaseSetup, PaperPurchaseSetupResult, PaperView, Settings } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { mediaType, paper, paperPurchase, papers, settings, stock, totals } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { today } from '../../lib/format.ts';

const created: PaperPurchaseSetupResult = { paper_id: 1, paper_stock_id: 10, id: 31 };
const routes = (items: PaperView[] = [paper()], media: MediaTypeView[] = [], overrides: Partial<Settings> = {}) => ({
  'GET /papers': papers(items, { settings: settings(overrides) }), 'GET /settings': settings(overrides), 'GET /media-types': { media_types: media },
});

test('empty stock and printer media tabs explain what to set up', async () => {
  const api = fakeApi(routes([], []));
  const { screen, user } = await renderApp('/papers', api);
  expect(await screen.findByText('No papers yet. Add stock to set up your first paper.')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Add stock' })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Media' }));
  expect(await screen.findByText("No media types yet. They're read from the printer at each collection.")).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Add stock' })).toBeNull();
});

test('paper cost shows an unknown dash instead of zero when none of its prints can be costed', async () => {
  const unknown = paper({ totals: totals({ jobs: 2, unknown_jobs: 2, unknown_paper_jobs: 2 }) });
  const costed = paper({ id: 2, name: 'Costed paper', totals: totals({ jobs: 3, unknown_paper_jobs: 1, paper_micros: 2_500_000 }) });
  const { screen } = await renderApp('/papers/1', fakeApi(routes([unknown, costed], [], { currency: 'EUR' })));
  await screen.findByRole('option', { name: /Test paper/ });
  await waitFor(() => expect(screen.getByRole('option', { name: /Costed paper/ }).textContent).toContain('€2.50'));
  const list = screen.getByRole('listbox', { name: 'Papers' });
  expect(within(list).getByRole('option', { name: /Test paper/ }).textContent).toContain('—');
  expect(within(list).getByRole('option', { name: /Costed paper/ }).textContent).toContain('€2.50');
  expect(within(list).getByRole('option', { name: /Costed paper/ }).textContent).toContain('1 without a paper cost');
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  expect(docket.textContent).toContain('2 without a paper cost');
  expect(docket.textContent).toContain('—');
});

test('paper docket displays the stock, purchase ledger and server-calculated print cost', async () => {
  const item = paper({
    stock: [stock({ bought: 50, used: 23, wasted: 2, remaining: 25 })], purchases: [paperPurchase()],
    totals: totals({ jobs: 4, paper_micros: 6_500_000, waste_micros: 1_000_000, ink_nl: 1_500_000 }),
  });
  const { screen } = await renderApp('/papers/1', fakeApi(routes([item], [], { currency: 'EUR' })));
  await screen.findByRole('heading', { name: 'Test paper' });
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  await waitFor(() => expect(docket.textContent).toContain('€37.99'));
  expect(docket.textContent).toContain('bought 50 · used by prints 23 · written off 2');
  expect(docket.textContent).toContain('28 Sep 2026 · A4 · 2 × 25 sheets');
  expect(docket.textContent).toContain('€6.50');
  expect(screen.getByRole('option', { name: /Test paper/ }).textContent).toContain('€1.00 waste');
});

test('new paper from a print defaults its name to printer media and preserves the print date and size', async () => {
  let items: PaperView[] = [];
  const api = fakeApi({ ...routes([], [mediaType()]), 'GET /papers': () => papers(items),
    'POST /paper-purchases/setup': () => { items = [paper({ name: 'Hahnemühle Photo Rag' })]; return created; },
  });
  const { screen, user, router } = await renderApp('/papers/new?media=media-1&size=A3&date=2026-09-28', api);
  await screen.findByRole('textbox', { name: 'Paper name' });
  const docket = screen.getByRole('complementary', { name: 'Add stock' });
  const name = within(docket).getByRole('textbox', { name: 'Paper name' }) as HTMLInputElement;
  const size = within(docket).getByRole('combobox', { name: 'Size' }) as HTMLSelectElement;
  expect(name.value).toBe('Hahnemühle Photo Rag');
  expect(size.value).toBe('A3');
  expect((within(docket).getByLabelText('Date') as HTMLInputElement).value).toBe('2026-09-28');
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '37.99');
  await user.click(within(docket).getByRole('button', { name: 'Add stock' }));
  await waitFor(() => expect(api.sent('POST /paper-purchases/setup')).toHaveLength(1));
  expect(api.sent('POST /paper-purchases/setup')).toEqual([{
    paper: { name: 'Hahnemühle Photo Rag', media_types: ['media-1'] },
    stock: { format: 'sheet', name: 'A3', width_um: 297_000, height_um: 420_000, deckle: false },
    purchase: { purchased_on: '2026-09-28', packs: 1, sheets_per_pack: 25, price_micros: 37_990_000 },
  } satisfies PaperPurchaseSetup]);
  expect(await screen.findByText(/Added\. Prints from 28 Sep 2026 on are costed from it\./)).toBeTruthy();
  expect(router.state.location.pathname).toBe('/papers/1');
});

test('changing printer media fills an untouched paper name but keeps a custom name', async () => {
  const second = mediaType({ source_media_id: 'media-2', name: 'Canon Pro Luster' });
  const api = fakeApi({ ...routes([], [mediaType(), second]), 'POST /paper-purchases/setup': created });
  const { screen, user } = await renderApp('/papers/new', api);
  await screen.findByRole('combobox', { name: 'Paper' });
  const docket = screen.getByRole('complementary', { name: 'Add stock' });
  await user.selectOptions(within(docket).getByRole('combobox', { name: 'Paper' }), 'new');
  const name = within(docket).getByRole('textbox', { name: 'Paper name' }) as HTMLInputElement;
  const media = within(docket).getByRole('combobox', { name: 'Prints as' });
  await user.selectOptions(media, 'media-1');
  expect(name.value).toBe('Hahnemühle Photo Rag');
  await user.selectOptions(media, 'media-2');
  expect(name.value).toBe('Canon Pro Luster');
  await user.clear(name);
  await user.type(name, '  My test pack  ');
  await user.selectOptions(media, 'media-1');
  expect(name.value).toBe('  My test pack  ');
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '12');
  await user.click(within(docket).getByRole('button', { name: 'Add stock' }));
  await waitFor(() => expect(api.sent('POST /paper-purchases/setup')).toHaveLength(1));
  expect(api.sent('POST /paper-purchases/setup')[0]).toMatchObject({ paper: { name: 'My test pack', media_types: ['media-1'] } });
});

test('buying an existing sheet stock sends only its id and the pack quantity, not another stock item', async () => {
  const api = fakeApi({ ...routes(), 'POST /paper-purchases/setup': created });
  const { screen, user } = await renderApp('/papers/1?form=purchase&date=2026-09-20', api);
  await screen.findByRole('combobox', { name: 'Size or roll' });
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  expect((within(docket).getByRole('combobox', { name: 'Size or roll' }) as HTMLSelectElement).value).toBe('10');
  await user.clear(within(docket).getByRole('spinbutton', { name: 'Packs' }));
  const save = within(docket).getByRole('button', { name: 'Add stock' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.type(within(docket).getByRole('spinbutton', { name: 'Packs' }), '2');
  await user.clear(within(docket).getByRole('spinbutton', { name: 'Sheets per pack' }));
  await user.type(within(docket).getByRole('spinbutton', { name: 'Sheets per pack' }), '50');
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '19.95');
  expect(save.disabled).toBe(false);
  await user.click(save);
  await waitFor(() => expect(api.sent('POST /paper-purchases/setup')).toHaveLength(1));
  expect(api.sent('POST /paper-purchases/setup')).toEqual([{
    paper_stock_id: 10, purchase: { purchased_on: '2026-09-20', packs: 2, sheets_per_pack: 50, price_micros: 19_950_000 },
  } satisfies PaperPurchaseSetup]);
  expect(await within(docket).findByText(/Added\. Prints from 20 Sep 2026/)).toBeTruthy();
});

test('a new deckle-edge size is created with an existing paper in a single purchase', async () => {
  const api = fakeApi({ ...routes(), 'POST /paper-purchases/setup': created });
  const { screen, user } = await renderApp('/papers/1?form=purchase&size=A3&date=2026-09-22', api);
  await screen.findByRole('combobox', { name: 'Size or roll' });
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  expect((within(docket).getByRole('combobox', { name: 'Size or roll' }) as HTMLSelectElement).value).toBe('new');
  expect((within(docket).getByRole('combobox', { name: 'Size' }) as HTMLSelectElement).value).toBe('A3');
  await user.click(within(docket).getByRole('checkbox', { name: 'Deckle edge' }));
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '24');
  await user.click(within(docket).getByRole('button', { name: 'Add stock' }));
  await waitFor(() => expect(api.sent('POST /paper-purchases/setup')).toHaveLength(1));
  expect(api.sent('POST /paper-purchases/setup')).toEqual([{
    paper_id: 1, stock: { format: 'sheet', name: 'A3 deckle', width_um: 297_000, height_um: 420_000, deckle: true },
    purchase: { purchased_on: '2026-09-22', packs: 1, sheets_per_pack: 25, price_micros: 24_000_000 },
  } satisfies PaperPurchaseSetup]);
});

test('a roll purchase uses width and length in micrometres and refuses a zero length', async () => {
  const api = fakeApi({ ...routes(), 'POST /paper-purchases/setup': created });
  const { screen, user } = await renderApp('/papers/new', api);
  await screen.findByRole('combobox', { name: 'Paper' });
  const docket = screen.getByRole('complementary', { name: 'Add stock' });
  await user.selectOptions(within(docket).getByRole('combobox', { name: 'Paper' }), 'new');
  await user.type(within(docket).getByRole('textbox', { name: 'Paper name' }), 'Roll paper');
  await user.selectOptions(within(docket).getByRole('combobox', { name: 'Kind' }), 'roll');
  await user.selectOptions(within(docket).getByRole('combobox', { name: 'Width' }), '24');
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '46.25');
  const length = within(docket).getByRole('spinbutton', { name: 'Length (m)' });
  await user.clear(length);
  await user.type(length, '0');
  const save = within(docket).getByRole('button', { name: 'Add stock' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.clear(length);
  await user.type(length, '12.5');
  await user.click(save);
  await waitFor(() => expect(api.sent('POST /paper-purchases/setup')).toHaveLength(1));
  expect(api.sent('POST /paper-purchases/setup')).toEqual([{
    paper: { name: 'Roll paper', media_types: [] }, stock: { format: 'roll', name: '24" roll', width_um: 609_600 },
    purchase: { purchased_on: today(), length_um: 12_500_000, price_micros: 46_250_000 },
  }]);
});

test('a rejected purchase stays on the form without claiming stock was added, then can retry', async () => {
  let attempts = 0;
  const api = fakeApi({
    ...routes(), 'POST /paper-purchases/setup': () => ++attempts === 1 ? reply(422, { error: 'invalid_request' }) : created,
  });
  const { screen, user, router } = await renderApp('/papers/1?form=purchase&date=2026-09-20', api);
  await screen.findByRole('combobox', { name: 'Size or roll' });
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  const save = within(docket).getByRole('button', { name: 'Add stock' });
  await user.type(within(docket).getByRole('textbox', { name: 'Price paid' }), '19.95');
  await user.click(save);
  expect(await within(docket).findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(within(docket).queryByText(/Added\. Prints from/)).toBeNull();
  expect(router.state.location.search.form).toBe('purchase');
  await user.click(save);
  expect(await within(docket).findByText(/Added\. Prints from 20 Sep 2026/)).toBeTruthy();
  expect(api.sent('POST /paper-purchases/setup')).toHaveLength(2);
});

test('printer media mapping appends the selected type and reports a rejected change without replacing it', async () => {
  const first = mediaType({ source_media_id: 'media-1', name: 'Photo Rag', papers: [{ id: 1, name: 'Test paper' }] });
  const second = mediaType({ source_media_id: 'media-2', name: 'Pro Luster', jobs: 3 });
  const types = [first, second];
  let mappedIds = ['media-1'], attempts = 0;
  const api = fakeApi({
    ...routes([], types),
    'GET /papers': () => papers([paper({ media_types: mappedIds.map(id => ({ source_media_id: id, name: types.find(m => m.source_media_id === id)!.name })) })]),
    'PATCH /papers/1': async (request: Request) => {
      const body = await request.json() as { media_types: string[] };
      if (++attempts === 1) return reply(409, { error: 'unknown_reference' });
      mappedIds = body.media_types;
      return { updated: true };
    },
  });
  const { screen, user } = await renderApp('/papers/1', api);
  await screen.findByRole('combobox', { name: 'Add printer media' });
  const docket = screen.getByRole('complementary', { name: 'Paper' });
  const select = within(docket).getByRole('combobox', { name: 'Add printer media' });
  await within(docket).findByRole('option', { name: 'Pro Luster' });
  await user.selectOptions(select, 'media-2');
  expect(await within(docket).findByText('Not saved. Something it refers to no longer exists.')).toBeTruthy();
  expect(within(docket).getByText('Photo Rag')).toBeTruthy();
  expect(api.sent('PATCH /papers/1')).toEqual([{ media_types: ['media-1', 'media-2'] }]);
  await user.selectOptions(select, 'media-2');
  await waitFor(() => expect(within(docket).getByText('Pro Luster')).toBeTruthy());
  expect(within(docket).queryByText('Not saved. Something it refers to no longer exists.')).toBeNull();
  expect(api.sent('PATCH /papers/1')).toEqual(Array(2).fill({ media_types: ['media-1', 'media-2'] }));
  await user.click(within(docket).getAllByRole('button', { name: 'Remove' })[0]);
  await waitFor(() => expect(within(docket).queryByText('Photo Rag')).toBeNull());
  expect(within(docket).getByText('Pro Luster')).toBeTruthy();
  expect(api.sent('PATCH /papers/1')[2]).toEqual({ media_types: ['media-2'] });
});

test('unlinked printer media warns that prints have no paper cost and links back to stock', async () => {
  const m = mediaType({ jobs: 2, totals: totals({ jobs: 2, ink_micros: 3_000_000, total_micros: 3_000_000, unknown_paper_jobs: 2 }) });
  const { screen, user, router } = await renderApp('/papers/media/media-1', fakeApi(routes([], [m])));
  await screen.findByRole('option', { name: /Hahnemuehle Photo Rag/ });
  const list = screen.getByRole('listbox', { name: 'Printer media' });
  expect(within(list).getByRole('option', { name: /Hahnemuehle Photo Rag/ }).textContent).toContain('prints have no paper cost');
  await screen.findByRole('heading', { name: 'Hahnemuehle Photo Rag' });
  const docket = screen.getByRole('complementary', { name: 'Printer media' });
  expect(docket.textContent).toContain('No paper yet, so these prints have no paper cost');
  expect(docket.textContent).toContain('ink only — paper cost unknown');
  expect(docket.textContent).toContain('£3.00');
  await user.click(screen.getByRole('tab', { name: 'Stock' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/papers'));
});

test('removing a mistyped purchase needs confirmation and keeps it when the ledger refuses deletion', async () => {
  let purchases = [paperPurchase()], attempts = 0;
  const api = fakeApi({
    ...routes(),
    'GET /papers': () => papers([paper({ purchases })]),
    'DELETE /paper-purchases/31': () => {
      if (++attempts === 1) return reply(409, { error: 'in_use' });
      purchases = [];
      return { deleted: true };
    },
  });
  const { screen, user } = await renderApp('/papers/1', api);
  const docket = await screen.findByRole('complementary', { name: 'Paper' });
  await within(docket).findByText(/28 Sep 2026 · A4 · 2 × 25 sheets/);
  await user.click(within(docket).getByRole('button', { name: 'Remove' }));
  const confirm = within(docket).getByRole('group', { name: 'Remove this purchase' });
  expect(within(confirm).getByText(/Costs are worked out again without it/)).toBeTruthy();
  expect(api.requests.filter(r => r.path === '/paper-purchases/31')).toHaveLength(0);
  await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
  expect(await within(confirm).findByText('Not removed. Something still uses this purchase.')).toBeTruthy();
  expect(within(docket).getByText(/28 Sep 2026 · A4 · 2 × 25 sheets/)).toBeTruthy();
  await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
  expect(await within(docket).findByText('None yet.')).toBeTruthy();
  expect(api.requests.filter(r => r.method === 'DELETE' && r.path === '/paper-purchases/31')).toHaveLength(2);
});
