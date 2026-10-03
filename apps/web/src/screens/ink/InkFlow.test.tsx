import { expect, test } from 'bun:test';
import { waitFor, within } from '@testing-library/react';
import type { CartridgeView, InkPurchaseView, InkResponse, WriteOffPreview, WriteOffView } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { settings, totals } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { today } from '../../lib/format.ts';

const purchase = (overrides: Partial<InkPurchaseView> = {}): InkPurchaseView => ({
  id: 21, ink_product_id: 1, purchased_on: '2026-09-01', cartridges: 2, price_micros: 72_000_000,
  remaining_nl: 140_000_000, ...overrides,
});
const cartridge = (overrides: Partial<CartridgeView> = {}): CartridgeView => ({
  id: 1, name: 'PFI-1100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
  open_remaining_nl: 60_000_000, open_purchase_id: 21, spares: 1,
  bought: 160_000_000, used: 20_000_000, wasted: 0, remaining: 140_000_000,
  used_micros: 9_000_000, waste_micros: 0, jobs: 3,
  purchases: [purchase()], write_offs: [], ...overrides,
});
const ink = (overrides: Partial<InkResponse> = {}): InkResponse => ({
  channels: ['C'], cartridges: [cartridge()], settings: settings(),
  totals: totals({ jobs: 3, ink_micros: 9_000_000 }), ...overrides,
});
const preview = (overrides: Partial<WriteOffPreview> = {}): WriteOffPreview => ({
  written_off: 60_000_000, remaining: 140_000_000, cost_micros: 27_000_000, ...overrides,
});
const routes = (data: InkResponse = ink()) => ({ 'GET /ink': data, 'GET /settings': data.settings });

test('the ink list shows ledger totals, fitted levels, and a selected channel docket', async () => {
  const data = ink({ totals: totals({ jobs: 3, ink_micros: 9_000_000, unknown_jobs: 2, unknown_ink_jobs: 2 }) });
  const api = fakeApi(routes(data));
  const { screen, user, router } = await renderApp('/ink', api);
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(row.textContent).toContain('~60.0 ml');
  expect(row.textContent).toContain('1 spare cartridge');
  expect(screen.getByText('2 without an ink cost')).toBeTruthy();
  await user.click(row);
  const docket = await screen.findByRole('complementary', { name: 'Cartridge' });
  expect(within(docket).getByText('C · Cyan')).toBeTruthy();
  expect(within(docket).getByText('Bought 1 Sep 2026')).toBeTruthy();
  expect(within(docket).queryByText('No purchases yet.')).toBeNull();
  expect(router.state.location.pathname).toBe('/ink/C');
});

