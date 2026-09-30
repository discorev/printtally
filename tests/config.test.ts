import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDataDirectory, parsePort } from '../apps/server/src/config.ts';
test('default data directory follows each platform convention', () => {
  assert.equal(defaultDataDirectory('darwin', '/Users/test'), '/Users/test/Library/Application Support/printtally');
  assert.equal(defaultDataDirectory('linux', '/home/test'), '/home/test/.printtally');
  assert.equal(defaultDataDirectory('win32', 'C:\\Users\\test', 'C:\\Users\\test\\AppData\\Roaming'), 'C:\\Users\\test\\AppData\\Roaming\\printtally');
  assert.equal(defaultDataDirectory('win32', 'C:\\Users\\test', undefined), 'C:\\Users\\test\\AppData\\Roaming\\printtally');
});
test('ports are whole numbers from 1 to 65535', () => {
  assert.equal(parsePort('4318'), 4318);
  for (const invalid of ['0', '65536', '43.18', '-1', '', '4318abc']) assert.throws(() => parsePort(invalid));
});
