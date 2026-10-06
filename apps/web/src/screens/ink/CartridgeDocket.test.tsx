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
  started_on: null, ended_on: null, ended_by: null, written_off_on: null, written_off_from_shelf: false, printed_nl: 0, waste_nl: 0, remaining_nl: 80_000_000,
  fitting_id: null, replaced: null, ...overrides,
});
const cartridge = (overrides: Partial<CartridgeView> = {}): CartridgeView => ({
  id: 1, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
  open_remaining_nl: 60_000_000, open_purchase_id: 21, open_unit_index: 2, spares: 2,
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
  const action = inside.getAllByRole('button', { name: 'Fit in printer' })[0];
  await user.click(action);
  const form = inside.getByRole('group', { name: 'Fit in printer' });
  expect((within(form).getByRole('combobox', { name: 'Printer' }) as HTMLSelectElement).value).toBe('1');
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('next');
  expect(within(form).getByRole('combobox', { name: 'The cartridge it replaces' })).toBeTruthy();
  await user.click(within(form).getByRole('button', { name: 'Fit' }));
  await waitFor(() => expect(api.sent('POST /ink-fittings')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 22, unit_index: 1, after_record: 10, replaced: 'shelf',
  }]));
  await waitFor(() => expect(inside.queryByRole('group', { name: 'Fit in printer' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(action));
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
    printer_id: 1, channel: 'C', ink_purchase_id: 21, unit_index: 3, after_record: 7, replaced: 'shelf',
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
    printer_id: 3, channel: 'C', ink_purchase_id: 22, unit_index: 1, after_record: 3, replaced: 'shelf',
  }]));
});

test('Change patches a correction with its current printer, start and replacement, then Remove correction deletes it', async () => {
  const { inside, user, api } = await open();
  await user.click(inside.getAllByRole('button', { name: 'Change' })[1]);
  let form = inside.getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('4');
  expect(within(form).queryByRole('combobox', { name: 'The cartridge it replaces' })).toBeNull();
  await user.selectOptions(within(form).getByRole('combobox', { name: 'From' }), '7');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.sent('PATCH /ink-fittings/50')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 21, unit_index: 2, after_record: 7, replaced: 'shelf',
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
    printer_id: 1, channel: 'C', ink_purchase_id: 21, unit_index: 1, after_record: 0, replaced: 'shelf',
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

test('a fitted unit from the next print has no printed amount or replacement choice for itself', async () => {
  const product = cartridge({ units: [unit(1, { state: 'fitted', printer_id: 1, starts_after_record: 10,
    started_on: null, printed_nl: 0, fitting_id: 50 })] });
  const { inside, user } = await open(data({ cartridges: [product], fitted: { C: { product_id: 1, purchase_id: 21, index: 1, remaining_nl: 80_000_000 } } }));
  expect(inside.getByText('In Studio from the next print')).toBeTruthy();
  expect(inside.queryByText(/0\.0 ml printed/)).toBeNull();
  await user.click(inside.getByRole('button', { name: 'Change' }));
  const form = inside.getByRole('group', { name: 'Change cartridge' });
  await waitFor(() => expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('next'));
  expect(within(form).queryByRole('option', { name: 'Current start' })).toBeNull();
  expect(within(form).queryByRole('combobox', { name: 'The cartridge it replaces' })).toBeNull();
});

test('a historical start absent from recent jobs is labelled by its date and resets on printer change', async () => {
  const product = cartridge({ units: [unit(1, { state: 'used', printer_id: 1, starts_after_record: 6,
    started_on: '2026-09-01', fitting_id: 50 })] });
  const { inside, user, api } = await open(data({ cartridges: [product] }));
  await user.click(inside.getByRole('button', { name: 'Change' }));
  const form = inside.getByRole('group', { name: 'Change cartridge' });
  const from = within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement;
  expect(from.value).toBe('6');
  expect(within(from).getByRole('option', { name: '1 Sep 2026' })).toBeTruthy();
  expect(within(from).queryByRole('option', { name: 'Current start' })).toBeNull();
  await user.selectOptions(from, '7');
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Printer' }), '3');
  expect(from.value).toBe('next');
  expect(within(from).queryByRole('option', { name: '1 Sep 2026' })).toBeNull();
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.sent('PATCH /ink-fittings/50')).toEqual([{
    printer_id: 3, channel: 'C', ink_purchase_id: 21, unit_index: 1, after_record: 3, replaced: 'shelf',
  }]));
});

