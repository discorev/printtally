import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { UpdateManager, type UpdateState } from './updater.ts';

const info = { version: '0.3.0', releaseDate: '2026-10-03T10:00:00.000Z', releaseNotes: '### Features\n\n* **desktop:** updates' };
class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  feed: unknown;
  checks = 0;
  downloads = 0;
  installs = 0;
  failCheck = false;
  failDownload = false;
  setFeedURL(feed: unknown): void { this.feed = feed; }
  async checkForUpdates(): Promise<null> {
    this.checks++;
    if (this.failCheck) throw new Error('offline');
    return null;
  }
  async downloadUpdate(): Promise<string[]> {
    this.downloads++;
    if (this.failDownload) throw new Error('offline');
    return [];
  }
  quitAndInstall(): void { this.installs++; }
}

function setup(kind: 'dev' | 'local' | 'release', env: Record<string, string> = {}, auto = false) {
  const fake = new FakeUpdater();
  const states: UpdateState[] = [];
  const manager = new UpdateManager(fake as unknown as ConstructorParameters<typeof UpdateManager>[0], kind, env, auto, state => states.push(state));
  return { fake, states, manager };
}

test('dev and local without a feed are disabled; release uses the generic latest feed', () => {
  const dev = setup('dev', { PRINTTALLY_UPDATE_FEED: 'http://localhost:4000', PRINTTALLY_UPDATE_PREVIEW: 'invalid' });
  dev.manager.start();
  expect(dev.manager.getState()).toEqual({ status: 'disabled' });
  expect(dev.fake.checks).toBe(0);
  expect(setup('local').manager.getState()).toEqual({ status: 'disabled' });
  const release = setup('release', { PRINTTALLY_UPDATE_PREVIEW: 'ready', PRINTTALLY_UPDATE_FEED: 'http://localhost:4000' });
  expect(release.manager.getState()).toEqual({ status: 'idle' });
  expect(release.fake.feed).toEqual({ provider: 'generic', url: 'https://github.com/discorev/printtally/releases/latest/download' });
  release.manager.stop();
});

test('local feed checks, normalises array notes, tracks progress, and stops after download', async () => {
  const { fake, manager, states } = setup('local', { PRINTTALLY_UPDATE_FEED: 'http://127.0.0.1:8000/' });
  expect(fake.feed).toEqual({ provider: 'generic', url: 'http://127.0.0.1:8000/' });
  expect(fake.autoDownload).toBe(false);
  expect(fake.autoInstallOnAppQuit).toBe(true);
  manager.start();
  expect(fake.checks).toBe(1);
  fake.emit('update-available', { ...info, releaseNotes: [{ version: '0.3.0', note: '### Features\n\n* **web:** new feature' }] });
  expect(manager.getState()).toEqual({ status: 'available', version: '0.3.0', notes: '### Features\n\n* **web:** new feature', date: info.releaseDate });
  await manager.download();
  fake.emit('download-progress', { percent: 47 });
  expect(manager.getState()).toMatchObject({ status: 'downloading', percent: 47 });
  fake.emit('update-downloaded', { ...info, releaseNotes: null });
  expect(manager.getState()).toEqual({ status: 'ready', version: '0.3.0', notes: '### Features\n\n* **web:** new feature', date: info.releaseDate });
  await manager.check();
  expect(fake.checks).toBe(1);
  let stoppedServer = false;
  manager.install(() => { stoppedServer = true; });
  expect(stoppedServer).toBe(true);
  expect(fake.installs).toBe(1);
  expect(states.map(state => state.status)).toEqual(['available', 'downloading', 'downloading', 'ready']);
});

test('auto-download toggles immediately on an offered update, and failed downloads return to available', async () => {
  const { fake, manager } = setup('release');
  fake.emit('update-available', info);
  fake.failDownload = true;
  const previous = console.error;
  console.error = () => {};
  try {
    manager.setAutoDownload(true);
    await Bun.sleep(0);
    expect(fake.downloads).toBe(1);
    expect(manager.getState().status).toBe('available');
    // electron-updater never downloads on its own: an unawaited download would hide its failure.
    expect(fake.autoDownload).toBe(false);
  } finally { console.error = previous; manager.stop(); }
});

test('with auto-download on, an offered update downloads through download()', async () => {
  const { fake, manager } = setup('release');
  manager.setAutoDownload(true);
  fake.emit('update-available', info);
  await Bun.sleep(0);
  expect(fake.downloads).toBe(1);
  expect(manager.getState()).toMatchObject({ status: 'downloading', percent: 0 });
  manager.stop();
});

test('a check error is logged but shown as idle', async () => {
  const { fake, manager } = setup('release');
  fake.failCheck = true;
  const previous = console.error;
  console.error = () => {};
  try {
    await manager.check();
    expect(manager.getState()).toEqual({ status: 'idle' });
  } finally { console.error = previous; manager.stop(); }
});

test('preview is local or dev only, and simulates download without installing', async () => {
  const { fake, manager } = setup('dev', { PRINTTALLY_UPDATE_PREVIEW: 'available' });
  expect(manager.getState()).toMatchObject({ status: 'available', version: '0.3.0' });
  expect(fake.feed).toBeUndefined();
  await manager.download();
  expect(manager.getState().status).toBe('downloading');
  await Bun.sleep(1400);
  expect(manager.getState().status).toBe('ready');
  const previous = console.log;
  console.log = () => {};
  try { manager.install(() => { throw new Error('preview must not stop server'); }); }
  finally { console.log = previous; manager.stop(); }
  expect(fake.installs).toBe(0);
  expect(setup('local', { PRINTTALLY_UPDATE_PREVIEW: 'downloading' }).manager.getState()).toMatchObject({ status: 'downloading', percent: 42 });
});
