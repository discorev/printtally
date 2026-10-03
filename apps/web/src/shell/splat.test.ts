import { expect, test } from 'bun:test';
import { SPLAT, splatParts } from './splat.ts';

test('the splat is the same every time: a closed body path and its eleven droplets', () => {
  expect(SPLAT.body).toStartWith('M');
  expect(SPLAT.body).toEndWith('Z');
  expect(SPLAT.droplets).toHaveLength(11);
  expect(splatParts({ R: 6.2, cx: 13, cy: 15 })).toEqual(SPLAT);
});
