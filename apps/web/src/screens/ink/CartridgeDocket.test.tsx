import { expect, test } from 'bun:test';
import { waitFor, within } from '@testing-library/react';
import type { CartridgeView, InkResponse } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { archivedPrinter, settings, totals } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const purchase = (id: number, cartridges: number) => ({ id, ink_product_id: 1, purchased_on: '2025-12-12', cartridges,
  price_micros: cartridges * 40_000_000, remaining_nl: cartridges * 80_000_000 });
const unit = (index: number, overrides: Partial<CartridgeView['units'][number]> = {}): CartridgeView['units'][number] => ({
  purchase_id: 21, index, state: 'shelf', printer_id: null, starts_after_record: null, ended_after_record: null,
  started_on: null, ended_on: null, printed_nl: 0, waste_nl: 0, remaining_nl: 80_000_000,
  fitting_id: null, replaced: null, ...overrides,
});
const cartridge = (overrides: Partial<CartridgeView> = {}): CartridgeView => ({
  id: 1, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
  open_remaining_nl: 60_000_000, open_purchase_id: 21, spares: 2,
  bought: 320_000_000, used: 20_000_000, wasted: 60_000_000, remaining: 240_000_000,
  used_micros: 10_000_000, waste_micros: 30_000_000, jobs: 3,
  purchases: [purchase(21, 3), purchase(22, 1)], write_offs: [], units: [
    unit(1, { state: 'used', printer_id: 1, starts_after_record: 0, ended_after_record: 2,
      started_on: '2026-10-01', ended_on: '2026-10-02', printed_nl: 20_000_000, waste_nl: 60_000_000, remaining_nl: 0 }),
    unit(2, { state: 'fitted', printer_id: 1, starts_after_record: 4, started_on: '2026-10-04',
      printed_nl: 20_000_000, remaining_nl: 60_000_000, fitting_id: 50, replaced: 'shelf' }),
    unit(3), unit(1, { purchase_id: 22, printer_id: 3, starts_after_record: 1, ended_after_record: 2,
      started_on: '2026-10-01', ended_on: '2026-10-02', remaining_nl: 45_000_000 }),
  ], ...overrides,
});
const data = (overrides: Partial<InkResponse> = {}): InkResponse => ({ channels: ['C'], cartridges: [cartridge()],
  fitted: { C: { product_id: 1, purchase_id: 21, index: 2, remaining_nl: 60_000_000 } },
  settings: settings(), totals: totals(), ...overrides,
});
const printers = [
  archivedPrinter({ id: 1, name: 'Studio', model: 'PRO-1100 series', inks: [
    { channel: 'C', series: 'PFI-4100', level: 70, replacement_count: 1, observed_at: '2026-10-04T10:00:00Z' },
  ] }),
  archivedPrinter({ id: 2, name: 'Wide', model: 'PRO-2600 series', inks: [
    { channel: 'C', series: 'PFI-3300', level: 30, replacement_count: 1, observed_at: '2026-10-04T10:00:00Z' },
  ] }),
  archivedPrinter({ id: 3, name: 'Unknown', model: null, inks: [] }),
  archivedPrinter({ id: 4, name: 'Other series', model: null, inks: [
    { channel: 'C', series: 'PFI-3100', level: 60, replacement_count: 1, observed_at: '2026-10-04T10:00:00Z' },
  ] }),
  archivedPrinter({ id: 5, name: 'Reported series', model: 'PRO-2600 series', inks: [
    { channel: 'C', series: 'PFI-4100', level: 60, replacement_count: 1, observed_at: '2026-10-04T10:00:00Z' },
  ] }),
];
const jobs = { highest_source_record_id: 10, jobs: [
  { job_id: 99, source_record_id: 10, date: '2026-10-04', time: '10:12', label: 'Photo Rag A3+' },
  { job_id: 98, source_record_id: 8, date: '2026-10-03', time: '09:30', label: 'Etching A4' },
  { job_id: 97, source_record_id: 5, date: '2026-10-02', time: '12:30', label: 'Baryta A4' },
] };
const routes = (response = data()) => ({ 'GET /printers': { printers }, 'GET /settings': settings(),
  'GET /ink?printer=1': response,
  'GET /ink?printer=3': data({ fitted: {}, cartridges: [cartridge({ open_remaining_nl: null, open_purchase_id: null })] }),
  'GET /printers/1/recent-jobs?limit=20': jobs,
  'GET /printers/3/recent-jobs?limit=20': { highest_source_record_id: 3, jobs: [] },
  'POST /ink-fittings': { id: 51 }, 'PATCH /ink-fittings/50': { updated: true }, 'DELETE /ink-fittings/50': { deleted: true },
});

const open = async (response = data()) => {
  const api = fakeApi(routes(response));
  const app = await renderApp('/ink/C?printer=1', api);
  await app.screen.findByText('In Studio');
  const docket = app.screen.getByRole('complementary', { name: 'Cartridge' });
  return { ...app, api, docket, inside: within(docket) };
};

test('the selected printer docket shows its fitted purchase, level, and individual unit places', async () => {
  const { inside } = await open();
  expect(inside.getByText('In Studio')).toBeTruthy();
  expect(inside.getByText('Bought 12 Dec 2025')).toBeTruthy();
  expect(inside.getByText('Printer level 70%')).toBeTruthy();
  expect(inside.getByText('Cartridges')).toBeTruthy();
  expect(inside.getByText('Used up in Studio · 1 Oct 2026 – 2 Oct 2026 · 20.0 ml printed, 60.0 ml waste')).toBeTruthy();
  expect(inside.getByText('In Studio since 4 Oct 2026 · 20.0 ml printed')).toBeTruthy();
  expect(inside.getByText('On the shelf · ~45.0 ml left')).toBeTruthy();
  expect(inside.getAllByText('set by you')).toHaveLength(1);
  expect(inside.getAllByRole('button', { name: 'Fit in printer' })).toHaveLength(2);
  expect(inside.getAllByRole('button', { name: 'Change' })).toHaveLength(2);
  expect(inside.getByText(/2 spare cartridges on the shelf/)).toBeTruthy();
});

