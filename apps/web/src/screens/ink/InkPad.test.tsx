import { expect, test } from 'bun:test';
import { waitFor, within } from '@testing-library/react';
import type { CartridgeView } from 'print-accounting-contracts';
import { fakeApi } from '../../../test/api.ts';
import { archivedPrinter, settings, totals } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const printers = [archivedPrinter({ id: 1, name: 'Studio', model: 'PRO-1100 series', inks: [
  { channel: 'C', series: 'PFI-4100', level: 70, replacement_count: 1, observed_at: '2026-09-01T00:00:00Z' },
] }), archivedPrinter({ id: 2, name: 'Wide', model: 'PRO-2600 series', inks: [
  { channel: 'C', series: 'PFI-3300', level: 10, replacement_count: 3, observed_at: '2026-09-02T00:00:00Z' },
] })];
const api = (list = printers) => fakeApi({ 'GET /printers': { printers: list }, 'GET /ink': {
  channels: ['C'], cartridges: [], fitted: {}, settings: settings(), totals: totals(),
}, 'GET /settings': settings(), ...Object.fromEntries([1, 2, 3, 4, 999].map(id => [`GET /ink?printer=${id}`, { channels: ['C'], cartridges: [], fitted: {}, settings: settings(), totals: totals() }])) });

test('Ink selects an archived printer, displays its cartridge type, and marks the reported low level', async () => {
  const { screen, user, router } = await renderApp('/ink?printer=2', api());
  const selector = await screen.findByRole('combobox', { name: 'Printer' }) as HTMLSelectElement;
  expect(selector.value).toBe('2');
  expect(selector.parentElement?.querySelector('h1')?.textContent).toBe('Ink');
  expect(await screen.findByText(/levels are estimates, cleaning isn't logged/)).toBeTruthy();
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(within(row).getByText('PFI-3300 · 330 ml')).toBeTruthy();
  const level = within(row).getByText(/Printer level 10%/);
  expect(level.className).toContain('text-amber');
  expect(row.querySelector('[data-printer-level="10"]')).toBeTruthy();
  await user.selectOptions(selector, '1');
  expect(router.state.location.search.printer).toBe(1);
  await waitFor(() => expect(within(screen.getByRole('option', { name: /C Cyan/ })).getByText('PFI-4100 · 80 ml')).toBeTruthy());
  expect(screen.getByRole('option', { name: /C Cyan/ }).querySelector('[data-printer-level="70"]')).toBeTruthy();
  await user.click(screen.getByRole('option', { name: /C Cyan/ }));
  expect(router.state.location.search.printer).toBe(1);
});

test('a mismatched printer series hides the pooled estimate and fill but retains its level tick', async () => {
  const product: CartridgeView = { id: 10, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
    open_remaining_nl: 60_000_000, open_purchase_id: null, spares: 2, bought: 160_000_000, used: 20_000_000,
    wasted: 0, remaining: 140_000_000, used_micros: 0, waste_micros: 0, jobs: 1, purchases: [], write_offs: [], units: [] };
  const service = fakeApi({ 'GET /printers': { printers: [...printers, archivedPrinter({ id: 3, name: 'No reading' })] },
    ...Object.fromEntries([1, 2, 3].map(id => [`GET /ink?printer=${id}`, { channels: ['C'], cartridges: [{ ...product, open_remaining_nl: id === 2 ? null : product.open_remaining_nl }], settings: settings(), totals: totals() }])), 'GET /settings': settings() });
  const { screen, user } = await renderApp('/ink?printer=2', service);
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(row.textContent).toContain('PFI-3300 not set up');
  expect(row.textContent).not.toContain('~60.0 ml');
  expect(row.textContent).toContain('no spare');
  expect(row.querySelector('[data-printer-level="10"]')).toBeTruthy();
  expect(row.querySelector('i[style*="width: 0%"]')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '1');
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('~60.0 ml'));
  expect(screen.getByRole('option', { name: /C Cyan/ }).querySelector('i[style*="width: 75%"]')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '3');
  expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('~60.0 ml');
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('2 spares'));
  expect(screen.getByRole('option', { name: /C Cyan/ }).querySelector('[data-printer-level]')).toBeNull();
});

