import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { AccountingDatabase, Ledger } from 'print-accounting-database';

const CHANNELS = ['B', 'C', 'CO', 'GY', 'M', 'MBK', 'PBK', 'PC', 'PGY', 'PM', 'R', 'Y'];
// A ledger as the first release left it: 76 jobs on one printer, 12 ink channels each, and user annotations.
function firstRelease(path: string): void {
  // Recorded the way Drizzle's migrator records it: the file's SHA-256 and the journal's timestamp.
  const folder = fileURLToPath(new URL('../packages/database/drizzle/', import.meta.url)), file = readFileSync(folder + '0000_initial.sql', 'utf8');
  const initial = { sql: file.split('--> statement-breakpoint'), hash: createHash('sha256').update(file).digest('hex'),
    folderMillis: JSON.parse(readFileSync(folder + 'meta/_journal.json', 'utf8')).entries[0].when as number };
  const raw = new Database(path);
  raw.exec('PRAGMA foreign_keys=ON');
  raw.transaction(() => {
    for (const statement of initial.sql) raw.exec(statement);
    raw.exec('CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    raw.query('INSERT INTO "__drizzle_migrations"(hash, created_at) VALUES(?, ?)').run(initial.hash, initial.folderMillis);
    const at = '2026-09-28T15:41:09.661000+00:00';
    raw.exec(`INSERT INTO printers(id,mac,last_host,first_seen_at,last_seen_at) VALUES(1,'020000000001','192.0.2.10','${at}','${at}')`);
    raw.exec(`INSERT INTO import_runs(id,printer_id,source,started_at,status) VALUES(1,1,'live','${at}','succeeded')`);
    raw.exec(`INSERT INTO media_configs(id,printer_id,source_media_id,first_seen_at,last_seen_at) VALUES(1,1,'custom-media-type-canon-A','${at}','${at}')`);
    raw.exec(`INSERT INTO media_revisions(id,media_id,content_hash,names_json,english_name,first_observed_at,last_observed_at) VALUES(1,1,'h','{"EN":"Museum Etching"}','Museum Etching','${at}','${at}')`);
    raw.exec('UPDATE media_configs SET current_revision_id=1');
    for (let id = 1; id <= 76; id++) {
      const started = `202601${String(1 + (id % 28)).padStart(2, '0')}10${String(id % 60).padStart(2, '0')}00`;
      raw.query(`INSERT INTO print_jobs(id,printer_id,source_record_id,identity_hash,identity_json,first_seen_at,last_seen_at) VALUES(?,1,?,?,'{}',?,?)`).run(id, id, 'identity' + id, at, at);
      raw.query(`INSERT INTO job_observations(id,job_id,content_hash,first_import_id,first_observed_at,last_observed_at,raw_json,media_config_id,job_name,started_at_raw,width_um,height_um,impressions)
        VALUES(?,?,'c',1,?,?,'{}',1,?,?,210000,297000,1)`).run(id, id, at, at, `PPL_${started}_001`, started);
      raw.query('UPDATE print_jobs SET current_observation_id=? WHERE id=?').run(id, id);
      for (const channel of CHANNELS) raw.query('INSERT INTO job_ink_usage(observation_id,channel,volume_nl) VALUES(?,?,?)').run(id, channel, 10000 * id);
    }
    raw.exec(`INSERT INTO job_annotations(job_id,custom_paper_name,hidden,notes,physical_sheet_count,paper_cost_override_micros,paper_cost_currency,updated_at)
      VALUES(3,'Test pack',0,'Edition 1/10',1,500000,'GBP','${at}'),(4,NULL,1,NULL,NULL,NULL,NULL,'${at}')`);
    raw.exec('PRAGMA application_id=1128353872');
  })();
  raw.close();
}

test('the ledger migration keeps every job, observation, ink reading and annotation of a first-release ledger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'printtally-migrate-')), path = join(dir, 'accounting.sqlite3');
  try {
    firstRelease(path);
    const db = new AccountingDatabase(path);
    try {
      assert.equal(db.all('SELECT * FROM __drizzle_migrations').length, 3);
      assert.deepEqual([db.summary().print_jobs, db.summary().job_observations, db.summary().job_ink_usage], [76, 76, 76 * 12]);
      assert.deepEqual(db.all('SELECT job_id,custom_paper_name,paper_stock_id,paper_id,hidden,notes FROM job_annotations ORDER BY job_id'), [
        { job_id: 3, custom_paper_name: 'Test pack', paper_stock_id: null, paper_id: null, hidden: 0, notes: 'Edition 1/10' },
        { job_id: 4, custom_paper_name: null, paper_stock_id: null, paper_id: null, hidden: 1, notes: null },
      ]);
      const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name);
      for (const gone of ['paper_prices', 'ink_prices', 'media_stock_mappings']) assert.ok(!tables.includes(gone));
      assert.deepEqual(db.all('PRAGMA foreign_key_check'), []); assert.deepEqual(db.get('PRAGMA integrity_check'), { integrity_check: 'ok' });
      const ledger = new Ledger(db);
      assert.deepEqual(ledger.settings(), { costing_method: 'oldest', currency: 'GBP' });
      assert.equal(ledger.jobs({ includeHidden: true, limit: 1000 }).total, 76);
      assert.deepEqual(ledger.jobs({ q: 'edition' }).jobs.map(job => [job.job_id, job.display_paper_name]), [[3, 'Test pack']]);
      assert.equal(ledger.job(1)!.job.ink.length, 12);
    } finally { db.close(); }
    const reopened = new AccountingDatabase(path);
    reopened.close();
  } finally { rmSync(dir, { recursive: true }); }
});
