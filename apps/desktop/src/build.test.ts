import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildInfo, runtimeSettings } from './build.ts';

const home = '/Users/test', support = '/Users/test/Library/Application Support';
const overrides = { PRINTTALLY_PORT: '4400', PRINTTALLY_DATA_DIR: '/tmp/seeded' };

test('a release build uses the real ledger on 4318 and ignores the overrides', () => {
  const settings = { port: 4318, dataDirectory: `${support}/printtally`, serverEnv: {} };
  expect(runtimeSettings('release', {}, home)).toEqual(settings);
  expect(runtimeSettings('release', overrides, home)).toEqual(settings);
});

test('a local build defaults to printtally-dev on 4319, keeps its settings apart and passwords in memory', () => {
  expect(runtimeSettings('local', {}, home)).toEqual({
    port: 4319, dataDirectory: `${support}/printtally-dev`, userData: `${support}/printtally-dev/desktop`,
    serverEnv: { PRINTTALLY_MEMORY_SECRETS: '1' },
  });
});

test('a local build honours PRINTTALLY_PORT and PRINTTALLY_DATA_DIR, and falls back on a bad port', () => {
  expect(runtimeSettings('local', overrides, home)).toMatchObject({ port: 4400, dataDirectory: '/tmp/seeded' });
  expect(runtimeSettings('local', { PRINTTALLY_PORT: '4318x' }, home).port).toBe(4319);
});

test('running from source keeps the real defaults and honours the overrides', () => {
  expect(runtimeSettings('dev', {}, home)).toEqual({ port: 4318, dataDirectory: `${support}/printtally`, serverEnv: {} });
  expect(runtimeSettings('dev', overrides, home)).toEqual({ port: 4400, dataDirectory: '/tmp/seeded', serverEnv: {} });
});

test('the build kind comes from build-info.json; a packaged app without it counts as local', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-build-')), file = join(dir, 'build-info.json');
  try {
    expect(readBuildInfo(file, false, '0.1.0')).toEqual({ kind: 'dev', version: '0.1.0-dev' });
    expect(readBuildInfo(file, true, '0.1.0')).toEqual({ kind: 'local', version: '0.1.0-local' });
    writeFileSync(file, JSON.stringify({ kind: 'release', version: '0.2.0' }));
    expect(readBuildInfo(file, true, '0.2.0')).toEqual({ kind: 'release', version: '0.2.0' });
    writeFileSync(file, JSON.stringify({ kind: 'production', version: '0.2.0' }));
    expect(readBuildInfo(file, true, '0.2.0').kind).toBe('local');
  } finally { rmSync(dir, { recursive: true }); }
});