test('the reported product supplies the estimate, and spares depend on the selected printer model', async () => {
  const pfi4100: CartridgeView = { id: 10, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
    open_remaining_nl: 60_000_000, open_purchase_id: null, spares: 2, bought: 160_000_000, used: 20_000_000,
    wasted: 0, remaining: 140_000_000, used_micros: 0, waste_micros: 0, jobs: 1, purchases: [], write_offs: [], units: [] };
  const pfi3300: CartridgeView = { ...pfi4100, id: 11, name: 'PFI-3300 C', capacity_nl: 330_000_000,
    open_remaining_nl: 200_000_000, spares: 3 };
  const pfi3100: CartridgeView = { ...pfi4100, id: 12, name: 'PFI-3100 C', capacity_nl: 160_000_000,
    open_remaining_nl: null, spares: 1 };
  const unknown = archivedPrinter({ id: 4, name: 'Unlisted', model: 'PRO-4600 series', inks: printers[1].inks });
  const service = fakeApi({ 'GET /printers': { printers: [...printers, archivedPrinter({ id: 3, name: 'No reading' }), unknown] },
    ...Object.fromEntries([2, 3, 4].map(id => [`GET /ink?printer=${id}`, { channels: ['C'], cartridges: [{ ...pfi4100, open_remaining_nl: id === 3 ? 60_000_000 : null }, { ...pfi3300, open_remaining_nl: id === 3 ? null : 200_000_000 }, pfi3100], settings: settings(), totals: totals() }])),
    'GET /settings': settings() });
  const { screen, user } = await renderApp('/ink?printer=2', service);
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('~200.0 ml of 330'));
  expect(row.textContent).toContain('4 spares'); // PFI-3100 and PFI-3300 both fit a PRO-2600.
  expect(row.textContent).not.toContain('PFI-3300 not set up');
  expect(row.querySelector('i[style*="width: 60.606"]')).toBeTruthy();
  expect(row.querySelector('[data-printer-level="10"]')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '4');
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('~200.0 ml of 330'));
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('3 spares')); // Unknown models only accept the reported series.
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '3');
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('~60.0 ml of 80'));
  await waitFor(() => expect(screen.getByRole('option', { name: /C Cyan/ }).textContent).toContain('6 spares')); // No reading keeps the pooled count.
});

test('an unknown printer ID selects the first archived printer without crashing', async () => {
  const { screen } = await renderApp('/ink?printer=999', api());
  const selector = await screen.findByRole('combobox', { name: 'Printer' }) as HTMLSelectElement;
  expect(selector.value).toBe('1');
  expect(within(await screen.findByRole('option', { name: /C Cyan/ })).getByText('PFI-4100 · 80 ml')).toBeTruthy();
});

test('a single printer hides the printer dropdown', async () => {
  const { screen } = await renderApp('/ink', api(printers.slice(0, 1)));
  await screen.findByRole('option', { name: /C Cyan/ });
  expect(screen.queryByRole('combobox', { name: 'Printer' })).toBeNull();
});

test('a fitted unit takes precedence over a stale reported series in the selected printer', async () => {
  const product: CartridgeView = { id: 10, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
    open_remaining_nl: 60_000_000, open_purchase_id: 21, spares: 0, bought: 80_000_000, used: 20_000_000,
    wasted: 0, remaining: 60_000_000, used_micros: 0, waste_micros: 0, jobs: 1,
    purchases: [{ id: 21, ink_product_id: 10, purchased_on: '2026-01-01', cartridges: 1, price_micros: 20_000_000, remaining_nl: 60_000_000 }],
    write_offs: [], units: [] };
  const service = fakeApi({ 'GET /printers': { printers }, 'GET /settings': settings(),
    'GET /ink?printer=2': { channels: ['C'], cartridges: [product], fitted: { C: { product_id: 10, purchase_id: 21, index: 1, remaining_nl: 60_000_000 } }, settings: settings(), totals: totals() } });
  const { screen, user } = await renderApp('/ink?printer=2', service);
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(row.textContent).toContain('PFI-4100 · 80 ml');
  expect(row.textContent).toContain('~60.0 ml of 80');
  expect(row.textContent).not.toContain('PFI-3300 not set up');
  await user.click(row);
  expect(await screen.findByText('Bought 1 Jan 2026')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Write off' })).toBeTruthy();
});
