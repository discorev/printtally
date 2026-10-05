import { expect, test } from 'bun:test';
import type { CartridgeView, InkPurchaseView, InkResponse } from 'print-accounting-contracts';
import { fakeApi } from '../../../test/api.ts';
import { archivedPrinter, settings, totals } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { today } from '../../lib/format.ts';

const cartridge = (id: number, name: string, channel: string, capacity_nl: number): CartridgeView => ({
  id, name, channel, capacity_nl, product_code: null, open_remaining_nl: null, open_purchase_id: null,
  spares: 0, bought: 0, used: 0, wasted: 0, remaining: 0, used_micros: 0, waste_micros: 0, jobs: 0, purchases: [], write_offs: [],
});
const ink: InkResponse = { channels: ['PM', 'C', 'MBK'], cartridges: [cartridge(1, 'PFI-3300 C', 'C', 330_000_000)], settings: settings(), totals: totals() };
const printers = [archivedPrinter({ id: 1, name: 'Small', model: 'PRO-1100 series' }),
  archivedPrinter({ id: 2, name: 'Wide', model: 'PRO-2600 series', inks: [
    { channel: 'PM', series: 'PFI-3100', level: 20, replacement_count: 1, observed_at: '2026-09-02T00:00:00Z' },
    { channel: 'C', series: 'PFI-3300', level: 50, replacement_count: 1, observed_at: '2026-09-02T00:00:00Z' },
    { channel: 'MBK', series: 'PFI-2300', level: 70, replacement_count: 1, observed_at: '2026-09-02T00:00:00Z' },
  ] })];
const routes = () => ({ 'GET /ink': ink, 'GET /settings': ink.settings, 'GET /printers': { printers },
  'POST /ink-purchases/setup': { ink_product_id: 42, id: 6 }, 'POST /ink-purchases/set': { purchases: [] } });

test('Type offers model sizes and defaults to the selected printer reading, without expanding Cartridge', async () => {
  const api = fakeApi(routes());
  const { screen, user } = await renderApp('/ink/PM?printer=2&form=purchase', api);
  const type = await screen.findByRole('combobox', { name: 'Type' }) as HTMLSelectElement;
  expect(type.value).toBe('PFI-3100');
  expect([...type.options].map(option => option.text)).toContain('PFI-3300 · 330 ml');
  const cartridges = screen.getByRole('combobox', { name: 'Cartridge' }) as HTMLSelectElement;
  expect([...cartridges.options].map(option => option.text)).toContain('All 3 cartridges (a set)');
  expect([...cartridges.options].map(option => option.text)).toContain('MBK · Matte Black');
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '40');
  await user.click(screen.getByRole('button', { name: 'Add stock' }));
  expect(await screen.findByText('Added.')).toBeTruthy();
  expect(api.sent('POST /ink-purchases/setup')).toEqual([{ cartridge: { name: 'PFI-3100 PM', channel: 'PM', capacity_nl: 160_000_000 },
    purchase: { purchased_on: today(), cartridges: 1, price_micros: 40_000_000 } }]);
});

test('Type on a set picks the matching MBK counterpart and reuses only matching products', async () => {
  const api = fakeApi(routes());
  const { screen, user } = await renderApp('/ink/new?printer=2', api);
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Cartridge' }), '*');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'PFI-3300');
  await user.type(screen.getByRole('textbox', { name: 'Price paid' }), '120');
  await user.click(screen.getByRole('button', { name: 'Add stock' }));
  expect(await screen.findByText('Added to all 3 cartridges.')).toBeTruthy();
  expect(api.sent('POST /ink-purchases/set')).toEqual([{ ink_product_ids: [1], new_cartridges: {
    series: 'PFI-3300', capacity_nl: 330_000_000, channels: ['PM', 'MBK'], names: { PM: 'PFI-3300 PM', MBK: 'PFI-2300 MBK' },
  }, purchased_on: today(), sets: 1, price_micros: 120_000_000 }]);
});

test('a set with no selected-printer reading defaults to the most recently bought series across channels', async () => {
  const purchase = (id: number, ink_product_id: number, purchased_on: string): InkPurchaseView => ({
    id, ink_product_id, purchased_on, cartridges: 1, price_micros: 40_000_000, remaining_nl: 80_000_000,
  });
  const data: InkResponse = { ...ink, cartridges: [
    { ...cartridge(1, 'PFI-3300 C', 'C', 330_000_000), purchases: [purchase(8, 1, '2026-09-10')] },
    { ...cartridge(2, 'PFI-3100 PM', 'PM', 160_000_000), purchases: [purchase(9, 2, '2026-09-12')] },
  ] };
  const { screen, user } = await renderApp('/ink/new?printer=1', fakeApi({ ...routes(), 'GET /ink': data }));
  expect(await screen.findByText('A cartridge, or a whole set, bought for the shelf.')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Cartridge' }), '*');
  expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('PFI-3100');
  expect(screen.getByText('For the whole set, split by cartridge size.')).toBeTruthy();
});

test('a recent MBK purchase selects the matching set type when the printer has no reading', async () => {
  const mbk: CartridgeView = { ...cartridge(3, 'PFI-2300 MBK', 'MBK', 330_000_000), purchases: [{
    id: 12, ink_product_id: 3, purchased_on: '2026-09-15', cartridges: 1, price_micros: 40_000_000, remaining_nl: 330_000_000,
  }] };
  const data: InkResponse = { ...ink, channels: ['C', 'MBK'], cartridges: [...ink.cartridges, mbk] };
  const { screen, user } = await renderApp('/ink/new?printer=1', fakeApi({ ...routes(), 'GET /ink': data }));
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Cartridge' }), '*');
  expect((screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).value).toBe('PFI-3300');
});

test('New type reveals the existing product name and size fields', async () => {
  const { screen, user } = await renderApp('/ink/PM?printer=2&form=purchase', fakeApi(routes()));
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Type' }), '__new__');
  expect(screen.getByRole('textbox', { name: 'Product' })).toBeTruthy();
  expect(screen.getByText("Not set up yet; it's added with this purchase.")).toBeTruthy();
  expect(screen.getByRole('spinbutton', { name: 'Size (ml)' })).toBeTruthy();
});