test('an ineligible current printer starts on the eligible printer next print', async () => {
  const product = cartridge({ units: [unit(1, { state: 'used', printer_id: 2, starts_after_record: 8,
    started_on: '2026-09-01', fitting_id: 50 })] });
  const { inside, user, api } = await open(data({ cartridges: [product] }));
  await user.click(inside.getByRole('button', { name: 'Change' }));
  const form = inside.getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'Printer' }) as HTMLSelectElement).value).toBe('1');
  expect((within(form).getByRole('combobox', { name: 'From' }) as HTMLSelectElement).value).toBe('next');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.sent('PATCH /ink-fittings/50')).toEqual([{
    printer_id: 1, channel: 'C', ink_purchase_id: 21, unit_index: 1, after_record: 10, replaced: 'shelf',
  }]));
});

test('a unit in another printer checks that printer fitting, excluding itself', async () => {
  const product = cartridge({ units: [unit(1, { state: 'fitted', printer_id: 3, starts_after_record: 1, fitting_id: 50 })] });
  const response = data({ cartridges: [product] });
  const other = data({ cartridges: [product], fitted: { C: { product_id: 1, purchase_id: 21, index: 1, remaining_nl: 80_000_000 } } });
  const api = fakeApi({ ...routes(response), 'GET /ink?printer=3': other });
  const { screen, user } = await renderApp('/ink/C?printer=1', api);
  const docket = await screen.findByText('In Studio').then(() => screen.getByRole('complementary', { name: 'Cartridge' }));
  await user.click(within(docket).getByRole('button', { name: 'Change' }));
  const form = within(docket).getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'Printer' }) as HTMLSelectElement).value).toBe('3');
  await waitFor(() => expect(api.requests.some(request => request.path === '/ink?printer=3')).toBe(true));
  expect(within(form).queryByRole('combobox', { name: 'The cartridge it replaces' })).toBeNull();
});

test('Escape and Cancel close only the inline form and return focus to its row action', async () => {
  const { inside, user, screen } = await open();
  const action = inside.getAllByRole('button', { name: 'Fit in printer' })[0];
  await user.click(action);
  let form = inside.getByRole('group', { name: 'Fit in printer' });
  expect(document.activeElement).toBe(within(form).getByRole('combobox', { name: 'Printer' }));
  await user.keyboard('{Escape}');
  expect(inside.queryByRole('group', { name: 'Fit in printer' })).toBeNull();
  expect(inside.getByText('In Studio')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(action));
  await user.click(action);
  form = inside.getByRole('group', { name: 'Fit in printer' });
  await user.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group', { name: 'Fit in printer' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(action));
});

test('a failed Remove correction keeps the form open and reports its API error', async () => {
  const api = fakeApi({ ...routes(), 'DELETE /ink-fittings/50': reply(400, { error: 'fitting_conflict' }) });
  const { screen, user } = await renderApp('/ink/C?printer=1', api);
  const docket = await screen.findByText('In Studio').then(() => screen.getByRole('complementary', { name: 'Cartridge' }));
  await user.click(within(docket).getAllByRole('button', { name: 'Change' })[1]);
  const form = within(docket).getByRole('group', { name: 'Change cartridge' });
  await user.click(within(form).getByRole('button', { name: 'Remove correction' }));
  expect(await within(form).findByText('Not saved. That fitting conflicts with another cartridge or print.')).toBeTruthy();
  expect(within(docket).getByRole('group', { name: 'Change cartridge' })).toBeTruthy();
});

