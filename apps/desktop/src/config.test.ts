import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRemote, parseTarget, saveRemote } from './config.ts';

const code = 'a'.repeat(43);

test('a pairing link keeps its host, port and code, and becomes the http page that redeems it', () => {
  for (const link of [`printtally://studio-mac:4400/pair#code=${code}`, `http://studio-mac:4400/pair#code=${code}`])
    expect(parseTarget(link)).toEqual({ remote: { host: 'studio-mac', port: 4400 }, pairUrl: `http://studio-mac:4400/pair#code=${code}` });
});

test('a bare address uses the default port and has nothing to redeem', () => {
  expect(parseTarget(' studio-mac.local ')).toEqual({ remote: { host: 'studio-mac.local', port: 4318 }, pairUrl: undefined });
  expect(parseTarget('192.0.2.50:4400')).toEqual({ remote: { host: '192.0.2.50', port: 4400 }, pairUrl: undefined });
  expect(parseTarget(`printtally://studio-mac/pair#code=short`)?.pairUrl).toBeUndefined();
});

test('anything else is not a Print Tally address', () => {
  for (const text of ['', 'https://studio-mac', 'file:///etc/passwd', 'http://']) expect(parseTarget(text)).toBeUndefined();
});

test('the remote host is remembered, and forgetting it means this Mac', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-desktop-'));
  try {
    expect(loadRemote(dir)).toBeUndefined();
    saveRemote(dir, { host: 'studio-mac', port: 4400 });
    expect(loadRemote(dir)).toEqual({ host: 'studio-mac', port: 4400 });
    saveRemote(dir, undefined);
    expect(loadRemote(dir)).toBeUndefined();
  } finally { rmSync(dir, { recursive: true }); }
});
