import { expect, test } from 'bun:test';
import { waitFor } from '@testing-library/react';
import type { DiscoveredPrinter, HealthResponse, ImportResult, PrinterTrustPreview } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { fingerprint, health, jobsScreenReads, knownPrinter, papers, printerStatus } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const discovered: DiscoveredPrinter = { host: '192.168.1.42', name: 'Studio printer', model: 'PRO-1000', services: ['_http._tcp'] };
const preview = (overrides: Partial<PrinterTrustPreview> = {}): PrinterTrustPreview => ({
  id: 'preview-1', host: discovered.host, name: discovered.name, mac: '00:1E:8F:12:34:56',
  fingerprintSha256: fingerprint, validFrom: '2025-01-01T00:00:00Z', validTo: '2035-01-01T00:00:00Z',
  expiresAt: '2026-10-03T12:05:00Z', existingPrinterId: null, previousFingerprintSha256: null,
  change: 'new', ...overrides,
});
const collected: ImportResult = { import_id: 2, new_jobs: 0, new_observations: 0, record_id_collisions: 0, received: 0 };
const noPrinter = health({ state: 'needs_printer' });
const ready = health({ printers: [printerStatus()] });

async function reachConfirmation(api: ReturnType<typeof fakeApi>) {
  const view = await renderApp('/setup', api);
  await view.user.click(await view.screen.findByRole('button', { name: 'Find my printer' }));
  await view.user.click(await view.screen.findByRole('button', { name: 'Use this printer' }));
  await view.screen.findByRole('button', { name: 'Confirm fingerprint' });
  return view;
}

test('discovered printer is trusted only after fingerprint confirmation, then a saved password starts collection', async () => {
  let serverHealth: HealthResponse = noPrinter;
  let releaseCollection!: (result: ImportResult) => void;
  const collection = new Promise<ImportResult>(resolve => { releaseCollection = resolve; });
  const api = fakeApi({
    'GET /health': () => serverHealth,
    'POST /printer-discovery': { printers: [discovered] },
    'POST /printer-enrolments': preview(),
    'POST /printer-enrolments/preview-1/confirm': knownPrinter(),
    'PUT /known-printers/printer-1/password': { saved: true },
    'POST /known-printers/printer-1/collect': () => collection,
    ...jobsScreenReads([], { 'GET /papers': papers([]) }),
  });
  const { screen, user, router } = await reachConfirmation(api);
  expect(api.sent('POST /printer-discovery')).toEqual([{}]);
  expect(api.sent('POST /printer-enrolments')).toEqual([{ host: discovered.host, name: discovered.name }]);
  expect(api.sent('POST /printer-enrolments/preview-1/confirm')).toEqual([]);
  expect(screen.getByText(/Only continue if it matches this one/)).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Confirm fingerprint' }));
  expect(api.sent('POST /printer-enrolments/preview-1/confirm')).toEqual([{ fingerprintSha256: fingerprint, confirmed: true }]);
  const password = await screen.findByLabelText('Administrator password') as HTMLInputElement;
  expect(password.type).toBe('password');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', "Enter the printer's administrator password.");
  expect(api.sent('PUT /known-printers/printer-1/password')).toEqual([]);

  await user.type(password, 'secret-pass');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(api.sent('PUT /known-printers/printer-1/password')).toEqual([{ password: 'secret-pass' }]);
  expect(await screen.findByText(/Reading Studio printer's job log/)).toBeTruthy();
  expect(api.sent('POST /known-printers/printer-1/collect')).toEqual([{}]);
  expect(router.state.location.pathname).toBe('/setup');

  serverHealth = ready;
  releaseCollection(collected);
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
});

test('manual address validation and missing MAC never confirm a printer without its identity', async () => {
  const api = fakeApi({
    'GET /health': noPrinter,
    'POST /printer-enrolments': (request: Request) => request.clone().json().then((body: { mac?: string }) => preview({ mac: body.mac ?? null })),
    'DELETE /printer-enrolments/preview-1': { cancelled: true },
  });
  const { screen, user } = await renderApp('/setup', api);
  await user.click(await screen.findByRole('button', { name: 'Enter an address instead' }));
  await user.type(screen.getByRole('textbox', { name: 'Printer address' }), 'not-a-printer');
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByText(/Enter the printer's IP address/)).toBeTruthy();
  expect(api.sent('POST /printer-enrolments')).toEqual([]);

  await user.clear(screen.getByRole('textbox', { name: 'Printer address' }));
  await user.type(screen.getByRole('textbox', { name: 'Printer address' }), discovered.host);
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByRole('textbox', { name: 'MAC address' })).toBeTruthy();
  await waitFor(() => expect(api.requests.some(request => request.method === 'DELETE' && request.path === '/printer-enrolments/preview-1')).toBe(true));
  expect(screen.queryByRole('button', { name: 'Confirm fingerprint' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'MAC address' }), 'wrong');
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByText(/Enter the MAC address as six pairs/)).toBeTruthy();
  expect(api.sent('POST /printer-enrolments')).toEqual([{ host: discovered.host }]);

  await user.clear(screen.getByRole('textbox', { name: 'MAC address' }));
  await user.type(screen.getByRole('textbox', { name: 'MAC address' }), '00:1E:8F:12:34:56');
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByRole('button', { name: 'Confirm fingerprint' })).toBeTruthy();
  expect(api.sent('POST /printer-enrolments')).toEqual([{ host: discovered.host }, { host: discovered.host, mac: '00:1E:8F:12:34:56' }]);
});

