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
    expect(await manager.connect()).toEqual({ host: '127.0.0.1', port: 4318, owns: false, remote: false, status: 'ready' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('starts its own server when nothing answers locally, once however many connects race', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const manager = new ServerManager({ ...options, spawnFn, fetchFn: answering('down', 'printtally') });
    const [first, second] = await Promise.all([manager.connect(), manager.connect()]);
    expect([first.owns, first.status, second.owns]).toEqual([true, 'ready', true]);
    expect(spawnFn).toHaveBeenCalledTimes(1);
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
    expect(await manager.connect({ host: 'studio-mac', port: 4500 })).toEqual({ host: 'studio-mac', port: 4500, owns: false, remote: true, status: 'ready' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  test('keeps a saved remote host that does not answer, for "Switch computer", instead of starting a server', async () => {
    const spawnFn = mock(() => fakeChild().child);
    const fetchFn = answering('down');
    const manager = new ServerManager({ ...options, spawnFn, fetchFn, port: 4400 });
    expect(await manager.connect({ host: 'studio-mac', port: 4318 })).toEqual({ host: 'studio-mac', port: 4318, owns: false, remote: true, status: 'unreachable' });
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
