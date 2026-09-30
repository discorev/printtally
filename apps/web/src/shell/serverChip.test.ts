import { expect, test } from 'bun:test';
import { showServerChip } from './serverChip.ts';

test('a browser always shows the chip, regardless of ownership', () => {
  expect(showServerChip({ desktop: false, ownership: undefined })).toBe(true);
  expect(showServerChip({ desktop: false, ownership: 'owned' })).toBe(true);
  expect(showServerChip({ desktop: false, ownership: 'borrowed' })).toBe(true);
  expect(showServerChip({ desktop: false, ownership: 'remote' })).toBe(true);
});

test('the desktop app hides the chip only once it owns the server it started', () => {
  expect(showServerChip({ desktop: true, ownership: 'owned' })).toBe(false);
  expect(showServerChip({ desktop: true, ownership: 'borrowed' })).toBe(true);
  expect(showServerChip({ desktop: true, ownership: 'remote' })).toBe(true);
});

test('the desktop app shows the chip until ownership is known', () => {
  expect(showServerChip({ desktop: true, ownership: undefined })).toBe(true);
});
