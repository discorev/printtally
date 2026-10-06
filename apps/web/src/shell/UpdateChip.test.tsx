import { afterEach, expect, mock, test } from 'bun:test';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PrintTallyBridge, UpdateState } from '../desktop.ts';

// The bridge is captured when desktop.ts is evaluated. Load separate browser and desktop copies so
// these tests can exercise both surfaces without relying on the order Bun loads other test files.
const browser = await import('../desktop.ts' + '?chip-browser-test') as typeof import('../desktop.ts');
const listeners = new Set<(state: UpdateState) => void>();
let state: UpdateState = { status: 'idle' };
const downloadUpdate = mock(async () => {}), installUpdate = mock(async () => {});
const bridge: PrintTallyBridge = {
  getVersion: async () => '0.2.0',
  getConnection: async () => ({ host: 'localhost', port: 3000, owns: true, remote: false, ownership: 'owned', status: 'ready' }),
  switchComputer: async () => {}, onConnectionChange: () => () => {},
  getUpdate: async () => state,
  onUpdateChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  downloadUpdate, installUpdate,
};
window.printtally = bridge;
const app = await import('../desktop.ts' + '?chip-desktop-test') as typeof import('../desktop.ts');
delete window.printtally;
const { UpdateChip } = await import('./UpdateChip.tsx');

const offer = { version: '0.3.0', date: '2026-10-01T12:00:00Z', notes: '' };
const useBridge = (update: UpdateState | undefined) => {
  state = update ?? { status: 'idle' };
  if (update === undefined) delete window.printtally;
  else window.printtally = bridge;
  mock.module('../desktop.ts', () => ({ ...(update === undefined ? browser : app) }));
};
const show = async () => {
  const view = render(<UpdateChip />), user = userEvent.setup();
  // The bridge's initial state comes back asynchronously.
  await act(async () => {});
  return { ...view, user };
};

afterEach(() => {
  mock.module('../desktop.ts', () => ({ ...browser }));
  delete window.printtally;
  listeners.clear();
  downloadUpdate.mockClear();
  installUpdate.mockClear();
});

test('no update chip appears in a browser, or while desktop updates are disabled or idle', async () => {
  useBridge(undefined);
  const browserView = await show();
  expect(screen.queryByRole('button', { name: /update|downloading|restart/i })).toBeNull();
  browserView.unmount();

  useBridge({ status: 'disabled' });
  const disabled = await show();
  expect(screen.queryByRole('button', { name: /update|downloading|restart/i })).toBeNull();
  disabled.unmount();

  useBridge({ status: 'idle' });
  await show();
  expect(screen.queryByRole('button', { name: /update|downloading|restart/i })).toBeNull();
});

test('an available update offers a download', async () => {
  useBridge({ status: 'available', ...offer });
  const { user } = await show();
  await user.click(screen.getByRole('button', { name: 'Update to 0.3.0' }));
  expect(downloadUpdate).toHaveBeenCalledTimes(1);
  expect(installUpdate).not.toHaveBeenCalled();
});

test('download progress is shown but cannot trigger another action', async () => {
  useBridge({ status: 'downloading', percent: 42.8, ...offer });
  const { user } = await show();
  const chip = screen.getByRole('button', { name: 'Downloading 42%' });
  expect(chip.getAttribute('aria-disabled')).toBe('true');
  await user.click(chip);
  expect(downloadUpdate).not.toHaveBeenCalled();
  expect(installUpdate).not.toHaveBeenCalled();
});

test('a ready update restarts into the downloaded version', async () => {
  useBridge({ status: 'ready', ...offer });
  const { user } = await show();
  await user.click(screen.getByRole('button', { name: 'Restart to update' }));
  expect(installUpdate).toHaveBeenCalledTimes(1);
  expect(downloadUpdate).not.toHaveBeenCalled();
});

test('an update pushed by the desktop bridge re-renders the chip', async () => {
  useBridge({ status: 'idle' });
  await show();
  expect(listeners.size).toBe(1);
  await act(async () => { for (const listener of listeners) listener({ status: 'available', ...offer }); });
  expect(screen.getByRole('button', { name: 'Update to 0.3.0' })).toBeTruthy();
  await act(async () => { for (const listener of listeners) listener({ status: 'downloading', percent: 71.9, ...offer }); });
  expect(screen.getByRole('button', { name: 'Downloading 71%' })).toBeTruthy();
});

test('keyboard focus opens the grouped receipt; Escape closes it and the changelog compares releases', async () => {
  useBridge({ status: 'available', ...offer, notes: [
    '### Features', '* **desktop:** install updates without leaving the app',
    '* **web:** show release notes in the top bar',
    '### Bug Fixes', '* **backend:** keep print costs accurate',
  ].join('\n') });
  const { user } = await show();
  await user.tab();
  const chip = screen.getByRole('button', { name: 'Update to 0.3.0' });
  expect(document.activeElement).toBe(chip);
  const receipt = await screen.findByRole('dialog', { name: 'Update to Print Tally 0.3.0' });
  const newItems = within(within(receipt).getByRole('region', { name: 'New' })).getAllByRole('listitem');
  expect(newItems.map(item => item.textContent)).toEqual([
    'Install updates without leaving the appdesktop', 'Show release notes in the top barweb',
  ]);
  const fixes = within(within(receipt).getByRole('region', { name: 'Fixed' })).getAllByRole('listitem');
  expect(fixes.map(item => item.textContent)).toEqual(['Keep print costs accuratebackend']);
  expect(within(receipt).getByText('3 changes')).toBeTruthy();
  // The installed version comes back asynchronously, after the receipt opens.
  const changelog = within(receipt).getByRole('link', { name: 'Full changelog on GitHub' });
  await waitFor(() => expect(changelog.getAttribute('href'))
    .toBe('https://github.com/discorev/printtally/compare/app-v0.2.0...app-v0.3.0'));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(chip);
});