test('empty discovery offers an address and a rejected inspection never advances to trust', async () => {
  const api = fakeApi({
    'GET /health': noPrinter,
    'POST /printer-discovery': { printers: [] },
    'POST /printer-enrolments': reply(409, { error: 'printer_inspection_failed' }),
  });
  const { screen, user } = await renderApp('/setup', api);
  await user.click(await screen.findByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByText('No printers answered on this network. Enter its address instead.')).toBeTruthy();
  await user.type(screen.getByRole('textbox', { name: 'Printer address' }), discovered.host);
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByText("Couldn't reach the printer at that address.")).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm fingerprint' })).toBeNull();
  expect(api.sent('POST /printer-enrolments')).toEqual([{ host: discovered.host }]);
});

test('stale fingerprint confirmation returns to discovery without saving a password', async () => {
  const api = fakeApi({
    'GET /health': noPrinter,
    'POST /printer-discovery': { printers: [discovered] },
    'POST /printer-enrolments': preview(),
    'POST /printer-enrolments/preview-1/confirm': reply(409, { error: 'fingerprint_mismatch' }),
  });
  const { screen, user } = await reachConfirmation(api);
  await user.click(screen.getByRole('button', { name: 'Confirm fingerprint' }));
  expect(await screen.findByRole('button', { name: 'Find my printer' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm fingerprint' })).toBeNull();
  expect(screen.queryByLabelText('Administrator password')).toBeNull();
  expect(api.sent('PUT /known-printers/printer-1/password')).toEqual([]);
});

test('failed first collection offers password correction instead of claiming jobs were collected', async () => {
  const api = fakeApi({
    'GET /health': noPrinter,
    'POST /printer-discovery': { printers: [discovered] },
    'POST /printer-enrolments': preview(),
    'POST /printer-enrolments/preview-1/confirm': knownPrinter(),
    'PUT /known-printers/printer-1/password': { saved: true },
    'POST /known-printers/printer-1/collect': reply(409, { error: 'collection_failed' }),
  });
  const { screen, user, router } = await reachConfirmation(api);
  await user.click(screen.getByRole('button', { name: 'Confirm fingerprint' }));
  await user.type(await screen.findByLabelText('Administrator password'), 'old-pass');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByText("Couldn't read the printer's log. Check the password, then try again.")).toBeTruthy();
  expect(router.state.location.pathname).toBe('/setup');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByLabelText('Administrator password')).toBeTruthy();
  expect(api.sent('POST /known-printers/printer-1/collect')).toEqual([{}]);
});

test('a MAC typed with hyphens is sent in the colon form the server accepts', async () => {
  const api = fakeApi({
    'GET /health': noPrinter,
    'POST /printer-enrolments': (request: Request) => request.clone().json().then((body: { mac?: string }) => preview({ mac: body.mac ?? null })),
    'DELETE /printer-enrolments/preview-1': { cancelled: true },
  });
  const { screen, user } = await renderApp('/setup', api);
  await user.click(await screen.findByRole('button', { name: 'Enter an address instead' }));
  await user.type(screen.getByRole('textbox', { name: 'Printer address' }), discovered.host);
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  await user.type(await screen.findByRole('textbox', { name: 'MAC address' }), '00-1E-8F-12-34-56');
  await user.click(screen.getByRole('button', { name: 'Find my printer' }));
  expect(await screen.findByRole('button', { name: 'Confirm fingerprint' })).toBeTruthy();
  expect(api.sent('POST /printer-enrolments')).toEqual([{ host: discovered.host }, { host: discovered.host, mac: '00:1E:8F:12:34:56' }]);
});

test('setup opened from Settings adds a printer; a first run or a re-check of a known printer sets one up', async () => {
  const opened = await renderApp('/setup', fakeApi({ 'GET /health': ready }));
  expect(await opened.screen.findByRole('heading', { name: /^Add a printer/ })).toBeTruthy();
  expect(opened.screen.getByRole('complementary', { name: 'Add a printer' })).toBeTruthy();
  opened.unmount();

  const recheck = await renderApp('/setup?host=192.168.1.42', fakeApi({ 'GET /health': ready, 'POST /printer-enrolments': preview() }));
  expect(await recheck.screen.findByRole('heading', { name: /^Set up your printer/ })).toBeTruthy();
  recheck.unmount();

  const first = await renderApp('/setup', fakeApi({ 'GET /health': noPrinter }));
  expect(await first.screen.findByRole('heading', { name: /^Set up your printer/ })).toBeTruthy();
});
