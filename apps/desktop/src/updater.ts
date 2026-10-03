import type { AppUpdater } from 'electron-updater';
import type { BuildKind } from './build.ts';

type Client = Pick<AppUpdater, 'autoDownload' | 'autoInstallOnAppQuit' | 'setFeedURL' | 'on' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall'>;
type NativeInfo = { version: string; releaseDate: string; releaseNotes?: string | Array<{ note: string | null }> | null };

export interface UpdateInfo { version: string; notes: string; date: string }
export type UpdateState =
  | { status: 'disabled' | 'idle' }
  | ({ status: 'available' | 'ready' } & UpdateInfo)
  | ({ status: 'downloading'; percent: number } & UpdateInfo);

const RELEASE_FEED = 'https://github.com/discorev/printtally/releases/latest/download';
const CHECK_INTERVAL = 60 * 60 * 1000;
const previewInfo: UpdateInfo = {
  version: '0.3.0', date: '2026-10-03T10:00:00.000Z',
  notes: '### Features\n\n* **desktop:** download and install updates from the app\n* **web:** name new paper from its printer media\n\n### Bug Fixes\n\n* **core:** correct ink totals for cancelled jobs',
};

function normalise(info: NativeInfo): UpdateInfo {
  const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes
    : info.releaseNotes?.map(entry => entry.note).filter((note): note is string => !!note).join('\n\n') ?? '';
  return { version: info.version, notes, date: info.releaseDate };
}

export class UpdateManager {
  private state: UpdateState;
  private autoDownload: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private previewTimer?: ReturnType<typeof setInterval>;
  private checking = false;
  private downloading = false;
  private readonly isPreview: boolean;

  constructor(
    private readonly client: Client,
    kind: BuildKind,
    env: Record<string, string | undefined>,
    autoDownload: boolean,
    private readonly onChange: (state: UpdateState) => void,
  ) {
    this.autoDownload = autoDownload;
    const preview = kind !== 'release' && env.PRINTTALLY_UPDATE_PREVIEW;
    this.isPreview = preview === 'available' || preview === 'downloading' || preview === 'ready';
    const feed = kind === 'release' ? RELEASE_FEED : kind === 'local' ? env.PRINTTALLY_UPDATE_FEED : undefined;
    this.state = preview === 'downloading' ? { status: 'downloading', percent: 42, ...previewInfo }
      : preview === 'available' || preview === 'ready' ? { status: preview, ...previewInfo }
      : feed ? { status: 'idle' } : { status: 'disabled' };
    if (this.state.status === 'disabled' || this.isPreview) return;

    // Downloads always go through download(), which catches a failed one; electron-updater's own autoDownload starts
    // one inside checkForUpdates() whose rejection nothing awaits.
    client.autoDownload = false;
    client.autoInstallOnAppQuit = true;
    client.setFeedURL({ provider: 'generic', url: feed! });
    client.on('update-available', info => {
      if (this.state.status === 'ready') return;
      const offer = normalise(info);
      this.setState({ status: 'available', ...offer });
      if (this.autoDownload) void this.download();
    });
    client.on('update-not-available', () => {
      if (this.state.status !== 'ready' && this.state.status !== 'downloading') this.setState({ status: 'idle' });
    });
    client.on('download-progress', progress => {
      if (this.state.status === 'downloading') this.setState({ ...this.state, percent: Math.max(0, Math.min(100, progress.percent)) });
    });
    client.on('update-downloaded', info => {
      this.downloading = false;
      this.setState({ status: 'ready', ...normalise(info) });
      this.stop();
    });
    client.on('error', error => {
      console.error('Update failed:', error);
      if (this.state.status === 'ready') return;
      if (this.state.status === 'downloading') this.setState({ ...this.state, status: 'available' });
      else this.setState({ status: 'idle' });
    });
  }

  getState(): UpdateState { return this.state; }
  getAutoDownload(): boolean { return this.autoDownload; }

  start(): void {
    if (this.state.status === 'disabled' || this.state.status === 'ready' || this.isPreview || this.timer) return;
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, CHECK_INTERVAL);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.timer = undefined;
    this.previewTimer = undefined;
  }

  async check(): Promise<void> {
    if (this.state.status === 'disabled' || this.state.status === 'ready' || this.state.status === 'downloading' || this.isPreview || this.checking) return;
    this.checking = true;
    try { await this.client.checkForUpdates(); }
    catch (error) { console.error('Update check failed:', error); this.setState({ status: 'idle' }); }
    finally { this.checking = false; }
  }

  setAutoDownload(on: boolean): void {
    this.autoDownload = on;
    if (this.state.status === 'disabled') return;
    if (on && this.state.status === 'available') void this.download();
  }

  async download(): Promise<void> {
    if (this.state.status !== 'available' || this.downloading) return;
    this.downloading = true;
    this.setState({ ...this.state, status: 'downloading', percent: 0 });
    if (this.isPreview) {
      this.previewTimer = setInterval(() => {
        if (this.state.status !== 'downloading') return;
        const percent = Math.min(100, this.state.percent + 20);
        this.setState({ ...this.state, percent });
        if (percent === 100) {
          this.setState({ status: 'ready', ...previewInfo });
          this.downloading = false;
          this.stop();
        }
      }, 250);
      return;
    }
    try { await this.client.downloadUpdate(); }
    catch (error) {
      console.error('Update download failed:', error);
      const state = this.getState();
      if (state.status === 'downloading') this.setState({ ...state, status: 'available' });
    } finally { this.downloading = false; }
  }

  install(beforeInstall: () => void): void {
    if (this.state.status !== 'ready') return;
    this.stop();
    if (this.isPreview) { console.log('Preview: would install update', this.state.version); return; }
    beforeInstall();
    this.client.quitAndInstall();
  }

  private setState(state: UpdateState): void {
    this.state = state;
    this.onChange(state);
  }
}
