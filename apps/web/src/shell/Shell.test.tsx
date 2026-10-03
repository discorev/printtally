import { expect, test } from 'bun:test';
import { act, waitFor, within } from '@testing-library/react';
import type { ImportsResponse, MissedJobs } from 'print-accounting-contracts';
import { LOCAL_NETWORK_BLOCKED } from '../api/client.ts';
import { connection } from '../connection/index.ts';
import { fakeApi, reply } from '../../test/api.ts';
import { health, jobsScreenReads, ledgerSpanReads, paper, papers, printerStatus, settings, totalsResponse } from '../../test/fixtures.ts';
import { renderApp } from '../../test/render.tsx';

const gap = (overrides: Partial<MissedJobs> = {}): MissedJobs => ({
  printerId: 'printer-1', printerName: 'Studio printer', fromRecord: 18, toRecord: 21,
  detectedAt: '2026-09-30T12:00:00Z', ...overrides,
});
const settingsRoutes = () => ({
  'GET /settings': settings(),
  'GET /totals': totalsResponse(),
  'GET /known-printers': { printers: [] },
  ...ledgerSpanReads(),
});

test('the entry URL opens Jobs and section links navigate with an active destination and a named server chip', async () => {
  const fake = fakeApi({ 'GET /health': health({ hostName: 'studio-mac' }), ...jobsScreenReads() });
  const { screen, user, router } = await renderApp('/', fake);
  const nav = within(await screen.findByRole('banner')).getByRole('navigation', { name: 'Sections' });
  expect(await screen.findByText('No prints yet. Collect from the printer and they appear here.')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/jobs');
  expect(within(nav).getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByTitle(`Serving on ${location.host}`).textContent).toContain('studio-mac');

  await user.click(within(nav).getByRole('link', { name: 'Papers' }));
  expect(await screen.findByRole('option', { name: /Test paper/ })).toBeTruthy();
  expect(within(nav).getByRole('link', { name: 'Papers' }).getAttribute('aria-current')).toBe('page');
  expect(within(nav).getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBeNull();
  expect(router.state.location.pathname).toBe('/papers');
  expect(fake.requests).toContainEqual({ method: 'GET', path: '/papers', body: undefined });
});

test('a 401 health response opens Connect and retry returns to Jobs when pairing is restored', async () => {
  let paired = false;
  const fake = fakeApi({
    'GET /health': () => paired ? health({ hostName: 'studio-mac' }) : reply(401, { error: 'unauthorized' }),
    ...jobsScreenReads(),
  });
  const { screen, user, router } = await renderApp('/jobs', fake);
  expect(await screen.findByRole('complementary', { name: 'Pair this device' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/connect');
  expect(screen.getByRole('complementary', { name: 'Pair this device' }).textContent).toContain('printtally pair');
  expect(screen.getByText(/Open the link it prints in this browser/)).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  paired = true;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('listbox', { name: 'Prints' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/jobs');
  expect(fake.requests.filter(request => request.path === '/health')).toHaveLength(2);
});

test('a revoked session reported by an ordinary screen request also sends the user to Connect', async () => {
  const fake = fakeApi({ 'GET /papers': reply(401, { error: 'unauthorized' }) });
  const { screen, router } = await renderApp('/papers', fake);
  expect(await screen.findByRole('complementary', { name: 'Pair this device' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/connect');
  expect(fake.requests).toContainEqual({ method: 'GET', path: '/papers', body: undefined });
});

test('a server with no printer opens the centered Setup instead of the requested screen', async () => {
  const fake = fakeApi({ 'GET /health': health({ state: 'needs_printer' }), 'GET /papers': papers() });
  const { screen, router } = await renderApp('/papers', fake);
  expect(await screen.findByRole('complementary', { name: 'Set up your printer' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/setup');
  expect(screen.queryByRole('navigation', { name: 'Sections' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Find my printer' })).toBeTruthy();
});

test('a first load during an outage explains why papers cannot load and disables adding stock', async () => {
  const fake = fakeApi({
    'GET /health': () => { throw new TypeError('offline'); },
    'GET /papers': () => { throw new TypeError('offline'); },
  });
  const { screen } = await renderApp('/papers', fake);
  expect(await screen.findByText("Can't load papers until the server is back.")).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain("Can't reach Print Tally on ");
  expect(screen.getByTitle(`Serving on ${location.host}`).textContent).toContain(' · retrying');
  expect(screen.getByRole('link', { name: 'Add stock' }).getAttribute('aria-disabled')).toBe('true');
});

test('loaded papers stay visible while lost, edits disable, and recovery refetches them', async () => {
  let online = true;
  let current = papers([paper({ name: 'Original stock' })]);
  const fake = fakeApi({
    'GET /health': () => online ? health({ hostName: 'studio-mac' }) : (() => { throw new TypeError('offline'); })(),
    'GET /papers': () => current,
    'GET /settings': settings(),
  });
  const { screen } = await renderApp('/papers', fake);
  expect(await screen.findByRole('option', { name: /Original stock/ })).toBeTruthy();
  online = false;
  await act(async () => { await connection.check(); });
  expect(screen.getByRole('option', { name: /Original stock/ })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain("Can't reach Print Tally on studio-mac — retrying");
  expect(screen.getByRole('link', { name: 'Add stock' }).getAttribute('aria-disabled')).toBe('true');
  current = papers([paper({ name: 'Updated stock' })]);
  online = true;
  await act(async () => { await connection.check(); });
  expect(await screen.findByRole('option', { name: /Updated stock/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Original stock/ })).toBeNull();
  expect(screen.queryAllByRole('status').map(status => status.textContent)).toEqual([]);
  expect(screen.getByRole('link', { name: 'Add stock' }).getAttribute('aria-disabled')).toBeNull();
  expect(fake.requests.filter(request => request.path === '/papers')).toHaveLength(2);
});

test('the missed-jobs strip links to Collect, where the gap is explained without repeating the strip', async () => {
  const fake = fakeApi({
    'GET /health': health({ missedJobs: [gap(), gap({ fromRecord: 31, toRecord: 31 })] }),
    ...jobsScreenReads(),
    'GET /imports?limit=20': { imports: [], limit: 20, offset: 0 } satisfies ImportsResponse,
    ...ledgerSpanReads(),
  });
  const { screen, user, router } = await renderApp('/jobs', fake);
  const strip = await screen.findByRole('status');
  expect(strip.textContent).toContain('last collected job 17');
  expect(strip.textContent).toContain('now starts at job 22');
  expect(strip.textContent).toContain('1 more gap under Collect');
  await user.click(within(strip).getByRole('button', { name: 'Details' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/collect'));
  expect(await screen.findAllByRole('alert')).toHaveLength(2);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Collect now' })).toBeTruthy();
});

test('printer attention strips offer the right remedy outside Collect, but Collect shows the full explanation', async () => {
  const fake = fakeApi({
    'GET /health': health({ printers: [
      printerStatus({ state: 'needs_confirming' }),
      printerStatus({ id: 'printer-2', name: 'Backup printer', host: '192.168.1.43', state: 'needs_password' }),
      printerStatus({ id: 'printer-3', name: 'Office printer', host: '192.168.1.44', state: 'local_network_blocked' }),
    ] }),
    ...jobsScreenReads(),
    'GET /imports?limit=20': { imports: [], limit: 20, offset: 0 } satisfies ImportsResponse,
    ...ledgerSpanReads(),
  });
  const { screen, user, router } = await renderApp('/jobs', fake);
  const strips = await screen.findAllByRole('status');
  expect(strips).toHaveLength(3);
  expect(strips[0].textContent).toContain("Studio printer's certificate changed");
  expect(within(strips[0]).getByRole('link', { name: 'Check the fingerprint' }).getAttribute('href')).toContain('host=192.168.1.42');
  expect(strips[1].textContent).toContain('no password for Backup printer');
  expect(within(strips[1]).getByRole('link', { name: 'Enter the password' }).getAttribute('href')).toBe('/settings');
  expect(strips[2].textContent).toContain(LOCAL_NETWORK_BLOCKED);
  await user.click(within(within(screen.getByRole('banner')).getByRole('navigation', { name: 'Sections' })).getByRole('link', { name: 'Collect' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/collect'));
  const alerts = await screen.findAllByRole('alert');
  expect(screen.queryByRole('status')).toBeNull();
  expect(alerts.map(alert => alert.textContent)).toEqual(expect.arrayContaining([
    expect.stringContaining("The printer's certificate changed"), expect.stringContaining('The printer needs its password'),
  ]));
  expect(screen.getByText(LOCAL_NETWORK_BLOCKED)).toBeTruthy();
});
