import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalNetworkBlocked } from '../apps/server/src/local-network.ts';

const PRIVATE = '10.23.45.67', PUBLIC = '203.0.113.5';
const byCode = { code: 'EHOSTUNREACH' };
const byErrno = { errno: 65 };
const byNegativeErrno = { errno: -65 };
const byMessage = { message: 'connect No route to host' };

test('blocks only on darwin, a private address, and a host-unreachable error, in any of its three forms', () => {
  for (const error of [byCode, byErrno, byNegativeErrno, byMessage]) {
    assert.equal(isLocalNetworkBlocked(PRIVATE, error, 'darwin'), true, JSON.stringify(error));
  }
});

test('a public address never counts, even with the same error and platform', () => {
  for (const error of [byCode, byErrno, byNegativeErrno, byMessage]) {
    assert.equal(isLocalNetworkBlocked(PUBLIC, error, 'darwin'), false, JSON.stringify(error));
  }
});

test('off darwin, the same private-address error is never a Local Network block', () => {
  for (const platform of ['linux', 'win32'] as const) {
    for (const error of [byCode, byErrno, byNegativeErrno, byMessage]) {
      assert.equal(isLocalNetworkBlocked(PRIVATE, error, platform), false, `${platform} ${JSON.stringify(error)}`);
    }
  }
});

test('an unrelated error on darwin to a private address stays the generic failure', () => {
  assert.equal(isLocalNetworkBlocked(PRIVATE, new Error('connect ECONNREFUSED'), 'darwin'), false);
  assert.equal(isLocalNetworkBlocked(PRIVATE, { code: 'ECONNREFUSED' }, 'darwin'), false);
  assert.equal(isLocalNetworkBlocked(PRIVATE, undefined, 'darwin'), false);
});

test('a wrapped cause (as downloadPrinterRoot attaches, never the raw message) is unwrapped one level', () => {
  assert.equal(isLocalNetworkBlocked(PRIVATE, new Error('Printer root download failed', { cause: byCode }), 'darwin'), true);
  assert.equal(isLocalNetworkBlocked(PRIVATE, new Error('Printer root download failed', { cause: { code: 'ECONNREFUSED' } }), 'darwin'), false);
});