test('a single type does not get its own heading', async () => {
  const { inside } = await open();
  expect(inside.queryByRole('heading', { name: 'PFI-4100 · 80 ml' })).toBeNull();
});

test('multiple types get headings under Cartridges', async () => {
  const other: CartridgeView = { ...cartridge(), id: 2, name: 'PFI-3100 C', capacity_nl: 160_000_000,
    purchases: [{ ...purchase(23, 1), ink_product_id: 2 }], units: [unit(1, { purchase_id: 23 })], open_remaining_nl: null, open_purchase_id: null };
  const second = await open(data({ cartridges: [cartridge(), other] }));
  expect(second.inside.getByRole('heading', { name: 'PFI-4100 · 80 ml' })).toBeTruthy();
  expect(second.inside.getByRole('heading', { name: 'PFI-3100 · 160 ml' })).toBeTruthy();
});

test('Fit in printer posts the selected printer and its highest record for The next print', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Fit in printer' })[0]);
  const form = inside.getByRole('group', { name: 'Fit in printer' });
  expect((within(form).getByRole('combobox', { name: 'Printer' }) as HTMLSelectElement).value).toBe('1');
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('next');
  expect(within(form).getByRole('combobox', { name: 'The cartridge it replaces' })).toBeTruthy();
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 22, after_record: 10, replaced: 'used',
  }]));
});

test('Fit in printer starts before the chosen print and filters compatible printers', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Fit in printer' })[1]);
  const form = inside.getByRole('group', { name: 'Fit in printer' });
  const printer = within(form).getByRole('combobox', { name: 'Printer' });
  expect(within(printer).getAllByRole('option').map(option => option.textContent)).toEqual(['Studio', 'Unknown', 'Reported series']);
  await user.selectOptions(within(form).getByRole('combobox', { name: 'From' }), '7');
  await user.selectOptions(within(form).getByRole('combobox', { name: 'The cartridge it replaces' }), 'shelf');
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 21, after_record: 7, replaced: 'shelf',
  }]));
});

test('a printer without a fitted channel hides The cartridge it replaces', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Fit in printer' })[0]);
  const form = inside.getByRole('group', { name: 'Fit in printer' });
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Printer' }), '3');
  await waitFor(() => expect(within(form).queryByRole('combobox', { name: 'The cartridge it replaces' })).toBeNull());
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toEqual([{
    printer_id: 3, channel: 'C', ink_purchase_id: 22, after_record: 3, replaced: 'used',
  }]));
});

test('Change patches a correction with its current printer, start and replacement, then Remove correction deletes it', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Change' })[1]);
  let form = inside.getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('4');
  expect((within(form).getByRole('combobox', { name: 'The cartridge it replaces' }) as HTMLSelectElement).value).toBe('shelf');
  await user.selectOptions(within(form).getByRole('combobox', { name: 'From' }), '7');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.sent('PATCH /ink-fittings/50')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 21, after_record: 7, replaced: 'shelf',
  }]));
  await user.click(inside.getAllByRole('button', { name: 'Change' })[1]);
  form = inside.getByRole('group', { name: 'Change cartridge' });
  await user.click(within(form).getByRole('button', { name: 'Remove correction' }));
  await waitFor(() => expect(api.requests.some(request => request.method === 'DELETE' && request.path === '/ink-fittings/50')).toBe(true));
});

test('Change on an automatic used unit creates a fitting from that purchase', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Change' })[0]);
  const form = inside.getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('0');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 21, after_record: 0, replaced: 'used',
  }]));
});


test('a single printer keeps the In the printer label', async () => {
  const api = fakeApi({ ...routes(), 'GET /printers': { printers: printers.slice(0, 1) } });
  const { screen } = await renderApp('/ink/C?printer=1', api);
  expect(await screen.findByText('In the printer')).toBeTruthy();
});

test('a fitting conflict is shown beside the inline form', async () => {
  const api = fakeApi({ ...routes(), 'POST /ink-fittings': reply(400, { error: 'fitting_conflict' }) });
  const { screen, user } = await renderApp('/ink/C?printer=1', api);
  const docket = await screen.findByText('In Studio').then(() => screen.getByRole('complementary', { name: 'Cartridge' }));
  await user.click(within(docket).getAllByRole('button', { name: 'Fit in printer' })[0]);
  const form = within(docket).getByRole('group', { name: 'Fit in printer' });
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  expect(await within(form).findByText('Not saved. That fitting conflicts with another cartridge or print.')).toBeTruthy();
});

test('refitting a returned shelf unit creates a new event without moving its earlier correction', async () => {
  const product = cartridge();
  product.units.find(item => item.purchase_id === 22)!.fitting_id = 60;
  const { inside, user, api } = await open(data({ cartridges: [product] }));
  await user.click(inside.getAllByRole('button', { name: 'Fit in printer' })[0]);
  const form = inside.getByRole('group', { name: 'Fit in printer' });
  expect(within(form).queryByRole('button', { name: 'Remove correction' })).toBeNull();
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('next');
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toHaveLength(1));
  expect(api.sent('PATCH /ink-fittings/60')).toHaveLength(0);
});
