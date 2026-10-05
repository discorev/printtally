import { expect, test } from 'bun:test';
import { within } from '@testing-library/react';
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

test('a single printer hides the printer dropdown', async () => {
  const { screen } = await renderApp('/ink', api(printers.slice(0, 1)));
  await screen.findByRole('option', { name: /C Cyan/ });
  expect(screen.queryByRole('combobox', { name: 'Printer' })).toBeNull();
});