test('write-off used rows show a date without an unfinished range or zero printed amount', async () => {
  const product = cartridge({ units: [unit(1, { state: 'used', printer_id: 1, starts_after_record: 0,
    ended_after_record: 1, started_on: '2026-09-01', ended_on: null, ended_by: 'write_off',
    written_off_on: '2026-09-02', written_off_from_shelf: false, waste_nl: 80_000_000 })] });
  const { inside } = await open(data({ cartridges: [product] }));
  expect(inside.getByText('Used up in Studio · since 1 Sep 2026 · 80.0 ml waste')).toBeTruthy();
  expect(inside.queryByText(/0\.0 ml printed/)).toBeNull();
});

test('Change on a unit in another printer offers replacement for a different fitted unit', async () => {
  const product = cartridge({ units: [unit(1, { state: 'used', printer_id: 3, starts_after_record: 1, fitting_id: 50 })] });
  const response = data({ cartridges: [product] });
  const other = data({ cartridges: [product], fitted: { C: { product_id: 1, purchase_id: 21, index: 2, remaining_nl: 80_000_000 } } });
  const api = fakeApi({ ...routes(response), 'GET /ink?printer=3': other });
  const { screen, user } = await renderApp('/ink/C?printer=1', api);
  const docket = await screen.findByText('In Studio').then(() => screen.getByRole('complementary', { name: 'Cartridge' }));
  await user.click(within(docket).getByRole('button', { name: 'Change' }));
  const form = within(docket).getByRole('group', { name: 'Change cartridge' });
  expect((within(form).getByRole('combobox', { name: 'Printer' }) as HTMLSelectElement).value).toBe('3');
  expect((await within(form).findByRole('combobox', { name: 'The cartridge it replaces' }) as HTMLSelectElement).value).toBe('shelf');
});

test('only the precise shelf preview shows next in the selected printer, preserving part-used volume', async () => {
  const product = cartridge({ open_purchase_id: 21, open_unit_index: 3,
    units: [unit(1, { remaining_nl: 45_000_000 }), unit(2), unit(3, { remaining_nl: 30_000_000 }),
      unit(1, { purchase_id: 22 })] });
  const { inside } = await open(data({ fitted: {}, cartridges: [product] }));
  expect(inside.getByText('On the shelf · ~30.0 ml left · next in Studio')).toBeTruthy();
  expect(inside.getByText('On the shelf · ~45.0 ml left')).toBeTruthy();
  expect(inside.getAllByText('On the shelf')).toHaveLength(2);
  expect(inside.queryByText(/next in Unknown/)).toBeNull();
});

test('a shelf write-off shows its date without an old printer even after partial use', async () => {
  const product = cartridge({ units: [unit(1, { state: 'used', printer_id: 3, starts_after_record: 1,
    ended_after_record: 2, started_on: '2026-09-01', ended_by: 'write_off', written_off_from_shelf: true,
    written_off_on: '2026-10-02', printed_nl: 20_000_000, waste_nl: 60_000_000, remaining_nl: 0 })] });
  const { inside } = await open(data({ cartridges: [product] }));
  const place = inside.getByText('Written off · 2 Oct 2026');
  expect(place.textContent).not.toContain('Unknown');
  expect(place.textContent).not.toContain('since');
  expect(place.textContent?.includes('\u00a0')).toBe(true);
});

test('a full previewed shelf unit shows next in the printer without a volume suffix', async () => {
  const product = cartridge({ open_purchase_id: 21, open_unit_index: 3, units: [unit(2), unit(3)] });
  const { inside } = await open(data({ fitted: {}, cartridges: [product] }));
  expect(inside.getByText('On the shelf · next in Studio')).toBeTruthy();
  expect(inside.getByText('On the shelf')).toBeTruthy();
});
