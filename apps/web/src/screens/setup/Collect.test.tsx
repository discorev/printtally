import { expect, test } from 'bun:test';
import { waitFor } from '@testing-library/react';
import type { ImportResult, ImportRun, ImportsResponse } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { health, ledgerSpanReads, printerStatus } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const studio = printerStatus();
const archive = printerStatus({ id: 'printer-2', name: 'Archive printer', host: '192.168.1.55' });
const imports = (items: ImportRun[] = []): ImportsResponse => ({ imports: items, limit: 20, offset: 0 });
const result = (new_jobs: number): ImportResult => ({ import_id: 7, new_jobs, new_observations: new_jobs, record_id_collisions: 0, received: new_jobs });
const reads = ledgerSpanReads();

test('collect now is disabled with no printer, and an unread log is not reported as collected', async () => {
  const api = fakeApi({ ...reads, 'GET /health': health(), 'GET /imports?limit=20': imports() });
  const { screen } = await renderApp('/collect', api);
  expect(await screen.findByText('Not yet')).toBeTruthy();
  expect(screen.getByText('Not read yet')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Collect now' }) as HTMLButtonElement).disabled).toBe(true);
});

test('collect now requests each printer, shows partial errors, and reports new jobs only after retry succeeds', async () => {
  let studioAttempts = 0, archiveAttempts = 0;
  let release!: (response: ImportResult) => void;
  const pending = new Promise<ImportResult>(resolve => { release = resolve; });
  const api = fakeApi({
    ...reads,
    'GET /health': health({ printers: [studio, archive] }),
    'GET /imports?limit=20': imports(),
    'POST /known-printers/printer-1/collect': () => ++studioAttempts === 1 ? pending : result(2),
    'POST /known-printers/printer-2/collect': () => ++archiveAttempts === 1 ? reply(409, { error: 'collection_failed' }) : result(1),
  });
  const { screen, user } = await renderApp('/collect', api);
  const collect = await screen.findByRole('button', { name: 'Collect now' });
  await user.click(collect);
  expect(await screen.findByRole('button', { name: 'Collecting…' })).toHaveProperty('disabled', true);
  expect(screen.getByText('Reading the printer\'s log…')).toBeTruthy();
  release(result(2));
  expect(await screen.findByText("Couldn't read the printer's log.")).toBeTruthy();
  expect(screen.queryByText(/new jobs?/)).toBeNull();
  expect(api.sent('POST /known-printers/printer-1/collect')).toEqual([{}]);
  expect(api.sent('POST /known-printers/printer-2/collect')).toEqual([{}]);

  await user.click(screen.getByRole('button', { name: 'Collect now' }));
  expect(await screen.findByText('3 new jobs')).toBeTruthy();
  expect(screen.queryByText("Couldn't read the printer's log.")).toBeNull();
  await waitFor(() => expect(api.sent('POST /known-printers/printer-2/collect')).toEqual([{}, {}]));
});

test('changed certificate warns that collection is withheld and links to verification for that host', async () => {
  const blocked = health({ state: 'printer_needs_confirming', printers: [{ ...studio, state: 'needs_confirming' }] });
  const api = fakeApi({ ...reads, 'GET /health': blocked, 'GET /imports?limit=20': imports(),
    'POST /printer-enrolments': reply(409, { error: 'printer_inspection_failed' }) });
  const { screen, user, router } = await renderApp('/collect', api);
  expect(await screen.findByText("The printer's certificate changed")).toBeTruthy();
  expect(screen.getByText(/won't send it the password or collect from it/)).toBeTruthy();
  await user.click(screen.getByRole('link', { name: 'Check the fingerprint' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
  expect(router.state.location.search).toEqual({ host: studio.host });
  await waitFor(() => expect(api.sent('POST /printer-enrolments')).toEqual([{ host: studio.host }]));
  expect(await screen.findByText("Couldn't reach the printer at that address.")).toBeTruthy();
  expect(api.sent('POST /known-printers/printer-1/collect')).toEqual([]);
});
