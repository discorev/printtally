import { describe, expect, test, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { ServerManager } from './server-manager.ts';

type Answer = 'printtally' | 'unpaired' | 'other' | 'down';

function fakeChild(): { child: ChildProcess; exit: () => void } {
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, { kill: mock(() => true) }) as unknown as ChildProcess;
  return { child, exit: () => emitter.emit('exit') };
}

// Answers health checks in turn, repeating the last one.
function answering(...answers: Answer[]): typeof fetch & { answers: Answer[] } {
  const fn = mock(async () => {
    const answer = fn.answers.length > 1 ? fn.answers.shift()! : fn.answers[0];
    if (answer === 'down') throw new TypeError('fetch failed');
    const [status, body] = answer === 'printtally' ? [200, { service: 'printtally', apiVersion: 1 }] : answer === 'unpaired' ? [401, { error: 'unauthorized' }] : [200, { ok: true }];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch & { answers: Answer[] };
  fn.answers = answers;
  return fn;
}

const options = { pollIntervalMs: 1, startupTimeoutMs: 50 };

describe('ServerManager', () => {
  test('borrows a Print Tally already answering locally, without spawning', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const manager = new ServerManager({ spawnFn, fetchFn: answering('printtally') });
    expect(await manager.connect()).toEqual({ host: '127.0.0.1', port: 4318, owns: false, remote: false, ownership: 'borrowed', status: 'ready' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('starts its own server when nothing answers locally, once however many connects race', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const manager = new ServerManager({ ...options, spawnFn, fetchFn: answering('down', 'printtally') });
    const [first, second] = await Promise.all([manager.connect(), manager.connect()]);
    expect([first.owns, first.status, second.owns]).toEqual([true, 'ready', true]);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  test('reports ownership: owned once it spawns a server, borrowed when it found one, remote for a saved host', async () => {
    const owned = new ServerManager({ ...options, spawnFn: mock(() => fakeChild().child), fetchFn: answering('down', 'printtally') });
    expect((await owned.connect()).ownership).toBe('owned');

    const borrowed = new ServerManager({ spawnFn: mock(() => fakeChild().child), fetchFn: answering('printtally') });
    expect((await borrowed.connect()).ownership).toBe('borrowed');

    const remote = new ServerManager({ spawnFn: mock(() => fakeChild().child), fetchFn: answering('printtally') });
    expect((await remote.connect({ host: 'studio-mac', port: 4500 })).ownership).toBe('remote');
  });

  test('never starts over another app on the port', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const manager = new ServerManager({ ...options, spawnFn, fetchFn: answering('other') });
    expect((await manager.connect()).status).toBe('port_in_use');
    await manager.ensureAlive();
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('uses a saved remote host on its own port, including one that needs this device paired', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const manager = new ServerManager({ spawnFn, fetchFn: answering('unpaired'), port: 4400 });
    expect(await manager.connect({ host: 'studio-mac', port: 4500 })).toEqual({ host: 'studio-mac', port: 4500, owns: false, remote: true, ownership: 'remote', status: 'ready' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('keeps a saved remote host that does not answer, for "Switch computer", instead of starting a server', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const fetchFn = answering('down');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn, port: 4400 });
    expect(await manager.connect({ host: 'studio-mac', port: 4318 })).toEqual({ host: 'studio-mac', port: 4318, owns: false, remote: true, ownership: 'remote', status: 'unreachable' });
    await manager.ensureAlive();
    fetchFn.answers = ['printtally'];
    await manager.ensureAlive();
    expect(manager.connection.status).toBe('ready');
    // Switching to this Mac uses the configured local port, not the remote's.
    fetchFn.answers = ['down', 'printtally'];
    expect(await manager.connect()).toMatchObject({ host: '127.0.0.1', port: 4400, owns: true });
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  test('restarts a server it owns after it crashes', async () => {
    const children = [fakeChild(), fakeChild()];
    const spawnFn = mock(() => children[spawnFn.mock.calls.length - 1].child);
    const fetchFn = answering('down', 'printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn });
    await manager.connect();
    children[0].exit();
    expect(manager.connection.owns).toBe(false);
    fetchFn.answers = ['down', 'printtally'];
    await manager.ensureAlive();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(manager.connection).toMatchObject({ owns: true, status: 'ready' });
  });

  test('gives up after a few failed starts instead of respawning in a loop', async () => {
    const spawnFn = mock(() => { const { child, exit } = fakeChild(); setTimeout(exit, 1); return child; });
    const manager = new ServerManager({ ...options, spawnFn, fetchFn: answering('down') });
    expect((await manager.connect()).status).toBe('failed');
    for (let i = 0; i < 5; i++) await manager.ensureAlive();
    expect(spawnFn).toHaveBeenCalledTimes(3);
    expect(manager.connection.status).toBe('failed');
  });

  test('gives up on a server that keeps crashing soon after it starts', async () => {
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn = mock(() => { const made = fakeChild(); children.push(made); return made.child; });
    const fetchFn = answering('down', 'printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn });
    await manager.connect();
    for (let i = 0; i < 5; i++) {
      children.at(-1)!.exit(); // Crashes seconds after answering.
      fetchFn.answers = ['down', 'printtally'];
      await manager.ensureAlive();
    }
    expect(spawnFn).toHaveBeenCalledTimes(3);
    expect(manager.connection).toMatchObject({ owns: false, status: 'failed' });
  });

  test('keeps restarting a server that ran a while before each crash', async () => {
    let now = 0;
    const children: ReturnType<typeof fakeChild>[] = [];
    const spawnFn = mock(() => { const made = fakeChild(); children.push(made); return made.child; });
    const fetchFn = answering('down', 'printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn, clock: () => now });
    await manager.connect();
    for (let i = 0; i < 5; i++) {
      fetchFn.answers = ['printtally'];
      await manager.ensureAlive(); // Answering polls while it runs don't change the count.
      now += 31_000;
      children.at(-1)!.exit();
      fetchFn.answers = ['down', 'printtally'];
      await manager.ensureAlive();
    }
    expect(spawnFn).toHaveBeenCalledTimes(6);
    expect(manager.connection).toMatchObject({ owns: true, status: 'ready' });
  });

  test('takes over when a borrowed local server disappears', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const fetchFn = answering('printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn });
    expect((await manager.connect()).owns).toBe(false);
    fetchFn.answers = ['down', 'printtally'];
    await manager.ensureAlive();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(manager.connection.owns).toBe(true);
  });

  test("a local build's port and data folder reach the probe, the takeover and the compiled server", async () => {
    const spawnFn = mock((_command: string, _args: string[]) => fakeChild().child);
    const fetchFn = answering('printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn, packaged: true, resourcesPath: '/App/Contents/Resources', port: 4319, dataDirectory: '/tmp/seeded' });
    await manager.connect();
    fetchFn.answers = ['down', 'printtally'];
    await manager.ensureAlive();
    const urls = (fetchFn as unknown as { mock: { calls: [string][] } }).mock.calls.map(([url]) => url);
    expect(new Set(urls)).toEqual(new Set(['http://127.0.0.1:4319/api/v1/health']));
    expect(spawnFn.mock.calls).toEqual([['/App/Contents/Resources/server/printtally-server', ['serve', '--port', '4319', '--data-dir', '/tmp/seeded']]]);
  });

  test('does not start a server once quitting', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const fetchFn = answering('printtally');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn });
    await manager.connect();
    manager.stop();
    fetchFn.answers = ['down'];
    await manager.ensureAlive();
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
