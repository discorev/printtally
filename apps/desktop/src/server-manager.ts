import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { DEFAULT_PORT, defaultDataDirectory } from './paths.ts';
import type { Remote } from './config.ts';

// ready: Print Tally answers. unreachable: a remote host doesn't (left for "Switch computer",
// plan decision 6). port_in_use: another app answers on the local port. failed: the bundled
// server didn't start, after a few tries.
export type ConnectionStatus = 'ready' | 'unreachable' | 'port_in_use' | 'failed';
export interface Connection { host: string; port: number; owns: boolean; remote: boolean; status: ConnectionStatus }
type SpawnFn = (command: string, args: string[]) => ChildProcess;
type Probe = 'printtally' | 'other' | 'down';
const MAX_FAILED_STARTS = 3;
// A server that exits this soon after answering counts as a failed start, so a crash loop still stops.
const STABLE_MS = 30_000;

export interface ServerManagerOptions {
  dataDirectory?: string; port?: number;
  // The packaging seam (plan step 06): dev runs the server from source with Bun, a
  // packaged build runs a compiled binary shipped under process.resourcesPath.
  packaged?: boolean; resourcesPath?: string; repoRoot?: string;
  spawnFn?: SpawnFn; fetchFn?: typeof fetch;
  healthTimeoutMs?: number; startupTimeoutMs?: number; pollIntervalMs?: number; clock?: () => number;
}

function serverCommand(options: Required<Pick<ServerManagerOptions, 'packaged' | 'resourcesPath' | 'repoRoot'>>, dataDirectory: string, port: number): { command: string; args: string[] } {
  const args = ['serve', '--port', String(port), '--data-dir', dataDirectory];
  if (options.packaged) return { command: resolve(options.resourcesPath, 'server', 'printtally-server'), args };
  return { command: 'bun', args: [resolve(options.repoRoot, 'apps/server/src/cli.ts'), ...args] };
}

export class ServerManager {
  private readonly dataDirectory: string;
  private readonly localPort: number;
  private readonly packaged: boolean;
  private readonly resourcesPath: string;
  private readonly repoRoot: string;
  private readonly spawnFn: SpawnFn;
  private readonly fetchFn: typeof fetch;
  private readonly healthTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly clock: () => number;

  private host = '127.0.0.1';
  private port: number;
  private remote = false;
  private status: ConnectionStatus = 'ready';
  private child: ChildProcess | undefined;
  private failedStarts = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private busy = false;
  private stopped = false;

  constructor(options: ServerManagerOptions = {}) {
    this.dataDirectory = options.dataDirectory ?? defaultDataDirectory();
    this.localPort = this.port = options.port ?? DEFAULT_PORT;
    this.packaged = options.packaged ?? false;
    this.resourcesPath = options.resourcesPath ?? '';
    this.repoRoot = options.repoRoot ?? resolve(import.meta.dirname, '..', '..', '..');
    this.spawnFn = options.spawnFn ?? ((command, args) => spawn(command, args, { stdio: 'inherit' }));
    this.fetchFn = options.fetchFn ?? fetch;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 20000;
    this.pollIntervalMs = options.pollIntervalMs ?? 300;
    this.clock = options.clock ?? Date.now;
  }

  get connection(): Connection {
    return { host: this.host, port: this.port, owns: !this.remote && this.child !== undefined, remote: this.remote, status: this.status };
  }

  // Same test as the CLI's checkPort. A remote host answers 401 until this device is paired;
  // the renderer holds that session cookie, not the main process, so 401 still means Print Tally.
  private async probe(host: string, port: number): Promise<Probe> {
    let response: Response;
    try { response = await this.fetchFn(`http://${host}:${port}/api/v1/health`, { signal: AbortSignal.timeout(this.healthTimeoutMs) }); }
    catch { return 'down'; }
    try {
      const body = await response.json() as { service?: unknown; error?: unknown };
      return (response.ok && body.service === 'printtally') || (response.status === 401 && body.error === 'unauthorized') ? 'printtally' : 'other';
    } catch { return 'other'; }
  }

  // connect() and ensureAlive() run one at a time, so a pairing link racing launch can't start two servers.
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => { this.busy = true; try { return await run(); } finally { this.busy = false; } });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async spawnAndWait(): Promise<boolean> {
    const { command, args } = serverCommand({ packaged: this.packaged, resourcesPath: this.resourcesPath, repoRoot: this.repoRoot }, this.dataDirectory, this.port);
    let startedAt: number | undefined;
    const child = this.spawnFn(command, args), gone = (): void => {
      if (this.child !== child) return;
      this.child = undefined;
      // Exits before answering are counted below; one that ran a while is a fresh start.
      if (startedAt !== undefined) this.failedStarts = this.clock() - startedAt < STABLE_MS ? this.failedStarts + 1 : 0;
    };
    this.child = child;
    child.on('exit', gone).on('error', gone);
    for (const deadline = Date.now() + this.startupTimeoutMs; this.child === child && Date.now() < deadline;) {
      if (await this.probe(this.host, this.port) === 'printtally') { startedAt = this.clock(); return true; }
      await new Promise(done => setTimeout(done, this.pollIntervalMs));
    }
    this.failedStarts++;
    return false;
  }

  // Use Print Tally already answering on this Mac, else start the bundled server on the same port
  // and data folder (plan decision 5). Never another port, and never over another app.
  private async useLocal(state: Probe): Promise<void> {
    // Our own server answering doesn't reset the count: it's judged when it exits.
    if (state === 'printtally') { this.status = 'ready'; if (!this.child) this.failedStarts = 0; return; }
    if (state === 'other') { this.status = 'port_in_use'; return; }
    if (this.child || this.stopped) return; // Still starting, or quitting.
    if (this.failedStarts >= MAX_FAILED_STARTS) { this.status = 'failed'; return; }
    this.status = await this.spawnAndWait() ? 'ready' : 'failed';
  }

  // A saved remote host is kept even when it doesn't answer; otherwise this Mac (plan decisions 3, 5, 6).
  connect(remote?: Remote): Promise<Connection> {
    return this.serial(async () => {
      if (remote) {
        this.host = remote.host; this.port = remote.port; this.remote = true;
        this.status = await this.probe(this.host, this.port) === 'printtally' ? 'ready' : 'unreachable';
        return this.connection;
      }
      this.host = '127.0.0.1'; this.port = this.localPort; this.remote = false; this.failedStarts = 0;
      await this.useLocal(await this.probe(this.host, this.port));
      return this.connection;
    });
  }

  // Polled by the app: restarts a server it launched, or takes over a borrowed one that went away
  // (plan decision 6). Each poll is one try, so a server that won't start isn't respawned in a loop.
  async ensureAlive(): Promise<void> {
    if (this.busy) return;
    await this.serial(async () => {
      const state = await this.probe(this.host, this.port);
      if (this.remote) this.status = state === 'printtally' ? 'ready' : 'unreachable';
      else await this.useLocal(state);
    });
  }

  stop(): void { this.stopped = true; this.child?.kill(); }
}
