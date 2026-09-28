import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotSchema } from 'print-accounting-contracts';
import { AccountingDatabase } from 'print-accounting-database';
import { digest, normalized } from 'print-accounting-core';
import { sample } from './fixtures.ts';
// Synthetic reference data only; used to check identity hashes stay stable across imports.
const reference = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url), 'utf8'));
test('imports the committed synthetic reference snapshot with compatible identities', () => {
  const snapshot = snapshotSchema.parse(reference.snapshot);
  assert.deepEqual(snapshot, sample());
  const identity = Object.fromEntries(['job_record_number', 'job_time_at_processing', 'job_name', 'job_owner'].map(name => [name, snapshot.records[0].raw[name] ?? null]));
  assert.equal(digest(identity), reference.identity_hash);
  assert.equal(digest({ raw: snapshot.records[0].raw, schema: snapshot.schema }), reference.content_hash);
  const dir = mkdtempSync(join(tmpdir(), 'printtally-reference-')), db = new AccountingDatabase(join(dir, 'db.sqlite3'));
  try {
    db.importSnapshot(reference.snapshot); db.importSnapshot(sample());
    assert.equal(db.summary().print_jobs, 1); assert.equal(db.summary().job_observations, 1);
    assert.equal(db.get('SELECT identity_hash FROM print_jobs')!.identity_hash, reference.identity_hash);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
test('normalized values match the reference decoder output', () => {
  const result = normalized(reference.normalized.raw, [
    { name: 'job_record_number', type: 'uint', order: '1' }, { name: 'job_name', type: 'string', order: '2' },
    { name: 'job_used_ink_C', type: 'uint', order: '3', unit: 'ml', factor: '1000' },
  ]);
  assert.deepEqual(result, reference.normalized);
});