test('no collected channels shows an empty state but still offers adding stock', async () => {
  const api = fakeApi(routes(ink({ channels: [], cartridges: [], totals: totals() })));
  const { screen, user } = await renderApp('/ink', api);
  expect(await screen.findByText('No ink yet. Collect jobs from the printer, or add the cartridges you have bought.')).toBeTruthy();
  await user.click(screen.getByRole('link', { name: 'Add stock' }));
  expect(await screen.findByRole('combobox', { name: 'Cartridge' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add stock' }).hasAttribute('disabled')).toBe(true);
});

test('an unfitted channel cannot be written off, while its purchase and waste history remains visible', async () => {
  const writeOff: WriteOffView = {
    id: 31, paper_stock_id: null, ink_product_id: 1, written_off_on: '2026-09-02',
    quantity: null, all_remaining: true, reason: 'Changed early', written_off: 60_000_000, cost_micros: 27_000_000,
  };
  const api = fakeApi(routes(ink({ cartridges: [cartridge({
    open_remaining_nl: null, open_purchase_id: null, spares: 1, wasted: 60_000_000, remaining: 80_000_000,
    waste_micros: 27_000_000, purchases: [purchase({ remaining_nl: 80_000_000 })], write_offs: [writeOff],
  })] })));
  const { screen } = await renderApp('/ink/C', api);
  expect(await screen.findByText('None fitted.')).toBeTruthy();
  const docket = screen.getByRole('complementary', { name: 'Cartridge' });
  expect((within(docket).getByRole('button', { name: 'Write off' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(docket).getByText('Changed early')).toBeTruthy();
  expect(within(docket).queryByText('No purchases yet.')).toBeNull();
});

test('buying an existing cartridge requires a valid price and sends the chosen quantity and date', async () => {
  const api = fakeApi({ ...routes(), 'POST /ink-purchases/setup': { ink_product_id: 1, id: 22 } });
  const { screen, user, router } = await renderApp('/ink/C?form=purchase', api);
  const save = await screen.findByRole('button', { name: 'Add stock' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), 'invalid');
  expect(save.disabled).toBe(true);
  await user.clear(screen.getByRole('textbox', { name: 'Price paid' }));
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '37.50');
  await user.clear(screen.getByRole('spinbutton', { name: 'Cartridges' }));
  expect(save.disabled).toBe(true);
  await user.type(screen.getByRole('spinbutton', { name: 'Cartridges' }), '2');
  await user.click(save);
  expect(await screen.findByText('Added.')).toBeTruthy();
  expect(router.state.location.search.form).toBe('added');
  expect(api.sent('POST /ink-purchases/setup')).toEqual([{
    ink_product_id: 1, purchase: { purchased_on: today(), cartridges: 2, price_micros: 37_500_000 },
  }]);
});

test('buying a previously unseen channel creates its product and purchase together', async () => {
  const api = fakeApi({ ...routes(), 'POST /ink-purchases/setup': { ink_product_id: 2, id: 23 } });
  const { screen, user, router } = await renderApp('/ink/PM?form=purchase', api);
  expect(await screen.findByRole('textbox', { name: 'Product' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Product' }) as HTMLInputElement).value).toBe('PFI-1100 PM');
  expect((screen.getByRole('spinbutton', { name: 'Size (ml)' }) as HTMLInputElement).value).toBe('80');
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '42');
  await user.click(screen.getByRole('button', { name: 'Add stock' }));
  expect(await screen.findByText('Added.')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/ink/PM');
  expect(api.sent('POST /ink-purchases/setup')).toEqual([{
    cartridge: { name: 'PFI-1100 PM', channel: 'PM', capacity_nl: 80_000_000 },
    purchase: { purchased_on: today(), cartridges: 1, price_micros: 42_000_000 },
  }]);
});

test('buying a whole set includes existing products and sets up missing channels in one request', async () => {
  const api = fakeApi({ ...routes(ink({ channels: ['PM', 'C'] })), 'POST /ink-purchases/set': { purchases: [] } });
  const { screen, user, router } = await renderApp('/ink/new', api);
  await screen.findByRole('combobox', { name: 'Cartridge' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Cartridge' }), '*');
  expect(screen.getByRole('textbox', { name: 'Series' })).toBeTruthy();
  await user.clear(screen.getByRole('textbox', { name: 'Series' }));
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '95.25');
  const save = screen.getByRole('button', { name: 'Add stock' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await user.type(screen.getByRole('textbox', { name: 'Series' }), ' PFI-1100 ');
  await user.clear(screen.getByRole('spinbutton', { name: 'Sets' }));
  await user.type(screen.getByRole('spinbutton', { name: 'Sets' }), '2');
  await user.click(save);
  expect(await screen.findByText('Added to all 2 cartridges.')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/ink/new');
  expect(router.state.location.search.form).toBe('added');
  expect(api.sent('POST /ink-purchases/set')).toEqual([{
    ink_product_ids: [1], new_cartridges: { series: 'PFI-1100', capacity_nl: 80_000_000, channels: ['PM'] },
    purchased_on: today(), sets: 2, price_micros: 95_250_000,
  }]);
});

test('a rejected purchase stays in the form, reports not saved, and can be retried', async () => {
  let attempts = 0;
  const api = fakeApi({ ...routes(), 'POST /ink-purchases/setup': () => ++attempts === 1 ? reply(422, { error: 'invalid_request' }) : { ink_product_id: 1, id: 22 } });
  const { screen, user, router } = await renderApp('/ink/C?form=purchase', api);
  await screen.findByRole('button', { name: 'Add stock' });
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '37.50');
  const save = screen.getByRole('button', { name: 'Add stock' });
  await user.click(save);
  expect(await screen.findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(screen.queryByText('Added.')).toBeNull();
  expect(router.state.location.search.form).toBe('purchase');
  await user.click(save);
  expect(await screen.findByText('Added.')).toBeTruthy();
  expect(api.sent('POST /ink-purchases/setup')).toHaveLength(2);
});

test('write-off waits for the ledger preview and cannot save a zero remainder', async () => {
  const date = today();
  let release!: (value: WriteOffPreview) => void;
  const response = new Promise<WriteOffPreview>(resolve => { release = resolve; });
  const api = fakeApi({ ...routes(), [`GET /write-offs/preview?ink_product_id=1&written_off_on=${date}`]: () => response });
  const { screen } = await renderApp('/ink/C?form=writeoff', api);
  const save = await screen.findByRole('button', { name: 'Save write-off' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  release(preview({ written_off: 0, remaining: 0 }));
  expect(await screen.findByText(/~0\.0 ml/)).toBeTruthy();
  expect(save.disabled).toBe(true);
});

test('writing off the fitted cartridge sends all remaining and only confirms after a successful save', async () => {
  const date = today();
  let release!: (value: WriteOffPreview) => void;
  const response = new Promise<WriteOffPreview>(resolve => { release = resolve; });
  let attempts = 0;
  const api = fakeApi({
    ...routes(), [`GET /write-offs/preview?ink_product_id=1&written_off_on=${date}`]: () => response,
    'POST /write-offs': () => ++attempts === 1 ? reply(422, { error: 'invalid_request' }) : { id: 41 },
  });
  const { screen, user, router } = await renderApp('/ink/C?form=writeoff', api);
  const save = await screen.findByRole('button', { name: 'Save write-off' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  release(preview({ written_off: 35_000_000 }));
  expect(await screen.findByText(/~35\.0 ml/)).toBeTruthy();
  await waitFor(() => expect(save.disabled).toBe(false));
  await user.type(screen.getByRole('textbox', { name: /Reason/ }), '  Changed early  ');
  await user.click(save);
  expect(await screen.findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(screen.queryByText(/Saved\. It shows as waste/)).toBeNull();
  expect(router.state.location.search.form).toBe('writeoff');
  await user.click(save);
  expect(await screen.findByText('Saved. It shows as waste in totals.')).toBeTruthy();
  expect(api.sent('POST /write-offs')).toEqual(Array(2).fill({
    ink_product_id: 1, written_off_on: date, all_remaining: true, reason: 'Changed early',
  }));
});
