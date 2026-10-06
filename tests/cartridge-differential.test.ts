import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLedger, type LedgerInput } from 'print-accounting-core';
import { computeLedger as legacyLedger } from './fixtures/legacy-ledger.ts';

// Fixed seed keeps a failure reproducible and avoids global Math.random state.
let seed = 0x5eeda110;
const random = (max: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; };
const day = (index: number) => `2026-02-${String(index).padStart(2, '0')}`;
const close = (actual: number | null, expected: number | null, context: string, tolerance = 1) => {
  assert.equal(actual === null, expected === null, context);
  if (actual !== null && expected !== null) assert.ok(Math.abs(actual - expected) <= tolerance, `${context}: ${actual} vs ${expected}`);
};

// 360 independently generated one-printer histories for each pricing method.
// Their clocks increase with record IDs: backwards clocks are the documented exception.
test('unit allocation agrees with the frozen pre-cartridge ledger', () => {
  for (const method of ['oldest', 'average', 'max'] as const) for (let trial = 0; trial < 360; trial++) {
    const channels = ['C', 'M'];
    const input: LedgerInput = { method, jobs: [], papers: [], stock: [], paperPurchases: [], writeOffs: [],
      cartridges: channels.map((channel, i) => ({ id: i + 1, channel, name: `PFI-4100 ${channel}`, capacity_nl: 1_000_000 })), inkPurchases: [] };
    if (random(2)) input.cartridges.push({ id: 3, channel: 'C', name: 'PFI-4100 C', capacity_nl: 1_000_000 });
    for (const product of input.cartridges) {
      const count = 1 + random(3);
      for (let p = 0; p < count; p++) input.inkPurchases.push({ id: input.inkPurchases.length + 1,
        ink_product_id: product.id, purchased_on: day(1 + random(9)), cartridges: 1 + random(4),
        price_micros: 500_000 + random(60_000_000) });
    }
    const jobCount = 2 + random(9);
    for (let j = 0; j < jobCount; j++) {
      const date = day(2 + j * 2), at = `${date}T12:00:00`;
      input.jobs.push({ id: j + 1, printer_id: 1, source_record_id: j + 1, date, at, source_media_id: null,
        width_um: null, height_um: null, impressions: 0, stock_id: null, paper_id: null,
        ink: channels.map(channel => ({ channel, volume_nl: random(9) === 0 ? null : random(2_300_000) })) });
    }
    const offCount = 1 + random(5);
    for (let j = 0; j < offCount; j++) {
      const all_remaining = random(3) === 0;
      input.writeOffs.push({ id: j + 1, paper_stock_id: null, ink_product_id: 1 + random(input.cartridges.length), printer_id: null,
        written_off_on: day(2 + random(22)), quantity: all_remaining ? null : 1 + random(2_500_000), all_remaining });
    }
    const old = legacyLedger(input), next = computeLedger(input), label = `${method} trial ${trial}`;
    for (const job of input.jobs) for (const [i, line] of next.jobs.get(job.id)!.ink.entries())
      close(line.cost_micros, old.jobs.get(job.id)!.ink[i].cost_micros, `${label}, job ${job.id} ${line.channel}`);
    for (const off of input.writeOffs) {
      const a = next.writeOffs.get(off.id)!, b = old.writeOffs.get(off.id)!;
      assert.equal(a.written_off, b.written_off, `${label}, off ${off.id} quantity`);
      close(a.cost_micros, b.cost_micros, `${label}, off ${off.id} cost`);
    }
    close([...next.inkWaste.values()].reduce((sum, w) => sum + w.cost_micros, 0),
      [...old.writeOffs.values()].reduce((sum, off) => sum + (off.cost_micros ?? 0), 0), `${label}, waste`, input.writeOffs.length);
  }
});
