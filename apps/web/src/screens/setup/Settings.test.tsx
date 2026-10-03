import { afterEach, expect, mock, test } from 'bun:test';
import type { PrintTallyBridge, UpdateState } from '../../desktop.ts';
import { screen, waitFor, within } from '@testing-library/react';
import type { KnownPrinterListing } from 'print-accounting-contracts';
import { fakeApi, reply } from '../../../test/api.ts';
import { health, knownPrinter, ledgerSpanReads, printerStatus, settings, totalsResponse } from '../../../test/fixtures.ts';
import { renderApp } from '../../../test/render.tsx';

const printer = knownPrinter();
const settingsReads = (printers: KnownPrinterListing[] = [printer]) => ({
  'GET /health': health({ printers: printers.map(item => printerStatus({ id: item.id, host: item.host, name: item.name,
    state: item.hasPassword ? 'ready' : 'needs_password' })) }),
  'GET /settings': settings(),
  'GET /totals': totalsResponse(),
  'GET /known-printers': { printers },
  ...ledgerSpanReads(),
});

// Desktop availability is captured at module load, so keep separate bridge-backed and browser copies.
const browser = await import('../../desktop.ts' + '?settings-browser-test') as typeof import('../../desktop.ts');
let update: UpdateState = { status: 'idle' };
const setAutoDownload = mock(async (_on: boolean) => {});
const bridge: PrintTallyBridge = {
  getVersion: async () => '0.2.0',
  getConnection: async () => ({ host: 'localhost', port: 3000, owns: true, remote: false, ownership: 'owned', status: 'ready' }),
  switchComputer: async () => {}, onConnectionChange: () => () => {},
  getUpdate: async () => update, onUpdateChange: () => () => {},
  getAutoDownload: async () => false, setAutoDownload,
};
window.printtally = bridge;
const app = await import('../../desktop.ts' + '?settings-desktop-test') as typeof import('../../desktop.ts');
delete window.printtally;

const renderDesktopSettings = async () => {
  window.printtally = bridge;
  mock.module('../../desktop.ts', () => ({ ...app }));
  return renderApp('/settings', fakeApi(settingsReads()));
};

afterEach(() => {
  mock.module('../../desktop.ts', () => ({ ...browser }));
  delete window.printtally;
  setAutoDownload.mockClear();
});

test('costing method stays on server choice during save and rejection, then changes only after confirmation', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let attempts = 0;
  let saved = settings();
  const api = fakeApi({
    ...settingsReads(),
    'GET /settings': () => saved,
    'PATCH /settings': () => ++attempts === 1 ? pending : (saved = settings({ costing_method: 'average' })),
  });
  const { screen, user } = await renderApp('/settings', api);
  const oldest = await screen.findByRole('radio', { name: /Oldest/ });
  const average = screen.getByRole('radio', { name: /Average/ });
  expect(oldest.getAttribute('aria-checked')).toBe('true');
  await user.click(average);
  expect(api.sent('PATCH /settings')).toEqual([{ costing_method: 'average' }]);
  expect(oldest.getAttribute('aria-checked')).toBe('true');
  expect(average.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('radiogroup', { name: 'Costing method' }).getAttribute('aria-busy')).toBe('true');
  expect(screen.getByText('Saving…')).toBeTruthy();

  release(reply(422, { error: 'invalid_request' }));
  expect(await screen.findByText('Not saved. Check the form and try again.')).toBeTruthy();
  expect(oldest.getAttribute('aria-checked')).toBe('true');
  await user.click(average);
  await waitFor(() => expect(average.getAttribute('aria-checked')).toBe('true'));
  expect(api.sent('PATCH /settings')).toEqual([{ costing_method: 'average' }, { costing_method: 'average' }]);
  expect(screen.queryByText('Not saved. Check the form and try again.')).toBeNull();
});

test('printer password rejection keeps the editor open and never reports a saved credential', async () => {
  let attempts = 0;
  let listed = printer;
  const api = fakeApi({
    ...settingsReads(),
    'GET /known-printers': () => ({ printers: [listed] }),
    'PUT /known-printers/printer-1/password': () => {
      if (++attempts === 1) return reply(503, { error: 'credential_store_failed' });
      listed = { ...listed, hasPassword: true };
      return { saved: true };
    },
  });
  const { screen, user } = await renderApp('/settings', api);
  expect(await screen.findByText(/Not saved yet/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Enter it' }));
  const password = screen.getByLabelText('Administrator password') as HTMLInputElement;
  expect(password.type).toBe('password');
  await user.type(password, 'new-secret');
  await user.click(within(password.closest('form')!).getByRole('button', { name: 'Show' }));
  expect(password.type).toBe('text');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', "Not saved. Couldn't use the keychain.");
  expect(screen.queryByText(/Password saved/)).toBeNull();
  expect(screen.getByLabelText('Administrator password')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByText(/Password saved .* It's used from the next collection/)).toBeTruthy();
  expect(api.sent('PUT /known-printers/printer-1/password')).toEqual([{ password: 'new-secret' }, { password: 'new-secret' }]);
});

test('settings shows an empty printer state linking to setup', async () => {
  const api = fakeApi({ ...settingsReads([]), 'GET /health': health() });
  const { screen, user, router } = await renderApp('/settings', api);
  expect(await screen.findByText('No printer is set up yet.')).toBeTruthy();
  await user.click(screen.getByRole('link', { name: 'Set up your printer' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
  expect(screen.getByRole('button', { name: 'Find my printer' })).toBeTruthy();
});

test('the automatic download toggle is absent in a browser and when updates are disabled', async () => {
  mock.module('../../desktop.ts', () => ({ ...browser }));
  const api = fakeApi(settingsReads());
  const browserView = await renderApp('/settings', api);
  expect(await screen.findByRole('radiogroup', { name: 'Costing method' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Download updates automatically' })).toBeNull();
  browserView.unmount();

  update = { status: 'disabled' };
  await renderDesktopSettings();
  expect(await screen.findByText('App version')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Download updates automatically' })).toBeNull();
});

test('an idle desktop app can opt in to automatic downloads', async () => {
  update = { status: 'idle' };
  const { screen, user } = await renderDesktopSettings();
  const toggle = await screen.findByRole('checkbox', { name: 'Download updates automatically' }) as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  await user.click(toggle);
  expect(toggle.checked).toBe(true);
  expect(setAutoDownload).toHaveBeenCalledWith(true);
});
