import { expect, test } from 'bun:test';
import { within } from '@testing-library/react';
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
  channels: ['C'], cartridges: [], settings: settings(), totals: totals(),
}, 'GET /settings': settings() });

test('Ink selects an archived printer, displays its cartridge type, and marks the reported low level', async () => {
  const { screen, user, router } = await renderApp('/ink?printer=2', api());
  const selector = await screen.findByRole('combobox', { name: 'Printer' }) as HTMLSelectElement;
  expect(selector.value).toBe('2');
  expect(selector.parentElement?.querySelector('h1')?.textContent).toBe('Ink');
  expect(screen.getByText(/levels are estimates, cleaning isn't logged/)).toBeTruthy();
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(within(row).getByText('PFI-3300 · 330 ml')).toBeTruthy();
  const level = within(row).getByText(/Printer level 10%/);
  expect(level.className).toContain('text-amber');
  expect(row.querySelector('[data-printer-level="10"]')).toBeTruthy();
  await user.selectOptions(selector, '1');
  expect(router.state.location.search.printer).toBe(1);
  expect(within(row).getByText('PFI-4100 · 80 ml')).toBeTruthy();
  expect(row.querySelector('[data-printer-level="70"]')).toBeTruthy();
  await user.click(row);
  expect(router.state.location.search.printer).toBe(1);
});

test('a mismatched printer series hides the pooled estimate and fill but retains its level tick', async () => {
  const product: CartridgeView = { id: 10, name: 'PFI-4100 C', channel: 'C', capacity_nl: 80_000_000, product_code: null,
    open_remaining_nl: 60_000_000, open_purchase_id: null, spares: 2, bought: 160_000_000, used: 20_000_000,
    wasted: 0, remaining: 140_000_000, used_micros: 0, waste_micros: 0, jobs: 1, purchases: [], write_offs: [] };
  const service = fakeApi({ 'GET /printers': { printers: [...printers, archivedPrinter({ id: 3, name: 'No reading' })] },
    'GET /ink': { channels: ['C'], cartridges: [product], settings: settings(), totals: totals() }, 'GET /settings': settings() });
  const { screen, user } = await renderApp('/ink?printer=2', service);
  const row = await screen.findByRole('option', { name: /C Cyan/ });
  expect(row.textContent).toContain('PFI-3300 not set up');
  expect(row.textContent).not.toContain('~60.0 ml');
  expect(row.textContent).toContain('2 spares');
  expect(row.querySelector('[data-printer-level="10"]')).toBeTruthy();
  expect(row.querySelector('i[style*="width: 0%"]')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '1');
  expect(row.textContent).toContain('~60.0 ml');
  expect(row.querySelector('i[style*="width: 75%"]')).toBeTruthy();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Printer' }), '3');
  expect(row.textContent).toContain('~60.0 ml');
  expect(row.querySelector('[data-printer-level]')).toBeNull();
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
