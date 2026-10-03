import { app, BrowserWindow, ipcMain, shell } from 'electron';
// electron-updater is CommonJS without a named autoUpdater export that ES modules can import.
import electronUpdater from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ServerManager, type Connection } from './server-manager.ts';
import { loadAutoDownload, loadRemote, parseTarget, saveAutoDownload, saveRemote } from './config.ts';
import { readBuildInfo, runtimeSettings } from './build.ts';
import { UpdateManager } from './updater.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const devWebUrl = process.env.PRINTTALLY_WEB_URL ?? 'http://127.0.0.1:5173';
// Release, local or dev (src/build.ts): a release build always uses the fixed port and default data folder,
// a local build its own, and dev honours PRINTTALLY_PORT and PRINTTALLY_DATA_DIR.
const build = readBuildInfo(join(__dirname, 'build-info.json'), app.isPackaged, app.getVersion());
const packaged = build.kind !== 'dev';
const settings = runtimeSettings(build.kind, process.env, homedir());
if (settings.userData) app.setPath('userData', settings.userData);

const manager = new ServerManager({
  packaged, resourcesPath: process.resourcesPath, port: settings.port, dataDirectory: settings.dataDirectory, serverEnv: settings.serverEnv,
});
let window: BrowserWindow | undefined;
let quitting = false;
let showingProblem = false;
let pendingPair: string | undefined; // A pairing page to open once the host answers.
const updater = new UpdateManager(electronUpdater.autoUpdater, build.kind, process.env, loadAutoDownload(app.getPath('userData')),
  state => window?.webContents.send('update', state));

// This Mac's server serves the built UI; dev loads the Vite dev URL for hot reload instead. A remote
// host always serves its own UI, so the UI and the API it calls come from the same server.
function targetUrl(): string {
  const { host, port, remote } = manager.connection;
  return remote || packaged ? `http://${host}:${port}` : devWebUrl;
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
// Shown when there's no UI to load: a remote host that doesn't answer, or no local server.
function problemPage({ host, port, remote, status }: Connection): string {
  const message = status === 'unreachable' ? `Can't reach Print Tally on ${host}, retrying.`
    : status === 'port_in_use' ? `Another app is using port ${port}, so Print Tally can't start. Quit that app, then reopen Print Tally.`
    : "Print Tally's server didn't start. Quit and reopen Print Tally to try again.";
  const button = remote ? '<p><button onclick="window.printtally.switchComputer()">Use this Mac instead</button></p>' : '';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="en"><title>Print Tally</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:4rem auto;padding:0 1rem"><div style="position:fixed;inset:0 0 auto;height:40px;-webkit-app-region:drag"></div><h1 style="font-size:1.25rem">Print Tally</h1><p>${escapeHtml(message)}</p>${button}</body></html>`);
}

function broadcastConnection(): void { window?.webContents.send('connection', manager.connection); }

async function show(): Promise<void> {
  const connection = manager.connection;
  broadcastConnection();
  if (!window) return;
  showingProblem = connection.status !== 'ready';
  const url = showingProblem ? problemPage(connection) : pendingPair ?? targetUrl();
  if (!showingProblem) pendingPair = undefined;
  // A page that fails to load (e.g. the dev UI not up yet) is retried on the next check.
  await window.loadURL(url).catch(() => { showingProblem = true; });
}

// A pairing link (opened through printtally:// or pasted in), another computer's address, or
// none for this Mac. The window redeems a pairing code itself, so its session keeps the cookie.
async function useComputer(target: string | undefined): Promise<void> {
  const parsed = target ? parseTarget(target) : undefined;
  if (target && !parsed) throw new Error('not_a_print_tally_address');
  saveRemote(app.getPath('userData'), parsed?.remote);
  pendingPair = parsed?.pairUrl;
  if (!app.isReady()) return; // Launch connects to the saved host.
  await manager.connect(parsed?.remote);
  await show();
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1100, height: 760,
    // No title bar: the UI's top bar holds the traffic lights and drags the window (it knows it's in the app
    // from the preload bridge), as in the docket design.
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 19 },
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Only changelog links leave the app; keep every new Electron window denied.
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && target.hostname === 'github.com' && target.pathname.startsWith('/discorev/printtally/'))
        void shell.openExternal(target.href).catch(error => console.error('Could not open changelog:', error));
    } catch { /* ignore invalid links */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(targetUrl()).origin) event.preventDefault(); });
  window.on('close', event => {
    // Keep the app in the Dock; only quitting stops a server it owns, so collection continues.
    if (quitting) return;
    event.preventDefault();
    window?.hide();
  });
  await show();
}

app.setAsDefaultProtocolClient('printtally');
app.on('open-url', (event, url) => { event.preventDefault(); useComputer(url).catch(() => { /* ignore malformed pairing links */ }); });
app.on('window-all-closed', () => { /* stay in the Dock; quitting is the only way to stop */ });
app.on('before-quit', () => { quitting = true; updater.stop(); manager.stop(); });
app.on('activate', () => { window ? window.show() : void createWindow(); });

ipcMain.handle('connection:get', () => manager.connection);
ipcMain.handle('app:version', () => build.version);
ipcMain.handle('update:get', () => updater.getState());
ipcMain.handle('update:download', () => updater.download());
ipcMain.handle('update:install', () => updater.install(() => { quitting = true; manager.stop(); }));
ipcMain.handle('update:auto-download:get', () => updater.getAutoDownload());
ipcMain.handle('update:auto-download:set', (_event, on: unknown) => {
  if (typeof on !== 'boolean') throw new Error('invalid_auto_download_setting');
  saveAutoDownload(app.getPath('userData'), on);
  updater.setAutoDownload(on);
});
ipcMain.handle('connection:switch-computer', (_event, target: unknown) => {
  if (target !== undefined && typeof target !== 'string') throw new Error('not_a_print_tally_address');
  return useComputer(target || undefined);
});

app.whenReady().then(async () => {
  await manager.connect(loadRemote(app.getPath('userData')));
  await createWindow();
  updater.start();
  setInterval(() => {
    void manager.ensureAlive().then(() => {
      const { status } = manager.connection;
      broadcastConnection();
      // Recover from the problem page, or leave the UI when this Mac's server can't come back. A lost
      // remote keeps the UI, which shows its own banner.
      if (showingProblem ? status === 'ready' : status === 'port_in_use' || status === 'failed') return show();
    });
  }, 5000);
  console.log('window-ready');
});
