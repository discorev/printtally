import { expect, test } from 'bun:test';
import type { CartridgeView, InkResponse } from 'print-accounting-contracts';
import { commonCapacity, inkChannels, inkSet } from './channels.ts';

const cartridge = (id: number, channel: string, capacity_nl: number): CartridgeView =>
  ({ id, name: `PFI-1100 ${channel}`, channel, capacity_nl, open_remaining_nl: null, purchases: [], write_offs: [], spares: 0, used: 0, jobs: 0, used_micros: 0, waste_micros: 0 }) as unknown as CartridgeView;
const channels = (codes: string[], cartridges: CartridgeView[]) => inkChannels({ channels: codes, cartridges } as unknown as InkResponse);

test('a whole set is every channel in the list: its product, or a new one where it has none', () => {
  const list = channels(['PM', 'R', 'C', 'Y'], [cartridge(1, 'C', 80e6), cartridge(2, 'PM', 80e6), cartridge(3, 'C', 160e6)]);
  expect(inkSet(list)).toEqual({ productIds: [2, 1], missing: ['R', 'Y'] });
  expect(inkSet(channels(['PM'], []))).toEqual({ productIds: [], missing: ['PM'] });
});

test('a new product is assumed the size most are, the first in cartridge order on a tie', () => {
  expect(commonCapacity(channels(['C', 'PM', 'Y'], [cartridge(1, 'C', 160e6), cartridge(2, 'PM', 80e6), cartridge(3, 'Y', 80e6)]))).toBe(80e6);
  expect(commonCapacity(channels(['PM', 'C'], [cartridge(1, 'C', 160e6), cartridge(2, 'PM', 80e6)]))).toBe(80e6);
  expect(commonCapacity(channels(['PM'], []))).toBeUndefined();
});
