import { expect, test } from 'bun:test';
import { currencySymbol, dateDay, dateLong, dateShort, duration, metres, ml, money, monthLong, parseMoney, plural, printerTime, stockQuantity } from './format.ts';
import { sizeCode, sizeName } from './sizes.ts';

test('money is integer micros in the ledger currency; unknown is a dash', () => {
  expect([money(1_860_000, 'GBP'), money(0, 'GBP'), money(null, 'GBP'), money(151_304_000, 'GBP'), currencySymbol('GBP')])
    .toEqual(['£1.86', '£0.00', '—', '£151.30', '£']);
  expect(money(2_500_000, 'EUR')).toBe('€2.50');
});

test('typed prices parse to micros, refusing anything that is not a positive amount', () => {
  expect(['37.99', '£37.99', ' 1,200 ', '.5', '0', '-3', 'abc', '1.999'].map(parseMoney))
    .toEqual([37_990_000, 37_990_000, 1_200_000_000, 500_000, null, null, null, null]);
});

test('quantities and dates format to the expected display strings', () => {
  expect([ml(940_000), ml(null), metres(10_500_000), stockQuantity(31, 'sheet'), stockQuantity(10_460_000, 'roll'), plural(1, 'print'), plural(1398, 'job')])
    .toEqual(['0.94 ml', '—', '10.5 m', '31 sheets', '10.5 m', '1 print', '1,398 jobs']);
  expect([dateShort('2026-09-12'), dateDay('2026-09-12'), dateLong('2026-09-12'), monthLong('2026-09-12')])
    .toEqual(['12 Sep 2026', 'Sat 12', 'Saturday 12 September 2026', 'September 2026']);
  expect([printerTime('20260912171246'), printerTime(null), duration('20260912171246', '20260912171711'), duration('20260912171246', '20260912171300')])
    .toEqual(['17:12', '', '4 min 25 s', '14 s']);
});

test('job sizes are named as the printer names them', () => {
  expect([sizeName(210_000, 297_000), sizeName(297_000, 210_000), sizeName(329_000, 483_000), sizeName(304_800, 304_800), sizeName('431800', '914400'), sizeName(300_000, 400_000), sizeName(null, 1)])
    .toEqual(['A4', 'A4', 'A3+', 'Square 12×12 in', '17×36 in', '300×400 mm', 'Unknown size']);
  expect(['Square 12×12 in', '13×19 in (Super B)', '17×36 in', 'L 89×127 mm', 'A4'].map(sizeCode)).toEqual(['12×12', '13×19', '17×36', 'L', 'A4']);
});
